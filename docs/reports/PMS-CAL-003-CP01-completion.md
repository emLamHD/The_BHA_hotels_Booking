# PMS-CAL-003-CP01 — completion report

`OPERATIONAL_BLOCK_MOVE_API` · implementer CLAUDE · reviewer CODEX_READ_ONLY (Owner invokes) · 2026-10-12

## 1. Identity

| | |
|---|---|
| Branch | `feature/pms-cal-003-cp01-operational-block-move-api` (created in the single checkout) |
| Baseline / START_HEAD | `c7041c17ef619ecac90d2d2f1ed7869b9eb21b0b` (= `origin/develop`, PR #102 merged; PMS-CAL-002 closed) |
| Validation SHA (code + tests) | `2e6c10e` — every runtime result below ran on this code |
| Later commit | documentation only (this report, design, ADR amendment, BIBLE, SNAPSHOT, runbook) |
| Draft PR / FINAL_HEAD / CI | in the PR description and the hand-off message (a report cannot contain the CI of the commit that contains it) |

## 2. What changed

Production (Backend only; 4 files, +223/−6, the removed lines are doc comments and one filter name-list line):

- `BlockMutations.cs`: `MoveOperationalBlockCommand(PropertyId, SegmentId, ExpectedVersion, DestinationPhysicalRoomId, ActorReference, Reason?)`; `IOperationalBlockMutationStore.MoveAsync` (no default interface body).
- `OperationalBlockMutationStore.cs`: the adapter `MoveAsync` and `MaximumMoveNights = 366`. It refuses a blank actor and an over-limit reason first, then pre-reads (`AsNoTracking`, exact `Id` + `PropertyId` + `Type = OperationalBlock`) the source's room and full dates — missing / other Property / assignment → `NotFound`; destination equal to the source room → `Invalid`; a source over 366 nights → `Invalid` from two day numbers, before anything is enumerated — then delegates **one** supersession with **one** replacement (destination, `source.StartDate…source.EndDate`, the caller's `ExpectedVersion`) to the unchanged `SupersedeSegmentsAsync`.
- `AdminOperationalBlocksController.cs`: `MoveOperationalBlockRequest` (`expectedVersion`, `destinationPhysicalRoomId` both `[JsonRequired]`, optional `reason`) and `Move` — `POST …/operational-blocks/{segmentId}/move`, `StaffCalendarPermission(BlockWrite, typeof(AdminCalendarWriteGateFilter))`, the same CORS/`IgnoreAntiforgery` composition, `ResolveActor` (Staff context or local constant; Staff with no context → `Forbid`), reason trimmed with blank → `null`, status mapping 200 / 400 / 404 / 409 where only `Succeeded` is a success.
- `AdminOperationalBlockOpenApiOperationFilter.cs`: `Move` added to the JSON-only list.

**Engine bodies unchanged — proof.** `git diff -U0 Back_End/src` shows the only removed lines are six doc-comment lines and one `nameof(...Cancel)))` line of the filter's name list; `CreateBlockAsync`, `SupersedeSegmentsAsync`, both `ComputeBlockedRoomDeltas` and `DatesInRange` have no removed or added line (the new members were inserted between existing methods).

Not touched: Domain/guards/constants, migrations/schema, `Program`/DI/auth/permission mapping, shared capacity/lock/concurrency engine, Customer APIs, `AssignmentMutationStore`, Front_End, workflows/deploy/config/packages, governance files.

## 3. Verification (local, this session)

Isolated PostgreSQL: container `bha-cp03-cp01-pg` (label `task=pms-cal-003-cp01`, image `postgres:18.3`, `PostgreSQL 18.3 (Debian 18.3-1.pgdg13+1)`), loopback `127.0.0.1:55433`; the test factory creates one throw-away database per test class on it. Not RDS, not `the-bha-postgres-1`, not the showcase stack. `TimeProvider` pinned by the fixtures (`2026-07-22T00:00:00Z`; the hold tests move it deliberately).

