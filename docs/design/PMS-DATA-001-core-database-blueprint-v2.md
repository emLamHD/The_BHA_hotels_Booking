# PMS-DATA-001 — Core Database Blueprint v2

- **Status:** Approved TARGET architecture, partially implemented and
  relabeled inline. §6's commercial-commitment aggregate (`PMS-BE-001.1`,
  migration 7) and §7–§12's physical-room schedule database authority,
  availability formula, locking discipline, and internal mutation boundary
  (`PMS-BE-001.2`, migration 8) are now CURRENT / AS-BUILT — see ADR 0005,
  ADR 0006, and their linked completion reports for full evidence. Still
  TARGET: the multi-RoomType public request shape (§6 item 1);
  `Organization` (§3); direct Admin/walk-in/OTA unit creation without a
  source Hold (§6 items 6, 11) and stay extension (§6 item 10); an
  independent single-Unit cancellation entry point (§7);
  `RoomTypeDailyInventory` as a stored/closed-snapshot table (§7 rules 16,
  33–34); the Calendar/Reservation Board read projection (§10); real Staff
  identity/Admin RBAC (§12); and any HTTP/Admin/Calendar endpoint exposing
  this authority. Existing CURRENT entities and capabilities not superseded
  by the above remain implemented exactly as recorded in §2.
- **Date:** 2026-08-19. Partially implemented 2026-08-23 (`PMS-BE-001.1`)
  and 2026-08-26 (`PMS-BE-001.2`).
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
  seed is seed content, not a schema restriction. Within that schema, the
  commercial commitment authority is now (`PMS-BE-001.1`, migration 7) the
  normalized `InventoryHold → InventoryHoldItem → InventoryHoldItemNight`
  and `Reservation → ReservationUnit → ReservationUnitNight` model (ADR
  0005): every persisted Item/Unit represents exactly one room, with
  immutable nightly snapshots. The legacy `BookingHold`/`BookingHoldNight`/
  `ReservationNight` tables no longer exist — no dual-write, no dormant
  table. The public `/api/v1` contract is unchanged: a request still
  carries exactly one `RoomTypeId`, one `RatePlanId`, and `rooms = Q`,
  normalized atomically into `Q` independent Items/Units — CURRENT remains
  single-RoomType-**per-request**, and no booking spans more than one
  Property; the multi-RoomType **request** shape remains TARGET. What is
  genuinely absent is an `Organization`/tenant ownership and authorization
  boundary above `Property` (§3).
- Eight PostgreSQL migrations exist, ending at
  `20260826035254_PhysicalRoomScheduleAvailabilityAuthority`:
  1. `20260721175848_InitialPropertyRoomInventory`
  2. `20260722102552_AddRatePlanFoundation`
  3. `20260722112304_AddDailyRoomRates`
  4. `20260722121010_AddDailyInventoryControls`
  5. `20260723085814_CustomerBookingIdentity`
  6. `20260723105404_AddBookingHoldReservationFoundation`
  7. `20260823084717_CommercialCommitmentV2Foundation` (`PMS-BE-001.1`)
  8. `20260826035254_PhysicalRoomScheduleAvailabilityAuthority`
     (`PMS-BE-001.2`)
