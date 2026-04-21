import { google } from 'googleapis';
import { retryOnSpecificErrors } from './retry';

/**
 * Enhanced Google Drive upload with retry logic and timeout handling
 */

// Initialize Google Drive API
const drive = google.drive({
  version: 'v3',
  auth: new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_url: 'https://accounts.google.com/o/oauth2/auth',
      token_url: 'https://oauth2.googleapis.com/token',
    } as any,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  }),
});

/**
 * Determine if error is retryable
 * Retries for: timeouts, rate limits, server errors (5xx)
 * Does NOT retry for: authentication errors, permissions, invalid parameters
 */
function isRetryableError(error: any): boolean {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorCode = error?.code || error?.status;

  // Network/timeout errors
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('econnreset') ||
    errorMessage.includes('enotfound') ||
    errorCode === 'ETIMEDOUT'
  ) {
    return true;
  }

  // Rate limit and server errors (4xx/5xx that might be temporary)
  if (errorCode === 429 || errorCode === 503 || errorCode === 500 || errorCode === 502) {
    return true;
  }

  // Google API specific errors
  if (errorMessage.includes('rate') || errorMessage.includes('quota')) {
    return true;
  }

  return false;
}

export interface GoogleDriveUploadResult {
  fileId: string;
  webViewLink: string;
  publicLink: string;
  size: number;
  uploadedAt: string;
}

/**
 * Upload buffer to Google Drive with retry logic
 */
export async function uploadToGoogleDriveWithRetry(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string = 'image/jpeg'
): Promise<GoogleDriveUploadResult> {
  console.log(`📤 Uploading to Google Drive (Root): ${fileName} (${fileBuffer.length} bytes)`);

  // Check file size (Google Drive limit is 5TB per file, but consider API timeout)
  if (fileBuffer.length > 100 * 1024 * 1024) {
    throw new Error('File too large (>100MB). Consider splitting or compressing.');
  }

  try {
    const result = await retryOnSpecificErrors(
      async () => {
        // Create file metadata - uploading to root drive (no folder specified)
        const fileMetadata = {
          name: fileName,
          mimeType,
        };

        console.log('📝 Creating file metadata...');

        // Upload file with retry
        const response = await drive.files.create({
          requestBody: fileMetadata as any,
          media: {
            mimeType,
            body: require('stream').Readable.from([fileBuffer]),
          },
          fields: 'id, webViewLink, webContentLink',
          supportsAllDrives: true,
        } as any);

        const fileId = response.data.id;

        if (!fileId) {
          throw new Error('Failed to get file ID from Google Drive');
        }

        return {
          fileId,
          webViewLink: response.data.webViewLink || '',
          webContentLink: response.data.webContentLink || '',
        };
      },
      isRetryableError,
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 15000,
        backoffMultiplier: 2,
        timeoutMs: 30000, // 30 second timeout per attempt
        onRetry: (attempt, error) => {
          console.warn(
            `⚠️ Google Drive upload retry ${attempt}: ${error?.message}`
          );
        },
      }
    );

    // Make file public (set permissions)
    console.log('🔓 Setting file to public...');
    try {
      // Note: Making file public is optional and might fail with rate limits
      // Retry separately with different strategy
      await retryOnSpecificErrors(
        async () => {
          await drive.permissions.create({
            fileId: result.fileId,
            requestBody: {
              role: 'reader',
              type: 'anyone',
            },
            supportsAllDrives: true,
          } as any);
        },
        (error) => {
          // Retry only for rate limit errors
          return error?.code === 429 || error?.message?.includes('rate');
        },
        {
          maxAttempts: 2,
          initialDelayMs: 1000,
          timeoutMs: 5000,
        }
      );
    } catch (permError) {
      console.warn('⚠️ Could not set file to public (permissions):', permError);
      // Non-fatal: file is uploaded, just not public
    }

    const publicLink = `https://drive.google.com/uc?id=${result.fileId}&export=view`;

    console.log('✅ File uploaded successfully');
    console.log(`   ID: ${result.fileId}`);
    console.log(`   Link: ${publicLink}`);

    return {
      fileId: result.fileId,
      webViewLink: result.webViewLink || publicLink,
      publicLink,
      size: fileBuffer.length,
      uploadedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('❌ Google Drive upload failed:', error);

    // Provide helpful error messages
    if (error?.message?.includes('Invalid Credentials')) {
      throw new Error('Google Drive credentials are invalid or expired');
    } else if (error?.message?.includes('permission')) {
      throw new Error('No permission to upload to Google Drive folder');
    } else if (error?.message?.includes('timeout')) {
      throw new Error('Google Drive upload timed out - try smaller file');
    }

    throw new Error(`Google Drive upload failed: ${error?.message}`);
  }
}

