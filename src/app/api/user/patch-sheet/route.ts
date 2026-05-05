import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

/**
 * PATCH /api/user/patch-sheet
 * Utility: set googleSheetId on a user document identified by lineUserId,
 * and optionally copy Google OAuth tokens from a web user account (userId).
 *
 * Protected by ADMIN_SECRET_KEY env var sent as x-admin-key header.
 *
 * Body: { lineUserId: string, googleSheetId: string, userId?: string }
 *   userId — MongoDB _id of the web account to copy OAuth tokens from
 */
export async function PATCH(request: NextRequest) {
  // --- Auth guard ---
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey) {
    return corsResponse({ error: 'ADMIN_SECRET_KEY env var not configured' }, 500, request);
  }
  const incoming = request.headers.get('x-admin-key');
  if (!incoming || incoming !== adminKey) {
    return corsResponse({ error: 'Forbidden' }, 403, request);
  }

  // --- Parse body ---
  let body: { lineUserId?: string; googleSheetId?: string; userId?: string };
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON body' }, 400, request);
  }

  const { lineUserId, googleSheetId, userId } = body;

  if (!lineUserId || !googleSheetId) {
    return corsResponse(
      { error: 'Missing required fields: lineUserId, googleSheetId' },
      400,
      request
    );
  }

  if (!lineUserId.startsWith('U')) {
    return corsResponse({ error: 'Invalid lineUserId format' }, 400, request);
  }

  await connectToDatabase();

  // Optionally copy OAuth tokens from web account
  const tokenFields: Record<string, unknown> = {};
  if (userId) {
    const webUser = await User.findById(userId).select(
      'googleAccessToken googleRefreshToken googleTokenExpiry'
    );
    if (webUser?.googleAccessToken) tokenFields.googleAccessToken = webUser.googleAccessToken;
    if (webUser?.googleRefreshToken) tokenFields.googleRefreshToken = webUser.googleRefreshToken;
    if (webUser?.googleTokenExpiry) tokenFields.googleTokenExpiry = webUser.googleTokenExpiry;
    console.log(`[PATCH-SHEET] Copying tokens from web user ${userId}: hasToken=${!!webUser?.googleAccessToken}`);
  }

  const updated = await User.findOneAndUpdate(
    { lineUserId },
    { googleSheetId, ...tokenFields },
    { new: true }
  ).select('lineUserId googleDriveFolderId googleSheetId googleAccessToken');

  if (!updated) {
    return corsResponse(
      { error: `No user found with lineUserId: ${lineUserId}` },
      404,
      request
    );
  }

  console.log(`✅ [PATCH-SHEET] Updated lineUserId ${lineUserId}, hasToken: ${!!updated.googleAccessToken}`);

  return corsResponse(
    {
      success: true,
      lineUserId: updated.lineUserId,
      googleDriveFolderId: updated.googleDriveFolderId ?? null,
      googleSheetId: updated.googleSheetId ?? null,
      hasGoogleToken: !!updated.googleAccessToken,
    },
    200,
    request
  );
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}
