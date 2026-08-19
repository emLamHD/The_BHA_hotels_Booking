# ADR 0006: Schedule physical rooms with occupancy segments

- **Status:** Accepted target architecture, implementation pending.
- **Date:** 2026-08-19.

This decision is TARGET / APPROVED, not CURRENT / AS-BUILT. The TARGET
occupancy-segment schedule, `RoomBlock`, exclusion constraints, and related
future implementation work described below are not implemented. Existing
CURRENT entities referenced for context, including `PhysicalRoom` and
`Reservation`, are not negated by this statement — they remain implemented
exactly as they are today. This ADR introduces no schema, extension,
migration, test, or product change. See
[PMS-DATA-001-core-database-blueprint-v2](../design/PMS-DATA-001-core-database-blueprint-v2.md)
for full detail and scenario walkthroughs.

## Dependency

This decision depends on [ADR 0003](0003-model-hotel-stays-with-half-open-date-ranges.md)
(half-open date ranges) and
[ADR 0005](0005-separate-commercial-commitment-from-physical-allocation.md)
(separation of commercial commitment from physical allocation). ADR 0005
establishes that a `ReservationUnit`'s existence is the complete record of a
sale; this ADR defines the independent layer that tracks where a guest, or
an operational block, actually occupies a PhysicalRoom.

## Context

The current schema (`BE-003.1`–`BE-003.5`) has no PhysicalRoom-level
schedule at all — a confirmed `Reservation` has no record of which physical
room, if any, a guest will occupy. The Owner-approved PMS blueprint requires
an authoritative physical-room schedule that: supports partial/unassigned
reservations, supports split/move operations without disturbing the
commercial sale, supports multi-room operational blocks (e.g. maintenance),
supports intentional cross-RoomType upgrades/downgrades, and prevents
double-booking a physical room or double-occupying a sold unit at the
PostgreSQL level, not only in application code.

The two exclusion invariants in Decision item 6 prevent segments from
overlapping each other, but neither one, by itself, ties an
`Effective ReservationAssignment` segment's date range back to the
`ReservationUnit`'s actual sold `ReservationUnitNight` dates. Without an
additional rule, a non-overlapping assignment could still be created for
dates the guest never booked — occupying and blocking a PhysicalRoom on
unsold nights while satisfying both exclusion constraints. Decision item 9
closes this gap.

## Decision

1. **`RoomOccupancySegments` are the authoritative PhysicalRoom schedule.**
   No separate `RoomAssignments` dual-write model exists alongside it — one
   table is the one authority for "what occupies this PhysicalRoom, when."
2. **Exact segment types and statuses, no others.** Segment types are
   exactly `ReservationAssignment` and `OperationalBlock`. Segment statuses
   are exactly `Effective` and `Cancelled`, independent of Reservation
   lifecycle or check-in state. No draft enum values such as `Reserved`,
   `InHouse`, `Blocked`, or `Held` are part of this model — those describe
   reservation/arrival/hold/operational business state, not the occupancy-
   segment type/status model itself.
3. **Type/reference consistency invariant.** A `ReservationAssignment`
   segment references a `ReservationUnit` and no `RoomBlock`. An
   `OperationalBlock` segment references a `RoomBlock` header and no
   `ReservationUnit`. A segment's type determines exactly one populated
   reference field; the other is always absent. This invariant must hold at
   the database level in the eventual implementation, not only in
   application code.
4. **Multi-room `RoomBlock` header-to-segment relationship.** One
   `RoomBlock` header relates to one or more `OperationalBlock`-type
   occupancy segments, supporting a single maintenance/operational event
   that spans multiple PhysicalRooms.
5. **Split/move/cancel operations with optimistic concurrency and
   append-only audit.** Segments are operationally mutable through
   controlled actions only. A split or move supersedes existing segment rows
   and creates new ones; it never overwrites a segment's date range in
   place. Optimistic concurrency (a version/row-version check) and an
   append-only audit trail are required so mutation never silently erases
   history.
6. **Two PostgreSQL exclusion invariants, enforced by the database:**
   - **PhysicalRoom schedule exclusion** — two `Effective` occupancy
     segments can never overlap on the same PhysicalRoom, regardless of
     segment type.
   - **ReservationUnit allocation exclusion** — two `Effective`
     `ReservationAssignment` segments can never overlap for the same
     `ReservationUnit`, preventing one sold unit from occupying two rooms
     over the same dates.
   Both use half-open date ranges, consistent with ADR 0003. Application
   prechecks alone are insufficient — PostgreSQL itself must reject an
   overlapping insert/update.
