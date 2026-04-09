import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { getUserMonthFolder } from '@/lib/googleDrive';
import { corsResponse } from '@/lib/cors';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return corsResponse(
        { error: 'userId query parameter is required' },
        400,
        request
      );
    }

    // Connect to database and get user
    await connectToDatabase();
    const user = await User.findById(userId);

    if (!user) {
      return corsResponse(
        { error: 'User not found' },
        404,
        request
      );
    }

    // Check if user has Google OAuth token
    if (!user.googleAccessToken) {
      return corsResponse(
        { error: 'User has not authorized Google Drive access' },
        401,
        request
      );
    }

    // Get or create month folder in user's drive
    const folderId = await getUserMonthFolder(userId, user.googleAccessToken, user.displayName);

    // Save folder ID to user record
    user.googleDriveFolderId = folderId;
    await user.save();

    return corsResponse(
      {
        success: true,
        folderId,
        folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
      },
      200,
      request
    );
  } catch (error: unknown) {
    console.error('Drive Folder Error:', error);
    return corsResponse(
      {
        error: 'Failed to get/create Google Drive folder',
        details: error instanceof Error ? error.message : 'Unknown error',
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
