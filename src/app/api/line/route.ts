import { NextRequest, NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import crypto from 'crypto';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { extractSlipDataWithGeminiFallback } from '@/lib/geminiExtraction';
import { uploadToCloudStorage } from '@/lib/cloudStorage'; // Cloud Storage (non-blocking)
import { appendReceiptToSheet } from '@/lib/googleSheets';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

// Initialize LINE client
const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

/**
 * Diagnostic: Check environment and service health
 */
function checkEnvironmentHealth(): {
  status: 'healthy' | 'warning' | 'error';
  checks: Record<string, boolean | string>;
} {
  const checks: Record<string, boolean | string> = {
    LINE_CHANNEL_ACCESS_TOKEN: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_CHANNEL_SECRET: !!process.env.LINE_CHANNEL_SECRET,
    MONGODB_URI: !!process.env.MONGODB_URI,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PROJECT_ID: !!process.env.GOOGLE_PROJECT_ID,
    GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
    GOOGLE_CLOUD_STORAGE_BUCKET_NAME: !!process.env.GOOGLE_CLOUD_STORAGE_BUCKET_NAME,
  };

  const allHealthy = Object.values(checks).every((v) => v === true);
  const status = allHealthy ? 'healthy' : 'error';

  return { status, checks };
}

/**
 * Verify LINE Webhook Signature
 * Compares HMAC-SHA256 signature from LINE header with calculated hash
 */
function verifyLineSignature(body: string, signature: string): boolean {
  if (!process.env.LINE_CHANNEL_SECRET) {
    console.error('โ LINE_CHANNEL_SECRET not configured');
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
      .update(body)
      .digest('base64');

    const isValid = hash === signature;
    
    if (!isValid) {
      console.warn('โ ๏ธ Invalid LINE signature');
      console.warn('Expected:', signature);
      console.warn('Got:', hash);
    }

    return isValid;
  } catch (error) {
    console.error('โ Error verifying signature:', error);
    return false;
  }
}

/**
 * Get image content from LINE Message API
 */
async function getImageFromLine(messageId: string): Promise<Buffer> {
  try {
    console.log(`๐“ฅ Downloading image from LINE: ${messageId}`);
    const response = await lineClient.getMessageContent(messageId);
    const chunks: Buffer[] = [];

    // Convert readable stream to buffer
    for await (const chunk of response as any) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    console.log(`โ… Image downloaded successfully: ${buffer.length} bytes`);
    return buffer;
  } catch (error) {
    console.error('โ Error getting image from LINE:', error);
    throw new Error('Failed to get image from LINE');
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
    console.log('๐“ค Sending reply to LINE...');
    await lineClient.replyMessage(replyToken, messages);
    console.log('โ… Reply sent successfully to LINE');
  } catch (error) {
    console.error('โ Error sending reply to LINE:', error);
    throw new Error('Failed to send reply to LINE');
  }
}

/**
 * BACKGROUND FUNCTION: Process receipt asynchronously
 * Runs AFTER returning 200 to LINE
 */
async function processReceiptInBackground(
  userId: string,
  messageId: string,
  imageBuffer: Buffer
): Promise<void> {
  try {
    console.log(`\n๐” [BACKGROUND] Starting async receipt processing for user ${userId}`);

    // Step 1: Connect to MongoDB
    await connectToDatabase();

    // Step 2: Extract data with Gemini
    console.log('๐ค– [BG] Extracting data with Gemini...');
    const slipData = await extractSlipDataWithGeminiFallback(imageBuffer);
    console.log('โ… [BG] Extraction complete:', {
      amount: slipData.amount,
      sender: slipData.sender,
      receiver: slipData.receiver,
    });

    // Check if extraction failed completely
    if (slipData.method === 'manual_required' && slipData.amount === 0) {
      console.error('โ [BG] Extraction failed - image could not be processed');
      await lineClient.pushMessage(userId, {
        type: 'text',
        text: 'โ เธเธญเธญเธ เธฑเธข เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธญเนเธฒเธเนเธเน€เธชเธฃเนเธเธเธตเนเนเธ”เน\n\n๐” เน€เธซเธ•เธธเธเธฅเธ—เธตเนเธญเธฒเธเน€เธเธดเธ”เธเธถเนเธ:\nโ€ข เธ เธฒเธเนเธกเนเธเธฑเธ”เธซเธฃเธทเธญเน€เธญเธตเธขเธ\nโ€ข เธเนเธญเธเธงเธฒเธกเนเธเนเธเน€เธชเธฃเนเธเนเธกเนเธเธฑเธ”\nโ€ข เธเธฃเธฐเธกเธงเธฅเธเธฅ AI เนเธเนเน€เธงเธฅเธฒเธเธฒเธ\n\n๐’ก เธฅเธญเธเนเธซเธกเน:\n1. เธ–เนเธฒเธขเธฃเธนเธเธ—เธตเนเธเธฑเธ” เนเธฅเธฐเธ•เธฃเธ\n2. เนเธซเนเนเธชเธเธชเธงเนเธฒเธเน€เธเธตเธขเธเธเธญ\n3. เธซเธฅเธตเธเน€เธฅเธตเนเธขเธเธเธฒเธฃเธชเธฐเธ—เนเธญเธเนเธชเธ',
      });
      return; // Stop processing, don't waste resources
    }

    // Step 3: Upload to Cloud Storage
    console.log('โ๏ธ [BG] Uploading to Cloud Storage...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `receipts/${userId}/receipt-${slipData.amount}-${timestamp}.jpg`;
    const storageResult = await uploadToCloudStorage(imageBuffer, fileName, 'image/jpeg');
    console.log('โ… [BG] Cloud Storage upload complete:', storageResult.publicUrl);

    // Step 4: Save to MongoDB
    console.log('๐’พ [BG] Saving to MongoDB...');
    const transactionId = `LINE-${userId}-${Date.now()}`;
    const receiptNumber = `RCP-${Date.now()}`;

    const newReceipt = await Receipt.create({
      transactionId,
      receiptNumber,
      storeName: slipData.receiver || 'LINE Upload',
      amount: slipData.amount,
      currency: 'THB',
      status: slipData.confidence === 'high' ? 'approved' : 'pending',
      userId,
      imageURL: storageResult.publicUrl,
      customerName: slipData.sender,
      extractedAmount: slipData.amount,
      extractedSender: slipData.sender,
      extractedReceiver: slipData.receiver,
      issueDate: new Date(slipData.date),
      items: slipData.items || [],
      notes: `Extracted via ${slipData.method} (${slipData.confidence} confidence) | CloudStorage: ${fileName}`,
    });

    const receiptId = newReceipt._id.toString();
    console.log('โ… [BG] MongoDB save complete:', receiptId);

    try {
      await appendReceiptToSheet({
        receiptId,
        userId,
        storeName: newReceipt.storeName,
        amount: newReceipt.amount,
        issueDate: newReceipt.issueDate,
        items: slipData.items,
        imageURL: storageResult.publicUrl,
        status: newReceipt.status,
        confidence: slipData.confidence,
        timestamp: newReceipt.createdAt,
      });
    } catch (sheetError) {
      console.error('โ ๏ธ [BG] Failed to append receipt to Google Sheets:', sheetError);
    }

    // Step 5: Send detailed result via pushMessage
    console.log('๐“ค [BG] Sending detailed result via pushMessage...');
    const amountText =
      slipData.amount > 0 ? `เธฟ${slipData.amount.toFixed(2)}` : 'เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธญเนเธฒเธเธเธณเธเธงเธเน€เธเธดเธ';
    const confidenceEmoji = {
      high: 'โ…',
      medium: 'โ ๏ธ',
      low: 'โ“',
    }[slipData.confidence];

    // Format items list
    let itemsText = '';
    if (slipData.items && slipData.items.length > 0) {
      itemsText = '\n\n๐’ เธชเธดเธเธเนเธฒ:\n';
      slipData.items.forEach((item, index) => {
        itemsText += `${index + 1}. ${item.description}\n   เธเธณเธเธงเธ: ${item.quantity} x เธฟ${item.unitPrice.toFixed(2)} = เธฟ${item.totalPrice.toFixed(2)}\n`;
      });
    }

    await lineClient.pushMessage(userId, {
      type: 'text',
      text: `${confidenceEmoji} เธเธฃเธฐเธกเธงเธฅเธเธฅเธชเธณเน€เธฃเนเธ!\n\n๐’ฐ เธเธณเธเธงเธเน€เธเธดเธ: ${amountText}\n๐‘ค เธเธนเนเธชเนเธ: ${slipData.sender || 'เนเธกเนเธ—เธฃเธฒเธ'}\n๐ข เธเธนเนเธฃเธฑเธ: ${slipData.receiver || 'เนเธกเนเธ—เธฃเธฒเธ'}\n๐“… เธงเธฑเธเธ—เธตเน: ${slipData.date}${itemsText}\n๐ฏ เธเธงเธฒเธกเนเธกเนเธเธขเธณ: ${confidenceEmoji} ${slipData.confidence}`,
    });

    console.log('โ… [BG] DetailedResult sent via pushMessage');
    console.log(`\nโจ [BACKGROUND COMPLETE] Receipt ID: ${receiptId}\n`);
  } catch (error: any) {
    console.error('\nโ [BACKGROUND ERROR] Receipt processing failed:', error);
    console.error('Error details:', error.message);

    try {
      // Send error notification via pushMessage
      let errorMsg = 'โ เธกเธตเธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธเธฃเธฐเธกเธงเธฅเธเธฅ';
      
      if (error.message?.includes('timeout')) {
        errorMsg = 'โฑ๏ธ เธ เธฒเธเธเธเธฒเธ”เนเธซเธเนเน€เธเธดเธเนเธ เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเนเธเธฑเธเธ เธฒเธเธ—เธตเนเน€เธฅเนเธเธเธงเนเธฒ';
      } else if (error.message?.includes('MongoDB')) {
        errorMsg = '๐—๏ธ เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เธเธฒเธเธเนเธญเธกเธนเธฅ เธฅเธญเธเนเธซเธกเนเนเธเธญเธตเธเธชเธฑเธเธเธฃเธนเน';
      } else if (error.message?.includes('Gemini')) {
        errorMsg = '๐ค– เธเนเธญเธเธดเธ”เธเธฅเธฒเธ” AI - เธฅเธญเธเนเธซเธกเนเนเธเธญเธตเธเธชเธฑเธเธเธฃเธนเน';
      } else if (error.message?.includes('Cloud Storage')) {
        errorMsg = 'โ๏ธ เธเนเธญเธเธดเธ”เธเธฅเธฒเธ” Upload - เธฅเธญเธเนเธซเธกเนเนเธเธญเธตเธเธชเธฑเธเธเธฃเธนเน';
      }

      await lineClient.pushMessage(userId, {
        type: 'text',
        text: `${errorMsg}\n\n๐“ ${error.message || 'Unknown error'}`,
      });
    } catch (pushError) {
      console.error('โ ๏ธ Could not send error via pushMessage:', pushError);
    }
  }
}

/**
 * Process LINE webhook events
 * Handles image messages with OCR extraction and storage
 */
async function processLineEvent(event: line.WebhookEvent): Promise<void> {
  // Only handle message events
  if (event.type !== 'message') {
    console.log(`โญ๏ธ Ignoring ${event.type} event`);
    return;
  }

  // Only handle image messages
  if (event.message.type !== 'image') {
    console.log(`๐“ Non-image message received: ${event.message.type}`);

    // Send text reply for non-image messages
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '๐“ธ เธเธญเนเธ—เธฉเธ”เนเธงเธข! เธเธฃเธธเธ“เธฒเธชเนเธเธฃเธนเธเธ เธฒเธเนเธเน€เธชเธฃเนเธ\n\n๐“ค เธเธฑเธเธเธฐเธ—เธณเธเธฒเธฃ:\n1. เธญเธฑเธ•เธฃเธฒเนเธฅเธเน€เธเธฅเธตเนเธขเธ OCR เธ”เนเธงเธข Gemini AI\n2. เธงเธดเน€เธเธฃเธฒเธฐเธซเนเธเนเธญเธกเธนเธฅเนเธฅเธฐเธชเนเธเธเธฅเธฑเธเธกเธฒ\n3. เน€เธเนเธเธเนเธญเธกเธนเธฅเนเธเธเธฒเธเธเนเธญเธกเธนเธฅ',
      },
    ]);

    return;
  }

  const messageId = (event.message as any).id;

  try {
    console.log(`\n๐“ฅ [WEBHOOK] Received image message: ${messageId}`);
    console.log(`๐‘ค User ID: ${event.source.userId}`);

    // Pre-download image while showing loading message
    const imageBuffer = await getImageFromLine(messageId);
    const fileSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`โ… Image downloaded (${fileSizeMB}MB)`);

    // โก INSTANT REPLY: Tell user we're processing
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: 'โ… เนเธ”เนเธฃเธฑเธเธฃเธนเธเนเธฅเนเธง!\n\nโณ เธเธณเธฅเธฑเธเธเธฃเธฐเธกเธงเธฅเธเธฅ...\n\n๐“ OCR เธ”เนเธงเธข AI\nโ๏ธ Upload Cloud Storage\n๐’พ เธเธฑเธเธ—เธถเธเธเนเธญเธกเธนเธฅ',
      },
    ]);

    console.log('โ… Initial reply sent to user');

    // ๐” BACKGROUND PROCESSING (wait for completion)
    // Must complete before returning to avoid Vercel function termination
    const userId = event.source.userId;
    if (!userId) {
      console.error('โ User ID is missing from webhook event');
      return;
    }

    console.log('๐” Background processing starting...');
    try {
      await processReceiptInBackground(userId, messageId, imageBuffer);
      console.log('๐” Background processing completed successfully\n');
    } catch (bgError) {
      console.error('โ Uncaught background error:', bgError);
    }

    return;
  } catch (error: any) {
    console.error('\nโ [ERROR] Download/reply failed:', error);

    try {
      let errorMsg = 'โ เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ” เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเน';
      
      if (error.message?.includes('Image')) {
        errorMsg = '๐“ธ เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธ”เธฒเธงเธเนเนเธซเธฅเธ”เธฃเธนเธ เธฅเธญเธเธชเนเธเนเธซเธกเน';
      } else if (error.message?.includes('reply')) {
        errorMsg = '๐“ค เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธชเนเธ reply เธฅเธญเธเนเธซเธกเน';
      }

      await sendLineReply(event.replyToken, [
        {
          type: 'text',
          text: `${errorMsg}\n\n๐“ ${error.message || 'Unknown error'}`,
        },
      ]);
    } catch (fallbackError) {
      console.error('โ ๏ธ Could not send error message:', fallbackError);
    }
  }
}