7. **Future EF/Npgsql implementation boundary** (named, not built by this
   ADR):
   - `btree_gist` PostgreSQL extension, required for `EXCLUDE` constraints
     over the composite range/equality keys these invariants need.
   - A raw-SQL migration for the exclusion constraints — EF Core does not
     generate `EXCLUDE` constraints from its fluent/attribute model.
   - PostgreSQL SQLSTATE `23P01` (exclusion violation) mapped, by exact
     constraint name, to safe, specific domain/application errors — never a
     raw database error surfacing to a caller.
   - An explicit transaction with two-`SaveChanges` ordering where
     relationship materialization requires it (e.g. inserting a `RoomBlock`
     header before its dependent segments can reference it), mirroring the
     explicit-transaction discipline already proven in `BE-003.3`–
     `BE-003.5`.
   - Real PostgreSQL integration tests for both exclusion constraints —
     never EF InMemory or SQLite, consistent with `docs/DATABASE.md`'s
     existing testing policy.
   - The booked-night coverage invariant in Decision item 9 is a distinct,
     additional requirement: PostgreSQL has no ordinary cross-table `CHECK`
     assertion capable of expressing it. The future implementation must use
     a database-enforced cross-table mechanism that validates the final
     committed transaction state — such as a deferrable constraint trigger,
     or another separately reviewed design offering equivalent database
     guarantees — evaluated at commit time so it observes both a segment
     write and any concurrent change to the unit's `ReservationUnitNight`
     coverage. An application-only precheck may improve error messages but
     is never sufficient as the sole correctness mechanism under concurrent
     writers. Operations touching assignment coverage or booked-night
     coverage must use one explicit transaction and the same per-unit
     concurrency/locking discipline already established for Hold/Reservation
     mutation, so a concurrent assignment and stay-change command cannot
     jointly commit an invalid combination. Real PostgreSQL integration
     tests are mandatory for this invariant; exact DDL, trigger/constraint
     names, SQLSTATE mapping, EF model, lock key, API, and domain-error
     contract remain implementation details for a separately authorized
     work item and are not invented here.
8. **Intentional cross-RoomType assignment, with guardrails.** Authorized
   front-desk staff may assign a `ReservationUnit` to a PhysicalRoom whose
   RoomType differs from the commercially booked RoomType. This requires
   authorization, a recorded reason, and audit evidence. It never implicitly
   reprices `ReservationUnitNights`, reservation totals, or ADR — the
   commercial RoomType and price stay exactly what was sold; only the
   physical PhysicalRoom reference on the segment changes. Cross-RoomType
   flexibility never grants date flexibility: the assignment's dates must
   still satisfy Decision item 9's booked-night coverage invariant against
   the sold unit's nights. While the commercial record never changes,
   `RoomTypeDailyInventory`'s operational capacity attribution (Decision
   item 10) does follow the assignment to the actual PhysicalRoom's
   RoomType for its covered dates — the assigned-type room becomes
   unsellable and the sold-type capacity is released for that date, so a
   physically occupied room can never also be commercially oversold.
