# PMS-BE-001.2 — Physical Room Schedule & Availability Authority — Completion Report

```text
STATUS: PASS — CLOSED

WORK_ITEM: PMS-BE-001.2
TITLE: Physical Room Schedule & Availability Authority
BASELINE_SHA: 298b7fd53c47824550e955b98c2bed370b38a646
FEATURE_BRANCH: feature/pms-be-001-2-physical-room-schedule-availability
START_HEAD: f58aa1e38344f85e6539f419d4c07454347b9d60
PR: https://github.com/emLamHD/The_BHA_hotels_Booking/pull/37 (MERGED)
FEATURE_HEAD: 4b2de0ab50fa1703f0b125a043d2461cc0309417
MERGE_COMMIT: 0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442
MERGED_AT: 2026-08-26T10:33:13Z
BASE_BRANCH: develop
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

Reproduced against real PostgreSQL 17 (`thebha_dev`), most recently after
Correction C2:

- `dotnet build --configuration Release`: 0 warnings, 0 errors.
- Filtered `PhysicalRoomScheduleAvailabilityAuthorityMigrationTests`: 5/5
  PASS (clean 7→8 apply with catalog-data preservation, empty-state 8→7
  downgrade, guarded non-empty downgrade rejection preserving data, 7
  reapplied after a safe downgrade) — rerun after C2 changed migration 8.
- Full suite: **244/244** unit tests, **326/326** PostgreSQL integration
  tests — all PASS.
- Concurrency-sensitive subset (`FullyQualifiedName~Concurrent`, 10 tests:
  assignment-vs-Hold-creation, assignment-vs-cancellation, block-vs-Hold-
  creation cannot oversell/deadlock): re-run 3× consecutively, 10/10 PASS
  every run, no flakiness observed.
- `dotnet ef migrations has-pending-model-changes`: clean.
- `git diff --check origin/develop...HEAD`: clean.
- Migrations 1–7 confirmed byte-identical to `origin/develop`; no
  migration 9 exists; migration 8 not renamed.

New test coverage by phase: 7 `AdvisoryLockPlanTests` (Phase 1); 14
`RoomOccupancySegmentInvariantTests`, 5 migration tests (Phase 2); 8
`AssignmentAwareAvailabilityTests`, 1 `AvailabilitySearchTests` case
(Phase 3); 21 `AssignmentMutationStoreTests`, 5
`OperationalBlockMutationStoreTests` covering the full mandatory 29-item
Phase 4 matrix (Phase 4); 7 active-Hold-capacity regression tests across
`AssignmentMutationStoreTests`/`OperationalBlockMutationStoreTests` (§11,
`PMS-BE-001.2-C1`); 2 `ReservationUnitNight` ownership-immutability tests
in `RoomOccupancySegmentInvariantTests` (§11, `PMS-BE-001.2-C2`).

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

Passed on the merged head (Backend/Frontend/Admin all `success`, run
`32957454881`) — see §9 for full evidence.

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
- `PMS-BE-001.2-C2` edited `thebha_check_booked_night_coverage()` in place
  within this same migration, while the feature branch was still unmerged
  (no rename, no migration 9): the function now rejects any `UPDATE` on
  `ReservationUnitNights` that
  changes `ReservationUnitId`, before its existing coverage check runs.

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

## 9. Push, Draft PR, merge, and GitHub CI

Feature branch pushed to `origin`; one Draft PR opened against `develop`
([`#37`](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/37)) and
carried through Corrections C1 and C2 (§11), each with its own passing
Backend/Frontend/Admin GitHub Actions run on that head. Owner merged PR #37
into `develop`:

- `gh pr view 37`: `state=MERGED`, `headRefOid=4b2de0ab50fa1703f0b125a043d2461cc0309417`,
  `mergeCommit=0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`,
  `mergedAt=2026-08-26T10:33:13Z`.
