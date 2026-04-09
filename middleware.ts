import { NextRequest, NextResponse } from 'next/server';

/**
 * Get the allowed CORS origin for a given request origin
 * Handles comma-separated list of allowed origins
 */
function getAllowedOrigin(requestOrigin: string | null): string | null {
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : ['*'];

  // Wildcard allows all
  if (allowedOrigins.includes('*')) {
    return '*';
  }

  // If no origin header, allow for same-origin requests
  if (!requestOrigin) {
    return '*';
  }

  // Check if request origin is in allowed list
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return '*'; // Default to allow in development
}

export function middleware(request: NextRequest) {
  const requestOrigin = request.headers.get('origin') || null;
  const allowedOrigin = getAllowedOrigin(requestOrigin);
  
  const headers = new Headers();
  
  // Only set CORS origin if it's allowed
  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
  }
  
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, authorization');
  headers.set('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle preflight requests (OPTIONS)
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { headers, status: 200 });
  }

  const response = NextResponse.next();
  
  // Add CORS headers to all responses
  headers.forEach((value, key) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
