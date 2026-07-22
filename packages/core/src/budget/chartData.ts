import type { Transaction } from '../model/transaction.js';
import { mondayOfWeek } from './weeks.js';

export interface CategorySlice {
  categoryId: string;
  totalMinor: number; // positive, spending only (expenses)
}

/** Spending (expenses only, i.e. amount < 0) grouped by category, sorted largest first. */
export function spendingByCategory(transactions: Transaction[]): CategorySlice[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + Math.abs(t.amount));
  }
  return Array.from(totals.entries())
    .map(([categoryId, totalMinor]) => ({ categoryId, totalMinor }))
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

export interface BalancePoint {
  date: string; // YYYY-MM-DD
  balanceMinor: number;
}

/**
 * Balance over time, keyed by real dates (not row index — the prototype's
 * known bug, per IMPLEMENTATION-STEPS.md Phase 6). One point per
 * transaction with a known balance, chronologically sorted; when multiple
 * transactions share a date, the last one (by transactionDate, then import
 * order) wins as that date's closing balance.
 */
export function balanceOverTime(transactions: Transaction[]): BalancePoint[] {
  const withBalance = transactions.filter((t) => t.balance !== null);
  const sorted = [...withBalance].sort((a, b) => {
    if (a.postedDate !== b.postedDate) return a.postedDate.localeCompare(b.postedDate);
    return (a.transactionDate ?? '').localeCompare(b.transactionDate ?? '');
  });
  const byDate = new Map<string, number>();
  for (const t of sorted) byDate.set(t.postedDate, t.balance as number);
  return Array.from(byDate.entries()).map(([date, balanceMinor]) => ({ date, balanceMinor }));
}

export interface WeeklyFlow {
  week: string; // Monday, YYYY-MM-DD
  incomeMinor: number;
  expenseMinor: number;
}

/** Income vs. expense, bucketed by Monday-keyed week. */
export function weeklyIncomeExpense(transactions: Transaction[]): WeeklyFlow[] {
  const buckets = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  for (const t of transactions) {
    const week = mondayOfWeek(t.postedDate);
    const bucket = buckets.get(week) ?? { incomeMinor: 0, expenseMinor: 0 };
    if (t.amount > 0) bucket.incomeMinor += t.amount;
    else if (t.amount < 0) bucket.expenseMinor += Math.abs(t.amount);
    buckets.set(week, bucket);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, v]) => ({ week, ...v }));
}
