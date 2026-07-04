# TODO — next milestone: optimization & growth

Previous milestones shipped: foundation (`a17fad3`), then critical CSV
fixes + hardening + management UIs (`e882ed9`) — categories/accounts pages,
manual transaction CRUD, filters/pagination, auto-migrate, default
categories, WAL-safe backup, loopback binding. All verified end-to-end.

This backlog comes from a three-lens system analysis (performance —
**benchmarked on a synthetic 50k-row ledger**, code quality, features/ops),
with every claim verified against the code and the numbers below measured,
not estimated. GitHub push/sync is handled by the owner outside this list.

---

## 1. Performance (measured at 50k rows; current ledger is 132 — this is about staying fast forever)

- [ ] **P1 · Index-friendly month predicates** (high, S). Every month filter
  uses `substr(date,1,7) = ?`, which defeats `transactions_date_idx` and
  full-scans: `summary.ts` (by-category `:37`, summary `:59`, trend
  `:87-93`), `transactions.ts:67` (month filter), `:105`
  (`max(substr(date,1,7))`). Measured: monthly agg 3.4ms → 0.22ms, 6-month
  trend 5.5ms → 1.4ms, latest-month 3.1ms → 0.008ms. Fix predicates to
  `date >= 'YYYY-MM-01' AND date < '<addMonths(m,1)>-01'` (reuse
  `addMonths`, `src/lib/month.ts`); keep `substr` in SELECT/GROUP BY (the
  CLAUDE.md bucketing convention is about the bucket key, not the WHERE);
  `getLatestTransactionMonth` becomes `substr(max(date),1,7)`. The
  dashboard runs four of these per render.
- [ ] **P2 · Stop rendering every mutation twice** (high, S). Every action
  calls `revalidatePath` AND 11 client call-sites follow with
  `router.refresh()` — per the bundled Next 16 docs, the action response
  already carries the re-rendered RSC payload for the current route, so
  each dropdown change runs all page queries twice. Do together with Q2
  (one `useServerForm` hook, no refresh inside). **Verify explicitly**:
  with refresh removed, a category change on /transactions must update the
  row without reload; if any surface goes stale, keep the refresh in the
  hook (1 place), never back in 11.
- [ ] **P3 · `getAccountOptions()` for dropdowns** (medium, S).
  /transactions and /import call `getAccountsWithBalances()` (full-table
  aggregate, ~11-17ms @50k) and throw the balances away. Add a plain
  `select id, name, type from accounts` service; keep the aggregate for
  /accounts and the API.
- [ ] **P4 · De-dupe the net-worth aggregate** (medium, S).
  `/api/summary/net-worth` runs `getNetWorth()` + `getAccountsWithBalances()`
  — the same aggregate twice per request (`getNetWorth` calls it
  internally). Compute once, sum in JS.
- [ ] **P5 · Batch apply-rules updates** (medium, S). One UPDATE per row,
  re-prepared each time (drizzle's better-sqlite3 driver has no statement
  cache). Group matched ids by category, one `UPDATE … WHERE id IN (…)` per
  category (chunk ~500 ids); measured 16.2ms → 4.1ms per 2k rows.
- [ ] **P6 · `synchronous = NORMAL` pragma** (low, S). WAL currently pairs
  with default `FULL` — an fsync per commit, i.e. per server action. NORMAL
  is the documented WAL pairing; risk (last commit on power loss) is
  acceptable beside `db:backup`.
- [ ] **P7 · Batch import inserts** (low, M — only if `import.ts` is being
  edited anyway). Per-row insert re-prepares 1000× (15.6ms → 6.9ms
  batched). Must preserve the skipped-row reporting contract: diff
  `returning({importHash})` against the computed hash list.

**Measured and fine — do not "optimize":** LIKE `%q%` search (3.5ms @50k;
FTS5 would be churn), `categoryId IS NULL` (already uses
`transactions_category_date_idx`), Recharts chunk (373KB but loaded only by
the dashboard route, which is the landing page — lazy-loading buys nothing),
startup migrate+defaults (~7ms once per process).

## 2. Code quality (payoff-to-churn ranked; ~200 duplicated lines for ~100 of primitives)

- [ ] **Q1 · Form primitives** (high, S). `inputClass` copied 5×
  (CategoryManager/AccountsManager/TransactionForm/ImportForm/
  TransactionFilters); labeled-field markup 17×; `⚠ {error}` line 8×;
  submit-button class 7×. One `src/components/ui/form.tsx`: `inputClass`,
  `buttonClass`, `Field`, `FormError`. No FormShell — wrappers genuinely
  differ.
