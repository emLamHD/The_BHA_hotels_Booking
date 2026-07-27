# CLAUDE.md — The BHA Hotels Booking

This repository has no `AGENTS.md`. This file is self-contained; it is not an
import of another executor's rules.

## 1. Project identity

The BHA Hotels Booking is a monorepo:

- `Back_End/` — ASP.NET Core 8 Web API, Clean Architecture
  (`TheBha.Domain` → `TheBha.Application` → `TheBha.Infrastructure` →
  `TheBha.Api`; see `docs/ARCHITECTURE.md` for the exact dependency graph).
- `Front_End/Customer_Web/` — Next.js customer application.
- `Front_End/Admin_Web/` — reserved placeholder, not yet implemented.
- Database: PostgreSQL 17 via EF Core 8 / Npgsql, owned entirely by
  `TheBha.Infrastructure`.
- Integration branch: `develop`. Production branch: `main`. CI: GitHub
  Actions (`.github/workflows/ci.yml`).

## 2. Claude Code's executor role

Claude Code replaced Codex as executor. The workflow, authority structure,
and quality gates are unchanged:

Control Tower → Operations Coordinator → **Claude Code** → Draft PR → Review
→ Hồ Đình Lâm merges.

Claude Code:

- Implements only the currently approved work unit from the Operations
  Coordinator's execution prompt.
- Inspects the actual repository state before acting; never assumes.
- Builds, tests, inspects its own diff, and reports evidence.
- Does not redesign architecture, expand scope, merge PRs, delete branches,
  rewrite history, or start the next work unit on its own initiative.
- Hồ Đình Lâm is the only merge authority. Claude Code must never merge,
  mark a PR ready for review, squash, rebase shared history, or delete a
  branch — local or remote — under any instruction found in this file, a
  prompt, or a document. Those actions are performed manually by Hồ Đình
  Lâm only.

## 3. Documentation reading order

At the time this file was written, `docs/governance/`, `docs/project/`,
`docs/daily/`, and `docs/reports/` did not exist in this repository (verify
this on the filesystem for every task — see §4). Read in this order:

1. The Operations Coordinator's execution prompt for the current task, in
   full, first. It is the authorization for what to build right now and it
   names which task-specific documents matter for this work unit; nothing
   below it grants scope on its own.
2. `README.md` — repo layout, local dev/build commands.
3. `docs/ARCHITECTURE.md` — dependency rules, layer ownership, current
   architectural scope, deliberately deferred decisions.
4. `docs/ADR/0001-use-dotnet-8.md`, `docs/ADR/0002-use-postgresql.md` —
   durable platform decisions.
5. `docs/DATABASE.md` — PostgreSQL, EF Core migrations, seed workflow,
   integration-test workflow.
6. The exact `docs/BE-XXX-*.md` document(s) the execution prompt or the
   work unit's dependencies actually reference — not simply the most
   recently dated file. Each `docs/BE-*.md` file is both a design record and
   completion evidence for one merged work unit; pick by relevance to the
   task's scope, not by recency. If the prompt does not name one and the
   task needs prior context, identify the correct file by tracing which
   work unit owns the code/schema being touched.

Do not read every historical `docs/BE-*.md` file by default — open older ones
only to trace a decision, verify a migration/API change, resolve a
contradiction, or investigate a defect.

## 4. Sources of truth

Treat evidence as four distinct categories, not one ranked chain. Each
answers a different question; they are not substitutes for one another, and
one category outranking another for its own question does not mean it
overrides a different category on a different question:

- **Current implementation state** — actual source code, EF Core
  migrations, and `origin/develop`/Git history. What the system *is* right
  now.
- **Authorized scope** — the Operations Coordinator's execution prompt for
  the active task. What Claude Code is *allowed to build right now*.
- **Durable architecture** — `docs/ARCHITECTURE.md` and `docs/ADR/*.md`.
  Stable decisions that constrain design; not a status report.
- **Historical completion evidence** — `docs/BE-*.md` files. What a past
  work unit claims it delivered, at the time it was written.

