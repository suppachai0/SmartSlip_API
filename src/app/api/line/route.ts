import { NextRequest, NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import crypto from 'crypto';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { extractSlipDataWithGeminiFallback } from '@/lib/geminiExtraction';
import { uploadToCloudStorage, downloadFromCloudStorage } from '@/lib/cloudStorage';
import { appendReceiptToSheet } from '@/lib/googleSheets';
import { corsResponse, addCorsHeaders } from '@/lib/cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import User from '@/models/User';

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
  imageBuffer: Buffer,
  category: string = 'อื่นๆ'
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
        text: '❌ ขออภัย ไม่สามารถอ่านใบเสร็จนี้ได้\n\n🔍 เหตุผลที่อาจเกิดขึ้น:\n• ภาพไม่ชัดหรือเอียง\n• ข้อความในใบเสร็จไม่ชัด\n• ประมวลผล AI ใช้เวลานาน\n\n💡 ลองใหม่:\n1. ถ่ายรูปที่ชัด และตรง\n2. ให้แสงสว่างเพียงพอ\n3. หลีกเลี่ยงการสะท้อนแสง\n4. ถ้ายังไม่ได้ สามารถไปทำในเว็บไซต์แทนได้\nhttps://smart-slip-nine.vercel.app/',
      });
      return; // Stop processing, don't waste resources
    }

    // Step 3: Upload to Cloud Storage
    console.log('☁️ [BG] Uploading to Cloud Storage...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `receipts/${userId}/receipt-${slipData.amount}-${timestamp}.jpg`;
    const storageResult = await uploadToCloudStorage(imageBuffer, fileName, 'image/jpeg');
    console.log('✅ [BG] Cloud Storage upload complete:', storageResult.publicUrl);

    // Step 3.5: Get user's Google Sheet ID
    let userGoogleSheetId: string | undefined;
    let userRole: 'user' | 'admin' | 'clerk' = 'user';
    try {
      const user = await User.findOne({ lineUserId: userId }).select('googleSheetId role');
      userGoogleSheetId = user?.googleSheetId ?? undefined;
      userRole = user?.role ?? 'user';
    } catch (userErr) {
      console.warn('⚠️ [BG] Could not fetch user sheet ID:', userErr);
    }

    // Step 4: Save to MongoDB
    console.log('💾 [BG] Saving to MongoDB...');
    const transactionId = `LINE-${userId}-${Date.now()}`;
    const receiptNumber = `RCP-${Date.now()}`;
    const roleContext = userRole === 'admin' ? undefined : userRole === 'clerk' ? 'clerk' : 'user';

    const newReceipt = await Receipt.create({
      transactionId,
      receiptNumber,
      storeName: slipData.receiver || 'LINE Upload',
      amount: slipData.amount,
      currency: 'THB',
      status: 'reviewing',
      userId,
      roleContext,
      imageURL: storageResult.publicUrl,
      customerName: slipData.sender,
      extractedAmount: slipData.amount,
      extractedSender: slipData.sender,
      extractedReceiver: slipData.receiver,
      issueDate: new Date(slipData.date),
      items: slipData.items || [],
      notes: `Extracted via ${slipData.method} (${slipData.confidence} confidence) | CloudStorage: ${fileName} | Category: ${category}`,
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
        spreadsheetId: userGoogleSheetId,
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
      text: `✅ ประมวลผลสำเร็จ!\n\n💰 จำนวนเงิน: ${amountText}\n👤 ผู้ส่ง: ${slipData.sender || 'ไม่ทราบ'}\n🏢 ผู้รับ: ${slipData.receiver || 'ไม่ทราบ'}\n📅 วันที่: ${slipData.date}\n📂 หมวดหมู่: ${category}${itemsText}\n\n☁️ บันทึกใน Cloud Storage แล้ว ✅\n\n❓ จะอนุมัติใบเสร็จตอนนี้เลยไหม?`,
      quickReply: {
        items: [
          { type: 'action', action: { type: 'postback', label: '✅ อนุมัติเลย', data: `action=approve&receiptId=${receiptId}` } },
          { type: 'action', action: { type: 'postback', label: '⏳ ไว้ทีหลัง', data: `action=pending&receiptId=${receiptId}` } },
        ],
      },
    } as any);

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
 * Parse custom Thai date range input (e.g., "สัปดาห์นี้", "เดือนที่แล้ว", "1-15 สิงหาคม")
 * Returns { startDate, endDate, description } or null if not parseable
 */
function parseDateRangeInput(text: string): { startDate: Date; endDate: Date; description: string } | null {
  const now = new Date();
  const normalizedText = text.toLowerCase().trim();

  // Thai month map
  const thaiMonthMap: Record<string, number> = {
    'มกราคม': 0, 'กุมภาพันธ์': 1, 'มีนาคม': 2, 'เมษายน': 3,
    'พฤษภาคม': 4, 'มิถุนายน': 5, 'กรกฎาคม': 6, 'สิงหาคม': 7,
    'กันยายน': 8, 'ตุลาคม': 9, 'พฤศจิกายน': 10, 'ธันวาคม': 11,
  };

  // "สัปดาห์นี้" - this week (last 7 days from today)
  if (normalizedText.includes('สัปดาห์นี้')) {
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { startDate, endDate, description: 'สัปดาห์นี้ (7 วันที่ผ่านมา)' };
  }

  // "เดือนที่แล้ว" - last month
  if (normalizedText.includes('เดือนที่แล้ว')) {
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1);
    const startDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1, 0, 0, 0, 0);
    const endDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    const thaiMonthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    return { startDate, endDate, description: `เดือน${thaiMonthNames[prevMonth.getMonth()]} ${prevMonth.getFullYear() + 543}` };
  }

  // "เดือน[MonthName]" - specific month of current year (e.g., "เดือนมกราคม")
  for (const [monthName, monthIdx] of Object.entries(thaiMonthMap)) {
    if (normalizedText.includes(monthName)) {
      const startDate = new Date(now.getFullYear(), monthIdx, 1, 0, 0, 0, 0);
      const endDate = new Date(now.getFullYear(), monthIdx + 1, 0, 23, 59, 59, 999);
      return { startDate, endDate, description: `${monthName} ${now.getFullYear() + 543}` };
    }
  }

  // "วันที่ X ถึง Y [เดือน]" pattern (e.g., "1 ถึง 15 สิงหาคม" or "15-20 กันยายน")
  const dateRangeMatch = text.match(/(\d+)\s*(?:ถึง|-|-)\s*(\d+)\s*([\u0E00-\u0E7F]+)?/u);
  if (dateRangeMatch) {
    const startDay = parseInt(dateRangeMatch[1]);
    const endDay = parseInt(dateRangeMatch[2]);
    const monthText = dateRangeMatch[3]?.trim();

    let monthIdx = now.getMonth();
    let year = now.getFullYear();

    if (monthText) {
      for (const [monthName, idx] of Object.entries(thaiMonthMap)) {
        if (monthText.includes(monthName)) {
          monthIdx = idx;
          break;
        }
      }
    }

    const startDate = new Date(year, monthIdx, startDay, 0, 0, 0, 0);
    const endDate = new Date(year, monthIdx, endDay, 23, 59, 59, 999);

    const monthName = Object.keys(thaiMonthMap)[monthIdx];
    return { startDate, endDate, description: `วันที่ ${startDay}-${endDay} ${monthName} ${year + 543}` };
  }

  // "สัปดาห์ที่แล้ว" - last week
  if (normalizedText.includes('สัปดาห์ที่แล้ว')) {
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14, 0, 0, 0, 0);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 23, 59, 59, 999);
    return { startDate, endDate, description: 'สัปดาห์ที่แล้ว' };
  }

  return null;
}

