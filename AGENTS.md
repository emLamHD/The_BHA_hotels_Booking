# AGENTS.md — The BHA Hotels Booking

> Shared contract: Claude implements, Codex reviews read-only.
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

`Owner + Control Tower → Operations Coordinator → Claude (implementer) → Owner → OC review → Owner decision`

Owner Hồ Đình Lâm alone decides Ready/merge, branch cleanup and whether the next task starts.

Fixed invariant: **Claude writes. Codex reviews. OC decides. Owner merges.** This is a permanent role assignment, not a per-work-item choice. Claude does not infer it might be replaced as implementer, and Codex is never assigned as an alternate `ACTIVE_EXECUTOR`.

There are two distinct activation contexts.

### 2.A Claude implementation context

- Claude is the only write-capable implementer for this repository.
- Claude requires a valid Master Execution Prompt containing at minimum `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`, branch/worktree, baseline, scope, acceptance, checks, skill policy and stop conditions before making any edit.
- Claude may implement, test, checkpoint, commit, push and open a Draft PR only when the Master Execution Prompt explicitly authorizes each of those actions.
- Claude never grants Codex write access, never invokes Codex or any other coding agent, never creates nested agents and never runs an implementation in parallel with another agent.
- If the Master Execution Prompt is missing, incomplete, or another coding agent may still have write access, Claude returns `BLOCKED`.

### 2.B Dedicated Codex review context

- A native dedicated Codex review launched through the approved `/codex:review` command is already authorized as a read-only review invocation.
- Codex review does not require `ACTIVE_EXECUTOR`, `PHASE_ID`, `EXECUTION_MODE`, or a repeated full Master Execution Prompt inside the native review request.
- Codex reviews the explicit Git target/diff supplied in the review command and the applicable repository review rules.
- Absence of executor-activation fields in native review context is not a blocker.
- If the target diff is empty, the review reports that there is no reviewable diff; it does not report missing executor authorization.
- Codex must remain read-only: no file edits, formatter writes, commits, pushes, PR changes or merges.
- Codex findings are evidence for OC, not a governance verdict. OC decides `PASS`, `CORRECTION_REQUIRED` or `BLOCKED`; Owner alone decides Ready/merge/branch cleanup.
- Only Owner may invoke the review command. Claude must never run or trigger it. At the required handoff (see §13), Claude must explicitly instruct Owner to invoke the exact command from the Master Execution Prompt — announcing that required Owner action is permitted and is not equivalent to Claude invoking the command.

## 3. Fixed roles and write lock

- Claude is the only coding agent with write access to the worktree, for every work item, at every phase.
- Claude never invokes Codex, creates nested agents, fans out work or runs an implementation in parallel with any other agent.
- Before Owner invokes Codex review, Claude stops all writes and leaves the worktree at a stable, reviewable checkpoint for the duration of the review.
- A correction cycle requires an OC correction prompt and Owner activation before Claude resumes writing.

## 4. Reading order and context

For an execution session, read:

1. the Master Execution Prompt in full;
2. this `AGENTS.md`;
3. provider adapter if applicable (`CLAUDE.md` for Claude);
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

1. Confirm `WORK_ITEM`, `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`, branch/worktree, baseline, scope and acceptance from the Master Execution Prompt.
2. Verify repository root, current branch and working-tree cleanliness.
3. Run `git fetch --prune origin` when network access and prompt policy allow it.
4. Verify HEAD/base against `BASELINE_SHA` and ahead/behind against the expected base.
5. Confirm no other write session is active; when resuming a correction, inspect the previous checkpoint and report.
6. Inspect current implementation and tests for the area in scope.
7. Confirm allowed/forbidden files, acceptance, checks and stop conditions.
8. Confirm required tools are available; optional tool absence is reported, not worked around by broad scope expansion.

Preflight output must stay short: `Work item`, `Branch/HEAD`, `Worktree`, `Scope`, `First action`.

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

## 8. Git and worktree rules

