# TODO — backlog

Shipped milestones: foundation (`a17fad3`) → CSV/hardening/management UIs
(`e882ed9`) → Tailscale/PWA/mobile (`9581add`) → **engineering milestone**
(`6b3f85c`/`5bd9952`) — performance, code-quality refactors, and ops →
**features milestone** (`56c58ef`/`5019ec8`/`f716fa1`/`390bbd2`/`b9d9575`) —
budgets, CSV export, date filter, import robustness, error handling →
**import-undo milestone** (U1, migration 0003) — batch-tracked imports with a
one-click undo → **UX-polish milestone r1** (UX1–UX6) — loading skeletons,
per-page titles, active-nav sub-routes, decimal inputs, empty states, not-found
→ **transaction-splitting milestone** (SP1, migration 0004) — split one charge
across categories; all spending aggregates are split-aware. → **UX-polish
milestone r2** (UX7–UX18) — filter pending state, create success flashes, styled
inline delete/undo confirms (no more `window.confirm`), inflow/outflow + error
danger colors, 44px tap targets, table scroll affordance, aria-live results,
autofocus-on-open, formatted dates, StatCard link affordance, category color dot.

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

## ✅ Transaction-splitting milestone — DONE (migration 0004, 100 tests green, verified)

- **SP1 Transaction splitting** — `transaction_splits` table (migration 0004,
  FK cascade on the transaction / set-null on the category). A transaction with
  ≥1 splits is categorized by its parts, not its own `categoryId`; the parts must
  sum to the transaction amount (`splitTransactionAction` enforces it
  server-side). New `spendingLineItems()` UNION abstraction in `summary.ts` makes
  **all four** spending aggregates (by-category, budget-vs-actual, monthly
  summary, trend) split-aware — an excluded split part drops out on its own.
  Services `getSplitsForTransaction`/`replaceSplits`; `clearSplitsAction` reverts.
  `SplitEditor` on the edit page (live remainder, balance check); the list shows
  a "Split" badge (`isSplit`) instead of a no-op category dropdown.

## ✅ UX-polish milestone (round 2) — DONE (build/lint/103 tests green, verified at runtime)

- **UX7 filter pending feedback** — `TransactionFilters` wraps every
  `router.replace` in `useTransition`; the form is `aria-busy` while the RSC
  re-query runs and an `aria-live` "Updating…" note shows instead of a frozen row.
