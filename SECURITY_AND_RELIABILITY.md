# SmartSlip API - Security & Reliability Improvements

**Last Updated:** March 17, 2026  
**Version:** 2.0 (Enhanced)

## Overview

This document outlines the security and reliability enhancements added to the SmartSlip API to address production issues:

1. ✅ **Authentication (API Key)** - Prevent unauthorized access
2. ✅ **Rate Limiting** - Protect against abuse
3. ✅ **Retry Logic (Google Drive)** - Handle timeouts gracefully
4. ✅ **Fallback Logic (Gemini)** - Extract data from unclear images

---

## 1. Authentication - API Key Validation

### 📋 Problem
Previously, anyone could call the API endpoints without authentication.

### ✅ Solution
Implemented API Key validation using the `validateApiKey()` utility in `/src/lib/auth.ts`.

### 🔧 How It Works

**Features:**
- API keys can be passed via:
  - `x-api-key` header (preferred)
  - `api_key` query parameter
- Multiple keys supported (comma-separated in `VALID_API_KEYS` env var)
- Works across all protected endpoints

**Protected Endpoints:**
```
POST   /api/receipts   - Create receipt (requires API key)
GET    /api/receipts   - List receipts (requires API key)
```

**LINE webhook** (`/api/line`) uses its own signature verification based on X-Line-Signature header, so it doesn't need API key.

### 📝 Configuration

In `.env.local`:
```env
# Add multiple keys separated by commas
VALID_API_KEYS=key1,key2,key3

# Each key should be a strong random string
# Generate with: openssl rand -hex 32
```

### 🧪 Testing

**Using cURL:**
```bash
# With header
curl -X POST http://localhost:3000/api/receipts \
  -H "x-api-key: super-secret-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"storeName":"Tom Yum","totalAmount":250,"userId":"user123"}'

# With query parameter
curl -X GET "http://localhost:3000/api/receipts?api_key=super-secret-api-key-12345&userId=user123"
```

**Response if API key is missing or invalid:**
```json
{
  "error": "Missing or invalid API key",
  "hint": "Provide API key via \"x-api-key\" header or \"api_key\" query parameter",
  "status": 401
}
```

### 🔐 Security Best Practices

1. **Generate Strong Keys:**
   ```bash
   # On Linux/Mac
   openssl rand -hex 32

   # On Windows PowerShell
   [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((1..32 | % {[byte]0..255 | Get-Random} | ForEach-Object {[char]$_} | Join-String)))
   ```

2. **Rotate keys periodically** (every 90 days recommended)

3. **Don't commit keys** to version control - use environment variables

4. **Track API usage** to detect suspicious patterns

---

## 2. Rate Limiting - Per-IP Request Limits

### 📋 Problem
No protection against:
- Brute force attacks
- Accidental overloads
- Malicious bots hammering the API

### ✅ Solution
Implemented in-memory rate limiter in `/src/lib/rateLimit.ts` that tracks requests per IP and rejects within time window.

### 🔧 How It Works

**Features:**
- Tracks requests per client IP address
- Sliding window time-based limits
- Automatic cleanup of expired entries
- Returns `429 Too Many Requests` when limit exceeded
- Includes `Retry-After` header with wait time

**Default Configuration:**
- 100 requests per 60 seconds per IP
- Configurable via environment variables

### 📝 Configuration

In `.env.local`:
```env
# Number of requests allowed
RATE_LIMIT_REQUESTS=100

# Time window in milliseconds (60000 = 1 minute)
RATE_LIMIT_WINDOW_MS=60000

# Examples for different strategies:
# Strict: 10 requests / 60 seconds
# Moderate: 100 requests / 60 seconds
# Relaxed: 1000 requests / 60 seconds
```

### 📊 Rate Limit Response

When limit is exceeded:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 45,
  "resetTime": "2026-03-17T10:45:32.123Z"
}
```

**Headers:**
```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2026-03-17T10:45:32.123Z
```

### 🧪 Testing

Generate multiple requests:
```bash
# Bash - Generate 150 requests
for i in {1..150}; do
  curl -X GET "http://localhost:3000/api/receipts?api_key=test" \
    -H "Content-Type: application/json" &
