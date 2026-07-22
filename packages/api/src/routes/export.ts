import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, gte, lte } from 'drizzle-orm';
import { exportTransactionsCsv, type Transaction } from '@budget-tracker/core';
import { requireAuth } from '../auth/middleware.js';
import { withUserContext } from '../db/client.js';
import { transactions } from '../db/schema.js';

const Body = z.object({ from: z.string().optional(), to: z.string().optional(), category: z.string().optional() });

function dbRowToCoreTxn(row: typeof transactions.$inferSelect): Transaction {
  return {
    id: row.id,
    accountId: row.accountId,
    postedDate: row.postedDate,
    transactionDate: row.transactionAt ? row.transactionAt.toISOString() : null,
    description: row.description,
    rawDescription: row.rawDescription,
    amount: row.amountMinor,
    fee: row.feeMinor,
    balance: row.balanceMinor,
    currency: row.currency,
    categoryId: row.categoryId,
    bankCategory: row.bankCategory,
    bankParentCategory: row.bankParentCategory,
    status: row.status as 'settled' | 'pending',
    source: row.source as 'pdf' | 'csv' | 'manual',
    importId: row.importId,
    fingerprint: row.fingerprint,
  };
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/export/csv', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = Body.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid export filters.' });
    const { from, to, category } = parsed.data;
    const userId = request.userId!;

    const rows = await withUserContext(userId, (tx) => {
      const conditions = [eq(transactions.userId, userId)];
      if (from) conditions.push(gte(transactions.postedDate, from));
      if (to) conditions.push(lte(transactions.postedDate, to));
      if (category) conditions.push(eq(transactions.categoryId, category));
      return tx.select().from(transactions).where(and(...conditions));
    });

    const csv = exportTransactionsCsv(rows.map(dbRowToCoreTxn));
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="transactions.csv"');
    return reply.send(csv);
  });
}
