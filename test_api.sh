#!/bin/bash
# SmartSlip API Testing - cURL Commands
# Base URL
BASE_URL="http://localhost:3000/api"

echo "=========================================="
echo "SmartSlip API Testing with cURL"
echo "=========================================="
echo ""

# 1. Create Receipt
echo "1️⃣  Creating a new receipt..."
RESPONSE=$(curl -X POST "$BASE_URL/receipts" \
  -H "Content-Type: application/json" \
  -d '{
    "storeName": "ร้านเสร็จ",
    "totalAmount": 5500,
    "userId": "user123",
    "items": [
      {
        "description": "กลิ่นมุก",
        "quantity": 2,
        "unitPrice": 250,
        "totalPrice": 500
      }
    ],
    "imageURL": "https://example.com/image.jpg",
    "customerName": "สมชาย",
    "customerEmail": "somchai@email.com"
  }')

echo "$RESPONSE" | jq .
RECEIPT_ID=$(echo "$RESPONSE" | jq -r '.data.id')
echo "Receipt ID: $RECEIPT_ID"
echo ""

# 2. Get all receipts
echo "2️⃣  Fetching all receipts..."
curl -X GET "$BASE_URL/receipts" | jq .
echo ""

# 3. Get receipt by ID
echo "3️⃣  Getting receipt by ID..."
curl -X GET "$BASE_URL/receipts/$RECEIPT_ID" | jq .
echo ""

# 4. Get receipts by user
echo "4️⃣  Getting receipts filtered by userId..."
curl -X GET "$BASE_URL/receipts?userId=user123" | jq .
echo ""

# 5. Get summary
echo "5️⃣  Getting summary of all receipts..."
curl -X GET "$BASE_URL/receipts/summary" | jq .
echo ""

# 6. Update receipt to approved
echo "6️⃣  Updating receipt status to approved..."
curl -X PUT "$BASE_URL/receipts/$RECEIPT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "approved",
    "notes": "ได้รับการตรวจสอบและอนุมัติแล้ว"
  }' | jq .
echo ""

# 7. Get updated receipt
echo "7️⃣  Getting updated receipt..."
curl -X GET "$BASE_URL/receipts/$RECEIPT_ID" | jq .
echo ""

# 8. Get summary after update
echo "8️⃣  Getting summary after update..."
curl -X GET "$BASE_URL/receipts/summary" | jq .
echo ""

# 9. Delete receipt
echo "9️⃣  Deleting receipt..."
curl -X DELETE "$BASE_URL/receipts/$RECEIPT_ID" | jq .
echo ""

echo "=========================================="
echo "✅ Testing Complete!"
echo "=========================================="
