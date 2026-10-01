# PMS-ADMIN-AUTH-001-CP01 — Staff identity and Property membership schema

> Draft PR into `develop`. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline `874f1481808afbcc83e18950b00d6ab07368b1be` (PR #73 merged). Branch `feature/pms-admin-auth-001-cp01-staff-identity`.

## Owner decisions applied (2026-10-01)

- D1: Staff are a separate Identity user type (`StaffAccount`).
- Roles are exactly `FrontDesk` and `Manager`; no `Viewer`.
- Staff use the Customer password and lockout policy; MFA is deferred.
- ADR 0007 is part of CP01.
- CP01 may exceed the 100–400 changed-line limit, with the explanation below.

The design's other open items (D3/D4/D6/D7/D8, production bootstrap) belong to CP02–CP07 and are untouched.

## Deliverable

- `StaffAccount : IdentityUser<Guid>` (`IsActive`, `CreatedAtUtc`, `DisabledAtUtc`), `StaffPropertyMembership`, `StaffRole` — `Back_End/src/TheBha.Infrastructure/Identity/`.
- EF configuration: table `StaffAccounts` (unique `UX_StaffAccounts_NormalizedEmail` / `…NormalizedUserName`, concurrency stamp, `CK_StaffAccounts_DisabledAtUtc`); table `StaffPropertyMemberships` (PK `(StaffAccountId, PropertyId)`, `CK_StaffPropertyMemberships_Role`, `Restrict` FKs to `StaffAccounts` and `Properties`).
- `TheBhaDbContext`: two `DbSet`s. `Program.cs`: `AddIdentityCore<StaffAccount>().AddEntityFrameworkStores<TheBhaDbContext>()` — no sign-in manager, no token providers; Customer registration untouched.
- Migration 9 `20261001141847_AddStaffIdentityFoundation` (generated), with a hand-written guard in `Down()` that refuses to drop non-empty Staff tables (same rule as migration 8).
- Tests, ADR 0007, `docs/DATABASE.md`, `docs/project/SNAPSHOT.md`, this report.

No endpoint, cookie, login, CLI verb, gate, CORS, frontend or Customer behaviour changed. Staff rows grant no access to anything yet.

## Why this PR exceeds 100–400 changed lines

Of about 2,390 changed lines, **1,836 are EF Core output that nobody writes or edits**:

| File | Lines | Origin |
|---|---|---|
| `…AddStaffIdentityFoundation.Designer.cs` | +1,615 | generated: EF 8 stores the **whole** model in every migration's Designer, so its size follows the model, not the change (migration 8's is 1,492) |
| `TheBhaDbContextModelSnapshot.cs` | +123 | generated |
| `…AddStaffIdentityFoundation.cs` | +110 | 98 generated + 12 hand-written `Down()` guard |

The PR cannot be split honestly: the model and its migration must land together or `develop` holds a model that disagrees with its schema; deleting or hand-writing the Designer, or squashing migrations, edits generated output and removes the tooling's own checks; and migration 9 breaks five existing migration assertions, which must be fixed in the same PR (measured: 5 failures with the old tests).

The generated part can be checked mechanically instead of read line by line:
- `dotnet ef migrations has-pending-model-changes` → exit 0 ("No changes have been made to the model since the last migration").
- The Designer's `BuildTargetModel` body is byte-identical to the snapshot's `BuildModel` body (`diff` exit 0).
- The snapshot delta adds only the two Staff entities.

The part to review by eye is about 430 lines of source and tests plus the docs. These sizes were measured beforehand in an external spike (`PMS-ADMIN-AUTH-001-CP01-FEASIBILITY`) and match this PR exactly for source and tests.

## Verification (this session, local PostgreSQL 17 in a disposable container)

| Command | Result |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | exit 0 |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | exit 0, 0 warnings, 0 errors |
| `dotnet ef migrations has-pending-model-changes` (Release) | exit 0 |
| `dotnet ef migrations list --no-connect` | migration 9 discovered after migration 8 |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` | exit 0 — unit 244/244, integration 595/595 (587 existing + 8 new) |
| `git diff --check` | clean |

New tests:
- `StaffIdentityPersistenceTests` (shared PostgreSQL fixture): create + password check + weak password refused + case-insensitive lookup; duplicate normalized email refused by Identity (`DuplicateEmail`) and by PostgreSQL (`23505` on `UX_StaffAccounts_NormalizedEmail`); the same email as customer and staff are independent principals, and a Staff claim write fails closed on the customer-keyed `AspNetUserClaims`; lockout after 5 failures for 15 minutes; security stamp changes with the password; membership PK `23505`, role check `23514`, unknown Property `23503`, `Restrict` on deleting the Property or the Staff `23503`, disabled-consistency check `23514`; Customer `IdentityOptions`, default scheme and sign-in manager unchanged, no Staff sign-in manager, no token providers.
- `StaffIdentityMigrationTests` (own database per test): a fresh database applies all nine migrations; a migration 8 database with a Property and a Customer upgrades with both intact; `Down()` is refused (`P0001`) while a Staff row exists and succeeds once the tables are empty.

Updated existing tests (required by migration 9): `PropertyInventoryPersistenceTests` (nine applied), `CommercialCommitmentV2MigrationTests` (migrations 8 and 9 pending from V7), `PhysicalRoomScheduleAvailabilityAuthorityMigrationTests` (migration 9 pending from V8); `PostgreSqlWebApplicationFactory.ResetDatabaseAsync` truncates the two new tables. `CustomerAuthenticationTests` is unchanged and passes.

## Limits and residual risk

- `IdentityOptions` is global: a later, stricter Staff policy needs its own validator.
- Identity claim/login/token tables stay keyed to customers; CP03 must not give Staff claims (a write fails, a read returns nothing).
- `docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md` still shows `Viewer` and the §10 items as open; ADR 0007 records the Owner decisions and takes precedence. The design file was left unchanged (outside this checkpoint's scope).
- CI has not run on this branch at the time of writing; see the PR checks.

## Review

`REVIEW: NOT RUN`. Owner invokes `/codex:review --base origin/develop`.
