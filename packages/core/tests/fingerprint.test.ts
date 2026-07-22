import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assignFingerprints, computeFingerprint } from '../src/dedup/fingerprint.js';
import { parseCapitecCsv } from '../src/parsers/capitecCsv.js';
import type { Transaction } from '../src/model/transaction.js';

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'x',
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
    fingerprint: '',
    ...overrides,
  };
}

describe('computeFingerprint', () => {
  it('is deterministic for identical inputs', async () => {
    const a = await computeFingerprint(makeTxn());
    const b = await computeFingerprint(makeTxn());
    expect(a).toBe(b);
  });

  it('changes when balance changes (distinguishes the two real same-day fee rows)', async () => {
    const a = await computeFingerprint(makeTxn({ balance: 745471 }));
    const b = await computeFingerprint(makeTxn({ balance: 35371 }));
    expect(a).not.toBe(b);
  });

  it('is case/whitespace-insensitive on rawDescription', async () => {
    const a = await computeFingerprint(makeTxn({ rawDescription: '  Test  Merchant ' }));
    const b = await computeFingerprint(makeTxn({ rawDescription: 'test merchant' }));
    expect(a).toBe(b);
  });

  it('changes when the amount changes', async () => {
    const a = await computeFingerprint(makeTxn({ amount: -1000 }));
    const b = await computeFingerprint(makeTxn({ amount: -1001 }));
    expect(a).not.toBe(b);
  });

  it('produces a 64-char hex sha256 digest', async () => {
    const h = await computeFingerprint(makeTxn());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('assignFingerprints — occurrence-counter fallback for null balance (PDF)', () => {
  it('gives two genuinely repeated same-day PDF rows distinct fingerprints', async () => {
    const cafeSwipe = () =>
      makeTxn({
        source: 'pdf',
        balance: null,
        transactionDate: null,
        rawDescription: 'CAFE PURCHASE',
        amount: -4800,
      });
    const [t1, t2] = await assignFingerprints([cafeSwipe(), cafeSwipe()]);
    expect(t1!.fingerprint).not.toBe(t2!.fingerprint);
  });

  it('gives identical fingerprints across two separate parses of the same PDF (re-import dedups)', async () => {
    const cafeSwipe = () =>
      makeTxn({ source: 'pdf', balance: null, transactionDate: null, rawDescription: 'CAFE PURCHASE', amount: -4800 });
    const firstImport = await assignFingerprints([cafeSwipe(), cafeSwipe()]);
    const secondImport = await assignFingerprints([cafeSwipe(), cafeSwipe()]);
    expect(firstImport.map((t) => t.fingerprint)).toEqual(secondImport.map((t) => t.fingerprint));
  });
});

describe('assignFingerprints — real WA0002 fixture', () => {
  it('produces 105 unique fingerprints (no accidental collisions) and reproduces identically on re-parse', async () => {
    const wa0002Path = fileURLToPath(
      new URL('../../../tests/fixtures/csv/DOC-20260316-WA0002.csv', import.meta.url),
    );
    const csv = readFileSync(wa0002Path, 'utf-8');

    const parsedOnce = parseCapitecCsv(csv, 'import-1');
    const fingerprintedOnce = await assignFingerprints(parsedOnce.transactions);
    const uniqueFingerprints = new Set(fingerprintedOnce.map((t) => t.fingerprint));
    expect(uniqueFingerprints.size).toBe(105);

    const parsedAgain = parseCapitecCsv(csv, 'import-2');
    const fingerprintedAgain = await assignFingerprints(parsedAgain.transactions);
    expect(fingerprintedAgain.map((t) => t.fingerprint).sort()).toEqual(
      fingerprintedOnce.map((t) => t.fingerprint).sort(),
    );
  });

  it('the two real same-day "Immediate Payment Fee" rows (Nr 19 & 21) get distinct fingerprints via balance', async () => {
    const wa0002Path = fileURLToPath(
      new URL('../../../tests/fixtures/csv/DOC-20260316-WA0002.csv', import.meta.url),
    );
    const csv = readFileSync(wa0002Path, 'utf-8');
    const parsed = parseCapitecCsv(csv);
    const feeRows = parsed.transactions.filter(
      (t) => t.description === 'Immediate Payment Fee' && t.postedDate === '2026-02-09',
    );
    expect(feeRows).toHaveLength(2);
    const fingerprinted = await assignFingerprints(feeRows);
    expect(fingerprinted[0]!.fingerprint).not.toBe(fingerprinted[1]!.fingerprint);
  });
});
