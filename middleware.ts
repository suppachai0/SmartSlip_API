import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // CORS Headers
  const headers = new Headers({
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, authorization',
    'Access-Control-Max-Age': '86400', // 24 hours
  });

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
