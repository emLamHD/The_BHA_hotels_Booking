# AGENTS.md — The BHA Hotels Booking

> Shared executor contract for Claude Code and Codex.  
> `docs/governance/RULES.md` remains the highest repository-level authority.

## 1. Project identity

The BHA Hotels Booking is a monorepo:

- `Back_End/` — ASP.NET Core 8 Web API using Clean Architecture:
  `TheBha.Domain → TheBha.Application → TheBha.Infrastructure → TheBha.Api`.
- `Front_End/Customer_Web/` — Next.js customer application.
- `Front_End/Admin_Web/` — reserved placeholder, not implemented.
- PostgreSQL 17 via EF Core 8/Npgsql, owned by `TheBha.Infrastructure`.
- Integration branch: `develop`; production branch: `main`.
- CI: `.github/workflows/ci.yml`.

## 2. Authority and activation

The operating chain is:

`Owner + Control Tower → Operations Coordinator → Active Executor → Owner → OC review → Owner decision`

Owner Hồ Đình Lâm alone decides Ready/merge, branch cleanup and whether the next task starts.

Claude Code and Codex are equal executor options. You are active only when the current Master Execution Prompt:

- identifies your agent in `ACTIVE_EXECUTOR` for the current phase;
- identifies the execution mode, baseline, branch/worktree, scope and acceptance;
- has been activated by Owner/OC after any previous agent has stopped.

If any of these conditions is absent or another coding agent still has write access, return `BLOCKED`. Do not self-assign, negotiate with another agent or infer that you are the reviewer because you are Codex.

## 3. One-active-agent invariant

- Only one coding agent may write to the worktree at a time.
- `SINGLE_AGENT` uses one executor for the work item.
- `SEQUENTIAL_DUAL_AGENT` uses OC-assigned phases in a fixed order.
- Both agents may receive the same Master Execution Prompt, but each executes only its assigned phase.
- Never invoke the other coding agent, create nested agents, fan out work or run parallel implementations.
- Sequential phases use the same branch/worktree unless Owner approved an exception.
- A handoff requires a stopped prior agent, Git checkpoint/state evidence and phase report.

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

1. Confirm `WORK_ITEM`, `PHASE_ID`, `EXECUTION_MODE` and `ACTIVE_EXECUTOR`.
2. Verify repository root, current branch and working-tree cleanliness.
3. Run `git fetch --prune origin` when network access and prompt policy allow it.
4. Verify HEAD/base against `BASELINE_SHA` and ahead/behind against the expected base.
5. Confirm the prior agent is stopped and inspect the phase report/checkpoint when applicable.
6. Inspect current implementation and tests for the area in scope.
7. Confirm allowed/forbidden files, acceptance, checks and stop conditions.
8. Confirm required tools are available; optional tool absence is reported, not worked around by broad scope expansion.

Preflight output must stay short: `Work item/phase`, `Active executor`, `Branch/HEAD`, `Worktree`, `Scope`, `First action`.

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

## 10. GitNexus, Orca and skills

- Use GitNexus for code graph/impact analysis when it improves confidence; verify conclusions against source/tests.
- Orca is a cockpit/worktree manager, not an authority. Do not enable parallel worktrees, auto-routing, nested execution or autonomous merge.
- Use only skills listed/approved by the prompt and repository policy.
- A skill never overrides RULES, scope, active-agent ownership or test requirements.
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

## 12. Phase handoff report

For a non-final phase, report: `Status: PASS | BLOCKED`; work item/phase; executor; branch/base/HEAD; checkpoint commits; files changed; acceptance evidence; checks; worktree status; deviations/risks/blockers; next phase and assigned executor; and confirmation that the executor stopped without merge, Ready, rebase or branch deletion.

`PASS` requires every phase acceptance criterion to be met. Anything incomplete or unverified is `BLOCKED`.

## 13. Completion report

Final report contains: `Status: PASS | BLOCKED`; work item; execution mode/completed phases; branch/base/head; commits; authorized Draft PR URL; diff stat/files; acceptance; exact checks/outcomes; self-review; deviations; risks/`NOT RUN`; blockers when blocked; requested Owner/OC decision; and confirmation that no merge, Ready transition, history rewrite or branch deletion occurred.

Send the report to Owner and stop. Owner forwards it to OC for review. Do not start the next task on your own.
