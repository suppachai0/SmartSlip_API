import { NextRequest, NextResponse } from 'next/server';
import { getUserMonthFolder } from '@/lib/googledrive';
import { corsResponse } from '@/lib/cors';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const userName = searchParams.get('name') || undefined;

    if (!userId) {
      return corsResponse(
        { error: 'userId query parameter is required' },
        400,
        request
      );
    }

    const folderId = await getUserMonthFolder(userId, userName);

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
