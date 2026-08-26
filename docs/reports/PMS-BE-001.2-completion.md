# PMS-BE-001.2 — Physical Room Schedule & Availability Authority — Completion Report

```text
STATUS: PASS — IMPLEMENTATION_COMPLETE_AWAITING_CODEX_REVIEW

WORK_ITEM: PMS-BE-001.2
TITLE: Physical Room Schedule & Availability Authority
BASELINE_SHA: 298b7fd53c47824550e955b98c2bed370b38a646
FEATURE_BRANCH: feature/pms-be-001-2-physical-room-schedule-availability
START_HEAD: f58aa1e38344f85e6539f419d4c07454347b9d60
FINAL_HEAD: (recorded after the documentation/finalization commit — see push/PR record below)
BASE_BRANCH: develop
DRAFT_PR: (recorded once opened — see push/PR record below)
```

## 1. What was delivered

Introduced `RoomOccupancySegment`/`RoomBlock` (ADR 0006, migration 8,
`PhysicalRoomScheduleAvailabilityAuthority`) as the sole PhysicalRoom
schedule authority — no separate `RoomAssignments` dual-write model exists
alongside it — plus the assignment-aware, block-adjusted availability
formula and an internal-only assignment/OperationalBlock mutation
boundary, across five internal phases on one feature branch:

1. **Phase 1** — a shared, deterministic `AdvisoryLockCoordinator` used by
   every advisory-lock-taking writer in the codebase (existing and new):
   fixed class order — (1) operation-specific idempotency/transition lock,
   (2) `ReservationUnit` locks, (3) `RoomType` inventory-scope locks, (4)
   daily `(RoomType, StayDate)` inventory locks — each deduplicated and
   sorted before acquisition inside one explicit transaction.
2. **Phase 2** — the `RoomOccupancySegment`/`RoomBlock`/
   `RoomOccupancySegmentAudit` schema and migration 8.
3. **Phase 3** — the block-adjusted, assignment-attributed availability
   formula and atomic whole-Reservation-cancellation assignment cleanup.
4. **Phase 4** — safe internal assignment and OperationalBlock mutation
   commands.
5. **Phase 5** — this documentation/verification/Draft-PR checkpoint.

No HTTP controller, no Admin/Calendar endpoint, no Staff identity, and no
Admin authentication/RBAC model are introduced by any phase — this work
item is entirely an internal application/persistence authority. The public
`/api/v1` contract is unchanged.

## 2. Database authority (ADR 0006, migration 8)

- `RoomOccupancySegment` types are exactly `ReservationAssignment` and
  `OperationalBlock`; statuses are exactly `Effective` and `Cancelled`.
- Exactly two PostgreSQL exclusion constraints (`btree_gist`-backed):
  `EX_RoomOccupancySegments_EffectiveRoomOverlap` (no two `Effective`
  segments may occupy the same `PhysicalRoom` on overlapping dates) and
  `EX_RoomOccupancySegments_EffectiveUnitOverlap` (no `ReservationUnit` may
  have two overlapping `Effective ReservationAssignment` segments).
