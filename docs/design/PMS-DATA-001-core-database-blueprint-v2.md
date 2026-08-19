# PMS-DATA-001 — Core Database Blueprint v2

- **Status:** Approved TARGET architecture. The newly proposed TARGET
  entities, relationships, constraints, and changes described below are not
  implemented. Existing CURRENT entities and capabilities remain implemented
  exactly as recorded in §2; this docs-only work item creates no schema or
  product behavior.
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

- The BHA Hotels Booking currently implements an explicit `Property`
  aggregate and a **multi-property-capable, property-scoped** schema:
  `RoomType`, `PhysicalRoom`, `RatePlan`, rates, inventory controls,
  `BookingHold`, and `Reservation` all carry `PropertyId` with
  property-consistency foreign keys (e.g. `(PropertyId, RoomTypeId) →
  RoomTypes(PropertyId, Id)`), property-scoped indexes, and
  `(Property, RoomType, stay date)` advisory-lock identities. This is a data
  model capable of storing multiple Property rows today — it is not an
  implicit single-Property design, and the current single-row development
  seed is seed content, not a schema restriction. Within that schema, each
  current `BookingHold`/`BookingHoldNight` and `Reservation`/
  `ReservationNight` (`BE-003.1`–`BE-003.5`) still captures exactly **one
  Property, one RoomType, and one RatePlan per booking**, with immutable
  nightly snapshots — CURRENT remains single-RoomType-per-booking, and no
  booking spans more than one Property. What is genuinely absent is an
  `Organization`/tenant ownership and authorization boundary above
  `Property` (§3).
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
   scoped (TARGET). CURRENT already has database-level `Property` identity
   and property-consistency integrity (§2) — every RoomType, RatePlan,
   Hold, and Reservation is bound to its owning `PropertyId` by foreign key,
   and `GET /api/v1/properties/{propertyId}/availability` is already
   property-addressed. What CURRENT does not have is `Organization`
   ownership of a Property, tenant membership, or organization-scoped
   authorization/isolation above that existing property boundary. Tenant
   isolation must be enforced at application/domain boundaries and by
   PostgreSQL integrity where practical — this is a design requirement for
   the eventual `Organization` boundary, not a claim that Property-level
   scoping itself is new.
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
       │    └─ InventoryHoldItem (references a RoomType; represents
       │         exactly one held room — a multi-room request is
       │         normalized into multiple items, §6 item 2)
       │         └─ InventoryHoldItemNight (per stay date; carries RatePlanId)
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
availability-reaction boundary and remain DEFERRED (§17).

## 5. Current-versus-target vocabulary map

| Concept | CURRENT | TARGET |
| --- | --- | --- |
| Tenant/property scope | Explicit `Property` aggregate; multi-property-capable, property-scoped schema/FKs/indexes; no `Organization`/tenant boundary above it | `Organization → Property` with tenant ownership/authorization layered above the existing Property scope |
| Commercial hold | `BookingHold`/`BookingHoldNight`, one RoomType per Hold | `InventoryHold → InventoryHoldItems → InventoryHoldItemNights`; each item is one held room, so multiple rooms and multiple RoomTypes per Hold |
| Commercial reservation | `Reservation`/`ReservationNight`, one RoomType per Reservation | `Reservation → ReservationUnits → ReservationUnitNights` |
| Physical schedule | None — no PhysicalRoom-level schedule exists | `RoomOccupancySegments`, authoritative PhysicalRoom schedule |
| Rate attachment | `RatePlanId` on the Hold/Reservation aggregate | `RatePlanId` on both `InventoryHoldItemNight` and `ReservationUnitNight`, copied exactly 1:1 on confirmation |
| Calendar | None | Projection over reservations/units/nights/segments/blocks |

## 6. Commercial commitment model

1. A customer booking supports multiple RoomTypes in one hold or reservation
   (TARGET — CURRENT is exactly one RoomType per Hold/Reservation).
2. TARGET hold aggregate: `InventoryHold → InventoryHoldItems →
   InventoryHoldItemNights`. A persisted `InventoryHoldItem` represents
   **exactly one held room** of one RoomType — its business cardinality is
   implicit quantity `1`. It is never modeled as a compressed cart line
   carrying a `Quantity > 1`. A room-type line at the request/UI boundary
   may carry a convenience `quantity = Q` (`Q >= 1`); in the same
   Hold-creation transaction that request line is atomically normalized
   into exactly `Q` independent, persisted `InventoryHoldItems` before any
   confirmation or persistence semantics apply — normalization is not a
   later reconciliation step. Each `InventoryHoldItemNight` is the
   per-stay-date nightly row under one item, mirroring today's per-night
   snapshot discipline (uniqueness, contiguity, exact coverage, decimal
   money, nightly multiplication, UTC-instant creation) at the item level
   instead of the Hold level, and additionally persists the exact
   `RatePlanId` selected and priced for that night. RatePlan lineage is
   never inferred from price alone at any later point — two RatePlans may
   quote the same amount for the same RoomType/night, and the amount cannot
   distinguish them; only the persisted `RatePlanId` can. For a stay of `N`
   nights, one item owns exactly `N` nights; a `Q`-room, `N`-night request
   line therefore produces `Q × N` item-night rows, each with its own
   `RatePlanId` (see the worked example in §15.1).
