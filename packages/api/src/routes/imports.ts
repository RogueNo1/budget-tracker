import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { assignFingerprints, mergeImport, newId, type Transaction } from '@budget-tracker/core';
import { requireAuth } from '../auth/middleware.js';
import { withUserContext } from '../db/client.js';
import { imports as importsTable, transactions, transactionEvents } from '../db/schema.js';
import { dbRowToCoreTxn } from '../db/mappers.js';
import type { Tx } from '../db/client.js';

const IncomingTxn = z.object({
  id: z.string(),
  accountId: z.string().nullable(),
  postedDate: z.string(),
  transactionDate: z.string().nullable(),
  description: z.string(),
  rawDescription: z.string(),
  amount: z.number().int(),
  fee: z.number().int(),
  balance: z.number().int().nullable(),
  currency: z.string(),
  categoryId: z.string(),
  bankCategory: z.string().nullable(),
  bankParentCategory: z.string().nullable(),
  status: z.enum(['settled', 'pending']),
  source: z.enum(['pdf', 'csv', 'manual']),
});

const ImportBody = z.object({
  filename: z.string(),
  format: z.enum(['pdf', 'csv']),
  accountId: z.string().nullable().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  transactions: z.array(IncomingTxn),
});

export async function importsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/imports', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ImportBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid import payload.', details: parsed.error.issues });
    }
    const userId = request.userId!;
    const input = parsed.data;

    // Server re-runs fingerprint dedup as the source of truth — the
    // client-supplied fingerprint (if any) is never trusted directly.
    const incomingAsCore: Transaction[] = input.transactions.map((t) => ({
      ...t,
      importId: null,
      fingerprint: '',
    }));
    const fingerprinted = await assignFingerprints(incomingAsCore);

    const result = await withUserContext(userId, async (tx: Tx) => {
      const existingRows = await tx.select().from(transactions).where(eq(transactions.userId, userId));
      const existing = existingRows.map(dbRowToCoreTxn);

      const merge = mergeImport(existing, fingerprinted);
      const importId = newId();

      const [batch] = await tx
        .insert(importsTable)
        .values({
          id: importId,
          userId,
          accountId: input.accountId ?? null,
          filename: input.filename,
          format: input.format,
          dateFrom: input.dateFrom ?? null,
          dateTo: input.dateTo ?? null,
          rowsTotal: fingerprinted.length,
          rowsNew: merge.new.length,
          rowsDuplicate: merge.duplicates.length,
        })
        .returning();

      if (merge.new.length > 0) {
        await tx.insert(transactions).values(
          merge.new.map((t) => ({
            id: t.id,
            userId,
            accountId: input.accountId ?? null,
            importId,
            postedDate: t.postedDate,
            transactionAt: t.transactionDate ? new Date(t.transactionDate) : null,
            description: t.description,
            rawDescription: t.rawDescription,
            amountMinor: t.amount,
            feeMinor: t.fee,
            balanceMinor: t.balance,
            currency: t.currency,
            categoryId: t.categoryId,
            bankCategory: t.bankCategory,
            bankParentCategory: t.bankParentCategory,
            status: t.status,
            source: t.source,
            fingerprint: t.fingerprint,
          })),
        );
      }

      for (const { old, replacement } of merge.pendingReplacements) {
        await tx
          .delete(transactions)
          .where(and(eq(transactions.id, old.id), eq(transactions.userId, userId)));
        await tx.insert(transactions).values({
          id: replacement.id,
          userId,
          accountId: input.accountId ?? null,
          importId,
          postedDate: replacement.postedDate,
          transactionAt: replacement.transactionDate ? new Date(replacement.transactionDate) : null,
          description: replacement.description,
          rawDescription: replacement.rawDescription,
          amountMinor: replacement.amount,
          feeMinor: replacement.fee,
          balanceMinor: replacement.balance,
          currency: replacement.currency,
          categoryId: replacement.categoryId,
          bankCategory: replacement.bankCategory,
          bankParentCategory: replacement.bankParentCategory,
          status: replacement.status,
          source: replacement.source,
          fingerprint: replacement.fingerprint,
        });
        await tx.insert(transactionEvents).values({
          transactionId: replacement.id,
          userId,
          field: 'status',
          oldValue: 'pending',
          newValue: 'settled',
          actor: 'import',
        });
      }

      return { batch, merge };
    });

    return reply.code(201).send({
      import: result.batch,
      rowsNew: result.merge.new.length,
      rowsDuplicate: result.merge.duplicates.length,
      rowsPendingReplaced: result.merge.pendingReplacements.length,
    });
  });

  app.get('/imports', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const rows = await withUserContext(userId, (tx) =>
      tx
        .select()
        .from(importsTable)
        .where(eq(importsTable.userId, userId))
        .orderBy(desc(importsTable.importedAt)),
    );
    return reply.send({ imports: rows });
  });

  app.get('/imports/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;
    const rows = await withUserContext(userId, (tx) =>
      tx
        .select()
        .from(importsTable)
        .where(and(eq(importsTable.id, id), eq(importsTable.userId, userId)))
        .limit(1),
    );
    const batch = rows[0];
    if (!batch) return reply.code(404).send({ error: 'Import not found.' });
    return reply.send({ import: batch });
  });
}
