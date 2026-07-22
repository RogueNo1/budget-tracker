import { formatMoney, type ImportBatch, type Transaction } from '@budget-tracker/core';
import { applyImport, runImport, type ImportOutcome } from './importFlow.js';
import { getAllImports, getAllTransactions } from './db.js';
import { mountDashboard, refreshDashboard } from './dashboard.js';
import { mountAuthControl } from './auth/authPanel.js';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function showToast(message: string, tone: 'ok' | 'warn' = 'ok'): void {
  const region = document.querySelector<HTMLElement>('#toast-region');
  if (!region) return;
  const toast = el('div', { class: tone === 'warn' ? 'toast warn' : 'toast' }, [message]);
  region.append(toast);
  setTimeout(() => toast.remove(), 5000);
}

function ledgerRow(t: Transaction, extra?: Node): HTMLElement {
  const isOut = t.amount < 0;
  return el('div', { class: 'ledger-row' }, [
    el('span', { class: 'date' }, [t.postedDate]),
    el('span', { class: 'desc', title: t.description }, [t.description]),
    el('span', { class: `amount ${isOut ? 'out' : 'in'}` }, [
      formatMoney(t.amount, t.currency),
    ]),
    extra ?? el('span', { class: 'fp-chip' }, [t.fingerprint.slice(0, 8)]),
  ]);
}

function renderReviewPanel(outcome: ImportOutcome): void {
  const panel = document.querySelector<HTMLElement>('#review-panel');
  if (!panel) return;
  panel.innerHTML = '';
  panel.hidden = false;

  const { batch, merge } = outcome;

  panel.append(
    el('div', { class: 'section-label' }, [`Review import — ${batch.filename}`]),
    el('div', { class: 'review-counts' }, [
      el('div', { class: 'review-count new' }, [
        el('span', { class: 'num' }, [String(merge.new.length)]),
        el('span', { class: 'label' }, ['New']),
      ]),
      el('div', { class: 'review-count duplicate' }, [
        el('span', { class: 'num' }, [String(merge.duplicates.length)]),
        el('span', { class: 'label' }, ['Duplicate']),
      ]),
      el('div', { class: 'review-count pending' }, [
        el('span', { class: 'num' }, [String(merge.pendingReplacements.length)]),
        el('span', { class: 'label' }, ['Pending → settled']),
      ]),
    ]),
  );

  if (merge.duplicates.length > 0) {
    const list = el(
      'div',
      {},
      merge.duplicates.slice(0, 25).map((t) => ledgerRow(t)),
    );
    panel.append(
      el('details', { class: 'review-detail' }, [
        el('summary', {}, [`Show ${merge.duplicates.length} duplicate row(s)`]),
        list,
      ]),
    );
  }

  if (merge.pendingReplacements.length > 0) {
    const list = el(
      'div',
      {},
      merge.pendingReplacements.slice(0, 25).map((pr) => ledgerRow(pr.replacement)),
    );
    panel.append(
      el('details', { class: 'review-detail' }, [
        el('summary', {}, [`Show ${merge.pendingReplacements.length} pending → settled row(s)`]),
        list,
      ]),
    );
  }

  const confirmBtn = el('button', { class: 'btn-import' }, ['Confirm import']);
  const cancelBtn = el('button', { class: 'btn-secondary' }, ['Cancel']);
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.setAttribute('disabled', 'true');
    await applyImport(batch, merge);
    panel.hidden = true;
    panel.innerHTML = '';
    showToast(`Imported ${batch.filename}: ${merge.new.length} new, ${merge.duplicates.length} skipped.`);
    await refreshHistory();
    await refreshEmptyState();
    await refreshDashboard();
  });
  cancelBtn.addEventListener('click', () => {
    panel.hidden = true;
    panel.innerHTML = '';
    showToast('Import cancelled — nothing was saved.', 'warn');
  });

  panel.append(el('div', { class: 'review-actions' }, [confirmBtn, cancelBtn]));
}

