# ADR 0005: Separate commercial commitment from physical allocation

- **Status:** Item 1–2, 4 (partial), 5–8 decomposition foundation implemented
  (`PMS-BE-001.1`, migration 7); remaining decision items (multi-RoomType
  public request, physical allocation integration, direct Admin/walk-in/OTA
  unit creation) remain target architecture, implementation pending.
- **Date:** 2026-08-19. Foundation implemented 2026-08-23.

`PMS-BE-001.1` implemented the Hold/Reservation item/unit decomposition
described in the Decision section below as CURRENT / AS-BUILT:
`InventoryHold → InventoryHoldItem → InventoryHoldItemNight` and
`Reservation → ReservationUnit → ReservationUnitNight` replaced the legacy
`BookingHold`/`BookingHoldNight` and `Reservation`/`ReservationNight`
authority entirely (migration 7, no dual-write, no legacy table remains).
The public `/api/v1` contract is unchanged: a request still carries exactly
one `RoomTypeId`/`RatePlanId`/`rooms = Q`, which the Hold-creation
transaction still normalizes atomically into `Q` independent Items — the
multi-RoomType **request** shape (item 1's forward-looking use case) remains
TARGET, not implemented. Physical-room allocation (ADR 0006) now has its
database authority, availability integration, and internal mutation
boundary implemented (`PMS-BE-001.2`); direct Admin/walk-in/OTA unit
creation without a source Hold (item 3), Admin authentication/RBAC, and any
HTTP/Admin exposure of that allocation authority remain TARGET, not
implemented. See
[PMS-DATA-001-core-database-blueprint-v2](../design/PMS-DATA-001-core-database-blueprint-v2.md)
for full detail and scenario walkthroughs, and
`docs/reports/PMS-BE-001.1-completion.md` for implementation evidence.

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
   persisted nightly rows. Each nightly row also persists the exact
   `RatePlanId` selected and priced for it, on both
   `InventoryHoldItemNight` and `ReservationUnitNight` — RatePlan lineage is
   never inferred from the accepted amount alone, since two RatePlans may
   quote the same amount for the same RoomType/night. The referenced
   RatePlan must belong to the same Property as the Hold/Reservation and be
   valid for the nightly RoomType relationship, mirroring the existing
   `(PropertyId, RatePlanId)`-style composite-key discipline CURRENT already
   uses (§2 of the blueprint) — the future implementation must preserve this
   with database-enforced property-scoped relationships, not only an
   application precheck.
2. **Map each `InventoryHoldItem` 1:1 to a `ReservationUnit`, and each
   `InventoryHoldItemNight` 1:1 to a `ReservationUnitNight`,** when
   confirmation originated from a hold — the existing one-to-one
   Hold→Reservation confirmation discipline (`BE-003.4`, enforced today by a
   unique `SourceHoldId` index) extends unchanged to the item/unit level.
   Full confirmation is atomic: one `Reservation` and every item-derived
   `ReservationUnit` are created together in one transaction, with no
   partial confirmation, no duplicate unit for the same item, and no later
   append. Confirmation copies each `InventoryHoldItemNight`'s persisted
   `RatePlanId` exactly to its corresponding `ReservationUnitNight`, along
   with its money snapshot and other accepted nightly fields — it performs
   no current-rate re-read, no repricing, and no inference of RatePlan from
   amount, RoomType, or any other mutable lookup; this holds even if the
   selected RatePlan's current rate changed after Hold creation. Hold-creation
   request idempotency/fingerprinting includes the request-level `quantity`
   for each RoomType line, so a replay of an already-succeeded request
   returns the same normalized items and never appends more.
3. **Allow Admin, walk-in, and OTA `ReservationUnits` without a mandatory
   hold.** A `ReservationUnit` may have a null `SourceInventoryHoldItemId`.
   Where present, that reference remains unique, preserving direct
   one-item-to-one-unit lineage rather than any quantity-to-generated-unit
   reconciliation mechanism. Every such unit still enters the same
   commercial commitment authority and nightly-snapshot integrity rules as
   a hold-confirmed unit, including persisting its own selected `RatePlanId`
   directly on every `ReservationUnitNight` it creates — direct creation
   never uses a weaker rate-lineage rule than hold-confirmed creation.
   Items/units normalized from the same original request line are
   independent business rows from persistence onward — they may diverge in
   occupancy, guest assignment, nightly price, or physical-room assignment
   without any split or reconciliation operation.
4. **Separate the commercial record from physical allocation, within the
   commercial date boundary — and separately, from operational capacity
   attribution.** The authoritative commercial record of a sale is
   `ReservationUnit` + its `ReservationUnitNight` rows + its
   `CommitmentStatus` (item 7) together — **never** `ReservationUnit`/
   `ReservationUnitNight` row existence alone. The unit and its nightly rows
   preserve the sold RoomType, price, dates, `RatePlanId`, guests, and
   source lineage as immutable evidence regardless of `CommitmentStatus`;
   `CommitmentStatus` separately determines whether that preserved record
   currently creates committed demand. Only a unit whose `CommitmentStatus
   == Committed` creates live commercial commitment/current demand; a
   `Cancelled` unit retains its full record as historical evidence but
   creates none (item 7). Row existence alone is never the demand
   predicate. PhysicalRoom-level allocation (`RoomOccupancySegment`,
   ADR 0006) is a distinct, independently mutable layer that references a
   `ReservationUnit` but never the reverse, and may reference only a
   `Committed` unit (ADR 0006 Decision item 3) — a reservation can be sold
   with zero, partial, or full PhysicalRoom assignment without any change
   to its commercial rows.
   Independence is bounded, not unlimited: every `Effective`
   `ReservationAssignment` segment must be fully covered by that unit's
   persisted `ReservationUnitNight` dates (ADR 0006 Decision item 9).
   Physical allocation can freely move, split, or reassign within the sold
   stay, but it can never manufacture occupancy on a date the unit was not
   commercially booked for. Stay-extension nights become assignable only
   after, or atomically with, the creation of their explicitly priced
   `ReservationUnitNight` rows (§6 item 10 of the blueprint) — a physical
   assignment may never anticipate a future commercial extension. Separately
   from this immutable commercial record, `RoomTypeDailyInventory`'s
   **operational capacity attribution** (item 5) is a derived, per-date
   projection that follows an `Effective` assignment to the assigned
   PhysicalRoom's actual RoomType for availability purposes — this never
   rewrites the commercial record above; it answers "which RoomType pool
   currently supplies this room-night," not "what was sold."
5. **Keep `RoomTypeDailyInventory` a projection/closed snapshot, never an
   editable authority — attributed to exactly one RoomType per committed
   room-night.** It extends ADR 0004's effective-inventory formula as a
   future operational projection and closed historical snapshot; no caller
   writes to it directly, mirroring how today's `AvailabilityDataSource`
   committed-demand read is itself a derived view, never a writable
   counter. The projection's daily capacity is computed in a fixed order:
   active `BaseInventory` (ADR 0004) is first reduced by every distinct
   PhysicalRoom carrying an `Effective OperationalBlock` segment for that
   date (ADR 0006 Decision item 10) to yield usable physical capacity;
   `SellableLimit`/`IsStopSell` daily controls (ADR 0004) are applied to
   that already-reduced capacity, never independently of it; and
   operational demand is subtracted last. Only nights of `Committed`
   `ReservationUnits` (item 7) participate; a `Cancelled` unit's nights
   contribute zero demand to any bucket. That demand is itself attributed
   to exactly one RoomType bucket per `Committed` room-night, never zero and
   never two: an unassigned Hold or Reservation night counts against its
   sold RoomType; a night covered by an `Effective ReservationAssignment`
   counts instead against the assigned PhysicalRoom's actual RoomType, and
   is not also counted against the sold RoomType. A same-RoomType
   assignment therefore remains one unit in the same bucket; a
   cross-RoomType assignment moves the attribution from the sold RoomType's
   pool to the actual RoomType's pool for its covered dates, without ever
   reclassifying the commercial sale (item 4). A sold, physically assigned
   `ReservationAssignment` is never separately counted as an
   `OperationalBlock` — blocks and assignments are two different capacity
   effects, evaluated together but never additively double-counting the
   same room. Full formula, the complete attribution rule set, and the
   required atomic-locking discipline (including for assignment mutation)
   are in
   [PMS-DATA-001-core-database-blueprint-v2](../design/PMS-DATA-001-core-database-blueprint-v2.md)
   §7 and [ADR 0006](0006-schedule-physical-rooms-with-occupancy-segments.md)
   Decision item 10.
6. **Keep the Calendar/Reservation Board a projection.** It is composed from
   reservations, units, unit nights, occupancy segments, and room blocks —
   it is never a competing aggregate (e.g. a `CalendarEvents` table) with
   its own write authority.
7. **Authoritative `ReservationUnit` commitment lifecycle:
   `CommitmentStatus = Committed | Cancelled`.** Every successfully created
   unit — hold-confirmed (item 2) or direct (item 3), regardless of origin
   — starts `Committed`. `Cancelled` is terminal within this decision;
   reinstatement/recommit requires a separately approved lifecycle and
   remains DEFERRED. Sibling units under the same Reservation may
   independently transition to `Cancelled` without affecting other
   `Committed` siblings, extending item 3's independence to the commitment
   lifecycle itself. If a unit's cancellation leaves its parent Reservation
   with no remaining `Committed` unit, the parent Reservation atomically
   transitions to `Cancelled` in the same transaction; a `Cancelled`
   Reservation can have no `Committed` unit and no `Effective
   ReservationAssignment` under it (ADR 0006 Decision item 3). Cancellation
   is a **demand-removal** operation, never a deletion: it never deletes or
   rewrites the unit, its `ReservationUnitNight` rows, prices, RatePlan
   lineage (item 1), guests, or source Hold lineage — all remain immutable
   historical evidence. Item 5's one-bucket operational attribution formula
   counts demand only from `Committed` units; a `Cancelled` unit contributes
   zero demand to any bucket, and its cancellation removes demand from
   whichever bucket supplied it — it never creates fallback demand
   elsewhere, and it never requires destination-capacity validation the way
   a cross-RoomType reassignment does (full mutation policy in
   [PMS-DATA-001-core-database-blueprint-v2](../design/PMS-DATA-001-core-database-blueprint-v2.md)
   §7 rules 17–26). `CommitmentStatus` is a commercial-demand lifecycle
   only — it is never reused for `RoomOccupancySegment.Status`, guest
   check-in/out state, housekeeping state, payment/refund state, or OTA
   synchronization state.

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
- **Infer a confirmed Reservation night's RatePlan from its accepted amount,
  RoomType, or a current-rate re-read at confirmation time, instead of
  persisting `RatePlanId` on the Hold night and copying it.** Rejected —
  two RatePlans can quote the same amount for the same RoomType/night,
  making amount-based inference ambiguous, and current rates can change
  after Hold creation, making a re-read produce a different (and wrong)
  answer than what was actually sold. Persisting and copying `RatePlanId`
  exactly is the only mechanism that is unambiguous and immune to
  post-Hold rate changes.
- **Make the Calendar/Reservation Board its own aggregate that operators
  write to directly.** Rejected — a writable Calendar aggregate would
  invite exactly the kind of desynchronization from the real commercial/
  physical state that a pure projection avoids by construction.
- **Treat cancellation as row deletion (deleting the `ReservationUnit` or
  its `ReservationUnitNight` rows) instead of a `CommitmentStatus`
  transition.** Rejected — deletion destroys the immutable commercial
  evidence (price, RatePlan lineage, guest, source Hold) this ADR requires
  to survive cancellation, and gives a future implementation no way to
  distinguish "never existed" from "was committed, then cancelled."
- **Treat `ReservationUnitNight` row existence alone as committed demand,
  with no `CommitmentStatus` filter.** Rejected — without an explicit
  status filter, a cancelled unit's nights would keep counting as demand
  forever, permanently understating availability and never releasing the
  capacity a cancellation is supposed to free.
- **Allow a `Cancelled` `ReservationUnit` to silently resume creating
  demand (implicit reinstatement) without a new approved policy.**
  Rejected — `Cancelled` is terminal within this decision precisely so a
  future reinstatement/recommit policy can be designed deliberately, with
  its own capacity-validation rules, rather than falling out accidentally
  from an unspecified status transition.

## Current-versus-target boundary

`PMS-BE-001.1` (migration 7, `CommercialCommitmentV2Foundation`) implemented
Decision items 1–2, 4 (commercial-record-versus-physical-allocation
separation only — physical allocation itself remains unimplemented), 5
(`RoomTypeDailyInventory`'s per-Committed-night-once counting, not the
`OperationalBlock`/assignment-attribution formula in ADR 0006), 6 (Calendar
remains a projection, not built), 7, and 8 (RatePlan lineage) as CURRENT /
AS-BUILT: `InventoryHold → InventoryHoldItem → InventoryHoldItemNight` and
`Reservation → ReservationUnit → ReservationUnitNight` replaced the legacy
`BookingHold`/`BookingHoldNight`/`Reservation`/`ReservationNight` model
entirely (no dual-write, no legacy table remains) against seven PostgreSQL
migrations. Decision item 3 (direct Admin/walk-in/OTA unit creation without
a source Hold) and the multi-RoomType **public request** shape remain
TARGET, not implemented — the public `/api/v1` contract still accepts
exactly one `RoomTypeId`/`RatePlanId`/`rooms = Q` per request. Items 9–13's
lifecycle/uniqueness/cancellation rules are implemented for this
single-RoomType-per-request scope. ADR 0006's `RoomOccupancySegment`,
`RoomBlock`, PostgreSQL exclusion constraints, and cross-RoomType assignment
remain entirely TARGET, unimplemented.

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
