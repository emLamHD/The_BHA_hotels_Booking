# THE BHA — WORKFLOW

> Trạng thái: quy trình vận hành chuẩn
>
> Cập nhật: 2026-09-01
>
> Phụ thuộc: `RULES.md` luôn có hiệu lực

## 1. Mục tiêu

Workflow này giữ The BHA ở trạng thái có thể phục hồi, review được và tiết kiệm context khi phối hợp Owner, Control Tower, OC, Claude Code và Codex theo mô hình: một implementer được Master Execution Prompt chọn code (`ACTIVE_EXECUTOR`), agent ghép cặp review read-only, OC quyết định và Owner merge. `docs/governance/RULES.md` §2.4 định nghĩa hai role pair hợp lệ.

## 2. Khởi động một Control Tower mới

Control Tower đọc đúng thứ tự mặc định:

1. `docs/governance/RULES.md`
2. `docs/project/PROJECT_BIBLE.md`
3. `docs/project/SNAPSHOT.md`
4. `docs/daily/YYYY-MM/YYYY-MM-DD-plan.md` của ngày hiện tại

Sau đó chỉ xuất xác nhận ngắn:

```text
Current state:
Today's objective:
Execution order:
Main risks:
First action:
```

Không kể lại toàn bộ nội dung các file. `WORKFLOW.md`, ADR, report và worklog được truy xuất khi cần, không thuộc packet mặc định.

### Khi nào mới đọc worklog trước đó

Mặc định không nạp worklog hôm qua nếu `SNAPSHOT.md` và plan hôm nay đã đủ để bàn giao.

Chỉ đọc worklog khi:

- có tranh cãi về một quyết định trước đó;
- cần điều tra lỗi hoặc quá trình review;
- plan phụ thuộc chi tiết chưa có trong Snapshot;
- có task dang dở cần phục hồi context.

Nguyên tắc: tài liệu lịch sử được lưu để truy xuất, không phải để nạp mặc định.

## 3. Chu kỳ vận hành cấp cao

1. Owner và Control Tower chốt objective/ràng buộc cấp cao.
2. Control Tower phát lệnh cho OC.
3. OC phân rã work item, phase, checkpoint, skill policy và viết Master Execution Prompt.
4. Owner mở phiên cho agent được Master Execution Prompt chọn làm `IMPLEMENTER`; agent đó là `ACTIVE_EXECUTOR` duy nhất có quyền ghi cho work item này.
5. `ACTIVE_EXECUTOR` thực hiện, test, tạo checkpoint ổn định, dừng ghi rồi công bố `READY_FOR_<REVIEWER>_REVIEW` kèm đúng review command/contract.
6. Owner invoke reviewer đã chọn read-only đúng một lượt theo review contract, sau khi xác nhận `REVIEW_BASE` vẫn resolve đúng `REVIEW_BASE_SHA` đã công bố (Codex: `/codex:review --base origin/develop` hoặc base do prompt chỉ định; Claude: phiên read-only riêng với `REVIEW_BASE_SHA`/`FINAL_HEAD` tường minh); `ACTIVE_EXECUTOR` không tự chạy/mở việc này. Nếu base đã di chuyển, dừng ở `BLOCKED` thay vì review theo base mới.
7. Owner chuyển trực tiếp cho OC completion report sẵn có của `ACTIVE_EXECUTOR` cùng kết quả review verbatim — hai tài liệu riêng biệt; `ACTIVE_EXECUTOR` vẫn dừng ghi, không được gọi lại chỉ để chèn kết quả vào report (`RULES.md` §3.6).
8. OC review report/diff/PR/reviewer findings và phát correction prompt cho đúng `ACTIVE_EXECUTOR` ban đầu của work item nếu cần (không đổi implementer — `RULES.md` §3.1).
9. Sau mỗi correction, `ACTIVE_EXECUTOR` chạy lại checks, dừng ghi và công bố lại `READY_FOR_<REVIEWER>_REVIEW`; Owner invoke lại reviewer cho phần thay đổi.
10. OC kết luận pass/fail và đưa recommendation.
11. Owner quyết định Ready, merge, xóa branch và có tiếp tục task kế tiếp hay không.
12. Control Tower chỉ được gọi lại khi có escalation hoặc cần phát lệnh cấp cao tiếp theo.

