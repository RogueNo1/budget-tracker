import type { Transaction } from '../model/transaction.js';

/**
 * SHA-256 via the Web Crypto API (globalThis.crypto.subtle) rather than
 * node:crypto — this keeps `core` framework-free and identical in the
 * browser (web) and Node (api); both environments expose crypto.subtle.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeDescription(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The non-balance fields of the fingerprint key, shared between the real
 * hash and the occurrence-counter dedup key used when balance is null.
 */
function baseKey(
  t: Pick<Transaction, 'accountId' | 'postedDate' | 'transactionDate' | 'amount' | 'fee' | 'rawDescription'>,
): string {
  return [
    t.accountId ?? '',
    t.postedDate,
    t.transactionDate ?? '',
    String(t.amount),
    String(t.fee),
    normalizeDescription(t.rawDescription),
  ].join('|');
}

/**
 * CLAUDE.md §7: sha256(accountId | postedDate | amount | fee |
 * normalisedRawDescription | balance). transactionDate is folded into the
 * base key too — CLAUDE.md's prose calls out "Transaction Date time and
 * balance" as what distinguishes two legitimate same-day, same-amount
 * transactions (e.g. two R48 café swipes); since CSV always has a
 * Transaction Date and PDF never does, including it here only sharpens
 * CSV fingerprints and is a no-op for PDF (where the occurrence-counter
 * fallback below is what actually does that job).
 *
 * When `balance` is null (PDF statements don't carry a per-row balance
 * usable this way in every layout, or a row is genuinely missing one),
 * pass `occurrenceIndex` — the 0-based count of prior transactions in this
 * same import sharing the same base key — so re-importing the same file
 * still dedups cleanly while genuinely repeated rows within one statement
 * (two identical purchases) survive as distinct fingerprints.
 */
export async function computeFingerprint(
  t: Pick<
    Transaction,
    'accountId' | 'postedDate' | 'transactionDate' | 'amount' | 'fee' | 'rawDescription' | 'balance'
  >,
  occurrenceIndex?: number,
): Promise<string> {
  const key = baseKey(t);
  const balancePart = t.balance === null ? 'NULL' : String(t.balance);
  const parts = [key, balancePart];
  if (t.balance === null && occurrenceIndex !== undefined) {
    parts.push(String(occurrenceIndex));
  }
  return sha256Hex(parts.join('|'));
}

/**
 * Assign a fingerprint to every transaction in a freshly-parsed batch,
 * applying the occurrence-counter fallback for balance-less rows in import
 * order. Pure/async, no store access — returns new objects, doesn't mutate.
 */
export async function assignFingerprints(transactions: Transaction[]): Promise<Transaction[]> {
  const seenCounts = new Map<string, number>();
  const out: Transaction[] = [];

  for (const t of transactions) {
    let occurrenceIndex: number | undefined;
    if (t.balance === null) {
      const key = baseKey(t);
      const count = seenCounts.get(key) ?? 0;
      occurrenceIndex = count;
      seenCounts.set(key, count + 1);
    }
    const fingerprint = await computeFingerprint(t, occurrenceIndex);
    out.push({ ...t, fingerprint });
  }

  return out;
}
