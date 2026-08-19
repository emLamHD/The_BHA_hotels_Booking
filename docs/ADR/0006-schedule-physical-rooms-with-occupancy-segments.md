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
establishes that a `ReservationUnit`, its `ReservationUnitNight` rows, and
its `CommitmentStatus` together are the authoritative commercial record of
a sale — row existence alone is never sufficient, and only a `Committed`
unit currently creates commercial demand (ADR 0005 Decision item 4); this
ADR defines the independent layer that tracks where a guest, or an
operational block, actually occupies a PhysicalRoom, and may reference only
a `Committed` unit (Decision item 3).

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
3. **Type/reference, same-Property, and unit-commitment consistency
   invariants.** A `ReservationAssignment` segment references a
   `ReservationUnit` and no `RoomBlock`. An `OperationalBlock` segment
   references a `RoomBlock` header and no `ReservationUnit`. A segment's
   type determines exactly one populated reference field; the other is
   always absent. Separately, every `RoomOccupancySegment` is scoped to
   exactly one Property, and every reference it populates must resolve
   inside that same Property: the referenced PhysicalRoom always belongs to
   the segment's Property; for a `ReservationAssignment`, the referenced
   `ReservationUnit`'s parent Reservation always belongs to that same
   Property as the PhysicalRoom and segment; for an `OperationalBlock`, the
   referenced `RoomBlock` header always belongs to that same Property as
   every PhysicalRoom segment under it. Intentional cross-RoomType
   assignment (Decision item 8) never authorizes cross-Property assignment
   — not even between two Properties under the same Organization, sharing a
   RoomType code, or both accessible to the operator; a cross-Property
   guest transfer is a distinct business operation, not designed or
   authorized here. A third, separate consistency rule: an `Effective`
   `ReservationAssignment` may reference only a `ReservationUnit` whose
   `CommitmentStatus` (ADR 0005 Decision item 7) is `Committed` — no
   assignment may be created or activated against a `Cancelled` unit, and
   cancelling a unit atomically cancels/supersedes every `Effective`
   assignment referencing it in the same transaction (Decision item 5).
   All three invariants must hold at the database level in the eventual
   implementation, not only in application code — same-Property
   consistency does not replace tenant/property-scoped authorization, and
   authorization does not replace it either; they are separate,
   complementary checks, and unit-commitment consistency is a further,
   independent check alongside them.
4. **Multi-room `RoomBlock` header-to-segment relationship, single-Property.**
   One `RoomBlock` header relates to one or more `OperationalBlock`-type
   occupancy segments, supporting a single maintenance/operational event
   that spans multiple PhysicalRooms and, optionally, multiple RoomTypes —
   but always within one Property. A `RoomBlock` can never span Properties;
   every PhysicalRoom a header's segments reference must belong to the same
   Property as the header (Decision item 3).
