import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  lineUserId: string;
  displayName?: string;
  pictureUrl?: string;
  email?: string;
  statusMessage?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  
  // Google OAuth
  googleId?: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleTokenExpiry?: Date;
  googleSheetId?: string; // User's personal Google Sheet

  // Pending receipts waiting for category selection (supports multiple images sent at once)
  pendingReceipts?: Array<{ url: string; receivedAt: Date }>;

  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    lineUserId: { type: String, required: true, unique: true, index: true },
    displayName: String,
    pictureUrl: String,
    email: String,
    statusMessage: String,
    accessToken: String,
    refreshToken: String,
    accessTokenExpiresAt: Date,
    
    // Google OAuth fields
    googleId: { type: String, sparse: true, unique: true },
    googleAccessToken: String,
    googleRefreshToken: String,
    googleTokenExpiry: Date,
    googleSheetId: String,

    pendingReceipts: [
      {
        url: String,
        receivedAt: Date,
      },
    ],

    lastLoginAt: Date,
  },
  {
    timestamps: true,
  }
);

export default (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>('User', userSchema);
