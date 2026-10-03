# PMS-ADMIN-AUTH-001-CP03 — Staff login, logout, `me` and session cookie

> Draft PR into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline and START_HEAD `6baefe90c409ba22f050c235bc2d5d0cf060cbd6` (PR #75, CP02, merged). Branch `feature/pms-admin-auth-001-cp03-staff-session`.

## Owner decisions applied (2026-10-03, CP03 activation)

- D3: own scheme `TheBha.Staff`, cookie `.TheBha.Staff`; Customer stays the default authenticate/challenge/sign-in scheme; 8 h absolute, no sliding, no remember-me; the cookie principal carries only the Staff id and security stamp; no shared `SignInManager<CustomerAccount>`, no Staff sign-in manager or token providers.
- D4: `SameSite=Strict`, exact-Origin allow-list and JSON content type on every Staff `POST`, login and logout included; missing, `null`, wrong or multi-valued Origin refused; CORS does not replace the server check; no Customer antiforgery token for Staff, and the global antiforgery check is skipped only on the Staff controller this boundary protects.
- Recorded in `docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md` (§2, §5 "As implemented in CP03", §10 items 11–12) and `docs/ADR/0007-…md` (Status, Decision, Consequences).

Still open: D7 (`AdminCalendar:AccessMode`), D8 (Staff audit actor). The Calendar keeps its local gates; a Staff session grants no Board access. CP04 is not started.

## Deliverable

| File | Purpose |
|---|---|
| `Api/Authentication/StaffAuthentication.cs` | Scheme constants, cookie registration, `OnValidatePrincipal`, principal/ticket helpers, `staff-login` options |
| `Api/Authentication/AdminRequestBoundary.cs` | The Origin and JSON predicates, moved unchanged out of the write gate |
| `Api/Authentication/StaffRequestBoundaryFilter.cs` | `no-store`, HTTPS, Origin 403, JSON 415 — before model binding |
| `Api/Authentication/StaffAuthContracts.cs` | `StaffLoginRequest`, `StaffSessionResponse`, `StaffMembershipResponse` |
| `Api/Authentication/StaffAuthOperationFilter.cs` | OpenAPI: `StaffCookie` security, `application/json`-only body |
| `Api/Controllers/StaffAuthController.cs` | `POST auth/login`, `POST auth/logout`, `GET me` under `api/admin/v1` |
| `Api/Controllers/AdminCalendarWriteGateFilter.cs` | calls the shared predicates; order, statuses and bodies unchanged |
| `Api/Program.cs` | Staff scheme, boundary filter DI, `admin-staff` CORS, `staff-login` limiter, cleartext guard for Staff paths, OpenAPI scheme |
| `tests/…/StaffAuthenticationTests.cs` | 37 PostgreSQL tests (14 facts + 23 theory cases) and a test-assembly-only Forbid probe |
| `tests/…/AdminCalendarAssignmentApiTests.cs` | the authorized-Admin-mutation-route registry gains login and logout (outside the MEP allowlist; Owner approved this exact edit before it was made) |

No model, EF configuration, migration, snapshot, dependency, Customer controller/contract/cookie/options/antiforgery, CLI, Calendar controller, frontend or CI change.

## Contract

| Route | Behaviour |
|---|---|
| `POST /api/admin/v1/auth/login` `{email,password}` | Anonymous; HTTPS → Origin (403) → JSON (415) → model validation (400) → `staff-login` limiter (429). Unknown, disabled, locked-out and wrong password: one 401 `Authentication failed` (the first three still hash once, so timing matches). Wrong password → `AccessFailedAsync`; success → `ResetAccessFailedCountAsync`, `SignInAsync("TheBha.Staff")`, 200 `{staffAccountId,email,memberships[{propertyId,propertyName,timeZone,role}]}` |
| `POST /api/admin/v1/auth/logout` `{}` | Staff session (else 401), Origin, JSON; signs out `TheBha.Staff` only; 204 |
| `GET /api/admin/v1/me` | Staff session (else 401); same body as login, read from the database each time, memberships ordered by Property name then id (ordinal); none → `[]` |

All responses and refusals carry `Cache-Control: no-store` (sign-in/out responses also carry the handler's `no-cache`). Cookie: `HttpOnly; Path=/api/admin; SameSite=Strict`, `Secure` (Always outside Development, `SameAsRequest` in Development, where Staff routes are HTTPS-only anyway), no `Domain`, no `Expires` (`IsPersistent=false`). Ticket: `AllowRefresh=false`, `ExpiresUtc = IssuedUtc + 8 h` on the application `TimeProvider`, which is also the handler's clock.

## Acceptance evidence (`StaffAuthenticationTests`, real PostgreSQL 17)

| # | Requirement | Test(s) |
|---|---|---|
| 1 | Happy path, contract, no-store, no secret | `Login_me_and_logout_follow_the_contract_and_never_return_secrets` — exact JSON keys and order, cookie attributes, body free of password/hash/stamp/concurrency stamp, deletion cookie on logout, 401 afterwards |
| 2 | Generic 401, lockout, reset count | `Every_login_failure_is_one_generic_401_and_lockout_is_enforced` — four failure kinds give identical title/detail and no cookie; count 1 → 0 on success; 5 failures lock; right password refused while locked |
| 3–4 | Customer ↔ Staff isolation, independent logouts | `Staff_and_customer_sessions_are_isolated_in_both_directions` — same email as Customer and Staff; each cookie (also renamed to the other's name) is 401 on the other `me`; Staff logout keeps Customer, Customer logout keeps Staff |
| 5 | Production flags; Customer surface unchanged | `Production_cookie_flags_are_strict_and_the_customer_surface_is_unchanged` + full `CustomerAuthenticationTests` |
| 6 | Ticket content; no `AspNetUserClaims` read | `The_ticket_holds_only_id_and_stamp_…` — unprotects the real cookie (exactly two claims); EF `CommandExecuting` diagnostics for this database show `StaffAccounts`/`StaffPropertyMemberships` and never `AspNetUserClaims/Logins/Tokens` or `AspNetUsers` |
| 7 | CLI disable / stamp change → 401 next request | `Disable_and_password_reset_through_the_cli_…` — `--staff-reset-password` and `--staff-disable`, plus `IsActive=false` without a stamp change |
| 8 | `me` reflects grant / role change / removal; empty | `Me_reads_memberships_from_the_database_on_every_request` — same cookie throughout, never re-issued |
| 9 | 8 h absolute on the shared clock | `The_session_ends_eight_hours_after_login_…` — ticket issued/expiry equal the test clock; handler `TimeProvider` is the test clock; 4 h and 7:59:59 → 200 without `Set-Cookie`; 8 h, 8 h + 1 s, 2 days → 401 |
| 10 | Origin 403, media type 415, malformed body | two theories (10 + 10 cases, login and logout) and `A_malformed_login_body_…` |
| 11 | CORS | `Only_the_admin_staff_policy_is_credentialed_…` — credentialed only for the Admin origin on the three Staff routes; Customer, foreign and `null` origins get nothing; both `admin-calendar` policies still uncredentialed |
| 12 | Cleartext refused, no redirect, no leak | `Cleartext_staff_routes_are_refused_before_https_redirection_…` — with an HTTPS port configured (control route answers 307), login/logout/`me` (any casing) answer 404 without `Location` or cookie, following redirects or not |
| 13 | 429 independent of Customer | `The_staff_login_limiter_is_its_own_…` (different Staff/Customer budgets, both orders) and a theory refusing non-positive values at startup |
| 14 | Challenge/Forbid JSON, no `Location` | `Staff_challenge_and_forbid_are_json_problems_…` (Forbid through a test-assembly probe only) |
| 15 | Gate regression, Customer suite | `AdminCalendarWriteGate*` (128) and `CustomerAuthenticationTests` (6) unchanged and green |

OpenAPI: `OpenApi_documents_the_staff_cookie_and_the_json_only_contract`.

**Mutation checks** (temporary edits in this checkout, restored, then 37/37 green): each of these turned the named test red — stamp check removed; `IsActive` check removed; expiry `>=` → `>`; sliding on with `AllowRefresh=true` (sliding alone is masked by `AllowRefresh=false`, the intended second layer); a role claim added; cleartext guard without Staff paths; an `AspNetUserClaims` read in the validator; boundary filter removed (20 tests); lockout check removed; failure count removed; Staff as default authenticate scheme; Staff limiter reading the Customer budget (found a test gap: equal budgets hid it — the test now uses different ones); `admin-staff` without credentials; logout also signing out Customer; reversed membership order.

## Verification (local PostgreSQL 17 in a disposable container `cp03-staff-pg`, port 55432; Owner's `the-bha-postgres-1` untouched)

| Command | Result |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | exit 0 |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | exit 0, 0 warnings, 0 errors |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter FullyQualifiedName~StaffAuthenticationTests` | exit 0, 37/37 |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter "FullyQualifiedName~CustomerAuthenticationTests\|FullyQualifiedName~AdminCalendarWriteGate"` | exit 0, 134/134 (6 + 128; both class names verified with `--list-tests`) |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` | first run: 1 failure — the route-registry test above (a real contract pin, not flaky); after the approved registry edit: exit 0, unit 244/244, integration 649/649 |
| `git diff --check` | clean |

## HTTPS smoke (real Kestrel, `TheBha.Api.dll` Release, Development, `https://localhost:7245` + `http://127.0.0.1:5245`, the local mkcert leaf, `curl --cacert` with verification on; throwaway database `cp03_smoke`, migrated and `--seed-development`; Staff via `BHA_STAFF_PASSWORD` + CLI; cookies and passwords redacted)

| # | Request | Result |
|---|---|---|
| 0 | `--staff-create --email smoke.desk@example.com --property-id 10000000-…-000000000001 --role Manager` | `created Staff 1254125b-… with Manager membership.` |
| 1 | login, Origin `https://localhost:3001`, JSON | 200, `.TheBha.Staff=<redacted>; path=/api/admin; secure; samesite=strict; httponly`, ACAO + credentials, body with one Manager membership |
| 2 | `me` | 200 `no-store`, same body |
| 3 | logout `{}` | 204, deletion cookie |
| 4 | `me` from the browser jar | 401 problem, `no-store` |
| 5 | login, Origin `https://evil.example` | 403 `Origin not allowed` |
| 6 | login, `text/plain` | 415 |
| 7–8 | login and `me` over `http://…:5245` | 404 problem, `no-store`, no `Location` |
| 9 | control `GET /api/v1/properties` over HTTP | 307 `Location: https://127.0.0.1:7245/…` |
| 10–11 | preflight from the Admin / Customer origin | credentialed `Content-Type`, `GET,POST` / no CORS headers |
| 12–15 | login, `me` 200, `--staff-reset-password`, `me` with the saved cookie | 401 + deletion cookie |
| 16–17 | login with the old / new password | 401 / 200 |
| 18–20 | `--staff-disable`, `me` with the saved cookie, login with the right password | 401 + deletion cookie / 401 |

Neither password nor the cookie value appears in any response file or the server log (grep).

## PR size (target 100–400, not a limit — `docs/governance/WORKFLOW.md` §6)

`git diff --numstat origin/develop...HEAD` at the final head: **+1,752 / −123 = 1,875** (the PR body and completion message carry the GitHub figure checked against it). Above the target, by group:

| Group | + / − | Why |
|---|---|---|
| `StaffAuthenticationTests.cs` | +973 | the MEP's 15 mandatory evidence groups on real PostgreSQL, 37 cases, plus the SQL-command recorder and Forbid probe; not trimmed (no reduction of tests or safety to meet the target) |
| registry test | +5 / −2 | Owner-approved registry entry |
| Staff source (5 new files + controller) | +445 | scheme/validator, boundary filter, controller, contracts, OpenAPI filter; about a third is the doc comments that state the security reasoning, in this codebase's style |
| `AdminRequestBoundary.cs` + gate | +105 / −97 | relocation: the two predicates and their comments move, not new logic |
| `Program.cs` | +57 / −6 | scheme, CORS, limiter, guard, OpenAPI wiring |
| docs (design, ADR, SNAPSHOT, this report) | +167 / −18 | D3/D4 records and evidence required by the MEP |

The design (§9) suggested splitting CP03 at the login/`me` seam if it grew; the MEP defines CP03 as one checkpoint and splitting needs an OC instruction, so it was not split. Splitting would also separate `me`'s invalidation tests from the login that creates the session.

## Risks and residuals

- Logout does not rotate the security stamp: a copied cookie stays valid until 8 h or a disable/reset (design §5, unchanged decision).
- Lockout is per account (Owner policy): anyone who knows a Staff email can lock that account for 15 minutes; it does not end an existing session.
- The `staff-login` limiter partitions by remote IP; behind a proxy all clients share one partition until a forwarded-header decision exists (not in CP03).
- An empty `Cors:AdminOrigins` refuses every Staff `POST` (fails closed); Production needs it set before Staff can log in.
- `me` lists memberships of an inactive Property as stored; whether the selector hides them is a CP06 decision.
- `ExpiresUtc` is serialized to the second, so a session can end up to one second before 8 h; never later.

`REVIEW: NOT RUN` (Owner invokes `/codex:review --base origin/develop`). CP04 NOT STARTED. Production NOT TOUCHED.