- [ ] **Q2 · `useServerForm(action, onSuccess)` hook** (high, S). The same
  useActionState wrapper appears 6× (CategoryManager ×2, AccountsManager
  ×2, TransactionForm, ImportForm). Implements P2: no `router.refresh()`
  inside unless verification demands it.
- [ ] **Q3 · Unify `ColorDot`** (high, S). `CategoryManager.tsx:31-44`
  duplicates `CategoryBadge.tsx`'s dot byte-for-byte — including the
  `--dot-dark` dark-mode swap. Export from one place; classic silent-drift
  risk.
- [ ] **Q4 · Action helpers, then split by domain** (medium-high, M).
  `firstError(parsed)` (repeated 5×) + `requiredId(formData, name)` (3×) in
  a non-`"use server"` `src/server/actions/shared.ts` (server-action files
  may only export async functions); then split actions into
  `actions/{accounts,categories,transactions}.ts` with a barrel re-export
  so the ~7 importing components don't change.
- [ ] **Q5 · Single `TransactionListItem` projection** (medium, S).
  `getRecentTransactions` and `getTransactionsPage` duplicate the 9-field
  select + joins; make the former delegate to the latter.
- [ ] **Q6 · Shared table chrome** (medium, S). Three hand-rolled tables
  share exact class strings. Thin `Table`/`Th`/`Td` (or exported class
  constants) only — no column-config abstraction; the managers' colSpan
  edit-row needs raw `<tr>`.
- [ ] **Q7 · `setupTestDb` fixture helper** (medium-low, S). The same
  ~12-line mkdtemp/createTestDb/afterAll block in all 5 integration test
  files.
- [ ] **Q8 · Complete `revalidateAll`** (medium, S — correctness). It skips
  `/accounts` and `/import`; account actions hand-append inconsistently —
  an account **rename** currently leaves the import page's account list
  un-revalidated. One list covering all five pages, used everywhere.
- [ ] **Q9 · Move `getAllCategories` to the categories service** (low, S).
  Stranded in `transactions.ts`; 2 importers to update.

**Checked healthy:** services DI (`db: Db = getDb()` everywhere, zero
drift), no dead code, no non-null assertions, sane type import direction,
the lib/db default-categories split is deliberate. ImportForm's slim inline
account form is intentional UX — fold into Q1/Q2 primitives and stop.

## 3. Features

- [ ] **F1 · Budgets per category** (high, M). The highest-value missing
  finance feature; the actuals side already exists
  (`getMonthlySpendingByCategory`). Add nullable `monthlyBudgetCents` to
  `categories` (first schema migration since baseline), expose in
  `CategoryFields` (reuse the `openingBalanceField`/`parseAmountToCents`
  pattern), `getBudgetVsActual(month)` in summary service, dashboard
  budget-vs-actual section with per-category progress + over-budget flag.
  MonthNav gives historical budget views for free.
- [ ] **F2 · CSV export of the filtered view** (high, S). Data sovereignty:
  currently no way out but SQLite tooling. `GET /api/export` reusing
  `buildTransactionWhere` with the same query params as /transactions (no
  limit), `Content-Disposition: attachment`; "Export CSV" link by the
  pagination footer carrying the active filters.
- [ ] **F3 · Import robustness bundle** (high, M — data-safety: wrong
  guesses freeze into `importHash`). (a) One file-level error naming the
  found headers when no date/description/amount column resolves, instead of
  N identical row errors; (b) a `warnings` field when `auto` date format
  fell back to MDY without evidence (no day>12 row anywhere); (c) expose
  the already-implemented-and-tested `columnMap` in `/api/import` fields,
  an "Advanced: column mapping" section in ImportForm, and `--map-*` CLI
  flags. `importStatement` already accepts it — only the edges are missing.
- [ ] **F4 · Error-handling bundle** (high, M). No `error.tsx` anywhere; a
  thrown route-handler error returns non-JSON 500 which ImportForm
  misreports as "could not reach the local server"; `recategorizeAction`
  still throws raw FK errors on a stale category id; the 5MB cap runs
  after the whole multipart body is buffered. Root error boundary,
  try/catch → JSON in `/api/import` (+ Content-Length pre-check before
  `formData()`), `getCategoryById` guard in recategorize, try/catch in
  applyRules.
