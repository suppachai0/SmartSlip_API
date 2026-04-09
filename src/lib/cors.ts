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

  return '*'; // Default to allow
}

/**
 * Add CORS headers to a response
 * Use this in all API route handlers to ensure CORS headers are included
 * 
 * @param response - The NextResponse to add headers to
 * @param request - Optional NextRequest to extract origin from
 */
export function addCorsHeaders(response: NextResponse, request?: NextRequest): NextResponse {
  const requestOrigin = request?.headers.get('origin') || null;
  const corsOrigin = getAllowedOrigin(requestOrigin);
  
  if (corsOrigin) {
    response.headers.set('Access-Control-Allow-Origin', corsOrigin);
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, authorization');
  response.headers.set('Access-Control-Max-Age', '86400');
  
  return response;
}

/**
 * Create a response with CORS headers already included
 * 
 * @param data - The data to return
 * @param status - HTTP status code
 * @param request - Optional NextRequest to extract origin from
 */
export function corsResponse(
  data: any,
  status: number = 200,
  request?: NextRequest
): NextResponse {
  const response = NextResponse.json(data, { status });
  return addCorsHeaders(response, request);
}
