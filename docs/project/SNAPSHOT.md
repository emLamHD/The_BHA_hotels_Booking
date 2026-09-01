# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-09-01
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này ghi nhận `PMS-BE-001.2-DOCS-CLOSEOUT` đã đóng sau khi PR
#38 (`docs(project): close PMS-BE-001.2 and record calendar handoff`) merge
vào `develop`, và mở work item quản trị `AI-OPS-GOV-003` — thay phân công
cố định Claude-implement/Codex-review bằng một trong hai role pair có thể
chọn trong Master Execution Prompt (`IMPLEMENTER: CLAUDE`/`REVIEWER:
CODEX_READ_ONLY`, hoặc `IMPLEMENTER: CODEX`/`REVIEWER: CLAUDE_READ_ONLY` —
`docs/governance/RULES.md` §2.4), vẫn giữ nguyên one-writer, independent
review, OC authority và Owner-only merge. Control Tower đã chọn
`PMS-CAL-001.1` — Reservation Board Read Projection & Frontend Integration
— là product work item kế tiếp, nhưng vẫn chỉ được authorize cho OC
planning, **chưa** cho implementation (§2, §8). Repository SHA và PR state
bên dưới là baseline đã được xác minh trực tiếp qua `git`/`gh pr view` tại
thời điểm cập nhật tài liệu này, không phải cam kết rằng SHA này sẽ còn là
`develop` HEAD sau các commit tiếp theo; revalidate lại `origin/develop`
trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `f0eef23c59608d2aba1e43063c38074ea863edef` |
| PR #31 | merged — `docs(pms): record core database blueprint v2`, merge commit `bfb3377b701e9309d3cbbea22bb18159bc37a2e0`, merged `2026-08-19T10:56:01Z`. Persists PMS blueprint documentation foundation (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006). |
| PR #32 | merged — `feat(admin): add PMS reservation board UI baseline`, merge commit `17e929d7c1f82941599223344b5f4cdc3aa34307`, merged `2026-08-22T14:42:31Z`. Closes `ADMIN-002.1`. |
| PR #33 | merged — `docs(project): close ADMIN-002.1 and record next sequence`, merge commit `2c38face7cf51d7271c361e6d684adea466edcf9`, merged `2026-08-22T15:38:25Z`. Closes `ADMIN-002.1-DOCS-CLOSEOUT`. |
| PR #34 | merged — `docs(project): record Graphify tooling adoption`, merge commit `7db8844dfde5ccc0651949f83ddfff76a3a977b9`, merged `2026-08-22T19:08:04Z`. Closes `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`; remote branch `docs/tool-graphify-001-closeout` deleted. This row is the current-state truth, replacing a since-corrected stale reference that had lingered in this file's own §7 section. |
| PR #35 | merged — `feat(booking): normalize commercial commitments`, feature branch `feature/pms-be-001-1-commercial-commitment-v2-foundation` (head `9e25f7cb6247420467957061a13c04801ce9b3c7`), merge commit `265d10006b219e456c30ed92bbb6c153a946944d`, merged `2026-08-24T16:46:46Z`. Closes `PMS-BE-001.1`. GitHub CI (Admin/Backend/Frontend) confirmed `pass` on this PR as of this Snapshot update (`gh pr checks 35`). Remote feature branch deleted (confirmed empty via `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`); the linked worktree `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for its implementation is confirmed removed (directory absent, not listed by `git worktree list --porcelain`) — see §4. |
| PR #36 | merged — `docs(project): close PMS-BE-001.1 and restore single-checkout workflow`, feature branch `docs/pms-be-001-1-closeout-single-checkout` (head `c8938c731dd5647868a07f0c3654d919e5d60e9a`), merge commit `298b7fd53c47824550e955b98c2bed370b38a646`, merged `2026-08-24T19:17:44Z`. Closes `PMS-BE-001.1-DOCS-CLOSEOUT`. |
| PR #37 | merged — `feat(pms): add physical room schedule and availability authority`, feature branch `feature/pms-be-001-2-physical-room-schedule-availability` (head `4b2de0ab50fa1703f0b125a043d2461cc0309417`), merge commit `0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`, merged `2026-08-26T10:33:13Z`. Closes `PMS-BE-001.2`. GitHub Actions (Backend/Frontend/Admin) confirmed `success` on this head (run `32957454881`). Remote feature branch confirmed deleted (`git ls-remote --heads origin feature/pms-be-001-2-physical-room-schedule-availability` empty). |
| PR #38 | merged — `docs(project): close PMS-BE-001.2 and record calendar handoff`, feature branch `docs/pms-be-001-2-closeout` (head `9b627fb29ce4b5b955e6e5640a465aa03953304f`), merge commit `f0eef23c59608d2aba1e43063c38074ea863edef`, merged `2026-08-26T12:01:07Z`. Closes `PMS-BE-001.2-DOCS-CLOSEOUT`. |
| PR/branch của work item hiện tại | `AI-OPS-GOV-003` (docs/governance-only) — feature branch `docs/ai-ops-gov-003-prompt-selected-role-pairs`, checked out directly in the one repository checkout (no `git worktree add`), baseline `f0eef23c59608d2aba1e43063c38074ea863edef`. Claude completed its docs-only corrections, self-reviewed, and stopped; per a current Owner one-time decision, no Codex review is required for this PR — Owner reviews the diff directly. Draft PR opened by Claude — not Ready or merged. Ready/merge/branch cleanup remain Owner-only. |
| Open execution PR khác | không có, theo `gh pr list --state open` tại thời điểm preflight của `AI-OPS-GOV-003` (ngoài PR của work item hiện tại ở trên, nếu đã được mở). |