- `gh run view 32957454881`: `conclusion=success` — Backend, Frontend, and
  Admin all `success` on the exact merged head.
- Remote feature branch `feature/pms-be-001-2-physical-room-schedule-availability`
  confirmed deleted (`git ls-remote --heads origin ...` empty) — Owner
  branch cleanup, not performed by Claude.

Claude did not mark the PR Ready, did not merge, and did not delete any
branch — all Ready/merge/cleanup actions above were Owner-only.

## 10. Known risks

- The very first intermediate Codex review in this work item's history
  covered only Phases 1–3, read-only, foreground (a disclosed,
  `NON_BLOCKING` process deviation from the selected background mode; no
  product impact). It was superseded by the full-diff reviews recorded in
  §11 and does not affect the final merged state.
- `Front_End/Admin_Web`'s first local build attempt during Phase 5 failed
  on a Google Fonts timeout — an environment/network characteristic of the
  execution sandbox, not a defect; a clean retry succeeded, and GitHub
  Actions' own Admin job passed on every pushed head. If GitHub Actions'
  network egress to `fonts.gstatic.com` is ever unavailable in the future,
  the same transient failure could recur in CI and would need a retry, not
  a code change.
- No independent HTTP/Admin caller exercises the physical-room schedule
  authority yet (§8) — the stricter capacity/immutability checks added by
  Corrections C1/C2 have not been exercised outside this work item's own
  tests and will need real coverage once `PMS-CAL-001.1` or another
  work item integrates against them.

## 11. Corrections (post-checkpoint, pre-merge)

- **`PMS-BE-001.2-C1`** (Codex `[P1]`): `RoomOccupancySegmentMutationSupport.ValidateFinalCapacityAsync`
  omitted active/unexpired `InventoryHold` demand from final-capacity
  validation. Fixed via a shared `PhysicalCapacityDataLoader.LoadActiveHoldDemandAsync`
  query (also adopted by `AvailabilityDataSource`/`BookingHoldCreationStore`,
  removing their prior duplication); one `TimeProvider` UTC instant now
  governs each mutation's whole evaluation. 7 new regression tests. Also
  consolidated Phase 5 documentation to its ownership boundaries and made
  the PMS-DATA-001 blueprint's per-item `TARGET`/`CURRENT` labels accurate
  instead of carrying a self-referential "may be inaccurate" disclaimer.
- **`PMS-BE-001.2-C2`** (Codex `[P2]`): migration 8's booked-night coverage
  trigger validated only the *new* `ReservationUnit` on an `UPDATE` that
  moves a `ReservationUnitNight` to a different Unit, so the *old* Unit's
  now-uncovered `Effective` assignment escaped the check.
  `ReservationUnitNight.ReservationUnitId` is immutable commercial evidence
  (it participates in the row's primary key; the domain exposes no
  ownership mutator); the trigger now rejects any such transfer outright,
  edited in place in migration 8 while the feature branch was still
  unmerged, rather than validating both Units. 2 new regression tests; full
  migration matrix and test suite re-run.

Final full-diff Codex review, run after Correction C2, over the complete
`origin/develop...HEAD` diff: PASS — Owner/OC-confirmed; not independently
re-derivable from GitHub because review results are relayed through the
Owner/OC workflow rather than posted as PR comments. No further correction
was required before merge.

## 12. Governance note

`STATUS: PASS — CLOSED`. PR #37 is merged into `develop` (merge commit
`0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`, `2026-08-26T10:33:13Z`);
Backend/Frontend/Admin GitHub Actions passed on the merged head; the
remote feature branch is deleted. Claude did not invoke Codex, did not
merge, did not mark any PR Ready, and did not perform branch cleanup — all
of those actions were Owner-only, consistent with the fixed invariant
`Claude writes. Codex reviews. OC decides. Owner merges.` This closure does
not itself authorize implementation of any next product work item; see
`docs/project/SNAPSHOT.md` §2 for the current decision on `PMS-CAL-001.1`.
