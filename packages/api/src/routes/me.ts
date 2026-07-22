import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';
import { withUserContext } from '../db/client.js';
import { users } from '../db/schema.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const rows = await withUserContext(userId, (tx) =>
      tx.select().from(users).where(eq(users.id, userId)).limit(1),
    );
    const user = rows[0];
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    return reply.send({
      id: user.id,
      email: user.email,
      settings: user.settings,
      createdAt: user.createdAt,
    });
  });
}
