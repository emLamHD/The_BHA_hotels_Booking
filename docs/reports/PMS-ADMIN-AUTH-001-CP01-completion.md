# PMS-ADMIN-AUTH-001-CP01 — Staff identity and Property membership schema

> Draft PR #74 into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). Review history: see "Review" below.
> Baseline `874f1481808afbcc83e18950b00d6ab07368b1be` (PR #73 merged). Branch `feature/pms-admin-auth-001-cp01-staff-identity`. Implementation head `59f540acbf2e257c3f26ad020881f7db8e376233`; correction C1 (documentation only) follows it.

## Owner decisions applied (2026-10-01)

- D1: Staff are a separate Identity user type (`StaffAccount`).
- Roles are exactly `FrontDesk` and `Manager`; no `Viewer`.
- Staff use the Customer password and lockout policy; MFA is deferred.
- ADR 0007 is part of CP01.
- CP01 alone may exceed the 100–400 changed-line limit, with the explanation below; the exception does not extend to CP02–CP07.

Still open and not approved by this checkpoint or by the merge of #73: D3 (the `TheBha.Staff` scheme), D4, D6 and the production bootstrap, D7, D8. The design (`docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md` §10) lists the same split since C1.

## Deliverable

- `StaffAccount : IdentityUser<Guid>` (`IsActive`, `CreatedAtUtc`, `DisabledAtUtc`), `StaffPropertyMembership`, `StaffRole` — `Back_End/src/TheBha.Infrastructure/Identity/`.
- EF configuration: table `StaffAccounts` (unique `UX_StaffAccounts_NormalizedEmail` / `…NormalizedUserName`, concurrency stamp, `CK_StaffAccounts_DisabledAtUtc`); table `StaffPropertyMemberships` (PK `(StaffAccountId, PropertyId)`, `CK_StaffPropertyMemberships_Role`, `Restrict` FKs to `StaffAccounts` and `Properties`).
- `TheBhaDbContext`: two `DbSet`s. `Program.cs`: `AddIdentityCore<StaffAccount>().AddEntityFrameworkStores<TheBhaDbContext>()` — no sign-in manager, no token providers; Customer registration untouched.
- Migration 9 `20261001141847_AddStaffIdentityFoundation` (generated), with a hand-written guard in `Down()` that refuses to drop non-empty Staff tables (same rule as migration 8).
- Tests, ADR 0007, `docs/DATABASE.md`, `docs/project/SNAPSHOT.md`, this report.

No endpoint, cookie, login, CLI verb, gate, CORS, frontend or Customer behaviour changed. Staff rows grant no access to anything yet.

## Why this PR exceeds 100–400 changed lines

At the implementation head `59f540a` GitHub reported +2,389 / −14 (2,403 changed lines); the final size including C1 is in the "Correction C1" section. **1,836 lines are EF Core output that nobody writes or edits**:

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

## Verification (implementation head `59f540a`, local PostgreSQL 17 in a disposable container)

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
- `AspNetUserClaims/Logins/Tokens` stay keyed to customers. No code may call the Staff Identity store APIs that store or read claims, external logins or tokens through them (a write fails on the foreign key, a read returns nothing). This limits the Identity store, not the session: the Staff cookie's `ClaimsPrincipal` still carries the Staff id and security stamp, and roles/Property ids are never put in the cookie as an authorization source. The default `UserClaimsPrincipalFactory<StaffAccount>` reads claims through `GetClaimsAsync`, so CP03 builds the Staff principal without that read (design §3).
- CI: run `36876443326` on `59f540acbf2e257c3f26ad020881f7db8e376233` — Admin, Backend and Frontend success. CI for the C1 head is on PR #74.

## Review

**Original review (implementation head)** — `REVIEW: RUN`. One invocation of `/codex:review --base origin/develop`, run by Owner. `REVIEW_BASE: origin/develop`. `REVIEWED_HEAD: AWAITING_OWNER_EVIDENCE` — the Codex job record (`review-mupmvxnb-uboyuo`, 2026-10-01T14:32:56Z–14:34:18Z) does not state the reviewed SHA. No finding. Codex's result, verbatim:

> Target: branch diff against origin/develop
>
> No actionable defects were identified in the diff. The Staff schema, Identity registration and migration updates are consistent with the documented checkpoint scope. Tests were not rerun in this read-only review.

The reviewer did not rerun builds or tests. This review does not cover correction C1.

## Correction C1 (documentation only)

- Design synchronised with the Owner decisions of 2026-10-01 (header, §1, D1/D2/D3 status, §3 caveats, §4 role matrix without `Viewer`, §6 role choices, §9 size note and CP05 acceptance, §10 decided/open split). ADR 0007: Draft-PR status, explicit `IsActive`/`DisabledAtUtc` CHECK, precise Identity-claims limit. SNAPSHOT: PR #74 and the still-open items. This report: decisions, sizes, claims limit, CI and review record.
- No source, test, migration, snapshot or dependency changed relative to `59f540a`; tests NOT RERUN (docs-only), the evidence above stays tied to `59f540a`.
- Size: C1 changes +64 / −42 lines against `59f540a`; the whole PR is +2,435 / −38 (2,473 changed lines) against `origin/develop`, of which the 1,836 generated lines are unchanged.
- `REVIEW: NOT RUN` for C1 until Owner invokes `/codex:review --base origin/develop`.
