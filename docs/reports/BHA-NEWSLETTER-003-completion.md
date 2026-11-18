# BHA-NEWSLETTER-003 — completion report (quản lý subscriber, email xác nhận mới, Welcome tự động)

- **IMPLEMENTATION:** xem `STATUS` ở tin bàn giao. **REVIEW:** NOT_RUN — Owner gọi Codex.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`; `CODEX_REVIEW_COMMAND`: `/codex:review --wait --base origin/feature/bha-newsletter-002-email-verification` (PR #133 còn mở lúc bắt đầu, nên giữ base của prompt).
- **Branch / base:** `feature/bha-newsletter-003-management-welcome` từ `origin/feature/bha-newsletter-002-email-verification` `c95e85e` (= `BASELINE_SHA`); tree sạch lúc bắt đầu; không worktree. **Draft PR:** #134 (base = nhánh của #133).
- **Graphify / diagnosing-bugs:** không dùng (đọc mã nguồn và test trực tiếp).

## Phần 1 — Quản lý subscriber trong Admin

| Thao tác | Hành vi |
|---|---|
| **Thêm** | `POST /api/admin/v1/website/newsletter-subscriptions` {email, language `vi|en|fr`}. Ghi `Source = admin`, `CreatedByStaffId`, trạng thái **Chờ xác minh**, **không gửi gì**. Email trùng (kể cả đã lưu trữ) → `409 newsletter-subscription-duplicate` kèm `existingId`/`existingArchived`; màn hình có nút "Mở bản ghi hiện có". |
| **Gửi lời mời xác minh** | `POST …/{id}/verification-invitations`. Cùng cooldown 300 s với form công khai. Luôn `200` với `status` = `queued` \| `cooldown` (+ `retryAfterSeconds`) \| `not-connected` (chưa có sender: không xếp hàng, không ghi cooldown). Chỉ cho địa chỉ đang chờ xác minh và không lưu trữ; địa chỉ đã xác minh/đã ngừng nhận → `409 newsletter-invite-not-pending`. |
| **Sửa** | `POST …/{id}/update` {expectedVersion, email?, language?}. Version kiểm **trong cùng câu UPDATE** (và sau khoá hàng), nên hai lượt sửa cùng version chỉ một lượt thắng (test: 4 lượt song song = 1×200 + 3×409). Đổi ngôn ngữ giữ trạng thái xác minh và đổi ngôn ngữ của thư đang chờ. Đổi email → **Chờ xác minh**, xoá `VerifiedAtUtc`/`UnsubscribedAtUtc`/cooldown, **huỷ thư đang chờ** (cả thư worker đang giữ) và **vô hiệu mọi token cũ** (`RevokedAtUtc`). Email mới trùng → `409` kèm hàng đang giữ; `UX_NewsletterSubscriptions_Email` vẫn là chốt chặn ở DB. |
| **Ngừng nhận** | Staff: `POST …/{id}/unsubscribe`. Khách: nút trong Welcome → trang `/newsletter/unsubscribe` → `POST /api/v1/website/newsletter-subscriptions/unsubscriptions`. Lưu `UnsubscribedAtUtc`, huỷ thư đang chờ/đang giữ. Khách đăng ký lại ở form công khai → **Chờ xác minh** + một thư xác nhận mới (double opt-in); chỉ nút xác nhận trong mail đó mới đưa về **Đã xác minh**. Staff không thể "mời lại" địa chỉ đã ngừng nhận. |
| **Lưu trữ / khôi phục** | `…/archive`, `…/restore`. Ẩn khỏi danh sách mặc định (`scope=active`), xem bằng `scope=archived|all`. Không đổi trạng thái đồng ý. Lưu trữ **huỷ thư đang chờ** (khôi phục không gửi lại chúng). Hành động của chính khách (đăng ký lại, bấm xác nhận) bỏ lưu trữ. |
| **Xoá vĩnh viễn** | `…/{id}/delete` (`204`). Dialog nêu đúng email và hậu quả. Một transaction: khoá hàng, kiểm version, xoá thư/token rồi xoá hàng. Link cũ (xác nhận lẫn hủy nhận tin) → `400`, **không dựng lại** subscriber. Audit giữ id/hành động/ai/lúc nào, **không giữ email, không FK**. |
| **Bảo vệ** | `WebsiteSettingsManage` (như 001/002; không thêm cờ, không đổi `StaffAccounts`); Staff boundary kiểm Origin + JSON như mọi route website (Admin API chỉ GET/POST theo CORS nên mọi ghi là POST). Route khách `unsubscriptions` ẩn danh, `IgnoreAntiforgeryToken` có chủ đích (không có cookie để mượn), qua rate limit của newsletter. |
| **Audit** | Bảng `NewsletterSubscriptionAudits` (`created`, `edited` + tên trường, `invited`, `unsubscribed`, `archived`, `restored`, `deleted`): actor, thời điểm. Việc khách tự ngừng nhận không có actor Staff nên không vào bảng này (giá trị nằm ở `UnsubscribedAtUtc`). |
| **Danh sách** | Lọc `status` (Chờ xác minh/Đã xác minh/Đã ngừng nhận), `scope`, tìm kiếm, phân trang; giá trị lạ → `400`. Sau mỗi thao tác màn hình đọc lại **đúng truy vấn đang có** (từ khoá, bộ lọc, trang); trang vượt phạm vi dùng lại hành vi "Về trang 1" cũ. Ghi một lần (khoá ghi của host), lỗi/mất phản hồi giữ dialog và không tự gửi lại. |

## Phần 2 — Email theo mẫu đã đọc

Template viết từ đầu (không sao chép nội dung/ảnh/mã của Upwork): khung bảng 600px nền sáng, CSS inline, Helvetica/Arial, nút bo tròn, preheader ẩn, alt text, `lang`, `<style>` chỉ là nâng cấp (≤480px xếp dọc thẻ khám phá). Logo và ảnh khách sạn (dẫn xuất từ tài nguyên có sẵn của Customer_Web, 14–145 KB) nhúng bằng `cid:` nên hiện được mà không cần origin công khai và không bị chặn "ảnh từ xa". Mục đích chính vẫn thấy khi ảnh bị chặn: tiêu đề, đoạn giải thích, nút (ô bảng có `bgcolor`) và liên kết chép-dán đều là chữ.

| Thư | Nội dung |
|---|---|
| **Xác nhận** | Logo → ảnh sảnh → tiêu đề "Xác nhận đăng ký", câu giải thích (ai/đăng ký gì), nút **Xác nhận đăng ký**, hạn liên kết, hộp liên kết sao chép, "bỏ qua nếu không phải bạn", chân thư nêu địa chỉ nhận. |
| **Welcome** | Subject đúng `Welcome to the BHA` (vi/en/fr, có test). Logo → ảnh banner → "Chào mừng bạn đến với The BHA", lời chào, "Email … đã được xác nhận thành công", lời chào mừng, CTA **Khám phá The BHA** (`Discover The BHA`/`Découvrir The BHA`) → `/`, ba khối thumbnail+tiêu đề+mô tả+liên kết: **Ưu đãi lưu trú** → `/offers`, **Khám phá The BHA Riverside** → `/riverside`, **Tin mới từ The BHA** → `/blog` (cả ba trả 200 trên Customer_Web khi kiểm), chân thư có liên kết **Hủy nhận tin** và header `List-Unsubscribe`. |

Quyết định: **không** có trang "Khám phá Đà Nẵng" (repo chưa có trang đó) nên dùng `/riverside`; **không** nhúng bài viết/ưu đãi cụ thể (chỉ liên kết tới trang công khai đang chạy, nên không thể trỏ vào nội dung chưa xuất bản). Text/plain đầy đủ cho cả hai thư; thư xác nhận vẫn đúng **một** dòng `https://` (liên kết xác nhận); Welcome đúng **một** dòng `https://` có `#t=` (liên kết hủy nhận tin), các liên kết trang thụt đầu dòng.

