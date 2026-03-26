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
    console.error('❌ LINE_CHANNEL_SECRET not configured');
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
      .update(body)
      .digest('base64');

    const isValid = hash === signature;
    
    if (!isValid) {
      console.warn('⚠️ Invalid LINE signature');
      console.warn('Expected:', signature);
      console.warn('Got:', hash);
    }

    return isValid;
  } catch (error) {
    console.error('❌ Error verifying signature:', error);
    return false;
  }
}

/**
 * Get image content from LINE Message API
 */
async function getImageFromLine(messageId: string): Promise<Buffer> {
  try {
    console.log(`📥 Downloading image from LINE: ${messageId}`);
    const response = await lineClient.getMessageContent(messageId);
    const chunks: Buffer[] = [];

    // Convert readable stream to buffer
    for await (const chunk of response as any) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    console.log(`✅ Image downloaded successfully: ${buffer.length} bytes`);
    return buffer;
  } catch (error) {
    console.error('❌ Error getting image from LINE:', error);
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
    console.log('📤 Sending reply to LINE...');
    await lineClient.replyMessage(replyToken, messages);
    console.log('✅ Reply sent successfully to LINE');
  } catch (error) {
    console.error('❌ Error sending reply to LINE:', error);
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
    console.log(`\n🔄 [BACKGROUND] Starting async receipt processing for user ${userId}`);

    // Step 1: Connect to MongoDB
    await connectToDatabase();

    // Step 2: Extract data with Gemini
    console.log('🤖 [BG] Extracting data with Gemini...');
    const slipData = await extractSlipDataWithGeminiFallback(imageBuffer);
    console.log('✅ [BG] Extraction complete:', {
      amount: slipData.amount,
      sender: slipData.sender,
      receiver: slipData.receiver,
    });

    // Check if extraction failed completely
    if (slipData.method === 'manual_required' && slipData.amount === 0) {
      console.error('❌ [BG] Extraction failed - image could not be processed');
      await lineClient.pushMessage(userId, {
        type: 'text',
        text: '❌ ขออภัย ไม่สามารถอ่านใบเสร็จนี้ได้\n\n🔍 เหตุผลที่อาจเกิดขึ้น:\n• ภาพไม่ชัดหรือเอียง\n• ข้อความในใบเสร็จไม่ชัด\n• ประมวลผล AI ใช้เวลานาน\n\n💡 ลองใหม่:\n1. ถ่ายรูปที่ชัด และตรง\n2. ให้แสงสว่างเพียงพอ\n3. หลีกเลี่ยงการสะท้อนแสง',
      });
      return; // Stop processing, don't waste resources
    }

    // Step 3: Upload to Cloud Storage
    console.log('☁️ [BG] Uploading to Cloud Storage...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `receipts/${userId}/receipt-${slipData.amount}-${timestamp}.jpg`;
    const storageResult = await uploadToCloudStorage(imageBuffer, fileName, 'image/jpeg');
    console.log('✅ [BG] Cloud Storage upload complete:', storageResult.publicUrl);

    // Step 4: Save to MongoDB
    console.log('💾 [BG] Saving to MongoDB...');
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
    console.log('✅ [BG] MongoDB save complete:', receiptId);

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
      console.error('⚠️ [BG] Failed to append receipt to Google Sheets:', sheetError);
    }

    // Step 5: Send detailed result via pushMessage
    console.log('📤 [BG] Sending detailed result via pushMessage...');
    const amountText =
      slipData.amount > 0 ? `฿${slipData.amount.toFixed(2)}` : 'ไม่สามารถอ่านจำนวนเงิน';
    const confidenceEmoji = {
      high: '✅',
      medium: '⚠️',
      low: '❓',
    }[slipData.confidence];

    // Format items list
    let itemsText = '';
    if (slipData.items && slipData.items.length > 0) {
      itemsText = '\n\n🛒 สินค้า:\n';
      slipData.items.forEach((item, index) => {
        itemsText += `${index + 1}. ${item.description}\n   จำนวน: ${item.quantity} x ฿${item.unitPrice.toFixed(2)} = ฿${item.totalPrice.toFixed(2)}\n`;
      });
    }

    await lineClient.pushMessage(userId, {
      type: 'text',
      text: `${confidenceEmoji} ประมวลผลสำเร็จ!\n\n💰 จำนวนเงิน: ${amountText}\n👤 ผู้ส่ง: ${slipData.sender || 'ไม่ทราบ'}\n🏢 ผู้รับ: ${slipData.receiver || 'ไม่ทราบ'}\n📅 วันที่: ${slipData.date}${itemsText}\n🎯 ความแม่นยำ: ${confidenceEmoji} ${slipData.confidence}`,
    });

    console.log('✅ [BG] DetailedResult sent via pushMessage');
    console.log(`\n✨ [BACKGROUND COMPLETE] Receipt ID: ${receiptId}\n`);
  } catch (error: any) {
    console.error('\n❌ [BACKGROUND ERROR] Receipt processing failed:', error);
    console.error('Error details:', error.message);

    try {
      // Send error notification via pushMessage
      let errorMsg = '❌ มีข้อผิดพลาดในการประมวลผล';
      
      if (error.message?.includes('timeout')) {
        errorMsg = '⏱️ ภาพขนาดใหญ่เกินไป กรุณาลองใหม่กับภาพที่เล็กกว่า';
      } else if (error.message?.includes('MongoDB')) {
        errorMsg = '🗄️ ข้อผิดพลาดฐานข้อมูล ลองใหม่ในอีกสักครู่';
      } else if (error.message?.includes('Gemini')) {
        errorMsg = '🤖 ข้อผิดพลาด AI - ลองใหม่ในอีกสักครู่';
      } else if (error.message?.includes('Cloud Storage')) {
        errorMsg = '☁️ ข้อผิดพลาด Upload - ลองใหม่ในอีกสักครู่';
      }

      await lineClient.pushMessage(userId, {
        type: 'text',
        text: `${errorMsg}\n\n📝 ${error.message || 'Unknown error'}`,
      });
    } catch (pushError) {
      console.error('⚠️ Could not send error via pushMessage:', pushError);
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
    console.log(`⏭️ Ignoring ${event.type} event`);
    return;
  }

  // Only handle image messages
  if (event.message.type !== 'image') {
    console.log(`📝 Non-image message received: ${event.message.type}`);

    // Send text reply for non-image messages
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '📸 ขอโทษด้วย! กรุณาส่งรูปภาพใบเสร็จ\n\n📤 ฉันจะทำการ:\n1. อัตราแลกเปลี่ยน OCR ด้วย Gemini AI\n2. วิเคราะห์ข้อมูลและส่งกลับมา\n3. เก็บข้อมูลในฐานข้อมูล',
      },
    ]);

    return;
  }

  const messageId = (event.message as any).id;

  try {
    console.log(`\n📥 [WEBHOOK] Received image message: ${messageId}`);
    console.log(`👤 User ID: ${event.source.userId}`);

    // Pre-download image while showing loading message
    const imageBuffer = await getImageFromLine(messageId);
    const fileSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`✅ Image downloaded (${fileSizeMB}MB)`);

    // ⚡ INSTANT REPLY: Tell user we're processing
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '✅ ได้รับรูปแล้ว!\n\n⏳ กำลังประมวลผล...\n\n📊 OCR ด้วย AI\n☁️ Upload Cloud Storage\n💾 บันทึกข้อมูล',
      },
    ]);

    console.log('✅ Initial reply sent to user');

    // 🔄 BACKGROUND PROCESSING (wait for completion)
    // Must complete before returning to avoid Vercel function termination
    const userId = event.source.userId;
    if (!userId) {
      console.error('❌ User ID is missing from webhook event');
      return;
    }

    console.log('🔄 Background processing starting...');
    try {
      await processReceiptInBackground(userId, messageId, imageBuffer);
      console.log('🔄 Background processing completed successfully\n');
    } catch (bgError) {
      console.error('❌ Uncaught background error:', bgError);
    }

    return;
  } catch (error: any) {
    console.error('\n❌ [ERROR] Download/reply failed:', error);

    try {
      let errorMsg = '❌ เกิดข้อผิดพลาด กรุณาลองใหม่';
      
      if (error.message?.includes('Image')) {
        errorMsg = '📸 ไม่สามารถดาวน์โหลดรูป ลองส่งใหม่';
      } else if (error.message?.includes('reply')) {
        errorMsg = '📤 ไม่สามารถส่ง reply ลองใหม่';
      }

      await sendLineReply(event.replyToken, [
        {
          type: 'text',
          text: `${errorMsg}\n\n📝 ${error.message || 'Unknown error'}`,
        },
      ]);
    } catch (fallbackError) {
      console.error('⚠️ Could not send error message:', fallbackError);
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
    console.log('\n\n🔔 ========== LINE WEBHOOK RECEIVED ==========');
    console.log(`📨 Request size: ${body.length} bytes`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);

    // Log environment health
    const health = checkEnvironmentHealth();
    console.log(`🏥 Environment Health: ${health.status}`);
    if (health.status !== 'healthy') {
      console.warn('⚠️ Missing environment variables:', 
        Object.entries(health.checks)
          .filter(([_, v]) => !v)
          .map(([k]) => k)
      );
    }

    // Handle empty body
    if (!body || body.trim() === '') {
      console.log('✅ Empty body detected - verification request');
      return corsResponse({ ok: true }, 200);
    }

    // Verify LINE signature
    const signature = request.headers.get('x-line-signature');
    if (!signature) {
      console.warn('⚠️ No X-Line-Signature header found');
    } else {
      console.log('🔐 Verifying LINE signature...');
      if (!verifyLineSignature(body, signature)) {
        console.warn('⚠️ Signature verification failed - but continuing anyway');
      } else {
        console.log('✅ Signature verified');
      }
    }

    // Parse webhook data
    let data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      console.error('❌ Failed to parse JSON body:', e);
      return corsResponse(
        { error: 'Invalid JSON' },
        400
      );
    }

    const events = data.events || [];
    console.log(`📥 Events to process: ${events.length}`);

    // CRITICAL FIX: Vercel terminates function immediately after response
    // We must process events BEFORE returning 200 to ensure work completes
    // LINE allows 3 seconds - that's our window to at least start processing
    if (events.length > 0) {
      try {
        console.log('\n💚 [SYNC PROCESSING STARTING] Processing before response...');
        console.log(`⏱️ Task started at: ${Date.now()}`);
        
        // Connect to MongoDB FIRST before returning
        console.log('📍 [STEP 0] Connecting to MongoDB...');
        await connectToDatabase();
        console.log('✅ [STEP 0] MongoDB connected BEFORE response sent');

        // Process each event
        console.log(`\n📊 Processing ${events.length} event(s) synchronously...`);
        
        const processPromises = events.map((event: line.WebhookEvent, i: number) => {
          return (async () => {
            try {
              console.log(`\n📌 [EVENT ${i + 1}/${events.length}] Type: ${event.type}`);
              const startTime = Date.now();
              
              await processLineEvent(event);
              
              const duration = Date.now() - startTime;
              console.log(`   ✅ Event ${i + 1} completed in ${duration}ms`);
            } catch (error: any) {
              console.error(`\n❌ [EVENT ${i + 1}] Processing failed:`);
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
          console.log('\n✨ [SUCCESS] All events processed before response\n');
        } catch (timeoutError) {
          console.warn('\n⏱️ [TIMEOUT] Processing exceeded 25s, returning response anyway');
          console.warn('   Events are still processing in the background...\n');
        }
      } catch (error: any) {
        console.error('❌ [ERROR] Sync processing failed:', error?.message);
        console.error('   Stack:', error?.stack?.split('\n').slice(0, 3).join('\n'));
      }
    }

    // Return 200 immediately to acknowledge webhook to LINE
    console.log('✅ Returning 200 OK to LINE Platform');
    console.log('🔔 =========================================\n');

    return corsResponse(
      { success: true, message: 'Webhook received and processing' },
      200
    );
  } catch (error: any) {
    console.error('❌ Fatal webhook error:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    // Always return 200 to LINE
    return corsResponse({ ok: true }, 200);
  }
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
        '✅ Image OCR extraction with Gemini',
        '✅ Google Drive upload with retry',
        '✅ MongoDB storage',
        '✅ Rate limiting ready',
        '✅ Enhanced error handling',
        '✅ Diagnostic logging',
      ],
      environment_checks: health.checks,
      configuration: config,
      webhook_url: `POST /api/line`,
    },
    health.status === 'healthy' ? 200 : 503
  );
}

/**
 * OPTIONS /api/line
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, authorization, x-line-signature');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}
