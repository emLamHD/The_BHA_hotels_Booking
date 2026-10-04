# PMS-ADMIN-AUTH-001 — Staff authentication and property-scoped RBAC

> Status: **proposal**, written in CP00 (baseline `0952e1b58e274a055b47ca3f04beb6fe08ed5ed8`, merged as PR #73) and synchronised with the Owner decisions of 2026-10-01 in `PMS-ADMIN-AUTH-001-CP01-C1`. Nothing below is CURRENT until a later checkpoint merges.
> Owner decisions are marked *Owner decision* and listed in §10. CP01 (Staff schema and Identity store, ADR 0007) is **merged** (PR #74, `3c1eefd`); CP02 (the Staff bootstrap CLI, §6) is **merged** (PR #75, `6baefe9`). CP03 (the Staff session, §5) is **merged** (PR #76, `c89efc2`); D3 and D4 were decided by Owner when CP03 was activated (2026-10-03). D7 was decided by Owner when CP04 was activated (2026-10-03); CP04 (`AccessMode`, the evaluator and Staff authorization of the Board read, §4 and §7) is **merged** (PR #77, `f3f705f`). D8 was decided by Owner when CP05 was activated (2026-10-03); CP05 (Staff authorization and audit of the five Calendar writes, §7 and §8) is **merged** (PR #78, `8f62229`). CP06 (the Admin_Web Staff session, §5 and §7) is in a **Draft PR, not merged**. The default/Production cut-over (CP07) does not exist, and the design as a whole is **not** approved or Production-ready.
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
| Written at `874f148`, before any Staff code. Since CP05 (PR #78, `8f62229`) `develop` has the Staff schema, Identity store, bootstrap CLI, session, `AccessMode`, Staff authorization of the Board read and of the five writes, and the Staff audit actor, but Admin_Web still has no Staff sign-in; CP06 (Draft) adds it. | whole tree |

## 2. Decisions

| # | Decision | Owner approval |
|---|---|---|
| D1 | Staff are a **separate identity**: new `StaffAccount : IdentityUser<Guid>` in the same `TheBhaDbContext` (§3). `CustomerAccount` is not touched. | *Owner decision* (2026-10-01); ADR 0007 |
| D2 | Authorization is server-side, per request, from `StaffPropertyMembership(Staff, Property, Role)`; roles map to a fixed permission set in code (§4). | *Owner decision:* exactly `FrontDesk` and `Manager`, no `Viewer` (2026-10-01), with the permissions in §4 |
| D3 | Staff session = its own cookie scheme `TheBha.Staff`; the Customer scheme stays the default and is unchanged (§5). Lifetime **8 h absolute, not sliding** — *Owner decision*. | *Owner decision* (lifetime at CP00; scheme at CP03 activation, 2026-10-03) |
| D4 | CSRF protection for Staff = `SameSite=Strict` + exact `Origin` allow-list on every non-GET + JSON content type; no antiforgery tokens (§5). | *Owner decision* (CP03 activation, 2026-10-03) |
| D5 | Admin_Web and the API are deployed **same-site** (one registrable domain, or localhost in dev) — *Owner decision*. | decided |
| D6 | First Staff and memberships are created only by a controlled CLI command, never by an HTTP route (§6). | *Owner decision* (2026-10-01), scope in §6 |
| D7 | Cut-over uses an explicit `AdminCalendar:AccessMode` switch; a route without a Staff policy is closed in `Staff` mode (§7). | *Owner decision* (CP04 activation, 2026-10-03), rules in §10 item 13 |
| D8 | Audit actor becomes `staff:{StaffAccountId}`; historical rows are untouched (§8). | *Owner decision* (CP05 activation, 2026-10-03), rules in §10 item 14 |

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
- The default scheme stays Customer. Staff routes name the `TheBha.Staff` scheme explicitly — the CP03 session routes with `[Authorize(AuthenticationSchemes = "TheBha.Staff")]`, converted Calendar routes through the CP04 permission filter, which authenticates that scheme itself (§7) — so a Customer cookie cannot satisfy them, and a Staff cookie cannot satisfy Customer routes (CP03 and CP04 test both). `SignInManager<CustomerAccount>` is not shared; login uses `UserManager<StaffAccount>` + `HttpContext.SignInAsync("TheBha.Staff", principal)`.
- Endpoints: `POST /api/admin/v1/auth/login` (`{email,password}` → 200 with the Staff summary and memberships; 401 with one generic message; rate-limited by a new `staff-login` policy; lockout via `UserManager`), `POST …/auth/logout` (204), `GET /api/admin/v1/me` (memberships with Property name, time zone and role — the source of the Admin Property selector; 401 without a session).
- CSRF (D4): cookies are `SameSite=Strict`, and every Staff `POST` (login included) passes the existing exact-`Origin` check, extracted from `AdminCalendarWriteGateFilter`, and the JSON content-type check. Chosen over tokens because the Customer antiforgery cookie/claims are shared global state that Staff tokens would entangle.
- CORS: one new **credentialed** policy `admin-staff` (explicit HTTPS `Cors:AdminOrigins`, `AllowCredentials`, `GET`/`POST`, `Content-Type` only). The Customer policies and the public `properties-catalog-read` are unchanged. Admin_Web switches admin calls to `credentials: "include"`.
- HTTPS: all Staff routes require HTTPS; Development keeps `SameAsRequest` cookies like the Customer cookie. Same-site (D5, *Owner decision*) is required because `SameSite=Strict` cookies are not sent on cross-site requests.
- Invalidation, all effective on the **next request**: Staff disabled (`IsActive=false`) → 401; password change or reset → `UserManager` rotates the security stamp → cookie rejected; membership removed or role changed → the per-request database check → 403 / changed `me`. `OnValidatePrincipal` reloads the Staff row on every request (Staff volume is small; no cache to go stale). Logout clears the cookie only; a stolen cookie is valid until expiry or stamp rotation (residual, documented).
- Customer_Web: no change to its scheme, cookie, CORS, antiforgery or contract; a regression test pins each.

**As implemented in CP03** (merged in PR #76, `c89efc2`; `Api/Authentication/StaffAuthentication.cs`, `StaffRequestBoundaryFilter.cs`, `AdminRequestBoundary.cs`, `Controllers/StaffAuthController.cs`; evidence in `docs/reports/PMS-ADMIN-AUTH-001-CP03-completion.md`):
- Principal: one `ClaimsIdentity` of type `TheBha.Staff` with exactly two claims, the Staff id (`NameIdentifier`) and `thebha:staff:security-stamp`. Built in code, never by `UserClaimsPrincipalFactory<StaffAccount>`; no role, Property id or email. A SQL-command test proves the login/`me`/logout path never touches `AspNetUserClaims/Logins/Tokens` or `AspNetUsers`.
- Ticket: `IsPersistent=false` (a browser-session cookie, no `Expires`), `AllowRefresh=false`, `IssuedUtc` and `ExpiresUtc = IssuedUtc + 8 h` from the application `TimeProvider`, which is also the handler's clock. `OnValidatePrincipal` rejects at **and after** `ExpiresUtc` (the handler alone accepts the exact instant) and any ticket whose span exceeds 8 h; no request renews it.
- `OnValidatePrincipal` reloads `IsActive` and `SecurityStamp` on every request; a missing/malformed claim, unknown or disabled Staff or a different stamp rejects the principal and deletes the Staff cookie only. Lockout does **not** end an existing session (otherwise anyone could end a Staff session by failing logins).
- Login: unknown, disabled and locked-out accounts and a wrong password all answer one 401 (`Authentication failed`), and the first three still run one password hash so their timing matches a wrong password. A wrong password calls `AccessFailedAsync` (lockout 5 / 15 min); the right password during lockout is refused. A success always writes the authenticated account back in an update checked against the concurrency stamp it was loaded with, before the session is issued — `ResetAccessFailedCountAsync` when failures are on record, `UpdateAsync` when there are none (corrections C1/C2) — and a failed write (e.g. a concurrent lockout) is the same generic 401 without a cookie. The login password has no maximum length (C1), so every password the CLI accepts can sign in. 200 returns `{staffAccountId, email, memberships[{propertyId, propertyName, timeZone, role}]}`; `me` returns the same shape, read from the database, ordered by Property name then id (ordinal). Memberships of an inactive Property are listed as stored.
- Boundary (D4): `StaffRequestBoundaryFilter`, a resource filter on the whole controller, sets `no-store`, refuses cleartext (404), and for every non-GET request requires exactly one approved `Origin` (403) then UTF-8 JSON (415) before model binding. `AdminCalendarWriteGateFilter` now calls the same two predicates (`AdminRequestBoundary`), with its order and responses unchanged. `logout` and `me` are authorized by the middleware first, so without a session they answer 401 before the boundary. An empty `Cors:AdminOrigins` refuses every Staff write.
- HTTPS: the cleartext guard ahead of `UseHttpsRedirection` also refuses every method on `/api/admin/v1/auth/*` and `/api/admin/v1/me` (404, `no-store`, no `Location`). No forwarded-header middleware; topology unchanged.
- Rate limit: policy `staff-login`, fixed window per remote IP, `StaffAuthentication:LoginRateLimiting:PermitLimit` (default 10) / `WindowSeconds` (default 60), positive or the host refuses to start; 429 ProblemDetails with `no-store`. Behind a proxy every client shares one partition until a forwarded-header decision exists.
- Residual, by design: logout deletes the cookie but does not rotate the stamp, so a copied cookie stays valid until 8 h or the next disable/reset.

## 6. Bootstrap

A CLI verb on the API host, in the style of `--seed-development`: `--staff-create --email <e> --property-id <guid> --role <FrontDesk|Manager>`, `--staff-grant` (same arguments), `--staff-disable --email <e>`, `--staff-reset-password --email <e>`. The password is read from the environment variable `BHA_STAFF_PASSWORD` or an interactive hidden prompt — never a command-line argument, never a default, never in Git; it must pass the Identity policy. The command prints the target database (host/name, no secret) and Staff id only, works in any environment against the configured database, and there is **no HTTP registration**. `DevelopmentDataSeeder` does not create Staff. Implemented in CP02 (`Api/Authentication/StaffBootstrapCommand.cs`, merged in PR #75).

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

**As implemented in CP04** (merged in PR #77, `f3f705f`; `AdminCalendarOptions.cs`, `Api/Authentication/StaffAccessEvaluator.cs`, `StaffCalendarPermissionAttribute.cs`, `StaffCalendarAccessFilter.cs`, `StaffCalendarModeGuard.cs`; evidence in `docs/reports/PMS-ADMIN-AUTH-001-CP04-completion.md`):
- Mode: `AdminCalendar:AccessMode` absent → `LocalGate`; present → exactly `LocalGate` or `Staff` (ordinal), anything else (empty, other casing, a number, a nested section) stops the host. Read once in `Program.cs` and handed on as a value, so neither a reloadable source nor a later configuration change can switch it; only a restart does. The Production guards on the two local flags stay in both modes.
- Evaluator: `IStaffAccessEvaluator.HasPermissionAsync(staffId, propertyId, permission, ct)` reads the one membership of that active Staff member at that Property from the database on every call, honours cancellation, and grants only the §4 map; any other role or permission value is denied. The four permissions exist; only `BoardRead` is attached to a route.
- Board: `StaffCalendarPermissionAttribute(BoardRead, typeof(AdminReservationBoardReadGateFilter))` replaces the read gate's `[ServiceFilter]` and is itself the filter. In `LocalGate` it returns the read gate unchanged, in the same place. In `Staff` mode it returns `StaffCalendarAccessFilter`, a resource filter (before model binding): `no-store`, cleartext 404, `AuthenticateAsync("TheBha.Staff")` — never the default Customer principal — then a challenge (401) or the evaluator at the route's `propertyId` and a forbid (403), both as the Staff cookie events' ProblemDetails. A non-member gets 403 whether or not the Property exists; a member of an inactive Property gets the query's 404. Validation (400) is reached only by a member.
- Guard (`Staff` mode only, after routing, before CORS/authentication): an endpoint under `/api/admin` (request path or route pattern) passes only if its metadata carries `StaffCalendarPermissionAttribute` or it is `StaffAuthController.Login`/`Logout`/`Me`; anything else — the five writes, `[Authorize]`/`[AllowAnonymous]` routes, absent routes — is 404 `no-store`, preflights included. The cleartext guard refuses every `/api/admin` method in `Staff` mode.
- CORS: in `Staff` mode a credentialed GET-only policy `admin-staff-calendar-read` for the explicit HTTPS Admin origins is added to Staff-authorized GET endpoints (the board) as endpoint metadata; `admin-calendar` and `admin-calendar-write` are unchanged and `LocalGate` keeps the uncredentialed board policy.
- OpenAPI: the board is documented for the mode the host runs (`StaffCookie` in `Staff` mode, none in `LocalGate`), with 401/403 marked as Staff-mode answers.
- Not in CP04: the five writes' Staff policies, Staff audit (D8), Admin_Web, the default switch and Production. `Staff` mode is selectable by configuration but is not configured anywhere and is not a Production cut-over.

**As implemented in CP05** (merged in PR #78, `8f62229`; `Api/Authentication/StaffCalendarWriteContext.cs`, `StaffCalendarAccessFilter.cs`, `StaffAccessEvaluator.cs`, the two write controllers, `Program.cs`; evidence in `docs/reports/PMS-ADMIN-AUTH-001-CP05-completion.md`):
- The five writes carry `StaffCalendarPermission` **per action** (create/move/unassign `AssignmentWrite`, block create/cancel `BlockWrite`) with `AdminCalendarWriteGateFilter` as the LocalGate filter; the controller-level gate attribute is removed, so `LocalGate` runs exactly that gate once, in the same place, and an action added later is closed in `Staff` mode by the guard. A test pins the per-action metadata.
- `Staff` mode, all before model binding: `no-store`, cleartext 404, `AuthenticateAsync("TheBha.Staff")` (401), the role read **once** from the database at the route's `propertyId` (`IStaffAccessEvaluator.GetRoleAsync`; 403 if it does not grant the base permission), then the CP03 boundary (exactly one approved `Origin` → 403, UTF-8 JSON → 415). The verified Staff id, Property and role are kept as `StaffCalendarWriteContext` for the action.
- Create/move with `confirmCrossRoomType=true` also need `AssignmentCrossRoomType` from that same role, else 403 before the store — whatever the destination room. Without confirmation no evidence is made, and the store still refuses an actual cross-RoomType placement; a confirmed one without a reason is still the store's refusal. Unassign needs only `AssignmentWrite`, also for a cross-type segment.
- Audit (D8): actor `staff:{StaffAccountId}` (canonical GUID) for every assignment row, the RoomBlock header and every block audit row; evidence `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed` from the verified role and route Property, forwarded only when confirmed and permitted; the store keeps it only on cross-type `Created` rows. A missing or mismatched context refuses (403) rather than falling back to the local actor. `LocalGate` keeps `admin-calendar-local-development` and `local-development-write-gate:cross-room-type-confirmed`; history is untouched.
- CORS/OpenAPI: in `Staff` mode the converted POSTs get a credentialed POST-only `Content-Type` policy for the HTTPS Admin origins (`admin-staff-calendar-write`); the board keeps its GET-only policy and `LocalGate` the uncredentialed `admin-calendar-write`. OpenAPI documents the writes for the running mode (`StaffCookie`, base and conditional cross permission, 401 and a 403 covering permission/Origin/store in `Staff` mode; the declared responses unchanged in `LocalGate`).
- Not in CP05: Admin_Web (CP06), the default switch and Production (CP07).

**As implemented in CP06** (Draft PR; Admin_Web only — `src/lib/api/accessMode.ts`, `staff.ts`, `client.ts`, `src/components/auth/StaffSession.tsx`, `SignInForm.tsx`, `src/components/calendar/reservation-board/CalendarAccessGate.tsx`, `calendarAccess.ts`, `ReservationBoard.tsx`; evidence in `docs/reports/PMS-ADMIN-AUTH-001-CP06-completion.md`):
- `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE`: unset → `LocalGate`; exactly `LocalGate` or `Staff`; empty or any other value is a configuration error on `/calendar` and on `/signin`, and no Calendar, `me` or login request is sent. No probing, no fallback between modes; it is inlined at build time, so a change needs a rebuild/restart. It must match the backend's `AdminCalendar:AccessMode`; the frontend does not detect a mismatch (the server refuses).
- `LocalGate`: the CP05 contract unchanged — public catalog for the selector, board read with default credentials, writes with `credentials: "omit"`, no Staff UI.
- `Staff`: login, logout, `me`, the board and the five writes use `credentials: "include"` (`cache: "no-store"` on the session calls and the board). No Origin header is set by hand, and no actor, role or evidence is sent in a body. `/calendar` is gated by `me`: checking → nothing of the board; 401 → `/signin`; a failed check → an error with Retry, never a redirect and never `LocalGate`. The selector is built from `me.memberships`; the public catalog is not requested; no membership → an explicit empty state.
- `/signin` posts the email (trimmed) and the password exactly as typed (no trim, normalisation or length limit), clears the password field after every attempt, guards against double submit, then confirms the session with `me` before opening `/calendar`. 401/429/400/network/other each have their own message.
- Permissions follow the role at the selected Property (`FrontDesk`: assign/move/unassign within the sold RoomType and block create/cancel; `Manager`: also the confirmed cross-RoomType placement; any other role: board read refused in the UI and no actions). The UI hides what the role lacks; the server still decides.
- 401 on any board read or write ends the session (the board is cleared, then `/signin`); a write 401 is a refusal — proof of no write — never an unknown outcome. 403 on a board read shows access denied and re-reads `me`; 403 on a write (other than the store's cross-RoomType confirmation answer) re-reads `me` and updates the permissions in place without resending. Session expiry is deferred until in-flight writes settle, and Sign out is disabled while a write is in flight; stale responses from an earlier session are dropped.
- Correction C1 (Codex review of CP06, 2 findings): Sign out and the board's writes exclude each other on refs read at the moment each starts. A write on the wire holds Sign out; a pending sign-out pauses every write control and every send-time check (`not-sent`, no intent). A refresh asked for during a pending sign-out never supersedes it: after a confirmed sign-out it is dropped; after an unconfirmed one it runs once before the page resumes changes.
- Correction C2 (Codex review of C1, 2 findings): the sign-out transition lasts until that re-read has answered. A permission re-read already on the wire when Sign out is clicked is taken over and redone after an unconfirmed logout (its caller gets the new answer); a refresh asked for during the re-read joins it. A re-read that finds no session ends it; one that cannot check access closes access as an error with Retry. The gate reopens writes only after the render carrying the re-read roles has committed.
- Correction C3 (Codex review of C2, 1 finding): the same contract holds for every re-read after a denial (board read or write `403`), not only around sign-out. While it is under way no write starts (controls and send-time checks); `authenticated` reopens writes on the re-read roles after they render; `unauthenticated` ends the session; an error — or a check superseded with nothing newer to decide — closes access as an error with Retry ("Your Staff access could not be checked again: …"), once the board's writes on the wire are settled. Retry reads `me` again.
- Correction C4 (Codex review of C3, 1 finding): a failure deferred behind the board's writes belongs to the check that produced it. A newer check, or the end of the session, drops it; when the writes settle it is acted on at most once, and only if its check is still the latest — so a stale failure can never close a session that a newer check has verified, nor replace an ended one.
- Uncertain writes: the pending/unknown records in `sessionStorage` are unchanged — not cleared on sign-out, expiry or a change of Staff, and not namespaced per Staff, so the lock and reconciliation survive a reload and a different Staff signing in on the same tab and Property. Nothing about the session (password, cookie, token or session DTO) is written to browser storage, the URL or logs.
- Not in CP06: any backend change, the default switch, Production and Customer_Web (CP07 and later).

`AdminCalendar:AccessMode = LocalGate | Staff`. `LocalGate` is today's behaviour (Development only; startup already throws in Production if a flag is on). In `Staff` mode the local gates and their flags are **not consulted** (a flag cannot open a Staff route) and a route without a Staff policy is **closed (404)**, so a partly converted host never leaves a write open. Default stays `LocalGate` in Development until the Admin_Web checkpoint (CP06) merges; CP07 makes `Staff` the default, makes Production require it, and leaves `LocalGate` an explicit Development-only opt-in. Production is not opened before CP07's acceptance. The board's Property selector lists only the Staff's memberships; no membership → an explicit empty state; the UI may hide actions the role lacks, but the server enforces.

## 8. Audit

`ActorReference = staff:{StaffAccountId}` (a GUID: stable, no email/PII, ≤ 200) for assignments and the `RoomBlock` header. Cross-RoomType keeps the current rule (evidence and reason only for a confirmed cross-RoomType placement) with `AuthorizationEvidence = staff-rbac:{role}:{propertyId}:cross-room-type-confirmed` (≤ 500). Existing rows keep `admin-calendar-local-development`; no backfill, no invented Staff. Anonymous `LocalGate` writes keep the old constants. *Owner decision* D8 at CP05 activation; implemented in CP05 (§7) — a block cancel records the cancelling Staff member on its audit row and never rewrites the header's creator.

## 9. Checkpoints (each one Draft PR; "≈ lines" = CP00 estimate, kept as history; hand-written + tests + docs, generated shown apart)

Since 2026-10-01, 100–400 changed lines per PR is a **target, not a limit** (`docs/governance/WORKFLOW.md` §6): a PR outside it states the GitHub figure and the reason. CP01's earlier size exception (2026-10-01) is history; its size is explained in `docs/reports/PMS-ADMIN-AUTH-001-CP01-completion.md`.

| CP | Behaviour after merge | Depends | Scope | Acceptance (minimum) | ≈ lines |
|---|---|---|---|---|---|
| CP01 | Staff tables exist; no endpoint, no behaviour change | – | `StaffAccount`, `StaffPropertyMembership`, `StaffRole`, EF config, `AddIdentityCore<StaffAccount>`, one migration, ADR 0007 | PostgreSQL tests: create/duplicate/lockout/stamp, membership FK/PK/CHECK; Customer auth tests unchanged; migration applies on a fresh DB | CP00 estimate: ~300 hand-written + ~1,700 **generated**. Measured at PR #74 head `59f540a`: +2,389 / −14, of which 1,836 generated (Designer 1,615, snapshot +123, migration body 98) |
| CP02 | Operator can create/grant/disable/reset Staff | CP01 | CLI verbs, secret input, tests | no password in args/output; weak password refused; idempotent grant | ~350 (CP00 estimate); actual size in `docs/reports/PMS-ADMIN-AUTH-001-CP02-completion.md` |
| CP03 | Staff can log in/out and read `me` | CP01–02 | scheme, cookie events, login/logout/me, `admin-staff` CORS, Origin check extraction, rate limit | 401/403 JSON; Customer↔Staff cookie isolation both ways; disable/stamp invalidation; no redirect | ~400 (CP00 estimate); merged in PR #76, actual size in `docs/reports/PMS-ADMIN-AUTH-001-CP03-completion.md` |
| CP04 | `AccessMode` + evaluator; board read authorized in `Staff` mode | CP03 | `IStaffAccessEvaluator`, permission map, policies, mode switch, guards, read route | member ok, non-member 403, no session 401; `Staff` mode ignores the read flag; unconverted routes 404 | ~350 (CP00 estimate); merged in PR #77, actual size in `docs/reports/PMS-ADMIN-AUTH-001-CP04-completion.md` |
| CP05 | Five write routes authorized; audit from Staff | CP04 | policies, actor/evidence, cross-RoomType permission | per route: `FrontDesk` assign / move / unassign / block create / block cancel, but 403 on `confirmCrossRoomType`; `Manager` all; 403 before the store; audit rows carry `staff:{id}`; `LocalGate` unchanged | ~400 (CP00 estimate); Draft PR, actual size in `docs/reports/PMS-ADMIN-AUTH-001-CP05-completion.md` |
| CP06 | Admin_Web login, `credentials: include`, selector from `me` | CP05 | login page, client, 401/403 handling, permission-aware controls | unit tests + live acceptance in `Staff` mode incl. reload protection unchanged | ~400 (CP00 estimate); Draft PR, actual size in `docs/reports/PMS-ADMIN-AUTH-001-CP06-completion.md` |
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

**Decided at CP03 activation, 2026-10-03 (recorded in ADR 0007):**
11. D3: the separate `TheBha.Staff` scheme and `.TheBha.Staff` cookie; Customer stays the default authenticate/challenge/sign-in scheme; 8 h absolute, no sliding, no remember-me; the cookie principal carries only the Staff id and security stamp; no shared `SignInManager<CustomerAccount>`, no Staff sign-in manager or token providers.
12. D4: `SameSite=Strict`, exact-Origin allow-list and JSON content type on every Staff `POST`, login and logout included; a missing, `null`, wrong or multi-valued Origin is refused; CORS does not replace the server-side check; no Customer antiforgery token for Staff, and the global antiforgery check is skipped only on the Staff actions this boundary protects.

**Decided at CP04 activation, 2026-10-03 (recorded in ADR 0007):**
13. D7: `AdminCalendar:AccessMode` has exactly two values, `LocalGate` and `Staff`; a missing setting is `LocalGate` in this checkpoint; a declared empty or invalid value fails startup, never a silent fallback; the mode is validated and captured at startup and only a restart changes it. `LocalGate` keeps today's contract. `Staff` uses the Staff session and database membership/permission; local flags grant nothing and create no fallback. In `Staff` mode an Admin route without Staff permission enforcement is closed with 404, except exactly the three CP03 session endpoints. CP04 converts only the board GET; the five Calendar POST routes wait for CP05. The default does not change to `Staff`, and the Production cut-over is CP07.

**Decided at CP05 activation, 2026-10-03 (recorded in ADR 0007):**
14. D8: `ActorReference = staff:{StaffAccountId}` with the canonical GUID, no email or PII. Assignment mutations and their audit, and the RoomBlock header on create, use the Staff member who made the request; a block cancel's audit uses the Staff member who cancels, and the existing header's actor does not change. Cross-RoomType evidence is `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed`, the role and Property taken from the request's server-side authorization. The existing evidence/reason invariant stays: only new cross-type `Created`/successor rows carry evidence, `Cancelled` rows never. No backfill or edit of historical audit. `LocalGate` keeps its current constants.

**Still open:** none of D1–D8. CP06 (Admin_Web) is in a Draft PR; CP07 (default/Production) is a later checkpoint.
