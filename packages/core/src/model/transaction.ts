/**
 * Common internal transaction schema (CLAUDE.md §2.4).
 * Both the CSV and PDF parsers map into this shape; all downstream code
 * (dedup, budget math, UI) consumes only this shape.
 */
export interface Transaction {
  /** Stable app-generated UUID — never the CSV `Nr`, never an array index. */
  id: string;
  /** Bank account number when known (CSV); null for PDF. */
  accountId: string | null;
  /** ISO YYYY-MM-DD — the canonical date for sorting/reporting. */
  postedDate: string;
  /** ISO datetime when available (CSV only); null for PDF. */
  transactionDate: string | null;
  /** Clean display description (CSV Description / PDF type+description). */
  description: string;
  /** Original Description (CSV) or the raw reconstructed line (PDF). */
  rawDescription: string;
  /**
   * SIGNED amount in minor units (integer cents): inflow > 0, outflow < 0.
   * CSV: moneyIn + moneyOut (one is always 0) | PDF: signed parsed amount.
   */
  amount: number;
  /** <= 0, in minor units. CSV Fee column; 0 for PDF (fees are their own rows there). */
  fee: number;
  /** Running balance after the transaction, in minor units, when the source provides it. */
  balance: number | null;
  /** ISO 4217, e.g. 'ZAR' | 'USD' — from source detection, not hardcoded. */
  currency: string;
  /** App category id; seeded from bank category or the rules engine, user overrides win. */
  categoryId: string;
  /** CSV Category, verbatim (provenance). Null for PDF/manual. */
  bankCategory: string | null;
  /** CSV Parent Category, verbatim (provenance). Null for PDF/manual. */
  bankParentCategory: string | null;
  status: 'settled' | 'pending';
  /** How this transaction entered the system. */
  source: 'pdf' | 'csv' | 'manual';
  /** FK to the import batch that produced it (null for manual). */
  importId: string | null;
  /** Dedup hash (see §7 / dedup/fingerprint.ts). */
  fingerprint: string;
}

export interface Category {
  id: string;
  /** null = built-in default category (shared across all users). */
  userId: string | null;
  parentId: string | null;
  name: string;
  color: string;
}

export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  /** First day of the budget month, ISO YYYY-MM-DD. */
  month: string;
  amountMinor: number;
}

export interface ImportBatch {
  id: string;
  userId: string;
  accountId: string | null;
  filename: string;
  format: 'pdf' | 'csv';
  importedAt: string;
  dateFrom: string;
  dateTo: string;
  rowsTotal: number;
  rowsNew: number;
  rowsDuplicate: number;
  rawFileKey: string | null;
}

export interface ParseMeta {
  account?: string;
  currency: string;
  dateRange: { from: string; to: string };
}

/**
 * Return shape for every parser module (CSV, PDF, future formats).
 * Parsers are pure functions with no DOM access — this makes them
 * unit-testable against fixtures with no browser/runtime needed.
 */
export interface ParseResult {
  transactions: Transaction[];
  warnings: string[];
  meta: ParseMeta;
}

export interface CategoryRule {
  id: string;
  userId: string | null;
  pattern: string;
  categoryId: string;
  priority: number;
}
