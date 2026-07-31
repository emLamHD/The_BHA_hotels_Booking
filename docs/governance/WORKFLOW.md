# THE BHA — WORKFLOW

> Trạng thái: quy trình vận hành chuẩn
>
> Cập nhật: 2026-07-31
>
> Phụ thuộc: `RULES.md` luôn có hiệu lực

## 1. Mục tiêu

Workflow này giữ The BHA ở trạng thái có thể phục hồi, review được và tiết kiệm context khi phối hợp Owner, Control Tower, OC, Claude Code và Codex.

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
3. OC phân rã work item, phase, checkpoint và viết Master Execution Prompt.
4. OC chọn `SINGLE_AGENT` hoặc `SEQUENTIAL_DUAL_AGENT`, rồi gán agent cho từng phase.
5. Owner mở phiên Active Executor theo phân công.
6. Executor thực hiện, test và gửi report cho Owner.
7. Owner chuyển report cho OC.
8. OC review report/diff/PR và phát correction nếu cần.
9. OC kết luận pass/fail và đưa recommendation.
10. Owner quyết định Ready, merge, xóa branch và có tiếp tục task kế tiếp hay không.
11. Control Tower chỉ được gọi lại khi có escalation hoặc cần phát lệnh cấp cao tiếp theo.

## 4. Lập Master Execution Prompt

OC tạo đúng một prompt authoritative cho một work item. Hai agent có thể nhận cùng prompt, nhưng chỉ đọc và thực hiện phase được gán.

Prompt nên có cấu trúc:

```text
WORK_ITEM:
OBJECTIVE:
EXECUTION_MODE: SINGLE_AGENT | SEQUENTIAL_DUAL_AGENT
BASE_BRANCH:
BASELINE_SHA:
FEATURE_BRANCH:
WORKTREE:

PHASES:
  - PHASE_ID:
    ACTIVE_EXECUTOR: CLAUDE | CODEX
    SCOPE:
    ACCEPTANCE:
    CHECKS:
    CHECKPOINT:

READ_NOW:
ALLOWED_FILES:
FORBIDDEN_FILES:
GLOBAL_ACCEPTANCE:
STOP_CONDITIONS:
REPORT_FORMAT:
PR_REQUIREMENT:
```

OC phải phân công trước. Prompt không dùng câu như “Claude và Codex tự thảo luận rồi chia việc”.

### Chọn execution mode

Chọn `SINGLE_AGENT` khi task nhỏ, cục bộ, correction ngắn hoặc việc chuyển giao tốn nhiều hơn giá trị review.

Chỉ chọn `SEQUENTIAL_DUAL_AGENT` khi có ranh giới phase tự nhiên, ví dụ:

- phân tích/thiết kế rồi implementation;
- implementation rồi hardening/test;
- backend contract rồi frontend integration;
- migration preparation rồi verification.

Không chọn dual-agent chỉ để “dùng cả hai”.

## 5. Preflight của Active Executor

Trước khi sửa file, executor phải:

1. đọc root `AGENTS.md`; Claude cũng đọc `CLAUDE.md`;
2. đọc Master Execution Prompt và các file trong `READ_NOW`;
3. xác nhận phase hiện tại được gán đúng agent;
4. kiểm tra repo root, branch, HEAD và worktree status;
5. xác nhận không có agent khác đang giữ write lock;
6. kiểm tra tool bắt buộc trong prompt có sẵn;
7. xuất preflight ngắn và bắt đầu first action.

Không recap toàn bộ project. Nếu baseline hoặc ownership không khớp, trả `BLOCKED`.

## 6. Thực thi `SINGLE_AGENT`

1. Agent được gán giữ write lock suốt work item.
2. Agent chỉ sửa scope được cho phép.
3. Agent chạy targeted checks và broader checks theo prompt/risk.
4. Agent cập nhật tài liệu trong scope nếu acceptance yêu cầu.
5. Agent tạo commit/push/Draft PR nếu prompt trao quyền.
6. Agent gửi completion report cho Owner rồi dừng.

