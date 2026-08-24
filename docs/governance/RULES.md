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

Claude Code là `IMPLEMENTER` duy nhất và là coding agent duy nhất được quyền ghi trong working tree (primary, hoặc linked worktree đã được cấp quyền theo §5.3) của work item. Claude chịu trách nhiệm implementation, correction, test, checkpoint, commit/push/Draft PR khi Master Execution Prompt cho phép và completion report.

Codex là `READ_ONLY_REVIEWER`. Codex chỉ được đọc source, Git state, diff, test evidence và tài liệu liên quan để trả findings. Codex không được sửa file, chạy formatter có ghi file, tạo commit, push, mở hoặc sửa PR, merge, xóa branch hay tiếp quản implementation.

Codex findings là bằng chứng review, không phải verdict quản trị. OC giữ quyền kết luận `PASS`, `CORRECTION_REQUIRED` hoặc `BLOCKED`; Owner giữ độc quyền Ready/merge/delete branch và mở task tiếp theo.

## 3. Invariant một writable implementer

Tại mọi thời điểm chỉ Claude được phép có quyền ghi vào working tree (primary, hoặc linked worktree đã được cấp quyền theo §5.3) của work item.

- Không tạo worktree thứ hai cho Codex để cùng giải một work item.
- Codex review cùng Git state/diff mà Claude vừa hoàn tất, nhưng chỉ trong sandbox read-only.
- Trước khi Owner gọi Codex review, Claude phải dừng mọi thao tác ghi và giữ working tree ở một checkpoint ổn định trong suốt lượt review.
- Chỉ Owner được phép gọi Codex, và chỉ qua review command đã duyệt (`/codex:review`). Claude không tự thực thi review command này; không dùng Codex để rescue, transfer, implement, sửa findings hoặc tự phân chia task.
- Không bật automatic review gate hoặc vòng lặp Claude–Codex tự động. Mỗi lượt review phải là một invocation hữu hạn, có chủ đích và được ghi trong report.
- Không tạo nested-agent/fan-out ngoài review invocation đã duyệt.
- Control Tower hoặc OC có thể tư vấn/review nhưng không được sửa worktree do Claude nắm giữ.

`Claude writes. Codex reviews. OC decides. Owner merges.` Đây là phân công cố định, không phải lựa chọn theo từng work item.

## 4. Master Execution Prompt

Mỗi work item phải có đúng một Master Execution Prompt chứa tối thiểu:

- work item ID và objective;
- `IMPLEMENTER: CLAUDE`;
- `REVIEWER: CODEX_READ_ONLY`;
- `REPOSITORY` và `FEATURE_BRANCH` dự kiến;
- `WORKING_TREE_MODE` — mặc định `PRIMARY_CHECKOUT_ONLY` nếu prompt không
  ghi trường này;
- `LINKED_WORKTREE` — mặc định `NOT_AUTHORIZED`; chỉ được ghi `AUTHORIZED`
  kèm đủ path/lý do/branch ownership/review location/cleanup owner/cleanup
  sequence theo §5.3;
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

Master Execution Prompt là bắt buộc cho work item implementation của Claude, nhưng không được lặp lại như executor-activation context bên trong native Codex review request. Native review chỉ cần review command tường minh, diff/target mục tiêu và review-mode rule ở mục 2 và 3; review không cần và không chờ `ACTIVE_EXECUTOR`, `PHASE_ID` hay `EXECUTION_MODE`.

Nếu prompt thiếu baseline, scope, acceptance, review base hoặc skill policy có ảnh hưởng đến cách triển khai, Claude phải trả `BLOCKED` thay vì tự đoán.

## 5. Working tree, linked worktree và branch lifecycle

### 5.1 Terminology

- `primary working tree`: main/non-linked checkout của repository hiện tại
  (checkout chứa root `AGENTS.md` áp dụng cho phiên đó). Đường dẫn filesystem
  của nó là environment-specific — phải được resolve từ repository root
  hiện tại hoặc trường `REPOSITORY` của Master Execution Prompt đang active;
  governance không hard-code một đường dẫn cụ thể theo máy.
- `linked worktree`: checkout bổ sung được tạo bằng `git worktree add`.
- Một phát biểu kiểu "working tree sạch" hay "working-tree status" **không**
  tự động có nghĩa phải tồn tại hay phải tạo một linked worktree — nó luôn
  chỉ nói về checkout (primary, hoặc linked worktree đã được cấp quyền theo
  §5.3) đang trong phạm vi hiện tại.

### 5.2 Mặc định: chỉ dùng primary working tree

Execution mặc định chỉ dùng đúng một filesystem checkout — primary working
tree của repository. Một feature branch được checkout trực tiếp trong
primary working tree đó (`git switch -c <branch>`). Linked worktree
(`git worktree add`) không thuộc workflow mặc định và không được tạo trừ
khi §5.3 cho phép rõ ràng.

- Một work item dùng một feature branch, checkout trực tiếp trong primary
  working tree, trừ khi có ngoại lệ theo §5.3.
- Claude dùng cùng branch/checkout đó cho toàn bộ implementation và
  correction, trừ khi Owner phê duyệt ngoại lệ.
- Chỉ Claude được sửa file trong working tree đang active (primary, hoặc
  linked worktree đã được cấp quyền).