3. Hold-creation request idempotency/fingerprinting (`BE-003.3`'s existing
   discipline, extended) includes the canonical request-level `quantity`
   for each RoomType line. A replay of an already-succeeded idempotent
   request returns the same, already-normalized set of `InventoryHoldItems`
   — it never appends additional items on top of a prior successful
   normalization.
4. TARGET reservation aggregate: `Reservation → ReservationUnits →
   ReservationUnitNights`. A `ReservationUnit` represents exactly one
   commercially sold room; each `ReservationUnitNight` is its per-stay-date
   nightly row, carrying `RatePlanId` (§5). A `ReservationUnit` created
   directly (Admin, walk-in, or OTA, item 11) without a source Hold persists
   its own selected `RatePlanId` on every `ReservationUnitNight` it creates
   — the same nightly lineage rule applies regardless of origin; there is
   no weaker rate-lineage path for direct creation.
5. Confirmation maps each `InventoryHoldItem` to exactly one
   `ReservationUnit`, and each `InventoryHoldItemNight` to exactly one
   corresponding `ReservationUnitNight` for the same stay date — the
   existing one-to-one Hold→Reservation confirmation discipline (`BE-003.4`)
   extends unchanged to the item/unit level. Full Hold confirmation creates
   one `Reservation` and every item-derived `ReservationUnit` atomically, in
   one transaction: there is no partial confirmation, no missing unit for an
   existing item, no duplicate unit for the same item, and no later append
   of a unit onto an already-confirmed Reservation from the same Hold.
   Confirmation copies each `InventoryHoldItemNight`'s persisted
   `RatePlanId` exactly to its corresponding `ReservationUnitNight` — it
   never infers RatePlan from the accepted amount, RoomType, or a
   current-rate re-read, and it never reprices. This holds even if the
   selected RatePlan's current rate has changed since Hold creation: the
   Hold's persisted `RatePlanId` and accepted money snapshot are copied
   as-is (see §15.1 for a worked example).
6. A `ReservationUnit` may have no source hold — Admin, walk-in, or OTA
   reservation creation may bypass a source hold entirely, leaving its
   `SourceInventoryHoldItemId` null. Where present, that reference is
   unique, mirroring the existing unique `SourceHoldId` constraint at the
   aggregate level today, and it preserves direct one-item-to-one-unit
   lineage rather than any quantity-to-generated-unit reconciliation.
7. Existing half-open stay semantics remain unchanged at the night level:
   `[checkIn, checkOut)`. Checkout is never priced and never consumes a
   room-night (ADR 0003, unchanged).
8. Existing nightly uniqueness/contiguity/exact-coverage, decimal-money,
   nightly multiplication, UTC-instant creation, and immutable-snapshot
   rules remain foundational at the new Item/Unit-Night level exactly as
   they operate at today's Hold/Reservation-Night level. Price snapshots on
   `InventoryHoldItemNight` and `ReservationUnitNight` are per room, per
   night — unambiguously so, since one item/unit is always exactly one
   room. Each nightly row's immutable snapshot includes both its accepted
   money amount and its `RatePlanId`; the two are persisted and copied
   together and neither is ever derived from the other. Hold and
   Reservation totals are the sum of all persisted item-night/unit-night
   rows; there is no separate per-unit-versus-aggregate price representation
   to reconcile.
9. Active-hold expiry correctness must not depend on the expiry worker
   running on time (unchanged principle from `BE-003.3`/`BE-003.5`).
   `ExpiresAtUtc` belongs to the `InventoryHold` aggregate, not to an
   individual `InventoryHoldItem` — every item under a Hold expires together
   with that Hold. Authoritative queries and transitions exclude the items
   of an expired Hold at the exact `ExpiresAtUtc` boundary; a background
   cleanup process remains operational hygiene only, never a correctness
   dependency.
10. Stay extension adds explicitly priced extension nights onto a
    `ReservationUnit`, each with its own explicitly selected `RatePlanId`
    persisted on its new `ReservationUnitNight`. It never silently copies,
    averages, or recalculates previously accepted `ReservationUnitNight`
    rows, including their existing `RatePlanId` values — extension nights
    may select a different RatePlan than the original nights without
    altering any already-accepted night.
11. Admin, walk-in, and OTA reservation creation may bypass a source hold,
    but every such `ReservationUnit` still enters the same commercial
    commitment authority, nightly-snapshot discipline, and integrity rules
    as a hold-confirmed unit, including persisting its own selected
    `RatePlanId` on every night it creates (item 4) — there is no separate,
    weaker write path.
12. Items/units normalized from the same original request line are
    independent business rows from the moment they are persisted. They may
    diverge — in occupancy, guest assignment, special requests, nightly
    price, stay-extension history, cancellation, or physical-room
    assignment (ADR 0006) — without any split or reconciliation operation,
    because they were never compressed into one multi-room row to begin
    with.

