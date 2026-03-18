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
 * List of prompts to try in order of specificity
 */
const EXTRACTION_PROMPTS = [
  // Prompt 1: Standard extraction (most accurate)
  (language: string = 'Thai') => `
Please extract the following information from this ${language} bank slip image (ใบเสร็จ):

1. Amount (จำนวนเงิน) - in Thai Baht - look for numbers and decimal points
2. Sender (ผู้ส่ง) - the name of the person/organization sending
3. Receiver (ผู้รับ) - the name of the person/organization receiving  
4. Date (วันที่) - in Thai date format if available, otherwise any date you can find

IMPORTANT: 
- Look for numbers even if text is unclear
- For amount, look for "฿" symbol or digit patterns next to large amounts
- For names, extract any text that looks like a person or business name
- For dates, look for date patterns in Thai (xx/xx/xxxx) or Gregorian format

Respond ONLY in JSON format, no other text:
{
  "amount": <number or 0 if not found>,
  "sender": "<text or 'Unknown'>",
  "receiver": "<text or 'Unknown'>",
  "date": "<date or today's date>"
}
`,

  // Prompt 2: Aggressive extraction (more lenient for unclear images)
  (language: string = 'Thai') => `
Extract any visible information from this potentially unclear ${language} bank slip image:

Focus on:
1. ANY numbers that could represent an amount
2. ANY text/names that could be sender or receiver
3. ANY date-like patterns

Return JSON:
{
  "amount": <best guess or 0>,
  "sender": "<best guess or 'Unclear'>",
  "receiver": "<best guess or 'Unclear'>",
  "date": "<best guess>"
}

Even if unsure, make your best attempt.
`,

  // Prompt 3: Text extraction only (when image is very unclear)
  () => `
List ALL text visible in this image in JSON format:
{
  "visible_text": ["text1", "text2", ...],
  "numbers": [<num1>, <num2>, ...],
  "readable": true or false
}

Just list what you can see, no interpretation.
`,
];

/**
 * Extract Thai bank slip data using Gemini with retry and fallback
 */
export async function extractSlipDataWithGeminiFallback(
  imageBuffer: Buffer
): Promise<SlipExtractionResult> {
  console.log('🤖 Starting enhanced Gemini extraction with fallbacks...');
  
  const base64Image = imageBuffer.toString('base64');
  const maxFileSize = 4 * 1024 * 1024; // 4MB

  // Warn if image is large (might timeout)
  if (imageBuffer.length > 2 * 1024 * 1024) {
    console.warn(`⚠️ Large image detected (${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB). Might timeout.`);
  }

  // Try prompts in order, with fallback strategy
  for (let promptIndex = 0; promptIndex < EXTRACTION_PROMPTS.length; promptIndex++) {
    try {
      const prompt = EXTRACTION_PROMPTS[promptIndex]();
      const methodName = 
        promptIndex === 0 ? 'gemini_standard' :
        promptIndex === 1 ? 'gemini_aggressive' :
        'fallback_text_only' as any;

      console.log(`🔄 Prompt ${promptIndex + 1}: Attempting ${methodName}...`);

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
          maxAttempts: 1,
          initialDelayMs: 0,
          timeoutMs: 3500, // 3.5 second timeout per attempt (aggressive)
          onRetry: (attempt, error) => {
            console.warn(`⚠️ Gemini API retry ${attempt}: ${error?.message}`);
          },
        }
      );

      const responseText = result.response.text();
      console.log(`📝 Gemini response (${methodName}):`, responseText.substring(0, 200));

      // Try to parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('⚠️ Could not find JSON in response, trying next prompt...');
        continue;
      }

      try {
        const extractedData = JSON.parse(jsonMatch[0]);
        
        // Validate extraction quality
        const confidence = evaluateExtractionQuality(extractedData, methodName);

        // Return immediately on any success (don't wait for high confidence)
        // This helps us finish within the 5s window
        if (confidence !== 'low') {
          console.log(`✅ Extraction successful (${confidence} confidence, ${methodName})`);
          return formatResult(extractedData, confidence, methodName);
        }

        // For low confidence on first attempt, try next prompt
        if (methodName === 'gemini_standard') {
          console.warn('⚠️ Low confidence on gemini_standard, trying next prompt...');
          continue;
        }

        // For other methods, return with low confidence
        return formatResult(extractedData, confidence, methodName);
      } catch (parseError) {
        console.warn('⚠️ Failed to parse JSON from response, trying next prompt...');
        continue;
      }
    } catch (error) {
      console.warn(`⚠️ Prompt ${promptIndex + 1} failed:`, error);
      continue;
    }
  }

  // All prompts failed - return manual entry required
  console.error('❌ All extraction attempts failed');
  return {
    amount: 0,
    sender: 'Unknown',
    receiver: 'Unknown',
    date: new Date().toISOString().split('T')[0],
    confidence: 'low',
    method: 'manual_required',
  };
}

/**
 * Evaluate extraction quality based on data completeness
 */
function evaluateExtractionQuality(
  data: any,
  method: string
): 'high' | 'medium' | 'low' {
  let score = 0;

  // Check amount
  if (typeof data.amount === 'number' && data.amount > 0) {
    score += 30;
  } else if (data.visible_text?.some((t: string) => /\d+(?:[.,]\d+)?/.test(t))) {
    score += 10;
  }

  // Check sender
  if (data.sender && data.sender !== 'Unknown' && data.sender !== 'Unclear') {
    score += 20;
  }

  // Check receiver
  if (data.receiver && data.receiver !== 'Unknown' && data.receiver !== 'Unclear') {
    score += 20;
  }

  // Check date
  if (data.date && data.date !== 'Unknown') {
    score += 15;
  }

  // Boost score for standard method
  if (method === 'gemini_standard') {
    score += 5;
  }

  if (score >= 75) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
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
