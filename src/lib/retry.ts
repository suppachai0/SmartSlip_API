/**
 * Retry utilities with exponential backoff
 * 
 * Used for:
 * - Google Drive uploads (timeout resilience)
 * - Gemini API calls (rate limiting)
 * - Network requests
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, error: any) => void;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  timeoutMs: 30000,
  onRetry: () => {},
};

/**
 * Calculate next retry delay with exponential backoff
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  multiplier: number
): number {
  const delay = Math.min(
    initialDelayMs * Math.pow(multiplier, attempt - 1),
    maxDelayMs
  );
  // Add jitter (random ±10%) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(delay + jitter));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Execute function with timeout
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Operation timeout after ${opts.timeoutMs}ms`)),
            opts.timeoutMs
          )
        ),
      ]);
    } catch (error) {
      lastError = error;
      console.error(`❌ Attempt ${attempt}/${opts.maxAttempts} failed:`, error);

      if (attempt < opts.maxAttempts) {
        const delayMs = calculateBackoffDelay(
          attempt,
          opts.initialDelayMs,
          opts.maxDelayMs,
          opts.backoffMultiplier
        );

        console.log(
          `⏳ Retrying in ${delayMs}ms... (attempt ${attempt + 1}/${opts.maxAttempts})`
        );

        opts.onRetry?.(attempt, error);

        await sleep(delayMs);
      }
    }
  }

  throw new Error(
    `Failed after ${opts.maxAttempts} attempts. Last error: ${lastError?.message || lastError}`
  );
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry specific error types
 * Useful for network errors, rate limits, etc.
 */
export async function retryOnSpecificErrors<T>(
  fn: () => Promise<T>,
  retryableErrors: (error: any) => boolean,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Operation timeout after ${opts.timeoutMs}ms`)),
            opts.timeoutMs
          )
        ),
      ]);
    } catch (error) {
      lastError = error;

      // Only retry if error matches criteria and we have attempts left
      if (!retryableErrors(error) || attempt === opts.maxAttempts) {
        throw error;
      }

      console.warn(
        `⚠️ Retryable error on attempt ${attempt}/${opts.maxAttempts}:`,
        error
      );

      const delayMs = calculateBackoffDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier
      );

      console.log(`⏳ Retrying in ${delayMs}ms...`);
      opts.onRetry?.(attempt, error);

      await sleep(delayMs);
    }
  }

  throw lastError;
}
