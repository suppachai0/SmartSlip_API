import { NextRequest, NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import { google } from 'googleapis';
import crypto from 'crypto';

// Initialize LINE client
const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

// Initialize Google Drive API
const drive = google.drive({
  version: 'v3',
  auth: new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url:
        'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.GOOGLE_CERT_URL,
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  }),
});

/**
 * Verify LINE Webhook Signature
 */
function verifyLineSignature(
  body: string,
  signature: string
): boolean {
  if (!process.env.LINE_CHANNEL_SECRET) {
    console.error('LINE_CHANNEL_SECRET not set');
    return false;
  }

  const hash = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');

  return hash === signature;
}

/**
 * Get image content from LINE Message API
 */
async function getImageFromLine(messageId: string): Promise<Buffer> {
  try {
    const response = await lineClient.getMessageContent(messageId);
    const chunks: Buffer[] = [];

    // Convert readable stream to buffer
    for await (const chunk of response as any) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  } catch (error) {
    console.error('Error getting image from LINE:', error);
    throw new Error('Failed to get image from LINE');
  }
}

/**
 * Upload buffer to Google Drive
 */
async function uploadToGoogleDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!folderId) {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID not set');
    }

    // Create file metadata
    const fileMetadata = {
      name: fileName,
      parents: [folderId],
      mimeType,
      // Make file publicly readable
      permissions: [
        {
          type: 'anyone',
          role: 'reader',
        },
      ],
    };

    // Upload file
    const response = await drive.files.create({
      requestBody: fileMetadata as any,
      media: {
        mimeType,
        body: require('stream').Readable.from([fileBuffer]),
      },
      fields: 'id, webViewLink, webContentLink',
      supportsAllDrives: true,
    });

    const fileId = response.data.id;

    if (!fileId) {
      throw new Error('Failed to get file ID from Google Drive response');
    }

    // Generate public link
    const publicLink = `https://drive.google.com/uc?id=${fileId}&export=view`;

    console.log('File uploaded successfully:', {
      fileId,
      fileName,
      publicLink,
    });

    return publicLink;
  } catch (error) {
    console.error('Error uploading to Google Drive:', error);
    throw new Error('Failed to upload to Google Drive');
  }
}

/**
 * Send reply message to LINE
 */
async function sendLineReply(
  replyToken: string,
  messages: line.Message[]
): Promise<void> {
  try {
    await lineClient.replyMessage(replyToken, messages);
    console.log('Reply sent successfully to LINE');
  } catch (error) {
    console.error('Error sending reply to LINE:', error);
    throw new Error('Failed to send reply to LINE');
  }
}

/**
 * Process LINE webhook events
 */
async function processLineEvent(
  event: line.WebhookEvent
): Promise<void> {
  // Only handle message events
  if (event.type !== 'message') {
    console.log('Ignoring non-message event:', event.type);
    return;
  }

  // Only handle image messages
  if (event.message.type !== 'image') {
    console.log('Ignoring non-image message:', event.message.type);

    // Send text reply for non-image messages
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '📸 Please send an image message. I will upload it to Google Drive and share the link with you.',
      },
    ]);

    return;
  }

  try {
    console.log('Processing image message:', event.message.id);

    // Step 1: Get image from LINE
    const imageBuffer = await getImageFromLine(event.message.id);
    console.log('Image retrieved from LINE, size:', imageBuffer.length, 'bytes');

    // Step 2: Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `receipt-${timestamp}.jpg`;

    // Step 3: Upload to Google Drive
    const publicLink = await uploadToGoogleDrive(imageBuffer, fileName, 'image/jpeg');

    // Step 4: Send reply to LINE with the public link
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '✅ Image uploaded successfully to Google Drive!',
      },
      {
        type: 'template',
        altText: 'Image uploaded',
        template: {
          type: 'buttons',
          text: 'Your receipt image has been uploaded.',
          actions: [
            {
              type: 'uri',
              label: '📂 View on Google Drive',
              uri: publicLink,
            },
            {
              type: 'postback',
              label: '⬇️ Download Link',
              data: `action=download&url=${encodeURIComponent(publicLink)}`,
            },
          ],
        },
      },
    ]);

    console.log('Image processing completed successfully');
  } catch (error) {
    console.error('Error processing image event:', error);

    // Send error message to LINE user
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '❌ Sorry, there was an error processing your image. Please try again later.',
      },
    ]);
  }
}

/**
 * POST /api/line
 * Handle LINE Messaging API webhook
 */
export async function POST(request: NextRequest) {
  try {
    // Get signature from header
    const signature = request.headers.get('x-line-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing X-Line-Signature header' },
        { status: 400 }
      );
    }

    // Get raw body
    const body = await request.text();

    // Verify signature
    if (!verifyLineSignature(body, signature)) {
      console.error('Invalid LINE signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 403 }
      );
    }

    // Parse events
    const events = JSON.parse(body).events as line.WebhookEvent[];

    console.log(`Received ${events.length} event(s) from LINE`);

    // Process each event
    for (const event of events) {
      try {
        await processLineEvent(event);
      } catch (error) {
        console.error('Error processing individual event:', error);
        // Continue processing other events
      }
    }

    // Return success response
    return NextResponse.json(
      {
        success: true,
        message: 'Webhook processed successfully',
        eventsCount: events.length,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Error in LINE webhook handler:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
