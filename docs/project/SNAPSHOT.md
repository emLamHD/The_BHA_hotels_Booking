# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-25
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đóng `PMS-BE-001.1` sau khi PR #35 đã merge vào `develop`
và khôi phục workflow mặc định về đúng một primary working tree, theo
Master Execution Prompt `PMS-BE-001.1-DOCS-CLOSEOUT`
(`docs/pms-be-001-1-closeout-single-checkout`, docs-only). Repository SHA và
PR state bên dưới là baseline đã được xác minh trực tiếp qua
`git`/`gh pr view` tại thời điểm cập nhật tài liệu này, không phải cam kết
rằng SHA này sẽ còn là `develop` HEAD sau các commit tiếp theo; revalidate
lại `origin/develop` trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `265d10006b219e456c30ed92bbb6c153a946944d` |
| PR #31 | merged — `docs(pms): record core database blueprint v2`, merge commit `bfb3377b701e9309d3cbbea22bb18159bc37a2e0`, merged `2026-08-19T10:56:01Z`. Persists PMS blueprint documentation foundation (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006). |
| PR #32 | merged — `feat(admin): add PMS reservation board UI baseline`, merge commit `17e929d7c1f82941599223344b5f4cdc3aa34307`, merged `2026-08-22T14:42:31Z`. Closes `ADMIN-002.1`. |
| PR #33 | merged — `docs(project): close ADMIN-002.1 and record next sequence`, merge commit `2c38face7cf51d7271c361e6d684adea466edcf9`, merged `2026-08-22T15:38:25Z`. Closes `ADMIN-002.1-DOCS-CLOSEOUT`. |
| PR #34 | merged — `docs(project): record Graphify tooling adoption`, merge commit `7db8844dfde5ccc0651949f83ddfff76a3a977b9`, merged `2026-08-22T19:08:04Z`. Closes `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`; remote branch `docs/tool-graphify-001-closeout` deleted. This row is the current-state truth, replacing a since-corrected stale reference that had lingered in this file's own §7 section. |
| PR #35 | merged — `feat(booking): normalize commercial commitments`, feature branch `feature/pms-be-001-1-commercial-commitment-v2-foundation` (head `9e25f7cb6247420467957061a13c04801ce9b3c7`), merge commit `265d10006b219e456c30ed92bbb6c153a946944d`, merged `2026-08-24T16:46:46Z`. Closes `PMS-BE-001.1`. GitHub CI (Admin/Backend/Frontend) confirmed `pass` on this PR as of this Snapshot update (`gh pr checks 35`). Remote feature branch deleted (confirmed empty via `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`); the linked worktree `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for its implementation is confirmed removed (directory absent, not listed by `git worktree list --porcelain`) — see §4. |
| PR/branch của work item hiện tại | `PMS-BE-001.1-DOCS-CLOSEOUT` (docs-only) — feature branch `docs/pms-be-001-1-closeout-single-checkout`, checked out directly in the primary working tree `/home/admin1/The_BHA_hotels_Booking` (no linked worktree — `LINKED_WORKTREE: NOT_AUTHORIZED` for this work item), baseline `265d10006b219e456c30ed92bbb6c153a946944d`. Claude stops writes at a stable checkpoint and reports `READY_FOR_CODEX_REVIEW`; Draft PR to be opened by Claude per the Master Execution Prompt before Owner invokes review — not Ready or merged. Ready/merge/branch cleanup remain Owner-only. |
| Open execution PR khác | không có, theo `gh pr list --state open` tại thời điểm cập nhật Snapshot này (ngoài PR của work item hiện tại ở trên, nếu đã được mở). |

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

### Đang thực thi

- `PMS-BE-001.1-DOCS-CLOSEOUT` — docs/governance closeout of `PMS-BE-001.1`
  and restoration of single-primary-checkout-by-default governance. Claude
  implementing under this Snapshot's own Master Execution Prompt; see the
  "PR/branch của work item hiện tại" row in §1. Not yet reviewed or merged.

### Quyết định đang hiệu lực

`PMS_BE_001_1_CLOSED_SINGLE_CHECKOUT_DEFAULT_RESTORED_NO_NEXT_PRODUCT_ITEM_AUTO_AUTHORIZED`

Ý nghĩa:

- `PMS-BE-001.1` là `PASS — CLOSED`. Việc đóng work item này **không** tự
  động mở bất kỳ product implementation work item kế tiếp nào — không
  multi-RoomType public request, không physical-room allocation
  (`RoomOccupancySegment`/`RoomBlock`), không OTA, không `FolioEntries`,
  không Admin backend integration, không `DATA-001.2`.
- Governance mặc định quay về đúng một primary working tree cho execution
  (`docs/governance/RULES.md` §5); linked worktree chỉ được phép khi một
  Master Execution Prompt tương lai cấp quyền rõ ràng theo §5.3 của file đó.
- Chỉ Owner quyết định work item sản phẩm nào (nếu có) sẽ được authorize kế
  tiếp, và bằng Master Execution Prompt riêng.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET vượt ngoài phạm
  vi `PMS-BE-001.1` (Organization, multi-RoomType Hold/Reservation
  **request** shape, `RoomOccupancySegments`, `RoomBlock`, PostgreSQL
  exclusion constraints, `FolioEntries`, OTA adapter/inbox/outbox,
  backend-integrated Admin Calendar/PMS): **locked** — documented as
  TARGET/APPROVED by `PMS-DATA-DOCS-001`, not authorized for implementation
  by this work item. Implementation requires a separate, future Master
  Execution Prompt defining exact scope, after a new Owner/Control Tower
  decision (§9).
- Payments/refunds, full housekeeping/maintenance modules, production
  migrations for any PMS TARGET entity, and adapter-specific OTA design:
  locked, unrelated separately authorized future work.

## 3. Current PostgreSQL schema and Hold/Reservation model

- Migration chain is now **seven** migrations, ending at
  `20260823084717_CommercialCommitmentV2Foundation` (`PMS-BE-001.1`, merged
  via PR #35). No migration was modified; the seventh migration is
  additive/replacing via a single-transaction expand → transform → contract
  cutover. No other PMS migration exists (Organization,
  `RoomOccupancySegment`, `RoomBlock`, `FolioEntries`, OTA inbox/outbox
  remain unimplemented — see below).
- CURRENT commercial commitment authority (`BE-003.1`–`BE-003.5`,
  `PMS-BE-001.1`) is the ADR 0005 normalized model:
  `InventoryHold → InventoryHoldItem → InventoryHoldItemNight` and
  `Reservation → ReservationUnit → ReservationUnitNight`. Every persisted
  Item/Unit represents exactly one room (no `Quantity`/`Rooms` field exists
  on Item/Unit/Night); every nightly row carries its own `RatePlanId` and
  accepted money. `ReservationUnit.CommitmentStatus = Committed | Cancelled`
  is the sole demand predicate — committed demand counts every
  `InventoryHoldItemNight` of an `Active`, unexpired Hold and every
  `ReservationUnitNight` of a `Committed` Unit, exactly once. This work item
  exposes only whole-Reservation cancellation (no independent per-Unit
  cancellation endpoint); cancelling a Reservation atomically transitions
  every still-`Committed` Unit to `Cancelled` in the same transaction. The
  public `/api/v1` contract, and the CURRENT limitation to exactly one
  RoomType/RatePlan per public Hold/Reservation request, are both unchanged
  — the request is atomically normalized into `Q` independent Items/Units
  internally; multi-RoomType **request** shape remains TARGET. The legacy
  `BookingHold`/`BookingHoldNight`/`ReservationNight` tables and the
  `RoomTypeId`/`RatePlanId`/`Rooms` columns previously on `Reservations` no
  longer exist — there is no dual-write and no dormant normalized table.
- No `Organization` entity, no `RoomOccupancySegment`/`RoomBlock` table, no
  PostgreSQL exclusion constraint, and no `btree_gist` dependency exist
  anywhere in the current schema or codebase.
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
  RoomType/RatePlan mỗi public request, đã hoạt động) và TARGET
  (multi-RoomType public request, physical allocation, OTA, Admin backend
  integration — chưa implement).
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
  Prompt, review report/diff/PR. Claude Code: implementer duy nhất có
  quyền ghi code/working tree. Codex: reviewer read-only.
- Operating invariant: `Claude writes. Codex reviews. OC decides. Owner
  merges.` — đã chứng minh hoạt động xuyên suốt `AI-OPS-PILOT-001`,
  `FE-002.1`, `ADMIN-001.1`, `PMS-DATA-DOCS-001`, `ADMIN-002.1`,
  `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`, và `PMS-BE-001.1`.
