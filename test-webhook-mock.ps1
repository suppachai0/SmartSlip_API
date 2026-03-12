# SmartSlip LINE Webhook Mock Tester - PowerShell Version
# Usage: powershell -ExecutionPolicy Bypass -File test-webhook-mock.ps1

Write-Host "==== SmartSlip LINE Webhook Mock Tester ====" -ForegroundColor Cyan
Write-Host ""

# Configuration
$BaseUrl = "http://localhost:3000"
$lineSecret = $env:LINE_CHANNEL_SECRET
if ([string]::IsNullOrEmpty($lineSecret)) {
    Write-Host "WARNING: LINE_CHANNEL_SECRET not set!" -ForegroundColor Yellow
    $lineSecret = "YOUR_SECRET"
}

# Check if server is running
Write-Host "INFO: Checking if server is running at $BaseUrl..." -ForegroundColor Yellow
try {
    $null = Invoke-WebRequest -Uri "$BaseUrl/api/receipts/summary" -Method GET -ErrorAction Stop
    Write-Host "OK: Server is online!" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Server not responding at $BaseUrl" -ForegroundColor Red
    Write-Host "TIP: Run: npm run dev" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Step 1: Create payload
Write-Host "STEP 1: Creating mock LINE webhook payload..." -ForegroundColor Cyan
$timestamp = [long](Get-Date -UFormat %s) * 1000

$payloadObj = @{
    events = @(
        @{
            type = "message"
            message = @{
                type = "image"
                id = "test-msg-1234567890"
            }
            replyToken = "nHuyWiB7yP5Zw52FIkcQT"
            source = @{
                type = "user"
                userId = "UTest1234567890abcdef1234567890ab"
            }
            timestamp = $timestamp
        }
    )
}

$payload = $payloadObj | ConvertTo-Json -Depth 10
$payloadSizeKB = [math]::Round($payload.Length / 1024, 2)
Write-Host "OK: Payload created ($payloadSizeKB KB)" -ForegroundColor Green
Write-Host ""

# Step 2: Generate signature
Write-Host "STEP 2: Generating LINE signature..." -ForegroundColor Cyan
$signatureData = [System.Text.Encoding]::UTF8.GetBytes($payload)
$signatureSecret = [System.Text.Encoding]::UTF8.GetBytes($lineSecret)
$hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList $signatureSecret
$signatureBytes = $hmac.ComputeHash($signatureData)
$signature = [Convert]::ToBase64String($signatureBytes)
$sigPreview = $signature.Substring(0, 30)
Write-Host "OK: Signature: $sigPreview..." -ForegroundColor Green
Write-Host ""

# Step 3: Send webhook
Write-Host "STEP 3: Sending POST request..." -ForegroundColor Cyan
Write-Host "Endpoint: $BaseUrl/api/line" -ForegroundColor Gray
Write-Host ""

try {
    $webResponse = Invoke-WebRequest `
        -Uri "$BaseUrl/api/line" `
        -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "X-Line-Signature" = $signature
        } `
        -Body $payload `
        -UseBasicParsing

    Write-Host "OK: Webhook executed!" -ForegroundColor Green
    Write-Host ""
    
    $responseData = $webResponse.Content | ConvertFrom-Json
    Write-Host "RESPONSE:" -ForegroundColor Cyan
    Write-Host ($responseData | ConvertTo-Json -Depth 5) -ForegroundColor White
    Write-Host ""

    if ($responseData.success -eq $true) {
        Write-Host "PASS: TEST PASSED!" -ForegroundColor Green
        Write-Host ""
        Write-Host "VERIFY: Check these components:" -ForegroundColor Yellow
        Write-Host "1. MongoDB: db.receipts.find().limit(1)" -ForegroundColor Gray
        Write-Host "2. Google Drive: folder/1G7pmEwq4RUOie43yPhOzFCnrVcxclW5K" -ForegroundColor Gray
        Write-Host "3. Console logs: Gemini extraction results" -ForegroundColor Gray
    } else {
        Write-Host "FAIL: Test failed" -ForegroundColor Red
        Write-Host "Error: $($responseData.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "ERROR: Request failed!" -ForegroundColor Red
    Write-Host "Message: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "Test completed!" -ForegroundColor Cyan
