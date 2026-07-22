import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runImport, applyImport } from '../src/importFlow.js';
import { _resetDbForTests, getAllImports, getAllTransactions } from '../src/db.js';

const wa0002Path = path.resolve(__dirname, '../../../tests/fixtures/csv/DOC-20260316-WA0002.csv');
const wa0002Bytes = readFileSync(wa0002Path);

function wa0002File(): File {
  return new File([wa0002Bytes], 'DOC-20260316-WA0002.csv', { type: 'text/csv' });
}

describe('Phase 5 integration: import -> IndexedDB, real WA0002 fixture', () => {
  beforeEach(async () => {
    await _resetDbForTests();
  });

  it('first import auto-applies (no existing data to conflict with) and persists 105 transactions', async () => {
    const outcome = await runImport(wa0002File());
    expect(outcome.autoApplied).toBe(true);
    expect(outcome.merge.new).toHaveLength(105);
    expect(outcome.merge.duplicates).toHaveLength(0);

    const stored = await getAllTransactions();
    expect(stored).toHaveLength(105);

    const imports = await getAllImports();
    expect(imports).toHaveLength(1);
    expect(imports[0]!.rowsNew).toBe(105);
    expect(imports[0]!.filename).toBe('DOC-20260316-WA0002.csv');
  });

  it('re-importing the same file is detected as needing review (all duplicates) and does NOT auto-apply', async () => {
    await runImport(wa0002File());
    const second = await runImport(wa0002File());

    expect(second.autoApplied).toBe(false);
    expect(second.merge.new).toHaveLength(0);
    expect(second.merge.duplicates).toHaveLength(105);

    // Confirming should not have happened yet — still only 105 rows stored, one import batch.
    const stored = await getAllTransactions();
    expect(stored).toHaveLength(105);
    const imports = await getAllImports();
    expect(imports).toHaveLength(1);
  });

  it('confirming a reviewed import with only duplicates adds zero new rows but still records the batch', async () => {
    await runImport(wa0002File());
    const second = await runImport(wa0002File());
    await applyImport(second.batch, second.merge);

    const stored = await getAllTransactions();
    expect(stored).toHaveLength(105); // unchanged — all 105 were duplicates
    const imports = await getAllImports();
    expect(imports).toHaveLength(2); // both attempts recorded in history
  });

  it('cancelling a reviewed import (never calling applyImport) leaves the store untouched', async () => {
    await runImport(wa0002File());
    await runImport(wa0002File()); // needs review, but we simulate "Cancel" by just not confirming

    const stored = await getAllTransactions();
    expect(stored).toHaveLength(105);
    const imports = await getAllImports();
    expect(imports).toHaveLength(1); // only the first, auto-applied import is recorded
  });

  it('rejects an unrecognized file format with a clear error instead of corrupting the store', async () => {
    const badFile = new File(['not,a,real,capitec,export\n1,2,3,4,5'], 'random.csv', {
      type: 'text/csv',
    });
    await expect(runImport(badFile)).rejects.toThrow();
    const stored = await getAllTransactions();
    expect(stored).toHaveLength(0);
  });
});
