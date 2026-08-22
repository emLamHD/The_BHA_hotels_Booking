# TOOL-GRAPHIFY-001 — Completion Report

> Work item: `TOOL-GRAPHIFY-001` (Graphify tooling-adoption pilot), gate
> closed by a Claude-run governance replay (`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT-C4`)
> after an initial Owner-run preliminary pilot and correction cycle C1–C3
> under the docs-only closeout `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`.
>
> Implementer of the gate-closing replay: `CLAUDE`. Reviewer: `CODEX_READ_ONLY`.
> The original preliminary pilot was performed locally by Owner and is
> retained below as historical evidence only — it is not, by itself, the
> basis on which this report states `PASS — CLOSED`.

## 0. Implementer/evidence model — read this first

Two distinct evidence layers exist for `TOOL-GRAPHIFY-001`. They must not
be conflated:

1. **Layer A — Owner-run preliminary pilot (2026-08-22, historical).**
   Owner personally performed install/config/dry-run/pilot on their local
   machine. The technical result was correct, but Owner — not Claude —
   performed the filesystem writes. Under this repository's single-writer
   invariant (`docs/governance/RULES.md` §2.4, §3: Claude is the only
   writable implementer at every phase), a pilot Owner personally executed
   cannot by itself close a tooling-adoption gate, even after Claude
   re-verifies the result read-only. Codex identified this exact defect
   as a P1 finding on PR #34. Owner accepted the finding and selected
   **Option A**: no retrospective exception was added to `RULES.md`;
   instead Claude was authorized to replay the pilot as sole writable
   implementer.
2. **Layer B — Claude-run governance replay, `C4` (gate-closing).**
   Claude, holding sole write access to the worktree for the duration of
   the correction, independently repeated install → config → dry run →
   pilot from a verified starting state, self-detected and cleaned the
   installer's known side effects, and additionally probed graph reuse
   from a separate read-only session. **This report's `PASS — CLOSED`
   status is based on Layer B, not Layer A.** Layer A is retained below
   only as preliminary/historical context.

Full narrative evidence for both layers is also recorded in
`docs/daily/2026-08/2026-08-22-worklog.md` §9–§10 (Layer A) and §14
(Layer B, correction C4).

## 1. Objective

Complete the four-step tooling-adoption gate (`docs/governance/WORKFLOW.md`
§12) for Graphify — install, config, dry run, pilot — as a project-scoped,
code-only, local tool for Claude's codebase navigation, with Claude as the
implementer who actually performs and closes the gate, and record the
resulting evidence into the repository's source-of-truth documents without
touching any product source, schema, migration, API, UI or dependency.

## 2. Install / config / dry-run / pilot evidence

### Layer A — Owner-run preliminary pilot (historical)

- **Install**: package `graphifyy==0.9.48`; CLI `graphify 0.9.48`. Installed
  by Owner as a project-scoped skill at `.claude/skills/graphify/SKILL.md`,
  outside product source.
- **Config**: single writable worktree, Claude-only write, Codex-only
  read-only review preserved. PreToolUse hooks, strict mode, watch mode and
  MCP were not enabled.
- **Dry run**: a code-only build (`--code-only`) — no product behavior
  change, no LLM backend, no API key.
- **Pilot**: one observable pilot query against the resulting graph
  (results in §4, Layer A).

All four Layer A evidence points were re-verified **read-only** by Claude
during `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` correction cycles C1–C3 (see
`docs/daily/2026-08/2026-08-22-worklog.md` §10): `graphify --version`
returned `0.9.48`; the skill file and `graphify-out/graph.json` /
`GRAPH_REPORT.md` existed; the graph's `built_at_commit` equaled the then-
current baseline HEAD (not stale). No rebuild was performed for this
layer — and, per Codex's P1 finding, this read-only re-verification of an
Owner-performed write is exactly what does **not** satisfy the single-
writer invariant, which is why Layer B exists.

### Layer B — Claude-run governance replay (`C4`, gate-closing)

Performed entirely by Claude as sole writable implementer, after backing
up and isolating Owner's Layer A artifacts outside the repository
(see §5):

