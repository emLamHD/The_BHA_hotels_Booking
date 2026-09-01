# AGENTS.md — The BHA Hotels Booking

> Shared contract: a Master Execution Prompt selects one implementer that writes; the paired agent reviews read-only.
>
> `docs/governance/RULES.md` remains the highest repository-level authority.

## 1. Project identity

The BHA Hotels Booking is a monorepo:

- `Back_End/` — ASP.NET Core 8 Web API using Clean Architecture:
  `TheBha.Domain → TheBha.Application → TheBha.Infrastructure → TheBha.Api`.
- `Front_End/Customer_Web/` — Next.js customer application.
- `Front_End/Admin_Web/` — imported TailAdmin template baseline (PR #30), plus an interactive PMS Reservation Board frontend prototype and a front-desk reservation-creation workspace added by `ADMIN-002.1` (PR #32): room/date timeline, multi-property demo switching, assigned/unassigned reservations, operational blocks, and reservation lifecycle/folio/move demonstrations, all driven by deterministic local mock state. It is still not integrated with `Back_End/` — no database persistence, no Admin authentication/RBAC, and no real OTA behavior exist. The locked target architecture remains one shared `Back_End/` solution serving both `Front_End/Customer_Web/` and `Front_End/Admin_Web/`; this frontend prototype does not implement Admin backend integration.
- PostgreSQL 17 via EF Core 8/Npgsql, owned by `TheBha.Infrastructure`.
- Integration branch: `develop`; production branch: `main`.
- CI: `.github/workflows/ci.yml`.

## 2. Authority and activation

The operating chain is:

`Owner + Control Tower → Operations Coordinator → prompt-selected implementer (ACTIVE_EXECUTOR) → Owner → OC review → Owner decision`

Owner Hồ Đình Lâm alone decides Ready/merge, branch cleanup and whether the next task starts.

Canonical invariant: **one prompt-selected implementer writes. The paired agent independently reviews read-only. OC decides. Owner merges.** Every real Master Execution Prompt selects exactly one of two allowed role pairs (`docs/governance/RULES.md` §2.4):

| `IMPLEMENTER` (`ACTIVE_EXECUTOR`) | `REVIEWER` |
| --- | --- |
| `CLAUDE` | `CODEX_READ_ONLY` |
| `CODEX` | `CLAUDE_READ_ONLY` |

`IMPLEMENTER: CLAUDE/CODEX`, `IMPLEMENTER: CLAUDE \| CODEX`, and similar combined values are never valid activations. The selected pair is immutable for the whole lifetime of that work item, including every correction (`RULES.md` §3.1) — no agent infers it might be reassigned mid-work-item, and a policy change a work item makes to this contract never retroactively changes that same work item's own bootstrap pair.

There are two distinct activation contexts.

### 2.A Implementation context

- `ACTIVE_EXECUTOR` — the agent `IMPLEMENTER` names in the current Master Execution Prompt — is the only write-capable implementer for that work item's repository checkout.
- `ACTIVE_EXECUTOR` requires a valid Master Execution Prompt containing at minimum `IMPLEMENTER`, `REVIEWER` (one of the two allowed pairs above), `REPOSITORY`, `FEATURE_BRANCH`, baseline, scope, acceptance, checks, skill policy and stop conditions before making any edit.
- `ACTIVE_EXECUTOR` may implement, test, checkpoint, commit, push and open a Draft PR only when the Master Execution Prompt explicitly authorizes each of those actions.
- `ACTIVE_EXECUTOR` never grants the reviewer write access, never invokes the reviewer or any other coding agent, never creates nested agents and never runs an implementation in parallel with another agent.
- If the Master Execution Prompt is missing a required field, names an invalid role-pair value, or another coding agent may still have write access, `ACTIVE_EXECUTOR` returns `BLOCKED`.

### 2.B Dedicated independent review context

- A native dedicated review launched through the mechanism approved for the selected reviewer — `/codex:review` when `REVIEWER: CODEX_READ_ONLY`; a separate read-only Claude session, opened by Owner with explicit repository, base SHA and final HEAD SHA, when `REVIEWER: CLAUDE_READ_ONLY` — is already authorized as a read-only review invocation.
- Independent review does not require `ACTIVE_EXECUTOR`, `PHASE_ID`, `EXECUTION_MODE`, or a repeated full Master Execution Prompt inside the native review request.
- The reviewer reviews the explicit Git target/diff supplied in the review command/contract and the applicable repository review rules.
- Absence of executor-activation fields in native review context is not a blocker.
- If the target diff is empty, the review reports that there is no reviewable diff; it does not report missing executor authorization.
- The reviewer must remain read-only: no file edits, formatter writes, commits, pushes, PR changes or merges. When the reviewer is Claude and a credible read-only runtime/permission configuration cannot be established, the review is `NOT RUN` and the work item is `BLOCKED`.
- Reviewer findings are evidence for OC, not a governance verdict. OC decides `PASS`, `CORRECTION_REQUIRED` or `BLOCKED`; Owner alone decides Ready/merge/branch cleanup.
- Only Owner may invoke the review. `ACTIVE_EXECUTOR` must never run or trigger it. At the required handoff (see §13), `ACTIVE_EXECUTOR` must explicitly instruct Owner to invoke the exact command/contract from the Master Execution Prompt — announcing that required Owner action is permitted and is not equivalent to `ACTIVE_EXECUTOR` invoking it.

## 3. Locked roles and write lock

- `ACTIVE_EXECUTOR` is the only coding agent with write access to the repository checkout, for every phase of its work item.
- `ACTIVE_EXECUTOR` never invokes the reviewer, creates nested agents, fans out work or runs an implementation in parallel with any other agent.
- Before Owner invokes independent review, `ACTIVE_EXECUTOR` stops all writes and leaves the working tree at a stable, reviewable checkpoint for the duration of the review.
- A correction cycle requires an OC correction prompt and Owner activation before `ACTIVE_EXECUTOR` resumes writing, and always returns write authority to the same `ACTIVE_EXECUTOR` the work item started with (`docs/governance/RULES.md` §3.1) — never a role switch, rescue or transfer.

## 4. Reading order and context

For an execution session, read:

1. the Master Execution Prompt in full;
2. this `AGENTS.md`;
3. the provider adapter for `ACTIVE_EXECUTOR`, if one exists (`CLAUDE.md` for Claude);
4. every path in the prompt's `READ_NOW`, in the stated order;
5. the implementation/tests directly relevant to your phase.

Do not preload every worklog, report, ADR or historical design document. Historical material is retrieved only to trace a decision, restore incomplete work, investigate a defect or resolve a contradiction.

Do not recap entire files after reading them. A short preflight confirmation is enough.

## 5. Sources of truth

- Governance: `docs/governance/RULES.md` and `docs/governance/WORKFLOW.md`.
- Authorized scope: current Master Execution Prompt.
- Stable product/architecture: `docs/project/PROJECT_BIBLE.md`, `docs/ARCHITECTURE.md` and `docs/ADR/`.
- Current state: source code, migrations, Git history, test/CI evidence and `docs/project/SNAPSHOT.md`.
- Historical evidence: daily worklogs and `docs/reports/`/legacy `docs/BE-*.md`.

If sources conflict, report exact file/reference evidence. Do not silently choose the interpretation that expands scope.

## 6. Preflight before editing

1. Confirm `WORK_ITEM`, `IMPLEMENTER`, `REVIEWER` (one of the two allowed role pairs — `docs/governance/RULES.md` §2.4), `REPOSITORY`, `FEATURE_BRANCH`, baseline, scope and acceptance from the Master Execution Prompt.
2. Verify repository root, current branch and working-tree cleanliness.
3. Run `git fetch --prune origin` when network access and prompt policy allow it.
4. Verify HEAD/base against `BASELINE_SHA` and ahead/behind against the expected base.
5. Confirm no other write session is active; when resuming a correction, inspect the previous checkpoint and report.
6. Inspect current implementation and tests for the area in scope.
7. Confirm allowed/forbidden files, acceptance, checks and stop conditions.
8. Confirm required tools are available; optional tool absence is reported, not worked around by broad scope expansion.

Preflight output must stay short: `Work item`, `Repository/Branch/HEAD`, `Scope`, `First action`.

## 7. Scope and architecture constraints

- One approved phase at a time.
- Do not pull in the next roadmap item.
- Do not guess missing business rules for pricing, inventory, guest tokens, payments or content ownership.
- Do not touch frontend during backend-only scope, or backend during frontend-only scope, unless explicitly authorized.
- Do not change public API contracts, EF Core schema/migrations, auth/Identity, concurrency/advisory-lock rules or the architecture dependency direction without explicit authorization.
- No opportunistic refactor, dependency upgrade or formatting sweep.
- Preserve unrelated user changes; never discard, stash or overwrite them without Owner instruction.
- Preserve upstream theme source/license attribution.
- Template assets with no license/provenance evidence are development/reference only and not production-eligible.

## 8. Git and branch rules

`docs/governance/RULES.md` §5 is the canonical source for the repository
checkout and branch lifecycle. Summary: the project uses exactly one
existing repository checkout; a feature branch is checked out directly in
it (`git switch -c <branch>`); `git worktree add` and any additional
execution checkout are prohibited, with no exception, authorization field,
or policy matrix for this. Other rules:

- Never commit directly to `main` or `develop`.
- Do not create a branch, commit, push or open/modify a PR unless the prompt authorizes that action.
- Use small coherent commits at authorized checkpoints; do not squash them yourself.
- Never run destructive Git commands, force-push or rewrite shared history.
- Never merge, mark a PR ready, rebase shared history or delete a local/remote branch.
- Do not change branches during an active phase unless the prompt explicitly says so.
- Before handoff, leave the working tree clean or list every intentional uncommitted file.
- This single-checkout rule does not grant the reviewer (Codex or Claude), a subagent, or a parallel implementation write access — the roles locked for the work item in §2–§3 are unchanged.

## 9. Build, test, migration and validation

Run from repository root unless noted.

Backend restore/build:

```bash
dotnet restore Back_End/TheBha.Booking.sln
dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore
```

Backend tests with a local PostgreSQL connection:

```bash
export ConnectionStrings__TheBhaDatabase="Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<local-password>"
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
```

PowerShell equivalent:

```powershell
$env:ConnectionStrings__TheBhaDatabase = "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<local-password>"
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
```

Integration tests require real PostgreSQL; they do not use EF InMemory or SQLite. If PostgreSQL is unavailable, report the exact failure and `NOT RUN`/failed status.

Migration apply command:

```bash
dotnet ef database update --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```

Migrations live only in `TheBha.Infrastructure`. Schema change requires explicit scope and PostgreSQL integration evidence.

Frontend CI-parity build:

```bash
cd Front_End/Customer_Web
npm ci
npm run build
```

Use targeted checks first, then broader/CI-parity checks required by prompt and risk. Never claim a check passed unless it ran in the current phase/session.

## 10. GitNexus, Graphify, Orca and skills

- Use GitNexus for code graph/impact analysis when it improves confidence; verify conclusions against source/tests.
- Graphify is adopted as an **optional, workspace-local** code-navigation tool (Claude-run governance replay `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT-C4`; history in `docs/reports/TOOL-GRAPHIFY-001-completion.md`). The skill and graph are project-scoped to Claude Code discovery, **not** repository-tracked (`.git/info/exclude`); a fresh clone or a different checkout/machine will not automatically have them, and its availability on Claude's workspace must never be assumed for Codex or any other agent acting as `ACTIVE_EXECUTOR`.
- `docs/governance/WORKFLOW.md` §12 is the **canonical** source for Graphify invocation policy — `GRAPHIFY_POLICY` values, unavailable/stale behavior, freshness rule, and install/rebuild boundaries. Read it there; this file does not duplicate it.
- In short: every Master Execution Prompt must declare `GRAPHIFY_POLICY`; under `ALLOWED_IF_RELEVANT`, when Claude is `ACTIVE_EXECUTOR`, Claude may decide on its own to query an existing, sufficiently fresh graph when it would materially help (ownership/architecture/dependency/impact-analysis/unfamiliar code) — no extra confirmation needed; missing/invalid policy means do not invoke; no policy value authorizes installing or rebuilding Graphify. Graphify is **not mandatory for every task** — most `NOT_APPLICABLE` cases need no graph at all. Graph results are always advisory and never replace reading the source `ACTIVE_EXECUTOR` will change, required `READ_NOW` documents, or source/test verification.
- The canonical invariant is unchanged by Graphify adoption: one prompt-selected implementer writes, the paired agent reviews read-only, OC decides, Owner merges.
- GitNexus policy is unchanged; Graphify adoption does not imply GitNexus removal.
- Orca is not part of the active workflow (discontinued 2026-08-07 per `docs/project/SNAPSHOT.md`). Do not enable Orca orchestration, parallel worktrees, auto-routing, nested execution or autonomous merge.
- Use only skills listed/approved by the prompt and repository policy, and only when available to the agent currently holding `ACTIVE_EXECUTOR`.
- A skill never overrides RULES, scope, the work item's locked role pair, or test requirements.
- If a skill/tool is unavailable, report it accurately; do not install or modify global configuration unless the prompt explicitly authorizes setup.

## 11. Stop and escalation conditions

Stop with `BLOCKED` when:

- branch, baseline or repository does not match the prompt;
- unknown changes exist before your first edit;
- another coding agent may still be active;
- a correction or any other request would switch `ACTIVE_EXECUTOR` away from the work item's original implementer (`docs/governance/RULES.md` §3.1);
- required business rule, acceptance or phase ownership is missing;
- schema/API/auth/architecture must change without authorization;
- docs, code and Git evidence conflict on a task dependency;
- a required test cannot run or baseline already fails outside scope;
- progress requires destructive action, new secret or ungranted external authority;
- a file/log/output may expose a secret—redact it before reporting;
- completing the phase would require scope expansion.

Do not repair unrelated baseline failures unless OC explicitly puts them in scope.

## 12. Checkpoint report

When a work item has more than one internal phase, `ACTIVE_EXECUTOR` reports at each checkpoint: `Status: PASS | BLOCKED`; work item/phase; branch/base/HEAD; checkpoint commits; files changed; acceptance evidence for that phase; checks; working-tree status; deviations/risks/blockers; and confirmation that `ACTIVE_EXECUTOR` stopped writing without merge, Ready, rebase or branch deletion.

`PASS` requires every phase acceptance criterion to be met. Anything incomplete or unverified is `BLOCKED`.

## 13. Completion report and independent review handoff

After the final phase of a work item, `ACTIVE_EXECUTOR` stops all writes at a stable checkpoint and reports: `Status: PASS | BLOCKED`; work item; branch/base/HEAD; commits; authorized Draft PR URL; diff stat/files; acceptance; exact checks/outcomes; self-review; deviations; risks/`NOT RUN`; blockers when blocked; requested Owner/OC decision.

`ACTIVE_EXECUTOR` then prints the ready line for the selected reviewer:

- when `REVIEWER: CODEX_READ_ONLY`, replacing `<CODEX_REVIEW_COMMAND>` verbatim with the `CODEX_REVIEW_COMMAND` supplied by the current Master Execution Prompt (no inferred or hardcoded default base or flags):

  ```
  READY_FOR_CODEX_REVIEW
  Owner must now invoke:
  <CODEX_REVIEW_COMMAND>
  ```

- when `REVIEWER: CLAUDE_READ_ONLY`, stating the resolved `REVIEW_BASE_SHA` and `FINAL_HEAD` and instructing Owner to open a separate read-only Claude review session with that exact repository, base SHA and head SHA (`docs/governance/RULES.md` §3.5).

If the Master Execution Prompt does not supply the required review command/contract for the selected reviewer, `ACTIVE_EXECUTOR` returns `BLOCKED` instead of inventing one. `ACTIVE_EXECUTOR` does not invoke the review itself and makes no further repository mutations after printing this line.

Send the report to Owner and stop. Owner invokes the independent review, then forwards the report — and, when Owner asks `ACTIVE_EXECUTOR` to continue the report, the returned review result verbatim — to OC for review. `ACTIVE_EXECUTOR` never silently fixes a reviewer finding; a fix requires an OC correction prompt, and any correction returns write authority to the same `ACTIVE_EXECUTOR` (`docs/governance/RULES.md` §3.1). Do not start the next task on your own.