done
```

After 100 requests, subsequent requests will return 429.

### 🔍 Implementation Details

**In-Memory Store:**
- Each IP has: `{ count: number, resetTime: timestamp }`
- Global store: `Map<string, RateLimitEntry>`
- Expired entries cleaned up every 5 minutes (automatic)

**Proxy/Load Balancer:** If behind proxy, rate limiter reads:
```javascript
headers.get('x-forwarded-for')  // Primary
headers.get('x-real-ip')        // Fallback
request.ip                      // Last resort
```

### ⚠️ Important Notes

- **In-Memory Limitation:** Resets on server restart
- **For Production:** Consider moving to Redis for distributed rate limiting
- **Multiple Servers:** Each server maintains separate rate limit store

---

## 3. Google Drive Upload with Retry Logic

### 📋 Problem
Large image uploads could timeout without recovery:
- No retry on transient failures
- Failure = lost data without user knowing
- Users had no way to recover

### ✅ Solution
Implemented retry with exponential backoff in `/src/lib/googleDrive.ts`.

### 🔧 How It Works

**Features:**
- Automatic retry up to 3 times
- Exponential backoff: 1s → 2s → 4s (with jitter)
- Retries only on transient errors (timeout, rate limit, 5xx)
- Does NOT retry on authentication or permission errors
- 30-second timeout per attempt
- Automatic file permissions (public sharing)

**Retryable Errors:**
- Network timeouts
- 5xx Server errors
- Rate limit (429)
- Connection reset

**Non-Retryable Errors:**
- Invalid credentials
- Permission denied
- File too large
- Invalid parameters

### 🧩 Configuration

In `/src/lib/googleDrive.ts` (can be customized):
```typescript
{
  maxAttempts: 3,           // Number of retry attempts
  initialDelayMs: 2000,     // 2 seconds
  maxDelayMs: 15000,        // 15 seconds max
  backoffMultiplier: 2,     // Double wait time each attempt
  timeoutMs: 30000,         // 30 seconds per attempt
}
```

### 📝 Example Flow

```
Attempt 1: Upload image (20 seconds)
  ❌ Timeout → Wait 2 seconds

Attempt 2: Retry (22 seconds)
  ❌ Timeout → Wait 4 seconds

Attempt 3: Retry (26 seconds)
  ✅ Success → Return file ID
```

### 🧪 Testing Retry

Simulate timeout by using a very small file:
```javascript
// No automatic way to trigger timeout in dev
// In production, it happens naturally with large files or slow networks
```

### 📊 Logging Output

```
📤 Uploading to Google Drive: receipt-1500.50-2026-03-17T10-30-45-123Z.jpg (2.5MB)
📝 Creating file metadata...
⚠️ Google Drive upload retry 1: timeout after 30000ms
⏳ Retrying in 2000ms... (attempt 2/3)
⚠️ Google Drive upload retry 2: ECONNRESET
⏳ Retrying in 4000ms... (attempt 3/3)
✅ File uploaded successfully
   - File ID: 1abc2def3ghi4jkl5mno6pqr7stu8vwx
   - Link: https://drive.google.com/uc?id=1abc...&export=view
```

### 🔧 Implementation Code

```typescript
// Automatically retries transient failures
const driveResult = await uploadToGoogleDriveWithRetry(
  imageBuffer,
  fileName,
  'image/jpeg'
);
```

---

## 4. Gemini OCR with Fallback Logic

### 📋 Problem
Gemini extraction failed on unclear/blurry receipt images:
- Single extraction attempt
- No fallback if image quality poor
- User lost receipt without knowing why

### ✅ Solution
Implemented multi-strategy extraction in `/src/lib/geminiExtraction.ts` with confidence scoring and fallbacks.

### 🔧 How It Works

**3-Level Fallback Strategy:**

**Level 1: Standard Extraction (Most Accurate)**
- Full detailed prompt
- Expects clear images
- Returns high confidence scores

**Level 2: Aggressive Extraction (More Lenient)**
- Simplified prompt
- More forgiving of unclear text
- Returns medium confidence scores

**Level 3: Text-Only Extraction (Last Resort)**
- Just list all visible text
- Returns low confidence scores
- Indicates "Manual review required"

### 📋 Confidence Levels

```typescript
{
  confidence: 'high'    // ✅ All fields extracted, amount found
  confidence: 'medium'  // ⚠️ Some fields unclear/missing
  confidence: 'low'     // ❓ Image very unclear, needs review
}
```

### 🧪 Example Response

```json
{
  "amount": 1500.50,
  "sender": "John Smith",
  "receiver": "DMDM Restaurant",
  "date": "2026-03-17",
  "confidence": "high",
  "method": "gemini_standard"
}
```

### 📊 Confidence Scoring

Points are awarded for:
- Amount extraction (30 points)
- Sender name (20 points)
- Receiver name (20 points)
- Date extraction (15 points)
- Standard method bonus (5 points)

**Confidence Thresholds:**
- 75+ points → `high` ✅
- 40-74 points → `medium` ⚠️
- <40 points → `low` ❓

### 🔧 Retry Configuration

For each prompt attempt (built-in):
```typescript
{
  maxAttempts: 3,              // Retry 3 times per prompt
  initialDelayMs: 1000,        // 1 second initial wait
  timeoutMs: 20000,            // 20 second timeout
  backoffMultiplier: 2,
}
```

### 🧪 Testing Unclear Images

```javascript
// Simulate with:
// 1. Blurry photos
// 2. Low contrast images
// 3. Partially obscured receipts
// 4. Text in multiple languages
// 5. Old/faded receipts

