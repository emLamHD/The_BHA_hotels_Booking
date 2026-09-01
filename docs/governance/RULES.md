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
- viết một `Master Execution Prompt` dùng chung cho work item, chọn đúng một role pair hợp lệ (`IMPLEMENTER`/`REVIEWER` — §2.4) cho toàn bộ work item trước khi execution bắt đầu;
- nhận report do Owner chuyển lại, review code/PR trong chính phiên chat OC khi có PR;
- yêu cầu correction, kết luận pass/fail và đề xuất hành động tiếp theo cho Owner.

`ACTIVE_EXECUTOR` đã chọn giữ vai trò implementer cho mọi phase và mọi correction của work item đó; phân rã phase không bao giờ đổi role pair. Đổi implementer đòi hỏi work item hiện tại dừng lại và một work item mới được authorize riêng (§3.1).

OC không được merge, không tự chuyển PR sang Ready và không tự mở khóa task kế tiếp.

### 2.4 Claude Code và Codex — implementer/reviewer được chọn theo prompt

Mỗi Master Execution Prompt chọn đúng một trong hai role pair hợp lệ sau; không có role pair thứ ba, không có giá trị lai (ví dụ `CLAUDE/CODEX`) được coi là active:

| `IMPLEMENTER` (`ACTIVE_EXECUTOR`) | `REVIEWER` (độc lập, read-only) |
| --- | --- |
| `CLAUDE` | `CODEX_READ_ONLY` |
| `CODEX` | `CLAUDE_READ_ONLY` |

`ACTIVE_EXECUTOR` là agent được `IMPLEMENTER` của Master Execution Prompt chỉ định — coding agent duy nhất được quyền ghi trong checkout đang dùng của work item đó. `ACTIVE_EXECUTOR` chịu trách nhiệm implementation, correction, test, checkpoint, commit/push/Draft PR khi Master Execution Prompt cho phép, và completion report.

Agent được chọn làm `REVIEWER` cho work item đó là reviewer độc lập, read-only. Reviewer chỉ được đọc source, Git state, diff, test evidence và tài liệu liên quan để trả findings. Reviewer không được sửa file, chạy formatter có ghi file, tạo commit, push, mở hoặc sửa PR, merge, xóa branch hay tiếp quản implementation — bất kể reviewer đó là Codex hay Claude.

- Khi `REVIEWER: CODEX_READ_ONLY`: Owner gọi Codex qua review command đã duyệt (`/codex:review`), review chạy trong sandbox read-only sẵn có của Codex.
- Khi `REVIEWER: CLAUDE_READ_ONLY`: Owner mở một phiên Claude riêng, tách biệt khỏi phiên implementer, chỉ chứa repository, base SHA, final HEAD SHA tường minh và review contract read-only. Nếu không thiết lập được chế độ read-only đáng tin cậy cho phiên đó, review là `NOT RUN` và work item `BLOCKED` — không coi phiên implementer tự nhận xét lại chính nó là review độc lập.
- Implementer không bao giờ là reviewer độc lập của chính work item mình đang/vừa thực thi, bất kể agent nào giữ vai trò nào.

Reviewer findings là bằng chứng review, không phải verdict quản trị. OC giữ quyền kết luận `PASS`, `CORRECTION_REQUIRED` hoặc `BLOCKED`; Owner giữ độc quyền Ready/merge/delete branch và mở task tiếp theo.

## 3. Invariant một writable implementer

Tại mọi thời điểm chỉ `ACTIVE_EXECUTOR` — implementer do Master Execution Prompt của work item đó chọn — được phép có quyền ghi vào checkout đang dùng của work item.

### 3.1 Role pair bị khóa suốt vòng đời work item

- Role pair (`IMPLEMENTER`/`REVIEWER`) được chọn khi Master Execution Prompt của work item kích hoạt là bất biến cho đến khi work item đó đóng, kể cả qua mọi correction cycle.
- Một correction luôn quay lại đúng `ACTIVE_EXECUTOR` ban đầu của work item. Correction prompt của OC có thể thu hẹp/làm rõ phạm vi correction nhưng không được đổi implementer.
- Cấm rescue, transfer và mọi hình thức đổi vai Claude↔Codex giữa chừng một work item.
- Nếu implementer ban đầu không thể tiếp tục, work item hiện tại dừng ở `BLOCKED`. Đổi implementer đòi hỏi một work item mới với Master Execution Prompt riêng, được authorize riêng — không tự thiết kế cơ chế transfer trong runtime.
- Một quyết định thay đổi chính policy này (ví dụ chính work item đang sửa `RULES.md`) không bao giờ tự động hồi tố để đổi role pair của chính work item đang thực thi thay đổi đó; role pair bootstrap của work item đó do Master Execution Prompt của nó ấn định và giữ nguyên cho đến khi work item đóng.

