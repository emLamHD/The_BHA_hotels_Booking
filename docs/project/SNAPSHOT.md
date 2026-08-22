# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-22
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đồng bộ Snapshot với trạng thái thực tế sau khi PR #31 (PMS
blueprint documentation foundation) và PR #32 (`ADMIN-002.1` — PMS
Reservation Board UI baseline) đã merge, và sau khi work item
`ADMIN-002.1-DOCS-CLOSEOUT` (docs-only) đồng bộ lại các nguồn sự thật khác.
Repository SHA và PR state bên dưới là baseline đã được xác minh cho lần cập
nhật tài liệu này, không phải cam kết rằng SHA này sẽ còn là `develop` HEAD
sau các commit tài liệu hoặc merge tiếp theo; revalidate lại
`origin/develop` trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `17e929d7c1f82941599223344b5f4cdc3aa34307` |
| PR #31 | merged — `docs(pms): record core database blueprint v2`, merge commit `bfb3377b701e9309d3cbbea22bb18159bc37a2e0`, merged `2026-08-19T10:56:01Z`. Persists PMS blueprint documentation foundation (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006). |
| PR #32 | merged — `feat(admin): add PMS reservation board UI baseline`, merge commit `17e929d7c1f82941599223344b5f4cdc3aa34307`, merged `2026-08-22T14:42:31Z`. Feature branch `feature/admin-002-1-reservation-board-ui-baseline`, feature head `e1ab378d3222dc555dc33d9408ea7ee57cdfc8db`. Closes `ADMIN-002.1`. |
| PR/branch của work item hiện tại | [`#33`](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/33) — `OPEN`, `DRAFT`; head branch `docs/admin-002-1-closeout`; base `develop`. `ADMIN-002.1-DOCS-CLOSEOUT` (docs-only). Not Ready or merged; Ready/merge/branch cleanup remain Owner-only. |
| Open execution PR khác | không có, theo `gh pr list --state open` tại thời điểm cập nhật Snapshot này (ngoài PR #33 ở trên). |

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
  Owner-approved TARGET PMS/database architecture (Organization/Property
  scoping, multi-RoomType Hold/Reservation, physical allocation via
  `RoomOccupancySegments`, PostgreSQL exclusion invariants, financial/
  guest/OTA boundaries) into durable documentation. No table, column,
  constraint, migration, entity, endpoint, or UI described there is
  implemented by that documentation.
- `ADMIN-002.1` — PMS Reservation Board UI Baseline: `PASS — CLOSED`. PR #32
  merged as above. Adds an **interactive frontend prototype** to
  `Front_End/Admin_Web`'s `/calendar` page: room/date timeline,
  multi-property demo switching, assigned/unassigned reservations,
  operational blocks, reservation hover/detail views, drag-and-drop room
  moves, date shifting, negotiated pricing, a front-desk
  reservation-creation workspace, and a front-desk lifecycle/folio/notes/
  activity operations workspace. Full evidence in
  `docs/reports/ADMIN-002.1-completion.md`.

### Quyết định đang hiệu lực

`ADMIN-002.1-DOCS-CLOSEOUT_IS_THE_SOLE_AUTHORIZED_WORK_ITEM_UNTIL_OWNER_DECISION`

Ý nghĩa:

- `ADMIN-002.1-DOCS-CLOSEOUT` (docs-only, đang ở Draft PR #33) là work item
  duy nhất đang active kể từ Snapshot này, cho đến khi Owner đưa ra quyết
  định kế tiếp.
- Việc đóng `ADMIN-002.1-DOCS-CLOSEOUT` không tự động mở bất kỳ product
  implementation work item nào — không cài Graphify, không database
  migration, không backend Admin Calendar/PMS, không OTA, không Customer Web
  change, không `DATA-001.2`.
- Work item kế tiếp do Owner/Control Tower chọn, theo trình tự khóa ở §9,
  là cài đặt/đánh giá Graphify cho Claude dưới tooling-adoption gate hiện có
  (`docs/governance/WORKFLOW.md` §12) — **không phải** một work item backend.
- Chỉ sau khi work item Graphify đóng thành công **và** Owner có một quyết
  định mới, một work item backend Calendar/PMS mới có thể mở.
- `DATA-001.2` tiếp tục dormant/deferred; không tự động kích hoạt lại.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET (Organization
  entity, multi-RoomType Hold/Reservation schema, `RoomOccupancySegments`,
  `RoomBlock`, PostgreSQL exclusion constraints, `FolioEntries`, Stay
  Declaration, OTA adapter/inbox/outbox, backend-integrated Admin
  Calendar/PMS): **locked** — documented as TARGET/APPROVED by
  `PMS-DATA-DOCS-001`, not authorized for implementation by
  `ADMIN-002.1-DOCS-CLOSEOUT` or by this Snapshot update. Implementation
  requires a separate, future Master Execution Prompt, and only after the
  Graphify work item and a new Owner decision per §9.
- Graphify installation/configuration: **locked** to its own future work
  item; not performed by `ADMIN-002.1-DOCS-CLOSEOUT`.
- Payments/refunds, full housekeeping/maintenance modules, production
  migrations for any PMS TARGET entity, and adapter-specific OTA design:
  locked, unrelated separately authorized future work.

## 3. Current PostgreSQL schema and Hold/Reservation model

- Migration chain unchanged, exactly six migrations, ending at
  `20260723105404_AddBookingHoldReservationFoundation`. No PMS migration
  exists. Unchanged by `ADMIN-002.1` (frontend-only) and by
  `ADMIN-002.1-DOCS-CLOSEOUT` (docs-only).
- CURRENT Hold/Reservation aggregate (`BE-003.1`–`BE-003.5`) remains
  **single-RoomType-per-booking**: `BookingHold`/`BookingHoldNight` and
  `Reservation`/`ReservationNight`, each capturing exactly one Property,
  RoomType, and RatePlan, with atomic PostgreSQL advisory-lock concurrency
  protection and expiry-aware committed demand. This is proven, working
  CURRENT behavior — it is not what the PMS blueprint's multi-item/unit
  target model (`InventoryHold → InventoryHoldItems →
  InventoryHoldItemNights`, `Reservation → ReservationUnits →
  ReservationUnitNights`, ADR 0005) describes. The two models must never be
  conflated: CURRENT is what runs today; TARGET is the Owner-approved,
  not-yet-implemented multi-RoomType/physical-allocation design.
- No `Organization` entity, no `RoomOccupancySegment`/`RoomBlock` table, no
  PostgreSQL exclusion constraint, and no `btree_gist` dependency exist
  anywhere in the current schema or codebase.
- The `ADMIN-002.1` frontend prototype (§2, §5) reads and writes only
  browser-memory mock state — it never calls, and is never proven against,
  the schema described in this section.

## 4. Verification evidence — prior closed work items

Full verification evidence for `FE-002.1` (PR #28) and `AI-OPS-PILOT-001`
(PR #27) remains recorded in `docs/daily/2026-08/2026-08-12-worklog.md`.

`ADMIN-001.1` (PR #30) verification: Admin CI (independent job) green;
template imported with upstream TailAdmin attribution preserved; no
backend/API/database change in that PR's diff.

`PMS-DATA-DOCS-001` (PR #31) verification: docs-only diff, no product
source/schema/API change; Owner-invoked Codex review and Owner merge.

`ADMIN-002.1` (PR #32) verification: full C1–C8 iteration history, final CI
run `32567637108` (Admin/Frontend/Backend all `success`) at head
`e1ab378d3222dc555dc33d9408ea7ee57cdfc8db`, final Codex review "No
actionable correctness defects were identified in the reviewed diff.".
Full detail in `docs/reports/ADMIN-002.1-completion.md`.

`ADMIN-002.1` feature branch `feature/admin-002-1-reservation-board-ui-baseline`
cleanup: Owner-reported deleted both locally and remotely; independently
confirmed via `git ls-remote --heads origin` returning no matching ref
(GitHub-verified remote absence). Local deletion is Owner-reported only —
this Snapshot distinguishes the two: remote absence is directly verified
evidence, local deletion is Owner's own report and not independently
observable from this worktree.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`), không đổi backend.
- Admin Web hiện có một **interactive Reservation Board frontend
  prototype** (`ADMIN-002.1`, PR #32) trên nền TailAdmin template baseline
  (PR #30): room/date timeline, multi-property demo switching,
  assigned/unassigned reservations, operational blocks, và front-desk
  reservation-creation/operations workspace, tất cả chạy trên **local
  deterministic mock state** qua một centralized reducer
  (`reservationRuntime.ts`) — không có backend call, không có persistence,
  mỗi lần reload quay về đúng mock baseline ban đầu. Admin Web **vẫn chưa**
  tích hợp `Back_End/`: chưa có database, chưa có Admin authentication/RBAC
  thật, chưa có OTA behavior thật.
- `PROJECT_BIBLE.md`, `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`,
  ADR (0001–0006), test baseline và source code là nguồn sự thật sản phẩm/
  kiến trúc. `PROJECT_BIBLE.md` §1–§2 và `docs/ARCHITECTURE.md` nay phân
  biệt rõ CURRENT frontend prototype (PR #32, mock-only), CURRENT backend
  (BE-003 single-RoomType, đã hoạt động, không đổi) và TARGET (multi-
  RoomType PMS backend-integrated, chưa implement).
- Template hotel assets hiện có trạng thái quyền sử dụng chưa được chứng
  minh đầy đủ; chỉ dùng development/reference, không được tự động promote
  sang production (không đổi từ DATA-001.1).

## 6. Operating model đang được áp dụng

### Quyền hạn

- Owner Hồ Đình Lâm: quyết định cuối, Ready/merge, branch cleanup và mở task
  tiếp theo.
- Control Tower: objective/execution order cấp cao và escalation.
- OC: phân rã work item/checkpoint, viết Master Execution Prompt, review
  report/diff/PR và recommendation.
- Claude Code: implementer duy nhất có quyền ghi code/worktree.
- Codex: reviewer read-only; không sửa code, commit, push, PR hoặc merge.

### Agent execution

- Operating invariant: `Claude writes. Codex reviews. OC decides. Owner
  merges.` — đã chứng minh hoạt động xuyên suốt `AI-OPS-PILOT-001` (PR #27),
  `FE-002.1` (PR #28), `ADMIN-001.1` (PR #30), `PMS-DATA-DOCS-001` (PR #31),
  và `ADMIN-002.1` (PR #32).
- Một work item dùng một feature branch và một writable worktree; chỉ Claude
  có write lock.
- Sau implementation/correction và mandatory checks, Claude dừng ghi tại
  checkpoint ổn định và công bố `READY_FOR_CODEX_REVIEW` kèm đúng command;
  chỉ Owner mới invoke một lượt `/codex:review --base origin/develop`.
- Không dùng rescue, transfer, Codex write mode, automatic review gate,
  parallel agent hoặc nested implementation orchestration.
- `ADMIN-002.1-DOCS-CLOSEOUT` chạy dưới `OWNER_DIRECT_ACTIVATION: AUTHORIZED`
  — một ngoại lệ một-lần theo `docs/governance/RULES.md` cho task docs-only
  này, không phải thay đổi governance thường trực.

## 7. `ADMIN-002.1-DOCS-CLOSEOUT` execution state

- Master Execution Prompt: `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`,
  `OWNER_DIRECT_ACTIVATION: AUTHORIZED`, baseline
  `17e929d7c1f82941599223344b5f4cdc3aa34307`, feature branch
  `docs/admin-002-1-closeout`.
- Scope: docs-only, exactly seven allowed paths (this file among them, in
  Phase 2). No product source, schema, migration, API, UI, dependency, or
  file under `docs/governance/**`, `docs/ADR/**`, or `docs/design/**` is
  touched. No Graphify installation, no backend implementation.
- Next action after Claude's completion report: Owner-invoked
  `/codex:review --base origin/develop` (exactly one invocation), then OC
  review of the report/diff/Codex result, then Owner-only Ready/merge/branch
  cleanup decision. **No product implementation work starts automatically**
  from this work item's completion — see §2's active decision.
- Draft PR: [#33](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/33),
  state at this Snapshot checkpoint: `OPEN` and `DRAFT`; head branch
  `docs/admin-002-1-closeout`; base `develop`. It is not Ready or merged;
  Ready/merge/branch cleanup remain Owner-only and are not authorized by this
  Snapshot.

## 8. Tooling migration state

Không đổi từ Snapshot trước — tooling migration đã hoàn tất, không còn gate
mở cho review tooling:

- `openai/codex-plugin-cc` là cầu review; review-only đã vận hành xuyên suốt
  `AI-OPS-PILOT-001`, `FE-002.1`, `ADMIN-001.1`, `PMS-DATA-DOCS-001`, và
  `ADMIN-002.1`.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`, chấp nhận là
  gap không blocking.
- Graphify: **chưa được cài đặt hoặc đánh giá bởi bất kỳ work item nào cho
  đến nay**, kể cả `ADMIN-002.1-DOCS-CLOSEOUT` — work item này chỉ ghi nhận
  Graphify là work item kế tiếp do Owner chọn (§9), không tự cài đặt.
  Installation/dry-run/pilot cho Graphify cần một Master Execution Prompt
  riêng theo `docs/governance/WORKFLOW.md` §12 (tooling-adoption gate).
- `diagnosing-bugs` (`mattpocock/skills`): cài global, điều kiện, không phải
  bước bắt buộc mỗi task. `ADMIN-002.1-DOCS-CLOSEOUT` không invoke skill này
  (`NOT_APPLICABLE`).
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 9. Current objective

Đóng `ADMIN-002.1-DOCS-CLOSEOUT`: hoàn tất Draft PR #33, chờ Owner-invoked
Codex review, gửi report cho OC.

Trình tự kế tiếp bị khóa theo đúng thứ tự sau — không được đảo hoặc gộp
bước:

1. Review/merge/branch cleanup cho Draft PR #33 (Owner-only).
2. Một work item riêng biệt, do Owner/Control Tower phát Master Execution
   Prompt mới, cài đặt/đánh giá Graphify cho Claude dưới tooling-adoption
   gate hiện có (`docs/governance/WORKFLOW.md` §12): cài đặt ngoài product
   source, cấu hình bảo toàn Claude-write/Codex-read-only, read-only dry
   run, pilot nhỏ có thể quan sát được, so sánh với GitNexus, ghi lại
   rollback/removal step.
3. Chỉ sau khi work item Graphify đóng thành công **và** Owner có một quyết
   định mới, Control Tower/OC mới định nghĩa work item backend Calendar
   đầu tiên (`PMS-DATA-DOCS-001` → implementation).

Không tự động mở `DATA-001.2`, Graphify, hoặc bất kỳ product/backend work
item nào khác (bao gồm bất kỳ phần nào của PMS blueprint TARGET) từ
Snapshot này.

## 10. Execution order hiện tại

1. Claude hoàn tất `ADMIN-002.1-DOCS-CLOSEOUT`, dừng ghi tại checkpoint ổn
   định, công bố `READY_FOR_CODEX_REVIEW`.
2. Owner invoke `/codex:review --base origin/develop` đúng một lượt.
3. Owner chuyển kết quả Codex về Claude; Claude đưa vào completion report,
   gửi Owner.
4. Owner chuyển report cho OC; OC kết luận `PASS`/`CORRECTION_REQUIRED`/
   `BLOCKED`.
5. Owner quyết định Ready/merge/branch cleanup cho `ADMIN-002.1-DOCS-CLOSEOUT`.
6. Control Tower và Owner, trong một quyết định cấp cao riêng biệt, mở work
   item Graphify (§9 bước 2) — không tự động từ bước 5.
7. Chỉ sau khi work item Graphify đóng và Owner ra quyết định mới, work item
   backend Calendar đầu tiên mới được định nghĩa (§9 bước 3).

## 11. Main risks

- Coi việc đóng `ADMIN-002.1-DOCS-CLOSEOUT` là authorization ngầm cho work
  item Graphify hoặc bất kỳ work item backend nào.
- Nhầm frontend mock prototype (`ADMIN-002.1`, PR #32, local state only)
  với backend PMS behavior thật hoặc với TARGET architecture đã implement.
- Bỏ qua dry-run/pilot stage của tooling-adoption gate khi work item
  Graphify bắt đầu.
- Suy ra phạm vi work item backend Calendar trước khi Graphify đóng và Owner
  ra quyết định mới.
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate worktree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.
- Quyền template assets bị hiểu nhầm là đã được cấp phép production.

## 12. First action

Owner xác nhận trạng thái Draft PR #33 (`ADMIN-002.1-DOCS-CLOSEOUT`); nếu
review/decision chưa hoàn tất, đó là first action, theo đúng plan
`docs/daily/2026-08/2026-08-23-plan.md`.
