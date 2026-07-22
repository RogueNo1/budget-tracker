# Budget Tracker — Technical Reference (CLAUDE.md)

This document is the primary technical reference for the Budget Tracker project. It documents
what exists today (two standalone HTML prototypes plus sample bank data), the two statement
formats the project must support, and the intended architecture for the next version — a
modular web application with user accounts and persistent storage.

---

## 1. Project Overview

### Purpose

Turn raw bank/account statements into a personal budget dashboard: import a statement, see
income vs. expenses, spending by category, balance over time, and a searchable, filterable,
categorised transaction ledger.

The project currently exists as **two independent single-file prototypes**, each handling one
statement format:

| Prototype | Statement format | Currency / locale | Rendering |
|---|---|---|---|
| `budget-ledger.html` | **PDF** bank statements (US credit-union column layout) | USD (`$`) | Chart.js (CDN) |
| `budget-tracker-2.html` | **CSV** exports (Capitec Bank South Africa layout) | ZAR (`en-ZA`, `R`) | Hand-rolled SVG/CSS charts |

Both run entirely client-side in the browser — no server, no build step, no persistence.
Everything is lost on page refresh. The goal of the next version is to merge these into one
application that imports **both** formats, auto-detects the type, normalises to a shared
transaction model, and adds user accounts with online storage.

### Files in this folder

| File | Role |
|---|---|
| `budget-ledger.html` | PDF-import prototype. pdf.js text extraction → line reconstruction → regex transaction parsing → regex auto-categorisation → dashboard (summary cards, doughnut + line charts, ledger table with per-row category override, CSV export). |
| `budget-tracker-2.html` | CSV-import prototype. Custom CSV parser → normalised objects → dashboard (5 KPI cards, weekly income/expense bars, category donut, balance line, paginated/sortable/filterable table, per-transaction detail modal). |
| `account_statement_1-Apr-2026_to_17-Jul-2026.csv` | Sample CSV export, 223 rows, 2026-04-01 → 2026-07-17. |
| `DOC-20260316-WA0001.csv` | Sample CSV export, 628 rows, 2025-03-01 → 2026-03-16 (longest history). |
| `DOC-20260316-WA0002.csv` | Sample CSV export, 105 rows, 2026-02-01 → 2026-03-16. **Entirely contained within WA0001's tail** — a real-world duplicate-import case. |
| `DOC-20260420-WA0008.csv` | Sample CSV export, 220 rows, 2026-01-01 → 2026-04-19. Overlaps both files above; contains `(Pending)` transactions. |

All four CSVs are exports of the **same account** (`2009932044`, a Capitec Global One account —
note the Live Better round-ups, Capitec Pay, PayShap, and SWIFT entries). The overlapping date
ranges make duplicate detection a hard requirement, not a nice-to-have (see §7).

There is no PDF sample in the repo; `budget-ledger.html` was built against US credit-union
statements whose transaction table is `Date · Description · Amount · Balance` in columns.

---

## 2. Statement Formats

### 2.1 PDF-based statement (handled by `budget-ledger.html`)

**File structure.** A text-based (not scanned) PDF where each transaction is one or more visual
lines: the first line starts with a date and contains the transaction type, one or two dollar
amounts, and the running balance; subsequent indented lines carry description detail. Statement
boilerplate (disclosure paragraphs, page headers, "Beginning/Ending Balance" rows) is
interleaved with transactions.

**Parsing pipeline** (`budget-ledger.html:238-313`):

1. **Text extraction** — pdf.js (`3.11.174`, CDN) reads every page via `getTextContent()`.
   Each text item keeps its `x`/`y` coordinates.
2. **Line reconstruction** (`extractLines`) — items are bucketed into rows by rounded `y`
   coordinate with a ±2pt tolerance (PDF text items on the same visual line rarely share an
   exact `y`). Rows are emitted top-to-bottom (`y` descending), items within a row sorted by
   `x` ascending and joined with spaces.