5. **Split/move/cancel operations with optimistic concurrency and
   append-only audit.** Segments are operationally mutable through
   controlled actions only. A split or move supersedes existing segment rows
   and creates new ones; it never overwrites a segment's date range in
   place. Optimistic concurrency (a version/row-version check) and an
   append-only audit trail are required so mutation never silently erases
   history.
   - **Cross-RoomType assignment mutation is operationally binding, not
     unconditionally reversible.** While the referenced unit remains
     `Committed`, unassigning an `Effective` cross-RoomType assignment
     (falling back to the sold RoomType) or reassigning it to a different
     PhysicalRoom succeeds only when the destination — the sold RoomType
     for a fallback, or the new PhysicalRoom's actual RoomType for a
     reassignment — has enough usable operational capacity in the final
     post-operation state, evaluated across every affected date. There is
     no hidden sold-type rollback reserve and no reservation of a second
     room merely to guarantee unconditional reversibility.
   - **Failure preserves the prior assignment atomically.** If any
     destination or fallback date lacks capacity, the entire mutation
     transaction is rejected: the existing `Effective` assignment and its
     demand attribution remain exactly as they were, with no
     delete-then-fail intermediate state ever visible or committed.
   - **Same-RoomType mutation creates no bucket delta.** Cancelling or
     moving a same-RoomType assignment while the unit remains `Committed`
     never changes which RoomType bucket the unit's demand occupies; it
     remains subject to the ordinary schedule-exclusion, audit, and
     concurrency rules, but requires no destination-capacity validation.
   - **Destination PhysicalRoom usability.** For every assignment create,
     activate, move, or supersede — same-RoomType or cross-RoomType — with a
     destination PhysicalRoom, that destination must have `OperationalStatus
     == Active`; carry no overlapping `Effective ReservationAssignment`;
     carry no overlapping `Effective OperationalBlock`; belong to the same
     Property as the segment and its referenced `ReservationUnit` (Decision
     item 3); satisfy the booked-night coverage invariant for the referenced
     unit (Decision item 9); and reference a unit whose `CommitmentStatus`
     is `Committed` (Decision item 3). A same-RoomType move needs no
     RoomType-pool headroom check (no bucket delta above), but "no headroom
     check" never means "no destination validation" — a same-RoomType
     destination must still satisfy every condition in this bullet. For
     assigned → unassigned there is no destination PhysicalRoom; any
     cross-type fallback to the sold RoomType instead remains subject to
     this item's final-state usable-capacity check above.
   - **Unit cancellation is a distinct, unconditional cleanup path.**
     Cancelling a `ReservationUnit` (ADR 0005 Decision item 7) atomically
     cancels/supersedes every `Effective` assignment referencing it in the
     same transaction and removes — never transfers — that demand; unlike a
     cross-RoomType reassignment, cancellation-triggered assignment cleanup
     requires no destination or fallback capacity check, because the
     resulting state simply has less demand, never relocated demand.
   - No emergency-overbooking path or override exists in this decision; a
     capacity-unsafe mutation is rejected outright, never forced through.
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
   - Decision item 3's same-Property consistency for a segment's PhysicalRoom
     and its populated `ReservationUnit`/`RoomBlock` reference is a further
     distinct requirement: the future implementation must use
     property-scoped composite foreign keys/alternate keys where the schema
     already exposes `PropertyId` on the relevant nodes (mirroring the
     existing `(PropertyId, RoomTypeId)`-style composite keys used by
     `BookingHold`/`Reservation` today), or an equivalently rigorous
     database-enforced cross-table mechanism where it does not. An
     application-only precheck is insufficient as the sole correctness
     mechanism under concurrent writers, exactly as for the other invariants
     in this item. Exact column duplication, alternate-key names, constraint
     names, SQLSTATE mapping, trigger code, EF configuration, or migration
     order remain implementation details for a separately authorized work
     item and are not invented here.
   - Decision item 3's unit-commitment consistency — an `Effective`
     `ReservationAssignment` may reference only a `Committed`
     `ReservationUnit`, and cancelling a unit or its parent Reservation
     atomically cancels/supersedes its assignments (ADR 0005 Decision item
     7) — is a further distinct requirement: the future implementation must
     database-enforce the final-state relationship between
     `ReservationUnit.CommitmentStatus`, parent `Reservation` status, and
     `Effective` assignment rows under concurrent writers. An
     application-only precheck is insufficient as the sole correctness
     mechanism, exactly as for the other invariants in this item — a
     deferrable constraint trigger or an equivalently rigorous mechanism may
     be named conceptually, but exact DDL, constraint/trigger names,
     SQLSTATE mapping, EF configuration, lock hashes, and migration order
     remain for a separately authorized implementation design and are not
     invented here.