### 3.2 Một writer

Chỉ `ACTIVE_EXECUTOR` được ghi vào checkout đang dùng của work item.

- Không tạo worktree thứ hai cho reviewer để cùng giải một work item.
- Reviewer review cùng Git state/diff mà `ACTIVE_EXECUTOR` vừa hoàn tất, nhưng chỉ trong sandbox/phiên read-only.
- Trước khi Owner gọi reviewer, `ACTIVE_EXECUTOR` phải dừng mọi thao tác ghi và giữ working tree ở một checkpoint ổn định trong suốt lượt review.
- Chỉ Owner được phép gọi reviewer, và chỉ qua cơ chế đã duyệt cho role pair đó (`/codex:review` khi reviewer là Codex; phiên Claude read-only riêng khi reviewer là `CLAUDE_READ_ONLY`). `ACTIVE_EXECUTOR` không tự thực thi việc gọi reviewer; không dùng reviewer để rescue, transfer, implement, sửa findings hoặc tự phân chia task.
- Không bật automatic review gate hoặc vòng lặp implementer–reviewer tự động. Mỗi lượt review phải là một invocation hữu hạn, có chủ đích và được ghi trong report.
- Không tạo nested-agent/fan-out ngoài review invocation đã duyệt; không có parallel implementation.
- Control Tower hoặc OC có thể tư vấn/review nhưng không được sửa worktree do `ACTIVE_EXECUTOR` nắm giữ.

### 3.3 Self-review khác independent review

`ACTIVE_EXECUTOR` vẫn phải tự thực hiện và báo cáo self-review, source verification và các check bắt buộc trước handoff — đây là kiểm soát chất lượng bình thường của implementation, không bị cấm.

Tuy nhiên, self-review của `ACTIVE_EXECUTOR` không bao giờ thay thế được independent review bắt buộc: `ACTIVE_EXECUTOR` không thể là reviewer độc lập của chính công việc mình vừa làm, bất kể agent nào giữ vai trò implementer.

### 3.4 Review target ổn định

Trước khi independent review bắt đầu:

1. `ACTIVE_EXECUTOR` hoàn tất self-review và các check bắt buộc.
2. `ACTIVE_EXECUTOR` ghi lại `REVIEW_BASE` (tên symbolic, ví dụ `origin/develop`), `REVIEW_BASE_SHA` đã resolve từ tên đó, và `FINAL_HEAD` chính xác tại thời điểm handoff — cả ba đều xuất hiện trong `READY_FOR_<REVIEWER>_REVIEW`.
3. `ACTIVE_EXECUTOR` dừng mọi thao tác ghi vào checkout.
4. Owner khởi động reviewer trong một phiên review tách biệt.
5. Ngay trước khi review chạy, `REVIEW_BASE` symbolic phải resolve lại đúng `REVIEW_BASE_SHA` đã công bố (`git rev-parse <REVIEW_BASE> == REVIEW_BASE_SHA`); reviewer phải tự xác nhận cùng SHA đã resolve đó trước khi coi diff là hợp lệ.
6. Reviewer chỉ xem đúng diff `REVIEW_BASE_SHA...FINAL_HEAD` đã công bố.

Bất kỳ commit mới hay working-tree mutation nào sau handoff làm vô hiệu kết quả review trước đó. Nếu `REVIEW_BASE` symbolic đã di chuyển khỏi `REVIEW_BASE_SHA` đã công bố (ví dụ `origin/develop` có commit mới), review phải dừng ở `BLOCKED` — không tự động review theo base mới, không rebase branch, không tự suy ra SHA thay thế. Dùng một `REVIEW_BASE_SHA` mới đòi hỏi một quyết định OC/Owner mới và một checkpoint được authorize lại. Sau một correction được authorize, cần một independent review mới nhằm đúng `FINAL_HEAD` mới (và, nếu `REVIEW_BASE` đã di chuyển hợp lệ, một `REVIEW_BASE_SHA` mới được xác nhận).

