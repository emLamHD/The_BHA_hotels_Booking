# PMS-CAL-002-CP00 — Split-move design and contract: completion report

> Draft PR into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> START_HEAD / BASELINE_SHA `38d4a9d964fde411aa4c03b46323f250fd54221b` (PR #80, `PMS-ADMIN-AUTH-001-CP07`, merged `2026-10-04T09:32:21Z`; CI run `37192482384` `success` on that commit). Branch `docs/pms-cal-002-cp00-split-move-design`. FINAL_HEAD, PR URL and CI on FINAL_HEAD are in the PR body and the handoff (this file is part of the final commit).

## 1. Outcome

- `docs/design/PMS-CAL-002-split-move.md`: verified CURRENT, ownership of every check, the proposed `split-move` HTTP contract, authorization/audit for both successors, atomicity, the Admin_Web and lost-response design, six OPEN Owner decisions and a five-checkpoint roadmap.
- Staff-auth closure synchronised: SNAPSHOT (milestone `PASS — CLOSED`, CP00 is the objective, First action no longer points to `PMS-CAL-001.2-CP04B`, stale "no Staff identity / opaque evidence only" CURRENT lines corrected), PROJECT_BIBLE (split-move stays TARGET, link to the design), Staff-auth design and ADR 0007 (CP07 merged in PR #80).
- No source, test, migration, API contract, CI, dependency, governance or runtime configuration change. Split-move does not exist yet; CP01 NOT STARTED.

## 2. CURRENT evidence (summary; full table in design §2)

- `SupersedeAsync` already supports one source with two replacements: exact partition, per-replacement destination checks (including a replacement that keeps the source room), per-replacement cross-type evidence, final-state capacity, one transaction, one audit group.
- The existing store regression returns **3 segments (1 Cancelled + 2 Created)**, not only the two successors.
- HTTP exposes only whole-segment `move` and `unassign`; no split route.
- Staff session, `AssignmentWrite`/`AssignmentCrossRoomType`, Staff actor and `staff-rbac` evidence are CURRENT (CP05–CP07).
- Two findings that shape the design: (1) the board returns a Unit's assignments un-clipped **but only when they overlap the window** (`ReservationBoard.cs:298-299`), so seeing both successors needs a window that straddles the split date; (2) a FrontDesk user cannot split a source that is already cross-type under the CURRENT store, because the kept prefix is a new cross-type `Created` row (design §5.2, decision D1).

## 3. Proposed contract (summary; design §4–§7)

`POST /api/admin/v1/properties/{propertyId}/reservation-assignments/{segmentId}/split-move` with `{ expectedVersion, splitDate, destinationPhysicalRoomId, confirmCrossRoomType?, reason? }`. A new store method reads the source's immutable room and dates, checks `start < splitDate < end` (and D2), builds the two replacements and calls the unchanged `SupersedeAsync`. `200` with `[source Cancelled, prefix, suffix]`. Status mapping reuses the existing titles. No idempotency key or schema. Client: target from the exact board segment, send-time guards, intent before the wire, no retry, `observed` only from a window that straddles the split date, `changed` when the source is gone, room-range locks, tab storage kept at format `v: 1` with an additive `split-move` record.

## 4. OPEN decisions for Owner (design §8)

| # | Question | Recommendation |
|---|---|---|
| D1 | Cross-type source kept on the prefix | Manager only (CURRENT store rule) |
| D2 | Destination = source room | Reject 400 |
| D3 | Reason mandatory | Only when a successor crosses RoomType |
| D4 | Split date before `localToday` | No server rule (none exists today); UI warning + extra acknowledgement |
| D5 | Route/response/`LocalGate` | `POST …/split-move`, `200` with three segments, `LocalGate` via the same attribute |
| D6 | Check-in state, past nights, repricing | No rule; no lifecycle exists; prices never change by invariant |

## 5. Roadmap (design §9; CP00 estimates)

| CP | Content | Est. lines |
|---|---|---|
| CP01 | Store command + PostgreSQL tests | ~300 |
| CP02 | HTTP route, Staff authz/audit, OpenAPI/pin tests, ADR 0006 amendment | ~400 |
| CP03 | Admin_Web client, target, reconciliation, storage | ~480 (reason in design) |
| CP04 | Dialog (not mounted) | ~450 (reason in design) |
| CP05 | Board wiring + browser acceptance + docs | ~350 |

## 6. Checks run in this session

| Check | Result |
|---|---|
| `git fetch --prune origin`; `develop` fast-forward; HEAD = `origin/develop` = BASELINE_SHA | yes, `38d4a9d` |
| `dotnet restore Back_End/TheBha.Booking.sln` | exit 0 |
| `dotnet build … --configuration Release --no-restore` | exit 0, 0 warnings, 0 errors |
| `--list-tests` confirmed the exact name `TheBha.IntegrationTests.AssignmentMutationStoreTests.Split_preserves_commercial_nights_price_and_creates_two_successor_segments` | listed |
| That test alone (`--filter FullyQualifiedName=…`) on a separate PostgreSQL 17.10 container (`127.0.0.1:55432`, random password, not `the-bha-postgres-1`) | exit 0, **1 passed**, 0 failed |
| `AssignmentMutationStoreTests` (34) + `AdminCalendarAssignmentMoveUnassignApiTests` (23) + `StaffCalendarWriteAuthorizationTests` (14), same database server | exit 0, **71 passed**, 0 failed, 0 skipped |
| Container and password file removed after the run | done; `the-bha-postgres-1` untouched |
| `git diff --check`; every path cited in the new design resolves on the baseline; relative links resolve | see PR body |
| CI Backend/Admin/Frontend on FINAL_HEAD | see PR body |

Browser acceptance: **NOT_APPLICABLE** — no UI is implemented in CP00, and none was simulated.

## 7. Self-review, deviations, risks

- Line references were checked against the baseline files; ranges were corrected where a test ended later than first noted.
- `docs/ADR/0006-…md` "Current-versus-target boundary" still says real Staff identity and Admin RBAC are TARGET. It is outside this checkpoint's allowlist and was **not** edited; recommended for the CP02 ADR 0006 amendment.
- `reconciliation.ts:152-169` describes board assignments as "complete"; they are un-clipped but window-filtered. Not edited (source is out of scope); listed for CP03.
- Two inactive linked worktrees from the discontinued Orca pilot (`/home/admin1/orca/workspaces/…`, 2026-08-07) exist on disk; recorded only, not used or modified (`RULES.md` §5).
- PR size will exceed the 100–400 target: the deliverable is a full design (contract, auth matrix, reconciliation rules, roadmap) plus the closure sync of four documents; exact GitHub numbers are in the PR body.

## 8. Status

`REVIEW: NOT RUN`. `CP01 NOT STARTED`. `Production NOT TOUCHED`. Skill policy: `diagnosing-bugs` not triggered (no defect); Graphify not invoked (the files in scope were known and read directly).
