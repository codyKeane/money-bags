<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Autonomous Money Bags continuation

When the user explicitly authorizes autonomous implementation and periodic
local commits, follow `docs/AUTONOMOUS_WORKFLOW.md`.

- Resume from the top status block in `IMPLEMENTATION_GUIDE.md` and the
  intentionally untracked `CODEX_HANDOFF.md`; do not restart completed work.
- Work in one bounded package at a time. Run focused checks first, then the
  package-appropriate repository gates.
- Create local commits periodically after reviewable packages pass. Never push,
  fetch, pull, amend, tag, release, deploy, or rewrite history as part of this
  authority.
- For tracked-file-only packages, prefer `npm run checkpoint` with an explicit
  literal path list. It refuses pre-existing staged or intent-to-add state, the
  financial/runtime and credential path classes enumerated in
  `docs/AUTONOMOUS_WORKFLOW.md`, conflicts, detached/in-progress Git states,
  hooks, signing prompts, and untracked files. It always leaves
  `CODEX_HANDOFF.md` outside the commit.
- New files require one explicit `--new-file <path>` option per file. Never use
  `git add .`, `git add -A`, or another broad staging command.
- Keep real ledgers, imports, backups, `.env*`, credentials, services,
  deployments, and production hosts outside autonomous implementation.
- Update the handoff after each checkpoint with the actual revision, checks,
  residual risks, and exact next action.
