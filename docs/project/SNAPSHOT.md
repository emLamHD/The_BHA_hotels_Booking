# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-09
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này thay đổi governance/tooling state. Repository SHA và PR state bên dưới đã được revalidate ngày 2026-08-09 theo baseline `AI-OPS-GOV-002` (`8b9d9ff1d7eda2b835280d3d9cc4031445ebea7c`); revalidate lại `origin/develop` trước khi tạo feature branch tiếp theo sau khi work item này merge.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `8b9d9ff1d7eda2b835280d3d9cc4031445ebea7c` |
| PR gần nhất | `#24` — merged 2026-08-09 |
| Merge commit | `8b9d9ff1d7eda2b835280d3d9cc4031445ebea7c` |
| Feature branch của PR #24 | trạng thái xóa local/remote chưa được Owner xác nhận trong phiên này |
| Open execution PR | `docs/ai-ops-gov-002-review-contract-alignment` — Draft PR mở trong work item này |

PR #24 sửa root `AGENTS.md`/`CLAUDE.md` để ghi Claude là sole implementer, Codex là read-only reviewer; CI hoàn tất với kết quả `success`. PR #23 trước đó hợp nhất kiến trúc quản trị `docs_1` vào `docs/`.

## 2. Work item state

### Hoàn tất

- `FE-001`: closed trước baseline hiện tại.
- `DATA-001.1`: đạt technical gate, PR #22 đã merge.

### Quyết định đang hiệu lực

`DEFER_DATA-001.2_AND_START_FE-002.1`

Ý nghĩa:

- không triển khai `DATA-001.2` ở thời điểm này;
- `FE-002.1` là product work item kế tiếp về mặt roadmap;
- `FE-002.1` chưa được mở execution trong lúc governance/tooling migration đang diễn ra;
- chỉ Owner được mở khóa `FE-002.1` sau khi bộ Markdown mới đã áp dụng và pilot workflow pass.

### Tạm hoãn

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi feature work khác ngoài `FE-002.1`: chưa được mở.

## 3. Test baseline

Baseline trước tooling migration:

- Frontend: `222/222` passing.
- Backend: `494/494` passing.
- PR #22 CI: `success`.
- PR #22 không thay đổi product code nên không tạo test baseline chức năng mới.

Nếu số test thay đổi trong task sau, completion report phải giải thích nguyên nhân và Snapshot chỉ cập nhật sau khi Owner chấp nhận kết quả.

## 4. Product/architecture state liên quan

- GitNexus đang cung cấp code graph và impact analysis cho Claude/Codex/Cursor.
- `PROJECT_BIBLE.md`, ADR, test baseline và source code vẫn là nguồn sự thật sản phẩm/kiến trúc.
- Template hotel assets hiện có trạng thái quyền sử dụng chưa được chứng minh đầy đủ; chỉ dùng development/reference, không được tự động promote sang production.

## 5. Operating model đang được áp dụng

### Quyền hạn

- Owner Hồ Đình Lâm: quyết định cuối, Ready/merge, branch cleanup và mở task tiếp theo.
- Control Tower: objective/execution order cấp cao và escalation.
- OC: phân rã work item/checkpoint, viết Master Execution Prompt, review report/diff/PR và recommendation.
- Claude Code: implementer duy nhất có quyền ghi code/worktree.
- Codex: reviewer read-only; không sửa code, commit, push, PR hoặc merge.

### Agent execution

- Operating invariant: `Claude writes. Codex reviews. OC decides. Owner merges.`
- Một work item dùng một feature branch và một writable worktree; chỉ Claude có write lock.
- Sau implementation/correction và mandatory checks, Claude dừng ghi tại checkpoint ổn định và công bố `READY_FOR_CODEX_REVIEW` kèm đúng command; chỉ Owner mới invoke một lượt `/codex:review --base origin/develop`.
- Codex đọc cùng Git state/diff trong sandbox read-only; không có worktree hoặc phase implementation riêng.
- Codex findings được Owner chuyển về, Claude đưa vào completion report; OC mới kết luận pass/correction/blocker.
- Không dùng rescue, transfer, Codex write mode, automatic review gate, parallel agent hoặc nested implementation orchestration.
- Mỗi Master Execution Prompt cho Claude kết thúc bằng câu: “Codex sẽ xem lại kết quả đầu ra của bạn sau khi bạn hoàn thành.”

## 6. Tooling migration state

Quyết định hiện tại:

- Orca path đã dừng ngày 2026-08-07 do orchestration phức tạp, tốn quota và không phù hợp nhu cầu CLI-first.
- Chọn `openai/codex-plugin-cc` làm cầu review; pilot chỉ dùng review read-only.
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.
- GitNexus tiếp tục là code graph/impact analysis, không thay source/test.
- Owner đã xác nhận `diagnosing-bugs` của `mattpocock/skills` được cài global trên máy phát triển Ubuntu.
- `diagnosing-bugs` được phê duyệt theo điều kiện, không phải mandatory step cho mọi task; exact installed version/hash cần được ghi khi chạy pilot đầu tiên.
- Khi dùng skill, mọi command/output/artifact chia sẻ phải redact secret, token, cookie, dữ liệu cá nhân và auth header.