3. **Transaction assembly** (`parseTransactions`) — a state machine over the lines:
   - A line matching `^(\d{1,2}\/\d{1,2}\/\d{2,4})\b` **starts a new transaction**.
   - Lines containing "beginning balance" / "ending balance" are discarded.
   - All money tokens matching `\$?-?[\d,]+\.\d{2}-?` are extracted; the **last** token is the
     running balance, the **first** (when ≥2 tokens exist) is the transaction amount. A
     **trailing `-`** (credit-union convention, e.g. `152.36-`) marks a withdrawal.
   - Remaining text on the date line becomes the `type`; following non-date lines are appended
     to `description`, except boilerplate (matched by `SKIP_LINE_RE`) and bare amount lines.
   - Lines with a date but only one money token (no amount, just balance) are parsed but later
     dropped by `filter(t => t.direction)`.
4. **Date parsing** — `M/D/YY` or `M/D/YYYY`; 2-digit years become `2000 + y`.

**Extracted fields per transaction:**

| Field | Type | Notes |
|---|---|---|
| `dateStr` | string | As printed, e.g. `3/14/25` |
| `date` | `Date` | Parsed, US month-first |
| `type` | string | Date-line remainder, e.g. `Withdrawal Debit Card` |
| `description` | string | Concatenated continuation lines |
| `amount` | number | **Signed**: negative = withdrawal, positive = deposit |
| `direction` | `'deposit'│'withdrawal'` | Derived from trailing-minus convention |
| `balance` | number | Running balance after the transaction |

**Normalisation performed:** currency symbols/commas stripped; trailing-minus converted to a
signed float; whitespace collapsed; multi-line descriptions merged. **No category comes from
the statement** — categories are inferred by first-match against 14 regex rules
(`CATEGORY_RULES`, `budget-ledger.html:207-222`), falling back to `Other`.

### 2.2 CSV-based statement (handled by `budget-tracker-2.html`)

**File structure.** A Capitec transaction-history export. One header row, then one row per
transaction, oldest first:

```
Nr,Account,Posting Date,Transaction Date,Description,Original Description,Parent Category,Category,Money In,Money Out,Fee,Balance
```

| Column | Example | Notes |
|---|---|---|
| `Nr` | `14` | Sequence number **within this export only** — restarts at 1 per file. Not a stable ID. |
| `Account` | `2009932044` | Account number, same on every row. |
| `Posting Date` | `2026-04-14` | ISO `YYYY-MM-DD`, the date the bank posted it. |
| `Transaction Date` | `2026-04-14 18:20` | ISO date + `H:mm` time (hour not always zero-padded). Can be **days earlier** than posting date for card purchases. |
| `Description` | `Banking App Immediate Payment: Heidi Rootman` | Cleaned, human-readable. May be prefixed `(Pending) …` for unsettled transactions. |
| `Original Description` | `HEIDI ROOTMAN` | Raw bank/merchant string (fixed-width merchant + city + country). |
| `Parent Category` | `Personal & Family` | Bank-assigned top-level category. |
| `Category` | `Digital Payments` | Bank-assigned sub-category. |
| `Money In` | `500.00` | **Positive** or empty. |
| `Money Out` | `-94.00` | **Negative** or empty. |
| `Fee` | `-1.00` | **Negative** or empty; a separate charge on the same row (or a fee-only row where both Money In/Out are empty). |
| `Balance` | `2996.17` | Running balance after the row (including its fee). |

Exactly one of `Money In` / `Money Out` / `Fee` is normally populated; fee-only rows exist
(e.g. `Immediate Payment Fee`).

**Parsing pipeline** (`budget-tracker-2.html:869-904`):

1. `parseCSV` — splits on `\n`, walks characters to honour double-quoted fields containing
   commas, maps columns by header name, and drops rows without an `Nr` value.
2. `normalise` — converts to typed objects: `parseFloat` on the money columns (`0` when
   empty; `balance` becomes `null` when absent), keeps both date strings as strings, and sets
   `isPending` when the description contains "pending".