## Phần 3 — Welcome tự động

- **Khi nào tạo:** chỉ khi câu `UPDATE … SET Status='Verified' WHERE Status='PendingVerification'` **thật sự đổi một hàng** (số hàng bị ảnh hưởng, trong transaction đã khoá subscription). Hai liên kết hợp lệ của một địa chỉ (thư bị thay thế vẫn dùng được), replay và 12 lượt bấm song song chỉ tạo **một** Welcome; DB còn chặn bằng `UX_NewsletterVerificationRequests_WelcomePerVerification` (SubscriptionId, thời điểm xác minh). Xác minh lại sau khi ngừng nhận/đổi email là một lần chuyển trạng thái mới → Welcome mới.
- **Không hồi tố:** subscriber đã xác minh trước nâng cấp không có request nào (test nâng cấp + test riêng). Welcome hết hạn gửi sau `WelcomeLifetimeHours` = 168 giờ (không gửi lời chào quá cũ); liên kết hủy nhận tin **không** hết hạn.
- **Hai loại token tách bạch:** token xác nhận chỉ xác nhận; token Welcome chỉ hủy nhận tin; token đã thu hồi (đổi email) hoặc của hàng đã xóa → `400` cho cả hai route.
- **Hàng đợi:** dùng lại `Purpose` trên outbox hiện có (cùng claim, lease, `ClaimId`, epoch, kiểm tra trước khi gửi của C1–C3). Đã rà mọi câu truy vấn chạm outbox: thay thế thư cũ, xác nhận, hủy khi đổi sender, nhả cooldown chỉ áp cho `Verification`/theo dấu thời gian riêng của từng request; không câu nào huỷ nhầm Welcome. Worker đọc lại từ DB ngay trước khi gửi: subscription còn tồn tại, đúng trạng thái cho loại thư (đang chờ cho xác nhận, đã xác minh cho Welcome), không lưu trữ, không ngừng nhận; thiếu hàng (đã xoá) là "không còn gì để gửi", không phải lỗi.
- **Gmail ngắt kết nối:** Welcome giữ `Pending`, gửi một lần sau khi kết nối lại (test).
- **Đổi tài khoản Gmail:** Welcome **đã từng thử** dưới danh tính cũ bị huỷ (`sender-changed`) như thư xác nhận; chưa từng thử thì đi từ tài khoản mới. Đây là quyết định của tôi (một lời chào gửi trùng từ hai địa chỉ tệ hơn không có lời chào; subscriber vẫn **Đã xác minh**).
- **Content Pack:** `NewsletterSubscriptionAudits` được liệt vào `Excluded` (spec + `manifest.json`), cùng ba bảng newsletter đã có.

