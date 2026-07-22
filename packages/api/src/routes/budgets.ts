import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';
import { withUserContext } from '../db/client.js';
import { budgets } from '../db/schema.js';

const MonthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
const PutBody = z.object({
  entries: z.array(z.object({ categoryId: z.string(), amountMinor: z.number().int() })),
});

export async function budgetsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/budgets', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = MonthQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'month must be YYYY-MM.' });
    const userId = request.userId!;
    const monthDate = `${parsed.data.month}-01`;
    const rows = await withUserContext(userId, (tx) =>
      tx.select().from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.month, monthDate))),
    );
    return reply.send({ budgets: rows });
  });

  app.put('/budgets', { preHandler: requireAuth }, async (request, reply) => {
    const monthParsed = MonthQuery.safeParse(request.query);
    const bodyParsed = PutBody.safeParse(request.body);
    if (!monthParsed.success || !bodyParsed.success) {
      return reply.code(400).send({ error: 'Invalid month or body.' });
    }
    const userId = request.userId!;
    const monthDate = `${monthParsed.data.month}-01`;

    await withUserContext(userId, async (tx) => {
      for (const entry of bodyParsed.data.entries) {
        await tx
          .insert(budgets)
          .values({ userId, categoryId: entry.categoryId, month: monthDate, amountMinor: entry.amountMinor })
          .onConflictDoUpdate({
            target: [budgets.userId, budgets.categoryId, budgets.month],
            set: { amountMinor: entry.amountMinor },
          });
      }
    });

    return reply.code(204).send();
  });
}
