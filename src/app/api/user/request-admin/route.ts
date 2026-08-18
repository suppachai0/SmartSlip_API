import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { corsResponse, addCorsHeaders } from '@/lib/cors';
import { verifyJWT } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return corsResponse({ error: 'Invalid JSON body' }, 400, request);
    }

    const {
      userId,
      lineUserId,
      displayName,
      email,
      phoneNumber,
      reason,
      message,
    } = body || {};

    const resolvedLineUserId = typeof lineUserId === 'string' ? lineUserId.trim() : '';
    const resolvedUserId = typeof userId === 'string' ? userId.trim() : '';
    const resolvedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
    const resolvedEmail = typeof email === 'string' ? email.trim() : '';
    const resolvedReason = typeof reason === 'string' ? reason.trim() : (typeof message === 'string' ? message.trim() : '');

    if (!resolvedUserId && !resolvedLineUserId) {
      return corsResponse(
        { error: 'Missing required field: userId or lineUserId' },
        400,
        request
      );
    }

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let authUserId = '';

    if (token) {
      const payload = verifyJWT(token);
      if (payload?.userId) {
        authUserId = String(payload.userId);
      }
    }

    await connectToDatabase();

    let user = null;
    if (resolvedUserId) {
      user = await User.findById(resolvedUserId);
    } else if (resolvedLineUserId) {
      user = await User.findOne({ lineUserId: resolvedLineUserId });
    }

    if (authUserId && !resolvedUserId && user && user._id.toString() !== authUserId) {
      return corsResponse({ error: 'User mismatch with session token' }, 403, request);
    }

    if (!user) {
      if (!resolvedLineUserId) {
        return corsResponse({ error: 'User not found and lineUserId is required to create a pending request' }, 404, request);
      }

      user = await User.create({
        lineUserId: resolvedLineUserId,
        displayName: resolvedDisplayName || 'ผู้ใช้ใหม่',
        email: resolvedEmail || undefined,
        ...(typeof phoneNumber === 'string' && phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
        statusMessage: resolvedReason || 'Requesting admin access',
        role: 'user',
        status: 'pending',
      });
    } else {
      if (user.role === 'admin' && user.status === 'approved') {
        return corsResponse(
          { success: false, message: 'User is already an approved admin', user: { id: user._id, status: user.status, role: user.role } },
          409,
          request
        );
      }

      if (resolvedLineUserId) user.lineUserId = resolvedLineUserId;
      if (resolvedDisplayName) user.displayName = resolvedDisplayName;
      if (resolvedEmail) user.email = resolvedEmail;
      if (typeof phoneNumber === 'string' && phoneNumber.trim()) {
        user.phoneNumber = phoneNumber.trim();
      }
      if (resolvedReason) {
        user.statusMessage = resolvedReason;
      }
      user.role = 'user';
      user.status = 'pending';
      await user.save();
    }

    return corsResponse(
      {
        success: true,
        message: 'Admin access request submitted successfully',
        user: {
          id: user._id,
          lineUserId: user.lineUserId,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
          status: user.status,
          statusMessage: user.statusMessage,
        },
      },
      200,
      request
    );
  } catch (error: any) {
    console.error('❌ [REQUEST-ADMIN] Error:', error);
    return corsResponse({ error: 'Failed to request admin access', details: error?.message }, 500, request);
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}
