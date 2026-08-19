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
8. **Intentional cross-RoomType assignment, with guardrails.** Authorized
   front-desk staff may assign a `ReservationUnit` to a PhysicalRoom whose
   RoomType differs from the commercially booked RoomType. This requires
   authorization, a recorded reason, and audit evidence. It never implicitly
   reprices `ReservationUnitNights`, reservation totals, or ADR — the
   commercial RoomType and price stay exactly what was sold; only the
   physical PhysicalRoom reference on the segment changes.

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

### Cost

- Two PostgreSQL exclusion constraints, `btree_gist`, and raw-SQL migration
  authorship are nontrivial implementation work compared to ordinary EF
  Core-managed constraints, and require dedicated PostgreSQL integration
  test coverage before they can be trusted.
- Every future segment-mutating operation (split, move, cancel, block
  creation) must carry optimistic concurrency and audit logging from day
  one of implementation — retrofitting audit history after the fact would
  be far more costly than building it in from the start.

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

## Current-versus-target boundary

Everything in the Decision section is TARGET / APPROVED. CURRENT / AS-BUILT
has no PhysicalRoom-level schedule, no `RoomOccupancySegment` table, no
`RoomBlock` table, no exclusion constraint, and no `btree_gist` dependency
anywhere in the repository. No migration, entity, extension, or test is
introduced by this ADR.
