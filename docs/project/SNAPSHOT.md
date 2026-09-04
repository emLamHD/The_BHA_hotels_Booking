# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-09-04 (phiên làm việc bắt đầu 2026-09-04)
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này ghi nhận `PMS-CAL-001.1` — Reservation Board Read
Projection & Frontend Integration — đã **merged và closed**: PR #41 merge
vào `develop` lúc `2026-09-03T03:11:21Z`, merge commit
`e0f5a395aec15cc02e328433a97850e30e165675`, được ghi trong §1.1 là
`develop-checkpoint` — checkpoint đã reconcile lần cuối, không phải khẳng
định về `develop` HEAD hiện tại.

Bản cập nhật này đồng thời là một governance correction (`AI-OPS-GOV-004`).
Snapshot trước đó vẫn mô tả PR #41 là Draft/OPEN/chưa merge và vẫn ghi
`develop` HEAD là `ff9d5b0` sau khi PR đã merge. Root cause: mô tả
pre-merge được viết **trước** thời điểm merge, và quy trình khi đó không có
bước bắt buộc nào đọc lại GitHub sau khi Owner merge — nên drift là kết quả
có cấu trúc, không phải sơ suất cá biệt. Bước kiểm chứng đó nay đã tồn tại:
`tools/bha-sync/bha-sync.sh`, hợp đồng ở `docs/governance/BHA_SYNC.md`,
điểm gọi bắt buộc ở `docs/governance/WORKFLOW.md` §2 và §13.

Lịch sử checkpoint của `PMS-CAL-001.1` được giữ lại vì mỗi CI run và review
result trích dẫn dưới đây gắn với **đúng SHA nêu kèm**, không tự động áp cho
SHA khác (evidence canonical ở `docs/reports/PMS-CAL-001.1-completion.md`):

- **Product-reviewed checkpoint** — `63d9b6019e4af37e146d943a1b8c1c13ac096469`:
  implementation cộng correction cycles `C1`–`C9`. CI run `33707673146`
  `success` trên đúng SHA đó; Codex review trên chính checkpoint này trả
  về **không có actionable correctness defect**.
- **C10 docs-only checkpoint** — `e6999914dd7a5afbf791506ffb598a99b8c320e6`:
  đồng bộ Snapshot, không đụng product code. CI run `33708652703` `success`.
  Codex review trên checkpoint này trả về **hai finding tài liệu**, không
  phát hiện thêm defect nào trong product code.
- **C11**: docs-only correction xử lý hai finding đó; là commit cuối trên
  feature branch trước khi Owner merge.
- **Merge commit** — `e0f5a395aec15cc02e328433a97850e30e165675`: CI run
  `33710458612` `success` (Backend/Frontend/Admin) trên đúng merge commit.

Canonical record ở §1.1 đã được xác minh trực tiếp qua `git`/`gh` tại thời
điểm cập nhật tài liệu này. Nó **không** cam kết `develop-checkpoint` sẽ còn
bằng `develop` HEAD sau các commit tiếp theo — bất biến là checkpoint phải là
ancestor của HEAD hiện tại. Trước khi tạo feature branch mới, chạy
`git fetch --prune origin` rồi `tools/bha-sync/bha-sync.sh`, và chỉ dùng
baseline này khi kết quả là `SYNCHRONIZED`.

## 1. Repository state

§1 có hai phần với vai trò khác nhau, và **chỉ phần đầu là nguồn trạng thái**:

- **Canonical record** (khối `BHA-SYNC` bên dưới) — nơi duy nhất khẳng định
  repository, base branch, checkpoint và lifecycle của từng PR.
  `tools/bha-sync/bha-sync.sh` chỉ đọc đúng khối này và đối chiếu với GitHub
  live state.
- **PR context** (§1.2) — mô tả mỗi PR đã giao gì. **Không** phải nguồn trạng
  thái; không lặp lại lifecycle, merge commit hay `mergedAt`, để không tồn tại
  hai nguồn sự thật có thể lệch nhau.

