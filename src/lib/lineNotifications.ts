import * as line from '@line/bot-sdk';
import User from '@/models/User';

const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

export async function notifyUserByLine(userId: string, message: string): Promise<boolean> {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN is missing; skipping LINE notification.');
      return false;
    }

    const user = await User.findById(userId).select('lineUserId');
    const lineUserId = user?.lineUserId;

    if (!lineUserId) {
      console.warn(`⚠️ User ${userId} has no lineUserId; skipping LINE notification.`);
      return false;
    }

    await lineClient.pushMessage(lineUserId, {
      type: 'text',
      text: message,
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to send LINE notification:', error);
    return false;
  }
}

export async function notifyUserByLineUserId(lineUserId: string, message: string): Promise<boolean> {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN is missing; skipping LINE notification.');
      return false;
    }

    if (!lineUserId) {
      return false;
    }

    await lineClient.pushMessage(lineUserId, {
      type: 'text',
      text: message,
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to send LINE notification by lineUserId:', error);
    return false;
  }
}
