#!/bin/bash
# Mock LINE Webhook Tester - Shell Script Version
# Usage: bash test-webhook-mock.sh

BASE_URL="http://localhost:3001"
LINE_CHANNEL_SECRET="${LINE_CHANNEL_SECRET:-YOUR_SECRET}"

echo "╔════════════════════════════════════════╗"
echo "║   SmartSlip LINE Webhook Mock Tester   ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Step 1: Create payload
echo "📝 Step 1: Creating mock payload..."
PAYLOAD=$(cat <<EOF
{
  "events": [
    {
      "type": "message",
      "message": {
        "type": "image",
        "id": "test-message-$(date +%s)"
      },
      "replyToken": "nHuyWiB7yP5Zw52FIkcQT",
      "source": {
        "type": "user",
        "userId": "UTest1234567890abcdef1234567890ab"
      },
      "timestamp": $(date +%s)000
    }
  ]
}
EOF
)

echo "✅ Payload created"
echo ""

# Step 2: Generate signature
echo "🔐 Step 2: Generating signature..."
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$LINE_CHANNEL_SECRET" -binary | base64)
echo "✅ Signature: ${SIGNATURE:0:30}..."
echo ""

# Step 3: Send request
echo "📤 Step 3: Sending POST request..."
echo "Target: $BASE_URL/api/line"
echo ""

curl -X POST "$BASE_URL/api/line" \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: $SIGNATURE" \
  -d "$PAYLOAD" \
  --write-out "\n\n✅ Status: %{http_code}\n" \
  --connect-timeout 5

echo ""
echo "✅ Request sent!"
echo ""
echo "📋 Next Steps:"
echo "   1. Check MongoDB: db.receipts.find().limit(1)"
echo "   2. Check Google Drive: folder 1G7pmEwq4RUOie43yPhOzFCnrVcxclW5K"
echo "   3. Check console logs for Gemini results"
