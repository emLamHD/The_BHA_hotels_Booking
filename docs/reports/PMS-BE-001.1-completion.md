# PMS-BE-001.1 — Commercial Commitment V2 Foundation — Completion Report

```text
STATUS: PASS — CLOSED

WORK_ITEM: PMS-BE-001.1
TITLE: Commercial Commitment V2 Foundation
PR: https://github.com/emLamHD/The_BHA_hotels_Booking/pull/35 (MERGED)
FEATURE_HEAD: 9e25f7cb6247420467957061a13c04801ce9b3c7
MERGE_COMMIT: 265d10006b219e456c30ed92bbb6c153a946944d
MERGED_AT: 2026-08-24T16:46:46Z
BASE_BRANCH: develop
```

## 1. What was delivered

Replaced the single-RoomType `BookingHold`/`BookingHoldNight`/
`Reservation`/`ReservationNight` commercial-commitment authority with the
ADR 0005 normalized model:

- `InventoryHold → InventoryHoldItem → InventoryHoldItemNight`
- `Reservation → ReservationUnit → ReservationUnitNight`

Every persisted Item/Unit represents exactly one physical room (no
`Quantity`/`Rooms` field anywhere on Item/Unit/Night). Every nightly row
carries its own `RatePlanId` and accepted money independently.
`ReservationUnit.CommitmentStatus = Committed | Cancelled` is the sole
committed-demand predicate. Cancellation is whole-Reservation only:
cancelling atomically transitions every still-`Committed` Unit to
`Cancelled` in one transaction (no independent per-Unit cancel endpoint).
Every Item/Unit/Night table is property-scoped via a `(PropertyId, Id)`
alternate key plus `(PropertyId, <FK>)` composite foreign keys, so
cross-property references are PostgreSQL-rejected, not just
application-checked.

## 2. Migration and downgrade behavior

Seventh migration, `20260823084717_CommercialCommitmentV2Foundation`, one
PostgreSQL transaction: expand (five new tables) → transform (deterministic
MD5-derived-UUID backfill of every legacy Hold/Reservation row into `Q`
Items/Units, ordinal-paired 1:1 with the source) → contract (drop legacy
tables/columns). A fail-fast `DO $$` validation block checks counts,
duplicate ids, source Item→Unit mapping, accepted-money totals, and
Property consistency before the contract step runs. No PostgreSQL
extension installed; the id-derivation helper is a `pg_temp` function.
Migrations 1–6 were not modified.

The guarded `Down()` reconstructs the legacy shape only when a
Hold/Reservation's Items/Units are legacy-representable (one RoomType, one
RatePlan across the *entire* aggregate); otherwise it raises and leaves all
normalized data intact. A Codex-found `[P1]` gap — the original guard
checked RatePlan uniformity per stay-date instead of per aggregate, so a
Hold with RatePlan A on night 1 and RatePlan B on night 2 could downgrade
and silently lose lineage — was fixed before merge (Correction
`PMS-BE-001.1-C1`): both guards now `GROUP BY` the Hold/Reservation id
alone. Legacy `BookingHolds`/`BookingHoldNights`/`Reservations.RoomTypeId`/
`RatePlanId`/`Rooms`/`ReservationNights` are dropped in the same
transaction as the transform — no dual-write, no dormant normalized table.

## 3. Public API compatibility

The public `/api/v1` contract is byte-identical. `BookingHoldDto`,
`BookingHoldNightDto`, `ReservationDto`, `ReservationNightDto`, every
controller, and every status code are unchanged — no file under
`TheBha.Application/Bookings` or `TheBha.Api/Controllers` was touched.
Values are now projected from the normalized rows instead of the legacy
aggregate. The public request shape is unchanged too: exactly one
RoomType/RatePlan per Hold/Reservation request, normalized into `Q`
independent Items/Units internally (multi-RoomType **request** shape
remains TARGET, not implemented by this work item). CSRF, idempotency,
guest-access-token, and authenticated-ownership behavior are unchanged.

## 4. Availability, confirmation, cancellation, idempotency

Committed demand counts every `InventoryHoldItemNight` of an `Active`,
unexpired Hold and every `ReservationUnitNight` of a `Committed` Unit,
exactly once — verified both by the adapted test suite and, independently,
by this closeout's own manual acceptance run (§6), which reconstructed the
raw pre-clamp demand aggregation in SQL to rule out a masked double-count.
Confirmation maps each Item to one Unit 1:1, copying the persisted
`RatePlanId`/`UnitAmount` without repricing or re-reading current rates.
Create/confirm/cancel replay remains idempotent (existing BE-003.3/BE-003.4
replay and boundary tests pass unchanged in behavior); concurrent
same-hold-confirmation and concurrent overlapping-multi-night-confirmation
tests each complete without deadlock and produce exactly one Reservation.