- **UX8 create success feedback** — `useFlash`/`FlashMessage` (`ui/flash.tsx`):
  a transient, auto-clearing "✓ … created" in an `aria-live` region after a
  create succeeds (add-transaction, account, category, import's inline account).
- **UX9 styled deletes** — `ConfirmButton` (`ui/confirm-button.tsx`) replaces
  all `window.confirm`: the trigger arms in place to a danger Confirm + Cancel
  pair (full context in a `title` tooltip). Used by delete-transaction,
  delete-category, and import-undo. Account delete keeps its type-the-name flow,
  now danger-toned.
- **UX10 inflow/outflow color** — "calm ledger": the amount column tints only
  income `--delta-good` (beside the signed number, color never alone); outflows
  stay default ink so `--delta-bad` stays reserved for danger. Delta tokens
  refined to a softer emerald / muted brick.
- **UX11 error danger color** — `FormError` and every inline validation/error
  message now render in `--delta-bad` (still with the ⚠ glyph + text).
- **UX12 ≥44px tap targets** — `min-h-11` baked into the shared `inputClass`/
  `buttonClass`/`toggleButtonClass` + a new `rowActionClass`, plus the mobile
  nav, month nav, pagination, and inline row actions. (Desktop-only sidebar left
  as a mouse target.)
- **UX13 table scroll affordance** — pure-CSS `.scroll-x-shadows` on `TableCard`:
  edge shadows that appear only when, and on the side where, the table overflows.
- **UX14 aria-live results** — the `/transactions` result count and empty state
  are `role="status" aria-live="polite"` so filter changes are announced.
- **UX15 autofocus on open** — the first field of each create/edit form gets
  focus when the form appears.
- **UX16 formatted dates** — `formatIsoDate` ("2026-07-07" → "Jul 7, 2026",
  string-only/TZ-safe) in the transaction table and import skip list; raw ISO
  kept in a `title` tooltip.
- **UX17 StatCard link affordance** — `StatCard` takes an optional `href` and
  then shows a hover lift + a → that fades in, so the clickable Net-worth tile
  no longer looks identical to the static ones.
- **UX18 CategorySelect color dot** — the in-row category dropdown is now
  controlled and shows a `ColorDot` that tracks the live selection (color rides
  along on `CategoryOption`).

## Audit-remediation program — ACTIVE

`IMPLEMENTATION_GUIDE.md` is the authoritative dependency-ordered delivery
plan for current correctness, privacy, and operational work. WP-00 and
WP-01A/B/C completed on 2026-07-13; WP-12A completed on 2026-07-14; WP-01D
and WP-12B completed on 2026-07-15. The next slice is WP-02A; do not skip to
WP-02B or the decision-gated transfer/refund/deduplication RFCs.

The product backlog below is retained as historical product context. Its rank
does not override the guide, and an unchecked item is not implementation
authorization when the guide classifies it as an RFC or non-goal.

## Historical product backlog (not the remediation delivery order)

State at planning time (2026-07-07): build/lint/103 tests all green; no `TODO`/
`FIXME` markers in code. Criticality order = at-risk work → data integrity →
value-per-effort. Sizes: S ≈ ½ day, M ≈ 1–2 days.

### P0 — operational (historical resolution)

UX7–UX18 landed in `3d967ba` (`feat(UX7-UX18): UX-polish round 2`); the stale
pre-commit task is retained only by this resolution note, not as live work.

### P1 — data integrity & correctness of the headline numbers
- [ ] **Transfer pairing/detection (M; decision-gated RFC-02).** Transfers are
  excluded only by keyword match (`Transfers` category,
  `excludeFromSpending`, `lib/default-categories.ts`).
  A transfer whose description misses `transfer`/`payment received`/`payment to
  rewards card` is **double-counted** — outflow on the source account *and*
  inflow on the destination — inflating both Spending and Income. Detect matched
  +/− pairs (same amount, near date, different accounts) only after the pairing
  policy is explicitly approved.
- [ ] **Near-duplicate import detection + cross-file gap (S–M; decision-gated
  RFC-01).** The frozen dedupe contract silently skips a *legitimately*
  identical transaction when it arrives in a different CSV file (both hash
  `occurrenceIndex 0`) — real data loss. Add a **running-balance import guard
  (S)** when the statement carries a balance column, without changing the
  frozen hash or adding an override unless approved.
- [ ] **Refund semantics (M; decision-gated RFC-03).** Refunds (positive amounts
  in a spend category) don't reduce category spend (see `getBudgetVsActual`,
  `summary.ts`). A fully refunded $200 purchase still reads as $200 spent.
  Decide the policy before implementing netting.

### P2 — high-value functionality gaps (value-per-effort order)
- [ ] **Uncategorized count on the dashboard (S)** — best value/effort. Absent
  from `app/page.tsx`; surface a count linking to `/transactions` filtered to
  uncategorized so the data-quality gap is visible.
- [ ] **Per-transaction exclude-from-spending override (M).** Exclusion is
  category-only today (`countsTowardSpending`, `summary.ts`); add a row-level
  flag wired into `spendingLineItems`.
- [ ] **Reconciliation / cleared flag + running balance (M).** No `cleared`
  column on `transactions`; blocks statement reconciliation + running balance.
- [ ] **Notes / tags on transactions (M).** No notes/tags columns exist.
- [ ] **Merge two categories (S).** Reassign `categoryId` (+ splits) then delete
  the emptied category — no merge path today.
- [ ] **Merchant / recurring rollup (M).** Group by normalized merchant to spot
  recurring charges/subscriptions.
- [ ] **Opening-balance dating (S/M).** `accounts.openingBalanceCents` has no
  date, so net-worth-over-time can't place it on the timeline.

### Shipped (kept for history)
- [x] ~~Transaction splitting across categories~~ — SP1, migration 0004.
- [x] ~~Import batch id + undo-an-import~~ — U1, migration 0003.

### Fresh UX audit — round 2 — DONE
- [x] ~~filter pending feedback · success feedback after create · styled deletes
  (replace `window.confirm`) · inflow/outflow color · error danger color · ≥44px
  tap targets · table scroll affordance · `aria-live` on results · autofocus on
  open · formatted dates · StatCard link affordance · CategorySelect color dot~~
  — all shipped (UX7–UX18, see the milestone section above).

### Deferred by design
Recurring-transaction auto-detection, OFX/QIF, multi-currency conversion,
Docker, auth, double-entry ledger, chart accessibility layer, month jump
picker, pagination page numbers, bulk recategorize, analytics round 2
(per-category trend, net-worth-over-time). The `db:seed` real-data guard is no
longer deferred; it is selected remediation work in WP-03 after WP-02A and
WP-12A.
