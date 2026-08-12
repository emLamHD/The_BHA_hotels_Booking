# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-08-12
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Lần cập nhật này đồng bộ Snapshot với trạng thái thực tế sau khi PR #28 (`FE-002.1`) đã merge. Repository SHA và PR state bên dưới là baseline đã được xác minh cho lần cập nhật tài liệu này (`3f68bd79eff7f6c553e5516431abd09a93298f71`), không phải cam kết rằng SHA này sẽ còn là `develop` HEAD sau các commit tài liệu hoặc merge tiếp theo; revalidate lại `origin/develop` trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `3f68bd79eff7f6c553e5516431abd09a93298f71` |
| PR gần nhất | `#28` — merged 2026-08-12T13:39:21Z (`FE-002.1` — Hold Confirmation UI) |
| Merge commit | `3f68bd79eff7f6c553e5516431abd09a93298f71` |
| Published feature commit | `2ccf19b5dba9ac2f71c617420b53a7ddbf7502dd` (`feat(frontend): add booking hold confirmation flow`) |
| Feature branch của PR #28 | local đã xóa; remote đã xóa (Owner-confirmed) |
| PR gần nhất trước đó | `#27` — merged 2026-08-12T09:57:28Z (`AI-OPS-PILOT-001`), merge commit `bb64f7e1592f4924049935ecc08922539c532bf8` |
| Feature branch của PR #25 | local đã xóa; **remote vẫn còn tồn tại** theo `git ls-remote --heads origin docs/ai-ops-gov-002-review-contract-alignment` ngày 2026-08-12 — xóa remote branch là Owner-only action, chưa thực hiện |
| Open execution PR | không có PR nào đang mở theo `gh pr list --state open` ngày 2026-08-12, ngoại trừ PR tài liệu sync đang publish (Draft) |

## 2. Work item state

### Hoàn tất

