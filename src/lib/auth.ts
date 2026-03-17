import { NextRequest, NextResponse } from 'next/server';

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

  // If no valid keys configured, allow all requests (warning: not secure for production)
  if (validKeys.length === 0) {
    console.warn('⚠️ WARNING: VALID_API_KEYS not configured. All API requests allowed.');
    return true;
  }

  // Check if provided key matches any valid key
  return validKeys.some(key => key.trim() === providedKey.trim());
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
  // Note: This is a simple implementation. Consider using 'jsonwebtoken' package for production
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const timestamp = Math.floor(Date.now() / 1000);

  // Simple signature (In production, use proper JWT library)
  const secret = process.env.JWT_SECRET || 'default-secret';
  const crypto = require('crypto');
  const signature = crypto
    .createHmac('sha256', secret)
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

    // Verify signature
    const secret = process.env.JWT_SECRET || 'default-secret';
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
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
