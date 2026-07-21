# Money Bags Implementation Plan Analysis

> Repository baseline: `3d967baf8d7451f8c8202f3f9489401771bcc3b7` (`3d967ba`)
> Analysis date: 2026-07-13
> Compared plan: [`IMPLEMENTATION_GUIDE.md`](IMPLEMENTATION_GUIDE.md)
> Scope: repository analysis and plan revision only; no remediation code, dependency, migration, private-data, database, build, deployment, or service operation

> **Historical planning record:** this analysis describes the pre-implementation
> `3d967ba` baseline and the guide-revision task. It is intentionally not updated
> to make those observations read like current implementation results. Current
> package completion and verification live at the top of `IMPLEMENTATION_GUIDE.md`;
> the current next-session handoff is maintained in `CODEX_HANDOFF.md`, while
> the guide's Section 16 retains the reusable handoff template.

## Executive conclusion

The original implementation guide was unusually strong. It preserved immutable financial contracts, used stable finding IDs, separated product-policy RFCs from remediation, required fake data, defined rollback behavior, and tied most claims to repository evidence. Its Next.js assumptions were also broadly correct for the installed release.

It was not yet optimal or fully decision-complete. Delivery order would have forced later safety work to be retrofitted into earlier behavior changes, several service boundaries were under-specified, editable money still had a floating-point path, import failure semantics were partial or caller-dependent, currency was diagnosed but not fully operable, export and upload contracts retained implementation choices, and output-trace planning did not cover every manifest or Next's separate standalone environment-file copy.

The guide has therefore been revised in place. The revision preserves the verified evidence, MB finding IDs, frozen import hash, append-only migration rule, split and currency invariants, rollback guidance, and deferred RFCs. It makes the selected work packages decision-complete and reorders them so compatibility and safe database targeting land before financial behavior or build work.

No dependency change is justified by this analysis. Next 16.2.10 is newer than the applicable published 16.2.6 patched threshold, while React/React DOM 19.2.4 exactly meet the React team's published safe 19.2.x backport. The accurate conclusion is therefore that the installed versions **meet or exceed** the reviewed thresholds—not that both strictly exceed them.

## 1. Scope and evidence model

This analysis compares the code at `3d967ba` with the implementation guide and classifies statements as follows:

- **Confirmed defect:** directly demonstrated by a focused fake-data test or unambiguous executable path.
- **Supported inference:** strongly implied by code, framework source, or operating-system behavior but not reproduced end to end in production conditions.
- **Historical baseline fact:** true of the audited commit or prior validation, but not a claim about future remediated behavior.
- **Plan omission:** repository behavior or a required implementation decision that the original guide did not close.
- **Over-specified/deferred:** a product or destructive-operation design that should remain outside selected remediation until separately approved.

The comparison used repository source, tracked configuration and documentation, installed package metadata, installed Next 16.2.10 documentation/source, and the supplied audit-validation record. It did not inspect a real database, imported statement, environment file, backup, credential, service journal, or production host.

## 2. Repository state and ownership

### Revision and working tree

- `HEAD` is exactly `3d967baf8d7451f8c8202f3f9489401771bcc3b7` on `main`, tracking `origin/main`.
- The clean state belongs to the **historical audit snapshot**.
- At the start of this revision, the current working tree intentionally contained a user-owned tracked edit to `CLAUDE.md` and an untracked `IMPLEMENTATION_GUIDE.md`. The `CLAUDE.md` edit only links the guide and is preserved.
- This task adds this analysis and revises the guide. It does not claim the current documentation worktree is clean.

### Architecture at the baseline

The application is a local-first Next.js App Router application backed by SQLite:

```text
Pages and client components
        |
Route Handlers / Server Actions / CLI scripts
        |
src/server/services/*
        |
src/db/client.ts + Drizzle schema/migrations
        |
better-sqlite3 / SQLite
```

That architecture is mostly present, but not mechanically complete. Import and health Route Handlers access the DB directly (`src/app/api/import/route.ts`, `src/app/api/health/route.ts`), several services trust caller-owned domain values, and operational scripts have inconsistent environment/path behavior. The revised guide keeps the architecture and closes those boundaries; it does not introduce a generic repository abstraction.

### Installed baseline

