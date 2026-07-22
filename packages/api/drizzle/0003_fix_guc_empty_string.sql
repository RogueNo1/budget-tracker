-- BUG FOUND during integration testing: Postgres custom (placeholder) GUCs
-- like app.current_user_id are NULL only until the FIRST time they're
-- referenced in a session. After that first SET LOCAL + COMMIT, the value
-- reverts to '' (empty string), not NULL — because the placeholder now
-- formally exists with an empty default. On a pooled connection reused
-- across requests, this meant the second request on a given connection hit
-- `''::uuid`, which throws invalid_text_representation instead of
-- evaluating to a safe "no match".
--
-- Fix: wrap every current_setting(...)::uuid cast in NULLIF(..., '') so an
-- empty string is treated the same as unset (NULL) before casting.

DROP POLICY users_self ON users;
CREATE POLICY users_self ON users
  USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY users_unauthenticated_lookup ON users;
CREATE POLICY users_unauthenticated_lookup ON users
  FOR SELECT
  USING (NULLIF(current_setting('app.current_user_id', true), '') IS NULL);

DROP POLICY accounts_isolation ON accounts;
CREATE POLICY accounts_isolation ON accounts
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY imports_isolation ON imports;
CREATE POLICY imports_isolation ON imports
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY categories_isolation ON categories;
CREATE POLICY categories_isolation ON categories
  USING (user_id IS NULL OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY category_rules_isolation ON category_rules;
CREATE POLICY category_rules_isolation ON category_rules
  USING (user_id IS NULL OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY transactions_isolation ON transactions;
CREATE POLICY transactions_isolation ON transactions
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY transaction_events_isolation ON transaction_events;
CREATE POLICY transaction_events_isolation ON transaction_events
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY budgets_isolation ON budgets;
CREATE POLICY budgets_isolation ON budgets
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY refresh_tokens_isolation ON refresh_tokens;
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
