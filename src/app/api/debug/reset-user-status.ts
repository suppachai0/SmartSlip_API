import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

/**
 * POST /api/debug/reset-user-status
 * ⚠️ TEMPORARY - Reset all non-admin user status to 'pending'
 * 
 * Purpose: For testing user approval workflow
 * 
 * Query params:
 * - adminKey: Secret key for safety (must match ADMIN_SECRET_KEY env var)
 */
export async function POST(request: NextRequest) {
  try {
    // Security: Check admin key
    const adminKey = process.env.ADMIN_SECRET_KEY;
    const incomingKey = request.nextUrl.searchParams.get('adminKey');
    
    if (!adminKey || !incomingKey || incomingKey !== adminKey) {
      return corsResponse(
        { error: 'Forbidden - Invalid admin key' },
        403,
        request
      );
    }

    await connectToDatabase();

    // Reset all non-admin users to 'pending' status
    const result = await User.updateMany(
      { role: { $ne: 'admin' } },  // Match all users except admins
      { $set: { status: 'pending' } }
    );

    console.log(`🔄 [RESET] Updated ${result.modifiedCount} users to pending status`);

    return corsResponse(
      {
        success: true,
        message: 'User status reset',
        details: {
          modified: result.modifiedCount,
          message: `Reset ${result.modifiedCount} non-admin users to 'pending' status`,
        },
      },
      200,
      request
    );
  } catch (error: any) {
    console.error('Error resetting user status:', error);
    return corsResponse(
      { error: 'Failed to reset user status', details: error.message },
      500,
      request
    );
  }
}

/**
 * OPTIONS /api/debug/reset-user-status
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response, request);
}
