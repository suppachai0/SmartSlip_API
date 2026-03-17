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
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID not configured');
  }

  console.log(`📤 Uploading to Google Drive: ${fileName} (${fileBuffer.length} bytes)`);

  // Check file size (Google Drive limit is 5TB per file, but consider API timeout)
  if (fileBuffer.length > 100 * 1024 * 1024) {
    throw new Error('File too large (>100MB). Consider splitting or compressing.');
  }

  try {
    const result = await retryOnSpecificErrors(
      async () => {
        // Create file metadata
        const fileMetadata = {
          name: fileName,
          parents: [folderId],
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
