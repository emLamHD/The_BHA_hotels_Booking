# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-22
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đồng bộ Snapshot với trạng thái thực tế sau khi PR #33
(`ADMIN-002.1-DOCS-CLOSEOUT`) đã merge, và sau khi Owner hoàn thành cài đặt/
cấu hình/dry-run/pilot Graphify local (`TOOL-GRAPHIFY-001`), rồi work item
`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (docs-only) đồng bộ lại các nguồn sự thật
khác để ghi nhận việc đó. Repository SHA và PR state bên dưới là baseline đã
được xác minh cho lần cập nhật tài liệu này, không phải cam kết rằng SHA này
sẽ còn là `develop` HEAD sau các commit tài liệu hoặc merge tiếp theo;
revalidate lại `origin/develop` trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `2c38face7cf51d7271c361e6d684adea466edcf9` |
| PR #31 | merged — `docs(pms): record core database blueprint v2`, merge commit `bfb3377b701e9309d3cbbea22bb18159bc37a2e0`, merged `2026-08-19T10:56:01Z`. Persists PMS blueprint documentation foundation (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006). |
| PR #32 | merged — `feat(admin): add PMS reservation board UI baseline`, merge commit `17e929d7c1f82941599223344b5f4cdc3aa34307`, merged `2026-08-22T14:42:31Z`. Feature branch `feature/admin-002-1-reservation-board-ui-baseline`, feature head `e1ab378d3222dc555dc33d9408ea7ee57cdfc8db`. Closes `ADMIN-002.1`. |
| PR #33 | merged — `docs(project): close ADMIN-002.1 and record next sequence`, merge commit `2c38face7cf51d7271c361e6d684adea466edcf9`, merged `2026-08-22T15:38:25Z`. Feature branch `docs/admin-002-1-closeout` deleted remotely (verified: `git ls-remote --heads origin docs/admin-002-1-closeout` returns no ref). Closes `ADMIN-002.1-DOCS-CLOSEOUT`. |
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
- `ADMIN-002.1-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #33 merged as above
  (`2c38face7cf51d7271c361e6d684adea466edcf9`, 2026-08-22T15:38:25Z). Docs-only
  synchronization of source-of-truth files after PR #32 merge; no product
  source touched. Feature branch `docs/admin-002-1-closeout` deleted
  remotely.
- `TOOL-GRAPHIFY-001` (Graphify tooling-adoption pilot): `PASS — CLOSED`.
  Completed locally 2026-08-22 by Owner, verified read-only by Claude in
  `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`. This `PASS — CLOSED` applies to the
  Owner's verified local workspace adoption, not to repository-distributed
  tooling. Evidence: `graphifyy==0.9.48` / `graphify 0.9.48` CLI;
  **workspace-local, project-scoped** skill at
  `.claude/skills/graphify/SKILL.md` (untracked — `git ls-files` returns no
  match for this path); code-only build (`--code-only`),
  625 code files indexed, 370 non-code files intentionally skipped (52
  docs, 2 papers, 316 images); resulting graph — 3,848 nodes, 9,607 edges,
  186 communities — independently re-verified against
  `graphify-out/graph.json` in this session and matches exactly; graph's
  recorded `built_at_commit` equals current baseline HEAD (not stale); no
  LLM backend or API key configured; pilot query correctly identified
  `reservationRuntime.ts` (runtime/domain-like mutations),
  `CreateReservationForm.tsx` (creation-form reducer/local state) and
  `ReservationBoard.tsx` (board presentation/view state) as the three
  ownership nodes (truncated at query budget, but the required nodes and
  synthesized result were correct); no token-saving percentage claim
  accepted or verified. Unwanted stock-installer side effects (root
  `CLAUDE.md` modification, `.claude/settings.json` creation) were detected
  and cleaned up by Owner; independently confirmed absent in this session
  (root `CLAUDE.md` carries no Graphify installer section;
  `.claude/settings.json` does not exist). Graphify artifacts/config,
  including the skill itself, are workspace-local and excluded from Git
  via `.git/info/exclude`; nothing Graphify-related is tracked, and a
  fresh clone or a different worktree/machine will not automatically have
  the skill or graph. GitNexus was not removed or modified. Full detail in
  `docs/reports/TOOL-GRAPHIFY-001-completion.md` and
  `docs/daily/2026-08/2026-08-22-worklog.md`.

### Quyết định đang hiệu lực

`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT_IS_THE_SOLE_AUTHORIZED_WORK_ITEM_UNTIL_OWNER_DECISION`

Ý nghĩa:

- `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (docs-only) là work item duy nhất đang
  active kể từ Snapshot này, cho đến khi Owner đưa ra quyết định kế tiếp.
- Việc đóng `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` không tự động mở bất kỳ
  product implementation work item nào — không database migration, không
  backend Admin Calendar/PMS, không OTA, không Customer Web change, không
  `DATA-001.2`.
- Owner đã ghi nhận (trong Master Execution Prompt của work item này) rằng
  sau khi `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` merge, backend Calendar/PMS là
  phase sản phẩm kế tiếp, và Control Tower/OC được phép định nghĩa còn Owner
  được phép phê duyệt work item backend Calendar/PMS đầu tiên dựa trên PMS
  blueprint đã merge trong PR #31.
- Quyết định đó **không** tự cấp phạm vi schema/domain/API/migration cụ thể
  cho backend — phạm vi đó vẫn phải nằm trong một Master Execution Prompt
  riêng, không được tự suy luận từ Snapshot này hay từ work item docs-only
  hiện tại.
- `DATA-001.2` tiếp tục dormant/deferred; không tự động kích hoạt lại.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET (Organization
  entity, multi-RoomType Hold/Reservation schema, `RoomOccupancySegments`,
  `RoomBlock`, PostgreSQL exclusion constraints, `FolioEntries`, Stay
  Declaration, OTA adapter/inbox/outbox, backend-integrated Admin
  Calendar/PMS): **locked** — documented as TARGET/APPROVED by
  `PMS-DATA-DOCS-001`, not authorized for implementation by
  `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` or by this Snapshot update. The
  Graphify-adoption precondition for opening this phase is now satisfied
  (`TOOL-GRAPHIFY-001`, above), but implementation still requires a
  separate, future Master Execution Prompt defining exact scope, and a new
  Owner/Control Tower decision per §9 — neither exists yet.
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

`ADMIN-002.1-DOCS-CLOSEOUT` (PR #33) verification: docs-only diff (seven
allowed files), no product source/schema/API change; merged
`2c38face7cf51d7271c361e6d684adea466edcf9` at `2026-08-22T15:38:25Z`;
independently confirmed via `gh pr view 33` (`state: MERGED`, matching
merge commit and timestamp) and `git ls-remote --heads origin
docs/admin-002-1-closeout` (no ref — remote branch deleted).

`TOOL-GRAPHIFY-001` verification: Owner-provided local evidence
(installation, config, dry run, pilot) independently re-verified read-only
by Claude in `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` preflight — `graphify
--version` returns `0.9.48`; `.claude/skills/graphify/SKILL.md` and
`graphify-out/graph.json`/`GRAPH_REPORT.md` exist locally in this workspace
(local existence, not Git-tracking evidence — `git ls-files` for these
paths returns no match, confirming they are untracked); parsed
`graphify-out/graph.json` independently shows exactly 3,848 nodes, 9,607
edges (`links`), 186 distinct `community` values and `built_at_commit`
equal to the current baseline HEAD; root `CLAUDE.md` contains no Graphify
installer section; `.claude/settings.json` does not exist; `git status
--short --untracked-files=all` is clean before any edit. No rebuild or
`/graphify .` invocation was performed to obtain this evidence.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`), không đổi backend.
- Admin Web hiện có một **interactive Reservation Board frontend
  prototype** (`ADMIN-002.1`, PR #32) trên nền TailAdmin template baseline
  (PR #30): room/date timeline, multi-property demo switching,
  assigned/unassigned reservations, operational blocks, và front-desk
  reservation-creation/operations workspace, tất cả chạy trên **local
  deterministic mock state**, chia thành ba lớp state riêng biệt: durable
  runtime mutation (lifecycle/folio/move) của reservation-board tập trung
  tại `reservationRuntimeReducer` trong `reservationRuntime.ts`; reservation
  creation workflow dùng `formReducer` riêng trong `CreateReservationForm.tsx`;
  và presentation/view state (selection, range, filter, drag) là
  component-local `useState` trong `ReservationBoard.tsx`. Không có backend
  call, không có persistence, mỗi lần reload quay về đúng mock baseline ban
  đầu. Admin Web **vẫn chưa**
  tích hợp `Back_End/`: chưa có database, chưa có Admin authentication/RBAC
  thật, chưa có OTA behavior thật.
- `PROJECT_BIBLE.md`, `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`,
  ADR (0001–0006), test baseline và source code là nguồn sự thật sản phẩm/
  kiến trúc. `PROJECT_BIBLE.md` §1–§2 và `docs/ARCHITECTURE.md` nay phân
  biệt rõ CURRENT frontend prototype (PR #32, mock-only), CURRENT backend
  (BE-003 single-RoomType, đã hoạt động, không đổi) và TARGET (multi-
  RoomType PMS backend-integrated, chưa implement). Không đổi bởi
  `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`.
- **Ba lớp trạng thái phải được phân biệt rõ, không được gộp:** (1) local
  Graphify tooling state — một knowledge-graph read-only, project-scoped,
  chạy trên máy Claude, đọc `graphify-out/` local, không commit vào Git,
  không sửa bất kỳ file source nào dưới `Back_End/**` hay `Front_End/**`;
  (2) tracked repository state — code/schema/migration thật trong Git,
  không đổi bởi Graphify adoption; (3) product/backend implementation
  state — Admin Web **vẫn** chỉ chạy trên local deterministic mock state
  (§ trên), backend Calendar/PMS **vẫn chưa implement** ở bất kỳ mức nào.
  Graphify adoption (`TOOL-GRAPHIFY-001`) là một thay đổi ở lớp (1) — công
  cụ đọc/graph hoá source hiện có để hỗ trợ Claude điều hướng codebase —
  không phải một thay đổi ở lớp (2) hay (3); nó không tạo, sửa hay xoá bất
  kỳ table, migration, endpoint hay UI nào.
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

## 7. `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` execution state

- Master Execution Prompt: `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`,
  baseline `2c38face7cf51d7271c361e6d684adea466edcf9`, feature branch
  `docs/tool-graphify-001-closeout`.
- Scope: docs-only, exactly six allowed paths (this file among them, in
  Phase 2). No product source, schema, migration, API, UI, dependency, or
  file under `docs/governance/RULES.md`, `docs/ADR/**`, `docs/design/**`,
  `Back_End/**`, `Front_End/**`, `.github/**`, or `.claude/**` is touched. No
  Graphify install/upgrade/uninstall/rebuild, no PreToolUse hook/strict
  mode/watch mode/MCP, no API key configuration, no backend implementation.
- Next action after Claude's completion report: Owner-invoked
  `/codex:review --base origin/develop` (exactly one invocation), then OC
  review of the report/diff/Codex result, then Owner-only Ready/merge/branch
  cleanup decision. **No product implementation work starts automatically**
  from this work item's completion — see §2's active decision.
- Draft PR: [#34](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/34),
  state at this Snapshot checkpoint: `OPEN` and `DRAFT`; head branch
  `docs/tool-graphify-001-closeout`; base `develop`. It is not Ready or
  merged; Ready/merge/branch cleanup remain Owner-only and are not
  authorized by this Snapshot.

## 8. Tooling migration state

Tooling migration cho review tooling đã hoàn tất từ trước; Graphify vừa
hoàn tất tooling-adoption gate riêng của nó:

- `openai/codex-plugin-cc` là cầu review; review-only đã vận hành xuyên suốt
  `AI-OPS-PILOT-001`, `FE-002.1`, `ADMIN-001.1`, `PMS-DATA-DOCS-001`,
  `ADMIN-002.1`, và `ADMIN-002.1-DOCS-CLOSEOUT`.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`, chấp nhận là
  gap không blocking. Graphify adoption không kéo theo việc gỡ GitNexus.
- Graphify: **đã hoàn tất bốn bước tooling-adoption gate** (install, config,
  dry run, pilot) trong workspace local đã được Owner verify vào
  2026-08-22, ghi nhận là `TOOL-GRAPHIFY-001` ở §2/§4. Chỉ graph code-only
  (`--code-only`) được build; không LLM backend/API key; skill
  (`.claude/skills/graphify/SKILL.md`) và toàn bộ artifact/config của
  Graphify đều không được commit vào Git — `git ls-files` xác nhận không
  match path nào. Evidence `PASS — CLOSED` chỉ áp dụng cho workspace đã
  verify này; một fresh clone, worktree khác, hay máy khác sẽ không tự
  động có Graphify — phải tự verify tồn tại trước khi coi là khả dụng, và
  không được tự ý cài đặt nếu vắng mặt trừ khi có Master Execution Prompt
  cho phép rõ ràng. Invoke Graphify luôn cần **cả hai**: khả dụng trong
  workspace **và** một `GRAPHIFY_POLICY` hợp lệ do OC khai báo tường minh
  trong Master Execution Prompt hiện hành — khả dụng cục bộ hay task "có
  vẻ" liên quan không tự cấp quyền. Ánh xạ: `REQUIRED_FOR_PREFLIGHT_IMPACT_ANALYSIS`
  bắt buộc dùng, theo đúng `GRAPHIFY_UNAVAILABLE_OR_STALE` đã khai báo nếu
  vắng mặt/stale, hoặc `BLOCKED` nếu prompt không khai báo hành vi đó;
  `ALLOWED_IF_RELEVANT` là **giá trị duy nhất** cho phép auto-invocation do
  model tự chọn, và chỉ khi Graphify thật sự khả dụng/đủ mới; `NOT_APPLICABLE`
  cấm invoke hoàn toàn; **thiếu hoặc `GRAPHIFY_POLICY` không hợp lệ được
  coi như `NOT_APPLICABLE`** (không bao giờ ngầm hiểu là `ALLOWED_IF_RELEVANT`
  hay là tùy chọn mặc định cho phép). Không giá trị policy nào tự cấp
  quyền cài đặt/rebuild. Graph luôn là advisory, luôn kiểm chứng lại với
  source/test; so sánh `built_at_commit` với `HEAD` hiện tại trước khi tin
  graph; graph stale không tự động cho phép rebuild — xem
  `docs/governance/WORKFLOW.md` §12 và `AGENTS.md` §10 cho ánh xạ đầy đủ.
  Cấm: full semantic pipeline, Graphify subagents, strict mode, PreToolUse
  hooks, watch mode, MCP, automatic rebuild — trừ khi một tooling work item
  sau này của Owner đổi chính sách.
- `diagnosing-bugs` (`mattpocock/skills`): cài global, điều kiện, không phải
  bước bắt buộc mỗi task. `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` không invoke
  skill này (`NOT_APPLICABLE`).
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 9. Current objective

Đóng `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`: hoàn tất Draft PR, chờ Owner-invoked
Codex review, gửi report cho OC.

Trình tự kế tiếp bị khóa theo đúng thứ tự sau — không được đảo hoặc gộp
bước:

1. Review/merge/branch cleanup cho Draft PR của
   `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (Owner-only).
2. Sau khi bước 1 hoàn tất, Control Tower/OC định nghĩa và Owner phê duyệt
   work item backend Calendar/PMS đầu tiên, dựa trên PMS blueprint đã merge
   trong PR #31 và bằng chứng backend hiện tại (§3). Phạm vi
   schema/domain/API/migration cụ thể của work item đó phải nằm trong một
   Master Execution Prompt riêng do Owner/OC phát hành — không được tự suy
   luận trước từ Snapshot này.
3. Claude chỉ bắt đầu implementation backend sau khi Master Execution Prompt
   đó tồn tại và Owner kích hoạt phiên tương ứng.

Không tự động mở `DATA-001.2` hoặc bất kỳ product/backend work item nào
khác (bao gồm bất kỳ phần nào của PMS blueprint TARGET) từ Snapshot này.

## 10. Execution order hiện tại

1. Claude hoàn tất `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`, dừng ghi tại
   checkpoint ổn định, công bố `READY_FOR_CODEX_REVIEW`.
2. Owner invoke `/codex:review --base origin/develop` đúng một lượt.
3. Owner chuyển kết quả Codex về Claude; Claude đưa vào completion report,
   gửi Owner.
4. Owner chuyển report cho OC; OC kết luận `PASS`/`CORRECTION_REQUIRED`/
   `BLOCKED`.
5. Owner quyết định Ready/merge/branch cleanup cho
   `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`.
6. Control Tower/OC, trong một quyết định cấp cao riêng biệt sau bước 5,
   định nghĩa work item backend Calendar/PMS đầu tiên (§9 bước 2); Owner phê
   duyệt Master Execution Prompt riêng cho nó.
7. Chỉ sau khi Master Execution Prompt đó tồn tại và Owner kích hoạt, Claude
   mới bắt đầu implementation backend (§9 bước 3).

## 11. Main risks

- Coi việc đóng `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` là authorization ngầm cho
  bất kỳ work item backend nào, hoặc coi việc Graphify pilot đã `PASS —
  CLOSED` là đủ để tự suy ra phạm vi backend.
- Nhầm frontend mock prototype (`ADMIN-002.1`, PR #32, local state only)
  với backend PMS behavior thật hoặc với TARGET architecture đã implement.
- Nhầm local Graphify tooling state (đọc/graph hoá source hiện có) với một
  thay đổi ở tracked repository state hoặc product/backend implementation
  state (§5).
- Suy ra phạm vi work item backend Calendar (schema/domain/API/migration)
  trước khi Owner phê duyệt Master Execution Prompt riêng cho nó.
- Dựa vào Graphify graph mà không kiểm chứng lại với source/test, hoặc
  rebuild graph khi không có Master Execution Prompt cho phép.
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate worktree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.
- Quyền template assets bị hiểu nhầm là đã được cấp phép production.

## 12. First action

Owner xác nhận trạng thái Draft PR của `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`;
nếu review/decision chưa hoàn tất, đó là first action, theo đúng plan
`docs/daily/2026-08/2026-08-23-plan.md`.
