import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';

/**
 * DEBUG ENDPOINT: Test direct receipt update
 * GET /api/debug?receiptId=xxx - Test update for specific receipt
 * GET /api/debug?list=true - List all receipts with their IDs
 */
export async function GET(request: NextRequest) {
  try {
    // If list=true, show all receipts
    const showList = request.nextUrl.searchParams.get('list') === 'true';
    if (showList) {
      console.log(`\n📋 [DEBUG LIST] Fetching all receipts...`);
      await connectToDatabase();
      
      const receipts = await Receipt.find({})
        .select('_id storeName amount status issueDate')
        .sort({ createdAt: -1 })
        .limit(20);
      
      console.log(`✅ [DEBUG LIST] Found ${receipts.length} receipts`);
      
      return NextResponse.json({
        success: true,
        message: `Found ${receipts.length} receipts`,
        receipts: receipts.map(r => ({
          id: r._id.toString(),
          storeName: r.storeName,
          amount: r.amount,
          status: r.status,
          issueDate: r.issueDate,
          copyThisId: `👉 ${r._id.toString()}`,
        })),
        howToUse: `Copy the "id" value and use it in URL: http://localhost:3000/api/debug?receiptId=[PASTE_ID]`,
      });
    }

    const receiptId = request.nextUrl.searchParams.get('receiptId');
    
    if (!receiptId) {
      return NextResponse.json(
        { error: 'receiptId parameter required', example: '/api/debug?receiptId=507f1f77bcf86cd799439011' },
        { status: 400 }
      );
    }

    console.log(`\n🧪 [DEBUG TEST] Testing receipt update for ID: ${receiptId}`);
    
    // Step 1: Connect to database
    console.log(`🔗 [DEBUG TEST] Step 1: Connecting to database...`);
    await connectToDatabase();
    console.log(`✅ [DEBUG TEST] Database connected`);

    // Step 2: Find receipt
    console.log(`🔍 [DEBUG TEST] Step 2: Finding receipt...`);
    const receipt = await Receipt.findById(receiptId);
    console.log(`📊 [DEBUG TEST] Receipt found:`, {
      id: receipt?._id,
      status: receipt?.status,
      amount: receipt?.amount,
      storeName: receipt?.storeName,
    });

    if (!receipt) {
      return NextResponse.json(
        { error: 'Receipt not found', receiptId },
        { status: 404 }
      );
    }

    // Step 3: Update status to approved
    console.log(`✏️ [DEBUG TEST] Step 3: Updating status to 'approved'...`);
    const updated = await Receipt.findByIdAndUpdate(
      receiptId,
      { $set: { status: 'approved' } },
      { new: true }
    );
    console.log(`✅ [DEBUG TEST] Update complete:`, {
      newStatus: updated?.status,
      updated: !!updated,
    });

    // Step 4: Verify by re-fetching
    console.log(`🔄 [DEBUG TEST] Step 4: Re-fetching to verify...`);
    const verified = await Receipt.findById(receiptId);
    console.log(`✅ [DEBUG TEST] Verification:`, {
      verifiedStatus: verified?.status,
      matchesExpected: verified?.status === 'approved',
    });

    return NextResponse.json({
      success: true,
      message: 'Test update completed',
      before: { status: receipt.status },
      after: { status: updated?.status },
      verified: { status: verified?.status, correct: verified?.status === 'approved' },
      debug: {
        mongooseConnected: !!updated,
        updateReturned: !!updated,
        verificationPassed: verified?.status === 'approved',
      },
    });
  } catch (error: any) {
    console.error(`❌ [DEBUG TEST] Error:`, error);
    return NextResponse.json(
      {
        error: 'Test failed',
        message: error?.message,
        code: error?.code,
        details: String(error),
      },
      { status: 500 }
    );
  }
}
