import { google, sheets_v4 } from 'googleapis';

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) {
    return sheetsClient;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    } as any,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export interface AppendReceiptRowPayload {
  receiptId: string;
  userId: string;
  storeName: string;
  amount: number;
  issueDate?: Date | string;
  items?: unknown;
  imageURL?: string;
  status?: string;
  confidence?: string;
  timestamp?: Date | string;
  spreadsheetId?: string; // User's personal sheet; falls back to GOOGLE_SHEETS_ID
}

export async function appendReceiptToSheet(
  payload: AppendReceiptRowPayload
): Promise<void> {
  const spreadsheetId = payload.spreadsheetId || process.env.GOOGLE_SHEETS_ID;
  const tabName = process.env.GOOGLE_SHEETS_TAB || 'Receipts';

  if (!spreadsheetId) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not configured, skipping append');
    return;
  }

  try {
    const sheets = getSheetsClient();

    const timestamp = payload.timestamp
      ? new Date(payload.timestamp)
      : new Date();
    const issueDate = payload.issueDate
      ? new Date(payload.issueDate)
      : undefined;

    const values = [
      [
        timestamp.toISOString(),
        payload.receiptId,
        payload.userId,
        payload.storeName,
        payload.amount,
        issueDate ? issueDate.toISOString().split('T')[0] : '',
        JSON.stringify(payload.items ?? []),
        payload.imageURL || '',
        payload.status || 'pending',
        payload.confidence || 'unknown',
      ],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A:J`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    console.log('[Sheets] Appended receipt row successfully');
  } catch (error) {
    console.error('[Sheets] Failed to append receipt row:', error);
    throw error;
  }
}