- Never commit directly to `main` or `develop`.
- Do not create a branch, commit, push or open/modify a PR unless the prompt authorizes that action.
- Use small coherent commits at authorized checkpoints; do not squash them yourself.
- Never run destructive Git commands, force-push or rewrite shared history.
- Never merge, mark a PR ready, rebase shared history or delete a local/remote branch.
- Do not change branches during an active phase unless the prompt explicitly says so.
- Before handoff, leave the worktree clean or list every intentional uncommitted file.

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
- Graphify (`graphifyy==0.9.48`) has completed a local, project-scoped, code-only tooling-adoption pilot (`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`): install, config, dry run and pilot query all passed. It is a project skill at `.claude/skills/graphify/SKILL.md`; its graph outputs (`graphify-out/`) are local-only and excluded from Git.
- Claude may automatically invoke the Graphify project skill when a task's description matches architecture, dependency, relationship or impact-analysis work. Graphify is not mandatory for every task.
- A Master Execution Prompt may declare:

  ```text
  GRAPHIFY_POLICY: REQUIRED_FOR_PREFLIGHT_IMPACT_ANALYSIS | ALLOWED_IF_RELEVANT | NOT_APPLICABLE
  GRAPHIFY_TRIGGER_OR_REASON:
  ```

- Graph results are advisory and must be checked against source/tests, never treated as a substitute for reading the actual code or running tests.
- Before relying on the graph, compare its recorded build commit/state with current `HEAD`. If the graph is stale, do not rebuild unless the current prompt explicitly authorizes it; report the stale state and fall back to source/tests instead.
- Prohibited unless a later Owner-authorized tooling work item changes policy: Graphify's full semantic pipeline, Graphify subagents, strict mode, PreToolUse hooks, watch mode, MCP, and automatic rebuild.
- The fixed invariant is unchanged by Graphify adoption: Claude writes, Codex reviews, OC decides, Owner merges.
- GitNexus policy is unchanged; Graphify adoption does not imply GitNexus removal.
- Orca is not part of the active workflow (discontinued 2026-08-07 per `docs/project/SNAPSHOT.md`). Do not enable Orca orchestration, parallel worktrees, auto-routing, nested execution or autonomous merge.
- Use only skills listed/approved by the prompt and repository policy.
- A skill never overrides RULES, scope, the fixed Claude-write/Codex-review roles or test requirements.
- If a skill/tool is unavailable, report it accurately; do not install or modify global configuration unless the prompt explicitly authorizes setup.

## 11. Stop and escalation conditions

Stop with `BLOCKED` when:

- branch, baseline or worktree does not match the prompt;
- unknown changes exist before your first edit;
- another coding agent may still be active;
- required business rule, acceptance or phase ownership is missing;
- schema/API/auth/architecture must change without authorization;
- docs, code and Git evidence conflict on a task dependency;
- a required test cannot run or baseline already fails outside scope;
- progress requires destructive action, new secret or ungranted external authority;
- a file/log/output may expose a secret—redact it before reporting;
- completing the phase would require scope expansion.

Do not repair unrelated baseline failures unless OC explicitly puts them in scope.

## 12. Checkpoint report

When a work item has more than one internal phase, Claude reports at each checkpoint: `Status: PASS | BLOCKED`; work item/phase; branch/base/HEAD; checkpoint commits; files changed; acceptance evidence for that phase; checks; worktree status; deviations/risks/blockers; and confirmation that Claude stopped writing without merge, Ready, rebase or branch deletion.

`PASS` requires every phase acceptance criterion to be met. Anything incomplete or unverified is `BLOCKED`.

## 13. Completion report and Codex review handoff

After the final phase of a work item, Claude stops all writes at a stable checkpoint and reports: `Status: PASS | BLOCKED`; work item; branch/base/HEAD; commits; authorized Draft PR URL; diff stat/files; acceptance; exact checks/outcomes; self-review; deviations; risks/`NOT RUN`; blockers when blocked; requested Owner/OC decision.

Claude then prints, replacing `<CODEX_REVIEW_COMMAND>` verbatim with the `CODEX_REVIEW_COMMAND` supplied by the current Master Execution Prompt (no inferred or hardcoded default base or flags):

```
READY_FOR_CODEX_REVIEW
Owner must now invoke:
<CODEX_REVIEW_COMMAND>
```

If the Master Execution Prompt does not supply `CODEX_REVIEW_COMMAND`, Claude returns `BLOCKED` instead of inventing one. Claude does not invoke the review command itself and makes no further repository mutations after printing this line.

Send the report to Owner and stop. Owner invokes Codex review, then forwards the report — and, when Owner asks Claude to continue the report, the returned Codex result verbatim — to OC for review. Claude never silently fixes a Codex finding; a fix requires an OC correction prompt. Do not start the next task on your own.
