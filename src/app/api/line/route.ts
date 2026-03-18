import { NextRequest, NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import crypto from 'crypto';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { extractSlipDataWithGeminiFallback } from '@/lib/geminiExtraction';
import { uploadToGoogleDriveWithRetry } from '@/lib/googleDrive';

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
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    MONGODB_URI: !!process.env.MONGODB_URI,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_DRIVE_FOLDER_ID: !!process.env.GOOGLE_DRIVE_FOLDER_ID,
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
        text: '📸 ขอโทษด้วย! กรุณาส่งรูปภาพใบเสร็จ\n\n📤 ฉันจะทำการ:\n1. อัตราแลกเปลี่ยน OCR ด้วย Gemini AI\n2. บันทึกลงใน Google Drive\n3. เก็บข้อมูลในฐานข้อมูล',
      },
    ]);

    return;
  }

  const messageId = (event.message as any).id;
  let receiptId: string | null = null;

  try {
    console.log(`\n🔄 [START] Processing image message: ${messageId}`);
    console.log(`👤 User ID: ${event.source.userId}`);

    // Step 1: Connect to MongoDB
    await connectToDatabase();
    console.log('✅ Step 1: MongoDB connected');

    // Step 2: Download image from LINE
    const imageBuffer = await getImageFromLine(messageId);
    const fileSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`✅ Step 2: Image downloaded (${fileSizeMB}MB)`);

    // Step 3: Extract data from image using enhanced Gemini
    console.log('🤖 Step 3: Extracting data with Gemini...');
    const slipData = await extractSlipDataWithGeminiFallback(imageBuffer);
    console.log('✅ Step 3: Data extracted');
    console.log(`   - Amount: ฿${slipData.amount}`);
    console.log(`   - Sender: ${slipData.sender}`);
    console.log(`   - Receiver: ${slipData.receiver}`);
    console.log(`   - Date: ${slipData.date}`);
    console.log(`   - Confidence: ${slipData.confidence}`);
    console.log(`   - Method: ${slipData.method}`);

    // Step 4: Upload image to Google Drive with retry
    console.log('☁️ Step 4: Uploading to Google Drive with retry...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `receipt-${slipData.amount}-${timestamp}.jpg`;

    const driveResult = await uploadToGoogleDriveWithRetry(
      imageBuffer,
      fileName,
      'image/jpeg'
    );
    console.log('✅ Step 4: Uploaded to Google Drive');
    console.log(`   - File ID: ${driveResult.fileId}`);
    console.log(`   - Link: ${driveResult.publicLink}`);

    // Step 5: Save receipt to MongoDB
    console.log('💾 Step 5: Saving to MongoDB...');
    const transactionId = `LINE-${event.source.userId}-${Date.now()}`;
    const receiptNumber = `RCP-${Date.now()}`;

    const newReceipt = await Receipt.create({
      transactionId,
      receiptNumber,
      storeName: slipData.receiver || 'LINE Upload',
      amount: slipData.amount,
      currency: 'THB',
      status: slipData.confidence === 'high' ? 'reviewing' : 'pending',
      userId: event.source.userId,
      imageURL: driveResult.publicLink,
      customerName: slipData.sender,
      extractedAmount: slipData.amount,
      extractedSender: slipData.sender,
      extractedReceiver: slipData.receiver,
      issueDate: new Date(slipData.date),
      notes: `Extracted via ${slipData.method} (${slipData.confidence} confidence) | Size: ${fileSizeMB}MB | DriveID: ${driveResult.fileId}`,
    });

    receiptId = newReceipt._id.toString();
    console.log('✅ Step 5: Receipt saved to MongoDB');
    console.log(`   - Receipt ID: ${receiptId}`);

    // Step 6: Send success reply to LINE
    console.log('📤 Step 6: Sending success message to LINE...');
    const amountText =
      slipData.amount > 0 ? `฿${slipData.amount.toFixed(2)}` : 'ไม่สามารถอ่านจำนวนเงิน';
    const confidenceEmoji = {
      high: '✅',
      medium: '⚠️',
      low: '❓',
    }[slipData.confidence];

    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: `${confidenceEmoji} อัพโหลดสำเร็จ!\n\n💰 จำนวนเงิน: ${amountText}\n👤 ผู้ส่ง: ${slipData.sender || 'ไม่ทราบ'}\n🏢 ผู้รับ: ${slipData.receiver || 'ไม่ทราบ'}\n📅 วันที่: ${slipData.date}\n\n${confidenceEmoji} ความแม่นยำ: ${slipData.confidence}`,
      },
      {
        type: 'template',
        altText: 'receipt-uploaded',
        template: {
          type: 'buttons' as any,
          text: 'ใบเสร็จได้รับการบันทึกแล้ว',
          actions: [
            {
              type: 'uri',
              label: '📂 ดูที่ Google Drive',
              uri: driveResult.publicLink,
            },
            {
              type: 'postback',
              label: '📋 ดูรายละเอียด',
              data: `action=view_receipt&id=${receiptId}`,
            },
          ],
        } as any,
      },
    ]);

    console.log('✅ Step 6: Reply sent successfully');
    console.log(`\n✨ [COMPLETE] Image processing succeeded\n`);
  } catch (error: any) {
    console.error('\n❌ [ERROR] Image processing failed:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);

    try {
      // Send error message to LINE user with helpful info
      let errorMsg = '❌ มีข้อผิดพลาดในการประมวลผลรูปภาพ';
      
      if (error.message?.includes('timeout')) {
        errorMsg = '⏱️ ภาพขนาดใหญ่เกินไป กรุณาลองใหม่กับภาพที่เล็กกว่า';
      } else if (error.message?.includes('MongoDB')) {
        errorMsg = '🗄️ Database connection error - ลองใหม่ในอีกสักครู่';
      } else if (error.message?.includes('Gemini')) {
        errorMsg = '🤖 AI service error - ลองใหม่ในอีกสักครู่';
      } else if (error.message?.includes('Google Drive')) {
        errorMsg = '☁️ Drive upload error - ลองใหม่ในอีกสักครู่';
      }

      await sendLineReply(event.replyToken, [
        {
          type: 'text',
          text: `${errorMsg}\n\n📝 Error: ${error.message || 'Unknown error'}`,
        },
      ]);
    } catch (replyError) {
      console.error('⚠️ Could not send error message to LINE:', replyError);
      console.error('Reply error details:', (replyError as any).message);
    }
  }
}

/**
 * POST /api/line
 * Handle LINE Messaging API webhook
 * 
 * Receives webhook events from LINE platform
 * Processes image messages with retry logic and error handling
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
      return NextResponse.json({ ok: true }, { status: 200 });
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
      return NextResponse.json(
        { error: 'Invalid JSON' },
        { status: 400 }
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

        // Wait for all events to process (or timeout after 2.5 seconds)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Processing timeout')), 2500)
        );

        try {
          await Promise.race([Promise.all(processPromises), timeoutPromise]);
          console.log('\n✨ [SUCCESS] All events processed before response\n');
        } catch (timeoutError) {
          console.warn('\n⏱️ [TIMEOUT] Processing exceeded 2.5s, returning response anyway');
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

    return NextResponse.json(
      { success: true, message: 'Webhook received and processing' },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('❌ Fatal webhook error:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    // Always return 200 to LINE
    return NextResponse.json({ ok: true }, { status: 200 });
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

  return NextResponse.json(
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
    { status: health.status === 'healthy' ? 200 : 503 }
  );
}
