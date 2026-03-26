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
        400,
        request
      );
    }

    // Find receipt by ID
    const receipt = await Receipt.findById(id);

    if (!receipt) {
      return corsResponse(
        { error: 'Receipt not found' },
        404,
        request
      );
    }

    return corsResponse(
      {
        success: true,
        data: receipt,
      },
      200,
      request
    );
  } catch (error: any) {
    console.error('Error fetching receipt:', error);
    return corsResponse(
      { error: 'Failed to fetch receipt' },
      500,
      request
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
      return corsResponse(
        { error: 'Invalid receipt ID format' },
        400,
        request
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
        return corsResponse(
          {
            error: 'Invalid status value',
            validStatuses,
          },
          400,
          request
        );
      }
    }

    // Check if receipt exists
    const existingReceipt = await Receipt.findById(id);
    if (!existingReceipt) {
      return corsResponse(
        { error: 'Receipt not found' },
        404,
        request
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

    return corsResponse(
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
      200,
      request
    );
  } catch (error: any) {
    console.error('Error updating receipt:', error);

    // Handle validation errors
    if (error.name === 'ValidationError') {
      return corsResponse(
        { error: 'Invalid data provided', details: error.message },
        400,
        request
      );
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return corsResponse(
        { error: 'Duplicate value for unique field' },
        400,
        request
      );
    }

    // Generic error response
    return corsResponse(
      { error: 'Failed to update receipt' },
      500,
      request
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
      return corsResponse(
        { error: 'Invalid receipt ID format' },
        400,
        request
      );
    }

    // Delete receipt
    const deletedReceipt = await Receipt.findByIdAndDelete(id);

    if (!deletedReceipt) {
      return corsResponse(
        { error: 'Receipt not found' },
        404,
        request
      );
    }

    return corsResponse(
      {
        success: true,
        message: 'Receipt deleted successfully',
        data: {
          id: deletedReceipt._id,
          transactionId: deletedReceipt.transactionId,
        },
      },
      200,
      request
    );
  } catch (error: any) {
    console.error('Error deleting receipt:', error);
    return corsResponse(
      { error: 'Failed to delete receipt' },
      500,
      request
    );
  }
}

/**
 * OPTIONS /api/receipts/[id]
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response, request);
}
