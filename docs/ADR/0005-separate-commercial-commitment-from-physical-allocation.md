# ADR 0005: Separate commercial commitment from physical allocation

- **Status:** Accepted target architecture, implementation pending.
- **Date:** 2026-08-19.

This decision is TARGET / APPROVED, not CURRENT / AS-BUILT. The new
item/unit decomposition and commercial-versus-physical separation described
below are not implemented. Existing CURRENT `BookingHold`/`BookingHoldNight`
and `Reservation`/`ReservationNight` capabilities described in Context
remain implemented exactly as they are today; this ADR introduces no schema
or product change. See
[PMS-DATA-001-core-database-blueprint-v2](../design/PMS-DATA-001-core-database-blueprint-v2.md)
for full detail and scenario walkthroughs.

## Context

ADR 0004 established the base/effective-inventory availability formula
(`BaseInventory`, `SellableLimit`, `IsStopSell`) before any full PMS existed,
explicitly noting that a future reservation capability would need to extend
that formula with committed inventory and concurrency protection.

`BE-003.1`–`BE-003.5` since delivered exactly that reservation capability —
but as a **single-RoomType-per-booking** model: `BookingHold`/
`BookingHoldNight` and `Reservation`/`ReservationNight` each capture one
Property, one RoomType, and one RatePlan per aggregate, with immutable
per-night snapshots and PostgreSQL advisory-lock-protected atomic pricing
(`BE-003.3`). This is correct and complete for its own scope, but it cannot
express a customer booking that mixes multiple RoomTypes in one commitment,
and it has no concept of PhysicalRoom-level allocation at all — a confirmed
Reservation today has no schedule of which physical room a guest will
occupy.

The Owner-approved PMS blueprint requires both: multi-RoomType commercial
bookings, and a physical-room allocation layer that operates independently
of the commercial sale. Building both into one aggregate would recreate the
exact anti-pattern ADR 0004 already rejected for availability — collapsing
two distinct concerns (what was sold vs. where the guest physically stays)
into one writable surface.

## Decision

1. **Decompose the Hold and Reservation aggregates into items/units plus
   nightly rows, where each item/unit is exactly one room.** `InventoryHold
   → InventoryHoldItems → InventoryHoldItemNights` replaces the
   single-RoomType `BookingHold`/`BookingHoldNight` shape; `Reservation →
   ReservationUnits → ReservationUnitNights` replaces the single-RoomType
   `Reservation`/`ReservationNight` shape. A persisted `InventoryHoldItem`
   (and, symmetrically, a `ReservationUnit`) represents **exactly one held
   or sold room** of one RoomType — implicit quantity `1`, never a
   compressed line carrying `Quantity > 1`. A request/UI room-type line may
   carry a convenience `quantity = Q`; the Hold-creation transaction
   atomically normalizes it into exactly `Q` independent, persisted
   `InventoryHoldItems` before any confirmation or persistence semantics
   apply — normalization happens once, at creation, never as a later
   reconciliation step. Each nightly row carries the existing per-night
   discipline (uniqueness, contiguity, exact coverage, decimal money,
   nightly multiplication, UTC-instant creation) at the item/unit level
   instead of the aggregate level; item-night/unit-night prices are per
   room, per night, and Hold/Reservation totals are the sum of all
   persisted nightly rows.
2. **Map each `InventoryHoldItem` 1:1 to a `ReservationUnit`, and each
   `InventoryHoldItemNight` 1:1 to a `ReservationUnitNight`,** when
   confirmation originated from a hold — the existing one-to-one
   Hold→Reservation confirmation discipline (`BE-003.4`, enforced today by a
   unique `SourceHoldId` index) extends unchanged to the item/unit level.
   Full confirmation is atomic: one `Reservation` and every item-derived
   `ReservationUnit` are created together in one transaction, with no
   partial confirmation, no duplicate unit for the same item, and no later
   append. Hold-creation request idempotency/fingerprinting includes the
   request-level `quantity` for each RoomType line, so a replay of an
   already-succeeded request returns the same normalized items and never
   appends more.
3. **Allow Admin, walk-in, and OTA `ReservationUnits` without a mandatory
   hold.** A `ReservationUnit` may have a null `SourceInventoryHoldItemId`.
   Where present, that reference remains unique, preserving direct
   one-item-to-one-unit lineage rather than any quantity-to-generated-unit
   reconciliation mechanism. Every such unit still enters the same
   commercial commitment authority and nightly-snapshot integrity rules as
   a hold-confirmed unit. Items/units normalized from the same original
   request line are independent business rows from persistence onward — they
   may diverge in occupancy, guest assignment, nightly price, or
   physical-room assignment without any split or reconciliation operation.
4. **Separate commercial commitment from physical allocation, within the
   commercial date boundary.** A `ReservationUnit`'s existence and its
   `ReservationUnitNight` rows are the complete, enforceable record of the
   sale — including which dates were actually sold. PhysicalRoom-level
   allocation (`RoomOccupancySegment`, ADR 0006) is a distinct,
   independently mutable layer that references a `ReservationUnit` but
   never the reverse — a reservation can be sold with zero, partial, or
   full PhysicalRoom assignment without any change to its commercial rows.
   Independence is bounded, not unlimited: every `Effective`
   `ReservationAssignment` segment must be fully covered by that unit's
   persisted `ReservationUnitNight` dates (ADR 0006 Decision item 9).
   Physical allocation can freely move, split, or reassign within the sold
   stay, but it can never manufacture occupancy on a date the unit was not
   commercially booked for. Stay-extension nights become assignable only
   after, or atomically with, the creation of their explicitly priced
   `ReservationUnitNight` rows (§6 item 10 of the blueprint) — a physical
   assignment may never anticipate a future commercial extension.
