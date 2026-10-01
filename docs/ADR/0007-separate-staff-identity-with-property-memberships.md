# ADR 0007: Separate Staff identity with Property memberships

- Status: Accepted (Owner, 2026-10-01). Schema implemented by `PMS-ADMIN-AUTH-001-CP01` (migration 9, merged in PR #74). The bootstrap CLI is `PMS-ADMIN-AUTH-001-CP02` (Draft PR, not merged). Staff session, route authorization and Staff audit are later checkpoints and do not exist yet.
- Date: 2026-10-01

## Context

The Admin Reservation Board is reachable only through local, unauthenticated Development gates. Before it can be used by hotel staff it needs a staff identity and a per-Property authorization source. The only identity today is `CustomerAccount` (ASP.NET Core Identity, `AddIdentityCore`, cookie scheme `Identity.Application`). The design and its alternatives are in `docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md`.

## Decision

- Staff are a **separate Identity user type**, `StaffAccount : IdentityUser<Guid>`, in the same `TheBhaDbContext` and migration chain, stored in its own table `StaffAccounts`. `CustomerAccount` and its table are unchanged. A customer can never be, or become, a staff principal; the same email may exist once as a customer and once as staff.
- `StaffAccount` adds `IsActive`, `CreatedAtUtc` and `DisabledAtUtc`; the CHECK `CK_StaffAccounts_DisabledAtUtc` keeps `IsActive` and `DisabledAtUtc` consistent (active with no disable time, or inactive with one). Normalized email and normalized user name are unique. A staff row is disabled, never deleted.
- Authorization data is `StaffPropertyMembership(StaffAccountId, PropertyId, Role, CreatedAtUtc)`: one role per staff member and Property, primary key on the pair, `Restrict` foreign keys to `StaffAccounts` and `Properties`, and a database check on `Role`.
- Roles are exactly `FrontDesk` and `Manager` (Owner decision; no `Viewer`). `FrontDesk` may read the board, write assignments and write operational blocks; `Manager` additionally may place an assignment across RoomTypes. Adding a role later requires a migration.
- Staff are registered with `AddIdentityCore<StaffAccount>().AddEntityFrameworkStores<TheBhaDbContext>()`, without a sign-in manager or token providers. `IdentityOptions` is global, so Staff use the Customer password and lockout policy (12+ characters with upper, lower, digit and symbol; lockout after 5 failures for 15 minutes) — Owner decision. MFA is deferred.
- The Identity claim, login and token tables (`AspNetUserClaims/Logins/Tokens`) stay keyed to customers. No code calls the Staff Identity store APIs that store or read claims, external logins or tokens through them; a Staff claim write fails on that foreign key. This limits the Identity store, not the session: the Staff cookie's `ClaimsPrincipal` carries the Staff id and security stamp. Roles and Property ids are never put in the cookie as an authorization source; membership and permission are checked on the server for every request.
- Staff and memberships are created and changed only by the operator CLI on the API host (`--staff-create`, `--staff-grant`, `--staff-disable`, `--staff-reset-password`), never over HTTP and never by the development seed (Owner decision, D6). Passwords come from a hidden prompt, or `BHA_STAFF_PASSWORD` for short-lived automation — never from an argument. Each verb runs in one transaction. Production bootstrap is run by Owner or an operator Owner names, after confirming the target database. The full rules are in the design §6.

## Consequences

- One `DbContext` keeps the documented single `dotnet ef database update` command and one migration chain.
- Migration 9's `Down()` refuses to drop non-empty Staff tables.
- A stricter Staff password policy, MFA or a third role each need a later, explicit decision.
- The Staff cookie scheme, login/logout/`me`, route authorization and audit attribution are designed but not implemented; until they land, Staff rows grant no access to anything.