## Migration 24 `AddNewsletterManagement`

Cột mới trên `NewsletterSubscriptions` (`Version` mặc định 1, `Language` mặc định `vi`, `CreatedByStaffId` FK Restrict, `UnsubscribedAtUtc`, `ArchivedAtUtc`), cột mới trên `NewsletterVerificationRequests` (`Purpose` mặc định `Verification`, `ForVerifiedAtUtc`, `RevokedAtUtc`), bảng `NewsletterSubscriptionAudits`, các CHECK (`Status` thêm `Unsubscribed`, `Source` thêm `admin`, `CreatedBy`, `UnsubscribedAt`, `Language`, `Version`, `Purpose`, `ForVerifiedAt`) và chỉ mục duy nhất của Welcome. `Down()` từ chối khi còn dữ liệu sẽ mất (địa chỉ do Staff thêm, đã ngừng nhận/lưu trữ/sửa, ngôn ngữ khác `vi`, Welcome, audit).

**Việc Owner cần làm:** `thebha_dev` đang ở migration 23 (tôi cố ý **không** áp migration chưa review lên DB mặc định). Trước khi dùng form newsletter hoặc trang Admin mới trên DB đó, chạy lệnh trong `AGENTS.md` §9 (`dotnet ef database update …`); nếu chưa, form công khai và trang danh sách trả lỗi trên DB đó.

## Kiểm chứng (đã chạy trong phiên này)

