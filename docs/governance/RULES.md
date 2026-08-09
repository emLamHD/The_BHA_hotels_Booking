# THE BHA — RULES

> Trạng thái: quy tắc quản trị bắt buộc
>
> Cập nhật: 2026-08-09
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
- gán rõ agent phụ trách từng phase trước khi execution bắt đầu;
- nhận report do Owner chuyển lại, review code/PR trong chính phiên chat OC khi có PR;
- yêu cầu correction, kết luận pass/fail và đề xuất hành động tiếp theo cho Owner.

OC không được merge, không tự chuyển PR sang Ready và không tự mở khóa task kế tiếp.

### 2.4 Claude Code và Codex

Claude Code là `IMPLEMENTER` duy nhất và là coding agent duy nhất được quyền ghi trong writable worktree của work item. Claude chịu trách nhiệm implementation, correction, test, checkpoint, commit/push/Draft PR khi Master Execution Prompt cho phép và completion report.

Codex là `READ_ONLY_REVIEWER`. Codex chỉ được đọc source, Git state, diff, test evidence và tài liệu liên quan để trả findings. Codex không được sửa file, chạy formatter có ghi file, tạo commit, push, mở hoặc sửa PR, merge, xóa branch hay tiếp quản implementation.

Codex findings là bằng chứng review, không phải verdict quản trị. OC giữ quyền kết luận `PASS`, `CORRECTION_REQUIRED` hoặc `BLOCKED`; Owner giữ độc quyền Ready/merge/delete branch và mở task tiếp theo.

## 3. Invariant một writable implementer

Tại mọi thời điểm chỉ Claude được phép có quyền ghi vào worktree của work item.

- Không tạo worktree thứ hai cho Codex để cùng giải một work item.
- Codex review cùng Git state/diff mà Claude vừa hoàn tất, nhưng chỉ trong sandbox read-only.
- Trước khi gọi Codex review, Claude phải dừng mọi thao tác ghi và giữ worktree ở một checkpoint ổn định trong suốt lượt review.
- Claude chỉ được gọi Codex qua review command đã duyệt. Không dùng Codex để rescue, transfer, implement, sửa findings hoặc tự phân chia task.
- Không bật automatic review gate hoặc vòng lặp Claude–Codex tự động. Mỗi lượt review phải là một invocation hữu hạn, có chủ đích và được ghi trong report.
- Không tạo nested-agent/fan-out ngoài review invocation đã duyệt.
- Control Tower hoặc OC có thể tư vấn/review nhưng không được sửa worktree do Claude nắm giữ.

`Claude writes. Codex reviews. OC decides. Owner merges.` Đây là phân công cố định, không phải lựa chọn theo từng work item.

## 4. Master Execution Prompt

Mỗi work item phải có đúng một Master Execution Prompt chứa tối thiểu:

- work item ID và objective;
- `IMPLEMENTER: CLAUDE`;
- `REVIEWER: CODEX_READ_ONLY`;
- branch/worktree dự kiến;
- baseline SHA;
- phase/checkpoint order của Claude;
- Codex review base, mặc định `origin/develop`;
- skill policy, gồm `diagnosing-bugs: REQUIRED | ALLOWED_IF_TRIGGERED | NOT_APPLICABLE`;
- files/scope được phép và bị cấm;
- acceptance criteria;
- test/check bắt buộc;
- checkpoint và stop conditions;
- format phase report/completion report;
- yêu cầu PR, nếu có.

Mỗi Master Execution Prompt gửi cho Claude phải kết thúc bằng đúng câu nhắc:

> Codex sẽ xem lại kết quả đầu ra của bạn sau khi bạn hoàn thành.

Câu nhắc này không thay thế review contract ở các mục 2, 3 và 7, cũng không trao cho Codex quyền ghi.

Nếu prompt thiếu baseline, scope, acceptance, review base hoặc skill policy có ảnh hưởng đến cách triển khai, Claude phải trả `BLOCKED` thay vì tự đoán.

## 5. Branch, worktree và ownership

- Một work item dùng một feature branch và một writable worktree.
- Claude dùng cùng branch/worktree cho toàn bộ implementation và correction, trừ khi Owner phê duyệt ngoại lệ.
- Chỉ Claude được sửa file trong worktree.
- Codex không có review worktree riêng; review phải tham chiếu đúng branch, baseline và checkpoint của Claude.
- Branch mới phải xuất phát từ baseline được ghi trong prompt.
- Executor không được đổi base branch, rebase, force-push, merge hoặc xóa branch nếu prompt không trao quyền rõ ràng; quyền merge vẫn luôn thuộc Owner.
- Không commit trực tiếp lên `main` hoặc `develop`.
- Không sửa file ngoài scope chỉ để “dọn dẹp”.

