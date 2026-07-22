import type { Transaction } from '../model/transaction.js';

export interface PendingReplacement {
  /** The existing pending transaction being superseded. */
  old: Transaction;
  /** The incoming settled transaction that supersedes it. */
  replacement: Transaction;
}

export interface MergeResult {
  /** Transactions to insert — genuinely new, not already in the store. */
  new: Transaction[];
  /** Incoming transactions whose fingerprint already exists in the store. */
  duplicates: Transaction[];
  /** Existing pending rows matched to an incoming settled row. */
  pendingReplacements: PendingReplacement[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How many days apart a pending row and its settled twin may post. */
const PENDING_MATCH_WINDOW_DAYS = 5;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / MS_PER_DAY;
}

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Loose containment match — settled descriptions often add detail a pending row didn't have yet. */
function descriptionsLikelyMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function findPendingTwin(
  incoming: Transaction,
  existingPendingPool: Transaction[],
  alreadyMatched: Set<string>,
): Transaction | undefined {
  return existingPendingPool.find(
    (e) =>
      !alreadyMatched.has(e.id) &&
      e.accountId === incoming.accountId &&
      e.amount === incoming.amount &&
      daysBetween(e.postedDate, incoming.postedDate) <= PENDING_MATCH_WINDOW_DAYS &&
      descriptionsLikelyMatch(e.rawDescription, incoming.rawDescription),
  );
}

/**
 * Merge a freshly-parsed (and already-fingerprinted, see dedup/fingerprint.ts)
 * incoming batch against the existing store. Pure function — never mutates
 * its inputs and never touches user-edited fields (categoryId, notes, etc.)
 * on existing rows; it only classifies incoming rows into new / duplicate /
 * pending-replacement so the caller (IndexedDB in Phase 5, Postgres in
 * Phase 7) can apply the actual write.
 */
export function mergeImport(existing: Transaction[], incoming: Transaction[]): MergeResult {
  const existingFingerprints = new Set(existing.map((t) => t.fingerprint));
  const existingPendingPool = existing.filter((t) => t.status === 'pending');
  const matchedPendingIds = new Set<string>();

  const result: MergeResult = { new: [], duplicates: [], pendingReplacements: [] };

  for (const t of incoming) {
    if (existingFingerprints.has(t.fingerprint)) {
      result.duplicates.push(t);
      continue;
    }

    if (t.status === 'settled') {
      const twin = findPendingTwin(t, existingPendingPool, matchedPendingIds);
      if (twin) {
        matchedPendingIds.add(twin.id);
        result.pendingReplacements.push({ old: twin, replacement: t });
        continue;
      }
    }

    result.new.push(t);
  }

  return result;
}
