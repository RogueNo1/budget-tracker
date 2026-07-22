import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_CATEGORIES, newId, type Category, type ImportBatch, type Transaction } from '@budget-tracker/core';

/**
 * Local-first offline cache. Deliberately shaped to match the future
 * Postgres rows (see CLAUDE.md §8) so Phase 8's sync layer is a transport
 * swap, not a rewrite: same field names, same id strategy (app UUIDs).
 */
interface BudgetTrackerDB extends DBSchema {
  transactions: {
    key: string; // Transaction.id
    value: Transaction;
    indexes: { 'by-fingerprint': string; 'by-postedDate': string; 'by-importId': string };
  };
  imports: {
    key: string; // ImportBatch.id
    value: ImportBatch;
  };
  overrides: {
    key: string; // transaction id
    value: { transactionId: string; categoryId: string; updatedAt: string };
  };
  categories: {
    key: string; // Category.id
    value: Category;
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'budget-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<BudgetTrackerDB>> | null = null;

function getDb(): Promise<IDBPDatabase<BudgetTrackerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BudgetTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('by-fingerprint', 'fingerprint');
        txStore.createIndex('by-postedDate', 'postedDate');
        txStore.createIndex('by-importId', 'importId');

        db.createObjectStore('imports', { keyPath: 'id' });
        db.createObjectStore('overrides', { keyPath: 'transactionId' });
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('settings');
      },
    });
  }
  return dbPromise;
}

export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAll('transactions');
}

export async function putTransactions(transactions: Transaction[]): Promise<void> {
  if (transactions.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('transactions', 'readwrite');
  await Promise.all([...transactions.map((t) => tx.store.put(t)), tx.done]);
}

/** Overwrite an existing row's identity/content (used for pending -> settled replacement). */
export async function replaceTransaction(oldId: string, replacement: Transaction): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('transactions', 'readwrite');
  await tx.store.delete(oldId);
  await tx.store.put(replacement);
  await tx.done;
}

export async function getAllImports(): Promise<ImportBatch[]> {
  const db = await getDb();
  const imports = await db.getAll('imports');
  return imports.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export async function putImport(batch: ImportBatch): Promise<void> {
  const db = await getDb();
  await db.put('imports', batch);
}

export async function setCategoryOverride(transactionId: string, categoryId: string): Promise<void> {
  const db = await getDb();
  await db.put('overrides', { transactionId, categoryId, updatedAt: new Date().toISOString() });
}

export async function getCategoryOverrides(): Promise<Map<string, string>> {
  const db = await getDb();
  const all = await db.getAll('overrides');
  return new Map(all.map((o) => [o.transactionId, o.categoryId]));
}

/**
 * User-facing category edit: records the override (source of truth for any
 * future re-categorization pass) AND updates the transaction's denormalized
 * categoryId directly, so the ledger table and charts reflect it immediately
 * without re-running the rules engine.
 */
export async function updateTransactionCategory(transactionId: string, categoryId: string): Promise<void> {
  const db = await getDb();
  await setCategoryOverride(transactionId, categoryId);
  const existing = await db.get('transactions', transactionId);
  if (existing) {
    await db.put('transactions', { ...existing, categoryId });
  }
}

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDb();
  const userCategories = await db.getAll('categories');
  const userIds = new Set(userCategories.map((c) => c.id));
  // User categories take precedence if a slug collides with a default.
  return [...DEFAULT_CATEGORIES.filter((c) => !userIds.has(c.id)), ...userCategories];
}

export async function addCategory(name: string, color: string): Promise<Category> {
  const db = await getDb();
  const id =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || newId();
  const category: Category = { id, userId: 'local', parentId: null, name: name.trim(), color };
  await db.put('categories', category);
  return category;
}

export async function addManualTransaction(input: {
  postedDate: string;
  description: string;
  amountMinor: number;
  categoryId: string;
  currency: string;
}): Promise<Transaction> {
  const db = await getDb();
  const txn: Transaction = {
    id: newId(),
    accountId: null,
    postedDate: input.postedDate,
    transactionDate: null,
    description: input.description,
    rawDescription: input.description,
    amount: input.amountMinor,
    fee: 0,
    balance: null,
    currency: input.currency,
    categoryId: input.categoryId,
    bankCategory: null,
    bankParentCategory: null,
    status: 'settled',
    source: 'manual',
    importId: null,
    fingerprint: `manual-${newId()}`,
  };
  await db.put('transactions', txn);
  return txn;
}

export async function updateManualTransaction(
  id: string,
  updates: Partial<Pick<Transaction, 'postedDate' | 'description' | 'amount' | 'categoryId'>>,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('transactions', id);
  if (!existing || existing.source !== 'manual') {
    throw new Error('Only manually-added transactions can be edited this way.');
  }
  await db.put('transactions', { ...existing, ...updates });
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('transactions', id);
}

/**
 * Clears only transactions + imports — used before a sync pull, which is
 * authoritative for those two stores. Deliberately leaves `categories` and
 * `overrides` alone: those aren't synced to the server yet (a known Phase 8
 * gap, see the note in sync/sync.ts), so wiping them here would silently
 * delete a signed-in user's custom categories on every login.
 */
export async function clearTransactionsAndImports(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear('transactions'), db.clear('imports')]);
}

/** Exposed for tests/dev tools; not used in the normal app flow. */
export async function _resetDbForTests(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.clear('transactions'),
    db.clear('imports'),
    db.clear('overrides'),
    db.clear('categories'),
    db.clear('settings'),
  ]);
}