/**
 * Handle custom date range summary request
 */
async function handleCustomDateRangeSummary(
  userId: string,
  dateRangeInput: string,
  replyToken: string
): Promise<void> {
  try {
    const dateRange = parseDateRangeInput(dateRangeInput);
    if (!dateRange) {
      // If parsing fails, let chatbot AI handle it
      return null as any;
    }

    await connectToDatabase();

    const user = await User.findOne({ lineUserId: userId }).select('_id');
    const userIds = [userId, ...(user?._id ? [user._id.toString()] : [])];

    const query: any = { userId: { $in: userIds } };
    query.$or = [
      { issueDate: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
      { createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
    ];

    const receipts = await Receipt.find(query).sort({ issueDate: -1, createdAt: -1 });
    const title = `สรุปยอดค่าใช้จ่าย`;
    const periodText = dateRange.description;

    if (receipts.length === 0) {
      await sendLineReply(replyToken, [
        {
          type: 'text',
          text: `📊 ${title}\n📅 ช่วงเวลา: ${periodText}\n\n🧾 ไม่พบรายการใบเสร็จในช่วงเวลานี้\n💰 ยอดรวม: ฿0.00\n\n💡 ส่งรูปใบเสร็จเข้ามาในแชทนี้เพื่อเริ่มบันทึกค่าใช้จ่ายได้เลยครับ!`,
        } as any,
      ]);
      return;
    }

    const totalAmount = receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const count = receipts.length;

    // Top 5 stores
    const storeMap: Record<string, number> = {};
    for (const r of receipts) {
      const store = r.storeName || 'ไม่ระบุร้านค้า';
      storeMap[store] = (storeMap[store] || 0) + (Number(r.amount) || 0);
    }
    const topStores = Object.entries(storeMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    let storeListText = '';
    if (topStores.length > 0) {
      storeListText = '\n\n🏪 ยอดตามร้านค้า/ผู้รับ:\n';
      topStores.forEach(([store, amount], idx) => {
        storeListText += `${idx + 1}. ${store}: ฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
      });
    }

    // Recent 5 receipts
    const thaiMonthNames = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
    ];
    let recentListText = '\n📋 รายการล่าสุด:\n';
    receipts.slice(0, 5).forEach((r, idx) => {
      const d = r.issueDate ? new Date(r.issueDate) : new Date(r.createdAt);
      const dateStr = `${d.getDate()} ${thaiMonthNames[d.getMonth()]}`;
      recentListText += `• ${r.storeName || 'LINE Upload'}: ฿${Number(r.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} (${dateStr})\n`;
    });

    const messageText = `📊 ${title}\n📅 ช่วงเวลา: ${periodText}\n\n🧾 จำนวนใบเสร็จ: ${count} ใบ\n💰 ยอดรวมทั้งหมด: ฿${totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${storeListText}${recentListText}\n🌐 ดูรายละเอียดเพิ่มเติมได้ที่เว็บไซต์:\nhttps://smart-slip-nine.vercel.app/`;

    await sendLineReply(replyToken, [
      {
        type: 'text',
        text: messageText,
      } as any,
    ]);
  } catch (error: any) {
    console.error('❌ [CUSTOM SUMMARY] Error:', error);
    // Fall through to chatbot for error handling
    return null as any;
  }
}

/**
 * Send Quick Reply to choose summary period
 */
async function sendSummaryPeriodMenu(replyToken: string): Promise<void> {
  await sendLineReply(replyToken, [
    {
      type: 'text',
      text: '📊 คุณต้องการดูสรุปยอดค่าใช้จ่ายในช่วงเวลาไหนดีครับ?',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '📅 วันนี้', text: 'สรุป:วันนี้' } },
          { type: 'action', action: { type: 'message', label: '🗓️ เดือนนี้', text: 'สรุป:เดือนนี้' } },
          { type: 'action', action: { type: 'message', label: '📆 ปีนี้', text: 'สรุป:ปีนี้' } },
          { type: 'action', action: { type: 'message', label: ' อื่นๆ', text: 'สรุป:อื่นๆ' } },
          { type: 'action', action: { type: 'message', label: 'สรุปยอดทั้งหมด', text: 'สรุป:ทั้งหมด' } },
        ],
      },
    } as any,
  ]);
}

/**
 * Handle summary for specific period (วันนี้, เดือนนี้, ปีนี้, ทั้งหมด)
 */
async function handleSummaryPeriod(
  userId: string,
  periodKey: 'today' | 'month' | 'year' | 'all',
  replyToken: string
): Promise<void> {
  try {
    await connectToDatabase();

    const user = await User.findOne({ lineUserId: userId }).select('_id');
    const userIds = [userId, ...(user?._id ? [user._id.toString()] : [])];

    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let title = '';
    let periodText = '';

    const thaiMonthNames = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    if (periodKey === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      title = 'สรุปยอดวันนี้';
      periodText = `${now.getDate()} ${thaiMonthNames[now.getMonth()]} ${now.getFullYear() + 543}`;
    } else if (periodKey === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      title = 'สรุปยอดเดือนนี้';
      periodText = `${thaiMonthNames[now.getMonth()]} ${now.getFullYear() + 543}`;
    } else if (periodKey === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      title = 'สรุปยอดปีนี้';
      periodText = `ปี ${now.getFullYear() + 543}`;
    } else {
      title = 'สรุปยอดทั้งหมด';
      periodText = 'ทุกช่วงเวลา';
    }

    const query: any = { userId: { $in: userIds } };
    if (startDate && endDate) {
      query.$or = [
        { issueDate: { $gte: startDate, $lte: endDate } },
        { createdAt: { $gte: startDate, $lte: endDate } }
      ];
    }

    const receipts = await Receipt.find(query).sort({ issueDate: -1, createdAt: -1 });

    if (receipts.length === 0) {
      await sendLineReply(replyToken, [
        {
          type: 'text',
          text: `📊 ${title}\n📅 ช่วงเวลา: ${periodText}\n\n🧾 ไม่พบรายการใบเสร็จในช่วงเวลานี้\n💰 ยอดรวม: ฿0.00\n\n💡 ส่งรูปใบเสร็จเข้ามาในแชทนี้เพื่อเริ่มบันทึกค่าใช้จ่ายได้เลยครับ!`,
          quickReply: {
            items: [
              { type: 'action', action: { type: 'message', label: '📅 วันนี้', text: 'สรุป:วันนี้' } },
              { type: 'action', action: { type: 'message', label: '🗓️ เดือนนี้', text: 'สรุป:เดือนนี้' } },
              { type: 'action', action: { type: 'message', label: '📈 สรุปยอดทั้งหมด', text: 'สรุป:ทั้งหมด' } },
            ],
          },
        } as any,
      ]);
      return;
    }

    const totalAmount = receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const count = receipts.length;

    // Top 5 stores
    const storeMap: Record<string, number> = {};
    for (const r of receipts) {
      const store = r.storeName || 'ไม่ระบุร้านค้า';
      storeMap[store] = (storeMap[store] || 0) + (Number(r.amount) || 0);
    }
    const topStores = Object.entries(storeMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    let storeListText = '';
    if (topStores.length > 0) {
      storeListText = '\n\n🏪 ยอดตามร้านค้า/ผู้รับ:\n';
      topStores.forEach(([store, amount], idx) => {
        storeListText += `${idx + 1}. ${store}: ฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
      });
    }

    // Recent 5 receipts
    let recentListText = '\n📋 รายการล่าสุด:\n';
    receipts.slice(0, 5).forEach((r, idx) => {
      const d = r.issueDate ? new Date(r.issueDate) : new Date(r.createdAt);
      const dateStr = `${d.getDate()} ${thaiMonthNames[d.getMonth()]}`;
      recentListText += `• ${r.storeName || 'LINE Upload'}: ฿${Number(r.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} (${dateStr})\n`;
    });

    const messageText = `📊 ${title}\n📅 ช่วงเวลา: ${periodText}\n\n🧾 จำนวนใบเสร็จ: ${count} ใบ\n💰 ยอดรวมทั้งหมด: ฿${totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${storeListText}${recentListText}\n🌐 ดูรายละเอียดเพิ่มเติมได้ที่เว็บไซต์:\nhttps://smart-slip-nine.vercel.app/`;

    await sendLineReply(replyToken, [
      {
        type: 'text',
        text: messageText,
      } as any,
    ]);
  } catch (error: any) {
    console.error('❌ [SUMMARY] Error generating period summary:', error);
    await sendLineReply(replyToken, [
      {
        type: 'text',
        text: '❌ เกิดข้อผิดพลาดในการดึงข้อมูลสรุปยอด ลองใหม่อีกครั้งนะครับ',
      },
    ]);
  }
}

/**
 * Answer receipt/finance questions using Gemini AI with user's receipt data as context
 */
async function answerReceiptQuestion(
  userId: string,
  question: string,
  replyToken: string
): Promise<void> {
  try {
    console.log(`🤖 [CHATBOT] Answering question for user ${userId}: ${question}`);
    await connectToDatabase();

    // Fetch user's recent receipts
    const user = await User.findOne({ lineUserId: userId }).select('_id');
    const userIds = [userId, ...(user?._id ? [user._id.toString()] : [])];
    const receipts = await Receipt.find({ userId: { $in: userIds } })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('storeName amount currency issueDate items status createdAt');

    if (receipts.length === 0) {
      // Still allow questions about the app even with no receipts
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
      const noReceiptPrompt = `คุณคือ SmartSlip AI Assistant ตอบเป็นภาษาไทย กระชับ ใช้ emoji

=== ข้อมูลเกี่ยวกับ SmartSlip ===
SmartSlip คือแอปพลิเคชันจัดการใบเสร็จและค่าใช้จ่ายอัจฉริยะ
- 📸 สแกนใบเสร็จ: ส่งรูปใบเสร็จมาใน LINE Bot นี้ได้เลย ระบบจะอ่านข้อมูลอัตโนมัติด้วย AI
- ☁️ เก็บบนคลาวด์: ใบเสร็จทุกใบถูกเก็บบน Google Cloud Storage อย่างปลอดภัย
- 📊 Google Sheets: ข้อมูลทุกใบเสร็จถูกบันทึกลง Google Sheets อัตโนมัติ
- 💬 LINE Bot: ส่งรูปใบเสร็จหรือถามคำถามเกี่ยวกับค่าใช้จ่ายผ่าน LINE ได้เลย
- 🤖 AI OCR: ใช้ Google Gemini AI อ่านและวิเคราะห์ใบเสร็จ
- วิธีใช้: ส่งรูปใบเสร็จมาใน LINE นี้ได้เลย

ผู้ใช้ยังไม่มีใบเสร็จในระบบ

คำถาม: ${question}

กฎ: ตอบได้เรื่อง SmartSlip แอป วิธีใช้งาน และแนะนำให้ส่งรูปใบเสร็จเพื่อเริ่มใช้งาน`;
      const chatModels = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
      for (const modelName of chatModels) {
        try {
          const chatModel = genAI.getGenerativeModel({ model: modelName });
          const result = await chatModel.generateContent(noReceiptPrompt);
          await sendLineReply(replyToken, [{ type: 'text', text: result.response.text() }]);
          return;
        } catch (modelError: any) {
          if (modelError?.status === 503 || modelError?.status === 429) continue;
          throw modelError;
        }
      }
      await sendLineReply(replyToken, [{ type: 'text', text: '❌ ขอโทษ ไม่สามารถตอบได้ตอนนี้ ลองใหม่อีกครั้งนะครับ' }]);
      return;
    }

    // Calculate summaries
    const today = new Date();
    const thisMonth = receipts.filter((r) => {
      const d = new Date(r.issueDate);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    });
    const totalAmount = receipts.reduce((sum, r) => sum + r.amount, 0);
    const thisMonthTotal = thisMonth.reduce((sum, r) => sum + r.amount, 0);

    const receiptSummary = receipts.slice(0, 15).map((r) => ({
      ร้าน: r.storeName,
      จำนวนเงิน: `฿${r.amount}`,
      วันที่: new Date(r.issueDate).toLocaleDateString('th-TH'),
      รายการ: r.items?.map((i: any) => `${i.description} x${i.quantity} ฿${i.totalPrice}`).join(', ') || '-',
    }));

    const prompt = `คุณคือ SmartSlip AI Assistant ผู้ช่วยอัจฉริยะของแอป SmartSlip ตอบเป็นภาษาไทย กระชับ ชัดเจน ใช้ emoji ประกอบ

=== ข้อมูลเกี่ยวกับ SmartSlip ===
SmartSlip คือแอปพลิเคชันจัดการใบเสร็จและค่าใช้จ่ายอัจฉริยะ
- 📸 สแกนใบเสร็จ: ส่งรูปใบเสร็จมาใน LINE Bot นี้ได้เลย ระบบจะอ่านข้อมูลอัตโนมัติด้วย AI
- ☁️ เก็บบนคลาวด์: ใบเสร็จทุกใบถูกเก็บบน Google Cloud Storage อย่างปลอดภัย
- 📊 Google Sheets: ข้อมูลทุกใบเสร็จถูกบันทึกลง Google Sheets อัตโนมัติ
- 🗄️ MongoDB: เก็บข้อมูลในฐานข้อมูล MongoDB
- 💬 LINE Bot: ส่งรูปใบเสร็จหรือถามคำถามเกี่ยวกับค่าใช้จ่ายผ่าน LINE ได้เลย
- 🤖 AI OCR: ใช้ Google Gemini AI อ่านและวิเคราะห์ใบเสร็จ ดึงข้อมูล ชื่อร้าน ยอดเงิน วันที่ สินค้า
- วิธีใช้: ส่งรูปใบเสร็จมาใน LINE นี้ได้เลย หรือพิมพ์ถามสรุปค่าใช้จ่าย

=== ข้อมูลค่าใช้จ่ายของคุณ ===
- ใบเสร็จทั้งหมด: ${receipts.length} ใบ
- ยอดรวมทั้งหมด: ฿${totalAmount.toFixed(2)}
- ยอดเดือนนี้: ฿${thisMonthTotal.toFixed(2)} (${thisMonth.length} ใบ)

ใบเสร็จล่าสุด 15 รายการ:
${JSON.stringify(receiptSummary, null, 2)}

คำถาม: ${question}

กฎ:
- ตอบได้ทั้งเรื่อง SmartSlip แอป วิธีใช้งาน ฟีเจอร์ต่างๆ และเรื่องใบเสร็จ ค่าใช้จ่ายของผู้ใช้
- ถ้าถามนอกเหนือจากนี้ ให้บอกสุภาพว่าตอบได้เฉพาะเรื่อง SmartSlip และค่าใช้จ่าย`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const chatModels = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
    let answer = '';
    for (const modelName of chatModels) {
      try {
        console.log(`📝 [CHATBOT] Trying model: ${modelName}`);
        const chatModel = genAI.getGenerativeModel({ model: modelName });
        const result = await chatModel.generateContent(prompt);
        answer = result.response.text();
        console.log(`✅ [CHATBOT] Answer generated via ${modelName} (${answer.length} chars)`);
        break;
      } catch (modelError: any) {
        const status = modelError?.status;
        if (status === 503 || status === 429) {
          console.warn(`⚠️ [CHATBOT] ${modelName} unavailable (${status}), trying next model...`);
          continue;
        }
        throw modelError;
      }
    }
    if (!answer) throw new Error('All chatbot models unavailable');
    await sendLineReply(replyToken, [{ type: 'text', text: answer }]);
  } catch (error: any) {
    console.error('❌ [CHATBOT] Error:', error);
    await sendLineReply(replyToken, [
      {
        type: 'text',
        text: '❌ ขอโทษ ไม่สามารถตอบได้ตอนนี้ ลองใหม่อีกครั้งนะครับ',
      },
    ]);
  }
}

/**
 * Process LINE webhook events
 * Handles image messages with OCR extraction and storage
 */
async function processLineEvent(event: line.WebhookEvent): Promise<void> {
  // DEBUG: Log all events
  console.log(`\n🔔 [EVENT] Type received: "${event.type}" (expected: postback/message)`);
  if (event.type === 'postback') {
    console.log(`🎯 [EVENT] This is a POSTBACK event!`);
  } else if (event.type === 'message') {
    console.log(`📝 [EVENT] This is a MESSAGE event`);
  } else {
    console.log(`❓ [EVENT] Unknown event type: ${event.type}`);
  }

  // Handle postback events (from quick reply buttons with postback action)
  if (event.type === 'postback') {
    const userId = event.source.userId;
    if (!userId) {
      console.warn(`⚠️ Postback event received but no userId`);
      return;
    }

    const postbackData = (event as any).postback?.data || '';
    console.log(`📮 [POSTBACK] Received from userId: ${userId}`);
    console.log(`📮 [POSTBACK] Raw data: "${postbackData}"`);
    console.log(`📮 [POSTBACK] Data length: ${postbackData.length} chars`);

    // Parse postback data (format: "action=approve&receiptId=...")
    let action: string | null = null;
    let receiptId: string | null = null;
    
    try {
      const params = new URLSearchParams(postbackData);
      action = params.get('action');
      receiptId = params.get('receiptId');
      console.log(`📮 [POSTBACK] Parsed - action: "${action}", receiptId: "${receiptId}"`);
      
      if (!receiptId) {
        console.warn(`⚠️ [POSTBACK] receiptId is missing from parsed data`);
        console.warn(`📮 [POSTBACK] Full params: ${JSON.stringify(Object.fromEntries(params))}`);
      }
    } catch (parseErr) {
      console.error(`❌ [POSTBACK] Failed to parse data:`, parseErr);
      return;
    }

    if (action === 'approve' && receiptId) {
      console.log(`✅ [POSTBACK] Processing APPROVE for receipt: ${receiptId}`);
      try {
        // Validate receiptId format (MongoDB ObjectId is 24 hex chars)
        if (!/^[0-9a-f]{24}$/i.test(receiptId)) {
          console.error(`❌ [POSTBACK] Invalid receiptId format: ${receiptId}`);
          await sendLineReply(event.replyToken, [{ type: 'text', text: '❌ ไม่สามารถอนุมัติได้ - ID ใบเสร็จไม่ถูกต้อง' }]);
          return;
        }
        
        console.log(`✅ [POSTBACK] receiptId format valid, connecting to database...`);
        await connectToDatabase();
        console.log(`✅ [POSTBACK] Database connected, updating status...`);
        
        const receipt = await Receipt.findByIdAndUpdate(
          receiptId,
          { $set: { status: 'approved' } },
          { new: true }
        );
        
        console.log(`📊 [POSTBACK] Update result:`);
        console.log(`   - Receipt found: ${!!receipt}`);
        console.log(`   - New status: ${receipt?.status}`);
        console.log(`   - Amount: ${receipt?.amount}`);
        
        if (receipt) {
          console.log(`✅ [POSTBACK] Receipt successfully updated`);
          await sendLineReply(event.replyToken, [
            {
              type: 'text',
              text: `✅ อนุมัติใบเสร็จแล้ว!\n\n💰 จำนวนเงิน: ฿${receipt.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n📌 สถานะ: ✅ อนุมัติแล้ว`,
            },
          ]);
          console.log(`✅ [POSTBACK] Confirmation message sent to LINE`);
        } else {
          console.warn(`⚠️ [POSTBACK] Receipt not found after update - receiptId: ${receiptId}`);
          console.warn(`⚠️ [POSTBACK] This could mean: 1) receiptId doesn't exist, 2) wrong database, 3) findByIdAndUpdate failed`);
          await sendLineReply(event.replyToken, [{ type: 'text', text: '❌ ไม่พบใบเสร็จ - อาจถูกลบแล้ว' }]);
        }
      } catch (err: any) {
        console.error(`❌ [POSTBACK APPROVE] Exception occurred:`);
        console.error(`   - Message: ${err?.message}`);
        console.error(`   - Code: ${err?.code}`);
        console.error(`   - Stack: ${err?.stack}`);
        try {
          await sendLineReply(event.replyToken, [{ type: 'text', text: `❌ เกิดข้อผิดพลาด: ${err?.message || 'Unknown error'}` }]);
        } catch (replyErr) {
          console.error(`❌ [POSTBACK] Failed to send error message to LINE:`, replyErr);
        }
      }
      return;
    }

    if (action === 'pending' && receiptId) {
      console.log(`⏳ [POSTBACK] Processing PENDING for receipt: ${receiptId}`);
      try {
        await sendLineReply(event.replyToken, [
          {
            type: 'text',
            text: '⏳ เก็บไว้ในสถานะรอตรวจสอบแล้ว\n\n📌 สามารถไปอนุมัติได้ที่เว็บไซต์เมื่อพร้อมครับ\nhttps://smart-slip-nine.vercel.app/line-receipts',
          },
        ]);
        console.log(`✅ [POSTBACK] Pending message sent to LINE`);
      } catch (err) {
        console.error(`❌ [POSTBACK PENDING] Failed:`, err);
      }
      return;
    }
    
    console.warn(`⚠️ [POSTBACK] Postback received but action/receiptId invalid:`);
    console.warn(`   - action: "${action}"`);
    console.warn(`   - receiptId: "${receiptId}"`);
    console.warn(`   - Raw data: "${postbackData}"`);
    return;
  }

  // Only handle message events
  if (event.type !== 'message') {
    console.log(`⏭️ Ignoring ${event.type} event`);
    return;
  }

  const userId = event.source.userId;
  if (!userId) return;

  // Check user approval status before processing any message
  await connectToDatabase();
  const adminIds = (process.env.ADMIN_LINE_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const isAdmin = adminIds.includes(userId);
  const userRecord = await User.findOneAndUpdate(
    { lineUserId: userId },
    isAdmin
      ? { $set: { role: 'admin', status: 'approved' } }
      : { $setOnInsert: { role: 'user', status: 'pending' } },
    { upsert: true, returnDocument: 'after' }
  ).select('status role');
  const userStatus = (userRecord?.status as string) ?? 'pending';
  console.log(`🔍 [DEBUG] User ${userId} status in DB: "${userStatus}"`);
  console.log(`🔍 [DEBUG] Role: "${userRecord?.role}"`);
  if (userStatus !== 'active' && userStatus !== 'approved') {
    const msg = userStatus === 'rejected'
      ? '🚫 บัญชีของคุณถูกปฏิเสธ กรุณาติดต่อแอดมิน\nhttps://smart-slip-nine.vercel.app/'
      : '⏳ บัญชีของคุณกำลังรอการอนุมัติจากแอดมิน\n\nหากต้องการใช้งาน ติดต่อแอดมินได้ที่\nhttps://smart-slip-nine.vercel.app/';
    console.log(`📨 [BLOCK] Status check failed - Sending: ${msg.split('\n')[0]}`);
    await sendLineReply(event.replyToken, [{ type: 'text', text: msg }]);
    return;
  }
  console.log(`✅ [ALLOW] User approved/active - Processing message normally`);

  // Handle text messages
  if (event.message.type === 'text') {
    const text = (event.message as line.TextEventMessage).text.trim();
    console.log(`💬 Text message from ${userId}: ${text}`);

    // Check if user clicked or typed summary request (from Rich Menu or message)
    const summaryTriggers = [
      'ฉันต้องการสรุปยอด',
      'สรุปยอด',
      'สรุปค่าใช้จ่าย',
      'ดูสรุปยอด',
      'สรุปยอดเงิน',
      'สรุปยอดรายจ่าย',
      'เมนูสรุปยอด',
      'ขอสรุปยอด',
      'สรุป',
    ];
    if (summaryTriggers.includes(text) || text.startsWith('สรุปเมนู')) {
      await sendSummaryPeriodMenu(event.replyToken);
      return;
    }

    // Handle Summary Period Selections
    if (text === 'สรุป:วันนี้' || text === 'วันนี้') {
      await handleSummaryPeriod(userId, 'today', event.replyToken);
      return;
    }
    if (text === 'สรุป:เดือนนี้' || text === 'เดือนนี้') {
      await handleSummaryPeriod(userId, 'month', event.replyToken);
      return;
    }
    if (text === 'สรุป:ปีนี้' || text === 'ปีนี้') {
      await handleSummaryPeriod(userId, 'year', event.replyToken);
      return;
    }
    if (text === 'สรุป:ทั้งหมด' || text === 'สรุปยอดทั้งหมด' || text === 'ทั้งหมด') {
      await handleSummaryPeriod(userId, 'all', event.replyToken);
      return;
    }
    if (text === 'สรุป:อื่นๆ' || text === 'อื่นๆ') {
      await sendLineReply(event.replyToken, [
        {
          type: 'text',
          text: '✍️ โปรดระบุช่วงเวลาที่ต้องการให้สรุป เช่น:\n\n• สัปดาห์นี้\n• เดือนที่แล้ว\n• เดือนมกราคม\n• วันที่ 1 ถึง 15 สิงหาคม\n• สรุปยอดหมวดอาหาร\n\nหรือพิมพ์ถามสรุปค่าใช้จ่ายที่ต้องการได้เลยครับ!',
        },
      ]);
      // Mark user state to expect custom date range input
      try {
        await User.updateOne(
          { lineUserId: userId },
          { $set: { pendingCustomSummary: true } },
          { upsert: true }
        );
      } catch (err) {
        console.warn('⚠️ Could not set pendingCustomSummary flag:', err);
      }
      return;
    }

    // Check if this is a category selection for a pending receipt
    const categoryMap: Record<string, string> = {
      '1': 'อาหาร', 'อาหาร': 'อาหาร',
      '2': 'ช้อปปิ้ง', 'ช้อปปิ้ง': 'ช้อปปิ้ง',
      '3': 'เดินทาง', 'เดินทาง': 'เดินทาง',
      '4': 'อื่นๆ', 'อื่นๆ': 'อื่นๆ',
    };
    const normalizedText = text.replace(/^หมวด:/, '');
    const selectedCategory = categoryMap[normalizedText];

    if (selectedCategory) {
      await connectToDatabase();
      const user = await User.findOne({ lineUserId: userId }).select(
        'pendingReceipts googleSheetId'
      );
      // Clear pending custom summary flag if set
      if (user && (user as any).pendingCustomSummary) {
        await User.updateOne(
          { lineUserId: userId },
          { $unset: { pendingCustomSummary: '' } }
        );
      }

      // Filter valid (non-expired) pending receipts
      const now = Date.now();
      const validPending = (user?.pendingReceipts ?? []).filter(
        (r: any) => now - new Date(r.receivedAt).getTime() < 10 * 60 * 1000
      );

      if (validPending.length > 0) {
        // Confirm category and process
        await sendLineReply(event.replyToken, [{
          type: 'text',
          text: `✅ เลือกหมวดหมู่: ${selectedCategory}\n⏳ กำลังประมวลผล ${validPending.length} รูป...`,
        }]);

        // Clear pending state immediately
        await User.updateOne({ lineUserId: userId }, { $set: { pendingReceipts: [] } });

        // Process each image sequentially
        for (const pending of validPending) {
          const imageBuffer = await downloadFromCloudStorage(pending.url);
          await processReceiptInBackground(userId, '', imageBuffer, selectedCategory);
        }
        return;
      } else if ((user?.pendingReceipts ?? []).length > 0) {
        // All expired — clean up
        await User.updateOne({ lineUserId: userId }, { $set: { pendingReceipts: [] } });
      }
    }

    // Check if user is expecting custom date range input for summary
    try {
      await connectToDatabase();
      const userRecord = await User.findOne({ lineUserId: userId }).select('pendingCustomSummary');
      if (userRecord && (userRecord as any).pendingCustomSummary === true) {
        // Try to parse as custom date range
        const customResult = await handleCustomDateRangeSummary(userId, text, event.replyToken);
        if (customResult !== null) {
          // Successfully handled as custom date range
          await User.updateOne(
            { lineUserId: userId },
            { $unset: { pendingCustomSummary: '' } }
          );
          return;
        }
        // If custom date range parsing fails, clear flag and continue to chatbot
        await User.updateOne(
          { lineUserId: userId },
          { $unset: { pendingCustomSummary: '' } }
        );
      }
    } catch (err) {
      console.warn('⚠️ Error checking pendingCustomSummary:', err);
    }

    // Normal chatbot Q&A
    await answerReceiptQuestion(userId, text, event.replyToken);
    return;
  }

  // Only handle image messages (for receipt scanning)
  if (event.message.type !== 'image') {
    console.log(`📝 Unsupported message type: ${event.message.type}`);
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '📸 ส่งรูปใบเสร็จเพื่อสแกน หรือพิมพ์ถามเกี่ยวกับค่าใช้จ่ายของคุณได้เลย!',
      },
    ]);
    return;
  }

  const messageId = (event.message as any).id;

  try {
    console.log(`\n📥 [WEBHOOK] Received image message: ${messageId}`);
    console.log(`👤 User ID: ${event.source.userId}`);

    // Pre-download image
    const imageBuffer = await getImageFromLine(messageId);
    const fileSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`✅ Image downloaded (${fileSizeMB}MB)`);

    // Upload image to Cloud Storage for pending state
    await connectToDatabase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pendingFileName = `pending/${userId}/receipt-${timestamp}.jpg`;
    const { publicUrl } = await uploadToCloudStorage(imageBuffer, pendingFileName, 'image/jpeg');

    // Push to pending receipts array (supports multiple images sent at once)
    await User.findOneAndUpdate(
      { lineUserId: userId },
      { $push: { pendingReceipts: { url: publicUrl, receivedAt: new Date() } } },
      { upsert: true }
    );

    // Ask for category with Quick Reply
    await sendLineReply(event.replyToken, [
      {
        type: 'text',
        text: '✅ ได้รับรูปแล้ว!\n\n📂 คุณต้องการให้ใบเสร็จนี้อยู่ในหมวดหมู่อะไร?',
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: '🍽️ อาหาร', text: 'หมวด:อาหาร' } },
            { type: 'action', action: { type: 'message', label: '🛍️ ช้อปปิ้ง', text: 'หมวด:ช้อปปิ้ง' } },
            { type: 'action', action: { type: 'message', label: '🚌 เดินทาง', text: 'หมวด:เดินทาง' } },
            { type: 'action', action: { type: 'message', label: '✨ อื่นๆ', text: 'หมวด:อื่นๆ' } },
          ],
        },
      } as any,
    ]);

    console.log('✅ Category prompt sent to user');
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
      return corsResponse(
        { ok: true }, 200);
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
          setTimeout(() => reject(new Error('Processing timeout')), 55000)
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
    console.error('❌ [WEBHOOK ERROR]', error);
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