| Việc | Kết quả |
|---|---|
| Backend unit | 676 passed, 0 failed |
| Backend integration, **toàn bộ** (Release, PostgreSQL thật) | **1504 passed, 0 failed, 0 skipped** (30 phút 28 giây), chạy nguyên khối một lần sau mọi sửa đổi của backend (khác với 002, nơi chưa chạy lại nguyên khối) |
| Test mới `NewsletterManagementTests` (34 ca) | thêm/trùng/400, mời (not-connected/queued/cooldown/không đủ điều kiện), sửa ngôn ngữ, sửa email (trạng thái, token cũ, thư chờ), email trùng + chốt DB, 4 lượt sửa cùng version = 1 thắng, version cũ = 409 cho mọi ghi, ngừng nhận (Staff, lặp, đăng ký lại → double opt-in → Welcome mới), lưu trữ/khôi phục, xoá + audit không có email, ma trận quyền 7 route, **một xác minh = một Welcome** (replay, 12 song song, hai liên kết hợp lệ), Welcome vi/en/fr (subject, nội dung, CTA, 3 khối, `List-Unsubscribe`, 5 ảnh `cid:`, alt), token xác nhận ≠ token hủy, hủy nhận tin (một lần, lặp, 12 song song, sau hạn gửi), Gmail ngắt/nối lại, Welcome quá hạn, **địa chỉ đã xác minh trước nâng cấp không có Welcome**, và 8 ca "Staff xoá/ngừng/lưu trữ/đổi email **trong lúc worker giữ thư** (đã nhận claim, chờ token của Google)": không thư nào rời đi, không hàng nào bị dựng lại |
| Test cũ phải sửa | 7 chỗ ghim số migration/danh sách (`StaffIdentity`, `CommercialCommitmentV2`, `PhysicalRoomSchedule…`, `BlogMedia`×3, `WebsiteSettings`×2, `PropertyInventory`), registry route OpenAPI (+7 route), và 2 test newsletter cũ phản ánh đúng hành vi mới (`Confirming_the_link…` đếm theo `Purpose`; `…never_deadlock…` nay thấy Welcome đang chờ và gửi nó) |
| **Nâng cấp DB** | `V23_database_with_subscribers_and_queued_mail_upgrades…`: DB ở migration 23 có subscriber chờ/đã xác minh và thư đã gửi/đang chờ → migration 24: mọi hàng còn nguyên với mặc định mới, **0 Welcome hồi tố**, 4 ràng buộc mới bị DB từ chối đúng, Down từ chối khi có dữ liệu rồi chạy được khi sạch. Thêm: bản sao DB dev thật (`thebha_dev`, 23 bài, 7 loại phòng…) được migrate bằng `dotnet ef database update` mà không lỗi |
| Customer_Web | `vitest` 1667 passed; `tsc`, `next lint`, `next build` (có `/newsletter/unsubscribe`) pass |
| Admin_Web | `vitest` 2517 passed (+23 ca quản lý, 10 ca danh sách cập nhật); `tsc`, `eslint .`, `next build` pass |

### Nghiệm thu HTTPS, API + PostgreSQL thật (Chrome)

DB `bha_nl3` là bản sao của `thebha_dev` đã migrate bằng code mới; kết nối Gmail thật trong bản sao bị gỡ, Google là **stub HTTPS cục bộ** (`authorize/token/userinfo/send/revoke`, không nằm trong repo); tài khoản Staff QA riêng. Kết quả: đăng nhập Staff → trang danh sách đúng (không 500) → **Kết nối Gmail** (qua stub, quay về báo đã kết nối) → **Thêm đăng ký** (English) → dòng "Chờ xác minh", "Admin thêm", không có thư → **Gửi lời mời xác minh** → worker thật gửi (From/To/Subject đúng, 6 phần MIME) → mở liên kết bằng khách: DB vẫn `Pending`, thanh địa chỉ sạch token, bấm **Xác nhận** → `Verified`, phiên bản 2 → worker gửi **đúng một** Welcome (`Welcome to the BHA`, `List-Unsubscribe`, 5 ảnh) → mở liên kết hủy: DB vẫn `Verified` khi chỉ mở, bấm **Hủy nhận tin** → "Đã hủy nhận tin"; Admin hiện **Đã ngừng nhận**, chỉ còn Sửa/Lưu trữ/Xóa → **Xóa** (dialog nêu đúng email và hậu quả) → 0 hàng, audit `created, invited, deleted`, cả hai liên kết cũ trả `400`. Form công khai (ngôn ngữ `fr`) vẫn `202`. Bản sao đã được xoá sau đó; stack của Owner (API/Admin/Customer) đã chạy lại, **trên DB `thebha_dev` chưa có migration 24** (xem trên).