## 7. Inventory/availability authority and hold-expiry correctness

`RoomTypeDailyInventory` is a future operational projection and a closed
historical snapshot — never a manually editable source of truth (TARGET).
Its role mirrors today's `AvailabilityDataSource` committed-demand read
(`BE-003.3`): a derived view over authoritative rows, never itself an
authority a caller can write to directly. The exact daily formula it
computes is defined below.

### Operational-block-adjusted daily availability formula (TARGET)

The formula distinguishes two different questions. **Commercial record**
(what RoomType and price were sold) lives on `ReservationUnit`/
`ReservationUnitNight` and never changes because of physical assignment
(§8, §12). **Operational capacity attribution** (which RoomType pool
currently supplies a given physical room-night, for availability purposes
only) is a derived, per-date projection rule below — it is never a
persisted `EffectiveRoomTypeId`, counter, or commercial rewrite.

For one Property `p`, RoomType `r`, StayDate `d`, and server instant
`utcNow`:

```text
BaseInventory(p, r, d)
  = count of PhysicalRooms for p/r with OperationalStatus = Active
    (ADR 0004, unchanged)

OperationalBlockedRooms(p, r, d)
  = count of distinct PhysicalRoomId, among the PhysicalRooms already
    counted in BaseInventory(p, r, d), that carry an Effective
    OperationalBlock segment covering d under the half-open
    [StartDate, EndDate) rule

UsablePhysicalCapacity(p, r, d)
  = max(0, BaseInventory(p, r, d) - OperationalBlockedRooms(p, r, d))

ControlledCapacity(p, r, d)
  = 0                                                  if IsStopSell = true
  = min(UsablePhysicalCapacity(p, r, d), SellableLimit) if SellableLimit is present
  = UsablePhysicalCapacity(p, r, d)                     otherwise

ActiveHoldDemand(p, r, d, utcNow)
  = InventoryHoldItemNight demand for held RoomType r whose parent Hold is
    Active and has ExpiresAtUtc > utcNow (a Hold has no ReservationAssignment
    path, so it always attributes to the held/sold RoomType)

UnassignedReservationDemand(p, r, d)
  = committed ReservationUnitNight demand whose sold RoomType is r and for
    whose ReservationUnit no Effective ReservationAssignment covers d

AssignedReservationDemand(p, r, d)
  = Effective ReservationAssignment room-nights covering d whose referenced
    PhysicalRoom's actual RoomType is r

OperationalCapacityDemand(p, r, d, utcNow)
  = ActiveHoldDemand(p, r, d, utcNow)
    + UnassignedReservationDemand(p, r, d)
    + AssignedReservationDemand(p, r, d)

AvailableToSell(p, r, d, utcNow)
  = max(0, ControlledCapacity(p, r, d) - OperationalCapacityDemand(p, r, d, utcNow))
```

**Operational capacity attribution rules — exactly one bucket per
reservation room-night, never zero and never two:**

1. If no `Effective ReservationAssignment` covers a committed unit/date, its
   demand counts against its commercially booked (sold) RoomType
   (`UnassignedReservationDemand`, or `ActiveHoldDemand` for Holds, which
   never have an assignment path).
2. If one `Effective ReservationAssignment` covers a unit/date, its demand
   counts against the assigned PhysicalRoom's actual RoomType
   (`AssignedReservationDemand`) and is **not** also counted against the
   sold RoomType for operational availability that date.
3. A same-RoomType assignment therefore remains exactly one unit in the
   same bucket — assignment never doubles a room's counted demand.
4. A cross-RoomType assignment moves only the operational capacity
   attribution for its covered dates: sold-type capacity is released and
   actual-type capacity is consumed. It never mutates or reclassifies the
   commercial RoomType, price, ADR, revenue reporting, source lineage, or
   historical commercial inventory (§8, §12) — this attribution rule and
   commercial immutability are not in tension; they answer different
   questions.
5. Attribution is nightly: a partially assigned or split unit may consume
   its sold RoomType on unassigned dates and the assigned PhysicalRoom's
   actual RoomType on assigned dates, changing by date exactly as the
   underlying `Effective` segment coverage changes.
6. A `Cancelled` assignment supplies no actual-room attribution. If the
   reservation night still counts as committed demand, it falls back to the
   sold RoomType the instant no `Effective` assignment covers that date.
7. The ReservationUnit allocation exclusion invariant (§11 item 2) and the
   PhysicalRoom schedule exclusion invariant (§11 item 1) together guarantee
   at most one `Effective` assignment per unit/date and at most one
   `Effective` segment per PhysicalRoom/date — making the one-bucket
   classification above unambiguous and preventing an assignment from ever
   being counted twice.
8. `OperationalBlock` remains a capacity-side deduction applied before
   controls (rules 9–13 below); a `ReservationAssignment` is never
   re-labelled as a block. An `Effective OperationalBlock` and an
   `Effective ReservationAssignment` can never cover the same
   PhysicalRoom/date, because the existing PhysicalRoom schedule exclusion
   invariant already forbids that overlap.
