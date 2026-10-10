# PMS-CAL-002-CP02 — HTTP_SPLIT_MOVE_STAFF_AUDIT — completion report

Date: 2026-10-10 (Asia/Saigon). Scope: one Admin HTTP route over the CP01 store command, with Staff authorization, server-owned audit actor/evidence, `LocalGate` parity and OpenAPI. No store, domain, auth runtime, schema, Admin_Web or cloud change. `BACKEND_CD` is `PAUSED / NOT_COMPLETE` and untouched.

## 1. Identity

| | |
|---|---|
| Work item / roles | `PMS-CAL-002-CP02` — `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Branch / base | `feature/pms-cal-002-cp02-http-split-move-staff-audit` → `develop`; START_HEAD = baseline = `81acab8123fb42d4d4e2e2caefd4bdebc554eac1` (= `origin/develop` after `git fetch --prune`, clean tree) |
| Draft PR, commits, FINAL_HEAD, GitHub additions/deletions, CI run IDs | A commit cannot contain its own hash or the runs of its own push: they are in the handoff, taken after the last push |
| Write ownership | One writable checkout. The two `orca/workspaces` worktrees were already registered before the session and were not touched; the P1 branch was not touched |

## 2. Owner decisions recorded (2026-10-10)

* **D1 / D2 APPROVED** (earlier): a cross-type prefix needs a Manager, confirmation and a new reason; a destination equal to the source room is refused.
* **D3 APPROVED:** `reason` is optional when both successors are the sold RoomType, required if the prefix or the suffix crosses; trimmed as in `move`, blank becomes absent. No new boundary rule: the store judges it.
* **D5 APPROVED:** `POST …/{segmentId}/split-move`, `200` with `[source Cancelled, prefix, suffix]`, Staff-authorized by default and `LocalGate` through the same attribute as `move`/`unassign`.
* **D4 / D6 remain OPEN.** No today, check-in/lifecycle or repricing rule was added.

## 3. Change

| File | Change |
|---|---|
| `Back_End/src/TheBha.Api/Controllers/AdminReservationAssignmentsController.cs` | `SplitMoveReservationAssignmentRequest` (init-only; `expectedVersion`, `splitDate`, `destinationPhysicalRoomId` are `[JsonRequired][Required]`; `confirmCrossRoomType`, `reason` optional) and the `SplitMove` action. Of the +96 lines about 70 are XML comments. `Create`, `Move`, `Unassign`, `TryResolveActor` and `MapSupersedeResult` are unchanged apart from one cross-reference in a comment |
| `…/AdminReservationAssignmentOpenApiOperationFilter.cs` | `nameof(SplitMove)` added to `WriteActionNames` (+ comment) |
| `…/AdminCalendarWriteGateFilter.cs` | comment only ("Five" → "Six" actions); runtime unchanged |
| `Back_End/tests/TheBha.IntegrationTests/AdminCalendarAssignmentSplitMoveApiTests.cs` (new) | 12 LocalGate/HTTP tests |
| `…/StaffCalendarWriteAuthorizationTests.cs` | 7 new Staff cases (the Theory counts 3); exact action pin, OpenAPI matrix row and `Writes()` gained split-move; the FrontDesk-confirm loop gained a split-move entry; positive-control count `(3, 2)` → `(4, 2)` |
| `…/AdminCalendarAssignmentApiTests.cs` | mutation-route registry allows exactly the split-move path |
| `…/AdminCalendarAssignmentMoveUnassignApiTests.cs` | the blanket "no path contains split" assertion became "the paths containing split are exactly `…/{segmentId}/split-move`"; swap and batch bans, and all move/unassign schema assertions, unchanged |
| `docs/design/PMS-CAL-002-split-move.md`, `docs/ADR/0006-…md` (amendment 2026-10-10), `docs/project/SNAPSHOT.md`, this report | decisions, status, evidence |

The action calls `TryResolveActor(propertyId, request.ConfirmCrossRoomType, …)` (Staff scheme on `Forbid`), trims the reason like `move`, makes exactly one `store.SplitMoveAsync(new SplitMoveAssignmentCommand(route PropertyId, route SegmentId, body ExpectedVersion/SplitDate/DestinationPhysicalRoomId, server actor, server evidence, reason))` and returns `MapSupersedeResult`. It has no pre-read, range, capacity or EF logic and no `Location`. There is no `[Consumes]`, so 415 still comes from the resource-filter gate, after environmental refusal.

Read-only checks before editing found no route list to extend: `StaffAuthOperationFilter` finds the confirmable body by reflection (`ConfirmCrossRoomType`), `StaffCalendarModeGuard`, the cleartext guard and the CORS selection in `Program.cs` work on endpoint metadata or the `/api/admin` prefix, and the gate filter sets `no-store` before binding.

## 4. Acceptance evidence

Environment: **PostgreSQL 18.3** (`postgres:18.3`, `server_version 18.3 (Debian 18.3-1.pgdg13+1)`) in a Docker container created for this run (own name `cp02-scratch-pg-…`, label `owner=claude-cp02-session`, port published on `127.0.0.1` and assigned by Docker, own database and password). `ConnectionStrings__TheBhaDatabase` pointed only at it; `the-bha-postgres-1` was neither used nor changed. The test clock is pinned to the fixtures' `2026-07-22T00:00:00Z` (and `+60 days` in the capacity case).

| # | Acceptance | Evidence |
|---|---|---|
| 1 | One route (D5) calls the CP01 command; DTO/response/status contract; no generic mutation | OpenAPI test: one `post`, statuses `200/400/403/404/409/415`, `200` = array of `RoomOccupancySegmentDto`, `400/403/409/415` = `ProblemDetails`, `404` without a content schema, request media type `application/json` only, exactly the 5 properties and 3 required fields, no `security` in LocalGate. Registry and "paths containing split" assertions allow exactly this path; swap/batch bans stay |
| 2 | D1/D3 for prefix and suffix; Staff actor/evidence server-owned | Staff Theory `suffix`/`prefix`/`both` (Manager): exact ranges, versions = committed `xmin`, one audit group of 3 (Cancelled without evidence; `Created` carries `staff-rbac:Manager:{property}:cross-room-type-confirmed` only on the crossing successors), actor `staff:{id}`, trimmed reason, the source's own `Created` row unchanged and in an earlier group, commercial snapshot unchanged. FrontDesk same-type: no reason, no evidence, actor named. A blank reason with confirmation is the store's `403 Cross-RoomType confirmation required` |
| 3 | Refusals at the right boundary; spy proves no store call | Shared loop (extended with split-move): no session, Customer cookie, Customer value in the Staff cookie, non-member, other Property, Origin missing/null/empty/lookalike/cleartext/foreign/duplicate, unsupported content type/charset, malformed body, FrontDesk `confirm=true`: `401/403/415/400` with `no-store` and no `Location`; store spy `0` calls, then `4` for the positive control. LocalGate: every required/typed field missing, null, wrong type or invalid (+ malformed, empty, `[]`, `null`) is `400` with `no-store`, spy `0`; the composed `SplitMoveAssignmentCommand` is asserted exactly (route ids, body values, local actor, evidence only with confirmation, reason `"  x  "`→`"x"`, blank→`null`) |
| 4 | Success partition/audit/commercial invariants and atomic rejections over HTTP | Same-type and partial-stay (`[9/2, 9/5)` split at `9/3`) successes with board re-reads (wide window: both successors and the two unassigned ranges; window touching only the suffix: the suffix un-clipped, never the prefix). Each business refusal compares the whole schedule (identity/status/room/nights/`xmin`), audit and commercial snapshot through a new `DbContext`: `403` ×6 (sold-type source with cross suffix and cross-type source with sold suffix; no confirmation, no reason, blank reason), `400` (split date at start/end/outside/`DateOnly.Min/Max`, same room, reason 501; reason 500 accepted), `404` (unknown, other-Property route, operational-block id, foreign destination), `409` (stale, cancelled source, inactive, occupied, no capacity) |
| 5 | LocalGate parity; pins/registry/OpenAPI; no regression | Local constants `admin-calendar-local-development` / `local-development-write-gate:cross-room-type-confirmed`, evidence on the prefix for a cross-type source. Closed gate: the gate's generic detail-free `404` + `no-store`, before binding, for valid, malformed, `text/plain` and empty bodies; cleartext `404` without `Location`; Origin `403` and media type `415` keep the gate's order; spy `0`. Staff mode: the local write flag does not open the route (`401`), an expired session (clock +8 h) is `401`. The exact-action pin and the Staff/LocalGate OpenAPI matrix list all six writes; the five older writes' assertions are unchanged |
| 6 | Forged inputs | Body fields `actorReference`, `authorizationEvidence`, `role`, `staffId`, `startDate`, `endDate`, `physicalRoomId`, `reservationUnitId`, `replacements`, `unitAmount` plus query and headers (`X-Actor-Reference`, `X-Role`) on a valid request (LocalGate and Staff): the successors use the source's own range and the body destination, the actor/evidence are the server's, and no segment appears for the forged Unit or rooms. The same payload with `confirmCrossRoomType` from FrontDesk is `403 Access denied`, spy `0` |
| 7 | Docs and scope | Design doc, ADR amendment and SNAPSHOT record D1/D2/D3/D5 APPROVED, D4/D6 OPEN, CP01 merged, CP03–CP05 not started, CD paused. Application/store/auth/Program.cs/schema untouched (§6) |

## 5. Commands and outcomes

| Command | Outcome |
|---|---|
| `git fetch --prune origin` | `origin/develop` = `81acab8…` = baseline |
| `dotnet restore Back_End/TheBha.Booking.sln` | up to date |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | 0 warnings, 0 errors |
| Targeted: new HTTP suite, `StaffCalendarWriteAuthorizationTests`, `AdminCalendarAssignmentApiTests`, `AdminCalendarAssignmentMoveUnassignApiTests` | 71 passed, 0 failed |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` (scratch PostgreSQL 18.3) | unit 244 passed; integration **892 passed**, 0 failed (CP01 reported 873: +19 = 12 in the new file + 7 Staff cases) |
| `git diff --check` | clean |

