import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { newId } from '@budget-tracker/core';
import { db, withUserContext } from '../db/client.js';
import { users, refreshTokens } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  REFRESH_TOKEN_TTL_MS,
} from '../auth/tokens.js';
import { env } from '../env.js';

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});
const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

const REFRESH_COOKIE = 'refresh_token';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/auth',
    maxAge: REFRESH_TOKEN_TTL_MS / 1000,
  };
}

async function issueSession(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken(userId);
  const { token: refreshToken, hash } = generateRefreshToken();
  await withUserContext(userId, (tx) =>
    tx.insert(refreshTokens).values({
      userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    }),
  );
  return { accessToken, refreshToken };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply) => {
    const parsed = RegisterBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const { email, password } = parsed.data;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'An account with this email already exists.' });
    }

    const id = newId();
    const passwordHash = await hashPassword(password);
    await withUserContext(id, (tx) => tx.insert(users).values({ id, email, passwordHash }));

    const { accessToken, refreshToken } = await issueSession(id);
    reply.setCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    return reply.code(201).send({ user: { id, email }, accessToken });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid email or password.' });
    }
    const { email, password } = parsed.data;

    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }

    const { accessToken, refreshToken } = await issueSession(user.id);
    reply.setCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    return reply.send({ user: { id: user.id, email: user.email }, accessToken });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const incoming = request.cookies[REFRESH_COOKIE];
    if (!incoming) {
      return reply.code(401).send({ error: 'No refresh token.' });
    }
    const incomingHash = hashRefreshToken(incoming);

    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, incomingHash))
      .limit(1);
    const record = rows[0];

    reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });

    if (!record) {
      return reply.code(401).send({ error: 'Invalid refresh token.' });
    }
    if (record.revokedAt) {
      // Reuse of an already-rotated/revoked token — the standard signal of
      // token theft. Revoke the entire chain for this user as a precaution.
      await withUserContext(record.userId, (tx) =>
        tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, record.userId), isNull(refreshTokens.revokedAt))),
      );
      return reply.code(401).send({ error: 'Refresh token already used. All sessions revoked.' });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      return reply.code(401).send({ error: 'Refresh token expired.' });
    }

    const { token: newRefreshToken, hash: newHash } = generateRefreshToken();
    await withUserContext(record.userId, async (tx) => {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), replacedByTokenHash: newHash })
        .where(eq(refreshTokens.id, record.id));
      await tx.insert(refreshTokens).values({
        userId: record.userId,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      });
    });

    const accessToken = signAccessToken(record.userId);
    reply.setCookie(REFRESH_COOKIE, newRefreshToken, refreshCookieOptions());
    return reply.send({ accessToken });
  });

  app.post('/auth/logout', async (request, reply) => {
    const incoming = request.cookies[REFRESH_COOKIE];
    reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    if (!incoming) return reply.code(204).send();

    const incomingHash = hashRefreshToken(incoming);
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, incomingHash))
      .limit(1);
    const record = rows[0];
    if (record && !record.revokedAt) {
      await withUserContext(record.userId, (tx) =>
        tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, record.id)),
      );
    }
    return reply.code(204).send();
  });
}
