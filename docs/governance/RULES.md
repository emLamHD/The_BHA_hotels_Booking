# THE BHA — RULES

> Trạng thái: quy tắc quản trị bắt buộc
>
> Cập nhật: 2026-09-01
>
> Phạm vi: mọi phiên Control Tower, Operations Coordinator, Claude Code và Codex

## 1. Mục đích

File này định nghĩa quyền hạn, ranh giới và các invariant bắt buộc của The BHA. Nếu một prompt, công cụ, skill hay thói quen làm việc mâu thuẫn với file này thì `RULES.md` thắng, trừ khi Owner sửa quy tắc bằng một quyết định mới được ghi lại.

## 2. Quyền quyết định

### 2.1 Owner — Hồ Đình Lâm

Owner là người duy nhất có quyền:

- chấp nhận hoặc từ chối thay đổi business scope;
- chấp nhận technical recommendation ở cấp dự án;
- quyết định có bắt đầu task tiếp theo hay không;
- chuyển PR từ Draft sang Ready, merge PR và xóa branch local/remote;
- cho phép ngoại lệ đối với workflow này.

Không AI nào được tự suy diễn quyền merge từ việc task đã pass review.

### 2.2 Tech Lead / Control Tower

Control Tower:

- giữ bức tranh cấp dự án và execution order;
- chốt objective, dependency, risk và acceptance ở cấp cao;
- phát lệnh cấp cao cho Operations Coordinator;
- xử lý escalation về kiến trúc, business scope hoặc quyết định có ảnh hưởng nhiều work item;
- đưa ra technical gate/recommendation khi Owner yêu cầu.

Control Tower không mặc định trực tiếp code và không thay Owner merge.

### 2.3 Operations Coordinator — OC

OC:

- phân rã lệnh cấp cao thành work item, phase và checkpoint;
- chọn execution mode;
- viết một `Master Execution Prompt` dùng chung cho work item;
- chọn một role pair cho toàn bộ work item trước khi execution bắt đầu; việc phân rã phase/checkpoint không được thay đổi implementer;
- nhận report do Owner chuyển lại, review code/PR trong chính phiên chat OC khi có PR;
- yêu cầu correction, kết luận pass/fail và đề xuất hành động tiếp theo cho Owner.

OC không được merge, không tự chuyển PR sang Ready và không tự mở khóa task kế tiếp.

### 2.4 Implementer và Reviewer

Mỗi Master Execution Prompt chọn đúng một trong hai role pair sau:

| `IMPLEMENTER` | `REVIEWER` |
| --- | --- |
| `CLAUDE` | `CODEX_READ_ONLY` |
| `CODEX` | `CLAUDE_READ_ONLY` |

Giá trị kết hợp (ví dụ `CLAUDE/CODEX`) không hợp lệ. Implementer được chọn là `ACTIVE_EXECUTOR` — coding agent duy nhất được quyền ghi trong checkout đang dùng của work item. `ACTIVE_EXECUTOR` chịu trách nhiệm implementation, correction, test, checkpoint, commit/push/Draft PR khi Master Execution Prompt cho phép và completion report.

Reviewer ghép cặp chỉ được đọc source, Git state, diff, test evidence và tài liệu liên quan để trả findings. Reviewer không được sửa file, chạy formatter có ghi file, tạo commit, push, mở hoặc sửa PR, merge, xóa branch hay tiếp quản implementation. Implementer không tự review độc lập công việc của chính mình. Role pair không đổi trong suốt work item và mọi correction của work item đó — đổi implementer đòi hỏi một work item mới, được authorize riêng.

Reviewer findings là bằng chứng review, không phải verdict quản trị. OC giữ quyền kết luận `PASS`, `CORRECTION_REQUIRED` hoặc `BLOCKED`; Owner giữ độc quyền Ready/merge/delete branch và mở task tiếp theo.

## 3. Invariant một writable implementer

Tại mọi thời điểm chỉ `ACTIVE_EXECUTOR` (implementer được chọn) được phép có quyền ghi vào checkout đang dùng của work item.

