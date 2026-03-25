import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { extractSlipDataWithGeminiFallback } from '@/lib/geminiExtraction';
import { uploadToCloudStorage } from '@/lib/cloudStorage';
import { appendReceiptToSheet } from '@/lib/googleSheets';

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
    console.log('🔔 [EXTRACT API] Upload receipt extraction request received');

    // Step 1: Parse multipart form data
    let formData;
    try {
      formData = await request.formData();
    } catch (error) {
      console.error('❌ Failed to parse form data:', error);
      return NextResponse.json(
        { error: 'Invalid form data. Please send multipart/form-data with image and userId.' },
        { status: 400 }
      );
    }

    const imageFile = formData.get('image') as File | null;
    const userId = formData.get('userId') as string | null;

    // Step 2: Validate required fields
    if (!imageFile) {
      return NextResponse.json(
        { error: 'Missing required field: image' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing required field: userId' },
        { status: 400 }
      );
    }

    // Step 3: Validate file type
    if (!imageFile.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image (JPEG, PNG, WebP, etc.)' },
        { status: 400 }
      );
    }

    // Step 4: Validate file size (max 20MB)
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (imageFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size must be less than 20MB. Current: ${(imageFile.size / 1024 / 1024).toFixed(2)}MB` },
        { status: 400 }
      );
    }

    console.log(`📥 [EXTRACT API] File received: ${imageFile.name} (${(imageFile.size / 1024).toFixed(2)}KB)`);

    // Step 5: Convert file to buffer
    const arrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Step 6: Connect to MongoDB
    await connectToDatabase();
    console.log('✅ [EXTRACT API] MongoDB connected');

    // Step 7: Extract data with Gemini
    console.log('🤖 [EXTRACT API] Starting Gemini extraction...');
    const slipData = await extractSlipDataWithGeminiFallback(imageBuffer);
    console.log('✅ [EXTRACT API] Gemini extraction complete:', {
      amount: slipData.amount,
      sender: slipData.sender,
      receiver: slipData.receiver,
    });

    // Step 8: Check if extraction failed
    if (slipData.method === 'manual_required' && slipData.amount === 0) {
      console.warn('⚠️ [EXTRACT API] Image could not be processed - returning limited response');
      return NextResponse.json(
        {
          success: false,
          message: 'Could not extract receipt data from image',
          data: {
            confidence: 'low',
            method: 'manual_required',
            recommendation: 'Please ensure the receipt is clear, well-lit, and not tilted',
          },
        },
        { status: 422 } // 422 Unprocessable Entity
      );
    }

    // Step 9: Upload to Cloud Storage
    console.log('☁️ [EXTRACT API] Uploading to Cloud Storage...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `receipts/${userId}/receipt-${slipData.amount}-${timestamp}.jpg`;
    const storageResult = await uploadToCloudStorage(imageBuffer, fileName, imageFile.type);
    console.log('✅ [EXTRACT API] Cloud Storage upload complete:', storageResult.publicUrl);

    // Step 10: Save to MongoDB
    console.log('💾 [EXTRACT API] Saving to MongoDB...');
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
      customerName: slipData.sender,
      extractedAmount: slipData.amount,
      extractedSender: slipData.sender,
      extractedReceiver: slipData.receiver,
      issueDate: new Date(slipData.date),
      items: slipData.items || [],
      notes: `Extracted via ${slipData.method} (${slipData.confidence} confidence) | File: ${fileName}`,
    });

    const receiptId = newReceipt._id.toString();
    console.log('✅ [EXTRACT API] MongoDB save complete:', receiptId);

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
      console.error('⚠️ [EXTRACT API] Failed to append receipt to Google Sheets:', sheetError);
    }

    // Step 11: Return success response
    const response = NextResponse.json(
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
          storeName: slipData.receiver,
          createdAt: newReceipt.createdAt,
        },
      },
      { status: 201 }
    );

    console.log('✅ [EXTRACT API] Returning 201 Created');
    return response;
  } catch (error: any) {
    console.error('❌ [EXTRACT API] Error:', error);
    console.error('   Message:', error?.message);
    console.error('   Code:', error?.code);

    // Handle specific errors
    if (error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Validation error: ' + error.message },
        { status: 400 }
      );
    }

    if (error.message?.includes('timeout')) {
      return NextResponse.json(
        { error: 'Request timeout. Image might be too complex. Please try a simpler receipt.' },
        { status: 504 }
      );
    }

    if (error.message?.includes('Cloud Storage')) {
      return NextResponse.json(
        { error: 'Failed to upload file to storage. Please try again.' },
        { status: 503 }
      );
    }

    if (error.message?.includes('Gemini') || error.message?.includes('AI')) {
      return NextResponse.json(
        { error: 'AI processing failed. Please try again later.' },
        { status: 503 }
      );
    }

    // Generic error
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
        code: error?.code,
      },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/receipts/extract
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key, authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
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
