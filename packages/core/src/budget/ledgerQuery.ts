import type { Transaction } from '../model/transaction.js';

export type LedgerSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';
export type LedgerTypeFilter = 'all' | 'income' | 'expense';

export interface LedgerQuery {
  search?: string;
  categoryId?: string | 'all';
  type?: LedgerTypeFilter;
  sort?: LedgerSort;
  page?: number; // 1-based
  pageSize?: number;
}

export interface LedgerPage {
  rows: Transaction[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const SORTERS: Record<LedgerSort, (a: Transaction, b: Transaction) => number> = {
  'date-desc': (a, b) => b.postedDate.localeCompare(a.postedDate) || b.id.localeCompare(a.id),
  'date-asc': (a, b) => a.postedDate.localeCompare(b.postedDate) || a.id.localeCompare(b.id),
  'amount-desc': (a, b) => b.amount - a.amount,
  'amount-asc': (a, b) => a.amount - b.amount,
};

export function queryLedger(transactions: Transaction[], query: LedgerQuery = {}): LedgerPage {
  const { search = '', categoryId = 'all', type = 'all', sort = 'date-desc', page = 1, pageSize = 20 } =
    query;

  let filtered = transactions;

  if (search.trim()) {
    const needle = search.trim().toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.description.toLowerCase().includes(needle) ||
        t.rawDescription.toLowerCase().includes(needle),
    );
  }

  if (categoryId !== 'all') {
    filtered = filtered.filter((t) => t.categoryId === categoryId);
  }

  if (type === 'income') filtered = filtered.filter((t) => t.amount > 0);
  if (type === 'expense') filtered = filtered.filter((t) => t.amount < 0);

  const sorted = [...filtered].sort(SORTERS[sort]);

  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize);

  return { rows, totalRows, page: safePage, pageSize, totalPages };
}
