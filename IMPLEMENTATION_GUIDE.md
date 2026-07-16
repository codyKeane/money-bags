# Money Bags Implementation Guide

> Status: active, decision-complete implementation north star for the audit-remediation program
> Code baseline: clean historical snapshot `main` at `3d967baf8d7451f8c8202f3f9489401771bcc3b7` (`3d967ba`)
> Implementation checkpoint: WP-00 and WP-01A/B/C completed 2026-07-13; WP-12A completed 2026-07-14; WP-01D and WP-12B completed 2026-07-15; WP-02A is next
> Checkpoint verification: the current default and seed-`12012` shuffled suites passed 21 files / 207 tests; ESLint, TypeScript, Git-ignore/re-inclusion checks, sanitized audit-CLI checks, and `git diff --check` passed; the earlier sanitized copied-workspace gate passed tests, lint, real dev/start health smokes, and the first wrapped production build
> Additional gates: migration integrity, cross-cwd and bundled-launcher root resolution, direct-Vitest fallback, zero-artifact guards, hostile Git-environment refusal, terminal-safe audit output, and documentation checks passed; security and independent review cleared WP-12B, while the disclosed native-Windows validation-wrapper limitation remains
> Safety gate: no Next build ran in the working repository; the only build used an allowlisted sanitized copy, a clean HOME/TMPDIR, and an unchanged fake default-ledger sentinel. Until WP-04, all validation/packaging builds retain this copied-workspace restriction
> Prepared: 2026-07-15
> Scope: correctness, data integrity, privacy, operational safety, architecture, and accessibility
> Dependency policy: use the existing Node.js 20+, Next.js, Drizzle, better-sqlite3, Zod, and Vitest stack; do not add a package unless a later decision record explicitly justifies it

This document turns the repository audit into an implementation program. It is deliberately more prescriptive than the audit report: it records the target behavior, ordering, boundaries, failure handling, rollback strategy, and validation needed for the next implementation session. It does not authorize a migration, restore, deployment, seed, or test against a real ledger.

## Navigation

- Sections 1–5 establish usage, outcomes, immutable contracts, baseline evidence, and the finding register.
- Sections 6–8 define the target architecture, product decision register, and dependency-ordered delivery sequence.
- Section 9 is the implementation core: WP-00 through WP-18, each with design, tests, acceptance, and rollback.
- Section 10 isolates policy-dependent RFCs and non-goals.
- Sections 11–13 define cross-cutting tests, migration compatibility, and documentation obligations.
- Sections 14–15 define merge/release gates and the separately authorized deployment runbook.
- Sections 16–18 provide the next-session checklist, handoff template, and final guardrails.

## 1. How to use this guide

Treat this file as the default plan until repository evidence disproves an assumption or a decision gate is resolved differently. A future implementation session should:

1. Read `AGENTS.md`, this guide, `CLAUDE.md`, and the files named by the selected work package.
2. Reconfirm the branch, HEAD, and worktree before editing. Preserve all user changes.
3. Select one delivery-stage package, or one explicitly identified sub-slice, rather than implementing the entire roadmap in one diff. Stable WP IDs are retained for traceability; Section 8, not numeric WP order, controls delivery order.
4. Write the smallest failing test that demonstrates the audited behavior before changing production code where practical.
5. Use only temporary SQLite databases and fake data. Do not open, inspect, copy, migrate, seed, restore, or summarize `data/*.db*` or `data/imports/`.
6. Read the relevant installed documentation under `node_modules/next/dist/docs/` before changing any Next.js configuration, route, header, caching, or Server Action behavior.
7. Preserve frozen compatibility contracts, especially the import hash. Never edit an already-applied migration.
8. Update the user and architecture documentation in the same work package when behavior changes.
9. Run the work package's focused checks, then the repository-wide release gates.
10. Stop and ask only when a deferred RFC is deliberately brought into scope or new repository evidence invalidates a selected contract. The selected remediation packages below do not contain unresolved implementation choices.

The guide uses “must” for a product or safety invariant, “should” for the recommended implementation, and “may” for an optional refinement. Suggested file and symbol names are review aids, not permission for speculative abstraction.

Unless a checkpoint explicitly says otherwise, each work package's “Current
path,” “Current evidence,” and finding text describes the audited `3d967ba`
baseline. Package completion is recorded in the checkpoint at the top of this
guide rather than by rewriting that historical evidence.

## 2. Target outcomes

The remediation program is complete when all of the following are true:

- No supported transaction update can commit while its split total disagrees with the parent; a historical mismatch blocks ordinary parent edits until the user explicitly repairs or clears the split.
- Demo seeding cannot overwrite or mingle with an existing personal ledger.
- Next.js output traces and any future packaged output cannot include financial databases, WAL/SHM files, imports, backups, or ignored environment files.
- An ambiguous date format cannot insert rows until the user explicitly chooses MDY or DMY.
- CSV debit/credit pairs handle common zero-filled columns without losing valid rows or changing refund/reversal signs.
- Every category-dependent behavior uses the same active-category rule for split and unsplit transactions.
- Excluded categories are consistently absent from spending, income, trend, and budget aggregates.
- A dashboard never labels a cross-currency sum as a meaningful scalar value and formats a single non-USD ledger in its actual currency.
- Default-category installation is all-or-nothing.
- Database location, backup location, restore target, permissions, and systemd runtime are explicit and consistent.
- Browser mutation routes enforce the documented trusted-origin boundary, and the application cannot be embedded for clickjacking.
- Financial API and export responses are explicitly non-cacheable; spreadsheet exports do not execute text as formulas.
- The database-access boundary is mechanically enforced for pages, components, route handlers, and Server Actions.
- Integration tests are independent, exact-name runs are trustworthy, import hashes have golden vectors, and migrations are tested with populated historical fixtures.
- Every stateful `beforeAll` suite is either immutable or replaced with self-contained setup, including import, accounts, categories, transactions/splits, summaries, and default-category coverage.
- Services validate their own domain write contracts: safe integer cents, ISO ledger dates, positive/null budgets, normalized account currencies, and referenced entities cannot be bypassed by a non-UI caller.
- Editable money text is converted to and from integer cents exactly in shared browser/server-safe helpers; values with more than two fractional digits are rejected, never rounded.
- Any malformed CSV row or invalid column map fails the whole import before account, category, batch, or transaction mutation; ambiguous dates remain a distinct explicit-format-required result.
- Account currency is editable and repairable in the application. Invalid stored values and mixed-currency ledgers suppress combined aggregates until corrected; no conversion is implied.
- `/api/export` keeps its five-column compatibility representation, while the UI uses a deterministic detailed format with currency and split details; legacy mixed-currency export is refused.
- Shared errors, confirmations, navigation, and split controls satisfy the repository's accessibility contracts.
- `README.md`, `CLAUDE.md`, `USER_MANUAL.md`, and `TODO.md` describe the implementation that actually ships.

## 3. Non-negotiable contracts

| Contract | Implementation consequence | Verification gate |
| --- | --- | --- |
| Money is signed integer cents; negative is outflow. | Parse editable decimal text with a shared digit-based helper; reject more than two fractional digits and unsafe results instead of rounding. Serialize form defaults and CSV decimals from integer digits. Display-only division inside `Intl.NumberFormat` is acceptable. | Parser/service/form/export boundary tests plus schema inspection; no SQLite `REAL` money values in fake fixtures. |
| Ledger dates are date-only `YYYY-MM-DD`. | Never use local-time `Date` conversion for stored transaction dates or month filtering. UTC `Date` may be used only for calendar generation where no ledger date is reinterpreted. | MDY/DMY/ISO/month-boundary tests under at least two `TZ` values. |
| Database access belongs in `src/server/services/`. | App pages, components, route handlers, and actions perform transport/UI work and call narrow services. `src/db/`, migrations, test fixtures, and operational connection owners are documented exceptions. | ESLint restriction plus `rg` boundary check. |
| External input and domain writes are explicitly validated. | Validate FormData, URL parameters, JSON mappings, CLI args, filenames, IDs, origins, and CSV values at transport boundaries. Revalidate safe integer cents, ISO dates, positive/null budgets, currency codes, and referenced entities inside the service that writes them. | Negative route/action/service tests, including direct service calls. |
| SQL is Drizzle or parameterized. | Reusable SQL fragments must interpolate Drizzle columns and bound values, never user-built SQL text. | Review and injection-oriented tests for search/filter inputs. |
| The import hash is frozen. | Preserve exact field order, delimiters, normalization, occurrence indexing, encoding, and SHA-256 output. Fix duplicate UX around the contract; do not “improve” the hash in place. | Golden vectors and re-import tests. |
| A statement import is file-atomic. | Parser errors, an ambiguous date, an invalid column map, an unknown account, or a failed CLI account creation commit no account, category, batch, or transaction change. Row-level partial success is not supported. | Whole-database before/after assertions for every refusal path. |
| Splits sum exactly to their parent. | Validate inside the service transaction for every split write and guard parent amount edits. Existing mismatches are detected, not silently repaired. | Service-level rollback and concurrency/stale-state tests. |
| Active category semantics are split-aware. | An unsplit transaction uses `transactions.category_id`; a split transaction uses only `transaction_splits.category_id`. | One shared semantic matrix exercised by filters, stats, rules, export, and summaries. |
| Excluded categories are consistently excluded. | Apply exclusion to all relevant aggregate surfaces, including budget-vs-actual. Preserve user configuration when a category is excluded. | Cross-aggregate contract test. |
| Currency is an account-owned normalized code. | Accept only uppercase-normalized three-letter codes that `Intl.NumberFormat` accepts; expose create/edit/repair through the application; suppress combined mixed/invalid aggregate states. Do not add conversion or a currency package. | Service/action/form/API tests for valid, lowercase, invalid persisted, single, and mixed states. |
| The app is local and has no application authentication. | Keep default loopback binding. Remote use remains an explicit trusted Tailscale/custom-proxy or deliberate LAN boundary; remediation must not imply per-user authorization. | Production command binding and origin/header tests. |
| The running app makes no external runtime calls. | Keep assets local, disable Next telemetry intrinsically, and add no exchange-rate/network service. | Clean-HOME telemetry check and outbound-denied smoke test. |
| Real financial artifacts remain private and uncommitted. | Ignore the entire runtime-data boundary except fake samples; exclude it from output traces; create private files and directories. | `git check-ignore`, NFT manifest scan, and POSIX mode tests using sentinels. |
| Migrations are append-only and startup-safe. | Never edit `0000`–`0004`; generate a new migration only for a reviewed schema need; pair it with populated upgrade tests and rollback instructions. Validate environment, DB-path policy, the journal, and referenced migration assets before creating a directory or opening SQLite. | Fresh and historical populated migration matrix, preflight artifact tests, `quick_check`, and `foreign_key_check`. |
| Destructive behavior is explicit. | No automatic data repair, implicit seed overwrite, unsafe restore, or hidden split clearing/rescaling. | Negative tests prove state remains unchanged on refusal/failure. |

### Frozen import-hash definition

The compatibility input remains:

```text
accountId|date|amountCents|normalizedDescription|occurrenceIndex
```

`normalizedDescription` remains `description.trim().replace(/\s+/g, " ").toLowerCase()`. The occurrence index starts at zero for each identical `date|amountCents|normalizedDescription` key within one file, in input row order. UTF-8 SHA-256 remains the digest.

Add these exact golden vectors before touching any importer-adjacent behavior:

```text
accountId: acct-1
date: 2026-06-03
amountCents: -450
description input: COFFEE SHOP
normalized description: coffee shop
occurrence 0: 794efbe010c9cc75108641472b6f79684a5a25c06fd4ea57143e5b01dc671580
occurrence 1: 1462da3aa0fcdaa4c22b355a0d4003ff9c7859a002fd6bf0d132ed620b240829
```

The test must include the exact input values that produced these vectors and assert normalization separately. A failing golden vector blocks the change unless a separately designed compatibility migration is approved.

If a future import-hash v2 is ever approved, production must retain v1 computation and lookup for existing rows. Do not assume a migration can recompute old hashes: historical file boundaries, row order, and occurrence provenance are not fully recoverable from the ledger alone.

## 4. Baseline and evidence to preserve

Three states must not be conflated:

1. **Historical audit snapshot.** Commit `3d967ba` on `main` (tracking `origin/main`) was the clean code snapshot audited: `feat(UX7-UX18): UX-polish round 2 — feedback, confirms, a11y, mobile`.
2. **Implementation-start documentation state.** Before the first remediation implementation commit, `HEAD` remained `3d967ba`; the maintainer owned a tracked `CLAUDE.md` edit linking this guide and the untracked `IMPLEMENTATION_GUIDE.md` / `IMPLEMENTATION_PLAN_ANALYSIS.md` planning artifacts. Those files were preserved and incorporated rather than replaced.
3. **Current implementation checkpoint.** WP-00, WP-01A/B/C, WP-12A, and WP-01D are complete in the checkpoint containing this handoff. The current default suite and shuffled seeds `17`, `2718`, and `20260714` each passed 20 files / 191 tests. WP-12A's focused resolver/preflight/migration run passed 4 files / 46 tests; the final WP-01D focused wrapper/smoke/worker/implicit/root run passed 5 files / 64 tests. All 45 previously collected integration-test names passed when selected individually. ESLint, TypeScript, migration-integrity, cross-cwd, bundled Next launcher-root, direct-Vitest, zero-artifact, and documentation gates passed; security audit found no remaining blocker, and independent review cleared POSIX behavior while recording the disclosed native-Windows validation limitation. The 103-test result below remains the historical audit result, not the current suite count.

Installed and locked baseline:

| Component | Version | Evidence |
| --- | ---: | --- |
| Next.js / `eslint-config-next` | `16.2.10` | `package.json`, `package-lock.json`, `npm ls --depth=0` |
| React / React DOM | `19.2.4` | `package.json`, `package-lock.json`, `npm ls --depth=0` |
| Drizzle ORM | `0.45.2` | `package.json`, installed tree |
| better-sqlite3 | `12.11.1` | `package.json`, installed tree |
| Zod | `4.4.3` | `package.json`, installed tree |
| Vitest | `4.1.9` | `package.json`, installed tree |
| Node / npm observed | `v22.22.1` / `10.9.4` | local toolchain; package contract remains Node `>=20.12` |

Validation evidence from the audit must be reported precisely:

- Full test run: **103 passed**.
- ESLint: **passed**.
- Standalone TypeScript check (`tsc --noEmit`): **passed**.
- Exact-name validation, `npm test -- -t "re-importing the same file imports 0"`: **failed**, receiving `imported: 5` where the test expected `0`. The test consumed the first import created by a different `it` block.
- Literal SHA-256 values for migrations `0000`–`0004`: **matched** the values in WP-01C.
- The two frozen import-hash golden values in Section 3: **matched** the current implementation.
- `git diff --check`: **passed** for the audited documentation state.

The only successful production build evidence for this plan is WP-01D's wrapped build in an allowlisted sanitized copied workspace. Its fake `data/finance.db` sentinel remained byte-for-byte unchanged and no sidecar or wrapper lease survived. The build emitted Next's whole-project NFT warning, so this is DB-access evidence, not trace-privacy evidence: builds in the working repository remain prohibited as validation/packaging evidence until WP-04. Historical trace metadata established the narrower MB-003 fact that route NFT manifests referenced fake/sample SQLite DB, WAL, and SHM paths. Current configuration does not enable `output: "standalone"`, so this proves sensitive trace inclusion and future copy risk, not that `npm start` copied runtime data.

Additional observed evidence:

- A fake temporary split reproduction changed a parent to `-12000` while parts remained `-10000`; spending reported `10000` cents while account balance reflected `12000` cents.
- A fake populated migration smoke reached the current schema, but there is no committed populated historical-upgrade matrix.
- Runtime source inspection found no application fetches, remote fonts, CDNs, or telemetry libraries. Telemetry opt-out still depends on environment state rather than every Next launcher.
- No real database, statement import, secret, or financial row was opened during the audit or this documentation revision.

Security dependency conclusion: Next `16.2.10` exceeds the applicable Next maintainer patched threshold `16.2.6`, and React/React DOM `19.2.4` meet the React team's safe `19.2.x` backport. These versions therefore do not justify a dependency or lockfile change for the reviewed advisories. Re-evaluate official advisories at implementation time; do not upgrade speculatively inside an unrelated package.

Version-local framework evidence for the selected work is the installed Next 16.2.10 documentation and source, not remembered behavior from another release:

