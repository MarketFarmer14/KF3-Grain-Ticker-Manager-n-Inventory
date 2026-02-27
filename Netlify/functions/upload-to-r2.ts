// Netlify Function: Upload images to Cloudflare R2
// Location: netlify/functions/upload-to-r2.ts

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { imageBase64, fileName } = JSON.parse(event.body);

    if (!imageBase64 || !fileName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing image or fileName' }),
      };
    }

    // Initialize R2 client (compatible with S3 API)
    const r2 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: 'kf3-grain-tickets',
      Key: `tickets/${fileName}`,
      Body: imageBuffer,
      ContentType: 'image/jpeg',
    });

    await r2.send(command);

    // Construct public URL
    // Format: https://pub-{account_hash}.r2.dev/tickets/{fileName}
    // You'll get this URL after enabling public access
    const publicUrl = `${process.env.R2_PUBLIC_URL}/tickets/${fileName}`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        url: publicUrl,
      }),
    };
  } catch (error: any) {
    console.error('R2 Upload Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Upload failed',
        details: error.message,
      }),
    };
  }
};
