# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-07-31  
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `a75d27bb3c6b47a9832f022616d94cefbe001d12` |
| PR gần nhất | `#22` — merged |
| Merge commit | `a75d27bb3c6b47a9832f022616d94cefbe001d12` |
| Feature branch của PR #22 | đã xóa local và remote theo xác nhận của Owner |
| Open execution PR | không có theo trạng thái bàn giao hiện tại |

PR #22 chỉ thêm một design document: `1 file`, `1737 additions`, `0 deletions`; CI hoàn tất với kết quả `success`.

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
- Claude Code/Codex: executor theo phase được OC gán.

### Agent execution

- Hai agent nhận cùng Master Execution Prompt khi dùng dual-agent.
- OC phân công trước; agent không tự chia việc.
- Mỗi thời điểm chỉ một Active Executor có quyền ghi vào một worktree.
- Các phase tuần tự dùng chung branch/worktree và chuyển giao bằng Git checkpoint + phase report.
- Không chạy parallel agent, nested agent hoặc agent-to-agent orchestration.
- Task nhỏ mặc định ưu tiên `SINGLE_AGENT` để tiết kiệm quota và handoff cost.

## 6. Tooling migration state

Mục tiêu hiện tại là chuẩn bị sử dụng có kiểm soát:

- Orca: cockpit/worktree manager, không phải authority hoặc autonomous orchestrator.
- `mattpocock/skills`: chỉ chọn/adapt skill phù hợp; không nhập toàn bộ bundle.
- Ưu tiên ban đầu: `diagnosing-bugs`; các skill còn lại chỉ lấy nguyên tắc sau review.

Chưa coi tooling migration là hoàn tất cho đến khi đủ các gate:

1. Owner áp dụng và xác nhận bộ Markdown mới.
2. Cài Orca ngoài product source nếu khả thi.
3. Config one-worktree/one-active-agent và kiểm tra privacy/telemetry.
4. Xác nhận GitNexus vẫn hoạt động ở cả hai agent.
5. Cài/adapt skill tối thiểu đã chọn.
6. Chạy dry run không đổi product behavior.
7. Chạy pilot đầu tiên và review kết quả.

## 7. Current objective

Hoàn tất migration tài liệu quản trị trước, sau đó mới `install → config → dry run/pilot`.

Không code `FE-002.1` hoặc `DATA-001.2` trong giai đoạn cập nhật tài liệu và cài đặt công cụ.

## 8. Execution order hiện tại

1. Chuẩn hóa `RULES.md`, `WORKFLOW.md`, `PROJECT_BIBLE.md`, `SNAPSHOT.md`, plan/worklog, root `AGENTS.md` và `CLAUDE.md`.
2. Owner áp dụng các file vào đúng vị trí trong repo và xác nhận.
3. Thực hiện installation/configuration theo plan ngày 2026-08-01.
4. Chạy task dry-run `AI-OPS-PILOT-001`.
5. OC review bằng chứng pilot; Owner quyết định pass/fail.
6. Chỉ sau khi pilot pass, Control Tower mới phát lệnh cấp cao để OC lập workflow cho `FE-002.1`.

## 9. Main risks

- Hai agent cùng ghi worktree do không có active-agent lock rõ ràng.
- OC prompt thiếu phase ownership khiến agent tự chia việc.
- Orca được bật parallel/auto-routing ngoài ý định.
- Import cả skill bundle gây prompt conflict hoặc side effect không kiểm soát.
- Tài liệu root và docs/governance drift nhau.
- FE-002.1 bị bắt đầu sớm trước khi pilot workflow pass.
- Quyền template assets bị hiểu nhầm là đã được cấp phép production.

## 10. First action

Owner áp dụng bộ Markdown đã review vào repo, kiểm tra link/path và xác nhận lại trạng thái clean trước khi bắt đầu cài đặt.