8. **Intentional cross-RoomType assignment, with guardrails — always within
   one Property.** Authorized front-desk staff may assign a
   `ReservationUnit` to a PhysicalRoom whose RoomType differs from the
   commercially booked RoomType, but only within the same Property as the
   sold Reservation (Decision item 3) — never across Properties, even under
   the same Organization or a shared RoomType code; a cross-Property guest
   transfer is a distinct business operation, not authorized here. This
   requires authorization, a recorded reason, and audit evidence. It never
   implicitly reprices `ReservationUnitNights`, reservation totals, or ADR —
   the commercial RoomType and price stay exactly what was sold; only the
   physical PhysicalRoom reference on the segment changes. Cross-RoomType
   flexibility never grants date flexibility: the assignment's dates must
   still satisfy Decision item 9's booked-night coverage invariant against
   the sold unit's nights. While the commercial record never changes,
   `RoomTypeDailyInventory`'s operational capacity attribution (Decision
   item 10) does follow the assignment to the actual PhysicalRoom's
   RoomType for its covered dates — the assigned-type room becomes
   unsellable and the sold-type capacity is released for that date, so a
   physically occupied room can never also be commercially oversold. This
   assignment is **operationally binding**, not unconditionally reversible
   (Decision item 5): unassigning it or reassigning it elsewhere succeeds
   only when the sold-type fallback or the new destination has final-state
   usable capacity; a capacity-unsafe mutation is rejected outright and the
   current assignment is preserved. There is no hidden sold-type rollback
   reserve, no reservation of a second room, and no overbooking-override
   path in this decision — an operator may need to keep the current
   assignment until a capacity-safe alternative exists.
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
    covers. Every availability computation and lock key in this formula is
    scoped to one verified Property, exactly as Decision item 3's
    same-Property consistency requires for the underlying segment
    references — an invalid cross-Property row can never move demand or
    block capacity between two Properties' inventories, because no segment
    reference is permitted to exist across Properties in the first place.
    The exact daily formula, block-counting rules, and required
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
      `Committed` room-night — never zero, never two, and only for units
      whose `CommitmentStatus` (ADR 0005 Decision item 7) is `Committed`; a
      `Cancelled` unit's nights contribute zero demand to any bucket. An
      unassigned Hold or `Committed` Reservation night counts against its
      sold RoomType. A night covered by an `Effective ReservationAssignment`
      counts instead against the assigned PhysicalRoom's actual RoomType and
      is not also counted against the sold RoomType — a same-RoomType
      assignment therefore remains one unit in the same bucket, while a
      cross-RoomType assignment moves the attribution from the sold
      RoomType's pool to the actual RoomType's pool for its covered dates,
      releasing the sold-type capacity and consuming the actual-type
      capacity, without reclassifying the commercial sale (Decision item
      8). An `Effective ReservationAssignment` is never counted as an
      `OperationalBlock` for this purpose — the two are separate capacity
      effects that can never cover the same PhysicalRoom/date, because the
      PhysicalRoom schedule exclusion (Decision item 6) already forbids
      that overlap. The ReservationUnit allocation exclusion and
      PhysicalRoom schedule exclusion (Decision item 6) together guarantee
      at most one `Effective` assignment per unit/date and at most one
      `Effective` segment per PhysicalRoom/date, making this one-bucket
      attribution unambiguous.
    - Cancelling a `ReservationUnit` or its parent `Reservation` (ADR 0005
      Decision item 7) **removes** the unit's current demand from whichever
      bucket supplied it — it never creates fallback demand in another
      bucket, and unlike a cross-RoomType reassignment (Decision item 5), it
      requires no destination-capacity validation, because the resulting
      state always has strictly less demand, never relocated demand. This
      recomputation applies only to current/open `RoomTypeDailyInventory`
      projection state; closed historical daily snapshots for past dates are
      never rewritten by a later cancellation, assignment mutation, or audit
      correction — commercial unit/night rows and `Cancelled` assignment
      history remain preserved as immutable evidence regardless.
    - Every future write path capable of changing capacity or demand for
      the same `(PropertyId, RoomTypeId, StayDate)` key — Hold/reservation
      creation, `ReservationAssignment` create/activate/split/move/cancel/
      supersede (which shifts attribution between the sold and an actual
      RoomType, subject to Decision item 5's operationally-binding mutation
      policy), `ReservationUnit`/`Reservation` cancellation (which removes
      demand and requires no destination capacity), `OperationalBlock`
      activation/split/move/cancellation, and capacity-affecting
      PhysicalRoom/`DailyInventoryControl` changes — participates in one
      shared atomic locking discipline over that key, extending the
      existing `BE-003.3`–`BE-003.5` advisory-lock pattern. For an
      assignment mutation, the locked keys include the commercially sold
      RoomType key, the old assigned PhysicalRoom's actual RoomType key when
      present, and the new assigned PhysicalRoom's actual RoomType key when
      present; the transaction evaluates the final post-operation
      attribution once, never a transient intermediate state, so a
      concurrent Hold creation, block change, assignment mutation, or
      cancellation for the same key can never both commit against the same
      stale pre-change capacity, and a legitimate atomic assignment
      swap/move is not rejected merely because of how it is represented
      mid-transaction. `SellableLimit`/`IsStopSell` govern new sellability,
      not whether an existing guest may be physically moved to an otherwise
      usable free room. No emergency-overbooking path or override exists in
      this decision; a capacity-unsafe mutation is rejected outright.
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
- Decision item 3's same-Property consistency guarantees that a multi-
  property database can never assign a Property A Reservation to a Property
  B PhysicalRoom, or attach a Property A `RoomBlock` header to Property B
  rooms — the physical schedule and per-property availability projection
  stay correctly isolated per Property even as the platform scales to more
  properties (blueprint §3 item 5).
- Decision item 5's operationally-binding, capacity-validated cross-RoomType
  mutation policy guarantees that a room's sold-type operational capacity
  can never be released and resold while an unassign/reassign that depends
  on that release is still in flight — a rejected mutation always leaves
  the prior `Effective` assignment exactly as it was, so no guest can be
  silently stranded between two rooms.