| Component | Exact installed version | Repository evidence |
| --- | ---: | --- |
| Next.js / `eslint-config-next` | 16.2.10 | `package.json`, `package-lock.json`, installed tree |
| React / React DOM | 19.2.4 | `package.json`, `package-lock.json`, installed tree |
| Drizzle ORM | 0.45.2 | `package.json`, installed tree |
| better-sqlite3 | 12.11.1 | `package.json`, installed tree |
| Zod | 4.4.3 | `package.json`, installed tree |
| Vitest | 4.1.9 | `package.json`, installed tree |
| Observed Node / npm | v22.22.1 / 10.9.4 | local toolchain; package contract remains Node `>=20.12` |

## 3. Validation evidence

The following results are the supplied audit evidence preserved by the plan. They are historical validation facts, not claims that remediation has already been implemented:

| Check | Result | Interpretation |
| --- | --- | --- |
| Full test suite | **103 passed** | Default-order suite was green at the audited snapshot. |
| ESLint | **passed** | The audited source satisfied current lint rules. |
| Standalone TypeScript check (`tsc --noEmit`) | **passed** | Type checking was green independently of the Next build. |
| `npm test -- -t "re-importing the same file imports 0"` | **failed**: received `imported: 5`, expected `0` | The selected test depended on an import performed by a different `it`; default-order success hid shared mutable state. |
| Frozen import-hash vectors | **matched** | Current hash behavior produces the two guide values and must remain frozen. |
| Migration `0000`–`0004` SHA-256 values | **matched** | Historical SQL bytes match the manifest below. |
| `git diff --check` | **passed** | The audited documentation diff had no whitespace errors. |

Migration checksum evidence:

| Migration | SHA-256 |
| --- | --- |
| `0000_hesitant_yellow_claw.sql` | `f6fbc57eab77a346e5c6b8e72d24e1393a15497b4051cde2c4f932648f8dfd31` |
| `0001_third_skin.sql` | `083430c4c6a7acbe024293efaa1835dfde96377f3a0bc7d08f9df4564b24eed5` |
| `0002_noisy_bill_hollister.sql` | `3fb428f49b2de20b671756014748d9b877f93142cc4cbec7c4daf417dbf60a78` |
| `0003_bouncy_odin.sql` | `d16f531ee1e4958c428716fcfdf0ae888b917055a32dc22ec4249bc405ec2de7` |
| `0004_right_gamma_corps.sql` | `163081861a670360f47dfc52c8934f70bbed808606a8a85f18ffbf4e61baf0f1` |

The frozen hash examples also remain:

- occurrence 0: `794efbe010c9cc75108641472b6f79684a5a25c06fd4ea57143e5b01dc671580`
- occurrence 1: `1462da3aa0fcdaa4c22b355a0d4003ff9c7859a002fd6bf0d132ed620b240829`

No successful production build is used as evidence. A bare build can resolve the default database through imported server modules; making tests/builds target a unique temporary DB is itself WP-01D. Historical NFT metadata supports the narrower trace-inclusion finding, but neither a production runtime smoke nor a privacy-safe standalone package has been verified.

## 4. Finding-by-finding comparison

### Confirmed and inferred repository findings

