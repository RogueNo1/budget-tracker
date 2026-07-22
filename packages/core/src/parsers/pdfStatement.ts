import { newId } from '../model/id.js';
import { toMinor } from '../model/money.js';
import type { ParseResult, Transaction } from '../model/transaction.js';

const DATE_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
const AMOUNT_RE = /\$?-?[\d,]+\.\d{2}-?/g;
const BARE_AMOUNT_RE = /^\$?-?[\d,]+\.\d{2}-?$/;
const SKIP_LINE_RE =
  /^(Date|Transaction Type|Disclosures|Member #|Page \d|Your savings|Loan number|If you think|In Case of|Telephone or write|We will tell|If we decide|This error correction|\* This error|\*\* If you|\*\*\* If you|Special Rule)/i;

interface RawStatementTxn {
  dateStr: string;
  isoDate: string;
  type: string;
  description: string;
  amountMinor: number;
  direction: 'deposit' | 'withdrawal' | null;
  balanceMinor: number;
}

/** "3/14/25" or "03/14/2025" -> "2025-03-14". Two-digit years are 2000+y, per the prototype. */
function parseDateToIso(dateStr: string): string {
  const bits = dateStr.split('/').map((n) => parseInt(n, 10));
  const m = bits[0] ?? 1;
  const d = bits[1] ?? 1;
  let y = bits[2] ?? 0;
  if (y < 100) y += 2000;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse the y-bucketed, top-to-bottom text lines already extracted from a
 * PDF page (see packages/web/src/pdf/extractLines.ts for the pdf.js side of
 * this). Pure function — no DOM, testable against hand-written fixtures.
 *
 * Ported from budget-ledger.html's parseTransactions/parseDate, with one
 * fix: a date line carrying only a single money token (a balance, with no
 * transaction amount) used to be silently dropped by the final
 * `filter(t => direction)`. It's still dropped — there's no amount to
 * record — but now it's recorded as a warning instead of vanishing.
 */
export function parseStatementLines(lines: string[], importId: string | null = null): ParseResult {
  const warnings: string[] = [];
  const raw: RawStatementTxn[] = [];
  let current: RawStatementTxn | null = null;

  lines.forEach((line, idx) => {
    const dm = line.match(DATE_RE);
    if (dm) {
      if (current) raw.push(current);

      const dateStr = dm[1] ?? dm[0];
      const rest = line.slice(dm[0].length).trim();

      if (/beginning balance|ending balance/i.test(rest)) {
        current = null;
        return;
      }

      const amounts = rest.match(AMOUNT_RE) || [];
      if (amounts.length === 0) {
        current = null;
        return;
      }
      if (amounts.length === 1) {
        warnings.push(
          `Line ${idx + 1}: date line "${dateStr}" has only a balance token, no transaction amount — skipped ("${line}").`,
        );
        current = null;
        return;
      }

      const balanceTok = amounts[amounts.length - 1]!;
      const amountTok = amounts[0]!;

      let typeText = rest;
      amounts.forEach((a) => {
        typeText = typeText.replace(a, '');
      });
      typeText = typeText.replace(/\*\*\d+\s*:\s*[^\w]*[A-Za-z ]*$/, '').trim();
      typeText = typeText.replace(/\s{2,}/g, ' ').trim();

      const isNeg = amountTok.trim().endsWith('-');
      const amountAbs = Math.abs(toMinor(amountTok));
      const amountMinor = isNeg ? -amountAbs : amountAbs;
      const direction: 'deposit' | 'withdrawal' = isNeg ? 'withdrawal' : 'deposit';

      current = {
        dateStr,
        isoDate: parseDateToIso(dateStr),
        type: typeText || '(transaction)',
        description: '',
        amountMinor,
        direction,
        balanceMinor: toMinor(balanceTok),
      };
    } else if (current) {
      if (SKIP_LINE_RE.test(line)) return;
      if (BARE_AMOUNT_RE.test(line)) return;
      current.description += (current.description ? ' ' : '') + line;
    }
  });
  if (current) raw.push(current);

  const kept = raw.filter((t): t is RawStatementTxn & { direction: 'deposit' | 'withdrawal' } =>
    Boolean(t.direction),
  );

  let minDate: string | undefined;
  let maxDate: string | undefined;

  const transactions: Transaction[] = kept.map((t) => {
    if (!minDate || t.isoDate < minDate) minDate = t.isoDate;
    if (!maxDate || t.isoDate > maxDate) maxDate = t.isoDate;
    const description = t.description ? `${t.type} ${t.description}` : t.type;
    return {
      id: newId(),
      accountId: null,
      postedDate: t.isoDate,
      transactionDate: null,
      description,
      rawDescription: description,
      amount: t.amountMinor,
      fee: 0,
      balance: t.balanceMinor,
      currency: 'USD',
      // Seeded by the categorize rules engine in Phase 4; PDF has no bank category.
      categoryId: 'uncategorised',
      bankCategory: null,
      bankParentCategory: null,
      status: 'settled',
      source: 'pdf',
      importId,
      fingerprint: '',
    };
  });

  return {
    transactions,
    warnings,
    meta: { currency: 'USD', dateRange: { from: minDate ?? '', to: maxDate ?? '' } },
  };
}
