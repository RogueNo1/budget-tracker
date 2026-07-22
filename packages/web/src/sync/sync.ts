import type { ImportBatch, Transaction } from '@budget-tracker/core';
import { apiFetch, apiJson } from '../api/client.js';
import { getAllTransactions, putTransactions, putImport, clearTransactionsAndImports } from '../db.js';

/**
 * Simplification vs. the full Phase 8 spec, done deliberately to ship a
 * working end-to-end sync loop rather than nothing: once authenticated,
 * the server is treated as the single source of truth and every mutation
 * is followed by a full re-pull into the local IndexedDB cache, rather
 * than a proper offline mutation queue with conflict resolution. This
 * means actions taken while offline will fail with a clear error instead
 * of queuing — that queue is the main piece still missing from "real"
 * Phase 8. Given this app's realistic data size (hundreds, not millions,
 * of transactions), a full re-pull per mutation is not a performance
 * problem; it trades some efficiency for a lot of correctness-simplicity.
 *
 * KNOWN GAP: custom categories (dashboard.ts's "Manage categories" panel)
 * and per-transaction category overrides only live in local IndexedDB —
 * there's no /categories sync yet, even though the server schema and
 * routes already exist for them. A signed-in user's custom categories are
 * NOT wiped by sync (clearTransactionsAndImports is deliberately narrow —
 * it leaves `categories`/`overrides` alone), but they also don't follow
 * the user to a second device. Wiring dashboard.ts's category CRUD through
 * the API is the next piece of Phase 8 to close.
 */

/** Push whatever is currently in the local (pre-login/guest) IndexedDB cache up to the server. */
export async function pushLocalDataToServer(): Promise<{ rowsNew: number; rowsDuplicate: number }> {
  const local = await getAllTransactions();
  if (local.length === 0) return { rowsNew: 0, rowsDuplicate: 0 };

  const dateFrom = local.reduce(
    (min, t) => (t.postedDate < min ? t.postedDate : min),
    local[0]!.postedDate,
  );
  const dateTo = local.reduce((max, t) => (t.postedDate > max ? t.postedDate : max), local[0]!.postedDate);

  const body = await apiJson<{ rowsNew: number; rowsDuplicate: number }>('/imports', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'local-device-sync',
      format: 'csv',
      accountId: null,
      dateFrom,
      dateTo,
      transactions: local,
    }),
  });
  return body;
}

/** Replace the local IndexedDB cache with the server's authoritative transaction list. */
export async function pullServerDataToLocal(): Promise<number> {
  const pageSize = 500;
  let page = 1;
  const all: Transaction[] = [];

  for (;;) {
    const body = await apiJson<{ rows: unknown[]; totalPages: number }>(
      `/transactions?page=${page}&pageSize=${pageSize}&sort=date-desc`,
    );
    all.push(...(body.rows as Transaction[]));
    if (page >= body.totalPages) break;
    page++;
  }

  await clearTransactionsAndImports();
  await putTransactions(all);
  return all.length;
}

/** Pull the server's import history down into the local cache (History panel). */
export async function pullImportHistoryToLocal(): Promise<number> {
  const body = await apiJson<{ imports: Record<string, unknown>[] }>('/imports');
  for (const raw of body.imports) {
    // Postgres timestamptz columns come back as Date-serialized JSON strings
    // already (fetch's res.json() doesn't revive Dates), but normalize
    // defensively in case a caller passes an actual Date through.
    const importedAt = raw.importedAt instanceof Date ? raw.importedAt.toISOString() : String(raw.importedAt);
    const batch: ImportBatch = {
      id: String(raw.id),
      userId: String(raw.userId),
      accountId: (raw.accountId as string | null) ?? null,
      filename: String(raw.filename),
      format: raw.format as 'pdf' | 'csv',
      importedAt,
      dateFrom: String(raw.dateFrom),
      dateTo: String(raw.dateTo),
      rowsTotal: Number(raw.rowsTotal),
      rowsNew: Number(raw.rowsNew),
      rowsDuplicate: Number(raw.rowsDuplicate),
      rawFileKey: (raw.rawFileKey as string | null) ?? null,
    };
    await putImport(batch);
  }
  return body.imports.length;
}

/** Full login-time sync: push whatever local/guest data exists, then pull the merged server state (transactions + import history) down. */
export async function syncAfterLogin(): Promise<{
  pushed: { rowsNew: number; rowsDuplicate: number };
  pulledCount: number;
}> {
  const pushed = await pushLocalDataToServer();
  const pulledCount = await pullServerDataToLocal();
  await pullImportHistoryToLocal();
  return { pushed, pulledCount };
}

/** After any authenticated mutation (import, manual add, category edit), re-sync the local cache from the server. */
export async function refreshLocalCacheFromServer(): Promise<void> {
  await pullServerDataToLocal();
}

export { apiFetch };
