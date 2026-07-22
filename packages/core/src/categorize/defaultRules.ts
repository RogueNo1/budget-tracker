import type { Category, CategoryRule } from '../model/transaction.js';

/**
 * Ported verbatim from budget-ledger.html's CATEGORY_RULES (lines 207-222).
 * Order is significant — first match wins, so priority descends by index.
 * userId: null marks these as built-in defaults, shared across all users;
 * users can add their own rules later (higher priority, see categorize.ts).
 */
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  { id: 'default-health-insurance', userId: null, categoryId: 'health-insurance', priority: 140, pattern: 'health insur|blue cross|bcbs|aetna|cigna|united ?health|medical insur' },
  { id: 'default-tithe', userId: null, categoryId: 'tithe', priority: 130, pattern: '\\btithe\\b' },
  { id: 'default-donations', userId: null, categoryId: 'donations', priority: 120, pattern: 'ywam|donation|charity|nonprofit|non-profit|missions?' },
  { id: 'default-rent', userId: null, categoryId: 'rent', priority: 110, pattern: '\\brent\\b|landlord|apartment|lease' },
  { id: 'default-staff-fee', userId: null, categoryId: 'staff-fee', priority: 100, pattern: 'staff fee|talent\\.?trust|agency fee' },
  { id: 'default-coffee', userId: null, categoryId: 'coffee', priority: 90, pattern: 'starbucks|coffee|dunkin|caribou' },
  { id: 'default-dining', userId: null, categoryId: 'dining', priority: 80, pattern: 'restaurant|mcdonald|chipotle|doordash|grubhub|uber ?eats' },
  { id: 'default-groceries', userId: null, categoryId: 'groceries', priority: 70, pattern: 'grocery|walmart|kroger|aldi|trader joe|meijer|whole foods' },
  { id: 'default-subscriptions', userId: null, categoryId: 'subscriptions', priority: 60, pattern: 'uber \\*one|netflix|spotify|hulu|subscription|membership' },
  { id: 'default-data', userId: null, categoryId: 'data', priority: 50, pattern: '\\bdata\\b|verizon|at&t|t-mobile|tmobile|internet|comcast|xfinity|data plan' },
  { id: 'default-transportation', userId: null, categoryId: 'transportation', priority: 40, pattern: 'uber|lyft|gas station|shell|exxon|chevron|parking' },
  { id: 'default-fees', userId: null, categoryId: 'fees', priority: 30, pattern: 'foreign cur con|overdraft|nsf|service fee|\\bfee\\b' },
  { id: 'default-atm-cash', userId: null, categoryId: 'atm-cash', priority: 20, pattern: 'atm\\/(dep|wdr)' },
  { id: 'default-deposits', userId: null, categoryId: 'deposits', priority: 10, pattern: 'remote dep capture|mobile deposit|payroll|direct dep|salary|paycheck' },
];

/** Ported from budget-ledger.html's CAT_COLORS, plus 'other' and 'uncategorised'. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'coffee', userId: null, parentId: null, name: 'Coffee', color: '#A9713C' },
  { id: 'rent', userId: null, parentId: null, name: 'Rent', color: '#6B4F3A' },
  { id: 'staff-fee', userId: null, parentId: null, name: 'Staff Fee', color: '#9B8556' },
  { id: 'atm-cash', userId: null, parentId: null, name: 'ATM & Cash', color: '#C1602B' },
  { id: 'deposits', userId: null, parentId: null, name: 'Deposits', color: '#4FB99F' },
  { id: 'dining', userId: null, parentId: null, name: 'Dining', color: '#D18B4A' },
  { id: 'fees', userId: null, parentId: null, name: 'Fees', color: '#8C4A2A' },
  { id: 'tithe', userId: null, parentId: null, name: 'Tithe', color: '#3F8F76' },
  { id: 'groceries', userId: null, parentId: null, name: 'Groceries', color: '#5E9A87' },
  { id: 'subscriptions', userId: null, parentId: null, name: 'Subscriptions', color: '#D4A73D' },
  { id: 'transportation', userId: null, parentId: null, name: 'Transportation', color: '#C98F4C' },
  { id: 'health-insurance', userId: null, parentId: null, name: 'Health Insurance', color: '#5B87A6' },
  { id: 'data', userId: null, parentId: null, name: 'Data', color: '#7A8FA0' },
  { id: 'donations', userId: null, parentId: null, name: 'Donations', color: '#4C9C82' },
  { id: 'other', userId: null, parentId: null, name: 'Other', color: '#8A7F6A' },
  { id: 'uncategorised', userId: null, parentId: null, name: 'Uncategorised', color: '#B8AFA1' },
];