- `RoomOccupancySegment`/`RoomBlock` (ADR 0006, migration 8) now exist as
  the sole PhysicalRoom schedule authority: exactly two PostgreSQL exclusion
  constraints (`EX_RoomOccupancySegments_EffectiveRoomOverlap`,
  `EX_RoomOccupancySegments_EffectiveUnitOverlap`), two deferred constraint
  triggers (`SQLSTATE XBHA1`/`XBHA2`), `xmin`-based optimistic concurrency,
  and append-only `RoomOccupancySegmentAudit` history. Availability is
  block-adjusted and assignment-attributed (§7's formula is now CURRENT).
  Internal-only `IAssignmentMutationStore`/`IOperationalBlockMutationStore`
  mutation commands exist behind the application/persistence boundary — no
  HTTP/Admin/Calendar controller endpoint, no Staff identity, and no Admin
  RBAC model exist. See ADR 0006 and
  `docs/reports/PMS-BE-001.2-completion.md` for the exact as-built boundary.
- Availability committed demand is already expiry-aware:
  `Active Holds where ExpiresAtUtc > utcNow` plus `Confirmed Reservations`,
  evaluated against one server UTC instant, with no persisted `Expired`
  status and no background expiry cleanup — an active Hold already stops
  counting at the exact expiry boundary (`BE-003.3`, `BE-003.5`).
- Every Hold/Reservation/assignment/block mutation uses one explicit
  PostgreSQL transaction and parameterized `pg_advisory_xact_lock` calls,
  now routed through a shared `AdvisoryLockCoordinator` with one fixed
  class order (idempotency/transition lock, then `ReservationUnit` locks,
  then `RoomType` inventory-scope locks, then daily inventory locks; see
  `docs/ARCHITECTURE.md`).
- Admin Web (`Front_End/Admin_Web`) is a merged, template-only baseline
  (TailAdmin 2.3.0, Next.js 16.1.6, React/React DOM 19.2.1, TypeScript 5.9.3,
  PR #30) plus the `ADMIN-002.1` frontend prototype (mock-state only, see
  `docs/reports/ADMIN-002.1-completion.md`). It has no backend integration,
  no Admin authentication, and no real PMS,
  Reservation Board, Calendar, or OTA behavior — it does not call, and is
  not proven against, the `RoomOccupancySegment` authority above.
- No `Organization` entity, no `FolioEntries`, no Stay Declaration, and no
  OTA inbox/outbox exist anywhere in the current schema or codebase.

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
       │         source InventoryHoldItem; CommitmentStatus = Committed |
       │         Cancelled, §6 item 13)
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
| Unit commitment lifecycle | None — `Reservation`/`ReservationNight` has no unit-level status | `ReservationUnit.CommitmentStatus = Committed \| Cancelled`; only `Committed` unit nights create demand (§6 item 13, §7) |
| Calendar | None | Projection over reservations/units/nights/segments/blocks |

## 6. Commercial commitment model

> Implementation status (`PMS-BE-001.1`, migration 7): items 2, 3, 5, 7–9,
> and 12–13 below are CURRENT / AS-BUILT. Item 4's aggregate shape is
> CURRENT; its direct-creation clause is not. Items 1 (multi-RoomType
> request), 6 and 11 (direct Admin/walk-in/OTA unit creation without a
> source Hold), and 10 (stay extension) remain TARGET. See ADR 0005 and
> `docs/reports/PMS-BE-001.1-completion.md` for full evidence.

1. A customer booking supports multiple RoomTypes in one hold or reservation
   (TARGET — CURRENT is exactly one RoomType per Hold/Reservation request).
