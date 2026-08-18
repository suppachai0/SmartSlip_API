import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Ephemeral fallback — tokens won't survive restarts. Set JWT_SECRET in env.
const JWT_SECRET = process.env.JWT_SECRET ?? (() => {
  console.error('🚨 CRITICAL: JWT_SECRET is not set. Using ephemeral secret — tokens invalidated on every cold start.');
  return crypto.randomBytes(32).toString('hex');
})();

/**
 * Validate API Key from request headers or query parameters
 * Supports multiple API keys separated by commas in environment variable
 */
export function validateApiKey(request: NextRequest): boolean {
  // Get API key from header or query parameter
  const headerKey = request.headers.get('x-api-key');
  const queryKey = request.nextUrl.searchParams.get('api_key');
  const providedKey = headerKey || queryKey;

  if (!providedKey) {
    return false;
  }

  // Get valid API keys from environment
  const validKeys = (process.env.VALID_API_KEYS || '').split(',').filter(key => key.trim());

  if (validKeys.length === 0) {
    console.error('🚨 CRITICAL: VALID_API_KEYS not configured. Denying API key request.');
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return validKeys.some(key => {
    const a = Buffer.from(key.trim());
    const b = Buffer.from(providedKey.trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/**
 * Generate unauthorized response
 */
export function unauthorizedResponse(
  message: string = 'Missing or invalid API key'
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      hint: 'Provide API key via "x-api-key" header or "api_key" query parameter',
    },
    { status: 401 }
  );
}

/**
 * Optional: Generate JWT token (for stateless authentication)
 * Requires JWT_SECRET to be set in environment
 */
export function generateJWT(payload: any, expiresIn: number = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64');

  return `${header}.${body}.${signature}`;
}

/**
 * Verify JWT token
 */
export function verifyJWT(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, body, signature] = parts;

    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64');

    if (signature !== expectedSignature) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(body, 'base64').toString());

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}