OC không review trực tiếp trong lúc executor đang sửa, trừ khi Owner yêu cầu một checkpoint tư vấn không ghi file.

## 7. Thực thi `SEQUENTIAL_DUAL_AGENT`

### Phase A

1. Agent A lấy write lock.
2. Agent A thực hiện đúng Phase A.
3. Agent A chạy checks của phase.
4. Agent A tạo checkpoint theo prompt.
5. Agent A xuất phase report và dừng hoàn toàn.

### Handoff gate

Owner hoặc OC xác nhận:

- process agent A đã dừng;
- branch/worktree/HEAD đúng;
- working tree sạch hoặc mọi thay đổi chưa commit đã được giải thích;
- checkpoint SHA/report tồn tại;
- Phase B đã được mở khóa.

### Phase B

1. Agent B đọc cùng Master Execution Prompt.
2. Agent B chỉ nạp report Phase A và tài liệu `READ NOW` cần thiết.
3. Agent B kiểm tra Git state trước khi sửa.
4. Agent B tiếp tục trên cùng branch/worktree.
5. Agent B hoàn tất checks và completion report rồi dừng.

Không có giao tiếp agent-to-agent trực tiếp. Report và Git checkpoint là giao thức chuyển giao.

## 8. Worktree và branch lifecycle

### Tạo

- Work item có một feature branch từ baseline do OC chỉ định.
- Một writable worktree gắn với feature branch đó.
- Orca có thể tạo/mở/quan sát worktree sau khi cài, nhưng không tự đổi execution mode hoặc spawn song song.

### Trong khi chạy

- Chỉ Active Executor được ghi.
- Control Tower/OC review bằng diff, report hoặc GitHub; không sửa worktree active.
- Không đổi branch giữa phase nếu chưa có handoff gate.

### Kết thúc

- Executor không merge hoặc xóa branch.
- OC trả recommendation.
- Owner quyết định Ready/merge.
- Sau merge, Owner xác nhận merge SHA, `develop` HEAD mới và cleanup local/remote.
- Snapshot chỉ ghi trạng thái mới sau khi bằng chứng này tồn tại.

## 9. Completion report và review

Completion report tối thiểu:

```text
Work item:
Execution mode:
Active executor / completed phases:
Base and head SHA:
Files changed:
Acceptance results:
Checks run and results:
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
2. OC gán correction cho một Active Executor; mặc định dùng agent phù hợp với phần code đó, không tự động gọi cả hai.
3. Owner kích hoạt agent.
4. Agent sửa, test, cập nhật report và dừng.
5. Owner chuyển lại cho OC review.

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
2. `config`: khóa chế độ một writable worktree, một Active Executor;
3. `dry run`: task không thay đổi product behavior;
4. `pilot`: một work item nhỏ với acceptance và rollback rõ.

Trong pilot Orca:

- dùng như cockpit/worktree manager;
- tắt parallel execution, auto-routing và nested orchestration;
- không cấp quyền merge;
- không coi metadata của Orca là source of truth thay Git/Snapshot.

Đối với repository skill bên ngoài:

- review từng skill;
- chỉ adapt phần phù hợp;
- không chạy installer toàn bộ nếu chưa review side effect;
- ưu tiên `diagnosing-bugs`; các skill khác chỉ lấy nguyên tắc khi thật sự cần.

## 13. Shutdown checklist

Trước khi đóng phiên execution:

- agent đã dừng và nhả write lock;
- branch/HEAD/worktree status đã được ghi;
- check đã chạy và `NOT RUN` đã khai báo;
- report đã gửi Owner;
- không tự merge hoặc tự bắt đầu task kế tiếp.

Trước khi đóng phiên Control Tower:

- Snapshot phản ánh quyết định đã được Owner xác nhận;
- plan ngày kế tiếp có objective và first action;
- chi tiết lịch sử chỉ nằm trong worklog/report;
- không để một quyết định quan trọng chỉ tồn tại trong chat.
