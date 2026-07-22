import { describe, expect, it } from 'vitest';
import { computeKpis, dominantCurrency } from '../src/budget/kpis.js';
import { balanceOverTime, spendingByCategory, weeklyIncomeExpense } from '../src/budget/chartData.js';
import { mondayOfWeek } from '../src/budget/weeks.js';
import { queryLedger } from '../src/budget/ledgerQuery.js';
import { exportTransactionsCsv } from '../src/budget/exportCsv.js';
import type { Transaction } from '../src/model/transaction.js';

function txn(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    accountId: '123',
    postedDate: '2026-01-06', // a Tuesday
    transactionDate: null,
    description: 'Test',
    rawDescription: 'TEST',
    amount: 0,
    fee: 0,
    balance: null,
    currency: 'ZAR',
    categoryId: 'other',
    bankCategory: null,
    bankParentCategory: null,
    status: 'settled',
    source: 'csv',
    importId: null,
    fingerprint: 'fp',
    ...overrides,
  };
}

describe('mondayOfWeek', () => {
  it('a Tuesday maps to the preceding Monday', () => {
    expect(mondayOfWeek('2026-01-06')).toBe('2026-01-05');
  });
  it('a Sunday maps to the preceding Monday (not the same day)', () => {
    expect(mondayOfWeek('2026-01-11')).toBe('2026-01-05');
  });
  it('a Monday maps to itself', () => {
    expect(mondayOfWeek('2026-01-05')).toBe('2026-01-05');
  });
});

describe('computeKpis', () => {
  it('computes income, expenses, fees, net cash flow', () => {
    const transactions = [
      txn({ amount: 50000, fee: 0 }), // +500.00
      txn({ amount: -9400, fee: 0 }), // -94.00
      txn({ amount: 0, fee: -100 }), // fee-only row
    ];
    const kpis = computeKpis(transactions);
    expect(kpis.totalIncomeMinor).toBe(50000);
    expect(kpis.totalExpensesMinor).toBe(9400);
    expect(kpis.feesPaidMinor).toBe(100);
    expect(kpis.netCashFlowMinor).toBe(50000 - 9400 - 100);
  });

  it('current balance is the most recent transaction by postedDate', () => {
    const transactions = [
      txn({ postedDate: '2026-01-01', balance: 1000 }),
      txn({ postedDate: '2026-01-05', balance: 2000 }),
      txn({ postedDate: '2026-01-03', balance: 1500 }),
    ];
    expect(computeKpis(transactions).currentBalanceMinor).toBe(2000);
  });

  it('counts pending transactions', () => {
    const transactions = [txn({ status: 'pending' }), txn({ status: 'settled' })];
    expect(computeKpis(transactions).pendingCount).toBe(1);
  });

  it('restricts to the dominant currency and reports it', () => {
    const transactions = [
      txn({ currency: 'ZAR', amount: 100 }),
      txn({ currency: 'ZAR', amount: 100 }),
      txn({ currency: 'USD', amount: 999999 }),
    ];
    const kpis = computeKpis(transactions);
    expect(kpis.currency).toBe('ZAR');
    expect(kpis.transactionCount).toBe(2);
  });

  it('dominantCurrency returns null for an empty list', () => {
    expect(dominantCurrency([])).toBeNull();
  });
});

describe('spendingByCategory', () => {
  it('sums expenses only, grouped by category, largest first', () => {
    const transactions = [
      txn({ categoryId: 'groceries', amount: -5000 }),
      txn({ categoryId: 'groceries', amount: -3000 }),
      txn({ categoryId: 'coffee', amount: -1000 }),
      txn({ categoryId: 'groceries', amount: 20000 }), // income, excluded
    ];
    const result = spendingByCategory(transactions);
    expect(result).toEqual([
      { categoryId: 'groceries', totalMinor: 8000 },
      { categoryId: 'coffee', totalMinor: 1000 },
    ]);
  });
});

