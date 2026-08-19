# PMS-DATA-001 — Core Database Blueprint v2

- **Status:** Approved TARGET architecture. Not implemented. No table, column,
  constraint, migration, entity, query, worker, endpoint, UI, or adapter
  described below exists in the current schema or codebase.
- **Date:** 2026-08-19.
- **Scope:** the locked, Owner-approved PMS core database design that Customer
  Web and a future Admin PMS will share. This document is the authoritative
  detailed target source; `PROJECT_BIBLE.md`, `ARCHITECTURE.md`, and
  `SNAPSHOT.md` summarize and link to it, they do not duplicate it.

## 1. Purpose and vocabulary

This blueprint persists the Owner-approved PMS/database target architecture
into durable repository documentation so it stops existing only in chat. It
does not implement any of it.

Three labels are used consistently throughout this document and its two
companion ADRs (0005, 0006):

- **CURRENT / AS-BUILT** — behavior proven today by merged source, migrations,
  tests, or PR evidence.
- **TARGET / APPROVED** — architecture the Owner has approved and this work
  item documents, but that is not implemented.
- **DEFERRED** — an intentionally excluded future decision or module that
  requires separate authorization before design or implementation begins.

`Accepted` is never used as shorthand for `Implemented`. Every TARGET
statement in this document remains TARGET even where the prose reads as a
firm decision — firmness of the decision is not evidence of construction.

## 2. Current as-built baseline

- The BHA Hotels Booking currently implements a **single-Property,
  single-RoomType** Hold/Reservation aggregate (`BE-003.1`–`BE-003.5`):
  `BookingHold`/`BookingHoldNight` and `Reservation`/`ReservationNight`, each
  capturing exactly one Property, RoomType, and RatePlan per booking, with
  immutable nightly snapshots.
- Exactly six PostgreSQL migrations exist, ending at
  `20260723105404_AddBookingHoldReservationFoundation`:
  1. `20260721175848_InitialPropertyRoomInventory`
  2. `20260722102552_AddRatePlanFoundation`
  3. `20260722112304_AddDailyRoomRates`
  4. `20260722121010_AddDailyInventoryControls`
  5. `20260723085814_CustomerBookingIdentity`
  6. `20260723105404_AddBookingHoldReservationFoundation`
- Availability committed demand is already expiry-aware:
  `Active Holds where ExpiresAtUtc > utcNow` plus `Confirmed Reservations`,
  evaluated against one server UTC instant, with no persisted `Expired`
  status and no background expiry cleanup — an active Hold already stops
  counting at the exact expiry boundary (`BE-003.3`, `BE-003.5`).
- Every Hold/Reservation mutation uses one explicit PostgreSQL transaction
  and parameterized `pg_advisory_xact_lock` calls, in a fixed
  lifecycle-transition-then-inventory lock order.