| ID | Classification | Repository evidence | Assessment of the original guide and revision |
| --- | --- | --- | --- |
| MB-001 | Confirmed defect | `src/server/services/transactions.ts:createTransaction`, `updateTransaction`, `setTransactionCategory`, and `replaceSplits` do not jointly enforce the parent/split invariant. The fake reproduction committed a `-12000` parent with `-10000` parts. | The guide correctly treated this as high risk and rejected silent repair/rescaling. Revision adds prerequisite service-domain validation and keeps split integrity in WP-02B. |
| MB-002 | Confirmed dangerous behavior | `src/db/seed.ts` opens the configured DB and uses `onConflictDoUpdate` for named accounts/categories. | Original diagnosis and fail-closed seed policy were strong. Revision moves strict path/migration preflight and service contracts before seed, and locks explicit USD demo accounts. |
| MB-003 | Confirmed historical trace inclusion; supported future packaging risk | Historical route `.nft.json` metadata named fake/sample SQLite DB, WAL, and SHM artifacts. Current config does not enable standalone. Installed Next build source separately copies selected `.env` files into standalone output. | Original trace concern was valid but could be read as proving current runtime copying. Revision separates observed trace inclusion from future standalone exposure, scans every NFT, and requires a sanitized copied-tree scan. |
| MB-004 | Confirmed import defect | `src/lib/csv/parse-statement.ts` auto-selects an interpretation for ambiguous separated dates and `src/server/services/import.ts` can persist returned rows. The corrected date changes the frozen hash. | Original guide correctly required explicit format before insertion. Revision makes the complete file fail before DB resolution and chooses exact typed/HTTP outcomes. |
| MB-005 | Confirmed import defect | Debit/Credit parsing treats two nonblank cells as conflicting even when one is zero-filled. | Original sign analysis was correct. Revision retains it inside a strict whole-file parser contract and exact digit-based cents conversion. |
| MB-006 | Confirmed aggregate defect | `src/server/services/summary.ts:getBudgetVsActual` filters only non-null budgets, unlike the existing spending exclusion predicate. | Original fix was narrow and correct. Revision orders service validation first and keeps the saved budget while excluded. |
| MB-007 | Confirmed semantic drift | Category filters/stats/rules/export use parent category fields even when split categories are the active allocations. | Original active-category matrix was one of the guide's strongest sections. Revision preserves it and defines legacy/detailed export behavior around it. |
| MB-008 | Confirmed presentation/correctness defect | `src/server/services/accounts.ts:getNetWorthOverview` returns a scalar plus currencies; the dashboard formats combined values as USD. `accounts.currency` exists in `src/db/schema.ts`, but account writes/forms do not expose it. | Original guide identified false aggregation but did not complete currency remediation. Revision adds create/edit/API/CLI currency, normalized validation, mixed/invalid states, and an in-app repair path without a migration/package. |
| MB-009 | Supported startup-integrity inference | `src/db/default-categories.ts:ensureDefaultCategories` checks count and inserts definitions one by one without one encompassing transaction. | A mid-loop failure was not reproduced, so “probable risk” is more precise than “confirmed corruption.” Revision retains atomic bootstrap and failure injection. |
| MB-010 | Confirmed configuration/operations gap | `src/db/client.ts:createDb` creates the parent and opens SQLite before migration-folder validation. `drizzle.config.ts`, seed, import CLI, and backup suppress environment-load errors broadly. Relative custom paths escape the documented data boundary. | Original path work was good but needed exact pre-open order. Revision locks strict environment, canonical path, journal, SQL asset, and checksum validation before `mkdir` or SQLite open. |
| MB-011 | Confirmed hardening gap; runtime modes not inspected | DB/backup creation uses default modes unless umask is restrictive; `scripts/backup-db.ts` creates directories without an explicit private mode. | Original guide correctly avoided inspecting/chmodding private artifacts. Revision keeps `0700`/`0600`, `UMask=0077`, read-only audit, and no automatic repair. |
| MB-012 | Confirmed code/config gap; exploitability is deployment-dependent | `next.config.ts` trusts `*.ts.net`; import reads the body without an Origin check; global frame denial is absent. Installed Next's action handler compares `.host` (not scheme) and permits missing Origin at its coarse framework check. | Original route-origin and framing direction was sound but incomplete for actions. Revision uses exact HTTPS origins, derives host entries for build-time Next config, and adds a full-origin guard as each action's first operation. |
| MB-013 | Confirmed unsanitized export path | `src/lib/csv/export.ts` quotes cells but does not neutralize spreadsheet formula-leading description/account/category text. | Original threat model was correct. Revision applies one shared text-cell policy to both export formats while leaving numeric Amount untouched. |
| MB-014 | Confirmed documentation/runtime guarantee gap | Telemetry suppression depends on `.env` / `.env.example`; package launchers do not intrinsically set it. | Original same-process preload is dependency-free and maintainable. Revision moves it after the safe build harness and requires every launcher/systemd path to use it. |
| MB-015 | Confirmed test-reliability defect | The exact-name re-import test fails because shared `beforeAll` state supplied its first import. Eleven current `beforeAll` suites span import, batches, accounts, net worth, categories, transactions, splits, three summaries, and defaults. | Original fix focused on the reproduced importer. Revision explicitly audits every stateful suite and permits `beforeAll` only for immutable fixtures. |
| MB-016 | Confirmed coverage gap | Current tests did not pin literal hash outputs or a committed populated historical migration matrix. | Original guide was strong. Revision preserves literal hashes/checksums and orders compatibility locks before parser/domain changes. |
| MB-017 | Historical compatibility limitation | The v1 hash includes an occurrence index only within one file; identical rows in different files can collide. Historical file boundaries cannot be reconstructed from ledger rows alone. | Correctly deferred. Revision preserves the hash and keeps any explicit override/provenance design in RFC-01. |
| MB-018 | Product backlog, not a remediation defect | Transfer pairing and refund behavior require policy for matching, signs, dates, splits, and aggregates. | Correctly deferred. Revision leaves transfers, refunds, conversion, and mixed-sign policy outside remediation. |
| MB-019 | Confirmed deployment drift | `package.json` permits NVM/Node `>=20.12`, while systemd templates hard-code `/usr/bin/npm`; systemd does not initialize an interactive NVM shell. | Original diagnosis was correct. Revision keeps a narrow portability correction before broader hardening and requires one verified runtime. |
| MB-020 | Confirmed architecture drift | `src/app/api/import/route.ts` imports DB/schema/query helpers; `src/app/api/health/route.ts` directly calls `getDb()`. | Original service-boundary goal was correct. Revision makes account existence transactional in import, adds a narrow health service, and locks lint/search enforcement. |
| MB-021 | Confirmed documentation drift | `TODO.md` describes the UX7–UX18 work as uncommitted although `3d967ba` is the matching commit. | Correctly placed first as documentation-only safety/truth work and again in final reconciliation. |
| MB-022 | Confirmed code-level accessibility gaps; manual behavior unverified | Shared form errors, confirmation focus/Escape behavior, active navigation state, and compact split controls lack parts of the stated accessible contract. | Original guide was appropriately specific and required a reproducible browser/screen-reader gate without adding a test dependency. Revision retains it late, after action/result behavior stabilizes. |

