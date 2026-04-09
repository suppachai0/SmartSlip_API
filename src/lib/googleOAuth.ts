/**
 * Google OAuth Helper Functions
 * Handles token exchange and refresh
 */

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
}

/**
 * Exchange authorization code for access token
 * @param code - Authorization code from Google consent screen
 */
export async function exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || '',
    grant_type: 'authorization_code',
  });

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Token exchange error:', error);
      throw new Error(`Failed to exchange code for token: ${response.status}`);
    }

    const data = (await response.json()) as GoogleTokenResponse;
    return data;
  } catch (error) {
    console.error('Token exchange failed:', error);
    throw error;
  }
}

/**
 * Get Google user info from access token
 */
export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  } catch (error) {
    console.error('Failed to get user info:', error);
    throw error;
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Token refresh error:', error);
      throw new Error(`Failed to refresh token: ${response.status}`);
    }

    const data = (await response.json()) as GoogleTokenResponse;
    return data;
  } catch (error) {
    console.error('Token refresh failed:', error);
    throw error;
  }
}

/**
 * Generate Google OAuth consent screen URL
 */
export function getGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || '',
    response_type: 'code',
    scope: 'openid email profile https://www.googleapis.com/auth/drive',
    access_type: 'offline', // Request refresh token
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Check if token is expired and refresh if needed
 * @param tokenExpiry - Token expiry timestamp
 * @param accessToken - Current access token
 * @param refreshToken - Refresh token
 * @returns Updated access token (or original if not expired)
 */
export async function ensureValidToken(
  tokenExpiry: Date,
  accessToken: string,
  refreshToken?: string
): Promise<{ accessToken: string; newExpiry?: Date }> {
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // Refresh 5 minutes before expiry

  // Check if token is still valid
  if (tokenExpiry.getTime() - now.getTime() > bufferMs) {
    return { accessToken };
  }

  // Token expired, try to refresh
  if (!refreshToken) {
    throw new Error('Token expired and no refresh token available. User needs to re-authorize.');
  }

  try {
    console.log('🔄 Refreshing Google OAuth token...');
    const newToken = await refreshAccessToken(refreshToken);

    const newExpiry = new Date();
    newExpiry.setSeconds(newExpiry.getSeconds() + newToken.expires_in);

    console.log('✅ Token refreshed successfully');
    return {
      accessToken: newToken.access_token,
      newExpiry,
    };
  } catch (error) {
    console.error('❌ Failed to refresh token:', error);
    throw new Error('Failed to refresh Google OAuth token. User needs to re-authorize.');
  }
}