9. **`Effective ReservationAssignment` booked-night coverage invariant.**
   Let `AssignedDates(s) = { d | s.StartDate <= d < s.EndDate }` for a
   segment `s`, and `BookedDates(u) = { n.StayDate | n is a persisted
   ReservationUnitNight for unit u }`. For every `RoomOccupancySegment s`
   where `s.Type == ReservationAssignment`, `s.Status == Effective`, and
   `s.ReservationUnitId == u`: `AssignedDates(s)` must be a subset of
   `BookedDates(u)`. This is an exact nightly-row coverage rule, not a
   comparison against only the minimum and maximum booked dates — existing
   uniqueness/contiguity rules normally make those equivalent, but the
   architecture must reject any segment containing even one date with no
   corresponding `ReservationUnitNight` row.
   - A full assignment may cover all booked nights; a partial assignment
     may cover any proper subset. Full coverage is never required —
     unassigned nights remain valid and visible (§8 item 2 of the
     blueprint).
   - Several `Effective` assignment segments for the same unit may together
     cover different booked-night subsets, subject to the existing
     non-overlap exclusions (Decision item 6); their union must still be a
     subset of `BookedDates(u)`.
   - An assignment beginning before the first booked night or ending after
     checkout is invalid. Half-open `[start, end)` semantics remain in
     force; checkout is never an occupied or priced night.
   - `Cancelled` segments preserve history and are not required to remain
     covered after a later commercial-stay change — only `Effective
     ReservationAssignment` rows participate in this invariant.
     `OperationalBlock` segments are not backed by a `ReservationUnit` and
     are entirely outside this coverage rule; their PhysicalRoom overlap
     protection (Decision item 6) is unaffected.
   - Stay extension must persist the new, explicitly priced, contiguous
     `ReservationUnitNight` rows before or in the same transaction as any
     assignment activation/extension covering those dates — a physical
     assignment may never anticipate a future commercial extension.
   - Any future stay-shortening or commercial-coverage-removal operation
     must cancel, split, or otherwise bring every affected `Effective
     ReservationAssignment` segment back within the remaining booked nights
     in the same transaction; the transaction's committed state must
     satisfy this invariant.
   - If operations need to protect a PhysicalRoom before a commercial night
     is sold, they must use the approved `OperationalBlock` path (Decision
     item 4), never a commercially unsupported `ReservationAssignment`.
   - The Calendar/Reservation Board projection must reflect valid source
     rows; it must never silently clip or normalize an out-of-coverage
     assignment, because doing so would hide corruption in the
     authoritative PhysicalRoom schedule rather than surfacing it.
   - This invariant complements, and is never a substitute for, either
     exclusion invariant in Decision item 6: the PhysicalRoom schedule
     exclusion still separately prevents two `Effective` segments from
     overlapping on one PhysicalRoom, and the ReservationUnit allocation
     exclusion still separately prevents one `ReservationUnit` from
     overlapping across two PhysicalRooms. Booked-night coverage is a third,
     distinct temporal-integrity rule — not a third exclusion constraint —
     that additionally prevents an `Effective ReservationAssignment` from
     occupying dates that were never sold.
10. **`Effective OperationalBlock` sellable-inventory invariant.** An
    `Effective OperationalBlock` segment does not only participate in the
    PhysicalRoom schedule exclusion (Decision item 6) — it also removes its
    referenced PhysicalRoom from `RoomTypeDailyInventory`'s usable physical
    capacity for its RoomType, on every date `[StartDate, EndDate)` it
    covers. The exact daily formula, block-counting rules, and required
    atomic-locking discipline are recorded in
    [PMS-DATA-001-core-database-blueprint-v2](../design/PMS-DATA-001-core-database-blueprint-v2.md)
    §7 — this ADR states the invariant, the blueprint states the arithmetic,
    so the two must never be edited to disagree. In summary:
    - `BaseInventory` (ADR 0004) is reduced by the count of distinct active
      PhysicalRooms carrying an `Effective OperationalBlock` for that date to
      yield usable physical capacity, **before** any `SellableLimit`/
      `IsStopSell` daily control (ADR 0004) is applied to that already-reduced
      capacity, and before operational demand is subtracted. This fixed order
      is required: applying `SellableLimit` to the un-reduced `BaseInventory`
      and only then subtracting blocks (`min(BaseInventory, SellableLimit) -
      blocks`) under-counts relative to the correct
      `min(BaseInventory - blocks, SellableLimit)` — it does not over-offer;
      omitting the block entirely is what over-offers, by continuing to
      count physically unusable rooms as sellable. The selected order is
      correct because a block changes usable physical capacity first and
      `SellableLimit` is then a sales cap on that usable capacity — see the
      blueprint §7 worked example for the exact, non-reversed arithmetic of
      both incorrect alternatives.
    - Each distinct blocked PhysicalRoom is deducted at most once per date,
      regardless of how many `OperationalBlock` segments or which
      multi-room `RoomBlock` header cover it; a PhysicalRoom already
      excluded from `BaseInventory` (`Inactive`/`OutOfService`) is not
      deducted again.
    - `Cancelled` blocks never reduce current or future availability; only
      `Effective` rows participate.
    - Operational demand is attributed to exactly one RoomType bucket per
      committed room-night — never zero, never two. An unassigned Hold or
      Reservation night counts against its sold RoomType. A night covered by
      an `Effective ReservationAssignment` counts instead against the
      assigned PhysicalRoom's actual RoomType and is not also counted
      against the sold RoomType — a same-RoomType assignment therefore
      remains one unit in the same bucket, while a cross-RoomType assignment
      moves the attribution from the sold RoomType's pool to the actual
      RoomType's pool for its covered dates, releasing the sold-type
      capacity and consuming the actual-type capacity, without reclassifying
      the commercial sale (Decision item 8). An `Effective
      ReservationAssignment` is never counted as an `OperationalBlock` for
      this purpose — the two are separate capacity effects that can never
      cover the same PhysicalRoom/date, because the PhysicalRoom schedule
      exclusion (Decision item 6) already forbids that overlap. The
      ReservationUnit allocation exclusion and PhysicalRoom schedule
      exclusion (Decision item 6) together guarantee at most one `Effective`
      assignment per unit/date and at most one `Effective` segment per
      PhysicalRoom/date, making this one-bucket attribution unambiguous.
    - Every future write path capable of changing capacity or demand for
      the same `(PropertyId, RoomTypeId, StayDate)` key — Hold/reservation
      creation, `ReservationAssignment` create/activate/split/move/cancel/
      supersede (which shifts attribution between the sold and an actual
      RoomType), `OperationalBlock` activation/split/move/cancellation, and
      capacity-affecting PhysicalRoom/`DailyInventoryControl` changes —
      participates in one shared atomic locking discipline over that key,
      extending the existing `BE-003.3`–`BE-003.5` advisory-lock pattern.
      For an assignment mutation, the locked keys include the commercially
      sold RoomType key, the old assigned PhysicalRoom's actual RoomType key
      when present, and the new assigned PhysicalRoom's actual RoomType key
      when present; the transaction evaluates the final post-operation
      attribution once, never a transient intermediate state, so a
      concurrent Hold creation, block change, or assignment mutation for the
      same key can never both commit against the same stale pre-change
      capacity, and a legitimate atomic assignment swap/move is not rejected
      merely because of how it is represented mid-transaction.
      `SellableLimit`/`IsStopSell` govern new sellability, not whether an
      existing guest may be physically moved to an otherwise usable free
      room.
    - Exact storage columns, refresh mechanism, advisory-lock hash, SQL
      function, API contract, EF mapping, DDL, or error payload remain
      implementation details for a separately authorized work item and are
      not invented here.

