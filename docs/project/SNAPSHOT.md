# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-19
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đồng bộ Snapshot với trạng thái thực tế sau khi PR #30
(`ADMIN-001.1` — Admin Web template baseline) đã merge, và ghi nhận việc
Owner/Control Tower đã hoàn tất workshop PMS blueprint và duyệt kiến trúc
target. Repository SHA và PR state bên dưới là baseline đã được xác minh cho
lần cập nhật tài liệu này (`f97c3529fb94c08fafad0da059ec1cf2b839b0d0`), không
phải cam kết rằng SHA này sẽ còn là `develop` HEAD sau các commit tài liệu
hoặc merge tiếp theo; revalidate lại `origin/develop` trước khi tạo feature
branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `f97c3529fb94c08fafad0da059ec1cf2b839b0d0` |
| PR gần nhất | `#30` — merged (`chore(admin): import TailAdmin template baseline`, `ADMIN-001.1`) |
| Merge commit | `f97c3529fb94c08fafad0da059ec1cf2b839b0d0` |
| Merged tại | `2026-08-18T10:12:53Z` |
| Feature commit HEAD của PR #30 | `9cee2857f97f6de002a6939d6e101445ff22b496` |
| Feature branch của PR #30 | `feature/admin-001-1-template-baseline` — remote đã xóa (OC-revalidated 2026-08-19) |
| Open execution PR tại preflight `PMS-DATA-DOCS-001` (2026-08-19) | không có, theo `gh pr list --state open` |
| PR/branch của work item hiện tại | `docs/pms-data-001-core-database-blueprint-v2` — xem §7 để biết trạng thái Draft PR chính xác tại thời điểm publish |

## 2. Work item state

### Hoàn tất

- `FE-001`: closed trước baseline hiện tại.
- `DATA-001.1`: đạt technical gate, PR #22 đã merge. Checkpoint 1–3 (source-of-
  truth và execution contract cho sellable catalog/media) đã hoàn tất, kết
  luận kỹ thuật `DEFER_DATA-001.2_AND_START_FE-002.1`; `DATA-001.2` vẫn
  dormant/deferred (xem §5).
- `AI-OPS-GOV-002`: `PASS`.
- `AI-OPS-PILOT-001`: `PASS` — PR #27, merge `bb64f7e1592f4924049935ecc08922539c532bf8`.
- `FE-002.1` — Hold Confirmation UI: `PASS — CLOSED`. PR #28, merge commit
  `3f68bd79eff7f6c553e5516431abd09a93298f71`, merged 2026-08-12T13:39:21Z.
  Full evidence retained in worklog `docs/daily/2026-08/2026-08-12-worklog.md`
  and prior Snapshot revisions; not re-copied here to keep this Snapshot
  current-state-focused.
- `ADMIN-001.1` — Admin Web Template Baseline: `PASS — CLOSED`. PR #30 merged
  as above. Imports TailAdmin 2.3.0 as `Front_End/Admin_Web` on Next.js
  16.1.6, React/React DOM 19.2.1, TypeScript 5.9.3, Node 22.23.1, npm
  lockfile v3, with an independent Admin CI job. Admin Web is
  **template-only**: no backend integration, no Admin authentication, no
  PMS, Reservation Board, Calendar business behavior, and no OTA behavior
  exists yet.
- Owner/Control Tower PMS blueprint workshop (2026-08-19): complete. The
  target PMS/database architecture (Organization/Property/tenant scoping,
  multi-RoomType Hold/Reservation item/unit decomposition, physical
  allocation via `RoomOccupancySegments`, both PostgreSQL exclusion
  invariants, cross-RoomType assignment rules, financial/guest/OTA
  boundaries) is Owner-approved as TARGET architecture. `PMS-DATA-DOCS-001`
  (this work item) persists that approved architecture into
  `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`,
  `docs/ADR/0005-separate-commercial-commitment-from-physical-allocation.md`,
  and `docs/ADR/0006-schedule-physical-rooms-with-occupancy-segments.md`. No
  table, column, constraint, migration, entity, endpoint, or UI described
  there is implemented by documenting it.