9. If an assigned PhysicalRoom later becomes non-`Active`, it drops out of
   `BaseInventory`, but its still-`Effective` assignment remains visible in
   `AssignedReservationDemand` — availability must clamp to zero/surface
   insufficient capacity rather than make the occupancy silently disappear.
   No relocation workflow is designed here.

**Block-counting and capacity-ordering rules:**

10. An `OperationalBlock` covers date `d` under the existing half-open rule
    `StartDate <= d < EndDate`; the block's end date is not itself blocked,
    consistent with ADR 0003.
11. Only `Type == OperationalBlock` and `Status == Effective` segments
    participate in `OperationalBlockedRooms`. `Cancelled` block history
    never reduces current or future availability.
12. Each distinct blocked PhysicalRoom is counted at most once per date. One
    multi-room `RoomBlock` (§9) therefore contributes one deduction per
    distinct affected PhysicalRoom — never one deduction for the header row,
    and never an arbitrary aggregate quantity. A PhysicalRoom already
    excluded from `BaseInventory` (`Inactive`/`OutOfService`) is never
    subtracted a second time merely because an `Effective` block row also
    exists for it.
13. Base physical capacity is reduced by blocks **before** `SellableLimit`
    is applied: `UsablePhysicalCapacity = BaseInventory -
    OperationalBlockedRooms`, then `ControlledCapacity =
    min(UsablePhysicalCapacity, SellableLimit)`. `SellableLimit` is an
    absolute cap on that already-reduced usable capacity, never an
    independent quantity subtracted a second time alongside blocked rooms.
    `IsStopSell` remains dominant and always yields zero controlled
    capacity regardless of blocks or limits. The general relationship
    (clamping to non-negative understood) is:
    `min(BaseInventory, SellableLimit) - OperationalBlockedRooms <=
    min(BaseInventory - OperationalBlockedRooms, SellableLimit)` — the
    selected order is correct because a block changes usable physical
    capacity first and `SellableLimit` is then a sales cap on that usable
    capacity, not because the alternative order can over-offer (see the
    worked example below for the exact, corrected failure modes of each
    alternative).
14. `OperationalCapacityDemand` is subtracted only after operational
    capacity and daily controls are resolved into `ControlledCapacity`.
    Hold expiry still uses one server-side `utcNow` and the exact
    `ExpiresAtUtc > utcNow` boundary already established (below, and
    `BE-003.3`/`BE-003.5`).
15. Stay-level sellability is the minimum `AvailableToSell` across every
    requested stay date; a request for `Q` rooms may succeed only when
    every requested date has `AvailableToSell >= Q`.
16. `RoomTypeDailyInventory` for a future date is the current derived
    projection above, recomputed as `Effective` assignments, blocks, and
    demand change. A closed historical snapshot for a past date retains the
    block-adjusted and attribution-adjusted values that were closed for
    that date; later cancellation, audit correction, or block/assignment
    history must never rewrite an already-closed past snapshot. No storage
    column, refresh mechanism, or snapshot schema is designed by this
    documentation work item.

**Worked example** (extends §15.6): 10 active PhysicalRooms for a RoomType,
3 of them under an `Effective OperationalBlock` for the date in question, a
`SellableLimit` of 8, and 4 rooms of `OperationalCapacityDemand`:

```text
BaseInventory                                     10
Effective OperationalBlock rooms                   3
UsablePhysicalCapacity = 10 - 3                     7
SellableLimit                                       8
ControlledCapacity = min(7, 8)                      7
OperationalCapacityDemand                           4
AvailableToSell = max(0, 7 - 4)                     3   <- correct result
```

A new request for 4 rooms on this date is rejected; a request for up to 3
may proceed, subject to the same result holding on every requested stay
date and to the atomic concurrency check below. The two alternative
orderings have different, and different-natured, failure modes — neither is
used, and for different reasons:

```text
Omitting the block entirely:
  min(BaseInventory, SellableLimit) - demand = min(10, 8) - 4 = 4
  -> over-offers by 1 relative to the correct 3, because only 7 rooms are
     physically usable and 4 are already consumed (7 - 4 = 3, not 4).

Subtracting the block after an already-binding limit:
  min(BaseInventory, SellableLimit) - block - demand = min(10, 8) - 3 - 4 = 1
  -> under-sells by 2 relative to the correct 3; this ordering caps at the
     limit (8) before the block is applied, so the block then removes
     capacity that was never actually offered up to 7, not capacity that
     "no longer exists" — it does not over-offer.
```

The selected order (`ControlledCapacity = min(BaseInventory -
OperationalBlockedRooms, SellableLimit)`, rule 13) is the one that produces
the physically and commercially correct result of 3 in both directions.

