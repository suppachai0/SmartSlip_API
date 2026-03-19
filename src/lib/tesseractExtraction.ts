import Tesseract from 'tesseract.js';

export interface SlipExtractionResult {
  amount: number;
  sender: string;
  receiver: string;
  date: string;
  confidence: 'high' | 'medium' | 'low';
  method: 'tesseract' | 'fallback_manual';
}

/**
 * Extract Thai bank slip data using Tesseract.js OCR
 * Free, runs locally on Vercel - no API calls needed
 */
export async function extractSlipDataWithTesseract(
  imageBuffer: Buffer
): Promise<SlipExtractionResult> {
  console.log('🤖 Starting Tesseract OCR extraction...');

  try {
    // Convert buffer to base64 for Tesseract
    const base64Image = imageBuffer.toString('base64');
    const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

    console.log('📝 Recognizing text with Tesseract...');
    
    // Run OCR
    const result = await Tesseract.recognize(
      imageDataUrl,
      ['tha', 'eng'], // Thai + English languages
      {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            console.log(`⏳ OCR Progress: ${(m.progress * 100).toFixed(1)}%`);
          }
        },
      }
    );

    const extractedText = result.data.text;
    console.log(`✅ OCR Complete. Confidence: ${(result.data.confidence).toFixed(1)}%`);
    console.log(`📄 Extracted text preview: ${extractedText.substring(0, 100)}...`);

    // Parse extracted text to find amount, sender, receiver, date
    const extraction = parseSlipText(extractedText);

    return {
      amount: extraction.amount,
      sender: extraction.sender,
      receiver: extraction.receiver,
      date: extraction.date,
      confidence: extraction.confidence,
      method: 'tesseract',
    };
  } catch (error) {
    console.error('❌ Tesseract extraction failed:', error);
    return {
      amount: 0,
      sender: 'Unknown',
      receiver: 'Unknown',
      date: new Date().toISOString().split('T')[0],
      confidence: 'low',
      method: 'fallback_manual',
    };
  }
}

/**
 * Parse extracted text to find slip data
 */
function parseSlipText(text: string): {
  amount: number;
  sender: string;
  receiver: string;
  date: string;
  confidence: 'high' | 'medium' | 'low';
} {
  // Split into lines for easier parsing
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

  let amount = 0;
  let sender = 'Unknown';
  let receiver = 'Unknown';
  let date = new Date().toISOString().split('T')[0];
  let foundAmount = false;
  let foundSender = false;
  let foundReceiver = false;
  let foundDate = false;

  // Look for patterns in the text
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';

    // Amount: look for numbers with Thai Baht symbol or large numbers
    if (!foundAmount && /[฿$]|จำนวน|เงิน|amount/i.test(line)) {
      const amountMatch = line.match(/(\d+[.,]?\d*)/);
      if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(',', '.'));
        foundAmount = true;
        console.log(`💰 Found amount: ${amount}`);
      }
    }

    // Amount: also search in next line if current line has amount keyword
    if (!foundAmount && /[฿$]|จำนวน|amount/i.test(line) && nextLine) {
      const amountMatch = nextLine.match(/(\d+[.,]?\d+)/);
      if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(',', '.'));
        foundAmount = true;
        console.log(`💰 Found amount: ${amount}`);
      }
    }

    // Sender: look for name patterns after "ผู้ส่ง" or "From"
    if (!foundSender && /ผู้ส่ง|หรือจาก|from|sender/i.test(line)) {
      // Try to get name from next line
      if (nextLine && nextLine.length > 2 && !/[฿$0-9]/.test(nextLine)) {
        sender = nextLine;
        foundSender = true;
        console.log(`👤 Found sender: ${sender}`);
      }
    }

    // Receiver: look for name patterns after "ผู้รับ" or "To"
    if (!foundReceiver && /ผู้รับ|ถึง|to|receiver/i.test(line)) {
      // Try to get name from next line
      if (nextLine && nextLine.length > 2 && !/[฿$0-9]/.test(nextLine)) {
        receiver = nextLine;
        foundReceiver = true;
        console.log(`👤 Found receiver: ${receiver}`);
      }
    }

    // Date: look for date patterns (dd/mm/yyyy or similar)
    if (!foundDate && /วันที่|date/i.test(line)) {
      const dateMatch = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        const fullYear = parseInt(year) > 2500 ? (parseInt(year) - 543).toString() : year;
        date = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        foundDate = true;
        console.log(`📅 Found date: ${date}`);
      } else if (nextLine) {
        const dateMatch2 = nextLine.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (dateMatch2) {
          const [, day, month, year] = dateMatch2;
          const fullYear = parseInt(year) > 2500 ? (parseInt(year) - 543).toString() : year;
          date = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          foundDate = true;
          console.log(`📅 Found date: ${date}`);
        }
      }
    }
  }

  // Evaluate confidence based on what we found
  let confidence: 'high' | 'medium' | 'low' = 'low';
  const foundCount = [foundAmount, foundSender, foundReceiver, foundDate].filter((x) => x).length;

  if (foundCount === 4 && amount > 0) {
    confidence = 'high';
  } else if (foundCount >= 3 && amount > 0) {
    confidence = 'medium';
  }

  return {
    amount,
    sender,
    receiver,
    date,
    confidence,
  };
}
