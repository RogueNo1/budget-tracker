import type { CategoryRule, Transaction } from '../model/transaction.js';
import { DEFAULT_CATEGORY_RULES } from './defaultRules.js';

/**
 * Resolve a transaction's category. Seeding order (IMPLEMENTATION-STEPS.md
 * Phase 4): explicit user override > user rule > bank category (CSV) >
 * default rule > 'Other'.
 *
 * This function only decides the *initial* seed for a freshly-parsed
 * transaction. An `explicit user override` is a category the user already
 * chose for this exact transaction (tracked by id, e.g. after a previous
 * import + edit) — pass it in as `overrideCategoryId` if the caller has one;
 * this module has no store access of its own (core stays framework/IO-free).
 */
export function resolveCategoryId(
  t: Pick<Transaction, 'description' | 'rawDescription' | 'bankCategory'>,
  rules: CategoryRule[] = DEFAULT_CATEGORY_RULES,
  overrideCategoryId?: string | null,
): string {
  if (overrideCategoryId) return overrideCategoryId;

  const haystack = `${t.description} ${t.rawDescription}`;

  const userRules = rules
    .filter((r) => r.userId !== null)
    .sort((a, b) => b.priority - a.priority);
  for (const r of userRules) {
    if (new RegExp(r.pattern, 'i').test(haystack)) return r.categoryId;
  }

  if (t.bankCategory) return t.bankCategory;

  const defaultRules = rules
    .filter((r) => r.userId === null)
    .sort((a, b) => b.priority - a.priority);
  for (const r of defaultRules) {
    if (new RegExp(r.pattern, 'i').test(haystack)) return r.categoryId;
  }

  return 'other';
}

/**
 * Apply resolveCategoryId across a batch of freshly-parsed transactions.
 * `overrides` maps transaction id -> categoryId for the rare case a batch
 * already carries known overrides (e.g. re-categorizing after a rule edit).
 */
export function categorizeBatch(
  transactions: Transaction[],
  rules: CategoryRule[] = DEFAULT_CATEGORY_RULES,
  overrides: Map<string, string> = new Map(),
): Transaction[] {
  return transactions.map((t) => ({
    ...t,
    categoryId: resolveCategoryId(t, rules, overrides.get(t.id) ?? null),
  }));
}