## Consequences

### Positive

- One authoritative table for the physical schedule removes any risk of a
  dual-write `RoomAssignments`/`RoomOccupancySegments` split falling out of
  sync.
- The fixed type/status enums keep the model from accumulating ad hoc
  lifecycle states that blur reservation business state with physical
  occupancy state.
- Database-enforced exclusion constraints make double-booking a physical
  room, or double-occupying a sold unit, structurally impossible rather
  than dependent on every code path remembering to check first.
- Split/move operations that preserve commercial pricing (ADR 0005;
  blueprint §9) let front-desk operations happen freely without any risk of
  silently changing what a guest is contractually owed.
- Cross-RoomType assignment with mandatory authorization/reason/audit
  supports real front-desk upgrade/downgrade practice without weakening the
  commercial record.
- The booked-night coverage invariant (Decision item 9) guarantees that
  authoritative physical occupancy can never exceed the guest's sold stay —
  the physical schedule and the Calendar/Reservation Board projection built
  on it stay trustworthy even as segments are split, moved, or extended.
- The `Effective OperationalBlock` sellable-inventory invariant (Decision
  item 10) guarantees that rooms taken out of service for maintenance or
  another operational reason cannot be oversold — physical blocking and
  commercial availability stay a single, consistent source of truth instead
  of two systems that can silently disagree.
- Decision item 10's one-bucket operational attribution rule guarantees that
  a cross-RoomType assignment cannot leave the assigned RoomType's occupied
  room commercially sellable while the sold RoomType's capacity is
  correctly released — availability reflects true physical occupancy in
  either direction without ever double-counting or ever leaving a room
  invisibly oversellable.

### Cost

- Two PostgreSQL exclusion constraints, `btree_gist`, and raw-SQL migration
  authorship are nontrivial implementation work compared to ordinary EF
  Core-managed constraints, and require dedicated PostgreSQL integration
  test coverage before they can be trusted.
- Every future segment-mutating operation (split, move, cancel, block
  creation) must carry optimistic concurrency and audit logging from day
  one of implementation — retrofitting audit history after the fact would
  be far more costly than building it in from the start.
