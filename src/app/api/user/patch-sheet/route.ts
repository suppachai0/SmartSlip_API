import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

/**
 * PATCH /api/user/patch-sheet
 * One-time utility: set googleSheetId on a user document identified by lineUserId.
 *
 * Protected by ADMIN_SECRET_KEY env var sent as x-admin-key header.
 *
 * Body: { lineUserId: string, googleSheetId: string }
 *
 * Returns the updated user's lineUserId, googleDriveFolderId, googleSheetId.
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
  let body: { lineUserId?: string; googleSheetId?: string };
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON body' }, 400, request);
  }

  const { lineUserId, googleSheetId } = body;

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

  const updated = await User.findOneAndUpdate(
    { lineUserId },
    { googleSheetId },
    { new: true }
  ).select('lineUserId googleDriveFolderId googleSheetId');

  if (!updated) {
    return corsResponse(
      { error: `No user found with lineUserId: ${lineUserId}` },
      404,
      request
    );
  }

  console.log(`✅ [PATCH-SHEET] Updated googleSheetId for ${lineUserId}`);

  return corsResponse(
    {
      success: true,
      lineUserId: updated.lineUserId,
      googleDriveFolderId: updated.googleDriveFolderId ?? null,
      googleSheetId: updated.googleSheetId ?? null,
    },
    200,
    request
  );
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}
