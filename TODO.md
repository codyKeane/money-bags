# TODO — backlog

Shipped milestones: foundation (`a17fad3`) → CSV/hardening/management UIs
(`e882ed9`) → Tailscale/PWA/mobile (`9581add`) → **engineering milestone**
(`6b3f85c`/`5bd9952`) — performance, code-quality refactors, and ops →
**features milestone** (`56c58ef`/`5019ec8`/`f716fa1`/`390bbd2`/`b9d9575`) —
budgets, CSV export, date filter, import robustness, error handling →
**import-undo milestone** (U1, migration 0003) — batch-tracked imports with a
one-click undo → **UX-polish milestone r1** (UX1–UX6) — loading skeletons,
per-page titles, active-nav sub-routes, decimal inputs, empty states, not-found.

## ✅ Engineering milestone — DONE (verified byte-identical + tests green)

- **Performance**: P1 index-friendly month predicates · P2 removed the
  double-render (`router.refresh` ×10 dropped; verified via Playwright gate) ·
  P3 `getAccountOptions` for dropdowns · P4 net-worth aggregate de-duped ·
  P5 batched apply-rules · P6 `synchronous=NORMAL` · P7 batched import inserts
  (skip-detail contract preserved).
- **Code quality**: Q1 form primitives (`ui/form.tsx`) · Q2 `useServerForm` ·
  Q3 unified `ColorDot` · Q4 actions split by domain + `firstError`/`requiredId`
  helpers · Q5 single transaction projection · Q6 shared table chrome
  (`ui/table.tsx`) · Q7 `setupTestDb` fixture · Q8 complete `revalidateAll` ·
  Q9 `getAllCategories` moved to the categories service.
- **Ops**: O1 systemd units (`deploy/`) + backup `--keep` retention ·
  O2 Node pin (`engines`/`.nvmrc`) + `/api/health`.

## ✅ Features milestone — DONE (all F1–F9, tests green, verified end-to-end)

- **F1 Budgets** — `monthly_budget_cents` (migration 0002), `getBudgetVsActual`,
  category form input + dashboard progress with over-budget `--delta-bad`.
- **F2 CSV export** — `GET /api/export` + pure `transactionsToCsv`, footer link.
- **F3 Import robustness** — `columnMap` via route JSON / CLI `--col-*` / an
  Advanced UI; single file-level error for missing columns; ambiguous-date
  warnings surfaced everywhere.
- **F4 Error handling** — root `error.tsx`; JSON errors + Content-Length
  pre-check on `/api/import`; `getCategoryById` guard in `recategorizeAction`.
- **F5** account → `/transactions?account=` links · **F6** dangling filter-param
  drop · **F7** from/to date filter (shared `TransactionQuery`) · **F8**
  `getNetWorthOverview` mixed-currency warning · **F9** `month.ts` +
  `getSpendingTrend` tests.

## ✅ Import-undo milestone — DONE (migration 0003, tests green, verified)

- **U1 Import batch id + undo** — migration 0003 adds an `import_batches` table
  and a nullable `transactions.batch_id` (FK `set null`). `importStatement`
  records one batch per import that inserts ≥1 row (all-duplicate imports record
  nothing), stamps `batchId` on every inserted row, and returns it; `filename`
  flows in from the UI upload and the CLI (`basename`). New services
  `getRecentImportBatches` + `undoImport` (two-step delete: rows first, then the
  batch — manual rows are untouched). `undoImportAction` re-verifies the batch
  server-side. `/import` now shows a "Recent imports" table with per-row Undo.
  Closes the CLAUDE.md "delete the corrupted rows first" gap.

## ✅ UX-polish milestone (round 1) — DONE (build/tests green, verified at runtime)

- **UX1 loading skeletons** — `Skeleton` primitive (`ui/skeleton.tsx`) + root
  `app/loading.tsx` and a table-shaped `app/transactions/loading.tsx`, so
  force-dynamic pages show structure instantly instead of freezing on nav.
- **UX2 per-page titles** — layout `title.template` (`%s · Finance Engine`) +
  per-page `metadata.title` (Transactions/Accounts/Categories/Import/Edit). Home
  keeps the app-name default (template doesn't apply to the root segment).
- **UX3 active-nav sub-routes** — `isActiveNav(pathname, href)` (exact for `/`,
  prefix for the rest, unit-tested) shared by Sidebar + MobileNav, so
  `/transactions/[id]/edit` keeps Transactions lit.
- **UX4 decimal inputs** — `inputMode="decimal"` on the amount + opening-balance
  inputs (mobile numeric keypad; budget input already had it).
- **UX5 smarter empty states** — `/transactions` distinguishes empty-ledger
  ("add one / import") from empty-filter ("Clear filters"); footer hidden at 0.
- **UX6 not-found + return nav** — global `app/not-found.tsx` (used by
  `notFound()` on a deleted transaction) + "← Back to transactions" on the edit
  page.

## Remaining — pick a theme for the next milestone

### Fresh functionality audit (new — ranked by user value)
- [ ] Transaction splitting across categories (the "Target run") — needs a
  splits table + aggregation changes (L).
- [x] ~~Import batch id + undo-an-import~~ — shipped (U1, migration 0003).
- [ ] Per-transaction exclude-from-spending override (M).
- [ ] Transfer pairing/detection — a missed keyword silently inflates both
  spend and income (M).
- [ ] Merge two categories (S) · notes/tags on transactions (M) ·
  reconciliation/cleared flag + running balance (M).
- [ ] Uncategorized count surfaced on the dashboard (S) · merchant/recurring
  rollup (M) · near-duplicate import detection (S) · running-balance import
  guard (S) · opening-balance dating (S/M) · refund semantics (M).

### Fresh UX audit — round 2 (remaining; mostly S, high perceived quality)
Shipped in round 1: loading skeletons · `inputMode` money inputs · empty-filter
vs empty-ledger · edit-page return nav + `not-found.tsx` · per-page `<title>`s ·
active-nav sub-route matching. Still open:
- [ ] filter pending feedback (`useFormStatus`/`useTransition`) · success
  feedback after create · styled deletes (replace `window.confirm`, incl. the
  new import-undo confirm) · inflow/outflow color (+`--delta-bad` token) ·
  error danger color · ≥44px tap targets · table scroll affordance ·
  `aria-live` on results · autofocus on open · formatted dates ·
  StatCard link affordance · CategorySelect color dot.

### Deferred by design
Recurring-transaction auto-detection, OFX/QIF, multi-currency conversion,
Docker, auth, double-entry ledger, chart accessibility layer, month jump
picker, pagination page numbers, `db:seed` real-data guard, bulk recategorize,
analytics round 2 (per-category trend, net-worth-over-time).
