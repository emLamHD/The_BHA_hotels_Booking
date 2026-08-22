# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-22
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đồng bộ Snapshot với trạng thái thực tế sau khi PR #33
(`ADMIN-002.1-DOCS-CLOSEOUT`) đã merge và sau khi Graphify được adopt qua
work item `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (Owner chạy pilot sơ bộ, Codex
chỉ ra pilot đó không đủ để đóng gate theo single-writer invariant, Claude
replay lại toàn bộ với vai trò writable implementer duy nhất — chi tiết ở
§2 và `docs/reports/TOOL-GRAPHIFY-001-completion.md`). Repository SHA và PR
state bên dưới là baseline đã được xác minh cho lần cập nhật tài liệu này,
không phải cam kết rằng SHA này sẽ còn là `develop` HEAD sau các commit tài
liệu hoặc merge tiếp theo; revalidate lại `origin/develop` trước khi tạo
feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `2c38face7cf51d7271c361e6d684adea466edcf9` |
| PR #31 | merged — `docs(pms): record core database blueprint v2`, merge commit `bfb3377b701e9309d3cbbea22bb18159bc37a2e0`, merged `2026-08-19T10:56:01Z`. Persists PMS blueprint documentation foundation (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006). |
| PR #32 | merged — `feat(admin): add PMS reservation board UI baseline`, merge commit `17e929d7c1f82941599223344b5f4cdc3aa34307`, merged `2026-08-22T14:42:31Z`. Closes `ADMIN-002.1`. |
| PR #33 | merged — `docs(project): close ADMIN-002.1 and record next sequence`, merge commit `2c38face7cf51d7271c361e6d684adea466edcf9`, merged `2026-08-22T15:38:25Z`. Closes `ADMIN-002.1-DOCS-CLOSEOUT`. |
| PR/branch của work item hiện tại | [`#34`](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/34) — `OPEN`, `DRAFT`; head branch `docs/tool-graphify-001-closeout`; base `develop`. `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (docs-only). Not Ready or merged; Ready/merge/branch cleanup remain Owner-only. |
| Open execution PR khác | không có, theo `gh pr list --state open` tại thời điểm cập nhật Snapshot này (ngoài PR #34 ở trên). |

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
  as an **optional, workspace-local** code-navigation tool. Owner performed
  an initial preliminary pilot locally; Codex identified that a
  writable-pilot Owner personally executed cannot by itself close a
  tooling-adoption gate under the single-writer invariant
  (`docs/governance/RULES.md` §2.4/§3); Owner selected **Option A** (no
  retrospective exception to `RULES.md`); Claude then performed the actual
  gate-closing replay as sole writable implementer
  (`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT-C4`): verified the exact CLI version,
  ran the project-scoped install, self-detected and cleaned the
  installer's known side effects (root `CLAUDE.md`, `.claude/settings.json`),
  rebuilt the code-only graph, ran the pilot query and checked its answer
  directly against source, and confirmed a separate read-only Claude Code
  session could reuse the existing graph without rebuilding it. Full
  evidence in `docs/reports/TOOL-GRAPHIFY-001-completion.md`;
  `docs/governance/WORKFLOW.md` §12 is the canonical invocation policy.
  `docs/governance/RULES.md` was not modified.

### Quyết định đang hiệu lực

`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT_IS_THE_SOLE_AUTHORIZED_WORK_ITEM_UNTIL_OWNER_DECISION`

Ý nghĩa:

- `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (docs-only) là work item duy nhất đang
  active kể từ Snapshot này, cho đến khi Owner đưa ra quyết định kế tiếp.
- Việc đóng work item này không tự động mở bất kỳ product implementation
  work item nào — không database migration, không backend Admin
  Calendar/PMS, không OTA, không Customer Web change, không `DATA-001.2`.
- Sau khi PR #34 merge, backend Calendar/PMS là phase sản phẩm kế tiếp
  (`NEXT_PRODUCT_PHASE: BACKEND CALENDAR/PMS`, xem §9). Control Tower đã sở
  hữu plan backend dựa trên PMS blueprint (PR #31); Snapshot này chỉ ghi
  nhận handoff, không tự định nghĩa hay mở rộng phạm vi backend.
- `DATA-001.2` tiếp tục dormant/deferred; không tự động kích hoạt lại.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET
  (Organization, multi-RoomType Hold/Reservation, `RoomOccupancySegments`,
  `RoomBlock`, PostgreSQL exclusion constraints, `FolioEntries`, OTA
  adapter/inbox/outbox, backend-integrated Admin Calendar/PMS): **locked**
  — documented as TARGET/APPROVED by `PMS-DATA-DOCS-001`, not authorized
  for implementation by this work item. Implementation requires a
  separate, future Master Execution Prompt defining exact scope, after a
  new Owner/Control Tower decision (§9).
- Payments/refunds, full housekeeping/maintenance modules, production
  migrations for any PMS TARGET entity, and adapter-specific OTA design:
  locked, unrelated separately authorized future work.

## 3. Current PostgreSQL schema and Hold/Reservation model

- Migration chain unchanged, exactly six migrations, ending at
  `20260723105404_AddBookingHoldReservationFoundation`. No PMS migration
  exists.
- CURRENT Hold/Reservation aggregate (`BE-003.1`–`BE-003.5`) remains
  **single-RoomType-per-booking**: `BookingHold`/`BookingHoldNight` and
  `Reservation`/`ReservationNight`, each capturing exactly one Property,
  RoomType, and RatePlan, with atomic PostgreSQL advisory-lock concurrency
  protection and expiry-aware committed demand. This is proven, working
  CURRENT behavior — it is not the PMS blueprint's multi-item/unit TARGET
  model (`InventoryHold → InventoryHoldItems → InventoryHoldItemNights`,
  `Reservation → ReservationUnits → ReservationUnitNights`, ADR 0005). The
  two models must never be conflated.
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

`TOOL-GRAPHIFY-001`: functional gate evidence (not corpus-count
comparisons) — exact CLI version confirmed; Claude ran the project-scoped
install and cleaned its known side effects; code-only graph build
completed; pilot query correctly identified the three required ownership
areas in `Front_End/Admin_Web` (reservation runtime mutations,
creation-form state, board view state), independently checked against
source, not accepted on the graph's answer alone; a second, separate
read-only Claude Code session reused the existing graph without rebuilding
it; no Graphify artifact/config is tracked in Git. Full command-level
detail in `docs/reports/TOOL-GRAPHIFY-001-completion.md` and
`docs/daily/2026-08/2026-08-22-worklog.md`.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`), không đổi backend.
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
  CURRENT backend (BE-003 single-RoomType, đã hoạt động, không đổi) và
  TARGET (multi-RoomType PMS backend-integrated, chưa implement).
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
  quyền ghi code/worktree. Codex: reviewer read-only.
