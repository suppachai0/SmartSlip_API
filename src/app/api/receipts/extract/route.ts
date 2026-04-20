import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { extractSlipDataWithGeminiFallback } from '@/lib/geminiExtraction';
import { uploadToCloudStorage } from '@/lib/cloudStorage';
import { uploadToGoogleDriveWithRetry } from '@/lib/googleDrive';
import { appendReceiptToSheet } from '@/lib/googleSheets';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

/**
 * POST /api/receipts/extract
 * Upload an image and extract receipt data using Gemini AI
 * 
 * Request: multipart/form-data
 * - image: File (required) - receipt image file
 * - userId: string (required) - user identifier
 * 
 * Response:
 * {
 *   success: boolean
 *   message: string
 *   data: {
 *     id: string (MongoDB ID)
 *     amount: number
 *     sender: string
 *     receiver: string
 *     date: string
 *     items: Array
 *     confidence: 'high' | 'medium' | 'low'
 *     imageURL: string
 *     createdAt: timestamp
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    console.log('๐”” [EXTRACT API] Upload receipt extraction request received');

    // Step 1: Parse multipart form data
    let formData;
    try {
      formData = await request.formData();
    } catch (error) {
      console.error('โ Failed to parse form data:', error);
      return corsResponse(
        { error: 'Invalid form data. Please send multipart/form-data with image and userId.' },
        400,
        request
      );
    }

    const imageFile = formData.get('image') as File | null;
    const userId = formData.get('userId') as string | null;

    // Step 2: Validate required fields
    if (!imageFile) {
      return corsResponse(
        { error: 'Missing required field: image' },
        400,
        request
      );
    }

    if (!userId) {
      return corsResponse(
        { error: 'Missing required field: userId' },
        400,
        request
      );
    }

    // Step 3: Validate file type
    if (!imageFile.type.startsWith('image/')) {
      return corsResponse(
        { error: 'File must be an image (JPEG, PNG, WebP, etc.)' },
        400,
        request
      );
    }

    // Step 4: Validate file size (max 20MB)
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (imageFile.size > MAX_FILE_SIZE) {
      return corsResponse(
        { error: `File size must be less than 20MB. Current: ${(imageFile.size / 1024 / 1024).toFixed(2)}MB` },
        400,
        request
      );
    }

    console.log(`๐“ฅ [EXTRACT API] File received: ${imageFile.name} (${(imageFile.size / 1024).toFixed(2)}KB)`);

    // Step 5: Convert file to buffer
    const arrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Step 6: Connect to MongoDB
    await connectToDatabase();
    console.log('โ… [EXTRACT API] MongoDB connected');

    // Step 7: Extract data with Gemini
    console.log('๐ค– [EXTRACT API] Starting Gemini extraction...');
    const slipData = await extractSlipDataWithGeminiFallback(imageBuffer);
    console.log('โ… [EXTRACT API] Gemini extraction complete:', {
      amount: slipData.amount,
      sender: slipData.sender,
      receiver: slipData.receiver,
    });

    // Step 8: Check if extraction failed
    if (slipData.method === 'manual_required' && slipData.amount === 0) {
      console.warn('โ ๏ธ [EXTRACT API] Image could not be processed - returning limited response');
      return corsResponse(
        {
          success: false,
          message: 'Could not extract receipt data from image',
          data: {
            confidence: 'low',
            method: 'manual_required',
            recommendation: 'Please ensure the receipt is clear, well-lit, and not tilted',
          },
        },
        422,
        request
      );
    }

        // Step 9: Upload to storage (priority-based with Service Account)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `receipts/${userId}/receipt-${slipData.amount}-${timestamp}.jpg`;
    
    let driveFileId = null;
    let storageResult;

    // Step 9a: Upload to Google Drive (Service Account - PRIMARY)
    console.log('[EXTRACT API] Uploading to Google Drive using Service Account (PRIMARY)...');
    try {
      const driveResult = await uploadToGoogleDriveWithRetry(
        imageBuffer,
        `receipt-${slipData.amount}-${timestamp}.jpg`,
        imageFile.type
      );
      driveFileId = driveResult.fileId;
      console.log('[EXTRACT API] Google Drive upload successful:', driveFileId);
    } catch (driveError) {
      console.error('[EXTRACT API] Google Drive upload failed:', driveError);
      throw new Error(`Google Drive upload failed: ${(driveError as any)?.message}`);
    }

    // Step 9b: Upload to Cloud Storage (BACKUP)
    console.log('[EXTRACT API] Uploading to Cloud Storage as backup...');
    try {
      storageResult = await uploadToCloudStorage(imageBuffer, fileName, imageFile.type);
      console.log('[EXTRACT API] Cloud Storage backup upload complete:', storageResult.publicUrl);
    } catch (storageError) {
      console.warn('[EXTRACT API] Cloud Storage backup failed (continuing with Drive-only):', storageError);
      // Fall back to Drive-only if Cloud Storage fails
      storageResult = {
        publicUrl: `https://drive.google.com/file/d/${driveFileId}`,
        fileId: driveFileId,
      };
    }

    // Step 10: Save to MongoDB
    console.log('๐’พ [EXTRACT API] Saving to MongoDB...');
    const transactionId = `WEB-${userId}-${Date.now()}`;
    const receiptNumber = `RCP-${Date.now()}`;

    const newReceipt = await Receipt.create({
      transactionId,
      receiptNumber,
      storeName: slipData.receiver || 'Web Upload',
      amount: slipData.amount,
      currency: 'THB',
      status: slipData.confidence === 'high' ? 'approved' : 'pending',
      userId,
      imageURL: storageResult.publicUrl,
      driveFileId,
      customerName: slipData.sender,
      extractedAmount: slipData.amount,
      extractedSender: slipData.sender,
      extractedReceiver: slipData.receiver,
      issueDate: new Date(slipData.date),
      items: slipData.items || [],
      notes: `Extracted via ${slipData.method} (${slipData.confidence} confidence) | File: ${fileName}`,
    });

    const receiptId = newReceipt._id.toString();
    console.log('โ… [EXTRACT API] MongoDB save complete:', receiptId);

    try {
      await appendReceiptToSheet({
        receiptId,
        userId,
        storeName: newReceipt.storeName,
        amount: newReceipt.amount,
        issueDate: newReceipt.issueDate,
        items: slipData.items,
        imageURL: storageResult.publicUrl,
        status: newReceipt.status,
        confidence: slipData.confidence,
        timestamp: newReceipt.createdAt,
      });
    } catch (sheetError) {
      console.error('โ ๏ธ [EXTRACT API] Failed to append receipt to Google Sheets:', sheetError);
    }

    // Step 11: Return success response
    const response = corsResponse(
      {
        success: true,
        message: 'Receipt extracted and saved successfully',
        data: {
          id: receiptId,
          amount: slipData.amount,
          sender: slipData.sender,
          receiver: slipData.receiver,
          date: slipData.date,
          items: slipData.items,
          confidence: slipData.confidence,
          imageURL: storageResult.publicUrl,
          driveFileId,
          storeName: slipData.receiver,
          createdAt: newReceipt.createdAt,
        },
      },
      201,
      request
    );

    console.log('โ… [EXTRACT API] Returning 201 Created');
    return response;
  } catch (error: any) {
    console.error('โ [EXTRACT API] Error:', error);
    console.error('   Message:', error?.message);
    console.error('   Code:', error?.code);

    // Handle specific errors
    if (error.name === 'ValidationError') {
      return corsResponse(
        { error: 'Validation error: ' + error.message },
        400,
        request
      );
    }

    if (error.message?.includes('timeout')) {
      return corsResponse(
        { error: 'Request timeout. Image might be too complex. Please try a simpler receipt.' },
        504,
        request
      );
    }

    if (error.message?.includes('Cloud Storage')) {
      return corsResponse(
        { error: 'Failed to upload file to storage. Please try again.' },
        503,
        request
      );
    }

    if (error.message?.includes('Gemini') || error.message?.includes('AI')) {
      return corsResponse(
        { error: 'AI processing failed. Please try again later.' },
        503,
        request
      );
    }

    // Generic error
    return corsResponse(
      {
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
        code: error?.code,
      },
      500,
      request
    );
  }
}

/**
 * OPTIONS /api/receipts/extract
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response, request);
}

/**
 * GET /api/receipts/extract
 * Health check endpoint
 */
export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      status: 'active',
      message: 'Receipt extraction API is running',
      endpoint: 'POST /api/receipts/extract',
      usage: {
        method: 'POST',
        contentType: 'multipart/form-data',
        fields: {
          image: 'File (required)',
          userId: 'string (required)',
        },
      },
    },
    { status: 200 }
  );
}