- Admin Web (`Front_End/Admin_Web`) is a merged, template-only baseline
  (TailAdmin 2.3.0, Next.js 16.1.6, React/React DOM 19.2.1, TypeScript 5.9.3,
  PR #30). It has no backend integration, no Admin authentication, and no
  PMS, Reservation Board, Calendar, or OTA behavior.
- No `Organization` entity, no PMS physical-room occupancy schedule, no
  `FolioEntries`, no Stay Declaration, no OTA inbox/outbox, and no PMS
  migration exist anywhere in the current schema or codebase.

## 3. Platform, tenant, and property boundary

1. Customer Web and Admin Web share one ASP.NET Core backend and one
   PostgreSQL source of truth (TARGET — Admin Web currently has no backend
   integration at all).
2. TARGET hierarchy: `Organization → Property → RoomType → PhysicalRoom`.
   CURRENT hierarchy stops at `Property → RoomType → PhysicalRoom`; no
   `Organization` entity exists.
3. Authorization and operational reads/writes are organization/property
   scoped (TARGET). Tenant isolation must be enforced at application/domain
   boundaries and by PostgreSQL integrity where practical — this is a design
   requirement for the eventual implementation, not a claim that any such
   enforcement exists today beyond the current single-Property model.
4. Current onboarding scope is exactly two approved properties, both TARGET
   (neither is a claim that both rows exist in the current seed/schema):
   - The BHA House — 79 Mộc Sơn 5, Đà Nẵng.
   - The BHA Riverside — 162 Nghiêm Xuân Yêm, Đà Nẵng.
5. The platform must scale to additional properties without a separate
   backend or database per property (TARGET design constraint).

## 4. Conceptual target relationship map

TARGET, textual only — no ER diagram tooling is introduced and no schema is
authored beyond the relationships named here.

```text
Organization
  └─ Property (one or more)
       ├─ RoomType (one or more)
       │    └─ PhysicalRoom (one or more)
       ├─ InventoryHold
       │    └─ InventoryHoldItem (references a RoomType)
       │         └─ InventoryHoldItemNight (per stay date)
       ├─ Reservation
       │    └─ ReservationUnit (references a RoomType; optionally a
       │         source InventoryHoldItem)
       │         └─ ReservationUnitNight (per stay date; carries RatePlanId)
       ├─ RoomOccupancySegment (references a PhysicalRoom; and either a
       │    ReservationUnit or a RoomBlock, per its type)
       ├─ RoomBlock (header for one or more operational-block segments)
       ├─ FolioEntries (financial posting authority, references a
       │    Reservation)
       └─ Guest identity documents / Stay Declarations (compliance records,
            reference a Reservation/guest, distinct lifecycles)
```

`RoomTypeDailyInventory` and the Calendar/Reservation Board are projections
over the above graph, not additional aggregates competing for authority
(§7, §10). OTA adapter/inbox/outbox entities attach at the Reservation and
availability-reaction boundary and remain DEFERRED (§14).

## 5. Current-versus-target vocabulary map

| Concept | CURRENT | TARGET |
| --- | --- | --- |
| Tenant/property scope | Single implicit Property, no Organization | `Organization → Property` |
| Commercial hold | `BookingHold`/`BookingHoldNight`, one RoomType per Hold | `InventoryHold → InventoryHoldItems → InventoryHoldItemNights`, multiple RoomTypes per Hold |
| Commercial reservation | `Reservation`/`ReservationNight`, one RoomType per Reservation | `Reservation → ReservationUnits → ReservationUnitNights` |
| Physical schedule | None — no PhysicalRoom-level schedule exists | `RoomOccupancySegments`, authoritative PhysicalRoom schedule |
| Rate attachment | `RatePlanId` on the Hold/Reservation aggregate | `RatePlanId` at UnitNight level |
| Calendar | None | Projection over reservations/units/nights/segments/blocks |

## 6. Commercial commitment model

1. A customer booking supports multiple RoomTypes in one hold or reservation
   (TARGET — CURRENT is exactly one RoomType per Hold/Reservation).
2. TARGET hold aggregate: `InventoryHold → InventoryHoldItems →
   InventoryHoldItemNights`. Each `InventoryHoldItem` represents one
   RoomType-quantity commitment within the Hold; each
   `InventoryHoldItemNight` is the per-stay-date nightly row under that item,
   mirroring today's per-night snapshot discipline (uniqueness, contiguity,
   exact coverage, decimal money, nightly multiplication, UTC-instant
   creation) at the item level instead of the Hold level.
3. TARGET reservation aggregate: `Reservation → ReservationUnits →
   ReservationUnitNights`. Each `ReservationUnit` is one commercially sold
   RoomType-unit within the Reservation; each `ReservationUnitNight` is its
   per-stay-date nightly row, carrying `RatePlanId` (§8).
4. Confirmation maps each `InventoryHoldItem` to exactly one
   `ReservationUnit` — the existing one-to-one Hold→Reservation confirmation
   discipline (`BE-003.4`) extends unchanged to the item/unit level.
5. A `ReservationUnit` may have no source hold — Admin, walk-in, or OTA
   reservation creation may bypass a source hold entirely. Where a source
   hold-item reference is present, it is unique, mirroring the existing
   unique `SourceHoldId` constraint at the aggregate level today.
6. Existing half-open stay semantics remain unchanged at the night level:
   `[checkIn, checkOut)`. Checkout is never priced and never consumes a
   room-night (ADR 0003, unchanged).
