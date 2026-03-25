import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { validateApiKey, unauthorizedResponse } from '@/lib/auth';
import { checkRateLimit, rateLimitExceededResponse, addRateLimitHeaders } from '@/lib/rateLimit';
import { appendReceiptToSheet } from '@/lib/googleSheets';

/**
 * POST /api/receipts
 * Create a new receipt from n8n or external service
 * 
 * SECURITY: Requires API key (add VALID_API_KEYS env var with comma-separated keys)
 * RATE LIMIT: Configurable via RATE_LIMIT_REQUESTS and RATE_LIMIT_WINDOW_MS
 * 
 * Expected request body:
 * {
 *   storeName: string (required)
 *   totalAmount: number (required)
 *   userId: string (required)
 *   items?: Array (optional)
 *   imageURL?: string (optional)
 *   customerName?: string (optional)
 *   customerEmail?: string (optional)
 *   notes?: string (optional)
 * }
 * 
 * Headers:
 * - x-api-key: Your API key (or use ?api_key=key in query string)
 */
export async function POST(request: NextRequest) {
  try {
    // Step 1: Validate API Key
    if (!validateApiKey(request)) {
      return unauthorizedResponse('Missing or invalid API key');
    }

    // Step 2: Check Rate Limit
    const rateLimitResult = checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return rateLimitExceededResponse(rateLimitResult.resetTime);
    }

    // Step 3: Connect to database
    await connectToDatabase();

    // Step 4: Parse request body with error handling
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const {
      storeName,
      totalAmount,
      userId,
      items = [],
      imageURL,
      customerName,
      customerEmail,
      notes,
    } = body;

    // Step 5: Validate required fields
    if (!storeName || typeof storeName !== 'string' || storeName.trim() === '') {
      return NextResponse.json(
        { error: 'storeName is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    if (totalAmount === undefined || totalAmount === null) {
      return NextResponse.json(
        { error: 'totalAmount is required' },
        { status: 400 }
      );
    }

    if (typeof totalAmount !== 'number' || totalAmount < 0) {
      return NextResponse.json(
        { error: 'totalAmount must be a non-negative number' },
        { status: 400 }
      );
    }

    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return NextResponse.json(
        { error: 'userId is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Step 6: Generate transaction ID and receipt number
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const receiptNumber = `RCP-${Date.now()}`;

    // Step 7: Create receipt object
    const receiptData = {
      transactionId,
      receiptNumber,
      storeName: storeName.trim(),
      amount: totalAmount,
      currency: 'THB',
      status: 'pending',
      userId: userId.trim(),
      imageURL,
      customerName,
      customerEmail,
      items: Array.isArray(items) ? items : [],
      notes,
      issueDate: new Date(),
    };

    // Step 8: Save to MongoDB
    const receipt = await Receipt.create(receiptData);

    // Step 8.1: Append to Google Sheets (best-effort)
    try {
      await appendReceiptToSheet({
        receiptId: receipt._id.toString(),
        userId: receipt.userId,
        storeName: receipt.storeName,
        amount: receipt.amount,
        issueDate: receipt.issueDate,
        items: receipt.items,
        imageURL: receipt.imageURL,
        status: receipt.status,
        confidence: 'manual',
        timestamp: receipt.createdAt,
      });
    } catch (sheetError) {
      console.error('⚠️ Failed to append receipt to Google Sheets:', sheetError);
    }

    // Step 9: Return success response
    let response = NextResponse.json(
      {
        success: true,
        message: 'Receipt created successfully',
        data: {
          id: receipt._id,
          transactionId: receipt.transactionId,
          receiptNumber: receipt.receiptNumber,
          status: receipt.status,
          amount: receipt.amount,
          storeName: receipt.storeName,
          createdAt: receipt.createdAt,
        },
      },
      { status: 201 }
    );

    // Add rate limit headers
    response = addRateLimitHeaders(
      response,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    );

    return response;
  } catch (error: any) {
    console.error('Error creating receipt:', error);

    // Handle MongoDB connection errors
    if (error.name === 'MongooseError') {
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500 }
      );
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid data provided', details: error.message },
        { status: 400 }
      );
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return NextResponse.json(
        { error: 'Duplicate transaction or receipt number' },
        { status: 400 }
      );
    }

    // Generic error response
    return NextResponse.json(
      { error: 'An error occurred while creating receipt' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/receipts
 * Fetch all receipts or filter by userId
 * 
 * SECURITY: Requires API key
 * RATE LIMIT: Configurable via environment variables
 * 
 * Query params:
 * - userId: Filter by user (optional)
 * - status: Filter by status (optional)
 * - api_key: API key (alternative to header)
 * 
 * Headers:
 * - x-api-key: Your API key
 */
export async function GET(request: NextRequest) {
  try {
    // Step 1: Validate API Key
    if (!validateApiKey(request)) {
      return unauthorizedResponse('Missing or invalid API key');
    }

    // Step 2: Check Rate Limit
    const rateLimitResult = checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return rateLimitExceededResponse(rateLimitResult.resetTime);
    }

    // Step 3: Connect to database
    await connectToDatabase();

    // Step 4: Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');

    // Step 5: Build query filter
    const filter: any = {};
    if (userId) filter.userId = userId;
    if (status) filter.status = status;

    // Step 6: Fetch receipts
    const receipts = await Receipt.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);

    // Step 7: Return response with rate limit headers
    let response = NextResponse.json(
      {
        success: true,
        data: receipts,
        count: receipts.length,
      },
      { status: 200 }
    );

    response = addRateLimitHeaders(
      response,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    );

    return response;
  } catch (error: any) {
    console.error('Error fetching receipts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch receipts' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/receipts
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
