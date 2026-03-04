import mongoose, { Document, Schema } from 'mongoose';

export interface IReceipt extends Document {
  _id: mongoose.Types.ObjectId;
  transactionId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  paymentMethod: string;
  customerEmail: string;
  customerName: string;
  receiptNumber: string;
  issueDate: Date;
  dueDate?: Date;
  items?: {
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const receiptSchema = new Schema<IReceipt>(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: 'USD',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
      required: true,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
    },
    issueDate: {
      type: Date,
      default: Date.now,
    },
    dueDate: {
      type: Date,
    },
    items: [
      {
        description: String,
        quantity: Number,
        unitPrice: Number,
        totalPrice: Number,
      },
    ],
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Check if the model already exists to avoid recompiliation in development
const Receipt =
  mongoose.models.Receipt || mongoose.model<IReceipt>('Receipt', receiptSchema);

export default Receipt;
