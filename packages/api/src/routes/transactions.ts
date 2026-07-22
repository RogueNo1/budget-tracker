import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, asc, eq, gte, lte, ilike, or, sql, count } from 'drizzle-orm';
import { newId } from '@budget-tracker/core';
import { requireAuth } from '../auth/middleware.js';
import { withUserContext } from '../db/client.js';
import { transactions, transactionEvents } from '../db/schema.js';
import { dbRowToCoreTxn } from '../db/mappers.js';

const ListQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(['all', 'income', 'expense']).optional().default('all'),
  from: z.string().optional(),
  to: z.string().optional(),
  accountId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(20),
  sort: z.enum(['date-desc', 'date-asc', 'amount-desc', 'amount-asc']).optional().default('date-desc'),
});

const ManualBody = z.object({
  postedDate: z.string(),
  description: z.string().min(1),
  amountMinor: z.number().int(),
  categoryId: z.string(),
  currency: z.string().length(3),
});

const PatchBody = z.object({
  categoryId: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().nullable().optional(),
  excluded: z.boolean().optional(),
});

export async function transactionsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/transactions', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ListQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query parameters.' });
    const { q, category, type, from, to, accountId, page, pageSize, sort } = parsed.data;
    const userId = request.userId!;

    const conditions = [eq(transactions.userId, userId)];
    if (q) {
      conditions.push(
        or(ilike(transactions.description, `%${q}%`), ilike(transactions.rawDescription, `%${q}%`))!,
      );
    }
    if (category) conditions.push(eq(transactions.categoryId, category));
    if (type === 'income') conditions.push(sql`${transactions.amountMinor} > 0`);
    if (type === 'expense') conditions.push(sql`${transactions.amountMinor} < 0`);
    if (from) conditions.push(gte(transactions.postedDate, from));
    if (to) conditions.push(lte(transactions.postedDate, to));
    if (accountId) conditions.push(eq(transactions.accountId, accountId));

    const orderBy =
      sort === 'date-asc'
        ? [asc(transactions.postedDate)]
        : sort === 'amount-desc'
          ? [desc(transactions.amountMinor)]
          : sort === 'amount-asc'
            ? [asc(transactions.amountMinor)]
            : [desc(transactions.postedDate)];

    const result = await withUserContext(userId, async (tx) => {
      const where = and(...conditions);
      const [rows, totalRes] = await Promise.all([
        tx
          .select()
          .from(transactions)
          .where(where)
          .orderBy(...orderBy)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        tx.select({ n: count() }).from(transactions).where(where),
      ]);
      return { rows, total: totalRes[0]?.n ?? 0 };
    });

    return reply.send({
      rows: result.rows.map(dbRowToCoreTxn),
      totalRows: result.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    });
  });

  app.post('/transactions', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ManualBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid transaction payload.' });
    const userId = request.userId!;
    const id = newId();
    const input = parsed.data;

    await withUserContext(userId, (tx) =>
      tx.insert(transactions).values({
        id,
        userId,
        postedDate: input.postedDate,
        description: input.description,
        rawDescription: input.description,
        amountMinor: input.amountMinor,
        feeMinor: 0,
        currency: input.currency,
        categoryId: input.categoryId,
        status: 'settled',
        source: 'manual',
        fingerprint: `manual-${id}`,
      }),
    );

    return reply.code(201).send({ id });
  });

  app.patch('/transactions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = PatchBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid patch payload.' });
    const userId = request.userId!;
    const updates = parsed.data;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update.' });
    }

    await withUserContext(userId, async (tx) => {
      const existingRows = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return;

      await tx
        .update(transactions)
        .set(updates)
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));

      const events = (Object.keys(updates) as (keyof typeof updates)[]).map((field) => ({
        transactionId: id,
        userId,
        field,
        oldValue: String((existing as Record<string, unknown>)[field] ?? ''),
        newValue: String(updates[field] ?? ''),
        actor: 'user',
      }));
      if (events.length > 0) await tx.insert(transactionEvents).values(events);
    });

    return reply.code(204).send();
  });

  app.get('/transactions/:id/events', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;
    const rows = await withUserContext(userId, (tx) =>
      tx
        .select()
        .from(transactionEvents)
        .where(and(eq(transactionEvents.transactionId, id), eq(transactionEvents.userId, userId)))
        .orderBy(desc(transactionEvents.at)),
    );
    return reply.send({ events: rows });
  });
}