5. **Keep `RoomTypeDailyInventory` a projection/closed snapshot, never an
   editable authority.** It extends ADR 0004's effective-inventory formula
   as a future operational projection and closed historical snapshot; no
   caller writes to it directly, mirroring how today's `AvailabilityDataSource`
   committed-demand read is itself a derived view, never a writable counter.
   The projection's daily capacity is computed in a fixed order: active
   `BaseInventory` (ADR 0004) is first reduced by every distinct PhysicalRoom
   carrying an `Effective OperationalBlock` segment for that date (ADR 0006
   Decision item 10) to yield usable physical capacity; `SellableLimit`/
   `IsStopSell` daily controls (ADR 0004) are applied to that already-reduced
   capacity, never independently of it; and `CommittedDemand` (Hold/
   Reservation item/unit-night demand) is subtracted last. A sold, physically
   assigned `ReservationAssignment` is never separately counted as a block —
   it already contributes its demand exactly once through its
   `ReservationUnitNight` row, so counting the assignment segment too would
   double-subtract the same sold room. Full formula, exact rules, and the
   required atomic-locking discipline are in
   [PMS-DATA-001-core-database-blueprint-v2](../design/PMS-DATA-001-core-database-blueprint-v2.md)
   §7 and [ADR 0006](0006-schedule-physical-rooms-with-occupancy-segments.md)
   Decision item 10.
6. **Keep the Calendar/Reservation Board a projection.** It is composed from
   reservations, units, unit nights, occupancy segments, and room blocks —
   it is never a competing aggregate (e.g. a `CalendarEvents` table) with
   its own write authority.

## Consequences

### Positive

- Multi-RoomType bookings become expressible without weakening the existing
  per-night integrity rules — those rules simply move down one level, from
  the aggregate to the item/unit.
- Physical allocation can evolve independently (splits, moves, upgrades,
  operational blocks — ADR 0006) without ever touching a sold reservation's
  price, nights, or ADR.
- Admin/walk-in/OTA reservation creation gets one shared commercial-integrity
  path instead of a parallel, potentially weaker one.
- `RoomTypeDailyInventory` and the Calendar stay honest projections, so
  there is never a question of which of two writable places holds the truth
  about a given night.

### Cost

- The write path for Hold/Reservation confirmation grows one level of
  nesting (item/unit, then night) compared to today's flat aggregate/night
  shape — every place that currently assumes "one RoomType per Hold" must be
  redesigned when implementation begins.
- A future implementation must carry the existing atomic-pricing and
  advisory-lock discipline (`BE-003.3`–`BE-003.5`) down to the item/unit
  level without regressing any of the current guarantees; this is scoped as
  implementation work, not solved by this ADR.

### Rejected alternatives

- **Keep one RoomType per Hold/Reservation and require multiple bookings for
  a multi-RoomType stay.** Rejected — this pushes a data-modeling limitation
  onto the customer and operator experience, and does not match the
  Owner-approved requirement that one hold/reservation supports multiple
  RoomTypes.
- **Add PhysicalRoom assignment directly onto `Reservation`/
  `ReservationNight`.** Rejected — this would re-couple commercial
  commitment and physical allocation into one aggregate, recreating exactly
  the problem this decision exists to avoid, and would force every
  price-sensitive operation to also reason about room-schedule state.
- **Model `InventoryHoldItem` as a compressed cart line carrying
  `Quantity > 1`, mapped `1:Q` to `Q` generated `ReservationUnits` on
  confirmation.** Rejected — this would require a reconciliation mechanism
  (e.g. a generated ordinal) between the persisted item's quantity and the
  units it must expand into at confirmation time, weakens direct lineage
  between a held room and its sold room, complicates confirmation
  idempotency/replay, and prevents two rooms from the same original request
  line from diverging (occupancy, price, physical assignment) before they
  are ever split apart. No current requirement mandates a compressed
  group-booking row; normalizing to one-room items at Hold-creation time
  achieves the same customer-facing "book 3 rooms at once" outcome without
  any of that complexity.
- **Let `RoomTypeDailyInventory` be directly editable by operators.**
  Rejected — this would create a second, manually mutable source of truth
  competing with the actual commitment rows (`ReservationUnitNight`,
  occupancy segments), reintroducing the "manually editable derived data"
  failure mode ADR 0004 already avoided for the base availability formula.
- **Make the Calendar/Reservation Board its own aggregate that operators
  write to directly.** Rejected — a writable Calendar aggregate would
  invite exactly the kind of desynchronization from the real commercial/
  physical state that a pure projection avoids by construction.

## Current-versus-target boundary

Everything in the Decision section is TARGET / APPROVED. CURRENT / AS-BUILT
remains exactly the single-RoomType `BookingHold`/`BookingHoldNight` and
`Reservation`/`ReservationNight` model delivered by `BE-003.1`–`BE-003.5`,
against the six existing PostgreSQL migrations. No migration, entity, or
schema change is introduced by this ADR.

## Relationship to ADR 0003 and ADR 0004

This decision extends ADR 0003 and ADR 0004; it does not rewrite or
supersede their historical CURRENT context.

- ADR 0003's half-open `[checkIn, checkOut)` stay model and its prohibition
  on UTC timestamps for hotel nights apply unchanged to
  `InventoryHoldItemNight` and `ReservationUnitNight`.
- ADR 0004's base/effective-inventory formula, and its explicit note that a
  future reservation capability must extend it with committed inventory and
  concurrency protection, is what `BE-003` already did for the single-
  RoomType model and what this ADR now extends to the multi-RoomType,
  item/unit-decomposed model. ADR 0004's own decision and consequences
  remain accurate as a historical record of the availability-only,
  pre-reservation state and are not altered here.
