import { NextRequest, NextResponse } from 'next/server';

/**
 * LINE OAuth2 Callback Route
 * LINE redirects here after user authorizes the app
 * 
 * Expected query params:
 * - code: authorization code to exchange for tokens
 * - state: opaque state value (optional, used to prevent CSRF)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Handle LINE OAuth error
    if (error) {
      console.error('LINE OAuth error:', error, errorDescription);
      return NextResponse.json(
        {
          success: false,
          error,
          error_description: errorDescription,
        },
        { status: 400 }
      );
    }

    // Validate authorization code
    if (!code) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization code' },
        { status: 400 }
      );
    }

    // Get backend base URL (for local dev, it's usually the same as frontend)
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const redirectUri = `${process.env.LINE_LOGIN_REDIRECT_URI || 'http://localhost:3000/api/auth/callback/line'}`;

    // Exchange authorization code for tokens via backend
    const tokenResponse = await fetch(`${backendUrl}/api/auth/line`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Token exchange failed:', errorData);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to exchange authorization code',
          details: errorData,
        },
        { status: 400 }
      );
    }

    const result = await tokenResponse.json();

    // Success! Return user data and session token
    // Frontend can use this to:
    // 1. Store sessionToken in localStorage/cookies
    // 2. Redirect to dashboard
    // 3. Set up API authentication headers
    return NextResponse.json({
      success: true,
      data: result.data,
      sessionToken: result.data?.sessionToken,
      user: result.data?.user,
      line: result.data?.line,
    });
  } catch (error: any) {
    console.error('LINE callback error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error?.message,
      },
      { status: 500 }
    );
  }
}

/**
 * POST method for callback (alternative approach)
 * Some OAuth implementations use POST instead of GET
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, redirectUri } = body;

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization code' },
        { status: 400 }
      );
    }

    // Get backend base URL
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

    // Exchange authorization code for tokens via backend
    const tokenResponse = await fetch(`${backendUrl}/api/auth/line`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Token exchange failed:', errorData);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to exchange authorization code',
          details: errorData,
        },
        { status: 400 }
      );
    }

    const result = await tokenResponse.json();

    return NextResponse.json({
      success: true,
      data: result.data,
      sessionToken: result.data?.sessionToken,
      user: result.data?.user,
      line: result.data?.line,
    });
  } catch (error: any) {
    console.error('LINE callback error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error?.message,
      },
      { status: 500 }
    );
  }
}