- Two `DEFERRABLE INITIALLY DEFERRED` constraint triggers, checked at
  `COMMIT` rather than per-statement so a single transaction may pass
  through a transient intermediate state (a batch move/swap) as long as the
  final committed state is valid: booked-night coverage
  (`thebha_check_booked_night_coverage`, `SQLSTATE XBHA1` — an `Effective
  ReservationAssignment`'s date range must be covered by its
  `ReservationUnit`'s actual sold nights) and unit-commitment consistency
  (`thebha_check_unit_commitment_consistency`, `SQLSTATE XBHA2` — an
  `Effective ReservationAssignment` may reference only a `Committed` Unit).
- Same-Property consistency is enforced through composite
  `(PropertyId, Id)` alternate-key foreign keys (added to `PhysicalRoom` by
  this migration), not application-level checks alone.
- Rows use `xmin`-based optimistic concurrency (EF Core `IsRowVersion()` on
  a shadow `uint`). Every mutation writes an append-only
  `RoomOccupancySegmentAudit` row grouped by `MutationGroupId` — audits
  have no mutators and are never updated or deleted through normal
  persistence.
- `Down()` is guarded: it succeeds only while `RoomOccupancySegments`,
  `RoomBlocks`, and `RoomOccupancySegmentAudits` are all empty, and fails
  atomically before dropping any data otherwise.

## 3. Availability authority

`Application/Properties/PhysicalCapacityFormula.cs` extends ADR 0004's
formula:

```text
UsablePhysicalCapacity = max(0, BaseInventory - OperationalBlockedRooms)
ControlledCapacity      = IsStopSell ? 0 : min(UsablePhysicalCapacity, SellableLimit ?? UsablePhysicalCapacity)
AvailableToSell         = max(0, ControlledCapacity - OperationalCapacityDemand)
```

Nightly demand is attributed to exactly one RoomType bucket: the sold
RoomType if a `ReservationUnit` night has no `Effective` assignment, or the
actually-assigned `PhysicalRoom`'s RoomType if one does — never both, so a
cross-RoomType assignment shifts attribution rather than double-counting.
Assignment *mutation* is validated against raw `UsablePhysicalCapacity`
only, never against `ControlledCapacity`/`SellableLimit`/`IsStopSell` —
those govern acceptance of *new* commercial demand, not where
already-committed demand physically sits. Whole-Reservation cancellation
(`IReservationCancellationStore`) atomically cancels any still-`Effective`
assignment segments of the cancelled Units in the same transaction,
writing audit evidence tagged `system:reservation-cancellation`.

## 4. Internal mutation boundary

`IAssignmentMutationStore` and `IOperationalBlockMutationStore`
(`Infrastructure/Persistence/AssignmentMutationStore.cs`,
`OperationalBlockMutationStore.cs`) are internal application/persistence
services only:

- Every mutation requires a non-empty `ActorReference`. Cross-RoomType
  assignment additionally requires `AuthorizationEvidence` and `Reason` —
  an opaque authorization string recorded verbatim into the audit trail,
  not a real permission check; no Staff identity or Admin RBAC model
  exists.
- Assignment operations: create (same- or cross-RoomType), split,
  move/reassign, atomic batch move/swap, unassign/cancel.
- OperationalBlock operations: multi-room creation, split, move, cancel.
- Batch supersession (move/swap) performs **one combined final-state
  capacity evaluation** across every segment in the batch — never
  sequential per-operation validation — using the fixed fixed-class lock
  order from `AdvisoryLockCoordinator`.
- `RoomOccupancySegmentMutationSupport.TryCommitAsync` maps `23P01`
  exclusion violations by the two exact approved constraint names, and
  `XBHA1`/`XBHA2`/foreign-key violations by exact SQLSTATE, to safe
  `SegmentMutationResult` messages — no raw PostgreSQL/Npgsql error text is
  ever exposed to a caller. Both `DbUpdateException`-wrapped and raw
  `PostgresException` (surfaced at `COMMIT` due to the deferred
  constraints) are caught.
- A rejected mutation leaves no partial state — the whole transaction
  rolls back, and prior `Effective` segments are unchanged.

## 5. Public API compatibility

Unchanged. No `TheBha.Api` controller, route, or DTO was added, removed, or
modified by this work item; `git diff origin/develop...HEAD` contains no
file under `Back_End/src/TheBha.Api`.

## 6. Test evidence

Reproduced in this Phase 5 session against real PostgreSQL 17
(`thebha_dev`):

- `dotnet build --configuration Release`: 0 warnings, 0 errors.
- Filtered `PhysicalRoomScheduleAvailabilityAuthorityMigrationTests`: 5/5
  PASS (clean 7→8 apply with catalog-data preservation, empty-state 8→7
  downgrade, guarded non-empty downgrade rejection preserving data, 7
  reapplied after a safe downgrade).
- Full suite: **244/244** unit tests, **317/317** PostgreSQL integration
  tests — all PASS.
- Concurrency-sensitive subset (`FullyQualifiedName~Concurrent`, 10 tests:
  assignment-vs-Hold-creation, assignment-vs-cancellation, block-vs-Hold-
  creation cannot oversell/deadlock): re-run 3× consecutively, 10/10 PASS
  every run, no flakiness observed.
- `dotnet ef migrations has-pending-model-changes`: clean.
- `git diff --check origin/develop...HEAD`: clean.
- Migrations 1–7 confirmed byte-identical to `origin/develop`; no
  migration 9 exists.

New test coverage by phase: 7 `AdvisoryLockPlanTests` (Phase 1); 14
`RoomOccupancySegmentInvariantTests`, 5 migration tests (Phase 2); 8
`AssignmentAwareAvailabilityTests`, 1 `AvailabilitySearchTests` case
(Phase 3); 21 `AssignmentMutationStoreTests`, 5
`OperationalBlockMutationStoreTests` covering the full mandatory 29-item
Phase 4 matrix (Phase 4).

### Frontend CI parity

- `Front_End/Customer_Web`: `npm ci`, `npm run lint` (clean), `npm test`
  (298/298 PASS), `npm run build` (succeeded). No file under
  `Front_End/Customer_Web` is in this branch's diff — this reproduces the
  pre-existing baseline.
- `Front_End/Admin_Web`: `npm ci`, `npm run lint` (clean), `npm run build`
  (succeeded on retry). First attempt failed on a transient
  `fonts.gstatic.com` fetch timeout unrelated to this branch (no
  `Front_End/Admin_Web` file is in this branch's diff); a clean retry after
  `rm -rf .next` succeeded, confirming the environment, not the code,
  caused the first failure. No frontend file was modified to force this
  check to pass.

### GitHub CI

Recorded once available on `FINAL_HEAD` after push (see §9).

## 7. Migration Up/Down evidence

`20260826035254_PhysicalRoomScheduleAvailabilityAuthority`:

- `Up()`: enables `btree_gist`; creates `RoomBlocks`, `RoomOccupancySegments`,
  `RoomOccupancySegmentAudits`; adds the `(PropertyId, Id)` alternate key on
  `PhysicalRooms`; creates the two exclusion constraints and the two
  deferred constraint triggers.
- `Down()`: guarded — succeeds only while all three new tables are empty
  (verified by `PhysicalRoomScheduleAvailabilityAuthorityMigrationTests`),
  drops the exclusion constraints/triggers/tables, then drops the two
  trigger functions last (they must survive until every referencing
  trigger, dropped with its table, is gone) and disables `btree_gist`
  where it was newly enabled by this migration.

## 8. Exclusions / remaining TARGET boundary

Not implemented by this work item:

- Multi-RoomType public Hold/Reservation **request** shape (ADR 0005 item
  1) — still exactly one RoomType/RatePlan per request.
- Any HTTP controller, Admin endpoint, or Calendar/Reservation-Board server
  API exposing `RoomOccupancySegment`/`RoomBlock` or the mutation stores.
- Admin authentication/RBAC and Staff identity — `ActorReference`/
  `AuthorizationEvidence` are opaque strings, not a real permission model.
- Check-in/check-out, full housekeeping/maintenance scheduling beyond the
  `RoomBlock`/`OperationalBlock` boundary already delivered.
- Independent per-Unit cancellation endpoint (only whole-Reservation
  cancellation exists, and it now cleans up assignments as part of this
  work item).
- Payments, deposits, collections, refunds, `FolioEntries`.
- Realtime, OTA inbox/outbox/adapters/providers, `DATA-001.2`.
- `RoomTypeDailyInventory` as a separate materialized projection table
  (the formula is computed on read, as before).
- `Organization`/tenant boundary above `Property`.
- Direct Admin/walk-in/OTA `ReservationUnit` creation without a source
  Hold.

## 9. Push, Draft PR, and GitHub CI

Recorded after the documentation/finalization commit is pushed and the
Draft PR is opened — see the follow-up commit to this report and to
`docs/project/SNAPSHOT.md` for the exact PR URL, `FINAL_HEAD`, and CI
result on that head.

## 10. Known risks

- The intermediate Codex review already run in this conversation covered
  only Phases 1–3, read-only, foreground (a disclosed, `NON_BLOCKING`
  process deviation from the selected background mode; no product impact).
  It is not a substitute for the final full-diff review this handoff
  requests — that review has not yet run over the complete
  `origin/develop...HEAD` diff, including Phase 4 and this Phase 5
  documentation commit.
- `docs/design/PMS-DATA-001-core-database-blueprint-v2.md` §6–§9, §11, §12
  retain their original per-item `TARGET`/`CURRENT` labels from before
  `PMS-BE-001.1`/`PMS-BE-001.2`; this Phase 5 update added status-header and
  section-level implementation-note pointers rather than relabeling every
  individual item, to avoid introducing a transcription error across ~700
  lines under time pressure. ADR 0005/0006 and this report are authoritative
  over that document's per-item labels where they disagree.
- `Front_End/Admin_Web`'s first build attempt failing on a Google Fonts
  timeout (§6) is an environment/network characteristic of the execution
  sandbox, not a defect; if GitHub Actions' network egress to
  `fonts.gstatic.com` is ever unavailable, the same transient failure could
  recur in CI and would need a retry, not a code change.

## 11. Governance note

`STATUS: PASS — IMPLEMENTATION_COMPLETE_AWAITING_CODEX_REVIEW` is not
`PASS — CLOSED`. It is not merged, not production-deployed, not
Owner-accepted, and the final full-diff Codex review has not yet run. Only
Owner may invoke `/codex:review --base origin/develop`; only Owner decides
Ready/merge/branch cleanup. Claude did not invoke Codex, did not merge, did
not mark the Draft PR Ready, and did not start the next work item.
