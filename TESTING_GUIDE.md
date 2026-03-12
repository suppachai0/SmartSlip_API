# SmartSlip LINE Webhook Mock Testing Guide

## 🎯 Overview

This guide provides step-by-step instructions to test the LINE webhook API without needing a real LINE Bot account.

---

## 📋 Prerequisites

✅ Next.js development server running (`npm run dev`)  
✅ MongoDB connected and configured  
✅ Google Drive API configured  
✅ Gemini API key set in `.env.local`  

---

## 🚀 Quick Start

### Option 1: PowerShell (Recommended for Windows)

```powershell
# Run the test script
powershell -ExecutionPolicy Bypass -File test-webhook-mock.ps1

# Or with custom port
powershell -ExecutionPolicy Bypass -File test-webhook-mock.ps1 -Port 3001
```

### Option 2: Node.js

```bash
# Requires axios to be installed
npm install axios --save-dev

# Run the test
node test-webhook-mock.js
```

### Option 3: Shell Script (Linux/Mac)

```bash
bash test-webhook-mock.sh
```

### Option 4: Manual with Postman

See **Postman Collection** section below.

---

## 🔍 What the Test Does

The mock test simulates a LINE webhook by:

1. **Creating a mock payload** - Simulates a LINE message event with an image
2. **Generating a valid signature** - Creates proper HMAC-SHA256 signature
3. **Sending to `/api/line`** - POSTs the payload to your webhook
4. **Checking response** - Verifies if webhook processed successfully

---

## 📊 Expected Results

### ✅ Successful Response (Status 200)

```json
{
  "success": true,
  "message": "Webhook processed successfully",
  "eventsCount": 1
}
```

### 🔴 Failed Response Examples

| Error | Cause | Solution |
|-------|-------|----------|
| `Connection refused` | Server not running | Run `npm run dev` |
| `Invalid signature` | Invalid secret | Check `LINE_CHANNEL_SECRET` |
| `Database connection failed` | MongoDB offline | Check MongoDB connection |
| `GEMINI_API_KEY not set` | Missing env variable | Add to `.env.local` |

---

## 🔎 Verification Checklist

After running the mock test, verify each component:

### 1️⃣ Check MongoDB

```javascript
// Connect to MongoDB and run:
db.receipts.find({}).sort({_id: -1}).limit(1)

// Expected output:
{
  "_id": ObjectId("..."),
  "transactionId": "LINE-UTest...",
  "receiptNumber": "RCP-...",
  "storeName": "...",
  "amount": 0,
  "status": "reviewing",
  "userId": "UTest1234567890abcdef1234567890ab",
  "imageURL": "https://drive.google.com/uc?id=...",
  "createdAt": ISODate("2026-03-11T..."),
  "updatedAt": ISODate("2026-03-11T...")
}
```

**Command-line MongoDB check:**
```bash
# Using MongoDB Atlas CLI
mongosh "mongodb+srv://username:password@cluster.mongodb.net/smartslip"
> db.receipts.find().limit(1).pretty()
```

---

### 2️⃣ Check Google Drive Upload

1. Open Google Drive: https://drive.google.com
2. Navigate to folder: `1G7pmEwq4RUOie43yPhOzFCnrVcxclW5K`
3. Look for file: `receipt-*.jpg`
4. File should be **publicly readable**

**Expected file structure:**
```
📁 Folder 1G7pmEwq4RUOie43yPhOzFCnrVcxclW5K
  └── 📄 receipt-0-2026-03-11T...jpg (uploaded image)
```

---

### 3️⃣ Check Gemini AI Extraction

Look at the **console logs** from `npm run dev`:

```
🤖 Sending image to Gemini for analysis...
🤖 Gemini response: {"amount": 1500.50, "sender": "...", "receiver": "...", "date": "..."}
✅ Data extracted from slip: {amount: 1500.50, sender: "...", receiver: "...", date: "..."}
📋 Receipt saved to MongoDB: 65f3a4b8c9d1e2f3g4h5i6j7
```

---

## 📝 Postman Collection Testing

If you prefer manual testing:

### Headers to Set

```
Content-Type: application/json
X-Line-Signature: [generated signature]
```

### Endpoint

```
POST http://localhost:3001/api/line
```

### Body (Raw JSON)

```json
{
  "events": [
    {
      "type": "message",
      "message": {
        "type": "image",
        "id": "test-message-1234567890"
      },
      "replyToken": "nHuyWiB7yP5Zw52FIkcQT",
      "source": {
        "type": "user",
        "userId": "UTest1234567890abcdef1234567890ab"
      },
      "timestamp": 1710173400000
    }
  ]
}
```

### Generate Signature in Postman

Use Postman's pre-request script:

```javascript
// Pre-request Script
const crypto = require('crypto');
const secret = pm.environment.get('LINE_CHANNEL_SECRET');
const body = request.body.toString();
const signature = crypto.createHmac('sha256', secret)
  .update(body)
  .digest('base64');
pm.request.headers.add({
    key: 'X-Line-Signature',
    value: signature
});
```

---

## 🧪 Advanced Testing

### Test with Real Image File

To test with an actual image (instead of mock):

```powershell
# Read actual image and send
$imageBytes = [System.IO.File]::ReadAllBytes("path/to/slip/image.jpg")
$base64Image = [Convert]::ToBase64String($imageBytes)

# Modify payload to include base64 image data
# (Requires modifying the test script)
```

---

## 🐛 Troubleshooting

### Issue: "X-Line-Signature invalid"
**Solution:**
- Verify `LINE_CHANNEL_SECRET` matches in `.env.local`
- Make sure payload is exact (no extra whitespace)

### Issue: "Cannot find module 'axios'"
**Solution:**
```bash
npm install axios --save-dev
```

### Issue: "ECONNREFUSED - Connection refused"
**Solution:**
- Ensure `npm run dev` is running
- Check if port is 3000 or 3001
- Verify firewall isn't blocking localhost

### Issue: "Gemini returns null values"
**Solution:**
- Check `GEMINI_API_KEY` is valid
- Verify API quota not exceeded
- Check image is valid

### Issue: "Google Drive upload failed"
**Solution:**
- Verify Service Account has Editor access to folder
- Check `GOOGLE_DRIVE_FOLDER_ID` is correct
- Ensure Google Cloud APIs are enabled

---

## 📚 Next Steps After Mock Testing

1. ✅ **Set up real LINE Bot**
   - Create Channel on LINE Developers
   - Get Access Token and Channel Secret
   - Set Webhook URL

2. ✅ **Update .env.local**
   ```
   LINE_CHANNEL_ACCESS_TOKEN=your_real_token
   LINE_CHANNEL_SECRET=your_real_secret
   ```

3. ✅ **Deploy to production**
   - Vercel, Render, or other platform
   - Update Webhook URL in LINE Console

4. ✅ **Test with real LINE Bot**
   - Add bot as friend
   - Send receipt image
   - Verify full flow works

---

## 💡 Tips

- 💾 **Save test results** - Screenshot MongoDB, Google Drive, and console logs
- 📊 **Monitor performance** - Check API response times
- 🔐 **Keep secrets safe** - Never commit `.env.local` to git
- 📝 **Document issues** - Note any errors for debugging

---

## 📞 Support

If tests fail:

1. Check console logs from `npm run dev`
2. Verify all `.env.local` values
3. Test each component individually:
   - MongoDB connection
   - Google Drive API
   - Gemini API
4. Check firewall/network settings

---

**Happy Testing!** 🚀
