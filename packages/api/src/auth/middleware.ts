import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * Extracts the userId from a verified access token and attaches it to the
 * request. Route handlers then filter every query by `request.userId` —
 * never by any id the client might supply in the URL/body (CLAUDE.md §5:
 * "never trust a client-supplied user id").
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing or malformed Authorization header.' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    request.userId = payload.sub;
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired access token.' });
  }
}