## 4. Lập Master Execution Prompt

OC tạo đúng một prompt authoritative cho một work item. Prompt phải chọn tường minh đúng một role pair hợp lệ trong hai pair ở `RULES.md` §2.4 (`IMPLEMENTER: CLAUDE` / `REVIEWER: CODEX_READ_ONLY`, hoặc `IMPLEMENTER: CODEX` / `REVIEWER: CLAUDE_READ_ONLY`); không có execution mode nào cho phép cả hai agent cùng ghi, và role pair đã chọn giữ nguyên suốt vòng đời work item, kể cả qua correction (`RULES.md` §3.1).

Prompt nên có cấu trúc:

```text
WORK_ITEM:
OBJECTIVE:
IMPLEMENTER: CLAUDE | CODEX            # chọn đúng một giá trị cụ thể — không để nguyên "|"
REVIEWER: CODEX_READ_ONLY | CLAUDE_READ_ONLY   # phải ghép đúng cặp với IMPLEMENTER — RULES.md §2.4
REPOSITORY:
BASE_BRANCH:
BASELINE_SHA:
FEATURE_BRANCH:

INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY
INDEPENDENT_REVIEW_METHOD:
REVIEW_BASE:
REVIEW_BASE_SHA:
REVIEW_TARGET: REVIEW_BASE_SHA...FINAL_HEAD_AT_HANDOFF
CODEX_REVIEW_COMMAND: /codex:review --base origin/develop   # bắt buộc chỉ khi REVIEWER: CODEX_READ_ONLY
CODEX_REVIEW_LIMIT: 1 invocation per implementation/correction completion   # chỉ khi REVIEWER: CODEX_READ_ONLY

PHASES:
  - PHASE_ID:
    SCOPE:
    ACCEPTANCE:
    CHECKS:
    CHECKPOINT:

SKILL_POLICY:
  diagnosing-bugs: REQUIRED | ALLOWED_IF_TRIGGERED | NOT_APPLICABLE
  TRIGGER_OR_REASON:
  GRAPHIFY_POLICY: REQUIRED_FOR_PREFLIGHT_IMPACT_ANALYSIS | ALLOWED_IF_RELEVANT | NOT_APPLICABLE
  GRAPHIFY_TRIGGER_OR_REASON:
  GRAPHIFY_UNAVAILABLE_OR_STALE: BLOCK | FALL_BACK_TO_SOURCE_TESTS

READ_NOW:
ALLOWED_FILES:
FORBIDDEN_FILES:
GLOBAL_ACCEPTANCE:
STOP_CONDITIONS:
REPORT_FORMAT:
PR_REQUIREMENT:

<Reminder ngắn cho ACTIVE_EXECUTOR rằng reviewer đã chọn sẽ xem lại kết quả — ví dụ "Codex sẽ xem lại kết quả đầu ra của bạn sau khi bạn hoàn thành." khi REVIEWER: CODEX_READ_ONLY.>
```

`IMPLEMENTER: CLAUDE | CODEX` và `REVIEWER: CODEX_READ_ONLY | CLAUDE_READ_ONLY` ở trên là ký hiệu lựa chọn trong template, không phải giá trị active hợp lệ — một Master Execution Prompt đã kích hoạt phải chọn đúng một giá trị cụ thể cho mỗi trường.

OC phải ghi review base rõ ràng (`REVIEW_BASE`/`REVIEW_BASE_SHA`); mặc định luôn là `origin/develop`, không để plugin tự suy ra GitHub default branch. Ngay trước khi review chạy, `REVIEW_BASE` symbolic phải resolve lại đúng `REVIEW_BASE_SHA` đã công bố; nếu base đã di chuyển, review dừng ở `BLOCKED` (`RULES.md` §3.4) thay vì tự động review theo base mới. Câu reminder cuối cùng là nhắc nhở ngắn cho `ACTIVE_EXECUTOR`, không thay thế các trường `IMPLEMENTER`, `REVIEWER`, review contract (`INDEPENDENT_REVIEW_INVOKER`, `CODEX_REVIEW_COMMAND`/limit khi áp dụng) và stop conditions.