describe('balanceOverTime', () => {
  it('is keyed by real date and chronologically sorted, not row index', () => {
    const transactions = [
      txn({ postedDate: '2026-01-05', balance: 500 }),
      txn({ postedDate: '2026-01-01', balance: 100 }),
      txn({ postedDate: '2026-01-03', balance: 300 }),
    ];
    const points = balanceOverTime(transactions);
    expect(points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-03', '2026-01-05']);
    expect(points.map((p) => p.balanceMinor)).toEqual([100, 300, 500]);
  });

  it('skips transactions with a null balance', () => {
    const transactions = [txn({ postedDate: '2026-01-01', balance: null })];
    expect(balanceOverTime(transactions)).toEqual([]);
  });
});

describe('weeklyIncomeExpense', () => {
  it('buckets by Monday-keyed week', () => {
    const transactions = [
      txn({ postedDate: '2026-01-06', amount: 1000 }), // week of Jan 5
      txn({ postedDate: '2026-01-08', amount: -500 }), // same week
      txn({ postedDate: '2026-01-13', amount: 2000 }), // week of Jan 12
    ];
    const weeks = weeklyIncomeExpense(transactions);
    expect(weeks).toEqual([
      { week: '2026-01-05', incomeMinor: 1000, expenseMinor: 500 },
      { week: '2026-01-12', incomeMinor: 2000, expenseMinor: 0 },
    ]);
  });
});

describe('queryLedger', () => {
  const transactions = [
    txn({ id: 'a', postedDate: '2026-01-01', description: 'Groceries at Pick n Pay', amount: -1000, categoryId: 'groceries' }),
    txn({ id: 'b', postedDate: '2026-01-02', description: 'Salary', amount: 50000, categoryId: 'deposits' }),
    txn({ id: 'c', postedDate: '2026-01-03', description: 'Coffee at Starbucks', amount: -500, categoryId: 'coffee' }),
  ];

  it('filters by search text (description)', () => {
    const result = queryLedger(transactions, { search: 'coffee' });
    expect(result.rows.map((r) => r.id)).toEqual(['c']);
  });

  it('filters by category', () => {
    const result = queryLedger(transactions, { categoryId: 'groceries' });
    expect(result.rows.map((r) => r.id)).toEqual(['a']);
  });

  it('filters by type: income', () => {
    const result = queryLedger(transactions, { type: 'income' });
    expect(result.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('filters by type: expense', () => {
    const result = queryLedger(transactions, { type: 'expense' });
    expect(result.rows.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  it('sorts date-desc by default', () => {
    const result = queryLedger(transactions);
    expect(result.rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts amount-asc', () => {
    const result = queryLedger(transactions, { sort: 'amount-asc' });
    expect(result.rows.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('paginates', () => {
    const result = queryLedger(transactions, { pageSize: 2, page: 2 });
    expect(result.rows).toHaveLength(1);
    expect(result.totalPages).toBe(2);
    expect(result.totalRows).toBe(3);
  });
});

describe('exportTransactionsCsv', () => {
  it('produces a quoted/escaped CSV with the expected columns', () => {
    const transactions = [
      txn({
        postedDate: '2026-01-01',
        description: 'Card Purchase: Pick n Pay, Cape Town',
        categoryId: 'groceries',
        amount: -9400,
        fee: 0,
        balance: 290217,
        status: 'settled',
      }),
    ];
    const csv = exportTransactionsCsv(transactions);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Description,Category,Money In,Money Out,Fee,Balance,Status');
    expect(lines[1]).toBe(
      '2026-01-01,"Card Purchase: Pick n Pay, Cape Town",groceries,,-94.00,,2902.17,settled',
    );
  });

  it('escapes embedded quotes', () => {
    const csv = exportTransactionsCsv([txn({ description: 'He said "hi"' })]);
    expect(csv).toContain('"He said ""hi"""');
  });
});