### Quyết định đang hiệu lực

`PMS-DATA-DOCS-001_IS_THE_SOLE_AUTHORIZED_WORK_ITEM_UNTIL_OWNER_DECISION`

Ý nghĩa:

- `PMS-DATA-DOCS-001` là work item sản phẩm/tài liệu duy nhất đang active kể
  từ Snapshot này, cho đến khi Owner đưa ra quyết định kế tiếp.
- Việc đóng `PMS-DATA-DOCS-001` (một khi Owner-invoked Codex review, OC
  review và Owner Ready/merge hoàn tất) không tự động mở bất kỳ product
  implementation work item nào — không database migration, không Admin
  Calendar/PMS, không OTA, không Customer Web change, không `DATA-001.2`.
  Control Tower và Owner sẽ chọn work item kế tiếp trong một quyết định
  riêng, ngoài phạm vi tài liệu sync này.
- `DATA-001.2` tiếp tục dormant/deferred; không tự động kích hoạt lại.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET (Organization
  entity, multi-RoomType Hold/Reservation schema, `RoomOccupancySegments`,
  `RoomBlock`, PostgreSQL exclusion constraints, `FolioEntries`, Stay
  Declaration, OTA adapter/inbox/outbox, Admin Calendar/PMS UI): **locked**
  — documented as TARGET/APPROVED by `PMS-DATA-DOCS-001`, not authorized for
  implementation by this work item or by this Snapshot update.
  Implementation requires a separate, future Master Execution Prompt.
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
  CURRENT behavior — it is not what the PMS blueprint's multi-item/unit
  target model (`InventoryHold → InventoryHoldItems →
  InventoryHoldItemNights`, `Reservation → ReservationUnits →
  ReservationUnitNights`, ADR 0005) describes. The two models must never be
  conflated: CURRENT is what runs today; TARGET is the Owner-approved,
  not-yet-implemented multi-RoomType/physical-allocation design.
- No `Organization` entity, no `RoomOccupancySegment`/`RoomBlock` table, no
  PostgreSQL exclusion constraint, and no `btree_gist` dependency exist
  anywhere in the current schema or codebase.

## 4. Verification evidence — prior closed work items

