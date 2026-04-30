import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';

export async function PATCH(request: NextRequest) {
  try {
    const adminKey = request.headers.get('x-admin-key');
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { lineUserId, googleSheetId } = await request.json();
    if (!lineUserId || !googleSheetId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    await connectToDatabase();
    const result = await User.findOneAndUpdate(
      { lineUserId },
      { $set: { googleSheetId } },
      { upsert: false }
    );

    if (!result) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
