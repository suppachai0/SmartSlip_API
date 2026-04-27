import { GoogleGenerativeAI } from '@google/generative-ai';
import { retryWithBackoff } from './retry';

/**
 * Enhanced Gemini extraction with fallback strategies
 * Handles unclear images, extraction failures, and provides multiple approaches
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// gemini-1.5-flash-latest: 1500 req/day free tier, gemini-2.5-flash: 20 req/day
// Note: use 'gemini-1.5-flash-latest' not 'gemini-1.5-flash' for v1beta API compatibility
const MODELS = ['gemini-1.5-flash-latest', 'gemini-1.5-flash-8b', 'gemini-2.5-flash'];

export interface SlipExtractionResult {
  amount: number;
  sender: string;
  receiver: string;
  date: string;
  items?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  confidence: 'high' | 'medium' | 'low';
  method: 'gemini_standard' | 'gemini_aggressive' | 'fallback_text_only' | 'manual_required';
}

/**
 * Extract Thai bank slip data using Gemini with model fallback on 503
 */
export async function extractSlipDataWithGeminiFallback(
  imageBuffer: Buffer
): Promise<SlipExtractionResult> {
  console.log('🤖 Starting Gemini extraction...');

  const base64Image = imageBuffer.toString('base64');

  const prompt = `From this Thai receipt (ใบเสร็จ), extract ONLY these 4 fields:
1. Total amount (number)
2. Shop/receiver name
3. Customer/sender name  
4. All items: [name] qty=[number] price=[number]

Return ONLY this exact JSON structure:
{
  "amount": 0,
  "sender": "name",
  "receiver": "name",
  "date": "date",
  "items": [{"description": "name", "quantity": 1, "unitPrice": 0, "totalPrice": 0}]
}

If you cannot read critical data, return null for that field.`;

  // Try each model in order until one succeeds
  for (const modelName of MODELS) {
    try {
      console.log(`📝 Trying model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });

      const result = await retryWithBackoff(
        async () => {
          return await model.generateContent([
            { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
            { text: prompt },
          ]);
        },
        {
          maxAttempts: 2,
          initialDelayMs: 1000,
          timeoutMs: 15000,
          onRetry: (attempt, error) => {
            console.warn(`⚠️ Retry ${attempt} on ${modelName}: ${error?.message}`);
          },
        }
      );

      const responseText = result.response.text();
      console.log(`✅ Gemini response from ${modelName} (${responseText.length} chars)`);

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const extractedData = JSON.parse(jsonMatch[0]);
      console.log('✅ Extraction successful');
      return formatResult(extractedData, 'high', 'gemini_standard');

    } catch (error: any) {
      const is503 = error?.message?.includes('503') || error?.message?.includes('Service Unavailable') || error?.message?.includes('high demand');
      const is429 = error?.message?.includes('429') || error?.message?.includes('Too Many Requests') || error?.message?.includes('quota');
      if ((is503 || is429) && modelName !== MODELS[MODELS.length - 1]) {
        console.warn(`⚠️ ${modelName} unavailable (${is503 ? '503' : '429'}), trying next model...`);
        continue;
      }
      // Last model or non-503 error - give up
      console.error('❌ Extraction failed:', error);
      return {
        amount: 0,
        sender: 'Unknown',
        receiver: 'Unknown',
        date: new Date().toISOString().split('T')[0],
        items: undefined,
        confidence: 'low',
        method: 'manual_required',
      };
    }
  }

  // Should not reach here
  return {
    amount: 0,
    sender: 'Unknown',
    receiver: 'Unknown',
    date: new Date().toISOString().split('T')[0],
    items: undefined,
    confidence: 'low',
    method: 'manual_required',
  };
}


/**
 * Format and validate extraction result
 */
function formatResult(
  data: any,
  confidence: 'high' | 'medium' | 'low',
  method: string
): SlipExtractionResult {
  // Format items list
  const items = Array.isArray(data.items)
    ? data.items.map((item: any) => ({
        description: (item.description || 'Unknown').toString().substring(0, 100),
        quantity: typeof item.quantity === 'number' ? Math.max(1, item.quantity) : 1,
        unitPrice: typeof item.unitPrice === 'number' ? Math.max(0, item.unitPrice) : 0,
        totalPrice: typeof item.totalPrice === 'number' ? Math.max(0, item.totalPrice) : 0,
      }))
    : undefined;

  return {
    amount: typeof data.amount === 'number' ? Math.max(0, data.amount) : 0,
    sender: (data.sender || 'Unknown').toString().substring(0, 100),
    receiver: (data.receiver || 'Unknown').toString().substring(0, 100),
    date: formatDate(data.date),
    items: items && items.length > 0 ? items : undefined,
    confidence,
    method: method as any,
  };
}

/**
 * Normalize date format to YYYY-MM-DD
 */
function formatDate(dateStr: any): string {
  if (!dateStr) {
    return new Date().toISOString().split('T')[0];
  }

  try {
    // Try to parse various date formats
    const dateString = dateStr.toString();

    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}/.test(dateString)) {
      return dateString.substring(0, 10);
    }

    // Thai date format (25/3/2567 -> 2024-03-25)
    if (/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.test(dateString)) {
      const match = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (match) {
        let [, day, month, year] = match;
        // Convert Thai year to Gregorian if needed (2567 = 2024)
        const yearNum = parseInt(year);
        if (yearNum > 2500) {
          year = (yearNum - 543).toString();
        }
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }

    // Try parsing as date
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    console.warn('⚠️ Could not parse date:', dateStr);
  }

  return new Date().toISOString().split('T')[0];
}