### AI-OPS-DRYRUN-001 (2026-08-09)

- Plugin install, auth, round-trip và read-only behavior: `PASS`.
- Real branch-diff review: `NOT TESTED`.
- Kết quả tổng thể: `BLOCKED` — root `AGENTS.md`/`CLAUDE.md` khi đó vẫn ở mô hình peer-executor cũ (yêu cầu `ACTIVE_EXECUTOR`, `SINGLE_AGENT`/`SEQUENTIAL_DUAL_AGENT`), và `develop` không có diff khả dụng để review.
- Hành động khắc phục: work item `AI-OPS-GOV-002` căn chỉnh lại root adapters và Codex review contract (invariant cố định, Owner là người duy nhất invoke `/codex:review`).

**Tooling migration chưa hoàn tất.** Chưa coi tooling migration là hoàn tất cho đến khi đủ các gate:

1. Owner áp dụng và xác nhận bộ Markdown mới cùng root `AGENTS.md`/`CLAUDE.md` adapter — draft căn chỉnh hoàn tất trong `AI-OPS-GOV-002`, chờ Owner xác nhận.
2. Cài/config `openai/codex-plugin-cc` ở review-only mode với explicit base `origin/develop`.
3. Xác nhận GitNexus vẫn hoạt động trong Claude workflow.
4. Kiểm tra `diagnosing-bugs` đã cài, ghi version/hash hoặc source revision và xác nhận redaction guardrail.
5. Chạy real branch-diff Codex review (Owner-invoked) không đổi product behavior, thay thế dry run trước đó vốn không có diff để review.
6. Chạy pilot đầu tiên (`AI-OPS-PILOT-001`) với một work item nhỏ, giới hạn một review invocation mỗi completion/correction, Owner-invoked.
7. OC review bằng chứng pilot; Owner quyết định pass/fail trước khi mở `FE-002.1`.

`AI-OPS-PILOT-001` và `FE-002.1` vẫn bị khóa cho đến khi correction này được Owner xác nhận và một lượt real branch-diff review pass.

## 7. Current objective

Hoàn tất `AI-OPS-GOV-002` (căn chỉnh root adapters và Codex review contract cho mô hình Claude-write/Codex-review cố định, Owner-invoked), sau đó chạy một lượt real branch-diff Codex review, rồi mới tiếp tục `install/config → pilot`.

Không code `FE-002.1` hoặc `DATA-001.2` trong giai đoạn cập nhật tài liệu và cài đặt công cụ.

## 8. Execution order hiện tại

1. `AI-OPS-GOV-002`: căn chỉnh root `AGENTS.md`/`CLAUDE.md` với `RULES.md`/`WORKFLOW.md` — loại bỏ mô hình peer-executor cũ, cố định Claude writes/Codex reviews, Owner là người duy nhất invoke `/codex:review`.
2. Owner áp dụng các file vào đúng vị trí trong repo và xác nhận correction này.
3. Chạy một lượt real branch-diff Codex review (Owner-invoked, `/codex:review --wait --base origin/develop`) trên checkpoint ổn định của `AI-OPS-GOV-002`.
4. Cài/config `openai/codex-plugin-cc` review-only và xác minh `diagnosing-bugs` đã cài.
5. Chạy task pilot `AI-OPS-PILOT-001` với Claude là writer duy nhất và Codex là reviewer duy nhất, Owner-invoked.
6. OC review bằng chứng pilot; Owner quyết định pass/fail.
7. Chỉ sau khi pilot pass, Control Tower mới phát lệnh cấp cao để OC lập workflow cho `FE-002.1`.

## 9. Main risks

- Codex được cấp nhầm write mode hoặc dùng rescue/transfer, phá invariant Claude-only write.
- Claude mutate worktree trong lúc Codex đang review, làm findings dựa trên diff không ổn định.
- Automatic review gate tạo vòng lặp dài và đốt quota.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.
- `diagnosing-bugs` bị gọi cho mọi task, gây context/quota overhead và tạo repro giả có ít giá trị.
- Diagnostic output/artifact làm lộ secret, cookie, token, auth header hoặc dữ liệu cá nhân.
- Import cả skill bundle gây prompt conflict hoặc side effect không kiểm soát.
- Tài liệu root và docs/governance drift nhau.
- FE-002.1 bị bắt đầu sớm trước khi pilot workflow pass.
- Quyền template assets bị hiểu nhầm là đã được cấp phép production.

## 10. First action

Owner xác nhận Draft PR `AI-OPS-GOV-002` (căn chỉnh root `AGENTS.md`/`CLAUDE.md` với `RULES.md`/`WORKFLOW.md`/`SNAPSHOT.md`), sau đó invoke `/codex:review --wait --base origin/develop` để chạy real branch-diff review trước khi tiếp tục config plugin review-only.