### 3.5 Reviewer invocation

Hợp đồng governance dùng chung, không phân biệt provider:

```text
INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY
REVIEW_BASE:
REVIEW_BASE_SHA:
INDEPENDENT_REVIEW_METHOD:
REVIEW_TARGET: REVIEW_BASE_SHA...FINAL_HEAD_AT_HANDOFF
```

Hai nhánh provider-specific, không tạo thêm framework mới:

- `REVIEWER: CODEX_READ_ONLY` → Owner gọi đúng Codex review command mà Master Execution Prompt cung cấp (`CODEX_REVIEW_COMMAND`).
- `REVIEWER: CLAUDE_READ_ONLY` → Owner mở một phiên Claude riêng chứa repository, `REVIEW_BASE_SHA`, `FINAL_HEAD` tường minh và review contract read-only; nếu không thiết lập được read-only đáng tin cậy, review là `NOT RUN` và work item `BLOCKED`.

Reviewer không được sửa file, chạy formatter có ghi file, commit, push, mở/sửa PR, merge, xóa branch hay tự implement correction. `ACTIVE_EXECUTOR` không bao giờ tự gọi reviewer của chính mình. Review findings gửi Owner và OC; không tự động reactivate `ACTIVE_EXECUTOR`.

### 3.6 Sau review

Sau handoff, `ACTIVE_EXECUTOR` giữ nguyên trạng thái dừng ghi. Owner chuyển trực tiếp cho OC: (1) completion report sẵn có của `ACTIVE_EXECUTOR`, và (2) kết quả independent review verbatim. Không yêu cầu `ACTIVE_EXECUTOR` đang dừng ghi phải mutate repository hay completion report chỉ để chèn kết quả review.

Nếu OC yêu cầu correction: OC phát correction prompt cho đúng `ACTIVE_EXECUTOR` ban đầu (§3.1); Owner reactivate; `ACTIVE_EXECUTOR` sửa/test/tạo checkpoint mới; Owner gọi lại một lượt independent review mới nhằm `FINAL_HEAD` mới; OC re-evaluate; Owner độc quyền quyết định Ready/merge/cleanup.

`Một prompt-selected implementer ghi. Agent được ghép cặp review độc lập, read-only. OC quyết định. Owner merge.` Đây là bất biến quản trị cố định; role pair cụ thể của từng work item là lựa chọn tường minh trong Master Execution Prompt của work item đó, không phải suy diễn ngầm và không đổi giữa chừng work item.

## 4. Master Execution Prompt

Mỗi work item phải có đúng một Master Execution Prompt chứa tối thiểu các
trường **bắt buộc** sau:

- work item ID và objective;
- `IMPLEMENTER:` — đúng một giá trị cụ thể trong `CLAUDE | CODEX` (không phải danh sách, không phải `CLAUDE/CODEX` hay `CLAUDE | CODEX` dùng làm giá trị active);
- `REVIEWER:` — đúng reviewer ghép cặp hợp lệ với `IMPLEMENTER` đã chọn theo bảng ở §2.4 (`CODEX_READ_ONLY` khi implementer là `CLAUDE`; `CLAUDE_READ_ONLY` khi implementer là `CODEX`);
- `REPOSITORY` và `FEATURE_BRANCH` dự kiến;
- baseline SHA;
- phase/checkpoint order của `ACTIVE_EXECUTOR`;
- hợp đồng independent-review đầy đủ (§3.5): `INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY`, `INDEPENDENT_REVIEW_METHOD`, `REVIEW_BASE` (tường minh, mặc định `origin/develop`), `REVIEW_BASE_SHA`, `REVIEW_TARGET: REVIEW_BASE_SHA...FINAL_HEAD_AT_HANDOFF` — cộng `CODEX_REVIEW_COMMAND` và invocation limit khi `REVIEWER: CODEX_READ_ONLY`, hoặc contract phiên read-only riêng tường minh khi `REVIEWER: CLAUDE_READ_ONLY`;
- skill policy, gồm `diagnosing-bugs: REQUIRED | ALLOWED_IF_TRIGGERED | NOT_APPLICABLE`, chỉ áp dụng cho `ACTIVE_EXECUTOR` khi skill đó khả dụng với agent được chọn;
- files/scope được phép và bị cấm;
- acceptance criteria;
- test/check bắt buộc;
- checkpoint và stop conditions;
- format phase report/completion report;
- yêu cầu PR, nếu có.

