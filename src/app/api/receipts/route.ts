import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';

/**
 * POST /api/receipts
 * Create a new receipt from n8n or external service
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
 */
export async function POST(request: NextRequest) {
  try {
    // Step 1: Connect to database
    await connectToDatabase();

    // Step 2: Parse request body
    const body = await request.json();
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

    // Step 3: Validate required fields
    if (!storeName) {
      return NextResponse.json(
        { error: 'storeName is required' },
        { status: 400 }
      );
    }

    if (!totalAmount && totalAmount !== 0) {
      return NextResponse.json(
        { error: 'totalAmount is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Step 4: Generate transaction ID and receipt number
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const receiptNumber = `RCP-${Date.now()}`;

    // Step 5: Create receipt object
    const receiptData = {
      transactionId,
      receiptNumber,
      storeName,
      amount: totalAmount,
      currency: 'USD',
      status: 'pending', // Default status
      userId,
      imageURL,
      customerName,
      customerEmail,
      items,
      notes,
      issueDate: new Date(),
    };

    // Step 6: Save to MongoDB
    const receipt = await Receipt.create(receiptData);

    // Step 7: Return success response
    return NextResponse.json(
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
 * Fetch all receipts or filter by userId (if provided)
 * 
 * Query params:
 * ?userId=string (optional)
 * ?status=pending|reviewing|completed|failed (optional)
 */
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');

    // Build query filter
    const filter: any = {};
    if (userId) filter.userId = userId;
    if (status) filter.status = status;

    // Fetch receipts
    const receipts = await Receipt.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);

    return NextResponse.json(
      {
        success: true,
        data: receipts,
        count: receipts.length,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Error fetching receipts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch receipts' },
      { status: 500 }
    );
  }
}
