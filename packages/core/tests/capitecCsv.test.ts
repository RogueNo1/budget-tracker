import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPITEC_HEADERS, UnknownCsvFormatError, parseCapitecCsv } from '../src/parsers/capitecCsv.js';
import type { Transaction } from '../src/model/transaction.js';

/**
 * NOTE: No real Capitec export was provided to this build (WA0001/WA0002/
 * WA0008/the April statement referenced in CLAUDE.md were never uploaded).
 * This fixture is synthetic — hand-built to match the documented 12-column
 * signature and CRLF line endings — so these tests validate the parser's
 * mechanics, not real-world data. Swap in the real fixtures and re-run this
 * suite once they're available; the row-count-style assertions in
 * IMPLEMENTATION-STEPS.md Phase 2 ("WA0001 yields 628 transactions") cannot
 * be checked until then.
 */
const fixturePath = fileURLToPath(
  new URL('../../../tests/fixtures/csv/synthetic-capitec-sample.csv', import.meta.url),
);
const sampleCsv = readFileSync(fixturePath, 'utf-8');

describe('parseCapitecCsv — synthetic fixture (CRLF)', () => {
  const result = parseCapitecCsv(sampleCsv, 'import-1');

  it('parses all 5 data rows', () => {
    expect(result.transactions).toHaveLength(5);
  });

  it('captures the account number and currency', () => {
    expect(result.meta.account).toBe('2009932044');
    expect(result.meta.currency).toBe('ZAR');
  });

  it('computes the date range from Posting Date', () => {
    expect(result.meta.dateRange).toEqual({ from: '2026-04-01', to: '2026-04-04' });
  });

  it('maps amount = moneyIn + moneyOut (inflow row)', () => {
    const t = result.transactions[0]!;
    expect(t.amount).toBe(50000); // 500.00
    expect(t.fee).toBe(0);
  });

  it('handles a quoted field containing a comma', () => {
    const t = result.transactions[1]!;
    expect(t.description).toBe('Card Purchase: Pick n Pay, Cape Town');
    expect(t.amount).toBe(-9400); // -94.00
  });

  it('maps a fee-only row: amount 0, fee negative minor units', () => {
    const t = result.transactions[2]!;
    expect(t.description).toBe('Immediate Payment Fee');
    expect(t.amount).toBe(0);
    expect(t.fee).toBe(-100); // -1.00
  });

  it('strips the "(Pending) " prefix and sets status: pending', () => {
    const t = result.transactions[3]!;
    expect(t.status).toBe('pending');
    expect(t.description).not.toMatch(/^\(Pending\)/i);
    expect(t.description).toContain("Card Purchase: Food Lover's Market");
  });

  it('parses a thousands-separated amount', () => {
    const t = result.transactions[4]!;
    expect(t.amount).toBe(123456); // 1,234.56
  });

  it('keeps bank category/parent category verbatim', () => {
    const t = result.transactions[0]!;
    expect(t.bankCategory).toBe('Digital Payments');
    expect(t.bankParentCategory).toBe('Personal & Family');
  });

  it('assigns a UUID id and the passed-in importId to every row', () => {
    for (const t of result.transactions) {
      expect(t.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(t.importId).toBe('import-1');
      expect(t.source).toBe('csv');
    }
  });

  it('produces no warnings on well-formed data', () => {
    expect(result.warnings).toEqual([]);
  });
});

const wa0002Path = fileURLToPath(
  new URL('../../../tests/fixtures/csv/DOC-20260316-WA0002.csv', import.meta.url),
);
const wa0002Csv = readFileSync(wa0002Path, 'utf-8');

describe('parseCapitecCsv — real fixture DOC-20260316-WA0002.csv', () => {
  const result = parseCapitecCsv(wa0002Csv, 'import-wa0002');

  it('parses all 105 rows with zero warnings', () => {
    expect(result.transactions).toHaveLength(105);
    expect(result.warnings).toEqual([]);
  });

  it('captures the account and ZAR currency', () => {
    expect(result.meta.account).toBe('2009932044');
    expect(result.meta.currency).toBe('ZAR');
  });

  it('computes the correct date range', () => {
    expect(result.meta.dateRange).toEqual({ from: '2026-02-01', to: '2026-03-16' });
  });

  it('strips "(Pending) " from the one pending row and marks it pending', () => {
    const pendingRows = result.transactions.filter((t) => t.status === 'pending');
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0]!.description).toBe('Dl Bolt Cpt (Card 3221)');
  });

  it('treats the pending row\'s blank Balance as null', () => {
    const pendingRows = result.transactions.filter((t) => t.status === 'pending');
    expect(pendingRows[0]!.balance).toBeNull();
  });

  it('handles amounts with a single fractional digit ("225.2" -> 22520 minor units)', () => {
    // Row 1: Balance "383.2" (no CSV field has literally one digit, but several
    // balances do, e.g. row Nr 105 balance "380.67" is 2-digit; check a genuine
    // 1-digit case from the file instead: row Nr 2 balance "335.2".
    const t = result.transactions.find((tx) => tx.rawDescription.includes('VARSITYCAFE'));
    expect(t).toBeDefined();
    expect(t!.balance).toBe(33520);
  });

  it('handles amounts with no decimal point at all ("-48" -> -4800 minor units)', () => {
    const t = result.transactions.find((tx) => tx.rawDescription.includes('VARSITYCAFE'));
    expect(t!.amount).toBe(-4800);
  });

  it('correctly distinguishes two same-day same-amount fee rows by balance', () => {
    // Nr 19 and Nr 21: both "Immediate Payment Fee", same date, same fee
    // (-1.00), but different running balances — proves balance is load-bearing
    // for later fingerprinting, not just a display field.
    const feeRows = result.transactions.filter(
      (t) => t.description === 'Immediate Payment Fee' && t.postedDate === '2026-02-09',
    );
    expect(feeRows).toHaveLength(2);
    const balances = feeRows.map((t) => t.balance).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(balances).toEqual([35371, 745471]);
  });

  it('re-parsing the same file twice is deterministic except for id', () => {
    const again = parseCapitecCsv(wa0002Csv, 'import-wa0002');
    expect(again.transactions).toHaveLength(result.transactions.length);
    const strip = (t: Transaction) => {
      const { id, ...rest } = t;
      return rest;
    };
    expect(again.transactions.map(strip)).toEqual(result.transactions.map(strip));
  });
});

