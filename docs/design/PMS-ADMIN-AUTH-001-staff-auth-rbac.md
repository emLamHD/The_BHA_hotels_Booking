# PMS-ADMIN-AUTH-001 — Staff authentication and property-scoped RBAC

> Status: **proposal**, written in CP00 (baseline `0952e1b58e274a055b47ca3f04beb6fe08ed5ed8`, merged as PR #73) and synchronised with the Owner decisions of 2026-10-01 in `PMS-ADMIN-AUTH-001-CP01-C1`. Nothing below is CURRENT until a later checkpoint merges.
> Owner decisions are marked *Owner decision* and listed in §10. CP01 (Staff schema and Identity store, ADR 0007) is **merged** (PR #74, `3c1eefd`). CP02 (the Staff bootstrap CLI, §6) is in a **Draft PR, not merged**. Staff session, route authorization and Staff audit do not exist anywhere. Neither the merges of #73/#74 nor CP02 approve the items in §10 "Still open" (D3 scheme, D4, D7, D8), and the design as a whole is **not** approved.
> Scope: authentication and authorization of the Admin Reservation Board routes. Out of scope: Organization/tenant onboarding, MFA, SSO/IdP, JWT, dynamic roles, role-admin UI, Staff self-service (registration, password reset by email), any non-calendar Admin module.

## 1. Verified CURRENT (source, not history)

| Fact | Where |
|---|---|
| Customer identity is `AddIdentityCore<CustomerAccount>` (password 12+, lockout 5/15 min, unique email) with `IdentityConstants.ApplicationScheme` as default authenticate/challenge/sign-in scheme; cookie `.TheBha.Customer`, HttpOnly, `Secure` outside Development, `SameSite` from config (default Lax), 8 h sliding; 401/403 are ProblemDetails, not redirects. | `Back_End/src/TheBha.Api/Program.cs:158-204` |
| `TheBhaDbContext : IdentityUserContext<CustomerAccount, Guid>` — user-only Identity model, **no role tables**; latest migration `20260826035254_PhysicalRoomScheduleAvailabilityAuthority`. | `Infrastructure/Persistence/TheBhaDbContext.cs`, `Migrations/` |
| `HttpCurrentCustomer` reads `HttpContext.User` (the default scheme's principal). | `Api/Authentication/HttpCurrentCustomer.cs` |
| Board read is behind `AdminReservationBoardReadGateFilter`: HTTPS, Development, loopback↔loopback, `AdminCalendar:EnableUnauthenticatedRead`; otherwise empty 404. Writes are behind `AdminCalendarWriteGateFilter`: the same plus no `Forwarded`/`X-Forwarded-*`, `EnableUnauthenticatedWrite`, exactly one allowed `Origin` (403), JSON content type (415). Startup throws if either flag is on in Production. | `Api/Controllers/AdminReservationBoardReadGateFilter.cs`, `AdminCalendarWriteGateFilter.cs`, `Program.cs:65-113` |
| Admin CORS policies are **uncredentialed** (`admin-calendar` GET; `admin-calendar-write` POST + `Content-Type`); `Cors:AdminOrigins` must be explicit HTTPS origins. Write controllers use `[IgnoreAntiforgeryToken]`; the global `AutoValidateAntiforgeryToken` protects the rest. | `Program.cs:219-286`, `Program.cs:130-135`, controllers |
| Audit actor is the constant `admin-calendar-local-development` (assignments and block header); cross-RoomType evidence is the constant `local-development-write-gate:cross-room-type-confirmed`, written only when the request confirms a cross-RoomType placement and a reason is present. Column limits: `ActorReference` 200, `AuthorizationEvidence` 500. | `AdminReservationAssignmentsController.cs:208-216`, `AdminOperationalBlocksController.cs:156`, `Domain/Scheduling/SchedulingFieldLimits.cs`, `AssignmentMutationStore.cs:116,378` |
| Admin_Web sends every write with `credentials: "omit"`; reads use the default fetch credentials. The Property selector uses the public `GET /api/v1/properties`. | `Front_End/Admin_Web/src/lib/api/client.ts` |
| Written at `874f148`, before any Staff code. Since CP01 (PR #74, `3c1eefd`) `develop` has the Staff schema and Identity store, but no Staff session, route authorization or Staff audit. | whole tree |

## 2. Decisions

| # | Decision | Owner approval |
|---|---|---|
| D1 | Staff are a **separate identity**: new `StaffAccount : IdentityUser<Guid>` in the same `TheBhaDbContext` (§3). `CustomerAccount` is not touched. | *Owner decision* (2026-10-01); ADR 0007 |
| D2 | Authorization is server-side, per request, from `StaffPropertyMembership(Staff, Property, Role)`; roles map to a fixed permission set in code (§4). | *Owner decision:* exactly `FrontDesk` and `Manager`, no `Viewer` (2026-10-01), with the permissions in §4 |
| D3 | Staff session = its own cookie scheme `TheBha.Staff`; the Customer scheme stays the default and is unchanged (§5). Lifetime **8 h absolute, not sliding** — *Owner decision*. | lifetime decided; scheme: open |
| D4 | CSRF protection for Staff = `SameSite=Strict` + exact `Origin` allow-list on every non-GET + JSON content type; no antiforgery tokens (§5). | confirm |
| D5 | Admin_Web and the API are deployed **same-site** (one registrable domain, or localhost in dev) — *Owner decision*. | decided |
| D6 | First Staff and memberships are created only by a controlled CLI command, never by an HTTP route (§6). | *Owner decision* (2026-10-01), scope in §6 |
| D7 | Cut-over uses an explicit `AdminCalendar:AccessMode` switch; a route without a Staff policy is closed in `Staff` mode (§7). | confirm |
| D8 | Audit actor becomes `staff:{StaffAccountId}`; historical rows are untouched (§8). | confirm |

## 3. Staff identity

| Option | Verdict |
|---|---|
| A. Second Identity user type `StaffAccount` in the **same** `TheBhaDbContext`, `AddIdentityCore<StaffAccount>().AddEntityFrameworkStores<TheBhaDbContext>()`. Own table `StaffAccounts`. | **Chosen.** One context, one migration command (`AGENTS.md` §9 has no `--context` flag), full `UserManager` (hashing, lockout, security stamp, password policy). |
| B. Reuse `CustomerAccount` with a staff flag/claims. | Rejected: a customer cookie could become a staff session; same email = same principal; violates the brief. |
| C. Second `DbContext` for staff. | Rejected: two contexts make the documented `dotnet ef database update` ambiguous and split migrations. |
| D. Hand-rolled hashing and lockout. | Rejected: re-implements Identity for no gain. |
| E. JWT / external IdP. | Out of scope (brief). |

Feasibility was **checked with a throwaway spike outside the repo** (EF 8.0.29 / Npgsql 8.0.11, same packages): with `StaffAccount` mapped as a plain entity (`ToTable("StaffAccounts")`, unique `NormalizedEmail`/`NormalizedUserName`, concurrency stamp), `AddIdentityCore<StaffAccount>` resolved `UserManager<StaffAccount>` beside `UserManager<CustomerAccount>`, and these behaved: create, duplicate email/user name rejected, lookup by email (case-insensitive), password check, lockout after 5 failures, security-stamp rotation, change password, weak password rejected; the same email could exist as customer and staff without interference. Not verified by the spike: `SignInManager` (deliberately not used, see §5). The migration output was generated and tested in CP01 (Draft PR #74).

Caveats CP01 must respect:
- `IdentityOptions` (password policy, lockout) is **global**: Staff inherits the Customer values (12 chars, upper/lower/digit/symbol, lockout 5 / 15 min) — *Owner decision* (2026-10-01); MFA is deferred. A stricter Staff policy would need a separate validator, not a different option object.
- `AspNetUserClaims/Logins/Tokens` stay keyed to `CustomerAccount`. No code may call the Staff Identity store APIs that store or read claims, external logins or user tokens (`UserManager<StaffAccount>` claim/login/token methods), because they go through those Customer-keyed tables; no token providers are registered for Staff. This limits the **Identity store**, not the session: the Staff cookie's `ClaimsPrincipal` still carries the Staff id and security stamp (§5). The default `UserClaimsPrincipalFactory<StaffAccount>` reads `AspNetUserClaims` through `GetClaimsAsync` (ASP.NET Core `UserClaimsPrincipalFactory.cs`), so CP03 builds the Staff principal from the Staff id and security stamp without that read, and a CP03 test proves it.
- New tables (generated by one migration): `StaffAccounts` (Identity columns + `IsActive`, `CreatedAtUtc`, `DisabledAtUtc`) and `StaffPropertyMemberships` (`StaffAccountId`, `PropertyId`, `Role` text with a CHECK, `CreatedAtUtc`; PK (`StaffAccountId`,`PropertyId`); FK `Restrict` to `StaffAccounts` and `Properties`). A Staff row is never deleted, only disabled.
- The durable Identity decision is recorded as `docs/ADR/0007-separate-staff-identity-with-property-memberships.md` in CP01 (*Owner decision*, 2026-10-01).

## 4. Property authorization and RBAC (roles and permissions: *Owner decision*)

Permissions (code constants): `BoardRead`, `AssignmentWrite` (create / move / unassign, same-RoomType), `AssignmentCrossRoomType` (create or move with `confirmCrossRoomType`), `BlockWrite` (create / cancel).

| Role | BoardRead | AssignmentWrite | BlockWrite | AssignmentCrossRoomType |
|---|---|---|---|---|
| `FrontDesk` | ✔ | ✔ | ✔ | – |
| `Manager` | ✔ | ✔ | ✔ | ✔ |

`Manager` differs from `FrontDesk` only by `AssignmentCrossRoomType`. There is no `Viewer` role (*Owner decision*, 2026-10-01); the database CHECK allows exactly these two roles, so adding a role needs a migration.

Rules:
- One role per (Staff, Property). No cross-Property effect: a membership never implies another Property, and cross-RoomType stays within the sold unit's Property (blueprint §12).
- The check runs on every request against the database with the route's `propertyId` as the **resource**; the cookie carries only the Staff id and security stamp, never roles or Property ids. A client-supplied Property, role or permission is never trusted.
- Missing/invalid session → 401; authenticated without the permission or membership → 403 (ProblemDetails). A cross-RoomType request from a role without the permission is refused **before** the store is called.
- One seam: `IStaffAccessEvaluator.HasPermission(staffId, propertyId, permission)`. No dynamic permission engine, no role UI.
- **Organization boundary.** CURRENT has no `Organization` (blueprint §3). This slice is Property-scoped only. When `Organization` arrives it adds an organization membership *above* Property and the evaluator's implementation; routes, policies and the cookie do not change. Tenant onboarding is not part of this milestone.

## 5. Session and browser integration

- Scheme `TheBha.Staff`; cookie `.TheBha.Staff`, HttpOnly, `Path=/api/admin`, `Secure` Always outside Development (same rule as the Customer cookie), `SameSite=Strict`, 8 h **absolute** (no sliding; *Owner decision*), events write 401/403 ProblemDetails — never a redirect. Cookie payload: Staff id + security stamp.
- The default scheme stays Customer. Admin controllers use `[Authorize(AuthenticationSchemes = "TheBha.Staff", Policy = …)]`; a Customer cookie cannot satisfy them, and a Staff cookie cannot satisfy Customer routes (CP03 tests both directions). `SignInManager<CustomerAccount>` is not shared; login uses `UserManager<StaffAccount>` + `HttpContext.SignInAsync("TheBha.Staff", principal)`.
- Endpoints: `POST /api/admin/v1/auth/login` (`{email,password}` → 200 with the Staff summary and memberships; 401 with one generic message; rate-limited by a new `staff-login` policy; lockout via `UserManager`), `POST …/auth/logout` (204), `GET /api/admin/v1/me` (memberships with Property name, time zone and role — the source of the Admin Property selector; 401 without a session).
- CSRF (D4): cookies are `SameSite=Strict`, and every Staff `POST` (login included) passes the existing exact-`Origin` check, extracted from `AdminCalendarWriteGateFilter`, and the JSON content-type check. Chosen over tokens because the Customer antiforgery cookie/claims are shared global state that Staff tokens would entangle.
- CORS: one new **credentialed** policy `admin-staff` (explicit HTTPS `Cors:AdminOrigins`, `AllowCredentials`, `GET`/`POST`, `Content-Type` only). The Customer policies and the public `properties-catalog-read` are unchanged. Admin_Web switches admin calls to `credentials: "include"`.
- HTTPS: all Staff routes require HTTPS; Development keeps `SameAsRequest` cookies like the Customer cookie. Same-site (D5, *Owner decision*) is required because `SameSite=Strict` cookies are not sent on cross-site requests.
- Invalidation, all effective on the **next request**: Staff disabled (`IsActive=false`) → 401; password change or reset → `UserManager` rotates the security stamp → cookie rejected; membership removed or role changed → the per-request database check → 403 / changed `me`. `OnValidatePrincipal` reloads the Staff row on every request (Staff volume is small; no cache to go stale). Logout clears the cookie only; a stolen cookie is valid until expiry or stamp rotation (residual, documented).
- Customer_Web: no change to its scheme, cookie, CORS, antiforgery or contract; a regression test pins each.

## 6. Bootstrap

A CLI verb on the API host, in the style of `--seed-development`: `--staff-create --email <e> --property-id <guid> --role <FrontDesk|Manager>`, `--staff-grant` (same arguments), `--staff-disable --email <e>`, `--staff-reset-password --email <e>`. The password is read from the environment variable `BHA_STAFF_PASSWORD` or an interactive hidden prompt — never a command-line argument, never a default, never in Git; it must pass the Identity policy. The command prints the target database (host/name, no secret) and Staff id only, works in any environment against the configured database, and there is **no HTTP registration**. `DevelopmentDataSeeder` does not create Staff. Implemented in CP02 (`Api/Authentication/StaffBootstrapCommand.cs`, Draft PR).

Bootstrap scope (*Owner decision*, 2026-10-01):
- Exactly one verb per invocation, validated before any change; exit 0 on success or no-op, non-zero otherwise; no HTTP listener and no seed.
- Production is run by Owner or an operator Owner names, on the API host in a controlled admin session, after confirming the printed target database.
- The hidden prompt is the default; `BHA_STAFF_PASSWORD` is only for short-lived automation; redirected input without the variable is refused. Credentials are handed over through a password manager with limited sharing — never in arguments, Git or logs.
- Create adds the Staff and its membership in one transaction. Grant with the same role is a no-op; a different role replaces it; grant never creates a Staff or a Property and never re-enables a disabled Staff.
- Disable sets `IsActive=false`, `DisabledAtUtc` and rotates the security stamp in one update; repeating it changes nothing.
- Reset-password (remove + add inside one transaction, no token providers) keeps the old password if the new one is refused, and neither unlocks a locked-out account nor re-enables a disabled one.

## 7. Route cut-over

| Route (called by the board today) | Permission |
|---|---|
| `GET /api/admin/v1/properties/{propertyId}/reservation-board` | `BoardRead` |
| `POST …/reservation-assignments` | `AssignmentWrite`; + `AssignmentCrossRoomType` when `confirmCrossRoomType` |
| `POST …/reservation-assignments/{segmentId}/move` | same as above |
| `POST …/reservation-assignments/{segmentId}/unassign` | `AssignmentWrite` |
| `POST …/operational-blocks` | `BlockWrite` |
| `POST …/operational-blocks/{segmentId}/cancel` | `BlockWrite` |
| `GET /api/v1/properties` (selector) | replaced for Admin by `GET /api/admin/v1/me`; stays public for Customer |

`AdminCalendar:AccessMode = LocalGate | Staff`. `LocalGate` is today's behaviour (Development only; startup already throws in Production if a flag is on). In `Staff` mode the local gates and their flags are **not consulted** (a flag cannot open a Staff route) and a route without a Staff policy is **closed (404)**, so a partly converted host never leaves a write open. Default stays `LocalGate` in Development until the Admin_Web checkpoint (CP06) merges; CP07 makes `Staff` the default, makes Production require it, and leaves `LocalGate` an explicit Development-only opt-in. Production is not opened before CP07's acceptance. The board's Property selector lists only the Staff's memberships; no membership → an explicit empty state; the UI may hide actions the role lacks, but the server enforces.

## 8. Audit

`ActorReference = staff:{StaffAccountId}` (a GUID: stable, no email/PII, ≤ 200) for assignments and the `RoomBlock` header. Cross-RoomType keeps the current rule (evidence and reason only for a confirmed cross-RoomType placement) with `AuthorizationEvidence = staff-rbac:{role}:{propertyId}:cross-room-type-confirmed` (≤ 500). Existing rows keep `admin-calendar-local-development`; no backfill, no invented Staff. Anonymous `LocalGate` writes keep the old constants.

## 9. Checkpoints (each one Draft PR; "≈ lines" = CP00 estimate, kept as history; hand-written + tests + docs, generated shown apart)

Since 2026-10-01, 100–400 changed lines per PR is a **target, not a limit** (`docs/governance/WORKFLOW.md` §6): a PR outside it states the GitHub figure and the reason. CP01's earlier size exception (2026-10-01) is history; its size is explained in `docs/reports/PMS-ADMIN-AUTH-001-CP01-completion.md`.

| CP | Behaviour after merge | Depends | Scope | Acceptance (minimum) | ≈ lines |
|---|---|---|---|---|---|
| CP01 | Staff tables exist; no endpoint, no behaviour change | – | `StaffAccount`, `StaffPropertyMembership`, `StaffRole`, EF config, `AddIdentityCore<StaffAccount>`, one migration, ADR 0007 | PostgreSQL tests: create/duplicate/lockout/stamp, membership FK/PK/CHECK; Customer auth tests unchanged; migration applies on a fresh DB | CP00 estimate: ~300 hand-written + ~1,700 **generated**. Measured at PR #74 head `59f540a`: +2,389 / −14, of which 1,836 generated (Designer 1,615, snapshot +123, migration body 98) |
| CP02 | Operator can create/grant/disable/reset Staff | CP01 | CLI verbs, secret input, tests | no password in args/output; weak password refused; idempotent grant | ~350 (CP00 estimate); actual size in `docs/reports/PMS-ADMIN-AUTH-001-CP02-completion.md` |
| CP03 | Staff can log in/out and read `me` | CP01–02 | scheme, cookie events, login/logout/me, `admin-staff` CORS, Origin check extraction, rate limit | 401/403 JSON; Customer↔Staff cookie isolation both ways; disable/stamp invalidation; no redirect | ~400 |
| CP04 | `AccessMode` + evaluator; board read authorized in `Staff` mode | CP03 | `IStaffAccessEvaluator`, permission map, policies, mode switch, guards, read route | member ok, non-member 403, no session 401; `Staff` mode ignores the read flag; unconverted routes 404 | ~350 |
| CP05 | Five write routes authorized; audit from Staff | CP04 | policies, actor/evidence, cross-RoomType permission | per route: `FrontDesk` assign / move / unassign / block create / block cancel, but 403 on `confirmCrossRoomType`; `Manager` all; 403 before the store; audit rows carry `staff:{id}`; `LocalGate` unchanged | ~400 |
| CP06 | Admin_Web login, `credentials: include`, selector from `me` | CP05 | login page, client, 401/403 handling, permission-aware controls | unit tests + live acceptance in `Staff` mode incl. reload protection unchanged | ~400 |
| CP07 | `Staff` default; Production requires it; docs current | CP06 | config defaults, startup guard, SNAPSHOT/BIBLE/ADR | Production + `LocalGate` refuses to start; end-to-end live acceptance | ~250 |

If CP01's generated migration is judged too large to review, the only honest split is not to split it: model and migration must land together. CP03 and CP06 sit at the upper bound and should be split at the login/`me` and login-page seams if they grow.

## 10. Owner decisions

**Decided in CP00 (recorded in CP00-C1):**
1. `FrontDesk` has `BoardRead`, `AssignmentWrite` and `BlockWrite`; `Manager` additionally has `AssignmentCrossRoomType`.
2. Admin_Web and the API are deployed same-site, so the `SameSite=Strict` + Origin design stands (a different topology would reopen §5).
3. The Staff session lasts 8 hours absolute, without sliding renewal.

**Decided 2026-10-01 (before CP01; 4–6 recorded in ADR 0007, 8 in the CP01 completion report):**
4. D1: Staff are a separate Identity user type in the same `TheBhaDbContext`.
5. Roles are exactly `FrontDesk` and `Manager`; there is no `Viewer`.
6. Staff use the Customer password and lockout policy; MFA is deferred.
7. ADR 0007 is part of CP01.
8. CP01 alone may exceed the 100–400 changed-line limit, with the explanation in its PR and completion report (history: superseded by item 10).

**Decided at CP02 activation, 2026-10-01 (recorded in ADR 0007 and `docs/governance/WORKFLOW.md` §6):**
9. D6: bootstrap only by the four CLI verbs, with the production operator, secret handling, grant, disable and reset rules in §6.
10. 100–400 changed lines per PR is a target, not a limit; a PR outside it states its GitHub size and the reason.

**Still open:**
1. D3: the separate `TheBha.Staff` cookie scheme (its 8 h absolute lifetime is decided above).
2. D4: CSRF by `SameSite=Strict` + exact Origin + JSON content type, without antiforgery tokens.
3. D7: the `AdminCalendar:AccessMode` cut-over.
4. D8: `staff:{StaffAccountId}` audit actor.
