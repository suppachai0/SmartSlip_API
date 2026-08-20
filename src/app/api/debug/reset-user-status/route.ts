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
 * ⚠️ WARNING: This is a debug endpoint - remove in production!
 */
// Allow GET for easy browser testing
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  try {
    // ⚠️ TEMP: For testing only - no auth required on debug endpoint
    console.log('🔄 [RESET] Starting user status reset process...');

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
