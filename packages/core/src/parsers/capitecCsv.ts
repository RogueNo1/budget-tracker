import { newId } from '../model/id.js';
import { toMinor } from '../model/money.js';
import type { ParseResult, Transaction } from '../model/transaction.js';

/** The 12-column Capitec export header signature (CLAUDE.md §2.2). */
export const CAPITEC_HEADERS = [
  'Nr',
  'Account',
  'Posting Date',
  'Transaction Date',
  'Description',
  'Original Description',
  'Parent Category',
  'Category',
  'Money In',
  'Money Out',
  'Fee',
  'Balance',
] as const;

export class UnknownCsvFormatError extends Error {
  expectedHeaders: readonly string[];
  constructor(message: string, expectedHeaders: readonly string[] = CAPITEC_HEADERS) {
    super(message);
    this.name = 'UnknownCsvFormatError';
    this.expectedHeaders = expectedHeaders;
  }
}

/** Normalize CRLF/LF and drop a trailing blank line left by a trailing newline. */
function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Tokenize one CSV line honouring double-quoted fields (commas inside quotes
 * don't split) and escaped quotes (`""` inside a quoted field -> `"`).
 */
function tokenizeCsvLine(line: string): string[] {
  const cols: string[] = [];
  let inQuotes = false;
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

/**
 * Parse a Capitec transaction-history CSV export into the common schema.
 * Pure function, no DOM access — unit-testable against fixture text.
 */
export function parseCapitecCsv(text: string, importId: string | null = null): ParseResult {
  const warnings: string[] = [];
  const lines = splitLines(text);

  if (lines.length === 0) {
    throw new UnknownCsvFormatError('The CSV file is empty.');
  }

  const headerLine = lines[0] ?? '';
  const headers = tokenizeCsvLine(headerLine);
  const missing = CAPITEC_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new UnknownCsvFormatError(
      `Unrecognized CSV header — this doesn't look like a Capitec export. Expected columns: ${CAPITEC_HEADERS.join(', ')}. Missing: ${missing.join(', ')}.`,
    );
  }

  const transactions: Transaction[] = [];
  let account: string | undefined;
  let minDate: string | undefined;
  let maxDate: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    if (rawLine.trim() === '') continue;

    const cols = tokenizeCsvLine(rawLine);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] ?? '').trim();
    });

    // Nr is per-file only and never used as identity, but its absence marks a
    // malformed/blank row — same filter the prototype uses.
    if (!row['Nr']) continue;

    const postingDate = row['Posting Date'] || '';
    if (!postingDate) {
      warnings.push(`Row ${i + 1} (Nr ${row['Nr']}): missing Posting Date — skipped.`);
      continue;
    }

    let description = row['Description'] || '';
    let status: 'settled' | 'pending' = 'settled';
    const pendingMatch = description.match(/^\(Pending\)\s*/i);
    if (pendingMatch) {
      status = 'pending';
      description = description.slice(pendingMatch[0].length);
    }

    const moneyIn = toMinor(row['Money In'] || '');
    const moneyOut = toMinor(row['Money Out'] || '');
    const fee = toMinor(row['Fee'] || '');
    const amount = moneyIn + moneyOut;
    const balanceRaw = row['Balance'] || '';
    const balance = balanceRaw === '' ? null : toMinor(balanceRaw);

    const acct = row['Account'] || '';
    if (!account && acct) account = acct;

    const bankCategory = row['Category'] || null;
    const bankParentCategory = row['Parent Category'] || null;

    const txn: Transaction = {
      id: newId(),
      accountId: acct || null,
      postedDate: postingDate,
      transactionDate: row['Transaction Date'] || null,
      description,
      rawDescription: row['Original Description'] || '',
      amount,
      fee,
      balance,
      currency: 'ZAR',
      // Bank category seeds categoryId as a display-safe placeholder; the
      // categorize service (Phase 4) resolves this to a real Category.id.
      categoryId: bankCategory ?? 'uncategorised',
      bankCategory,
      bankParentCategory,
      status,
      source: 'csv',
      importId,
      fingerprint: '', // computed by dedup/fingerprint.ts (Phase 4)
    };
    transactions.push(txn);

    if (!minDate || postingDate < minDate) minDate = postingDate;
    if (!maxDate || postingDate > maxDate) maxDate = postingDate;
  }

  return {
    transactions,
    warnings,
    meta: {
      account,
      currency: 'ZAR',
      dateRange: { from: minDate ?? '', to: maxDate ?? '' },
    },
  };
}
