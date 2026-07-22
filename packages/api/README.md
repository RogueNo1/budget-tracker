# Budget Tracker API — local setup

## 1. Postgres

```bash
# Debian/Ubuntu
sudo apt-get install postgresql
sudo service postgresql start

sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres createdb budget_tracker_dev
sudo -u postgres createdb budget_tracker_test   # only needed to run the test suite

# A non-superuser app role — REQUIRED. RLS policies are silently bypassed by
# superusers/table owners, so the app must never connect as `postgres`.
sudo -u postgres psql -d budget_tracker_dev <<'SQL'
CREATE ROLE app_user WITH LOGIN PASSWORD 'app_user_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE budget_tracker_dev TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
SQL
# Repeat against budget_tracker_test if you'll run the test suite.
```

## 2. Schema + RLS policies

```bash
cd packages/api
DATABASE_URL="postgres://postgres:postgres@localhost:5432/budget_tracker_dev" npx drizzle-kit push --force

# Apply RLS policies in order (not managed by drizzle-kit push):
for f in drizzle/0*.sql; do
  PGPASSWORD=postgres psql -h localhost -U postgres -d budget_tracker_dev -f "$f"
done
```

Repeat both steps against `budget_tracker_test` if you'll run `npm test`.

## 3. Seed default categories/rules

Must run as the `postgres` superuser (the seed inserts `user_id IS NULL` rows, which
`app_user` is blocked from writing by RLS's `WITH CHECK` — intentionally, since only an
administrative/seeding process should create built-ins).

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5432/budget_tracker_dev" \
JWT_ACCESS_SECRET="any-placeholder-16-chars-min" \
JWT_REFRESH_SECRET="any-placeholder-16-chars-min" \
npm run db:seed
```

## 4. Environment variables (for actually running the app)

Create `packages/api/.env` (or export these):

```
DATABASE_URL=postgres://app_user:app_user_pw@localhost:5432/budget_tracker_dev
JWT_ACCESS_SECRET=<32+ random bytes, e.g. `openssl rand -base64 32`>
JWT_REFRESH_SECRET=<a different 32+ random bytes>
PORT=3001
NODE_ENV=development
```

**Note:** the app must connect via `app_user`, not `postgres` — see the RLS note above.

## 5. Run it

```bash
npm run dev      # tsx watch src/server.ts
npm run build && npm start   # production
npm test          # requires budget_tracker_test set up per steps 1-2 above;
                   # vitest.config.ts points at it with hardcoded local dev credentials
```

## Why RLS needs `app_user`, and what "second fence" means

Every route filters queries by `request.userId` (from the verified JWT) in its own
WHERE clause — that's the primary fence. Postgres Row-Level Security is the second: each
authenticated request runs inside a transaction that does
`SET LOCAL app.current_user_id = '<uuid>'`, and every table's RLS policy compares that
against `user_id`. If a route handler ever forgot a WHERE clause, RLS still blocks the
cross-user read/write at the database level — but only because the app connects as a
non-superuser role. Connecting as `postgres` (or any role that owns the tables) makes
Postgres skip RLS entirely, silently, with no error — so this is not optional.

## Known simplification vs. a "real" migration tool

Schema changes here are applied via `drizzle-kit push` (introspect-and-diff) rather than
versioned `drizzle-kit generate` migration files, and RLS policies are hand-written SQL
in `drizzle/0001..0004*.sql` applied manually/in a script — not integrated into Drizzle's
own migration runner. This is fine for one environment but should move to
`drizzle-kit generate` + a migration runner (or Postgres-native RLS support in whichever
migration tool you standardize on) before there's a real staging/production split.
