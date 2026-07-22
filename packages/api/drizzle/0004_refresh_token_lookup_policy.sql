-- BUG: /auth/refresh looks up a refresh token by its hash BEFORE it knows
-- which user it belongs to (that's the whole point — the token tells you
-- the user, not the other way around). That lookup runs with no
-- app.current_user_id context set, so refresh_tokens_isolation (0001),
-- which only allows user_id = <context>, blocked it unconditionally —
-- every refresh silently returned "no rows found" / "Invalid refresh
-- token" even for a token that was issued moments ago. Same fix pattern as
-- users_unauthenticated_lookup (0002): permit SELECT specifically when no
-- user context is set. Safe for the same reason — only our own server
-- process ever holds Postgres credentials, and the actual secret is the
-- unguessable 32-byte token itself, not row visibility.
CREATE POLICY refresh_tokens_unauthenticated_lookup ON refresh_tokens
  FOR SELECT
  USING (NULLIF(current_setting('app.current_user_id', true), '') IS NULL);