**Extracted fields:** `nr`, `account`, `postingDate`, `transactionDate`, `description`,
`originalDescription`, `parentCategory`, `category`, `moneyIn`, `moneyOut`, `fee`, `balance`,
`isPending`.

**Normalisation performed:** numeric coercion and the pending flag only. Categories are taken
as-is from the bank; no rules engine. Dates stay as strings and are fed to `new Date(...)`
at sort/chart time.

### 2.3 Key differences between the formats

| Aspect | PDF (credit union) | CSV (Capitec) |
|---|---|---|
| Amount encoding | One signed `amount` + `direction`; trailing `-` = negative | Three columns: `Money In` (+), `Money Out` (−), `Fee` (−) |
| Fees | Folded into the amount / separate rows, not distinguished | First-class `Fee` column |
| Dates | Single `M/D/YY` date, US order, no time | Two ISO dates (posting + transaction) with time |
| Categories | **None in source** — inferred by regex rules | **Two-level bank-assigned** categories included |
| Description | Reconstructed from multi-line PDF text | Two variants provided (clean + raw) |
| Currency | USD | ZAR |
| Row identity | None | `Nr` (per-file only) |
| Pending state | Not represented | `(Pending)` prefix in description |
| Parsing risk | High (layout heuristics, y-bucketing, regex) | Low (structured, but quoted-field and CRLF care needed) |

### 2.4 Common internal transaction schema

Both parsers must map into this shared model (the superset of both formats). All new code
should consume **only** this shape:

```ts
interface Transaction {
  id: string;               // Stable app-generated ID (see §7) — never the CSV `Nr`
  accountId: string | null; // Bank account number when known (CSV); null for PDF
  postedDate: string;       // ISO YYYY-MM-DD — the canonical date for sorting/reporting
  transactionDate: string | null; // ISO datetime when available (CSV only)
  description: string;      // Clean display description (CSV Description / PDF type+description)
  rawDescription: string;   // Original Description (CSV) or the raw reconstructed line (PDF)
  amount: number;           // SIGNED, in minor units or decimal: inflow > 0, outflow < 0.
                            //   CSV: moneyIn + moneyOut  |  PDF: signed amount
  fee: number;              // ≤ 0. CSV Fee column; 0 for PDF (fees are their own rows there)
  balance: number | null;   // Running balance after the transaction, when the source provides it
  currency: string;         // ISO 4217, e.g. 'ZAR' | 'USD' — from source detection, not hardcoded
  categoryId: string;       // App category (see §7); seeded from bank category or rules engine
  bankCategory: string | null;       // CSV Category, verbatim (provenance)
  bankParentCategory: string | null; // CSV Parent Category, verbatim
  status: 'settled' | 'pending';
  source: 'pdf' | 'csv' | 'manual';  // How this transaction entered the system
  importId: string | null;  // FK to the import batch that produced it (null for manual)
  fingerprint: string;      // Dedup hash (see §7)
}
```

Mapping rules:

- **CSV → model:** `amount = moneyIn + moneyOut` (one is always 0); `fee` from the Fee column;
  strip a leading `(Pending) ` from description and set `status: 'pending'`; `postedDate` from
  Posting Date; keep bank categories verbatim in the `bankCategory*` fields and use them to
  seed `categoryId`.
- **PDF → model:** `amount` is the signed parsed amount; `fee = 0`; `postedDate` = the parsed
  date converted to ISO; `transactionDate = null`; `categoryId` seeded from the regex rules
  engine; `bankCategory* = null`.
- Never store direction separately — derive it (`amount >= 0`) at display time.

---

## 3. Existing Functionality

### 3.1 `budget-ledger.html` (PDF prototype) — detailed

**Features**

- Drag-and-drop or file-picker import of **one or more** PDFs (multi-month merge supported).
- Summary cards: Total in, Total out, Net change, Ending balance (+ deposit/withdrawal counts
  and the statement date span).