- [ ] **F5 · Account → transactions links** (medium, S).
  `/transactions?account=<id>` already works; nothing links to it. Make the
  account row/count in AccountsManager (and optionally the account cell in
  TransactionTable) a Link. Closes an obvious navigation dead end.
- [ ] **F6 · Drop dangling filter params** (medium, S). Deleting a category
  leaves `?category=<deleted-id>` URLs showing "0 of 0" while the select
  displays "All categories". After loading options in
  `transactions/page.tsx`, discard filter values not in the lists
  (mirroring the existing `isValidMonth` guard).
- [ ] **F7 · Date-range filter (from/to)** (medium, S/M). Only single-month
  exists; "Q1", "since March", tax year all need ranges. Two validated
  `type="date"` inputs + `gte/lte` in `buildTransactionWhere`; month and
  range mutually exclusive; feeds F2's filtered export.
- [ ] **F8 · Currency: expose it or guard it** (medium, S — decision).
  `accounts.currency` is dead state: displayed everywhere
  (`formatCents(…, a.currency)`) but unsettable from any UI/service input,
  while `getNetWorth` naively sums cents across currencies. Either add a
  currency select (small ISO whitelist) + group net worth by currency, or
  keep USD-only and make mixed currencies impossible/loud. Conversion stays
  deferred.
- [ ] **F9 · Missing tests** (medium, S). `month.ts` has zero coverage —
  `addMonths` year-boundary/negative-delta modular math is exactly the
  pin-with-tests kind; `getSpendingTrend` zero-fill window untested;
  add a case for the MDY-fallback warning once F3(b) exists.

## 4. Operations (home server; Docker stays out of scope)

- [ ] **O1 · systemd units + scheduled backups + retention** (high, M).
  `deploy/finance.service` (WorkingDirectory=repo, `ExecStart=npm start`,
  `Restart=on-failure`, journald = log rotation) +
  `deploy/finance-backup.service`/`.timer` (daily); add `--keep N` pruning
  to `scripts/backup-db.ts` (currently unbounded — every run adds a full
  copy); README "Run on a home server" section incl. `npm ci` (caret ranges
  can drift past the tested set on a fresh machine) and restore cross-link.
- [ ] **O2 · Pin Node + health endpoint** (high, S). No `engines`/`.nvmrc`
  (repo needs ≥20.12 for `process.loadEnvFile`; better-sqlite3 ABI is
  Node-major-bound): add `"engines": {"node": ">=20.12"}` + `.nvmrc` `22`.
  Add `/api/health` (`select 1` → `{ok:true}`/500) so uptime monitoring
  doesn't have to hit `/api/accounts`, which does aggregate work and leaks
  balances into monitor logs.

## 5. Defer (next-next, in rough order)

- **Refund semantics** — positive amounts in expense categories count as
  income and vanish from category spend. Decide together with F1: budgets
  should almost certainly consume *net* category spend.
- **Bulk recategorize** (checkbox selection + one action) — per-row +
  apply-rules covers most flows today.
- **Analytics round 2**: per-category monthly trend (a `getSpendingTrend`
  variant grouped by month × category), net-worth-over-time (cumulative
  sums + openings, documented as "before first transaction"). Build after
  F1/refund-semantics settle net-vs-gross.
- **`db:seed` guard** on a DB with real data (abort without `--force`).
- ~~**Mobile layout**~~ — DONE (shipped with the Tailscale/PWA milestone:
  MobileNav top bar below `md`, responsive padding, wrapping headers; the
  app is also installable as a PWA and pre-configured for
  `tailscale serve` remote access — see README "Remote access").
- **Chart accessibility** (Recharts `accessibilityLayer`, non-hue series
  distinction), **month jump picker**, **pagination page numbers**.
- **Deferred by design**: recurring-transaction detection, OFX/QIF,
  multi-currency conversion, Docker, auth, double-entry ledger.

## Suggested execution order

1. P1+P2+Q1+Q2+Q3 in one pass (the form-component sweep implements the
   perf fix); then Q8 (correctness), P3+P4.
2. F4 (error handling) and O2 — small, unblock daily reliability.
3. F1 budgets (the milestone's anchor), then F2 export, F3 import bundle.
4. F5/F6/F7 quick wins; Q4-Q7/Q9, P5-P7 opportunistically alongside.
5. O1 when it next touches the home server.