- Không tạo worktree thứ hai cho reviewer để cùng giải một work item.
- Reviewer review cùng Git state/diff mà `ACTIVE_EXECUTOR` vừa hoàn tất, nhưng chỉ trong sandbox/phiên read-only.
- Trước khi Owner gọi reviewer, `ACTIVE_EXECUTOR` phải dừng mọi thao tác ghi và giữ working tree ở một checkpoint ổn định trong suốt lượt review.
- Chỉ Owner được phép gọi reviewer, và chỉ qua cơ chế đã duyệt (`/codex:review` khi reviewer là Codex; một phiên Claude read-only riêng khi reviewer là Claude). `ACTIVE_EXECUTOR` không tự thực thi việc gọi reviewer; không dùng reviewer để rescue, transfer, implement, sửa findings hoặc tự phân chia task.
- Không bật automatic review gate hoặc vòng lặp implementer–reviewer tự động. Mỗi lượt review phải là một invocation hữu hạn, có chủ đích và được ghi trong report.
- Không tạo nested-agent/fan-out ngoài review invocation đã duyệt.
- Control Tower hoặc OC có thể tư vấn/review nhưng không được sửa worktree do `ACTIVE_EXECUTOR` nắm giữ.

`Implementer được chọn ghi. Reviewer ghép cặp review độc lập, read-only. OC quyết định. Owner merge.` Role pair cố định trong suốt work item, không đổi giữa chừng hoặc qua correction.

## 4. Master Execution Prompt

Mỗi work item phải có đúng một Master Execution Prompt chứa tối thiểu các
trường **bắt buộc** sau:

- work item ID và objective;
- `IMPLEMENTER` và `REVIEWER` — đúng một trong hai role pair ở §2.4;
- `REPOSITORY` và `FEATURE_BRANCH` dự kiến;
- baseline SHA;
- phase/checkpoint order của `ACTIVE_EXECUTOR`;
- review base, mặc định `origin/develop`;
- skill policy, gồm `diagnosing-bugs: REQUIRED | ALLOWED_IF_TRIGGERED | NOT_APPLICABLE`;
- files/scope được phép và bị cấm;
- acceptance criteria;
- test/check bắt buộc;
- checkpoint và stop conditions;
- format phase report/completion report;
- yêu cầu PR, nếu có.

Mỗi Master Execution Prompt gửi cho `ACTIVE_EXECUTOR` phải kết thúc bằng đúng câu nhắc nêu tên reviewer đã chọn, ví dụ:

> Codex sẽ xem lại kết quả đầu ra của bạn sau khi bạn hoàn thành.

Câu nhắc này không thay thế review contract ở các mục 2, 3 và 7, cũng không trao cho reviewer quyền ghi.

Master Execution Prompt là bắt buộc cho work item implementation của `ACTIVE_EXECUTOR`, nhưng không được lặp lại như executor-activation context bên trong native review request. Native review chỉ cần review command/instruction tường minh, diff/target mục tiêu và review-mode rule ở mục 2 và 3; review không cần và không chờ `ACTIVE_EXECUTOR`, `PHASE_ID` hay `EXECUTION_MODE`.

Nếu prompt thiếu baseline, scope, acceptance, review base hoặc skill policy có ảnh hưởng đến cách triển khai, `ACTIVE_EXECUTOR` phải trả `BLOCKED` thay vì tự đoán.

## 5. Active execution checkout và branch lifecycle

Mỗi work item chỉ được có đúng một **active execution checkout** — repository
checkout được Master Execution Prompt chỉ định qua trường `REPOSITORY`
(trên máy hiện tại: `/home/admin1/The_BHA_hotels_Booking`; nói chung,
checkout chứa root `AGENTS.md` áp dụng cho phiên đó). Feature branch được
checkout và thực thi trực tiếp tại chính checkout đó.

- Một work item dùng một feature branch, checkout trực tiếp trong active
  execution checkout bằng `git switch -c <branch>`.
