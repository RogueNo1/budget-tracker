import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeKpis } from '@budget-tracker/core';
import { runImport } from '../src/importFlow.js';
import {
  _resetDbForTests,
  addCategory,
  addManualTransaction,
  deleteTransaction,
  getAllCategories,
  getAllTransactions,
  updateManualTransaction,
  updateTransactionCategory,
} from '../src/db.js';

const wa0002Path = path.resolve(__dirname, '../../../tests/fixtures/csv/DOC-20260316-WA0002.csv');
const wa0002Bytes = readFileSync(wa0002Path);
function wa0002File(): File {
  return new File([wa0002Bytes], 'DOC-20260316-WA0002.csv', { type: 'text/csv' });
}

describe('Phase 6 integration: category editing, manual transactions, KPIs', () => {
  beforeEach(async () => {
    await _resetDbForTests();
  });

  it('getAllCategories returns the 16 defaults when no user categories exist', async () => {
    const categories = await getAllCategories();
    expect(categories.length).toBe(16);
    expect(categories.find((c) => c.id === 'groceries')).toBeDefined();
  });

  it('addCategory persists a new user category and it appears in getAllCategories', async () => {
    await addCategory('Pet Supplies', '#ff8800');
    const categories = await getAllCategories();
    const found = categories.find((c) => c.name === 'Pet Supplies');
    expect(found).toBeDefined();
    expect(found!.color).toBe('#ff8800');
    expect(found!.id).toBe('pet-supplies');
  });

  it('updateTransactionCategory changes categoryId on the stored transaction (visible immediately, no re-import needed)', async () => {
    await runImport(wa0002File());
    const before = await getAllTransactions();
    const target = before[0]!;
    await updateTransactionCategory(target.id, 'my-custom-cat');
    const after = await getAllTransactions();
    const updated = after.find((t) => t.id === target.id);
    expect(updated!.categoryId).toBe('my-custom-cat');
  });

  it('addManualTransaction creates a source:manual transaction included in KPI totals', async () => {
    await addManualTransaction({
      postedDate: '2026-05-01',
      description: 'Cash gift',
      amountMinor: 10000,
      categoryId: 'other',
      currency: 'ZAR',
    });
    const all = await getAllTransactions();
    expect(all).toHaveLength(1);
    expect(all[0]!.source).toBe('manual');
    const kpis = computeKpis(all);
    expect(kpis.totalIncomeMinor).toBe(10000);
  });

  it('updateManualTransaction edits a manual row; rejects editing a non-manual row', async () => {
    const manual = await addManualTransaction({
      postedDate: '2026-05-01',
      description: 'Cash gift',
      amountMinor: 10000,
      categoryId: 'other',
      currency: 'ZAR',
    });
    await updateManualTransaction(manual.id, { description: 'Birthday gift' });
    const all = await getAllTransactions();
    expect(all[0]!.description).toBe('Birthday gift');

    await runImport(wa0002File());
    const imported = (await getAllTransactions()).find((t) => t.source === 'csv')!;
    await expect(updateManualTransaction(imported.id, { description: 'nope' })).rejects.toThrow();
  });

  it('deleteTransaction removes a manual transaction', async () => {
    const manual = await addManualTransaction({
      postedDate: '2026-05-01',
      description: 'Cash gift',
      amountMinor: 10000,
      categoryId: 'other',
      currency: 'ZAR',
    });
    await deleteTransaction(manual.id);
    const all = await getAllTransactions();
    expect(all).toHaveLength(0);
  });

  it('KPIs computed on the real WA0002 import are internally consistent (net = income - expenses - fees)', async () => {
    await runImport(wa0002File());
    const all = await getAllTransactions();
    const kpis = computeKpis(all);
    expect(kpis.netCashFlowMinor).toBe(
      kpis.totalIncomeMinor - kpis.totalExpensesMinor - kpis.feesPaidMinor,
    );
    expect(kpis.transactionCount).toBe(105);
    expect(kpis.currency).toBe('ZAR');
  });
});
