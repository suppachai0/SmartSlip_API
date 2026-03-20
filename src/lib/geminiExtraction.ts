import { GoogleGenerativeAI } from '@google/generative-ai';
import { retryWithBackoff } from './retry';

/**
 * Enhanced Gemini extraction with fallback strategies
 * Handles unclear images, extraction failures, and provides multiple approaches
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

export interface SlipExtractionResult {
  amount: number;
  sender: string;
  receiver: string;
  date: string;
  confidence: 'high' | 'medium' | 'low';
  method: 'gemini_standard' | 'gemini_aggressive' | 'fallback_text_only' | 'manual_required';
}

/**
 * Extract Thai bank slip data using Gemini with single fast prompt
 */
export async function extractSlipDataWithGeminiFallback(
  imageBuffer: Buffer
): Promise<SlipExtractionResult> {
  console.log('🤖 Starting Gemini extraction...');
  
  const base64Image = imageBuffer.toString('base64');

  try {
    // Single fast prompt - just get the main data needed
    const prompt = `Extract from this Thai bank slip (ใบเสร็จ):
1. Amount in Baht (฿) - number only
2. Sender name 
3. Receiver name
4. Date (any format)

Return ONLY valid JSON:
{"amount": 0, "sender": "...", "receiver": "...", "date": "..."}`;

    console.log('📝 Calling Gemini API...');

    const result = await retryWithBackoff(
      async () => {
        return await model.generateContent([
          {
            inlineData: {
              data: base64Image,
              mimeType: 'image/jpeg',
            },
          },
          {
            text: prompt,
          },
        ]);
      },
      {
        maxAttempts: 2,
        initialDelayMs: 500,
        timeoutMs: 6000, // Gemini API timeout - increased from 3500ms
        onRetry: (attempt, error) => {
          console.warn(`⚠️ Retry ${attempt}: ${error?.message}`);
        },
      }
    );

    const responseText = result.response.text();
    console.log(`✅ Gemini response received (${responseText.length} chars)`);

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const extractedData = JSON.parse(jsonMatch[0]);
    console.log('✅ Extraction successful');
    
    return formatResult(extractedData, 'high', 'gemini_standard');
  } catch (error) {
    console.error('❌ Extraction failed:', error);
    return {
      amount: 0,
      sender: 'Unknown',
      receiver: 'Unknown',
      date: new Date().toISOString().split('T')[0],
      confidence: 'low',
      method: 'manual_required',
    };
  }
}


/**
 * Format and validate extraction result
 */
function formatResult(
  data: any,
  confidence: 'high' | 'medium' | 'low',
  method: string
): SlipExtractionResult {
  return {
    amount: typeof data.amount === 'number' ? Math.max(0, data.amount) : 0,
    sender: (data.sender || 'Unknown').toString().substring(0, 100),
    receiver: (data.receiver || 'Unknown').toString().substring(0, 100),
    date: formatDate(data.date),
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
