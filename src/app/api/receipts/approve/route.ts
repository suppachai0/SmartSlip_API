import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { NextRequest, NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';

// Initialize LINE client
const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { receiptId, userId } = body;

    if (!receiptId) {
      return NextResponse.json(
        { error: 'receiptId is required' },
        { status: 400 }
      );
    }

    await connectToDatabase();
    
    console.log(`📝 [APPROVE API] Attempting to approve receipt: ${receiptId}`);
    
    const receipt = await Receipt.findByIdAndUpdate(
      receiptId,
      { $set: { status: 'approved' } },
      { new: true }
    );

    if (!receipt) {
      console.warn(`⚠️ [APPROVE API] Receipt not found: ${receiptId}`);
      return NextResponse.json(
        { error: 'Receipt not found' },
        { status: 404 }
      );
    }

    console.log(`✅ [APPROVE API] Receipt approved successfully:`, receipt._id);
    
    // Send LINE notification if userId is provided
    if (userId) {
      try {
        await lineClient.pushMessage(userId, {
          type: 'text',
          text: `✅ อนุมัติใบเสร็จแล้ว!\n\n💰 จำนวนเงิน: ฿${receipt.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n📌 สถานะ: ✅ อนุมัติแล้ว`,
        });
        console.log(`📱 [APPROVE API] LINE notification sent to ${userId}`);
      } catch (lineErr) {
        console.warn(`⚠️ [APPROVE API] Could not send LINE notification:`, lineErr);
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'Receipt approved successfully',
      receipt: {
        id: receipt._id,
        amount: receipt.amount,
        status: receipt.status,
      },
    });
  } catch (error: any) {
    console.error('❌ [APPROVE API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
