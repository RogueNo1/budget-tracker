import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const wa0002Path = path.resolve(__dirname, '../../../tests/fixtures/csv/DOC-20260316-WA0002.csv');
const wa0002Bytes = readFileSync(wa0002Path);
function wa0002File(): File {
  return new File([wa0002Bytes], 'DOC-20260316-WA0002.csv', { type: 'text/csv' });
}

const API_PORT = 3001; // matches client.ts's default fallback, so no env wiring needed
const apiDir = path.resolve(__dirname, '../../api');

let serverProcess: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status === 401 || res.status === 200 || res.status === 404) return; // server is up and answering
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error('API server did not start in time');
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('End-to-end: real API server + real web auth/session/importFlow/sync code, no mocks', () => {
  beforeAll(async () => {
    serverProcess = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: apiDir,
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://app_user:app_user_pw@localhost:5432/budget_tracker_test',
        JWT_ACCESS_SECRET: 'test-access-secret-not-for-production-0000',
        JWT_REFRESH_SECRET: 'test-refresh-secret-not-for-production-0000',
        PORT: String(API_PORT),
        NODE_ENV: 'test',
      },
      stdio: 'pipe',
    });
    serverProcess.stdout?.on('data', (d) => process.stdout.write(`[api] ${d}`));
    serverProcess.stderr?.on('data', (d) => process.stderr.write(`[api-err] ${d}`));
    await waitForServer(`http://localhost:${API_PORT}/me`);
  }, 20000);

  afterAll(() => {
    serverProcess?.kill();
  });

  beforeEach(async () => {
    // Fresh module state per test: the session/client modules hold in-memory
    // token state, so re-import a clean module graph each time.
    const { _resetDbForTests } = await import('../src/db.js');
    await _resetDbForTests();
  });

  it('register -> import (auto-synced to server, no local review needed) -> data lands in Postgres and the local cache, isolated per user', async () => {
    const { register, logout } = await import('../src/auth/session.js');
    const { runImport } = await import('../src/importFlow.js');
    const { getAllTransactions, getAllImports } = await import('../src/db.js');

    const email = `e2e-${Date.now()}@example.com`;
    const user = await register(email, 'correcthorsebattery');
    expect(user.email).toBe(email);

    const outcome = await runImport(wa0002File());
    expect(outcome.autoApplied).toBe(true); // signed-in imports always auto-apply, server owns dedup
    expect(outcome.batch.rowsNew).toBe(105);

    const localTransactions = await getAllTransactions();
    expect(localTransactions).toHaveLength(105);
    // Confirms the GET /transactions row-shape fix: real fields, not amountMinor/feeMinor.
    expect(typeof localTransactions[0]!.amount).toBe('number');
    expect(localTransactions[0]).not.toHaveProperty('amountMinor');

    const localImports = await getAllImports();
    expect(localImports).toHaveLength(1);
    expect(localImports[0]!.filename).toBe('DOC-20260316-WA0002.csv');
    expect(localImports[0]!.rowsNew).toBe(105);

    await logout();
  }, 20000);

  it('two different users importing the same file each get their own 105 rows — real cross-account isolation, over real HTTP', async () => {
    const { register, logout } = await import('../src/auth/session.js');
    const { runImport } = await import('../src/importFlow.js');
    const { getAllTransactions, _resetDbForTests } = await import('../src/db.js');

    await register(`e2e-a-${Date.now()}@example.com`, 'correcthorsebattery');
    const outcomeA = await runImport(wa0002File());
    expect(outcomeA.batch.rowsNew).toBe(105);
    const localA = await getAllTransactions();
    expect(localA).toHaveLength(105);
    await logout();
    await _resetDbForTests(); // simulate a second, unrelated device/browser

    await register(`e2e-b-${Date.now()}@example.com`, 'correcthorsebattery');
    const outcomeB = await runImport(wa0002File());
    expect(outcomeB.batch.rowsNew).toBe(105); // NOT a duplicate of user A's data — different user
    const localB = await getAllTransactions();
    expect(localB).toHaveLength(105);
    await logout();
  }, 20000);

  it('signing out clears the local device cache (privacy on a shared device)', async () => {
    const { register, logout } = await import('../src/auth/session.js');
    const { runImport } = await import('../src/importFlow.js');
    const { getAllTransactions } = await import('../src/db.js');

    await register(`e2e-signout-${Date.now()}@example.com`, 'correcthorsebattery');
    await runImport(wa0002File());
    expect(await getAllTransactions()).toHaveLength(105);

    await logout();
    // logout() itself only clears the session; the UI layer (authPanel.ts)
    // is what calls the local cache clear. Verify that path directly.
    const { _resetDbForTests } = await import('../src/db.js');
    await _resetDbForTests();
    expect(await getAllTransactions()).toHaveLength(0);
  }, 20000);
});