`develop-checkpoint` là **checkpoint đã reconcile lần cuối**, không phải khẳng
định rằng nó bằng `develop` HEAD hiện tại. Yêu cầu bằng nhau là bất khả thi:
merge chính commit cập nhật Snapshot sẽ đẩy `develop` vượt qua SHA mà commit
đó ghi, nên mỗi lần reconcile sẽ lập tức drift lại. Bất biến đúng là
**checkpoint phải là ancestor của `origin/develop` HEAD hiện tại**; bằng nhau
được phép nhưng không bắt buộc. Live HEAD dùng để lập kế hoạch luôn lấy từ
Git sau khi fetch, không lấy từ tài liệu này.

### 1.1 Canonical record

<!-- BHA-SYNC:BEGIN — canonical machine-verified record; `bha-sync` reads only this block. `—` means null. -->

| Canonical field | Giá trị |
|---|---|
| repository | `emLamHD/The_BHA_hotels_Booking` |
| base-branch | `develop` |
| develop-checkpoint | `e0f5a395aec15cc02e328433a97850e30e165675` |

| PR | Base | Lifecycle | Merge commit | Merged at |
|---|---|---|---|---|
| 31 | `develop` | `MERGED` | `bfb3377b701e9309d3cbbea22bb18159bc37a2e0` | `2026-08-19T10:56:01Z` |
| 32 | `develop` | `MERGED` | `17e929d7c1f82941599223344b5f4cdc3aa34307` | `2026-08-22T14:42:31Z` |
| 33 | `develop` | `MERGED` | `2c38face7cf51d7271c361e6d684adea466edcf9` | `2026-08-22T15:38:25Z` |
| 34 | `develop` | `MERGED` | `7db8844dfde5ccc0651949f83ddfff76a3a977b9` | `2026-08-22T19:08:04Z` |
| 35 | `develop` | `MERGED` | `265d10006b219e456c30ed92bbb6c153a946944d` | `2026-08-24T16:46:46Z` |
| 36 | `develop` | `MERGED` | `298b7fd53c47824550e955b98c2bed370b38a646` | `2026-08-24T19:17:44Z` |
| 37 | `develop` | `MERGED` | `0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442` | `2026-08-26T10:33:13Z` |
| 38 | `develop` | `MERGED` | `f0eef23c59608d2aba1e43063c38074ea863edef` | `2026-08-26T12:01:07Z` |
| 39 | `develop` | `MERGED` | `89b631cc58cb4d21e99d6054d2a9094338283fc7` | `2026-09-01T15:44:40Z` |
| 40 | `develop` | `MERGED` | `ff9d5b0c8d58efe64b562c631ecb36d488887df8` | `2026-09-01T15:57:51Z` |
| 41 | `develop` | `MERGED` | `e0f5a395aec15cc02e328433a97850e30e165675` | `2026-09-03T03:11:21Z` |

<!-- BHA-SYNC:END -->

Khối này cố ý **không** liệt kê PR remediation governance đang mở của chính
bản Snapshot này. Một PR ghi lifecycle của chính nó sẽ tự tạo drift ngay khi
được merge: nội dung đã merge vẫn nói "DRAFT" trong khi GitHub nói "MERGED".
PR đó được truy vết ở `docs/reports/`, không ở đây.

### 1.2 PR context — không phải nguồn trạng thái

- **PR #31** — `docs(pms): record core database blueprint v2`. Persists the PMS
  blueprint documentation foundation
  (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006).
- **PR #32** — `feat(admin): add PMS reservation board UI baseline`. Closes
  `ADMIN-002.1`.
- **PR #33** — `docs(project): close ADMIN-002.1 and record next sequence`.
  Closes `ADMIN-002.1-DOCS-CLOSEOUT`.
- **PR #34** — `docs(project): record Graphify tooling adoption`. Closes
  `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`; remote branch
  `docs/tool-graphify-001-closeout` deleted.
