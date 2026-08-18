import { NextRequest, NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

/**
 * PATCH /api/admin/users/[id]
 * Update a user's role and/or approval status.
 * Protected by x-admin-key header.
 *
 * Body: { role?: 'user' | 'admin', status?: 'pending' | 'approved' | 'rejected' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey) {
    return corsResponse({ error: 'ADMIN_SECRET_KEY not configured' }, 500, request);
  }
  const incoming = request.headers.get('x-admin-key');
  if (!incoming || incoming !== adminKey) {
    return corsResponse({ error: 'Forbidden' }, 403, request);
  }

  let body: { role?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON body' }, 400, request);
  }

  const { role, status } = body;

  if (!role && !status) {
    return corsResponse({ error: 'Provide at least one of: role, status' }, 400, request);
  }

  if (role && !['user', 'admin'].includes(role)) {
    return corsResponse({ error: 'role must be "user" or "admin"' }, 400, request);
  }
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    return corsResponse({ error: 'status must be "pending", "approved", or "rejected"' }, 400, request);
  }

  await connectToDatabase();

  const update: Record<string, string> = {};
  if (role) update.role = role;
  if (status) update.status = status;

  const { id } = await params;

  const updated = await User.findByIdAndUpdate(id, update, { returnDocument: 'after' })
    .select('lineUserId displayName email role status');

  if (!updated) {
    return corsResponse({ error: `No user found with id: ${id}` }, 404, request);
  }

  // Send LINE push notification if status changed and user has lineUserId
  if (status && updated.lineUserId) {
    let msg = '';
    if (status === 'approved') {
      msg = '✅ บัญชีของคุณได้รับการอนุมัติแล้ว!\n\nคุณสามารถใช้งาน SmartSlip ได้แล้วตอนนี้ 🎉\nลองส่งรูปใบเสร็จมาได้เลย';
    } else if (status === 'rejected') {
      msg = '❌ บัญชีของคุณถูกปฏิเสธ\n\nหากมีข้อสงสัย กรุณาติดต่อแอดมิน\nhttps://smart-slip-nine.vercel.app/';
    }
    if (msg) {
      try {
        console.log(`📤 Sending LINE notification to ${updated.lineUserId} - Status: ${status}`);
        await lineClient.pushMessage(updated.lineUserId, { type: 'text', text: msg });
        console.log(`✅ LINE notification sent successfully`);
      } catch (err) {
        console.error('⚠️ Failed to send LINE notification:', err);
      }
    }
  } else {
    console.warn(`⚠️ Skipping LINE notification - status: ${status}, lineUserId: ${updated.lineUserId}`);
  }

  return corsResponse({ success: true, user: updated }, 200, request);
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}
