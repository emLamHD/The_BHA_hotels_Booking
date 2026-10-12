# PMS-CAL-003 — operational-block move (design and roadmap)

> Status 2026-10-12: `PMS-CAL-003-CP01` (backend) implemented in a Draft PR on baseline `c7041c17ef619ecac90d2d2f1ed7869b9eb21b0b`; CP02 and CP03 are **not started**. Block split/resize/batch/swap, check-in/check-out, folio and the template mocks are out of scope. This document records the contract CP01 implements; current state is tracked in `docs/project/PROJECT_BIBLE.md` and `docs/project/SNAPSHOT.md`.

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
| **CP01** | Store adapter, HTTP route, tests, docs (this document). | implemented in a Draft PR |
| **CP02** | Admin_Web client function, request/outcome types, reconciliation target and tab-storage record for a block move (the lock rules of create/cancel apply: one request, never retried, the source's room and nights stay locked while unknown). | not started |
| **CP03** | Dialog, board/popover action, locks, browser acceptance on an isolated PostgreSQL in `Staff` mode. | not started |

Not planned here: block split, resize, batch or swap; moving a block to another Property; any change to the shared supersession engine.

## 4. Risks

- A move into another RoomType changes that type's usable capacity; the engine checks final capacity, so it can be a `409` even when the destination room is free. The UI (CP03) must say so honestly.
- The 366-night bound is a resource bound, not a business rule; a longer block can be cancelled or re-created as consecutive blocks but not moved in one request.
- Concurrent moves are decided by the engine (one winner, others `409`); the HTTP layer adds no second lock.