- Chỉ `ACTIVE_EXECUTOR` được sửa file trong active execution checkout này.
- Không được chạy `git worktree add`, tạo checkout thực thi bổ sung, chuyển
  sang hoặc sử dụng linked worktree để thực thi work item. Không có
  authorization field, exception contract hoặc policy matrix nào cho linked
  worktree — không có ngoại lệ.
- Linked worktree cũ, không hoạt động và không liên quan đến work item hiện
  tại có thể vẫn tồn tại vật lý trên máy (ví dụ từ công cụ/thử nghiệm đã
  ngưng dùng). Sự tồn tại vật lý của chúng **không** tự làm preflight thất
  bại và không mâu thuẫn với invariant "một active execution checkout" ở
  trên — invariant này nói về checkout đang dùng để thực thi, không phải số
  lượng checkout tồn tại trên đĩa. Nếu phát hiện một checkout/worktree cũ
  trong lúc preflight, chỉ ghi nhận (audit) và để nguyên; không sử dụng,
  không sửa, không xóa nếu chưa có chỉ thị riêng của Owner cho đúng
  checkout đó.
- Branch mới phải xuất phát từ baseline được ghi trong prompt.
- Executor không được đổi base branch, rebase, force-push, merge hoặc xóa
  branch nếu prompt không trao quyền rõ ràng; quyền merge và branch cleanup
  vẫn luôn thuộc Owner.
- Không commit trực tiếp lên `main` hoặc `develop`.
- Không sửa file ngoài scope chỉ để "dọn dẹp".

Vòng đời branch chuẩn:

```text
develop
→ verify baseline
→ git switch -c feature branch
→ work/commit/push/Draft PR
→ Owner review và merge
→ git switch develop
→ fast-forward update
→ Owner xóa feature branch
```

`Implementer được chọn ghi. Reviewer ghép cặp review độc lập, read-only. OC quyết định. Owner merge.` vẫn là bất biến cố định (§2, §3) — mô hình một-checkout này không cấp quyền ghi cho reviewer, subagent hay parallel implementation.

## 6. Checkpoint và review handoff

Trước khi chuyển từ implementation sang review, `ACTIVE_EXECUTOR` phải:

1. hoàn tất acceptance của phase/work item hoặc nêu rõ blocker;
2. chạy các check được giao;
3. để worktree ở trạng thái hiểu được và liệt kê mọi file chưa commit;
4. tạo commit/checkpoint nếu prompt yêu cầu;
5. chuẩn bị provisional completion report với branch, baseline, HEAD, diff scope, checks và rủi ro;
6. dừng mọi thao tác ghi;
7. công bố `READY_FOR_<REVIEWER>_REVIEW` kèm đúng review command/instruction Owner cần dùng; `ACTIVE_EXECUTOR` không tự gọi command đó.

Chỉ Owner được invoke command hoặc mở reviewer session này. Reviewer chỉ trả findings hoặc xác nhận không có finding trong phạm vi đã review. Sau khi Owner chuyển kết quả về, `ACTIVE_EXECUTOR` đưa nguyên trạng kết quả review vào completion report và dừng. Reviewer không nhận write lock ở bất kỳ thời điểm nào.

## 7. Review và quyền merge

Luồng mặc định sau execution:

1. `ACTIVE_EXECUTOR` hoàn tất implementation/correction và mandatory checks.
2. `ACTIVE_EXECUTOR` dừng mọi thao tác ghi tại một checkpoint ổn định, công bố `READY_FOR_<REVIEWER>_REVIEW` và in đúng command/instruction Owner cần dùng (Codex: mặc định `/codex:review --base origin/develop`, trừ khi Master Execution Prompt chỉ định review base khác; Claude: Owner mở một phiên Claude read-only riêng).
3. Owner gọi reviewer đã chỉ định. Đây là invocation duy nhất cho lượt review này; `ACTIVE_EXECUTOR` không tự chạy command này.
4. Reviewer thực hiện review read-only trên đúng diff/target được yêu cầu và trả findings; không được sửa code.
5. Owner chuyển kết quả review về cho `ACTIVE_EXECUTOR`; `ACTIVE_EXECUTOR` chèn nguyên trạng review result, review base và trạng thái `RUN`/`NOT RUN` vào completion report rồi gửi Owner và dừng.
6. Owner chuyển report cho OC.
7. OC kiểm tra reviewer findings cùng report, diff, test và PR nếu có.
8. Nếu cần correction, OC phát correction prompt cho đúng `ACTIVE_EXECUTOR` ban đầu; sau correction, `ACTIVE_EXECUTOR` lặp lại bước 1–6 cho đúng phần thay đổi.
9. Khi pass, OC trả recommendation cho Owner.
10. Owner quyết định Ready/merge/delete branch và có mở task tiếp theo hay không.

