import {
  Chart,
  registerables,
  type ChartConfiguration,
} from 'chart.js';
import {
  balanceOverTime,
  computeKpis,
  exportTransactionsCsv,
  formatMoney,
  queryLedger,
  spendingByCategory,
  weeklyIncomeExpense,
  type Category,
  type LedgerQuery,
  type Transaction,
} from '@budget-tracker/core';
import {
  addCategory,
  addManualTransaction,
  deleteTransaction,
  getAllCategories,
  getAllTransactions,
  updateTransactionCategory,
} from './db.js';

Chart.register(...registerables);

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

let categoriesCache: Category[] = [];
let currentQuery: LedgerQuery = { page: 1, pageSize: 20, sort: 'date-desc', type: 'all', categoryId: 'all' };
let charts: Chart[] = [];

function categoryName(id: string): string {
  return categoriesCache.find((c) => c.id === id)?.name ?? id;
}
function categoryColor(id: string): string {
  return categoriesCache.find((c) => c.id === id)?.color ?? '#5c6268';
}

function destroyCharts(): void {
  charts.forEach((c) => c.destroy());
  charts = [];
}

// ---------------------------------------------------------------- KPI grid

function renderKpis(transactions: Transaction[]): void {
  const grid = document.querySelector<HTMLElement>('#kpi-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const kpis = computeKpis(transactions);
  const cur = kpis.currency ?? 'ZAR';
  const cells: { label: string; value: string; tone?: 'in' | 'out' | 'pending' }[] = [
    { label: 'Income', value: formatMoney(kpis.totalIncomeMinor, cur), tone: 'in' },
    { label: 'Expenses', value: formatMoney(-kpis.totalExpensesMinor, cur), tone: 'out' },
    {
      label: 'Net Cash Flow',
      value: formatMoney(kpis.netCashFlowMinor, cur),
      tone: kpis.netCashFlowMinor >= 0 ? 'in' : 'out',
    },
    { label: 'Fees Paid', value: formatMoney(-kpis.feesPaidMinor, cur), tone: 'out' },
    {
      label: 'Current Balance',
      value: kpis.currentBalanceMinor !== null ? formatMoney(kpis.currentBalanceMinor, cur) : '—',
    },
    { label: 'Pending', value: String(kpis.pendingCount), tone: 'pending' },
  ];

  for (const cell of cells) {
    grid.append(
      el('div', { class: 'kpi-cell' }, [
        el('span', { class: 'kpi-label' }, [cell.label]),
        el('span', { class: `kpi-value ${cell.tone ?? ''}` }, [cell.value]),
      ]),
    );
  }
}

// ------------------------------------------------------------------ Charts

function renderCharts(transactions: Transaction[]): void {
  destroyCharts();

  const doughnutCanvas = document.querySelector<HTMLCanvasElement>('#chart-spending');
  const lineCanvas = document.querySelector<HTMLCanvasElement>('#chart-balance');
  const barCanvas = document.querySelector<HTMLCanvasElement>('#chart-weekly');
  if (!doughnutCanvas || !lineCanvas || !barCanvas) return;

  const slices = spendingByCategory(transactions).slice(0, 6);
  const doughnutConfig: ChartConfiguration<'doughnut'> = {
    type: 'doughnut',
    data: {
      labels: slices.map((s) => categoryName(s.categoryId)),
      datasets: [
        {
          data: slices.map((s) => s.totalMinor / 100),
          backgroundColor: slices.map((s) => categoryColor(s.categoryId)),
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: { legend: { position: 'right', labels: { color: '#9aa0a6', boxWidth: 10, font: { size: 10 } } } },
      maintainAspectRatio: false,
    },
  };
  charts.push(new Chart(doughnutCanvas, doughnutConfig));

  const points = balanceOverTime(transactions);
  const lineConfig: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: points.map((p) => p.date),
      datasets: [
        {
          data: points.map((p) => p.balanceMinor / 100),
          borderColor: '#4fb99f',
          backgroundColor: 'rgba(79,185,159,0.12)',
          fill: true,
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#5c6268', maxTicksLimit: 5, font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#5c6268', font: { size: 9 } }, grid: { color: '#2a2f33' } },
      },
      maintainAspectRatio: false,
    },
  };
  charts.push(new Chart(lineCanvas, lineConfig));

  const weeks = weeklyIncomeExpense(transactions);
  const barConfig: ChartConfiguration<'bar'> = {
    type: 'bar',
    data: {
      labels: weeks.map((w) => w.week.slice(5)),
      datasets: [
        { label: 'Income', data: weeks.map((w) => w.incomeMinor / 100), backgroundColor: '#4fb99f' },
        { label: 'Expense', data: weeks.map((w) => w.expenseMinor / 100), backgroundColor: '#c1602b' },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: '#9aa0a6', font: { size: 9 } } } },
      scales: {
        x: { ticks: { color: '#5c6268', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#5c6268', font: { size: 9 } }, grid: { color: '#2a2f33' } },
      },
      maintainAspectRatio: false,
    },
  };
  charts.push(new Chart(barCanvas, barConfig));
}

// ------------------------------------------------------------- Ledger table

function categorySelect(selectedId: string, onChange: (id: string) => void): HTMLSelectElement {
  const select = el(
    'select',
    { class: 'cat-select' },
    categoriesCache.map((c) => {
      const opt = el('option', { value: c.id }, [c.name]);
      if (c.id === selectedId) opt.setAttribute('selected', 'true');
      return opt;
    }),
  );
  select.addEventListener('click', (e) => e.stopPropagation());
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function ledgerRow(t: Transaction, onReRender: () => void, onOpenDetail: (t: Transaction) => void): HTMLElement {
  const isOut = t.amount < 0;
  const row = el('div', { class: 'tx-row' }, [
    el('span', { class: 'date' }, [
      t.status === 'pending' ? el('span', { class: 'pending-dot', title: 'Pending' }, ['●']) : '',
      t.postedDate,
    ]),
    el('span', { class: 'desc', title: t.rawDescription }, [t.description]),
    categorySelect(t.categoryId, async (categoryId) => {
      await updateTransactionCategory(t.id, categoryId);
      onReRender();
    }),
    el('span', { class: `amount ${isOut ? 'out' : 'in'}` }, [formatMoney(t.amount, t.currency)]),
  ]);
  row.addEventListener('click', () => onOpenDetail(t));
  return row;
}

async function refreshDashboard(): Promise<void> {
  const [transactions, categories] = await Promise.all([getAllTransactions(), getAllCategories()]);
  categoriesCache = categories;

  renderKpis(transactions);
  renderCharts(transactions);

  const catFilter = document.querySelector<HTMLSelectElement>('#filter-category');
  if (catFilter) {
    const prev = catFilter.value || 'all';
    catFilter.innerHTML = '';
    catFilter.append(el('option', { value: 'all' }, ['All categories']));
    for (const c of categoriesCache) catFilter.append(el('option', { value: c.id }, [c.name]));
    catFilter.value = prev;
  }

  renderLedger(transactions);
}

function renderLedger(allTransactions: Transaction[]): void {
  const tableBody = document.querySelector<HTMLElement>('#tx-rows');
  const pageInfo = document.querySelector<HTMLElement>('#page-info');
  if (!tableBody || !pageInfo) return;

  const page = queryLedger(allTransactions, currentQuery);
  tableBody.innerHTML = '';
  for (const t of page.rows) {
    tableBody.append(ledgerRow(t, () => void refreshDashboard(), openDetailModal));
  }
  pageInfo.textContent = `Page ${page.page} of ${page.totalPages} — ${page.totalRows} transactions`;

  const prevBtn = document.querySelector<HTMLButtonElement>('#page-prev');
  const nextBtn = document.querySelector<HTMLButtonElement>('#page-next');
  if (prevBtn) prevBtn.disabled = page.page <= 1;
  if (nextBtn) nextBtn.disabled = page.page >= page.totalPages;
}

// ------------------------------------------------------------- Detail modal

function closeModal(): void {
  document.querySelector<HTMLElement>('#modal-root')?.replaceChildren();
}

function openDetailModal(t: Transaction): void {
  const root = document.querySelector<HTMLElement>('#modal-root');
  if (!root) return;

  const isManual = t.source === 'manual';

  const catSel = categorySelect(t.categoryId, async (categoryId) => {
    await updateTransactionCategory(t.id, categoryId);
    await refreshDashboard();
  });

  const fields = el('div', { class: 'modal-fields' }, [
    fieldRow('Date', t.postedDate),
    fieldRow('Transaction time', t.transactionDate ?? '—'),
    fieldRow('Description', t.description),
    fieldRow('Raw description', t.rawDescription),
    fieldRow('Amount', formatMoney(t.amount, t.currency)),
    fieldRow('Fee', formatMoney(t.fee, t.currency)),
    fieldRow('Balance', t.balance !== null ? formatMoney(t.balance, t.currency) : '—'),
    fieldRow('Status', t.status),
    fieldRow('Source', t.source),
    fieldRow('Import ID', t.importId ?? '—'),
    fieldRow('Bank category', t.bankCategory ?? '—'),
    fieldRow('Bank parent category', t.bankParentCategory ?? '—'),
    fieldRow('Fingerprint', t.fingerprint),
  ]);

  const catRow = el('div', { class: 'field-row' }, [el('span', { class: 'field-label' }, ['Category']), catSel]);

  const actions = el('div', { class: 'modal-actions' });
  if (isManual) {
    const deleteBtn = el('button', { class: 'btn-secondary danger' }, ['Delete transaction']);
    deleteBtn.addEventListener('click', async () => {
      await deleteTransaction(t.id);
      closeModal();
      await refreshDashboard();
    });
    actions.append(deleteBtn);
  }
  const closeBtn = el('button', { class: 'btn-secondary' }, ['Close']);
  closeBtn.addEventListener('click', closeModal);
  actions.append(closeBtn);

  const dialog = el('div', { class: 'modal-dialog' }, [
    el('div', { class: 'section-label' }, ['Transaction detail']),
    catRow,
    fields,
    actions,
  ]);

  const overlay = el('div', { class: 'modal-overlay' }, [dialog]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  root.replaceChildren(overlay);
}

function fieldRow(label: string, value: string): HTMLElement {
  return el('div', { class: 'field-row' }, [
    el('span', { class: 'field-label' }, [label]),
    el('span', { class: 'field-value' }, [value]),
  ]);
}

// ------------------------------------------------------------ Manual + CSV

function openManualForm(): void {
  const root = document.querySelector<HTMLElement>('#modal-root');
  if (!root) return;

  const dateInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const descInput = el('input', { type: 'text', placeholder: 'Description' });
  const amountInput = el('input', { type: 'number', step: '0.01', placeholder: 'Amount (+in / -out)' });
  const catSelect = el(
    'select',
    {},
    categoriesCache.map((c) => el('option', { value: c.id }, [c.name])),
  );

  const saveBtn = el('button', { class: 'btn-import' }, ['Add transaction']);
  saveBtn.addEventListener('click', async () => {
    const amountDecimal = parseFloat(amountInput.value || '0');
    if (!descInput.value.trim() || Number.isNaN(amountDecimal) || amountDecimal === 0) return;
    const all = await getAllTransactions();
    await addManualTransaction({
      postedDate: dateInput.value,
      description: descInput.value.trim(),
      amountMinor: Math.round(amountDecimal * 100),
      categoryId: catSelect.value,
      currency: computeKpis(all).currency ?? 'ZAR',
    });
    closeModal();
    await refreshDashboard();
  });
  const cancelBtn = el('button', { class: 'btn-secondary' }, ['Cancel']);
  cancelBtn.addEventListener('click', closeModal);

  const dialog = el('div', { class: 'modal-dialog' }, [
    el('div', { class: 'section-label' }, ['Add manual transaction']),
    el('div', { class: 'manual-form' }, [dateInput, descInput, amountInput, catSelect]),
    el('div', { class: 'modal-actions' }, [saveBtn, cancelBtn]),
  ]);
  const overlay = el('div', { class: 'modal-overlay' }, [dialog]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  root.replaceChildren(overlay);
}

function openCategoryManager(): void {
  const root = document.querySelector<HTMLElement>('#modal-root');
  if (!root) return;

  const list = el(
    'div',
    { class: 'category-list' },
    categoriesCache.map((c) =>
      el('div', { class: 'category-chip' }, [
        el('span', { class: 'swatch', style: `background:${c.color}` }, []),
        c.name,
      ]),
    ),
  );

  const nameInput = el('input', { type: 'text', placeholder: 'New category name' });
  const colorInput = el('input', { type: 'color', value: '#5b87a6' });
  const addBtn = el('button', { class: 'btn-import' }, ['Add category']);
  addBtn.addEventListener('click', async () => {
    if (!nameInput.value.trim()) return;
    await addCategory(nameInput.value.trim(), colorInput.value);
    await refreshDashboard();
    openCategoryManager(); // re-render with the new category included
  });
  const closeBtn = el('button', { class: 'btn-secondary' }, ['Close']);
  closeBtn.addEventListener('click', closeModal);

  const dialog = el('div', { class: 'modal-dialog' }, [
    el('div', { class: 'section-label' }, ['Manage categories']),
    list,
    el('div', { class: 'manual-form' }, [nameInput, colorInput, addBtn]),
    el('div', { class: 'modal-actions' }, [closeBtn]),
  ]);
  const overlay = el('div', { class: 'modal-overlay' }, [dialog]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  root.replaceChildren(overlay);
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------- Mount

export function mountDashboard(root: HTMLElement): void {
  const searchInput = el('input', { type: 'search', placeholder: 'Search description…', class: 'ledger-search' });
  const catFilter = el('select', { id: 'filter-category' }, [el('option', { value: 'all' }, ['All categories'])]);
  const typeFilter = el('select', {}, [
    el('option', { value: 'all' }, ['All types']),
    el('option', { value: 'income' }, ['Income']),
    el('option', { value: 'expense' }, ['Expense']),
  ]);
  const sortSelect = el('select', {}, [
    el('option', { value: 'date-desc' }, ['Newest first']),
    el('option', { value: 'date-asc' }, ['Oldest first']),
    el('option', { value: 'amount-desc' }, ['Amount: high → low']),
    el('option', { value: 'amount-asc' }, ['Amount: low → high']),
  ]);

  const applyFilters = () => {
    currentQuery = {
      ...currentQuery,
      search: searchInput.value,
      categoryId: catFilter.value as LedgerQuery['categoryId'],
      type: typeFilter.value as LedgerQuery['type'],
      sort: sortSelect.value as LedgerQuery['sort'],
      page: 1,
    };
    void getAllTransactions().then(renderLedger);
  };
  searchInput.addEventListener('input', applyFilters);
  catFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
  sortSelect.addEventListener('change', applyFilters);

  const addManualBtn = el('button', { class: 'btn-secondary' }, ['+ Manual transaction']);
  addManualBtn.addEventListener('click', openManualForm);
  const manageCatBtn = el('button', { class: 'btn-secondary' }, ['Categories']);
  manageCatBtn.addEventListener('click', openCategoryManager);
  const exportBtn = el('button', { class: 'btn-secondary' }, ['Export CSV']);
  exportBtn.addEventListener('click', async () => {
    const all = await getAllTransactions();
    const filtered = queryLedger(all, { ...currentQuery, page: 1, pageSize: Number.MAX_SAFE_INTEGER }).rows;
    downloadCsv(exportTransactionsCsv(filtered), 'transactions.csv');
  });

  const prevBtn = el('button', { id: 'page-prev', class: 'btn-secondary' }, ['← Prev']);
  const nextBtn = el('button', { id: 'page-next', class: 'btn-secondary' }, ['Next →']);
  prevBtn.addEventListener('click', () => {
    currentQuery = { ...currentQuery, page: (currentQuery.page ?? 1) - 1 };
    void getAllTransactions().then(renderLedger);
  });
  nextBtn.addEventListener('click', () => {
    currentQuery = { ...currentQuery, page: (currentQuery.page ?? 1) + 1 };
    void getAllTransactions().then(renderLedger);
  });

  const dashboard = el('div', { class: 'dashboard' }, [
    el('div', { id: 'kpi-grid', class: 'kpi-grid' }),
    el('div', { class: 'chart-row' }, [
      el('div', { class: 'chart-card' }, [
        el('div', { class: 'section-label' }, ['Spending by category']),
        el('canvas', { id: 'chart-spending' }),
      ]),
      el('div', { class: 'chart-card' }, [
        el('div', { class: 'section-label' }, ['Balance over time']),
        el('canvas', { id: 'chart-balance' }),
      ]),
      el('div', { class: 'chart-card' }, [
        el('div', { class: 'section-label' }, ['Weekly income vs. expense']),
        el('canvas', { id: 'chart-weekly' }),
      ]),
    ]),
    el('div', { class: 'ledger-toolbar' }, [
      searchInput,
      catFilter,
      typeFilter,
      sortSelect,
      el('span', { class: 'spacer' }, []),
      addManualBtn,
      manageCatBtn,
      exportBtn,
    ]),
    el('div', { id: 'tx-rows', class: 'tx-table' }),
    el('div', { class: 'ledger-pagination' }, [prevBtn, el('span', { id: 'page-info' }, ['']), nextBtn]),
    el('div', { id: 'modal-root' }),
  ]);

  root.append(dashboard);
  void refreshDashboard();
}

export { refreshDashboard };