`IMPLEMENTER: CLAUDE/CODEX`, `IMPLEMENTER: CLAUDE | CODEX` hay `REVIEWER: CLAUDE_READ_ONLY/CODEX_READ_ONLY` không phải giá trị hợp lệ để kích hoạt work item — các chuỗi này chỉ được xuất hiện trong tài liệu minh họa lựa chọn không hợp lệ, không phải giá trị active.

Mỗi Master Execution Prompt gửi cho `ACTIVE_EXECUTOR` phải kết thúc bằng một câu nhắc ngắn nêu đúng reviewer đã chọn của work item đó, ví dụ:

> Codex sẽ xem lại kết quả đầu ra của bạn sau khi bạn hoàn thành.

khi `REVIEWER: CODEX_READ_ONLY`, hoặc câu tương đương nêu tên reviewer khi `REVIEWER: CLAUDE_READ_ONLY`. Câu nhắc này không thay thế review contract ở các mục 2, 3 và 7, cũng không trao cho reviewer quyền ghi.

Master Execution Prompt là bắt buộc cho work item implementation của `ACTIVE_EXECUTOR`, nhưng không được lặp lại như executor-activation context bên trong native reviewer invocation. Native review (Codex hoặc phiên Claude read-only riêng) chỉ cần review command/contract tường minh, diff/target mục tiêu và review-mode rule ở mục 2 và 3; review không cần và không chờ `ACTIVE_EXECUTOR` của phiên implementer, `PHASE_ID` hay `EXECUTION_MODE`.

Nếu prompt thiếu `IMPLEMENTER`/`REVIEWER` hợp lệ, baseline, scope, acceptance, bất kỳ trường nào trong hợp đồng independent-review đầy đủ ở trên, hoặc skill policy có ảnh hưởng đến cách triển khai, `ACTIVE_EXECUTOR` phải trả `BLOCKED` ngay tại preflight — trước khi sửa bất kỳ file nào — thay vì tự đoán hoặc chỉ phát hiện thiếu sót sau khi đã implement.

## 5. Active execution checkout và branch lifecycle

Mỗi work item chỉ được có đúng một **active execution checkout** — repository
checkout được Master Execution Prompt chỉ định qua trường `REPOSITORY`
(trên máy hiện tại: `/home/admin1/The_BHA_hotels_Booking`; nói chung,
checkout chứa root `AGENTS.md` áp dụng cho phiên đó). Feature branch được
checkout và thực thi trực tiếp tại chính checkout đó.

- Một work item dùng một feature branch, checkout trực tiếp trong active
  execution checkout bằng `git switch -c <branch>`.
- Chỉ `ACTIVE_EXECUTOR` của work item đó được sửa file trong active execution
  checkout này.
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

`Một prompt-selected implementer ghi. Agent ghép cặp review độc lập, read-only. OC quyết định. Owner merge.` vẫn là bất biến cố định (§2, §3) — mô
hình một-checkout này không cấp quyền ghi cho reviewer (Codex hay Claude),
subagent hay parallel implementation, và không cấp quyền ghi cho agent nào
khác ngoài `ACTIVE_EXECUTOR` đã chọn của work item.

## 6. Checkpoint và review handoff

Trước khi chuyển từ implementation sang independent review, `ACTIVE_EXECUTOR` phải:

1. hoàn tất acceptance của phase/work item hoặc nêu rõ blocker;
2. chạy các check được giao;
3. để worktree ở trạng thái hiểu được và liệt kê mọi file chưa commit;
4. tạo commit/checkpoint nếu prompt yêu cầu;
5. chuẩn bị provisional completion report với branch, baseline, `REVIEW_BASE_SHA`, `FINAL_HEAD`, diff scope, checks và rủi ro;
6. dừng mọi thao tác ghi;
7. công bố `READY_FOR_<REVIEWER>_REVIEW` (`READY_FOR_CODEX_REVIEW` khi reviewer là Codex; tương đương khi reviewer là `CLAUDE_READ_ONLY`) kèm `REVIEW_BASE`, `REVIEW_BASE_SHA` đã resolve, `FINAL_HEAD`, và đúng review command/contract Owner cần chạy; `ACTIVE_EXECUTOR` không tự gọi command/mở phiên đó.