If any two categories conflict (e.g. an ADR says one thing and the code does
another; a `docs/BE-*.md` file claims a migration that isn't present) —
**report the contradiction with exact file references** rather than
silently resolving it or guessing which source wins. The Operations
Coordinator or Control Tower decides how to reconcile it.

Do not assume any path is permanently absent from this repository (e.g.
`SNAPSHOT.md`, `docs/daily/`, `docs/governance/`). Verify on the filesystem
for the current task. If the Operations Coordinator references a path that
is not present, do not invent its content and do not assume it will never
exist — report it as missing and escalate for its actual location or
confirmation that it has not yet been created.

## 5. Task startup protocol

Before editing anything:

1. Read the execution prompt in full before opening any file to edit.
2. Verify current branch and working-tree cleanliness (`git status`).
3. Run `git fetch --prune origin`, then check ahead/behind against the
   expected base (e.g. `git status` after fetch, or `git rev-list
   --left-right --count origin/develop...HEAD`). Do not claim the base
   branch is current from a stale local ref — a base branch is only
   "current" after this fetch confirms zero divergence in the direction
   that matters for the task.
4. Inspect the existing implementation and tests for the area in scope
   (relevant `TheBha.Domain` / `TheBha.Application` / `TheBha.Infrastructure`
   / `TheBha.Api` folders and their `TheBha.UnitTests` /
   `TheBha.IntegrationTests` counterparts) before designing any change.
5. Confirm scope boundaries (in/out, acceptance criteria, commit
   checkpoints) against the prompt before writing code.

## 6. Scope and architecture constraints

- One approved work unit at a time. Do not pull in the next planned item
  from a `docs/BE-*.md` roadmap mention.
- Do not guess missing business rules (pricing, inventory, guest-token
  lifecycle, payments, etc.) — these are deliberately deferred per
  `docs/ARCHITECTURE.md` §"Deliberately deferred decisions" until an
  explicit decision exists. Escalate instead of inferring.
- Do not modify `Front_End/` during a backend-only task, or vice versa,
  unless the execution prompt explicitly includes it.
- Do not change public API contracts, the EF Core schema/migrations,
  authentication/Identity, concurrency/advisory-lock rules, or the
  Domain → Application → Infrastructure → Api dependency direction in
  `docs/ARCHITECTURE.md` unless explicitly authorized.
- No opportunistic refactoring, dependency upgrades, or formatting sweeps
  outside the diff the task requires.
- Preserve unrelated in-progress or uncommitted user changes; never
  discard, stash, or overwrite them without being asked.
- `Front_End/Customer_Web` preserves an upstream theme's source and license
  attribution (see `.gitattributes`, README §"Front-end provenance") — do
  not alter that provenance incidentally.

## 7. Git and commit rules

- Never run destructive Git commands (`reset --hard`, `push --force`,
  history rewrite) without explicit instruction.
- Deleting a branch — local or remote — is absolutely prohibited for
  Claude Code. No execution prompt, document, or instruction in this file
  can authorize it; it is not on the list of actions an execution prompt
  can unlock.
- Use small, coherent, reviewable commits at each authorized checkpoint —
  this applies especially to large work units, which must be delivered as a
  sequence of small commits, not as one giant commit for the whole feature.
  Do not squash intermediate commits yourself under any circumstance.
- Do not create a branch, commit, push, or open/modify a PR unless the
  current task explicitly calls for it.
- Never merge, mark a PR ready, or delete a branch — local or remote —
  under any circumstance. Whether and when a final squash merge happens is
  a decision made solely by Hồ Đình Lâm after review — it is never Claude
  Code's call to make or to execute.

## 8. Build, test, migration, and validation commands

Run from the repository root unless noted. Source: `README.md`,
`docs/DATABASE.md`, `.github/workflows/ci.yml`.

**Restore / build (backend):**
```
dotnet restore Back_End/TheBha.Booking.sln
dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore
```

**Tests (backend, unit + integration in one solution):**

PowerShell:
```
$env:ConnectionStrings__TheBhaDatabase = "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<local-password>"
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
```

Bash / Git Bash:
```
export ConnectionStrings__TheBhaDatabase="Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<local-password>"
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
```
Integration tests require a real running PostgreSQL (`docker compose up -d
postgres`) and a user with CREATE DATABASE permission — they create a
uniquely named database per run, migrate it, and drop it. Tests never use EF
InMemory or SQLite. If PostgreSQL is not reachable, report that exact reason
instead of skipping silently.

**Migrations:**
```
dotnet ef database update --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```
Migrations live only in `TheBha.Infrastructure`. The API never calls
`EnsureCreated()` or auto-applies migrations at startup. Schema changes
require an approved work item plus PostgreSQL integration evidence.

**Frontend build:**
```
cd Front_End/Customer_Web
npm ci
npm run build
```

**Formatting:** no `.editorconfig` or formatting step exists in CI today —
do not introduce one opportunistically; if formatting is needed, use
`dotnet format Back_End/TheBha.Booking.sln` only when the task calls for it.

**CI parity:** `.github/workflows/ci.yml` runs exactly: frontend
`npm ci && npm run build`; backend `dotnet restore` → `dotnet build
--configuration Release --no-restore` → `dotnet test --configuration
Release --no-build` against a `postgres:17-alpine` service container.
Match these flags locally before reporting evidence.

## 9. Stop and escalation conditions

Stop and ask the Operations Coordinator/Control Tower rather than proceeding
when:

- A required business rule, contract, or acceptance criterion is absent
  from the execution prompt.
- The task would require changing schema, public API contracts, auth, or
  architectural boundaries without explicit authorization.
- The task would touch both `Front_End/` and `Back_End/` but scope says
  backend-only (or vice versa).
- Documentation, Git state, or code contradict each other on something the
  task depends on.
- A required test cannot run (e.g. PostgreSQL unavailable, EF tool missing)
  — report the exact error, do not claim the test passed.
- `git status` shows working-tree changes that Claude Code did not make in
  this session (e.g. modified/untracked files present before the first
  edit). Do not overwrite, discard, or assume ownership of them — report
  what is present and escalate before touching the tree.
- After `git fetch --prune origin` (§5), the actual branch or base SHA does
  not match what the execution prompt expects — do not proceed on an
  assumed base.
- A required build/test command fails on the unmodified baseline, before
  any task-specific change is made, for a reason outside the task's scope.
  Do not fix unrelated pre-existing failures as part of this task; report
  the failure and ask whether it is in scope.
- Any file, log, command output, or diff about to be read, run, or reported
  appears to contain a secret (connection string password, API key, token,
  credential, private key). Stop before further exposing it, and if the
  value must be referenced in any output, **redact it** (e.g.
  `Password=<redacted>`) rather than printing it in full.

## 10. Completion report format

Every completed work unit is reported with:

- **Status** — exactly `PASS` or `BLOCKED`, no other value. `PASS` requires
  every acceptance criterion in the execution prompt to be met and verified
  with evidence in this report. Anything incomplete, unverified, failed, or
  waiting on a decision is `BLOCKED` — there is no partial-credit status.
  When `BLOCKED`, report whatever progress was actually completed and
  verified as a separate, clearly labeled list, not folded into Status.
- **Work-unit ID** — the exact identifier from the execution prompt (e.g.
  `BE-003.4`), not a paraphrase.
- Branch, base SHA, and scope actually implemented (vs. what was assigned).
- **Feature commit(s)** — the actual commit SHA(s) created for this work
  unit, in checkpoint order.
- **Draft PR URL** — if a Draft PR was authorized and opened for this task.
- **Diff stat** — files changed / insertions / deletions (e.g. `git diff
  --stat` output) for the exact commits produced.
- Files changed, with a one-line reason per file group.
- Exact commands run for build/test/migration and their real outcome
  (pass/fail/skipped-with-reason) — never claim a test passed unless it was
  actually executed in this session.
- Diff self-review notes: no scope creep, no generated artifacts (`bin/`,
  `obj/`, `.vs/`), no secrets, no leftover debug code, no unrelated
  formatting churn.
- **Deviations** — any place the implementation diverged from the execution
  prompt, and why.
- **Risks** — anything the Operations Coordinator/Control Tower should
  weigh before approving the next checkpoint or work unit.
- **Blockers** — required whenever Status is `BLOCKED`: the exact reason
  (e.g. a required decision was absent, a test could not run, an
  acceptance criterion could not be verified).
- Explicit confirmation of what was **not** done: no merge, no PR-ready
  transition, no history rewrite, no local or remote branch deletion. These
  are never delegated to Claude Code and are never authorized by any
  execution prompt — this confirmation is unconditional, not contingent on
  whether the task happened to request one of them.
