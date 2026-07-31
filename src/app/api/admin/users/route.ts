import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

/**
 * GET /api/admin/users
 * List all users with their role and approval status.
 * Protected by x-admin-key header.
 */
export async function GET(request: NextRequest) {
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey) {
    return corsResponse({ error: 'ADMIN_SECRET_KEY not configured' }, 500, request);
  }
  const incoming = request.headers.get('x-admin-key');
  if (!incoming || incoming !== adminKey) {
    return corsResponse({ error: 'Forbidden' }, 403, request);
  }

  await connectToDatabase();

  const users = await User.find({})
    .select('lineUserId displayName email pictureUrl role status createdAt lastLoginAt')
    .sort({ createdAt: -1 });

  return corsResponse({ success: true, total: users.length, users }, 200, request);
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}
