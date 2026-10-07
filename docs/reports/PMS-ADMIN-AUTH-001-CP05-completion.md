# PMS-ADMIN-AUTH-001-CP05 — Staff authorization and audit for the five Calendar writes

> Draft PR into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline and START_HEAD `f3f705f5e033fbcb231e19ed8ba9051f9b901dc8` (PR #77, CP04 with correction C1, merged `2026-10-03T06:40:05Z`). Branch `feature/pms-admin-auth-001-cp05-calendar-write-rbac-audit`.

## Owner decision applied (2026-10-03, CP05 activation)

- D8: `ActorReference = staff:{StaffAccountId}` (canonical GUID, no email/PII). Assignment mutations/audit and the RoomBlock header on create use the Staff member making the request; a block cancel's audit uses the Staff member who cancels and does not change the existing header's actor. Cross-RoomType evidence `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed`, role and Property from the request's server-side authorization. Existing invariant kept: only new cross-type `Created`/successor rows carry evidence, `Cancelled` rows never. No backfill. `LocalGate` keeps its constants.
- Recorded in `docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md` (header, §1, §2, §7 "As implemented in CP05", §8, §9, §10 item 14) and `docs/ADR/0007-…md` (Status, Decision, Consequences).

Not in CP05: Admin_Web (Staff login, cookie, selector — CP06), the default switch and Production requirement (CP07). The Calendar is not declared ready for public use.

## Deliverable

| File | Change |
|---|---|
| `Api/Authentication/StaffAccessEvaluator.cs` | `GetRoleAsync` (the active Staff member's role at the Property, one query); `HasPermissionAsync` now maps that role — same behaviour |
| `Api/Authentication/StaffCalendarAccessFilter.cs` | role read once → base permission (403) → CP03 Origin/JSON boundary (403/415) → `StaffCalendarWriteContext` set; GET unchanged |
| `Api/Authentication/StaffCalendarWriteContext.cs` | new: verified Staff id, Property, role; `ActorReference`, `CrossRoomTypeEvidence`, `Grants`, `For(httpContext, propertyId)` |
| `Api/Authentication/StaffCalendarPermissionAttribute.cs` | passes the CP03 boundary filter; documents per-action use |
| `Api/Authentication/StaffCalendarModeGuard.cs` | `WriteCorsPolicy` constant; comment only — the guard is unchanged |
| `Api/Authentication/StaffAuthOperationFilter.cs` | writes documented per running mode |
| `Api/Controllers/AdminReservationAssignmentsController.cs` | per-action `[StaffCalendarPermission(AssignmentWrite, typeof(AdminCalendarWriteGateFilter))]` replacing the controller `[ServiceFilter]`; actor/evidence from LocalGate constants or the Staff context; conditional cross permission |
| `Api/Controllers/AdminOperationalBlocksController.cs` | the same with `BlockWrite`; actor only |
| `Api/Program.cs` | Staff-mode `admin-staff-calendar-write` policy; the endpoint CORS convention also maps POST |
| `tests/…/StaffCalendarWriteAuthorizationTests.cs` | new, 14 PostgreSQL tests with counting store spies |
| `tests/…/StaffCalendarAuthorizationTests.cs` | the CP04 "five writes closed" test now asserts the converted state (renamed); the policyless-route guard test unchanged |

No change to models, EF configuration, migrations, dependencies, mutation stores/commands, Customer auth, the CLI, CP03 login/session/validator, the AccessMode parser/default, the local gate implementations, the frontend or CI. The existing Calendar write API tests and the Admin route registry needed no edit: the LocalGate contract, including OpenAPI, is unchanged.

## Contract (`AccessMode=Staff`; `LocalGate` unchanged)

| Route | Base permission | Conditional | Actor / evidence |
|---|---|---|---|
| `POST …/reservation-assignments` (201) | `AssignmentWrite` | `confirmCrossRoomType=true` → `AssignmentCrossRoomType` | `staff:{id}`; evidence forwarded only when confirmed and permitted, kept by the store only on a cross-type `Created` row |
| `POST …/reservation-assignments/{segmentId}/move` (200, array) | `AssignmentWrite` | same | same; `Cancelled` source never has evidence |
| `POST …/reservation-assignments/{segmentId}/unassign` (200, array) | `AssignmentWrite` | none — also for a cross-type source | `staff:{id}`, no evidence |
| `POST …/operational-blocks` (201) | `BlockWrite` | – | header and `Created` audit `staff:{id}` |
| `POST …/operational-blocks/{segmentId}/cancel` (200) | `BlockWrite` | – | `Cancelled` audit `staff:{id}`; header creator unchanged |

Order before binding: `no-store`, cleartext 404, Staff session 401, base permission 403 (`Access denied`), Origin 403 (`Origin not allowed`), JSON 415; then binding/validation 400, the conditional cross permission 403 (`Access denied`), and the store's existing 400/403/404/409. CORS: credentialed POST-only `Content-Type` for the HTTPS Admin origins; preflights are answered by CORS and run nothing.

## Acceptance evidence (`StaffCalendarWriteAuthorizationTests`, real PostgreSQL 17)

| # | Requirement | Test | Positive control |
|---|---|---|---|
| 1 | FrontDesk all five; Manager incl. cross create/move | `A_front_desk_member_runs_all_five_writes_…` (statuses, DTO shapes, 6 audit rows in order, all `staff:{desk}`, no evidence, header `staff:{desk}`); `A_manager_places_cross_room_type_…` | – |
| 2 | 401/403 per route, store not called, no mutation | `Every_write_refuses_without_authority_or_boundary_before_the_store_is_called` — each route: no cookie, Customer cookie, Customer value under the Staff name → 401; member of B, A's member on B's route → 403; spies count 0 | the same five requests with the member's cookie → spies 3 + 2, actor `staff:{desk}` |
| 3 | Both cookies → Staff actor | `With_both_cookies_the_staff_member_is_the_actor_…` | – |
| 4 | FrontDesk confirmed create/move → 403 before store | spy test (same-type room, create and move: 0 calls) and `Front_desk_confirmation_is_refused_…` | Manager same requests succeed |
| 5 | Unconfirmed cross-type and reasonless Manager stay refused | `Front_desk_confirmation_is_refused_…` — FrontDesk unconfirmed → store `Cross-RoomType confirmation required`; Manager confirmed without reason and unconfirmed → same store refusal; no rows | Manager with reason → 200/201 |
| 6 | Actor right; spoofing changes nothing | `Spoofed_identity_in_the_body_query_or_headers_changes_nothing` — body `actorReference`/`authorizationEvidence`/`role`/`staffId`, query and `X-*` headers → actor `staff:{manager}`, evidence server form; a FrontDesk body claiming Manager → 403 | – |
| 7 | Evidence only on cross-type Created rows | `A_manager_places_cross_room_type_…` — cross create: evidence; over-confirmed same-type move: none on Cancelled or successor; cross move: Cancelled none, successor evidence; FrontDesk unassign of a cross segment: Cancelled none; exactly 2 rows with evidence, both `Created` | – |
| 8 | Block header/cancel actors; history untouched | `A_block_keeps_its_creator_and_each_cancel_names_its_canceller` — a LocalGate-created (historical) block and a FrontDesk block, both cancelled by the Manager: headers local/desk, Created rows local/desk, Cancelled rows manager; the historical row compared field by field | – |
| 9 | Origin/media before binding/store; malformed body no bypass | spy test — missing, `null`, empty, lookalike, `http://`, Customer origin, two origins → 403 also with a malformed body; none, `text/plain`, UTF-16, form → 415; malformed with valid boundary → 400; spies 0 | – |
| 10 | Grant/role change/removal/disable/reset next request | `Membership_and_session_changes_apply_to_writes_…` — Manager→FrontDesk loses cross (403) keeps writes; membership deleted → 403; CLI grant → 201; disable → 401; reset → 401 | Manager cross before the change |
| 11 | Local flags; LocalGate regression | `In_staff_mode_the_local_write_flag_…` (flag on: anonymous 401, outsider 403; flag off + LAN address: member 201); `Local_gate_mode_keeps_anonymous_local_writes_…` (local actor and evidence constants, a Staff cookie ignored, Origin/media order, flag off → 404) + every existing write/gate/route-registry suite unchanged and green | – |
| 12 | Unknown Admin route 404; CP04 tests updated | split path 404 without CORS (`Staff_writes_refuse_cleartext_…`); `In_staff_mode_the_five_calendar_writes_are_converted_…` (CP04 test, now 401/403 before binding, member binding 400, credentialed preflight, 0 rows); CP04 policyless-probe guard test unchanged | LocalGate block create 201 |
| 13 | HTTP 404; CORS; Board policy; Customer | `Staff_writes_refuse_cleartext_get_credentialed_post_cors_…` — cleartext 404 `no-store` no `Location` (control 307); Admin preflight credentialed POST; Customer/foreign/`null` none; board preflight still GET-only; LocalGate preflight uncredentialed | – |
| 14 | Business/version/isolation/366 | `Business_rules_versions_and_property_isolation_…` — stale version 409, unknown segment 404, reversed range 400, 367 nights 400, other Property's segment via either route 404, assignment segment via block cancel 404 | – |
| 15 | OpenAPI both modes | `OpenApi_documents_the_writes_for_the_mode_the_host_runs` — Staff: `StaffCookie`, declared statuses + 401/403, base permission, `AssignmentCrossRoomType` only on create/move; LocalGate: no scheme, declared statuses exactly as before | – |
| – | Per-action metadata | `Every_calendar_write_action_enforces_its_staff_permission_per_action_and_keeps_the_local_gate` — exactly five actions, expected permission each, LocalGate filter = write gate, no controller-level permission or `[ServiceFilter]` | – |

No mutation campaign (not required).

## Verification (PostgreSQL 17 in a disposable container `cp05-staff-pg`, port 55437, removed afterwards; Owner's `the-bha-postgres-1` untouched)

| Command | Result |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | exit 0 |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | exit 0, 0 warnings, 0 errors |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter FullyQualifiedName~StaffCalendarWriteAuthorizationTests` | exit 0, 14/14 |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter "FullyQualifiedName~StaffCalendarAuthorizationTests\|…StaffAuthenticationTests\|…CustomerAuthenticationTests\|…AdminCalendar\|…AdminOperationalBlock"` | exit 0, 291/291 — `--list-tests`: 50 + 41 + 6 + 15 + 23 + 44 + 84 + 28 |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` | exit 0, unit 244/244, integration 717/717 |
| `git diff --check` | clean |

During development the first run of the existing suites failed only the CP04 "five writes closed" test (expected: the writes are converted) and passed the other 290; one new test first expected 7 audit rows where the five writes produce 6 (a counting error in the test, corrected to the exact event sequence).

## HTTPS smoke (real Kestrel, `TheBha.Api.dll` Release, Development, `https://localhost:7250` + `http://127.0.0.1:5250`, the local mkcert leaf, `curl --cacert` with verification on; throwaway database `cp05_smoke`, migrated, `--seed-development`, one inserted Property; passwords via `BHA_STAFF_PASSWORD`; secrets in files, actor GUIDs shown as `<desk>`/`<manager>`)

`AccessMode=Staff`: CLI create FrontDesk and Manager (exit 0); a real Committed reservation of two DLX-KING units through the public booking API (csrf → hold 201 → confirm 201).

| Step | Result |
|---|---|
| FrontDesk create → 101, move → 102, unassign | 201; 200 `[Cancelled, Effective]`; 200 `[Cancelled]` |
| FrontDesk block create on 201, cancel | 201; 200 `Cancelled` |
| FrontDesk confirmed cross create, confirmed cross move | 403 `Access denied` both; audit rows 6 → 7 (only the same-type create in between) |
| Manager confirmed cross create with reason; over-confirmed same-type move | 201; 200 |
| FrontDesk on a Property without membership / wrong Origin / no cookie | 403 `Access denied` / 403 `Origin not allowed` / 401 |
| Audit rows | every row `staff:<desk>` or `staff:<manager>`; evidence `staff-rbac:Manager:<P1>:cross-room-type-confirmed` only on the Manager's cross-type `Created` row; the over-confirmed same-type successor and all `Cancelled` rows none (Cancelled with evidence: 0); block header `staff:<desk>` |

Restart without `AccessMode` (LocalGate, write flag on): anonymous block create 201, header actor `admin-calendar-local-development`.

Secret scan (both passwords, both Staff cookies, the guest token) over response bodies (the guest's own hold response excepted), CLI output and server log: 0. A first smoke attempt was discarded: its generated passwords lacked an uppercase letter, the CLI refused them (`PasswordRequiresUpper`), so no Staff existed; the script now stops if bootstrap fails, and the run above is on a fresh database.

## PR size (target 100–400, not a limit — `docs/governance/WORKFLOW.md` §6)

GitHub and `git diff --numstat origin/develop...HEAD`: **+1,382 / −66 = 1,448** in 15 files (the PR body and handoff carry the GitHub figure checked against it). Above the target, by group:

| Group | + / − | Why |
|---|---|---|
| `StaffCalendarWriteAuthorizationTests.cs` | +925 | the MEP's 15 evidence groups across five routes on real PostgreSQL, with store spies, parameterized refusal matrices and positive controls; not trimmed |
| CP04 test update | +13 / −7 | the converted state of the five writes |
| product (1 new + 8 changed files) | +283 / −39 | context, filter, evaluator, two controllers, CORS, OpenAPI; a large share security and audit doc comments |
| docs (design, ADR, SNAPSHOT, this report) | +161 / −20 | D8 record, CP04-merged sync and the evidence required by the MEP |

Not split: the five routes share one boundary and one audit rule; converting some would leave Staff-mode writes half open, half closed.

## Risks and residuals

- The conditional cross permission lives in the two assignment actions (after binding, because `confirmCrossRoomType` is in the body); the metadata test pins the base permission per action, and the integration tests pin the conditional one for create and move.
- `Staff` mode remains selectable by configuration in any environment; nothing configures it, and the Production decision is CP07.
- Admin_Web does not send the Staff cookie yet (CP06): in `Staff` mode the board UI cannot write.
- The evaluator now answers the role once per request; a role change between that read and the store's transaction applies from the next request (the existing per-request model).
- CP03/CP04 residuals unchanged.

`REVIEW: NOT RUN` (Owner invokes `/codex:review --base origin/develop`). CP06 NOT STARTED. Production NOT TOUCHED.
