import { describe, expect, it } from 'vitest';
import { resolveCategoryId } from '../src/categorize/categorize.js';
import { DEFAULT_CATEGORY_RULES } from '../src/categorize/defaultRules.js';

describe('resolveCategoryId — seeding order', () => {
  const pdfLikeTxn = {
    description: 'Debit Card Purchase Starbucks Store #1234',
    rawDescription: 'Debit Card Purchase Starbucks Store #1234',
    bankCategory: null,
  };

  it('an explicit override always wins', () => {
    expect(resolveCategoryId(pdfLikeTxn, DEFAULT_CATEGORY_RULES, 'my-custom-cat')).toBe(
      'my-custom-cat',
    );
  });

  it('falls through to a default rule when there is no override or bank category (PDF case)', () => {
    expect(resolveCategoryId(pdfLikeTxn, DEFAULT_CATEGORY_RULES)).toBe('coffee');
  });

  it('bank category (CSV) wins over default rules when present', () => {
    const csvLikeTxn = {
      description: 'Card Purchase: Starbucks Sandton',
      rawDescription: 'STARBUCKS SANDTON ZA',
      bankCategory: 'Coffee Shops', // a CSV-provided category, distinct from the default rule's 'coffee' id
    };
    expect(resolveCategoryId(csvLikeTxn, DEFAULT_CATEGORY_RULES)).toBe('Coffee Shops');
  });

  it('a user rule outranks bank category', () => {
    const csvLikeTxn = {
      description: 'Card Purchase: Starbucks Sandton',
      rawDescription: 'STARBUCKS SANDTON ZA',
      bankCategory: 'Coffee Shops',
    };
    const rulesWithUserOverride = [
      ...DEFAULT_CATEGORY_RULES,
      { id: 'user-1', userId: 'user-abc', categoryId: 'personal-treats', priority: 999, pattern: 'starbucks' },
    ];
    expect(resolveCategoryId(csvLikeTxn, rulesWithUserOverride)).toBe('personal-treats');
  });

  it('falls back to "other" when nothing matches', () => {
    const unmatched = {
      description: 'Some Unrecognized Merchant XYZ',
      rawDescription: 'UNRECOGNIZED MERCHANT XYZ',
      bankCategory: null,
    };
    expect(resolveCategoryId(unmatched, DEFAULT_CATEGORY_RULES)).toBe('other');
  });

  it('the first matching default rule wins (rule order is priority-significant)', () => {
    // "fee" would match the generic Fees rule, but a more specific rule earlier
    // in priority should win when both match.
    const t = {
      description: 'Staff Fee Talent Trust Agency',
      rawDescription: 'STAFF FEE TALENT.TRUST AGENCY',
      bankCategory: null,
    };
    expect(resolveCategoryId(t, DEFAULT_CATEGORY_RULES)).toBe('staff-fee');
  });
});