describe('parseCapitecCsv — tokenizer edge cases', () => {
  it('handles LF-only line endings', () => {
    const csv = `${CAPITEC_HEADERS.join(',')}\n1,123,2026-01-01,,Test,Test,Cat,Cat,10.00,,,100.00\n`;
    const result = parseCapitecCsv(csv);
    expect(result.transactions).toHaveLength(1);
  });

  it('handles a trailing newline without producing a phantom row', () => {
    const csv = `${CAPITEC_HEADERS.join(',')}\n1,123,2026-01-01,,Test,Test,Cat,Cat,10.00,,,100.00\n\n\n`;
    const result = parseCapitecCsv(csv);
    expect(result.transactions).toHaveLength(1);
  });

  it('handles escaped double-quotes inside a quoted field', () => {
    const csv = `${CAPITEC_HEADERS.join(',')}\n1,123,2026-01-01,,"He said ""hi"" today",Test,Cat,Cat,10.00,,,100.00\n`;
    const result = parseCapitecCsv(csv);
    expect(result.transactions[0]!.description).toBe('He said "hi" today');
  });

  it('throws a typed UnknownCsvFormatError listing expected columns for an unrecognized header', () => {
    const csv = 'Date,Amount,Description\n2026-01-01,10.00,Test\n';
    expect(() => parseCapitecCsv(csv)).toThrow(UnknownCsvFormatError);
    try {
      parseCapitecCsv(csv);
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownCsvFormatError);
      expect((e as InstanceType<typeof UnknownCsvFormatError>).expectedHeaders).toEqual(
        CAPITEC_HEADERS,
      );
    }
  });

  it('emits a warning and skips a row with a missing Posting Date instead of throwing', () => {
    const csv = `${CAPITEC_HEADERS.join(',')}\n1,123,,,Test,Test,Cat,Cat,10.00,,,100.00\n`;
    const result = parseCapitecCsv(csv);
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/missing Posting Date/);
  });

  it('treats a blank Balance cell as null, not 0', () => {
    const csv = `${CAPITEC_HEADERS.join(',')}\n1,123,2026-01-01,,Test,Test,Cat,Cat,10.00,,,\n`;
    const result = parseCapitecCsv(csv);
    expect(result.transactions[0]!.balance).toBeNull();
  });
});