**Cross-RoomType attribution example** (full detail in §15.5): a unit
commercially sold as `DLX-KING` and `Effective`-assigned to a `FAMILY`
PhysicalRoom counts once in `AssignedReservationDemand(FAMILY)` for its
assigned dates and zero times in `UnassignedReservationDemand(DLX-KING)` for
those same dates — the sold RoomType's operational capacity is released and
the actual RoomType's operational capacity is consumed, while the unit's
commercial RoomType/price/reporting remain `DLX-KING` throughout (rule 4).

**Atomicity and locking (TARGET).** The formula above is not a read-only
afterthought layered on independent writers. Every future write path capable
of changing capacity or demand for the same `(PropertyId, RoomTypeId,
StayDate)` key participates in one shared atomic availability/locking
discipline, extending the existing `BE-003.3`–`BE-003.5` advisory-lock
pattern to at least:

- Hold creation and any direct (Admin/walk-in/OTA) reservation path that
  creates new committed demand (§6 item 11);
- `ReservationAssignment` create, activate, split, move, cancel, or
  supersede (§9), which shifts operational capacity attribution between the
  sold RoomType and an actual RoomType;
- activation, creation, split, move, cancellation, or date/room change of an
  `OperationalBlock` segment;
- capacity-affecting PhysicalRoom operational-status changes and
  `DailyInventoryControl` changes, once those TARGET write paths are
  separately designed.

For a multi-room, multi-date, or assignment-mutation operation, every
affected `(PropertyId, RoomTypeId, StayDate)` key is derived, de-duplicated,
and locked in deterministic order within one explicit transaction —
mirroring `BookingAdvisoryLockKeys.ForInventory`'s existing ascending-order
discipline. For a `ReservationAssignment` mutation specifically, the
affected keys include the commercially sold RoomType key, the old assigned
PhysicalRoom's actual RoomType key when present, and the new assigned
PhysicalRoom's actual RoomType key when present. Under the locks, the
transaction evaluates the final post-operation nightly attribution once —
never a transient intermediate delete-then-insert state — so a legitimate
atomic swap or move is not rejected merely because of how it is represented
mid-transaction:

- unassigned → same-type assigned: demand remains one unit in the same
  bucket;
- unassigned sold DLX → assigned FAMILY: demand leaves DLX operational
  capacity and enters FAMILY capacity;
- assigned FAMILY → unassigned: demand leaves FAMILY and returns to sold DLX
  if the unit-night remains committed;
- assigned FAMILY → assigned SUITE: demand moves from FAMILY to SUITE;
- move between two PhysicalRooms of the same actual RoomType: no RoomType
  pool delta, while the physical schedule exclusion invariant still applies.

The operation must not commit a final state that overcommits usable
physical capacity for an affected destination or fallback RoomType/date
unless a future, separately approved overbooking/override policy explicitly
permits it — no such override is authorized here. `SellableLimit` and
`IsStopSell` govern new sellability, not whether an existing guest may be
physically moved to an otherwise usable free room: new Hold/direct-
reservation demand is accepted against `AvailableToSell`/`ControlledCapacity`
as documented, while assignment mutation protects actual usable physical
capacity and all already-committed/unassigned demand without treating
stop-sell alone as a prohibition on a front-desk room move; after any
mutation, `AvailableToSell` is recomputed with daily controls and clamps to
zero when controlled headroom is exhausted. Whether an emergency block that
would drive existing demand above newly reduced controlled capacity is
rejected outright or accepted with a recorded operational deficit is a
business policy this correction does not decide; at minimum, the projection
must clamp `AvailableToSell` to zero and refuse additional new demand while
capacity is insufficient — it must not silently choose a broader
conflict-resolution or relocation workflow. Exact advisory-lock hash
construction, SQL function, API contract, EF mapping, DDL, or error payload
remain implementation details for a separately authorized work item and are
not invented here.

The expiry-boundary correctness rule already proven today (`BE-003.3`,
`BE-003.5`) — `Active Holds where ExpiresAtUtc > utcNow` counted, expired
Holds excluded at the exact instant, no persisted `Expired` status required
for correctness — extends unchanged to the new `InventoryHoldItem`/
`InventoryHoldItemNight` shape, with `ExpiresAtUtc` remaining a property of
the `InventoryHold` aggregate (§6 item 9), not of an individual item — every
item under a Hold shares its parent Hold's single expiry instant. An
expired-but-uncleaned Hold and its items remain logically harmless before
any operational cleanup runs, exactly as an expired-but-uncleaned Hold is
harmless today.

## 8. Commercial commitment versus physical allocation

1. Commercial commitment (`Reservation`/`ReservationUnit`/
   `ReservationUnitNight`) and PhysicalRoom allocation
   (`RoomOccupancySegment`) are independent inventory layers (TARGET).
2. A commercial reservation can be fully assigned, partially assigned, or
   entirely unassigned to PhysicalRooms without losing its booked
   RoomType/nights — the sale is complete and enforceable the moment
   `ReservationUnitNight` rows exist; physical assignment is a separate,
   later operational act. Independence is bounded, not unlimited: any zero,
   partial, or full physical assignment is only ever valid within the
   referenced unit's sold nightly coverage — every `Effective`
   `ReservationAssignment` segment must be fully covered by that unit's
   `ReservationUnitNight` dates (§9, ADR 0006 Decision item 9). Separation
   means physical allocation can never rewrite commercial nights and can
   never create occupancy outside them.
