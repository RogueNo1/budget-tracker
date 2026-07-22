import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { env } from '../env.js';

const client = postgres(env.DATABASE_URL, { max: 10 });
export const db: PostgresJsDatabase<typeof schema> = drizzle(client, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a Postgres transaction with `app.current_user_id` set via
 * SET LOCAL. This is what makes the RLS policies in
 * drizzle/0001_rls_policies.sql actually scope every query to `userId` —
 * SET LOCAL only lasts for the transaction, so there's no risk of one
 * request's user context leaking into a pooled connection reused by another
 * request.
 *
 * This is the *second* fence. Route handlers still filter by userId in
 * their own WHERE clauses (the primary fence, per CLAUDE.md §5) — if a
 * handler ever forgets to, RLS is what stops a cross-user read/write
 * instead of silently succeeding.
 *
 * SET LOCAL doesn't accept a bind-parameter placeholder for its value, so
 * the uuid is interpolated directly — safe only because it's validated
 * against a strict UUID shape first (defense in depth on top of the fact
 * that callers only ever pass a userId that already came from a verified
 * JWT, never raw client input).
 */
export async function withUserContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) {
    throw new Error(`withUserContext: userId is not a valid UUID: ${userId}`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.current_user_id = '${userId}'`));
    return fn(tx);
  });
}
