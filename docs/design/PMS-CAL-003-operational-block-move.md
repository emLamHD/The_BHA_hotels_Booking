# PMS-CAL-003 — operational-block move (design and roadmap)

> Status 2026-10-12: `PMS-CAL-003-CP01` (backend) is **merged** (PR #103, merge `1a09e656af128a6df93875bb5ae12de8f70ce435`). `PMS-CAL-003-CP02` (Admin_Web foundation, §5) is implemented in a Draft PR on that baseline; CP03 is **not started**. Block split/resize/batch/swap, check-in/check-out, folio and the template mocks are out of scope. This document records the contract CP01 implements; current state is tracked in `docs/project/PROJECT_BIBLE.md` and `docs/project/SNAPSHOT.md`.

## 1. Why

Operators close a room (an `OperationalBlock`) and later need the closure to follow the work to another room without lifting and re-creating it: the header, the reason, the creator and the nights must survive, and the audit must show one move. `BlockSegmentSupersession` already defines a single replacement as a move, and `SupersedeSegmentsAsync` already owns the transaction, the version check, the capacity and overlap rules, the advisory locks, header preservation and the audit. CP01 adds only a narrow adapter and a narrow HTTP exposure of that authority.

## 2. Contract implemented by CP01

**Application / store.** `MoveOperationalBlockCommand(PropertyId, SegmentId, ExpectedVersion, DestinationPhysicalRoomId, ActorReference, Reason?)` and `IOperationalBlockMutationStore.MoveAsync` (no default interface body). The adapter:

1. refuses a blank actor and a reason over `SchedulingFieldLimits.Reason` (500, after trimming) as `Invalid`, before any read or lock;
2. pre-reads, `AsNoTracking`, the segment by exact `Id` + `PropertyId` + `Type = OperationalBlock` for its room and full dates. Missing, another Property's, or an assignment segment → `NotFound`;
3. destination equal to the source room → `Invalid` (no no-op successor);
4. a source longer than **366 nights** → `Invalid`, decided from two `DateOnly` day numbers before the engine enumerates anything (the same resource bound as the HTTP block-create budget; the internal supersession keeps supporting longer segments, they can still be cancelled);
5. delegates **one** supersession with **one** replacement — the destination room over `source.StartDate…source.EndDate` — with the caller's `ExpectedVersion` to the unchanged `SupersedeSegmentsAsync`.

The pre-read decides nothing about versions or availability and is not a concurrency gate: status, version, destination existence/Property/Active, overlap and final capacity (a different RoomType included) are re-checked by the engine under its locks. `CreateBlockAsync`, `SupersedeSegmentsAsync`, the delta helpers and the shared engine were not edited.

**HTTP.** `POST /api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/move`, body `{ "expectedVersion": uint, "destinationPhysicalRoomId": Guid, "reason"?: string }` (the first two `[JsonRequired]`; reason trimmed, blank → none). No actor, evidence, source dates, header or replacements can be supplied; unknown JSON properties are ignored.

| Status | When |
|---|---|
| 200 | `[source (Cancelled), successor (Effective)]`, `RoomOccupancySegmentDto` with committed versions |
| 400 | missing/malformed field, same room, reason over 500, block longer than 366 nights (also: a body the formatter cannot read) |
| 401 / 403 | Staff boundary (session, Property membership, `BlockWrite`) |
| 404 | segment missing / other Property / not a block; destination missing or in another Property; closed `LocalGate` |
| 409 | stale or zero version; source not Effective; destination not Active; overlap or final-capacity failure |
| 415 | gate-owned media-type refusal |

Only `Succeeded` is a success shape; any other (including an unknown) status is a refusal. No retry, idempotency key, exactly-once claim or read-by-id route: a caller that loses the response re-reads the board.

**Permissions and audit.** The action carries `StaffCalendarPermission(BlockWrite, typeof(AdminCalendarWriteGateFilter))` and the same CORS / `IgnoreAntiforgery` composition as create and cancel (no `[Consumes]`, which would change the gate's order). FrontDesk and Manager with `BlockWrite` at the right Property may both move, across RoomTypes too: a block has no sold RoomType, so there is no `AssignmentCrossRoomType`, no confirmation field and no authorization evidence (always `null`). The actor is the verified Staff context (`staff:{id}`) or, in `LocalGate`, the local constant — never a fallback in Staff mode. The two new audit rows (`Cancelled`, `Created`) share one `MutationGroupId`; the optional reason goes only into them. The `RoomBlock` header (id, reason, creator, creation time), siblings and earlier audit rows are untouched; booking, Unit, nightly price, commitment and demand are not touched.

**OpenAPI.** `AdminOperationalBlockOpenApiOperationFilter` publishes `application/json` only for the move as for create/cancel; the registry of Admin mutation routes gains exactly this route. No permission mapping or URL whitelist changed.

## 3. Roadmap

| CP | Scope | State |
|---|---|---|
| **CP01** | Store adapter, HTTP route, tests, docs (this document). | merged (PR #103) |
| **CP02** | Admin_Web client function, request/outcome types, reconciliation target and tab-storage record for a block move (the lock rules of create/cancel apply: one request, never retried, the source's room and nights stay locked while unknown). No action, dialog or send handler. | implemented in a Draft PR (§5) |
| **CP03** | Dialog, board/popover action, locks, browser acceptance on an isolated PostgreSQL in `Staff` mode. | not started |

Not planned here: block split, resize, batch or swap; moving a block to another Property; any change to the shared supersession engine.

## 4. Risks

- A move into another RoomType changes that type's usable capacity; the engine checks final capacity, so it can be a `409` even when the destination room is free. The UI (CP03) must say so honestly.
- The 366-night bound is a resource bound, not a business rule; a longer block can be cancelled or re-created as consecutive blocks but not moved in one request.
- Concurrent moves are decided by the engine (one winner, others `409`); the HTTP layer adds no second lock.

## 5. CP02 status — Admin_Web foundation (2026-10-12)

Admin_Web only; no backend, schema, dialog, popover, toolbar, `StaffSession` or `dateMath.ts` change, and **no action, dialog or send path** — `ReservationBoard.tsx` neither imports nor calls the new client (a test pins it). What exists:

- **Client** (`client.ts`, `types.ts`): `MoveOperationalBlockRequest` and `moveOperationalBlock(propertyId, segmentId, request, options?)`, outcome `OperationalBlockMoveOutcome` = `moved{segments|null}` / `not-sent` / `rejected` / `unknown`. One fetch, never retried; the body is built field by field (`expectedVersion`, `destinationPhysicalRoomId`, optional `reason`) so no actor, evidence, dates, header, replacements or confirmation can ride along; Staff credentials `include`, LocalGate `omit`; every `200` is a known move, whatever the body; `401` carries the session-ended marker; `403`/`404` are detail-free `not-permitted`; `409` `conflict`; other `4xx` `refused`; `5xx`, unexpected non-4xx statuses, network, timeout and abort-after-send are `unknown`; invalid config/mode or a signal aborted before the call is `not-sent` with zero fetches. No cross-RoomType branch.
- **Exact target** (`blockMoveTarget.ts`, pure): `buildBlockMoveTarget` requires the selected Property and exactly one board block matching `roomBlockId`, `segmentId`, `segmentVersion`, room and own start/end; a `uint` version; real Gregorian dates 0001–9999 (via the existing `gregorianDayNumber`) spanning 1…366 nights; and the source room on the board (it may be inactive). It carries the full source range and header, and the Active rooms other than the source as facts — never as a free-ness or capacity claim.
- **Reconciliation** (`blockCreateReconciliation.ts`): `BlockMoveReconciliationTarget` joins `BlockWriteTarget`; `resolution` gains `changed`, produced only by a move. On a loaded board of the same Property whose window overlaps the source's nights, read after the write: **observed** only when the source segment is no longer shown and a different segment of the same header holds exactly the source's nights in the destination; **unresolved** while the source is shown exactly as it was (id, version, header, room, range) — a look-alike in the destination does not change that; otherwise **changed**, which says nothing about whether the request succeeded or failed. Another Property, a non-overlapping window, an old sequence or a failed read resolve nothing; `status` (re-read) and `resolution` stay separate. Create and cancel keep their two-valued rule.
- **Locks**: an unresolved move locks the source **and** the destination room over the source's full range, from every view of the Property (`blockRoomsTouchedBy` feeds `isRoomRangeUnresolved`; half-open adjacency and other rooms/Properties unaffected). `isBlockSegmentWriteUnresolved` is the segment-id predicate for cancel and move of one block segment; CP03 wires its send-time callers.
- **Storage** (`uncertainWriteStorage.ts`): the v1 format, both v1 keys and the token/handoff algorithm are unchanged; a move is one more entry in `blocks`. It serializes header, source and destination ids and room numbers, the version and the full range — never a reason, actor, evidence, guest/contact or session data. The parser is strict (mandatory text fields, two different rooms, a true integer `uint` version, real Gregorian dates, 1…366 nights); an unknown operation or a damaged pending entry is unreadable, refuses a new pending write and is never overwritten. Literal v1 text written before CP02 is read exactly as before. That proves only that the *current* parser reads old records: `OLD_BUILD_DOWNGRADE_RUNTIME` is **NOT_VERIFIED** (no baseline parser was run).
- **Board** (allowance only): the inline `UncertainBlockNotice` words a restored move as a move between two rooms (observed = a fact of the schedule, not proof of cause; changed = not saved), resolved notices dismiss without touching any other record or lock, and the two block dialogs ignore the move-only `changed` value.

CP03 will add the dialog, the popover action, the send handler (calling the lock predicates at send time) and the real-browser acceptance. Evidence: `docs/reports/PMS-CAL-003-CP02-completion.md`.