- Decision item 3's unit-commitment consistency, together with ADR 0005
  Decision item 7's `CommitmentStatus` lifecycle, guarantees that a
  cancelled reservation's demand and physical assignments are always
  cleaned up atomically in the same transaction — no stale `Effective`
  assignment or stale demand can outlive the unit it belonged to.

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
- Decision item 3's same-Property consistency requires property-scoped
  composite foreign keys/alternate keys (or an equivalent cross-table
  mechanism) on every occupancy-segment reference, plus PostgreSQL
  integration test coverage proving cross-Property references are rejected
  — additional schema and verification surface beyond a same-Property-naive
  design.
- Decision item 5's conditional cross-RoomType mutation policy requires the
  future implementation to evaluate destination/fallback capacity against
  the final post-operation state before committing an unassign/reassign —
  meaningfully more implementation and test surface than an unconditional
  mutation that skips the capacity check.
- Decision item 3's unit-commitment consistency requires the future
  implementation to database-enforce the three-way relationship between
  `ReservationUnit.CommitmentStatus`, parent `Reservation` status, and
  `Effective` assignment rows under concurrent writers — additional
  cross-table enforcement and PostgreSQL integration test coverage beyond
  the exclusion/coverage/block invariants alone.

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
- **Relying on application/UI-only authorization checks, with no
  database-enforced same-Property invariant, to keep occupancy segment
  references inside one Property.** Rejected — application-only checks
  cannot prevent a concurrent writer, a bug, or an unreviewed code path
  from committing a cross-Property reference; only a database-enforced
  constraint on the segment/`ReservationUnit`/`RoomBlock` relationship makes
  cross-Property corruption structurally impossible rather than merely
  discouraged.
- **Permitting cross-Property assignment when the two Properties share an
  Organization, a RoomType code, or an operator's access grant.** Rejected
  — shared ownership, naming, or access does not make two Properties'
  physical inventories the same inventory; allowing this would silently
  corrupt both Properties' physical schedules and per-property availability
  projections. A genuine cross-Property guest transfer, if ever needed, is
  a separate business operation requiring its own future authorization —
  not an exception folded into cross-RoomType assignment.
- **Unconditional unassign/reassign of an `Effective` cross-RoomType
  assignment, with no destination-capacity check.** Rejected — this is
  exactly the gap the post-C9 review identified: releasing sold-type
  capacity and allowing it to be resold, then unconditionally permitting a
  later unassign/reassign, can leave the sold RoomType overcommitted or
  strand a guest with no valid destination. The accepted model requires
  every such mutation to validate final-state usable capacity before
  committing (Decision item 5).
- **A hidden sold-type "rollback reserve" — holding back capacity or
  reserving a second room merely to guarantee an assignment can always be
  unconditionally reversed.** Rejected — this creates a second, implicit
  demand bucket in tension with the one-bucket attribution rule (Decision
  item 10), understates true availability for no correctness benefit, and
  substitutes a speculative reservation for an explicit, auditable
  capacity check performed at mutation time.
- **A partial mutation — committing a destination assignment while leaving
  the source/fallback state ambiguous, or vice versa.** Rejected — an
  assignment mutation must evaluate and commit the complete final
  post-operation state in one transaction (Decision item 5); anything less
  risks a state where a room appears both released and occupied, or neither,
  depending on which half of the mutation happened to commit.
- **Allowing an `Effective ReservationAssignment` to reference a `Cancelled`
  `ReservationUnit`.** Rejected — a cancelled unit no longer represents
  live demand, so an assignment referencing it would create physical
  occupancy with no corresponding commercial commitment; Decision item 3
  requires every `Effective` assignment to reference a `Committed` unit, and
  cancellation atomically cancels any assignment that already existed.
- **Enforcing unit-commitment consistency (Decision item 3) with
  application-only checks and no database-level final-state constraint.**
  Rejected — application-only checks cannot prevent a concurrent writer, a
  bug, or an unreviewed code path from committing an `Effective` assignment
  against a `Cancelled` unit, or from leaving a `Cancelled` Reservation with
  a `Committed` unit; only a database-enforced final-state check makes this
  corruption structurally impossible rather than merely discouraged.

## Current-versus-target boundary

Everything in the Decision section is TARGET / APPROVED. CURRENT / AS-BUILT
has no PhysicalRoom-level schedule, no `RoomOccupancySegment` table, no
`RoomBlock` table, no exclusion constraint, and no `btree_gist` dependency
anywhere in the repository. No migration, entity, extension, or test is
introduced by this ADR.
