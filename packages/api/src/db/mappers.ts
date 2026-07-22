import type { Transaction } from '@budget-tracker/core';
import type { transactions } from './schema.js';

/**
 * Maps a Drizzle transactions row (JS-cased fields already, e.g.
 * `amountMinor`, `transactionAt: Date | null`) to the wire/core Transaction
 * shape every client (web app, future mobile, etc.) expects — the same
 * shape POST /imports accepts, so the API's contract is symmetric.
 */
export function dbRowToCoreTxn(row: typeof transactions.$inferSelect): Transaction {
  return {
    id: row.id,
    accountId: row.accountId,
    postedDate: row.postedDate,
    transactionDate: row.transactionAt ? row.transactionAt.toISOString() : null,
    description: row.description,
    rawDescription: row.rawDescription,
    amount: row.amountMinor,
    fee: row.feeMinor,
    balance: row.balanceMinor,
    currency: row.currency,
    categoryId: row.categoryId,
    bankCategory: row.bankCategory,
    bankParentCategory: row.bankParentCategory,
    status: row.status as 'settled' | 'pending',
    source: row.source as 'pdf' | 'csv' | 'manual',
    importId: row.importId,
    fingerprint: row.fingerprint,
  };
}