- Operating invariant: `Claude writes. Codex reviews. OC decides. Owner
  merges.` — đã chứng minh hoạt động xuyên suốt `AI-OPS-PILOT-001`,
  `FE-002.1`, `ADMIN-001.1`, `PMS-DATA-DOCS-001`, `ADMIN-002.1`, và
  `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`.
- Một work item dùng một feature branch và một writable worktree; chỉ
  Claude có write lock. Sau implementation/correction và mandatory checks,
  Claude dừng ghi tại checkpoint ổn định và công bố `READY_FOR_CODEX_REVIEW`;
  chỉ Owner mới invoke `/codex:review --base origin/develop`. Không dùng
  rescue, transfer, Codex write mode, automatic review gate, parallel
  agent hoặc nested implementation orchestration.

## 7. `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` execution state

- Master Execution Prompt: `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`,
  baseline `2c38face7cf51d7271c361e6d684adea466edcf9`, feature branch
  `docs/tool-graphify-001-closeout`.
- Scope: docs-only, exactly six allowed paths (this file among them). No
  product source, schema, migration, API, UI, dependency, or file under
  `docs/governance/RULES.md`, `docs/ADR/**`, `docs/design/**`,
  `Back_End/**`, `Front_End/**`, `.github/**`, or `.claude/**` is
  tracked/committed. No backend implementation.
- Correction `C4` was a narrowly Owner-authorized replay of Graphify as the
  *tool under test* for this work item only — not a general license to
  invoke Graphify elsewhere. Outside this work item, invocation always
  requires an explicit `GRAPHIFY_POLICY` per `docs/governance/WORKFLOW.md`
  §12.
- Next action after Claude's completion report: Owner-invoked
  `/codex:review --base origin/develop`, then OC review, then Owner-only
  Ready/merge/branch cleanup decision. **No product implementation work
  starts automatically** from this work item's completion.
- Draft PR: [#34](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/34),
  `OPEN`/`DRAFT`; not Ready or merged.

## 8. Tooling migration state

- `openai/codex-plugin-cc`: review-only bridge, operating throughout all
  closed work items above.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`. Graphify
  adoption does not imply GitNexus removal.
- Graphify: adopted as an optional, workspace-local code-navigation tool
  (§2). `docs/governance/WORKFLOW.md` §12 is the canonical policy —
  `GRAPHIFY_POLICY` values, freshness, and install/rebuild boundaries live
  there, not duplicated here.
- `diagnosing-bugs` (`mattpocock/skills`): conditional global skill, not
  invoked by this work item (`NOT_APPLICABLE`).
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 9. Current objective

Đóng `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`: hoàn tất Draft PR, chờ Owner-invoked
Codex review, gửi report cho OC.

Trình tự kế tiếp bị khóa theo đúng thứ tự sau — không được đảo hoặc gộp
bước:

1. Review/merge/branch cleanup cho Draft PR #34 (Owner-only).
2. Sau khi bước 1 hoàn tất, Owner kích hoạt Control Tower's existing backend
   plan (dựa trên PMS blueprint PR #31); OC chuyển plan đó thành Master
   Execution Prompt backend đầu tiên — không được tự suy luận phạm vi
   trước từ Snapshot này.
3. Claude chỉ bắt đầu implementation backend sau khi Master Execution
   Prompt đó tồn tại và Owner kích hoạt phiên tương ứng.

Không tự động mở `DATA-001.2` hoặc bất kỳ product/backend work item nào
khác từ Snapshot này.

## 10. Main risks

- Coi việc đóng `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` là authorization ngầm cho
  bất kỳ work item backend nào.
- Nhầm frontend mock prototype (`ADMIN-002.1`) với backend PMS behavior
  thật hoặc với TARGET architecture đã implement.
- Nhầm local Graphify tooling state với tracked repository state hoặc
  product/backend implementation state (§5).
- Suy ra phạm vi backend Calendar work item trước khi Owner phê duyệt
  Master Execution Prompt riêng cho nó.
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate worktree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.

## 11. First action

Owner xác nhận trạng thái Draft PR #34; nếu review/decision chưa hoàn tất,
đó là first action, theo đúng plan `docs/daily/2026-08/2026-08-23-plan.md`.