## 2. Work item state

### Hoàn tất

- `FE-001`: closed trước baseline hiện tại.
- `DATA-001.1`: đạt technical gate, PR #22 đã merge; `DATA-001.2` vẫn
  dormant/deferred (xem §5).
- `AI-OPS-GOV-002`: `PASS`.
- `AI-OPS-PILOT-001`: `PASS` — PR #27, merge `bb64f7e1592f4924049935ecc08922539c532bf8`.
- `FE-002.1` — Hold Confirmation UI: `PASS — CLOSED`. PR #28, merge commit
  `3f68bd79eff7f6c553e5516431abd09a93298f71`, merged 2026-08-12T13:39:21Z.
  Full evidence in `docs/daily/2026-08/2026-08-12-worklog.md`.
- `ADMIN-001.1` — Admin Web Template Baseline: `PASS — CLOSED`. PR #30
  merged (`f97c3529fb94c08fafad0da059ec1cf2b839b0d0`, 2026-08-18T10:12:53Z).
  Imports TailAdmin 2.3.0 as `Front_End/Admin_Web`.
- `PMS-DATA-DOCS-001`: `PASS — CLOSED`. PR #31 merged as above. Persists the
  Owner-approved TARGET PMS/database architecture into durable
  documentation. No table, column, constraint, migration, entity, endpoint,
  or UI described there is implemented by that documentation.
- `ADMIN-002.1` — PMS Reservation Board UI Baseline: `PASS — CLOSED`. PR #32
  merged as above. **This is the completed frontend phase**: an
  interactive Admin Reservation Board/Calendar prototype in
  `Front_End/Admin_Web` (room/date timeline, multi-property demo switching,
  assigned/unassigned reservations, operational blocks, front-desk
  reservation-creation and lifecycle/folio/notes/activity workspaces). Full
  evidence in `docs/reports/ADMIN-002.1-completion.md`. Only the frontend
  UI baseline is complete — see §5 for its mock-only boundary.
- `ADMIN-002.1-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #33 merged as above.
  Docs-only synchronization; no product source touched.
- `TOOL-GRAPHIFY-001` (Graphify tooling-adoption): `PASS — CLOSED`, adopted
  as an **optional, workspace-local** code-navigation tool. Full evidence in
  `docs/reports/TOOL-GRAPHIFY-001-completion.md`;
  `docs/governance/WORKFLOW.md` §12 is the canonical invocation policy.
- `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #34 merged as
  above. Docs-only diff; no product source touched.