Full verification evidence for `FE-002.1` (PR #28) and `AI-OPS-PILOT-001`
(PR #27) remains recorded in `docs/daily/2026-08/2026-08-12-worklog.md` and
is not re-copied into this Snapshot revision, per the operating principle
that historical evidence is retrieved on demand, not preloaded by default.

`ADMIN-001.1` (PR #30) verification: Admin CI (independent job) green;
template imported with upstream TailAdmin attribution preserved per
`docs/README.md` conventions; no backend/API/database change in that PR's
diff.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`), không đổi backend.
- Admin Web hiện có template baseline (PR #30) — chưa có backend
  integration, chưa có Admin authentication, chưa có PMS/Reservation
  Board/Calendar business behavior.
- `PROJECT_BIBLE.md`, `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`,
  ADR (0001–0006), test baseline và source code là nguồn sự thật sản phẩm/
  kiến trúc. `PROJECT_BIBLE.md` §1–§2 và §8 nay phân biệt rõ CURRENT
  (BE-003 single-RoomType, đã hoạt động) với TARGET (multi-RoomType PMS,
  chưa implement).
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
  `FE-002.1` (PR #28), và `ADMIN-001.1` (PR #30).
- Một work item dùng một feature branch và một writable worktree; chỉ Claude
  có write lock.
- Sau implementation/correction và mandatory checks, Claude dừng ghi tại
  checkpoint ổn định và công bố `READY_FOR_CODEX_REVIEW` kèm đúng command;
  chỉ Owner mới invoke một lượt `/codex:review --base origin/develop`.
- Không dùng rescue, transfer, Codex write mode, automatic review gate,
  parallel agent hoặc nested implementation orchestration.

## 7. `PMS-DATA-DOCS-001` execution state

- Master Execution Prompt: `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`,
  baseline `f97c3529fb94c08fafad0da059ec1cf2b839b0d0`, feature branch
  `docs/pms-data-001-core-database-blueprint-v2`.
- Scope: docs-only, exactly nine allowed paths (this file among them). No
  product source, schema, migration, API, UI, dependency, or file under
  `docs/governance/**` is touched. Root `AGENTS.md` is the sole Owner-approved
  project-identity exception added by C9.
- Next action after Claude's completion report: Owner-invoked
  `/codex:review --base origin/develop` (exactly one invocation), then OC
  review of the report/diff/Codex result, then Owner-only Ready/merge/branch
  cleanup decision. **No product implementation work starts automatically**
  from this work item's completion — see §2's locked decision.
- Draft PR: created during this work item's Phase 4; see the work item's
  completion report for the exact URL, or `DRAFT_PR_PENDING_CREATION` if not
  yet available at the time this Snapshot section was last edited.

## 8. Tooling migration state

Không đổi từ Snapshot trước — tooling migration đã hoàn tất, không còn gate
mở:

- `openai/codex-plugin-cc` là cầu review; review-only đã vận hành xuyên suốt
  `AI-OPS-PILOT-001`, `FE-002.1`, và `ADMIN-001.1`.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`, chấp nhận là
  gap không blocking.
- `diagnosing-bugs` (`mattpocock/skills`): cài global, điều kiện, không phải
  bước bắt buộc mỗi task. `PMS-DATA-DOCS-001` không invoke skill này —
  documentation/design synchronization không có defect/regression cụ thể để
  chẩn đoán (`NOT_APPLICABLE`, theo skill policy trong Master Execution
  Prompt).
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 9. Current objective

Đóng `PMS-DATA-DOCS-001`: publish Draft PR, chờ Owner-invoked Codex review,
gửi report cho OC. Không có product implementation objective nào khác đang
active.

Không tự động mở `DATA-001.2` hoặc bất kỳ product work item nào khác (bao
gồm bất kỳ phần nào của PMS blueprint TARGET) từ Snapshot này.

## 10. Execution order hiện tại

1. Claude hoàn tất `PMS-DATA-DOCS-001`, dừng ghi tại checkpoint ổn định, công
   bố `READY_FOR_CODEX_REVIEW`.
2. Owner invoke `/codex:review --base origin/develop` đúng một lượt.
3. Owner chuyển kết quả Codex về Claude; Claude đưa vào completion report,
   gửi Owner.
4. Owner chuyển report cho OC; OC kết luận `PASS`/`CORRECTION_REQUIRED`/
   `BLOCKED`.
5. Owner quyết định Ready/merge/branch cleanup.
6. Control Tower và Owner, trong một quyết định riêng biệt, chọn (hoặc tiếp
   tục hoãn) work item sản phẩm kế tiếp — không tự động từ bước 5.

## 11. Main risks

- Coi việc đóng `PMS-DATA-DOCS-001` là authorization ngầm cho một product
  implementation work item.
- Nhầm lẫn CURRENT (BE-003 single-RoomType, đã hoạt động) với TARGET
  (multi-RoomType PMS, chưa implement) khi đọc `PROJECT_BIBLE.md` hoặc
  blueprint.
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate worktree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.
- Quyền template assets bị hiểu nhầm là đã được cấp phép production.

## 12. First action

Control Tower/OC đọc Snapshot đã đồng bộ này cùng plan ngày hiện tại
(`docs/daily/2026-08/2026-08-20-plan.md`), xác nhận `PMS-DATA-DOCS-001` đang
ở giai đoạn review/decision, sau đó tự chọn hoặc hoãn work item kế tiếp
trong một lệnh cấp cao riêng biệt.
