# Budget Tracker — Implementation Steps

A step-by-step build guide for the target application described in [CLAUDE.md](CLAUDE.md).
Follow the phases in order — each phase ends with something working and verifiable, and later
phases only build on earlier ones. Estimated effort assumes one developer (or Claude Code)
working incrementally.

**Ground rules for every phase**

- All domain logic goes in `packages/core` — no DOM, no HTTP, no framework imports there.
- Money is always integer **minor units** (cents). Convert at the parser boundary, format at
  the display boundary with `Intl.NumberFormat` and the transaction's own currency.
- Every transaction is identified by its app-generated UUID `id` — never a CSV `Nr`, never an
  array index.
- Statement-derived text is never inserted with `innerHTML` — always escaped or `textContent`.
- Each step's "Verify" box must pass before moving on.

---

## Phase 0 — Project scaffold

**Goal:** empty monorepo that builds, tests, and runs a blank page.

1. Create the repo and workspace layout from CLAUDE.md §8:
   ```
   budget-tracker/
   ├── package.json            # npm workspaces: packages/*
   ├── packages/
   │   ├── core/               # tsc library, zero runtime deps (pdf.js comes later)
   │   ├── web/                # Vite + TypeScript app
   │   └── api/                # Fastify + TypeScript app (empty for now)
   └── tests/fixtures/
   ```
2. Tooling: TypeScript strict mode, Vitest for tests, ESLint + Prettier, a root
   `npm run build / test / dev` that fans out to workspaces.
3. Copy the four sample CSVs from this folder into `tests/fixtures/csv/`.
4. `git init`, first commit.

> **Verify:** `npm run build` and `npm run test` succeed (0 tests); `npm run dev -w web`
> serves a blank page.

---

## Phase 1 — Core domain model

**Goal:** the shared types every later step depends on.

1. `packages/core/src/model/transaction.ts` — the `Transaction` interface exactly as in
   CLAUDE.md §2.4, plus `Category`, `Budget`, `ImportBatch`, `ParseResult`
   (`{ transactions, warnings, meta: { account?, currency, dateRange } }`).
2. `packages/core/src/model/money.ts` — helpers: `toMinor(decimalString) → bigint/number`,
   `formatMoney(minor, currency, locale)`. Parse decimal strings digit-by-digit; **never**
   `parseFloat` for storage.
3. `packages/core/src/model/id.ts` — `newId()` (UUID v4).

> **Verify:** unit tests for `toMinor` covering `"500"`, `"-94.00"`, `""`, `"-0.35"`,
> `"1,234.56"`, trailing-minus `"152.36-"`.

---## Phase 2 — CSV parser (Capitec)

**Goal:** all four fixture files parse into the common schema. Do CSV before PDF — it is the
structured format and validates the model cheaply.

1. `packages/core/src/parsers/capitecCsv.ts`:
   - Robust CSV tokenizer: quoted fields, escaped quotes, **CRLF and LF**, trailing newline.
   - Header validation against the 12-column Capitec signature (CLAUDE.md §2.2); unknown
     header → typed error listing expected columns.
   - Row mapping per CLAUDE.md §2.4: `amount = moneyIn + moneyOut`, `fee` from Fee column,
     strip `(Pending) ` prefix → `status: 'pending'`, keep `bankCategory`/`bankParentCategory`
     verbatim, `currency: 'ZAR'`, `source: 'csv'`.
   - Money through `toMinor`; blank cells → 0 (`balance` → `null`).
2. Emit `warnings` for rows that fail to map instead of throwing away silently.

> **Verify:** tests assert — WA0001 yields 628 transactions; account `2009932044` on all;
> row `Immediate Payment Fee` maps to `amount: 0, fee: -100` (minor units); a `(Pending)` row
> maps to `status: 'pending'` with a clean description; sum of amounts+fees between two rows
> equals the balance delta for a sampled window.

---

## Phase 3 — PDF parser

**Goal:** port `budget-ledger.html`'s extraction into `core`, testable without a real PDF.

1. Split into two functions so the pdf.js dependency stays at the edge:
   - `packages/web/src/pdf/extractLines.ts` — the pdf.js part: text items → y-bucketed
     (±2pt), x-sorted, top-to-bottom `string[]` (port of `extractLines`,
     budget-ledger.html:238-264). Ship pdf.js from npm with a **local** worker file.
   - `packages/core/src/parsers/pdfStatement.ts` — pure `parseStatementLines(lines: string[])`:
     the date-line state machine (port of `parseTransactions`, budget-ledger.html:266-307)
     mapping to the common schema — trailing-minus = negative, last money token = balance,
     2-digit year → `2000 + y`, date → ISO `postedDate`, `currency: 'USD'`, `fee: 0`,
     `transactionDate: null`, `source: 'pdf'`.
