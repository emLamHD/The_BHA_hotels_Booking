# PMS-CAL-002 — Mid-stay room move by split assignment ("split-move")

> Status: **proposal**, written in `PMS-CAL-002-CP00` on baseline `38d4a9d964fde411aa4c03b46323f250fd54221b` (PR #80 merge). Nothing below is CURRENT. Split-move stays **TARGET** until its implementation checkpoints merge.
> Everything marked *Recommended* is the implementer's proposal, **not** an Owner decision. The open decisions are D1–D6 in §8; CP01 must not start until Owner has decided the ones it depends on.
> **Update 2026-10-10 (Owner Hồ Đình Lâm):** D1 and D2 are **APPROVED** (§8); `PMS-CAL-002-CP01` implemented the internal store command (`SplitMoveAsync`, §4.3, §9) and is **merged** (PR #97, merge `81acab8`).
> **Update 2026-10-10 (later, Owner):** D3 and D5 are **APPROVED** (§8); D4 and D6 stay **OPEN**. `PMS-CAL-002-CP02` implements the HTTP route `POST …/{segmentId}/split-move` (§4) behind the existing Staff authorization and the Development-only `LocalGate`; it is a Draft PR until merged. Admin_Web (CP03–CP05) stays **TARGET** and is not started.
> Scope: one Effective ReservationAssignment segment, one split date, one destination PhysicalRoom for the later nights. Out of scope: batch/swap, several split dates, changing stay dates, pricing, booking creation, operational-block move/split, OTA, server-side idempotency.

## 1. Goal

Blueprint §15.4: a guest holds Room 101 for 9 nights and must move to Room 102 after 5 nights.

- The 9-night segment is **superseded** (status `Cancelled`, row and audit kept), never deleted or re-dated in place (ADR 0006 item 5).
- Successor 1: Room 101, the first 5 nights `[start, splitDate)`.
- Successor 2: Room 102, the last 4 nights `[splitDate, end)`.
- `ReservationUnitNight` rows, prices and the commercial commitment do not change (blueprint §9, ADR 0006 item 8).
- One transaction: a conflict leaves the source segment, its version and the commercial records exactly as they were.

Dates are half-open nights (ADR 0003). `splitDate` is the first night in the destination room, so a valid request has `startDate < splitDate < endDate` and both successors have at least one night.

## 2. Verified CURRENT at the baseline (source, not history)

| Fact | Where |
|---|---|
| `AssignmentSupersession` with two or more replacements is a split; the ranges must exactly partition the source range. | `Back_End/src/TheBha.Application/Scheduling/AssignmentMutations.cs:22-33` |
| `SupersedeAsync` takes the ReservationUnit advisory lock, re-reads the segments under it, and rejects a non-Effective segment or a stale `ExpectedVersion` (`xmin`) with `Conflict`. | `Back_End/src/TheBha.Infrastructure/Persistence/AssignmentMutationStore.cs:238-288` |
| Replacements must cover the source range exactly, contiguously and without overlap (`ExactlyPartitions`), else `Invalid`. | `AssignmentMutationStore.cs:339-345`; `RoomOccupancySegmentMutationSupport.cs:49-72` |
| **Every** replacement, including one that keeps the source room, is validated as a destination: it must exist in the Property (`NotFound`) and be `Active` (`Conflict`). | `AssignmentMutationStore.cs:347-360` |
| Cross-RoomType is decided **per replacement** against the Unit's **sold** RoomType; if any replacement crosses, the command needs non-empty evidence and reason, else `Unauthorized`. | `AssignmentMutationStore.cs:362-383` |
| Demand deltas: −1 on the source room's RoomType for every source night, +1 on each replacement room's RoomType for its nights; RoomType-scope and inventory locks are taken for all affected types/dates, then the **final** state is checked once (holds included). | `AssignmentMutationStore.cs:323-326, 368-371, 385-410`; `RoomOccupancySegmentMutationSupport.cs:125-176` |
| Audit: one `MutationGroupId`; a `Cancelled` row for the source (never evidence) and one `Created` row per successor (evidence only when that successor crosses RoomTypes); actor and reason on every row. | `AssignmentMutationStore.cs:412-475` (CP04A) |
| Result order is the source segment(s) cancelled, then successors in replacement order; versions are read after commit. | `AssignmentMutationStore.cs:413-415, 493-494` |
| Room/Unit exclusion constraints and the booked-night coverage trigger are `DEFERRABLE INITIALLY DEFERRED`, so cancelling the source and inserting a successor in the same room in one transaction is legal; violations are mapped to safe `Conflict` texts at commit. | `Persistence/Migrations/20260826035254_PhysicalRoomScheduleAvailabilityAuthority.cs:302-345`; `RoomOccupancySegmentMutationSupport.cs:83-103, 178-203` |
| A segment's room and dates are immutable: setters are private and `Cancel()` is the only mutator; `xmin` is the row version. | `Back_End/src/TheBha.Domain/Scheduling/RoomOccupancySegment.cs:48-68`; `Configurations/RoomOccupancySegmentConfiguration.cs:57-61` |
| Store regression `Split_preserves_commercial_nights_price_and_creates_two_successor_segments` returns **3 segments: 1 Cancelled + 2 Created**; unit total unchanged; source `Cancelled`; two Effective successors. Its prefix keeps the source room. | `Back_End/tests/TheBha.IntegrationTests/AssignmentMutationStoreTests.cs:152-194` |
| Mixed split records evidence only on the cross-type successor; a cross-type split missing evidence or reason is rejected with the source row, its `xmin` and the audit untouched. | `AssignmentMutationStoreTests.cs:873-907, 949-995` |
| HTTP exposes only whole-segment `move` (one replacement equal to the source range) and `unassign` (zero replacements); no split route. | `Back_End/src/TheBha.Api/Controllers/AdminReservationAssignmentsController.cs:332-408` |
| Every Calendar write action carries `[StaffCalendarPermission(AssignmentWrite or BlockWrite, typeof(AdminCalendarWriteGateFilter))]`, pinned per action by a test; in `Staff` mode a route without it is 404. | Controller `:256, :333, :377`; `StaffCalendarWriteAuthorizationTests.cs:505-533`; `Api/Authentication/StaffCalendarModeGuard.cs:28-46` |
| `Staff` mode: before binding, session (401) → role at the route Property read from the DB (403) → Origin/JSON (403/415) → `StaffCalendarWriteContext`. `confirmCrossRoomType` also needs `AssignmentCrossRoomType` (Manager) else 403 before the store; actor `staff:{id}`, evidence `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed`. `LocalGate` (Development-only opt-in) keeps the local constants. | `StaffCalendarAccessFilter.cs:39-74`; `StaffAccessEvaluator.cs:23,70`; `StaffCalendarWriteContext.cs:12-25`; controller `:418-442` |
| Board read returns only Active rooms, Committed Units with a booked night in `[from, to)`, and each Unit's Effective assignments **un-clipped but only those overlapping `[from, to)`**. | `Infrastructure/Persistence/ReservationBoardDataLoader.cs:91, 103, 137`; `Application/Scheduling/ReservationBoard.cs:298-299` |
| No assignment mutation compares dates with the Property's local today; `localToday` is used only by customer availability/hold and returned by the board. | `Application/Properties/AvailabilitySearch.cs:83-84`; `BookingHoldCreationStore.cs:131-133`; `ReservationBoard.cs:234` |
| Admin_Web move: target built from the exact clicked segment (`buildMoveTarget`), cross-type judged against the sold type at send time, role re-checked, storage verified, room/night locks, stale-board refusal, intent recorded before the wire, one request, no retry. | `Front_End/Admin_Web/src/components/calendar/reservation-board/moveTarget.ts:57-103`; `ReservationBoard.tsx:1550-1695` |
| Lost-response model: `200`/`4xx` settled, network/timeout/abort-after-send/`5xx` unknown; unknown writes resolve only from authoritative board evidence (`observed`/`changed`) and lock rooms/nights until then. | `src/lib/api/client.ts:381-516`; `reconciliation.ts:171-232, 345-385` |
| Tab storage: format `v: 1`, per-operation record fields, pending intent written and read back before sending; a stored pending entry that does not validate makes `beginPendingWrite` refuse every new write. | `uncertainWriteStorage.ts:70, 109-134, 204-236, 371-390` |

## 3. Who owns each check

| Check | Store / PostgreSQL (CURRENT authority) | HTTP boundary (new route) | UX only (never relied on) |
|---|---|---|---|
| Source exists in route Property, is an assignment | pre-read + re-read under lock → 404 | – | build target from board |
| Source Effective, `expectedVersion` current | under Unit lock → 409 | send board version verbatim | refuse stale target |
| `start < splitDate < end` | **new**, store method (§4.3) → 400 | required field | date picker bounded by source range |
| Destination ≠ source room (D2) | **new**, store method → 400 | – | room omitted from list |
| Successor rooms in Property, `Active` | → 404 / 409 | – | Active rooms only |
| Exact partition of the source range | built by server; re-checked → 400 | client cannot send ranges | – |
| No room/Unit overlap | deferred exclusion → 409 | – | optional "occupied" hint |
| Booked-night coverage, Unit Committed | trigger → 409 (holds by construction) | – | – |
| Final-state capacity (cross-type) | → 409 | – | – |
| Cross-type evidence + reason | per successor → 403 "Cross-RoomType confirmation required" | actor/evidence from server-side authorization | confirmation + reason fields |
| Session, `AssignmentWrite`, Origin, JSON | – | filter → 401/403/415 before binding | hide action without capability |
| `AssignmentCrossRoomType` for `confirmCrossRoomType` | – | controller → 403 before store | Manager-only controls |
| Atomicity, audit, locks | one transaction, `MutationGroupId` | – | – |

The controller adds no capacity, overlap, concurrency or date engine. The only new rules are the two `Invalid` checks (split date inside the range; D2), placed in the store method that owns the source read.

## 4. Proposed HTTP contract (*Recommended*)

### 4.1 Route

`POST /api/admin/v1/properties/{propertyId:guid}/reservation-assignments/{segmentId:guid}/split-move`

Same controller, CORS policy and `[IgnoreAntiforgeryToken]` as `move`; the action carries `[StaffCalendarPermission(StaffPermission.AssignmentWrite, typeof(AdminCalendarWriteGateFilter))]`, so it is Staff-authorized by default and keeps the Development-only `LocalGate` gate like the other five writes (D5). The per-action pin test gains this entry.

### 4.2 Request body

```json
{ "expectedVersion": 812345, "splitDate": "2026-11-06", "destinationPhysicalRoomId": "…", "confirmCrossRoomType": false, "reason": "AC failure in 101" }
```

| Field | Rule |
|---|---|
| `expectedVersion` (uint) | `[JsonRequired]`; the source segment's version from the board read. |
| `splitDate` (date) | `[JsonRequired]`; first night in the destination room. |
| `destinationPhysicalRoomId` (guid) | `[JsonRequired]`. |
| `confirmCrossRoomType` (bool) | Optional, default `false`; must be `true` when **either** successor crosses the sold RoomType (§5.2). |
| `reason` (string) | Optional; trimmed, empty → absent; required by the store when a successor crosses (D3); max 500 (domain guard → 400). |

The body carries no actor, no evidence, no source dates and no replacement list. Unknown properties are ignored, as for `move`. The server never takes a range from the visible Calendar window: the source's own `[start, end)` comes from the database.

### 4.3 Server composition

A new application command and store method, not controller logic:

```csharp
public sealed record SplitMoveAssignmentCommand(
    Guid PropertyId, Guid SegmentId, uint ExpectedVersion, DateOnly SplitDate,
    Guid DestinationPhysicalRoomId, string ActorReference, string? AuthorizationEvidence, string? Reason);

Task<SegmentMutationResult> SplitMoveAsync(SplitMoveAssignmentCommand command, CancellationToken cancellationToken);
```

`AssignmentMutationStore.SplitMoveAsync`:

1. Reads `StartDate`, `EndDate`, `PhysicalRoomId` of the segment with that id, the route Property and type `ReservationAssignment` (no tracking). None → `NotFound`.
2. `SplitDate <= StartDate || SplitDate >= EndDate` → `Invalid("splitDate must fall strictly inside the segment's nights.")`.
3. `DestinationPhysicalRoomId == PhysicalRoomId` → `Invalid(...)` (if D2 is accepted).
4. Calls the existing `SupersedeAsync` with one supersession `(SegmentId, ExpectedVersion, [ (source room, Start, SplitDate), (destination, SplitDate, End) ])` and the command's actor, evidence and reason.

The read in step 1 is outside `SupersedeAsync`'s transaction on purpose and is safe: room and dates of a segment never change (§2), and the only mutable field (status) plus the version are re-checked under the Unit lock in step 4. A source cancelled in between gives the same `409` as `move`. `SupersedeAsync` itself is not modified.

### 4.4 Response

`200 OK`, body = the store result: exactly three `RoomOccupancySegmentDto`, in order `[source (Cancelled), prefix (source room, [start, splitDate)), suffix (destination, [splitDate, end))]`, each with its new `version`. `200`, not `201`, for parity with `move` (an existing placement is restructured). No `Location`; the board stays the authoritative read. Clients should identify successors by room and range, not only by index.

### 4.5 Status mapping (unchanged `MapSupersedeResult` titles)

| Situation | Status, title |
|---|---|
| Missing/invalid required field, malformed JSON | 400 (validation problem) |
| Split date not strictly inside; same room (D2); reason > 500 | 400 "Invalid assignment request" |
| `Staff`: no/expired session | 401 "Authentication required" |
| `Staff`: no `AssignmentWrite` at the route Property; Origin not allowed | 403 "Access denied" / "Origin not allowed" |
| `Staff`: `confirmCrossRoomType` without `AssignmentCrossRoomType` | 403 "Access denied" (before the store) |
| A successor crosses RoomType without evidence/reason | 403 "Cross-RoomType confirmation required" |
| Non-JSON content type | 415 |
| `LocalGate` closed | 404, empty |
| Source not in Property / not an assignment; destination not in Property | 404 "Assignment target not found" |
| Source not Effective, stale version, room not Active, overlap, capacity, Unit not Committed | 409 "Assignment conflict" |

Every 4xx is proof that nothing was written. No idempotency key, request id or schema change is added in this milestone; a lost response is handled by the client contract in §6.

## 5. Authorization and audit

### 5.1 Who may call

`AssignmentWrite` at the route Property (FrontDesk and Manager). In `Staff` mode the actor is `staff:{StaffAccountId}`; in `LocalGate` the existing local constants. No client value can change either.

### 5.2 Cross-RoomType for both successors

`S` = sold RoomType, `R` = source room's RoomType, `D` = destination's RoomType. The store judges each successor against `S`.

| Case | Prefix (room R) | Suffix (room D) | Confirmation | Who may do it (current role map) | Evidence written on |
|---|---|---|---|---|---|
| `R = S`, `D = S` | same | same | no | FrontDesk, Manager | none |
| `R = S`, `D ≠ S` | same | cross | yes | Manager | suffix `Created` |
| `R ≠ S`, `D = S` | **cross** | same | yes | Manager (D1) | prefix `Created` |
| `R ≠ S`, `D ≠ S` | cross | cross | yes | Manager (D1) | both `Created` rows |

Row 3 is the non-obvious one: keeping the guest in an already cross-type room for the earlier nights creates a **new** `Created` row that crosses, so the store requires evidence and a reason even though the operator only picked a same-type destination. Under the CURRENT store a FrontDesk user therefore cannot split a cross-type source (403 either before the store or from it). The client must compute `confirmCrossRoomType = (R ≠ S) || (D ≠ S)`.

### 5.3 Audit rows of one split-move

| Row | Event | Actor | Evidence | Reason |
|---|---|---|---|---|
| source | `Cancelled` | caller | never | request reason |
| prefix | `Created` | caller | only if `R ≠ S` | request reason |
| suffix | `Created` | caller | only if `D ≠ S` | request reason |

All three share one `MutationGroupId`. The source keeps its original `Created` row; no history is rewritten and nothing is backfilled.

## 6. Atomicity and concurrency

- One `SupersedeAsync` transaction: Unit lock → authoritative re-read → validation → RoomType-scope and inventory locks for every affected type/date → final-state capacity → cancel source + insert successors + audit → commit. Deferred constraints run at commit and map to `409`; nothing is half-applied.
- Capacity deltas: prefix nights net 0 (−R +R). Suffix nights −R +D: 0 when `D = R`, otherwise a real move between buckets that must have final-state capacity (ADR 0006 item 5).
- Known CURRENT behaviours, not changed here: (a) the retained source room must still be `Active`, so a split-move from a room deactivated after assignment is a `409` — the board does not list inactive rooms, so the UI cannot open the action for it; (b) the store validates every touched bucket, including net-zero ones, so a bucket that is already over capacity rejects even a no-delta change (same as `move`).

## 7. Admin_Web design

### 7.1 Entry and target

The stay popover of an assigned segment offers **Move from a date…** beside Move and Unassign, only when the role grants `assignmentWrite` and the segment has at least two nights. `buildSplitMoveTarget(board, selectedPropertyId, selection)` follows `buildMoveTarget`: exact match on segment id, version, room and range in the current board, else `null`. It carries the segment's own un-clipped `[start, end)`, current room and RoomType, sold RoomType, `localToday`, board key/window, and candidate rooms (Active, excluding the source room; same sold type first).

### 7.2 Dialog

- Shows guest, confirmation, source room and type, the full source range and night count.
- Split date picker bounded to `start+1 … end−1`, independent of the visible window. Default (*Recommended*): `localToday` when it lies strictly inside, otherwise no default.
- Live summary: "Room 101 keeps 5 nights (Nov 1 – Nov 5); Room 102 takes 4 nights (Nov 6 – Nov 9)".
- Destination list; other-RoomType rooms only for a role with `crossRoomType`.
- Confirmation checkbox and required reason whenever `(R ≠ S) || (D ≠ S)`; for a FrontDesk user with `R ≠ S` the action is disabled with "A Manager must split a stay placed in a different room type than sold."
- Optional reason otherwise (D3); a past split date shows the D4 warning.
- Submission rules of the move dialog: one request at a time (synchronous ref), not closable in flight, Confirm gone after `409`/unknown, any edit clears the previous result.

### 7.3 Send-time guards (in this order, all before the intent is recorded)

1. Destination is one of the target's candidates; cross-type re-derived from board RoomTypes, not trusted from the dialog.
2. Capabilities at the Property **now** (`assignmentWrite`; `crossRoomType` if confirmation is needed).
3. Storage verified (`refuseWhileStorageUnverified`).
4. Room/night locks: source room over `[start, end)`, destination over `[splitDate, end)`, and no unresolved write on this segment id or this Unit's overlapping nights.
5. Board key unchanged, else the dialog closes with the stale-board message.
6. `beginPendingWrite` succeeds (record read back), else not sent.

Session expiry, logout, a `me` refresh or a Property switch never resend anything, and never drop pending or unknown records (they are not namespaced by Staff, as in CP06).

### 7.4 Outcomes

`splitMoveReservationAssignment` mirrors `moveReservationAssignment`: `split` (HTTP 200, `segments` or `null` if the body is unreadable — still a success), `not-sent`, `rejected` (4xx, same categories, the store's 403 title matched exactly), `unknown` (network, timeout, abort after send, 5xx). Never retried. A known success stays a success even if the body or the following board read fails; the board re-read decides what is drawn — the UI never paints successor bars itself. A store 403 for a role without `crossRoomType` is described as needing a Manager, not as "confirm and retry".

### 7.5 Reconciling an unknown outcome

Tracked target: `{ operation: "split-move", reservationUnitId, segmentId, expectedVersion, sourcePhysicalRoomId, physicalRoomId (destination), startDate, endDate (source range), splitDate }`.

Because the board returns only assignments overlapping its window (§2), what a board can prove depends on its window `[from, to)`:

- **Can evaluate at all**: same Property and the window overlaps `[start, end)`. Then an Effective source would be in the response if it still existed.
- **Can observe the result**: additionally `from < splitDate < to` — the window contains nights `splitDate−1` and `splitDate`, so both successors would be returned.

Verdict, in order:

1. `observed` — the window straddles `splitDate` and the Unit has both an assignment in the source room exactly `[start, splitDate)` and one in the destination exactly `[splitDate, end)`.
2. `unresolved` — the source segment is present with the same id, version, room and range.
3. `changed` — otherwise. The source is gone or different, so this request's `expectedVersion` can never commit later; the locks can be released. It does **not** say the request succeeded.

`boardCanEvaluate` and the "Check again" gate must call the same function (the CP04C.3-C2 rule). Examples: a window covering only the prefix nights with the source gone → `changed`, never `observed`; the same window with the source intact → `unresolved`; a window ending before `start` → no verdict. Seeing one successor, or the source missing, never proves completion.

`observed` means "the authoritative schedule matches what was asked", which another operator could also have produced. Proof that **this** request committed exists only for a `200` response; its body's successor ids then also appear in later board reads.

### 7.6 Locks while unresolved

`roomsTouchedBy` becomes room-and-range pairs: source room over `[start, end)` (if the request did not commit, the source still holds every night), destination over `[splitDate, end)`. Plus a per-segment lock on `segmentId` for move/unassign/split-move and the per-Unit lock on `[start, end)`. Locks apply on every board of the Property, whatever its window.

### 7.7 Tab storage

*Recommended*: keep `FORMAT_VERSION = 1` and add `"split-move"` as a new `target.operation` with the fields above (`splitDate` validated as ISO and strictly inside `[start, end)`). Existing v1 records keep reading unchanged. Bumping the version would make the new build treat every existing v1 record as unreadable and lose its locks. An older build reading a `split-move` record fails closed: an unknown pending intent makes `beginPendingWrite` refuse all writes, and an unknown outcome record shows the existing "could not be restored" warning. No storage code changes in CP00.

## 8. Decisions for Owner (D1, D2, D3 and D5 APPROVED 2026-10-10; D4 and D6 OPEN)

| # | Question | Recommendation | Impact | Alternatives |
|---|---|---|---|---|
| D1 | Source already cross-type (`R ≠ S`): who may keep it on the prefix? | **APPROVED 2026-10-10.** Manager only, with confirmation and reason, exactly as the CURRENT store requires; the prefix `Created` row carries Manager evidence; the old assignment's evidence is never inherited. CP01 proves the store half (fresh evidence and reason per crossing successor, prefix included); the Manager permission at the HTTP boundary is CP02. | No store/audit change; FrontDesk must ask a Manager for these stays. | (a) Allow FrontDesk by copying/inheriting the source's authorization — changes CP04A "evidence only describes this row's authorization" and the store; (b) forbid split-move of cross-type sources for everyone. |
| D2 | Destination equal to the source room? | **APPROVED 2026-10-10.** Reject with 400; the UI never offers it. | Prevents a no-op that churns segment ids, versions and audit. | Allow it as a "split in place" (no user value identified). |
| D3 | Reason mandatory? | **APPROVED 2026-10-10.** Optional when both successors are the sold RoomType; required (with confirmation) when the prefix or the suffix crosses — the store rule. Trimmed as in `move`; blank becomes absent. | Parity with `move`; no new boundary rule. | Always required — better operational record, differs from `move`, needs a new boundary rule. |
| D4 | Split date before the Property's `localToday`? | CURRENT has **no** today rule for any assignment mutation; keep none on the server. UI warns when `splitDate < localToday` and asks for an extra acknowledgement. | Allows night-audit corrections ("the guest moved yesterday"); rewriting past nights stays a deliberate act. | (a) Server rejects `splitDate < localToday` — new business rule, blocks corrections; (b) no UI warning. |
| D5 | Route, response, `LocalGate` | **APPROVED 2026-10-10.** §4.1–4.5: `POST …/{segmentId}/split-move`, `200` with `[source, prefix, suffix]`, Staff-authorized by default and `LocalGate` supported through the same attribute. Implemented by `PMS-CAL-002-CP02`. | Same conventions as `move`/`unassign`. | `201`; returning successors only; Staff-only (would need a new attribute variant). |
| D6 | Check-in state, past nights already consumed, repricing | No rule proposed: CURRENT has no stay lifecycle (check-in is mock-only), and pricing never changes by invariant. | Split-move is allowed for any Effective segment. | Couple to a lifecycle work item once it exists. |

## 9. Implementation roadmap (each a Draft PR; none started)

Size target 100–400 changed lines including tests and docs (`docs/governance/WORKFLOW.md` §6). Estimates are CP00 estimates.

| CP | User-visible after merge | Allowlist | Forbidden | Tests / evidence | Est. lines |
|---|---|---|---|---|---|
| **CP01** Store command (needs D1, D2) | Nothing; no route. | `AssignmentMutations.cs`, `AssignmentMutationStore.cs`, `AssignmentMutationStoreTests.cs` | Controller, schema, migrations, `SupersedeAsync` body, frontend | PostgreSQL 17: positive 101→102 (3 segments, audit group, commercial snapshot unchanged); cross-type suffix (Manager evidence on suffix only); cross-type source kept on prefix (evidence on prefix); split date at start/end/outside → 400 with no write; D2 → 400; not found; stale version; destination overlap; capacity reject; inactive destination — each asserting source row, `xmin`, audit and commercial rows unchanged | ~300 |
| **CP02** HTTP route + Staff/audit (needs D3, D5) | Route exists; no UI. | Controller, API/Staff integration tests, pin test, OpenAPI test, ADR 0006 amendment | Store logic, schema, frontend | Status matrix of §4.5 over HTTP; Staff: FrontDesk same-type 200, FrontDesk with `R ≠ S` 403 and no write, Manager cross-type 200 with `staff-rbac` evidence; non-member 403, no session 401, Origin 403, 415; `LocalGate` parity; body cannot inject actor/evidence/ranges | ~400 |
| **CP03** Admin_Web client, target, reconciliation, storage (needs D4 for the today flag) | Nothing visible. | `client.ts`, `types.ts`, new `splitMoveTarget.ts`, `reconciliation.ts`, `uncertainWriteStorage.ts`, their tests | Dialog, board wiring, backend | Unit tests: outcome mapping per status; target exactness/stale; clipped-window matrix of §7.5; room-range locks; storage round-trip, old v1 records, damaged `split-move` record fails closed | ~480 (over target: the window matrix and storage invariants are the safety case; can be split into client+target and reconciliation+storage if Owner prefers six checkpoints) |
| **CP04** Dialog (not mounted) | Nothing visible. | New `ReservationSplitMoveDialog.tsx` + test | Board wiring, backend | Unit tests: date bounds, summary, role-aware destination list, confirmation rule `(R ≠ S) ‖ (D ≠ S)`, FrontDesk disabled state, double-submit, non-closable in flight, outcome texts | ~450 (over target: dialog plus accessibility/focus tests, same pattern as the move dialog) |
| **CP05** Board wiring + acceptance | Staff can split-move from the board. | `ReservationBoard.tsx`, popover, board tests, SNAPSHOT/BIBLE, completion report | Backend, storage format | Board tests for guards and re-read; **browser acceptance** in Chrome on a separate PostgreSQL 17 in `Staff` mode: FrontDesk same-type split, Manager cross-type split, conflict, offline/abort → unknown → locks → `observed`/`changed`, reload keeps locks, logout/sign-in keeps records | ~350 |

**CP01 status (2026-10-10):** implemented as an internal store command and **merged** (PR #97, merge `81acab8`): `SplitMoveAssignmentCommand`, `IAssignmentMutationStore.SplitMoveAsync`; `SupersedeAsync` unchanged; no route, no schema, no UI. Beyond the allowlist above, the one test spy that implements the interface (`CountingAssignmentStore` in `StaffCalendarWriteAuthorizationTests.cs`) gained the new member (OC amendment A1). Evidence: `docs/reports/PMS-CAL-002-CP01-completion.md`.

**CP02 status (2026-10-10):** implemented in a Draft PR as written in §4: one `split-move` action on `AdminReservationAssignmentsController`, a five-field request class, a single `SplitMoveAsync` call and the existing `MapSupersedeResult`; no store, auth, schema or Admin_Web change. The existing exact-action pin, the OpenAPI operation matrix and the mutation-route registry gained this one route and still list the five older writes. Evidence: `docs/reports/PMS-CAL-002-CP02-completion.md`. D4 and D6 remain OPEN; CP03–CP05 have not started.

Each checkpoint stops writing and hands over with `READY_FOR_CODEX_REVIEW` and the prompt's review command; CI Backend/Admin/Frontend green on the exact final head; Production untouched.

## 10. Rejected alternatives

- Client sends a replacement list or both ranges — lets the browser define the partition; the server already owns the range.
- Reusing `move` with a shorter range — `move` is pinned to the full range by design and its reconciliation assumes destination range = source range.
- Controller pre-reads the source — needs a new read port in the API layer; the store already owns the read and the transaction.
- Idempotency key or request table — schema and contract work outside this milestone; the lock-and-reconcile client model already prevents blind duplicates in one tab.
- Optimistic successor bars after `200` — the board re-read is the only display authority.
- New storage format version — loses existing locks on upgrade (§7.7).

## 11. Risks

- Treating this proposal as CURRENT or as Owner-approved before D1–D6 are decided.
- A window that does not straddle `splitDate` can only ever yield `changed`; tests must pin that it never yields `observed`.
- Cross-tab and cross-device duplicates remain possible (no server idempotency), as for every existing write.
- `reconciliation.ts` (`:152-169`) says a board returns a Unit's assignments "complete"; it returns them un-clipped **but only when they overlap the window** (§2). Correct for `move`, wrong to rely on for split-move; CP03 should correct that comment.
