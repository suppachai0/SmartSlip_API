import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

/**
 * GET /api/receipts/summary
 * Get summary of receipts with totals by status
 * 
 * Query params:
 * ?userId=string (optional) - Filter by specific user
 * ?storeName=string (optional) - Filter by store
 */
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const storeName = searchParams.get('storeName');

    // Build filter query
    const matchStage: any = {};
    if (userId) matchStage.userId = userId;
    if (storeName) matchStage.storeName = storeName;

    // MongoDB Aggregation Pipeline
    const summary = await Receipt.aggregate([
      // Step 1: Match documents based on filters
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),

      // Step 2: Group by status and calculate totals
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          averageAmount: { $avg: '$amount' },
        },
      },

      // Step 3: Sort by status
      {
        $sort: { _id: 1 },
      },
    ]);

    // Step 4: Calculate overall totals and format response
    let grandTotal = 0;
    let totalCount = 0;
    const statusBreakdown: any = {};
    const statusLabels: any = {
      pending: 'รอดำเนินการ',
      reviewing: 'กำลังตรวจสอบ',
      approved: 'อนุมัติแล้ว',
      rejected: 'ปฏิเสธ',
      completed: 'เสร็จสิ้น',
      failed: 'ล้มเหลว',
    };

    summary.forEach((item) => {
      grandTotal += item.totalAmount;
      totalCount += item.count;

      statusBreakdown[item._id] = {
        status: item._id,
        statusLabel: statusLabels[item._id] || item._id,
        totalAmount: item.totalAmount,
        count: item.count,
        averageAmount: parseFloat(item.averageAmount.toFixed(2)),
      };
    });

    // Step 5: Ensure all statuses are included (even with 0 values)
    const validStatuses = [
      'pending',
      'reviewing',
      'approved',
      'rejected',
      'completed',
      'failed',
    ];
    validStatuses.forEach((status) => {
      if (!statusBreakdown[status]) {
        statusBreakdown[status] = {
          status,
          statusLabel: statusLabels[status],
          totalAmount: 0,
          count: 0,
          averageAmount: 0,
        };
      }
    });

    // Step 6: Get recent receipts (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCount = await Receipt.countDocuments({
      ...(userId && { userId }),
      ...(storeName && { storeName }),
      createdAt: { $gte: sevenDaysAgo },
    });

    return corsResponse(
      {
        success: true,
        summary: {
          grandTotal: parseFloat(grandTotal.toFixed(2)),
          totalCount,
          recentCount: recentCount,
          averageAmount: parseFloat(
            (grandTotal / totalCount || 0).toFixed(2)
          ),
          statusBreakdown: validStatuses.map((status) => statusBreakdown[status]),
          filters: {
            userId: userId || null,
            storeName: storeName || null,
          },
          timestamp: new Date().toISOString(),
        },
      },
      200
    );
  } catch (error: any) {
    console.error('Error fetching summary:', error);
    return corsResponse(
      { error: 'Failed to fetch summary' },
      500
    );
  }
}
