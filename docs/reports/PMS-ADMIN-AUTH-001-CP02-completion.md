# PMS-ADMIN-AUTH-001-CP02 — Staff bootstrap CLI

> Draft PR into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline and START_HEAD `3c1eefd5836e6fb1710817ff86021e391c55179d` (PR #74, CP01, merged). Branch `feature/pms-admin-auth-001-cp02-staff-bootstrap-cli`.

## Owner decisions applied (2026-10-01, CP02 activation)

- D6: Staff are bootstrapped only by four CLI verbs on the API host; no HTTP registration, no Staff in the development seed.
- Production is run by Owner or an operator Owner names, in a controlled admin session on the API host, after confirming the printed target database. This task did not touch Production.
- The hidden prompt is the default; `BHA_STAFF_PASSWORD` is only for short-lived automation; credentials go through a password manager with limited sharing — never arguments, Git or logs.
- Grant: same role is a no-op; a different role replaces it; no Staff or Property is created. Disable: state and security stamp in one update; repeating keeps the first timestamp. Reset: never unlocks a locked-out account or re-enables a disabled one.
- PR size: 100–400 changed lines is a target, not a limit (`docs/governance/WORKFLOW.md` §6, `AGENTS.md` §13).

Still open: D3 (scheme), D4, D7, D8. CP03 is not started. The Calendar is not ready to be opened publicly.

## Deliverable

- `Back_End/src/TheBha.Api/Authentication/StaffBootstrapCommand.cs` — parser, secret input, the four verbs, one transaction per verb.
- `Program.cs` — a Staff verb is dispatched right after `Build()`, before `--seed-development`; it sets `Environment.ExitCode` and returns, so no listener starts and the seed never runs. Without a Staff verb, startup and the seed are unchanged.
- `StaffBootstrapCommandTests.cs` — 17 PostgreSQL tests.
- Governance (size target), design §1/§2/§6/§9/§10, ADR 0007, SNAPSHOT, this report.

No model, EF configuration, migration, snapshot, dependency, Customer auth, session, CORS, gate, frontend or CI change.

## Contract per verb (all verified)

| Verb | Behaviour | Evidence |
|---|---|---|
| `--staff-create --email --property-id --role` | Identity policy and normalized-email uniqueness; Staff and membership in one transaction; refuses unknown Property, weak/empty password, duplicate email (existing Staff untouched); Customer with the same email unchanged | tests 1–3, smoke 1–2 |
| `--staff-grant --email --property-id --role` | Staff and Property must exist; same role → `unchanged`, exit 0; other role → replaced; other Properties untouched; a disabled Staff stays disabled | test 4 |
| `--staff-disable --email` | `IsActive=false`, `DisabledAtUtc` and a new security stamp in one update; repeat → `unchanged`, timestamp and stamp kept; Staff and memberships kept | test 5 |
| `--staff-reset-password --email` | `RemovePassword` + `AddPassword` in one transaction (no token providers); a refused password rolls back so the old one still works and the stamp is unchanged; success changes password and stamp; lockout and disabled state kept | test 6, smoke 4 |
| any | exactly one verb; missing, unknown, duplicate or valueless flags, bad email/GUID/role, `--password`, `--seed-development` and unknown verbs → exit 2 before any database access, without echoing values | theory (11 cases), smoke 3 |

Exit codes: 0 success or no-op, 1 operation refused or failed, 2 usage error or missing password. Output: the target database as `host/name` (no secret), then one line with the operation, status and Staff id.

## Verification (implementation head, local PostgreSQL 17 in a disposable container)

| Command | Result |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | exit 0 |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | exit 0, 0 warnings, 0 errors |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter FullyQualifiedName~StaffBootstrapCommandTests` | exit 0, 17/17 |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` | exit 0 — unit 244/244, integration 612/612 (595 existing incl. `CustomerAuthenticationTests` and `StaffIdentityPersistenceTests` + 17 new) |
| `git diff --check` | clean |

**Rollback after the Staff insert:** test-only triggers make the membership insert raise; non-transactional sequences prove that one Staff row was inserted and one membership insert attempted, and afterwards no Staff or membership exists. Triggers, functions and sequences are dropped in `finally`.

**Mutation checks** (temporary edits in this checkout, restored to the identical SHA-256, then 17/17 green again):
- M1, always commit even on failure → `Reset_password_…` fails.
- M2, commit the Staff before the membership insert → `Create_rolls_back_…` and two other create tests fail.

**Smoke through `Back_End/src/TheBha.Api/bin/Release/net8.0/TheBha.Api.dll`** (`ASPNETCORE_ENVIRONMENT=Development`, a migrated throwaway database `thebha_smoke`, passwords random and only in the environment or the PTY; values redacted here):

| # | Command | Exit | Output |
|---|---|---|---|
| 1 | `BHA_STAFF_PASSWORD=<redacted> dotnet TheBha.Api.dll --staff-create --email smoke@example.com --property-id 91000000-…-0000000000aa --role FrontDesk` | 0 | `staff: target database 127.0.0.1/thebha_smoke` / `staff: created Staff 7b3ac399-… with FrontDesk membership.` |
| 2 | same with an unknown `--property-id …ff` | 1 | `staff: the Property does not exist; nothing was changed.` |
| 3 | `… --staff-reset-password --email smoke@example.com --password <redacted test value>` | 2 | `staff: --staff-reset-password accepts only --email; an unexpected argument was given.` |
| 4 | `script -qec "dotnet TheBha.Api.dll --staff-reset-password --email smoke@example.com"` with the password typed into the PTY | 0 | `Staff password: ` (nothing echoed) / `staff: reset the password of Staff 7b3ac399-….`; password hash and stamp changed in the database |
| 5 | `echo unused \| dotnet TheBha.Api.dll --staff-reset-password --email smoke@example.com` (no variable) | 2 | `staff: a password is required in BHA_STAFF_PASSWORD or at the hidden prompt.` |
| 6 | `dotnet TheBha.Api.dll` (no Staff verb, control) | 124 (stopped by `timeout`) | `Now listening on: http://127.0.0.1:55499` |

Runs 1–5 printed no `Now listening` line. The database held exactly one Staff with one `FrontDesk` membership. The secrets occurred 0 times in all captured output and in the PTY transcript. Run 3 deliberately passed a throwaway value as a forbidden argument; the PTY run 4 was repeated with a fresh value that never appeared in any argument list.

## Size

Whole PR against `origin/develop`: **+713 / −21 = 734** changed lines (local `git diff --numstat`; the GitHub figure is in the PR) — above the 100–400 target, for these reasons:

| Group | Lines | Why it is needed |
|---|---|---|
| `StaffBootstrapCommand.cs` + `Program.cs` | +307 | four verbs share one strict parser (every flag rule is a stated contract), the hidden prompt, target display, one transaction per verb and redacted error handling; no framework or abstraction was added |
| `StaffBootstrapCommandTests.cs` | +262 | one test per verb contract plus the rollback-after-insert probe, lockout/disabled preservation, Customer independence and 11 refused argument shapes; every run asserts no password in the output |
| Governance, design, ADR, SNAPSHOT, this report | +144 / −21 | the size policy, D6 and its scope, current state, and the evidence above |

No generated files. The P0 spike measured the same order (≈ 504 code + tests before the extra rollback and lockout tests).

## Limits and residual risk

- Development logs EF SQL at Information level with parameters shown as `?` (sensitive data logging is not enabled), so no value is logged; enabling it would expose hashes.
- The hidden prompt was verified once manually through a PTY (`script`), not by an automated test.
- Setting `BHA_STAFF_PASSWORD` inline on a shell command can leave it in shell history; that is why the hidden prompt is the default and the variable is limited to short-lived automation.
- CI on the PR head: see the PR checks.

## Review

`REVIEW: NOT RUN`. Owner invokes `/codex:review --base origin/develop`.