Dự án dùng đúng một checkout repository đang tồn tại (`docs/governance/RULES.md`
§5) — `git worktree add` và mọi checkout thực thi bổ sung đều bị cấm, không
có ngoại lệ hay field ủy quyền cho việc này.

Master Execution Prompt là bắt buộc cho work item implementation của `ACTIVE_EXECUTOR`, nhưng không được lặp lại như executor-activation context bên trong native reviewer invocation: review command/contract tường minh, diff/target mục tiêu và review-mode rule đã đủ thẩm quyền cho reviewer read-only. `INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY` nghĩa là chỉ Owner được gọi/mở review; `ACTIVE_EXECUTOR` chỉ dừng ghi và công bố `READY_FOR_<REVIEWER>_REVIEW`.

## 5. Preflight của `ACTIVE_EXECUTOR`

Trước khi sửa file, `ACTIVE_EXECUTOR` phải:

1. đọc root `AGENTS.md`; `ACTIVE_EXECUTOR` cũng đọc adapter provider của mình nếu có (ví dụ `CLAUDE.md` khi `ACTIVE_EXECUTOR` là Claude);
2. đọc Master Execution Prompt và các file trong `READ_NOW`;
3. xác nhận `IMPLEMENTER`, `REVIEWER` (đúng cặp hợp lệ theo `RULES.md` §2.4), hợp đồng independent-review đầy đủ (`INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY`, `REVIEW_BASE`/`REVIEW_BASE_SHA`/`REVIEW_TARGET`, và review command/contract theo provider) và skill policy — thiếu hoặc sai bất kỳ trường nào ở đây khiến preflight trả `BLOCKED` ngay, không đợi đến sau implementation;
4. kiểm tra repo root, branch, HEAD và working-tree status;
5. xác nhận không có agent/process khác đang giữ write lock;
6. kiểm tra tool bắt buộc trong prompt có sẵn với agent đang giữ `ACTIVE_EXECUTOR`;
7. xuất preflight ngắn và bắt đầu first action.

Không recap toàn bộ project. Nếu baseline, ownership hoặc role pair không khớp, trả `BLOCKED`.

## 6. Thực thi implementation bằng `ACTIVE_EXECUTOR`

1. `ACTIVE_EXECUTOR` giữ write lock suốt implementation/correction.
2. `ACTIVE_EXECUTOR` chỉ sửa scope được cho phép.
3. `ACTIVE_EXECUTOR` áp dụng `SKILL_POLICY` trước khi chọn quy trình thực thi.
4. `ACTIVE_EXECUTOR` chạy targeted checks và broader checks theo prompt/risk.
5. `ACTIVE_EXECUTOR` cập nhật tài liệu trong scope nếu acceptance yêu cầu.
6. `ACTIVE_EXECUTOR` tạo commit/push/Draft PR nếu prompt trao quyền.
7. `ACTIVE_EXECUTOR` chuẩn bị provisional completion report và checkpoint ổn định.
8. `ACTIVE_EXECUTOR` dừng mọi thao tác ghi tại checkpoint ổn định và công bố `READY_FOR_<REVIEWER>_REVIEW` kèm đúng command/contract cho Owner; `ACTIVE_EXECUTOR` không tự mở review gate.

OC không review trực tiếp trong lúc `ACTIVE_EXECUTOR` đang sửa, trừ khi Owner yêu cầu một checkpoint tư vấn không ghi file.

## 7. Independent review gate

Hợp đồng đầy đủ (role-pair lock, self-review vs. independent review, review target ổn định, hai nhánh provider) là `docs/governance/RULES.md` §3.1–§3.6; mục này chỉ mô tả vận hành cụ thể trong một phiên.

### Review invocation