Chỉ Owner được gọi reviewer. Reviewer chỉ trả findings hoặc xác nhận không có finding trong phạm vi đã review. Owner sau đó chuyển trực tiếp cho OC completion report sẵn có của `ACTIVE_EXECUTOR` cùng kết quả review verbatim — hai tài liệu riêng biệt; `ACTIVE_EXECUTOR` vẫn ở trạng thái dừng ghi, không được gọi lại chỉ để chèn kết quả vào report (§3.6). Reviewer không nhận write lock ở bất kỳ thời điểm nào, bất kể reviewer là Codex hay Claude.

## 7. Review và quyền merge

Luồng mặc định sau execution:

1. `ACTIVE_EXECUTOR` hoàn tất implementation/correction và mandatory checks.
2. `ACTIVE_EXECUTOR` dừng mọi thao tác ghi tại một checkpoint ổn định, công bố `READY_FOR_<REVIEWER>_REVIEW` kèm `REVIEW_BASE`, `REVIEW_BASE_SHA` đã resolve và `FINAL_HEAD` tường minh, và in đúng command/contract Owner cần chạy (Codex: mặc định `/codex:review --base origin/develop`, trừ khi Master Execution Prompt chỉ định review base khác; Claude read-only: phiên review riêng — §3.5).
3. Owner gọi reviewer đã chỉ định (`/codex:review` hoặc command được chỉ định, hoặc mở phiên Claude read-only riêng), sau khi xác nhận `REVIEW_BASE` vẫn resolve đúng `REVIEW_BASE_SHA` đã công bố (§3.4). Đây là invocation duy nhất cho lượt review này; `ACTIVE_EXECUTOR` không tự gọi. Nếu base đã di chuyển, dừng ở `BLOCKED` thay vì review theo base mới.
4. Reviewer thực hiện review read-only trên đúng diff/target được yêu cầu và trả findings; không được sửa code.
5. Owner chuyển trực tiếp cho OC completion report sẵn có của `ACTIVE_EXECUTOR` cùng kết quả review verbatim và trạng thái `RUN`/`NOT RUN` — hai tài liệu riêng biệt; không yêu cầu `ACTIVE_EXECUTOR` (đang dừng ghi) mutate report chỉ để chèn kết quả (§3.6).
6. OC kiểm tra reviewer findings cùng report, diff, test và PR nếu có.
7. Nếu cần correction, OC phát correction prompt cho đúng `ACTIVE_EXECUTOR` ban đầu (§3.1); sau correction, `ACTIVE_EXECUTOR` lặp lại bước 1–5 cho đúng phần thay đổi, nhằm `FINAL_HEAD` mới.
8. Khi pass, OC trả recommendation cho Owner.
9. Owner quyết định Ready/merge/delete branch và có mở task tiếp theo hay không.

Independent review là mandatory gate mặc định, bất kể reviewer là Codex hay Claude. Chỉ Owner được invoke reviewer; `ACTIVE_EXECUTOR` không tự gọi. Nếu Owner không thể invoke được review (command/phiên không khả dụng, treo, base đã di chuyển khỏi `REVIEW_BASE_SHA` đã công bố, hoặc không tạo được kết quả đáng tin cậy — kể cả khi không thiết lập được read-only đáng tin cậy cho phiên Claude reviewer), Owner ghi nhận `REVIEW: NOT RUN` kèm evidence và chuyển trực tiếp cho OC cùng completion report sẵn có; work item ở trạng thái `BLOCKED` cho đến khi có correction prompt mới — không tự thay bằng rescue, transfer hay self-review, và không yêu cầu `ACTIVE_EXECUTOR` (đang dừng ghi) tự ghi trạng thái này vào report.

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

