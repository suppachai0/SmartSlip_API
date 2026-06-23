# SmartSlip API

Backend API สำหรับแอป SmartSlip — บันทึกใบเสร็จผ่าน LINE Bot ด้วย AI

**Production:** https://smart-slip-api.vercel.app

---

## ภาพรวม

ผู้ใช้ส่งรูปภาพใบเสร็จมาทาง LINE Bot → ระบบถาม category → Gemini AI อ่านข้อมูล → บันทึกลง MongoDB และ Google Sheets

**Tech Stack:** Next.js 16 · MongoDB · Google Cloud Storage · Google Sheets API · Gemini AI · LINE Messaging API

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
| `GET` | `/api/auth/line` | เริ่ม LINE Login flow |

### User
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/user/link-line` | เชื่อม LINE userId กับบัญชี web |
| `PATCH` | `/api/user/patch-sheet` | ตั้งค่า Google Sheet ID (admin) |

---

## Environment Variables

```env
# LINE
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=

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

# App
FRONTEND_URL=
ADMIN_SECRET_KEY=
```

---

## การทำงานของ LINE Bot

1. ผู้ใช้ส่งรูปภาพใบเสร็จ
2. ระบบอัปโหลดรูปไปยัง Cloud Storage (path: `pending/`)
3. ส่ง Quick Reply ถามหมวดหมู่ (อาหาร / เดินทาง / ช้อปปิ้ง ฯลฯ)
4. ผู้ใช้เลือก category → ระบบดาวน์โหลดรูปจาก Cloud Storage
5. Gemini AI อ่านข้อมูลใบเสร็จ (fallback 4 models)
6. บันทึกลง MongoDB และ Google Sheets
7. ส่งผลสรุปกลับให้ผู้ใช้ใน LINE

---

## Development

```bash
npm install
npm run dev   # http://localhost:3000
```
