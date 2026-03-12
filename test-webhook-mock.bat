@echo off
REM Mock LINE Webhook Tester - Windows Batch Script
REM Usage: test-webhook-mock.bat

setlocal enabledelayedexpansion

cls
echo ╔════════════════════════════════════════╗
echo ║   SmartSlip LINE Webhook Mock Tester   ║
echo ╚════════════════════════════════════════╝
echo.

set BASE_URL=http://localhost:3001
set LINE_CHANNEL_SECRET=%LINE_CHANNEL_SECRET%

IF "%LINE_CHANNEL_SECRET%"=="" (
    set LINE_CHANNEL_SECRET=YOUR_SECRET
    echo ⚠️  LINE_CHANNEL_SECRET not set!
    echo    Set it via: set LINE_CHANNEL_SECRET=your_secret
    echo.
)

echo 📝 Step 1: Creating test payload...

REM Create temp file for payload
set PAYLOAD_FILE=%TEMP%\payload.json

(
echo {
echo   "events": [
echo     {
echo       "type": "message",
echo       "message": {
echo         "type": "image",
echo         "id": "test-message-%RANDOM%"
echo       },
echo       "replyToken": "nHuyWiB7yP5Zw52FIkcQT",
echo       "source": {
echo         "type": "user",
echo         "userId": "UTest1234567890abcdef1234567890ab"
echo       },
echo       "timestamp": %date:~10,4%%date:~4,2%%date:~7,2%
echo     }
echo   ]
echo }
) > %PAYLOAD_FILE%

echo ✅ Payload created at: %PAYLOAD_FILE%
echo.

echo 🔐 Step 2: Note on Signature...
echo ⚠️  Windows batch cannot generate SHA256 signatures easily
echo    Option 1: Use Node.js script instead (test-webhook-mock.js)
echo    Option 2: Use PowerShell (PowerShell script below)
echo    Option 3: Use curl with pre-generated signature
echo.

echo 📤 Step 3: Sending POST request (without signature verification)...
echo Target: %BASE_URL%/api/line
echo.

REM Note: curl needs to be installed
curl -X POST "%BASE_URL%/api/line" ^
  -H "Content-Type: application/json" ^
  -d @%PAYLOAD_FILE%

echo.
echo ✅ Request sent!
echo.
echo 📋 Next Steps:
echo    1. Check MongoDB for receipts
echo    2. Check Google Drive folder
echo    3. Check console logs
echo.
pause
