import mongoose from 'mongoose';
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
  let normalizedStatus = status;
  if (status) {
    const s = status.toLowerCase().trim();
    if (['active', 'approved', 'unlocked'].includes(s)) {
      normalizedStatus = 'active';
    } else if (['restricted', 'suspended', 'blocked', 'inactive', 'locked'].includes(s)) {
      normalizedStatus = 'restricted';
    } else if (['rejected', 'cancelled', 'canceled', 'revoked', 'disabled'].includes(s)) {
      normalizedStatus = 'rejected';
    } else if (['pending'].includes(s)) {
      normalizedStatus = 'pending';
    } else {
      return corsResponse({ error: 'status must be "pending", "active", "restricted", or "rejected"' }, 400, request);
    }
  }

  await connectToDatabase();

  const update: Record<string, string> = {};
  if (role) update.role = role;
  if (normalizedStatus) update.status = normalizedStatus;

  const { id } = await params;

  let updated = null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    updated = await User.findByIdAndUpdate(id, update, { returnDocument: 'after' })
      .select('lineUserId displayName email role status');
  }

  if (!updated) {
    updated = await User.findOneAndUpdate({ lineUserId: id }, update, { returnDocument: 'after' })
      .select('lineUserId displayName email role status');
  }

  if (!updated) {
    return corsResponse({ error: `No user found with id or lineUserId: ${id}` }, 404, request);
  }

  console.log(`🔧 [ADMIN UPDATE] User ${updated.displayName} (${id}) - Status: ${updated.status}, Role: ${updated.role}`);
  console.log(`📝 [ADMIN UPDATE] Update payload was:`, update);

  // Send LINE push notification if status changed and user has lineUserId
  if (normalizedStatus && updated.lineUserId) {
    let msg = '';
    if (normalizedStatus === 'active') {
      msg = '✅ บัญชีของคุณได้รับการอนุมัติแล้ว!\n\nคุณสามารถใช้งาน SmartSlip ได้แล้วตอนนี้ 🎉\nลองส่งรูปใบเสร็จมาได้เลย';
    } else if (normalizedStatus === 'rejected') {
      msg = '❌ บัญชีของคุณถูกยกเลิกการใช้งาน\n\nหากมีข้อสงสัย กรุณาติดต่อแอดมิน\nhttps://smart-slip-nine.vercel.app/';
    } else if (normalizedStatus === 'restricted') {
      msg = '⚠️ บัญชีของคุณถูกระงับการใช้งานชั่วคราว\n\nหากมีข้อสงสัย กรุณาติดต่อแอดมิน\nhttps://smart-slip-nine.vercel.app/';
    }
    if (msg) {
      try {
        console.log(`📤 Sending LINE notification to ${updated.lineUserId} - Status: ${normalizedStatus}`);
        await lineClient.pushMessage(updated.lineUserId, { type: 'text', text: msg });
        console.log(`✅ LINE notification sent successfully`);
      } catch (err) {
        console.error('⚠️ Failed to send LINE notification:', err);
      }
    }
  } else {
    console.warn(`⚠️ Skipping LINE notification - status: ${normalizedStatus}, lineUserId: ${updated.lineUserId}`);
  }

  return corsResponse({ success: true, user: updated }, 200, request);
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}
