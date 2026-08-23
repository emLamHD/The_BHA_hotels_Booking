# PMS-BE-001.1 — Commercial Commitment V2 Foundation — Completion Report

```text
STATUS: PASS

WORK_ITEM: PMS-BE-001.1
TITLE: Commercial Commitment V2 Foundation
IMPLEMENTER: CLAUDE
REVIEWER: CODEX_READ_ONLY

START_BASELINE: 7db8844dfde5ccc0651949f83ddfff76a3a977b9
FINAL_HEAD: 407678537c73aaf3eadc9861934ffef3adbd6eac (this report's own
  commit is necessarily one commit behind this hash, since a commit's hash
  cannot describe itself before it exists; see git log on the branch for the
  exact tip after this file is committed and pushed).
BRANCH: feature/pms-be-001-1-commercial-commitment-v2-foundation
WORKTREE: /home/admin1/The_BHA_hotels_Booking-pms-be-001-1
WRITE_LOCK_RELEASED: Yes — Claude stopped all writes after this checkpoint.

COMMITS:
- 97a5705 feat(booking): normalize commercial commitments (PMS-BE-001.1)
  (49 files changed, 4518 insertions(+), 1058 deletions(-))
- 4076785 docs(pms-be-001.1): record completion report and CI evidence
  (this file's own prior version, 1 file changed, 250 insertions(+))
DRAFT_PR: https://github.com/emLamHD/The_BHA_hotels_Booking/pull/35
DRAFT_STATE: OPEN / DRAFT (not Ready, not merged)
PR_BASE: develop
PR_HEAD_MATCH: Yes as of each push — PR headRefOid tracked 97a5705 then
  4076785 exactly; a third, docs-only commit adds only this reconciliation
  edit.
CI_STATUS: All three jobs PASS on both pushed commits.
  - Commit 97a5705: Admin (54s), Backend (1m55s), Frontend (1m35s).
    Run: https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/32630676851
  - Commit 4076785: Admin (48s), Backend (2m6s), Frontend (1m37s).
    Run: https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/32630830420

FILES_CHANGED: 49 (see commit 97a5705 for the full list)
DELETED_LEGACY_AUTHORITY:
- Back_End/src/TheBha.Domain/Bookings/BookingHold.cs (renamed to InventoryHold.cs)
- Back_End/src/TheBha.Domain/Bookings/BookingHoldNight.cs
- Back_End/src/TheBha.Domain/Bookings/BookingNightSnapshot.cs (renamed to NightlyCommitmentSnapshot.cs)
- Back_End/src/TheBha.Domain/Bookings/ReservationNight.cs
- Back_End/src/TheBha.Infrastructure/Persistence/Configurations/BookingHoldNightConfiguration.cs
- Back_End/src/TheBha.Infrastructure/Persistence/Configurations/ReservationNightConfiguration.cs
- PostgreSQL tables (migration 7 contract step): BookingHolds, BookingHoldNights, ReservationNights
- Reservations.RoomTypeId / Reservations.RatePlanId / Reservations.Rooms columns

NEW_NORMALIZED_AUTHORITY:
- Back_End/src/TheBha.Domain/Bookings/InventoryHold.cs, InventoryHoldItem.cs,
  InventoryHoldItemNight.cs, ReservationUnit.cs, ReservationUnitNight.cs,
  ReservationUnitPlan.cs, CommitmentStatus.cs
- Back_End/src/TheBha.Infrastructure/Persistence/Configurations/
  InventoryHoldConfiguration.cs, InventoryHoldItemConfiguration.cs,
  InventoryHoldItemNightConfiguration.cs, ReservationUnitConfiguration.cs,
  ReservationUnitNightConfiguration.cs
- PostgreSQL tables: InventoryHolds, InventoryHoldItems, InventoryHoldItemNights,
  ReservationUnits, ReservationUnitNights

MIGRATION:
- Seventh migration: 20260823084717_CommercialCommitmentV2Foundation
- Migration chain: 7 migrations, ending at CommercialCommitmentV2Foundation;
  none of migrations 1-6 modified (confirmed by diff — only migration 7's
  own two files and the model snapshot changed).
- Fresh database result: PASS. `dotnet ef database update` on a brand-new
  database applied all 7 migrations cleanly; final schema contains
  InventoryHolds/InventoryHoldItems/InventoryHoldItemNights/Reservations/
  ReservationUnits/ReservationUnitNights and no BookingHold*/ReservationNights
  table. Also codified as CommercialCommitmentV2MigrationTests
  .Fresh_database_applies_all_seven_migrations (PASS).
- v6 -> v7 backfill result: PASS. A database migrated to exactly migration 6,
  seeded with representative legacy rows (an Active 3-room/2-night Hold, an
  Active-but-already-expired 1-room/1-night Hold, a Confirmed 2-room/2-night
  Reservation, and a Cancelled 1-room/1-night Reservation), then migrated to
  migration 7: produced exactly the expected Item/Unit/night counts, correct
  RoomTypeId/RatePlanId lineage, and correct Committed/Cancelled
  CommitmentStatus mapping, verified both manually (psql) and by
  CommercialCommitmentV2MigrationTests
  .V6_database_with_representative_data_upgrades_with_exact_counts_totals_and_lineage
  (PASS).
- Downgrade result: PASS (guarded). Downgrading the same upgraded database
  back to migration 6 reconstructed the original BookingHolds/
  BookingHoldNights/Reservations/ReservationNights rows exactly
  (Rooms/RoomTypeId/RatePlanId/TotalAmount/Status all matched the original
  seed byte-for-byte), verified manually and by
  CommercialCommitmentV2MigrationTests
  .Downgrade_from_v7_to_v6_reconstructs_the_legacy_shape_exactly (PASS).
  Separately verified the guard itself: after forcing one Item of a
  multi-item Hold to a second RoomType (simulating data the legacy
  single-RoomType schema cannot represent), the downgrade raised
  `P0001: ... span more than one RoomType ...` and left all 7 migrations
  and all normalized data fully intact — verified manually and by
  CommercialCommitmentV2MigrationTests
  .Downgrade_fails_and_preserves_all_normalized_data_when_a_hold_spans_more_than_one_room_type
  (PASS).
- Item/unit/night count evidence: exact matches in every scenario above (3
  Items/6 ItemNights for a 3-room/2-night Hold; 2 Units/4 UnitNights for a
  2-room/2-night Confirmed Reservation; 1 Unit/1 UnitNight, CommitmentStatus
  = Cancelled, for a 1-room Cancelled Reservation).
- Total preservation evidence: normalized SUM(UnitAmount) equaled the legacy
  TotalAmount exactly for every seeded Hold/Reservation (3003.00, 400.00,
  2000.00, 600.00) — also enforced structurally by the migration's own
  fail-fast validation block, which raises before the contract step if any
  mismatch exists.
- RatePlan lineage evidence: every backfilled ItemNight/UnitNight carries the
  legacy aggregate's RatePlanId exactly; verified by direct query and by the
  migration test's DISTINCT RatePlanId assertion across a Reservation's Units.
- Model snapshot parity: `dotnet ef migrations has-pending-model-changes`
  reports "No changes have been made to the model since the last migration."

ACCEPTANCE:
- rooms = Q, stay N creates exactly Q InventoryHoldItems / Q×N
  InventoryHoldItemNights: PASS (domain constructor + migration backfill
  both verified).
- Confirmation creates Q/Q×N Units/UnitNights atomically, no repricing, no
  current-rate re-read: PASS (InventoryHold.Confirm copies persisted
  RatePlanId/UnitAmount 1:1; BookingHoldConfirmationApiTests
  .First_confirmation_uses_hold_snapshot_despite_stop_sell_limit_and_catalog_changes
  PASS).
- Replay does not append (idempotent create/confirm): PASS (existing
  BE-003.3/BE-003.4 replay tests adapted and passing unchanged in behavior).
- Hold expiry exact at ExpiresAtUtc: PASS (existing BE-003.3/BE-003.5 boundary
  tests passing unchanged).
- Availability/committed-demand counts each active ItemNight and each
  Committed UnitNight exactly once: PASS (AvailabilityDataSource and
  BookingHoldCreationStore.LoadCommittedDemandAsync rewritten against
  CommitmentStatus/Hold-Active-and-unexpired; BookingHoldApiTests
  .Availability_counts_confirmed_reservation_once_and_excludes_cancelled_state
  PASS).
- Whole-Reservation cancellation transitions every Committed Unit and
  releases demand atomically: PASS (Reservation.Cancel cascades to every
  Unit in one domain-object mutation persisted in one transaction;
  ReservationCancellationApiTests passing unchanged in behavior).
- No persisted Quantity/Rooms on Item/Unit/ItemNight/UnitNight: PASS (schema
  inspection — no such column exists on InventoryHoldItems,
  InventoryHoldItemNights, ReservationUnits, or ReservationUnitNights).
- Source Item -> Unit uniqueness PostgreSQL-enforced: PASS
  (IX_ReservationUnits_SourceInventoryHoldItemId unique index;
  BookingPersistenceTests.PostgreSql_enforces_hold_and_reservation_uniqueness
  PASS).
- Property consistency PostgreSQL-enforced on every Item/Unit/RoomType/
  RatePlan relationship: PASS (every relationship uses a
  (PropertyId, <FK>) composite FK against a (PropertyId, Id) alternate key;
  BookingPersistenceTests.Same_property_room_type_and_rate_plan_are_enforced
  and .Reservation_relationships_are_enforced PASS).
- No dual-write, no dormant normalized table: PASS (legacy tables/columns
  dropped in the same migration transaction as the transform).
- No persisted BookingHoldNight/ReservationNight as commercial authority
  after cutover: PASS (tables dropped).

PUBLIC_COMPATIBILITY:
- API shapes: BookingHoldDto/BookingHoldNightDto/ReservationDto/
  ReservationNightDto unchanged (Application/Bookings not modified except
  none — no file in that directory was touched); values now projected from
  normalized rows in BookingHoldCreationStore.Map / BookingHoldConfirmationStore.Map.
- Status codes: unchanged — TheBha.Api/Controllers/BookingHoldsController.cs
  and ReservationsController.cs were not modified.
- Ownership/security: CSRF, idempotency, guest-token, and authenticated
  ownership behavior unchanged — verified by the full existing API-level
  integration test suite (adapted only for table/entity renames, no
  behavioral change), all passing.
- Customer Web checks: `npm run lint` clean, 298/298 tests passing,
  `npm run build` succeeds — zero Customer Web source files touched.

CONCURRENCY_AND_REPLAY:
- Idempotency: unchanged discipline — BookingAdvisoryLockKeys namespaces
  unchanged; BookingHoldApiTests concurrent-replay tests passing.
- Advisory locks: lifecycle-then-inventory lock order unchanged; inventory
  lock key now resolved via the Hold's/Reservation's Item(s) RoomTypeId
  (uniform across Items in this work item's scope).
- Overbooking: BookingHoldConfirmationApiTests
  .Concurrent_same_hold_confirmation_persists_exactly_one_reservation and
  .Concurrent_overlapping_multi_night_confirmations_complete_without_deadlock
  PASS.
- Confirmation replay: PASS (IsCoherentReservation rewritten to compare
  Item->Unit mapping and nightly snapshots; all incoherence tests in
  ReservationReplayCoherenceTests.cs PASS, including 3 new cases for
  Unit-RoomType mismatch, missing-Unit-for-Item, and foreign-source-Item).
- Cancellation replay: PASS (ReservationCancellationApiTests idempotent
  double-cancel tests passing unchanged).

CHECKS:
- restore: PASS (`dotnet restore Back_End/TheBha.Booking.sln`).
- Release build: PASS, 0 warnings, 0 errors
  (`dotnet build --configuration Release`).
- targeted unit tests: PASS, 243/243
  (`dotnet test --configuration Release --no-build`, TheBha.UnitTests.dll).
- targeted PostgreSQL integration tests: PASS, 255/255
  (TheBha.IntegrationTests.dll, includes 4 new CommercialCommitmentV2MigrationTests).
- full backend suite: PASS, 498/498 total (243 unit + 255 integration).
- EF pending-model check: PASS, clean
  (`dotnet ef migrations has-pending-model-changes`).
- Customer Web CI parity: PASS (`npm ci`, `npm run lint`, `npm test`
  298/298, `npm run build`).
- Admin Web CI parity: PASS (`npm ci`, `npm run lint`, `npm run build`).
- git diff --check: PASS, clean.
- GitHub CI: PASS — Admin, Backend, Frontend jobs all green on run
  32630676851.

SKILL_POLICY:
- diagnosing-bugs: NOT invoked. No concrete reproducible defect, flaky
  failure, or unclear-root-cause CI failure occurred during this session —
  every test failure encountered during development was immediately
  attributable to a specific, obvious authoring mistake (a stale table/
  column name in a raw SQL string, an unordered-collection assertion, a
  non-hex idempotency-hash test fixture character, or a null source-item
  reference in a test fixture) and was fixed directly without a diagnostic
  loop.
- Graphify: queried once during Phase 0 preflight (graph fresh — built at
  commit 62f2f82d, only docs files changed since, no code file in the
  graph's scope). Cross-checked every graph result directly against source
  before relying on it; no install/rebuild/config change made.

SELF_REVIEW:
- Verified by direct read that no file outside the allowed-files list in
  the Master Execution Prompt was touched (`git status --short` after
  staging matches exactly the Domain/Bookings, Infrastructure/Persistence,
  IntegrationTests/UnitTests, and named docs paths).
- Verified none of migrations 1-6 were modified (only migration 7's own
  files and the model snapshot appear in the diff).
- Verified the public DTO/interface/controller/Customer-Web-contract surface
  was not touched, confirming the Phase 0 impact-map conclusion held.
- Re-ran the full backend suite twice after the last fix to confirm no
  flakiness (both runs 243/255 clean).

KNOWN_RISKS:
- The migration's deterministic Item/Unit id generation (MD5-derived UUID
  from `(source aggregate id, ordinal)`) has an astronomically low but
  theoretical collision probability; the migration's own fail-fast
  validation block checks for and would raise on any such collision before
  the contract step runs, so a collision fails the migration loudly rather
  than corrupting data.
- The guarded Down() migration is exercised by this work item's automated
  tests and a manual adversarial scenario (forced two-RoomType Hold), but
  has not been exercised against a production-scale dataset; it remains a
  rollback safety net, not a supported forward operational path.

NOT_RUN: None. Every check required by §11 of the Master Execution Prompt
ran in this session with real evidence.

DEVIATIONS: None from the Master Execution Prompt's scope, allowed files,
or acceptance criteria.

BLOCKERS: None.

WORKTREE_STATUS: Clean after the checkpoint commit (verified via
`git status --short`); no uncommitted changes remain. Claude has stopped
all write operations in this worktree as of this report.

REQUESTED_OWNER_OC_DECISION:
Owner invoke Codex review, then forward the result and this report to OC
for review and a PASS / CORRECTION_REQUIRED / BLOCKED decision. Only Owner
decides Ready, merge, and branch/worktree cleanup, and whether to open the
next work item (multi-RoomType public request, physical-room allocation,
Admin backend integration, or any other TARGET item named in
docs/project/PROJECT_BIBLE.md and the PMS blueprint).
```

READY_FOR_CODEX_REVIEW
Owner must now invoke:
`/codex:review --base origin/develop`
