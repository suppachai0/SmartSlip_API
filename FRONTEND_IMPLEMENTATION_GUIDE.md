# 📋 Frontend Implementation Guide: Dynamic User Approval with LINE Notifications

## 🎯 Objective

Frontend developers need to create a new route handler at `src/app/api/admin/users/[id]/route.ts` to handle:
- ✅ Dynamic user approval/rejection (PATCH requests)
- ✅ LINE push notifications when status changes
- ✅ Admin role verification

## 📍 File Location

**Repository**: SmartSlip Frontend (Non2412/SmartSlip)  
**New File Path**: `src/app/api/admin/users/[id]/route.ts`

## 🚀 Implementation Steps

### Step 1: Create the New File Structure

```bash
# In SmartSlip repository root
mkdir -p src/app/api/admin/users/\[id\]
```

### Step 2: Copy the Route Handler Code

Frontend developer should copy the entire code from:
- File: `FRONTEND_IMPLEMENTATION_[id]_route.ts` 
- Location: Backend repository (smartslip-api)

Then paste it into: `src/app/api/admin/users/[id]/route.ts`

### Step 3: Verify Environment Variables

Ensure these are set in SmartSlip Vercel Dashboard → Settings → Environment Variables:

```env
# Must exist:
LINE_CHANNEL_ACCESS_TOKEN=your-line-bot-token
LINE_CHANNEL_SECRET=your-line-secret

# MongoDB connection (should already exist):
MONGODB_URI=mongodb+srv://...
```

### Step 4: Test the Implementation

#### Local Testing
```bash
# In SmartSlip repository
npm run dev  # or pnpm dev
```

Then test with curl:
```bash
curl -X PATCH http://localhost:3000/api/admin/users/USER_ID \
  -H "Content-Type: application/json" \
  -b "your-auth-cookie" \
  -d '{"status": "rejected"}'
```

#### Production Testing
1. Go to Admin Dashboard: https://smart-slip-nine.vercel.app/admin
2. Find a pending user (e.g., "Korawich")
3. Click ❌ **ปฏิเสธ** button
4. Check Browser DevTools → Network tab:
   - Should show: `PATCH /api/admin/users/{userId}` → **200 OK**
5. Verify user receives LINE message

## 🔄 API Endpoint Details

### Request
```http
PATCH /api/admin/users/[id]
Content-Type: application/json
Cookie: <session-auth>

{
  "role": "user" | "admin",     // optional
  "status": "pending" | "active" | "rejected" | "restricted"  // optional
}
```

### Response (Success)
```json
{
  "success": true,
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Korawich",
    "email": "korawich@example.com",
    "role": "user",
    "status": "rejected",
    "lineUserId": "U1234567890abcdef1234567890abcdef"
  }
}
```

### Response (Error)
```json
{
  "success": false,
  "error": "No user found with id: 507f1f77bcf86cd799439011"
}
```

## 📱 LINE Message Templates

When user status changes, they receive automatic notifications:

### ✅ Approved
```
✅ บัญชีของคุณได้รับการอนุมัติแล้ว!

คุณสามารถใช้งาน SmartSlip ได้แล้วตอนนี้ 🎉
ลองส่งรูปใบเสร็จมาได้เลย
```

### ❌ Rejected
```
❌ บัญชีของคุณถูกปฏิเสธ

หากมีข้อสงสัย กรุณาติดต่อแอดมิน
https://smart-slip-nine.vercel.app/
```

### 🚫 Restricted
```
🚫 บัญชีของคุณถูกระงับการใช้งาน

กรุณาติดต่อแอดมินเพื่อทราบรายละเอียด
```

## ⚠️ Common Issues & Troubleshooting

### Issue 1: "404 Not Found" on PATCH request
**Cause**: Frontend still has old code calling wrong endpoint  
**Solution**: Make sure `src/app/api/admin/users/[id]/route.ts` exists and PATCH handler is implemented

### Issue 2: LINE notification not sent
**Cause**: 
- LINE_CHANNEL_ACCESS_TOKEN missing/invalid
- User doesn't have lineUserId set
- LINE API quota exceeded

**Solution**:
- Check Vercel Environment Variables
- Verify user has LINE account linked (lineUserId field in database)
- Check LINE Bot server logs

### Issue 3: "Unauthorized" (401) error
**Cause**: User is not authenticated/admin

**Solution**:
- Ensure you're logged in as admin user
- Check session cookie is being sent with request

## 🔐 Security Notes

✅ **This implementation includes**:
- Admin role verification via Auth.js session
- Validates role/status values
- Proper error handling
- MongoDB ObjectId validation

⚠️ **Frontend developers should ensure**:
- CORS is properly configured if calling from different domain
- Never expose LINE tokens in client-side code
- Validate user input before sending to API

## 🐛 Debugging

Enable verbose logging by adding this to `.env.local`:

```env
DEBUG=*
```

Then check Vercel function logs during request.

## 📞 Support

If LINE notifications still don't work after implementation:

1. Check backend logs at: https://vercel.com/smart-slip-api/logs
2. Verify LINE credentials in Vercel Settings
3. Test LINE Bot directly via LINE Developers Console

---

**Checklist for Frontend Developer:**
- [ ] Created `src/app/api/admin/users/[id]/route.ts`
- [ ] Copied code from backend template
- [ ] Verified environment variables in Vercel
- [ ] Tested PATCH request locally (`npm run dev`)
- [ ] Tested in production Admin Dashboard
- [ ] Verified LINE notifications received by user
- [ ] Commit and deploy to production