function historyRow(batch: ImportBatch): HTMLElement {
  return el('div', { class: 'history-row' }, [
    el('span', { class: 'filename' }, [batch.filename]),
    el('span', { class: 'stat' }, [`${batch.dateFrom} → ${batch.dateTo}`]),
    el('span', { class: 'stat new' }, [`+${batch.rowsNew} new`]),
    el('span', { class: 'stat' }, [`${batch.rowsDuplicate} dup`]),
  ]);
}

async function refreshHistory(): Promise<void> {
  const list = document.querySelector<HTMLElement>('#history-list');
  const panel = document.querySelector<HTMLElement>('#history-panel');
  if (!list || !panel) return;
  const imports = await getAllImports();
  list.innerHTML = '';
  panel.hidden = imports.length === 0;
  for (const batch of imports) list.append(historyRow(batch));
}

async function refreshEmptyState(): Promise<void> {
  const empty = document.querySelector<HTMLElement>('#empty-state');
  if (!empty) return;
  const transactions = await getAllTransactions();
  empty.hidden = transactions.length > 0;
}

async function handleFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    try {
      const outcome = await runImport(file);
      if (outcome.parseWarnings.length > 0) {
        showToast(
          `${file.name}: parsed with ${outcome.parseWarnings.length} warning(s) — see console.`,
          'warn',
        );
        console.warn(`Parse warnings for ${file.name}:`, outcome.parseWarnings);
      }
      if (outcome.autoApplied) {
        showToast(`Imported ${file.name}: ${outcome.merge.new.length} new transactions.`);
        await refreshHistory();
        await refreshEmptyState();
        await refreshDashboard();
      } else {
        renderReviewPanel(outcome);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Couldn't import ${file.name}: ${message}`, 'warn');
    }
  }
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = '';

  const fileInput = el('input', { type: 'file', accept: '.csv,.pdf', multiple: 'true', hidden: 'true' });
  const importBtn = el('button', { class: 'btn-import' }, ['+ Import statement']);
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) void handleFiles(fileInput.files);
    fileInput.value = '';
  });

  const topbar = el('header', { class: 'topbar' }, [
    el('div', { class: 'topbar-brand' }, [el('span', { class: 'mark' }, ['◆']), ' LEDGER']),
    el('div', { class: 'import-control' }, [
      el('span', { class: 'import-hint' }, ['Drop a statement anywhere, or']),
      importBtn,
      fileInput,
    ]),
    el('div', { id: 'auth-control', class: 'auth-control' }),
  ]);

  topbar.addEventListener('dragover', (e) => {
    e.preventDefault();
    topbar.classList.add('drag-over');
  });
  topbar.addEventListener('dragleave', () => topbar.classList.remove('drag-over'));
  topbar.addEventListener('drop', (e) => {
    e.preventDefault();
    topbar.classList.remove('drag-over');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  });

  const main = el('main', { class: 'main' }, [
    el('section', { id: 'toast-region', class: 'toast-region' }),
    el('section', { id: 'review-panel', class: 'review-panel', hidden: 'true' }),
    el('section', { id: 'empty-state', class: 'empty-state' }, [
      'No transactions yet — drop a Capitec CSV or PDF statement above to get started.',
      el('div', { class: 'privacy-note' }, ['Files are parsed locally in your browser and never uploaded.']),
    ]),
    el('section', { id: 'history-panel', class: 'history-panel', hidden: 'true' }, [
      el('div', { class: 'section-label' }, ['Import history']),
      el('div', { id: 'history-list', class: 'history-list' }),
    ]),
    el('section', { id: 'dashboard-panel' }),
  ]);

  root.append(topbar, main);

  mountDashboard(document.querySelector<HTMLElement>('#dashboard-panel')!);

  mountAuthControl(document.querySelector<HTMLElement>('#auth-control')!, {
    showToast,
    onSignedIn: async () => {
      await refreshHistory();
      await refreshEmptyState();
      await refreshDashboard();
    },
    onSignedOut: async () => {
      await refreshHistory();
      await refreshEmptyState();
      await refreshDashboard();
    },
  });

  void refreshHistory();
  void refreshEmptyState();
}