- **Install**: exact CLI version `0.9.48` was already present —
  **verified via `graphify --version` / `uv tool list`, not reinstalled**,
  per the Master Correction Prompt's explicit "verification is acceptable"
  allowance when the installed version already matches. Claude then ran
  the project-scoped installer itself: `graphify install --project`
  (syntax confirmed via `graphify install --help` before running),
  recreating `.claude/skills/graphify/SKILL.md` + `references/` +
  `.graphify_version`.
- **Config**: unchanged invariant preserved — single writable worktree,
  Claude-only write, Codex-only read-only review. No `--strict`, no
  `graphify claude install`, no global-scope install, no watch mode, no
  MCP were used.
- **Dry run**: `graphify extract . --code-only` (no LLM backend, no API
  key, no docs/paper/image semantic extraction), which also ran
  deterministic clustering by default; followed by `graphify cluster-only .`
  to regenerate `GRAPH_REPORT.md`/`graph.html` and confirm re-clustering
  behavior. Full statistics in §4, Layer B.
- **Pilot**: the same pilot query, re-run against the Claude-built graph,
  with its result independently checked against source (not accepted on
  the graph's word alone) — see §4, Layer B.

## 3. Local-only file/config and security/data boundary (current, post-C4)

- `graphify-out/` (graph JSON, HTML viz, report) is local to this
  workspace, excluded from Git via `.git/info/exclude`, and not committed.
- `.claude/skills/graphify/` (the full directory — `SKILL.md`, the
  `.graphify_version` sidecar, and the entire `references/**` tree) is
  **workspace-local, project-scoped** — "project-scoped" describes where
  Claude Code discovers and applies it in the current workspace, not that
  it is repository-tracked. `git ls-files` returns no match for
  `.claude/skills/graphify/**`; the whole path is excluded locally via
  `.git/info/exclude`, so none of it is committed and none of it carries
  product source either way. A fresh clone, another worktree, or another
  developer machine will **not** automatically contain this skill or the
  graph — availability must be independently verified in each workspace
  before relying on it.
- Root `.graphifyignore` also exists in this workspace, created for this
  Graphify adoption (currently just `.git/`, `.gitnexus/`, `graphify-out/`
  — no sensitive content). Like the skill and graph, it is excluded from
  Git via `.git/info/exclude` and is not tracked. It is part of the local
  Graphify surface and is covered by the rollback procedure (§9) — it is
  not hidden from that inventory.
- No API key or LLM backend is configured for Graphify. No secret, token,
  cookie or credential is present in any Graphify config or output file
  reviewed for this report, including the C4 replay's backup manifest and
  probe transcripts (both stored outside the repository; scanned for
  common secret patterns with none found).
- Graph availability is local to this workspace only — it is not shared,
  synced or pushed anywhere.

## 4. Build statistics and pilot query/result

### Layer A — Owner-run preliminary pilot (historical numbers)

- Indexed: 625 code files.
- Intentionally skipped (code-only build): 370 non-code files — 52 docs, 2
  papers, 316 images.
- Resulting graph: 3,848 nodes, 9,607 edges, 186 communities.
- Pilot query result correctly identified `reservationRuntime.ts`,
  `CreateReservationForm.tsx` and `ReservationBoard.tsx` as the three
  ownership nodes (truncated at query budget, but the required nodes and
  synthesized result were correct).

### Layer B — Claude-run replay (`C4`, actual current evidence)

- Indexed: 624 code files.
- Intentionally skipped (code-only build): 371 non-code files — 53 docs, 2
  papers, 316 images.
- The classified-file total is identical to Layer A (624+371 = 625+370 =
  995), and a `git diff --name-status` between the Layer A baseline commit
  and the C4 replay HEAD showed only `.md` (documentation) changes — the
  new `docs/reports/TOOL-GRAPHIFY-001-completion.md` (this file) accounts
  for the +1 doc / −1 code shift in classification; no code file was lost.
- Resulting graph: **3,848 nodes, 9,607 edges — identical to Layer A**,
  confirming the underlying corpus/graph content is equivalent between the
  two runs. Community count: 183 immediately after `extract`, then 184
  after a subsequent `cluster-only` re-run on the *same, unchanged* graph
  (node/edge counts identical both times). This run-to-run community-count
  drift (183→184→ vs. Layer A's 186) is consistent with expected
  non-determinism in Louvain-style community detection on a graph of this
  size, not data loss — it is reported honestly here rather than
  overwritten with the Layer A numbers. All node/edge/community counts
  were independently re-parsed from `graphify-out/graph.json` with a
  general-purpose JSON parser (not taken from the CLI's own printed
  summary alone); `built_at_commit` in the file equals the C4 replay HEAD.
- Pilot query (same three-part question) re-run against the Layer B graph.
  Result again identified `reservationRuntime.ts`, `CreateReservationForm.tsx`
  and `ReservationBoard.tsx` as the three ownership nodes.
- **Independent source validation** (required for C4, not performed for
  Layer A): the graph's answer was checked directly against source with
  `rg`, not accepted on the graph's word alone —
  `export function reservationRuntimeReducer` at
  `reservationRuntime.ts:501`; `function formReducer`, `function
  validateForm`, and `useReducer(formReducer, ...)` in
  `CreateReservationForm.tsx`; `useReducer(reservationRuntimeReducer, ...)`
  alongside a distinct set of `useState` presentation/view-state calls
  (`selectedPropertyId`, `rangeLength`, `anchorDate`, `filters`,
  `draggedItemId`, etc.) in `ReservationBoard.tsx`. The graph's answer
  agreed with source in full; no disagreement was found.
- No token-saving percentage claim was accepted or verified in either
  layer.

## 5. Installer side effects — reproduced and cleaned by Claude in C4

The stock Graphify installer's side effects, first observed during Owner's
Layer A pilot and cleaned up by Owner at that time, were **independently
reproduced when Claude itself ran the installer in C4**, then detected and
cleaned by Claude in the same replay:

- Root `CLAUDE.md`: `graphify install --project` wrote a "graphify
  section" to it (confirmed via `git diff CLAUDE.md` showing the exact
  known insertion). Claude restored it with `git checkout -- CLAUDE.md`
  and confirmed its sha256 hash matched `git show HEAD:CLAUDE.md` exactly.
- `.claude/settings.json`: the installer created it with a `PreToolUse`
  hook block (`Bash|Grep` and `Read|Glob` matchers routed to
  `graphify hook-guard`). Claude removed it (`rm -f
  .claude/settings.json`) and confirmed its absence afterward.
- PreToolUse hooks, strict mode, watch mode and MCP were confirmed not
  enabled in the final, stable workspace state after cleanup.
- The project skill (`.claude/skills/graphify/SKILL.md` + sidecars) and
  local graph outputs (`graphify-out/`) — recreated by Claude in C4 — were
  retained, as intended by the replay.
- GitNexus was not removed or modified at any point.
- `git status --short --untracked-files=all` was clean immediately before
  Claude's first C4 edit and remained clean throughout, apart from the
  transient installer-created files described above, which were cleaned
  before the replay was declared `PASS`.

## 6. New-session reuse probe (`C4` Phase 3 — not performed for Layer A)

A separate `claude` CLI process (an OS subprocess launched via `Bash`, not
the `Agent` tool — zero subagents spawned, confirmed via the session's own
`subagent_stats.spawned: 0`) was run in `-p`/`--print` non-interactive mode
in the same workspace, restricted with `--allowedTools 'Bash(graphify
query *)'` and a `--disallowedTools` list explicitly blocking
Edit/Write/NotebookEdit/Agent/git/rm/mv/cp/gh and every other Graphify
subcommand.

- **First attempt** self-blocked with `BLOCKED_PENDING_SCOPE_CLARIFICATION`,
  citing the `GRAPHIFY_POLICY` gate this same work item's correction C3
  had just added to `AGENTS.md` §10 — direct proof the new session read
  live, current governance text rather than acting on a cached assumption
  or the task description alone.
- **Second attempt**, given an explicit `GRAPHIFY_POLICY:
  ALLOWED_IF_RELEVANT` citation matching C4's
  `OWNER_AUTHORIZED_TOOL_UNDER_TEST_ACTIONS` carve-out, ran the query
  successfully and returned all three required ownership nodes in
  substance. Its own attempt to run an additional, non-allowlisted
  `ls`/`git status` self-check was **denied by the CLI's own
  tool-permission system** (visible in the session JSON's
  `permission_denials` array) — proof the read-only restriction was
  enforced at the tool level, not merely requested in the prompt.
- `sha256` hashes of `graphify-out/graph.json` and
  `.claude/skills/graphify/SKILL.md` were identical before and after both
  probe attempts; `git status --short --untracked-files=all` was clean
  before and after. The probe reused the existing graph without rebuilding
  it.
- Both sessions' sanitized JSON transcripts were saved outside the
  repository alongside the C4 backup and inventory manifest, and scanned
  for common secret patterns (api-key/password/secret/token/bearer) with
  none found.

## 7. Disabled / not-adopted capabilities

The following Graphify capabilities are explicitly not adopted by this
pilot/replay and remain prohibited unless a future, separately
Owner-authorized tooling work item changes policy:

- Full semantic extraction pipeline (LLM-backed doc/paper/image
  extraction) — both layers only ran the code-only, AST-based path.
- Graphify subagent dispatch for semantic chunking.
- Strict mode.
- PreToolUse hooks / automatic post-commit rebuild hook.
- Watch mode (`--watch`).
- MCP stdio server (`--mcp`).
- Automatic graph rebuild on staleness — a stale graph must be reported,
  not silently rebuilt, unless the current Master Execution Prompt
  explicitly authorizes a rebuild.

## 8. Known limitations

- The graph is **code-only**: docs, papers and images in this repository
  are not indexed at all (371 files intentionally skipped in the C4
  replay), let alone semantically.
- No LLM-generated community labels exist for this graph — no Gemini/other
  API key was configured, so community naming, if used later, would need a
  separate step.
- The graph can become **stale** relative to `HEAD` as source changes;
  nothing in this pilot/replay keeps it automatically in sync. Freshness
  is **not** simply raw `built_at_commit != HEAD` inequality — the full
  input-aware rule in `AGENTS.md` §10 / `docs/governance/WORKFLOW.md` §12
  applies: compare files changed since `built_at_commit` against the
  graph's actual build-input set (its code-only build profile), not every
  tracked path. Concretely for this replay: the retained graph's
  `built_at_commit` is `62f2f82d67fb1f80f3204c58ef3351d6e8f6fe8d`, while
  the tracked commits that followed it (recording this very report, and
  correction C5's alignment pass) only touched the six allowed
  documentation files — none of which fall inside the code-only graph's
  input set. Under the input-aware rule, that does **not** stale the
  graph; a future user must still re-check the rule (not assume permanent
  freshness) against whatever `HEAD` is current when they rely on it.
  Graph metadata was not regenerated to chase this — the rule is applied,
  not the timestamp forced to match.
- Community-detection counts are not exactly reproducible run-to-run on an
  otherwise-unchanged graph (§4, Layer B) — treat exact community counts
  as approximate, not as an exact-match integrity check; node and edge
  counts are the more reliable structural signal.
- No token-saving percentage claim for using Graphify versus direct
  source/grep search has been validated in either layer; none should be
  assumed from this report.
- Graph availability is local to this workspace. A new Claude Code session
  opened in the same workspace can reuse the existing local skill and graph
  after verifying their existence and freshness (demonstrated directly in
  §6); it must not rebuild merely because the session is new. A fresh
  clone, separate worktree, different repository path or another machine
  will not automatically contain these workspace-local artifacts.

## 9. Rollback

This is a **documented procedure only** — it has not been executed as part
of this report or correction C5. If Graphify adoption needs to be
reversed, remove or restore the **complete** local Graphify surface, not
just the top-level skill file:

1. Remove the complete project skill directory: delete
   `.claude/skills/graphify/` in full — this includes, without limiting
   cleanup to, `SKILL.md`, the `.graphify_version` sidecar, and the entire
   `references/**` tree (`extraction-spec.md`, `exports.md`, `update.md`,
   `add-watch.md`, `github-and-merge.md`, `query.md`, `hooks.md`,
   `transcribe.md` as of this replay — plus any other installer-created
   file later added under that directory). Deleting only `SKILL.md` and
   `.graphify_version` leaves the installer-created `references/` tree
   behind and does not constitute a complete rollback.
2. Remove the complete local graph output: delete the `graphify-out/`
   directory in full (graph JSON/HTML, `GRAPH_REPORT.md`, manifest, cache,
   and any other generated file under it).
3. Handle root `.graphifyignore`: this file exists in the current
   workspace (created for this Graphify adoption, currently containing
   only standard exclude patterns — `.git/`, `.gitnexus/`, `graphify-out/`
   — no sensitive content). Remove it if it was created solely for this
   Graphify installation, as it was here; if a workspace instead had a
   pre-existing `.graphifyignore` before adoption, restore that prior
   version from backup instead of deleting it — never blindly delete
   unrelated user-authored ignore rules.
4. Handle `.claude/settings.json` and root `CLAUDE.md` safely: remove any
   Graphify-created `.claude/settings.json` (the installer's `PreToolUse`
   hook block) if present; restore any pre-existing settings from backup
   rather than deleting unrelated configuration if the file predates
   Graphify. Ensure tracked root `CLAUDE.md` contains no Graphify
   installer section (compare against `git show HEAD:CLAUDE.md`).
5. Remove only the exact Graphify-specific entries from
   `.git/info/exclude` (`.claude/skills/graphify/`, `.claudeignore`,
   `.graphifyignore`, `graphify-out/`, and the `.claude/CLAUDE.md` line if
   it was added for Graphify) — or restore the pre-install snapshot of
   that file — while preserving any unrelated local exclusions already in
   it.
6. Remove Graphify-specific hooks, strict-mode configuration, watch
   processes, and MCP configuration if any were later enabled by a
   separately authorized tooling work item (none are enabled as of this
   report — §7).
7. Uninstall the exact CLI package through the recorded installation
   mechanism when full tool removal is intended: `uv tool uninstall
   graphifyy` (or the equivalent `pip uninstall graphifyy` if installed
   via `pip` instead of `uv`).
8. Verify rollback completion: the full `.claude/skills/graphify/`
   directory is absent; `graphify-out/` is absent; `.graphifyignore` is
   absent or restored to its pre-adoption state; `.claude/settings.json`
   is absent or restored; no unnecessary Graphify-specific
   `.git/info/exclude` entry remains; `git ls-files`/`git status` show no
   Graphify artifact/config tracked or staged; and unrelated local
   configuration (e.g. `.claude/settings.local.json`, any pre-existing
   `.graphifyignore` content) remains intact.

No product source, schema, migration, API, UI or dependency change is
involved in this rollback — it only removes local tooling. The C4 backup
(Owner's original Layer A artifacts, plus a pre-replay inventory manifest)
remains available outside the repository for reference/rollback even after
this rollback procedure, independent of it.

## 10. Product behavior statement

No product behavior changed as a result of either the Layer A preliminary
pilot, the Layer B (`C4`) governance replay, or this docs-closeout work
item as a whole. `Back_End/**` and `Front_End/**` are untouched — verified
via `git diff --stat` showing no product-path changes throughout C4.
Admin Web remains an interactive Reservation Board frontend prototype
running on local deterministic mock state only — no database, no Admin
authentication/RBAC, no OTA behavior. Backend Calendar/PMS (the PMS
blueprint TARGET architecture from PR #31) **remains unimplemented and
unopened**: no table, column, constraint, migration, entity, endpoint or
UI described in `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`
exists in the current schema or codebase, and no backend work item was
opened by this correction. Graphify adoption — in both layers — is a
change to local tooling state only (§5 of `docs/project/SNAPSHOT.md`'s
three-layer distinction), not to tracked repository state or
product/backend implementation state. `docs/governance/RULES.md` was not
modified at any point in this work item. PR #34 remains `OPEN`/`DRAFT`;
this report does not claim it was marked Ready, merged, or that any branch
was deleted.
