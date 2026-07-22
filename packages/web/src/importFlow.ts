import {
  assignFingerprints,
  categorizeBatch,
  detectFormat,
  mergeImport,
  newId,
  parseCapitecCsv,
  parseStatementLines,
  type ImportBatch,
  type MergeResult,
  type ParseResult,
  type Transaction,
} from '@budget-tracker/core';
import { extractLines } from './pdf/extractLines.js';
import { getAllTransactions, putImport, putTransactions, replaceTransaction } from './db.js';
import { isAuthenticated } from './auth/session.js';
import { apiJson } from './api/client.js';
import { refreshLocalCacheFromServer } from './sync/sync.js';

export interface ImportOutcome {
  batch: ImportBatch;
  merge: MergeResult;
  parseWarnings: string[];
  /** True if this import had no duplicates/pending-replacements and was auto-applied without review. */
  autoApplied: boolean;
}

async function parseFile(file: File): Promise<{ result: ParseResult; format: 'pdf' | 'capitecCsv' }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(bytes);
  const importId = newId();

  if (format === 'pdf') {
    const lines = await extractLines(bytes.buffer as ArrayBuffer);
    return { result: parseStatementLines(lines, importId), format };
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  return { result: parseCapitecCsv(text, importId), format };
}

/**
 * Full pipeline for one dropped/picked file: parse -> categorize -> fingerprint
 * (all client-side — raw statement bytes never leave the browser, only the
 * normalized transactions do) -> either sync to the server (signed-in) or
 * merge into the local IndexedDB cache only (guest mode).
 *
 * SIGNED IN: the server re-runs fingerprint dedup as the source of truth
 * (see packages/api/src/routes/imports.ts), so there's nothing meaningful
 * left for a client-side "review and cancel" step to guard against —
 * duplicates are safely excluded either way. Signed-in imports always
 * auto-apply; the toast reports new/duplicate/pending-replaced counts from
 * the server's response.
 *
 * GUEST (not signed in): unchanged from Phase 5 — local mergeImport against
 * IndexedDB, review panel shown only if there's something to review.
 */
export async function runImport(file: File): Promise<ImportOutcome> {
  const { result, format } = await parseFile(file);

  const categorized = categorizeBatch(result.transactions);
  const fingerprinted = await assignFingerprints(categorized);

  const batch: ImportBatch = {
    id: fingerprinted[0]?.importId ?? newId(),
    userId: 'local',
    accountId: result.meta.account ?? null,
    filename: file.name,
    format: format === 'pdf' ? 'pdf' : 'csv',
    importedAt: new Date().toISOString(),
    dateFrom: result.meta.dateRange.from,
    dateTo: result.meta.dateRange.to,
    rowsTotal: fingerprinted.length,
    rowsNew: 0, // filled in below once we know new/duplicate counts
    rowsDuplicate: 0,
    rawFileKey: null,
  };

  if (isAuthenticated()) {
    const serverResult = await apiJson<{ rowsNew: number; rowsDuplicate: number; rowsPendingReplaced: number }>(
      '/imports',
      {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          format: format === 'pdf' ? 'pdf' : 'csv',
          // accountId is a UUID FK to the `accounts` table (CLAUDE.md §8),
          // not the bank's own account number — result.meta.account is the
          // latter (e.g. "2009932044" from the CSV). There's no UI yet to
          // create/select an `accounts` row (multi-account support is a
          // Phase 10 backlog item), so this is always null for now: every
          // signed-in user has one implicit, unlabeled account.
          accountId: null,
          dateFrom: result.meta.dateRange.from,
          dateTo: result.meta.dateRange.to,
          transactions: fingerprinted,
        }),
      },
    );
    await refreshLocalCacheFromServer();

    batch.rowsNew = serverResult.rowsNew;
    batch.rowsDuplicate = serverResult.rowsDuplicate;
    await putImport(batch); // so the local History panel reflects server-side imports too
    const emptyMerge: MergeResult = { new: [], duplicates: [], pendingReplacements: [] };
    return { batch, merge: emptyMerge, parseWarnings: result.warnings, autoApplied: true };
  }

  const existing = await getAllTransactions();
  const merge = mergeImport(existing, fingerprinted);
  batch.rowsNew = merge.new.length;
  batch.rowsDuplicate = merge.duplicates.length;

  const hasConflicts = merge.duplicates.length > 0 || merge.pendingReplacements.length > 0;

  if (!hasConflicts) {
    await applyImport(batch, merge);
    return { batch, merge, parseWarnings: result.warnings, autoApplied: true };
  }

  return { batch, merge, parseWarnings: result.warnings, autoApplied: false };
}

/** Persist a merge result locally: new rows inserted, pending rows replaced in place, batch recorded. */
export async function applyImport(batch: ImportBatch, merge: MergeResult): Promise<void> {
  await putTransactions(merge.new);
  for (const { old, replacement } of merge.pendingReplacements) {
    await replaceTransaction(old.id, replacement);
  }
  await putImport(batch);
}

export type { Transaction };

