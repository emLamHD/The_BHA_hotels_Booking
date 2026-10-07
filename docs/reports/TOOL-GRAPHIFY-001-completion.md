# TOOL-GRAPHIFY-001 — Completion Report

> Work item: `TOOL-GRAPHIFY-001` (Graphify tooling-adoption), gate closed
> by a Claude-run governance replay (`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT-C4`)
> under the docs-only closeout `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`.
>
> Implementer of the gate-closing replay: `CLAUDE`. Reviewer:
> `CODEX_READ_ONLY`. `docs/governance/WORKFLOW.md` §12 is the canonical
> Graphify invocation policy; this report does not duplicate it.

## 1. Objective

Complete the four-step tooling-adoption gate for Graphify — install,
config, dry run, pilot — as an optional, workspace-local, code-only tool
for Claude's codebase navigation, with Claude as the implementer who
actually performs and closes the gate, without touching any product
source, schema, migration, API, UI or dependency.

## 2. Owner preliminary pilot vs. Claude governance-valid replay

Owner personally performed an initial install/config/dry-run/pilot on
their local machine. Technically correct, but Owner — not Claude —
performed the filesystem writes; under this repository's single-writer
invariant (`docs/governance/RULES.md` §2.4/§3), that cannot by itself
close a tooling-adoption gate, even after Claude re-verifies it read-only.
Codex flagged this as a P1 finding; Owner accepted it and selected
**Option A** (no retrospective exception to `RULES.md`; Claude replays the
pilot instead).

Claude then performed the actual gate-closing replay
(`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT-C4`) as sole writable implementer:
isolated and backed up Owner's prior artifacts outside the repository,
verified the exact CLI version (already `graphify 0.9.48` — verified, not
reinstalled), ran the project-scoped installer itself
(`graphify install --project`), rebuilt the code-only graph and ran
clustering, re-ran the pilot query, and confirmed a separate read-only
Claude Code session could reuse the resulting graph without rebuilding it.
**This report's `PASS — CLOSED` status is based on that replay, not on
Owner's preliminary pilot.** `docs/governance/RULES.md` was not modified.

## 3. Essential functional evidence (from the C4 replay)

- CLI: exact version `0.9.48` confirmed present and verified, not
  reinstalled.
- Install: `graphify install --project` run by Claude; recreated the
  project-scoped skill outside product source.
- Installer side effects: the installer wrote a "graphify section" into
  root `CLAUDE.md` and created `.claude/settings.json` with a `PreToolUse`
  hook — both were detected and removed/restored by Claude in the same
  replay. Root `CLAUDE.md` matches tracked `HEAD` exactly; no
  `.claude/settings.json`, hook, strict mode, watch mode or MCP remains
  enabled.
- Dry run: `graphify extract . --code-only` (no LLM backend, no API key)
  followed by clustering — completed successfully.
- Pilot: the query correctly identified `reservationRuntime.ts`,
  `CreateReservationForm.tsx` and `ReservationBoard.tsx` as the files
  owning reservation runtime mutations, creation-form state, and board
  view state respectively. Claude independently checked this answer
  directly against source (`rg` for the relevant reducer/state
  declarations) rather than accepting the graph's word alone — the answer
  agreed with source in full.
- Reuse probe: a separate, tool-restricted, read-only Claude Code session
  in the same workspace reused the existing graph without rebuilding it,
  and returned the same three ownership areas; its own attempt to run an
  unauthorized command outside the allowed query was denied by the CLI's
  own permission system, and file hashes were identical before and after.
- No product file, dependency manifest, or lockfile changed at any point.

Raw file/node/edge/community counts from either the preliminary pilot or
the replay are recorded only as non-gating command output in
`docs/daily/2026-08/2026-08-22-worklog.md`; they are not evidence this
report relies on, and small run-to-run count drift (e.g. in community
detection) is expected and not investigated further here.

## 4. Local-only boundary

The skill directory (`.claude/skills/graphify/`), `graphify-out/`, and
root `.graphifyignore` are all workspace-local and excluded from Git via
`.git/info/exclude` — `git ls-files` returns no match for any of them. A
fresh clone, a different worktree, or another machine will **not**
automatically have Graphify; a new Claude Code session in the *same*
workspace can reuse the existing skill/graph without rebuilding (§3). No
API key or LLM backend is configured; no secret or credential is present
in any reviewed Graphify file.

Prohibited unless a future, separately Owner-authorized tooling work item
changes policy: full semantic extraction, Graphify subagents, strict mode,
PreToolUse hooks, watch mode, MCP, and automatic rebuild.

## 5. Known limitations

- The graph is **code-only** — docs, papers and images are not indexed at
  all.
- No LLM-generated community labels (no API key configured).
- The graph can become stale; freshness follows the input-aware rule in
  `docs/governance/WORKFLOW.md` §12 (a documentation-only change does not
  stale a code-only graph) rather than raw commit-SHA equality.
- No token-saving claim for Graphify versus direct source/grep search has
  been validated.

## 6. Rollback (documented, not executed)

1. Delete `.claude/skills/graphify/` in full (the whole directory, not
   just `SKILL.md`).
2. Delete `graphify-out/` in full.
3. Remove root `.graphifyignore` (created for this adoption) — or restore
   a prior version if one predated adoption.
4. Remove any Graphify-created `.claude/settings.json`; confirm root
   `CLAUDE.md` still matches tracked content.
5. Remove the Graphify-specific entries from `.git/info/exclude`
   (`.claude/skills/graphify/`, `.claudeignore`, `.graphifyignore`,
   `graphify-out/`), preserving unrelated local exclusions.
6. Uninstall the CLI package via its recorded mechanism (`uv tool
   uninstall graphifyy`, or `pip uninstall graphifyy` if installed via
   `pip`).
7. Verify: no Graphify path remains locally or in `git ls-files`; unrelated
   local configuration is untouched.

No product source, schema, migration, API, UI or dependency change is
involved in this rollback.

## 7. Product behavior statement

No product behavior changed. `Back_End/**` and `Front_End/**` are
untouched. Admin Web remains an interactive Reservation Board frontend
prototype on local deterministic mock state only. Backend Calendar/PMS
remains unimplemented and unopened. `docs/governance/RULES.md` was not
modified. PR #34 remains `OPEN`/`DRAFT` — this report does not claim it
was marked Ready, merged, or that any branch was deleted.
