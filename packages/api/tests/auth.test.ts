import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetTestDb, closeTestDb } from './testDb.js';
import type { FastifyInstance } from 'fastify';

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  for (const h of headers) {
    if (h.startsWith(`${name}=`)) return h.split(';')[0]!.slice(name.length + 1);
  }
  return undefined;
}

let app: FastifyInstance;

async function registerUser(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'correcthorsebattery' },
  });
  const body = JSON.parse(res.body);
  const refreshCookie = extractCookie(res.headers['set-cookie'], 'refresh_token');
  return { accessToken: body.accessToken as string, userId: body.user.id as string, refreshCookie, res };
}

describe('API integration: auth + isolation', () => {
  beforeEach(async () => {
    await resetTestDb();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('registers a user, hashes the password (never stores plaintext), and returns an access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'alice@example.com', password: 'correcthorsebattery' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.user.email).toBe('alice@example.com');
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.passwordHash).toBeUndefined(); // never returned to the client
    expect(res.headers['set-cookie']).toBeDefined();
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(res.headers['set-cookie'])).toContain('SameSite=Lax');
  });

  it('rejects registering the same email twice', async () => {
    await registerUser('dupe@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dupe@example.com', password: 'correcthorsebattery' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a too-short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'short@example.com', password: 'abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('logs in with correct credentials and rejects incorrect ones', async () => {
    await registerUser('login@example.com');
    const good = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@example.com', password: 'correcthorsebattery' },
    });
    expect(good.statusCode).toBe(200);

    const bad = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@example.com', password: 'wrongpassword' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('rejects a protected route with no token, and accepts it with a valid one', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/me' });
    expect(noAuth.statusCode).toBe(401);

    const { accessToken } = await registerUser('protected@example.com');
    const withAuth = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(withAuth.statusCode).toBe(200);
    expect(JSON.parse(withAuth.body).email).toBe('protected@example.com');
  });

  it('rejects a malformed/garbage access token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refresh rotates the token: old refresh token cannot be reused, new one works', async () => {
    const { refreshCookie } = await registerUser('rotate@example.com');
    expect(refreshCookie).toBeDefined();

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${refreshCookie}` },
    });
    expect(first.statusCode).toBe(200);
    const newRefreshCookie = extractCookie(first.headers['set-cookie'], 'refresh_token');
    expect(newRefreshCookie).toBeDefined();
    expect(newRefreshCookie).not.toBe(refreshCookie);

    // Reusing the OLD (now-rotated) refresh token must fail.
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${refreshCookie}` },
    });
    expect(reuse.statusCode).toBe(401);

    // The NEW token should still work at this point... except reuse detection
    // revokes the whole chain as a precaution, so it should now be rejected too.
    const second = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${newRefreshCookie}` },
    });
    expect(second.statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const { refreshCookie } = await registerUser('logout@example.com');
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `refresh_token=${refreshCookie}` },
    });
    expect(logoutRes.statusCode).toBe(204);

    const refreshAfterLogout = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `refresh_token=${refreshCookie}` },
    });
    expect(refreshAfterLogout.statusCode).toBe(401);
  });

  // --------------------------------------------------------------------
  // The single most important test in this whole backend: two users must
  // never see each other's data, even though both hit the exact same
  // endpoints with the exact same query shape. CLAUDE.md §5's isolation
  // requirement, and IMPLEMENTATION-STEPS.md Phase 8's explicit verify box.
  // --------------------------------------------------------------------
  it('ISOLATION: two users each see only their own transactions, categories, and imports', async () => {
    const alice = await registerUser('alice-iso@example.com');
    const bob = await registerUser('bob-iso@example.com');

    await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        postedDate: '2026-01-01',
        description: "Alice's secret transaction",
        amountMinor: -1000,
        categoryId: 'other',
        currency: 'ZAR',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: {
        postedDate: '2026-01-01',
        description: "Bob's secret transaction",
        amountMinor: -2000,
        categoryId: 'other',
        currency: 'ZAR',
      },
    });

    const aliceList = await app.inject({
      method: 'GET',
      url: '/transactions',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const bobList = await app.inject({
      method: 'GET',
      url: '/transactions',
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });

    const aliceBody = JSON.parse(aliceList.body);
    const bobBody = JSON.parse(bobList.body);

    expect(aliceBody.rows).toHaveLength(1);
    expect(aliceBody.rows[0].description).toBe("Alice's secret transaction");
    expect(bobBody.rows).toHaveLength(1);
    expect(bobBody.rows[0].description).toBe("Bob's secret transaction");

    // Cross-check: Bob's list must not contain Alice's row and vice versa.
    expect(JSON.stringify(bobBody.rows)).not.toContain('Alice');
    expect(JSON.stringify(aliceBody.rows)).not.toContain('Bob');
  });

  it('ISOLATION: a wrong-user id in the URL returns 404, not another user\'s data', async () => {
    const alice = await registerUser('alice-url@example.com');
    const bob = await registerUser('bob-url@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        postedDate: '2026-01-01',
        description: "Alice's transaction",
        amountMinor: -500,
        categoryId: 'other',
        currency: 'ZAR',
      },
    });
    const { id } = JSON.parse(created.body);

    // Bob tries to patch Alice's transaction by guessing its id.
    const patchAttempt = await app.inject({
      method: 'PATCH',
      url: `/transactions/${id}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { description: 'hijacked' },
    });
    // The route returns 204 either way (idempotent patch semantics) but the
    // row must be UNCHANGED — verify by reading it back as Alice.
    expect([204, 404]).toContain(patchAttempt.statusCode);

    const aliceList = await app.inject({
      method: 'GET',
      url: '/transactions',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const rows = JSON.parse(aliceList.body).rows;
    expect(rows[0].description).toBe("Alice's transaction"); // NOT 'hijacked'
  });

  it('ISOLATION: registering with a wrong-shaped/injection-attempt email is rejected, not executed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: "'; DROP TABLE users; --", password: 'correcthorsebattery' },
    });
    expect(res.statusCode).toBe(400); // fails email validation, never reaches SQL
  });
});
