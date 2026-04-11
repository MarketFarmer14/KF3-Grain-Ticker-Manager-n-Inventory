// Netlify Function: AI Ticket Reader with Usage Tracking
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Fetch image from R2 via S3 API (avoids CORS and SSL certificate issues with public URLs)
async function fetchImageFromR2(imageUrl: string): Promise<Buffer> {
  const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  // Extract the key from the public URL (e.g., ".../tickets/1234-image.jpg" -> "tickets/1234-image.jpg")
  const urlPath = new URL(imageUrl).pathname;
  const key = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;

  const command = new GetObjectCommand({
    Bucket: 'kf3-grain-tickets',
    Key: key,
  });

  const response = await r2.send(command);
  const stream = response.Body as any;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Step tracking for detailed error reporting
  let step = 'parsing request';

  try {
    const { imageUrl, imageBase64 } = JSON.parse(event.body);

    if (!imageUrl && !imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No image provided' }) };
    }

    // Step 1: Get image as base64
    step = 'fetching image';
    let base64Data: string;
    if (imageBase64) {
      base64Data = imageBase64;
    } else {
      const imageBuffer = await fetchImageFromR2(imageUrl);
      base64Data = imageBuffer.toString('base64');
      if (!base64Data || base64Data.length < 100) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: `Image fetch returned empty/tiny result from: ${imageUrl}` }),
        };
      }
    }

    // Step 2: Check env vars
    step = 'checking environment';
    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY not set in Netlify env vars' }) };
    }

    // Step 3: Usage tracking (optional - don't block on failure)
    step = 'checking usage';
    let currentUsage = 0;
    let supabase: any = null;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        supabase = createClient(supabaseUrl, supabaseKey);
        const { data: usageData } = await supabase.rpc('get_ai_usage');
        currentUsage = usageData?.[0]?.count || 0;
        if (currentUsage >= 500) {
          return { statusCode: 429, body: JSON.stringify({ error: 'Monthly AI limit reached (500/month)' }) };
        }
      } catch (usageErr) {
        console.error('Usage check failed, continuing anyway:', usageErr);
      }
    }

    // Step 4: Call OpenAI Vision API
    step = 'calling OpenAI';
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are reading a grain delivery ticket. Extract ALL visible information and return ONLY valid JSON.

Rules:
- Return ONLY JSON, no markdown, no explanations
- Use null for missing/unreadable fields
- Date format: YYYY-MM-DD
- Crop: exactly "Corn" or "Soybeans"
- Through: exactly "Akron", "RVC", "Cargill", "ADM", or null
- Bushels, moisture_percent, and dockage must be numbers
- Dockage/shrink is a percentage deducted for foreign material

{
  "ticket_date": "YYYY-MM-DD or null",
  "ticket_number": "string or null",
  "person": "string or null",
  "crop": "Corn or Soybeans or null",
  "bushels": number or null,
  "delivery_location": "string or null",
  "through": "Akron or RVC or Cargill or ADM or null",
  "truck": "string or null",
  "moisture_percent": number or null,
  "dockage": number or null,
  "notes": "any extra info or null"
}`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Data}` },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    // Step 5: Parse response
    step = 'parsing AI response';
    const content = response.choices[0].message.content;
    let extractedData;
    try {
      const clean = content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedData = JSON.parse(clean || '{}');
    } catch {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'AI returned unparseable response', details: content }),
      };
    }

    // Step 6: Increment usage
    step = 'updating usage';
    if (supabase) {
      try { await supabase.rpc('increment_ai_usage'); } catch { /* non-critical */ }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...extractedData, _usage: currentUsage + 1, _limit: 500 }),
    };
  } catch (error: any) {
    console.error(`AI Error at step "${step}":`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `AI failed at step: ${step}`,
        details: error.message || String(error),
      }),
    };
  }
};