2. CURRENT (`PMS-BE-001.1`) hold aggregate: `InventoryHold → InventoryHoldItems →
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
4. CURRENT (`PMS-BE-001.1`) reservation aggregate shape:
   `Reservation → ReservationUnits → ReservationUnitNights`. A
   `ReservationUnit` represents exactly one commercially sold room; each
   `ReservationUnitNight` is its per-stay-date nightly row, carrying
   `RatePlanId` (§5). The following sentence is TARGET, not implemented: a
   `ReservationUnit` created directly (Admin, walk-in, or OTA, item 11)
   without a source Hold persists
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
13. Every `ReservationUnit` has an authoritative CURRENT (`PMS-BE-001.1`)
    commitment lifecycle: `CommitmentStatus = Committed | Cancelled`. Every
    successfully created unit — hold-confirmed, Admin, walk-in, or
    OTA-originated (item 11) — starts `Committed`. `Cancelled` is terminal
    within this decision; reinstatement/recommit requires a separately
    approved lifecycle and capacity-validation policy and remains DEFERRED
    (§17). Sibling units under the same Reservation may independently
    transition to `Cancelled` without affecting other `Committed` siblings —
    this extends item 12's independence to the commitment lifecycle itself.
    Cancellation never deletes or rewrites the unit, its
    `ReservationUnitNight` rows, prices, RatePlan lineage, guests, or source
    Hold lineage — all remain immutable historical evidence (§7 rule 17,
    §8). `CommitmentStatus` is a commercial-demand lifecycle only: it is
    never reused for `RoomOccupancySegment.Status`, guest check-in/out
    state, housekeeping state, payment/refund state, or OTA synchronization
    state (ADR 0005 Decision item 7, ADR 0006 Decision item 3).

## 7. Inventory/availability authority and hold-expiry correctness

> Implementation status (`PMS-BE-001.2`, migration 8): the block-adjusted,
> assignment-attributed availability formula, its shared locking discipline,
> the `RoomOccupancySegment`/`RoomBlock` database authority, the two
> PostgreSQL exclusion constraints and two deferred consistency triggers
> (§11 and the fourth invariant below), and internal assignment/block
> mutation are CURRENT / AS-BUILT, relabeled inline through §12. Still
> TARGET: `RoomTypeDailyInventory` as a separate materialized/closed-snapshot
> table (rules 16, 33–34 — the formula is computed on read, not stored or
> closed); the Calendar/Reservation Board read projection itself (§10); real
> Staff identity/Admin RBAC behind `ActorReference`/`AuthorizationEvidence`
> (§12); and any HTTP/Admin endpoint exposing this authority. See ADR 0006
> and `docs/reports/PMS-BE-001.2-completion.md` for full evidence.

`RoomTypeDailyInventory` is a future operational projection and a closed
historical snapshot — never a manually editable source of truth (TARGET).
Its role mirrors today's `AvailabilityDataSource` committed-demand read
(`BE-003.3`): a derived view over authoritative rows, never itself an
authority a caller can write to directly. The exact daily formula it
computes is defined below.

### Operational-block-adjusted daily availability formula (CURRENT — `PMS-BE-001.2`)

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
  = ReservationUnitNight demand whose sold RoomType is r, whose parent
    ReservationUnit.CommitmentStatus is Committed, and for whose
    ReservationUnit no Effective ReservationAssignment covers d

AssignedReservationDemand(p, r, d)
  = Effective ReservationAssignment room-nights covering d whose referenced
    PhysicalRoom's actual RoomType is r and whose referenced ReservationUnit
    has CommitmentStatus Committed (an Effective assignment can never
    reference a Cancelled unit, §9/ADR 0006 Decision item 3 — see rule 18)

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

**Unit cancellation and demand removal (CURRENT — `PMS-BE-001.2`, only as a
cascade of whole-Reservation cancellation — an independent single-Unit
cancellation entry point remains TARGET):**

17. `ReservationUnit.CommitmentStatus` (§6 item 13) gates every demand term
    above: `UnassignedReservationDemand` and `AssignedReservationDemand` —
    and therefore `OperationalCapacityDemand` — include only nights whose
    parent `ReservationUnit.CommitmentStatus == Committed`. A `Cancelled`
    unit's nights contribute zero demand to any RoomType bucket, on any
    date, regardless of whether they were previously unassigned or
    `Effective`-assigned.
18. An `Effective ReservationAssignment` is valid only when its referenced
    `ReservationUnit.CommitmentStatus == Committed`. No assignment may be
    created or activated for a `Cancelled` unit (§9, ADR 0006 Decision item
    3).
19. Cancelling a unit is a **demand-removal** operation, not a
    demand-transfer operation: it removes the unit's current demand from
    whichever one bucket supplied it immediately beforehand (its sold
    RoomType if unassigned, or the assigned PhysicalRoom's actual RoomType
    if `Effective`-assigned) and requires no destination or fallback
    capacity check — unlike a cross-RoomType reassignment (rules 20–24
    below), which does require one. In the same transaction, cancelling a
    unit atomically cancels/supersedes every `Effective
    ReservationAssignment` referencing it, so rule 18's invariant holds
    both before and after the transaction commits.
20. **Cross-RoomType assignment mutation remains operationally binding, not
    unconditionally reversible.** While the referenced unit remains
    `Committed`, an `Effective` cross-RoomType assignment cannot simply be
    cancelled and fall back to the sold RoomType, or reassigned to another
    PhysicalRoom, when that fallback/reassignment would overcommit usable
    operational capacity in the final post-operation state. There is no
    hidden sold-type rollback reserve, no reservation of a second room, and
    no persisted `EffectiveRoomTypeId`/transfer counter created merely to
    guarantee unconditional rollback (§8 item 3).
21. **Cross-type assigned → unassigned** is an existing-committed-demand
    allocation transfer for an already-`Committed` unit (rule 35), never new
    commercial demand. It succeeds only when the sold RoomType's final-state
    `OperationalCapacityDemand` — including the unit's demand returning to
    it — does not exceed `UsablePhysicalCapacity` for every affected date,
    evaluated against the final post-operation state. `ControlledCapacity`,
    `AvailableToSell`, `IsStopSell`, and `SellableLimit` govern acceptance of
    genuinely new demand (rule 25) and never themselves gate this transfer.
22. **Cross-type assigned → a different PhysicalRoom** atomically supersedes
    the current assignment with the replacement. Like rule 21, this is an
    existing-committed-demand allocation transfer, never new commercial
    demand. It succeeds only when the destination PhysicalRoom is usable
    (rule 36) and the destination RoomType's final-state
    `OperationalCapacityDemand` does not exceed `UsablePhysicalCapacity` for
    every affected date.
23. **Failure preserves the existing assignment.** If any destination or
    fallback date lacks capacity, the entire mutation transaction is
    rejected: the existing `Effective` assignment and its demand
    attribution remain exactly as they were; no delete-then-fail
    intermediate state is ever visible or committed.
24. **Same-RoomType assignment cancellation creates no bucket delta.**
    Cancelling a same-RoomType assignment while the unit remains `Committed`
    is not a cross-type rollback — demand stays in the same RoomType bucket
    before and after the mutation. It remains subject to the existing
    assignment/schedule/audit/concurrency invariants (§9), but requires no
    destination-capacity validation because no RoomType-pool delta occurs.
25. `SellableLimit` and `IsStopSell` govern acceptance of **new** demand.
    They do not, by themselves, prohibit moving an already-`Committed`
    guest to an otherwise usable PhysicalRoom — assignment mutation
    validation protects usable operational capacity and existing committed
    demand; it does not reinterpret stop-sell as a ban on front-desk
    movement (restates and extends the atomicity discussion below).
26. No emergency-overbooking path or override exists in this decision. A
    capacity-unsafe cross-type mutation is rejected outright, never forced
    through. An operator may therefore need to keep a guest's current
    physical assignment until another capacity-safe assignment or fallback
    becomes available — an explicit operational consequence of releasing
    (and potentially reselling) the sold-type capacity, not an implicit
    promise that rollback is always available.

**Reservation aggregate cancellation (CURRENT — `PMS-BE-001.2`):**

27. Cancelling one unit atomically, in one transaction: transitions that
    unit from `Committed` to `Cancelled`; cancels/supersedes every
    `Effective ReservationAssignment` referencing it (rule 19); removes its
    demand from whichever bucket supplied it (rule 19); preserves all
    unit/night and assignment history plus append-only audit evidence; and
    leaves sibling units unchanged when they remain `Committed` (§6 item
    13).
28. If the cancelled unit was the final `Committed` unit under its parent
    `Reservation`, that parent `Reservation` atomically transitions to
    `Cancelled` in the same transaction. A `Cancelled` Reservation can have
    no `Committed` unit and no `Effective ReservationAssignment` under any
    of its units.
29. A non-cancelled Reservation may contain a mixture of `Committed` and
    `Cancelled` sibling units; unit-level cancellation does not imply
    parent cancellation until no `Committed` unit remains (rule 28).
30. Whole-Reservation cancellation atomically transitions every remaining
    `Committed` unit to `Cancelled`, cancels/supersedes every remaining
    `Effective ReservationAssignment`, and removes all corresponding
    current/open demand in the same transaction.
31. Unit and Reservation cancellation participate in the same shared
    deterministic `(PropertyId, RoomTypeId, StayDate)` locking discipline as
    every other capacity/demand-changing operation (see Atomicity and
    locking below), even though cancellation itself never needs destination
    or fallback capacity — this ensures a concurrent sale or mutation
    against the same key observes one atomic result.
32. This decision defines only the data/inventory effect after a whole-unit
    or whole-Reservation cancellation has already been determined valid by
    a future authorized workflow. It does not invent cancellation
    eligibility, authorization, notice periods, fees, refund calculation,
    no-show handling, early departure, partial-night cancellation, or
    guest-removal UX — all remain DEFERRED (§17).

**Open projection versus closed history (TARGET):**

33. A valid assignment mutation or unit/Reservation cancellation recomputes
    only current/open `RoomTypeDailyInventory` projection state (rule 16).
    Closed historical daily snapshots are never rewritten by later
    cancellation, assignment mutation, audit correction, or status change.
34. Commercial unit/night rows, historical assignment segments, and
    append-only audit evidence remain preserved regardless of cancellation.
    `Cancelled` assignment rows remain historical and create no current
    physical-room attribution; `Cancelled` units remain historical and
    create no current committed demand (rule 17).

**New demand versus existing committed-demand allocation transfer
(CURRENT — `PMS-BE-001.2`):**

35. Hold creation, and any direct (Admin/walk-in/OTA) reservation creation
    that adds new committed room-night demand (§6 item 11), are new
    commercial demand: they are validated against `ControlledCapacity`,
    `AvailableToSell`, `IsStopSell`, and `SellableLimit` (rule 25) under
    ordinary daily sales controls and the existing atomic
    concurrency/locking discipline. By contrast, an assignment mutation for
    an already-`Committed` unit — create/activate, unassigned → assigned,
    assigned → unassigned, assigned → a different PhysicalRoom, or a
    split/move/supersede that changes RoomType attribution — transfers the
    unit's one existing demand bucket; it creates no additional committed
    room-night and is never validated as a new sale. Such a transfer
    succeeds only when the final post-operation `OperationalCapacityDemand`
    does not exceed `UsablePhysicalCapacity` for every affected
    `(PropertyId, RoomTypeId, StayDate)` key (rules 20–24) — it is never
    gated by `ControlledCapacity`/`AvailableToSell`, which govern acceptance
    of new demand only. `IsStopSell`/`SellableLimit` alone never prohibit
    moving an already-`Committed` guest to a usable PhysicalRoom (rule 25);
    after a successful transfer, `AvailableToSell` is recomputed under
    ordinary daily controls and clamps to zero when there is no remaining
    controlled headroom for new demand.
36. **Destination PhysicalRoom usability (assignment create, activate,
    move, or supersede — same-RoomType or cross-RoomType).** For every such
    mutation with a destination PhysicalRoom, that destination must:
    have `OperationalStatus == Active`; carry no overlapping `Effective
    ReservationAssignment`; carry no overlapping `Effective
    OperationalBlock`; belong to the same Property as the occupancy segment
    and the referenced `ReservationUnit` (§9, ADR 0006 Decision item 3);
    satisfy the booked-night coverage invariant for the referenced unit (§9,
    ADR 0006 Decision item 9); and reference a unit whose `CommitmentStatus
    == Committed` (rule 18). A same-RoomType move creates no RoomType-bucket
    delta (rule 24) and therefore requires no RoomType headroom validation —
    but "no headroom validation" never means "no destination validation": a
    same-RoomType destination must still satisfy every condition above. If a
    validly assigned PhysicalRoom later becomes non-`Active`, the existing
    `Effective` assignment does not disappear automatically (rule 9) — this
    rule governs destination selection at mutation time, not an automatic
    relocation workflow, which remains undesigned (§17). For assigned →
    unassigned there is no destination PhysicalRoom; any cross-type fallback
    to the sold RoomType instead remains subject to rule 21's final-state
    capacity check.

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

**Atomicity and locking (CURRENT — `PMS-BE-001.2`, via the shared
`AdvisoryLockCoordinator`; the PhysicalRoom-operational-status/
`DailyInventoryControl` bullet below remains TARGET).** The formula above is not a read-only
afterthought layered on independent writers. Every future write path capable
of changing capacity or demand for the same `(PropertyId, RoomTypeId,
StayDate)` key participates in one shared atomic availability/locking
discipline, extending the existing `BE-003.3`–`BE-003.5` advisory-lock
pattern to at least:

- Hold creation and any direct (Admin/walk-in/OTA) reservation path that
  creates new committed demand (§6 item 11);
- `ReservationAssignment` create, activate, split, move, cancel, or
  supersede (§9), which shifts operational capacity attribution between the
  sold RoomType and an actual RoomType, subject to rules 20–26's
  operationally-binding, capacity-validated mutation policy;
- `ReservationUnit` cancellation and whole-`Reservation` cancellation
  (rules 17–19, 27–30), which remove demand rather than transfer it and
  require no destination/fallback capacity check;
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
  bucket (rule 24);
- unassigned sold DLX → assigned FAMILY: this is an existing-committed-demand
  allocation transfer for an already-`Committed` unit (rule 35), never new
  commercial demand — demand leaves DLX operational capacity and enters
  FAMILY capacity, subject to FAMILY's final-state `OperationalCapacityDemand`
  not exceeding `UsablePhysicalCapacity` (rule 22 governs the reverse
  direction's capacity check); it is never gated by `AvailableToSell`/
  `ControlledCapacity`, which govern acceptance of genuinely new demand
  (rule 25, rule 35);
- assigned FAMILY → unassigned: demand leaves FAMILY and returns to sold DLX
  **only when** the unit-night remains `Committed` (rule 17) **and** DLX has
  final-state usable capacity for it (rule 21) — otherwise the mutation is
  rejected and the FAMILY assignment is preserved unchanged (rule 23);
- assigned FAMILY → assigned SUITE: demand moves from FAMILY to SUITE only
  when SUITE has final-state usable capacity (rule 22); otherwise rejected
  with the FAMILY assignment preserved (rule 23);
- move between two PhysicalRooms of the same actual RoomType: no RoomType
  pool delta (rule 24), while the physical schedule exclusion invariant
  still applies;
- unit cancellation while `Effective`-assigned: demand leaves whichever
  bucket supplied it and is removed entirely, not transferred — no
  destination/fallback capacity check applies (rules 17–19, 27).

The operation must not commit a final state that overcommits usable
physical capacity for an affected destination or fallback RoomType/date
unless a future, separately approved overbooking/override policy explicitly
permits it — no such override is authorized here (restates rules 20, 23,
26: capacity-unsafe mutations are rejected outright, never forced through,
and a rejected mutation always preserves the prior `Effective` assignment
unchanged). `SellableLimit` and
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
   (`RoomOccupancySegment`) are independent inventory layers
   (CURRENT — `PMS-BE-001.2`).
2. A commercial reservation can be fully assigned, partially assigned, or
   entirely unassigned to PhysicalRooms without losing its booked
   RoomType/nights — the authoritative commercial record is the unit's
   `ReservationUnitNight` rows together with its `CommitmentStatus` (§6 item
   13; ADR 0005 Decision item 4), never row existence alone: a `Committed`
   unit's sale is complete and enforceable regardless of physical assignment
   state; physical assignment is a separate, later operational act.
   Independence is bounded, not unlimited: any zero,
   partial, or full physical assignment is only ever valid within the
   referenced unit's sold nightly coverage — every `Effective`
   `ReservationAssignment` segment must be fully covered by that unit's
   `ReservationUnitNight` dates (§9, ADR 0006 Decision item 9). Separation
   means physical allocation can never rewrite commercial nights and can
   never create occupancy outside them. Assignment is also bounded by the
   unit's commitment lifecycle (§6 item 13): an `Effective`
   `ReservationAssignment` is valid only against a `Committed` unit, and
   cancelling a unit atomically cancels its assignments in the same
   transaction (§7 rules 17–19, 27).
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
  PhysicalRoom schedule (CURRENT — `PMS-BE-001.2`).
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
- An `Effective` `ReservationAssignment` may reference only a `ReservationUnit`
  whose `CommitmentStatus` is `Committed` (§6 item 13, §7 rule 18) — no
  assignment may be created or activated against a `Cancelled` unit.
  Cancelling a unit atomically cancels/supersedes every `Effective`
  assignment referencing it in the same transaction (§7 rules 19, 27).
- Every `RoomOccupancySegment` belongs to exactly one Property, and every
  reference it populates must resolve inside that same Property: the
  referenced PhysicalRoom is always in the segment's Property; a
  `ReservationAssignment`'s referenced `ReservationUnit`/Reservation is
  always in that same Property; an `OperationalBlock`'s referenced
  `RoomBlock` header is always in that same Property. This same-Property
  consistency is database-enforced (CURRENT — `PMS-BE-001.2`, via composite
  alternate-key foreign keys), not merely an authorization or
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

**CURRENT — `PMS-BE-001.2`, migration 8.** PostgreSQL enforces both
exclusion invariants below; application-level prechecks alone are not the
sole mechanism (full detail in
[ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)):

1. **PhysicalRoom schedule exclusion**
   (`EX_RoomOccupancySegments_EffectiveRoomOverlap`) — two `Effective`
   occupancy segments can never overlap on the same PhysicalRoom, regardless
   of segment type (`ReservationAssignment` vs. `OperationalBlock`).
2. **ReservationUnit allocation exclusion**
   (`EX_RoomOccupancySegments_EffectiveUnitOverlap`) — two `Effective`
   `ReservationAssignment` segments can never overlap for the same
   `ReservationUnit`, preventing one sold unit from occupying two rooms over
   the same dates.

Both invariants use half-open date ranges, consistent with ADR 0003's
existing `[checkIn, checkOut)` stay model. Both remain exactly two exclusion
invariants — no third exclusion constraint exists. The implementation:
`btree_gist` PostgreSQL extension; a raw-SQL migration for the exclusion
constraints (EF Core does not generate `EXCLUDE` constraints natively);
`23P01` mapped to safe, specific application errors by exact constraint name
only — never a raw database error surfacing to a caller; and real PostgreSQL
integration tests, never EF InMemory or SQLite, consistent with
`docs/DATABASE.md`'s testing policy.

**A separate, third temporal-integrity rule — not a third exclusion
invariant — additionally applies (CURRENT):** every `Effective`
`ReservationAssignment` segment's dates must be a subset of its
`ReservationUnit`'s persisted `ReservationUnitNight` dates (§9; full detail
in [ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
Decision item 9). The two exclusion invariants above prevent segments from
overlapping each other; this coverage rule separately prevents an
`Effective ReservationAssignment` from occupying dates that were never
commercially sold. It is enforced by a `DEFERRABLE INITIALLY DEFERRED`
constraint trigger (`thebha_check_booked_night_coverage`, `SQLSTATE
XBHA1`) that validates the final committed transaction state — an ordinary
`CHECK` constraint cannot express a cross-table rule — so a transaction may
pass through a transient intermediate state as long as the final state at
`COMMIT` satisfies it.

**A separate structural invariant — same-Property reference consistency —
also applies to every `RoomOccupancySegment` (CURRENT), independent of the
exclusion invariants and the booked-night coverage rule above:** a
segment's PhysicalRoom and its populated `ReservationUnit`/`RoomBlock`
reference must always belong to the same Property (§9; full detail in
[ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
Decision item 3). This is a reference-consistency requirement, not an
overlap/exclusion rule and not a temporal-coverage rule — it does not
replace, and is not replaced by, tenant/property-scoped authorization checks
made above the database. It is enforced through composite foreign
keys/alternate keys on `PropertyId` (`PhysicalRoom` gained a
`(PropertyId, Id)` alternate key for this in migration 8), not an
application-only precheck.

**A fourth, separate invariant class — unit-commitment consistency —
governs the relationship between `ReservationUnit.CommitmentStatus`,
parent `Reservation` status, and `Effective ReservationAssignment` rows
(CURRENT; §6 item 13, §7 rules 17–19 and 27–30; full detail in
[ADR 0006](../ADR/0006-schedule-physical-rooms-with-occupancy-segments.md)
Decision items 3 and 5):** an `Effective` assignment may reference only a
`Committed` unit; cancelling a unit atomically cancels its assignments and
removes its demand; and a `Cancelled` Reservation can have no `Committed`
unit or `Effective` assignment under it. This is a lifecycle-consistency
requirement, distinct from the exclusion, booked-night-coverage, and
same-Property invariants above. It is enforced by a second `DEFERRABLE
INITIALLY DEFERRED` constraint trigger
(`thebha_check_unit_commitment_consistency`, `SQLSTATE XBHA2`) that
validates the final committed state across unit status, Reservation status,
and assignment rows under concurrent writers, exactly as for the other
invariants in this section.

## 12. Intentional cross-RoomType assignment

1. A `ReservationUnit` may deliberately be assigned to a PhysicalRoom whose
   RoomType differs from the commercially booked RoomType — supporting
   intentional upgrades and downgrades (CURRENT — `PMS-BE-001.2`, the
   mutation mechanics and capacity/audit rules below; gated by a mandatory
   `AuthorizationEvidence`/`Reason` pair, which is an opaque authorization
   string recorded into the audit trail, not real Staff identity or Admin
   RBAC — those remain TARGET). Cross-RoomType assignment is valid only
   **within the same Property** as
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
   released, without any change to the commercial record. An `Effective`
   cross-RoomType assignment is **operationally binding** for its covered
   nights: unassigning it or reassigning it elsewhere is not unconditional
   — it succeeds only when the sold-type fallback or the new destination
   RoomType has enough final-state usable operational capacity; otherwise
   the mutation is rejected and the current assignment is preserved
   unchanged (§7 rules 20–26). There is no hidden rollback reserve and no
   overbooking override — an operator may need to keep the current
   assignment until a capacity-safe alternative exists.
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
time, no `RoomOccupancySegment` exists for either unit — both units start
`Committed` (§6 item 13), and the sale is already commercially complete and
enforceable via their `ReservationUnitNight` rows together with that
`CommitmentStatus` (ADR 0005 Decision item 4), not via row existence alone.
Later, front-desk staff assign one unit to a specific PhysicalRoom
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

**Cross-RoomType mutation is operationally binding, not unconditionally
reversible (§7 rules 20–26):**

1. Committed sold DLX, unassigned → `Effective`-assigned to FAMILY: DLX
   demand is released; FAMILY demand is consumed, subject to FAMILY having
   final-state usable capacity.
2. Committed sold DLX, FAMILY-assigned → unassigned, while DLX has usable
   headroom for the unit's demand: the mutation is allowed atomically —
   FAMILY demand is released and DLX demand returns.
3. The same unassign attempted while DLX **lacks** headroom: rejected
   atomically; the FAMILY assignment and its attribution remain unchanged —
   no partial or intermediate state is committed.
4. Committed sold DLX, FAMILY-assigned → reassigned to a SUITE PhysicalRoom
   with SUITE headroom available: one atomic supersede; demand moves
   FAMILY → SUITE in the same transaction.
5. The same move attempted without SUITE headroom: rejected; the FAMILY
   assignment remains exactly as it was.
6. Same-RoomType assigned DLX → unassigned DLX: no RoomType-bucket delta at
   all; ordinary mutation/audit/concurrency rules still apply, but no
   destination-capacity check is required.
7. `IsStopSell` on SUITE, with one otherwise-usable free SUITE PhysicalRoom,
   does not by itself forbid moving an already-`Committed` guest there — it
   still forbids **new** SUITE sellability under the existing daily-control
   rules (§7 rule 25).
8. No transition above ever creates a second demand bucket, a hidden
   sold-type rollback reserve, or an implicit overbooking override — a
   capacity-unsafe mutation is always rejected outright (§7 rule 26).

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

### 15.10 Unit and Reservation cancellation (§6 item 13, §7 rules 17–19, 27–30)

A `Reservation` is confirmed with exactly two `ReservationUnits`; each
starts `Committed` and its nights create demand under its sold RoomType.

1. Immediately after creation, both units are `Committed` and their nights
   count as demand.
2. Front-desk cancels the first of the two units. Only that unit's demand
   is removed; the remaining sibling stays `Committed` and unaffected; the
   parent `Reservation` remains non-cancelled because one `Committed` unit
   remains.
3. The cancelled first unit had been `Effective`-assigned to a FAMILY
   PhysicalRoom: cancellation atomically cancels/supersedes that assignment
   and releases FAMILY demand in the same transaction — no fallback demand
   is created under the sold RoomType, because the unit's demand is
   removed, not transferred (rule 19).
4. Later, front-desk cancels the remaining (second) unit. Because this is
   now the cancellation of the final `Committed` unit, the parent
   `Reservation` atomically transitions to `Cancelled` in the same
   transaction (rule 28).
5. Equivalently, an operator may cancel the whole `Reservation` directly
   instead of the two sequential unit cancellations above: every remaining
   `Committed` unit transitions to `Cancelled`, every remaining `Effective`
   assignment is cancelled/superseded, and all corresponding current demand
   is removed — atomically, in one transaction (rule 30).
6. An attempt to create or activate a `ReservationAssignment` against
   the already-`Cancelled` first unit is rejected (§9, rule 18).
7. The `Cancelled` units' `ReservationUnitNight` snapshots (prices, RatePlan
   lineage, dates) and their `Cancelled` assignment history remain in the
   database as immutable evidence; they create no current committed demand
   or physical-room attribution (rule 34).
8. Closed historical `RoomTypeDailyInventory` snapshots for dates already
   in the past when these cancellations occur are not rewritten — only the
   current/open projection reflects the cancellations (rule 33).

This scenario defines only the inventory/demand effect of a cancellation
already determined valid by a future authorized workflow; it does not
decide cancellation eligibility, fees, refunds, no-show handling, or early
departure (§17).

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
- Payments, refunds, and cancellation fee calculation.
- Cancellation eligibility, authorization, and notice-period policy.
- Partial-night cancellation (only whole-unit and whole-Reservation
  cancellation are defined, §7 rules 17–19, 27–30).
- No-show handling and early departure.
- Reinstatement/recommit of a `Cancelled` `ReservationUnit` (§6 item 13).
- Emergency overbooking and any overbooking-override policy (§7 rules 20,
  26).
- Full housekeeping/maintenance modules beyond the `RoomBlock`/
  `OperationalBlock` boundary named in §9.
- Production migrations for any TARGET entity named in this document.
- Admin Calendar/PMS UI implementation.
- `DATA-001.2` (dormant/deferred, unrelated to this work item).
- Any other module not explicitly named as TARGET above.

## 18. Implementation boundary and related decisions

No table, column, constraint, entity, query, worker, endpoint, UI, or
adapter described in this document was implemented by the docs-only work
item that authored it (`PMS-DATA-DOCS-001`); current schema at that time
remained exactly the six migrations listed in §2. This document and its two
companion ADRs recorded the Owner-approved TARGET architecture so a future,
separately authorized implementation work item would not have to re-derive
it from chat history.

That future work item, `PMS-BE-001.1` (migration 7,
`CommercialCommitmentV2Foundation`), has since implemented the §6 commercial
commitment Item/Unit decomposition (`InventoryHold → InventoryHoldItem →
InventoryHoldItemNight`, `Reservation → ReservationUnit →
ReservationUnitNight`) for the existing single-RoomType-per-request public
contract — see ADR 0005's "Current-versus-target boundary" section for the
exact item-by-item CURRENT/TARGET split. Every other table, constraint,
worker, endpoint, UI, and adapter in this document — §7's
`OperationalBlock`/assignment-attribution formula, §9–§12's
`RoomOccupancySegment`/`RoomBlock`/cross-RoomType assignment (ADR 0006), the
multi-RoomType **public request** shape, §10's Calendar/Reservation Board
projection UI, and §13's OTA/FolioEntries/Stay Declaration boundaries —
remains entirely TARGET, not implemented.

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
