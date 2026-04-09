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
  googleDriveFolderId?: string; // SmartSlip/[userId]/Receipts folder
  
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
    googleDriveFolderId: String,
    
    lastLoginAt: Date,
  },
  {
    timestamps: true,
  }
);

export default (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>('User', userSchema);