7. Existing nightly uniqueness/contiguity/exact-coverage, decimal-money,
   nightly multiplication, UTC-instant creation, and immutable-snapshot
   rules remain foundational at the new Item/Unit-Night level exactly as
   they operate at today's Hold/Reservation-Night level.
8. Active-hold expiry correctness must not depend on the expiry worker
   running on time (unchanged principle from `BE-003.3`/`BE-003.5`).
   Authoritative queries and transitions exclude expired holds at the exact
   `ExpiresAtUtc` boundary; a background cleanup process remains operational
   hygiene only, never a correctness dependency.
9. Stay extension adds explicitly priced extension nights onto a
   `ReservationUnit`. It never silently copies, averages, or recalculates
   previously accepted `ReservationUnitNight` rows.
10. Admin, walk-in, and OTA reservation creation may bypass a source hold,
    but every such `ReservationUnit` still enters the same commercial
    commitment authority, nightly-snapshot discipline, and integrity rules
    as a hold-confirmed unit — there is no separate, weaker write path.

## 7. Inventory/availability authority and hold-expiry correctness

`RoomTypeDailyInventory` is a future operational projection and a closed
historical snapshot — never a manually editable source of truth (TARGET).
Its role mirrors today's `AvailabilityDataSource` committed-demand read
(`BE-003.3`): a derived view over authoritative rows, never itself an
authority a caller can write to directly.

The expiry-boundary correctness rule already proven today (`BE-003.3`,
`BE-003.5`) — `Active Holds where ExpiresAtUtc > utcNow` counted, expired
Holds excluded at the exact instant, no persisted `Expired` status required
for correctness — extends unchanged to the new `InventoryHoldItem`/
`InventoryHoldItemNight` shape. An expired-but-uncleaned Hold item remains
logically harmless before any operational cleanup runs, exactly as an
expired-but-uncleaned Hold is harmless today.

## 8. Commercial commitment versus physical allocation

1. Commercial commitment (`Reservation`/`ReservationUnit`/
   `ReservationUnitNight`) and PhysicalRoom allocation
   (`RoomOccupancySegment`) are independent inventory layers (TARGET).
2. A commercial reservation can be fully assigned, partially assigned, or
   entirely unassigned to PhysicalRooms without losing its booked
   RoomType/nights — the sale is complete and enforceable the moment
   `ReservationUnitNight` rows exist; physical assignment is a separate,
   later operational act.
3. `RoomTypeDailyInventory` is a projection/closed snapshot (§7), never a
   competing writable authority.
4. The Calendar/Reservation Board is a projection over reservations, units,
   unit nights, occupancy segments, room blocks, and related operational
   state (§10) — it is not a competing aggregate such as a `CalendarEvents`
   table.
5. Realtime UI delivery (e.g. push updates to an open Calendar view)
   improves operator experience but is never the correctness mechanism.
   Transactions and PostgreSQL constraints remain authoritative regardless
   of whether or how quickly a UI observer is notified.

## 9. RoomOccupancySegment model

Full detail — including the two exclusion invariants, the future
implementation boundary, and cross-RoomType assignment rules — is recorded
in [ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md).
Summary for this blueprint:

- `RoomOccupancySegments` (not `RoomAssignments`) are the authoritative
  PhysicalRoom schedule (TARGET).
- Segment types are exactly `ReservationAssignment` and `OperationalBlock`.
  No other segment type exists.
- Segment statuses are exactly `Effective` and `Cancelled`, independent of
  Reservation lifecycle/check-in state. No draft enum such as `Reserved`,
  `InHouse`, `Blocked`, or `Held` is part of this model — those concepts
  belong to reservation/arrival/hold/operational business state, not the
  occupancy-segment type/status model.
- A `ReservationAssignment` segment references a `ReservationUnit`. An
  `OperationalBlock` segment references the appropriate `RoomBlock` header.
  Type/reference consistency is an invariant: a segment's type determines
  which reference field is populated, and the other reference is absent.
- Multi-room operational blocks use one `RoomBlock` header related to one or
  more occupancy segments.
- Segments are operationally mutable through controlled split/move/cancel
  actions, using optimistic concurrency and append-only audit evidence.
  Mutation must never erase history — a split or move creates new segment
  rows and marks superseded ones, it does not overwrite them in place.