- "Where it went" doughnut chart (withdrawals grouped by category, Chart.js).
- "Balance over time" filled line chart (running balance per transaction, Chart.js).
- Ledger table: date, type + description, category `<select>`, signed amount, balance.
- Per-row **category override** via the dropdown (in-memory only).
- Text search over type+description; category filter dropdown.
- **Export CSV** (`Date,Type,Description,Category,Amount,Balance`, quoted/escaped).
- Privacy stance: all parsing happens locally in the browser; nothing is uploaded.

**Data flow**

```
file input / drop → handleFiles()
  → pdfjsLib.getDocument(arrayBuffer)
  → extractLines(pdf)         // y-bucketed line reconstruction
  → parseTransactions(lines)  // state machine, regex amounts
  → collected[] sorted by date, concatenated onto allTxns
  → renderAll(): renderSummary() + renderCharts() + renderTable()
```

State is three globals: `allTxns` (array), `overrides` (index → category name),
`catChart`/`balChart` (Chart.js instances, destroyed and rebuilt on each render).

**Transaction processing** — see §2.1. Categorisation is `categorize(t)`: first matching
regex in `CATEGORY_RULES` wins over the `type + ' ' + description` haystack; `Other` otherwise.
`getCategory(t, idx)` checks `overrides[idx]` first.

**Budget calculations**

- Income = Σ amount over `direction === 'deposit'`; Expenses = Σ |amount| over withdrawals;
  Net = income − expenses.
- Ending balance = `balance` of the **last transaction after date sort** (not a computed value).
- Doughnut = Σ |amount| per category, withdrawals only.

**UI behaviour** — app section hidden until the first successful parse; status line shows
progress/errors in-place; charts re-render on every category override; table re-renders on
search/filter input; "Add another statement" appends without clearing.

**Assumptions & limitations (important when porting)**

1. **Category overrides are keyed by array index** (`overrides[idx]`). Importing another PDF
   re-sorts `allTxns`, so existing overrides silently attach to *different* transactions.
   This is the strongest argument for stable transaction IDs (§7).
2. **No duplicate detection** — importing the same PDF twice doubles every number.
3. US-only conventions: `M/D/YY` dates, `$`, trailing-minus negatives.
4. Only works on **text-based** PDFs (no OCR); layout heuristics assume amount-then-balance
   column order and fail politely otherwise (error message in `#status`).
5. Single-amount date lines are dropped — real transactions can be lost if the amount token
   isn't detected.
6. No persistence of anything (transactions, overrides) across refresh.
7. `renderTable` builds rows with `innerHTML` from statement text — an XSS vector if a
   malicious statement is imported; the rewrite must escape or use `textContent`.

### 3.2 `budget-tracker-2.html` (CSV prototype) — summary

- Import **one** CSV (picker or drop); a new import **replaces** `allTxns` (`catColorMap` is
  not reset, so colours accumulate across loads).
- KPI cards: Total Income, Total Expenses (excl. fees), Net Cash Flow, Fees Paid, Current
  Balance (+ progress bars scaled against income).
- Charts (no library): last-8-weeks income vs. expense bar pairs (weeks keyed by Monday via
  `getWeekKey`), SVG donut of spending by bank category with legend (top 8), SVG balance
  polyline (evenly spaced by index, not by time).
- Table: paginated (20/row pages), search (description + category), category filter, Money
  In/Out type filter, four sort orders (date/amount asc/desc). Sort ties broken by `nr`.
- Row click opens a **detail modal** (amount, dates, categories, fee, balance, account, `Nr`)
  — looked up by `t.nr`, which is safe only because a single file is loaded at a time.
- Pending rows get a blinking dot (from `isPending`).
- ZAR formatting via `Intl.NumberFormat('en-ZA', { currency: 'ZAR' })`.
- **No** category editing, no export, no multi-file merge, no persistence. Same `innerHTML`
  XSS caveat as the PDF prototype.

