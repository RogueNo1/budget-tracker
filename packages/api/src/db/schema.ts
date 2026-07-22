import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  jsonb,
} from 'drizzle-orm/pg-core';

/**
 * Schema per CLAUDE.md §8, verbatim, with one addition: `refreshTokens`.
 * The spec calls for "a rotating refresh token in an HttpOnly cookie" —
 * rotation implies each token can be individually revoked (e.g. on
 * logout, or if reuse of an already-rotated token is detected, which is
 * the standard signal of token theft). A stateless JWT refresh token can't
 * be revoked before its own expiry, so this table stores a hash of each
 * issued refresh token with its status, which is what makes rotation and
 * "logout actually logs out" possible.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  settings: jsonb('settings').notNull().default({}),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  bankAccountNo: text('bank_account_no'),
  label: text('label'),
  currency: text('currency').notNull(),
});

export const imports = pgTable('imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  filename: text('filename').notNull(),
  format: text('format').notNull(), // 'pdf' | 'csv'
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  dateFrom: date('date_from'),
  dateTo: date('date_to'),
  rowsTotal: integer('rows_total').notNull().default(0),
  rowsNew: integer('rows_new').notNull().default(0),
  rowsDuplicate: integer('rows_duplicate').notNull().default(0),
  rawFileKey: text('raw_file_key'),
});

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // NULL = built-in default
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    color: text('color').notNull(),
    slug: text('slug').notNull(), // stable id used by core's categoryId (e.g. 'groceries')
  },
  (t) => ({
    uniqueUserParentName: uniqueIndex('categories_user_parent_name_key').on(
      t.userId,
      t.parentId,
      t.name,
    ),
  }),
);

export const categoryRules = pgTable('category_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // NULL = default rule
  pattern: text('pattern').notNull(),
  categoryId: text('category_id').notNull(), // slug, matches Category.slug / core's categoryId
  priority: integer('priority').notNull().default(0),
});

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey(), // app-generated UUID from core's newId(), not defaultRandom()
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    importId: uuid('import_id').references(() => imports.id, { onDelete: 'set null' }),
    postedDate: date('posted_date').notNull(),
    transactionAt: timestamp('transaction_at', { withTimezone: true }),
    description: text('description').notNull(),
    rawDescription: text('raw_description').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    feeMinor: bigint('fee_minor', { mode: 'number' }).notNull().default(0),
    balanceMinor: bigint('balance_minor', { mode: 'number' }),
    currency: text('currency').notNull(),
    categoryId: text('category_id').notNull(), // slug
    bankCategory: text('bank_category'),
    bankParentCategory: text('bank_parent_category'),
    status: text('status').notNull(), // 'settled' | 'pending'
    source: text('source').notNull(), // 'pdf' | 'csv' | 'manual'
    excluded: boolean('excluded').notNull().default(false),
    notes: text('notes'),
    fingerprint: text('fingerprint').notNull(),
  },
  (t) => ({
    uniqueUserFingerprint: uniqueIndex('transactions_user_fingerprint_key').on(
      t.userId,
      t.fingerprint,
    ),
    byUserPostedDate: index('transactions_user_posted_date_idx').on(t.userId, t.postedDate),
    byUserStatus: index('transactions_user_status_idx').on(t.userId, t.status),
  }),
);

export const transactionEvents = pgTable('transaction_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  actor: text('actor').notNull(), // 'user' | 'import' | 'system'
});

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(), // slug
    month: date('month').notNull(), // first day of month
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  },
  (t) => ({
    uniqueUserCategoryMonth: uniqueIndex('budgets_user_category_month_key').on(
      t.userId,
      t.categoryId,
      t.month,
    ),
  }),
);

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  replacedByTokenHash: text('replaced_by_token_hash'),
});
