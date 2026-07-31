# THE BHA — RULES

> Trạng thái: quy tắc quản trị bắt buộc  
> Cập nhật: 2026-07-31  
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

Claude Code và Codex là hai executor ngang hàng về quyền ghi code. Agent nào được OC gán cho phase hiện tại thì agent đó là `Active Executor`.

- `SINGLE_AGENT`: một agent làm toàn bộ work item.
- `SEQUENTIAL_DUAL_AGENT`: Claude và Codex làm các phase khác nhau theo thứ tự OC đã định.

Codex không mặc định là reviewer độc lập và Claude không mặc định là executor duy nhất. Vai trò cụ thể phải được ghi trong Master Execution Prompt.

## 3. Invariant một agent hoạt động

Tại mọi thời điểm chỉ một coding agent được phép có quyền ghi vào worktree của work item.

- Không chạy Claude và Codex song song trên cùng worktree, branch hoặc task.
- Không cho mỗi agent một worktree riêng để cùng giải một work item.
- Không để Claude gọi Codex, Codex gọi Claude, hoặc tạo nested-agent/fan-out ngoài prompt.
- Phiên của Control Tower hoặc OC có thể tồn tại để tư vấn/review nhưng không được đồng thời sửa worktree đang do Active Executor nắm giữ.
- Chuyển agent chỉ xảy ra sau khi agent trước đã dừng, tạo checkpoint hợp lệ và xuất phase report.

`Same prompt = yes. Self-divide = no.` Hai agent có thể nhận cùng Master Execution Prompt, nhưng không được tự thương lượng hoặc tự chia việc. Phân công của OC là authoritative.

## 4. Master Execution Prompt

Mỗi work item phải có đúng một Master Execution Prompt chứa tối thiểu:

- work item ID và objective;
- execution mode;
- branch/worktree dự kiến;
- baseline SHA;
- phase order và `ACTIVE_EXECUTOR` của từng phase;
- files/scope được phép và bị cấm;
- acceptance criteria;
- test/check bắt buộc;
- checkpoint và stop conditions;
- format phase report/completion report;
- yêu cầu PR, nếu có.

Nếu prompt thiếu agent phụ trách phase hiện tại, baseline, scope hoặc acceptance có ảnh hưởng đến cách triển khai, executor phải trả `BLOCKED` thay vì tự đoán.

## 5. Branch, worktree và ownership

- Một work item dùng một feature branch và một writable worktree.
- Các phase tuần tự dùng chung branch/worktree, trừ khi Owner phê duyệt ngoại lệ.
- Chỉ Active Executor được sửa file trong worktree ở phase hiện tại.
- Branch mới phải xuất phát từ baseline được ghi trong prompt.
- Executor không được đổi base branch, rebase, force-push, merge hoặc xóa branch nếu prompt không trao quyền rõ ràng; quyền merge vẫn luôn thuộc Owner.
- Không commit trực tiếp lên `main` hoặc `develop`.
- Không sửa file ngoài scope chỉ để “dọn dẹp”.

## 6. Checkpoint và chuyển giao agent

Trước khi chuyển từ agent A sang agent B, agent A phải:

1. hoàn tất acceptance của phase hoặc nêu rõ blocker;
2. chạy các check được giao;
3. để worktree ở trạng thái hiểu được và liệt kê mọi file chưa commit;
4. tạo commit/checkpoint nếu prompt yêu cầu;
5. xuất phase report với SHA, thay đổi, test, rủi ro và next phase;
6. dừng hoàn toàn.

Owner hoặc OC mới được kích hoạt agent kế tiếp. Agent B phải kiểm tra branch, HEAD, worktree status và report trước khi sửa file.

## 7. Review và quyền merge

Luồng mặc định sau execution:

1. Executor gửi completion report cho Owner.
2. Owner chuyển report cho OC.
3. OC kiểm tra report, diff, test và PR nếu có.
4. Nếu cần correction, OC phát prompt correction cho đúng Active Executor.
5. Khi pass, OC trả recommendation cho Owner.
6. Owner quyết định Ready/merge/delete branch và có mở task tiếp theo hay không.

Chỉ escalation lên Control Tower khi vấn đề chạm business scope, kiến trúc, dependency cấp dự án hoặc vượt quyền OC.

## 8. Nguồn sự thật

Các nguồn sự thật có vai trò khác nhau:

- `docs/governance/RULES.md`: quyền hạn và invariant bắt buộc.
- `docs/governance/WORKFLOW.md`: quy trình vận hành.
- `docs/project/PROJECT_BIBLE.md`: sự thật sản phẩm và kiến trúc ổn định.
- `docs/project/SNAPSHOT.md`: trạng thái hiện tại có thể phục hồi.
- `docs/project/adr/`: quyết định kiến trúc bền vững.
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

- Orca chỉ là cockpit/worktree manager hỗ trợ vận hành; không có quyền tự phân việc, tự mở agent song song hoặc thay thế OC.
- GitNexus là công cụ code graph và impact analysis hiện hành.
- Chỉ cài/adapt skill đã được review và phù hợp dự án; không mặc định nhập toàn bộ một skill repository.
- Skill/prompt/tool không được thay đổi quyền hạn trong file này.
- Trong giai đoạn pilot, ưu tiên capability tối thiểu, có thể tắt và quan sát được.

## 12. Stop conditions bắt buộc

Executor phải dừng và báo `BLOCKED` khi:

- baseline SHA hoặc branch không khớp prompt;
- worktree có thay đổi không rõ chủ sở hữu;
- agent khác vẫn đang active với quyền ghi;
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
