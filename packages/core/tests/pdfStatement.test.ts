import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStatementLines } from '../src/parsers/pdfStatement.js';

const fixturePath = fileURLToPath(
  new URL('../../../tests/fixtures/pdf-lines/sample-statement.json', import.meta.url),
);
const lines: string[] = JSON.parse(readFileSync(fixturePath, 'utf-8'));

describe('parseStatementLines — fixture lines', () => {
  const result = parseStatementLines(lines, 'import-pdf-1');

  it('discards beginning/ending balance rows and keeps only real transactions', () => {
    expect(result.transactions).toHaveLength(3);
  });

  it('parses a deposit correctly', () => {
    const t = result.transactions[0]!;
    expect(t.postedDate).toBe('2025-03-14');
    expect(t.amount).toBe(50000); // +500.00
    expect(t.balance).toBe(150000); // 1,500.00
    expect(t.description).toContain('Deposit Payroll Direct Dep');
  });

  it('parses a trailing-minus withdrawal as negative', () => {
    const t = result.transactions[1]!;
    expect(t.amount).toBe(-15236); // 152.36-
    expect(t.balance).toBe(134764);
  });

  it('appends a multi-line description continuation to the transaction it follows', () => {
    const t = result.transactions[1]!;
    expect(t.description).toContain('Starbucks Store #1234');
  });

  it('skips a boilerplate line ("Page 2") without corrupting the next description', () => {
    const t = result.transactions[1]!;
    expect(t.description).not.toContain('Page 2');
  });

  it('discards the dated Beginning Balance and Ending Balance rows entirely', () => {
    const descriptions = result.transactions.map((t) => t.description);
    expect(descriptions.join(' ')).not.toMatch(/balance/i);
  });

  it('parses the second withdrawal with no continuation line', () => {
    const t = result.transactions[2]!;
    expect(t.amount).toBe(-20000);
    expect(t.description).toBe('Withdrawal Check');
  });

  it('records a warning instead of silently dropping a date line with only a balance token', () => {
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/only a balance token/);
    expect(result.warnings[0]).toMatch(/4\/1\/25/);
  });

  it('sets source: pdf, currency USD, and stamps the importId on every row', () => {
    for (const t of result.transactions) {
      expect(t.source).toBe('pdf');
      expect(t.currency).toBe('USD');
      expect(t.importId).toBe('import-pdf-1');
      expect(t.id).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('computes the date range across kept transactions', () => {
    expect(result.meta.dateRange).toEqual({ from: '2025-03-14', to: '2025-03-16' });
  });
});

describe('parseStatementLines — edge cases', () => {
  it('handles a 4-digit year', () => {
    const result = parseStatementLines(['1/5/2025 ATM Withdrawal 40.00 960.00']);
    expect(result.transactions[0]!.postedDate).toBe('2025-01-05');
  });

  it('returns no transactions and no warnings for an empty line list', () => {
    const result = parseStatementLines([]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('drops a dated line with zero money tokens without a warning (not transaction-like)', () => {
    const result = parseStatementLines(['3/1/25 Statement Period Summary']);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