| Command | Outcome |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | success |
| `dotnet build … -c Release --no-restore --no-incremental` (SDK 8.0.423) | **0 warnings, 0 errors** |
| `dotnet test … -c Release --no-build` (whole solution) | **unit 244 passed / 0 failed / 0 skipped; integration 920 passed / 0 failed / 0 skipped** |
| `git diff --check`, secret scan of the diff | clean (§8) |

Tests added: **+28** (the integration suite was 892). `OperationalBlockMutationStoreTests` +14, new `AdminOperationalBlockMoveApiTests` 11, `StaffCalendarWriteAuthorizationTests` +3. Existing assertions were not loosened: the registry in `AdminCalendarAssignmentApiTests` and the sub-path check in `AdminOperationalBlockCreateApiTests` gain exactly the one new route, the permission pin and OpenAPI table in the Staff tests gain one row, and `CountingBlockStore` implements `MoveAsync` by the existing spy pattern (the only implementer/test double of the interface).

Behaviour covered (each business refusal compares **every** segment with its committed `xmin`, every `RoomBlock` header, every audit row and the commercial snapshot before/after):

- **Success** — example from the prompt: source Effective room A `[9/1, 9/4)` → 200 `[Cancelled source, Effective successor]` in room B over the same dates, same header `H`, versions equal the committed `xmin`; two new audit rows, one `MutationGroupId`, actor server-owned, `AuthorizationEvidence` null, reason `"Move closure to room B"` (trimmed), header reason unchanged; the original `Created` row and unrelated blocks/siblings byte-identical; commercial rows identical. Same and different RoomType; one night; a source clipped by the board window moves over its full span (board read before/after).
- **Reason** — absent, `null`, empty, whitespace → none; trimmed; exactly 500 accepted (also after trimming); 501 → 400 with state unchanged.
- **Refusals** — same room 400; blank actor 400; source missing, other Property, assignment segment, destination missing, destination in another Property → 404; stale version, zero version, cancelled source, not-Active destination → 409. Added after mutation testing: another Property's block or an assignment with *its own room as destination* must be 404, not 400.
- **Body** — missing / null / wrong-typed / negative / fractional / over-`uint` `expectedVersion`, missing or malformed destination, `[]`, `null`, `{}`, broken JSON, non-object `reason` → 400 with the store spy at **zero calls**; a non-Guid segment route → 404. (Quoted numbers such as `"expectedVersion":"1"` are accepted by the host's shared `System.Text.Json` web defaults for every Admin route, as before.) Forged `actorReference`, evidence, role, `confirmCrossRoomType`, dates, `physicalRoomId`, `roomBlockId`, `replacements`, query string and headers change nothing: the route and the typed body decide.
- **Capacity / overlap** — overlap with an assignment or another block 409; touching ranges (half-open) 200; destination type fully committed 409; an active hold counts and an expired one does not; a same-type move succeeds even when that type is fully committed (net delta zero); a different-RoomType move succeeds when capacity allows (FrontDesk and Manager, no confirmation field).
- **Span** — 366 nights moves; 367 → 400; a source `[2026-01-01, 9999-12-31)` (planted only in the scratch database) → 400 in well under a second with state unchanged.
- **Concurrency** (barrier-started, six rounds each, never sleeps): two moves of the same version → one winner and one 409, one successor, exactly the expected audits; move vs cancel of the same version → one winner; two blocks racing for one destination room and nights → one winner; two moves that together exceed the destination type's capacity → one winner. No partial writes or extra audit rows in any round.
- **Staff / gate** — FrontDesk and Manager move across RoomTypes with `staff:{id}` and no evidence, the header keeps its creator; a forged identity and a Customer cookie beside the Staff cookie never win; another Property's member 403, no/expired/disabled session 401 — all with zero store calls; the store receives the route's ids, the body's version/room and the Staff actor. The move joins the seven-write loops (no authority, bad Origin, wrong media type, closed gate, local write flag does not open Staff). Closed `LocalGate`, cleartext, missing Origin, `text/plain` → 404 / 404 / 403 / 415 with zero calls. OpenAPI: one `post`, statuses `200/400/403/404/409/415`, `200` an array of `RoomOccupancySegmentDto`, `404` without a body, JSON-only request body with exactly `destinationPhysicalRoomId`, `expectedVersion`, `reason` and the first two required, and below the collection only `cancel` and `move`.
- **Regressions** — create and cancel (block) and all assignment routes incl. split-move pass in the full run; an unknown or unused `SegmentMutationStatus` from a store is a 409, never a 200.

**Mutation checks** (a throwaway script flipped one guard at a time, rebuilt, ran the four affected suites, restored the file; 11 mutations): same room allowed, no span bound, shortened replacement range, no Property filter in the pre-read, no Type filter, the caller's version ignored, reason not trimmed, an unused status mapped to success, the permission changed to `AssignmentWrite`, the filter skipping `Move`, the actor always the local constant — **all 11 caught.** Three first survived (the two pre-read filters and the status mapping) because the engine's own filters / a too-weak spy status masked them; tests that isolate each were added and now kill them.

## 4. Acceptance

| # | Item | Result |
|---|---|---|
| 1 | Command, interface member, adapter; engine untouched | met (§2) |
| 2 | HTTP route, body, status mapping, no actor/evidence/dates from the client | met |
| 3 | Permission/actor/audit invariants (BlockWrite only; null evidence; one group) | met |
| 4 | OpenAPI exact; registry gains one route; no assertion loosened | met |
| 5 | Refusals change nothing; concurrency one winner | met |
| 6 | Mandatory checks on PostgreSQL 18.3; final-head CI | local met; CI in the hand-off |
| 7 | Docs distinguish backend implemented from UI/CP02/CP03 not started | met |

## 5. Deviations and limitations

- No edit outside the allowlist. `StaffCalendarAuthorizationTests`: the loop test was renamed from "…the_five_calendar_writes…" to "…the_calendar_writes…" because its list now has more entries than its name claimed.
- The adapter checks the reason limit before its pre-read (the audit rows would otherwise reject it after the engine took its locks); this restates no business rule — it uses `SchedulingFieldLimits.Reason`.
- The controller's `Move` has `IReadOnlyList<RoomOccupancySegmentDto>` as the OpenAPI 200 type, like split-move.
- Frontend/browser, live deploy and cloud calls: NOT_REQUIRED / NOT_RUN for a backend checkpoint. `diagnosing-bugs` was not triggered; Graphify NOT_APPLICABLE (source read directly). No Docker image was built; the image workflow is CI's evidence, not dispatched.
- PR size is above the 100–400 target: the size and reason are in the PR description (mostly tests: store invariants, concurrency, the HTTP and Staff contracts).
- Pre-existing and untouched: a stash named `owner-gitignore` and two Orca worktrees in the checkout.

## 6. Cleanup

Container `bha-cp03-cp01-pg` and its anonymous volume removed (`docker rm -f -v`); the scratch directory outside the repo (password, env file, logs, mutation script) deleted. Other containers (`the-bha-postgres-1`, the showcase set) untouched. No secret or config in the repository.

## 7. Status

`IMPLEMENTATION_CP01: PASS` · `HTTP_OPERATIONAL_BLOCK_MOVE: IMPLEMENTED` · `UI_OPERATIONAL_BLOCK_MOVE: NOT_IMPLEMENTED` · `REVIEW_CP01: NOT_RUN — OWNER_ONLY` · `PMS_CAL_003: IN_PROGRESS` · `PMS_CAL_002: CLOSED_AFTER_OWNER_MERGE` · `CP02 / CP03: NOT_STARTED` · `CLOUD_CALLS_CP01 / LIVE_DEPLOY_CP01: NOT_RUN` · `BACKEND_CD: PAUSED / NOT_COMPLETE` (the two release flags were not read or changed; the `false` readbacks of 2026-10-10 are earlier evidence).

## 8. Secret scan

The diff was grepped for password/secret/key/bearer/private-key patterns and for the scratch connection string; the only hits are test-fixture constants already present (`Password` seed helpers) and the runbook's `BHA_STAFF_PASSWORD` instructions.
