# 🔧 Frontend Code Changes Required

## File: SmartSlip → src/app/admin/page.tsx

### Change 1: Update handleUserUpdate Function

**Location**: Around line 330 in `src/app/admin/page.tsx`

#### BEFORE (Current - Broken)
```typescript
const handleUserUpdate = async (userId: string, updates: { role?: string; status?: string }) => {
  try {
    setActionLoading(userId);
    const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY || 'admin-secret-key-smartslip-2026';
    
    // ❌ WRONG: This calls /api/admin/users endpoint (static, expects userId in body)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ 
        role: updates.role,
        status: updates.status 
      })
    });
    
    const json = await res.json();
    if (json.success) {
      await Promise.all([fetchUsers(), fetchStats(), fetchLogs()]);
      showToast('อัปเดตข้อมูลผู้ใช้งานเรียบร้อยแล้ว!', 'success');
    } else {
      showToast(json.error || 'Failed to update user', 'error');
    }
  } catch (e) {
    console.error(e);
    showToast('เกิดข้อผิดพลาดการเชื่อมต่อ: ' + (e as any).message, 'error');
  } finally {
    setActionLoading(null);
  }
};
```

#### AFTER (Fixed - Uses Dynamic Route with Auth)
```typescript
const handleUserUpdate = async (userId: string, updates: { role?: string; status?: string }) => {
  try {
    setActionLoading(userId);
    
    // ✅ CORRECT: Use dynamic route with Auth.js session (no x-admin-key needed)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json'
        // No x-admin-key header needed - Auth.js session handles authorization
      },
      body: JSON.stringify({ 
        role: updates.role,
        status: updates.status 
      })
    });
    
    const json = await res.json();
    if (json.success) {
      await Promise.all([fetchUsers(), fetchStats(), fetchLogs()]);
      showToast('อัปเดตข้อมูลผู้ใช้งานเรียบร้อยแล้ว!', 'success');
      
      // ✨ LINE notification will be sent automatically by backend
      console.log(`📱 LINE notification sent to user: ${json.user?.name}`);
    } else {
      showToast(json.error || 'Failed to update user', 'error');
    }
  } catch (e) {
    console.error(e);
    showToast('เกิดข้อผิดพลาดการเชื่อมต่อ: ' + (e as any).message, 'error');
  } finally {
    setActionLoading(null);
  }
};
```

---

## Summary of Changes

| Aspect | Before | After |
|--------|--------|-------|
| **Endpoint** | `/api/admin/users` (static) | `/api/admin/users/[id]` (dynamic) |
| **Auth Method** | x-admin-key header | Auth.js session (NextAuth) |
| **User ID Location** | Body: `{ userId, ... }` | URL: `/api/admin/users/{userId}` |
| **LINE Notification** | ❌ Not sent | ✅ Sent automatically |
| **Response** | `{ success: true }` | `{ success: true, user: {...} }` |

---

## Testing After Changes

### 1. Local Testing
```bash
npm run dev  # or pnpm dev
# Visit: http://localhost:3000/admin
# Try rejecting a pending user
```

### 2. Check Network Tab in Browser DevTools
```
✅ Should see:
  Method: PATCH
  URL: /api/admin/users/507f1f77bcf86cd799439011
  Status: 200 OK
  Response: {"success": true, "user": {...}}
```

### 3. Verify LINE Notification
- User should receive message in LINE within 5 seconds
- Message format:
  ```
  ✅ บัญชีของคุณได้รับการอนุมัติแล้ว!
  
  คุณสามารถใช้งาน SmartSlip ได้แล้วตอนนี้ 🎉
  ลองส่งรูปใบเสร็จมาได้เลย
  ```

### 4. Production Testing
```bash
# After deploying to Vercel
# Go to: https://smart-slip-nine.vercel.app/admin
# Click reject on a pending user
# Verify LINE message received
```

---

## Pre-requisites

Make sure these are completed FIRST:

1. ✅ **New route file created**: `src/app/api/admin/users/[id]/route.ts`
   - Copy from: `FRONTEND_IMPLEMENTATION_[id]_route.ts`

2. ✅ **Environment variables set** in Vercel:
   - `LINE_CHANNEL_ACCESS_TOKEN` ✅
   - `LINE_CHANNEL_SECRET` ✅
   - `MONGODB_URI` ✅

3. ✅ **Dependencies installed**:
   ```bash
   # Should already have:
   npm list @line/bot-sdk  # Should be installed
   npm list next-auth      # Should be installed
   ```

---

## Rollback (If Needed)

If something breaks, revert to original:
```typescript
const res = await fetch('/api/admin/users', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, role: updates.role, status: updates.status })
});
```

Then open issue to discuss architecture.

---

## 🎯 Final Checklist

- [ ] Created `src/app/api/admin/users/[id]/route.ts`
- [ ] Updated `handleUserUpdate` in `src/app/admin/page.tsx`
- [ ] Tested locally with `npm run dev`
- [ ] Verified Network requests in DevTools
- [ ] Tested with real user on production
- [ ] Received LINE message in test account
- [ ] Deployed to Vercel production
- [ ] Tested one more time on production