1. `ACTIVE_EXECUTOR` xác nhận branch, baseline, HEAD và worktree status ở checkpoint ổn định, dừng ghi, rồi công bố `READY_FOR_<REVIEWER>_REVIEW` kèm `REVIEW_BASE`, `REVIEW_BASE_SHA` đã resolve, `FINAL_HEAD`, và đúng command/contract (Codex: `/codex:review --base origin/develop`, trừ khi prompt ghi base khác; Claude: phiên read-only riêng).
2. Ngay trước khi gọi reviewer, Owner xác nhận `REVIEW_BASE` vẫn resolve đúng `REVIEW_BASE_SHA` đã công bố; nếu base đã di chuyển, dừng ở `BLOCKED` thay vì review theo base mới (`RULES.md` §3.4).
3. Chỉ Owner được gọi/mở reviewer đó (`INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY`). `ACTIVE_EXECUTOR` không tự chạy `/codex:review` hay tự mở phiên Claude reviewer.
4. Reviewer chạy review read-only trên đúng diff/target được yêu cầu và chỉ trả findings có evidence, severity và vị trí phù hợp; native review không cần lặp lại executor-activation field nào của Master Execution Prompt. Khi reviewer là Claude, nếu không thiết lập được chế độ read-only đáng tin cậy cho phiên đó, review là `NOT RUN`.
5. `ACTIVE_EXECUTOR` không yêu cầu reviewer sửa code và không bật write mode cho reviewer.
6. `ACTIVE_EXECUTOR` không tự chạy `/codex:rescue`, `/codex:transfer` hoặc automatic review gate.
7. Mặc định chỉ một invocation do Owner khởi tạo cho mỗi lần implementation/correction hoàn tất; không tự lặp đến khi hết findings.

### Sau review

- Owner chuyển trực tiếp cho OC completion report sẵn có của `ACTIVE_EXECUTOR` cùng kết quả review verbatim — hai tài liệu riêng biệt; `ACTIVE_EXECUTOR` vẫn dừng ghi và không được gọi lại chỉ để chèn kết quả vào report (`RULES.md` §3.6).
- Nếu reviewer có findings, `ACTIVE_EXECUTOR` không tự mở rộng scope hoặc âm thầm sửa sau review; `ACTIVE_EXECUTOR` dừng để OC phân loại và phát correction prompt cho đúng `ACTIVE_EXECUTOR` ban đầu.
- Nếu reviewer không có finding, kết quả forward cho OC ghi rõ `REVIEW: PASS_WITH_NO_FINDINGS`; đây vẫn chưa phải verdict merge.
- Nếu review fail, treo hoặc không khả dụng (kể cả không thiết lập được read-only đáng tin cậy cho phiên Claude reviewer, hoặc base đã di chuyển), Owner ghi nhận `REVIEW: NOT RUN` kèm evidence và chuyển trực tiếp cho OC; work item `BLOCKED` cho đến khi có correction prompt mới.
- Reviewer không nhận write lock và không bao giờ cần một checkout ghi riêng — Codex luôn review đúng checkout `ACTIVE_EXECUTOR` đang dùng; phiên Claude reviewer luôn tách biệt khỏi phiên implementer, không phải một checkout ghi thứ hai.

## 8. Repository checkout và branch lifecycle

`docs/governance/RULES.md` §5 là nguồn canonical: dự án dùng đúng một
checkout repository đang tồn tại; `git worktree add` và mọi checkout thực
thi bổ sung đều bị cấm, không ngoại lệ. Mục này chỉ mô tả vận hành cụ thể
trong một phiên.

### Tạo

- Work item có một feature branch từ baseline do OC chỉ định, checkout trực
  tiếp trong checkout đó (`git switch -c`).
- Chỉ checkout đó cấp quyền ghi cho `ACTIVE_EXECUTOR` của work item. Reviewer
  (Codex qua plugin, hoặc phiên Claude read-only riêng) chỉ đọc cùng Git
  state/diff để review, không cần checkout riêng cho mình.

### Trong khi chạy

- Chỉ `ACTIVE_EXECUTOR` được ghi.
- Control Tower/OC review bằng diff, report hoặc GitHub; không sửa working
  tree đang active.
- Không đổi branch hoặc mutate working tree trong lúc independent review.

### Kết thúc

- `ACTIVE_EXECUTOR` và reviewer không merge hoặc xóa branch.
- OC trả recommendation.
- Owner quyết định Ready/merge.
- Sau merge: checkout quay lại `develop`, fast-forward update; Owner xác
  nhận merge SHA, `develop` HEAD mới, và xóa branch local/remote.
- Snapshot chỉ ghi trạng thái mới sau khi bằng chứng này tồn tại.

## 9. Completion report và review

Completion report tối thiểu:

```text
Work item:
Implementer:
Reviewer:
Base and head SHA:
Files changed:
Acceptance results:
Checks run and results:
Skill policy / skills invoked / trigger evidence:
Reviewer command/contract, base and result:
Known risks / NOT RUN:
PR / branch status:
Requested decision:
```

Owner chuyển nguyên report cho OC, bổ sung link PR nếu có. OC review:

- base/head/commits/diff scope;
- acceptance criteria;
- test/CI evidence;
- dependency và regression risk;
- documentation/state consistency;
- unresolved comment hoặc blocker.

Kết quả OC:

- `PASS — recommend Owner merge`;
- `CORRECTION_REQUIRED` kèm correction prompt;
- `BLOCKED` kèm quyết định cần escalation.

## 10. Correction loop

1. OC chỉ rõ finding, evidence, expected outcome và checks phải chạy lại.
2. OC phát correction prompt cho đúng `ACTIVE_EXECUTOR` ban đầu của work item (không đổi implementer — `RULES.md` §3.1) và cập nhật `SKILL_POLICY` nếu finding cần chẩn đoán.
3. Owner kích hoạt `ACTIVE_EXECUTOR` đó.
4. `ACTIVE_EXECUTOR` sửa, test, tạo checkpoint, dừng ghi rồi công bố lại `READY_FOR_<REVIEWER>_REVIEW`; Owner invoke lại một lượt independent review read-only cho đúng phần thay đổi, nhằm `FINAL_HEAD` mới.
5. Owner chuyển trực tiếp cho OC completion report (đã cập nhật ở bước 4) cùng kết quả review verbatim; `ACTIVE_EXECUTOR` vẫn dừng ghi, không được gọi lại chỉ để chèn kết quả (`RULES.md` §3.6).
6. Owner chuyển lại cho OC review.

Correction không làm thay đổi scope lớn. Nếu phải đổi business/architecture hoặc thêm work item, OC dừng và escalation lên Control Tower.

## 11. Cập nhật nguồn sự thật

| Khi nào | File cần cập nhật |
|---|---|
| Quy tắc quyền hạn thay đổi | `RULES.md` |
| Quy trình vận hành thay đổi | `WORKFLOW.md` |
| Sự thật sản phẩm/kiến trúc ổn định thay đổi | `PROJECT_BIBLE.md` hoặc ADR |
| Trạng thái hiện tại, SHA, task kế tiếp thay đổi | `SNAPSHOT.md` |
| Objective và execution order của ngày thay đổi | plan ngày |
| Hoạt động, bằng chứng, quyết định trong ngày | worklog ngày |
| Work item cần hồ sơ bàn giao lâu dài | `docs/reports/` |

Trước khi kết thúc ngày, kiểm tra Snapshot có đủ để một Control Tower mới phục hồi mà không cần worklog hay không.

## 12. Tooling adoption gate

Mọi công cụ orchestration/skill mới đi qua bốn bước:

1. `install`: cài ngoài product source khi có thể;
2. `config`: khóa chế độ một writable checkout duy nhất, `ACTIVE_EXECUTOR`-only write và reviewer-only read-only review, đúng role pair đã chọn cho work item;
3. `dry run`: task không thay đổi product behavior;
4. `pilot`: một work item nhỏ với acceptance và rollback rõ.

Trong pilot `openai/codex-plugin-cc` (áp dụng khi `REVIEWER: CODEX_READ_ONLY`):

- chỉ bật review command read-only;
- dùng explicit base `origin/develop`;
- chỉ Owner invoke review command (`INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY`); `ACTIVE_EXECUTOR` không tự chạy;
- không dùng rescue, transfer, write mode hoặc automatic review gate;
- giới hạn một review invocation cho mỗi implementation/correction completion;
- không cấp quyền merge và không coi plugin output là verdict thay OC.

Đối với repository skill bên ngoài:

- review từng skill;
- chỉ adapt phần phù hợp;
- không chạy installer toàn bộ nếu chưa review side effect;
- skill đã chọn ban đầu là `diagnosing-bugs`; các skill khác chỉ được xét sau review riêng.

### Chính sách gọi `diagnosing-bugs`

