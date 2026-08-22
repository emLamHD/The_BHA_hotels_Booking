# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-22
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đồng bộ Snapshot với trạng thái thực tế sau khi PR #33
(`ADMIN-002.1-DOCS-CLOSEOUT`) đã merge, sau khi Owner hoàn thành một pilot
Graphify local sơ bộ (`TOOL-GRAPHIFY-001`), và sau khi Codex chỉ ra rằng
pilot writable do Owner trực tiếp thực hiện không đủ để đóng gate theo
single-writer invariant — dẫn tới việc Claude replay lại toàn bộ pilot với
vai trò writable implementer duy nhất (correction `C4`) trong work item
`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` để gate thật sự đóng hợp lệ, đồng thời
đồng bộ lại các nguồn sự thật khác để ghi nhận toàn bộ trình tự đó. Repository
SHA và PR state bên dưới là baseline đã được xác minh cho lần cập nhật tài
liệu này, không phải cam kết rằng SHA này sẽ còn là `develop` HEAD sau các
commit tài liệu hoặc merge tiếp theo; revalidate lại `origin/develop` trước
khi tạo feature branch mới.

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
- `TOOL-GRAPHIFY-001` (Graphify tooling-adoption pilot): `PASS — CLOSED`,
  gate-closed on the basis of a **Claude-run governance replay**
  (`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT-C4`), not on the original Owner-run
  pilot alone. Two distinct evidence layers exist and must not be
  conflated:
  - **Historical preliminary evidence (Owner-run, 2026-08-22):** Owner
    personally performed install/config/dry-run/pilot locally. Technically
    correct at the time, but insufficient by itself to close the adoption
    gate under the single-writer invariant (`docs/governance/RULES.md`
    §2.4, §3) — Owner, not Claude, performed the filesystem writes. Codex
    flagged this as a P1 governance defect on PR #34; Owner accepted the
    finding and selected **Option A** (no retrospective exception added to
    `RULES.md`; replay instead).
  - **Governance-valid gate-closing evidence (Claude-run replay, C4):**
    Claude, as sole writable implementer, isolated and backed up the prior
    Owner-created artifacts outside the repository, verified the exact CLI
    version (`graphifyy==0.9.48` / `graphify 0.9.48`, already installed —
    verified, not reinstalled), ran `graphify install --project`
    (project-scoped, outside product source), self-detected and cleaned up
    the installer's known side effects (root `CLAUDE.md` mutation,
    `.claude/settings.json` creation — both reproduced exactly as
    documented, then restored/removed by Claude in the same replay),
    recreated the code-only graph (`graphify extract . --code-only`, no
    LLM backend, no API key) and ran clustering (`graphify cluster-only`),
    ran the pilot query and independently confirmed its answer against
    source with direct file reads and `rg` (not the graph output alone),
    and confirmed graph reuse — without rebuild — from a second, separate,
    tool-restricted read-only `claude -p` session in the same workspace
    (its own attempt to run anything outside the allowlisted `graphify
    query` command was denied by the CLI's own permission system, and
    `graph.json`/`SKILL.md` hashes were identical before and after).
  - **Actual C4 replay statistics:** 624 code files indexed, 371 non-code
    files intentionally skipped (53 docs, 2 papers, 316 images — one more
    doc than the Owner pilot's 52, accounted for by
    `docs/reports/TOOL-GRAPHIFY-001-completion.md` being added between the
    two runs); graph — 3,848 nodes, 9,607 edges (identical to the Owner
    pilot's node/edge counts, confirming the underlying corpus/graph
    content is equivalent), 184 communities (vs. the Owner pilot's 186 —
    attributable to expected run-to-run non-determinism in Louvain-style
    community detection on an unchanged graph, not data loss: a
    `cluster-only` rerun on the *same* C4 graph independently produced yet
    a third count, 183→184, with node/edge counts unchanged both times).
    Graph's `built_at_commit` equals the C4 replay HEAD. No token-saving
    percentage claim accepted or verified in either run.
  - **Local state (post-C4):** the skill
    (`.claude/skills/graphify/SKILL.md` + sidecars) and `graphify-out/`
    remain **workspace-local, project-scoped, untracked** — `git ls-files`
    returns no match for either path, excluded via `.git/info/exclude`.
    Root `CLAUDE.md` exactly matches tracked `HEAD` content;
    `.claude/settings.json` is absent; no strict mode, PreToolUse hook,
    watch mode or MCP is enabled. A fresh clone, a different worktree, or
    another machine will **not** automatically have Graphify — a new
    Claude Code session in the *same* workspace, however, can and did
    reuse the existing skill/graph without rebuild.
  - `docs/governance/RULES.md` was not modified anywhere in this sequence.
  Full detail in `docs/reports/TOOL-GRAPHIFY-001-completion.md` and
  `docs/daily/2026-08/2026-08-22-worklog.md` (original pilot record, §9,
  plus the C4 replay record appended later the same day).

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

`TOOL-GRAPHIFY-001` verification — two layers:

1. **Preliminary (Owner-run) evidence, re-verified read-only by Claude
   (C1–C3 preflight):** Owner-provided local evidence (installation,
   config, dry run, pilot) — `graphify --version` returned `0.9.48`;
   `.claude/skills/graphify/SKILL.md` and
   `graphify-out/graph.json`/`GRAPH_REPORT.md` existed locally (local
   existence, not Git-tracking evidence — `git ls-files` returned no
   match, confirming they were untracked); parsed `graphify-out/graph.json`
   independently showed exactly 3,848 nodes, 9,607 edges (`links`), 186
   distinct `community` values and `built_at_commit` equal to the then-
   current baseline HEAD; root `CLAUDE.md` contained no Graphify installer
   section; `.claude/settings.json` did not exist. No rebuild or
   `/graphify .` invocation was performed to obtain this layer of
   evidence — it was read-only re-verification of Owner's own writes, and
   Codex correctly identified that read-only re-verification of an
   Owner-performed write does not satisfy the single-writer invariant.
2. **Governance-valid (Claude-run) replay evidence (`C4`):** Claude backed
   up the prior artifacts outside the repository (sanitized manifest with
   path/size/sha256 for every file, retained through Owner review), then
   itself ran `graphify install --project` (project-scoped installer,
   `graphify 0.9.48` verified not reinstalled), `graphify extract .
   --code-only` (624 code files, 371 non-code skipped, 3,848 nodes, 9,607
   edges, 183 communities), and `graphify cluster-only .` (re-clustered
   the same graph to 184 communities, node/edge counts unchanged — the
   community-count drift between runs on an identical graph is consistent
   with expected Louvain-style non-determinism, independently confirmed
   by the fact that a same-graph re-cluster also shifted the count without
   any change to nodes/edges). Claude independently re-parsed
   `graphify-out/graph.json` after each step (not trusting the CLI's own
   printed summary alone): 3,848 nodes, 9,607 links, 184 communities,
   `built_at_commit` equal to the C4 replay HEAD. Claude then self-detected
   and cleaned the installer's side effects (`git diff CLAUDE.md` showed
   the exact known "graphify section" insertion, reverted with `git
   checkout -- CLAUDE.md`; `.claude/settings.json` was created with a
   `PreToolUse` hook block, then removed) and confirmed, post-cleanup, that
   root `CLAUDE.md` hashed identically to tracked `HEAD` and
   `.claude/settings.json` was absent. The pilot query was re-run and its
   result was independently checked against source via direct `rg` on
   `reservationRuntime.ts` (`export function reservationRuntimeReducer`),
   `CreateReservationForm.tsx` (`function formReducer`, `function
   validateForm`, `useReducer(formReducer, ...)`) and `ReservationBoard.tsx`
   (`useReducer(reservationRuntimeReducer, ...)` alongside its own
   `useState` presentation/view-state calls) — the graph's answer agreed
   with source in full. A second, separate `claude -p` process (tool-
   restricted to only `Bash(graphify query *)`, with Edit/Write/git/Agent/
   other Graphify subcommands explicitly disallowed) was launched in the
   same workspace: its first attempt correctly self-blocked citing the
   `GRAPHIFY_POLICY` gate this same work item's correction C3 had just
   added to `AGENTS.md` (proof the new session read live governance text,
   not cached assumptions); its second attempt, given an explicit
   `GRAPHIFY_POLICY: ALLOWED_IF_RELEVANT` authorization matching C4's
   `OWNER_AUTHORIZED_TOOL_UNDER_TEST_ACTIONS` carve-out, ran the query
   successfully and returned the three required ownership nodes in
   substance — its own attempt to run an unauthorized `ls`/`git status`
   check outside the allowlisted command was denied by the CLI's own
   permission system (`permission_denials` in the session's JSON output),
   and `graph.json`/`SKILL.md` sha256 hashes were identical before and
   after the probe, confirming no rebuild occurred. `git status --short
   --untracked-files=all` was clean immediately before C4's first edit and
   remained clean through Phase 3.

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
- Scope (tracked files): docs-only, exactly six allowed paths (this file
  among them). No product source, schema, migration, API, UI, dependency,
  or file under `docs/governance/RULES.md`, `docs/ADR/**`,
  `docs/design/**`, `Back_End/**`, `Front_End/**`, `.github/**`, or
  `.claude/**` is tracked/committed. No backend implementation.
- Corrections C1–C3 were pure documentation clarifications and performed no
  Graphify action. **Correction C4** is different in kind: it is a
  narrowly Owner-authorized `OWNER_AUTHORIZED_TOOL_UNDER_TEST_ACTIONS`
  replay — Claude, as sole writable implementer, verified the CLI version,
  ran `graphify install --project`, recreated the code-only graph and
  clustering, ran the pilot query, and probed reuse from a second read-only
  session, all against Graphify as the *tool under test* for this specific
  governance-replay work item, per an explicit Owner/OC Master Correction
  Prompt. This is not a general license to invoke Graphify in other work
  items — outside C4, invocation still always requires an explicit
  `GRAPHIFY_POLICY` in the current prompt (`AGENTS.md` §10,
  `docs/governance/WORKFLOW.md` §12) — and C4 explicitly did not use
  Graphify to plan, analyze, or self-certify its own correctness
  (`GRAPHIFY_POLICY: NOT_APPLICABLE` for that purpose). No PreToolUse
  hook/strict mode/watch mode/MCP/API key remains enabled after C4; see
  §2's `TOOL-GRAPHIFY-001` entry for full replay evidence.
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
  dry run, pilot) — Owner thực hiện một pilot sơ bộ local ngày 2026-08-22,
  sau đó Claude replay lại toàn bộ với vai trò writable implementer duy
  nhất trong correction C4 để gate thật sự đóng hợp lệ theo single-writer
  invariant; ghi nhận đầy đủ là `TOOL-GRAPHIFY-001` ở §2/§4. Chỉ graph code-only
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