2. Create `tests/fixtures/pdf-lines/*.json` — arrays of extracted lines (hand-write one from
   the layout description; capture real ones with a debug dump once a real statement is
   available). Tests run against these, not PDFs.
3. Fix the known prototype bug: don't silently drop date lines with a single money token —
   record them as warnings.

> **Verify:** fixture tests cover a deposit, a trailing-minus withdrawal, a multi-line
> description, a boilerplate line to skip, and a beginning/ending-balance row to discard.

---

## Phase 4 — Format detection + categorisation + dedup

**Goal:** the full import pipeline in `core`.

1. `parsers/detect.ts` (CLAUDE.md §4): magic bytes `%PDF-` → pdf; first line matches Capitec
   header → capitecCsv; otherwise a typed `UnknownFormatError` with user guidance.
2. `categorize/` — data-driven rules engine: rules are `{ pattern, categoryId, priority }`
   JSON; port the 14 regexes from `CATEGORY_RULES` (budget-ledger.html:207-222) as the
   default ruleset. Seeding order: explicit user override > user rule > bank category (CSV) >
   default rule > `Other`.
3. `dedup/fingerprint.ts` — per CLAUDE.md §7:
   `sha256(accountId|postedDate|amount|fee|normalisedRawDescription|balance)`, with the
   occurrence-counter fallback when `balance` is null, and the pending→settled matcher.
4. `dedup/merge.ts` — `mergeImport(existing: Transaction[], incoming: Transaction[])` →
   `{ new, duplicates, pendingReplacements }`. Pure function; never mutates user-edited fields.

> **Verify:** the decisive test — parse WA0001 then merge WA0002: **0 new, 105 duplicates**.
> Merge WA0008 after both: only the non-overlapping rows are new; the `(Pending)` Food
> Lover's row replaces nothing yet (no settled twin in fixtures) and imports as pending.
> Two identical same-day `R48` café rows within one file both survive.

---

## Phase 5 — Frontend: import flow + local persistence

**Goal:** a usable local-first app (no accounts yet) with feature parity on import.

1. `packages/web`: app shell — header, empty state with drop zone + file picker
   (accept `.csv,.pdf`, **multiple**), privacy note ("parsed locally in your browser").
2. Wire drop/pick → `detect` → parser → `mergeImport` → **Import Review screen**: counts of
   new / duplicate / pending-replaced, expandable duplicate list, Confirm / Cancel.
3. Persist to **IndexedDB** (e.g. `idb` wrapper): `transactions`, `imports`, `overrides`,
   `settings` stores. This is the offline cache that later syncs to the API — keep the data
   shape identical to the future DB rows so Phase 8 is a transport swap, not a rewrite.
4. Import history view listing past imports with their dedup stats.

> **Verify:** drop WA0001 then WA0002 in the running app → review screen reports 105
> duplicates; confirm; refresh the page → data still there; import the same file again →
> 0 new.

---

## Phase 6 — Frontend: dashboard (feature parity)

**Goal:** everything both prototypes did, once, against the common schema. Work through the
parity checklist in CLAUDE.md §3.2.

1. **KPI cards** (5): Total Income, Total Expenses (excl. fees), Net Cash Flow, Fees Paid,
   Current Balance — computed in `core/budget/` (pure functions, unit-tested), rendered with
   per-currency formatting.
2. **Charts** (Chart.js): spending-by-category doughnut, balance-over-time line (x = real
   dates, not row index — fixes the prototype), weekly income vs. expense bars (Monday-keyed
   week bucketing ported to `core/budget/weeks.ts`).
3. **Ledger table**: date, description (+detail), category dropdown, Money In / Money Out /
   Fee / Balance columns, signed colouring, pending dot. Pagination (20/page), search,
   category filter, type filter, 4 sort orders.
4. **Category editing**: dropdown per row writes an override keyed by transaction `id`,
   persisted to IndexedDB, charts re-render. Add a "manage categories" screen (create/rename/
   recolour custom categories, edit rules).
5. **Detail modal** on row click: all fields incl. provenance (`source`, import, raw
   description, bank category) — looked up by `id`.
6. **Manual transactions**: add/edit/delete form (`source: 'manual'`).
7. **CSV export** of the filtered view (quoted/escaped, same column order as the prototype).
8. Escape every statement-derived string at render time (no raw `innerHTML`).

