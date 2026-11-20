# BHA-NEWSLETTER-BADGE-001 — completion report

- Work item `BHA-NEWSLETTER-BADGE-001` — badge đỏ “chưa xem” trên menu Admin, lưu theo từng Staff, bền qua thiết bị; chỉ cho Newsletter. Implementer `CLAUDE`, reviewer `CODEX_READ_ONLY` (Owner gọi).
- Branch `feature/bha-newsletter-badge-001-staff-unseen`, base `origin/develop`, **baseline = START_HEAD = `c7b921cc0eec5b8aae705056e1c40cd30da9c63c`** (PR #135 `BHA-NEWSLETTER-LIVE-001` đã merge). CI của baseline: run `44562455896` đang chạy lúc bắt đầu (không coi là pass), **kết thúc `success`** khi tôi kiểm lại. Một Draft PR vào `develop`.
- Commits: `c05f30b` (CP1: dữ liệu bền, migration 25, API), `95193e7` (CP2: session/live dùng chung, badge, ack từ màn Newsletter), `6b26f4e` (sửa: chỉ gate dùng quyền website mặc định mới dùng chung phiên), rồi các commit chỉ-tài-liệu. **Tested code SHA: `6b26f4e`** (mã ứng dụng; các commit sau chỉ là tài liệu). FINAL_HEAD và PR: xem báo cáo chat.
- Phạm vi giữ đúng prompt: Domain/Application/Infrastructure cho hoạt động Newsletter và cursor; **một migration mới**; API Admin đếm/đánh dấu; metadata snapshot của danh sách; Admin layout/sidebar/provider/API client/màn Newsletter; wiring StaffSession tối thiểu; test và tài liệu. **Không đổi** schema `StaffAccounts`, hệ quyền, OAuth, template email, Calendar/Booking, Customer API; không badge cho menu khác, không notification center, không digest, không backplane, không Redis.
- Đồ thị Graphify của repo cũ (23/08) nên không dùng; phân tích ảnh hưởng bằng đọc nguồn + test.

## Số đếm nghĩa là gì (định nghĩa chính xác)

Badge = **số lượt xác minh Newsletter có số thứ tự lớn hơn mốc đã xem của đúng Staff đó**, tính trên các lượt còn tồn tại. Không phải tổng subscriber đang Verified.

- Một **lượt xác minh** là một lần `ConfirmAsync` thực sự chuyển một dòng `PendingVerification → Verified` (cùng điều kiện đã quyết định Welcome: câu `UPDATE … WHERE Status = 'PendingVerification'` trả 1 hàng). Nhập email, Staff thêm tay, gửi lời mời, replay token, `already-verified`, token sai/hết hạn, ngừng nhận: **không** tạo lượt. Hủy → đăng ký lại → xác minh lại hợp lệ là một lượt mới.
- Chỉ bắt đầu ghi từ khi triển khai: không tạo lượt hồi tố cho subscriber cũ. Staff chưa có cursor đọc từ mốc 0 của stream mới, **không** tự đánh dấu khi đăng nhập.
- Xóa một subscription xóa luôn lượt của nó (FK `ON DELETE CASCADE`; bảng không giữ email/token): count chỉ đếm cái còn tồn tại, watermark không bao giờ lùi.
- “Đã xem” là đã xem **mục menu**, không phải từng dòng. Bộ lọc/phân trang không thu hẹp watermark.

## Schema (migration 25 `20261119162454_AddNewsletterUnseenBadge`)

| Bảng | Cột | Ý nghĩa |
|---|---|---|
| `MenuActivityStreams` | `MenuKey` (PK, 40), `LastSequence` bigint ≥ 0 | Bộ đếm của stream; migration seed `('newsletter', 0)`. Dòng này là **điểm tuần tự hóa duy nhất** của stream. |
| `NewsletterVerificationActivities` | `Sequence` bigint PK ≥ 1 (không identity), `SubscriptionId` FK cascade, `OccurredAtUtc` | Một lượt xác minh. **Không** email, token, dữ liệu Gmail (test đọc `information_schema`: đúng 3 cột). |
| `StaffMenuSeen` | PK (`StaffAccountId`, `MenuKey`), `LastSeenSequence` ≥ 0, `UpdatedAtUtc`; FK tới `StaffAccounts` (cascade) và `MenuActivityStreams` (restrict) | Cursor “đã xem” theo Staff + menu. |

`StaffAccounts` không đổi (chỉ có thêm FK trỏ tới nó từ bảng mới). `Down` có guard: từ chối khi còn lượt đã đếm, còn cursor, hoặc bộ đếm đã nhích; stream chưa đụng tới thì được rollback và áp lại. `ContentPackSpec` phân loại ba bảng mới là *excluded* (trạng thái vận hành của một môi trường, không phải nội dung).

## Watermark an toàn trước commit khác thứ tự

Số thứ tự **không** lấy từ identity/timestamp. `ConfirmAsync`, ở nhánh `moved == 1`, câu **cuối cùng trước commit**:

```sql
WITH next AS (UPDATE "MenuActivityStreams" SET "LastSequence" = "LastSequence" + 1 WHERE "MenuKey" = 'newsletter' RETURNING "LastSequence")
INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") SELECT "LastSequence", @id, @now FROM next
```

Dòng bộ đếm bị khóa đến COMMIT nên **số commit đúng theo thứ tự được cấp**: người đọc thấy N thì mọi số ≤ N đã commit (identity cho phép 7 commit trước 6). Rollback trả lại số. Thiếu dòng bộ đếm thì câu lệnh ném lỗi và giao dịch rollback (không có xác minh nào commit mà không được đếm).

**Thứ tự khóa**: subscription → request/mail (token, hủy mail, Welcome) → bộ đếm (cuối). Người đọc (GET đếm, danh sách) và ack **không bao giờ khóa subscription**; không giữ giao dịch qua lời gọi mạng. Xóa subscription lấy khóa subscription rồi cascade (không chạm bộ đếm).

**Snapshot nhất quán.** `ListAsync` (cả nhánh quá-trang-cuối) chạy trong **một giao dịch REPEATABLE READ**, câu đầu đọc `LastSequence`: dòng, `total` và `viewWatermark` cùng một snapshot, nên mọi lượt ≤ watermark có trong các dòng và không lượt nào sau nó bị coi là đã xem. `GET menu-unseen` là **một câu SQL** (bộ đếm LEFT JOIN cursor + `count(*)`): một snapshot. **Ack** là một câu `INSERT … SELECT … WHERE LastSequence >= W ON CONFLICT DO UPDATE SET LastSeenSequence = GREATEST(cũ, mới)`: nguyên tử, đơn điệu tăng, hai tab ack lần đầu cùng lúc không gây duplicate-key; W vượt mốc đã commit → 0 hàng → 400 (không bị “kẹp” thành tất cả).

## Hợp đồng Admin

- `GET /api/admin/v1/website/menu-unseen` → `{ "newsletter": { "count": 3, "lastSeenWatermark": "7", "currentWatermark": "10" } }`. Không đổi trạng thái đã xem; không ghi gì (kể cả Staff chưa có cursor).
- `POST /api/admin/v1/website/menu-unseen/newsletter/seen` body `{ "viewWatermark": "10" }` → trả đúng dạng trên sau khi áp cursor. Idempotent với cùng watermark.
- `GET danh sách Newsletter` thêm `viewWatermark: string` (chuỗi thập phân, opaque). Caller cũ tương thích (chỉ thêm trường).
- Staff ID lấy từ phiên (`ActorStaffId`), không nhận từ client (body có `staffAccountId` bị bỏ qua; test khẳng định cursor của chính người đăng nhập mới nhúc nhích). Quyền `WebsiteSettingsManage`, HTTPS, Origin + JSON như mọi route Admin; `LocalGate` → 404; `Cache-Control: no-store`. Quyền được xét **trước** khi đọc body.
- Watermark phải khớp `^(0|[1-9][0-9]*)$` và vừa `long`; số JSON, dấu, khoảng trắng, số 0 đứng đầu, `1e3`, tràn `long`, thiếu/`null`, và giá trị vượt mốc đã commit → **400** `menu-unseen-watermark-invalid`, không đổi gì. Menu key lạ → **404** `menu-unseen-unknown-menu`.

## Admin: một phiên, một nguồn, một socket

- `(admin)/layout` mount `AdminStaffScope` (chỉ chế độ `Staff`): một `StaffSessionProvider` + `NewsletterBadgeProvider` cho cả sidebar và trang.
- **Ảnh hưởng tới shared StaffSession (đã chọn, ghi rõ):** `StaffSessionProvider` thêm prop `reuse`; `WebsiteAccessGate` truyền `reuse={rule === WEBSITE_RULE}` nên **chỉ gate dùng quyền website mặc định** (Ngôn ngữ, Bản dịch, Tiền tệ, Menu, Banner, Social, Newsletter, sender) chia sẻ phiên của layout (một `me`, một generation, một sign-out). Gate có rule riêng — **Blog và Promotions** (vai trò theo Property, ADR 0009), cùng Calendar và Catalog — **không đổi**: vẫn phiên riêng (một test ghim cả hai nhánh; lúc đầu tôi suýt để Blog/Promotions dùng chung vì chúng cũng render `WebsiteAccessGate`, advisor chặn lại) (hệ quả: trên các trang đó có thêm một lần `me` của layout; sau khi đăng xuất ở đó, badge ẩn trong tối đa ~30 giây hoặc ngay khi một 401 đến). Không đổi logic quyền của từng trang. Vào một trang Website trong layout **không còn đọc lại `me`** (phiên của layout được dùng lại); mọi request vẫn được server xét lại, và 403 vẫn đọc lại `me`.
- **Ảnh hưởng tới SignalR:** kết nối live thuộc provider của layout, **một kết nối mỗi Staff identity**, chỉ khi phiên đã xác nhận **và** có quyền website. Màn Newsletter chỉ *lắng nghe* khi đang mount (không replay, không mở socket thứ hai); không có provider (màn render riêng) thì dùng kết nối riêng như trước (đường này dành cho test). 401 → `expire()` của phiên dùng chung; 403 → `refresh()`, chỉ phiên đã kết thúc mới `expire()`.
- **Đếm:** lấy từ API, không đếm message SignalR. Hỏi khi phiên được xác nhận, sau tín hiệu (gộp), sau reconnect, khi tab về foreground/focus, và mỗi 30 giây khi tab hiển thị; một request tại một thời điểm, request phát sinh trong lúc chờ chạy một lần sau; lỗi mạng giữ số cũ (không về 0, không đăng xuất). So sánh watermark bằng BigInt; một câu trả lời có watermark thấp hơn cái đã áp dụng bị bỏ (câu trả lời cũ không làm số cũ xuất hiện lại).
- **Ack từ màn Newsletter:** chỉ gửi `viewWatermark` của response danh sách đã được chấp nhận cho **query đang hiện** (`settled`; response abort/supersede/lỗi/401/403 không bao giờ tới `data`), dưới đúng Staff identity đã đọc. Không optimistic: badge đổi khi server trả lời. Một POST tại một thời điểm (watermark mới hơn xếp hàng, thấp hơn không gửi); thất bại mạng/5xx thử lại tối đa 2 lần với **cùng watermark** (1,5 s, 4 s); 400 không thử lại; 401 kết thúc phiên. Không dùng chung gì với write slot, hold, stale, dialog, cờ đọc: lỗi ack không khóa CRUD. Trang 2 đóng băng (LIVE-001) không ack hoạt động mới chỉ vì nhận SignalR; live update bị hoãn giữ badge đến lần tải hợp lệ; ack không gỡ hold/stale/dialog.
- **Sidebar:** badge đỏ cạnh “Đăng ký nhận tin” (ẩn ở 0, 1–99 hiện số, >99 hiện `99+`, `aria-label` giữ số thực), chấm đỏ trên mục cha “Website” khi submenu đóng, trên icon khi sidebar thu gọn, và trong drawer mobile; mở mục cha hoặc submenu tự mở theo đường dẫn không đánh dấu đã xem; nhãn `new/pro` của template không đổi; Staff thiếu quyền không thấy và không gọi API.

## Bằng chứng

### Backend (PostgreSQL 17 thật, `NewsletterUnseenTests` 17 ca + 1 ca nâng cấp)

| Tính chất | Ca |
|---|---|
| Chỉ chuyển trạng thái thật mới là hoạt động; xác minh lại sau khi hủy là hoạt động mới | `Only_a_real_move_to_verified_…` |
| Rollback (commit bị từ chối) không để lại hoạt động và trả lại số | `A_verification_whose_commit_fails_…` |
| Cùng link bấm 6 lần cùng lúc → 1 hoạt động | `The_same_link_pressed_twice_at_once_counts_once` |
| Không email/token trong bảng hay response | `The_activity_holds_no_address_…` |
| A/B độc lập; cursor bền qua phiên mới và host thứ hai | `Each_Staff_member_has_their_own_cursor_…` |
| Staff chưa có cursor đếm từ 0, GET không ghi | `A_Staff_member_with_no_cursor_…` |
| Hoạt động commit sau snapshot vẫn chưa xem | `A_verification_that_commits_after_the_list_snapshot_…` |
| Danh sách trả watermark của chính snapshot (rỗng, quá trang, có lọc) | `The_list_answers_with_the_watermark_…` |
| **Commit đúng thứ tự**: giao dịch giữ số 1 chưa commit **chặn** xác minh số 2; người đọc lúc đó thấy 0, ack 0; commit → cả hai còn được đếm | `A_transaction_that_holds_an_earlier_number_blocks_a_later_one_…` |
| Ack ngược thứ tự giữ mốc lớn hơn; nhiều ack lần đầu đồng thời → 200 cả, không 500 | `Acknowledgements_that_arrive_out_of_order_…` |
| 8 xác minh + 12 lượt đọc/ack đồng thời: không deadlock, số 1..8 không trùng không thiếu | `Verifications_lists_and_acknowledgements_at_once_…` |
| Cursor sai định dạng/âm/tràn/số JSON/thiếu/vượt mốc → 400, không đổi gì; Staff ID trong body bị bỏ qua | `A_watermark_that_is_not_a_plain_…` |
| Menu key lạ → 404, không ghi | `A_menu_that_has_no_badge_…` |
| 401, 403 (kể cả body hỏng), Origin lạ, content-type sai, method sai, `LocalGate` 404, `no-store` | 3 ca quyền/biên |
| Xóa subscription đã xác minh chưa xem → lượt biến mất theo, watermark giữ | `Deleting_a_verified_unseen_…` |
| Nâng cấp V24 → V25 (subscriber, request, sender nguyên vẹn; stream 0; không Welcome/hoạt động hồi tố; ràng buộc DB; `Down` được khi stream trống, bị từ chối khi đã có dữ liệu) | `V24_database_with_subscribers_and_mail_upgrades_intact_…` |

Pin cập nhật có chủ đích: số/danh sách migration trong `StaffIdentity`, `WebsiteSettings`, `BlogMedia`, `CommercialCommitmentV2`, `PhysicalRoomSchedule…`, `PropertyInventory` (24 → 25, thêm migration mới vào danh sách chờ); pin route ghi Admin (`AdminCalendarAssignmentApiTests`) thêm `menu-unseen/{menuKey}/seen`; `ResetDatabaseAsync` của test đưa bộ đếm về 0. **Không nới bộ lọc nào.** `ContentPackSpec` phân loại ba bảng mới (các ca ContentPack đã đỏ đúng vì “unclassified tables” trước khi sửa).

### Admin (vitest, deferred promise)

`NewsletterBadgeProvider.test` (28 ca): ai được badge (thiếu quyền/chưa đăng nhập: không gọi gì); tín hiệu chỉ là lời nhắc (3 tín hiệu = 1 request, số là của API); reconnect, foreground/focus, 30 giây chỉ khi hiển thị; một request tại một lúc; lỗi giữ số cũ; 401/403; câu trả lời cũ không ghi đè ack mới; ack không optimistic, đúng watermark, một lần, thử lại cùng watermark có giới hạn, 400 không thử lại, 401; đổi Staff/đăng xuất/unmount làm callback cũ vô hiệu; một kết nối cho sidebar + màn hình (cả Strict Mode), không replay, rời màn hình thì ngừng nghe. `NewsletterSeenAck.test` (10 ca, màn thật + provider thật): ack bằng watermark của danh sách (không phải mốc mới nhất của count); lỗi/không watermark không ack; response bị supersede không ack; trang 2 + tín hiệu không đọc/không ack, badge theo server; dialog/hold/recovery giữ ack đến lần tải hợp lệ và ack không gỡ hold; ack lỗi không khóa CRUD. `AppSidebar.test` (8 ca): 0 ẩn, số, `99+` + nhãn, chỉ ở “Đăng ký nhận tin”, chấm cha khi đóng, thu gọn, mobile. Thêm: `StaffSession.test` (`reuse` nhường phiên, không `reuse` giữ phiên riêng), `menuUnseen.test` (parse/watermark/hai lời gọi), parse `viewWatermark`. **Kiểm tra đột biến**: bỏ so sánh watermark, bỏ chặn ack không mới hơn, bỏ kiểm tra identity → test đỏ.

### Trình duyệt (Chrome HTTPS; Admin `next dev`; API + PostgreSQL riêng + SignalR **thật**; Google là stub local; không thư thật; DB của Owner không chạm) — 32/32

Ba ngữ cảnh: A, B (Manager có quyền website) và phiên thứ hai của chính A. Đã chứng minh: (1) Staff chưa có cursor = 0; ba xác minh thật qua API công khai → A (trang Website) và B (trang `/profile`, ngoài phiên Staff) cùng thấy **3**; submenu đóng → chấm trên “Website”, mở → badge đỏ 3; chưa có list read nào, chưa ack. (2) A vào Newsletter (điều hướng client): danh sách tải → ack đúng `"3"` một lần → A về 0; **B vẫn 3**; điều hướng giữ **cùng một socket**. (3) A tải lại → 0; phiên thứ hai của A: `count 0, lastSeen 3`; B tải lại: vẫn 3. (4) **Xác minh thứ tư đến trong lúc ack đang chờ** (POST bị giữ bằng route phía trình duyệt, A ở trang 2): badge không rơi về 0, hiện 2 trong lúc chờ, **vẫn 1 sau khi ack “4” đáp** (thứ năm được đếm); trang 2 giữ nguyên các dòng, 0 list read cho tín hiệu; “Xem đăng ký mới” → ack “5” → 0. (5) Mất socket (offline + đóng socket) → badge không đoán; online lại → socket tự mở lại và số đúng (1). (6) B đếm đủ 6, độc lập A; **mobile 375px**: drawer có chấm, mở Website thấy badge đỏ **6**. Mỗi trang đúng một socket hub đang mở. Mở trang cấu hình sender **không** gửi ack nào (B: không có gì; A: không thêm). DB cuối: 6 hoạt động, bộ đếm 6, cursor chỉ của A (5), B và phiên thứ hai không ack. Ảnh: `…/scratchpad/accept/shots/b01-A-three.png`, `b02-B-three.png`, `b03-A-zero-after-open.png`, `b04-A-page2-new-activity-counted.png`, `b05-B-mobile-drawer.png` (thư mục scratchpad của phiên, có thể bị dọn). Lần chạy đầu 24/28 do lỗi **của script** (đếm socket qua sự kiện `close` của Playwright, giả định chấm cha cũng hiện khi submenu tự mở theo đường dẫn, chờ badge khi drawer mobile chưa mở), đã sửa script, không đổi mã.

## Kiểm tra cục bộ (trên mã `6b26f4e`)

| Kiểm tra | Kết quả |
|---|---|
| Backend `dotnet build` Release | thành công |
| Backend unit | 676 passed |
| Backend integration (PostgreSQL 17 thật, cụm riêng, UTC) | **1561 passed, 0 failed** (23 phút 56 giây; +19 so với 1542) |
| Admin `tsc --noEmit`, `eslint .` | sạch |
| Admin vitest (toàn bộ) | 95 file, **2686 passed** (+56) |
| Admin `next build` | thành công |
| Chrome HTTPS (API, PostgreSQL, SignalR thật; Google stub): nghiệm thu badge | 32/32 |
| Chrome HTTPS: **LIVE-001 chạy lại** (`accept.mjs`) trên dây nối mới | 43/43 (toast ≈ 332 ms; thu hồi quyền, vô hiệu hóa, trang 2, hoãn, đăng xuất đều như cũ) |
| Chrome HTTPS: **C1 chạy lại** (`c1-accept.mjs`) | 16/17; ca còn lại **thay đổi có chủ đích**: socket nay thuộc layout nên *không* đóng khi rời màn Newsletter (F2 vẫn đúng: không có request nào sau unmount) |
| Customer_Web | **không chạy**: không đổi mã hay hợp đồng nào nó dùng |

## Triển khai và thứ tự

1. **Migration 25** (additive: 3 bảng mới + một dòng seed; không sửa bảng cũ) — áp **trước** khi chạy API bản mới. API cũ + schema mới chạy bình thường (không ai đọc bảng mới); API mới + schema cũ **fail** ở xác minh (thiếu `MenuActivityStreams`) và ở danh sách (thiếu bảng) — nên không đảo thứ tự.
2. **API** bản mới.
3. **Admin_Web**. Admin mới gọi `menu-unseen`: nếu API chưa lên bản này, lời gọi 404 → badge giữ 0 (không lỗi, không đăng xuất); danh sách không có `viewWatermark` → không ack.

Không áp migration lên `thebha_dev` trong work item này (migration đã kiểm trên cụm PostgreSQL riêng). Khi Owner khởi động stack local, `~/bha-dev.sh up` sẽ cảnh báo migration chờ; áp bằng `dotnet ef database update` như lệnh trong `AGENTS.md`.

## Giới hạn và rủi ro

- **Một API instance**, không backplane (như LIVE-001): tín hiệu chỉ tới Staff đang nối cùng instance. Badge vẫn đúng nhờ lần hỏi API (foreground/focus/30 giây/reconnect).
- **Đồng bộ giữa tab/thiết bị của cùng Staff**: tối thiểu khi focus, tải lại hoặc chu kỳ 30 giây (không có đẩy từ server khi ack; không BroadcastChannel).
- Các gate Calendar/Blog/Promotions/Catalog giữ phiên riêng: sau khi đăng xuất ở đó, badge của layout ẩn tối đa ~30 giây (hoặc ngay khi 401 đến).
- Bộ đếm là điểm tuần tự hóa của riêng các lượt **xác minh** (hiếm): chúng nối đuôi nhau tới COMMIT; ở quy mô một subscriber xác minh mỗi vài giây là không đáng kể.
- Count đếm `count(*)` trên bảng hoạt động giữ vô thời hạn (không có retention trong work item này); chỉ mục PK theo `Sequence` đủ cho số lượng newsletter hiện tại.
- Proxy cùng-origin (`BHA-ADMIN-PROXY-001`) vẫn chưa kiểm chứng cho WebSocket (như LIVE-001): không đổi; badge vẫn đếm đúng bằng API/poll.
- Nghiệm thu trình duyệt chạy `next dev`, không phải `next start`.
- **Bản sao DB của Owner không được dùng** (không có mật khẩu và prompt cấm áp migration lên DB Owner): nâng cấp được kiểm bằng ca V24 → V25 với dữ liệu mô phỏng trên cụm riêng.
- Hai worktree Orca cũ (`dry-run-orca-*`) có từ trước work item này; không dùng.

## Kích thước PR

Ngoài mục tiêu 100–400 dòng (xem số liệu GitHub trong báo cáo chat). Phần lớn là **file sinh tự động** của EF (`…AddNewsletterUnseenBadge.Designer.cs` 4265 dòng + snapshot 95 dòng) và test (1530 dòng: backend 590, Admin 940); mã production backend 282 dòng (không tính migration) và Admin 420 dòng. Không đưa test hay guard ra ngoài để giảm số dòng.

## Skill policy / review

- `diagnosing-bugs`: không kích hoạt riêng. Ba điều đã gặp và cách xử lý: (1) 11 test pin migration đỏ đúng như dự kiến → cập nhật pin có chủ đích; (2) ca ContentPack đỏ “unclassified tables” → phân loại ba bảng mới; (3) hai lỗi harness của tôi (xác nhận mail của Welcome bị chọn nhầm; xóa subscription bị FK request chặn trong test) → sửa test, không sửa mã.
- Graphify: `ALLOWED_IF_RELEVANT`, đồ thị cũ → dùng nguồn + test. Advisor đã được hỏi trước khi chốt kế hoạch.
- Review: lần 1 do Owner gọi trả hai finding P2, xử lý ở mục Correction C1; lần review sau C1 chờ Owner gọi lại `/codex:review --wait --base origin/develop`.

## Correction C1 (`BHA-NEWSLETTER-BADGE-001-C1`, sau `/codex:review` lần 1; mã `9537f22`, test bổ sung `a0b4465`)

Hai finding P2 của Codex; chỉ sửa `NewsletterBadgeProvider.tsx`, `AppSidebar.tsx` và test. Không đổi backend, migration, contract, dependency, proxy, StaffSession core, điều kiện `reuse={rule === WEBSITE_RULE}`, và socket **vẫn thuộc layout** (không đổi để chiều nghiệm thu cũ).

- **F1 — 403 rồi kiểm tra phiên lỗi phải đóng access.** `authFailure` (một hàm cho cả ba đường: kết nối live, request đếm, ack) chỉ xử lý `refresh() → "unauthenticated"`. Khi `/me` lỗi, `refresh()` trả `"error"` nhưng phiên dùng chung vẫn `authenticated`, nên form Website vẫn chạy trên quyền chưa được kiểm chứng lại (trong khi `WebsiteBoundary.onDenied` trước đây gọi `failAccessCheck()`). Sửa: cùng quy tắc với gate — `unauthenticated` → `expire()`; `error` → `failAccessCheck()` (access đóng thành lỗi có Retry, **không** phải đăng xuất); `authenticated` → giữ (màn hình dựng lại theo `me` vừa đọc; không tự hết phiên); `superseded` → không làm gì. Kết quả đến muộn từ identity/generation cũ bị bỏ (kiểm tra `gen` sau khi `refresh()` trả lời) nên không đóng hay làm hết phiên Staff mới. `failAccessCheck` được đưa vào `sessionRef` để luôn dùng handler hiện hành. Lỗi mạng thuần túy của API đếm (không có 403) giữ nguyên: giữ số cũ, không đóng gì.
- **F2 — chỉ báo theo phần menu thực sự được vẽ.** Chấm trên mục cha bị ẩn khi `openSubmenu` trỏ tới Website, nhưng khi sidebar thu gọn (không hover) submenu không được vẽ nên cũng không có badge số: không còn dấu hiệu nào. Sửa: `submenuDrawn = isExpanded || isHovered || isMobileOpen`; chấm chỉ ẩn khi submenu mở **và** đang được vẽ. Không reset `openSubmenu`; mở/đóng/hover/thu gọn không gửi ack và không đổi count.

### Bằng chứng trước/sau

| | Trước (`d71a2a8` + test) | Sau |
|---|---|---|
| vitest, 14 ca C1 mới (F1: live/REST/ack 403 + `/me` lỗi → form đóng + Retry → Retry mở lại với một kết nối; unauthenticated; authenticated; mất quyền; superseded; muộn sau đăng xuất; muộn sau khi đổi Staff; muộn sau khi cây bị unmount; lỗi mạng thuần túy. F2: thu gọn/hover/mobile/0/99+/không ack) | 5 đỏ (3 F1: không có `staff-session-error`; 2 F2: chấm không hiện), các ca bảo vệ còn lại xanh | 14/14 |
| Trình duyệt F1: chặn `GET menu-unseen` bằng 403 và làm `/me` thất bại | đỏ: trang Website **vẫn mở**, không có lỗi/Retry | trang đóng, lỗi + Thử lại, socket đóng cùng access; Retry → trang trở lại, badge 2, **một** socket |
| Trình duyệt F2 (desktop thu gọn/hover, mobile 375px, đo trong khung nhìn thực) | đỏ 2/11: sau khi thu gọn không có chấm nào trên màn hình, và sau khi chuột rời cũng vậy (chạy F2 riêng trên mã chưa sửa; lần chạy toàn bộ trước sửa dừng ở F1) | 15/15 (cùng script, F1 + F2) |

Phần thật/mock của nghiệm thu trình duyệt: Chrome HTTPS, Admin `next dev`, API + PostgreSQL + SignalR **thật**, Google là stub; 403 của request đếm và việc `/me` thất bại được tạo bằng `route` phía trình duyệt. Đường **403 của kết nối live** không tạo được trong trình duyệt (negotiate đã xong); nó chỉ được chứng minh bằng test tích hợp (phiên dùng chung thật + provider thật + gate mặc định + form thật), và dùng chung `authFailure` với đường REST đã nghiệm thu. Ảnh: `…/scratchpad/accept/shots/c1-01-access-closed-retry.png`, `c1-02-after-retry.png`, `c1-03-expanded-website-open.png`, `c1-04-collapsed-dot.png`, `c1-05-hover-expanded.png`, `c1-06-mobile-drawer-closed.png`, `c1-07-mobile-drawer-open.png` (thư mục scratchpad của phiên, có thể bị dọn).

| Kiểm tra (C1, trên `9537f22`) | Kết quả |
|---|---|
| Admin vitest (toàn bộ, trên `a0b4465`) | 95 file, **2700 passed** (+14) |
| `tsc --noEmit`, `eslint .` (trên `a0b4465`), `next build` (trên `9537f22`; commit sau chỉ đổi test) | sạch / thành công |
| Chrome HTTPS (C1) | 15/15 |
| Backend, Customer_Web | không chạy lại: không đổi mã ảnh hưởng đến chúng |

Giới hạn giữ nguyên như đã công bố, **cộng một hệ quả mới của F1**: phiên dùng chung của layout giờ có thể chuyển sang trạng thái `error` từ một đường của badge (403 rồi `/me` lỗi) trên các trang **không có gate quyền website mặc định** (`/profile`, các trang template, Calendar, Catalog, Blog, Promotions). Ở đó không có gì hiện lỗi hay nút Retry: badge và socket của layout tắt cho tới khi Staff mở một trang Website và bấm Thử lại, hoặc tải lại trang. Đó là hành vi đúng (access phải đóng cho đến khi có Retry); không thêm tự thử lại vì như vậy sẽ mở lại access mà không có thao tác Retry của Staff.

## Quyết định cần Owner/OC

Chuyển PR cho review; nếu đạt, quyết định Ready/merge và thứ tự triển khai (migration → API → Admin). Không bắt đầu badge cho menu khác.
