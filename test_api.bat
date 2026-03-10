@echo off
REM SmartSlip API Testing - Windows Batch Script
REM Base URL
set BASE_URL=http://localhost:3000/api

echo.
echo ==========================================
echo SmartSlip API Testing with PowerShell
echo ==========================================
echo.

REM 1. Create Receipt
echo 1 Creating a new receipt...
for /f "delims=" %%A in ('powershell -Command "$response = Invoke-WebRequest -Uri '%BASE_URL%/receipts' -Method POST -Headers @{'Content-Type'='application/json'} -Body '{\"storeName\": \"ร้านเสร็จ\", \"totalAmount\": 5500, \"userId\": \"user123\", \"items\": [{\"description\": \"กลิ่นมุก\", \"quantity\": 2, \"unitPrice\": 250, \"totalPrice\": 500}], \"imageURL\": \"https://example.com/image.jpg\", \"customerName\": \"สมชาย\", \"customerEmail\": \"somchai@email.com\"}' -UseBasicParsing; $response.Content"') do set "RESPONSE=%%A"
echo %RESPONSE%
for /f "delims=" %%A in ('powershell -Command "$obj = '%RESPONSE%' | ConvertFrom-Json; $obj.data.id"') do set "RECEIPT_ID=%%A"
echo Receipt ID: %RECEIPT_ID%
echo.

REM 2. Get all receipts
echo 2 Fetching all receipts...
powershell -Command "Invoke-WebRequest -Uri '%BASE_URL%/receipts' -Method GET -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json | ConvertTo-Json -Depth 10"
echo.

REM 3. Get receipt by ID
echo 3 Getting receipt by ID...
powershell -Command "Invoke-WebRequest -Uri '%BASE_URL%/receipts/%RECEIPT_ID%' -Method GET -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json | ConvertTo-Json -Depth 10"
echo.

REM 4. Get summary
echo 4 Getting summary of all receipts...
powershell -Command "Invoke-WebRequest -Uri '%BASE_URL%/receipts/summary' -Method GET -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json | ConvertTo-Json -Depth 10"
echo.

REM 5. Update receipt
echo 5 Updating receipt status to approved...
powershell -Command "Invoke-WebRequest -Uri '%BASE_URL%/receipts/%RECEIPT_ID%' -Method PUT -Headers @{'Content-Type'='application/json'} -Body '{\"status\": \"approved\", \"notes\": \"ได้รับการตรวจสอบและอนุมัติแล้ว\"}' -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json | ConvertTo-Json -Depth 10"
echo.

REM 6. Delete receipt
echo 6 Deleting receipt...
powershell -Command "Invoke-WebRequest -Uri '%BASE_URL%/receipts/%RECEIPT_ID%' -Method DELETE -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json | ConvertTo-Json -Depth 10"
echo.

echo ==========================================
echo Testing Complete!
echo ==========================================
pause