/**
 * POST /api/line
 * Handle LINE Messaging API webhook
 * 
 * Non-blocking webhook handler with background processing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    console.log('\n\n๐”” ========== LINE WEBHOOK RECEIVED ==========');
    console.log(`๐“จ Request size: ${body.length} bytes`);
    console.log(`โฐ Timestamp: ${new Date().toISOString()}`);

    // Log environment health
    const health = checkEnvironmentHealth();
    console.log(`๐ฅ Environment Health: ${health.status}`);
    if (health.status !== 'healthy') {
      console.warn('โ ๏ธ Missing environment variables:', 
        Object.entries(health.checks)
          .filter(([_, v]) => !v)
          .map(([k]) => k)
      );
    }

    // Handle empty body
    if (!body || body.trim() === '') {
      console.log('โ… Empty body detected - verification request');
      return corsResponse(
        { ok: true }, 200);
    }

    // Verify LINE signature
    const signature = request.headers.get('x-line-signature');
    if (!signature) {
      console.warn('โ ๏ธ No X-Line-Signature header found');
    } else {
      console.log('๐” Verifying LINE signature...');
      if (!verifyLineSignature(body, signature)) {
        console.warn('โ ๏ธ Signature verification failed - but continuing anyway');
      } else {
        console.log('โ… Signature verified');
      }
    }

    // Parse webhook data
    let data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      console.error('โ Failed to parse JSON body:', e);
      return corsResponse(
        { error: 'Invalid JSON' },
        400
      );
    }

    const events = data.events || [];
    console.log(`๐“ฅ Events to process: ${events.length}`);

    // CRITICAL FIX: Vercel terminates function immediately after response
    // We must process events BEFORE returning 200 to ensure work completes
    // LINE allows 3 seconds - that's our window to at least start processing
    if (events.length > 0) {
      try {
        console.log('\n๐’ [SYNC PROCESSING STARTING] Processing before response...');
        console.log(`โฑ๏ธ Task started at: ${Date.now()}`);
        
        // Connect to MongoDB FIRST before returning
        console.log('๐“ [STEP 0] Connecting to MongoDB...');
        await connectToDatabase();
        console.log('โ… [STEP 0] MongoDB connected BEFORE response sent');

        // Process each event
        console.log(`\n๐“ Processing ${events.length} event(s) synchronously...`);
        
        const processPromises = events.map((event: line.WebhookEvent, i: number) => {
          return (async () => {
            try {
              console.log(`\n๐“ [EVENT ${i + 1}/${events.length}] Type: ${event.type}`);
              const startTime = Date.now();
              
              await processLineEvent(event);
              
              const duration = Date.now() - startTime;
              console.log(`   โ… Event ${i + 1} completed in ${duration}ms`);
            } catch (error: any) {
              console.error(`\nโ [EVENT ${i + 1}] Processing failed:`);
              console.error(`   Error: ${error?.message}`);
              console.error(`   Type: ${error?.constructor?.name}`);
            }
          })();
        });

        // Wait for all events to process (or timeout after 25 seconds)
        // Gemini API can take 10s + image download + other operations
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Processing timeout')), 25000)
        );

        try {
          await Promise.race([Promise.all(processPromises), timeoutPromise]);
          console.log('\nโจ [SUCCESS] All events processed before response\n');
        } catch (timeoutError) {
          console.warn('\nโฑ๏ธ [TIMEOUT] Processing exceeded 25s, returning response anyway');
          console.warn('   Events are still processing in the background...\n');
        }
      } catch (error: any) {
        console.error('โ [ERROR] Sync processing failed:', error?.message);
        console.error('   Stack:', error?.stack?.split('\n').slice(0, 3).join('\n'));
      }
    }

    // Return 200 immediately to acknowledge webhook to LINE
    console.log('โ… Returning 200 OK to LINE Platform');
    console.log('๐”” =========================================\n');

    return corsResponse(
      { success: true, message: 'Webhook received and processing' },
      200
    );
  } catch (error: any) {
    console.error('โ [WEBHOOK ERROR]', error);
    return corsResponse(
      { error: 'Webhook processing failed' },
      500
    );
  }
}

/**
 * OPTIONS /api/line
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}

/**
 * GET /api/line
 * Health check and diagnostic endpoint
 */
export async function GET() {
  const health = checkEnvironmentHealth();
  const config = {
    node_env: process.env.NODE_ENV,
    line_bot_id: process.env.LINE_CHANNEL_ACCESS_TOKEN ? 'configured' : 'MISSING',
    gemini_key: process.env.GEMINI_API_KEY ? 'configured' : 'MISSING',
    mongodb_uri: process.env.MONGODB_URI ? 'configured' : 'MISSING',
    google_drive: process.env.GOOGLE_DRIVE_FOLDER_ID ? 'configured' : 'MISSING',
  };

  return corsResponse(
    {
      status: health.status === 'healthy' ? 'healthy' : 'warning',
      timestamp: new Date().toISOString(),
      message: 'LINE Webhook endpoint status',
      features: [
        'โ… Image OCR extraction with Gemini',
        'โ… Google Drive upload with retry',
        'โ… MongoDB storage',
        'โ… Rate limiting ready',
        'โ… Enhanced error handling',
        'โ… Diagnostic logging',
      ],
      environment_checks: health.checks,
      configuration: config,
      webhook_url: `POST /api/line`,
    },
    health.status === 'healthy' ? 200 : 503
  );
}


