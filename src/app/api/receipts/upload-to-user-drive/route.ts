import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { uploadToUserGoogleDrive } from '@/lib/googleDrive';
import { corsResponse } from '@/lib/cors';
import { validateApiKey } from '@/lib/auth';

/**
 * POST /api/receipts/upload-to-user-drive
 * Upload receipt image to user's own Google Drive
 * 
 * Requires:
 * - userId (required)
 * - api_key (required)
 * - file (multipart form data)
 * 
 * User must have Google OAuth access authorized
 */
export async function POST(request: NextRequest) {
  try {
    // Validate API key
    if (!validateApiKey(request)) {
      return corsResponse(
        { error: 'Missing or invalid API key' },
        401,
        request
      );
    }

    // Parse form data
    const formData = await request.formData();
    const userId = formData.get('userId') as string;
    const file = formData.get('file') as File;

    if (!userId) {
      return corsResponse(
        { error: 'userId is required' },
        400,
        request
      );
    }

    if (!file) {
      return corsResponse(
        { error: 'file is required' },
        400,
        request
      );
    }

    // Connect to database
    await connectToDatabase();

    // Get user and verify Google OAuth
    const user = await User.findById(userId);
    if (!user) {
      return corsResponse(
        { error: 'User not found' },
        404,
        request
      );
    }

    if (!user.googleAccessToken) {
      return corsResponse(
        {
          error: 'User has not authorized Google Drive access',
          requiresAuth: true,
        },
        401,
        request
      );
    }

    // Convert file to buffer
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Upload to user's Google Drive
    const uploadResult = await uploadToUserGoogleDrive(
      fileBuffer,
      file.name,
      user.googleAccessToken,
      userId,
      file.type || 'image/jpeg'
    );

    return corsResponse(
      {
        success: true,
        message: 'File uploaded to your Google Drive',
        ...uploadResult,
      },
      200,
      request
    );
  } catch (error: unknown) {
    console.error('User Drive Upload Error:', error);
    
    // Check for token expiration
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (errorMsg.includes('unauthorized') || errorMsg.includes('invalid_grant')) {
      return corsResponse(
        {
          error: 'Google authorization expired',
          requiresAuth: true,
          details: 'Please re-authorize Google Drive access',
        },
        401,
        request
      );
    }

    return corsResponse(
      {
        error: 'Failed to upload to Google Drive',
        details: errorMsg,
      },
      500,
      request
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  const { addCorsHeaders } = await import('@/lib/cors');
  return addCorsHeaders(response, request);
}