**Ảnh preview hai template** (render từ chính mail worker đã gửi, 375px và 600px): `/home/admin1/bha-previews/newsletter-003/{confirmation,welcome}-{375,600}.png` (+ `*.html` và ảnh nhúng). Không nằm trong repo.

## Phần chưa kiểm chứng / giới hạn

- **Không gửi thư thật tới hộp thư test:** prompt không nêu hộp thư test và hook riêng tư của phiên chặn việc đưa địa chỉ của Owner vào request. Gửi thật: Owner nhập địa chỉ vào form trang chủ (hoặc Admin → Thêm đăng ký → Gửi lời mời) sau khi áp migration. **Chưa render trên client thư thật** (Gmail web/app, Outlook, Apple Mail): chỉ Chrome headless 375/600 px và giải mã MIME.
- **Thư trùng khi Google không trả lời:** như 002, kết quả không rõ (timeout, mất kết nối, crash sau khi gọi) được thử lại với cùng liên kết, nên khách **có thể nhận hai bản** của một thư; với Welcome, hai lời chào. Hạn chế còn lại không đóng được: giữa lần kiểm tra cuối và lúc Google nhận request — một thư Staff vừa xoá/ngừng/đổi email trong đúng khoảng đó vẫn có thể đi.
- **Quyền dùng chung:** `WebsiteSettingsManage` vẫn bảo vệ cả danh sách/CRUD subscriber lẫn cấu hình sender (điểm mở từ C1, chưa tách vì phải đổi schema `StaffAccounts`). Nay quyền này còn **xoá vĩnh viễn** dữ liệu cá nhân của khách: nên cân nhắc tách quyền trước khi cấp rộng.
- **`List-Unsubscribe` không có "một chạm" (RFC 8058):** token nằm ở URL fragment nên không thể là đích POST; mail client chỉ mở trang hủy, khách vẫn bấm nút.
- **Log Admin dev ghi `code`/`state` của callback OAuth** (điểm mở từ C1) vẫn như cũ; chưa kiểm production Admin.
- **Hai DB `*_integration_*` mồ côi** có thể còn trong container `the-bha-postgres-1` sau các lần chạy test bị ngắt; chưa xoá khi chưa có ý của Owner.

## Đề xuất PR tiếp theo: email tổng hợp tháng (chưa làm)

Theo bố cục **Medium Daily Digest** đã đọc: header nhận diện, mục bài nổi bật, mỗi dòng gồm tiêu đề, mô tả ngắn và thumbnail ~160×107px, cuối thư quản lý nhận tin. Đề xuất `BHA-NEWSLETTER-004`: (1) Admin chọn **tháng**; (2) chọn **bài blog đã xuất bản** và **ưu đãi đang hiệu lực** (chỉ metadata thật: tiêu đề, mô tả, ảnh `card`/`thumb` đã có, đường dẫn công khai); (3) **preview** đúng template ở 375/600px và gửi thử tới một hộp thư Owner chỉ định; (4) **Owner duyệt** rồi mới gửi tới tập `Verified` + không lưu trữ + không `Unsubscribed`, theo lô có giới hạn tốc độ và hạn mức Gmail; (5) mỗi thư mang token hủy nhận tin riêng (cơ chế của Welcome); (6) ghi lại ai duyệt/gửi cho ai. Chưa cần đổi mô hình token vì Welcome đã đặt nền cho liên kết hủy nhận tin theo từng thư.

## PR size

PR #134 (GitHub): **+7575 / −203, 49 file** (lúc bàn giao). Rất xa mục tiêu 100–400 dòng vì: `…AddNewsletterManagement.Designer.cs` **4170 dòng sinh tự động** (cộng migration 288 và snapshot); test mới ~1100 dòng (759 tích hợp, 338 UI, 56 API khách) và các test cũ đã cập nhật; bốn–sáu ảnh nhúng (nhị phân); khoá i18n ba ngôn ngữ (~80 dòng); phần mã sản phẩm viết tay (dịch vụ, controller, template, màn hình, trang khách) chỉ khoảng 1500 dòng. Không nén code hay bỏ test để hạ số này.
