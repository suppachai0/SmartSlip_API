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
      googleSheetId,
    } = body;

    if (!userId || !lineUserId) {
      return corsResponse({ error: 'Missing required fields: userId, lineUserId' }, 400, request);
    }

    // Basic validation - LINE user IDs start with 'U'
    if (!lineUserId.startsWith('U')) {
      return corsResponse({ error: 'Invalid lineUserId format' }, 400, request);
    }

    await connectToDatabase();

    // Get googleSheetId from body or fall back to the web account's stored value
    const webUser = await User.findById(userId).select('googleSheetId');
    const resolvedSheetId = googleSheetId || webUser?.googleSheetId;

    // Upsert: find by lineUserId and link to web account
    const updated = await User.findOneAndUpdate(
      { lineUserId },
      {
        lineUserId,
        ...(resolvedSheetId && { googleSheetId: resolvedSheetId }),
      },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).select('lineUserId googleSheetId');

    console.log(`✅ [LINK-LINE] Linked lineUserId ${lineUserId}, hasSheet: ${!!updated?.googleSheetId}`);

    return corsResponse(
      {
        success: true,
        message: 'LINE account linked successfully',
        lineUserId: updated.lineUserId,
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