- Splitting or moving an occupancy segment never reprices
  `ReservationUnitNights` and therefore never changes booked ADR (average
  daily rate). Allocation-span metrics may change when a segment is split
  (for example, 9 nights becomes 5 + 4 across two PhysicalRooms) — this is
  an allocation-segment-length change, never confused with the reservation's
  contractual stay length or ALOS (average length of stay) reporting, which
  are derived from `ReservationUnitNight`, not from occupancy segments.

## 10. Calendar/Reservation Board projection

The Calendar/Reservation Board is a read projection composed from
`Reservation`, `ReservationUnit`, `ReservationUnitNight`,
`RoomOccupancySegment`, `RoomBlock`, and related operational state — it owns
no independent write authority and no separate aggregate table (TARGET,
extends §8 item 4).

- A reservation that is fully assigned shows its `ReservationUnit` mapped to
  specific PhysicalRooms via `Effective` `ReservationAssignment` segments for
  every night of its stay.
- A partially assigned reservation shows PhysicalRoom occupancy for the
  nights that have an `Effective` segment and an explicit unassigned state
  for the remaining nights — the projection must represent partial coverage
  without inventing a placeholder segment.
- An unassigned reservation shows as commercially confirmed with no
  PhysicalRoom occupancy row at all; its RoomType/nights remain visible from
  `ReservationUnitNight` directly.
- Realtime delivery to an open Calendar view is a UX improvement layered on
  top of this projection; it never becomes the correctness mechanism (§8
  item 5).

## 11. PostgreSQL non-overlap protection

PostgreSQL must enforce both exclusion invariants below; application-level
prechecks alone are insufficient (TARGET, detailed further in
[ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)):

1. **PhysicalRoom schedule exclusion** — two `Effective` occupancy segments
   can never overlap on the same PhysicalRoom, regardless of segment type
   (`ReservationAssignment` vs. `OperationalBlock`).
2. **ReservationUnit allocation exclusion** — two `Effective`
   `ReservationAssignment` segments can never overlap for the same
   `ReservationUnit`, preventing one sold unit from occupying two rooms over
   the same dates.

Both invariants use half-open date ranges, consistent with ADR 0003's
existing `[checkIn, checkOut)` stay model.

The future EF/Npgsql implementation boundary (named here, not built):
`btree_gist` PostgreSQL extension; a raw-SQL migration for the exclusion
constraints (EF Core does not generate `EXCLUDE` constraints natively);
mapping the PostgreSQL exclusion-violation SQLSTATE `23P01` to safe,
specific domain/application errors by exact constraint name (never a raw
database error surfacing to a caller); an explicit transaction with
two-`SaveChanges` ordering where relationship materialization requires it
(mirroring the existing explicit-transaction discipline in `BE-003.3`–
`BE-003.5`); and real PostgreSQL integration tests, never EF InMemory or
SQLite, consistent with `docs/DATABASE.md`'s existing testing policy. No DDL,
migration code, constraint name, or test is created by this documentation
work item.

## 12. Intentional cross-RoomType assignment

1. Authorized front-desk staff may deliberately assign a `ReservationUnit`
   to a PhysicalRoom whose RoomType differs from the commercially booked
   RoomType — supporting intentional upgrades and downgrades (TARGET).
2. Cross-RoomType assignment requires authorization, a recorded reason, and
   audit evidence — it is never a silent or anonymous action.
3. The commercial/sold RoomType remains the booked RoomType for pricing,
   reporting, and the customer's original commitment. Physical occupancy
   follows the assigned PhysicalRoom's actual RoomType.
4. Assignment must never implicitly rewrite price, `ReservationUnitNights`,
   reservation totals, ADR, historical commercial inventory, or the
   original promise made to the guest. A cross-RoomType assignment is a
   physical-allocation act; it never reaches back into the commercial layer
   (§8).

## 13. Money, guest compliance, OTA, and integration boundaries

- Booking/Reservation nightly price snapshots remain immutable commercial
  evidence at the `ReservationUnitNight` level, exactly as
  `ReservationNight` is immutable today (unchanged principle).
