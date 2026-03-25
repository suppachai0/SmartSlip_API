import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { generateJWT } from '@/lib/auth';

const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

interface LineTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

interface LineVerifyResponse {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
  name?: string;
  picture?: string;
  email?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { code, redirectUri } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Missing "code" in request body' },
        { status: 400 }
      );
    }

    const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
    const defaultRedirectUri = process.env.LINE_LOGIN_REDIRECT_URI;

    if (!channelId || !channelSecret || !defaultRedirectUri) {
      return NextResponse.json(
        { error: 'LINE Login environment variables are not configured' },
        { status: 500 }
      );
    }

    const effectiveRedirectUri = redirectUri || defaultRedirectUri;

    // Exchange authorization code for access token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: effectiveRedirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    });

    const tokenResponse = await fetch(LINE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('LINE token exchange failed:', errorText);
      return NextResponse.json(
        { error: 'Failed to exchange authorization code', details: errorText },
        { status: 400 }
      );
    }

    const tokenData = (await tokenResponse.json()) as LineTokenResponse;

    // Verify ID token to get user profile
    const verifyParams = new URLSearchParams({
      id_token: tokenData.id_token,
      client_id: channelId,
    });

    const verifyResponse = await fetch(LINE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: verifyParams.toString(),
    });

    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      console.error('LINE ID token verification failed:', errorText);
      return NextResponse.json(
        { error: 'Failed to verify LINE ID token', details: errorText },
        { status: 400 }
      );
    }

    const profile = (await verifyResponse.json()) as LineVerifyResponse;

    // Connect to database and upsert user
    await connectToDatabase();

    const user = await User.findOneAndUpdate(
      { lineUserId: profile.sub },
      {
        lineUserId: profile.sub,
        displayName: profile.name,
        pictureUrl: profile.picture,
        email: profile.email,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        lastLoginAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const sessionPayload = {
      userId: user._id.toString(),
      lineUserId: user.lineUserId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const sessionToken = generateJWT(sessionPayload);

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user._id,
          lineUserId: user.lineUserId,
          displayName: user.displayName,
          pictureUrl: user.pictureUrl,
          email: user.email,
        },
        sessionToken,
        line: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresIn: tokenData.expires_in,
          scope: tokenData.scope,
        },
      },
    });
  } catch (error: any) {
    console.error('LINE Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'POST /api/auth/line with { code } to exchange LINE login code',
  });
}