Review là mandatory gate mặc định. Chỉ Owner được invoke reviewer; `ACTIVE_EXECUTOR` không tự gọi command này. Nếu Owner không thể invoke được review (review mechanism không khả dụng, treo hoặc không tạo được kết quả đáng tin cậy), `ACTIVE_EXECUTOR` ghi `REVIEW: NOT RUN` kèm evidence khi được Owner thông báo, và trả `BLOCKED`; không tự thay bằng rescue, transfer hay self-review.

Chỉ escalation lên Control Tower khi vấn đề chạm business scope, kiến trúc, dependency cấp dự án hoặc vượt quyền OC.

## 8. Nguồn sự thật

Các nguồn sự thật có vai trò khác nhau:

- `docs/governance/RULES.md`: quyền hạn và invariant bắt buộc.
- `docs/governance/WORKFLOW.md`: quy trình vận hành.
- `docs/project/PROJECT_BIBLE.md`: sự thật sản phẩm và kiến trúc ổn định.
- `docs/project/SNAPSHOT.md`: trạng thái hiện tại có thể phục hồi.
- `docs/ADR/`: quyết định kiến trúc bền vững.
- `docs/daily/YYYY-MM/YYYY-MM-DD-plan.md`: kế hoạch của ngày.
- `docs/daily/YYYY-MM/YYYY-MM-DD-worklog.md`: lịch sử thực thi của ngày.
- `docs/reports/`: completion/phase report cần lưu lâu hơn phiên chat.
- test baseline và trạng thái Git/CI: bằng chứng thực thi.

Thứ tự ưu tiên khi có mâu thuẫn:

1. quyết định mới nhất đã được Owner xác nhận;
2. `RULES.md`;
3. ADR đang hiệu lực;
4. `PROJECT_BIBLE.md`;
5. `SNAPSHOT.md`;
6. kế hoạch ngày hiện tại;
7. worklog và report lịch sử.

Không dùng chat history làm nguồn sự thật lâu dài.

## 9. Context discipline

- Tài liệu lịch sử được lưu để truy xuất, không phải để nạp mặc định.
- Control Tower mới chỉ đọc packet quy định trong `WORKFLOW.md`.
- Executor chỉ đọc Master Execution Prompt, instruction file bắt buộc và những tài liệu được liệt kê trong `READ NOW`.
- Không yêu cầu AI kể lại toàn bộ file đã đọc; chỉ xác nhận ngắn hoặc trích đúng phần cần dùng.
- Dùng GitNexus cho code graph/impact analysis khi có ích; không thay thế việc đọc source hoặc chạy test.

## 10. Verification discipline

- Mọi claim về behavior phải có test, log, diff hoặc dẫn chiếu source phù hợp.
- Test phải chạy theo tầng: targeted trước, broader suite sau nếu scope/risk yêu cầu.
- Không sửa test để hợp thức hóa behavior sai.
- Không báo pass nếu check bắt buộc chưa chạy; phải ghi rõ `NOT RUN` và lý do.
- Không che giấu warning, flaky test, untracked file hoặc thay đổi ngoài scope.

## 11. Công cụ và skill

