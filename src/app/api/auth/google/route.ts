import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/googleOAuth';

/**
 * GET /api/auth/google
 * Redirects user to Google OAuth consent screen
 * 
 * @param request - NextRequest object
 */
export async function GET(request: NextRequest) {
  try {
    // Get state parameter from query string (for CSRF protection)
    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state') || '';
    const returnUrl = searchParams.get('returnUrl') || '';

    // Generate Google OAuth URL
    const authUrl = getGoogleAuthUrl();
    
    // Add state and returnUrl as query parameters
    const urlWithState = new URL(authUrl);
    if (state) {
      urlWithState.searchParams.append('state', `${state}:${encodeURIComponent(returnUrl)}`);
    }

    // Redirect to Google
    return NextResponse.redirect(urlWithState.toString());
  } catch (error) {
    console.error('Google OAuth redirect error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Google OAuth' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  const { addCorsHeaders } = await import('@/lib/cors');
  return addCorsHeaders(response, request);
}
