# PMS-ADMIN-AUTH-001-CP04 — AccessMode, Staff access evaluator and Board read authorization

> Draft PR into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline and START_HEAD `c89efc22246771541f6aefecf0221374076a192f` (PR #76, CP03 with corrections C1/C2, merged `2026-10-03T05:18:26Z`). Branch `feature/pms-admin-auth-001-cp04-board-read-rbac`.

## Owner decision applied (2026-10-03, CP04 activation)

- D7: `AdminCalendar:AccessMode` has exactly two values, `LocalGate` and `Staff`; missing → `LocalGate` in this checkpoint; a declared empty or invalid value fails startup (no silent fallback); validated and captured at startup, only a restart changes it. `LocalGate` keeps the current contract. `Staff` uses the Staff session and the database membership/permission; local flags grant nothing and create no fallback. In `Staff` mode an Admin route without Staff permission enforcement is closed 404, except exactly the three CP03 session endpoints. CP04 converts only the board GET; the five Calendar POST routes wait for CP05. The default is not switched to `Staff`, and the Production cut-over is CP07.
- Recorded in `docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md` (header, §2, §7 "As implemented in CP04", §9, §10 item 13) and `docs/ADR/0007-…md` (Status, Decision, Consequences).

Still open: D8 (Staff audit actor) — not implemented. Staff writes are CP05, Admin_Web CP06, default/Production cut-over CP07. Nothing here makes the Calendar Production-ready.

## Deliverable

| File | Purpose |
|---|---|
| `Api/AdminCalendarOptions.cs` | `AdminCalendarAccessMode`; `AdminCalendarAccess.FromConfiguration` (missing → LocalGate, else exactly `LocalGate`/`Staff`) |
| `Api/Authentication/StaffAccessEvaluator.cs` | `StaffPermission` (4 values), the fixed `StaffPermissions.RoleGrants` map, `IStaffAccessEvaluator`, `StaffAccessEvaluator` (membership of an active Staff member at the Property, from the database, every call) |
| `Api/Authentication/StaffCalendarPermissionAttribute.cs` | Marks a converted action and is its filter factory: LocalGate → the route's existing local gate; Staff → `StaffCalendarAccessFilter` |
| `Api/Authentication/StaffCalendarAccessFilter.cs` | Staff-mode resource filter: `no-store`, cleartext 404, explicit `TheBha.Staff` authentication (401), evaluator at the route `propertyId` (403) |
| `Api/Authentication/StaffCalendarModeGuard.cs` | Staff-mode middleware: closes (404) every `/api/admin` endpoint without the attribute that is not CP03 login/logout/me; the Staff read CORS policy name |
| `Api/Authentication/StaffAuthOperationFilter.cs` | OpenAPI for a converted action, per the running mode |
| `Api/Controllers/AdminReservationBoardController.cs` | `[StaffCalendarPermission(BoardRead, typeof(AdminReservationBoardReadGateFilter))]` in place of the read gate's `[ServiceFilter]`; 401/403 declared |
| `Api/Program.cs` | mode captured and registered; evaluator DI; Staff-mode CORS policy, cleartext rule, guard and endpoint CORS convention |
| `tests/…/StaffCalendarAuthorizationTests.cs` | 27 PostgreSQL tests (17 facts + 10 theory cases) and a test-assembly-only `[AllowAnonymous]` Admin probe |

No change to models, EF configuration, migrations, dependencies, Customer auth, the CP02 CLI, CP03 login/cookie/validator, the local gate filters, the Calendar write controllers/stores/audit, the frontend or CI. `AdminReservationBoardApiTests`, `AdminCalendarAssignmentApiTests` and the factory needed no change.

## Contract

| Mode | Board `GET /api/admin/v1/properties/{propertyId}/reservation-board` | Five Calendar POSTs | Other `/api/admin` | CP03 session routes | Customer routes |
|---|---|---|---|---|---|
| `LocalGate` (absent key or explicit) | unchanged: read gate (HTTPS, Development, loopback, read flag) before binding, anonymous, uncredentialed `admin-calendar` CORS | unchanged write gate | unchanged | unchanged | unchanged |
| `Staff` | Staff session (401) + `BoardRead` membership at `propertyId` (403), both before binding, `no-store`, ProblemDetails, no redirect; then the existing query (400/404/200); local flags and loopback not consulted; credentialed GET-only CORS for the HTTPS Admin origins; cleartext 404 before redirect | 404 before CORS, auth, binding, action and store — any body, any cookie, flags on, preflight included | 404 the same way (`[Authorize]`, `[AllowAnonymous]`, local-gated or absent) | open (login, logout, `me` only) | unchanged |

## Acceptance evidence (`StaffCalendarAuthorizationTests`, real PostgreSQL 17)

| # | Requirement | Test | Positive control |
|---|---|---|---|
| 1 | Fixed map, unknown fails closed | `The_fixed_role_map_is_exactly_the_decided_one_…` — FrontDesk exactly 3, Manager all 4; `Viewer`, wrong casing, empty, null roles and permission values 42/−1 grant nothing; evaluator: other Property, unknown Staff, disabled Staff → false; pre-cancelled token throws | FrontDesk/Manager true where mapped |
| 2 | Member 200, non-member/cross-Property 403 | `A_member_reads_its_own_property_board_…` — FrontDesk and Manager 200 with the right Property; other Property, non-existent Property, member of B on A, non-member on inactive → 403; member of inactive → query 404 | outsider reads its own B |
| 3 | No/invalid session, Customer-only cookie → 401 | `Without_a_valid_staff_session_…` — none, garbage, Customer cookie, Customer value under the Staff name | (2) |
| 4 | Removal/grant/role change on the next request | `Membership_grant_removal_and_role_change_…` — SQL delete → 403 with the same cookie; CLI grant B → 200; FrontDesk→Manager flips `AssignmentCrossRoomType` in the evaluator, board still 200 | — |
| 5 | Cookie claims grant nothing | `Role_and_property_claims_in_a_valid_cookie_grant_nothing` — genuine tickets (valid id/stamp, host key) plus Manager role, Property and permission claims → 403 on the claimed Property, also for a Staff with no membership | the forged cookies pass `me` and the member's own board |
| 6 | CLI disable/reset → 401 next request | `Cli_disable_and_password_reset_…` | 200 before |
| 7 | Read flag neither opens nor closes in Staff mode | `In_staff_mode_the_local_read_flag_…` — flag off (asserted off on the bound option): member 200, anonymous 401; flag on: anonymous 401, non-member 403; a LAN remote address: member 200 | flag value asserted |
| 8 | Five writes 404 in Staff mode, no mutation | `In_staff_mode_the_five_calendar_writes_…` — each route × valid / malformed / `{}` body × Manager cookie / none, write flag on, approved Origin, JSON, plus preflight → 404, `no-store`, no CORS header; segment/block/audit counts stay 0 | the same block create on LocalGate with the flag → 201 and one segment + block |
| 9 | Test-only Admin endpoint without metadata closed | `In_staff_mode_an_admin_endpoint_without_staff_permission_metadata_is_closed` — `[AllowAnonymous]` probe, `[Authorize(TheBha.Staff)]` probe, write-gate probe, unknown `auth/*` and absent paths → 404 with or without a Manager cookie; nothing invoked | the same probes on LocalGate: 200 / 403 / 204 |
| 10 | Session routes and Customer routes unaffected | `In_staff_mode_the_session_routes_work_…` — login 200, `me` 200, logout 204, `me` 401; public properties, Customer register/login/`me` | — |
| 11 | LocalGate default/regression | `An_absent_or_explicit_local_gate_mode_…` (anonymous board 200; a Staff cookie neither needed nor able to open a closed gate; write gate's own 404) + `AdminReservationBoardApiTests` (55), `AdminCalendarWriteGateApiTests` (44), `AdminCalendarAssignmentApiTests` (15) unchanged and green | — |
| 12 | Invalid mode fails; reload cannot switch | theory `A_declared_access_mode_must_be_exactly_…` (`""`, `" "`, `staff`, `STAFF`, `localgate`, `Staff `, `0`, `1`, `LocalGate,Staff`, `Both`), `A_nested_access_mode_section_is_refused_too`, `The_mode_is_captured_at_startup_…` (configuration flipped before and after the first request, both directions; the flip is visible in `IConfiguration`, the behaviour is not) | — |
| 13 | Staff board over HTTP 404, no redirect | `In_staff_mode_the_board_over_cleartext_is_404_…` — with and without cookie: 404 problem, `no-store`, no `Location`/`Set-Cookie`/board data | Customer HTTP → 307 on the same host |
| 14 | Board CORS per mode | `Board_cors_is_credentialed_for_admin_origins_in_staff_mode_only` — Staff: Admin origin preflight and GET credentialed; Customer, foreign, `null`, `http://` origins nothing; POST not allowed; approved origin without session still 401. LocalGate: uncredentialed | — |
| 15 | Member validation/404, unauthorized never queries | `A_member_keeps_the_query_contract_…` — member: missing `to`, malformed, reversed, 32 nights → 400 problem `no-store`; with a counting query spy, anonymous and non-member requests with malformed, empty and valid queries → 401/403 and 0 query calls | member → spy called once |
| 16 | OpenAPI | `OpenApi_documents_the_board_for_the_mode_the_host_runs` — Staff: `StaffCookie` only; LocalGate: no scheme; both: mode-stating description, `BoardRead`, 200/400/401/403/404 with 401/403 marked Staff-mode only; never `CustomerCookie` | — |

No mutation campaign (not required); every negative assertion above has the positive control listed.

## Verification (PostgreSQL 17 in a disposable container `cp04-staff-pg`, port 55435, removed afterwards; Owner's `the-bha-postgres-1` untouched)

Final run on the committed code:

| Command | Result |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | exit 0 |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | exit 0, 0 warnings, 0 errors |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter FullyQualifiedName~StaffCalendarAuthorizationTests` | exit 0, 27/27 |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter "FullyQualifiedName~StaffAuthenticationTests\|…CustomerAuthenticationTests\|…AdminReservationBoardApiTests\|…AdminCalendarWriteGateApiTests\|…AdminCalendarAssignmentApiTests"` | exit 0, 161/161 — `--list-tests`: 41 + 6 + 55 + 44 + 15 |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` | exit 0, unit 244/244, integration 680/680 |
| `git diff --check` | clean |

During development: two of the new tests first failed on test setup, not product behaviour — the LocalGate write check expected no CORS header, but a closed local write gate carries the uncredentialed `admin-calendar-write` header for an approved origin (existing contract, assertion corrected); and `UseSetting(read flag=false)` is overridden by the factory's Development opt-in, so the flag is now switched off on the bound option (as the board tests do) and its value asserted. After those, one product refinement (the Staff CORS convention limited to GET-only endpoints) — the whole table above was rerun after it.

## HTTPS smoke (real Kestrel, `TheBha.Api.dll` Release, Development, `https://localhost:7248` + `http://127.0.0.1:5248`, the local mkcert leaf, `curl --cacert` with verification on; throwaway database `cp04_smoke`, migrated, `--seed-development`, plus one inserted Property; passwords via `BHA_STAFF_PASSWORD`; cookies and passwords redacted; run on the final build)

`AccessMode=Staff`, with `EnableUnauthenticatedRead=true` and `EnableUnauthenticatedWrite=true` also set:

| # | Step | Result |
|---|---|---|
| 1–2 | CLI `--staff-create` FrontDesk at the seeded Property; login | exit 0; 200 |
| 3 | board, member | 200, `no-store`, `Access-Control-Allow-Origin: https://localhost:3001`, `…-Credentials: true`; "The BHA Hotel", 3 rooms |
| 4 | board, no cookie | 401 `Authentication required` |
| 5 | board of a Property without membership | 403 `Access denied` |
| 6 | valid block create (real Active room, future dates) with the member's cookie, Origin, JSON | 404, no CORS header; segments/blocks/audits 0/0/0 → 0/0/0 |
| 7 | board over `http://` with the cookie | 404, `no-store`, no `Location` (control: `GET /api/v1/properties` over `http://` → 307) |
| 8 | CLI `--staff-reset-password`, board with the old cookie | exit 0; 401 |
| 9 | login with the new password, board | 200; 200 |
| 10 | CLI `--staff-disable`, board with that cookie | exit 0; 401 |

Restart without `AccessMode` (LocalGate, read flag on): 11 — anonymous loopback HTTPS board 200, no credentials header.

Secret scan (both passwords, both cookie values) over response bodies, CLI output and server log: 0. No UI/Calendar frontend is part of CP04; no `UI_LIVE` claim.

## PR size (target 100–400, not a limit — `docs/governance/WORKFLOW.md` §6)

GitHub and `git diff --numstat origin/develop...HEAD`: **+1,456 / −36 = 1,492** in 13 files (the PR body and handoff carry the GitHub figure checked against it). Above the target, by group:

| Group | + / − | Why |
|---|---|---|
| `StaffCalendarAuthorizationTests.cs` | +912 | the MEP's 16 mandatory evidence groups on real PostgreSQL, 27 cases, each negative with its positive control; not trimmed |
| product (4 new files + 4 changed) | +382 / −17 | mode, evaluator and map, attribute/filter, guard, OpenAPI, Program wiring; a large share is the doc comments that state the security reasoning, in this codebase's style |
| docs (design, ADR, SNAPSHOT, this report) | +162 / −19 | D7 record, CP03-merged sync, stale-statement fixes and the evidence required by the MEP |

Not split: the MEP defines CP04 as one checkpoint, and the guard, the Board filter and the mode are one security property — splitting would ship a mode that leaves writes open or a Board path without its guard.

## Risks and residuals

- `Staff` mode is selectable by configuration in any environment, Production included; nothing configures it, the writes stay closed in it, and the Production decision (require `Staff`, refuse `LocalGate`) is CP07.
- In `Staff` mode the board is not limited to loopback (that is a local-gate condition); its exposure is Staff session + membership, HTTPS, `SameSite=Strict` and the D5 same-site topology. No forwarded-header middleware; behind a proxy the CP03 limiter residual still applies.
- The guard recognises Admin endpoints by the `/api/admin` path or route prefix — every current Admin route is under it; a future Admin route outside that prefix would not be guarded.
- Admin_Web is unchanged (CP06): in `Staff` mode it cannot write (404, preflights included) and does not yet send the Staff cookie.
- The evaluator adds one indexed query per authorized request (primary-key lookup on the membership), no cache by design.
- CP03 residuals unchanged (logout does not rotate the stamp; lockout as a per-account DoS; `me` lists inactive Properties).

`REVIEW: NOT RUN` (Owner invokes `/codex:review --base origin/develop`). CP05 NOT STARTED. Production NOT TOUCHED.
