import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseCapitecCsv, categorizeBatch, assignFingerprints } from '@budget-tracker/core';
import { buildApp } from '../src/app.js';
import { resetTestDb, closeTestDb } from './testDb.js';

const wa0002Path = path.resolve(__dirname, '../../../tests/fixtures/csv/DOC-20260316-WA0002.csv');
const wa0002Csv = readFileSync(wa0002Path, 'utf-8');

let app: FastifyInstance;

async function registerAndGetToken(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'correcthorsebattery' },
  });
  return JSON.parse(res.body).accessToken as string;
}

/** Mirrors what the browser's importFlow.ts does client-side before POSTing to /imports. */
async function buildImportPayload(csv: string) {
  const parsed = parseCapitecCsv(csv);
  const categorized = categorizeBatch(parsed.transactions);
  const fingerprinted = await assignFingerprints(categorized);
  return {
    filename: 'DOC-20260316-WA0002.csv',
    format: 'csv' as const,
    accountId: null,
    dateFrom: parsed.meta.dateRange.from,
    dateTo: parsed.meta.dateRange.to,
    transactions: fingerprinted,
  };
}

describe('API integration: imports (server-side dedup) + transactions', () => {
  beforeEach(async () => {
    await resetTestDb();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('first import of the real WA0002 file: 105 new, 0 duplicate, all persisted', async () => {
    const token = await registerAndGetToken('import1@example.com');
    const payload = await buildImportPayload(wa0002Csv);

    const res = await app.inject({
      method: 'POST',
      url: '/imports',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.rowsNew).toBe(105);
    expect(body.rowsDuplicate).toBe(0);

    const list = await app.inject({
      method: 'GET',
      url: '/transactions?pageSize=200',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(list.body).totalRows).toBe(105);
  });

  it("re-importing the same file server-side: 0 new, 105 duplicate — matches core's dedup exactly", async () => {
    const token = await registerAndGetToken('import2@example.com');
    const payload = await buildImportPayload(wa0002Csv);

    await app.inject({ method: 'POST', url: '/imports', headers: { authorization: `Bearer ${token}` }, payload });
    const second = await app.inject({
      method: 'POST',
      url: '/imports',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    const body = JSON.parse(second.body);
    expect(body.rowsNew).toBe(0);
    expect(body.rowsDuplicate).toBe(105);

    const list = await app.inject({
      method: 'GET',
      url: '/transactions?pageSize=200',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(list.body).totalRows).toBe(105); // unchanged
  });

  it('the server never trusts a client-supplied fingerprint: tampering with it does not bypass dedup', async () => {
    const token = await registerAndGetToken('tamper@example.com');
    const payload = await buildImportPayload(wa0002Csv);

    await app.inject({ method: 'POST', url: '/imports', headers: { authorization: `Bearer ${token}` }, payload });

    // Re-send the same batch but with every fingerprint replaced by garbage —
    // if the server trusted client fingerprints, this would falsely dedupe
    // to 0 duplicates (fingerprints don't match) and re-insert everything.
    const tampered = {
      ...payload,
      transactions: payload.transactions.map((t) => ({ ...t, fingerprint: 'not-a-real-fingerprint' })),
    };
    const res = await app.inject({
      method: 'POST',
      url: '/imports',
      headers: { authorization: `Bearer ${token}` },
      payload: tampered,
    });
    const body = JSON.parse(res.body);
    expect(body.rowsNew).toBe(0);
    expect(body.rowsDuplicate).toBe(105); // still correctly deduped server-side
  });

  it('ISOLATION: importing the same file as two different users creates 105 rows each, independently', async () => {
    const aliceToken = await registerAndGetToken('import-alice@example.com');
    const bobToken = await registerAndGetToken('import-bob@example.com');
    // Two independent parses, like two different browsers/users each
    // running the client-side pipeline on their own copy of the file —
    // this is what gives each transaction its own fresh UUID, same as
    // real usage. Reusing a single payload object would collide on the
    // transactions table's global primary key, which is a test-setup
    // artifact, not a real scenario (two independent UUID generations
    // colliding is not something that happens in practice).
    const alicePayload = await buildImportPayload(wa0002Csv);
    const bobPayload = await buildImportPayload(wa0002Csv);

    const aliceRes = await app.inject({
      method: 'POST',
      url: '/imports',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: alicePayload,
    });
    const bobRes = await app.inject({
      method: 'POST',
      url: '/imports',
      headers: { authorization: `Bearer ${bobToken}` },
      payload: bobPayload,
    });

    expect(JSON.parse(aliceRes.body).rowsNew).toBe(105);
    expect(JSON.parse(bobRes.body).rowsNew).toBe(105); // NOT deduped against Alice's data

    const aliceList = await app.inject({
      method: 'GET',
      url: '/transactions?pageSize=200',
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(JSON.parse(aliceList.body).totalRows).toBe(105);
  });

  it('GET /summary computed server-side is internally consistent on real data', async () => {
    const token = await registerAndGetToken('summary@example.com');
    const payload = await buildImportPayload(wa0002Csv);
    await app.inject({ method: 'POST', url: '/imports', headers: { authorization: `Bearer ${token}` }, payload });

    const res = await app.inject({ method: 'GET', url: '/summary', headers: { authorization: `Bearer ${token}` } });
    const body = JSON.parse(res.body);
    expect(body.kpis.transactionCount).toBe(105);
    expect(body.kpis.netCashFlowMinor).toBe(
      body.kpis.totalIncomeMinor - body.kpis.totalExpensesMinor - body.kpis.feesPaidMinor,
    );
  });

  it('manual transaction create + patch + event log', async () => {
    const token = await registerAndGetToken('manual@example.com');
    const created = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        postedDate: '2026-01-01',
        description: 'Gift',
        amountMinor: 5000,
        categoryId: 'other',
        currency: 'ZAR',
      },
    });
    const { id } = JSON.parse(created.body);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/transactions/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { categoryId: 'groceries' },
    });
    expect(patch.statusCode).toBe(204);

    const events = await app.inject({
      method: 'GET',
      url: `/transactions/${id}/events`,
      headers: { authorization: `Bearer ${token}` },
    });
    const eventBody = JSON.parse(events.body);
    expect(eventBody.events).toHaveLength(1);
    expect(eventBody.events[0].field).toBe('categoryId');
    expect(eventBody.events[0].newValue).toBe('groceries');
  });

  it('GET /transactions returns rows in the core Transaction wire shape (amount/fee/balance/transactionDate), not raw DB column names', async () => {
    const token = await registerAndGetToken('shape@example.com');
    const parsed = parseCapitecCsv(wa0002Csv);
    const categorized = categorizeBatch(parsed.transactions);
    const fingerprinted = await assignFingerprints(categorized);
    await app.inject({
      method: 'POST',
      url: '/imports',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        filename: 'WA0002.csv',
        format: 'csv',
        dateFrom: parsed.meta.dateRange.from,
        dateTo: parsed.meta.dateRange.to,
        transactions: fingerprinted,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/transactions?pageSize=5',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(res.body);
    expect(body.rows.length).toBeGreaterThan(0);
    const row = body.rows[0];

    // The wire shape core/web expect — NOT amountMinor/feeMinor/balanceMinor/transactionAt.
    expect(row).toHaveProperty('amount');
    expect(row).toHaveProperty('fee');
    expect(row).toHaveProperty('balance');
    expect(row).toHaveProperty('transactionDate');
    expect(row).not.toHaveProperty('amountMinor');
    expect(row).not.toHaveProperty('feeMinor');
    expect(row).not.toHaveProperty('balanceMinor');
    expect(row).not.toHaveProperty('transactionAt');
    expect(typeof row.amount).toBe('number');
  });

  it('GET /transactions accepts pageSize=500 (the sync layer\'s full-pull page size)', async () => {
    const token = await registerAndGetToken('pagesize@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/transactions?pageSize=500',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
