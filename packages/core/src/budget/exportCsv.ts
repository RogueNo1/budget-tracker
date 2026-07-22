import type { Transaction } from '../model/transaction.js';

const EXPORT_COLUMNS = [
  'Date',
  'Description',
  'Category',
  'Money In',
  'Money Out',
  'Fee',
  'Balance',
  'Status',
] as const;

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function minorToPlainDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${cents}`;
}

/** Export a (typically already-filtered) transaction list as a quoted/escaped CSV string. */
export function exportTransactionsCsv(transactions: Transaction[]): string {
  const lines = [EXPORT_COLUMNS.join(',')];

  for (const t of transactions) {
    const moneyIn = t.amount > 0 ? minorToPlainDecimal(t.amount) : '';
    const moneyOut = t.amount < 0 ? minorToPlainDecimal(t.amount) : '';
    const fee = t.fee !== 0 ? minorToPlainDecimal(t.fee) : '';
    const balance = t.balance !== null ? minorToPlainDecimal(t.balance) : '';

    const row = [
      t.postedDate,
      t.description,
      t.categoryId,
      moneyIn,
      moneyOut,
      fee,
      balance,
      t.status,
    ].map(csvField);

    lines.push(row.join(','));
  }

  return lines.join('\r\n');
}
