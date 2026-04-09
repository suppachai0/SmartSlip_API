import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import { exchangeCodeForToken, getGoogleUserInfo } from '@/lib/googleOAuth';
import { corsResponse } from '@/lib/cors';

/**
 * GET /api/auth/google/callback
 * OAuth callback endpoint - receives authorization code from Google
 * Exchanges code for tokens and saves to database
 * 
 * Query params:
 * - code: Authorization code from Google
 * - state: State parameter (includes returnUrl for frontend redirect)
 * - error: Error code if user denied
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    // Handle user denied or error
    if (error) {
      return NextResponse.redirect(
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=${error}`
      );
    }

    // Validate code
    if (!code) {
      return corsResponse(
        { error: 'Missing authorization code' },
        400,
        request
      );
    }

    // Step 1: Exchange authorization code for access token
    console.log('Exchanging code for token...');
    const tokenData = await exchangeCodeForToken(code);

    // Step 2: Get user info using access token
    console.log('Fetching user info...');
    const userInfo = await getGoogleUserInfo(tokenData.access_token);

    // Step 3: Connect to database
    await connectToDatabase();

    // Step 4: Save or update user in database
    const expiryDate = new Date();
    expiryDate.setSeconds(expiryDate.getSeconds() + tokenData.expires_in);

    const user = await User.findOneAndUpdate(
      { googleId: userInfo.id },
      {
        googleId: userInfo.id,
        email: userInfo.email,
        displayName: userInfo.name,
        pictureUrl: userInfo.picture,
        googleAccessToken: tokenData.access_token,
        googleRefreshToken: tokenData.refresh_token || undefined,
        googleTokenExpiry: expiryDate,
        lastLoginAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log('User authenticated:', user._id);

    // Step 5: Create JWT or session token (optional, depends on your auth strategy)
    // For now, we'll just pass userId to frontend
    const userId = user._id.toString();

    // Step 6: Parse state parameter to get returnUrl
    let returnUrl = '/dashboard';
    if (state) {
      const parts = state.split(':');
      if (parts.length > 1) {
        returnUrl = decodeURIComponent(parts[1]);
      }
    }

    // Redirect to frontend with userId and token
    const redirectUrl = new URL(
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}${returnUrl}`
    );
    redirectUrl.searchParams.append('userId', userId);
    redirectUrl.searchParams.append('authToken', user._id.toString()); // Simple token (use JWT in production)

    return NextResponse.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    
    // Redirect to frontend with error message
    const errorUrl = new URL(
      process.env.FRONTEND_URL || 'http://localhost:3000'
    );
    errorUrl.searchParams.append(
      'error',
      error instanceof Error ? error.message : 'Authentication failed'
    );
    
    return NextResponse.redirect(errorUrl.toString());
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  const { addCorsHeaders } = await import('@/lib/cors');
  return addCorsHeaders(response, request);
}