3. `RoomTypeDailyInventory` is a projection/closed snapshot (§7), never a
   competing writable authority. "Independent inventory layers" (item 1)
   means physical allocation never rewrites a `ReservationUnitNight` row or
   the commercial RoomType it records — it does not mean physical allocation
   is invisible to availability. `RoomTypeDailyInventory`'s operational
   capacity attribution (§7) deliberately follows an `Effective
   ReservationAssignment` to the assigned PhysicalRoom's actual RoomType for
   availability purposes on that date, precisely so an occupied room cannot
   also be sold; this is a derived projection effect, not a mutation of any
   commercial row.
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
- Every `RoomOccupancySegment` belongs to exactly one Property, and every
  reference it populates must resolve inside that same Property: the
  referenced PhysicalRoom is always in the segment's Property; a
  `ReservationAssignment`'s referenced `ReservationUnit`/Reservation is
  always in that same Property; an `OperationalBlock`'s referenced
  `RoomBlock` header is always in that same Property. This same-Property
  consistency is database-enforced (TARGET), not merely an authorization or
  UI check — see [ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
  Decision item 3 for the full invariant and its enforcement boundary.
- Multi-room operational blocks use one `RoomBlock` header related to one or
  more occupancy segments, and that header's PhysicalRooms are always in one
  Property — a `RoomBlock` can never span Properties (ADR 0006 Decision
  item 4).
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
- For every `Effective` `ReservationAssignment` segment `s` referencing unit
  `u`, `AssignedDates(s)` (the segment's `[StartDate, EndDate)` dates) must
  be a subset of `BookedDates(u)` (the exact set of dates with a persisted
  `ReservationUnitNight` for `u`) — an exact nightly-row coverage rule, not
  only a comparison against the unit's earliest and latest booked dates.
  Full coverage is never required; partial and unassigned coverage remain
  valid. `Cancelled` segments and `OperationalBlock` segments (which are not
  backed by a `ReservationUnit`) are outside this rule. Full detail,
  including stay-extension and stay-shortening handling, is in
  [ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
  Decision item 9.

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
- The Calendar/Reservation Board assumes and requires valid source rows. It
  must never silently clip or normalize an `Effective ReservationAssignment`
  segment whose dates fall outside its unit's booked coverage (§9, ADR 0006
  Decision item 9) — doing so would hide corruption in the authoritative
  PhysicalRoom schedule instead of surfacing it. An out-of-coverage segment
  is an architecture-level defect, not a display detail for the projection
  to paper over.

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
existing `[checkIn, checkOut)` stay model. Both remain exactly two exclusion
invariants — no third exclusion constraint is added.

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

**A separate, third temporal-integrity rule — not a third exclusion
invariant — additionally applies:** every `Effective` `ReservationAssignment`
segment's dates must be a subset of its `ReservationUnit`'s persisted
`ReservationUnitNight` dates (§9; full detail in
[ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
Decision item 9). The two exclusion invariants above prevent segments from
overlapping each other; this coverage rule separately prevents an
`Effective ReservationAssignment` from occupying dates that were never
commercially sold, closing a gap the exclusion invariants alone do not
cover. Its future implementation boundary requires a database-enforced
cross-table mechanism that validates the final committed transaction state
(e.g. a deferrable constraint trigger, or an equivalently rigorous design)
— an ordinary `CHECK` constraint cannot express a cross-table rule, and an
application-only precheck is not sufficient as the sole correctness
mechanism under concurrent writers. It requires the same explicit
transaction and per-unit locking discipline as the exclusion invariants,
plus real PostgreSQL integration tests. Exact trigger/constraint design,
SQLSTATE mapping, and error contract remain implementation details for a
separately authorized work item; none is created by this documentation
work item.

**A separate structural invariant — same-Property reference consistency —
also applies to every `RoomOccupancySegment`, independent of the exclusion
invariants and the booked-night coverage rule above:** a segment's
PhysicalRoom and its populated `ReservationUnit`/`RoomBlock` reference must
always belong to the same Property (§9; full detail in
[ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
Decision item 3). This is a reference-consistency requirement, not an
overlap/exclusion rule and not a temporal-coverage rule — it does not
replace, and is not replaced by, tenant/property-scoped authorization checks
made above the database. Its future implementation boundary requires
property-scoped composite foreign keys/alternate keys where the schema
already exposes `PropertyId` on the relevant nodes, or an equivalently
rigorous database-enforced mechanism where it does not; an application-only
precheck alone is insufficient under concurrent writers, exactly as for the
other invariants in this section. No exact column, constraint name, or
migration is created by this documentation work item.

## 12. Intentional cross-RoomType assignment

1. Authorized front-desk staff may deliberately assign a `ReservationUnit`
   to a PhysicalRoom whose RoomType differs from the commercially booked
   RoomType — supporting intentional upgrades and downgrades (TARGET).
   Cross-RoomType assignment is valid only **within the same Property** as
   the sold `ReservationUnit`'s Reservation (§9, ADR 0006 Decision item 3)
   — it never authorizes cross-Property assignment, even between two
   Properties under the same `Organization`, sharing a RoomType code, or
   both accessible to the operator. A cross-Property guest transfer is a
   different business operation and is not designed or authorized by this
   work item.
2. Cross-RoomType assignment requires authorization, a recorded reason, and
   audit evidence — it is never a silent or anonymous action.
3. The commercial/sold RoomType remains the booked RoomType for pricing,
   reporting, and the customer's original commitment. Physical occupancy
   follows the assigned PhysicalRoom's actual RoomType — and so does that
   room-night's operational capacity attribution in `RoomTypeDailyInventory`
   for as long as the assignment stays `Effective` (§7, §8 item 3): the
   assigned-type room becomes unsellable and the sold-type capacity is
   released, without any change to the commercial record.
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
  is designed or implemented by this work item (§17).

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
attempt, one room of each RoomType. At the request/UI boundary this is two
RoomType lines, each with `quantity = 1`; the Hold-creation transaction
normalizes each line into one persisted `InventoryHoldItem` (§6 item 2),
producing one `InventoryHold` with two `InventoryHoldItems` (one per
RoomType), each with its own `InventoryHoldItemNight` rows. On confirmation,
each `InventoryHoldItem` maps 1:1 to a new `ReservationUnit` under one
`Reservation`, copying its nightly snapshots exactly as
`BookingHold.Confirm(...)` copies today's single-item snapshot — no re-read
of current rates, stop-sell, or sellable limits occurs at confirmation time.

A request line may instead carry a `quantity` greater than one for a single
RoomType. For example, a request for 3 Deluxe rooms across 5 nights is
normalized, atomically within the same Hold-creation transaction, into 3
independent, persisted `InventoryHoldItems` (§6 item 2) — never one item
carrying a `Quantity = 3` field:

```text
Request: 3 Deluxe rooms for 5 nights

Persisted Hold:
- 1 InventoryHold
- 3 InventoryHoldItems, each representing one Deluxe room
- 15 InventoryHoldItemNights

Confirmed result:
- 1 Reservation
- 3 ReservationUnits, each sourced 1:1 from one Hold item
- 15 ReservationUnitNights
```

Each of the 3 items/units is an independent business row from the moment it
is persisted — they may later diverge in occupancy, guest assignment,
nightly price, or physical-room assignment without any split or
reconciliation operation, because they were never compressed into one
multi-room row to begin with (§6 item 12). A replay of the same idempotent
3-room request returns the same 3 already-normalized items; it never
appends a further 3 (§6 item 3).

**RatePlan lineage example** (§6 items 2, 5, 8): two RatePlans, `STANDARD`
and `PROMO-STANDARD`, both quote the same Deluxe night at the same amount.
A Hold is created selecting `PROMO-STANDARD`; each of its
`InventoryHoldItemNight` rows persists `RatePlanId = PROMO-STANDARD` next to
its accepted money snapshot — the amount alone could not later distinguish
`PROMO-STANDARD` from `STANDARD`, only the persisted `RatePlanId` can. If
`PROMO-STANDARD`'s current rate changes before the Hold is confirmed,
confirmation still copies the Hold's persisted `RatePlanId`
(`PROMO-STANDARD`) and its originally accepted money snapshot exactly to the
new `ReservationUnitNight` rows — it performs no current-rate re-read and
never reprices or silently switches to `STANDARD`.

### 15.2 Admin/walk-in reservation without a source hold

Front-desk staff create a `Reservation` directly for a walk-in guest. Its
`ReservationUnit`(s) have no source `InventoryHoldItem` reference at all.
The same commercial commitment authority and nightly-snapshot integrity
rules apply as if it had originated from a hold (§6 item 11) — there is no
separate, lighter-weight walk-in write path.

### 15.3 Initially unassigned or partially assigned reservation

A `Reservation` is confirmed with two `ReservationUnits`. At confirmation
time, no `RoomOccupancySegment` exists for either unit — the sale is
already commercially complete and enforceable via `ReservationUnitNight`
alone. Later, front-desk staff assign one unit to a specific PhysicalRoom
for its first three nights only, creating `Effective`
`ReservationAssignment` segments covering only those nights — the assigned
first three nights are exactly three existing `ReservationUnitNight` dates
already booked for that unit, demonstrating that a partial-subset
assignment (a proper subset of `BookedDates(u)`, §9, ADR 0006 Decision item
9) is valid without requiring full coverage; the remaining nights of that
unit, and the entire second unit, stay unassigned. The Calendar projection
(§10) reflects exactly this partial coverage.

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

This same assignment has an operational-availability effect distinct from
the commercial record above (§7's attribution rules). Consider `FAMILY` with
exactly one active, usable PhysicalRoom and no other demand: once the
`DLX-KING`-sold unit is `Effective`-assigned to that room, the assigned
date's demand counts once in `AssignedReservationDemand(FAMILY)` and zero
times in `UnassignedReservationDemand(DLX-KING)` — `FAMILY`'s
`AvailableToSell` for that date becomes zero, correctly preventing the
system from also selling that now-occupied room, while `DLX-KING`'s
operational capacity for that date is simultaneously released back for sale.
The unit's commercial RoomType, price, and reporting remain `DLX-KING`
throughout; only the operational capacity pool that the room-night draws
from has moved.

By contrast, a `DLX-KING` unit `Effective`-assigned to a `DLX-KING`
PhysicalRoom (a same-RoomType assignment) counts exactly once in
`AssignedReservationDemand(DLX-KING)` — never once as unassigned sold demand
plus once again as assigned demand. An unassigned night on the same unit (no
`Effective` assignment covering it) reverts to counting under its sold
RoomType, `UnassignedReservationDemand(DLX-KING)`, for that date only.

### 15.6 Multi-room operational block

Housekeeping needs three PhysicalRooms taken out of sellable service for
maintenance across the same date range. One `RoomBlock` header is created,
related to three `OperationalBlock`-type `RoomOccupancySegment` rows (one
per PhysicalRoom), all `Effective`. None references a `ReservationUnit`; the
PhysicalRoom schedule exclusion invariant (§11 item 1) still applies to each
segment individually.

The three blocked PhysicalRooms are not merely excluded from the physical
schedule — they also reduce `RoomTypeDailyInventory`'s
`UsablePhysicalCapacity` for their RoomType on every date the block covers
(§7's operational-block-adjusted formula). Against 10 active PhysicalRooms
of that RoomType, a `SellableLimit` of 8, and 4 rooms of existing
`OperationalCapacityDemand`, §7's worked example shows `AvailableToSell`
correctly landing at `max(0, min(7, 8) - 4) = 3` — not the `4` that omitting
the block entirely would incorrectly offer, and not the `1` that subtracting
the block after an already-binding limit would incorrectly withhold. The
block reduces usable physical capacity before the sellable limit and
operational demand are applied, so new holds or reservations cannot oversell
the two remaining blocked rooms' worth of capacity.

### 15.7 Stay extension with new priced nights

A guest already checked in for a `ReservationUnit` covering 3 nights wants
to extend by 2 more nights. Two new `ReservationUnitNight` rows are added
with their own explicitly priced `UnitAmount` and their own explicitly
selected `RatePlanId` — which may differ from the original 3 nights' RatePlan
— appended to the existing contiguous, half-open date range. The original 3
nights' snapshots, including their `RatePlanId` values, are untouched — no
averaging, copying, or recalculation of already-accepted nights occurs (§6
item 10). If an existing `Effective`
`ReservationAssignment` segment is being extended to cover the 2 new
nights, that extension is only valid once the 2 priced
`ReservationUnitNight` rows exist — before or atomically with the segment
change, in the same transaction. An assignment covering the extension
dates without their corresponding `ReservationUnitNight` rows is invalid
(§9, ADR 0006 Decision item 9): physical assignment may never anticipate a
future commercial extension.

### 15.8 Expired hold remaining logically harmless before cleanup

An `InventoryHold`'s `ExpiresAtUtc` passes while no cleanup worker has run
yet — every `InventoryHoldItem` under that Hold expires together with it
(§6 item 9). A concurrent availability read or a new hold attempt for the
same RoomType/night correctly excludes all of the expired Hold's items'
demand at the exact boundary instant, exactly as `BE-003.3`/`BE-003.5`
already guarantee at the Hold level today (§7). No overbooking or
stale-demand risk exists merely because cleanup has not yet executed.

### 15.9 Future OTA inbound reservation and outbound availability reaction

An OTA channel sends an inbound reservation notification through its
adapter boundary. The adapter maps the external identity, applies
idempotency/replay handling, and — once accepted — the reservation enters
the same `Reservation`/`ReservationUnit`/`ReservationUnitNight` commercial
authority as any other channel (§6 item 11), after which the platform
reacts by pushing an outbound availability update back through the same
adapter boundary. This scenario is named to show where the OTA boundary
attaches to the commercial model; the adapter itself remains entirely
DEFERRED (§13, §17) and is not designed here.

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
  `InventoryHoldItemNight`/`ReservationUnitNight` (§6 item 7).
- [ADR 0004 — Compute effective inventory with daily controls](../ADR/0004-compute-effective-inventory-with-daily-controls.md)
  — base/effective-inventory formula that `RoomTypeDailyInventory` (§7)
  extends as a projection, not a rewrite.
- [ADR 0005 — Separate commercial commitment from physical allocation](../ADR/0005-separate-commercial-commitment-from-physical-allocation.md)
  — the Hold/Reservation item/unit decomposition and the commercial-versus-
  physical separation detailed in §6 and §8.
- [ADR 0006 — Schedule physical rooms with occupancy segments](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
  — the full `RoomOccupancySegment` model, exclusion invariants, and
  cross-RoomType assignment rules detailed in §9, §11, and §12.
