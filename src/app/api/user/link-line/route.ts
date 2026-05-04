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

    const {
      userId,
      lineUserId,
      googleDriveFolderId: bodyFolderId,
      googleSheetId,
      googleAccessToken,
      googleRefreshToken,
      googleTokenExpiry,
    } = body;

    if (!userId || !lineUserId) {
      return corsResponse({ error: 'Missing required fields: userId, lineUserId' }, 400, request);
    }

    // Basic validation - LINE user IDs start with 'U'
    if (!lineUserId.startsWith('U')) {
      return corsResponse({ error: 'Invalid lineUserId format' }, 400, request);
    }

    await connectToDatabase();

    // Get googleDriveFolderId from body or fall back to the web account's stored value
    const webUser = await User.findById(userId).select('googleDriveFolderId googleSheetId');
    const googleDriveFolderId = bodyFolderId || webUser?.googleDriveFolderId;
    const resolvedSheetId = googleSheetId || webUser?.googleSheetId;

    // Build token update fields if provided
    const tokenFields: Record<string, unknown> = {};
    if (googleAccessToken) tokenFields.googleAccessToken = googleAccessToken;
    if (googleRefreshToken) tokenFields.googleRefreshToken = googleRefreshToken;
    if (googleTokenExpiry) tokenFields.googleTokenExpiry = new Date(googleTokenExpiry);

    // Upsert: find by lineUserId and set googleDriveFolderId (create if not exists)
    const updated = await User.findOneAndUpdate(
      { lineUserId },
      {
        lineUserId,
        ...(googleDriveFolderId && { googleDriveFolderId }),
        ...(resolvedSheetId && { googleSheetId: resolvedSheetId }),
        ...tokenFields,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).select('lineUserId googleDriveFolderId googleSheetId googleAccessToken');

    console.log(`✅ [LINK-LINE] Linked lineUserId ${lineUserId}, hasDrive: ${!!updated?.googleDriveFolderId}, hasSheet: ${!!updated?.googleSheetId}, hasGoogleToken: ${!!updated?.googleAccessToken}`);

    return corsResponse(
      {
        success: true,
        message: 'LINE account linked successfully',
        lineUserId: updated.lineUserId,
        hasDriveFolder: !!updated.googleDriveFolderId,
        hasSheet: !!updated.googleSheetId,
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
