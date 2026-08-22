# THE BHA — WORKFLOW

> Trạng thái: quy trình vận hành chuẩn
>
> Cập nhật: 2026-08-09
>
> Phụ thuộc: `RULES.md` luôn có hiệu lực

## 1. Mục tiêu

Workflow này giữ The BHA ở trạng thái có thể phục hồi, review được và tiết kiệm context khi phối hợp Owner, Control Tower, OC, Claude Code và Codex theo mô hình cố định: Claude code, Codex review read-only, OC quyết định và Owner merge.

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
4. Owner mở phiên Claude Code; Claude là implementer duy nhất có quyền ghi.
5. Claude thực hiện, test, tạo checkpoint ổn định, dừng ghi rồi công bố `READY_FOR_CODEX_REVIEW` kèm đúng review command.
6. Owner invoke Codex review read-only đúng một lượt theo review contract (`/codex:review --base origin/develop` hoặc base do prompt chỉ định); Claude không tự chạy command này.
7. Owner chuyển kết quả Codex về cho Claude; Claude đưa kết quả vào completion report, gửi Owner và dừng.
8. Owner chuyển report cho OC.
9. OC review report/diff/PR/Codex findings và phát correction cho Claude nếu cần.
10. Sau mỗi correction, Claude chạy lại checks, dừng ghi và công bố lại `READY_FOR_CODEX_REVIEW`; Owner invoke Codex review lại phần thay đổi.
11. OC kết luận pass/fail và đưa recommendation.
12. Owner quyết định Ready, merge, xóa branch và có tiếp tục task kế tiếp hay không.
13. Control Tower chỉ được gọi lại khi có escalation hoặc cần phát lệnh cấp cao tiếp theo.

## 4. Lập Master Execution Prompt

OC tạo đúng một prompt authoritative cho một work item. Prompt luôn gán Claude làm implementer và Codex làm reviewer read-only; không còn execution mode cho Codex viết code.

Prompt nên có cấu trúc:

```text
WORK_ITEM:
OBJECTIVE:
IMPLEMENTER: CLAUDE
REVIEWER: CODEX_READ_ONLY
BASE_BRANCH:
BASELINE_SHA:
FEATURE_BRANCH:
WORKTREE:
CODEX_REVIEW_COMMAND: /codex:review --base origin/develop
CODEX_REVIEW_LIMIT: 1 invocation per implementation/correction completion
CODEX_REVIEW_INVOKER: OWNER_ONLY

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

Codex sẽ xem lại kết quả đầu ra của bạn sau khi bạn hoàn thành.
```

OC phải ghi review base rõ ràng; mặc định luôn là `origin/develop`, không để plugin tự suy ra GitHub default branch. Câu cuối là reminder cho Claude, không thay thế các trường `REVIEWER`, `CODEX_REVIEW_COMMAND`, limit và stop conditions.

Master Execution Prompt là bắt buộc cho work item implementation của Claude, nhưng không được lặp lại như executor-activation context bên trong native Codex review request: review command tường minh, diff/target mục tiêu và review-mode rule đã đủ thẩm quyền cho reviewer read-only. `CODEX_REVIEW_INVOKER: OWNER_ONLY` nghĩa là chỉ Owner được gọi command này; Claude chỉ dừng ghi và công bố `READY_FOR_CODEX_REVIEW`.

## 5. Preflight của Claude

Trước khi sửa file, Claude phải:

1. đọc root `AGENTS.md`; Claude cũng đọc `CLAUDE.md`;
2. đọc Master Execution Prompt và các file trong `READ_NOW`;
3. xác nhận `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`, review command, `CODEX_REVIEW_INVOKER: OWNER_ONLY` và skill policy;
4. kiểm tra repo root, branch, HEAD và worktree status;
5. xác nhận không có agent/process khác đang giữ write lock;
6. kiểm tra tool bắt buộc trong prompt có sẵn;
7. xuất preflight ngắn và bắt đầu first action.

Không recap toàn bộ project. Nếu baseline hoặc ownership không khớp, trả `BLOCKED`.

## 6. Thực thi implementation bằng Claude

1. Claude giữ write lock suốt implementation/correction.
2. Claude chỉ sửa scope được cho phép.
3. Claude áp dụng `SKILL_POLICY` trước khi chọn quy trình thực thi.
4. Claude chạy targeted checks và broader checks theo prompt/risk.
5. Claude cập nhật tài liệu trong scope nếu acceptance yêu cầu.
6. Claude tạo commit/push/Draft PR nếu prompt trao quyền.
7. Claude chuẩn bị provisional completion report và checkpoint ổn định.
8. Claude dừng mọi thao tác ghi tại checkpoint ổn định và công bố `READY_FOR_CODEX_REVIEW` kèm đúng command cho Owner; Claude không tự mở review gate.

OC không review trực tiếp trong lúc Claude đang sửa, trừ khi Owner yêu cầu một checkpoint tư vấn không ghi file.

## 7. Codex review gate