- Codex không có review worktree riêng dưới bất kỳ policy nào; review luôn
  tham chiếu đúng branch, baseline và checkpoint mà Claude đang dùng — dù đó
  là primary working tree hay một linked worktree đã được cấp quyền.
- Branch mới phải xuất phát từ baseline được ghi trong prompt.
- Executor không được đổi base branch, rebase, force-push, merge hoặc xóa
  branch nếu prompt không trao quyền rõ ràng; quyền merge vẫn luôn thuộc
  Owner.
- Không commit trực tiếp lên `main` hoặc `develop`.
- Không sửa file ngoài scope chỉ để "dọn dẹp".

### 5.3 Ngoại lệ: linked worktree

Linked worktree chỉ được phép khi Master Execution Prompt hiện tại ghi rõ
toàn bộ các trường sau:

- `LINKED_WORKTREE: AUTHORIZED`;
- exact path;
- lý do cần isolation/parallel checkout cụ thể;
- branch ownership;
- nơi Codex review sẽ được invoke;
- ai chịu trách nhiệm cleanup;
- cleanup sequence sau merge.

Thiếu bất kỳ trường nào ở trên, Claude không được chạy `git worktree add`.
Claude không được suy luận quyền tạo linked worktree chỉ từ các từ
"worktree", "working tree", "write lock" hay "feature branch". Codex không
bao giờ cần linked review worktree riêng — kể cả khi Claude đang dùng một
linked worktree đã được cấp quyền, Codex vẫn chỉ review đúng branch/diff đó,
không cần checkout riêng cho mình.

### 5.4 Vòng đời branch chuẩn

```text
primary working tree ở develop sạch
→ fetch/prune
→ verify origin/develop và baseline
→ git switch -c feature branch
→ implement/test/commit/push/Draft PR
→ Claude dừng ghi
→ Owner invoke Codex review từ đúng primary checkout/feature branch đó
→ Owner Ready/merge
→ primary checkout quay lại develop
→ fast-forward update
→ Owner xóa local/remote feature branch
```

Vòng đời này không yêu cầu tạo sibling folder repository nào.

### 5.5 Bất biến vai trò không đổi

Single-primary-checkout không cấp quyền ghi cho Codex, subagent hay parallel
implementation. `Claude writes. Codex reviews. OC decides. Owner merges.`
vẫn là phân công cố định (§2, §3) — không đổi bởi mô hình working-tree này.

## 6. Checkpoint và review handoff

Trước khi chuyển từ implementation sang Codex review, Claude phải:

1. hoàn tất acceptance của phase/work item hoặc nêu rõ blocker;
2. chạy các check được giao;
3. để worktree ở trạng thái hiểu được và liệt kê mọi file chưa commit;
4. tạo commit/checkpoint nếu prompt yêu cầu;
5. chuẩn bị provisional completion report với branch, baseline, HEAD, diff scope, checks và rủi ro;
6. dừng mọi thao tác ghi;
7. công bố `READY_FOR_CODEX_REVIEW` kèm đúng review command Owner cần chạy; Claude không tự gọi command đó.

Chỉ Owner được gọi review command này. Codex chỉ trả findings hoặc xác nhận không có finding trong phạm vi đã review. Sau khi Owner chuyển kết quả về, Claude đưa nguyên trạng kết quả review vào completion report và dừng. Codex không nhận write lock ở bất kỳ thời điểm nào.

## 7. Review và quyền merge

Luồng mặc định sau execution:

1. Claude hoàn tất implementation/correction và mandatory checks.
2. Claude dừng mọi thao tác ghi tại một checkpoint ổn định, công bố `READY_FOR_CODEX_REVIEW` và in đúng command Owner cần chạy (mặc định `/codex:review --base origin/develop`, trừ khi Master Execution Prompt chỉ định review base khác).
3. Owner gọi `/codex:review` (hoặc command được chỉ định). Đây là invocation duy nhất cho lượt review này; Claude không tự chạy command này.
4. Codex thực hiện native read-only review trên đúng diff/target được yêu cầu và trả findings; không được sửa code.
5. Owner chuyển kết quả Codex về cho Claude; Claude chèn nguyên trạng review result, review base và trạng thái `RUN`/`NOT RUN` vào completion report rồi gửi Owner và dừng.
6. Owner chuyển report cho OC.
7. OC kiểm tra Codex findings cùng report, diff, test và PR nếu có.
8. Nếu cần correction, OC phát correction prompt cho Claude; sau correction, Claude lặp lại bước 1–6 cho đúng phần thay đổi.
9. Khi pass, OC trả recommendation cho Owner.
10. Owner quyết định Ready/merge/delete branch và có mở task tiếp theo hay không.

Codex review là mandatory gate mặc định. Chỉ Owner được invoke `/codex:review`; Claude không tự gọi command này. Nếu Owner không thể invoke được review (command không khả dụng, treo hoặc không tạo được kết quả đáng tin cậy), Claude ghi `CODEX_REVIEW: NOT RUN` kèm evidence khi được Owner thông báo, và trả `BLOCKED`; không tự thay bằng rescue, transfer hay self-review.

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
- Review mặc định dùng `/codex:review --base origin/develop`, do Owner invoke sau khi Claude công bố `READY_FOR_CODEX_REVIEW`. `/codex:adversarial-review` chỉ được dùng khi OC yêu cầu rõ cho work item rủi ro cao, và vẫn do Owner invoke.
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