- The booked-night coverage invariant (Decision item 9) requires a
  cross-table, commit-time enforcement mechanism (e.g. a deferrable
  constraint trigger) beyond an ordinary `CHECK` constraint, plus the same
  coordinated transaction/locking discipline across assignment and
  stay-coverage writes, plus dedicated PostgreSQL integration test coverage
  — nontrivial implementation and verification work beyond the two
  exclusion constraints alone.
- The `Effective OperationalBlock` sellable-inventory invariant and the
  one-bucket operational attribution rule (Decision item 10) require every
  future capacity- or demand-changing write path — Hold/reservation
  creation, `ReservationAssignment` mutation across up to three RoomType
  keys (sold, old-actual, new-actual), block mutation, and
  operational-status/daily-control changes — to share one atomic locking
  discipline over the same `(PropertyId, RoomTypeId, StayDate)` keys;
  coordinating that many write paths under one lock ordering is meaningfully
  more implementation and
  test surface than a single-writer availability read.

### Rejected alternatives

- **A `CalendarEvents` aggregate as the authoritative physical schedule.**
  Rejected — this would make the Calendar a competing write authority
  instead of a projection (ADR 0005), and would need its own overlap
  protection duplicating whatever `RoomOccupancySegments` already enforces.
- **A separate `RoomAssignments` table alongside occupancy segments.**
  Rejected — a dual-write model between two physical-schedule tables
  reintroduces exactly the synchronization risk this ADR exists to
  eliminate; one table is simpler and strictly safer.
- **Application-only overlap checks, no database exclusion constraint.**
  Rejected — application prechecks cannot prevent race conditions under
  concurrent writers the way a PostgreSQL `EXCLUDE` constraint can; this
  would leave double-booking possible under load, which is unacceptable for
  a physical-room schedule.
- **Forcing PhysicalRoom RoomType to always equal the sold RoomType (no
  cross-RoomType assignment).** Rejected — real front-desk operations
  routinely need to intentionally upgrade or downgrade a guest to a
  different physical RoomType while preserving the original commercial
  terms; forbidding this outright does not match approved operational
  practice.
- **Relying on application/UI-only validation, or on the Calendar
  projection silently clipping an out-of-coverage assignment to booked
  dates, instead of a database-enforced booked-night coverage invariant.**
  Rejected — application-only checks cannot prevent a concurrent writer
  from committing an unsupported assignment, and Calendar-side clipping
  would hide, rather than prevent, corruption in the authoritative
  PhysicalRoom schedule; neither can be the correctness mechanism for
  Decision item 9.
- **Treating `OperationalBlock` segments as Calendar-only display data with
  no effect on `RoomTypeDailyInventory`/availability.** Rejected — this is
  exactly the gap the post-C5 review identified: blocked rooms would remain
  sellable, allowing new holds/reservations to oversell capacity that is
  physically unavailable. Availability must reflect operational blocks, not
  merely display them.
- **Counting an `Effective ReservationAssignment` segment as an operational
  block in addition to its `ReservationUnitNight` demand under the sold
  RoomType.** Rejected — this additively double-counts the same sold,
  physically assigned room, understating true availability for no
  correctness benefit. The accepted model is mutually exclusive
  reattribution, not addition: the room-night's demand moves from the sold
  RoomType's bucket to the assigned PhysicalRoom's actual RoomType bucket,
  counted exactly once, never in both.
- **Leaving a cross-RoomType `Effective ReservationAssignment`'s demand
  attributed only to its sold RoomType, with no capacity adjustment for the
  assigned room's actual RoomType.** Rejected — this is exactly the gap the
  post-C6 review identified: an assigned room's actual RoomType would stay
  fully sellable even though it is physically occupied, allowing commercial
  oversale that the PhysicalRoom schedule exclusion (Decision item 6) does
  not prevent, since that exclusion only stops a *later* conflicting
  assignment — it does not reduce availability shown to a *new* customer
  browsing the assigned RoomType. The accepted model requires the
  attribution to follow the assignment to the actual RoomType.

## Current-versus-target boundary

Everything in the Decision section is TARGET / APPROVED. CURRENT / AS-BUILT
has no PhysicalRoom-level schedule, no `RoomOccupancySegment` table, no
`RoomBlock` table, no exclusion constraint, and no `btree_gist` dependency
anywhere in the repository. No migration, entity, extension, or test is
introduced by this ADR.