> **Verify:** import all four fixtures → totals match hand-checked sums; edit a category,
> re-import the same file, edit survives; export → re-import round-trips; XSS canary — a
> fixture row with `<img onerror>` in the description renders inert.

---

## Phase 7 — Backend: API + database

**Goal:** the Fastify API and Postgres schema from CLAUDE.md §8, no auth wiring yet.

1. Stand up Postgres (Docker Compose for dev; SQLite acceptable locally). Create the schema
   from CLAUDE.md §8 with a migration tool (Drizzle or Prisma): `users`, `accounts`,
   `imports`, `categories`, `category_rules`, `transactions`
   (with `UNIQUE(user_id, fingerprint)`), `transaction_events`, `budgets`.
2. Implement routes (CLAUDE.md §8 API surface): transactions CRUD + query filters +
   pagination; `POST /imports` accepting the **pre-parsed transaction batch** + file metadata
   (parsing stays client-side for privacy); imports history; categories + rules; budgets;
   `GET /summary`.
3. Server re-runs fingerprint dedup on `POST /imports` — the DB unique constraint is the
   source of truth; return the dedup report.
4. Write `transaction_events` rows on every PATCH (field, old, new, actor).
5. Integration tests with a seeded test user (hardcoded until Phase 8) covering the WA0001 +
   WA0002 dedup case end-to-end over HTTP.

> **Verify:** `POST /imports` with WA0001's parsed batch → 628 created; repeat with WA0002's
> → `rows_new: 0, rows_duplicate: 105`; PATCH a category → an event row exists.

---

## Phase 8 — Auth + user accounts + sync

**Goal:** real users, isolated data, frontend talks to the API.

1. **Auth routes** (CLAUDE.md §5): register (email + argon2id hash), login, refresh, logout.
   Access JWT ~15 min; rotating refresh token in `HttpOnly; Secure; SameSite=Lax` cookie.
   Rate-limit `/auth/*`.
2. Auth middleware on everything else; **every query filtered by the token's `user_id`** —
   never a client-supplied one. Add Postgres RLS policies as a second fence.
3. Frontend: register/login screens, session handling, silent refresh.
4. **Sync layer**: IndexedDB becomes the offline cache; on login, push local-only data up
   (server dedups), pull server state down; queue mutations when offline. Simplest correct
   model: server wins on conflict, edits replay from the mutation queue.
5. Settings screen: default currency/locale, raw-file retention opt-in, budgets per category
   per month (`PUT /budgets`), budget-vs-actual bars on the dashboard.
6. Isolation test: two users import the same file — each sees only their own 628 rows.

> **Verify:** register → import → logout → login on another browser → data is there; second
> user sees nothing; expired access token silently refreshes; wrong-user id in a URL → 404.

---

## Phase 9 — Hardening + deployment

1. **Security pass:** upload size caps and MIME sniffing; helmet/CSP headers; dependency
   audit; confirm no statement data reaches logs; TLS via the host.
2. **Error UX:** unknown CSV headers → column list message; unparseable PDF → the
   "Date · Description · Amount · Balance" guidance; partial-parse warnings surfaced in the
   import review.
3. **Performance:** virtualised table for multi-year datasets (WA0001 is 628 rows for one
   year; multi-account users will grow past 10k); server-side pagination already in place.
4. **Deploy:** Postgres + API on a managed host (Fly.io / Railway / Supabase), static `web`
   build on a CDN host; environment-based config; automated migrations on deploy; nightly
   encrypted DB backups.
5. CI: lint + typecheck + full test suite on every push; the Phase 4 dedup test and Phase 6
   XSS canary are release blockers.

---

## Phase 10 — Post-parity backlog (optional, in rough priority order)

- Pending→settled auto-replacement across imports (matcher exists from Phase 4).
- User-defined categorisation rules UI (engine is data-driven since Phase 4).
- New bank formats: one parser module + one detection signature each (CLAUDE.md §8).
- Column-mapping UI for unknown CSVs.
- Recurring-transaction detection; budget alerts; multi-account and multi-currency reporting;
  raw-file storage (encrypted object storage) for re-parsing.

---

## Dependency map

```
Phase 0 ─ 1 ─ 2 ─┬─ 4 ─ 5 ─ 6 ─┐
                 └─ 3 ──┘       ├─ 8 ─ 9 ─ 10
             (7 can start after 4) ─ 7 ─┘
```

Phases 3 (PDF parser) and 7 (backend) can run in parallel with the frontend track once
Phase 4's pipeline is done. Everything else is sequential.