### Plan-completeness gaps found during comparison

| Gap | Evidence | Why the original plan was incomplete | Revision |
| --- | --- | --- | --- |
| PG-01: service-owned domain writes | Public functions in `accounts.ts`, `categories.ts`, and `transactions.ts` accept caller-owned cents, dates, budgets, currencies, and referenced IDs. | Transport-only Zod validation can be bypassed by another caller and races referenced-entity checks. | WP-02A validates safe cents, ISO ledger dates, positive/null budgets, currencies, names/IDs, and references inside services; typed expected conflicts; DB constraints remain defense in depth. |
| PG-02: exact editable money | `src/lib/money.ts:dollarsToCents` uses `Number`/`Math.round`; SplitEditor and form/export defaults divide cents and/or call `toFixed`. | Financial storage is integer cents, but editing and serialization could round or lose integer precision. | One browser/server-safe digit parser rejects more than two fractional digits; the inverse serializes cents exactly. All editable defaults, split inputs, actions, and CSV use it. |
| PG-03: file-atomic import/map/account creation | `importStatement` can retain valid rows when others fail; route `parseColumnMap` falls back silently; `scripts/import-csv.ts` creates an account before file preflight. | “Transactional inserts” did not mean the entire submitted file or CLI account target was atomic. | Strict CSV/map preflight precedes DB resolution. Any malformed row fails all. CLI account creation occurs only after ready preflight and in the same immediate transaction. |
| PG-04: honest upload bound | `src/app/api/import/route.ts` calls `request.formData()` before checking `File.size`; missing/understated length is possible. | A declared-length check alone does not cap memory, and an exact 5 MiB file needs multipart overhead. | Origin first; early declared-length refusal; measured stream cap at 5 MiB + 64 KiB; cancel on crossing; `formData()` only on a bounded reconstructed Request; authoritative 5 MiB File check. |
| PG-05: revalidation drift | `src/server/actions/shared.ts` lists five page paths; import has its own two calls. | New pages can become stale and multiple lists can diverge. | One post-commit `revalidatePath("/", "layout")`, verified against installed Next 16.2.10 behavior; failures/no-ops do not revalidate. |
| PG-06: complete packaging privacy | Route exclusions operate on route traces; framework server manifests and standalone environment-file copies have separate paths. | “Exclude all routes” is not “scan all server manifests,” and NFT exclusions cannot stop Next's post-trace `.env` copy. | Same absolute trace/Turbopack root, explicit includes/excludes, every-NFT scan, sanitized standalone build, and complete copied-tree/symlink scan. |