- `FE-001`: closed trước baseline hiện tại.
- `DATA-001.1`: đạt technical gate, PR #22 đã merge.
- `AI-OPS-GOV-002`: `PASS` — root adapters căn chỉnh với `RULES.md`/`WORKFLOW.md`; lượt Codex review cuối cùng trên branch diff thật (PR #25) không có actionable finding.
- `AI-OPS-PILOT-001`: `PASS` — PR #27 (`test(frontend): cover booking contact upper bounds`), merge commit `bb64f7e1592f4924049935ecc08922539c532bf8`, merged 2026-08-12T09:57:28Z. Thay đổi: đúng hai upper-bound acceptance test cho `validateContact` trong `bookingHoldAttempt.test.ts` (file duy nhất thay đổi), không đổi production behavior. Verification: targeted `25/25`, full frontend `224/224` trên 18 file test, lint/TypeScript/production build PASS, `git diff --check` PASS. `diagnosing-bugs` không được invoke (không có unclear test/CI failure); recorded provenance SHA-256 của `SKILL.md` đã cài: `2529bfd4055807465b6b46aa8cf2259270ba11b2fa53e9138780d324509748c6`. GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`. Owner-invoked Codex review trên diff thật (`origin/develop`) không có actionable finding. Workflow `Claude writes. Codex reviews. OC decides. Owner merges.` đã được chứng minh đủ trên một diff thật để Owner và Control Tower authorize `FE-002.1`.
- `FE-002.1` — Hold Confirmation UI: `PASS — CLOSED`. PR #28, published commit `2ccf19b5dba9ac2f71c617420b53a7ddbf7502dd`, merge commit `3f68bd79eff7f6c553e5516431abd09a93298f71`, merged 2026-08-12T13:39:21Z. Xem §3 để biết evidence đầy đủ. Không có unresolved review finding. Không mở lại implementation từ Snapshot này.

### Quyết định đang hiệu lực

`FE-002.1_CLOSED_NO_NEXT_WORK_ITEM_ASSIGNED`

Ý nghĩa:

- `FE-002.1` đã đóng theo evidence tại §3; đây là trạng thái cuối cùng, không phải checkpoint tạm thời.
- Không có product work item kế tiếp nào được authorize từ việc đóng `FE-002.1` hoặc từ tài liệu sync này. Recommendation roadmap (nếu có) không phải là authorization.
- `DATA-001.2` tiếp tục deferred/dormant; không tự động kích hoạt lại.
- Control Tower và Owner sẽ chọn work item kế tiếp trong một quyết định riêng, ngoài phạm vi tài liệu sync này.

### Tạm hoãn

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi feature work khác: chưa được mở; không có work item sản phẩm nào đang active tại thời điểm cập nhật Snapshot này.

## 3. Verification evidence — FE-002.1 (accepted)

Delivery:

- Reservation confirmation API contract (`ReservationDto`, `ReservationNightDto`, `ReservationStatus`, `confirmBookingHold`).
- Xác nhận confirmation dùng đúng Hold ID và guest token đã retain của session hiện tại; đường tokenless cho session đã authenticate.
- Xử lý known-error và ambiguous-result (uncertain), exact confirmation retry.
- Bảo vệ same-tick duplicate và stale-completion (tái dùng pattern `inFlight`/`operationId` đã có).
- UI accessible cho toàn bộ lifecycle confirmation, gồm render trực tiếp Reservation result.
- Bảo toàn cả hai outcome `"confirmed"` và `"replayed"`.
- Đồng bộ Availability UI lock với predicate authoritative `isAvailabilitySearchLocked()`.

Loại trừ tường minh: Reservation GET, payment, booking cancellation, persistent credential storage, backend behavior change — không cái nào nằm trong PR #28.

Verification:

- Full frontend suite: `298/298` passing trên 18 file test.
- Lint: PASS, zero error/warning.
- TypeScript (`tsc --noEmit`): PASS.
- Production build: PASS, 33 routes generated. Ba warning "deopted into client-side rendering" (`/listing-experiences-detail`, `/listing-car-detail`, `/listing-stay-detail`) là baseline có sẵn từ trước, không phải do `FE-002.1`.
- `git diff --check`: PASS.
- Desktop live journey (browser thật, backend + Postgres local thật): PASS.
- Keyboard-only Tab → Enter activation (verified qua `document.activeElement`, không dùng chuột): PASS.
- Rapid duplicate activation (Enter thứ hai ngay lập tức khi đang pending): đúng một confirmation `POST`.
- Owner mobile verification tại `390 × 844`: PASS — không overflow, không lộ guest token.
- Backend CI (PR #28): `success`.
- Frontend CI (PR #28): `success`.
- Owner-invoked final Codex review trên PR #28: không có actionable correctness defect.

Published scope: một commit duy nhất, 11 file frontend, `1611 insertions(+), 73 deletions(-)`. Không có thay đổi Provider, backend, API, schema, migration, dependency, lockfile, documentation hay configuration trong PR #28.

Backend test baseline trước đó (không có thay đổi backend trong `AI-OPS-PILOT-001` hoặc `FE-002.1`): `494/494` passing — số này chưa được re-run/re-count trong lần cập nhật này; Backend CI trên PR #28 xác nhận `success` nhưng không cung cấp lại total test count mới.

Nếu số test thay đổi trong task sau, completion report phải giải thích nguyên nhân và Snapshot chỉ cập nhật sau khi Owner chấp nhận kết quả.

## 4. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold → Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn từ trước (`BE-003.4`), không đổi backend.
- GitNexus đang cung cấp code graph và impact analysis cho Claude/Codex/Cursor khi khả dụng; hiện tại `UNAVAILABLE`, được chấp nhận là non-blocking tooling gap (xem §6), không thay source/test/project sources of truth.
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

- Operating invariant: `Claude writes. Codex reviews. OC decides. Owner merges.` — đã chứng minh hoạt động trên diff thật qua `AI-OPS-PILOT-001` (PR #27) và tiếp tục vận hành review-only qua `FE-002.1` (PR #28).
- Một work item dùng một feature branch và một writable worktree; chỉ Claude có write lock.
- Sau implementation/correction và mandatory checks, Claude dừng ghi tại checkpoint ổn định và công bố `READY_FOR_CODEX_REVIEW` kèm đúng command; chỉ Owner mới invoke một lượt `/codex:review --base origin/develop`.
- Codex đọc cùng Git state/diff trong sandbox read-only; không có worktree hoặc phase implementation riêng.
- Codex findings được Owner chuyển về, Claude đưa vào completion report; OC mới kết luận pass/correction/blocker.
- Không dùng rescue, transfer, Codex write mode, automatic review gate, parallel agent hoặc nested implementation orchestration.
- Mỗi Master Execution Prompt cho Claude kết thúc bằng câu: "Codex sẽ xem lại kết quả đầu ra của bạn sau khi bạn hoàn thành."

## 6. Tooling migration state

Quyết định hiện tại:

- Orca path đã dừng ngày 2026-08-07 do orchestration phức tạp, tốn quota và không phù hợp nhu cầu CLI-first.
- Chọn `openai/codex-plugin-cc` làm cầu review; review-only đã vận hành xuyên suốt `AI-OPS-PILOT-001` và `FE-002.1`.
- Governance alignment (root `AGENTS.md`/`CLAUDE.md` với `RULES.md`/`WORKFLOW.md`, qua `AI-OPS-GOV-002` và hai correction round): `PASS`.
- Plugin install, auth và review-only round-trip: `PASS`.
- Real branch-diff review qua PR #25: `PASS`.
- Pilot work item trên diff thật (`AI-OPS-PILOT-001`, PR #27): `PASS` — không có actionable Codex finding.
- Product work item đầu tiên qua workflow này (`FE-002.1`, PR #28): `PASS — CLOSED` — không có actionable Codex finding.
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`. Không có GitNexus CLI, binary hay MCP server trong môi trường hiện tại; đã được OC/Owner chấp nhận là gap không blocking, không cần cài đặt/investigate lại cho mỗi task.
- `diagnosing-bugs` (`mattpocock/skills`) đã cài global trên máy phát triển; recorded provenance SHA-256 của `SKILL.md` đã cài: `2529bfd4055807465b6b46aa8cf2259270ba11b2fa53e9138780d324509748c6`. Skill được phê duyệt theo điều kiện, không phải mandatory step cho mọi task.
- Khi dùng skill, mọi command/output/artifact chia sẻ phải redact secret, token, cookie, dữ liệu cá nhân và auth header.

### AI-OPS-DRYRUN-001 (đóng 2026-08-09)

- Plugin install, auth, round-trip và read-only behavior: `PASS`.
- Lượt thử đầu tiên: `BLOCKED` — root `AGENTS.md`/`CLAUDE.md` khi đó vẫn ở mô hình peer-executor cũ, và `develop` không có diff khả dụng để review.
- Real branch-diff review còn thiếu đã được hoàn tất qua PR #25 (`AI-OPS-GOV-002`).
- Trạng thái đóng được chấp nhận: `PASS`.

**Tooling migration đã hoàn tất.** Toàn bộ gate trước đó đã đóng:

1. Governance alignment và real branch-diff review qua PR #25: `PASS`.
2. GitNexus: xác nhận `UNAVAILABLE`, chấp nhận là non-blocking gap (không còn là gate mở).
3. `diagnosing-bugs` provenance SHA-256: đã ghi (xem trên).
4. Pilot đầu tiên (`AI-OPS-PILOT-001`): `PASS` qua PR #27.
5. OC review bằng chứng pilot; Owner đã chấp nhận kết quả và authorize `FE-002.1`, sau đó `FE-002.1` đã hoàn tất qua PR #28.

Không còn work item nào bị khóa bởi tooling migration.

## 7. Current objective

Không có current objective sản phẩm nào đang active tại thời điểm cập nhật Snapshot này ngoài chính tài liệu sync này (`DOCS-2026-08-12-FE-002.1-CLOSURE`). Control Tower và Owner sẽ chọn work item kế tiếp trong một quyết định riêng.

Không tự động mở `DATA-001.2` hoặc bất kỳ product work item nào khác từ Snapshot này.

## 8. Execution order hiện tại

1. Owner review và (nếu chấp nhận) merge PR tài liệu sync này.
2. Control Tower đọc Snapshot đã đồng bộ và chọn/authorize work item kế tiếp trong một lệnh cấp cao riêng.
3. OC chuẩn bị Master Execution Prompt cho work item đó khi được chọn.
4. Không có execution order sản phẩm nào được authorize trước bước 2.

## 9. Main risks

- Codex được cấp nhầm write mode hoặc dùng rescue/transfer, phá invariant Claude-only write.
- Claude mutate worktree trong lúc Codex đang review, làm findings dựa trên diff không ổn định.
- Automatic review gate tạo vòng lặp dài và đốt quota.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.
- `diagnosing-bugs` bị gọi cho mọi task, gây context/quota overhead và tạo repro giả có ít giá trị.
- Diagnostic output/artifact làm lộ secret, cookie, token, auth header hoặc dữ liệu cá nhân.
- Import cả skill bundle gây prompt conflict hoặc side effect không kiểm soát.
- Tài liệu root và docs/governance drift nhau.
- Quyền template assets bị hiểu nhầm là đã được cấp phép production.
- Coi tài liệu sync (ví dụ tài liệu này) là implementation evidence thay vì một work item riêng.
- Tin rằng remote branch của PR #25 đã xóa trong khi ref vẫn còn tồn tại.
- Coi recommendation roadmap của OC là authorization cho work item kế tiếp.

## 10. First action

Control Tower đọc Snapshot đã đồng bộ này cùng plan ngày hiện tại, sau đó tự chọn hoặc hoãn work item kế tiếp trong một lệnh cấp cao riêng biệt với tài liệu sync này.
