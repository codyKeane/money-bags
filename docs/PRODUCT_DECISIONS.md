# Money Bags product decisions

> Prepared: 2026-07-17
> Scope: autonomous completion of the remaining decision-gated product work

This record resolves the deferred decisions named by `IMPLEMENTATION_GUIDE.md`.
The existing import hash and migrations `0000` through `0005` remain immutable.
All new behavior is additive and is verified only with synthetic ledgers and
throwaway databases.

## Import identity and duplicate review

The frozen hash remains
`sha256(accountId|date|amountCents|normalizedDescription|occurrenceIndex)`.
An import computes a source-file fingerprint and reports hash collisions as
reviewable duplicate candidates. A user may explicitly override a candidate;
the override inserts a normal transaction with a null `importHash` and a
separate provenance row containing the source fingerprint, row number, and
original hash. The same source file/row cannot be overridden twice while its
batch exists. Undo removes the transaction, provenance, and batch together.
Different source files may each receive an explicit override for the same
frozen hash. Ordinary re-imports remain idempotent and never auto-override.

## Transfer pairing

Transfer candidates require opposite signed amounts with equal absolute cents,
different accounts, valid equal currencies, and dates within three calendar
days. A candidate is advisory only. Pairing is an explicit one-to-one action;
paired transactions remain in the ledger and export, but both are excluded
from income, spending, trend, and budget aggregates regardless of category.
Unpairing restores their ordinary category semantics. A transaction cannot be
simultaneously paired as a transfer and linked as a refund.

## Refunds

A refund is an explicit link from a positive transaction to an original
negative transaction on the same account and currency. Partial refunds are
allowed, but cumulative linked refund cents cannot exceed the original
outflow's absolute cents. The refund's own active category/splits determine
where the reduction appears; a linked refund contributes negative spending,
does not count as income, and reduces budget actuals. Unlinked positive rows
retain the existing income behavior. Linking never rewrites the original row.

## Mixed-sign splits

Mixed-sign split parts are allowed when every part is a nonzero safe integer and
the signed parts sum exactly to the parent. Aggregates use the signed parts as
stored: negative parts are spending and positive parts are income unless the
parent is explicitly a transfer or refund. The editor displays a warning for a
mixed-sign allocation and never normalizes or infers a refund/transfer from it.

## Currency presentation

Money Bags does not convert currencies. Existing compatibility scalar fields
remain unavailable for a mixed or invalid currency set, while dashboard data
is additionally grouped by each valid currency. Each group has its own net
worth, income, spending, budgets, and trend. Invalid accounts remain a repair
blocker and are never coerced into a group.

## Reconciliation and transaction controls

Transactions gain an explicit `cleared` flag, defaulting to false, and an
explicit `excludeFromSpending` flag, defaulting to false. The latter overrides
category inclusion for that row only; it never changes the category or budget
configuration. The transaction list can filter and toggle cleared state and
shows a running balance when an account is selected. Running balance uses the
account opening balance plus rows ordered by date, creation time, and ID.

## Accounts, merchants, and categories

Accounts gain an optional date for the opening balance. A missing date means
the opening amount is a current baseline and is excluded from historical trend
points; the current product does not yet render a net-worth-over-time chart.
Transactions gain an optional bounded merchant label; imports leave it
empty and rollups use a deterministic normalized description fallback. Category
merge is one explicit transaction: parent categories, split parts, and ignored
fallbacks move to the target, then the source is deleted. Source and target
must be distinct and both must exist.

## Guarded restore

Automated restore is a command-line operation, never an application route. It
defaults to preview and requires both `--confirm` and `--quiesced`, an absolute
backup path, and an absolute target path. The target must be the canonical
configured ledger and the backup must pass the existing standalone verifier.
The command acquires a no-clobber lock, creates a validated rescue copy,
stages and fsyncs the replacement, removes only target sidecars, atomically
publishes the replacement, and verifies integrity and schema afterward. Any
failure leaves the rescue and original target available for manual recovery;
the command never deletes the rescue implicitly.

## Explicit non-goals retained

Authentication, cloud sync, bank APIs, telemetry, remote fonts/CDN assets,
double-entry conversion, Docker/deployment-platform expansion, and broad
browser-test dependencies remain outside this local-first project. The manual
screen-reader and real-host gates still require their respective environments;
code and fake-data verification can proceed without pretending those gates
passed.