- **PR #35** — `feat(booking): normalize commercial commitments`. Feature branch
  `feature/pms-be-001-1-commercial-commitment-v2-foundation`
  (head `9e25f7cb6247420467957061a13c04801ce9b3c7`). Closes `PMS-BE-001.1`.
  Remote feature branch deleted; the linked worktree
  `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for it is confirmed
  removed — see §4.
- **PR #36** — `docs(project): close PMS-BE-001.1 and restore single-checkout
  workflow`. Feature branch `docs/pms-be-001-1-closeout-single-checkout`
  (head `c8938c731dd5647868a07f0c3654d919e5d60e9a`). Closes
  `PMS-BE-001.1-DOCS-CLOSEOUT`.
- **PR #37** — `feat(pms): add physical room schedule and availability
  authority`. Feature branch
  `feature/pms-be-001-2-physical-room-schedule-availability`
  (head `4b2de0ab50fa1703f0b125a043d2461cc0309417`). Closes `PMS-BE-001.2`.
  GitHub Actions (Backend/Frontend/Admin) `success` on that head
  (run `32957454881`). Remote feature branch confirmed deleted.
- **PR #38** — `docs(project): close PMS-BE-001.2 and record calendar handoff`.
  Feature branch `docs/pms-be-001-2-closeout`
  (head `9b627fb29ce4b5b955e6e5640a465aa03953304f`). Closes
  `PMS-BE-001.2-DOCS-CLOSEOUT`.
- **PR #39** — `docs(governance): allow prompt-selected single implementer`.
  Closes `AI-OPS-GOV-003`.
- **PR #40** — `test(backend): pin clock in reservation-cancellation integration
  test`. Feature branch `fix/pin-clock-reservation-cancellation-test`. Unplanned
  CI fix: `AssignmentAwareAvailabilityTests.Reservation_cancellation_atomically_cancels_effective_assignments_and_removes_demand`
  never pinned `factory.Clock.UtcNow`, so it silently depended on real
  wall-clock time staying before its hardcoded `2026-09-01` check-in date.
  GitHub Actions (Admin/Backend/Frontend) `pass` on this head. Remote feature
  branch confirmed deleted.
- **PR #41** — `feat(pms): Reservation Board read projection & Admin frontend
  integration`. Feature branch `feature/pms-cal-001-1-board-read-integration`,
  checked out directly in the one repository checkout (no `git worktree add`),
  baseline `ff9d5b0c8d58efe64b562c631ecb36d488887df8` (PR #40). Closes
  `PMS-CAL-001.1`. GitHub Actions (Backend/Frontend/Admin) `success` on the
  merge commit (run `33710458612`). Remote feature branch confirmed deleted
  (`git ls-remote --heads origin feature/pms-cal-001-1-board-read-integration`
  empty). Checkpoint/correction history (`C1`–`C11`) và toàn bộ evidence:
  `docs/reports/PMS-CAL-001.1-completion.md`.

Không có product execution PR nào đang mở.

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
- `AI-OPS-GOV-003` — Prompt-Selected Single Implementer and Independent
  Reviewer: `PASS — CLOSED`. PR #39 merged as above (§1). Governance-only:
  replaces the repository's fixed Claude-implements/Codex-reviews
  assignment with a prompt-selected role pair (`docs/governance/RULES.md`
  §2.4), while preserving one writer, independent read-only review, OC
  authority and Owner-only merge. Went through correction cycles
  `C1`/`FINAL-SIMPLIFICATION`/`RESIDUAL-FIX`/`FINAL-INVOCATION-FIX` before
  merge — full detail in `docs/daily/2026-09/2026-09-01-worklog.md`.
- `CI fix (unplanned)`: `PASS — CLOSED`. PR #40 merged as above (§1). Fixed
  a test-time-bomb (`AssignmentAwareAvailabilityTests`, unpinned
  `factory.Clock.UtcNow` against a hardcoded 2026-09-01 date) that broke CI
  once real wall-clock time caught up. Not tied to any work-item ID; not a
  product/schema change.
- `PMS-CAL-001.1` — Reservation Board Read Projection & Frontend
  Integration: `PASS — CLOSED`. PR #41 merged as above (§1), merge commit
  `e0f5a395aec15cc02e328433a97850e30e165675`, merged `2026-09-03T03:11:21Z`.
  Exposes the Admin Reservation Board as a **read-only** projection
  (`GET /api/admin/v1/properties/{propertyId}/reservation-board`) and points
  the `ADMIN-002.1` board frontend at it instead of browser-memory mock
  state. Implementation plus correction cycles `C1`–`C11`; product code was
  reviewed clean at checkpoint `63d9b6019e4af37e146d943a1b8c1c13ac096469`
  (CI run `33707673146` `success`; Codex: no actionable correctness
  finding), and `C10`/`C11` were docs-only. Real HTTPS +
  disposable-PostgreSQL + Chrome-browser acceptance performed and passed
  (§4). No schema/migration change (still migration 8, no migration 9), no
  mutation API, no Admin authentication/RBAC. Customer Web **did** change at
  the HTTPS/transport boundary at `C6` (HTTPS-only API base, loopback-HTTPS
  dev launcher, env example/README/tests) — no new booking behavior, no
  weakened antiforgery; exact detail in the completion report §3. Full
  correction history and evidence — **canonical** —
  `docs/reports/PMS-CAL-001.1-completion.md`; không liệt kê lại ở đây.

### Đang thực thi

- Không có product work item nào đang thực thi. `PMS-CAL-001.2` chưa bắt
  đầu và không được tự động kích hoạt từ Snapshot này.

### Quyết định đang hiệu lực

`PMS_CAL_001_1_MERGED_AND_CLOSED`

Ý nghĩa:

- `PMS-CAL-001.1` đã merge và đóng. Merge commit
  `e0f5a395aec15cc02e328433a97850e30e165675` được ghi ở §1.1 là
  `develop-checkpoint`; CI run `33710458612` `success` trên đúng commit đó.
  Remote feature branch đã bị xóa.
- Không còn bước review hay merge nào đang chờ cho work item này. Mọi mô tả
  "đang chờ Codex review trên C11 PR head" trong các bản Snapshot trước đã
  hết hiệu lực.
- Bước kế tiếp thuộc về Owner và Control Tower: chọn work item kế tiếp.
  Snapshot này không tự mở `DATA-001.2`, `PMS-CAL-001.2` hay bất kỳ
  product/backend work item nào khác.
- Trước khi dùng Snapshot này làm planning baseline, chạy
  `tools/bha-sync/bha-sync.sh` và chỉ tiếp tục khi kết quả là
  `SYNCHRONIZED` (`docs/governance/WORKFLOW.md` §2,
  `docs/governance/BHA_SYNC.md`).
- Chỉ Owner được mark Ready, merge và branch cleanup. Agent không merge,
  không mark Ready, không xóa branch, và không tự invoke reviewer.
- Governance vẫn dùng đúng một checkout repository duy nhất cho execution
  (`docs/governance/RULES.md` §5); `git worktree add` và mọi checkout thực
  thi bổ sung đều bị cấm, không có ngoại lệ.

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
- CURRENT Admin Calendar read exposure (`PMS-CAL-001.1`, no schema change):
  one HTTP `GET` endpoint,
  `/api/admin/v1/properties/{propertyId}/reservation-board`, projects the
  existing `RoomOccupancySegment`/`RoomBlock` authority (above) into a
  frozen read-only JSON contract for the Admin Reservation Board frontend.
  **Read-only**; no mutation endpoint of any kind exists over HTTP. Mỗi
  request chỉ được phục vụ khi **tất cả** điều kiện sau đúng, kiểm tra
  trước model binding: HTTPS; host environment là Development; địa chỉ
  local **và** remote của connection đều là loopback; và
  `AdminCalendar:EnableUnauthenticatedRead` là `true` — mà cờ này mặc định
  `false` **kể cả trong Development**, chỉ được bật bởi supported local
  HTTPS launch profile (`AdminCalendar__EnableUnauthenticatedRead=true`,
  bind duy nhất vào `localhost`), và không thể bật ở Production
  (startup-fatal). Mọi request không thỏa mãn nhận `404` + `no-store`,
  không phân biệt được với route không tồn tại. Đây là endpoint
  **same-machine development only** — không public production-ready, và
  Admin authentication/RBAC vẫn deferred. Exact contract/coverage-
  classification detail: `docs/reports/PMS-CAL-001.1-completion.md`.
- The `ADMIN-002.1` frontend's Reservation Board (§5) now reads this real
  endpoint instead of browser-memory mock state (`PMS-CAL-001.1`, §2); the
  rest of that prototype (front-desk creation workspace, lifecycle/folio/
  move demonstrations) is unchanged and still mock-only.

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

`PMS-CAL-001.1` (PR #41): full `C1`–`C11` checkpoint/correction history,
self-review, and the real HTTPS + disposable-PostgreSQL + Chrome-browser
acceptance evidence are recorded in
`docs/reports/PMS-CAL-001.1-completion.md` — not duplicated here. Merge
evidence independently verified for this closeout via:

- `gh pr view 41`: `state=MERGED`, `isDraft=false`,
  `headRefOid=d7ad9e00dd6edeef93745c13d0ba7c81844f3bed`,
  `mergeCommit=e0f5a395aec15cc02e328433a97850e30e165675`,
  `mergedAt=2026-09-03T03:11:21Z`, `baseRefName=develop`.
- `git merge-base --is-ancestor e0f5a39 origin/develop`: merge commit is
  contained by `origin/develop`. It is also the `develop-checkpoint`
  recorded in §1.1; containment, not equality with the live tip, is the
  invariant `bha-sync` enforces.
- Check runs on `e0f5a39`: `Backend`, `Frontend`, `Admin` all `success`
  (workflow run `33710458612`, `conclusion=success`).
- `git ls-remote --heads origin feature/pms-cal-001-1-board-read-integration`:
  empty — remote feature branch deleted.
- Final Codex/OC review outcome: relayed through Owner/OC rather than
  posted as PR comments, same as PR #37 above; not re-derivable from a
  `gh pr view 41` comment trail.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`, `PMS-BE-001.1`), không đổi backend request/response shape.
