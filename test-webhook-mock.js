const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

/**
 * Mock LINE Webhook Tester
 * Tests the /api/line endpoint with a mock image
 */

const BASE_URL = 'http://localhost:3000'; // Adjust port if needed
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'YOUR_LINE_CHANNEL_SECRET';

/**
 * Generate LINE signature
 */
function generateLineSignature(body, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
}

/**
 * Create mock LINE webhook payload with base64 image
 */
function createMockPayload(imageBuffer) {
  // In real LINE webhook, they send the event in JSON
  // For testing, we'll simulate it locally in the route instead
  const payload = {
    events: [
      {
        type: 'message',
        message: {
          type: 'image',
          id: 'test-message-' + Date.now(),
        },
        replyToken: 'nHuyWiB7yP5Zw52FIkcQT',
        source: {
          type: 'user',
          userId: 'UTest1234567890abcdef1234567890ab',
        },
        timestamp: Date.now(),
      },
    ],
  };

  return JSON.stringify(payload);
}

/**
 * Run mock webhook test
 */
async function runMockTest() {
  try {
    console.log('🚀 Starting Mock Webhook Test...\n');
    console.log(`📍 Target: ${BASE_URL}/api/line`);
    console.log(`⏰ Time: ${new Date().toISOString()}\n`);

    // Step 1: Create mock payload
    console.log('📝 Step 1: Creating mock LINE webhook payload...');
    const mockBody = createMockPayload();
    console.log('✅ Payload created');
    console.log('Payload:', mockBody.substring(0, 100) + '...\n');

    // Step 2: Generate signature
    console.log('🔐 Step 2: Generating LINE signature...');
    const signature = generateLineSignature(mockBody, LINE_CHANNEL_SECRET);
    console.log('✅ Signature generated:', signature.substring(0, 30) + '...\n');

    // Step 3: Send to webhook
    console.log('📤 Step 3: Sending POST request to webhook...');
    const response = await axios.post(
      `${BASE_URL}/api/line`,
      mockBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': signature,
        },
      }
    );

    console.log('✅ Response received:\n');
    console.log('Status:', response.status, response.statusText);
    console.log('Data:', JSON.stringify(response.data, null, 2));

    // Step 4: Parse response
    if (response.data.success) {
      console.log('\n✨ Mock test PASSED! ✨');
      console.log('');
      console.log('✅ Webhook processed successfully');
      console.log('📝 Next Steps:');
      console.log('   1. Check MongoDB for new Receipt record');
      console.log('   2. Verify Google Drive folder for uploaded image');
      console.log('   3. Check logs for Gemini extraction results');
    } else {
      console.log('\n❌ Mock test FAILED');
      console.log('Error:', response.data.error);
    }
  } catch (error) {
    console.error('\n❌ Test Error:', error.toString());
    if (error.message) console.error('Message:', error.message);
    if (error.code) console.error('Code:', error.code);

    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('Request failed - no response received');
      console.error('Request:', error.config?.url);
    } else {
      console.error('Full Error:', JSON.stringify(error, null, 2));
    }

    console.error('\n🔧 Troubleshooting:');
    console.error('   1. Is the dev server running? (npm run dev)');
    console.error('   2. Check if port is 3000 or 3001');
    console.error('   3. Verify LINE_CHANNEL_SECRET in .env.local');
    console.error('   4. Check MongoDB connection');
  }
}

// Run the test
console.log('╔════════════════════════════════════════╗');
console.log('║   SmartSlip LINE Webhook Mock Tester   ║');
console.log('╚════════════════════════════════════════╝\n');

runMockTest();
