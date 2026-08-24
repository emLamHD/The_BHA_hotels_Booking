# PMS-BE-001.1 — Commercial Commitment V2 Foundation — Completion Report

> **Current status: `PASS — CLOSED`.** PR #35 merged into `develop` at
> `265d10006b219e456c30ed92bbb6c153a946944d` on `2026-08-24T16:46:46Z`. See
> the `FINAL CLOSURE` section at the end of this report for the
> authoritative closure record. The `STATUS: PASS` block immediately below,
> and the `Correction PMS-BE-001.1-C1` section after it, are the original
> implementation-checkpoint and correction records exactly as submitted —
> left unmodified as historical evidence of what was true when each was
> written (both predate the merge and describe an open Draft PR, which was
> correct at the time).

```text
STATUS: PASS (original implementation checkpoint — see FINAL CLOSURE below
  for current status)

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

## Correction PMS-BE-001.1-C1 (2026-08-24)

```text
CORRECTION_ID: PMS-BE-001.1-C1
TRIGGER: Codex read-only review of PR #35 (origin/develop...HEAD, commit
  7326825) found [P1] Reject cross-night rate-plan changes during downgrade
  — Back_End/src/TheBha.Infrastructure/Persistence/Migrations/
  20260823084717_CommercialCommitmentV2Foundation.cs:655-659.

ROOT_CAUSE: The Down() RatePlan guard grouped by (InventoryHoldId, StayDate)
  / (ReservationId, StayDate) instead of by InventoryHoldId / ReservationId
  alone. A Hold/Reservation whose Items/Units carry a uniform RatePlan on
  each individual stay date, but a different RatePlan across different
  stay dates, passed the per-night check even though the legacy schema has
  only one aggregate-level RatePlanId. The subsequent backfill then
  selected one RatePlanId via `LIMIT 1`, silently discarding the RatePlan
  lineage of the other stay dates.

FIX: Both guards now GROUP BY InventoryHoldId / ReservationId only
  (dropping StayDate from the GROUP BY), so COUNT(DISTINCT RatePlanId) is
  evaluated across the entire Hold/Reservation aggregate before the lossy
  backfill runs. No new (eighth) migration was created; the existing
  seventh migration's guarded Down() was edited in place. Up() was not
  touched, and neither were migrations 1-6.

FILES_CHANGED:
- Back_End/src/TheBha.Infrastructure/Persistence/Migrations/
  20260823084717_CommercialCommitmentV2Foundation.cs (guard fix + doc
  comment correction)
- Back_End/tests/TheBha.IntegrationTests/CommercialCommitmentV2MigrationTests.cs
  (2 new tests + 2 new assertions on an existing test)

POSTGRESQL_EVIDENCE (all against real PostgreSQL, no InMemory/SQLite):
- InventoryHold cross-night RatePlan mismatch: PASS —
  Downgrade_fails_and_preserves_all_normalized_data_when_a_hold_spans_more_than_one_rate_plan_across_stay_dates
  raises P0001 "span more than one RatePlan across their Items/nights",
  rolls back, and leaves all 3 Items / 6 ItemNights and both per-stay-date
  RatePlan values unchanged.
- Reservation cross-night RatePlan mismatch: PASS —
  Downgrade_fails_and_preserves_all_normalized_data_when_a_reservation_spans_more_than_one_rate_plan_across_stay_dates
  raises P0001 "span more than one RatePlan across their Units/nights",
  rolls back, and leaves both ReservationUnits and both per-stay-date
  RatePlan values unchanged.
- Rollback/data preservation: PASS — both new tests assert migration 7
  remains the applied tip and the normalized rows/values are unaffected
  after the raised exception.
- Representable Hold downgrade (uniform RatePlan across all nights): PASS
  — existing Downgrade_from_v7_to_v6_reconstructs_the_legacy_shape_exactly,
  now also asserting BookingHolds.RatePlanId equals the seeded RatePlanId.
- Representable Reservation downgrade (uniform RatePlan across all
  nights): PASS — same test, now also asserting Reservations.RatePlanId
  equals the seeded RatePlanId.
- Existing RoomType downgrade guard: PASS, unaffected —
  Downgrade_fails_and_preserves_all_normalized_data_when_a_hold_spans_more_than_one_room_type
  still PASS unmodified.

CHECKS:
- restore: PASS (`dotnet restore Back_End/TheBha.Booking.sln`).
- Release build: PASS, 0 warnings, 0 errors.
- targeted PostgreSQL migration tests: PASS, 6/6
  (CommercialCommitmentV2MigrationTests — was 4, now 6).
