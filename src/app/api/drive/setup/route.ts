import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { createFolderStructureWithServiceAccount } from '@/lib/googleDrive';
import { corsResponse } from '@/lib/cors';

/**
 * POST /api/drive/setup
 * Initialize Google Drive folder structure for user
 * Creates folders: SmartSlip > [userId] > Receipts > [Year] > [Month]
 * Uses Service Account - NO USER AUTHORIZATION NEEDED
 * 
 * Request:
 * {
 *   userId: string (required) - User ID from database
 * }
 * 
 * Response:
 * {
 *   success: boolean
 *   message: string
 *   data: {
 *     folderId: string - Month folder ID
 *     folderPath: string - Folder structure description
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    console.log('📁 [DRIVE SETUP API] Setup request received');

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return corsResponse(
        { error: 'Invalid JSON body' },
        400,
        request
      );
    }

    const { userId } = body;

    // Validate required fields
    if (!userId) {
      return corsResponse(
        { error: 'Missing required field: userId' },
        400,
        request
      );
    }

    console.log(`📝 [DRIVE SETUP API] Setting up folders for user: ${userId}`);

    // Connect to MongoDB
    await connectToDatabase();
    console.log('✅ [DRIVE SETUP API] MongoDB connected');

    // Create folder structure using Service Account (no user token needed)
    console.log('📂 [DRIVE SETUP API] Creating folder structure with Service Account...');
    const monthFolderId = await createFolderStructureWithServiceAccount(userId);

    console.log(`✅ [DRIVE SETUP API] Month folder created: ${monthFolderId}`);

    // Update user document with folder ID
    console.log(`💾 [DRIVE SETUP API] Updating user document...`);
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        googleDriveFolderId: monthFolderId,
      },
      { new: true }
    );

    if (!updatedUser) {
      console.error('❌ [DRIVE SETUP API] User not found:', userId);
      return corsResponse(
        { error: 'User not found' },
        404,
        request
      );
    }

    console.log('✅ [DRIVE SETUP API] User document updated');

    // Return success response
    return corsResponse(
      {
        success: true,
        message: 'Google Drive setup completed successfully',
        data: {
          folderId: monthFolderId,
          folderPath: 'SmartSlip > [userId] > Receipts > [Year] > [Month]',
        },
      },
      200,
      request
    );

  } catch (error: any) {
    console.error('❌ [DRIVE SETUP API] Error:', error);
    console.error('   Message:', error?.message);

    if (error.message?.includes('Invalid Credentials')) {
      return corsResponse(
        { error: 'Google Drive credentials are invalid or expired' },
        401,
        request
      );
    }

    if (error.message?.includes('permission')) {
      return corsResponse(
        { error: 'No permission to create folders in Google Drive' },
        403,
        request
      );
    }

    return corsResponse(
      { error: `Setup failed: ${error?.message || 'Unknown error'}` },
      500,
      request
    );
  }
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  return corsResponse({}, 200, request);
}
