import { NextRequest, NextResponse } from 'next/server';

/**
 * Rate limiter using in-memory store
 * For production with multiple instances, use Redis instead
 * 
 * Configuration via environment variables:
 * - RATE_LIMIT_REQUESTS: Number of requests allowed (default: 100)
 * - RATE_LIMIT_WINDOW_MS: Time window in milliseconds (default: 60000 = 1 minute)
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting (will reset on server restart)
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Get client IP address from request
 */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const direct = request.headers.get('x-real-ip');
  return (forwarded?.split(',')[0] || direct || request.ip || 'unknown').trim();
}

/**
 * Check if request exceeds rate limit
 */
export function checkRateLimit(request: NextRequest): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
} {
  const clientIp = getClientIp(request);
  const maxRequests = parseInt(process.env.RATE_LIMIT_REQUESTS || '100', 10);
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

  const now = Date.now();
  const entry = rateLimitStore.get(clientIp);

  // Create new entry if client hasn't made requests yet
  if (!entry) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs,
    };
  }

  // Reset counter if window has passed
  if (now >= entry.resetTime) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs,
    };
  }

  // Check if limit exceeded
  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  // Increment counter
  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

/**
 * Return rate limit exceeded response
 */
export function rateLimitExceededResponse(
  resetTime: number
): NextResponse {
  const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      retryAfter: retryAfter > 0 ? retryAfter : 60,
      resetTime: new Date(resetTime).toISOString(),
    },
    {
      status: 429,
      headers: {
        'Retry-After': (retryAfter > 0 ? retryAfter : 60).toString(),
        'X-RateLimit-Reset': new Date(resetTime).toISOString(),
      },
    }
  );
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders<T>(
  response: NextResponse<T>,
  remaining: number,
  resetTime: number
): NextResponse<T> {
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', new Date(resetTime).toISOString());
  return response;
}

/**
 * Clean up expired rate limit entries (call periodically)
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now >= entry.resetTime) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Rate limit store cleanup: removed ${cleaned} expired entries`);
  }
}

// Clean up rate limit store every 5 minutes
if (typeof global !== 'undefined' && !(global as any).rateLimitCleanupInterval) {
  (global as any).rateLimitCleanupInterval = setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}
