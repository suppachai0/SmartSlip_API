# SmartSlip API

Backend API สำหรับแอป SmartSlip — บันทึกใบเสร็จผ่าน LINE Bot ด้วย AI

**Production:** https://smart-slip-api.vercel.app  
**Frontend:** https://smart-slip-nine.vercel.app

---

## ภาพรวม

ผู้ใช้ส่งรูปภาพใบเสร็จมาทาง LINE Bot → ระบบถาม category → Gemini AI อ่านข้อมูล → บันทึกลง MongoDB และ Google Sheets

**Tech Stack:** Next.js 16 · MongoDB · Google Cloud Storage · Google Sheets API · Gemini AI · LINE Messaging API

---

## ระบบ Role และการอนุมัติผู้ใช้

ผู้ใช้ทุกคนต้องรอ admin อนุมัติก่อนจึงจะใช้งาน LINE Bot และเว็บได้

| Role | สิทธิ์ |
|------|--------|
| `user` | สแกนและดูใบเสร็จของตัวเอง |
| `admin` | ทำได้ทุกอย่าง + อนุมัติ/จัดการผู้ใช้ |

| Status | ความหมาย |
|--------|----------|
| `pending` | รอการอนุมัติ (default ของผู้ใช้ใหม่) |
| `approved` | ใช้งานได้ |
| `rejected` | ถูกปฏิเสธ |

Admin ถูกกำหนดผ่าน environment variable:
- `ADMIN_LINE_USER_IDS` — LINE user ID ของ admin (คั่นด้วย `,`)
- `ADMIN_EMAILS` — Email ของ admin สำหรับ Google login (คั่นด้วย `,`)

เมื่อ admin เปลี่ยน status เป็น `approved` หรือ `rejected` ระบบจะส่ง push message แจ้งผู้ใช้ใน LINE อัตโนมัติ

---

## API Endpoints

### LINE Webhook
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/line` | รับ webhook จาก LINE (image + text) |
| `GET` | `/api/line` | ตรวจสอบ health ของระบบ |

### Receipts
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/receipts/extract` | อัปโหลดและสแกนใบเสร็จจาก web |
| `GET` | `/api/receipts` | ดึงรายการใบเสร็จของผู้ใช้ |
| `GET` | `/api/receipts/summary` | สรุปยอดรายจ่าย |
| `GET/DELETE` | `/api/receipts/[id]` | ดูหรือลบใบเสร็จ |

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/google` | เริ่ม Google OAuth flow |
| `GET` | `/api/auth/google/callback` | Google OAuth callback |
| `GET` | `/api/auth/callback/line` | LINE Login callback |
| `POST` | `/api/auth/line` | แลก LINE authorization code |

### User
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/user/link-line` | เชื่อม LINE userId กับบัญชี web |
| `PATCH` | `/api/user/patch-sheet` | ตั้งค่า Google Sheet ID (admin) |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | ดูรายชื่อผู้ใช้ทั้งหมด |
| `PATCH` | `/api/admin/users/[id]` | อนุมัติ / เปลี่ยน role ผู้ใช้ |

Admin endpoints ทั้งหมดต้องใส่ header: `x-admin-key: <ADMIN_SECRET_KEY>`

#### ตัวอย่าง: อนุมัติผู้ใช้
```bash
# ดูรายชื่อผู้ใช้ทั้งหมด
GET /api/admin/users
x-admin-key: your_secret

# อนุมัติ
PATCH /api/admin/users/<userId>
x-admin-key: your_secret
Content-Type: application/json
{ "status": "approved" }

# ปฏิเสธ
PATCH /api/admin/users/<userId>
x-admin-key: your_secret
Content-Type: application/json
{ "status": "rejected" }
```

---

## Environment Variables

```env
# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=

# LINE Login (web)
LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
LINE_LOGIN_REDIRECT_URI=

# MongoDB
MONGODB_URI=

# Google Service Account (Cloud Storage + Sheets)
GOOGLE_PROJECT_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_PRIVATE_KEY_ID=
GOOGLE_CLIENT_ID=
GOOGLE_CLOUD_STORAGE_BUCKET_NAME=

# Google OAuth (web login)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=

# Gemini AI
GEMINI_API_KEY=

# App
FRONTEND_URL=
ADMIN_SECRET_KEY=

# Role system — admin users (comma-separated)
ADMIN_LINE_USER_IDS=Uxxxxxxxx,Uxxxxxxxx
ADMIN_EMAILS=admin@example.com
```

---

## การทำงานของ LINE Bot

1. ผู้ใช้ส่งข้อความครั้งแรก → ระบบสร้าง record อัตโนมัติ (status: `pending`)
2. ถ้ายังไม่ได้รับการอนุมัติ → ตอบ "รอการอนุมัติจากแอดมิน"
3. เมื่อ admin อนุมัติ → ระบบ push แจ้งผู้ใช้ใน LINE ทันที
4. ผู้ใช้ส่งรูปใบเสร็จ → ระบบอัปโหลดรูปไปยัง Cloud Storage (`pending/`)
5. ส่ง Quick Reply ถามหมวดหมู่ (อาหาร / เดินทาง / ช้อปปิ้ง / อื่นๆ)
6. ผู้ใช้เลือก category → ระบบดาวน์โหลดรูปจาก Cloud Storage
7. Gemini AI อ่านข้อมูลใบเสร็จ (fallback chain 4 models)
8. บันทึกลง MongoDB และ Google Sheets
9. ส่งผลสรุปกลับให้ผู้ใช้ใน LINE

---

## Development

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # production build check
```

