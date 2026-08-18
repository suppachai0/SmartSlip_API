/**
 * FRONTEND IMPLEMENTATION GUIDE
 * =====================================================
 * File Location: SmartSlip repo → src/app/api/admin/users/[id]/route.ts
 * 
 * This file needs to be created in the Frontend (SmartSlip) repository
 * to handle dynamic user approval/rejection with LINE notifications
 * 
 * Copy this entire code into the new file
 */

import { NextRequest, NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { auth } from '@/auth';

const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

/**
 * Helper to verify admin session (same as in /api/admin/users route.ts)
 */
async function checkAdmin() {
  const session = await auth();
  if (!session || !session.user || !session.user.id) {
    return { authorized: false, error: 'Unauthorized', status: 401 };
  }
  if ((session.user as any).role !== 'admin') {
    return { authorized: false, error: 'Forbidden', status: 403 };
  }
  return { authorized: true, session };
}

/**
 * PATCH /api/admin/users/[id]
 * 
 * Update a user's role and/or approval status.
 * Sends LINE notification when status changes.
 * 
 * @param request - NextRequest object
 * @param params - { id: userId }
 * 
 * Request Body:
 * {
 *   role?: 'user' | 'admin',
 *   status?: 'pending' | 'active' | 'rejected' | 'restricted'
 * }
 * 
 * Response:
 * { success: true, user: { _id, name, role, status, lineUserId, ... } }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAdmin();
    if (!authCheck.authorized) {
      return NextResponse.json(
        { success: false, error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const body = await request.json();
    const { role, status } = body;

    if (!role && !status) {
      return NextResponse.json(
        { success: false, error: 'Provide at least one of: role, status' },
        { status: 400 }
      );
    }

    if (role && !['user', 'admin'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'role must be "user" or "admin"' },
        { status: 400 }
      );
    }

    if (
      status &&
      !['pending', 'active', 'rejected', 'restricted'].includes(status)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'status must be "pending", "active", "rejected", or "restricted"',
        },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db(); // Default DB
    const { id } = await params;

    let userId: ObjectId;
    if (ObjectId.isValid(id)) {
      userId = new ObjectId(id);
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    // Build update object
    const updateData: Record<string, any> = {};
    if (role) updateData.role = role;
    if (status) updateData.status = status;

    // Update user in database
    const updated = await db
      .collection('users')
      .findOneAndUpdate({ _id: userId }, { $set: updateData }, { returnDocument: 'after' });

    if (!updated.value) {
      return NextResponse.json(
        { success: false, error: `No user found with id: ${id}` },
        { status: 404 }
      );
    }

    const user = updated.value;

    // ✨ SEND LINE NOTIFICATION ✨
    if (status && user.lineUserId) {
      let msg = '';

      if (status === 'active' || status === 'approved') {
        msg =
          '✅ บัญชีของคุณได้รับการอนุมัติแล้ว!\n\nคุณสามารถใช้งาน SmartSlip ได้แล้วตอนนี้ 🎉\nลองส่งรูปใบเสร็จมาได้เลย';
      } else if (status === 'rejected') {
        msg =
          '❌ บัญชีของคุณถูกปฏิเสธ\n\nหากมีข้อสงสัย กรุณาติดต่อแอดมิน\nhttps://smart-slip-nine.vercel.app/';
      } else if (status === 'restricted') {
        msg = '🚫 บัญชีของคุณถูกระงับการใช้งาน\n\nกรุณาติดต่อแอดมินเพื่อทราบรายละเอียด';
      } else if (status === 'pending') {
        msg = '⏳ บัญชีของคุณกลับสู่สถานะรอการตรวจสอบ';
      }

      if (msg) {
        try {
          console.log(
            `📤 Sending LINE notification to ${user.lineUserId} - Status: ${status}`
          );
          await lineClient.pushMessage(user.lineUserId, { type: 'text', text: msg });
          console.log(`✅ LINE notification sent successfully`);
        } catch (err) {
          console.error('⚠️ Failed to send LINE notification:', err);
          // Don't fail the entire request if LINE notification fails
        }
      }
    } else {
      if (status) {
        console.warn(
          `⚠️ Skipping LINE notification - status: ${status}, lineUserId: ${user.lineUserId}`
        );
      }
    }

    // Return updated user
    return NextResponse.json(
      {
        success: true,
        user: {
          _id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          lineUserId: user.lineUserId,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('❌ Error in PATCH /api/admin/users/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS handler for CORS preflight (if needed)
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
