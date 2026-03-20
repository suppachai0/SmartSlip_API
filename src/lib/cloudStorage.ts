import { Storage } from '@google-cloud/storage';

const storage = new Storage({
  projectId: process.env.GOOGLE_PROJECT_ID,
  credentials: {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_url: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  } as any,
});

const bucketName = process.env.GOOGLE_CLOUD_STORAGE_BUCKET_NAME || 'smartslip-receipts-bucket';

export interface CloudStorageUploadResult {
  publicUrl: string;
  fileName: string;
  size: number;
  uploadedAt: string;
}

/**
 * Upload buffer to Google Cloud Storage
 */
export async function uploadToCloudStorage(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string = 'image/jpeg'
): Promise<CloudStorageUploadResult> {
  try {
    console.log(`📤 Uploading to Cloud Storage: ${fileName} (${fileBuffer.length} bytes)`);

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);

    // Upload file
    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000', // 1 year
      },
    });

    // Generate public URL (no need to makePublic when uniform bucket-level access is enabled)
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;

    console.log('✅ File uploaded to Cloud Storage');
    console.log(`   URL: ${publicUrl}`);

    return {
      publicUrl,
      fileName,
      size: fileBuffer.length,
      uploadedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('❌ Cloud Storage upload failed:', error);
    throw new Error(`Cloud Storage upload failed: ${error?.message}`);
  }
}

/**
 * Optional: List files in bucket
 */
export async function listFilesInBucket() {
  try {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles();

    return files.map((file) => ({
      name: file.name,
      size: file.metadata?.size,
      updated: file.metadata?.updated,
    }));
  } catch (error) {
    console.error('❌ Error listing files:', error);
    throw error;
  }
}
