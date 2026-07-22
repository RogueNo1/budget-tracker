-- The register/login routes must look a user up by email before any
-- user context exists (you can't know whose context to SET LOCAL to until
-- you've found the account). This additional permissive SELECT policy
-- allows that lookup specifically when no app.current_user_id is set at
-- all — i.e. only from code paths that never entered withUserContext().
-- This is safe because only our own server ever holds Postgres
-- credentials; no client can run arbitrary SQL. Once a request IS inside
-- an authenticated user context, users_self (0001) is the only applicable
-- policy and still fully isolates row access to that one user.
CREATE POLICY users_unauthenticated_lookup ON users
  FOR SELECT
  USING (current_setting('app.current_user_id', true) IS NULL);