- `FolioEntries` are the financial posting/adjustment authority (TARGET,
  named entity, not designed in schema detail here). They record charges,
  payments, and adjustments; they never rewrite an accepted booking
  snapshot — a folio adjustment is a new posted entry, not a mutation of
  `ReservationUnitNight.UnitAmount`.
- Guest identity documents and Stay Declarations are separate concepts with
  distinct lifecycle, privacy, and compliance responsibilities (TARGET,
  named boundary only). Neither is designed in schema detail here.
- OTA integration preserves adapter boundaries, external-identity mapping,
  idempotency, inbox/outbox reliability, replay handling, and source
  attribution (TARGET boundary statement only).
- Adapter-specific OTA schema and behavior remain DEFERRED. No OTA adapter
  is designed or implemented by this work item (§14).

## 14. Realtime UX versus correctness

Realtime delivery of Calendar/Reservation Board updates to connected
operator UIs is an experience improvement, never the mechanism that
guarantees correctness. PostgreSQL transactions and the two exclusion
constraints in §11 remain authoritative regardless of whether, or how
quickly, any UI observer is notified of a change (restates §8 item 5,
§10's closing point, for completeness alongside the other boundary
statements in this section).

## 15. Scenario walkthroughs

These walkthroughs describe data authority and state movement only — no
API, command, migration, or UI implementation is specified.

### 15.1 Customer multi-RoomType hold and confirmation

A customer requests two RoomTypes for overlapping dates in one booking
attempt. One `InventoryHold` is created with two `InventoryHoldItems` (one
per RoomType), each with its own `InventoryHoldItemNight` rows. On
confirmation, each `InventoryHoldItem` maps 1:1 to a new `ReservationUnit`
under one `Reservation`, copying its nightly snapshots exactly as
`BookingHold.Confirm(...)` copies today's single-item snapshot — no re-read
of current rates, stop-sell, or sellable limits occurs at confirmation time.

### 15.2 Admin/walk-in reservation without a source hold

Front-desk staff create a `Reservation` directly for a walk-in guest. Its
`ReservationUnit`(s) have no source `InventoryHoldItem` reference at all.
The same commercial commitment authority and nightly-snapshot integrity
rules apply as if it had originated from a hold (§6 item 10) — there is no
separate, lighter-weight walk-in write path.

### 15.3 Initially unassigned or partially assigned reservation

A `Reservation` is confirmed with two `ReservationUnits`. At confirmation
time, no `RoomOccupancySegment` exists for either unit — the sale is
already commercially complete and enforceable via `ReservationUnitNight`
alone. Later, front-desk staff assign one unit to a specific PhysicalRoom
for its first three nights only, creating `Effective`
`ReservationAssignment` segments covering only those nights; the remaining
nights of that unit, and the entire second unit, stay unassigned. The
Calendar projection (§10) reflects exactly this partial coverage.

### 15.4 Front-desk room move requiring segment split

A guest occupying PhysicalRoom 101 for a 9-night stay needs to move to
PhysicalRoom 102 partway through. The existing 9-night `Effective`
`ReservationAssignment` segment on Room 101 is superseded (marked, not
deleted) and replaced by two new segments: a 5-night `Effective` segment on
Room 101 covering the nights already stayed/committed before the move, and
a 4-night `Effective` segment on Room 102 covering the remainder. The
underlying `ReservationUnitNight` rows, their prices, and the reservation's
ADR are unchanged by this split (§9).

### 15.5 Intentional cross-RoomType upgrade or downgrade

A `ReservationUnit` booked and priced as `DLX-KING` is, with authorization
and a recorded reason, assigned to a PhysicalRoom belonging to `FAMILY`.
The `ReservationUnit`'s commercial RoomType, price, and `ReservationUnitNight`
rows stay `DLX-KING` and unchanged; only the physical occupancy — the
`RoomOccupancySegment`'s PhysicalRoom reference — reflects the `FAMILY` room
(§12).

### 15.6 Multi-room operational block