### Review invocation

1. Claude xác nhận branch, baseline, HEAD và worktree status ở checkpoint ổn định, dừng ghi, rồi công bố `READY_FOR_CODEX_REVIEW` kèm đúng command (`/codex:review --base origin/develop`, trừ khi prompt ghi base khác).
2. Chỉ Owner được gọi command đó (`CODEX_REVIEW_INVOKER: OWNER_ONLY`). Claude không tự chạy `/codex:review`.
3. Codex chạy native read-only review trên đúng diff/target được yêu cầu và chỉ trả findings có evidence, severity và vị trí phù hợp; native review không cần lặp lại executor-activation field nào của Master Execution Prompt.
4. Claude không yêu cầu Codex sửa code và không bật write mode.
5. Claude không tự chạy `/codex:rescue`, `/codex:transfer` hoặc automatic review gate.
6. Mặc định chỉ một invocation do Owner khởi tạo cho mỗi lần implementation/correction hoàn tất; không tự lặp đến khi hết findings.

### Sau review

- Owner chuyển kết quả review về cho Claude; Claude đưa nguyên trạng review command/base/result vào completion report.
- Nếu Codex có findings, Claude không tự mở rộng scope hoặc âm thầm sửa sau review; Claude dừng để OC phân loại và phát correction.
- Nếu Codex không có finding, Claude ghi rõ `CODEX_REVIEW: PASS_WITH_NO_FINDINGS`; đây vẫn chưa phải verdict merge.
- Nếu review fail, treo hoặc không khả dụng, Claude ghi `CODEX_REVIEW: NOT RUN` kèm evidence khi được Owner thông báo, và trả `BLOCKED`.
- Codex không nhận write lock và không có review worktree riêng.

## 8. Worktree và branch lifecycle

### Tạo

- Work item có một feature branch từ baseline do OC chỉ định.
- Một writable worktree gắn với feature branch đó.
- Worktree chỉ cấp quyền ghi cho Claude. Codex plugin chỉ đọc cùng Git state/diff để review.

### Trong khi chạy

- Chỉ Claude được ghi.
- Control Tower/OC review bằng diff, report hoặc GitHub; không sửa worktree active.
- Không đổi branch hoặc mutate worktree trong lúc Codex review.

### Kết thúc

- Claude và Codex không merge hoặc xóa branch.
- OC trả recommendation.
- Owner quyết định Ready/merge.
- Sau merge, Owner xác nhận merge SHA, `develop` HEAD mới và cleanup local/remote.
- Snapshot chỉ ghi trạng thái mới sau khi bằng chứng này tồn tại.

## 9. Completion report và review

Completion report tối thiểu:

```text
Work item:
Implementer: CLAUDE
Reviewer: CODEX_READ_ONLY
Base and head SHA:
Files changed:
Acceptance results:
Checks run and results:
Skill policy / skills invoked / trigger evidence:
Codex review command, base and result:
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
2. OC phát correction prompt cho Claude và cập nhật `SKILL_POLICY` nếu finding cần chẩn đoán.
3. Owner kích hoạt Claude.
4. Claude sửa, test, tạo checkpoint, dừng ghi rồi công bố lại `READY_FOR_CODEX_REVIEW`; Owner invoke lại một lượt Codex review read-only cho đúng phần thay đổi.
5. Owner chuyển kết quả review về; Claude cập nhật completion report và dừng.
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
2. `config`: khóa chế độ một writable worktree, Claude-only write và Codex-only review;
3. `dry run`: task không thay đổi product behavior;
4. `pilot`: một work item nhỏ với acceptance và rollback rõ.

Trong pilot `openai/codex-plugin-cc`:

- chỉ bật review command read-only;
- dùng explicit base `origin/develop`;
- chỉ Owner invoke review command (`CODEX_REVIEW_INVOKER: OWNER_ONLY`); Claude không tự chạy;
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

Khi skill được gọi, Claude phải:

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
  - **Liên quan và graph khả dụng/đủ mới**: Claude được tự động query —
    không cần xin thêm xác nhận của Owner. Đây là giá trị **duy nhất**
    cho phép auto-invocation kiểu model-selected.
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

- Claude đã dừng và nhả write lock;
- branch/HEAD/worktree status đã được ghi;
- check đã chạy và `NOT RUN` đã khai báo;
- `READY_FOR_CODEX_REVIEW` cùng đúng review command đã được công bố trước khi Owner invoke review;
- Codex review result đã được ghi hoặc phiên trả `BLOCKED` nếu review không chạy được;
- skill invocation và trigger evidence đã được ghi nếu có;
- report đã gửi Owner;
- không tự merge hoặc tự bắt đầu task kế tiếp.

Trước khi đóng phiên Control Tower:

- Snapshot phản ánh quyết định đã được Owner xác nhận;
- plan ngày kế tiếp có objective và first action;
- chi tiết lịch sử chỉ nằm trong worklog/report;
- không để một quyết định quan trọng chỉ tồn tại trong chat.