- **Single-primary-checkout default (khôi phục từ `PMS-BE-001.1-DOCS-CLOSEOUT`):**
  execution mặc định chỉ dùng đúng một filesystem checkout — primary
  working tree của repository (`/home/admin1/The_BHA_hotels_Booking`). Một
  work item dùng một feature branch, checkout trực tiếp trong primary
  working tree đó; chỉ Claude có write lock. Linked worktree
  (`git worktree add`) không thuộc workflow mặc định — chỉ được phép khi
  một Master Execution Prompt tương lai ghi rõ `LINKED_WORKTREE:
  AUTHORIZED` kèm path/lý do/branch ownership/review location/cleanup
  owner/cleanup sequence (`docs/governance/RULES.md` §5.3). Chi tiết đầy đủ
  và vòng đời branch chuẩn: `docs/governance/RULES.md` §5 (canonical),
  `AGENTS.md` §8, `docs/governance/WORKFLOW.md` §8.
- Sau implementation/correction và mandatory checks, Claude dừng ghi tại
  checkpoint ổn định và công bố `READY_FOR_CODEX_REVIEW`; chỉ Owner mới
  invoke `/codex:review --base origin/develop` (hoặc base do prompt chỉ
  định). Không dùng rescue, transfer, Codex write mode, automatic review
  gate, parallel agent hoặc nested implementation orchestration — mô hình
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

`PMS-BE-001.1` đã đóng (`PASS — CLOSED`, PR #35 merged). Objective hiện tại
là hoàn tất `PMS-BE-001.1-DOCS-CLOSEOUT`:

1. Claude hoàn tất docs-only closeout (file này và 6 file còn lại trong
   allowlist của Master Execution Prompt), dừng mọi thao tác ghi tại
   checkpoint ổn định, và công bố `READY_FOR_CODEX_REVIEW`.
2. Owner xem completion report, mở Draft PR (nếu Claude chưa mở) và invoke
   đúng một lượt `/codex:review --base origin/develop`.
3. Owner chuyển kết quả Codex về; Claude chèn nguyên trạng vào completion
   report và dừng.
4. Owner chuyển report cho OC; OC kết luận `PASS`/`CORRECTION_REQUIRED`/
   `BLOCKED`.
5. Chỉ Owner quyết định Ready/merge/branch cleanup cho work item này, và có
   mở task backend/sản phẩm kế tiếp (multi-RoomType public request,
   physical-room allocation, OTA, Admin backend integration...) hay không —
   xem §2 "Quyết định đang hiệu lực".

Không tự động mở `DATA-001.2` hoặc bất kỳ product/backend work item nào
khác từ Snapshot này. **Không còn** current-state claim rằng PR #35 chưa
merge, hay rằng Codex review cho PR #35 vẫn đang chờ — cả hai đã hoàn tất
(§1, §2, §4).

## 9. Main risks

- Coi việc đóng `PMS-BE-001.1` (hoặc việc restore single-primary-checkout
  governance) là authorization ngầm cho bất kỳ work item backend/sản phẩm
  kế tiếp nào — không đúng; §2 "Quyết định đang hiệu lực" nói rõ.
- Nhầm frontend mock prototype (`ADMIN-002.1`) với backend PMS behavior
  thật.
- Nhầm foundation normalized Item/Unit (`PMS-BE-001.1`, single-RoomType
  public request) với multi-RoomType public request hoặc physical
  allocation TARGET đã implement — chúng vẫn chưa implement.
- Tạo linked worktree ngoài ngoại lệ đã được Owner cấp quyền rõ ràng
  (`docs/governance/RULES.md` §5.3) — mặc định là cấm.
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate working tree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.

## 10. First action

Owner xem completion report của `PMS-BE-001.1-DOCS-CLOSEOUT`, xác nhận Draft
PR (nếu đã mở bởi Claude) và invoke `/codex:review --base origin/develop`
đúng một lượt cho work item đó — đó là first action theo Master Execution
Prompt hiện tại. Việc chọn work item sản phẩm/backend kế tiếp (nếu có) là
một quyết định Owner riêng, chưa được authorize bởi Snapshot này.
