# TOOL-GRAPHIFY-001 — Completion Report

> Work item: `TOOL-GRAPHIFY-001` (Graphify tooling-adoption pilot),
> recorded by the docs-only closeout `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`.
>
> Implementer: `CLAUDE` (docs-closeout only; the pilot itself was performed
> locally by Owner). Reviewer: `CODEX_READ_ONLY`.

## 1. Objective

Complete the four-step tooling-adoption gate (`docs/governance/WORKFLOW.md`
§12) for Graphify — install, config, dry run, pilot — as a project-scoped,
code-only, local tool for Claude's codebase navigation, and record the
resulting evidence into the repository's source-of-truth documents without
touching any product source, schema, migration, API, UI or dependency.

## 2. Install / config / dry-run / pilot evidence

- **Install**: package `graphifyy==0.9.48`; CLI `graphify 0.9.48`. Installed
  as a project-scoped skill at `.claude/skills/graphify/SKILL.md`, outside
  product source.
- **Config**: single writable worktree, Claude-only write, Codex-only
  read-only review preserved. PreToolUse hooks, strict mode, watch mode and
  MCP were not enabled.
- **Dry run**: a code-only build (`--code-only`) — no product behavior
  change, no LLM backend, no API key.
- **Pilot**: one observable pilot query against the resulting graph,
  described below (§4).

All four evidence points were independently re-verified read-only by
Claude in `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`'s preflight (see
`docs/daily/2026-08/2026-08-22-worklog.md` §10): `graphify --version`
returns `0.9.48`; the skill file and `graphify-out/graph.json` /
`GRAPH_REPORT.md` exist; the graph's `built_at_commit` equals the current
baseline HEAD (not stale). No rebuild or `/graphify .` invocation was
performed to obtain this evidence.

## 3. Local-only file/config and security/data boundary

- `graphify-out/` (graph JSON, HTML viz, report) is local to this
  workspace, excluded from Git via `.git/info/exclude`, and not committed.
- `.claude/skills/graphify/SKILL.md` (and its `.graphify_version` sidecar)
  is a tracked project-scoped skill file, not product source; it does not
  affect `Back_End/**` or `Front_End/**` build/runtime behavior.
- No API key or LLM backend is configured for Graphify. No secret, token,
  cookie or credential is present in any Graphify config or output file
  reviewed for this report.
- Graph availability is local to this workspace only — it is not shared,
  synced or pushed anywhere.

## 4. Build statistics and pilot query/result

- Indexed: 625 code files.
- Intentionally skipped (code-only build): 370 non-code files — 52 docs, 2
  papers, 316 images.
- Resulting graph: 3,848 nodes, 9,607 edges, 186 communities.
- Pilot query asked which `Front_End/Admin_Web` files own reservation
  runtime mutations, creation-form state, and board view state. Result
  correctly identified:
  - `reservationRuntime.ts` — reservation runtime/domain-like mutations
    (`reservationRuntimeReducer`, `canMove`, `findBlockingItem`,
    `computeFolioSummary`, and related helpers).
  - `CreateReservationForm.tsx` — creation-form reducer/local state
    (`validateForm`, composed with `GuestDetailsSection.tsx`,
    `ReservationUnitEditor.tsx`, `ReservationReviewDialog.tsx`).
  - `ReservationBoard.tsx` — board presentation/view state, wiring the
    reducer to `ReservationTimeline.tsx`, `ReservationBoardToolbar.tsx`,
    and related dialogs.
  - The query was truncated at its ~1,200-token result budget (759 nodes
    found, 32 shown), but all three required ownership nodes were present
    among the shown results and the synthesized ownership answer was
    correct. No token-saving percentage claim was accepted or verified as
    part of this pilot.

## 5. Detected installer side effects and cleanup

The stock Graphify installer unexpectedly modified files outside the
project skill boundary:

- Root `CLAUDE.md` was modified by the installer. Owner restored it from
  `HEAD`; Claude independently confirmed in this session that root
  `CLAUDE.md` carries no Graphify installer section.
- `.claude/settings.json` was created by the installer. Owner moved it
  outside the repository. Claude independently confirmed in this session
  that `.claude/settings.json` does not exist in the worktree.
- PreToolUse hooks were confirmed not enabled.
- The project skill (`.claude/skills/graphify/SKILL.md`) and local graph
  outputs (`graphify-out/`) remain installed, as intended by the pilot.
- GitNexus was not removed or modified by the Graphify install.
- `git status --short --untracked-files=all` was clean before this
  session's first edit.

## 6. Disabled / not-adopted capabilities

The following Graphify capabilities are explicitly not adopted by this
pilot and remain prohibited unless a future, separately Owner-authorized
tooling work item changes policy:

- Full semantic extraction pipeline (LLM-backed doc/paper/image
  extraction) — this pilot only ran the code-only, AST-based path.
- Graphify subagent dispatch for semantic chunking.
- Strict mode.
- PreToolUse hooks / automatic post-commit rebuild hook.
- Watch mode (`--watch`).
- MCP stdio server (`--mcp`).
- Automatic graph rebuild on staleness — a stale graph must be reported,
  not silently rebuilt, unless the current Master Execution Prompt
  explicitly authorizes a rebuild.

## 7. Known limitations

- The graph is **code-only**: docs, papers and images in this repository
  are not indexed at all (370 files intentionally skipped), let alone
  semantically.
- No LLM-generated community labels exist for this graph — no Gemini/other
  API key was configured, so community naming, if used later, would need a
  separate step.
- The graph can become **stale** relative to `HEAD` as source changes;
  nothing in this pilot keeps it automatically in sync. Every future user
  of the graph must compare its `built_at_commit` against current `HEAD`
  before trusting it (`AGENTS.md` §10, `docs/governance/WORKFLOW.md` §12).
- No token-saving percentage claim for using Graphify versus direct
  source/grep search has been validated in this pilot; none should be
  assumed from this report.
- Graph availability is local to this workspace only — another Claude Code
  session or machine has no access to it without repeating the build.

## 8. Rollback

If Graphify adoption needs to be reversed:

1. Remove the local project skill: delete
   `.claude/skills/graphify/SKILL.md` and its `.graphify_version` sidecar.
2. Remove the local graph output: delete the `graphify-out/` directory.
3. Uninstall the `uv` tool: `uv tool uninstall graphifyy` (or the
   equivalent `pip uninstall graphifyy` if installed via pip instead of
   `uv`).
4. Restore any local ignore configuration: confirm `.git/info/exclude` (or
   `.gitignore`, if later moved there) no longer needs its `graphify-out/`
   entry once the directory is removed.

No product source, schema, migration, API, UI or dependency change is
involved in this rollback — it only removes local tooling.

## 9. Product behavior statement

No product behavior changed as a result of this pilot or this docs-closeout
work item. `Back_End/**` and `Front_End/**` are untouched. Admin Web
remains an interactive Reservation Board frontend prototype running on
local deterministic mock state only — no database, no Admin
authentication/RBAC, no OTA behavior. Backend Calendar/PMS (the PMS
blueprint TARGET architecture from PR #31) **remains unimplemented**: no
table, column, constraint, migration, entity, endpoint or UI described in
`docs/design/PMS-DATA-001-core-database-blueprint-v2.md` exists in the
current schema or codebase. Graphify adoption is a change to local tooling
state only (§3 of `docs/project/SNAPSHOT.md`'s three-layer distinction),
not to tracked repository state or product/backend implementation state.
