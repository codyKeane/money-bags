# TODO — backlog

Shipped milestones: foundation (`a17fad3`) → CSV/hardening/management UIs
(`e882ed9`) → Tailscale/PWA/mobile (`9581add`) → **engineering milestone**
(`6b3f85c`/`5bd9952`/this) — performance, code-quality refactors, and ops.

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

## Remaining — pick a theme for the next milestone

### Features (original TODO section 3)
- [ ] **F1 · Budgets per category** (high, M). Nullable `monthlyBudgetCents`,
  `getBudgetVsActual(month)`, dashboard progress + over-budget flag. Actuals
  side (`getMonthlySpendingByCategory`) already exists.
- [ ] **F2 · CSV export of the filtered view** (high, S). `GET /api/export`
  reusing `buildTransactionWhere`; "Export CSV" link by the pagination footer.
- [ ] **F3 · Import robustness** (high, M). Expose the tested-but-hidden
  `columnMap` in `/api/import` + CLI + an "Advanced" UI; one file-level error
  when no date/description/amount column resolves; a `warnings` field when
  `auto` date format fell back to MDY without evidence.
- [ ] **F4 · Error-handling bundle** (high, M). Root `error.tsx`; try/catch →
  JSON in `/api/import` (+ Content-Length pre-check); `getCategoryById` guard
  in `recategorizeAction`.
- [ ] **F5 · Account → transactions links** (medium, S). Link to
  `/transactions?account=<id>` from AccountsManager/TransactionTable.
- [ ] **F6 · Drop dangling filter params** (medium, S). Discard `?category=`/
  `?account=` ids not in the loaded option lists (mirror the `isValidMonth`
  guard) in `transactions/page.tsx`.
- [ ] **F7 · Date-range filter (from/to)** (medium, S/M). `gte/lte` on `date`
  in `buildTransactionWhere`; two `type="date"` inputs; feeds F2 export.
- [ ] **F8 · Currency: expose or guard** (medium, S). `accounts.currency` is
  display-only dead state; either add a currency select + group net worth by
  currency, or make mixed currencies impossible/loud.
- [ ] **F9 · Missing tests** (medium, S). `month.ts` (`addMonths`/`monthRange`
  boundaries), `getSpendingTrend` zero-fill window.

### Fresh functionality audit (new — ranked by user value)
- [ ] Transaction splitting across categories (the "Target run") — needs a
  splits table + aggregation changes (L).
- [ ] Import batch id + undo-an-import — CLAUDE.md tells users to "delete the
  corrupted rows first" but nothing can (M, high value).
- [ ] Per-transaction exclude-from-spending override (M).
- [ ] Transfer pairing/detection — a missed keyword silently inflates both
  spend and income (M).
- [ ] Merge two categories (S) · notes/tags on transactions (M) ·
  reconciliation/cleared flag + running balance (M).
- [ ] Uncategorized count surfaced on the dashboard (S) · merchant/recurring
  rollup (M) · near-duplicate import detection (S) · running-balance import
  guard (S) · opening-balance dating (S/M) · refund semantics (M).

### Fresh UX audit (new — mostly S, high perceived quality)
- [ ] `loading.tsx` skeletons (force-dynamic pages freeze on nav) · filter
  pending feedback · `inputMode="decimal"` on money inputs · success feedback
  after create · styled deletes (replace `window.confirm`) · smarter empty
  states (empty-filter vs empty-ledger) · inflow/outflow color (+`--delta-bad`
  token) · edit-page return nav + `not-found.tsx` · error danger color ·
  ≥44px tap targets · table scroll affordance · per-page `<title>`s ·
  active-nav sub-route matching · `aria-live` on results · autofocus on open ·
  formatted dates · StatCard link affordance · CategorySelect color dot.

### Deferred by design
Recurring-transaction auto-detection, OFX/QIF, multi-currency conversion,
Docker, auth, double-entry ledger, chart accessibility layer, month jump
picker, pagination page numbers, `db:seed` real-data guard, bulk recategorize,
analytics round 2 (per-category trend, net-worth-over-time).
