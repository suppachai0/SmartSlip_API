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
    lastLoginAt: Date,
  },
  {
    timestamps: true,
  }
);

export default (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>('User', userSchema);