## 6. Checkpoint và review handoff

Trước khi chuyển từ implementation sang Codex review, Claude phải:

1. hoàn tất acceptance của phase/work item hoặc nêu rõ blocker;
2. chạy các check được giao;
3. để worktree ở trạng thái hiểu được và liệt kê mọi file chưa commit;
4. tạo commit/checkpoint nếu prompt yêu cầu;
5. chuẩn bị provisional completion report với branch, baseline, HEAD, diff scope, checks và rủi ro;
6. dừng mọi thao tác ghi;
7. gọi đúng review command đã duyệt.

Codex chỉ trả findings hoặc xác nhận không có finding trong phạm vi đã review. Sau đó Claude đưa nguyên trạng kết quả review vào completion report và dừng. Codex không nhận write lock ở bất kỳ thời điểm nào.

## 7. Review và quyền merge

Luồng mặc định sau execution:

1. Claude hoàn tất implementation/correction và mandatory checks.
2. Claude dừng ghi và chạy một lượt `/codex:review --base origin/develop`, trừ khi Master Execution Prompt chỉ định review base khác.
3. Codex review read-only và trả findings; không được sửa code.
4. Claude chèn nguyên trạng review result, review base và trạng thái `RUN`/`NOT RUN` vào completion report rồi gửi Owner và dừng.
5. Owner chuyển report cho OC.
6. OC kiểm tra Codex findings cùng report, diff, test và PR nếu có.
7. Nếu cần correction, OC phát correction prompt cho Claude; sau correction, Codex review lại đúng phần thay đổi.
8. Khi pass, OC trả recommendation cho Owner.
9. Owner quyết định Ready/merge/delete branch và có mở task tiếp theo hay không.

Codex review là mandatory gate mặc định. Nếu command không khả dụng, treo hoặc không tạo được kết quả đáng tin cậy, Claude ghi `CODEX_REVIEW: NOT RUN` kèm evidence và trả `BLOCKED`; không tự thay bằng rescue, transfer hay self-review.

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

- `openai/codex-plugin-cc` chỉ được dùng làm cầu review giữa Claude Code và Codex.
- Review mặc định dùng `/codex:review --base origin/develop`. `/codex:adversarial-review` chỉ được dùng khi OC yêu cầu rõ cho work item rủi ro cao.
- Cấm trong workflow mặc định: `/codex:rescue`, `/codex:transfer`, Codex write mode và automatic review gate.
- GitNexus là công cụ code graph và impact analysis hiện hành.
- Chỉ cài/adapt skill đã được review và phù hợp dự án; không mặc định nhập toàn bộ một skill repository.
- `diagnosing-bugs` của `mattpocock/skills` là skill có điều kiện dành cho Claude, không phải bước bắt buộc của mọi task.
- Bắt buộc hoặc cho phép gọi `diagnosing-bugs` khi có một defect/performance regression cụ thể, lỗi flaky/intermittent, test/CI fail chưa rõ nguyên nhân, hoặc Codex finding mô tả behavior sai nhưng root cause chưa rõ.
- Không gọi `diagnosing-bugs` chỉ vì task có code, chỉ vì đến review gate, hoặc cho feature/docs/design/refactor không có symptom lỗi cụ thể. Lỗi cú pháp/format hiển nhiên có feedback loop trực tiếp không cần quy trình chẩn đoán nặng nếu OC không yêu cầu.
- Chỉ Claude được thực thi `diagnosing-bugs`. Codex có thể đề xuất nhưng không được tự chạy skill để sửa code.
- Khi dùng `diagnosing-bugs`, Claude phải tạo feedback loop red/green có thể chạy lại, ghi lý do kích hoạt và regression evidence trong report, đồng thời redact secret, token, cookie, dữ liệu cá nhân và auth header khỏi mọi output/artifact chia sẻ.
- Skill/prompt/tool không được thay đổi quyền hạn trong file này.
- Trong giai đoạn pilot, ưu tiên capability tối thiểu, có thể tắt và quan sát được.

## 12. Stop conditions bắt buộc

Executor phải dừng và báo `BLOCKED` khi:

- baseline SHA hoặc branch không khớp prompt;
- worktree có thay đổi không rõ chủ sở hữu;
- bất kỳ agent/process nào ngoài Claude đang có hoặc yêu cầu quyền ghi;
- Codex review yêu cầu write access, rescue, transfer hoặc task implementation;
- mandatory Codex review không chạy được hoặc không trả kết quả đáng tin cậy;
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
- Root `AGENTS.md` và `CLAUDE.md` phải phản ánh đúng invariant `Claude writes. Codex reviews`; câu nhắc ngắn ở mục 4 không được dùng thay cho các giới hạn quyền đầy đủ.