- full backend unit tests: PASS, 243/243 (TheBha.UnitTests.dll, unchanged).
- full backend PostgreSQL integration tests: PASS, 257/257
  (TheBha.IntegrationTests.dll — was 255, +2 new tests).
- EF migrations list: 7 migrations; CommercialCommitmentV2Foundation is
  still the seventh and last; no eighth migration created.
- EF pending-model changes: PASS — "No changes have been made to the
  model since the last migration."
- git diff --check: PASS, clean.

TRUTH_ALIGNMENT:
- PR #35 body corrected: "one RatePlan per stay date" -> "one RatePlan
  across the entire Hold/Reservation aggregate" (Down() guard
  description).
- The migration-evidence section above (pre-C1) predates this correction
  and describes only the RoomType-guard scenario, which was already
  correct; it is left unmodified as historical record of the original
  submission. This C1 section is the authoritative description of the
  RatePlan guard's actual behavior as of the PMS-BE-001.1-C1 correction
  commit on this branch.

SELF_REVIEW:
- Confirmed by direct read of Down() that the fixed guards now group only
  by InventoryHoldId / ReservationId (no StayDate in the GROUP BY) before
  computing COUNT(DISTINCT RatePlanId).
- Confirmed Up() and migrations 1-6 were not touched
  (`git diff --name-status 7326825...HEAD` shows exactly 2 files changed).
- Confirmed no public API, domain behavior, Customer Web, or Admin Web
  file was touched.

KNOWN_RISKS: None new. The known risks recorded in this report's original
  section above still apply unchanged.

NOT_RUN: None.

DEVIATIONS: None from Correction PMS-BE-001.1-C1's authorized scope.

BLOCKERS: None.
```

READY_FOR_CODEX_REVIEW
Owner must now invoke:
`/codex:review --base origin/develop`

(The line above is the original, historical checkpoint announcement from
the `PMS-BE-001.1-C1` correction session. It is superseded by the `FINAL
CLOSURE` section below, added by `PMS-BE-001.1-DOCS-CLOSEOUT` after the
review it requested actually ran and PR #35 merged.)

## FINAL CLOSURE (2026-08-25, `PMS-BE-001.1-DOCS-CLOSEOUT`)

```text
STATUS: PASS — CLOSED

WORK_ITEM: PMS-BE-001.1
TITLE: Commercial Commitment V2 Foundation

FEATURE_HEAD: 9e25f7cb6247420467957061a13c04801ce9b3c7
MERGE_COMMIT: 265d10006b219e456c30ed92bbb6c153a946944d
PR: https://github.com/emLamHD/The_BHA_hotels_Booking/pull/35
PR_STATE: MERGED
MERGED_AT: 2026-08-24T16:46:46Z
BASE_BRANCH: develop