/**
 * Batch cleanup old files (optional maintenance)
 */
export async function cleanupOldFiles(
  ageHours: number = 24 * 30
): Promise<number> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    console.warn('GOOGLE_DRIVE_FOLDER_ID not configured');
    return 0;
  }

  try {
    const cutoffTime = new Date(Date.now() - ageHours * 60 * 60 * 1000);

    const response = await drive.files.list({
      q: `'${folderId}' in parents and createdTime < '${cutoffTime.toISOString()}' and trashed = false`,
      spaces: 'drive',
      pageSize: 100,
      fields: 'files(id, name, createdTime)',
      supportsAllDrives: true,
    } as any);

    const files = response.data.files || [];
    let deleted = 0;

    for (const file of files) {
      try {
        await drive.files.delete({
          fileId: file.id || '',
          supportsAllDrives: true,
        } as any);
        deleted++;
      } catch (err) {
        console.warn(`⚠️ Could not delete ${file.name}:`, err);
      }
    }

    console.log(`🧹 Cleanup completed: deleted ${deleted} old files`);
    return deleted;
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    return 0;
  }
}

/**
 * ==========================================
 * USER OAUTH TOKEN FUNCTIONS (Phase 2)
 * For uploading files to user's own Google Drive
 * ==========================================
 */

/**
 * Initialize Google Drive API with user's OAuth token
 * @param accessToken - User's Google OAuth access token
 */
function getDriveWithUserAuth(accessToken: string) {
  return google.drive({
    version: 'v3',
    auth: {
      credentials: {
        access_token: accessToken,
      },
    } as any,
  });
}

/**
 * Get or create folder structure in user's Google Drive
 * Structure: SmartSlip / [userId] / Receipts / [Year] / [Month]
 * 
 * @param accessToken - User's Google OAuth access token
 * @param userId - User ID from database
 * @param userName - Optional: User name for display
 * @returns Folder ID for current month's receipts
 */
export async function getUserMonthFolder(
  userId: string,
  accessToken: string,
  userName?: string
): Promise<string> {
  try {
    const userDrive = getDriveWithUserAuth(accessToken);
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    console.log(`📂 Creating/Finding folder structure for user: ${userId}`);

    // Step 1: Find or create root "SmartSlip" folder
    let smartslipFolderId = await findOrCreateFolder(
      userDrive,
      'SmartSlip',
      'root'
    );
    console.log(`✓ SmartSlip folder: ${smartslipFolderId}`);

    // Step 2: Find or create user folder
    const userFolderName = userName || userId;
    let userFolderId = await findOrCreateFolder(
      userDrive,
      userFolderName,
      smartslipFolderId
    );
    console.log(`✓ User folder (${userFolderName}): ${userFolderId}`);

    // Step 3: Find or create "Receipts" folder
    let receiptsFolderId = await findOrCreateFolder(
      userDrive,
      'Receipts',
      userFolderId
    );
    console.log(`✓ Receipts folder: ${receiptsFolderId}`);

    // Step 4: Find or create year folder
    let yearFolderId = await findOrCreateFolder(
      userDrive,
      year,
      receiptsFolderId
    );
    console.log(`✓ Year folder (${year}): ${yearFolderId}`);

    // Step 5: Find or create month folder
    const monthName = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleString(
      'en-US',
      { month: 'long', year: 'numeric' }
    );
    let monthFolderId = await findOrCreateFolder(
      userDrive,
      `${month}-${monthName}`,
      yearFolderId
    );
    console.log(`✓ Month folder (${month}-${monthName}): ${monthFolderId}`);

    return monthFolderId;
  } catch (error) {
    console.error('❌ Failed to get/create month folder:', error);
    throw new Error(`Failed to get/create Google Drive folder: ${error}`);
  }
}

/**
 * Helper: Find existing folder or create new one
 * @param drive - Google Drive API instance
 * @param folderName - Name of folder to find/create
 * @param parentId - Parent folder ID (or 'root')
 */
async function findOrCreateFolder(
  drive: any,
  folderName: string,
  parentId: string = 'root'
): Promise<string> {
  try {
    // Search for existing folder
    const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    const response = await drive.files.list({
      q: query,
      spaces: 'drive',
      pageSize: 1,
      fields: 'files(id)',
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }

    // Folder doesn't exist, create it
    console.log(`  Creating folder: "${folderName}"`);
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });

    return createResponse.data.id;
  } catch (error) {
    console.error(`❌ Error with folder "${folderName}":`, error);
    throw error;
  }
}

/**
 * Upload file to user's Google Drive (in their monthly receipts folder)
 * @param fileBuffer - File buffer to upload
 * @param fileName - Name of file
 * @param accessToken - User's Google OAuth access token
 * @param userId - User ID
 * @param mimeType - File MIME type
 */