Two first-run failures were test-side only and were corrected without touching behaviour: the closed-gate body is the generic ProblemDetails (as the existing gate tests define it) rather than a zero-length body, and an audit-event comparison assumed enum order.

## 6. Self-review

* No production line outside `AdminReservationAssignmentsController.cs` (new class + action; comments), the one `WriteActionNames` entry and one gate-filter comment changed. `src/TheBha.Application`, `src/TheBha.Infrastructure`, `src/TheBha.Domain`, `Authentication/*`, `Program.cs` and the board projection have no diff.
* No migration, package or lockfile, `Front_End/`, `.github/`, `deploy/` or secret file changed; the scratch password lived only in an owner-only scratchpad file and the process environment and appears in no diff or output.
* Tests were not weakened: the older routes' assertions, the swap/batch bans and the move/unassign schema assertions are unchanged; the three allowance edits name the exact path.
* Cleanup: only the container `cp02-scratch-pg-…` created by this session (label verified before removal) and its volume.

## 7. Limits and risks

* No idempotency or exactly-once guarantee: a lost response needs a board re-read, as for every write.
* The `LocalGate` constants describe how the local gate was exercised; they are not proof of a Manager.
* Beyond the store's own rules there is no today, check-in or repricing rule (D4/D6 OPEN).
* The PR exceeds the 100–400 line target: roughly 100 production lines (about 70 of them XML comments), 20 lines of test edits, ~1,000 lines of new tests and ~40 of docs plus this report. The tests carry the safety case (Staff matrix, per-refusal state comparison, forged inputs); none was compressed to fit.
* NOT_RUN by design: browser/API Docker rehearsal and frontend checks (UI is CP05), any cloud call, live deploy, release workflow dispatch.

## 8. Status

`IMPLEMENTATION_CP02: PASS` (mandatory checks above). `REVIEW_CP02: NOT_RUN — OWNER_ONLY`. `HTTP_SPLIT_MOVE: IMPLEMENTED`. `UI_SPLIT_MOVE: NOT_IMPLEMENTED`. `CP03–CP05: NOT_STARTED`. `BACKEND_CD: PAUSED / NOT_COMPLETE`. `LIVE_DEPLOY_CP02`, `CLOUD_CALLS_CP02`: `NOT_RUN`. The two GitHub repository release flags were written `false` by Owner at an earlier step; this checkpoint called no cloud and changed no flag.