Housekeeping needs three PhysicalRooms taken out of sellable service for
maintenance across the same date range. One `RoomBlock` header is created,
related to three `OperationalBlock`-type `RoomOccupancySegment` rows (one
per PhysicalRoom), all `Effective`. None references a `ReservationUnit`; the
PhysicalRoom schedule exclusion invariant (§11 item 1) still applies to each
segment individually.

### 15.7 Stay extension with new priced nights

A guest already checked in for a `ReservationUnit` covering 3 nights wants
to extend by 2 more nights. Two new `ReservationUnitNight` rows are added
with their own explicitly priced `UnitAmount`, appended to the existing
contiguous, half-open date range. The original 3 nights' snapshots are
untouched — no averaging, copying, or recalculation of already-accepted
nights occurs (§6 item 9).

### 15.8 Expired hold remaining logically harmless before cleanup

An `InventoryHoldItem`'s `ExpiresAtUtc` passes while no cleanup worker has
run yet. A concurrent availability read or a new hold attempt for the same
RoomType/night correctly excludes the expired item's demand at the exact
boundary instant, exactly as `BE-003.3`/`BE-003.5` already guarantee at the
Hold level today (§7). No overbooking or stale-demand risk exists merely
because cleanup has not yet executed.

### 15.9 Future OTA inbound reservation and outbound availability reaction

An OTA channel sends an inbound reservation notification through its
adapter boundary. The adapter maps the external identity, applies
idempotency/replay handling, and — once accepted — the reservation enters
the same `Reservation`/`ReservationUnit`/`ReservationUnitNight` commercial
authority as any other channel (§6 item 10), after which the platform
reacts by pushing an outbound availability update back through the same
adapter boundary. This scenario is named to show where the OTA boundary
attaches to the commercial model; the adapter itself remains entirely
DEFERRED (§14, §13) and is not designed here.

## 16. Approximate table-count estimate

The locked PMS core is estimated at approximately 27–30 domain tables. This
is an estimate for planning context only — it is not a required count, not
an acceptance target, and not a commitment that implementation must land at
exactly this number. The blueprint groups logical table families (catalog/
tenancy, commercial commitment, physical schedule, financial, guest
compliance, OTA integration) and names known conceptual entities; it does
not invent an exact speculative schema, column list, index design, API
surface, or migration sequence beyond the invariants stated in this document
and its two companion ADRs.

## 17. Deferred decisions and modules

The following remain intentionally excluded from this work item and require
separate future authorization before design or implementation begins:

- Adapter-specific OTA schema and behavior (§13, §15.9).
- Payments and refunds.
- Full housekeeping/maintenance modules beyond the `RoomBlock`/
  `OperationalBlock` boundary named in §9.
- Production migrations for any TARGET entity named in this document.
- Admin Calendar/PMS UI implementation.
- `DATA-001.2` (dormant/deferred, unrelated to this work item).
- Any other module not explicitly named as TARGET above.

## 18. Implementation boundary and related decisions

No table, column, constraint, entity, query, worker, endpoint, UI, or
adapter described in this document is implemented by this work item. Current
schema remains exactly the six migrations listed in §2. This document and
its two companion ADRs record the Owner-approved TARGET architecture so a
future, separately authorized implementation work item does not have to
re-derive it from chat history.

Related decisions:

- [ADR 0003 — Model hotel stays with half-open date ranges](../ADR/0003-model-hotel-stays-with-half-open-date-ranges.md)
  — half-open `[checkIn, checkOut)` semantics, extended unchanged to
  `InventoryHoldItemNight`/`ReservationUnitNight` (§6 item 6).
- [ADR 0004 — Compute effective inventory with daily controls](../ADR/0004-compute-effective-inventory-with-daily-controls.md)
  — base/effective-inventory formula that `RoomTypeDailyInventory` (§7)
  extends as a projection, not a rewrite.
- [ADR 0005 — Separate commercial commitment from physical allocation](../ADR/0005-separate-commercial-commitment-from-physical-allocation.md)
  — the Hold/Reservation item/unit decomposition and the commercial-versus-
  physical separation detailed in §6 and §8.
- [ADR 0006 — Schedule physical rooms with occupancy segments](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
  — the full `RoomOccupancySegment` model, exclusion invariants, and
  cross-RoomType assignment rules detailed in §9, §11, and §12.
