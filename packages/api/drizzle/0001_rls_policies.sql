-- Row-level security: the second fence behind app-level `WHERE user_id = ?`
-- filtering. Every authenticated request runs its DB work inside a
-- transaction that does `SET LOCAL app.current_user_id = '<uuid>'` first
-- (see src/db/withUserContext.ts); these policies compare that session
-- setting against each row's user_id. If the app ever forgets a WHERE
-- clause, RLS still blocks cross-user reads/writes at the database level.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- users: a row can only see/touch itself.
CREATE POLICY users_self ON users
  USING (id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY accounts_isolation ON accounts
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY imports_isolation ON imports
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- categories: built-in defaults (user_id IS NULL) are visible to everyone
-- but not writable by anyone through this policy; user-owned rows are
-- fully isolated.
CREATE POLICY categories_isolation ON categories
  USING (user_id IS NULL OR user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY category_rules_isolation ON category_rules
  USING (user_id IS NULL OR user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY transactions_isolation ON transactions
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY transaction_events_isolation ON transaction_events
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY budgets_isolation ON budgets
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
