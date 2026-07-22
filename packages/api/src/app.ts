import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { transactionsRoutes } from './routes/transactions.js';
import { importsRoutes } from './routes/imports.js';
import { categoriesRoutes } from './routes/categories.js';
import { budgetsRoutes } from './routes/budgets.js';
import { summaryRoutes } from './routes/summary.js';
import { exportRoutes } from './routes/export.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(helmet);
  await app.register(cookie);

  // Rate-limit /auth/* only, per CLAUDE.md §5 ("rate-limit auth endpoints").
  await app.register(async (authScope) => {
    await authScope.register(rateLimit, {
      max: 10,
      timeWindow: '1 minute',
    });
    await authScope.register(authRoutes);
  });

  await app.register(meRoutes);
  await app.register(transactionsRoutes);
  await app.register(importsRoutes);
  await app.register(categoriesRoutes);
  await app.register(budgetsRoutes);
  await app.register(summaryRoutes);
  await app.register(exportRoutes);

  app.get('/health', async () => ({ ok: true }));

  return app;
}