- `openai/codex-plugin-cc` chỉ được dùng làm cầu review khi reviewer của work item là Codex.
- Review mặc định dùng `/codex:review --base origin/develop`, do Owner invoke sau khi `ACTIVE_EXECUTOR` công bố `READY_FOR_<REVIEWER>_REVIEW`. `/codex:adversarial-review` chỉ được dùng khi OC yêu cầu rõ cho work item rủi ro cao, và vẫn do Owner invoke.
- Cấm trong workflow mặc định: `/codex:rescue`, `/codex:transfer`, automatic review gate, và Codex write mode khi Codex là reviewer. Codex chỉ được ghi khi được chọn làm `IMPLEMENTER` bởi một Master Execution Prompt.
- GitNexus là công cụ code graph và impact analysis hiện hành.
- Chỉ cài/adapt skill đã được review và phù hợp dự án; không mặc định nhập toàn bộ một skill repository.
- `diagnosing-bugs` của `mattpocock/skills` là skill có điều kiện dành cho `ACTIVE_EXECUTOR`, không phải bước bắt buộc của mọi task.
- Bắt buộc hoặc cho phép gọi `diagnosing-bugs` khi có một defect/performance regression cụ thể, lỗi flaky/intermittent, test/CI fail chưa rõ nguyên nhân, hoặc finding của reviewer mô tả behavior sai nhưng root cause chưa rõ.
- Không gọi `diagnosing-bugs` chỉ vì task có code, chỉ vì đến review gate, hoặc cho feature/docs/design/refactor không có symptom lỗi cụ thể. Lỗi cú pháp/format hiển nhiên có feedback loop trực tiếp không cần quy trình chẩn đoán nặng nếu OC không yêu cầu.
- Chỉ `ACTIVE_EXECUTOR` được thực thi `diagnosing-bugs`. Reviewer có thể đề xuất nhưng không được tự chạy skill để sửa code.
- Khi dùng `diagnosing-bugs`, `ACTIVE_EXECUTOR` phải tạo feedback loop red/green có thể chạy lại, ghi lý do kích hoạt và regression evidence trong report, đồng thời redact secret, token, cookie, dữ liệu cá nhân và auth header khỏi mọi output/artifact chia sẻ.
- Skill/prompt/tool không được thay đổi quyền hạn trong file này.
- Trong giai đoạn pilot, ưu tiên capability tối thiểu, có thể tắt và quan sát được.

## 12. Stop conditions bắt buộc

Executor phải dừng và báo `BLOCKED` khi:

- baseline SHA hoặc branch không khớp prompt;
- worktree có thay đổi không rõ chủ sở hữu;
- bất kỳ agent/process nào ngoài `ACTIVE_EXECUTOR` đang có hoặc yêu cầu quyền ghi;
- reviewer yêu cầu write access, rescue, transfer hoặc task implementation;
- mandatory review không chạy được hoặc không trả kết quả đáng tin cậy;
- scope/acceptance mâu thuẫn hoặc thiếu quyết định cần thiết;
- cần secret, destructive action hoặc quyền bên ngoài chưa được cấp;
- test failure cho thấy phải mở rộng scope;
- thay đổi chạm business/architecture decision chưa được duyệt;
- prompt yêu cầu executor merge hoặc tự mở task kế tiếp.

## 13. Quy tắc cập nhật tài liệu

- Quyết định bền vững: cập nhật RULES, WORKFLOW, PROJECT_BIBLE hoặc ADR phù hợp.
- Trạng thái hiện tại: cập nhật SNAPSHOT.
- Kế hoạch/thực thi trong ngày: cập nhật plan và worklog.
- Completion report không thay thế SNAPSHOT.
- Khi workflow thay đổi, phải kiểm tra đồng thời `RULES.md`, `WORKFLOW.md`, root `AGENTS.md` và adapter như `CLAUDE.md` để tránh drift.
- Root `AGENTS.md` và `CLAUDE.md` phải phản ánh đúng invariant ở §2.4/§3 (implementer được chọn ghi, reviewer ghép cặp review độc lập); câu nhắc ngắn ở mục 4 không được dùng thay cho các giới hạn quyền đầy đủ.