- `PMS-BE-001.1` — Commercial Commitment V2 Foundation: `PASS — CLOSED`. PR
  #35 merged as above. Replaces the single-RoomType
  `BookingHold`/`BookingHoldNight`/`Reservation`/`ReservationNight`
  commercial authority with the normalized ADR 0005 `InventoryHold →
  InventoryHoldItem → InventoryHoldItemNight` / `Reservation →
  ReservationUnit → ReservationUnitNight` authority (migration 7,
  `CommercialCommitmentV2Foundation`), while preserving the public
  `/api/v1` contract byte-identical. Correction `PMS-BE-001.1-C1` (a Codex
  `[P1]` finding on the guarded downgrade's cross-night RatePlan check) was
  fixed and closed before merge — see
  `docs/reports/PMS-BE-001.1-completion.md`. Final Codex review: `PASS`, no
  discrete actionable correctness issue (Owner/OC-confirmed context for
  this closeout; not independently re-derivable from GitHub, since this
  repository's Codex review results are relayed through Owner/OC rather
  than posted as PR comments — no `gh pr view 35` comment trail exists to
  quote verbatim). Full detail in §4.
- `PMS-BE-001.1-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #36 merged as above
  (§1). Docs-only closeout of `PMS-BE-001.1` and restoration of
  single-primary-checkout-by-default governance; no product source touched.
- `PMS-BE-001.2` — Physical Room Schedule & Availability Authority:
  `PASS — CLOSED`. PR #37 merged as above (§1). Delivers the PhysicalRoom
  schedule database authority, block-adjusted/assignment-attributed
  availability, whole-Reservation cancellation cleanup, and an
  internal-only assignment/block mutation boundary with no HTTP/Admin
  exposure and no Staff/RBAC model — full as-built detail in ADR 0006 and
  `docs/reports/PMS-BE-001.2-completion.md`, not repeated here. Two
  Owner-invoked Codex corrections (`C1`: active-Hold demand omitted from
  mutation capacity validation; `C2`: booked-night coverage trigger let a
  `ReservationUnitNight` transfer ownership between Units unvalidated) were
  fixed and closed before merge — see the completion report. Does **not**
  implement: multi-RoomType public request shape, `Organization`, Admin
  authentication/RBAC, Staff identity, any HTTP exposure of the schedule
  authority, OTA, `FolioEntries`, or `DATA-001.2`.
- `PMS-BE-001.2-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #38 merged as above
  (§1). Docs-only closeout of `PMS-BE-001.2` after PR #37 merged; records
  `PMS-CAL-001.1` as the next Control-Tower-selected product work item,
  authorized for OC planning only, not implementation.

### Đang thực thi

- `AI-OPS-GOV-003` — Prompt-Selected Single Implementer and Independent
  Reviewer: governance-only work item replacing the repository's fixed
  Claude-implements/Codex-reviews assignment with a prompt-selected role
  pair (`docs/governance/RULES.md` §2.4: `IMPLEMENTER: CLAUDE`/`REVIEWER:
  CODEX_READ_ONLY`, or `IMPLEMENTER: CODEX`/`REVIEWER: CLAUDE_READ_ONLY`),
  while preserving one writer, independent read-only review, OC authority
  and Owner-only merge. Edits exactly five files: `AGENTS.md`, `CLAUDE.md`,
  `docs/governance/RULES.md`, `docs/governance/WORKFLOW.md`,
  `docs/project/SNAPSHOT.md` (this file). Claude implementing under this
  work item's own Master Execution Prompt; see the "PR/branch của work item
  hiện tại" row in §1. Per a current Owner one-time decision, no Codex
  review is required for this PR; this exception applies only to
  `AI-OPS-GOV-003` and does not change review policy for other work items.
  Not yet merged.

### Quyết định đang hiệu lực

`PMS_BE_001_2_CLOSED_PMS_CAL_001_1_SELECTED_FOR_PLANNING_ONLY`

Ý nghĩa:

- `PMS-BE-001.2` là `PASS — CLOSED`. Việc đóng work item này **không** tự
  động mở implementation cho bất kỳ product work item kế tiếp nào.
- `PMS-CAL-001.1` — Reservation Board Read Projection & Frontend
  Integration — đã được Control Tower chọn là product work item kế tiếp,
  nhưng bản cập nhật này **chỉ** authorize OC lập kế hoạch
  (planning/decomposition), **không** authorize bất kỳ Calendar source
  code, API, HTTP configuration, frontend integration, authentication,
  schema change, migration, test harness hay dependency nào. Implementation
  yêu cầu một Master Execution Prompt riêng, do OC soạn sau khi lập kế
  hoạch xong.
- Governance vẫn dùng đúng một checkout repository duy nhất cho execution
  (`docs/governance/RULES.md` §5); `git worktree add` và mọi checkout thực
  thi bổ sung đều bị cấm, không có ngoại lệ.
- Chỉ Owner quyết định Ready/merge/branch cleanup cho closeout này.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET vượt ngoài phạm
  vi `PMS-BE-001.1`/`PMS-BE-001.2` và ngoài phạm vi planning-only của
  `PMS-CAL-001.1` (Organization, multi-RoomType Hold/Reservation
  **request** shape, HTTP/Admin/Calendar exposure của
  `RoomOccupancySegments`/`RoomBlock` vượt ngoài `PMS-CAL-001.1`'s exact
  scope, Admin authentication/RBAC, Staff identity, `FolioEntries`, OTA
  adapter/inbox/outbox): **locked** — documented as TARGET/APPROVED by
  `PMS-DATA-DOCS-001`, not authorized for implementation until its own
  Master Execution Prompt.
- Payments/refunds, full housekeeping/maintenance modules, production
  migrations for any remaining PMS TARGET entity, and adapter-specific OTA
  design: locked, unrelated separately authorized future work.

## 3. Current PostgreSQL schema and Hold/Reservation model

- Migration chain is now **eight** migrations, ending at
  `20260826035254_PhysicalRoomScheduleAvailabilityAuthority` (`PMS-BE-001.2`
  migration 8, this work item). Migrations 1–7 (pre-existing before
  `PMS-BE-001.2`) are byte-identical to `origin/develop` — confirmed via
  `git diff origin/develop` at this Snapshot update. No ninth migration was
  created; Phase 4's mutation-command work reused migration 8's schema and
  the ADR 0006 exclusion/trigger invariants without any further schema
  change. No other PMS migration exists (`Organization`, `FolioEntries`, OTA
  inbox/outbox remain unimplemented — see below).
- CURRENT commercial commitment authority (`BE-003.1`–`BE-003.5`,
  `PMS-BE-001.1`) is the ADR 0005 normalized model:
  `InventoryHold → InventoryHoldItem → InventoryHoldItemNight` and
  `Reservation → ReservationUnit → ReservationUnitNight`. Every persisted
  Item/Unit represents exactly one room (no `Quantity`/`Rooms` field exists
  on Item/Unit/Night); every nightly row carries its own `RatePlanId` and
  accepted money. `ReservationUnit.CommitmentStatus = Committed | Cancelled`
  is the sole demand predicate — committed demand counts every
  `InventoryHoldItemNight` of an `Active`, unexpired Hold and every
  `ReservationUnitNight` of a `Committed` Unit, exactly once. The public
  `/api/v1` contract, and the CURRENT limitation to exactly one
  RoomType/RatePlan per public Hold/Reservation request, are both unchanged
  — the request is atomically normalized into `Q` independent Items/Units
  internally; multi-RoomType **request** shape remains TARGET. The legacy
  `BookingHold`/`BookingHoldNight`/`ReservationNight` tables and the
  `RoomTypeId`/`RatePlanId`/`Rooms` columns previously on `Reservations` no
  longer exist — there is no dual-write and no dormant normalized table.
- CURRENT physical-room schedule authority (`PMS-BE-001.2`, ADR 0006,
  migration 8): `RoomOccupancySegment` is the sole PhysicalRoom schedule —
  no separate `RoomAssignments` dual-write model — with PostgreSQL-enforced
  exclusion, booked-night-coverage, unit-commitment-consistency, and
  same-Property invariants, `xmin` optimistic concurrency, and append-only
  audit. Availability is block-adjusted and assignment-attributed.
  Whole-Reservation cancellation atomically cancels its assignment segments.
  Internal-only assignment/OperationalBlock mutation commands exist behind
  the application/persistence boundary only — **no HTTP controller and no
  Admin/Calendar endpoint expose them**, and no Staff identity or Admin RBAC
  model exists; cross-RoomType assignment requires an opaque
  `AuthorizationEvidence`/`Reason` pair, not a real permission check. A
  shared `AdvisoryLockCoordinator` is now used by every advisory-lock-taking
  writer. Exact constraint names, SQLSTATEs, lock order, and error mapping
  are recorded in ADR 0006 and `docs/reports/PMS-BE-001.2-completion.md`,
  not duplicated here.
- No `Organization` entity, no `FolioEntries` table, and no OTA
  inbox/outbox exist anywhere in the current schema or codebase.
- The `ADMIN-002.1` frontend prototype (§2, §5) reads and writes only
  browser-memory mock state — it never calls, and is never proven against,
  the schema described in this section.

## 4. Verification evidence — prior closed work items

Full verification evidence for `FE-002.1` (PR #28) and `AI-OPS-PILOT-001`
(PR #27) remains recorded in `docs/daily/2026-08/2026-08-12-worklog.md`.

`ADMIN-001.1` (PR #30): Admin CI (independent job) green; template imported
with upstream TailAdmin attribution preserved; no backend/API/database
change.

`PMS-DATA-DOCS-001` (PR #31): docs-only diff, no product source/schema/API
change; Owner-invoked Codex review and Owner merge.

`ADMIN-002.1` (PR #32): full C1–C8 iteration history, final CI run
`32567637108` (Admin/Frontend/Backend all `success`), final Codex review
"No actionable correctness defects were identified in the reviewed diff."
Full detail in `docs/reports/ADMIN-002.1-completion.md`.

`ADMIN-002.1-DOCS-CLOSEOUT` (PR #33): docs-only diff, merged
`2c38face7cf51d7271c361e6d684adea466edcf9` at `2026-08-22T15:38:25Z`;
confirmed via `gh pr view 33` and remote branch deletion.

`TOOL-GRAPHIFY-001` / `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (PR #34): functional
gate evidence (not corpus-count comparisons) — exact CLI version confirmed;
Claude ran the project-scoped install and cleaned its known side effects;
code-only graph build completed; pilot query correctly identified the three
required ownership areas in `Front_End/Admin_Web`, independently checked
against source. Merge confirmed via `gh pr view 34` (`MERGED`, merge commit
`7db8844d...`, merged `2026-08-22T19:08:04Z`) and empty
`git ls-remote --heads origin docs/tool-graphify-001-closeout`. Full detail
in `docs/reports/TOOL-GRAPHIFY-001-completion.md`.

`PMS-BE-001.1` (PR #35): full C0–C1 implementation and correction history
in `docs/reports/PMS-BE-001.1-completion.md`,
`docs/daily/2026-08/2026-08-23-worklog.md`, and
`docs/daily/2026-08/2026-08-24-worklog.md`. Merge and cleanup evidence
independently verified for this Snapshot update via:

- `gh pr view 35`: `state=MERGED`, `headRefOid=9e25f7cb6247420467957061a13c04801ce9b3c7`,
  `mergeCommit=265d10006b219e456c30ed92bbb6c153a946944d`,
  `mergedAt=2026-08-24T16:46:46Z`.
- `gh pr checks 35`: Admin/Backend/Frontend all `pass`.
- `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`:
  empty — remote feature branch deleted.
- `git worktree list --porcelain` at this Snapshot's preflight: the linked
  worktree `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for this
  work item's implementation is **not** listed, and the directory itself is
  absent from disk — cleanup confirmed. (Two unrelated historical linked
  worktrees from discontinued Orca dry-runs, dated 2026-08-07, remain
  registered under `/home/admin1/orca/workspaces/...`; audited, not
  mutated — out of scope for this work item.)
- Backend test suite reproduced independently in this Claude Code session,
  built from the merged commit (`9e25f7cb6...`) against real PostgreSQL 17:
  **243/243** unit tests, **257/257** integration tests, **6/6**
  `CommercialCommitmentV2MigrationTests` — all PASS, matching the counts
  recorded in `docs/reports/PMS-BE-001.1-completion.md`'s C1 section.
  `Front_End/Customer_Web` **298/298** test count is sourced from that
  completion report (not independently re-run in this session).
- Manual, end-to-end acceptance test performed in this session against the
  live merged code: built and ran `TheBha.Api` from a clean checkout of the
  merged commit against a disposable, migration-7-applied PostgreSQL
  database (isolated from `thebha_dev`); exercised the exact API sequence
  `Front_End/Customer_Web` uses (`GET .../availability` →
  `POST /api/v1/booking-holds` → `POST .../confirm` →
  `POST /api/v1/reservations/{id}/cancel`) for a 2-room × 2-night case:
  - availability search: `requestedRooms=2`, `availableRooms=2`,
    `totalAmount=6,000,000 VND` (2 × 2 × 1,500,000).
  - Hold creation: exactly 1 `InventoryHold`, 2 `InventoryHoldItems`, 4
    `InventoryHoldItemNights`; `SUM(UnitAmount)` of the Nights equals
    `InventoryHolds.TotalAmount` exactly.
  - Confirmation: exactly 1 `Reservation`, 2 `ReservationUnits`, 4
    `ReservationUnitNights`; the 2 Units carry 2 **distinct**
    `SourceInventoryHoldItemId` values; all Units `CommitmentStatus =
    Committed`; `SUM(UnitAmount)` equals `Reservations.TotalAmount` exactly.
  - Availability after confirmation: raw committed-demand aggregation
    (reconstructed directly in SQL, before the API's `Math.Max(0, …)`
    clamp) equals exactly 2 rooms/night, not 4 — confirming the Hold's
    demand is excluded once its status flips to `Confirmed` and only the
    `Committed` Reservation Units are counted, with no double-count.
  - Cancellation: both Units transition to `CommitmentStatus = Cancelled`;
    their Night rows (`RatePlanId`, `UnitAmount`, `StayDate`) are byte-for-
    byte unchanged; availability search afterward returns
    `availableRooms=2` again.
  - All 5/5 manual acceptance criteria PASS. This is Owner-requested manual
    UI/database acceptance evidence performed via direct API calls (no
    Customer Web UI click-through — the Claude-in-Chrome browser extension
    was not connected in this session) against the real running system and
    real PostgreSQL, not a mock or unit-test double.

`PMS-BE-001.2` (PR #37): full checkpoint/correction history, self-review,
and local/CI verification evidence (build, full unit/integration/
migration/concurrency test counts, EF pending-model check, frontend CI
parity, forbidden-file review) recorded in
`docs/reports/PMS-BE-001.2-completion.md` and
`docs/daily/2026-08/2026-08-26-worklog.md` — not duplicated here. Merge
evidence independently verified for this closeout via:

- `gh pr view 37`: `state=MERGED`, `headRefOid=4b2de0ab50fa1703f0b125a043d2461cc0309417`,
  `mergeCommit=0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`,
  `mergedAt=2026-08-26T10:33:13Z`.
- `gh run view 32957454881`: `conclusion=success`, Backend/Frontend/Admin
  all `success`, on the exact merged head.
- `git ls-remote --heads origin feature/pms-be-001-2-physical-room-schedule-availability`:
  empty — remote feature branch deleted.
- Final Codex/OC review outcome: `PASS`, Owner/OC-confirmed; not
  independently re-derivable from GitHub, since this repository's Codex
  review results are relayed through Owner/OC rather than posted as PR
  comments — no `gh pr view 37` comment trail exists to quote verbatim.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`, `PMS-BE-001.1`), không đổi backend request/response shape.
- Admin Web hiện có một **interactive Reservation Board frontend
  prototype** (`ADMIN-002.1`, PR #32) trên nền TailAdmin template baseline
  (PR #30) — frontend UI baseline hoàn tất, nhưng chỉ chạy trên **local
  deterministic mock state**: durable runtime mutation (lifecycle/folio/
  move) tại `reservationRuntimeReducer` trong `reservationRuntime.ts`;
  creation workflow dùng `formReducer` riêng trong
  `CreateReservationForm.tsx`; presentation/view state là component-local
  `useState` trong `ReservationBoard.tsx`. Không có backend call, không có
  persistence, không có Admin authentication/RBAC thật, không có OTA
  behavior thật — mỗi lần reload quay về đúng mock baseline ban đầu.
- `PROJECT_BIBLE.md`, `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`,
  ADR (0001–0006), test baseline và source code là nguồn sự thật sản phẩm/
  kiến trúc. Chúng phân biệt rõ CURRENT frontend prototype (mock-only),
  CURRENT backend (`PMS-BE-001.1` normalized Item/Unit authority, một
  RoomType/RatePlan mỗi public request; `PMS-BE-001.2` physical-room
  schedule database authority/availability/internal mutation boundary — cả
  hai đã hoạt động) và TARGET (multi-RoomType public request, HTTP/Admin/
  Calendar integration của schedule authority, Admin authentication/RBAC,
  OTA — chưa implement).
- Local Graphify tooling state (đọc/graph hoá source hiện có trên máy
  Claude, không commit vào Git) không được gộp với tracked repository
  state hay product/backend implementation state — nó không tạo, sửa hay
  xoá bất kỳ table, migration, endpoint hay UI nào.
- Template hotel assets hiện có trạng thái quyền sử dụng chưa được chứng
  minh đầy đủ; chỉ dùng development/reference, không được tự động promote
  sang production.

## 6. Operating model đang được áp dụng

- Owner Hồ Đình Lâm: quyết định cuối, Ready/merge, branch cleanup và mở task
  tiếp theo. Control Tower: objective/execution order cấp cao và
  escalation. OC: phân rã work item/checkpoint, viết Master Execution
  Prompt, review report/diff/PR. Implementer được Master Execution Prompt
  chọn (Claude hoặc Codex): duy nhất có quyền ghi code/working tree.
  Reviewer ghép cặp: read-only (`docs/governance/RULES.md` §2.4).
- Mô hình lịch sử trước `AI-OPS-GOV-003` (không còn là policy hiện tại,
  xem §2.4 `docs/governance/RULES.md`): `Claude writes. Codex reviews. OC
  decides. Owner merges.` — đã chứng minh hoạt động xuyên suốt
  `AI-OPS-PILOT-001`, `FE-002.1`, `ADMIN-001.1`, `PMS-DATA-DOCS-001`,
  `ADMIN-002.1`, `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`, `PMS-BE-001.1`, và
  `PMS-BE-001.2` (bao gồm hai correction cycle `C1`/`C2` trước khi merge).
- **Single-checkout workflow (khôi phục từ `PMS-BE-001.1-DOCS-CLOSEOUT`):**
  dự án dùng đúng một checkout repository đang tồn tại
  (`/home/admin1/The_BHA_hotels_Booking`). Một work item dùng một feature
  branch, checkout trực tiếp trong đó; chỉ `ACTIVE_EXECUTOR` được Master
  Execution Prompt chọn có write lock.
  `git worktree add` và mọi checkout thực thi bổ sung đều bị **cấm** —
  không có ngoại lệ, không có field ủy quyền, không có policy matrix cho
  việc này (PR #35 từng dùng và sau đó đã xóa một linked worktree trong
  quá trình implementation của nó — xem §4 — đó là lịch sử đã kết thúc,
  không phải cơ chế còn hiệu lực). Chi tiết và vòng đời branch chuẩn:
  `docs/governance/RULES.md` §5 (canonical), `AGENTS.md` §8,
  `docs/governance/WORKFLOW.md` §8.
- Sau implementation/correction và mandatory checks, `ACTIVE_EXECUTOR`
  dừng ghi tại checkpoint ổn định và công bố `READY_FOR_<REVIEWER>_REVIEW`;
  chỉ Owner mới invoke reviewer đã chọn (`/codex:review --base
  origin/develop`, hoặc base do prompt chỉ định, khi reviewer là Codex;
  một phiên Claude read-only riêng khi reviewer là Claude). Không dùng
  rescue, transfer, Codex write mode, automatic review gate, parallel
  agent hoặc nested implementation orchestration — mô hình
  single-primary-checkout không thay đổi bất biến này.

## 7. Tooling migration state

- `openai/codex-plugin-cc`: review-only bridge, operating throughout all
  closed work items above.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`. Graphify
  adoption does not imply GitNexus removal.
- Graphify: adopted as an optional, workspace-local code-navigation tool
  (§2). `docs/governance/WORKFLOW.md` §12 is the canonical policy —
  `GRAPHIFY_POLICY` values, freshness, and install/rebuild boundaries live
  there, not duplicated here. Queried once during `PMS-BE-001.1` Phase 0
  preflight (graph fresh at that time; every result cross-checked directly
  against source); not invoked by `PMS-BE-001.1-DOCS-CLOSEOUT`
  (docs-only, `NOT_APPLICABLE` per the WORKFLOW.md §12 mapping table).
- `diagnosing-bugs` (`mattpocock/skills`): conditional global skill. Not
  invoked by `PMS-BE-001.1` (no concrete reproducible defect — every test
  failure during that session was an immediately obvious authoring mistake,
  fixed directly). Not applicable to `PMS-BE-001.1-DOCS-CLOSEOUT`
  (docs-only, no defect in scope).
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 8. Current objective

`PMS-BE-001.1`, `PMS-BE-001.1-DOCS-CLOSEOUT`, `PMS-BE-001.2`, và
`PMS-BE-001.2-DOCS-CLOSEOUT` đã đóng (`PASS — CLOSED`, PR
#35/#36/#37/#38 merged). Objective hiện tại là hoàn tất `AI-OPS-GOV-003` —
thay phân công cố định Claude-implement/Codex-review bằng mô hình
prompt-selected role pair, giữ nguyên one-writer, independent review, OC
authority và Owner-only merge:

1. Claude hoàn tất đúng năm file governance/state trong allowlist của
   Master Execution Prompt (`AGENTS.md`, `CLAUDE.md`,
   `docs/governance/RULES.md`, `docs/governance/WORKFLOW.md`,
   `docs/project/SNAPSHOT.md` — file này), tự kiểm tra, dừng mọi thao tác
   ghi tại checkpoint ổn định, và giao lại cho Owner.
2. Theo một quyết định one-time hiện tại của Owner, PR này không yêu cầu
   Codex review; Owner tự xem diff và quyết định Ready/merge trực tiếp.
   Ngoại lệ này chỉ áp dụng cho `AI-OPS-GOV-003`, không phải policy chung
   cho các product work item.
3. Nếu Owner (đóng vai OC) yêu cầu correction, OC phát hành một correction
   prompt mới cho Claude và Owner activate Claude trước khi Claude ghi
   thêm bất kỳ điều gì.
4. Chỉ Owner quyết định Ready/merge/branch cleanup cho `AI-OPS-GOV-003`.
5. Sau khi merge, OC soạn Master Execution Prompt riêng cho `PMS-CAL-001.1`
   planning/decomposition, dùng `origin/develop` baseline mới.

Không tự động mở `DATA-001.2`, không tự động bắt đầu implementation cho
`PMS-CAL-001.1`, và không tự động mở bất kỳ product/backend work item nào
khác từ Snapshot này.

## 9. Main risks

- Coi việc chọn `PMS-CAL-001.1` là authorization ngầm cho việc bắt đầu
  Calendar implementation — không đúng; bản cập nhật này chỉ authorize OC
  planning, không authorize bất kỳ Calendar source code/API/HTTP config/
  frontend integration/authentication/schema/migration/test/dependency nào.
- Nhầm frontend mock prototype (`ADMIN-002.1`) với backend PMS behavior
  thật.
- Nhầm database authority/internal mutation boundary của `RoomOccupancySegment`/
  `RoomBlock` (`PMS-BE-001.2`, đã CURRENT) với HTTP/Admin/Calendar
  integration, Staff identity, hoặc Admin RBAC thật — những thứ này vẫn
  TARGET, chưa implement; `ActorReference`/`AuthorizationEvidence` chỉ là
  opaque string, không phải permission check thật.
- Nhầm foundation normalized Item/Unit (`PMS-BE-001.1`, single-RoomType
  public request) với multi-RoomType public request TARGET đã implement —
  vẫn chưa implement.
- Coi `AI-OPS-GOV-003` (docs-only, chưa merge) là tương đương đã merge —
  không đúng cho đến khi Owner xác nhận merge SHA của chính work item này.
- Tạo `git worktree add` hoặc bất kỳ checkout thực thi bổ sung nào — luôn
  bị cấm, không có ngoại lệ (`docs/governance/RULES.md` §5).
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate working tree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.

## 10. First action

Owner xem completion report của `AI-OPS-GOV-003` và diff của Draft PR #39
trực tiếp — không cần invoke Codex review cho PR này theo quyết định
one-time hiện tại của Owner — rồi quyết định Ready/merge. Sau khi Owner
xác nhận merge SHA và checkout sạch, OC soạn Master Execution Prompt riêng
cho `PMS-CAL-001.1` planning, dùng baseline `origin/develop` mới.
