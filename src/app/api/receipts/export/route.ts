import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import User from '@/models/User';
import { corsResponse } from '@/lib/cors';
import { notifyUserByLine } from '@/lib/lineNotifications';

/**
 * POST /api/receipts/export
 * Export user receipts as CSV/Excel
 * 
 * Expected request body:
 * {
 *   userId: string (MongoDB ObjectId)
 *   format: 'csv' | 'excel' (default: 'csv')
 *   dateRange?: { start: Date, end: Date }
 * }
 * 
 * Returns:
 * CSV file content or Excel buffer
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const body = await request.json();
    const { userId, format = 'csv', dateRange } = body;

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return corsResponse(
        { error: 'userId is required' },
        400,
        request
      );
    }

    // Build query
    const query: any = { userId };

    // Apply date range filter if provided
    if (dateRange && dateRange.start && dateRange.end) {
      query.createdAt = {
        $gte: new Date(dateRange.start),
        $lte: new Date(dateRange.end),
      };
    }

    // Fetch receipts
    const receipts = await Receipt.find(query)
      .select('storeName amount issueDate status category notes')
      .lean()
      .exec();

    if (!receipts || receipts.length === 0) {
      return corsResponse(
        { error: 'No receipts found for export' },
        404,
        request
      );
    }

    // Get user info for LINE notification
    const user = await User.findById(userId).select('lineUserId displayName');

    // Generate CSV content
    const csvContent = generateCSV(receipts);

    // Prepare response based on format
    let responseBody: any;
    let contentType: string;
    let filename: string;

    if (format === 'excel') {
      // For now, we'll send CSV with Excel MIME type
      // In production, you might use a library like 'xlsx' or 'exceljs'
      responseBody = csvContent;
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `receipts-export-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      responseBody = csvContent;
      contentType = 'text/csv';
      filename = `receipts-export-${new Date().toISOString().split('T')[0]}.csv`;
    }

    // Send LINE notification
    if (user?.lineUserId) {
      const totalAmount = receipts.reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
      const message = `📊 ข้อมูลใบเสร็จของคุณพร้อมแล้ว\n${receipts.length} รายการ\nรวม: ${totalAmount.toLocaleString('th-TH')} ฿\n\nกรุณาตรวจสอบไฟล์ที่ส่งไปยังเบราว์เซอร์`;
      
      try {
        await notifyUserByLine(userId, message);
      } catch (notifyError) {
        console.error('LINE notification failed:', notifyError);
        // Continue anyway, don't fail the export
      }
    }

    // Return CSV file
    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error: any) {
    console.error('Error exporting receipts:', error);

    return corsResponse(
      { error: 'Failed to export receipts' },
      500,
      request
    );
  }
}

/**
 * Generate CSV content from receipts array
 */
function generateCSV(receipts: any[]): string {
  // CSV Headers (Thai language)
  const headers = ['ลำดับ', 'ร้านค้า', 'จำนวนเงิน', 'วันที่', 'สถานะ', 'หมวดหมู่', 'หมายเหตุ'];

  // Map receipts to CSV rows
  const rows = receipts.map((receipt: any, index: number) => [
    index + 1,
    (receipt.storeName || '-').toString().replace(/"/g, '""'), // Escape quotes
    Number(receipt.amount || 0).toFixed(2),
    receipt.issueDate ? new Date(receipt.issueDate).toLocaleDateString('th-TH') : '-',
    receipt.status || 'pending',
    receipt.category || '-',
    (receipt.notes || '').toString().replace(/"/g, '""'), // Escape quotes
  ]);

  // Combine headers and rows
  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      row
        .map(cell => {
          // Wrap cells containing commas, quotes, or newlines in quotes
          if (String(cell).includes(',') || String(cell).includes('"') || String(cell).includes('\n')) {
            return `"${cell}"`;
          }
          return cell;
        })
        .join(',')
    ),
  ];

  // Add summary row
  const totalAmount = receipts.reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
  csvLines.push('');
  csvLines.push(`รวมทั้งสิ้น,${totalAmount.toFixed(2)}`);
  csvLines.push(`จำนวนรายการ,${receipts.length}`);
  csvLines.push(`วันที่ export,${new Date().toLocaleString('th-TH')}`);

  return csvLines.join('\n');
}