| Tình huống | Policy |
|---|---|
| Bug/performance regression cụ thể, symptom tái hiện được hoặc root cause chưa rõ | `REQUIRED` |
| Flaky/intermittent failure, CI/test fail ngoài dự kiến, hoặc Codex finding về behavior cần điều tra | `REQUIRED` hoặc `ALLOWED_IF_TRIGGERED` do OC ghi rõ |
| Feature mới, docs, design, refactor không có symptom lỗi | `NOT_APPLICABLE` |
| Lỗi syntax/format/local compile hiển nhiên với feedback loop trực tiếp | Mặc định `NOT_APPLICABLE`, trừ khi OC yêu cầu |
| Audit hiệu năng chung không có regression/symptom cụ thể | `NOT_APPLICABLE`; đây không phải phạm vi của skill |

Khi skill được gọi, `ACTIVE_EXECUTOR` phải:

1. ghi lý do kích hoạt;
2. xây feedback loop red-capable đã chạy ít nhất một lần;
3. minimize/rank hypothesis/instrument theo skill khi cần;
4. thêm regression evidence chứng minh red trước fix và green sau fix;
5. redact secret, token, cookie, dữ liệu cá nhân và auth header khỏi output/artifact chia sẻ;
6. ghi skill invocation và loop command trong completion report.

Không gọi skill này cho toàn bộ task. Đây là quy trình chẩn đoán nặng, chỉ có lợi khi đang đuổi theo một failure cụ thể.

### Graphify — chính sách canonical

Graphify đã được adopt thành công như một công cụ code-navigation
workspace-local, **tùy chọn**, qua một replay quản trị do Claude thực hiện
với vai trò writable implementer duy nhất (`TOOL-GRAPHIFY-001-DOCS-CLOSEOUT-C4`),
sau một pilot sơ bộ Owner tự chạy trên máy Owner (không đủ để tự đóng gate
theo single-writer invariant). `docs/governance/RULES.md` không đổi trong
quá trình này. Chi tiết lịch sử: `docs/daily/2026-08/2026-08-22-worklog.md`,
`docs/reports/TOOL-GRAPHIFY-001-completion.md`.

Skill và graph là workspace-local, project-scoped, loại khỏi Git qua
`.git/info/exclude` — không tự động có ở fresh clone, worktree khác, hay
máy khác.

**Đây là nguồn canonical duy nhất cho chính sách invoke Graphify** — các
file khác (`AGENTS.md`, `SNAPSHOT.md`, report) chỉ tóm tắt ngắn và trỏ về
đây, không lặp lại chi tiết.

Mỗi Master Execution Prompt bắt buộc khai báo:

```text
GRAPHIFY_POLICY: REQUIRED_FOR_PREFLIGHT_IMPACT_ANALYSIS | ALLOWED_IF_RELEVANT | NOT_APPLICABLE
GRAPHIFY_TRIGGER_OR_REASON:
GRAPHIFY_UNAVAILABLE_OR_STALE: BLOCK | FALL_BACK_TO_SOURCE_TESTS
```

Ánh xạ:

- **`REQUIRED_FOR_PREFLIGHT_IMPACT_ANALYSIS`**: bắt buộc dùng cho preflight
  impact analysis. Nếu Graphify vắng mặt/stale: theo đúng
  `GRAPHIFY_UNAVAILABLE_OR_STALE` đã khai báo (`BLOCK` → `BLOCKED`;
  `FALL_BACK_TO_SOURCE_TESTS` → dùng source/test trực tiếp, phải report
  rõ). **Nếu trường `GRAPHIFY_UNAVAILABLE_OR_STALE` thiếu hoặc không hợp
  lệ → luôn `BLOCKED`**, không bao giờ tự fallback sang source/test —
  không có generic rule nào được ghi đè hành vi này.
