# Autonomous Money Bags workflow

This workflow turns explicit user authorization for autonomous implementation
into a bounded, reproducible loop. It grants authority to create periodic
**local** commits. It never grants authority to push, fetch, pull, amend,
rewrite history, release, deploy, access real financial data, inspect secrets,
or operate production services.

## Sources of truth

At the start of every continuation:

1. Read `AGENTS.md`.
2. Read the top status block of `IMPLEMENTATION_GUIDE.md`.
3. Read the intentionally untracked `CODEX_HANDOFF.md`.
4. Verify `git status --short --branch`, `git log --oneline --decorate -4`,
   and `git diff --check`.

Historical work-package sections remain evidence, not live status. Never
restart a completed package merely because its original plan remains in the
guide.

## Autonomous loop

For each bounded package:

1. Establish the user/data outcome, frozen contracts, affected entry points,
   rollback path, and acceptance tests.
2. Preserve all pre-existing work. Stop if unrelated tracked changes overlap
   the package.
3. Use only synthetic content and throwaway temporary SQLite databases.
4. Add a failing regression before production code when practical.
5. Implement the smallest coherent change.
6. Run focused tests, then the applicable lint, type, build, privacy, migration,
   or integration gates.
7. Inspect the complete diff and run `git diff --check`.
8. Create one local checkpoint commit containing only that package.
9. Refresh `CODEX_HANDOFF.md` with the new revision, evidence, residual risks,
   and exact next action.
10. Select the next safe package from current repository evidence.

The loop stops only when no safe code or documentation package remains, or when
the next outcome requires new authority such as real-host operations, sensitive
environment review, a real screen reader, deployment, or real financial data.
Blocked manual evidence remains explicitly pending; it is never rounded into a
pass.

## Tracked-file checkpoint command

After the package checks pass, a checkpoint of explicit tracked files can be
created without staging unrelated work:

```bash
npm run checkpoint -- --message "fix: bounded checkpoint" -- \
  src/example.ts src/example.test.ts README.md
```

The mandatory `--` ends checkpoint options. Every following argument is one
literal repository-relative tracked file. The helper:

- requires one trimmed single-line message and 1–200 unique paths;
- verifies the package marker and canonical Git root;
- refuses detached HEAD, conflicts, and merge/rebase/cherry-pick/revert/bisect
  state;
- refuses every pre-existing staged change;
- refuses intent-to-add index entries and untracked files in the trailing
  tracked-file list, plus unchanged, deleted, directory, symlink, pathspec,
  and traversal selections;
- refuses `.git/**`, `data/**`, `imports/**`, `backups/**`, `.env*`,
  `node_modules/**`, `.next/**`, SQLite databases and sidecars, common private
  key/credential formats and locations, and `CODEX_HANDOFF.md`;
- runs `git diff --check` for the selected paths;
- uses literal pathspecs with `git commit --only`, so unrelated tracked changes
  and all untracked files remain outside the commit;
- clears hostile `GIT_*` environment overrides, disables Git prompts and
  signing, and uses an empty temporary hooks directory so a local hook cannot
  push or mutate external systems;
- verifies that the commit advanced the inspected HEAD, contains exactly the
  requested paths and bytes, and leaves no staged changes;
- prints the short commit ID and final concise status.

The helper never invokes a remote-capable Git command.

## New files

New files require a separate explicit option before the mandatory `--`:

```bash
npm run checkpoint -- --message "feat: bounded package" \
  --new-file path/to/new-file -- \
  path/to/existing-file
```

Repeat `--new-file` for each new regular file. The helper validates that each is
untracked, non-ignored under the effective repository and global Git ignore
rules, outside the enumerated protected path classes above, and resolves
exactly. It stages only those new paths, checks their staged diff for whitespace
errors, and removes that staging if validation or Git refuses the commit. It
still refuses `CODEX_HANDOFF.md`. Never use `git add .`, `git add -A`, or
`git add -u`.

If post-commit verification ever fails after Git advanced `HEAD`, the helper
returns exit 3 and prints `COMMITTED_WITH_VERIFICATION_FAILURE` plus the
revision and “Do not retry; inspect HEAD.” A pre-commit refusal returns exit 2
and never claims a commit exists.

## Verification profiles

The checkpoint command proves Git scope; it does not replace package testing.
Use the smallest relevant focus first. Executable behavior packages normally
finish with:

```bash
npm test -- --run
npm test -- --run --sequence.shuffle --sequence.seed 20260723
npm run lint
node node_modules/typescript/bin/tsc --noEmit
npm run build
npm run check:build-privacy
git diff --check
```

Run `npm run validate:build-privacy` when packaging/trace behavior changes or at
the final release-quality checkpoint. Migration changes require the populated
historical matrix and reviewed new migration metadata. Do not edit migrations
`0000` through `0006` or the frozen import hash.

## Handoff state

`CODEX_HANDOFF.md` remains intentionally untracked so it can describe the
current working revision without creating self-referential follow-up commits.
It must state:

- current branch, `HEAD`, and remote relationship;
- the last completed local commit;
- exact verification commands and results;
- known warnings and residual risks;
- manual or separately authorized gates that remain;
- the exact next safe action;
- whether anything was pushed or deployed.
