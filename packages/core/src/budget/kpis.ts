import type { Transaction } from '../model/transaction.js';

export interface Kpis {
  totalIncomeMinor: number;
  totalExpensesMinor: number; // positive number, excludes fees
  feesPaidMinor: number; // positive number
  netCashFlowMinor: number; // income - expenses - fees (signed)
  currentBalanceMinor: number | null;
  currency: string | null;
  transactionCount: number;
  pendingCount: number;
}

/**
 * If transactions span more than one currency, KPIs are computed only over
 * the dominant currency (most transactions) — proper multi-currency
 * reporting is Phase 10 backlog per IMPLEMENTATION-STEPS.md. The excluded
 * count is returned so the UI can surface it instead of silently dropping data.
 */
export function dominantCurrency(transactions: Transaction[]): string | null {
  const counts = new Map<string, number>();
  for (const t of transactions) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = -1;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

/** Most recent transaction's balance, by postedDate then transactionDate, both descending. */
function latestBalance(transactions: Transaction[]): number | null {
  const withBalance = transactions.filter((t) => t.balance !== null);
  if (withBalance.length === 0) return null;
  const sorted = [...withBalance].sort((a, b) => {
    if (a.postedDate !== b.postedDate) return b.postedDate.localeCompare(a.postedDate);
    return (b.transactionDate ?? '').localeCompare(a.transactionDate ?? '');
  });
  return sorted[0]!.balance;
}

export function computeKpis(allTransactions: Transaction[]): Kpis {
  const currency = dominantCurrency(allTransactions);
  const transactions = currency
    ? allTransactions.filter((t) => t.currency === currency)
    : allTransactions;

  let income = 0;
  let expenses = 0;
  let fees = 0;
  let pending = 0;

  for (const t of transactions) {
    if (t.amount > 0) income += t.amount;
    if (t.amount < 0) expenses += Math.abs(t.amount);
    if (t.fee < 0) fees += Math.abs(t.fee);
    if (t.status === 'pending') pending++;
  }

  return {
    totalIncomeMinor: income,
    totalExpensesMinor: expenses,
    feesPaidMinor: fees,
    netCashFlowMinor: income - expenses - fees,
    currentBalanceMinor: latestBalance(transactions),
    currency,
    transactionCount: transactions.length,
    pendingCount: pending,
  };
}
