# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-09
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đồng bộ Snapshot với trạng thái thực tế sau khi PR #25 (`AI-OPS-GOV-002`) đã merge. Repository SHA và PR state bên dưới là baseline đã được xác minh cho lần cập nhật tài liệu này (`d1008e19ae47617e449493b10f2c613342f48c76`), không phải cam kết rằng SHA này sẽ còn là `develop` HEAD sau các commit tài liệu hoặc merge tiếp theo; revalidate lại `origin/develop` trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `d1008e19ae47617e449493b10f2c613342f48c76` |
| PR gần nhất | `#25` — merged 2026-08-09 (`AI-OPS-GOV-002`) |
| Merge commit | `d1008e19ae47617e449493b10f2c613342f48c76` |
| Feature branch của PR #25 | local đã xóa; **remote vẫn còn tồn tại** theo `git ls-remote --heads origin docs/ai-ops-gov-002-review-contract-alignment` ngày 2026-08-09 — xóa remote branch là Owner-only action, chưa thực hiện |
| Open execution PR | không có PR nào đang mở theo `gh pr list --state open` ngày 2026-08-09 |

PR #25 (`AI-OPS-GOV-002`, gồm hai correction round C1/C2 theo Codex P2 findings) căn chỉnh root `AGENTS.md`/`CLAUDE.md` với mô hình cố định `Claude writes. Codex reviews. OC decides. Owner merges.`; lượt Codex review cuối cùng (Owner-invoked) chạy trên branch diff thật và không trả actionable finding. PR #24 trước đó (baseline `8b9d9ff1d7eda2b835280d3d9cc4031445ebea7c`) đã ghi Claude là sole implementer, Codex là read-only reviewer; PR #23 hợp nhất kiến trúc quản trị `docs_1` vào `docs/`.

## 2. Work item state

### Hoàn tất

- `FE-001`: closed trước baseline hiện tại.
- `DATA-001.1`: đạt technical gate, PR #22 đã merge.
- `AI-OPS-GOV-002`: `PASS` — root adapters căn chỉnh với `RULES.md`/`WORKFLOW.md`; lượt Codex review cuối cùng trên branch diff thật (PR #25) không có actionable finding.

### Quyết định đang hiệu lực

`DEFER_DATA-001.2_AND_START_FE-002.1`

Ý nghĩa:

- không triển khai `DATA-001.2` ở thời điểm này;
- `FE-002.1` là product work item kế tiếp về mặt roadmap;
- `FE-002.1` chưa được mở execution; bộ Markdown governance mới đã áp dụng qua `AI-OPS-GOV-002` (`PASS`), nhưng `AI-OPS-PILOT-001` chưa chạy;
- chỉ Owner được mở khóa `FE-002.1` sau khi `AI-OPS-PILOT-001` pass.

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
- Governance alignment (root `AGENTS.md`/`CLAUDE.md` với `RULES.md`/`WORKFLOW.md`, qua `AI-OPS-GOV-002` và hai correction round): `PASS`.
- Plugin install, auth và review-only round-trip: `PASS`.
- Real branch-diff review qua PR #25: `PASS` — lượt Codex review cuối cùng chạy trên branch diff thật (`origin/develop`) và không trả actionable finding.
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.
- GitNexus tiếp tục là code graph/impact analysis hiện hành, không thay source/test; xác nhận GitNexus vẫn hoạt động trong Claude workflow vẫn là yêu cầu evidence cho pilot, trừ khi đã có bằng chứng repo hiện hành.
- Owner đã xác nhận `diagnosing-bugs` của `mattpocock/skills` được cài global trên máy phát triển Ubuntu.
- `diagnosing-bugs` được phê duyệt theo điều kiện, không phải mandatory step cho mọi task; exact installed version/hash hoặc source revision vẫn là yêu cầu evidence cho pilot đầu tiên, chưa được ghi.
- Khi dùng skill, mọi command/output/artifact chia sẻ phải redact secret, token, cookie, dữ liệu cá nhân và auth header.
- `AI-OPS-PILOT-001`: `NOT STARTED` — là task kế tiếp.

### AI-OPS-DRYRUN-001 (đóng 2026-08-09)

- Plugin install, auth, round-trip và read-only behavior: `PASS`.
- Lượt thử đầu tiên: `BLOCKED` — root `AGENTS.md`/`CLAUDE.md` khi đó vẫn ở mô hình peer-executor cũ (yêu cầu `ACTIVE_EXECUTOR`, `SINGLE_AGENT`/`SEQUENTIAL_DUAL_AGENT`), và `develop` không có diff khả dụng để review.
- Real branch-diff review còn thiếu đã được hoàn tất qua PR #25 (`AI-OPS-GOV-002`); lượt review cuối cùng không có actionable finding.
- Trạng thái đóng được chấp nhận: `PASS`.

**Tooling migration vẫn chưa hoàn tất.** Chưa coi tooling migration là hoàn tất cho đến khi đủ các gate còn lại:

1. Governance alignment và real branch-diff review qua PR #25: đã `PASS`.
2. Xác nhận GitNexus vẫn hoạt động trong Claude workflow — pending pilot evidence, trừ khi đã có bằng chứng repo hiện hành.
3. Ghi exact installed version/hash hoặc source revision của `diagnosing-bugs` — pending pilot evidence.
4. Chạy pilot đầu tiên (`AI-OPS-PILOT-001`, một work item riêng, bounded và không phải tài liệu sync này) với một work item nhỏ, giới hạn một review invocation mỗi completion/correction, Owner-invoked.
5. OC review bằng chứng pilot; Owner quyết định pass/fail trước khi mở `FE-002.1`.

`AI-OPS-PILOT-001` và `FE-002.1` vẫn bị khóa cho đến khi OC review bằng chứng pilot và Owner chấp nhận kết quả.

## 7. Current objective

Chuẩn bị, chạy và đóng `AI-OPS-PILOT-001` — một work item pilot riêng, bounded, không đổi product behavior, tách biệt khỏi mọi tài liệu sync. Chỉ sau khi pilot `PASS`, Control Tower mới ra lệnh cho OC scope-lock `FE-002.1`.

Không code `FE-002.1` hoặc `DATA-001.2` trước khi pilot pass.

## 8. Execution order hiện tại

1. Control Tower issues lệnh cấp cao cho `AI-OPS-PILOT-001`.
2. OC inspects current evidence và tạo Master Execution Prompt authoritative cho `AI-OPS-PILOT-001`.
3. Chạy `AI-OPS-PILOT-001` với Claude là sole writer, Codex là read-only reviewer, Owner là sole review-command invoker, OC là người quyết định `PASS`/`CORRECTION_REQUIRED`/`BLOCKED`.
4. Owner accepts hoặc rejects kết quả pilot.
5. Chỉ sau khi pilot `PASS`, Control Tower mới có thể ra lệnh cho OC scope-lock `FE-002.1`.
6. Candidate journey cần khảo sát, chưa phải scope đã duyệt: `Create Booking Hold → Confirm Hold → Reservation result`.
7. Chỉ sau khi scope lock và Owner authorization, Claude mới được implement `FE-002.1`.
8. Hoàn tất end-of-day worklog, Snapshot synchronization và daily plan tiếp theo dựa trên execution thực tế.

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
- Coi tài liệu sync (ví dụ `DOCS-2026-08-09-CT-PACKET`) là pilot evidence thay vì một work item riêng.
- Tin rằng remote branch của PR #25 đã xóa trong khi ref vẫn còn tồn tại.

## 10. First action

Control Tower issues lệnh cấp cao cho OC chuẩn bị Master Execution Prompt cho `AI-OPS-PILOT-001`.