## 5. Installed Next.js and security evidence

The repository warning says this is not a generic Next.js task. The revision therefore uses installed 16.2.10 material:

- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` documents `allowedOrigins`. Installed `node_modules/next/dist/server/app-render/action-handler.js` parses the incoming Origin and compares host values; the coarse check does not provide the guide's required exact scheme policy and does not reject a missing Origin by itself. Next can reject malformed Origin values and decodes action arguments before calling the exported function, so the application guard is accurately scoped as the first application-controlled operation—not as code that precedes framework decoding. See the [official Server Actions configuration reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions).
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` explicitly documents `revalidatePath("/", "layout")` for invalidating the root layout and all pages beneath it. See the [official `revalidatePath` reference](https://nextjs.org/docs/app/api-reference/functions/revalidatePath).
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` defines route-keyed trace includes/excludes; `turbopack.md` requires an absolute root. See the [official output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [Turbopack](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack) references.
- Installed `node_modules/next/dist/build/index.js` copies loaded `.env` and `.env.production` into standalone output after normal traced-file copying. This is why a sanitized workspace and full copied-tree scanner are required; trace exclusions alone are insufficient.
- Route Handler/backend-for-frontend behavior is grounded in the installed `route.md` and `backend-for-frontend.md`, plus the [official Route Handler reference](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [backend-for-frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend).

Security review uses maintainer primary sources:

- The applicable [Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-26hh-7cqf-hhc6) identifies 16.2.6 as the patched 16.2.x threshold; installed 16.2.10 exceeds it. The [Next.js advisory index](https://github.com/vercel/next.js/security/advisories) remains the implementation-time recheck source.
- The React team's [December 2025 security update](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components) identifies 19.2.4 as the safe 19.2.x backport; installed React/React DOM exactly meet it.

These findings do not justify changing `package.json` or `package-lock.json`. Advisory status is time-sensitive, so each future implementation/release session must recheck primary sources against the then-installed versions.

## 6. Revised delivery architecture

The major planning correction is ordering:

1. Immediate documentation safety corrections.
2. Test isolation, hash/parser compatibility locks, safe temporary DB execution, and strict path/environment/migration preflight.
3. Service-owned domain write contracts, exact money conversion, split integrity, and safe demo seed.
4. File-atomic import/map/CLI account behavior, default-category atomicity, and excluded-budget consistency.
5. Active-category semantics, account currency/repair, truthful aggregate states, and compatibility/detailed export.
6. Build/trace privacy, telemetry, exact browser mutation boundaries, bounded upload/no-store headers, root-layout revalidation, and enforced service boundaries.
7. Private backup/runtime operations, systemd hardening, accessibility, and documentation/release reconciliation.

This sequence reduces rework in three concrete ways:

- no behavior package relies on shared mutable tests or an unsafe default build target;
- service contracts and exact cents exist before split/import/export/currency behavior uses them;
- origin, upload, response, cache, and route-service policies land as one coherent browser boundary after transport results stabilize.

The guide keeps narrow modules and injectable services. It explicitly rejects a generic repository layer, currency conversion abstraction, new multipart dependency, and speculative index/migration.

## 7. Deferred and deliberately over-specified work

The following remain RFCs, not selected implementation work:

- automated restore;
- transfer candidate pairing;
- refund modeling;
- mixed-sign split policy;
- exchange rates/conversion;
- cross-file duplicate override;
- authentication/authorization.

The original guide included a detailed automated-restore preview. That detail is useful as a safety constraint, but implementing it would be a destructive feature with failure-atomicity and service-quiescence requirements. The revision preserves it only as RFC-06 and makes validated private backups plus an offline path-aware manual runbook the selected remediation.

Likewise, the frozen import hash's cross-file collision is not “fixed” by salting or rewriting hashes. Refunds, transfers, and mixed-sign allocations are financial policy, not parser cleanup. Authentication would change the product boundary rather than close the selected local/trusted-network risks.

## 8. Uncertainty and residual-risk ledger

| Uncertainty / residual risk | Current evidence | Required future disposition |
| --- | --- | --- |
| Production runtime behavior | No production server or real deployment was started for this documentation task. | After safe-target work, run a bounded loopback fake-DB production smoke and inspect headers, binding, cancellation, and shutdown. |
| Future standalone privacy | Historical traces show inclusion risk; installed source shows separate env copying. No sanitized standalone tree was built. | Build only in a sanitized copied workspace, scan every NFT and the complete copied tree/symlink targets, then retain that as a release gate. |
| Real filesystem modes and systemd/NVM behavior | Code/template inspection supports the gap; no private artifact or host service was inspected. | Use fake artifacts for mode tests; conduct operator-authorized read-only installation audit and `systemd-analyze verify` later. |
| Proxy/forwarded-header trust | Full-origin policy depends on the documented loopback reverse-proxy topology. | Test direct and proxy paths, reject forwarded headers outside that topology, and record the deployment assumption. |
| `Intl.NumberFormat` currency acceptance | It proves runtime renderability but is not an authoritative ISO 4217 registry and can accept reserved/user-defined identifiers. | Document the contract, test it, and add no registry package unless product requirements change. |
| Strict CSV compatibility | Disabling relaxed quotes/column counts can reject malformed files that prior code partially accepted. | Treat rejection as intentional file-atomic safety; provide row-number diagnostics and explicit map/date correction, never partial mutation. |
| Streaming export snapshot/cancellation | Design is decision-complete but not implemented or measured. | Test a dedicated read-only WAL snapshot, >1,000 rows, concurrent writes, cancellation, close/rollback, and query count. |
| Real historical data anomalies | Existing invalid currencies, split mismatches, partial defaults, or seeded rows were not inspected. | Provide read-only diagnostics and explicit repair workflows; never auto-repair or infer private data state. |
| Future advisories | Security status can change after 2026-07-13. | Recheck Next/React maintainer advisories at each implementation/release boundary. |

## 9. Final disposition

The revised `IMPLEMENTATION_GUIDE.md` remains the single authoritative north-star plan. It is now materially stronger because its dependency graph, package summaries, detailed contracts, acceptance tests, release gates, documentation matrix, and kickoff advice describe the same seven-stage program.

This documentation task intentionally changes no package, lockfile, schema, migration, production source, private data, database, service, or deployment state. Runtime truth remains to be established by the fake-data implementation and verification gates defined in the guide.

## 10. Documentation-revision verification

The revision itself was checked without adding a Markdown dependency:

- `git diff --check`: passed for tracked changes.
- `git diff --no-index --check /dev/null IMPLEMENTATION_GUIDE.md`: produced no whitespace diagnostics; exit status 1 is the expected all-new-file difference status.
- `git diff --no-index --check /dev/null IMPLEMENTATION_PLAN_ANALYSIS.md`: produced no whitespace diagnostics; exit status 1 is the expected all-new-file difference status.
- A dependency-free Node check found balanced fenced blocks, no duplicate same-level headings outside fences, and no missing local Markdown link targets.
- Targeted `rg` checks found no stale resource-bounding alternative, warn-and-insert contract, permissive path rollout, wildcard origin as desired policy, blanket trace-coverage assertion, or unresolved pagination/lowercase-currency alternative. The only strict-threshold phrase is the deliberate correction that React exactly meets rather than strictly exceeds its threshold.
- An independent read-only review reported no blocking findings. Its three consistency findings—telemetry-preload trace retention, Server Action/framework ordering, and pagination/lowercase-currency alternatives—were reconciled in the guide.
- Final status is intentionally limited to the pre-existing user-owned `CLAUDE.md` link plus the two planning documents: `M CLAUDE.md`, `?? IMPLEMENTATION_GUIDE.md`, and `?? IMPLEMENTATION_PLAN_ANALYSIS.md`.

The 103-test, lint, TypeScript, exact-name, hash, and migration results in Section 3 were not rerun for a documentation-only revision. No production build was run for the safety reason already stated.