- **`ALLOWED_IF_RELEVANT`**: tùy chọn. `GRAPHIFY_UNAVAILABLE_OR_STALE` vẫn
  là trường bắt buộc dưới policy này — nếu thiếu hoặc giá trị không hợp
  lệ, preflight trả `BLOCKED`. Claude tự đánh giá Graphify có thực sự
  liên quan tới task hay không trước khi gọi (ví dụ liên quan: tra
  ownership qua nhiều module, kiến trúc/dependency, impact/blast-radius,
  trace call/data-flow xuyên file, vùng code chưa quen, hay chọn file nào
  cần đọc trực tiếp; không liên quan: thay đổi đã cô lập/file đã biết rõ,
  task chỉ là docs/planning, hoặc graph không giảm được sự không chắc
  chắn):
  - **Không liên quan**: không gọi Graphify, tiếp tục task bình thường,
    không block chỉ vì graph vắng mặt/stale.
  - **Liên quan và graph khả dụng/đủ mới**: `ACTIVE_EXECUTOR` được tự động
    query — không cần xin thêm xác nhận của Owner. Đây là giá trị **duy
    nhất** cho phép auto-invocation kiểu model-selected. Trong thực tế,
    graph/skill này hiện chỉ tồn tại trên workspace Claude (xem
    workspace-local ở trên trong mục này) — sự khả dụng đó không được mặc
    định suy ra cho Codex hay bất kỳ agent nào khác khi agent đó giữ
    `ACTIVE_EXECUTOR`.
  - **Liên quan nhưng graph vắng mặt/stale**: theo đúng
    `GRAPHIFY_UNAVAILABLE_OR_STALE` đã khai báo — `BLOCK` → `BLOCKED`;
    `FALL_BACK_TO_SOURCE_TESTS` → tiếp tục bằng source/test, phải báo rõ
    giới hạn. Không có generic fallback nào được phép ghi đè giá trị
    `BLOCK`.
- **`NOT_APPLICABLE`**: cấm invoke — không inspect, query, install, update
  hay rebuild.
- **Thiếu hoặc không hợp lệ**: coi như `NOT_APPLICABLE`, không bao giờ như
  `ALLOWED_IF_RELEVANT`. Không suy ra quyền từ mô tả task, skill đã cài,
  graph đã có sẵn, hay việc một work item trước đã accept pilot.

Mặc định đề xuất cho Master Execution Prompt sản phẩm thông thường:

```text
GRAPHIFY_POLICY: ALLOWED_IF_RELEVANT
GRAPHIFY_UNAVAILABLE_OR_STALE: FALL_BACK_TO_SOURCE_TESTS
```

Ngoại lệ: `REQUIRED_FOR_PREFLIGHT_IMPACT_ANALYSIS` khi task đòi hỏi rõ ràng
phân tích dependency/kiến trúc/impact trước khi sửa; `NOT_APPLICABLE` cho
task docs-only, planning, hay thay đổi nhỏ cô lập không cần graph.

Không giá trị policy nào tự cấp quyền cài đặt/rebuild/hook/strict
mode/watch mode/MCP/semantic-LLM — luôn cần một work item tooling riêng
của Owner. Graphify không thay thế Master Execution Prompt, `READ_NOW` bắt
buộc, việc đọc trực tiếp source sẽ sửa, hay source/test verification —
kết quả graph luôn chỉ là advisory.

**Freshness**: `built_at_commit == HEAD` → fresh ngay. Khác nhau → chỉ
stale nếu có file trong phạm vi input của graph (với graph code-only là
các code file được index) bị đổi/thêm/xoá kể từ `built_at_commit`
(committed/staged/unstaged), hoặc build profile/version của Graphify đổi.
Thay đổi chỉ ở tài liệu, ngoài phạm vi input đó, không làm graph stale.
Không xác định được chắc chắn → coi là stale. Stale không bao giờ tự cấp
quyền install/update/rebuild.

## 13. Shutdown checklist

Trước khi đóng phiên execution:

- `ACTIVE_EXECUTOR` đã dừng và nhả write lock;
- branch/HEAD/worktree status đã được ghi;
- check đã chạy và `NOT RUN` đã khai báo;
- `READY_FOR_<REVIEWER>_REVIEW` cùng đúng review command/contract đã được công bố trước khi Owner invoke review;
- review result đã được ghi hoặc phiên trả `BLOCKED` nếu review không chạy được;
- skill invocation và trigger evidence đã được ghi nếu có;
- report đã gửi Owner;
- không tự merge hoặc tự bắt đầu task kế tiếp.

Trước khi đóng phiên Control Tower:

- Snapshot phản ánh quyết định đã được Owner xác nhận;
- plan ngày kế tiếp có objective và first action;
- chi tiết lịch sử chỉ nằm trong worklog/report;
- không để một quyết định quan trọng chỉ tồn tại trong chat.
