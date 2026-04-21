import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { createFolderStructureWithServiceAccount, shareFolderWithUser } from '@/lib/googleDrive';
import { corsResponse } from '@/lib/cors';

/**
 * POST /api/drive/setup
 * Initialize Google Drive folder structure for user
 * Creates folders: SmartSlip > [userId] > Receipts > [Year] > [Month]
 * Uses Service Account - NO USER AUTHORIZATION NEEDED
 * Shares folder with user email automatically
 * 
 * Request:
 * {
 *   userId: string (required) - User ID from database
 *   email: string (optional) - User email for sharing folder
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

    const { userId, email: emailFromRequest } = body;

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

    // Get user email for folder sharing
    // Priority: 1. Email from Frontend request, 2. Email from MongoDB user document
    let userEmail = emailFromRequest;
    if (!userEmail) {
      const existingUser = await User.findById(userId);
      userEmail = existingUser?.email;
    }

    if (userEmail) {
      console.log(`📧 [DRIVE SETUP API] Using email for sharing: ${userEmail}`);
    }

    // Create folder structure using Service Account (no user token needed)
    console.log('📂 [DRIVE SETUP API] Creating folder structure with Service Account...');
    const { monthFolderId, userFolderId } = await createFolderStructureWithServiceAccount(userId);

    console.log(`✅ [DRIVE SETUP API] Month folder created: ${monthFolderId}`);

    // Share user folder with user's email so they can access it directly
    if (userEmail) {
      try {
        await shareFolderWithUser(userFolderId, userEmail);
        console.log(`✅ [DRIVE SETUP API] Folder shared with user: ${userEmail}`);
      } catch (shareError) {
        console.warn('⚠️ [DRIVE SETUP API] Could not share folder (non-fatal):', shareError);
      }
    }

    // Update user document with folder ID (save userFolderId for direct browsing)
    console.log(`💾 [DRIVE SETUP API] Updating user document...`);
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        googleDriveFolderId: userFolderId,
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