- `openai/codex-plugin-cc` là cầu review được dùng khi reviewer của work item là `CODEX_READ_ONLY`; đây vẫn là công cụ review, không phải công cụ implementation generic.
- Review mặc định dùng `/codex:review --base origin/develop` khi reviewer là Codex, do Owner invoke sau khi `ACTIVE_EXECUTOR` công bố `READY_FOR_CODEX_REVIEW`. `/codex:adversarial-review` chỉ được dùng khi OC yêu cầu rõ cho work item rủi ro cao, và vẫn do Owner invoke. Khi reviewer là `CLAUDE_READ_ONLY`, Owner dùng phiên Claude read-only riêng (§3.5) — không cần và không tạo plugin mới cho việc này.
- Cấm trong workflow mặc định: `/codex:rescue`, `/codex:transfer`, automatic review gate, và Codex write mode khi Codex giữ vai trò reviewer. Codex chỉ được ghi khi một Master Execution Prompt tuân thủ governance này tương lai chọn `IMPLEMENTER: CODEX` và cấp quyền file/Git action tường minh cho work item đó; work item hiện tại không mở khóa việc đó.
- Claude chỉ được ghi khi được chọn `IMPLEMENTER: CLAUDE`; Claude phải giữ read-only khi được chọn `REVIEWER: CLAUDE_READ_ONLY`.
- GitNexus là công cụ code graph và impact analysis hiện hành, dùng bởi `ACTIVE_EXECUTOR` khi có sẵn.
- Chỉ cài/adapt skill đã được review và phù hợp dự án; không mặc định nhập toàn bộ một skill repository.
- `diagnosing-bugs` của `mattpocock/skills` là skill có điều kiện dành cho `ACTIVE_EXECUTOR`, không phải bước bắt buộc của mọi task, và chỉ dùng được khi skill đó khả dụng với agent đang giữ vai trò implementer.
- Bắt buộc hoặc cho phép gọi `diagnosing-bugs` khi có một defect/performance regression cụ thể, lỗi flaky/intermittent, test/CI fail chưa rõ nguyên nhân, hoặc finding của reviewer mô tả behavior sai nhưng root cause chưa rõ.
- Không gọi `diagnosing-bugs` chỉ vì task có code, chỉ vì đến review gate, hoặc cho feature/docs/design/refactor không có symptom lỗi cụ thể. Lỗi cú pháp/format hiển nhiên có feedback loop trực tiếp không cần quy trình chẩn đoán nặng nếu OC không yêu cầu.
- Chỉ `ACTIVE_EXECUTOR` được thực thi `diagnosing-bugs`, khi skill đó khả dụng với agent đang giữ vai trò implementer đó. Reviewer có thể đề xuất nhưng không được tự chạy skill để sửa code.
- Khi dùng `diagnosing-bugs`, `ACTIVE_EXECUTOR` phải tạo feedback loop red/green có thể chạy lại, ghi lý do kích hoạt và regression evidence trong report, đồng thời redact secret, token, cookie, dữ liệu cá nhân và auth header khỏi mọi output/artifact chia sẻ.
- Graphify là công cụ workspace-local trên máy Claude (§12 `WORKFLOW.md`); sự khả dụng của nó trên workspace Claude không được mặc định suy ra là khả dụng cho Codex hay bất kỳ agent nào khác khi agent đó giữ vai trò implementer.
- Skill/prompt/tool không được thay đổi quyền hạn trong file này.
- Trong giai đoạn pilot, ưu tiên capability tối thiểu, có thể tắt và quan sát được.

## 12. Stop conditions bắt buộc

Executor phải dừng và báo `BLOCKED` khi:

- baseline SHA hoặc branch không khớp prompt;
- worktree có thay đổi không rõ chủ sở hữu;
- bất kỳ agent/process nào ngoài `ACTIVE_EXECUTOR` đang có hoặc yêu cầu quyền ghi;
- một correction hoặc bất kỳ yêu cầu nào đòi đổi implementer khỏi `ACTIVE_EXECUTOR` ban đầu của work item;
- reviewer review yêu cầu write access, rescue, transfer hoặc task implementation;
- mandatory independent review không chạy được hoặc không trả kết quả đáng tin cậy (kể cả khi không thiết lập được read-only đáng tin cậy cho phiên Claude reviewer);
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
- Khi workflow thay đổi, phải kiểm tra đồng thời `RULES.md`, `WORKFLOW.md`, root `AGENTS.md` và adapter provider hiện có (`CLAUDE.md`) để tránh drift.
- Root `AGENTS.md` và `CLAUDE.md` phải phản ánh đúng invariant §3.6: một prompt-selected implementer ghi, agent ghép cặp review độc lập read-only; câu nhắc ngắn ở mục 4 không được dùng thay cho các giới hạn quyền đầy đủ.
- Một work item không được tự diễn giải việc mình sửa các file governance này là hồi tố đổi role pair của chính work item đó (§3.1).