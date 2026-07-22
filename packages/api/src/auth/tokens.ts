import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { env } from '../env.js';

const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AccessTokenPayload {
  sub: string; // userId
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

/** Throws if invalid/expired. Callers (the auth preHandler) turn that into a 401. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    throw new Error('Malformed access token payload');
  }
  return { sub: decoded.sub };
}

/**
 * Opaque refresh tokens (not JWT): a random value handed to the client,
 * only its SHA-256 hash stored server-side. This is what makes true
 * revocation possible (logout, or reuse-of-a-rotated-token detection,
 * which is the standard signal of token theft) — a self-contained signed
 * JWT refresh token can't be invalidated before its own expiry.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
