// Netlify Function: AI Ticket Reader
// Location: netlify/functions/read-ticket.ts

import OpenAI from 'openai';

export const handler = async (event: any) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { imageBase64 } = JSON.parse(event.body);

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No image provided' }),
      };
    }

    // Initialize OpenAI with API key from environment
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Call Vision API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are reading a grain delivery ticket. Extract ALL visible information and return it as JSON. 

CRITICAL RULES:
- Return ONLY valid JSON, no markdown, no explanations
- Use null for missing fields
- Date format: YYYY-MM-DD
- Crop must be exactly "Corn" or "Soybeans" (capitalize first letter)
- Through must be exactly one of: "Akron", "RVC", "Cargill", "ADM", or null
- Numbers must be numbers, not strings

Expected JSON format:
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
  "notes": "string or null"
}

Extract whatever you can see. If you can't read something, use null.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;
    
    // Parse the JSON response
    let extractedData;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedData = JSON.parse(cleanContent || '{}');
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', content);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Failed to parse AI response',
          rawResponse: content 
        }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(extractedData),
    };
  } catch (error: any) {
    console.error('OpenAI API Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'AI processing failed', 
        details: error.message 
      }),
    };
  }
};