Feature-parity checklist for the rewrite (union of both prototypes): multi-file import &
merge (PDF prototype), replace-vs-append choice, KPI cards incl. fees, all three chart types,
search/filter/sort/pagination, per-row category editing, transaction detail modal, CSV export,
pending indicator, local-first privacy messaging.

---

## 4. Target Application

One application that supersedes both prototypes.

### Import pipeline

```
File(s) → detectFormat() → parser (pdf | csv) → Transaction[] (common schema, §2.4)
        → fingerprint + dedup against store (§7) → ImportReview (new / duplicate / conflict)
        → user confirms → persisted to the user's account
```

**Format detection** (`detectFormat`):

1. Extension/MIME: `application/pdf` or `%PDF-` magic bytes → PDF parser; `.csv`/`text/*` →
   CSV sniffing.
2. CSV sniffing: read the first line; if it contains the Capitec header signature
   (`Nr,Account,Posting Date,…`) → Capitec CSV parser. Unknown headers → error listing the
   expected columns (and, later, a column-mapping UI).
3. PDF sniffing: run line extraction; if no lines match the date-leading transaction pattern,
   fail with the "works best with Date · Description · Amount · Balance layouts" guidance.

**Parser modules** are pure functions with no DOM access, one per format, each returning
`{ transactions: Transaction[], warnings: string[], meta: { account?, currency, dateRange } }`.
This makes them unit-testable against the sample CSVs in this folder and against pdf.js
text fixtures (store extracted-line arrays as JSON fixtures so tests don't need real PDFs).

**Currency** comes from the parser (`USD` for the credit-union PDF, `ZAR` for Capitec) and is
stored per transaction; formatting uses `Intl.NumberFormat` with the transaction's currency
instead of the current hardcoded `$`/`R`.

**Categorisation service:** seed `categoryId` from bank categories (CSV) or the regex rules
engine (PDF, ported from `CATEGORY_RULES`); user overrides always win and are persisted
(§7). Keep the rules engine data-driven (JSON rules) so users can add their own rules later.

### Preserved functionality

Everything in the §3.2 parity checklist, implemented once against the common schema. The
dashboard no longer cares which format a transaction came from; `source`/`importId` appear
only in the detail modal and import history.

---

## 5. User Accounts

Recommended approach: a small backend with token-based auth; the frontend remains the
existing SPA style. (See §8 for concrete stack suggestions.)

- **Registration/login:** email + password. Hash passwords with **argon2id** (or bcrypt,
  cost ≥ 12). Never store plaintext. Verify email before enabling sync if abuse is a concern.
- **Sessions:** short-lived JWT access token (~15 min) + rotating refresh token in an
  `HttpOnly; Secure; SameSite=Lax` cookie. All API routes except `/auth/*` require auth.
- **Isolation:** every table carries `user_id`; every query filters by the authenticated
  user's id server-side (never trust a client-supplied user id). Enable row-level security
  if using Postgres/Supabase.
- **What is persisted per user:**
  - **Imports:** one `imports` row per uploaded file (filename, format, detected account,
    date range, row counts, dedup stats). Optionally the raw file in object storage
    (encrypted at rest) for re-parsing; make raw-file retention a user setting given the
    sensitivity of bank data.
  - **Transactions:** the canonical, deduplicated ledger (§7).
  - **Edits:** category overrides, renamed descriptions, notes — stored as fields on the
    transaction plus an audit trail (§7).
  - **Custom categories:** user-defined category tree (name, parent, colour, icon) plus
    user-defined auto-categorisation rules.
  - **Budgets & settings:** per-category monthly budget amounts, default currency, locale,
    display preferences.
- **Security baseline:** TLS everywhere; rate-limit auth endpoints; validate uploads
  (size cap, MIME sniffing) and parse them in a way that can't execute content; encrypt
  backups; no bank statement data in logs.

---

## 6. Transactions

- **IDs:** every transaction gets an app-generated UUID (`id`) at import/creation time.
  Never reuse the CSV `Nr` (it restarts per export) or an array index (the override-loss bug
  in `budget-ledger.html`, §3.1.1) as identity.
- **Duplicate detection:** compute a deterministic `fingerprint` per transaction:
  `sha256(accountId | postedDate | amount | fee | normalisedRawDescription | balance)`.
  On import, a fingerprint already present for that user ⇒ flagged duplicate (default:
  skip, with an import-review screen to override). This directly handles the real sample
  data: `DOC-20260316-WA0002.csv` is fully contained in `WA0001`, and `WA0008` overlaps both.
  Legitimate identical same-day transactions (two `R48` café card swipes) are distinguished
  by `Transaction Date` time and `balance`, both in the hash; when balance is missing (PDF),
  fall back to an occurrence counter within the import (`…|n`th identical row) so re-importing
  the same file dedups but genuinely repeated rows within one statement survive.
  A pending transaction should be **replaced** by its settled version: match on
  account+amount+similar description within a date window, then update in place.
- **Edits:** user edits (category, description alias, notes, exclude-from-budget flag) live
  on the transaction row; parser-derived fields (`rawDescription`, `amount`, `balance`,
  `bankCategory`) are immutable provenance. Re-imports must never clobber user edits —
  dedup-by-fingerprint guarantees the edited row is kept and the incoming duplicate dropped.
- **User-created transactions:** `source: 'manual'`, `importId: null`, no fingerprint-based
  dedup (or fingerprint over id), fully editable including amount/date, and deletable
  (imported transactions are excluded/hidden rather than hard-deleted, so a re-import
  doesn't resurrect them).
- **History:** an append-only `transaction_events` audit table (`transaction_id, user_id,
  timestamp, field, old_value, new_value, source: user|import|system`) records category
  changes, edits, and pending→settled replacements; enables undo and "why is this
  categorised as X?" answers.

---

## 7. Recommended Architecture

### Stack

- **Frontend:** Vite + TypeScript. Plain TS + small components is acceptable to stay close
  to the prototypes' spirit; React is the default choice if the team prefers a framework.
  Chart.js for all charts (the hand-rolled SVG charts in `budget-tracker-2.html` are not
  worth maintaining). pdf.js as an npm dependency (pin the version; keep the worker local
  instead of CDN).
- **Backend:** Node.js + TypeScript (Fastify or Express) — shares the parser/schema code
  with the frontend. Parsing can stay **client-side** (privacy: raw statements never leave
  the browser; only normalised transactions sync) with the same parser package usable
  server-side later.
- **Database:** PostgreSQL (Supabase is a pragmatic hosted option: Postgres + auth + RLS in
  one). SQLite is fine for local development.

### Folder structure

```
budget-tracker/
├── packages/
│   ├── core/                  # Framework-free domain code (shared FE/BE)
│   │   ├── model/             # Transaction, Category, Budget, Import types (§2.4)
│   │   ├── parsers/
│   │   │   ├── detect.ts      # Format detection
│   │   │   ├── capitecCsv.ts  # CSV parser (from budget-tracker-2.html)
│   │   │   └── pdfStatement.ts# PDF line-reconstruction + parser (from budget-ledger.html)
│   │   ├── categorize/        # Rules engine + default rules JSON
│   │   ├── dedup/             # Fingerprinting, import merge
│   │   └── budget/            # Totals, per-category aggregation, weekly buckets
│   ├── web/                   # Vite app: views, charts, import review UI, auth screens
│   └── api/                   # Fastify app: routes, auth, db access (Drizzle/Prisma)
├── tests/
│   ├── fixtures/              # The 4 sample CSVs + extracted-PDF-line JSON fixtures
│   └── ...                    # Parser, dedup, budget-math unit tests
└── CLAUDE.md
```

The rule that matters most: **`core` has no DOM and no HTTP** — everything in it is testable
with plain unit tests against the fixtures in this repo.

### Database schema (Postgres)

```sql
users        (id uuid PK, email citext UNIQUE, password_hash text, created_at, settings jsonb)
accounts     (id uuid PK, user_id FK, bank_account_no text, label text, currency char(3))
imports      (id uuid PK, user_id FK, account_id FK NULL, filename text, format text,
              imported_at timestamptz, date_from date, date_to date,
              rows_total int, rows_new int, rows_duplicate int, raw_file_key text NULL)
categories   (id uuid PK, user_id FK NULL,      -- NULL = built-in default category
              parent_id FK NULL, name text, color text, UNIQUE(user_id, parent_id, name))
category_rules (id uuid PK, user_id FK, pattern text, category_id FK, priority int)
transactions (id uuid PK, user_id FK, account_id FK NULL, import_id FK NULL,
              posted_date date, transaction_at timestamptz NULL,
              description text, raw_description text,
              amount_minor bigint, fee_minor bigint DEFAULT 0, balance_minor bigint NULL,
              currency char(3), category_id FK, bank_category text NULL,
              bank_parent_category text NULL,
              status text CHECK (status IN ('settled','pending')),
              source text CHECK (source IN ('pdf','csv','manual')),
              excluded bool DEFAULT false, notes text NULL,
              fingerprint text, UNIQUE(user_id, fingerprint))
transaction_events (id, transaction_id FK, user_id FK, at timestamptz,
                    field text, old_value text, new_value text, actor text)
budgets      (id uuid PK, user_id FK, category_id FK, month date, amount_minor bigint,
              UNIQUE(user_id, category_id, month))
```

Store money as **integer minor units** (cents) — both prototypes accumulate float errors with
`parseFloat` + `reduce`.

### API surface (REST, JSON, all routes user-scoped)

```
POST   /auth/register | /auth/login | /auth/refresh | /auth/logout
GET    /me                          # profile + settings
GET    /transactions                # filters: q, category, type, date range, account; paginated
POST   /transactions                # manual transaction
PATCH  /transactions/:id            # category/description/notes/excluded
GET    /transactions/:id/events
POST   /imports                     # multipart upload OR pre-parsed transaction batch
GET    /imports  /imports/:id       # history + dedup report
GET|POST|PATCH|DELETE /categories, /categories/rules
GET|PUT /budgets?month=YYYY-MM
GET    /summary?from&to             # KPI + chart aggregates (or compute client-side)
POST   /export/csv
```

If parsing stays client-side, `POST /imports` accepts the normalised `Transaction[]` batch
plus file metadata; the server re-runs fingerprint dedup as the source of truth.

### Extensibility

- **New bank formats** = one new module in `core/parsers` returning the common schema, plus a
  detection signature — nothing else changes.
- Category rules, budgets, and currencies are all data, not code.
- Future candidates the schema already accommodates: multiple accounts per user, multi-currency
  reporting (per-transaction `currency`), recurring-transaction detection (fingerprint +
  description clustering), budget alerts, shared/household ledgers (add a `ledger_id`
  indirection between `users` and data if this becomes real).

---

## Appendix: gotchas checklist for the rewrite

- [ ] Escape all statement-derived text before inserting into the DOM (both prototypes use raw `innerHTML`).
- [ ] Handle CRLF and quoted commas in CSV (current parser relies on `trim` to survive `\r`).
- [ ] CSV `Nr` is per-file; never treat it as identity.
- [ ] CSV money: `Money In` positive, `Money Out`/`Fee` negative, blanks = 0; fee-only rows exist.
- [ ] `(Pending)` prefix → `status: 'pending'`; replace with settled version on re-import.
- [ ] PDF trailing-minus amounts (`152.36-`) are withdrawals; last money token on the line is the balance.
- [ ] PDF 2-digit years → `2000 + y`; US month-first order.
- [ ] Keep category overrides keyed by transaction `id`, not array index.
- [ ] Integer minor units for money; `Intl.NumberFormat` with per-transaction currency.
- [ ] Test dedup against the real overlap: WA0002 ⊂ WA0001; WA0008 overlaps both.