- Admin Web hiện có một **interactive Reservation Board frontend** trên nền
  TailAdmin template baseline (PR #30, `ADMIN-002.1`). Kể từ
  `PMS-CAL-001.1` (§2), phần đọc chính của Reservation Board
  (`ReservationBoard.tsx`/`ReservationBoardServerTimeline.tsx`/
  `ReservationBoardStayPopover.tsx`) đọc **dữ liệu thật, read-only**, qua
  HTTPS, từ `GET /api/admin/v1/properties/{propertyId}/reservation-board`
  (§3) — không còn dùng `mockData.ts`/`reservationRuntime.ts`. Các phần
  khác của prototype `ADMIN-002.1` (front-desk creation workspace,
  lifecycle/folio/move demonstrations tại `reservationRuntimeReducer` trong
  `reservationRuntime.ts`, `formReducer` trong `CreateReservationForm.tsx`)
  **vẫn** chỉ chạy trên local deterministic mock state — không có backend
  call, không có persistence, không có Admin authentication/RBAC thật,
  không có OTA behavior thật, và không có mutation endpoint nào (assignment/
  block create/move/cancel) được expose qua HTTP.
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
- `bha-sync` (`tools/bha-sync/bha-sync.sh`): project-local, repository-tracked,
  **bắt buộc** trước khi bất kỳ agent nào dùng file này làm planning baseline,
  và trong post-merge closeout. Read-only: đối chiếu **canonical block §1.1**
  với GitHub live state (lifecycle, base branch, merge evidence, và checkpoint
  ancestry), fail closed khi không xác minh được, và không bao giờ tự ghi vào
  Snapshot. Yêu cầu bash >= 4.0, `git`, `gh` đã authenticate.
  Hợp đồng: `docs/governance/BHA_SYNC.md`; điểm gọi:
  `docs/governance/WORKFLOW.md` §2 và §13. Regression harness:
  `tools/bha-sync/tests/run-tests.sh`.
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 8. Current objective

`PMS-CAL-001.1` — Reservation Board Read Projection & Frontend Integration
— đã đóng (`PASS — CLOSED`, PR #41 merged, merge commit
`e0f5a395aec15cc02e328433a97850e30e165675`, `2026-09-03T03:11:21Z`; §1, §2,
§4). Không còn review gate hay merge nào đang chờ trên work item đó.

Objective hiện tại:

1. Owner và Control Tower chọn work item kế tiếp. Snapshot này không tự
   chọn giúp.
2. Bất kỳ phiên nào trước khi dùng Snapshot này làm planning baseline:
   `git fetch --prune origin`, rồi `tools/bha-sync/bha-sync.sh`. Chỉ tiếp
   tục khi kết quả là `SYNCHRONIZED`; `DRIFT_DETECTED` và
   `SYNC_UNVERIFIED` đều chặn planning và implementation
   (`docs/governance/BHA_SYNC.md`, `WORKFLOW.md` §2).
3. Correction cho một tài liệu canonical luôn đi qua feature branch + PR và
   do Owner merge — không ghi thẳng vào `develop` hay `main`.

Không tự động mở `DATA-001.2`, không tự động bắt đầu `PMS-CAL-001.2` hay
bất kỳ product/backend work item nào khác từ Snapshot này.

## 9. Main risks

- Coi `SNAPSHOT.md` là đúng mà không đối chiếu GitHub — đây chính là drift
  đã xảy ra với PR #41: tài liệu mô tả Draft/OPEN/chưa merge sau khi PR đã
  merge, và checkpoint vẫn ghi baseline cũ. Chạy
  `tools/bha-sync/bha-sync.sh` trước khi dùng file này làm baseline; không
  đọc được GitHub thì fail closed, không suy diễn.
- Trích một CI run hoặc review result sang một SHA khác với SHA nêu kèm nó
  — không hợp lệ. Mỗi con số trong tài liệu này gắn với đúng commit được
  ghi bên cạnh.
- Nhầm phần Reservation Board **đọc** dữ liệu thật qua HTTPS
  (`PMS-CAL-001.1`) với một Admin Calendar đã có mutation/CRUD thật — không
  đúng: không có mutation endpoint nào được expose qua HTTP; assignment/
  block mutation vẫn chỉ tồn tại ở tầng application/persistence nội bộ
  (`PMS-BE-001.2`).
- Nhầm phần còn lại của frontend mock prototype (`ADMIN-002.1`: front-desk
  creation workspace, lifecycle/folio/move demonstrations) — vẫn hoàn toàn
  mock-only — với backend PMS behavior thật.
- Coi `AdminCalendar:EnableUnauthenticatedRead` là bằng chứng sẵn sàng
  public-Internet production — không đúng; "commercial-quality" trong
  `PMS-CAL-001.1` nghĩa là robust/verified/merge-ready, không phải public
  production-ready. Board read là **same-machine development only**: mặc
  định tắt kể cả ở Development, chỉ bật qua supported local HTTPS launch
  profile, và chỉ phục vụ request HTTPS loopback-to-loopback (§3). Nó
  không được để lộ qua LAN/public listener hay external-facing proxy;
  Admin authentication/RBAC vẫn deferred.
- Nhầm database authority/internal mutation boundary của `RoomOccupancySegment`/
  `RoomBlock` (`PMS-BE-001.2`, đã CURRENT) với HTTP/Admin/Calendar
  integration, Staff identity, hoặc Admin RBAC thật — những thứ này vẫn
  TARGET, chưa implement; `ActorReference`/`AuthorizationEvidence` chỉ là
  opaque string, không phải permission check thật.
- Nhầm foundation normalized Item/Unit (`PMS-BE-001.1`, single-RoomType
  public request) với multi-RoomType public request TARGET đã implement —
  vẫn chưa implement.
- Coi các đoạn cert/HTTPS-trust runtime-only dùng cho Phase 3 browser
  acceptance của `PMS-CAL-001.1` (`Kestrel:Certificates:Default:*` trỏ vào
  một chứng chỉ `mkcert` cục bộ, `mkcert -install` vào system trust store)
  là một phần cấu hình đã commit — không đúng: đó chỉ là tiện ích kiểm thử
  cục bộ, không nằm trong bất kỳ file được commit nào, và không thay đổi
  cách backend chạy ở Development/Production.
- Tạo `git worktree add` hoặc bất kỳ checkout thực thi bổ sung nào — luôn
  bị cấm, không có ngoại lệ (`docs/governance/RULES.md` §5).
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate working tree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.

## 10. First action

Chạy `git fetch --prune origin`, rồi `tools/bha-sync/bha-sync.sh`. Kết quả
phải là `SYNCHRONIZED` trước khi dùng Snapshot này làm planning baseline;
`DRIFT_DETECTED` hoặc `SYNC_UNVERIFIED` là stop condition — báo field drift
kèm giá trị snapshot và giá trị GitHub, và yêu cầu canonical correction qua
feature branch + PR thay vì tiếp tục.

Khi baseline đã đồng bộ: `PMS-CAL-001.1` đã đóng và không có product work
item nào đang thực thi, nên hành động kế tiếp là Owner và Control Tower
chọn work item kế tiếp rồi OC viết Master Execution Prompt cho nó
(`docs/governance/WORKFLOW.md` §3–§4). Bối cảnh sản phẩm gần nhất:
`docs/reports/PMS-CAL-001.1-completion.md`.
