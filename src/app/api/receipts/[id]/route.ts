import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import Receipt from '@/models/Receipt';
import { corsResponse, addCorsHeaders } from '@/lib/cors';

/**
 * GET /api/receipts/[id]
 * Fetch a single receipt by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();

    const { id } = await params;

    // Validate MongoDB ObjectId
    if (!Types.ObjectId.isValid(id)) {
      return corsResponse(
        { error: 'Invalid receipt ID format' },
        400
      );
    }

    // Find receipt by ID
    const receipt = await Receipt.findById(id);

    if (!receipt) {
      return corsResponse(
        { error: 'Receipt not found' },
        404
      );
    }

    return corsResponse(
      {
        success: true,
        data: receipt,
      },
      200
    );
  } catch (error: any) {
    console.error('Error fetching receipt:', error);
    return corsResponse(
      { error: 'Failed to fetch receipt' },
      500
    );
  }
}

/**
 * PUT /api/receipts/[id]
 * Update receipt by ID and change status
 * 
 * Expected request body:
 * {
 *   status?: 'pending' | 'reviewing' | 'approved' | 'rejected' | 'completed' | 'failed'
 *   customerName?: string
 *   customerEmail?: string
 *   paymentMethod?: string
 *   receiptNumber?: string
 *   notes?: string
 *   items?: Array
 *   [any other fields]
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();

    const { id } = await params;

    // Validate MongoDB ObjectId
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid receipt ID format' },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();

    // Extract fields that can be updated
    const updateData: any = {};
    const allowedFields = [
      'status',
      'customerName',
      'customerEmail',
      'paymentMethod',
      'receiptNumber',
      'notes',
      'items',
      'storeName',
      'amount',
      'currency',
      'imageURL',
      'issueDate',
      'dueDate',
    ];

    // Only allow updating approved fields
    allowedFields.forEach((field) => {
      if (field in body) {
        updateData[field] = body[field];
      }
    });

    // Validate status if provided
    if (updateData.status) {
      const validStatuses = ['pending', 'reviewing', 'approved', 'rejected', 'completed', 'failed'];
      if (!validStatuses.includes(updateData.status)) {
        return NextResponse.json(
          {
            error: 'Invalid status value',
            validStatuses,
          },
          { status: 400 }
        );
      }
    }

    // Check if receipt exists
    const existingReceipt = await Receipt.findById(id);
    if (!existingReceipt) {
      return NextResponse.json(
        { error: 'Receipt not found' },
        { status: 404 }
      );
    }

    // Update receipt
    const updatedReceipt = await Receipt.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true, // Return updated document
        runValidators: true, // Run schema validators
      }
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Receipt updated successfully',
        data: {
          id: updatedReceipt._id,
          transactionId: updatedReceipt.transactionId,
          receiptNumber: updatedReceipt.receiptNumber,
          status: updatedReceipt.status,
          amount: updatedReceipt.amount,
          storeName: updatedReceipt.storeName,
          updatedAt: updatedReceipt.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Error updating receipt:', error);

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
        { error: 'Duplicate value for unique field' },
        { status: 400 }
      );
    }

    // Generic error response
    return NextResponse.json(
      { error: 'Failed to update receipt' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/receipts/[id]
 * Delete a receipt by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();

    const { id } = await params;

    // Validate MongoDB ObjectId
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid receipt ID format' },
        { status: 400 }
      );
    }

    // Delete receipt
    const deletedReceipt = await Receipt.findByIdAndDelete(id);

    if (!deletedReceipt) {
      return NextResponse.json(
        { error: 'Receipt not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Receipt deleted successfully',
        data: {
          id: deletedReceipt._id,
          transactionId: deletedReceipt.transactionId,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Error deleting receipt:', error);
    return NextResponse.json(
      { error: 'Failed to delete receipt' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/receipts/[id]
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
