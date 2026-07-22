import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull, or } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';
import { withUserContext } from '../db/client.js';
import { categories, categoryRules } from '../db/schema.js';

const CategoryBody = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  parentId: z.string().uuid().nullable().optional(),
  slug: z.string().min(1),
});

const RuleBody = z.object({
  pattern: z.string().min(1),
  categoryId: z.string().min(1),
  priority: z.number().int().default(0),
});

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const rows = await withUserContext(userId, (tx) =>
      tx
        .select()
        .from(categories)
        .where(or(isNull(categories.userId), eq(categories.userId, userId))),
    );
    return reply.send({ categories: rows });
  });

  app.post('/categories', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CategoryBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid category payload.' });
    const userId = request.userId!;
    const [row] = await withUserContext(userId, (tx) =>
      tx
        .insert(categories)
        .values({
          userId,
          name: parsed.data.name,
          color: parsed.data.color,
          parentId: parsed.data.parentId ?? null,
          slug: parsed.data.slug,
        })
        .returning(),
    );
    return reply.code(201).send({ category: row });
  });

  app.patch('/categories/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = CategoryBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid category payload.' });
    const userId = request.userId!;
    const [row] = await withUserContext(userId, (tx) =>
      tx
        .update(categories)
        .set(parsed.data)
        .where(and(eq(categories.id, id), eq(categories.userId, userId)))
        .returning(),
    );
    if (!row) {
      return reply
        .code(404)
        .send({ error: 'Category not found or not editable (built-in defaults are read-only).' });
    }
    return reply.send({ category: row });
  });

  app.delete('/categories/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;
    await withUserContext(userId, (tx) =>
      tx.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId))),
    );
    return reply.code(204).send();
  });

  app.get('/categories/rules', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const rows = await withUserContext(userId, (tx) =>
      tx
        .select()
        .from(categoryRules)
        .where(or(isNull(categoryRules.userId), eq(categoryRules.userId, userId))),
    );
    return reply.send({ rules: rows });
  });

  app.post('/categories/rules', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = RuleBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid rule payload.' });
    const userId = request.userId!;
    const [row] = await withUserContext(userId, (tx) =>
      tx
        .insert(categoryRules)
        .values({ userId, ...parsed.data })
        .returning(),
    );
    return reply.code(201).send({ rule: row });
  });

  app.patch('/categories/rules/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = RuleBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid rule payload.' });
    const userId = request.userId!;
    const [row] = await withUserContext(userId, (tx) =>
      tx
        .update(categoryRules)
        .set(parsed.data)
        .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
        .returning(),
    );
    if (!row) return reply.code(404).send({ error: 'Rule not found or not editable.' });
    return reply.send({ rule: row });
  });

  app.delete('/categories/rules/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;
    await withUserContext(userId, (tx) =>
      tx.delete(categoryRules).where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId))),
    );
    return reply.code(204).send();
  });
}