- Server Action origin configuration: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` and the [official Server Actions configuration reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions).
- Root-layout invalidation: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` and the [official `revalidatePath` reference](https://nextjs.org/docs/app/api-reference/functions/revalidatePath).
- Output tracing and Turbopack roots: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`, `turbopack.md`, the [official output reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), and the [official Turbopack reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack).
- Route-handler and backend-for-frontend boundaries: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`, the [official Route Handler reference](https://nextjs.org/docs/app/api-reference/file-conventions/route), and the [official backend-for-frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend).
- Global headers and framework disclosure: the installed `headers.md` / `poweredByHeader.md`, the [official headers reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers), and the [official `poweredByHeader` reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/poweredByHeader).

The security conclusion uses maintainer primary sources: the [Next.js advisory index](https://github.com/vercel/next.js/security/advisories), the applicable [Next.js 16.2.x advisory](https://github.com/vercel/next.js/security/advisories/GHSA-26hh-7cqf-hhc6), and the React team's [19.2.x security backport notice](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components). “Meet or exceed” is deliberate: React 19.2.4 is the published safe 19.2.x backport, while Next 16.2.10 is newer than the applicable 16.2.6 threshold.

Do not delete a passing assertion merely because a focused run exposes ordering. Make the scenario self-contained.

## 5. Finding-to-work-package register

| Finding | Class | Severity | Condensed issue | Work package |
| --- | --- | --- | --- | --- |
| MB-001 | Confirmed defect | High | Parent edits can violate the split-sum invariant and make ledger balances disagree with spending. | WP-02B |
| MB-002 | Confirmed dangerous behavior | High | `db:seed` upserts and overwrites real-like account/category settings and adds unbatchable demo rows. | WP-03 |
| MB-003 | Confirmed sensitive trace inclusion / probable packaging exposure | High | Next route output traces include local DB/WAL/SHM paths that an NFT/standalone workflow could copy; standalone also copies selected `.env` files outside NFT selection. Current `npm start` does not itself copy them. | WP-04 |
| MB-004 | Confirmed import defect | High | Auto date mode inserts ambiguous dates; correcting by re-import creates different hashes and duplicate ledger rows unless the first batch is undone. | WP-06A |
| MB-005 | Confirmed import defect | Medium | Common CSVs with both Debit and Credit columns zero-fill the inactive side and are rejected. | WP-06B |
| MB-006 | Confirmed aggregate defect | Medium | Excluded categories still appear in budget-vs-actual. | WP-08 |
| MB-007 | Confirmed semantic drift | Medium | Category filters, export, category stats, and apply-rules inspect an ignored split parent category. | WP-09/WP-10A |
| MB-008 | Confirmed presentation/correctness defect | Medium | Mixed currencies are summed, a single non-USD aggregate is formatted as USD, and account create/edit has no currency field or invalid-value repair path. | WP-11 |
| MB-009 | Probable startup integrity risk | Medium | Default categories are inserted one row at a time and can remain partial after failure. | WP-07 |
| MB-010 | Confirmed configuration/operations risk | Medium | Custom DB paths bypass ignore/restore assumptions; environment loading suppresses unexpected failures; current startup creates the parent and opens SQLite before migration/path preflight completes. | WP-12 |
| MB-011 | Confirmed privacy hardening gap | Medium | DBs/backups can be `0644` and directories `0755` under a common umask. | WP-13A |
| MB-012 | Confirmed browser-boundary gap | Medium | `/api/import` has no Origin check, Server Actions trust every `*.ts.net`, Next discards scheme and permits missing Origin at its framework check, and the app permits framing. | WP-14A |
| MB-013 | Confirmed export risk | Medium | Formula-leading imported text is emitted unchanged to spreadsheet-oriented CSV. | WP-10B |
| MB-014 | Documentation/runtime guarantee gap | Medium | Telemetry opt-out depends on a copied environment template. | WP-05 |
| MB-015 | Confirmed test reliability defect | Medium | Several integration tests rely on test order and shared mutations. | WP-01A |
| MB-016 | Confirmed coverage gap | Medium | No golden hash vectors or committed populated migration matrix protect compatibility. | WP-01B/WP-01C |
| MB-017 | Known compatibility limitation | Informational | Identical rows in separate files can collide under the frozen hash. | RFC-01 |
| MB-018 | Known product backlog | Informational | Transfer pairing and refund semantics require product policy, not a silent remediation. | RFC-02/RFC-03 |
| MB-019 | Confirmed deployment drift | Medium | systemd hard-codes `/usr/bin/npm` while setup permits NVM. | WP-16 |
| MB-020 | Architecture drift | Low | Import and health routes access the DB directly. | WP-15 |
| MB-021 | Documentation drift | Low | `TODO.md` still calls the committed UX round uncommitted. | WP-00/WP-18 |
| MB-022 | Confirmed accessibility gaps | Low | Shared errors, confirmations, nav state, and some split controls lack complete accessible behavior. | WP-17 |

The comparison also found plan-completeness gaps that extend existing findings without rewriting their historical IDs:

| Gap ID | Class | Evidence | Selected package |
| --- | --- | --- | --- |
| PG-01 | Confirmed plan omission | Public account/category/transaction services accept caller-owned cents, dates, budgets, currencies, and foreign keys without revalidating the domain contract. | WP-02A |
| PG-02 | Confirmed defect / plan omission | `dollarsToCents()` uses `Number` plus `Math.round`; form defaults and CSV use division/`toFixed`, so editable and serialized money are not exact integer-digit paths. | WP-02A |
| PG-03 | Confirmed import defect / plan omission | `importStatement()` writes valid rows when other rows are malformed; route column-map parsing silently falls back; CLI account creation occurs before file preflight. | WP-06 |
| PG-04 | Confirmed availability gap | `request.formData()` buffers before the authoritative 5 MiB file check; declared length can be absent or understated. | WP-14B |
| PG-05 | Confirmed maintenance gap | Shared actions hard-code five page paths although installed Next documents root-layout revalidation for all data. | WP-14C |
| PG-06 | Supported future-packaging risk | Route exclusions do not cover every framework-server NFT manifest, and standalone copies `.env` / `.env.production` outside normal trace selection. | WP-04 |

## 6. Target architecture

The target preserves the current App Router and service-oriented structure:

```text
Browser / CLI
    |
    +-- Next pages and client components -------- presentation and interaction
    +-- Route handlers / Server Actions -------- transport validation and status mapping
    +-- Operational scripts -------------------- explicit process/connection ownership
                    |
                    v
          src/server/services/* ---------------- business rules, DB queries,
                    |                             transactions, cross-row invariants
                    v
          src/db/client.ts + schema ------------ connection, pragmas, migrations
                    |
                    v
                  SQLite

Pure parsing, money/date logic, hash compatibility, CSV encoding
remain in src/lib/* and do not open the database or perform network I/O.
```

### Boundary rules

- Route handlers parse HTTP, enforce origin/body/header policy, call a service, and map typed results to HTTP. They do not import `@/db/client`, `@/db/schema`, or Drizzle query builders.
- Server Actions validate FormData/arguments, call a service, map typed outcomes to user-visible errors, and revalidate paths only after success.
- Services own checks that must remain true regardless of caller. In particular, safe integer cents, ISO dates, positive/null budgets, normalized currencies, referenced entities, split sums, split-parent edit guards, seed eligibility, import atomicity, and destructive target verification cannot live only in UI or action code.
- Operational scripts may own a connection when the operation itself is database administration, but reusable business behavior should be extracted into an injectable service or pure helper.
- Configuration/path helpers must not import `src/db/client.ts`, because merely resolving a path must never open or migrate a database.
- Shared SQL semantics should be represented once. The active-category predicates and split-aware spending projection are contracts, not page-specific conveniences.
- Exact editable-money conversion belongs in a pure browser/server-safe module. Services accept cents, never editable decimal strings; forms and CSV share the inverse digit serializer instead of division or `toFixed`.
- Components receive truthful, already-discriminated financial states. A component must not infer that currencies can be summed or that a split parent's category is active.

### Suggested narrow modules

Create these only when their work package needs them:

| Suggested module | Responsibility |
| --- | --- |
| `src/db/path.ts` | Pure Node-only database path resolution/classification; no open, migration, or query side effect. |
| `src/server/services/domain-contracts.ts` | Narrow service-boundary validators and typed expected-conflict helpers; no generic CRUD/repository abstraction. |
| `src/lib/money.ts` | Shared exact decimal-text ↔ safe-integer-cents helpers plus presentation formatting. |
| `src/server/services/health.ts` | Minimal parameterized `select 1` health check. |
| `src/server/services/transaction-categories.ts` | Reusable active-category SQL predicates/projections if keeping them in existing services would duplicate logic. |
| `src/server/security/origin-policy.ts` | Exact URL parsing/matching for same-origin and explicitly configured HTTPS deployment origins; no suffix wildcard. |
| `src/lib/csv/spreadsheet-safe.ts` | Pure export-time text-cell protection, if a separate module improves focused tests. |
| `scripts/check-build-privacy.mjs` | Dependency-free read of `.nft.json` metadata; never opens traced files. |
| `scripts/next-telemetry-disabled.cjs` | Preload that sets `NEXT_TELEMETRY_DISABLED=1` before the Next CLI loads. |
| `scripts/run-with-temp-db.mjs` | Cross-platform safe-command harness that supplies and cleans a unique absolute temporary DB. |
| `scripts/audit-data-path.ts` | Read-only DB path, Git-ignore, and POSIX-mode diagnostics. |
| `scripts/verify-backup.ts` | Read-only validation for a standalone backup used by the manual restore runbook. Automated restore remains RFC-06. |

Do not create a general repository layer, event bus, plugin system, or currency-conversion abstraction. The current local single-user scope does not justify them.

## 7. Decision register

The decisions below are part of the north star. D-11 through D-16 remain deferred product RFC inputs and are not unresolved choices inside the selected remediation packages.

| ID | Decision | Recommended default | Reason and guardrail |
| --- | --- | --- | --- |
| D-01 | Edit a transaction that has valid splits | Reject an amount change. Permit description/date/account/category edits only when the existing parts currently sum to the unchanged parent amount. | Silent rescaling invents allocations; silent clearing discards user work. Return a typed conflict and link the user to edit/clear splits first. |
| D-02 | Existing split mismatch | Detect and report; block every ordinary parent update until the user explicitly repairs or clears the split; never auto-repair. | Date/account edits can move bad allocations between financial periods/accounts, and the intended allocation cannot be reconstructed safely. Do not print descriptions or amounts to logs. |
| D-03 | Ambiguous date in `auto` mode | Fail the entire file before creating a batch or transaction, then require explicit MDY/DMY. | A warning after insertion is too late because the corrected date changes the frozen hash. |
| D-04 | Debit and Credit are both present | Parse both. Zero is inactive when the other side is nonzero; two nonzero values are an error; two zeros produce a zero-cent row, matching the accepted single Amount value `0`. | This supports common bank exports and preserves negative-debit refund and negative-credit reversal semantics. If zero transactions are later prohibited, change that as a separate global policy. |
| D-05 | Excluded category also has a budget | Preserve the stored budget but omit the category from budget-vs-actual while excluded. Show explanatory UI copy; do not silently clear the budget. | Re-enabling the category restores the user's configuration without making excluded spending appear active. |
| D-06 | Split transaction CSV representation | Preserve `/api/export` as the five-column compatibility format; a split parent emits `Category=Split`. Add `/api/export?format=detailed` with `Date,Description,Amount,Currency,Account,Category,Split Details`; make the UI use detailed. | Existing consumers keep their header contract, while detailed export is truthful and currency-explicit. Keep any future allocation-level export separate. |
| D-07 | Category-filtered export of a split transaction | Export the full parent row when any active allocation matches; document that the filter means “transaction contains this category.” | Exporting only the matched amount would silently change the ledger-row contract. A separate allocation export can serve that need later. |
| D-08 | Mixed currencies | For exactly one currency, format all combined values in that currency. For more than one, expose a discriminated mixed state and suppress every combined net-worth, income, spending, trend, and budget scalar. No conversion. | Warning beside a false sum is insufficient. External exchange rates would violate local/no-egress scope. |
| D-09 | Demo seed eligibility | One-time, fail-closed initialization only: no accounts, transactions, batches, or splits; categories must be empty or exactly the untouched defaults. Refuse re-seeding and custom/nonempty ledgers; provide no `--force`. | There is no reliable way to distinguish coincident personal rows from demo rows in the current schema. Repeatable demo cleanup needs a future marker design. |
| D-10 | Relative DB paths | Require in-repository relative paths to resolve under `data/`; allow a canonical absolute external path. Preflight and reject every other target before directory creation or SQLite open. Never relocate a file automatically. | Keeps Git, backup, restore, permissions, and trace policy aligned. A legacy external target can be expressed as its canonical absolute path; an unsafe in-repository target needs an explicit operator move procedure. |
| D-11 | Cross-file hash collision | **Decision gate / defer.** Preserve the hash. Prefer explicit review/override recorded outside the hash if this is implemented. | Changing the digest breaks compatibility with every stored import hash. |
| D-12 | Refunds | **Decision gate / defer.** Preserve current negative-only gross-spend behavior until a written product model is approved. | Netting by category/date/merchant is a financial policy decision, not a parser fix. |
| D-13 | Transfers | **Decision gate / defer.** Add advisory candidate detection and explicit user confirmation; do not auto-pair or delete. | Similar amounts and dates are evidence, not proof of a transfer. |
| D-14 | Authentication | Do not add it in this remediation program. Preserve loopback default and documented trusted-network opt-ins. | No-auth is an intentional product boundary; origin/framing fixes harden browser mutations without changing product scope. |
| D-15 | Mixed-sign splits | **Decision gate / defer.** Do not change current accepted semantics until refunds and transfer behavior are defined. | A negative parent containing positive and negative parts has policy implications across spending and refunds. |
| D-16 | Automated restore | Deferred as RFC-06. Selected remediation ends with validated private backups, a read-only verifier, and an offline manual restore runbook. | Restore is destructive and requires separate approval, independent review, and an enforceable quiescence design. |
| D-17 | Tailscale/custom browser origins | Accept only exact comma-separated HTTPS origins. Derive exact host/port strings for Next's build-time Server Action allowlist; enforce exact scheme/host/port at runtime for import and at the start of every action. No `*.ts.net` or suffix wildcard. | Next's framework comparison drops the scheme and permits a missing Origin, so it is defense in depth rather than the complete policy. Configuration changes require rebuilding. |
| D-18 | Malformed statement files | Any malformed row fails the complete file. Ambiguous dates and invalid column maps remain distinct typed preflight results. | Partial import makes correction and hash behavior difficult to reason about; refusal before mutation is deterministic. |
| D-19 | Upload resource bound | Cap the raw multipart body at `5 MiB + 64 KiB`. Reject an oversized declared length early, then read/cancel the stream at the hard cap and call `formData()` only on a reconstructed in-memory bounded request. Keep the 5 MiB file check authoritative. | Covers absent, chunked, malformed, or understated lengths without another dependency. |
| D-20 | Account currency | Add normalized three-letter currency to create/update service contracts, actions, forms, and applicable APIs. `Intl.NumberFormat` acceptance is the support test; invalid persisted values get an in-app repair path. | Makes the existing schema field operable and prevents a false aggregate without a package or exchange rates. |
| D-21 | Revalidation | After every successful financial mutation, call `revalidatePath("/", "layout")`; retain client refresh only where current behavior needs it and verify all routes update. | Installed Next 16.2.10 documents this as invalidating the root layout and all pages beneath it, avoiding a drifting hard-coded route list. |

## 8. Delivery sequence

Implement the following seven stages in order. Work within a stage may be split into the named reviewable WPs, but no later stage may merge before its stated prerequisite. Detailed sections retain stable IDs so findings and historical discussion remain traceable.

```text
Stage 1  WP-00 immediate documentation safety corrections
   |
Stage 2  WP-01A/B/C compatibility + test isolation
         WP-12A strict env/path/migration preflight
         WP-01D safe temporary DB execution + WP-12B Git/path audit
   |
Stage 3  WP-02A domain write contracts + exact money helpers
         WP-02B split integrity + WP-03 safe demo seed
   |
Stage 4  WP-06 fail-closed import/parser/map/CLI atomicity
         WP-07 default-category atomicity + WP-08 excluded budgets
   |
Stage 5  WP-09 active-category semantics
         WP-11 account currency + truthful aggregate states
         WP-10 compatibility/detailed export
   |
Stage 6  WP-04 trace/standalone privacy + WP-05 telemetry
         WP-14A/B/C browser origins, bounded upload, headers/no-store,
                    root-layout revalidation
         WP-15 services-only route boundary
   |
Stage 7  WP-13 private backup/manual restore + WP-16 runtime hardening
         WP-17 accessibility + WP-18 final documentation/release

RFC-01..06 remain outside remediation until explicitly approved.
```

### Package summary

| Package | Primary outcome | Findings | Size | Prerequisites |
| --- | --- | --- | --- | --- |
| WP-00 | Correct dangerous/stale documentation immediately | MB-002, MB-010, MB-019, MB-021 | S | None |
| WP-01A–C | Independent stateful suites, frozen hash/parser contracts, migration checksums, populated upgrades | MB-015, MB-016 | M/L | WP-00 |
| WP-12A | Side-effect-free strict env/DB-path/migration-asset preflight before filesystem/SQLite mutation | MB-010 | M | WP-01A |
| WP-01D | Intrinsically safe temporary-DB tests, builds, and smokes | MB-015, PG-06 | M | WP-12A |
| WP-12B | Enforced DB path/Git boundary and read-only audit | MB-010 | M | WP-12A |
| WP-02A | Narrow service-owned domain validation and exact editable-money helpers | PG-01, PG-02 | M | WP-01A/B, WP-12A |
| WP-02B | Service-owned split invariant and mismatch diagnostics | MB-001 | M | WP-02A |
| WP-03 | Fail-closed, transactional demo seed | MB-002 | M | WP-02A, WP-12A |
| WP-06 | File-atomic parsing, strict column maps, date/debit-credit fixes, atomic CLI account creation | MB-004/005, PG-03 | L | WP-01B, WP-02A |
| WP-07 | Atomic default category installation | MB-009 | S | WP-01A, WP-02A |
| WP-08 | Excluded budgets align with aggregate contract | MB-006 | S | WP-02A |
| WP-09 | Shared active-category behavior | MB-007 | M/L | WP-02B, WP-01A |
| WP-11 | Configurable/repairable currency plus discriminated single/mixed/invalid states | MB-008 | M/L | WP-02A, WP-08/09 |
| WP-10 | Five-column compatibility export plus detailed, split/currency-truthful streaming export | MB-007/013 | L | WP-02A, WP-09, WP-11 |
| WP-04 | Correct trace roots/exclusions, every-manifest and standalone copied-tree privacy checks | MB-003, PG-06 | M | WP-01D, WP-12B |
| WP-05 | Telemetry disabled by every Next invocation | MB-014 | S | WP-01D; coordinate with WP-04 |
| WP-14A | Exact runtime/action Origin policy plus global response headers | MB-012 | M | WP-12A, installed Next docs review |
| WP-14B | No-store financial responses, bounded 5 MiB upload, safe filename | PG-04 | M | WP-14A |
| WP-14C | Root-layout mutation revalidation and behavior verification | PG-05 | S | WP-14A |
| WP-15 | Restore and enforce services-only DB access | MB-020 | S/M | WP-06, WP-14 contracts stable |
| WP-13A | Private modes, validated backups, and safe manual restore docs | MB-010/011 | M | WP-12B |
| WP-16A | Correct systemd Node/npm portability contract | MB-019 | S | Stage 6 complete |
| WP-16B | Direct launcher, telemetry, private umask, and service hardening | MB-019/011/014 | M | WP-05, WP-13A, WP-16A |
| WP-17 | Shared accessibility contract completion | MB-022 | M | Shared action/result behavior stable |
| WP-18 | Documentation, backlog, and release closeout | All | M | All selected packages |

Estimated size is relative: S is a focused half-day-sized diff, M is roughly one to two focused days, and L should be split into independently reviewable slices.

## 9. Detailed work packages

### WP-00 — Immediate documentation safety corrections

**Goal:** remove instructions that can cause a maintainer to run an unsafe command before the code-level guards land.

**Current evidence**

- `README.md` and `USER_MANUAL.md` describe `npm run db:seed` as idempotent or safe to repeat.
- `src/db/seed.ts` uses `onConflictDoUpdate` for named accounts and default categories, including opening balances, colors, keywords, and exclusion flags.
- Restore instructions in `README.md` and `USER_MANUAL.md` hard-code `data/finance.db`, while `resolveDbPath()` permits a custom `DB_FILE_NAME`.
- `TODO.md` says UX round 2 is entirely uncommitted, but HEAD is the matching `3d967ba` commit and the historical audit snapshot was clean. The current documentation worktree is intentionally not clean, as Section 4 records.
- The systemd examples call `/usr/bin/npm`; setup documentation also permits NVM, which systemd does not source automatically.

**Implementation steps**

1. Replace every “safe to repeat” seed claim with a prominent warning: use only on a new disposable/demo ledger; make a validated backup before any uncertainty; code-level protection is pending WP-03.
2. Remove the dashboard empty-state suggestion to run seed, or label it unambiguously as demo-only until WP-03 provides a safe target flow.
3. Correct the restore target text to the resolved `DB_FILE_NAME`. Explain that the matching `<target>-wal` and `<target>-shm` belong to that exact target and that the service must be stopped before a manual restore.
4. Add an NVM/systemd warning: `/usr/bin/npm` requires a compatible system-wide installation and will not see an interactive shell's NVM environment.
5. Replace the stale P0 commit task in `TODO.md` with a historical note that UX7–UX18 landed in `3d967ba`. Do not rewrite the shipped milestone history.
6. Retain the existing `CLAUDE.md` link to this guide and update its status only if the program is superseded or completed.

**Acceptance criteria**

- `rg -n "safe to repeat|entirely uncommitted|copy.*data/finance.db" README.md USER_MANUAL.md TODO.md CLAUDE.md src/app` returns no misleading live instruction.
- Documentation clearly distinguishes current unsafe implementation from the intended WP-03 guard.
- No command implies that a custom-path database should be restored into the default path.
- `git diff --check` passes; no executable file changes are mixed into the documentation patch.

**Rollback:** revert only the wording if it proves inaccurate. Never restore the unsafe seed claim merely because WP-03 is delayed.

---

### WP-01 — Trustworthy validation and compatibility locks

This package should land before broad production changes. It has four independently reviewable slices.

#### WP-01A — Remove test-order dependence

**Current path:** `src/test/test-db.ts` creates one database per test file/`describe` using `beforeAll`. The exact-name import failure confirms shared mutation. Audit all 11 current `beforeAll` suites, not only the reproduced importer: import and import-batch/undo in `src/server/services/import.test.ts`; accounts and net-worth in `accounts.test.ts`; categories in `categories.test.ts`; transactions and transaction splits in `transactions.test.ts`; budget, trend, and split-aware aggregates in `summary.test.ts`; and default installation in `src/db/default-categories.test.ts`.

**Target behavior:** every test is a complete arrange/act/assert scenario. Selecting it by exact name must not change its prerequisites.

**Implementation steps**

1. Fix the smallest confirmed cases first:
   - a re-import test performs the first import and the re-import itself;
   - an undo test creates its own import batch;
   - update/delete/balance tests arrange the row and IDs they mutate;
   - no test reads an ID stored by another `it` block.
2. Inventory every `beforeAll(` under `src/**/*.test.ts` and name every containing `describe`. For import, import-batch/undo, accounts, net-worth, categories, transactions, transaction splits, all three summary suites, and default-category installation, record whether setup is immutable. A later test must not rely on a row created, updated, deleted, imported, split, or assigned to a module variable by an earlier `it`.
3. Add `setupTestDbPerTest()` only where repeated setup remains noisy. It should create a fresh migrated temp directory/database in `beforeEach`, close SQLite, and remove the directory in `afterEach`, including after failures.
4. Keep a per-suite `beforeAll` fixture only when every test treats it as immutable. A suite that tests writes should normally arrange a fresh DB or a savepoint/fixture reset for each test.
5. Add a dedicated shuffled-order validation command or documented Vitest invocation after the confirmed suites are independent. Do not make nondeterministic ordering the only CI mode.
6. Preserve expected behavior assertions. Do not lower counts or broaden matches to accommodate shared state.

**Focused tests**

```bash
npm test -- -t "re-importing the same file imports 0"
npm test -- -t "undo deletes exactly the batch's rows"
npm test -- src/server/services/accounts.test.ts
npm test -- src/server/services/categories.test.ts
npm test -- src/server/services/transactions.test.ts
npm test -- src/db/default-categories.test.ts
```

Then run the suite in normal and shuffled orders across several fixed seeds. Record the seeds so failures reproduce.

**Acceptance criteria**

- Every integration test passes by exact name.
- The full suite passes in its default order and at least three recorded shuffled orders.
- Temp databases are removed on success and failure.
- Production files are untouched; no test resolves to `data/finance.db`.

#### WP-01B — Lock the import-hash and parser compatibility surface

**Current path:** `src/lib/import-hash.ts`, `src/lib/import-hash.test.ts`, and `src/lib/csv/parse-statement.test.ts` test behavior but do not pin known digest outputs.

**Implementation steps**

1. Add golden hash tests for the two exact digests in Section 3. Include the literal account ID, date, amount, description, normalization result, and occurrence index used to derive them.
2. Cover UTF-8 descriptions, leading/trailing/repeated whitespace, case folding, two identical rows, row-order changes, and different account IDs.
3. Assert that the same complete file re-import produces the same vector sequence.
4. Add a prominent test comment that a changed digest requires a separately approved compatibility migration—not an updated snapshot.
5. Add parser contract fixtures for safe-integer cents, ISO dates, MDY/DMY, ambiguous separated dates, debit/credit signs, decimal comma, parentheses, and trailing minus.

**Acceptance criteria**

- Golden values are literal constants, not recomputed by the production helper inside the expectation.
- WP-06 changes can modify parser outcomes without changing either digest for unchanged normalized rows.
- No test contains or derives from real financial data.

#### WP-01C — Add populated migration coverage

**Current path:** `src/db/client.ts` runs Drizzle migrations automatically; migrations `0000`–`0004` are append-only, but committed tests primarily exercise a fresh current schema.

**Implementation steps**

1. Add a temp-DB migration harness that can apply migrations sequentially to a selected historical revision. Use the committed SQL and Drizzle journal; do not copy current schema definitions into a fake “old” schema.
2. For each meaningful historical point, insert fake rows valid at that revision, including:
   - accounts with opening balances;
   - categorized and uncategorized transactions with import hashes;
   - excluded categories and budgets when those columns exist;
   - import batches when `0003` exists;
   - valid splits when `0004` exists.
3. Run the current migrator, then assert row preservation, default values for new columns, foreign-key behavior, indexes, and the migration journal.
4. Run `PRAGMA quick_check` and `PRAGMA foreign_key_check` after every upgrade.
5. Add a “current schema to current schema” idempotency test.
6. Pin literal SHA-256 checksums for the committed `0000`–`0004` SQL files in a test/manifest. The expected values must be committed constants, not computed from the same files at test setup. Include the relevant journal metadata if changing it could alter order. Drizzle's migration journal does not by itself prove historical SQL remained byte-identical.
   - Make the byte contract cross-platform first, for example with a narrow `.gitattributes` rule enforcing LF for migration SQL; otherwise Windows checkout conversion can create false checksum failures.
7. If a future migration is destructive or transforms data, require a dedicated pre/post fixture and explicit rollback/recovery procedure before merge.

Baseline SQL checksums at `3d967ba`:

| Migration | SHA-256 |
| --- | --- |
| `0000_hesitant_yellow_claw.sql` | `f6fbc57eab77a346e5c6b8e72d24e1393a15497b4051cde2c4f932648f8dfd31` |
| `0001_third_skin.sql` | `083430c4c6a7acbe024293efaa1835dfde96377f3a0bc7d08f9df4564b24eed5` |
| `0002_noisy_bill_hollister.sql` | `3fb428f49b2de20b671756014748d9b877f93142cc4cbec7c4daf417dbf60a78` |
| `0003_bouncy_odin.sql` | `d16f531ee1e4958c428716fcfdf0ae888b917055a32dc22ec4249bc405ec2de7` |
| `0004_right_gamma_corps.sql` | `163081861a670360f47dfc52c8934f70bbed808606a8a85f18ffbf4e61baf0f1` |

Parse and pin the first five journal entries by `idx`, `version`, `when`, `tag`, and `breakpoints` while allowing future entries to append. Do not pin the entire journal file as immutable because a legitimate new migration must extend it.

**Acceptance criteria**

- Fresh migration and every populated historical fixture reach the current schema.
- Re-running migrations is a no-op.
- Existing migration files remain byte-identical.
- A broken foreign key or intentionally altered migration makes the test fail loudly.

#### WP-01D — Make the no-real-data test/build rule executable

**Problem:** a bare Next build can import server modules that default to `data/finance.db`, and an accidentally uninjected test can call `getDb()`. A written warning does not prevent creation, migration, or default installation in the active ledger.

**Implementation steps**

1. Add a dependency-free Node command wrapper that:
   - creates a unique directory under the OS temporary directory;
   - resolves an absolute per-run `DB_FILE_NAME` inside it;
   - refuses any target under the repository or configured runtime-data tree;
   - spawns the requested bounded command with that environment;
   - forwards exit/signal status;
   - closes/removes the temporary DB, WAL, SHM, and directory in `finally`/signal cleanup.
2. Make `npm run build` intrinsically use the safe temporary target before it invokes Next. A production build must not need the live ledger; `npm start` receives the real configured target only at runtime.
3. Configure Vitest so every worker receives its own temporary default DB path before application modules load. A global setup may create the temp root, a setup file may derive a worker-specific filename, and global teardown must remove the root. Tests that inject their own DB remain unchanged.
4. Add a test sentinel that intentionally calls an uninjected service and proves it opens only the worker temp target.
5. Provide a bounded helper for dev/start smoke tests that uses a new temporary absolute DB and explicit loopback binding, then always stops and cleans up.
6. Before WP-04 trace exclusions land, run privacy builds only in a sanitized fixture workspace with no real runtime data anywhere under the trace root.
7. Keep `npm run lint` DB-free; fail if a future lint/config import unexpectedly opens a database.

**Acceptance criteria**

- Standard `npm test` and `npm run build` are safe even when `DB_FILE_NAME` is unset.
- In a sanitized fixture workspace, a fake sentinel at its default runtime path is neither opened nor changed by test/build; never create or inspect such a sentinel over the real workspace's default path.
- Parallel Vitest workers never share an implicit SQLite file.
- Cleanup occurs after success, failure, and termination.
- The wrapper prints only its temporary path/status and never reads an existing ledger.

**Package rollback:** WP-01 changes validation infrastructure, tests, and safe command wiring, not ledger behavior. If per-test setup is too slow, optimize fixture creation after measuring; do not return to shared mutable prerequisites or bare real-target builds.

---

### WP-02A — Service-owned domain write contracts and exact money

**Delivery stage:** 3, after WP-01A/B and WP-12A.

**Goal:** make direct service calls as safe as actions/routes without building a generic repository layer, and remove binary floating point from every editable or serialized money path.

**Current evidence**

- Account, category, and transaction actions validate some fields, but `createAccount()`, `updateAccount()`, `createCategory()`, `updateCategory()`, `createTransaction()`, `updateTransaction()`, `setTransactionCategory()`, and `replaceSplits()` accept caller-owned values/references.
- `src/lib/money.ts:dollarsToCents()` uses `Number` and `Math.round`, so `1.005` is rounded rather than rejected. Split inputs use it directly.
- Account, transaction, and budget form defaults divide cents by 100; two use `toFixed(2)`. CSV export also divides and uses `toFixed(2)`.
- SQLite integer/FK/unique constraints are valuable defense in depth but do not produce a complete typed domain contract or protect values such as a semantically invalid date/currency.

**Narrow contract package**

1. Add pure, named validators/helpers rather than a generic CRUD/repository abstraction:
   - safe signed integer cents (`Number.isSafeInteger`);
   - an ISO ledger date accepted by the existing date-only validator;
   - a budget that is `null` or a positive safe integer;
   - a normalized currency code described below;
   - nonempty bounded names/descriptions/IDs where the service persists them.
2. Validate referenced accounts/categories inside the same service transaction as the write. UI prechecks may improve messages but are not the invariant.
3. Return typed outcomes for expected conflicts, with stable codes such as `not-found`, `unknown-account`, `unknown-category`, `duplicate-name`, `invalid-input`, and the split-specific conflicts in WP-02B. Do not parse arbitrary SQLite error strings in callers. Unexpected I/O/programmer/database faults still throw and roll back.
4. Keep existing database foreign keys, unique constraints, and integer affinity as defense in depth. Do not weaken them and do not add a migration merely to duplicate a service check.
5. Apply the contract to manual account/category/transaction writes, split writes, import persistence, seed persistence, recategorization, and budget updates. Transport schemas remain responsible for decoding FormData/JSON/CLI text.

**Exact editable-money helpers**

Implement in the browser/server-safe `src/lib/money.ts` (or one adjacent pure module) with no dependency:

```ts
decimalTextToCents(text: string): number | null
centsToDecimalText(cents: number): string
```

The locked grammar and behavior are:

- trim outer ASCII/Unicode whitespace;
- accept an optional leading `+`/`-` and either digits with an optional one/two-digit fraction or a leading decimal point with one/two digits;
- reject currency symbols, grouping separators, exponent syntax, internal whitespace, a bare sign/point, and more than two fractional digits;
- build the result from digit strings/integers, normalize negative zero to numeric `0`, and return `null` unless the result is a safe integer;
- serialize a safe integer by sign/whole/remainder digits with exactly two fractional digits; reject programmer misuse of a non-safe integer rather than rounding it.

`parseAmountToCents()` may retain bank-specific normalization (symbols, grouping, parentheses, decimal comma, trailing minus) but must delegate its final exact decimal conversion or follow the same safe digit algorithm. It must not broaden editable form grammar accidentally.

Replace every editable/serialization float path:

- `SplitEditor` input parsing, remainder math inputs, and split defaults;
- transaction amount and account opening-balance form defaults;
- category budget form default;
- server action parsing for those three editable fields;
- both CSV export formats in WP-10.

`Intl.NumberFormat` may still receive `cents / 100` for final display only. All persisted, compared, summed, form-default, and exported values remain integer/digit based.

**Tests and acceptance criteria**

- Direct service calls reject unsafe cents, invalid dates, nonpositive budgets, invalid currencies, and unknown references with typed results and no write.
- Create/update paths cannot race a caller-side existence check into a raw FK/unique error; a fake competing connection test covers the practical conflict path.
- Decimal tests include blank, `0`, `-0`, `+.5`, `-.05`, `1.2`, `1.23`, `1.230`, `1.005`, exponent text, symbols/grouping, and values around `Number.MAX_SAFE_INTEGER`.
- `centsToDecimalText(9007199254740990)` is exactly `90071992547409.90`; round-trip every accepted safe cent value at boundaries.
- Form defaults and split inputs round-trip exactly. More than two fractional digits are refused, never rounded.
- Services remain narrow functions in existing domain modules; no base repository, generic entity validator, event bus, or new package appears.

**Rollback:** keep exact money parsing and service validation even if a caller's error mapping needs correction. Roll back only the affected adapter/UI mapping; never return to `Math.round`, caller-only foreign-key validation, or unsafe integer acceptance.

---

### WP-02B — Service-owned split integrity

**Delivery stage:** 3, after WP-02A.

**Goal:** make it impossible for any supported write path to create or preserve a new parent/split mismatch, while handling possible historical mismatches without guessing.

**Current path and defect**

- `splitTransactionAction()` in `src/server/actions/transactions.ts` validates the sum before calling `replaceSplits()`.
- `replaceSplits()` in `src/server/services/transactions.ts` deletes/inserts atomically but explicitly delegates validation to its caller.
- `updateTransaction()` updates `amountCents` without checking for split rows.
- The schema comment in `src/db/schema.ts` states the sum invariant but SQLite does not enforce it.

**Recommended service contract**

Use typed, non-exceptional outcomes for expected conflicts. The exact type may vary, but it should be equivalent to:

```ts
type UpdateTransactionResult =
  | { status: "updated"; id: string }
  | { status: "not-found" }
  | {
      status: "existing-split-mismatch";
      parentAmountCents: number;
      splitTotalCents: number;
    }
  | {
      status: "split-amount-conflict";
      currentAmountCents: number;
      splitTotalCents: number;
    };

type ReplaceSplitsResult =
  | { status: "updated" }
  | { status: "not-found" }
  | { status: "invalid-parts"; reason: string }
  | { status: "unknown-category" };
```

Expected validation failures should not depend on parsing SQLite error strings. Programmer faults and unexpected database failures should still throw and roll back.

**Implementation steps**

1. Move the complete split invariant into `replaceSplits()` or a narrowly named service replacement:
   - parent exists;
   - empty array means clear;
   - otherwise at least two parts;
   - every amount is a safe, nonzero integer;
   - sum accumulation remains a safe integer;
   - total equals the parent's current `amountCents`;
   - every non-null category exists.
2. Perform the parent read, validation, delete, and insert in one write-reserving SQLite transaction using the installed Drizzle better-sqlite3 `{ behavior: "immediate" }` option. Category lookup may be batched. The action remains responsible for Zod shape validation and friendly formatting, but not correctness.
3. Change `updateTransaction()` so its immediate transaction reads the current parent and split total before updating:
   - if existing parts do not sum to the current parent, return `existing-split-mismatch` for every ordinary parent edit;
   - if parts are valid but `input.amountCents !== current.amountCents`, return `split-amount-conflict`;
   - only a valid split with an unchanged amount may receive a metadata edit.
4. Apply the same existing-mismatch guard to `setTransactionCategory()` and any other service that updates the parent row. Search every `update(transactions)` call; deletion/explicit split repair are the only operations allowed to remove a mismatch without an ordinary parent update.
5. Map both conflicts in actions to stable messages: repair the split allocations or explicitly clear the split first. Do not automatically rescale or clear parts.
6. Preserve `importHash` and `batchId` provenance on edit. No update should turn an imported row into a manual row or detach it from undo.
7. Add a read-only mismatch query/service for maintenance. It may return transaction IDs and totals to the local trusted application UI, but logs should expose at most a generic presence/count and the health endpoint must remain generic and must not invoke this audit. Do not automatically repair rows.
8. Show a blocking UI warning when a mismatch already exists. The only offered write paths are explicit: adjust parts to the unchanged parent or clear splits after the user reviews them.

**Tests**

- Creating valid positive and negative splits succeeds.
- Zero part, unsafe integer, one-part nonempty split, unknown parent, unknown category, and mismatched sum all refuse with no row changes.
- Replacing valid parts rolls back the delete if insert/validation fails.
- Clearing parts succeeds and the parent category becomes active again.
- Editing description/date/account with an unchanged amount succeeds only when the current split is valid and preserves its parts.
- Any ordinary parent edit on a historical mismatch refuses and leaves every parent/split field unchanged.
- Direct `setTransactionCategory()`/inline recategorization also refuses on a historical mismatch rather than changing an ignored/fallback parent.
- Editing the amount of a split transaction refuses and leaves the full parent row unchanged.
- Editing the amount of an unsplit transaction succeeds.
- A direct service call cannot bypass the invariant.
- Two real temporary SQLite connections race a parent update and split replacement. One may receive `SQLITE_BUSY`, but both can never commit inconsistent state. A documentation-only single-process assumption is insufficient because operational scripts and multiple processes can open the same file.
- Split-aware spending, budgets, trends, and account balance agree after each permitted mutation. WP-09 separately validates category filters once their split semantics are corrected.

**Acceptance criteria**

- The audit reproduction (`-12000` parent versus `-10000` parts) is impossible through service/action paths.
- `replaceSplits()` no longer says “caller is responsible” for sum validation.
- A fault after deletion leaves the prior split set intact.
- Existing mismatches are detected but never silently changed.
- No schema migration is required. A trigger-based solution is out of scope unless service enforcement proves insufficient and a migration design is separately reviewed.

**Rollback:** this is a correctness boundary and should not be rolled back to unguarded updates. If UI mapping regresses, revert only the UI layer while retaining service refusal.

---

### WP-03 — Fail-closed, transactional demo seed

**Delivery stage:** 3, after WP-02A and WP-12A.

**Goal:** make `npm run db:seed` incapable of overwriting or mingling with personal data.

**Current path and defect:** `src/db/seed.ts` loads the active database, upserts named accounts/categories with `onConflictDoUpdate`, and inserts deterministic transactions without an import batch. Re-running can reset opening balances and category settings in a real-like ledger.

**Target policy**

- Seed is a one-time demo initializer, not general data synchronization.
- Eligible target: no accounts, transactions, import batches, or splits; categories are either absent or exactly the untouched built-in default set.
- Any custom category, edited default, budget, account, or transaction makes the command refuse.
- There is no `--force` escape hatch in this package.
- Re-running against the seeded database refuses. If repeatable demo reset is later required, design a dedicated marker/batch and removal migration separately.

**Implementation steps**

1. Land WP-12A first. Load `.env` fail-closed and resolve the target without importing the auto-opening client.
2. Print the normalized target path before mutation, but never query or print row contents.
3. Require an existing, current, explicitly migrated schema. A missing target or unknown/old schema refuses with instructions to run `npm run db:migrate` against the intended disposable/demo target first. Seed must not create or auto-migrate a file before eligibility is known.
4. Extract injectable behavior such as `seedDemoData(db, clock)` from the executable script. Keep CLI parsing/printing/process exit in the script.
5. Recheck eligibility inside one immediate write transaction to prevent time-of-check/time-of-use drift.
6. Compare the category table with the exact default definitions, including names, colors, normalized keyword JSON, exclusion flag, and null budget. Any other state refuses. Handle the two allowed states explicitly inside the same transaction:
   - no categories: insert the defaults and retain their returned IDs;
   - exact defaults already present: reuse their existing IDs unchanged.
7. Insert accounts with an explicit validated `USD` demo currency and insert transactions in that transaction through the WP-02A service-owned contracts. Do not update an existing row. A name conflict after the eligibility check must roll back everything.
8. Inject the clock/month anchor for deterministic tests. Keep ledger dates built directly as ISO strings.
9. Remove “idempotent” language from code comments, command docs, dashboard empty state, and manual.
10. Return/print a concise fake/demo summary after success; do not log transaction descriptions or per-row amounts.

**Tests**

- Fresh schema with untouched defaults seeds successfully.
- Fresh current schema with no categories inserts defaults and demo rows atomically.
- Existing exact defaults are reused; their IDs and creation timestamps remain unchanged.
- A missing or historical-schema target refuses before creation/migration.
- A database with one account, one manual/imported transaction, one batch, one split, one custom category, one changed keyword, one changed exclusion flag, or one budget refuses and remains logically unchanged.
- Name collisions cannot update an opening balance or category setting.
- Failure on the Nth insert rolls back accounts, categories, and transactions.
- Running twice: first succeeds, second refuses without changes.
- A non-ENOENT `.env` error exits nonzero before opening/creating the default database.
- Fixed clocks at a month/year boundary produce valid deterministic ISO dates.
- The script never targets a real repository data path in tests; use a temp absolute path.

**Acceptance criteria**

- There is no production path from `db:seed` to `onConflictDoUpdate` on personal account/category rows.
- The guard covers configuration-only ledgers, not merely ledgers with transactions.
- Refusal is nonzero, actionable, and mutation-free.
- No historical demo cleanup is attempted.

**Rollback:** retain the refusal even if demo convenience regresses. A temporary workaround is a separately configured disposable database, not a force flag against the active ledger.

---

### WP-04 — Next output-trace privacy

**Delivery stage:** 6, after safe temporary builds and strict path policy exist.

**Goal:** ensure tracing metadata and any future NFT/standalone packaging cannot pull runtime financial state into deployable output.

**Current path:** `next.config.ts` has no explicit trace root or exclusions. `src/db/client.ts` dynamically resolves a local database. Generated route/page `.nft.json` files referenced fake/sample DB, WAL, and SHM files. Git ignore rules do not affect Next's tracer.

**Required framework research:** before editing, reread the installed Next 16.2.10 output documentation at `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` and `turbopack.md`. The bundled docs state that exclusion keys are route globs, values are project-root-relative globs, and `'/*'` targets all traced **routes**. It does not promise that this key covers framework-level manifests such as `next-server.js.nft.json`; scan every manifest instead of inferring coverage.

**Implementation steps**

1. Derive one absolute project root from `next.config.ts`'s own location, not an inferred parent workspace or whichever directory invoked the build.
2. Set both `outputFileTracingRoot` and `turbopack.root` to that same absolute project root. This is a project consistency decision; the installed docs independently define each setting and require the Turbopack root to be absolute.
3. Add a global `'/*'` route exclusion for files the application server never needs, at minimum:
   - `data/**/*`;
   - every private `.env*` variant (source `.env.example` need not be shipped);
   - documented imports/backups/runtime directories;
   - `src/**/*.test.*`, `src/test/**/*`, `deploy/**/*`, non-runtime documentation such as `AGENTS.md`, `CLAUDE.md`, `IMPLEMENTATION*.md`, `TODO.md`, and `USER_MANUAL.md`, and operator/test-only scripts such as import, backup, audit, verification, privacy-check, and temporary-DB commands;
   - any exact configured runtime target/sidecar that could otherwise sit below the trace root (strict WP-12 normally rejects such an out-of-policy target).
4. Add narrow global route includes for `drizzle/**/*`, `node_modules/better-sqlite3/**/*`, and the exact `scripts/next-telemetry-disabled.cjs` runtime preload so migrations, native SQLite assets, and the launcher guarantee remain packaged. Never exclude application source or public PWA assets required at runtime.
5. Treat the database as externally provisioned runtime state for a copied/standalone deployment. Such a server receives an absolute `DB_FILE_NAME` pointing to a private mounted/restored database.
6. Add `scripts/check-build-privacy.mjs`. It reads every `.nft.json` under the build output—including route, middleware/instrumentation if present, and `next-server.js.nft.json` manifests—and fails if a traced path classifies as:
   - `.db`, `.sqlite`, `.sqlite3`, `-journal`, `-wal`, `-shm`, or equivalent SQLite runtime suffix;
   - `data/imports` or `data/backups`;
   - ignored environment files;
   - the exact resolved configured DB target and its journal/WAL/SHM sidecars regardless of filename extension;
   - any configured runtime-state directory.
7. The checker should print the relative manifest and policy class, not file contents or unnecessarily reveal absolute home paths.
8. Resolve each trace entry relative to its containing manifest, normalize `..` and Windows/Unix separators, then classify both normalized path and runtime-data policy. Do not trust a suffix check on the raw string.
9. Wire the checker into a separate `check:build-privacy` script first. Once stable, make it part of the build/release gate without hiding the original `next build` exit status.
10. Treat standalone copying as a second privacy boundary. Installed Next `node_modules/next/dist/build/index.js` copies loaded `.env` and `.env.production` into standalone output after normal traced-file copying, so trace exclusions cannot block those copies. Project policy rejects all private `.env*` variants in a packaged tree.
11. Permit a standalone build only in a sanitized copied workspace containing source, fake samples, and injected fake environment—never private `.env*` files or runtime data. After building, scan the entire copied `.next/standalone` tree by normalized path and symlink target before declaring it private. Fail on private env names, SQLite/runtime/import/backup paths, tests, operator/test-only scripts other than the exact telemetry preload, deploy files, or unrelated documentation. Require that preload to exist when the packaged launcher uses it.

**Fake validation**

1. Use a clean fixture workspace or existing fake sentinels under `data/samples/`; never create/overwrite `data/finance.db` in a workspace that may contain a real ledger.
2. Add fake manifest unit cases for `.db`, `.sqlite`, `.sqlite3`, an arbitrary configured DB extension, `-journal`, `-wal`, `-shm`, custom relative/absolute runtime directories, `.env.local`/production variants, `../` traversal, and Windows separators.
3. Build through WP-01D's temporary DB harness and scan every `.nft.json`; no fake DB/sidecar/import/backup/environment sentinel may appear. Before exclusions land, do this only in a sanitized fixture workspace. A bare build in the working repository is never the reproduction command.
4. Assert required migration journal/SQL, better-sqlite3 native runtime assets, and `scripts/next-telemetry-disabled.cjs` remain traceable where needed; no operator/test-only script is retained.
5. Start the production build loopback-bound with `DB_FILE_NAME` set to a new temporary absolute path. Verify `/api/health`, then stop the server.
6. In the sanitized copied workspace only, enable `output: "standalone"` for the validation fixture, assert loaded `.env`/`.env.production` sentinels would be detected, scan the complete copied tree, and prove migrations/native SQLite assets remain. Do not enable standalone in the product config until this gate passes.

**Acceptance criteria**

- The build root warning is resolved by an explicit repository root.
- Sensitive runtime-state paths do not occur in any server trace.
- Every NFT manifest and the complete sanitized standalone copied tree pass their respective path-policy scans; route glob exclusions are not claimed to cover framework-server manifests.
- No `.env`, `.env.production`, or other private `.env*` file exists in standalone output.
- The packaged launcher retains its exact telemetry preload while operator/test-only scripts remain absent.
- A fresh temporary production database still migrates and starts.
- No test or checker opens an existing DB or import file; manifest metadata only is inspected.

**Rollback:** if an essential runtime file is omitted, narrow the mistaken exclusion or add a precise include. Never roll back the `data/**/*` privacy boundary or package the live data directory.

---

### WP-05 — Intrinsic telemetry opt-out

**Delivery stage:** 6, after the safe build harness; land with WP-04 where practical.

**Goal:** make the no-telemetry claim true for `dev`, `build`, and `start` even when `.env` was never copied and the user's HOME has no global Next preference.

**Recommended implementation**

1. Add a tiny CommonJS preload, for example `scripts/next-telemetry-disabled.cjs`, containing only the environment assignment before Next loads.
2. Invoke the local Next CLI in the same Node process for `dev`, `build`, `start`, `dev:lan`, and `start:lan`, conceptually:

   ```text
   node --require ./scripts/next-telemetry-disabled.cjs ./node_modules/next/dist/bin/next <command> ...
   ```

   Verify the installed Next CLI path before hard-coding it. Same-process invocation avoids wrapper-child signal-forwarding problems and needs no `cross-env` dependency.
3. Keep `NEXT_TELEMETRY_DISABLED=1` in `.env.example` as defense in depth, but make clear it is no longer the guarantee.
4. Add `Environment=NEXT_TELEMETRY_DISABLED=1` to the systemd unit in WP-16.
5. Recheck the launcher path whenever Next is upgraded.

**Tests**

- Use a temporary clean `HOME` with no Next telemetry preference.
- Statically assert that `dev`, `build`, `start`, `dev:lan`, `start:lan`, and the exact WP-16B systemd invocation all load the opt-out before Next initializes.
- Set `NEXT_TELEMETRY_DEBUG=1` and run bounded process smokes for every distinct launcher path under a temporary clean `HOME`/config directory. Verify no telemetry payload is emitted and no machine-global preference is mutated.
- Run a fake build with outbound network denied when the environment permits; distinguish a package/build-time network need from runtime application egress.
- Verify Ctrl-C and SIGTERM stop dev/start without orphaning a process.
- Confirm loopback and LAN scripts retain their exact binding behavior.

**Acceptance criteria**

- Every package script that starts Next sets the opt-out before the CLI initializes.
- No dependency or lockfile change is needed.
- README/CLAUDE claims no longer depend on copying `.env.example`.

**Rollback:** if the internal CLI path changes, temporarily use an explicit platform-appropriate environment setting while correcting the local launcher. Do not silently remove telemetry suppression.

---

### WP-06 — Import parsing correctness

**Delivery stage:** 4, after WP-01B and WP-02A.

Keep the parser/map/atomicity changes in clearly separated review slices, but land the whole file-atomic contract before calling import remediation complete. No slice may change the frozen hash.

**Whole-package contract**

- Preflight the CSV text, date mode, and raw column-map input before resolving/opening the database. Do not use a default parameter such as `db = getDb()` on the preflight entry point because JavaScript evaluates it before the function body.
- Keep BOM support, outer cell trimming, and empty-line skipping. Set `relax_column_count: false` and `relax_quotes: false`: inconsistent columns or malformed quoting are malformed CSV and fail the whole file.
- Any parser/row error produces `invalid-file` with safe row numbers/messages and no insertable rows. There is no partial-success import.
- `date-format-required` and `invalid-column-map` are distinct typed results so callers can focus the correct control.
- Only a `ready` preflight may acquire `getDb()`, read/install defaults, resolve an account, create a CLI account, load categories, compute hashes, create a batch, or write transactions.
- Once persistence begins, account resolution/optional creation, category reads, batch creation, dedupe inserts, and count finalization share one immediate transaction. Expected failures roll back every table.
- UI, API, and CLI map the same typed result; no caller silently drops errors or converts a refusal into `imported: 0` success.

#### WP-06A — Require an explicit format for ambiguous dates

**Current path and defect**

- `parseStatementDate()` in `src/lib/csv/parse-statement.ts` resolves ambiguous separated dates as MDY in `auto` mode.
- `parseStatementCsv()` emits a nonfatal warning and returns insertable rows.
- `importStatement()` inserts valid returned rows transactionally.
- Re-importing after changing the format changes the normalized date and therefore the frozen hash; unless the user first undoes the original batch, both date interpretations can exist.

**Target behavior:** if any separated date in an auto-mode file has two distinct valid MDY/DMY interpretations, the parser/import result requires a format choice. Nothing from the file is inserted and no import batch is recorded.

**Recommended result model**

Replace warning/partial results with a discriminated preflight state equivalent to:

```ts
type ParseStatementResult =
  | {
      status: "ready";
      rows: ParsedStatementRow[];
      warnings: string[];
    }
  | {
      status: "date-format-required";
      ambiguousRowNumbers: number[];
    }
  | {
      status: "invalid-column-map";
      issues: ColumnMapIssue[];
    }
  | {
      status: "invalid-file";
      errors: StatementRowError[];
    };
```

Do not expose raw CSV rows through logs or exceptions. The UI may identify row numbers because the user already supplied the file.

**Implementation steps**

1. Separate “detect possible interpretations” from “choose interpretation.” ISO dates and unambiguous separated dates remain accepted in auto mode.
2. If one or more rows are ambiguous in auto mode, return `date-format-required` for the whole file. If any other row/CSV error exists, return `invalid-file`. Do not return an insertable partial subset. When both occur, return `invalid-file` first so malformed content must be corrected before date interpretation.
3. Make the pure import preflight complete before `getDb()` is evaluated, then check `ready` before categories, hashes, batch ID generation, or a write transaction.
4. Map the state consistently:
   - Web UI: show a persistent error/instruction near the date-format selector and focus it; user chooses MDY or DMY and resubmits.
   - API: use the locked transport mapping: `invalid-column-map` → 400, `invalid-file` → 422, `date-format-required` → 422, unknown account → 404, compatible-target conflict → 409, and ready/success → 200. Every response uses the same stable `{ error: <code>, ...safeDetails }` envelope and `Cache-Control: no-store`; do not expose CSV cell contents.
   - CLI: exit nonzero with `--date-format MDY` / `--date-format DMY` instructions.
5. Keep explicit MDY/DMY deterministic. Never invoke local-time parsing for a ledger date.
6. Explain the historical correction workflow: if a file was imported under the old warning behavior, undo its batch before importing with the corrected format. Do not promise automatic identification of those rows.

**Tests**

- ISO, equal-component dates such as `05/05/2026`, and valid component-over-12 dates import in auto mode; impossible dates such as `31/04/2026` remain errors.
- A file with one ambiguous row and many unambiguous rows inserts zero rows and creates zero batches.
- A file with one valid row plus one bad date/amount/description, inconsistent column count, or malformed quote inserts zero rows and changes no account/category/batch state.
- The same file imports under explicit MDY and DMY with the expected distinct ISO dates.
- The web/API/CLI surfaces all reach the same service state.
- A blocked import leaves accounts, categories, transactions, import batches, splits, and account balance unchanged and does not create/open the default DB.
- Date tests pass under `TZ=UTC` and `TZ=America/Chicago` with identical ledger strings.
- Hash goldens remain unchanged.

**Acceptance criteria**

- There is no warning-only insertion path for ambiguity in auto mode.
- An explicit date choice occurs before hash construction and writes.
- The import UI does not label a blocked file as successfully imported.
- No parser path returns both insertable rows and row errors.

**Rollback:** retain fail-closed service behavior if UI flow needs correction. The temporary fallback is an actionable explicit-format error, not a return to insert-then-warn.

#### WP-06B — Support zero-filled Debit/Credit columns

**Current defect:** the parser treats any two nonblank Debit/Credit cells as “both present,” so common rows such as Debit=`0.00`, Credit=`100.00` are rejected.

**Parsing algorithm**

1. If the canonical Amount column is nonblank, retain its existing precedence and strict parsing.
2. Otherwise parse every nonblank Debit and Credit cell independently. An invalid nonblank value is always a row error; it must not be ignored because the other side is valid.
3. Define an active side as a successfully parsed value not equal to zero.
4. If both sides are active, reject the row.
5. If only Debit is active, `amountCents = -parsedDebit`.
6. If only Credit is active, `amountCents = parsedCredit`.
7. If at least one side is present, no side is active, and every present side parsed successfully to zero, store positive numeric `0`, consistent with a single Amount=`0` row. This covers zero/blank as well as zero/zero and normalizes JavaScript negative zero before hashing/storage.
8. If neither side has a value, retain the missing-amount error.

This preserves existing sign semantics:

- positive debit → negative outflow;
- negative debit → positive refund/inflow;
- positive credit → positive inflow;
- negative credit → negative reversal/outflow.

**Tests**

| Debit | Credit | Expected |
| ---: | ---: | --- |
| `12.34` | `0.00` | `-1234` |
| `0` | `12.34` | `1234` |
| `-12.34` | `0` | `1234` |
| `0` | `-12.34` | `-1234` |
| `0` | `0` | `0` |
| `0` | blank | `0` |
| blank | `0` | `0` |
| `-0.00` / `(0.00)` / `0.00-` | blank | positive numeric `0` |
| `12.34` | `56.78` | row error |
| `garbage` | `12.34` | row error |
| blank | blank | row error |

Also cover currency symbols, parentheses, trailing minus, decimal comma, unsafe integers, and whitespace.

**Acceptance criteria**

- Common zero-filled exports import correctly.
- Invalid text is never converted to zero or ignored.
- No intermediate floating-point cents conversion is introduced.
- Hash compatibility tests pass.

#### WP-06C — Strict column maps and atomic account targeting

**Current defects**

- `/api/import` silently converts malformed JSON, unknown keys, invalid values, and an empty map to `undefined`, falling back to automatic header detection.
- Map values are inserted into a normalized `Map`, so two canonical fields can claim the same source header without a typed conflict.
- UI and CLI header override values have no shared control/length rules.
- The CLI calls `getOrCreateAccountByName()` before CSV preflight, so a bad file can leave an otherwise unused account.

**Locked column-map contract**

1. Accept only a plain JSON object. Allowed canonical keys are exactly `date`, `description`, `amount`, `debit`, and `credit`; any other own key is an error.
2. Every supplied value must be a string. Trim it, require 1–120 Unicode code points, and reject C0/C1 controls (`U+0000`–`U+001F`, `U+007F`–`U+009F`). An explicitly supplied empty value is invalid rather than “not supplied.”
3. Compare values case-insensitively after trimming. Two canonical fields cannot claim the same normalized source header. A mapped source name must match exactly one normalized header in the file; zero or multiple matches is a typed issue.
4. Reject an incoherent amount map: `amount` cannot target the same source header as debit/credit, and a mapped debit/credit pair remains subject to WP-06B. Unmapped automatic detection retains the locked synonym priority from WP-01B.
5. The API parses JSON once and passes the unknown value to the shared validator. Malformed JSON returns `invalid-column-map`; it never falls back. UI and CLI construct the same raw shape and receive the same issues.
6. Do not include raw CSV values in server logs. The local UI/CLI may show safe canonical field names, source header names already supplied by the user, and row numbers.

**Atomic account contract**

1. Represent the target as a discriminated service input: an existing account ID for web/API, or CLI `by-name` data containing bounded name, account type, and normalized currency (default `USD` unless `--currency` is supplied).
2. Complete pure file/map/date preflight first. Only `ready` reaches the database.
3. In the immediate import transaction, resolve an existing ID or look up/create the CLI account, then load categories, compute hashes with the resolved ID, create the batch, and insert rows. A concurrent duplicate name returns a typed expected conflict or reuses the now-existing compatible account; it never leaks a raw constraint error.
4. If a same-name CLI account already exists, require its type/currency to match the explicit CLI values or return a typed conflict. Never silently rewrite an existing account.
5. Unknown web/API account returns the existing 404 mapping from the service transaction. A failed import leaves account/category/batch/transaction/split state unchanged.

**Tests and acceptance criteria**

- Malformed JSON, arrays/null, unknown keys, non-string/empty/overlong/control values, duplicate normalized claims, missing mapped headers, and duplicate file headers all return `invalid-column-map` with zero mutation.
- A valid map continues to override synonyms deterministically; hash goldens remain unchanged for the same normalized rows.
- A malformed or ambiguous file addressed to a new CLI name creates no account and never opens the default DB.
- A ready valid file creates the CLI account and import rows in one transaction; an injected failure after account creation rolls both back.
- Existing compatible CLI account is reused; incompatible type/currency refuses without update.
- Web, API, and CLI expose stable typed outcomes and nonzero/4xx refusal statuses.

**Rollback:** keep strict map validation and preflight-before-account ordering. If one caller's presentation regresses, fix that adapter; do not restore silent fallback or orphan account creation.

---

### WP-07 — Atomic default-category bootstrap

**Delivery stage:** 4.

**Goal:** a fresh database observes either all built-in defaults or none after an insertion failure.

**Current path:** `ensureDefaultCategories()` in `src/db/default-categories.ts` checks `count(*)`, then inserts each definition separately. Startup calls it after migrations when `installDefaults` is enabled.

**Implementation steps**

1. Wrap the empty-table check and all default inserts in one synchronous database transaction.
2. Preserve current semantics:
   - if any category exists before initialization, do nothing;
   - never overwrite an edit;
   - do not run a name-by-name “repair” at every startup.
   - an individually deleted category is not resurrected while at least one category remains.
3. Use the installed Drizzle better-sqlite3 transaction API with `{ behavior: "immediate" }` so the empty-table check and inserts acquire write ownership as one unit. Pin this installed API in a focused test rather than relying on behavior from another Drizzle version.
4. Let any insert failure propagate so startup fails visibly after the transaction rolls back.
5. Document the current all-empty edge case honestly: without persisted initialization state, deleting the final category is indistinguishable from a fresh database, so the next startup reinstalls the full defaults. Preventing that requires either a final-category deletion rule or an additive initialized marker and is a separate decision/migration, not part of the atomicity fix.
6. For a database already left partial by an earlier version, provide only an explicit read-only diagnostic and separately reviewed repair procedure. Do not silently infer missing defaults.

**Tests**

- Empty table produces the complete expected set.
- A SQLite trigger that aborts on the fifth named insert leaves zero categories.
- Removing the injected failure and retrying installs all defaults.
- A nonempty table remains byte/logically unchanged.
- Deleting one default from an otherwise nonempty table does not resurrect it.
- Deleting every category demonstrates and documents the existing reinstall-on-next-start behavior unless a separately approved marker/final-delete policy is implemented.
- If practical, two fake connections initializing concurrently produce one complete set and no partial visibility.

**Acceptance criteria**

- The check and writes share one transaction.
- Failure cannot commit a prefix of defaults.
- No migration is required for the atomicity fix and no partially populated existing table is repaired automatically.

---

### WP-08 — Excluded-category budget consistency

**Delivery stage:** 4, after WP-02A.

**Goal:** a category excluded from spending is absent from budget-vs-actual just as it is absent from category spending, monthly summary, and trends.

**Current path:** `countsTowardSpending()` filters the spending aggregates, but `getBudgetVsActual()` selects every category with a non-null `monthlyBudgetCents` and does not filter `excludeFromSpending`.

**Implementation steps**

1. Update `getBudgetVsActual()` to require both a non-null budget and `excludeFromSpending = false` while retaining its LEFT JOIN behavior for zero-spend budget categories.
2. Preserve the stored budget when exclusion is enabled. Do not clear it in `updateCategory()`.
3. Add concise category-form help: excluded categories do not count as income/spending and do not appear in budget progress; a saved budget returns if the category is included later.
4. Keep existing refund behavior—positive lines do not reduce gross budget spend—until D-12 is resolved.
5. Add a cross-aggregate contract fixture containing:
   - included and excluded unsplit outflows/inflows;
   - included and excluded split parts;
   - uncategorized lines;
   - an excluded category with a budget.

**Tests and acceptance criteria**

- The excluded budget category is absent, not shown with zero actual.
- Re-enabling it restores its previously stored budget and correct split-aware actual.
- Included zero-spend budgets still appear.
- All four aggregate families agree on exclusion.
- Empty tables return existing empty/zero shapes without null/NaN values.

**Rollback:** retain the aggregate exclusion even if explanatory UI copy needs revision. It enforces an existing product contract.

---

### WP-09 — Shared active-category semantics

**Delivery stage:** 5, after WP-02B and the isolation work in WP-01A.

**Goal:** category filters, category statistics, categorization rules, deletion impact, and future category consumers all use the same split-aware definition already used by spending summaries.

**Canonical semantic matrix**

| Transaction state | Active category behavior |
| --- | --- |
| No split rows, parent category X | Matches X only. |
| No split rows, parent category null | Matches “uncategorized.” |
| Split rows X and Y, parent category Z | Matches X and Y; never Z. |
| Split rows X and null, parent category Z | Matches X and “uncategorized”; never Z. |
| Two split rows with category X | Category stats count one transaction, while spending sums both allocations. |

The user-visible category filter means “this transaction contains at least one active allocation in the category.” A transaction may therefore appear in both category X and uncategorized filters if one split part is X and another is null.

**Current drift**

- `buildTransactionWhere()` filters `transactions.categoryId` directly.
- `getCategoriesWithStats()` counts parent category joins.
- `applyRulesToUncategorized()` scans every parent with null `categoryId`, including split transactions whose parent is ignored.
- Category deletion correctly uses `ON DELETE SET NULL` for both parent and split FKs, but its UI count does not describe active split usage.

**Implementation steps**

1. Define reusable parameterized SQL predicates in the service layer:
   - `hasSplits(transactionId)`;
   - active category X = `EXISTS` matching split X, or `NOT EXISTS` splits and parent X;
   - active uncategorized = `EXISTS` null split, or `NOT EXISTS` splits and parent null.
2. Update `buildTransactionWhere()` so list and export filters use those predicates. Preserve `q`, account, month, and inclusive date intersection behavior.
3. Ensure pagination count uses `count(*)` over parent transactions and never duplicates a parent because several split rows match.
4. Update `getCategoriesWithStats()` to count distinct parent transactions that actively use each category. Do not count the ignored parent of a split transaction in that active-usage statistic.
5. Add a separate `CategoryDeletionImpact` service result for destructive confirmation. It must disclose at least:
   - distinct transactions/active split parts whose current categorization becomes null;
   - split transactions whose ignored parent fallback reference will be cleared and therefore cannot return if splits are later removed.
   Deletion still sets matching parent/split references to null and must not delete transactions.
6. Change `applyRulesToUncategorized()` to scan only unsplit transactions with a null parent. Do not auto-assign ignored parent categories on split transactions. Leave null split parts for deliberate manual allocation; keyword matching the whole description does not know how to divide the amount.
7. Preserve split-aware summary logic. If extracting a helper would make its date-range pushdown or UNION query worse, share semantic predicates rather than forcing every consumer through one oversized abstraction.
8. Replace the transactions page's unbounded `parseInt` with explicit safe pagination validation. Accept only `/^[1-9][0-9]*$/` values that convert to a safe integer; invalid values canonically redirect to page 1. Change the service input from caller-computed offset to requested page plus the fixed page size 50. Count first, require a safe non-negative count, clamp an out-of-range requested page to `lastPage = max(1, ceil(count / 50))`, compute/check the offset only from that clamped value, and redirect to the canonical last-page URL when clamping occurred. Never calculate an offset from untrusted text.
9. Examine query plans using a fake local-scale fixture. The existing split index on `transaction_id` supports correlated `EXISTS`. Add a new `(category_id, transaction_id)` index only if measured plans justify it; generate a new additive migration and add populated-upgrade coverage if so.

**Tests**

- Exercise every row in the semantic matrix against list filtering, pagination count, export selection, category stats, deletion confirmation, and apply-rules scan count.
- Verify a split transaction appears once even if two parts match the same category.
- Verify an ignored parent category never matches or increments stats.
- Verify deletion impact separately counts active references and ignored fallback-parent references. Deletion sets the disclosed references null, retains all rows/amounts, and makes affected active parts uncategorized.
- Verify rule application cannot mutate the ignored parent category of a split transaction.
- Verify search wildcards remain escaped and category values remain bound parameters.
- Verify huge digit strings, exponent-like values, negatives, zero, decimals, `Infinity`, and values beyond the safe-integer range canonically reach page 1; a safe but out-of-range page redirects to the computed last page. No untrusted or unclamped value reaches SQLite as an offset.

**Acceptance criteria**

- One semantic fixture drives assertions across all category consumers.
- No direct parent-category predicate remains in a consumer where splits can exist.
- Query performance remains appropriate for a local ledger; any index addition has an append-only migration test.

**Rollback:** do not revert consumers independently and recreate contradictory semantics. If a query plan regresses, optimize the shared predicate or add a measured index while keeping behavior.

---

### WP-10 — Truthful and spreadsheet-safe CSV export

**Delivery stage:** 5, after WP-02A, WP-09, and WP-11.

#### WP-10A — Split-aware ledger export

**Current path:** `getTransactionsForExport()` uses the parent projection and `transactionsToCsv()` writes `Date,Description,Amount,Account,Category`. A split transaction can therefore export the category that the rest of the product explicitly ignores.

**Locked endpoint contracts**

1. Omitted `format`, or `format=legacy`, preserves the existing compatibility header exactly:

   ```text
   Date,Description,Amount,Account,Category
   ```

   Unsplit rows emit their active category or `Uncategorized`; split parents emit the literal `Split` and never the ignored parent category. Because this representation has no currency column, refuse selected rows spanning multiple normalized currencies or any invalid persisted currency with a typed `409` JSON response and `Cache-Control: no-store`. An empty selection emits the header only.

2. `format=detailed` emits exactly:

```text
Date,Description,Amount,Currency,Account,Category,Split Details
```

- Unsplit: its account currency, normal active category, and blank Split Details.
- Split: its account currency, `Category=Split`, and compact deterministic JSON:

  ```json
  [{"category":"Groceries","amountCents":-5000},{"category":null,"amountCents":-2500}]
  ```

   Detailed export permits mixed currencies because every row carries its currency; it still refuses invalid persisted currencies and directs the user to the repair path. Keep one row/full parent Amount so parent ledger totals remain intact. Sort details by binary category name with null last, then amount; omit random IDs. Identical duplicate parts are observably identical.

3. The transactions-page export control uses `?format=detailed`. The compatibility endpoint remains documented for local scripts. An unknown `format` returns typed `400` JSON rather than silently selecting a mode.
4. In both modes a category filter means “the parent transaction contains this active category/allocation”; it exports the complete parent row. A future allocation-level export is a separate RFC/endpoint.

**Implementation steps**

1. Introduce a dedicated export DTO/service rather than overloading the on-screen `TransactionListItem`.
2. Stream a UTF-8 RFC 4180 response in keyset-paginated chunks of 500 parents. Order ascending by `(transactions.date, transactions.createdAt, transactions.id)` and advance with the corresponding lexicographic `>` predicate; ID is the mandatory tie-breaker. Never use offset pagination or materialize all rows/CSV in memory.
3. The export service owns a dedicated read-only `fileMustExist` SQLite connection. Start a deferred read transaction, establish one WAL snapshot, query/stream all chunks, then commit/close on completion; roll back/close on error or stream cancellation. Route code never opens the DB. This prevents concurrent writes from moving a row across keyset boundaries mid-export.
4. Within each parent chunk, fetch all split details in one bounded `IN` query (500 IDs is below SQLite's variable limit), group in memory, and discard the chunk after encoding. There is no N+1 path.
5. Reuse WP-09's active-category predicate and WP-11's currency normalization/state helper. Check the selected currency set inside the same read snapshot before emitting the header so a legacy refusal remains a JSON response rather than a half-written CSV.
6. Use WP-02A's `centsToDecimalText()` for parent Amount. Validate safe integers and keep Amount as signed decimal numeric text; never divide or use `toFixed`.
7. Keep dates as validated date-only strings. Ensure split rows never serialize the ignored parent category.
8. Document exact headers, `format` behavior, 409 repair guidance, filter meaning, deterministic order, and formula protection in README/manual/API comments.

**Tests**

- Unsplit categorized and uncategorized rows.
- Split rows with two categories, a null category, excluded category, duplicate category parts, positive/negative values, commas/quotes/Unicode in names.
- Deterministic output across repeated calls.
- Filter by active split category, ignored parent, and uncategorized.
- Summed exported Amount equals summed selected parent ledger amount.
- Exact decimal serialization at zero, ±1 cent, ordinary values, `±Number.MAX_SAFE_INTEGER`, and `±9007199254740990`; the latter must end in `.90`, never the float-rounded `.91`.
- Legacy: exact five-column header, split marker, empty header-only output, one-currency success, mixed/invalid 409 refusal before bytes stream.
- Detailed: exact seven-column header, Currency on every row, mixed-currency success, invalid-currency refusal, deterministic split JSON.
- More than 500 and more than 1,000 fake rows prove keyset chunk boundaries, stable `(date, createdAt, id)` ties, snapshot behavior during a competing write, bounded split queries, cancellation cleanup, and no N+1 growth.

**Acceptance criteria**

- No exported category contradicts active-category semantics.
- Existing consumers retain the five-column contract; the UI deliberately uses detailed mode.
- The export remains `Cache-Control: no-store`.

#### WP-10B — Formula-safe text fields

**Threat model:** RFC 4180 quoting does not stop spreadsheet applications from interpreting a quoted text cell beginning with `=`, `+`, `-`, or `@` as a formula. Imported descriptions and user-defined account/category names are untrusted text.

**Implementation steps**

1. Keep spreadsheet protection separate from RFC quoting.
2. Before quoting, inspect every textual cell: Description, Currency, Account, Category, and Split Details. JSON Split Details normally starts with `[`, but keeping the serializer contract uniform avoids a future bypass.
3. Prefix a single apostrophe when zero or more leading control/whitespace characters are followed by `=`, `+`, `-`, or `@`. A pure predicate equivalent to `/^[\u0000-\u0020]*[=+\-@]/` is a starting point; confirm behavior with supported spreadsheet programs.
4. Do not sanitize the numeric Amount column. `-12.34` must remain a numeric signed amount.
5. Do not mutate stored values, imported descriptions, normalization, categorization, or hash inputs.
6. Do not add an immediate unsafe query flag. If an exact machine export is later needed, give it a separate warned format/endpoint.

**Tests**

- Every dangerous marker in description/currency/account/category and a synthetic split-detail text cell.
- Leading spaces, tabs, CR, LF, and other control characters before a marker.
- Ordinary minus-containing text not at the start.
- Commas, quotes, CRLF, BOM policy, and Unicode.
- Amount `-12.34` remains numeric and unprefixed.
- Hash goldens remain unchanged.
- Manual smoke in the spreadsheet programs named in the support documentation confirms no fake formula executes.

**Acceptance criteria**

- Text formula payloads are inert by default.
- Stored and hashed data are byte-for-byte unaffected.
- The visible-apostrophe tradeoff is documented for strict CSV consumers.

---

### WP-11 — Currency-truthful aggregates and rendering

**Delivery stage:** 5. The account currency/repair slice lands before aggregate and export slices.

**Goal:** never present incompatible cents as one currency amount.

**Current path and defect**

- `getNetWorthOverview()` returns a scalar sum plus a list of currencies.
- The dashboard always formats net worth, income, spending, budgets, and trend values through `formatCents()`'s default USD.
- A warning appears only when net worth spans multiple currencies. The false scalar remains displayed, and a single EUR ledger is still labeled USD.
- `accounts.currency` already exists with a `USD` default, but create/update service inputs, Server Actions, account forms, and lightweight account APIs do not let the user set or repair it. No migration is needed.

**Target state model**

Use a discriminated result such as:

```ts
type CurrencyState =
  | { kind: "empty" }
  | { kind: "single"; currency: string }
  | { kind: "mixed"; currencies: string[] }
  | { kind: "invalid"; accounts: { id: string; name: string }[] };
```

Combined aggregate service DTOs carry this discriminator and expose numeric aggregate values only in the `single` branch. JSON routes retain their current aggregate field names for compatibility, add `currencyState`, and set every combined financial scalar to `null` in `empty`, `mixed`, or `invalid` states; they never use `0` as a sentinel. UI code switches on the discriminator before reading values.

**Implementation steps**

1. Add one shared `normalizeCurrencyCode(input)` contract: trim, uppercase, require exactly three ASCII letters, and require construction/use of `Intl.NumberFormat("en-US", { style: "currency", currency: code })` not to throw. Return the normalized code or a typed invalid result. This proves runtime renderability, not membership in an authoritative ISO 4217 registry—Node accepts some reserved/user-defined identifiers. Do not claim otherwise and do not add a registry package.
2. Require currency in `CreateAccountInput` and `UpdateAccountInput`; validate again inside the service. Add a labeled three-character field to create/edit forms (`USD` default for create), include it in account actions, the CLI `--currency` option, account option/row DTOs, `/api/accounts`, and any transaction/export DTO that renders account money.
3. Make the account page the repair path. Reads must carry the raw stored currency plus normalized/invalid state without calling a formatter that can throw. For an invalid account, suppress the formatted balance, show an accessible “currency needs repair” state, and keep the edit form usable with the raw value selected for correction. Saving any other account fields still requires a new valid currency; a successful correction re-enables formatting/aggregates. Do not require direct SQL or seed.
4. Run every persisted account currency through the same trim/uppercase validator before aggregation. A supported lowercase/space-padded value is treated in memory as its normalized uppercase code without mutating storage; the edit form presents the normalized value and the next explicit save persists it. Truly invalid values return the `invalid` state and repair link; never crash, log the raw value, silently relabel it USD, or perform an automatic write during a read.
5. Compute the distinct normalized currency set from accounts once for the dashboard request. Require every per-account and combined aggregate result to remain a safe integer; an unsafe sum is an explicit invalid/error state, not a rounded value.
6. Empty ledger: retain the welcome/empty state without inventing a currency total.
7. Single currency:
   - net worth, monthly summary, category spend, budgets, and trend render using that currency;
   - a EUR-only ledger displays EUR, not USD;
   - individual account/API rows include currency.
8. Mixed currency:
   - suppress combined net worth and all cross-account income/spending/trend/budget values and charts;
   - show an explicit explanation that Money Bags does not convert currencies;
   - continue to show per-account balances with each account's currency and navigation to those accounts;
   - return a discriminated JSON state rather than a false scalar from summary/net-worth endpoints.
9. Invalid currency: suppress combined financial rendering and show an actionable local configuration error that identifies affected accounts by safe ID/name and links to their edit controls; do not expose account identity in public health/log output.
10. Do not add exchange-rate storage, remote APIs, or a hard-coded conversion rate.
11. Treat category budgets as currency-ambiguous in mixed mode because the schema has no currency dimension. Do not display them as if globally comparable.
12. Keep integer cents through storage and service calculations. `Intl.NumberFormat` conversion for final rendering remains presentation-only.

**Tests**

- Empty account set.
- USD-only, EUR-only, and two accounts with the same non-USD currency.
- USD+EUR with positive, negative, and zero balances.
- A supported lowercase/space-padded persisted code normalizes in memory to uppercase, renders in that currency, and is persisted only on explicit save; a truly invalid code produces the repair state. Neither path crashes or falls back to USD.
- Create/edit/action/service/API round-trips for USD, EUR, JPY, lowercase input, nonletters, wrong length, an `Intl`-rejected identifier, and a renderable reserved identifier (documenting the renderability—not registry—contract).
- An invalid persisted value does not crash the account page; its edit flow repairs it without SQL, and all combined summaries remain unavailable until repair.
- Individually safe balances whose sum would exceed `Number.MAX_SAFE_INTEGER` produce an explicit invalid/error state and no aggregate scalar.
- Mixed accounts where only one has transactions: combined dashboard remains mixed because net worth and category budgets span the installation.
- API shapes contain a discriminator and no misleading mixed scalar.
- Charts/budgets are absent with accessible explanatory text in mixed mode.
- Formatting has correct symbols/currency codes and no `NaN`/negative-zero surprises.

**Acceptance criteria**

- No screen or API calls a USD+EUR arithmetic sum “net worth,” “income,” “spending,” “actual,” or “trend.”
- One non-USD currency is consistently formatted correctly.
- Account create/edit and the repair path make currency configurable end to end; there is no schema migration.
- No network access or new dependency is introduced.

**Rollback:** if a consumer is not ready for the new DTO, add an adapter that preserves the discriminator. Do not restore a false mixed scalar for compatibility.

---

### WP-12 — Database path, environment, and Git privacy contract

**Delivery stage:** 2. WP-12A precedes WP-01D and every later package that may open SQLite.

**Goal:** make every runtime/operational entry point resolve the same explicit database, keep in-repository data ignored, and fail closed on environment errors.

**Current path and risk**

- `resolveDbPath()` in `src/db/client.ts` accepts any relative path from `process.cwd()`.
- `drizzle.config.ts`, runtime, seed, CLI import, and backup load/resolve configuration through partially duplicated paths.
- several `process.loadEnvFile()` calls catch every error, so permission or parse failures can silently fall back to a different/default database.
- `.gitignore` protects `data/*.db*`, `data/backups/`, and `data/imports/`, but a custom in-repository path or extension can escape those patterns.
- Restore docs assume the default path.
- `createDb()` currently calls `mkdirSync()` and `new Database(file)` before `resolveMigrationsFolder()`. A bad working directory/missing migration journal can therefore leave a directory or empty SQLite artifact even though startup fails.

**Target path policy**

- Default remains `<repo>/data/finance.db`.
- A relative `DB_FILE_NAME` resolves from a stable repository root, not an arbitrary invocation directory.
- Every relative target must resolve lexically and canonically under `<repo>/data/`; `finance.db`, `../outside.db`, and `custom/finance.db` are rejected.
- An explicit absolute path outside the repository is allowed and becomes the operator's backup/permission responsibility.
- An absolute path that resolves inside the repository but outside `data/` is rejected.
- No existing configured file is silently moved, renamed, copied, or replaced.
- A legacy external target remains usable when configured as its canonical absolute path. A legacy in-repository target outside `data/` requires a documented stopped-service, validated-backup, explicit move; startup never guesses or performs that move.

#### WP-12A — Resolver and environment foundation

This slice is a prerequisite for safe tests/builds, seed, import, backup, and runtime work. All checks below complete before any directory creation, SQLite open, migration, default installation, or other data mutation.

**Implementation steps**

1. Extract a side-effect-free Node helper, such as `src/db/path.ts`, that:
   - derives the repository root from a stable module/config location;
   - resolves default, relative, and absolute targets;
   - classifies both lexical and canonical location relative to the repository and `data/`;
   - rejects an empty/NUL-containing target, traversal or canonical escape, target symlink/non-regular existing target, symlink loop, dangling/ambiguous parent, and any in-repository location outside `data/`;
   - does not import `src/db/client.ts`, open SQLite, create directories, or run migrations.
2. Add a strict environment loader. Suppress only the expected missing `.env` (`ENOENT`). Permission, encoding, parse, and other failures throw before resolving/opening a database. Never print environment contents.
3. Add a side-effect-free migration-asset preflight fixed to `<repo>/drizzle`:
   - parse `meta/_journal.json` and validate ordered unique entries;
   - require every journal-referenced SQL file to be a readable regular file below the migration root;
   - validate the committed `0000`–`0004` hashes against WP-01C's literal manifest and allow only append-only later entries represented by reviewed test metadata;
   - reject traversal, missing files, malformed journal fields, duplicates, or changed historical bytes.
4. Compose `preflightDatabaseOpen()` in this exact order: strict environment load, stable-root/path resolution, lexical/canonical path policy, migration-asset validation. It returns immutable normalized paths/config only. `createDb()` may create a private parent and open SQLite only after it succeeds.
5. Use the same helper/preflight from runtime, Drizzle config, seed/import/backup/verification tooling wherever relevant. Drizzle config may use a tiny adapter, but contract-test identical root/target/migration results. A pure CSV preflight in WP-06 still occurs before this DB preflight.

**WP-12A acceptance**

- Runtime, migration, import, seed, backup, and future restore adapters resolve the same fake target from any working directory.
- Path calculation has no DB/filesystem mutation side effects.
- Any env, path, journal, SQL-asset, or frozen-checksum failure exits before `mkdir`, SQLite open, WAL/SHM creation, migration, or default-category installation and leaves no filesystem artifact.
- WP-03 can require a current target without importing the auto-migrating client.

#### WP-12B — Path policy, Git boundary, and audit

**Implementation steps**

1. Change Git rules to protect the full data boundary while retaining fake samples, conceptually:

   ```gitignore
   data/**
   !data/samples/
   !data/samples/**
   ```

   Validate re-inclusion with `git check-ignore`; do not untrack committed fake samples.
2. Add a read-only `audit:data-path` command that reports:
   - normalized resolved target;
   - inside/outside repository classification;
   - whether an in-repository target is under `data/` and Git-ignored;
   - parent/file POSIX modes when available;
   - actionable pass/fail/remediation without querying tables or printing secrets.
3. Update backup and restore documentation to use the resolver's target and explicitly configured backup location.
4. Keep migration resolution independent and fixed to `<repo>/drizzle`; never derive migrations from the data path.
5. Resolve symlinks without opening the target database:
   - classify the lexical path;
   - find and canonicalize the nearest existing ancestor, then append the not-yet-created suffix;
   - fail closed on loops, dangling/ambiguous parents, or lookup errors;
   - reject a relative target whose canonical parent escapes `data/`;
   - treat an absolute target canonically entering the repository as in-repository and apply the same outside-`data/` policy;
   - reject the final target itself when it is a symlink; operators configure the canonical regular file path directly.
   Operators who intentionally mount/symlink data elsewhere should configure the canonical absolute path explicitly rather than relying on a relative escape.

**Tests**

- Default path from repository root and a different working directory resolves identically.
- `data/finance.db`, `data/finance.sqlite`, `data/custom/name.sqlite3`, WAL/SHM, imports, and backups are ignored.
- `data/samples/**` remains trackable.
- Relative `finance.db`, `../outside.db`, and `custom/finance.db` fail before filesystem mutation.
- Absolute external temp path passes.
- Symlink-out, symlink-in, traversal, dangling-parent, and loop cases exercise both lexical and nearest-existing-ancestor canonical classification and fail closed as defined above.
- A non-ENOENT env error, missing/malformed journal, missing/replaced SQL, or altered frozen migration exits nonzero and does not create a parent/default database.
- runtime, migration, import, seed, backup, and restore adapters resolve the same fake target.

**Acceptance criteria**

- Both lexical and canonical classification enforce the same privacy boundary without opening the DB.
- An environment failure cannot silently select another ledger.
- In-repository runtime data is ignored regardless of common SQLite extension/suffix.
- Existing external custom paths work through an explicit canonical absolute value; unsafe in-repository paths receive a documented manual move procedure and are never auto-moved.

**Rollback:** do not revert strict environment/migration preflight or allow an unsafe fallback target. If enforcement blocks an existing ledger, stop before startup, preserve the original file, and either configure its canonical external absolute path or follow the validated offline move procedure. Never create a replacement empty default by accident.

---

### WP-13 — Private storage, validated backup, and safe restore documentation

**Delivery stage:** 7, after WP-12B; automated restore remains outside this stage.

Private storage, validated backup publication, and a correct manual restore runbook are required remediation. Automated restore is a new destructive feature and is deferred as RFC-06 unless separately approved.

#### WP-13A — Private modes and validated backups

**Current path:** `src/db/client.ts` creates parent directories with default mode and SQLite files under process umask; `scripts/backup-db.ts` similarly creates backup directories/files. With umask `022`, local artifacts can be directory `0755` and file `0644`.

**Implementation steps**

1. Set `UMask=0077` in both systemd service definitions. This protects DB, WAL, SHM, temporary backup files, and future process-created artifacts.
2. For application/CLI processes that can create runtime data, call `process.umask(0o077)` before opening a new SQLite file and retain it for that process. Document the process-global effect. Programmatic enforcement complements, not replaces, systemd UMask.
3. Create new runtime and backup directories with mode `0700` and new DB/final backup files with `0600` on POSIX.
4. Do not silently chmod arbitrary existing trees during normal startup. Extend the read-only audit command with exact remediation instructions. An explicitly invoked permission-repair command would require separate authorization.
5. Harden backup creation:
   - create `<final-base>.<randomUUID>.partial` exclusively in the destination directory using `node:crypto`'s `randomUUID()` and reject symlink/collision cases;
   - use better-sqlite3's online backup API;
   - apply `0600`;
   - close it, reopen read-only with `fileMustExist`, and run `PRAGMA quick_check` and `PRAGMA foreign_key_check`;
   - fsync the file, name the final image `moneybags-<UTC-YYYYMMDDTHHMMSSmmmZ>-<randomUUID>.sqlite3`, and publish with no-clobber semantics;
   - fsync the containing directory on supported POSIX systems after rename;
   - only after durable publication prune retention.
6. Distinguish incomplete copy failure from logical validation failure:
   - remove only an unambiguous incomplete partial created by this run;
   - retain a complete image that fails integrity/FK validation by atomically renaming that run's partial to the same UUID-bearing basename with `.invalid`. It is not a valid rollback artifact, but may be the only capture of a damaged source and must never enter normal retention/restore selection.
7. On Windows, skip POSIX numeric-mode enforcement explicitly and document that Windows ACL verification is outside this implementation. Do not report false security from `chmod` no-ops.
8. Never overwrite a validated backup. The millisecond UTC stamp plus UUID keeps concurrent/fixed-clock runs distinct; exclusive creation/no-clobber publication remains the authoritative collision defense.
9. Add a read-only backup verification command for manual restore preparation. It accepts an explicit regular standalone backup path, opens with `fileMustExist`, checks integrity and foreign keys, and accepts only an exact current migration-journal state or an exact ordered prefix represented by the committed populated historical fixtures. It rejects unknown, divergent, or newer revisions and prints only status/schema revision—never ledger rows.

**Tests**

- Under umask `022`, fake app startup still creates new DB/WAL/SHM as `0600` and directories as `0700` on POSIX.
- Backup directory/file modes are private.
- A valid fake WAL-mode DB backs up while another connection is open and passes integrity checks.
- Injected backup or validation failure produces no final file and does not prune the previous valid backup.
- A complete but logically invalid image is retained privately as quarantined; an incomplete copy is cleaned up.
- Retention keeps the newest N validated final files and ignores partial/unrelated files.
- Two concurrent/fixed-clock runs, preexisting names, and symlink targets cannot overwrite a backup.
- Failure after rename but before directory fsync is injected and reported; retention does not run before durable publication.
- The read-only verifier accepts current/supported historical fake backups and rejects live-target, unrelated, newer-schema, corrupt, symlink, and partial/quarantined inputs.
- Both units pass `systemd-analyze verify` when the tool exists; otherwise record the environment limitation.

**Acceptance criteria**

- Future WAL/SHM recreation remains private because the process/service umask is private.
- Backup success means the image passed integrity checks, not merely that bytes were copied.
- Logs contain paths/counts/status, never ledger rows.

**Rollback:** if private modes break an undocumented group-shared workflow, stop and obtain an explicit product/operations decision. The single-user privacy contract takes precedence over silently restoring world-readable modes.

#### RFC-06 preview — Path-aware guarded automated restore (deferred)

This preview records safety requirements so a later design does not repeat the audit's hazards. It is not required for remediation completion. Prerequisites are WP-12B and WP-13A, explicit approval of D-16, a fake failure-injection harness, and independent review.

**Immediate documentation fix before code**

The manual procedure must say:

1. identify the resolved target;
2. validate the selected standalone backup with the read-only verifier (integrity, foreign keys, and schema compatibility);
3. stop the application/service;
4. make a WAL-safe rescue backup of the current target;
5. require the selected source to be a standalone validated backup image, not a live WAL-mode main file;
6. after a validated rescue and confirmed stop, quarantine only that target's stale `-wal`/`-shm` immediately before replacing the exact main target; delete the quarantine only after restored validation succeeds;
7. run integrity and foreign-key checks before allowing application startup/migrations;
8. pair a pre-update database backup with the prior code revision.

**Recommended script contract**

`scripts/restore-db.ts --from <backup>` should:

1. load environment fail-closed and resolve the target through the shared path helper without importing the auto-migrating client;
2. require an explicit typed confirmation that names the target, unless a separately reviewed noninteractive flag is needed for automation;
3. reject source=target, missing/non-regular source, a source inside an unsafe partial location, and ambiguous symlink targets;
4. accept only a verified standalone backup image. If a live WAL-mode source must ever be supported, first snapshot it through better-sqlite3's online backup API; never validate with its WAL and then copy only the main file;
5. open the standalone image read-only and require `quick_check`, `foreign_key_check`, and an expected Drizzle schema/journal compatibility check. Reject unrelated/newer schemas; classify older supported revisions for later migration before touching the target;
6. require an enforceable service-inactive/whole-operation coordination mechanism, not merely a successful writer lock. A lock is helpful evidence but does not prove another process cannot retain the old inode. Persist a private restore-in-progress marker that startup/preflight honors so a crash cannot restart against an intermediate main/sidecar state;
7. create and validate a WAL-safe pre-restore rescue backup of the current target;
8. copy the selected backup to an exclusive temporary file in the target directory, apply private mode, close/reopen with `fileMustExist`, validate, and fsync it;
9. with service quiescence and the durable in-progress marker held, rename the target's own WAL/SHM to unique quarantine names immediately before the main-file swap, rename with no-clobber/rollback handling, then fsync the containing directory. This ordering prevents a restored main file from being opened with stale target sidecars;
10. reopen the restored main file without application migrations and rerun integrity/foreign-key/schema checks. Only after success may the sidecar quarantine and in-progress marker be removed and the directory fsynced again;
11. print target, selected backup, rescue artifact, and status—never table contents.

**Failure and rollback model**

- Before rename, failure leaves the original target untouched.
- After rename but before final validation, stop; do not start the app. Atomically restore the validated rescue artifact.
- If the restored DB requires an older application schema, return to the recorded prior code revision and its paired backup.
- Never copy only the live main DB while its service is running in WAL mode.

**Tests—all fake**

- Default and external custom target restore.
- Corrupt backup rejected before target mutation.
- Live WAL-mode/unrelated/newer-schema sources are rejected; supported older standalone backups are classified without migration.
- Source=target and non-regular source rejected.
- Simulated copy, fsync, chmod, rename, and post-validation failures leave/recover the correct target.
- Running/locked target refused.
- A competing writer attempting access throughout preparation, sidecar quarantine, swap, and final validation cannot enter the coordinated critical section.
- Rescue backup restores the original sentinel state.
- Only the correct target WAL/SHM files are removed.
- Resulting directory/file modes are private.
- Old populated migration fixture restores, validates, and is migrated only in a separate subsequent startup test.

**Acceptance criteria**

- The original target or a validated rescue exists at every failure point.
- No restore code imports `getDb()` or auto-migrates before validation.
- Real restore execution remains an explicit operator action outside automated tests.

---

### WP-14 — Browser mutation and response boundary

**Delivery stage:** 6, after strict configuration and domain/import contracts exist.

#### WP-14A — Origin policy and anti-framing

**Current path:** Server Actions configure allowed proxy origins in `next.config.ts`, but `POST /api/import` is an independent route that calls `request.formData()` without checking Origin. No global `frame-ancestors`/X-Frame-Options policy prevents clickjacking.

**Required framework research:** read installed Next 16.2.10 documentation for `headers()`, route request handling, and `serverActions.allowedOrigins`, plus the installed `action-handler.js`/CSRF matcher before implementation. Current installed behavior parses `new URL(Origin).host` (scheme discarded, port retained), may reject/throw on malformed values before invoking application code, permits a missing Origin with a warning, and decodes Server Action arguments before the exported function's first line. Next's framework check is necessary defense in depth but not the complete application policy.

**Origin policy**

For `/api/import`, evaluate Origin before content-length/content-type inspection, body decoding, DB access, or body reads. For Server Actions, the guard is the first **application-controlled** operation, before application argument parsing, service calls, or DB mutation; do not claim it runs before Next's own Origin handling or action-argument decoding. Accepted browser origins are:

- exact same origin, including development port;
- exact configured HTTPS Tailscale/custom deployment origins from `EXTRA_ALLOWED_ORIGINS`.

`EXTRA_ALLOWED_ORIGINS` is a comma-separated list of complete URLs, not host globs. Each entry must be an exact `https://` origin with no credentials, path other than `/`, query, fragment, wildcard, or trailing-dot hostname; normalize hostname case and default port. Invalid configuration fails config evaluation. Reject malformed origins, `Origin: null`, missing Origin, arbitrary nonempty origins, HTTP configured origins, suffix confusion, and every unlisted `*.ts.net` host. The CLI calls services directly and is unaffected.

**Implementation steps**

1. Create one config-safe pure parser plus a server-only runtime matcher. Runtime comparison uses normalized full `URL.origin` (scheme, host, and port). Route same-origin uses `new URL(request.url).origin`; configured HTTPS origins match exactly. For actions, derive the direct origin from Host plus the documented direct HTTP protocol, or from `X-Forwarded-Host`/`X-Forwarded-Proto` only when the service is loopback-bound behind the documented trusted proxy; configured public origins still match exactly. Test this deployment assumption explicitly.
2. Remove unconditional `*.ts.net`. Map each validated configured URL to its exact `.host` (port retained) for `experimental.serverActions.allowedOrigins`; never pass a full URL or wildcard. Treat this framework allowlist as the build-time coarse check.
3. Add `assertTrustedActionOrigin()` as the first awaited application operation in every exported Server Action before inspecting decoded arguments, parsing FormData values, or calling a service. For requests Next passes through, it rejects missing/unlisted/scheme-mismatched Origin with a stable generic typed result/error. Malformed or `null` Origin may be rejected by Next before the guard; in either case no application service/DB work may occur. Centralize a wrapper only if it preserves Next's required action exports and types.
4. Call the same runtime policy at the first line of import `POST`, before `Content-Length`, content type, body access, file access, account lookup, or DB initialization. Return generic no-store 403 JSON.
5. Origin configuration is serialized/read through Next configuration. Document and test that changing `EXTRA_ALLOWED_ORIGINS` requires a new production build and restart/deployment; a restart of an old build is insufficient.
6. Add global response configuration:
   - `Content-Security-Policy: frame-ancestors 'none'`;
   - `X-Frame-Options: DENY`;
   - `X-Content-Type-Options: nosniff`;
   - `Referrer-Policy: no-referrer`;
   - `poweredByHeader: false`.
   Keep CSP limited to frame denial in this package; do not improvise a script/style CSP without a nonce/hash design.
7. Do not add permissive CORS headers and do not treat CORS as CSRF prevention.

**Tests**

- Loopback same-origin upload succeeds with the exact port.
- Every exact configured HTTPS Tailscale/custom origin succeeds; changing the list without rebuilding does not change the built allowlist.
- An unrelated but syntactically valid `https://host.other-tailnet.ts.net`, wildcard/suffix, arbitrary/malformed/suffix-confusion/HTTP remote origins, a scheme downgrade for the same host, `null`, and missing Origin are refused by Next or the application guard with zero service/DB mutation. The import route returns its generic 403 itself.
- A rejected request with a large/throwing body proves the body was not read.
- Every Server Action passes the first-application-operation guard matrix; framework-level malformed/null cases and guard-level missing/unlisted/scheme cases all prove zero service/DB mutation. Actions still work through loopback, exact Tailscale, and configured proxy paths.
- Spoofed forwarded host/proto is rejected outside the explicitly documented loopback proxy deployment.
- Browser iframe embedding fails for loopback and Tailscale URLs.
- All responses carry frame denial, `nosniff`, and `no-referrer`; `x-powered-by` is absent.
- Default and explicit LAN binding behavior remains unchanged; no authentication is implied.

**Acceptance criteria**

- Every browser-accessible mutation surface has Next's coarse Server Action protection plus the first-operation application guard, or the import route's explicit Origin-first policy.
- Import rejection occurs before body parsing and DB access.
- Framing is denied globally.

**Rollback:** if a documented proxy breaks, correct only host normalization/allowlist configuration while retaining body-before-origin ordering and framing protection.

#### WP-14B — No-store JSON and honest upload resource bounds

**Delivery stage:** 6, after WP-14A and the WP-06 import contract.

**No-store implementation**

1. Add a small response helper or consistent headers for every financial JSON response, including success and error paths, from:
   - `/api/accounts`;
   - `/api/transactions`;
   - `/api/summary/spending`;
   - `/api/summary/net-worth`;
   - `/api/import`;
   - `/api/health` for freshness.
2. Preserve `Cache-Control: no-store` on every CSV and JSON response from `/api/export`, including typed legacy mixed/invalid-currency refusals.
3. Keep routes dynamically evaluated where needed. HTTP `no-store` complements, rather than substitutes for, Next server-cache semantics.
4. Add no permissive ACAO header.

**Upload bounds**

1. Define these byte constants without adding a multipart dependency:
   - `MAX_FILE_BYTES = 5 * 1024 * 1024` (5,242,880 bytes);
   - `MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024` (65,536 bytes);
   - `MAX_MULTIPART_BYTES = 5_308_416` bytes.
   The total cap bounds the entire request, including all form fields and multipart framing; the file cap remains authoritative for the CSV value.
2. Run WP-14A's trusted-Origin check before inspecting `Content-Length`, content type, or body.
3. After Origin succeeds, accept an absent `Content-Length` because HTTP/2 and chunked requests need not provide it. If present, require an ASCII base-10, non-negative safe integer with no sign or whitespace: malformed/negative/unsafe values return generic no-store 400, and values greater than `MAX_MULTIPART_BYTES` return no-store 413 before any body read. A declared in-range length is only an early hint, never the enforcement boundary.
4. Require `multipart/form-data` with a syntactically usable boundary before reading. Return generic no-store 415 for the wrong media type and 400 for malformed multipart metadata.
5. Read `request.body` through its stream reader while maintaining an actual byte counter. Accumulate only while the total is at most `MAX_MULTIPART_BYTES`; as soon as the next chunk would cross the cap, cancel the reader best-effort, release it in `finally`, discard accumulated chunks, and return generic no-store 413. This stream counter is authoritative for absent, chunked, and deliberately understated lengths.
6. Only after a complete in-limit read, construct a new in-memory `Request` from the bounded bytes and copied safe headers. Remove `transfer-encoding`, replace `content-length` with the actual byte length, and invoke `boundedRequest.formData()` exactly once. Never invoke `formData()` on the original network request. Malformed multipart parsing returns generic no-store 400 and releases references to the byte buffers.
7. Require exactly one expected file field and reject unexpected duplicate file fields. Retain the authoritative `File.size <= MAX_FILE_BYTES` check after parsing. An exact 5 MiB file succeeds only when its complete multipart body also fits within the explicit 64 KiB overhead budget; a file one byte larger always returns 413.
8. Normalize the untrusted display filename to its final basename under both `/` and `\\`, then NFC. Require 1–255 Unicode code points, reject `.`/`..` and C0/C1 controls (including NUL), and apply the same service validator to UI and CLI filenames. The value is metadata and is never used as a filesystem destination.
9. On unexpected errors, log only a stable operation/error code; never CSV content, form fields, account IDs, filenames, request headers, or a full error likely to reveal sensitive paths in production.

**Tests**

- All financial JSON and health responses include `Cache-Control: no-store` in a production build.
- Mutate fake data and verify a subsequent response is current.
- An exact 5 MiB file with at most 64 KiB total multipart overhead succeeds; one byte over the file limit and one byte over the total cap each fail with 413.
- Declared oversized requests fail before reading, while absent, chunked, and deliberately understated lengths are stopped by the measured stream cap.
- Malformed, signed, whitespace-containing, negative, and unsafe-integer `Content-Length` values return 400 without a body read.
- A throwing or over-limit stream proves reader cancellation/release and buffer cleanup. Test that only the reconstructed bounded request reaches `formData()`.
- Additional fields that consume more than the 64 KiB overhead allowance fail even when the CSV itself is under 5 MiB.
- Overlong/control-containing filenames reject without a DB write; normal Unicode names round-trip safely in the local UI.
- Malformed multipart yields generic JSON without stack/data leakage.

**Acceptance criteria**

- Transport and file limits no longer conflict for an exact-limit valid file.
- Missing or dishonest length metadata cannot cause the route to buffer more than the explicit total cap before multipart parsing.
- No response/cache hardening changes financial calculations or route data shapes except the separately planned currency discriminator.

**Rollback:** retain the Origin-first order, authoritative streaming cap, and file-size check. If the 64 KiB compatibility allowance proves too small for a documented client, change only that named constant with a boundary regression test; never fall back to parsing the unbounded network request.

#### WP-14C — Root-layout mutation revalidation

**Delivery stage:** 6, after Server Action and import result contracts are stable.

1. Replace the hard-coded page list in `src/server/actions/shared.ts` and the separate import-route page calls with one shared success-path helper that calls `revalidatePath("/", "layout")`.
2. Invoke it only after a mutation commits successfully. Validation failures, expected conflicts, rejected origins, malformed imports, and no-op results must not claim a successful revalidation.
3. Preserve client `router.refresh()` only where it is still needed to reflect a completed action in the current client tree; do not use it as a substitute for server-cache invalidation.
4. Verify this installed-version contract against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`: a root layout invalidation covers all nested layouts and pages and invalidates client cache on the next visit. Do not substitute a path-only `revalidatePath("/")` call.

**Tests and acceptance**

- Successful account, category, transaction, split, rule, import, and relevant settings mutations invoke the root-layout form once after commit.
- Failure/no-op paths invoke it zero times.
- Browser verification visits dashboard, accounts, transactions, categories, budgets, rules, and import after representative mutations and observes current data without maintaining a page-name allowlist.
- A repository search finds no residual hard-coded revalidation page array or route-local list.

**Rollback:** if installed Next behavior regresses, restore only a centrally tested fallback list and open an upstream/version follow-up; do not scatter route-specific invalidation calls again.

---

### WP-15 — Restore and enforce the services-only DB boundary

**Delivery stage:** 6, after WP-06 and WP-14 response/origin contracts are stable.

**Goal:** make documented architecture mechanically true without changing route behavior.

**Current drift**

- `src/app/api/import/route.ts` imports `getDb`, schema, and Drizzle to verify an account.
- `src/app/api/health/route.ts` imports `getDb` and a SQL fragment directly.
- Other API routes already call services.

**Implementation steps**

1. Move account-existence validation into `importStatement()` and represent an unknown account as a typed service outcome. Recheck inside the same immediate import write transaction that creates the batch/rows so the route cannot introduce a check/use race. UI/API/CLI callers map the same outcome; the route must not perform a separate DB lookup.
2. Keep filename validation in the import service contract as specified by WP-14B, even when a CLI supplies the value.
3. Add `checkDatabaseHealth(db = getDb())` in a narrow health service. It performs only a parameterized/Drizzle `select 1` and returns/throws a minimal status.
4. Preserve WP-06's locked import mapping exactly: invalid column map 400, invalid file 422, explicit date format required 422, unknown account 404, compatible-target conflict 409, and success 200. Preserve WP-14B no-store headers on every branch.
5. Add scoped ESLint `no-restricted-imports` rules for `src/app/**/*`, `src/components/**/*`, and `src/server/actions/**/*` prohibiting `@/db/*` and direct Drizzle query imports.
6. Explicitly exempt services, `src/db/**/*`, tests, and operational scripts with documented connection ownership. Do not disable the rule globally because a type import is inconvenient; narrow the pattern correctly.
7. Add a repository search to the release gate:

   ```bash
   rg -n 'from "@/db/|from "drizzle-orm' src/app src/components src/server/actions
   ```

   Expected matches should be zero unless a narrowly documented type-only exception is approved.

**Tests**

- Import unknown account remains 404; invalid maps remain 400; malformed files and ambiguous dates remain 422; compatible-target conflicts remain 409; healthy import behavior is unchanged.
- Deleting the fake account between parsing and import cannot create a batch or surface a raw FK error.
- Health returns 200/`{ok:true}` and failure returns generic 500/`{ok:false}` without details.
- A temporary lint fixture/direct forbidden import makes ESLint fail.
- Services accept an injected fake DB.

**Acceptance criteria**

- Route handlers contain HTTP concerns only.
- The boundary is enforced for future code.
- No behavior/migration/dependency change is mixed into the refactor.

---

### WP-16 — Reproducible systemd runtime and operational preflight

**Delivery stage:** 7. WP-16A lands first within this stage; WP-16B then waits for WP-05, WP-13A, and WP-16A.

**Goal:** make service startup use the same verified Node installation as install/build/backup and preserve loopback/privacy guarantees after reboot.

**Current drift:** `package.json` requires Node `>=20.12` and `.nvmrc` pins a version, but units call `/usr/bin/npm`; systemd does not initialize NVM.

#### WP-16A — Correct the runtime portability defect

Keep this first diff narrow so the confirmed NVM/systemd contradiction is not blocked on broader hardening.

1. The operator selects either a system-wide or NVM-managed Node during installation. The documented installer step resolves that selected `node` to a stable absolute executable, runs its version check, and substitutes it into an obvious `@@NODE_EXECUTABLE@@` token in every unit. An unresolved token is a validation failure.
2. Do not retain `/usr/bin/npm` in the templates. For NVM, point the token at an operator-maintained stable absolute symlink (updated deliberately after a verified upgrade), not an interactive shell function or version-directory path that silently disappears.
3. Require install, build, app, and backup commands to report/use the same Node major/runtime. Re-run substitution and all unit checks on every Node upgrade.

**WP-16A validation**

- `systemd-analyze verify` passes after substituting a fake/real verified absolute path as appropriate.
- The exact unit executable reports Node `>=20.12` without an interactive shell.
- README unit installation instructions cannot be followed with an unresolved placeholder or an invisible NVM assumption.

#### WP-16B — Direct launcher, privacy, and service hardening

After WP-05 and WP-13A:

1. Use direct Node invocation of the local Next CLI/preload for the long-running service rather than putting npm between systemd and the server.
2. Invoke backup tooling directly through the same absolute Node executable and the verified local `tsx` CLI path. Do not retain npm as a unit process intermediary.

**Unit changes**

- explicit `WorkingDirectory` and service user;
- explicit verified Node/CLI path;
- `Environment=NODE_ENV=production`;
- `Environment=NEXT_TELEMETRY_DISABLED=1`;
- `UMask=0077`;
- loopback host/port preserved in the direct start command;
- `NoNewPrivileges=true`, validated in the fake service smoke before unit installation;
- preflight for Node version, `.next` build, WP-12's complete migration-asset policy, configured DB parent, and writable required paths.

Do not add `ProtectSystem`/`ReadWritePaths` in this selected package without first tracing actual production-mode writes and designing the exact DB/WAL/SHM, backup, build, and cache paths. Record that as a separately reviewed hardening follow-up; the selected baseline is the explicit user/runtime, direct launcher, loopback bind, private umask, telemetry suppression, and `NoNewPrivileges` above.

**Tests/operations validation**

- `systemd-analyze verify` for app, backup, and timer units.
- The exact unit executable reports a satisfying Node version as the service user.
- Start succeeds after reboot without an interactive shell/NVM initialization.
- SIGTERM stops cleanly and restart policy behaves as documented.
- `ss` shows only `127.0.0.1:3100` for default production service.
- Backup timer uses the same runtime and creates a validated private fake backup.
- An intentionally wrong Node or missing build fails preflight with an actionable journal message.

**Acceptance criteria**

- README install commands and unit files describe the same runtime choice.
- Unit templates contain obvious placeholders or installation substitution instructions rather than silently assuming `/usr/bin/npm`.
- WP-16A can land independently; direct launch, UMask, telemetry, and sandbox hardening land only after their prerequisites.
- No `sudo`, service install, enable, or deployment is performed by an implementation session unless the user separately authorizes that exact operation.

**Rollback:** use the previously recorded verified Node path. Do not rely on a shell profile or unbounded `/usr/bin/env` search as an emergency fix.

---

### WP-17 — Shared accessibility and destructive-action contracts

**Delivery stage:** 7, after shared action/result behavior is stable.

**Goal:** correct shared primitives so errors, confirmations, navigation state, and compact split controls work with keyboard, touch, and assistive technology.

**Current evidence**

- `FormError` in `src/components/ui/form.tsx` has visual glyph/text but no live-region role or field relationship.
- `ConfirmButton` in `src/components/ui/confirm-button.tsx` keeps full consequence context in an optional `title`, does not move/restore focus, and does not support Escape.
- `Sidebar` and `MobileNav` visually mark the active route but omit `aria-current="page"`; mobile toggle lacks `aria-controls`.
- Some compact `SplitEditor` controls do not consistently meet the 44×44 target or distinguish repeated part indices in accessible names.
- Account deletion's typed confirmation needs an explicit label relationship and visible consequence.

**Implementation steps**

1. Extend the form-error contract:
   - stable ID;
   - `role="alert"` for submitted errors or an appropriate polite live region for nonurgent status;
   - `aria-invalid` and `aria-describedby` on a known failing field;
   - focus a `tabIndex={-1}` form summary only on the transition from submitted/pending to failure, not every render.
2. Strengthen `ConfirmButton`:
   - require visible consequence/prompt text for destructive callers; `title` may supplement, never replace it;
   - keep refs to trigger and Confirm;
   - focus Confirm when armed;
   - Escape/Cancel disarms and restores trigger focus;
   - a failed async operation stays actionable and announces its error;
   - after success, move focus to a sensible surviving control/row supplied by the caller; falling to `document.body` after removing the trigger is not acceptable.
3. Review every call site—transaction/category/account delete and import undo—and require each to provide a surviving post-success focus destination. State what is deleted, whether splits/import edits are included, and what remains.
4. Add `aria-current="page"` to active desktop/mobile links. Add a stable menu ID plus `aria-controls` to the mobile toggle; Escape must close it and restore focus to the toggle.
5. Give split add/remove/clear controls at least 44×44 CSS pixels. Include the one-based part index/category in repeated accessible names.
6. Give account typed-confirmation input an actual `<label>` or equivalent ID relationship and describe the destructive consequence.
7. Preserve working strengths: chart table alternatives, text/glyph alongside financial color, filter result live status, loading labels, and create/import success messages. Avoid duplicate announcements.
8. Do not add jsdom/Testing Library solely for this package. Use existing Vitest for pure focus/state helpers if extracted and require a documented real-browser gate. A browser test dependency is a separate proposal.
9. Record the browser, operating system, screen reader, and versions used for the manual gate so the result is reproducible.

**Manual acceptance matrix**

| Scenario | Expected keyboard/focus behavior | Expected announcement/visible behavior |
| --- | --- | --- |
| Arm Delete/Undo | Focus moves to Confirm. | Full consequence is visible without hover. |
| Cancel or Escape | Returns to original trigger. | Armed prompt disappears. |
| Server refusal | Focus remains in actionable confirmation/error area. | Error announced once. |
| Successful row deletion | Focus moves to nearby stable action/table heading. | Removed item is not focus target. |
| Form validation failure | Focus moves to summary/field once. | Error has role/description relationship. |
| Active navigation | Normal tab navigation. | Screen reader announces current page. |
| Mobile menu | Toggle controls named menu; Escape closes. | Expanded state is accurate. |
| Split editor on touch | All controls are at least 44×44. | Repeated controls have distinct names. |

**Acceptance criteria**

- Keyboard-only completion succeeds for all destructive workflows and split editing.
- A screen-reader smoke announces form/import/split/destructive errors and active navigation.
- Touch does not rely on hover/title for consequences.
- Shared primitive changes are verified at every call site.

**Rollback:** if automatic focus is disruptive, narrow the transition condition. Do not remove live semantics, visible consequences, or keyboard cancellation wholesale.

---

### WP-18 — Documentation and release reconciliation

**Delivery stage:** 7, after every selected behavior package.

Documentation changes belong with each behavior package. WP-18 is the final consistency sweep, not permission to defer all docs until the end.

**Documentation matrix**

| Document | Required truth after remediation |
| --- | --- |
| `README.md` | Safe setup, loopback/no-auth boundary, telemetry guarantee, seed refusal, build privacy, custom DB path, validated backup/restore, Node/systemd choice, and concise import date behavior. |
| `CLAUDE.md` | Actual module boundaries, typed service invariants, active-category semantics, currency discriminator, standard/focused/shuffled validation, operational scripts, and immutable hash/migration rules. |
| `USER_MANUAL.md` | User-visible blocked ambiguous-date flow, Debit/Credit behavior, split edit refusal, excluded budgets, truthful mixed-currency state, split export schema/formula safety, accessible confirmations, safe seed/backup/restore walkthrough. |
| `TODO.md` | `3d967ba` milestone correctly shipped; remediated findings marked with commits; transfer/refund/cross-file duplicate remain decision-dependent; no snapshot state presented as current fact. |
| `.env.example` | Default DB, telemetry defense in depth, and allowed-origin syntax aligned with implementation; no secret/example that encourages committing `.env`. |
| `deploy/*` comments | Exact Node selection, loopback binding, private umask, fake validation, backup retention, and service-stop restore rule. |
| API/code comments | Match route cache/origin/export behavior and do not claim caller-owned invariants that services now own. |

**Implementation steps**

1. Search all shipped docs and code comments for old phrases and examples after each behavior change.
2. Reconcile milestone hashes with `git log`, never with memory.
3. Distinguish intentional product boundaries from defects:
   - no authentication is intentional;
   - loopback/Tailscale trust remains critical;
   - no multi-currency conversion is intentional;
   - gross refund treatment remains pending until resolved;
   - cross-file identical-row collision remains a known frozen-hash limitation.
4. Include a release/update runbook and paired code/database rollback guidance.
5. Link this guide as historical/implementation context after the program; mark completed packages and unresolved RFCs instead of deleting the reasoning.

**Acceptance criteria**

- Commands, paths, response shapes, and UI behavior in docs match executable code.
- No document calls a dangerous command safe or describes a committed worktree as uncommitted.
- Known limitations remain visible and accurately scoped.
- A new maintainer can execute the fake release matrix without needing audit context from another session.

## 10. Deferred RFCs and explicit non-goals

Do not fold these into a remediation diff. Each changes financial policy, compatibility, or product scope and needs a short design record with examples before implementation.

### RFC-01 — Cross-file identical-row review/override

**Problem:** occurrence indexing distinguishes identical rows within one file, but two files each containing one identical row produce the same hash. One may be a legitimate repeated transaction.

**Constraints:** the existing hash cannot change. A safe design should show skipped-row detail and allow an explicit import decision without destroying re-import idempotency.

**Candidate direction:** store a separately identified manual duplicate override/provenance record or insert a manual transaction with explicit source metadata. Never salt/change a stored hash invisibly. Define how undo, export, and repeated override attempts behave.

**Required examples:** identical subscription on two statement files; overlapping statement periods; same-day same-amount coffee purchases; user retries; batch undo.

### RFC-02 — Transfer candidates and explicit pairing

**Problem:** transfers are currently excluded by category/keywords, not linked across accounts.

**Candidate direction:** generate advisory candidate pairs with opposite safe-integer amounts, different accounts, compatible currencies, and a narrow date window. Require explicit confirmation, preserve both ledger rows, and record linkage. Never auto-delete, auto-category, or silently pair.

**Required decisions:** same-currency only, acceptable date window, one-to-many cases, card payments, unpair behavior, how linked pairs affect income/spending and export.

### RFC-03 — Refund model

**Problem:** positive values in spending categories count as income in monthly summary and do not reduce budget/category gross spend under current negative-only logic.

**Possible explicit model:** an `is_refund` or linkage field introduced by an additive migration, with rules for original purchase link, partial/multi-month refund, split refund, and unlinked credit. Do not infer every positive categorized row as a refund; it may be income or reversal.

**Required decisions:** gross versus net dashboard views, budget treatment, date/month allocation, split categories, and migration defaults for existing positives.

### RFC-04 — Mixed-sign split semantics

Define whether a single transaction may allocate both negative and positive parts, how those parts count toward gross/net spend, and how the UI explains them. Until then, preserve existing behavior and do not “normalize” signs automatically.

### RFC-05 — Multi-currency features

Per-currency grouped dashboards may be useful later. Exchange-rate conversion, rate history, gains/losses, and remote rate fetching are explicitly outside this remediation program. Any future design must remain local-first or make egress/credentials an explicit product change.

### RFC-06 — Guarded automated restore

Required remediation ends with validated backups and a path-aware, offline manual restore runbook. An automated restore command is a separately approved destructive feature. If approved, use the detailed RFC-06 preview under WP-13: accept only schema-compatible standalone backup images, hold enforceable service quiescence, create a validated rescue, coordinate sidecars and the main-file swap without a stale-WAL window, publish durably with no-clobber semantics, and prove every failure point against fake data under independent review.

### Other non-goals

- Authentication/authorization system.
- Cloud sync, bank APIs, telemetry, CDN assets, or remote fonts.
- Double-entry ledger conversion.
- Docker/deployment platform expansion.
- Rewriting Drizzle services into a generic repository abstraction.
- Automatic repair of existing split/category/default/seed anomalies.
- Editing historical migrations or changing the frozen hash.
- Adding a broad browser-test dependency without a separate cost/maintenance review.

## 11. Cross-cutting test strategy

### Test pyramid for this repository

1. **Pure unit tests:** exact decimal-text/cents conversion, date parsing, hash vectors, strict column-map validation, origin matching, path classification, spreadsheet protection, currency normalization/state mapping, and multipart byte-count helpers.
2. **Service integration tests:** temporary migrated SQLite database for direct domain-contract refusals, split invariants, file-atomic import/batches/undo, account currency repair, categories, summaries, deterministic export snapshots, path-independent operations, seed, and backup/restore internals.
3. **Route/action tests:** service-only boundaries, validation, Origin-before-body ordering, typed status mapping, no-store/global headers, missing/dishonest/oversized body lengths, reader cancellation, and user-visible error results.
4. **Production smoke:** loopback production server with a new temporary absolute DB; health, headers, binding, build traces; stop after validation.
5. **Manual accessibility/operations gates:** keyboard/screen reader, systemd syntax/runtime, fake restore failure matrix, spreadsheet formula smoke.

### Required financial fixture matrix

Every aggregate/semantic package should share or recreate a small, explicit fake ledger with:

- positive income, negative outflow, zero, positive refund-like credit, and negative reversal;
- checking/savings/credit-card account types with opening balances;
- categorized, uncategorized, excluded, and budgeted categories;
- unsplit and split transactions, including a null split category;
- same-category duplicate split parts;
- import batch and manual row provenance;
- month-end/year-end dates as ISO strings;
- one-currency and mixed-currency variants.

Expected values must be hand-calculated integer cents in the test, not produced by the same helper under test.

### Failure injection

Use SQLite triggers, injectable clocks/filesystem operations, and dependency parameters rather than production-only flags. Required failure points include:

- default insert N of 12;
- split replacement after existing rows are selected but before insert completes;
- seed after some would-be inserts;
- import ambiguity before batch creation;
- malformed row/map and CLI account creation inside the import transaction;
- export cancellation after at least one keyset page while the read snapshot remains open;
- multipart total-cap crossing before FormData parsing;
- backup copy/validation/rename;
- restore validation/copy/fsync/rename/post-check.

Every failure test asserts all affected tables/files, not merely an error message.

### Timezone and locale

- Run date-only tests under at least `TZ=UTC` and `TZ=America/Chicago`.
- Do not snapshot locale-dependent formatted strings unless locale/currency is fixed explicitly.
- Test raw service cents separately from `Intl.NumberFormat` output.

### Query/performance validation

The target remains a local single-user application, so optimize only measured issues. For split-aware filters/export/stats:

- build a fake fixture in the tens of thousands of parent rows and representative splits;
- inspect `EXPLAIN QUERY PLAN` for date/account/category predicates;
- verify date range indexes remain usable and correlated split checks use `transaction_splits_transaction_idx`;
- record before/after wall time as diagnostic evidence, not a brittle unit-test threshold;
- add an index only with an additive migration and populated migration test.

Avoid N+1 queries for account lists, split export details, and category stats. Batch split-detail reads within each 500-parent export page and stay within SQLite's variable limit when using `IN`.

### Privacy of validation

- All runtime validation uses temporary absolute DB paths or committed fake samples.
- WP-01D's wrapper/per-worker setup makes that target mandatory for `npm run build`, server smokes, and uninjected tests; a prose convention alone is insufficient.
- A checker may read build manifest metadata but never the referenced real file.
- Do not enumerate or print `data/*.db*`, `data/imports/`, environment contents, or statement rows.
- Do not start a server on all interfaces for validation; use explicit `127.0.0.1` and stop it.
- Before WP-04 exclusions exist, privacy builds run in a sanitized fixture workspace so the tracer cannot discover real data under its root.
- Network denial tests are optional environment checks; a blocked command is not a repository failure.

## 12. Migration and compatibility protocol

Most work packages need no schema change. If a package proposes one:

1. State why service/code-only enforcement is insufficient.
2. Back up only fake data during development; do not invoke migration generation against a real target.
3. Update `src/db/schema.ts`, then use the repository's Drizzle generation command to create a new migration. Never hand-edit `0000`–`0004`.
4. Inspect generated SQL for table rebuilds, default/null behavior, foreign keys, indexes, and data copying.
5. Add a populated pre-migration fixture representing every relevant state.
6. Assert exact transformed values plus `quick_check` and `foreign_key_check`.
7. Define application backward compatibility. If old code cannot run after migration, the release runbook must pair the prior code revision with a pre-update backup.
8. Define interruption behavior. SQLite DDL/data migration should be transactional where supported.
9. Do not auto-repair ambiguous historical data in a migration. Add nullable/default-safe structure, then use an explicit reviewed user workflow.
10. Record downgrade/rollback as restore of a validated paired backup when reverse SQL is unsafe.

No migration should be introduced for WP-02A/B, WP-03, WP-06, WP-07, WP-08, WP-10, WP-11, WP-12, WP-14A/B/C, WP-15, WP-16, or WP-17 as currently designed. Account currency already exists in the schema. A measured split-category index in WP-09 is the main possible exception and still requires the protocol above.

## 13. Documentation-by-package obligations

| Package | Documentation that must change in the same diff |
| --- | --- |
| WP-02A/B | Exact money input/serialization, typed service domain contracts, and split edit/clear behavior in manual and `CLAUDE.md`. |
| WP-03 | Every seed command description, empty state, and operational warning. |
| WP-04 | Build/package privacy boundary and external runtime DB provisioning. |
| WP-05 | No-telemetry claim and script invocation details. |
| WP-06 | Whole-file failure, strict column-map rules, exact 400/404/409/422 outcomes, atomic CLI account creation, format chooser, zero-filled Debit/Credit, and undo-first historical correction. |
| WP-07 | Architecture startup semantics; explicit note that partial historical sets are not auto-repaired. |
| WP-08/09 | Excluded budgets and active split-category behavior in manual/CLAUDE. |
| WP-10 | Both exact header schemas, legacy mixed-currency refusal, split JSON schema, filter/order/snapshot meaning, and spreadsheet apostrophe behavior. |
| WP-11 | Account create/edit/repair currency, single/mixed/invalid aggregate states, and no-conversion limitation. |
| WP-12 | Strict DB path and pre-open migration policy, explicit legacy move procedure, Git privacy, and strict environment errors. |
| WP-13 | Private modes, validated backup, path-aware offline manual restore, paired rollback; automation remains RFC-06. |
| WP-14A/B/C | Exact trusted-Origin/rebuild behavior, proxy assumptions, global framing/no-store headers, measured multipart/file caps, filename rules, and root-layout revalidation. |
| WP-15 | Service-boundary enforcement and explicit operational/test exceptions. |
| WP-16 | Node selection, unit install placeholders, loopback and permission checks. |
| WP-17 | Keyboard/touch/assistive behavior only where user-facing instructions benefit. |

## 14. Release and definition-of-done gates

### Per-work-package gate

- Relevant source and every caller read before editing.
- Finding reproduced with fake data or logically pinned by a failing test.
- Narrow tests pass.
- Negative/refusal path asserts unchanged state.
- Documentation and comments match the new behavior.
- No dependency/lockfile/migration change unless explicitly part of the package.
- `git diff --check` passes and the diff contains no unrelated formatting.

### Standard repository gate after WP-01D

WP-00 is documentation-only and uses documentation/diff checks, not a production build. For WP-01A/B/C and WP-12A work before the safe harness exists, run only the focused tests/type/lint checks that apply, with an explicit unique absolute temporary `DB_FILE_NAME` and deterministic cleanup where any module could open SQLite. Do not run Next build in the live working repository.

During WP-01D, implement the temporary-target wrapper before the first Next build, validate it in a sanitized copied workspace, and use that wrapper for the package's build test. After WP-01D lands, run and record the standard commands for every executable behavior package; the scripts themselves must be safe when `DB_FILE_NAME` is unset:

```bash
npm test
npm run lint
npm run build
```

Run only the additional gates made applicable by the package: WP-04/WP-05 add every-manifest/copied-tree privacy and telemetry; migration-affecting work adds populated upgrades; WP-10 adds streamed snapshot/export cancellation; WP-13 adds fake backup/manual-restore validation; WP-14 adds headers/origin/upload/revalidation; WP-15 adds boundary search; WP-16 adds systemd verification.

### Final-program release gate

The following list is required only after the corresponding packages have landed; WP-00 or WP-01 cannot satisfy future behavior by themselves. Before a release declaring the remediation program complete, verify:

- clean-HOME build has telemetry disabled;
- all `.nft.json` files pass the sensitive-path checker;
- a sanitized copied-workspace standalone build passes a full copied-tree path/symlink scan and contains no `.env*`, runtime data, tests, operator/test-only scripts other than the required telemetry preload, deploy files, or unrelated documentation;
- production smoke uses a new temporary absolute DB and binds only `127.0.0.1:3100`;
- `/api/health` returns generic status and `Cache-Control: no-store`;
- financial APIs are no-store and current after mutation;
- every action and import pass the exact scheme/host/port Origin matrix, including missing-Origin refusal, before parsing/body/DB work;
- upload tests prove declared-length early refusal, measured `5 MiB + 64 KiB` enforcement for absent/chunked/understated lengths, reader cancellation, and authoritative 5 MiB file rejection;
- every successful financial mutation refreshes all pages through `revalidatePath("/", "layout")`; rejected/no-op mutations do not revalidate;
- compatibility and detailed exports pass exact-header, mixed-currency, keyset-order, snapshot, split-batching, formula-protection, exact-cents, and cancellation tests;
- `PRAGMA quick_check` and `foreign_key_check` pass for fresh/current/historical fake DBs;
- fake DB/WAL/SHM/backups have private POSIX modes;
- exact-name and shuffled test runs pass;
- `rg` finds no forbidden direct DB imports;
- `git diff --check`, reviewed `git diff`, and final `git status --short` are explainable.

### Global definition of done

A work package is not complete merely because its happy path passes. Where relevant to that package, it is complete only when:

- the service layer owns any business/DB invariant changed by the package;
- every affected entry point maps the same typed outcome;
- partial failure leaves data/files in the documented state;
- no real data was used;
- compatibility and privacy tests pass;
- user and maintainer docs are true;
- rollback is practical and does not require guessing;
- remaining uncertainty is written down.

## 15. Update/deployment runbook

This is a target runbook for a separately authorized deployment, not an instruction to deploy during implementation.

1. Record code revision, Node/npm versions, worktree state, and resolved DB path.
2. On fake data, run tests, lint, build, trace privacy, telemetry, migration, and operational checks.
3. Run the read-only path/permission audit against the intended installation only with operator authorization; do not query ledger rows.
4. Before any version that can migrate the real DB, create a WAL-safe online backup, validate it, record its private path, and pair it with the prior code revision.
5. Never run `npm ci` or replace `.next`/`node_modules` beneath a live service in the same working directory. Either:
   - stop the service before an in-place install/build and keep it stopped through validation; or
   - build and validate an immutable versioned release directory, then switch the service atomically. This model requires the financial DB to live at an absolute external path.
6. Install/build using the exact verified Node runtime referenced by systemd. Preserve the prior immutable build/revision for rollback.
7. Start and verify:
   - only loopback port `3100` is listening;
   - health is 200 and generic;
   - frame-denial and no-store headers are present;
   - direct loopback and documented Tailscale/custom Server Actions work;
   - same-origin upload works and arbitrary-origin upload fails before body parsing;
   - current DB, WAL/SHM, and backup modes are private;
   - no application runtime egress occurs.
8. Confirm the backup timer's next run and last successful validated backup.
9. On failure, stop the service. Revert to the prior code revision. If schema compatibility is not backward-safe, restore the paired pre-update backup, run integrity/foreign-key checks, and only then restart.

Never use an unvalidated backup as the sole rollback artifact. Never delete the current DB/WAL/SHM until a rescue artifact and stopped-service state are confirmed.

## 16. Next-session kickoff checklist

Copy this checklist into the next session and fill it out before code changes:

```text
Selected package/slice:
Finding IDs addressed:
Decision gates resolved:
Repository root:
Branch / HEAD:
Initial git status:
Node / npm:
Applicable AGENTS files:
Installed Next/Drizzle docs consulted:
Fake fixture/temp DB plan:
Expected files changed:
Expected migration/lockfile impact (normally none):
Failing reproduction/test:
Rollback plan:
Focused validation commands:
Full validation commands:
Uncertainty requiring user input:
```

### Completed checkpoint evidence

- Before WP-12A, a fake temporary `createTestDb()` reproduction invoked from a
  directory without migrations threw only after creating the configured parent
  and SQLite file. The replacement preflight tests prove malformed env, path,
  journal, SQL, and checksum inputs fail before the target parent, DB, WAL, or
  SHM can exist.
- WP-12A focused validation: 4 test files / 46 tests passed, covering the
  stable-root marker, strict atomic env parsing, lexical/canonical path policy,
  fixed migration metadata and hashes, preflight ordering, cross-cwd behavior,
  and adapter wiring.
- Current default order: 16 test files / 148 tests passed.
- Current shuffled order: 16 test files / 148 tests passed with each recorded
  WP-12A seed: `17`, `2718`, and `20260714`.
- Exact-name isolation: Vitest collected 45 tests under `src/server/services/`
  and `src/db/`; every full test name passed as the sole selected test in its
  file. The two originally failing import/re-import and undo names also passed
  in their dedicated focused runs.
- Repository-wide ESLint and `tsc --noEmit` passed. Migration SQL 0000–0004 and
  the lockfile remained unchanged. Every explicit WP-12A guard path remained
  absent, and the independent review found no remaining database-open ordering
  or security blocker after the cwd fallback was removed.
- WP-01D added an ownership-marked outer lease, authenticated Vitest root
  handoff, fresh marked worker directories, implicit-handle close support,
  bounded POSIX process-group supervision, and real dev/start smoke helpers.
  Missing/changed markers, forged handles, symlink replacement, setup/logging
  failures, early server exit, pre-spawn signals, ignored descendants, and
  cleanup failures all have focused negative coverage.
- Current WP-01D default and shuffled orders: 20 files / 191 tests passed for
  the default order and seeds `17`, `2718`, and `20260714`. Repository-wide
  ESLint, `tsc --noEmit`, and `git diff --check` passed. Every reported outer
  lease root was checked directly and was absent afterward.
- A direct `vitest run` used a controlled `TMPDIR`, passed the implicit-DB
  sentinel, and left that root empty. A forged wrapper token was rejected before
  any database artifact was created.
- The sanitized copied-workspace gate allowlisted Git source, rejected private
  env/runtime-data paths and source symlinks, copied dependencies locally, and
  used clean HOME/TMPDIR state. Tests (20 files / 190 tests), lint, real Next
  dev health smoke, the wrapped optimized build, and real `next start` health
  smoke passed. Five reported leases were absent afterward. The fake default
  sentinel retained SHA-256
  `45957bc25a2f747c9368c922d5b8f7389b59e9db35cf7fd9a4c698799c3100e6`,
  size, mtime, and mode, and gained no WAL/SHM/journal sidecar. The fixture was
  removed after verification.
- The sanitized build emitted Next's whole-project NFT warning. That expected
  PG-06 evidence preserves the pre-WP-04 copied-workspace restriction; WP-01D
  does not claim output-trace or standalone privacy.
- Native Windows validation wrappers fail before lease creation because this
  dependency-free implementation cannot prove orphan-descendant termination
  after a leader exits. Linux, macOS, and WSL own a POSIX process group. Normal
  Windows dev/start support remains, while wrapped test/lint/build/smoke needs
  WSL until a separately reviewed Windows job-object supervisor exists.
- WP-12B broadens the root Git boundary to all `data/**` paths while
  re-including only `data/samples/**`. Path-string checks covered the default
  DB, common SQLite extensions, nested targets, WAL/SHM, imports, backups, and
  the fake-sample exception; the committed fake sample remained tracked.
- The read-only path audit reuses strict env/path/migration preflight, anchors
  to its own checkout, reports normalized target/classification, derived backup
  directory, Git status, and direct parent/file modes, and never imports or
  opens SQLite. Git inspection strips redirecting control variables, disables
  external config/locks/prompts, verifies the canonical worktree, and accepts
  only a positive NUL-delimited match from the root `.gitignore`. Tracked,
  negated, alternate-provenance, malformed, and error results fail closed.
- A sanitized copied CLI fixture with no `.env` or runtime data used clean
  HOME/TMPDIR state plus hostile `GIT_DIR`, `GIT_WORK_TREE`, and injected Git
  configuration. `npm run audit:data-path` passed, created no target, parent,
  data tree, WAL/SHM, HOME, or TMPDIR artifact, and the fixture was removed.
  The direct no-cache TypeScript loader avoids the `tsx` CLI child/IPC/cache
  path.
- Final WP-12B focused validation passed 3 files / 53 tests. The current full
  suite passed 21 files / 207 tests in default order and shuffled with seed
  `12012`; repository ESLint, `tsc --noEmit`, and `git diff --check` passed,
  every reported validation lease was absent afterward, and no build was
  required for this non-Next path/Git/documentation slice. No real `.env`,
  ledger, ignored data tree, database operation, server, or deployment was
  used. Security review found no remaining blocker; POSIX-mode enforcement and
  validated backup hardening remain WP-13 work.

Exact guarded command forms used for WP-12A:

```bash
DB_FILE_NAME=/tmp/moneybags-wp12a-final-focused-20260714-1/default.db ./node_modules/.bin/vitest run src/db/path.test.ts src/db/preflight.test.ts src/db/migrations.test.ts src/db/default-categories.test.ts --reporter=dot
DB_FILE_NAME=/tmp/moneybags-wp12a-final-full-20260714-1/default.db npm test
DB_FILE_NAME=/tmp/moneybags-wp12a-final-shuffle-17-20260714-1/default.db npm test -- --sequence.shuffle --sequence.seed 17
DB_FILE_NAME=/tmp/moneybags-wp12a-final-shuffle-2718-20260714-1/default.db npm test -- --sequence.shuffle --sequence.seed 2718
DB_FILE_NAME=/tmp/moneybags-wp12a-final-shuffle-20260714-20260714-1/default.db npm test -- --sequence.shuffle --sequence.seed 20260714
npm run lint
./node_modules/.bin/tsc --noEmit
git diff --check
```

The earlier full exact-name matrix was collected with the following guarded
command:

```bash
DB_FILE_NAME=/tmp/moneybags-exact-list-20260713/default.db npx vitest list src/server/services src/db --json
```

For each of its 45 `{ file, name }` results, the command runner invoked
`./node_modules/.bin/vitest run <file> -t '^<regex-escaped-full-name>$'
--reporter=dot` with a distinct
`DB_FILE_NAME=/tmp/moneybags-exact-matrix-20260713-<index>/default.db`. All 45
invocations passed, and a post-run `/tmp/moneybags-exact-*` search plus direct
checks of the default/shuffle/focused guard directories found no artifacts.

### Prepared handoff: WP-02A

The next session should select **WP-02A — Service-owned domain write contracts
and exact money**. WP-00, WP-01A/B/C/D, and WP-12A/B are complete. Keep every
database-bearing validation command behind WP-01D's temporary-target harness,
and keep builds in sanitized copied workspaces until WP-04. Do not begin
WP-02B split-integrity changes or decision-gated RFC behavior before the WP-02A
contracts are stable.

```text
Selected package/slice: WP-02A
Finding IDs addressed: PG-01, PG-02
Decision gates resolved: service-owned write invariants and the exact editable-money grammar/serialization contract in Section 9; no generic repository abstraction and no schema migration
Repository root: the checkout root; confirm it before running any command
Branch / starting state: main at the commit containing this handoff; reconfirm a clean worktree
Applicable instructions: repository-root AGENTS.md plus any active session working agreement
Installed versions to preserve: Next 16.2.10, Drizzle ORM 0.45.2, better-sqlite3 12.11.1, Node >=20.12
Fake fixture/temp DB plan: wrapper-owned unique OS-temp DBs and synthetic services/forms only; never open, migrate, seed, import, or inspect the configured ledger
Expected files changed: narrow pure money helpers/tests; existing account/category/transaction/import service contracts and focused callers/tests; exact form/default/export adapters identified by repository exploration
Expected migration/lockfile impact: none; do not edit schema, migrations 0000-0004, dependency versions, or package-lock.json
Failing reproduction/test: prove 1.005 and unsafe-cent inputs are currently rounded/accepted where specified, and direct service calls can bypass caller-only date/currency/reference/budget validation, using fake data only
Rollback plan: retain exact parsing/serialization and service-owned validation if an adapter mapping needs correction; roll back only the affected adapter, never return to Math.round, float serialization, or caller-only invariants
Focused validation: pure boundary/round-trip money tests; direct-service invalid-input/reference/conflict tests; exact no-write assertions; caller mapping and existing hash/migration compatibility tests
Repository validation: wrapped default/shuffled tests, lint, typecheck, final Git status/diff; any Next build remains sanitized-copy-only until WP-04
Uncertainty requiring user input: stop only if repository evidence exposes a contract choice not already locked in WP-02A or requires a schema/dependency/public-API expansion beyond the package
```

## 17. Handoff template for every completed package

```markdown
## Outcome

<Behavior now guaranteed, led with user/data impact.>

## Scope

- Finding(s):
- Files changed:
- Deliberate non-goals:
- Migration/dependency impact:

## Evidence

- Reproduction before:
- Focused tests after:
- Full tests/lint/build:
- Privacy/migration/operations checks as relevant:

## Data safety

- Fake/temp data used:
- Transaction/rollback boundary:
- Failure-state assertions:
- Real data or services touched: No (unless separately and explicitly authorized)

## Compatibility

- Import hash:
- Money/date conventions:
- API/export behavior:
- Migration/backward compatibility:

## Residual risk and next dependency

- Remaining uncertainty:
- Next work package:
- Operator action required:

## Repository state

- Initial status:
- Final status:
- Unrelated user changes preserved:
```

## 18. Final guardrails

- Do not “fix” a real database to prove a code change.
- Do not run demo seed against any existing ledger.
- Do not test restore against the active target.
- Do not open or summarize private data files.
- Do not alter the import hash, historical migrations, signed-cent convention, or date-only convention.
- Do not rescale, clear, pair, recategorize, net, convert, or repair financial rows without an explicit user-visible decision.
- Do not treat a warning beside a false financial total as correctness.
- Do not make the app remotely reachable by default or imply that Tailscale supplies application-level per-user authorization.
- Do not add packages to solve behavior already covered by Node, Next, Drizzle, better-sqlite3, Zod, Vitest, or a small pure helper.
- Do not weaken a failing focused test; make its state self-contained.
- Do not claim a privacy, migration, backup, build, or accessibility gate passed unless it actually ran and its result was inspected.

The north-star principle is simple: refuse ambiguous or destructive behavior before mutation, keep financial semantics singular and service-owned, and make every privacy and recovery claim executable against fake data.