const result = await extractSlipDataWithGeminiFallback(imageBuffer);

console.log(`Confidence: ${result.confidence}`);
console.log(`Method: ${result.method}`);

if (result.confidence === 'low') {
  // Alert user to verify manually
}
```

### 📝 Database Tracking

Saved to MongoDB in Receipt document:
```json
{
  "extractedAmount": 1500.50,
  "extractedSender": "John Smith",
  "extractedReceiver": "DMDM Restaurant",
  "notes": "Extracted via gemini_standard (high confidence) | Size: 2.5MB | DriveID: 1abc2def..."
}
```

### 🔍 User Feedback

In LINE reply, confidence is shown with emoji:
```
✅ อัพโหลดสำเร็จ!

💰 จำนวนเงิน: ฿1,500.50
👤 ผู้ส่ง: John Smith
🏢 ผู้รับ: DMDM Restaurant
📅 วันที่: 2026-03-17

✅ ความแม่นยำ: high
```

Confidence levels:
- ✅ `high` - Very confident
- ⚠️ `medium` - Somewhat confident, may need review
- ❓ `low` - Manual review recommended

---

## 5. Error Handling & Logging

### 📝 Comprehensive Logging

All operations include detailed logs:

```
🔄 [START] Processing image message: 100001abc...
👤 User ID: Uabc123def456ghi...

✅ Step 1: MongoDB connected
✅ Step 2: Image downloaded (2.5MB)
🤖 Step 3: Extracting data with Gemini...
   - Amount: ฿1,500.50
   - Sender: John Smith
   - Receiver: DMDM Restaurant
   - Date: 2026-03-17
   - Confidence: high
   - Method: gemini_standard

☁️ Step 4: Uploading to Google Drive with retry...
   - File ID: 1abc2def3ghi4jkl5mno6pqr7stu8vwx
   - Link: https://drive.google.com/uc?id=1abc...

💾 Step 5: Saving to MongoDB...
   - Receipt ID: 65f1a2b3c4d5e6f7g8h9i0j1

📤 Step 6: Sending success message to LINE...
✅ Step 6: Reply sent successfully

✨ [COMPLETE] Image processing succeeded
```

### 🎯 Error Recovery

**Automatic Recovery:**
1. Google Drive upload fails → Retry with backoff
2. Gemini extraction unclear → Try next strategy
3. MongoDB save fails → User gets error message
4. LINE reply fails → Log and continue (receipt still saved)

---

## 6. Quick Reference

### Environment Variables Checklist

```env
# ✅ Existing (don't change)
MONGODB_URI=...
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
GOOGLE_*=...
GEMINI_API_KEY=...

# ✅ NEW - Add these for security
VALID_API_KEYS=key1,key2,key3
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
JWT_SECRET=your-secret-key
```

### Testing Checklist

- [ ] Test API without key → returns 401
- [ ] Test API with correct key → returns 200/201
- [ ] Generate 150 requests → returns 429 after 100
- [ ] Upload 5MB image → completes with retry
- [ ] Submit blurry receipt → returns confidence level
- [ ] Monitor logs for error messages

---

## 7. Future Improvements

### Potential Enhancements

1. **Redis Rate Limiting**
   - Distributed rate limiting across servers
   - Persistent across restarts

2. **JWT Authentication**
   - Token-based auth for clients
   - Expiring tokens for security

3. **API Usage Metrics**
   - Track bandwidth usage per API key
   - Daily/monthly reports

4. **Webhook Retry**
   - Automatic retry for failed uploads
   - Exponential backoff

5. **Enhanced Logging**
   - Centralized logging (Sentry, LogRocket)
   - Real-time monitoring dashboards

---

## 📞 Support & Questions

For issues or questions, check:
1. Logs in `/src/app/api/line/route.ts` (all processing steps log)
2. Environment variables in `.env.local`
3. Error messages returned from API

Common issues:
- **401 Unauthorized:** Missing or incorrect API key
- **429 Too Many Requests:** Rate limit exceeded, wait before retrying
- **❓ Low Confidence:** Image too unclear, verify data manually
- **⏱️ Timeout:** Large image, retry or reduce image size

---

**Version:** 2.0 (March 17, 2026)  
**Status:** Production Ready ✅