export async function uploadToUserGoogleDrive(
  fileBuffer: Buffer,
  fileName: string,
  accessToken: string,
  userId: string,
  mimeType: string = 'image/jpeg'
): Promise<GoogleDriveUploadResult> {
  console.log(`📤 Uploading to user's Google Drive: ${fileName}`);

  try {
    const userDrive = getDriveWithUserAuth(accessToken);

    // Get the month folder
    const monthFolderId = await getUserMonthFolder(userId, accessToken);

    // Upload file to month folder
    const response = await userDrive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        parents: [monthFolderId],
      },
      media: {
        mimeType,
        body: require('stream').Readable.from([fileBuffer]),
      },
      fields: 'id, webViewLink, webContentLink',
    });

    const fileId = response.data.id;
    if (!fileId) {
      throw new Error('Failed to get file ID from Google Drive');
    }

    const publicLink = `https://drive.google.com/uc?id=${fileId}&export=view`;

    console.log('✅ File uploaded to user drive successfully');
    console.log(`   File ID: ${fileId}`);
    console.log(`   Link: ${publicLink}`);

    return {
      fileId,
      webViewLink: response.data.webViewLink || publicLink,
      publicLink,
      size: fileBuffer.length,
      uploadedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('❌ User drive upload failed:', error);
    throw new Error(`Failed to upload to user Google Drive: ${error?.message}`);
  }
}

/**
 * ==========================================
 * SERVICE ACCOUNT FUNCTIONS (Phase 3)
 * For creating folder structure automatically
 * without requiring user authorization
 * ==========================================
 */

/**
 * Create folder structure using Service Account
 * Structure: SmartSlip / [userId] / Receipts / [Year] / [Month]
 * 
 * @param userId - User ID from database
 * @param userName - Optional: User name for display
 * @returns Folder ID for current month's receipts
 */
export async function createFolderStructureWithServiceAccount(
  userId: string,
  userName?: string
): Promise<string> {
  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    console.log(`📂 [SERVICE ACCOUNT] Creating folder structure for user: ${userId}`);

    // Step 1: Find or create root "SmartSlip" folder using Service Account
    let smartslipFolderId = await findOrCreateFolderWithServiceAccount(
      'SmartSlip',
      'root'
    );
    console.log(`✓ [SERVICE ACCOUNT] SmartSlip folder: ${smartslipFolderId}`);

    // Step 2: Find or create user folder
    const userFolderName = userName || userId;
    let userFolderId = await findOrCreateFolderWithServiceAccount(
      userFolderName,
      smartslipFolderId
    );
    console.log(`✓ [SERVICE ACCOUNT] User folder (${userFolderName}): ${userFolderId}`);

    // Step 3: Find or create "Receipts" folder
    let receiptsFolderId = await findOrCreateFolderWithServiceAccount(
      'Receipts',
      userFolderId
    );
    console.log(`✓ [SERVICE ACCOUNT] Receipts folder: ${receiptsFolderId}`);

    // Step 4: Find or create year folder
    let yearFolderId = await findOrCreateFolderWithServiceAccount(
      year,
      receiptsFolderId
    );
    console.log(`✓ [SERVICE ACCOUNT] Year folder (${year}): ${yearFolderId}`);

    // Step 5: Find or create month folder
    const monthName = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleString(
      'en-US',
      { month: 'long', year: 'numeric' }
    );
    let monthFolderId = await findOrCreateFolderWithServiceAccount(
      `${month}-${monthName}`,
      yearFolderId
    );
    console.log(`✓ [SERVICE ACCOUNT] Month folder (${month}-${monthName}): ${monthFolderId}`);

    return monthFolderId;
  } catch (error) {
    console.error('❌ [SERVICE ACCOUNT] Failed to create folder structure:', error);
    throw new Error(`Failed to create folder structure with Service Account: ${error}`);
  }
}

/**
 * Helper: Find existing folder or create new one using Service Account
 * @param folderName - Name of folder to find/create
 * @param parentId - Parent folder ID (or 'root')
 */
async function findOrCreateFolderWithServiceAccount(
  folderName: string,
  parentId: string = 'root'
): Promise<string> {
  try {
    // Search for existing folder
    const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    const response = await drive.files.list({
      q: query,
      spaces: 'drive',
      pageSize: 1,
      fields: 'files(id)',
      supportsAllDrives: true,
    } as any);

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id || '';
    }

    // Folder doesn't exist, create it
    console.log(`  [SERVICE ACCOUNT] Creating folder: "${folderName}"`);
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
      supportsAllDrives: true,
    } as any);

    return createResponse.data.id || '';
  } catch (error) {
    console.error(`❌ [SERVICE ACCOUNT] Error with folder "${folderName}":`, error);
    throw error;
  }
}
