import postgres from 'postgres';

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/budget_tracker_test';

const admin = postgres(ADMIN_URL);

/** Wipes all user-generated data but keeps the seeded built-in categories/rules (user_id IS NULL). */
export async function resetTestDb(): Promise<void> {
  await admin.unsafe(`
    TRUNCATE TABLE transaction_events, refresh_tokens, transactions, imports, budgets, accounts CASCADE;
    DELETE FROM category_rules WHERE user_id IS NOT NULL;
    DELETE FROM categories WHERE user_id IS NOT NULL;
    DELETE FROM users;
  `);
}

export async function closeTestDb(): Promise<void> {
  await admin.end();
}
