import { NextRequest } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { corsResponse, addCorsHeaders } from '@/lib/cors';
import { NextResponse } from 'next/server';

/**
 * POST /api/user/link-line
 * Link a LINE user ID to an existing web account (Google/LINE OAuth)
 * 
 * Called from frontend when user is logged in and LINE user ID is known
 * 
 * Body: { userId: string, lineUserId: string }
 */
export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse({ error: 'Invalid JSON body' }, 400, request);
    }

    const { userId, lineUserId } = body;

    if (!userId || !lineUserId) {
      return corsResponse({ error: 'Missing required fields: userId, lineUserId' }, 400, request);
    }

    // Basic validation - LINE user IDs start with 'U'
    if (!lineUserId.startsWith('U')) {
      return corsResponse({ error: 'Invalid lineUserId format' }, 400, request);
    }

    await connectToDatabase();

    // Check if lineUserId is already used by another account
    const existing = await User.findOne({ lineUserId, _id: { $ne: userId } });
    if (existing) {
      // Already linked - copy googleDriveFolderId to the LINE account if needed
      if (!existing.googleDriveFolderId) {
        const sourceUser = await User.findById(userId).select('googleDriveFolderId');
        if (sourceUser?.googleDriveFolderId) {
          await User.findByIdAndUpdate(existing._id, {
            googleDriveFolderId: sourceUser.googleDriveFolderId,
          });
        }
      }
      return corsResponse(
        { success: true, message: 'LINE account already linked', lineUserId },
        200,
        request
      );
    }

    // Update the current web user's document to include lineUserId
    const updated = await User.findByIdAndUpdate(
      userId,
      { lineUserId },
      { new: true }
    ).select('lineUserId googleDriveFolderId');

    if (!updated) {
      return corsResponse({ error: 'User not found' }, 404, request);
    }

    console.log(`✅ [LINK-LINE] Linked lineUserId ${lineUserId} to user ${userId}`);

    return corsResponse(
      {
        success: true,
        message: 'LINE account linked successfully',
        lineUserId: updated.lineUserId,
        hasDriveFolder: !!updated.googleDriveFolderId,
      },
      200,
      request
    );
  } catch (error: any) {
    console.error('❌ [LINK-LINE] Error:', error);
    return corsResponse({ error: 'Failed to link LINE account' }, 500, request);
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}