## 5. Test evidence

```text
UNIT_TESTS: 243/243 PASS
POSTGRESQL_INTEGRATION_TESTS: 257/257 PASS
  (includes CommercialCommitmentV2MigrationTests: 6/6 PASS, +2 added by
  Correction C1 to cover the cross-night RatePlan guard)
CUSTOMER_WEB_TESTS: 298/298 PASS
EF_PENDING_MODEL_CHANGES: clean
GITHUB_CI: PASS (Admin, Backend, Frontend, PR #35)
FINAL_CODEX_REVIEW: PASS, no discrete actionable correctness issue
  remaining after Correction C1 (Owner/OC-confirmed context — this
  repository relays Codex results through Owner/OC, not PR comments, so
  this is not independently re-derivable from a GitHub comment trail).
```

The unit/integration/migration counts were independently reproduced during
`PMS-BE-001.1-DOCS-CLOSEOUT`, built directly from the merged commit against
real PostgreSQL 17 — matching the counts above exactly.

## 6. Manual acceptance (Owner-requested, this closeout)

Performed against the live merged commit and real PostgreSQL 17 (a
disposable, migration-7-applied database isolated from `thebha_dev`), using
the exact API sequence `Front_End/Customer_Web` calls. Case: 2 rooms × 2
nights.

- Search: `requestedRooms=2`, `availableRooms=2`, `totalAmount=6,000,000 VND`.
- Hold: 1 `InventoryHold`, 2 `InventoryHoldItems`, 4
  `InventoryHoldItemNights`; `SUM(UnitAmount)` = `InventoryHolds.TotalAmount`.
- Confirm: 1 `Reservation`, 2 `ReservationUnits`, 4
  `ReservationUnitNights`, 2 **distinct** `SourceInventoryHoldItemId`
  values, all Units `Committed`, `SUM(UnitAmount)` = `Reservations.TotalAmount`.
- Post-confirm availability: raw committed-demand aggregation (reconstructed
  in SQL, pre-clamp) = exactly 2 rooms/night, not 4 — no double-count
  between the now-`Confirmed` Hold and the `Committed` Reservation Units.
- Cancel: both Units → `Cancelled`; Night rows (`RatePlanId`, `UnitAmount`,
  `StayDate`) byte-for-byte unchanged; availability returns to
  `availableRooms=2`.

All 5/5 criteria PASS. Evidence collected via direct API calls (CSRF →
search → hold → confirm → cancel), not a browser click-through — the
Claude-in-Chrome extension was not connected in this session.

## 7. Exclusions / remaining TARGET boundary

Not implemented by this work item (all remain TARGET, documented by
`PMS-DATA-DOCS-001`, locked pending a separate future Master Execution
Prompt): multi-RoomType **request** shape (item/unit persistence already
supports it; the public request does not yet), physical-room allocation
(`RoomOccupancySegment`/`RoomBlock`, ADR 0006), PostgreSQL exclusion
constraints/`btree_gist`, `Organization` entity, OTA adapter/inbox/outbox,
`FolioEntries`/payments, backend-integrated Admin Calendar/PMS. `DATA-001.2`
remains dormant/deferred. `Front_End/Admin_Web`'s Reservation Board
(`ADMIN-002.1`) remains a browser-memory-only mock prototype, never wired
to this backend.

## 8. Known risks

- The deterministic Item/Unit id generation (MD5-derived UUID from
  `(source aggregate id, ordinal)`) has an astronomically low but
  theoretical collision probability; the migration's fail-fast validation
  block would raise on any such collision before the contract step runs,
  rather than silently corrupting data.
- The guarded `Down()` is exercised by automated tests and one manual
  adversarial scenario, but not at production scale; it is a rollback
  safety net, not a supported forward operational path.

## 9. Governance note

This work item's Draft PR and Codex-review handoff produced four
documentation corrections (`PMS-BE-001.1-DOCS-CLOSEOUT-C1` through `-C4`)
to the repository's checkout/worktree governance itself — unrelated to the
product delivered above, which was unaffected throughout. Full history of
those corrections is in `docs/daily/2026-08/2026-08-25-worklog.md` and the
PR #36 timeline; it is not repeated here, per this report's scope as a
product-delivery summary rather than a chronological transcript.
