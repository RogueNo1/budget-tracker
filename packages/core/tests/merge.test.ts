import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assignFingerprints } from '../src/dedup/fingerprint.js';
import { mergeImport } from '../src/dedup/merge.js';
import { parseCapitecCsv } from '../src/parsers/capitecCsv.js';
import type { Transaction } from '../src/model/transaction.js';

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    accountId: '123',
    postedDate: '2026-01-01',
    transactionDate: '2026-01-01 10:00',
    description: 'Test',
    rawDescription: 'TEST MERCHANT',
    amount: -1000,
    fee: 0,
    balance: 5000,
    currency: 'ZAR',
    categoryId: 'other',
    bankCategory: null,
    bankParentCategory: null,
    status: 'settled',
    source: 'csv',
    importId: null,
    fingerprint: overrides.fingerprint ?? 'fp-default',
    ...overrides,
  };
}

describe('mergeImport — synthetic cases', () => {
  it('classifies a transaction with a new fingerprint as new', () => {
    const existing = [makeTxn({ fingerprint: 'fp-a' })];
    const incoming = [makeTxn({ fingerprint: 'fp-b' })];
    const result = mergeImport(existing, incoming);
    expect(result.new).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);
  });

  it('classifies a transaction with an existing fingerprint as a duplicate', () => {
    const existing = [makeTxn({ fingerprint: 'fp-a' })];
    const incoming = [makeTxn({ fingerprint: 'fp-a' })];
    const result = mergeImport(existing, incoming);
    expect(result.duplicates).toHaveLength(1);
    expect(result.new).toHaveLength(0);
  });

  it('never mutates the existing array or its objects', () => {
    const existingTxn = makeTxn({ fingerprint: 'fp-a', categoryId: 'user-edited-category' });
    const existing = [existingTxn];
    const incoming = [makeTxn({ fingerprint: 'fp-a' })];
    mergeImport(existing, incoming);
    expect(existing[0]).toBe(existingTxn);
    expect(existing[0]!.categoryId).toBe('user-edited-category');
  });

  it('matches an incoming settled transaction to an existing pending twin (same account/amount, close date, similar description)', () => {
    const existing = [
      makeTxn({
        id: 'pending-1',
        fingerprint: 'fp-pending',
        status: 'pending',
        rawDescription: 'FOOD LOVERS MARKET',
        amount: -4800,
        postedDate: '2026-04-03',
      }),
    ];
    const incoming = [
      makeTxn({
        id: 'settled-1',
        fingerprint: 'fp-settled',
        status: 'settled',
        rawDescription: 'FOOD LOVERS MARKET POTCHEFSTROOM',
        amount: -4800,
        postedDate: '2026-04-04',
      }),
    ];
    const result = mergeImport(existing, incoming);
    expect(result.pendingReplacements).toHaveLength(1);
    expect(result.pendingReplacements[0]!.old.id).toBe('pending-1');
    expect(result.pendingReplacements[0]!.replacement.id).toBe('settled-1');
    expect(result.new).toHaveLength(0);
  });

  it('does not match a settled transaction to a pending row with a different amount', () => {
    const existing = [
      makeTxn({ id: 'pending-1', fingerprint: 'fp-pending', status: 'pending', amount: -4800 }),
    ];
    const incoming = [
      makeTxn({ id: 'settled-1', fingerprint: 'fp-settled', status: 'settled', amount: -9900 }),
    ];
    const result = mergeImport(existing, incoming);
    expect(result.pendingReplacements).toHaveLength(0);
    expect(result.new).toHaveLength(1);
  });

  it('imports a pending row with no settled twin as new, not a replacement', () => {
    const existing: Transaction[] = [];
    const incoming = [makeTxn({ id: 'pending-1', fingerprint: 'fp-pending', status: 'pending' })];
    const result = mergeImport(existing, incoming);
    expect(result.new).toHaveLength(1);
    expect(result.pendingReplacements).toHaveLength(0);
  });

  it('two identical same-day repeated rows within one incoming batch both survive if fingerprints differ', () => {
    const existing: Transaction[] = [];
    const incoming = [makeTxn({ fingerprint: 'fp-1' }), makeTxn({ fingerprint: 'fp-2' })];
    const result = mergeImport(existing, incoming);
    expect(result.new).toHaveLength(2);
  });
});

/**
 * The spec's decisive Phase 4 test is "parse WA0001, then merge WA0002: 0
 * new, 105 duplicates" — WA0001 was never uploaded to this build, so that
 * exact test can't run. The closest honest proxy with only real data: parse
 * the real WA0002 file, treat it as the existing store, then merge a fresh
 * parse of the *same* file. Every row should come back a duplicate and
 * nothing new — which is the same mechanism the real test exercises (a
 * fully-overlapping import produces 0 new / all duplicate), just without a
 * second, larger file to overlap against.
 */
describe('mergeImport — real WA0002 fixture, self-merge proxy for the WA0001⊃WA0002 test', () => {
  it('re-importing the identical file yields 0 new, 105 duplicates', async () => {
    const wa0002Path = fileURLToPath(
      new URL('../../../tests/fixtures/csv/DOC-20260316-WA0002.csv', import.meta.url),
    );
    const csv = readFileSync(wa0002Path, 'utf-8');

    const firstParse = parseCapitecCsv(csv, 'import-1');
    const firstFingerprinted = await assignFingerprints(firstParse.transactions);

    const secondParse = parseCapitecCsv(csv, 'import-2');
    const secondFingerprinted = await assignFingerprints(secondParse.transactions);

    const result = mergeImport(firstFingerprinted, secondFingerprinted);
    expect(result.new).toHaveLength(0);
    expect(result.duplicates).toHaveLength(105);
  });
});