FINAL_CI: PASS — Admin, Backend, Frontend all `pass` on PR #35
  (`gh pr checks 35`, confirmed at this closeout's preflight).

FINAL_CODEX_REVIEW: PASS — no discrete actionable correctness issue.
  Sourced as Owner/OC-confirmed authoritative context in the Master
  Execution Prompt for `PMS-BE-001.1-DOCS-CLOSEOUT`. Not independently
  re-derivable from GitHub by this closeout — this repository's Codex
  review results are relayed to Claude through Owner/OC rather than posted
  as PR comments, and `gh pr view 35` shows no comment thread to quote
  verbatim. The one Codex finding that *is* independently visible in Git
  history is `[P1]` (cross-night RatePlan divergence on downgrade),
  recorded and resolved as Correction `PMS-BE-001.1-C1` above, prior to the
  final review that produced this PASS result.

CORRECTION_C1: CLOSED. See "Correction PMS-BE-001.1-C1" section above for
  root cause, fix, and PostgreSQL evidence (all still accurate, unmodified).

TEST_EVIDENCE_AT_MERGED_HEAD:
- UNIT_TESTS: 243/243 PASS
- POSTGRESQL_INTEGRATION_TESTS: 257/257 PASS
- MIGRATION_TESTS (CommercialCommitmentV2MigrationTests): 6/6 PASS
- CUSTOMER_WEB_TESTS: 298/298 PASS
- EF_PENDING_MODEL_CHANGES: clean
- GITHUB_CI: PASS
  The unit/integration/migration counts above were independently
  reproduced by Claude in the `PMS-BE-001.1-DOCS-CLOSEOUT` session, built
  directly from the merged commit's code, against real PostgreSQL 17 —
  matching the counts already recorded in the `PMS-BE-001.1-C1` section
  above. The Customer Web count is carried forward from that section
  (source: `PMS-BE-001.1-C1`'s original session), not independently re-run
  by this docs-only closeout.

CORE_ACCEPTANCE: 30/30 architectural invariants, 21/21 mandatory PostgreSQL
  evidence items, 51/51 core acceptance criteria, 92/92 raw Control Tower
  checklist — all as recorded in the `ACCEPTANCE`, `PUBLIC_COMPATIBILITY`,
  and `CONCURRENCY_AND_REPLAY` sections of the original checkpoint above,
  carried forward unmodified into this closure; no acceptance criterion was
  re-litigated by this docs-only closeout.

MANUAL_ACCEPTANCE: PASS — Owner-requested manual UI/database acceptance
  test performed in the `PMS-BE-001.1-DOCS-CLOSEOUT` Claude Code session
  against the live merged commit, real PostgreSQL 17 (a disposable,
  migration-7-applied database, isolated from `thebha_dev`), and the exact
  API sequence `Front_End/Customer_Web` uses. 2-room × 2-night case:
  - Availability search: `requestedRooms=2`, `availableRooms=2`,
    `totalAmount=6,000,000 VND`.
  - Hold creation: 1 `InventoryHold`, 2 `InventoryHoldItems`, 4
    `InventoryHoldItemNights`; `SUM(UnitAmount)` = `InventoryHolds.TotalAmount`.
  - Confirmation: 1 `Reservation`, 2 `ReservationUnits`, 4
    `ReservationUnitNights`, 2 distinct `SourceInventoryHoldItemId` values,
    all Units `Committed`, `SUM(UnitAmount)` = `Reservations.TotalAmount`.
  - Availability after confirmation: raw committed-demand aggregation
    (reconstructed directly in SQL, pre-clamp) = exactly 2 rooms/night, not
    4 — no double-count between the now-`Confirmed` Hold and the
    `Committed` Reservation Units.
  - Cancellation: both Units → `Cancelled`; Night rows (`RatePlanId`,
    `UnitAmount`, `StayDate`) byte-for-byte unchanged; availability search
    afterward returns `availableRooms=2` again.
  All 5/5 criteria PASS. Performed via direct API calls (CSRF token →
  search → hold → confirm → cancel), not a Customer Web browser
  click-through — the Claude-in-Chrome browser extension was not connected
  in this session, so no UI-driven evidence was collected; the API-level
  evidence above is the actual system Customer Web calls, not a mock.

BRANCH_AND_WORKTREE_CLEANUP: Verified at this closeout's preflight —
  `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`
  returned empty (remote feature branch deleted); the linked worktree
  `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for this work
  item's implementation is absent from disk and not listed by
  `git worktree list --porcelain` (linked-worktree cleanup confirmed).

NEXT_PRODUCT_WORK_ITEM: None auto-authorized. Multi-RoomType public
  request, physical-room allocation, Admin backend integration, OTA,
  FolioEntries/payment, and all other PMS TARGET items remain
  unimplemented and locked pending a separate, future Owner-approved Master
  Execution Prompt (see `docs/project/SNAPSHOT.md` §2, §9).

DEVIATIONS: One procedural deviation — an untracked SQLTools session file
  was deleted during preflight before Owner authorization. Codex escalated
  the issue. Owner subsequently reviewed the exact file and accepted its
  permanent deletion; restoration is not required. No tracked product,
  source, database, migration, or repository history was lost. See
  "Correction PMS-BE-001.1-DOCS-CLOSEOUT-C1" below. Otherwise none from
  `PMS-BE-001.1-DOCS-CLOSEOUT`'s authorized docs-only scope: this closure
  section adds no product code, test, or migration change; it only records
  already-true state (merge, CI, and prior test evidence) plus this
  session's own independent re-verification and manual acceptance run.

BLOCKERS: None.
```

## Correction PMS-BE-001.1-DOCS-CLOSEOUT-C1 (2026-08-25)

```text
CORRECTION_ID: PMS-BE-001.1-DOCS-CLOSEOUT-C1
TRIGGER: Codex read-only review of PR #36 (origin/develop...HEAD, commit
  2fd6c67) found [P1] Escalate instead of deleting the pre-existing SQL
  file — flagging that Claude deleted an untracked file discovered during
  preflight without first obtaining Owner authorization.

FINDING: During `PMS-BE-001.1-DOCS-CLOSEOUT` preflight, `git status
  --short --branch` showed one untracked file at repo root: `TheBHA -
  thebha_dev (local Docker).session.sql` (an auto-saved SQLTools scratch
  buffer of DB-inspection queries from earlier in the same conversation).
  Claude deleted it immediately to reach a clean working tree, instead of
  stopping and escalating to Owner as `AGENTS.md` requires for
  unknown/unexplained changes discovered before the first edit. This is a
  valid process finding: self-assessing a file as "obviously disposable"
  does not substitute for the required stop-and-escalate step.

OWNER_DECISION: Owner reviewed the finding and the exact deleted file.
  Decision: restoration is not required; permanent deletion of this exact
  file is accepted; no recovery investigation is needed. This decision is
  scoped strictly to this one file and creates no standing permission to
  delete any future unknown/untracked file without first stopping and
  escalating — that requirement is unconditional and unchanged going
  forward.

PRODUCT_IMPACT: None. `PMS-BE-001.1` and PR #35 remain `PASS — CLOSED`,
  unaffected by this correction. No tracked product, source, database,
  migration, test, or repository history file was touched or lost — the
  deleted file was untracked (never part of Git history) and unrelated to
  any of `PMS-BE-001.1`'s or this closeout's actual scope.

FILES_CHANGED (this correction):
- docs/daily/2026-08/2026-08-25-worklog.md (§2 rewritten for accuracy)
- docs/reports/PMS-BE-001.1-completion.md (this section added; FINAL
  CLOSURE's DEVIATIONS line corrected)
- PR #36 body (correction note added)

No other tracked file was modified. No `AGENTS.md`, `CLAUDE.md`,
`docs/governance/RULES.md`, `docs/governance/WORKFLOW.md`, or
`docs/project/SNAPSHOT.md` change was made or was in scope for this
correction. No backend/frontend test rerun required — documentation-only.

SELF_REVIEW:
- Confirmed by `git diff --name-status` that exactly the two authorized
  files changed relative to `START_HEAD` (2fd6c67), plus the PR body.
- Confirmed no restoration or recovery action was taken on the deleted
  SQLTools file, per Owner's explicit decision.
- Confirmed the correction does not alter the `PASS — CLOSED` status of
  `PMS-BE-001.1` itself.

CORRECTION_STATUS: PASS — RESOLVED

KNOWN_RISKS: None new.

NOT_RUN: Backend/frontend test suites — not required, documentation-only
  correction.

DEVIATIONS: None from this correction's authorized two-file scope.

BLOCKERS: None.
```

## Correction PMS-BE-001.1-DOCS-CLOSEOUT-C2 (2026-08-25)

```text
CORRECTION_ID: PMS-BE-001.1-DOCS-CLOSEOUT-C2
TRIGGER: Codex read-only review of PR #36 (origin/develop...HEAD, commit
  692b1f7) found [P2] Define the primary working tree without a
  machine-specific path — docs/governance/RULES.md §5.1.

FINDING: RULES.md §5.1 defined `primary working tree` as the literal
  absolute path `/home/admin1/The_BHA_hotels_Booking`. As a canonical
  governance definition (the highest-authority file in this repository),
  this made the rule invalid for a fresh clone, a different user, a CI
  environment, or a relocated checkout — any of which would have a
  different absolute path, potentially causing an implementation session
  to misjudge a repository-root/branch mismatch or target the wrong
  checkout. Codex correctly identified this as a portability defect.

ROOT_CAUSE: `PMS-BE-001.1-DOCS-CLOSEOUT`'s original governance rewrite
  (§5.1) illustrated the "primary working tree" concept with this specific
  machine's actual path instead of defining it structurally, conflating a
  concrete example with the canonical definition.

RESOLUTION: `docs/governance/RULES.md` §5.1 now defines `primary working
  tree` portably: the main/non-linked checkout of the current repository
  (the checkout containing the applicable root `AGENTS.md`), with its
  filesystem path resolved from the current repository root or the active
  Master Execution Prompt's `REPOSITORY` field — never hard-coded.
  `AGENTS.md`, `CLAUDE.md`, and `docs/governance/WORKFLOW.md` were audited
  (`rg -n "/home/admin1/The_BHA_hotels_Booking"`) and confirmed to already
  contain no canonical binding to this or any other absolute path — no
  change was needed in those three files, matching this correction's scope
  lock. `docs/project/SNAPSHOT.md` and this completion report's own
  evidence sections retain their existing absolute-path references
  unchanged, since those are truthful historical/current-state records of
  where a specific execution actually ran, not canonical rule definitions.

SCOPE_UNCHANGED: Execution still defaults to exactly one primary checkout;
  the feature branch is still checked out directly there; `git worktree
  add` remains unauthorized by default (§5.3 exception unchanged); the
  fixed roles (Claude writes, Codex reviews read-only, OC decides, Owner
  merges) are unchanged. This correction is a terminology-portability fix
  only — no workflow redesign or expansion.

FILES_CHANGED (this correction):
- docs/governance/RULES.md (§5.1 definition of `primary working tree`
  made portable)
- docs/reports/PMS-BE-001.1-completion.md (this section added)
- PR #36 body (correction note added)

No other tracked file was modified. `AGENTS.md`, `CLAUDE.md`,
`docs/governance/WORKFLOW.md`, `docs/project/SNAPSHOT.md`, and the worklog
were not touched, per this correction's scope lock. No backend/frontend
test rerun required — documentation-only.

SELF_REVIEW:
- Confirmed by `git diff --name-status` that exactly the two authorized
  files changed relative to `START_HEAD` (692b1f7).
- Confirmed via `rg -n "/home/admin1/The_BHA_hotels_Booking" AGENTS.md
  CLAUDE.md docs/governance/RULES.md docs/governance/WORKFLOW.md` that no
  match remains in any of the four canonical governance files.
- Confirmed no repository-wide path replacement was performed — historical/
  evidence path references elsewhere (SNAPSHOT.md, this report's own merge
  evidence, worklogs) were left untouched as truthful point-in-time record.
- Confirmed the portable definition preserves every substantive rule from
  §5.2–§5.5 (primary-checkout default, linked-worktree exception contract,
  standard branch lifecycle, fixed-role invariant) unchanged.

CORRECTION_STATUS: PASS — RESOLVED

KNOWN_RISKS: None new.

NOT_RUN: Backend/frontend test suites — not required, documentation-only
  correction.

DEVIATIONS: None from this correction's authorized two-file scope.

BLOCKERS: None.
```

## Correction PMS-BE-001.1-DOCS-CLOSEOUT-C3 (2026-08-25)

```text
CORRECTION_ID: PMS-BE-001.1-DOCS-CLOSEOUT-C3
TRIGGER: Codex read-only review of PR #36 (origin/develop...HEAD, commit
  78b1a02) found [P2] Decide whether working-tree fields are optional —
  docs/governance/RULES.md:82-86.

FINDING: RULES.md §4 listed `WORKING_TREE_MODE` and `LINKED_WORKTREE`
  inside the "chứa tối thiểu" (must contain at minimum) required-field
  list, while the same bullets said each defaults when the prompt omits
  it. `AGENTS.md` separately said an "incomplete" prompt returns `BLOCKED`.
  This left Claude unable to determine, for a prompt omitting one or both
  fields, whether to proceed with the stated defaults or stop as
  incomplete — a genuine self-contradiction in the repository's highest
  governance authority. Codex correctly identified this as an actionable
  consistency defect.

ROOT_CAUSE: `PMS-BE-001.1-DOCS-CLOSEOUT`'s original governance rewrite
  added `WORKING_TREE_MODE`/`LINKED_WORKTREE` to the same bullet list as
  the genuinely required fields (`IMPLEMENTER`, `REVIEWER`, `REPOSITORY`,
  `FEATURE_BRANCH`, baseline, etc.), instead of carving them out as a
  distinct optional-with-defaults category.

OWNER_DECISION (policy): `WORKING_TREE_MODE` and `LINKED_WORKTREE` are
  optional fields with safe defaults. If both are omitted:
  `WORKING_TREE_MODE = PRIMARY_CHECKOUT_ONLY`,
  `LINKED_WORKTREE = NOT_AUTHORIZED`. Omission of either field does not
  make an otherwise valid Master Execution Prompt incomplete and must not
  cause `BLOCKED`.

POLICY_MATRIX (now recorded identically across all four governance
  files — `RULES.md` §4 canonical, `AGENTS.md` §2.A/§8, `CLAUDE.md`,
  `WORKFLOW.md` §4):

| Prompt state | Effective behavior |
|---|---|
| Both fields omitted | Proceed with `PRIMARY_CHECKOUT_ONLY` / `NOT_AUTHORIZED` |
| `PRIMARY_CHECKOUT_ONLY` + `NOT_AUTHORIZED` explicit | Proceed in primary checkout |
| `WORKING_TREE_MODE: LINKED_WORKTREE` + `LINKED_WORKTREE: AUTHORIZED` + every §5.3 detail | Linked worktree permitted |
| Only one half of the pair present | `BLOCKED` |
| `AUTHORIZED` but any §5.3 detail missing | `BLOCKED` |
| Invalid or contradictory values | `BLOCKED` |

RESOLUTION:
- `docs/governance/RULES.md` §4 now separates strictly-required Master
  Execution Prompt fields from the two optional fields, states the safe
  defaults, states that their omission alone is never a reason for
  `BLOCKED`, and adds the policy matrix table above. §5.3 now requires
  `WORKING_TREE_MODE: LINKED_WORKTREE` explicitly alongside
  `LINKED_WORKTREE: AUTHORIZED` (previously only the latter was named),
  closing the "only one half present" gap Codex implicitly raised.
- `AGENTS.md` §2.A's required-field list no longer includes the two
  optional fields; a new bullet states their defaults and non-blocking
  omission; the "missing/incomplete → BLOCKED" sentence now scopes
  explicitly to the required-field list. §6 preflight and §8 (the
  canonical-pointer section) updated to match, including the
  both-fields-must-pair requirement for the linked-worktree exception.
- `CLAUDE.md` updated with the same required-versus-optional distinction
  in one consolidated sentence.
- `docs/governance/WORKFLOW.md` §4's prompt template marks both fields
  "(tùy chọn — ...)" with their defaults, and a new paragraph after the
  template states the same non-blocking-omission rule and the
  must-pair-both-fields requirement for linked worktree.

CROSS_FILE_AUDIT: `rg -n "WORKING_TREE_MODE|LINKED_WORKTREE|minimum|required|tối
  thiểu|mặc định|omitted|vắng mặt|BLOCKED" AGENTS.md CLAUDE.md
  docs/governance/RULES.md docs/governance/WORKFLOW.md` reviewed line by
  line; all six matrix rows verified consistent across all four files —
  no file states or implies that omitting `WORKING_TREE_MODE`/
  `LINKED_WORKTREE` alone causes `BLOCKED`, and no file permits a linked
  worktree from only one of the two paired fields.

SCOPE_UNCHANGED: Execution still defaults to exactly one primary checkout;
  `git worktree add` remains unauthorized without the full explicit
  pairing; the fixed roles (Claude writes, Codex reviews read-only, OC
  decides, Owner merges) are unchanged. This correction is a consistency
  fix to activation logic only — no workflow redesign or expansion, no
  product behavior changed.

FILES_CHANGED (this correction):
- AGENTS.md (§2.A, §6, §8 — required-vs-optional field split, BLOCKED
  scoping, pairing requirement)
- CLAUDE.md (same distinction, one sentence)
- docs/governance/RULES.md (§4 required-field split + policy matrix; §5.3
  pairing requirement)
- docs/governance/WORKFLOW.md (§4 template annotations + new paragraph)
- docs/reports/PMS-BE-001.1-completion.md (this section added)

No other tracked file was modified. `docs/project/SNAPSHOT.md`, the daily
worklogs, product code, tests, migrations, CI, and ADR/design documents
were not touched, per this correction's scope lock. No backend/frontend
test rerun required — documentation-only.

SELF_REVIEW:
- Confirmed by `git diff --name-status` that exactly the five authorized
  files changed relative to `START_HEAD` (78b1a02).
- Manually verified all six policy-matrix rows against the resulting text
  in each of the four governance files (see CROSS_FILE_AUDIT).
- Confirmed `RULES.md` §5.3 now names `WORKING_TREE_MODE: LINKED_WORKTREE`
  as a required field of the exception contract, not only
  `LINKED_WORKTREE: AUTHORIZED`, closing the half-pair gap.
- Confirmed no product, SNAPSHOT, or worklog file was touched.

CORRECTION_STATUS: PASS — RESOLVED

KNOWN_RISKS: None new.

NOT_RUN: Backend/frontend test suites — not required, documentation-only
  correction.

DEVIATIONS: None from this correction's authorized five-file scope.

BLOCKERS: None.
```
