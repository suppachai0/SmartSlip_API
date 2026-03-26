import { NextResponse } from 'next/server';

/**
 * Add CORS headers to a response
 * Use this in all API route handlers to ensure CORS headers are included
 */
export function addCorsHeaders(response: NextResponse): NextResponse {
  const corsOrigin = process.env.CORS_ORIGIN || '*';
  
  response.headers.set('Access-Control-Allow-Origin', corsOrigin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, authorization');
  response.headers.set('Access-Control-Max-Age', '86400');
  
  return response;
}

/**
 * Create a response with CORS headers already included
 */
export function corsResponse(
  data: any,
  status: number = 200
): NextResponse {
  const response = NextResponse.json(data, { status });
  return addCorsHeaders(response);
}
