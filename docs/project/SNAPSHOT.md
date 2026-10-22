# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-10-22 (`BHA-BLOG-001-CP03`; 2026-10-21: `BHA-BLOG-001-CP02`; `BHA-BLOG-001-CP01`; `BHA-BOOKING-PROMOTIONS-001`; 2026-10-19: `BHA-PRODUCT-ADMIN-001-CP01-C3-C1`; 2026-10-18: `BHA-PRODUCT-ADMIN-001-CP01-C3`; 2026-10-13: `CUST-WEB-001-CP04`, `CUST-WEB-001-CP03`, `CUST-WEB-001-CP02`, `CUST-WEB-001-CP01b`, `CUST-WEB-001-CP01a`, `CUST-WEB-001-CP00`; 2026-10-12: `PMS-CAL-004-CP01`, `PMS-CAL-003-CP03`, `-CP02`, `-CP01`, `PMS-CAL-002-CP05`, `-CP04`, `-CP03`; 2026-10-10: `PMS-CAL-002-CP02`, `PMS-CAL-002-CP01`, `BHA-BACKEND-CD-001-CP04`; 2026-10-09: `-CP03`, `-CP02`, `-CP01`; các phần cũ hơn giữ nguyên kèm SHA)
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Cập nhật 2026-10-22 (`BHA-BLOG-001-CP03`, Admin Blog: bài viết, chuyên mục, trình soạn thảo, bản dịch, thư viện ảnh, xem trước riêng tư, xuất bản, cấu hình; branch `feature/bha-blog-001-cp03-admin-blog` từ `develop` `cde026daca8611c16982543dbca407e4b5de929b`, Draft PR vào `develop`, implementer Claude, reviewer Codex read-only do Owner gọi, không migration): (1) **C2 sửa** trong PR mới (`using var srgb` trong `SkiaBlogImagePipeline`; đo trên SkiaSharp 4.153.1 thì `CreateSrgb()` trả về một instance dùng chung và `Dispose` không làm gì, nên đây là đúng quyền sở hữu chứ không phải sửa một rò rỉ đo được). (2) **Backend**: `GET posts/{id}/translations/{locale}/preview` (BlogAccess, `no-store`, bản nháp đã lưu hoặc bản đã xuất bản, đúng hình chi tiết công khai, ảnh qua route preview của Staff), dòng danh sách có `coverMediaId`, và sửa validator thân bài giữ khoảng trắng giữa các run định dạng (trước đó "Đây là **đậm** chữ" bị lưu thành "Đây làđậmchữ"). (3) **Admin_Web**: Website → Blog (Bài viết, Chuyên mục, Thư viện ảnh, Cấu hình) sau gate dùng lại phiên Staff với luật `BlogEdit`/`BlogPublish` (tài khoản chỉ có Blog không mở được trang Website nào khác); trình soạn thảo TipTap 3.32.0 (MIT) trên schema đúng bằng định dạng của máy chủ; ghi với `expectedVersion`, 409 giữ dữ liệu và so sánh, mất phản hồi là "chưa xác nhận" và được đối soát bằng đọc lại (không gửi lại mù, tạo bài giữ mã client); tải ảnh tuần tự với tiến trình byte thật và đối soát SHA-256; focal point, usage, xoá có bảo vệ; ghim; cấu hình mục trang chủ theo mã. **Customer_Web chưa nối API Blog (CP04), SEO/sitemap/hreflang (CP05) chưa làm, focal point và credit chưa vào JSON công khai, production chưa có media mount.** Hợp đồng: `docs/design/BHA-BLOG-001-blog-content-publishing.md` §10; vận hành: `docs/runbooks/BHA-BLOG-001-admin-blog.md`; báo cáo: `docs/reports/BHA-BLOG-001-CP03-completion.md`. **CP03-C1** (cùng branch/PR #128, từ head `9097726`, sau review Codex 1 finding P2): preview của một translation không có draft lẫn revision đã đăng (schema cho phép, API hiện không tạo ra) trả 404 có kiểm soát thay vì 500; còn một chỗ cùng gốc chưa sửa (`ListPostsAsync` dòng 76) chờ OC quyết định.

Cập nhật 2026-10-21 (`BHA-BLOG-001-CP02`, thư viện ảnh và pipeline ảnh của Blog, branch `feature/bha-blog-001-cp02-media-library-pipeline` từ `develop` `57eb0b93805bff59d8382a57d302d4276c65c831` — đã chứa PR #126 —, Draft PR vào `develop`; implementer Claude / reviewer Codex read-only do Owner gọi): **chỉ backend** (UI_LIVE `NOT_APPLICABLE`; màn thư viện/picker là CP03, Customer là CP04). Tách ảnh (tài sản: tên, mô tả, credit, nguồn, giấy phép, focal point, `Version`) khỏi lần dùng ảnh (alt/chú thích thuộc revision/ngôn ngữ — không bao giờ bị sửa ngầm bởi sửa tài sản). Upload một ảnh (tương thích CP01, thêm field additive, `id` do client đặt → lặp lại là 409) và upload nhiều ảnh (`media/bulk`, ≤ 10 ảnh/≤ 50 MB, kết quả theo từng file bằng index + id, ảnh hỏng không làm hỏng ảnh khác). Pipeline dùng SkiaSharp (MIT, đã có sẵn, không thêm dependency): decode thật, áp EXIF orientation, sRGB, ba cỡ `thumb` 320 / `card` 640 / `article` 1280 (không phóng to), mỗi cỡ WebP + JPEG (PNG nếu có trong suốt thật), không giữ EXIF/GPS; **AVIF không được tạo** (encoder trong bản Skia đang dùng trả `null`, có test chứng minh). File ghi trước, rồi row + variants trong một transaction; lỗi → xoá file chỉ khi chắc chắn row chưa commit (mất ack thì giữ file). Danh sách/tìm kiếm phân trang ổn định, usage (cover/og/body; draft/live/lịch sử; cả bài đã unpublish/archive), xoá chỉ khi không còn dùng (`FOR UPDATE` + FK, đua với save được thứ tự bởi PostgreSQL: `409 blog.media-in-use` hoặc `400 blog.media-missing`, không 500). Public: variant ở địa chỉ bất biến `media/{id}/{generation}/{preset}.{format}`, cổng publication kiểm ở mọi request trước byte/304, `public, max-age=300` (không stale-*), bản gốc private không có địa chỉ công khai; focal/credit **chưa** vào JSON công khai (quyết định mở cho OC: giữ "sửa ≠ xuất bản"). Migration 19 `AddBlogMediaLibrary` (ảnh CP01 giữ id/key/tham chiếu, `Generation` 0 cho đến khi chạy `--blog-media-maintain --expected-database NAME (--dry-run|--apply)` — bước bắt buộc khi triển khai nếu đã có ảnh; lệnh cũng dọn file không còn row nào tham chiếu sau thời gian ân hạn). Dockerfile thêm `/var/media`; compose showcase thêm volume ảnh; **production AWS chưa có mount ảnh** (shape CD-001 chỉ hai bind mount) — chưa xác minh, chưa cấu hình. Thiết kế §9: `docs/design/BHA-BLOG-001-blog-content-publishing.md`; vận hành: `docs/runbooks/BHA-BLOG-001-blog-media.md`; bằng chứng: `docs/reports/BHA-BLOG-001-CP02-completion.md`. Review Codex đầu tiên (`d9d1b41`) có hai finding P2 đã sửa bằng correction `CP02-C1` (id upload hàng loạt so sánh theo giá trị Guid; offset phân trang tính bằng `long`); `REVIEW` của correction: `NOT_RUN`.

Cập nhật 2026-10-21 (`BHA-BLOG-001-CP01`, nền tảng nội dung và xuất bản của Blog/Cẩm nang, branch `feature/bha-blog-001-cp01-content-publishing` từ `develop` `c7d559793d405e4eaad6b5e18804b36ebe5f57f3` — đã chứa PR #125 ưu đãi —, Draft PR vào `develop`; implementer Claude / reviewer Codex read-only do Owner gọi): **chỉ backend** (CP01 trong lộ trình CP01–CP05; chưa có media library, màn Admin, Customer, SEO/sitemap — UI_LIVE `NOT_APPLICABLE`). Mô hình: một bài (`BlogPosts`) chỉ là danh tính; mỗi ngôn ngữ là một `BlogPostTranslations` với trạng thái xuất bản riêng (`Draft`/`Published`/`Unpublished`/`Archived`) và `Version` làm token đồng thời cho mọi thao tác ghi (hai người cùng version → một bên `409 blog.stale-version`; publish/unpublish/sửa chạy đua không để lại trạng thái lẫn). Nội dung nằm trong các revision bất biến: một bản nháp duy nhất sửa tại chỗ, publish đóng băng nó và trỏ `PublishedRevisionId` vào đó trong một transaction; tiêu đề, slug, tóm tắt, thân bài, ảnh, SEO **và chuyên mục** đều thuộc revision nên đổi chuyên mục ở bản nháp không đổi bản đang công khai. Khôi phục một revision tạo bản nháp mới (bản nháp bị thay vẫn được giữ, đóng băng). Địa chỉ: `BlogPostSlugs` khoá `(Locale, Slug)`, địa chỉ cũ của bài là redirect 301 thuộc về chính bài đó mãi mãi (không chain, không bị bài khác chiếm); chuyên mục có lịch sử slug tương tự. Thân bài là JSON có phiên bản (`heading` 2–4, `paragraph`, `list`, `quote`, `image`, `gallery`, `toc`, `propertyIntro`), server kiểm tra chặt, chỉ chấp nhận link nội bộ/https, văn bản thuần (không `<`/`>`), mọi id media/cơ sở phải tồn tại. Chuyên mục "Điểm đến nổi bật" được migration seed idempotent với id cố định; `BlogSettings.HomeSectionCategoryId` nối section homepage với chuyên mục **theo id** (đổi tên không đổi gì); ghim/thứ tự thuộc quan hệ bài–chuyên mục. API công khai (`api/v1/website/blog`) chỉ trả bản đã xuất bản đúng ngôn ngữ (ngôn ngữ lạ/đang tắt → 400, không fallback), danh sách theo chuyên mục: ghim trước rồi mới nhất, có tie-break tổng nên không trùng bài giữa các trang; `no-cache` + ETag nên ngừng xuất bản có hiệu lực ở request kế tiếp; ảnh chỉ phục vụ khi có bài đã xuất bản dùng. Quyền (ADR 0010): hai cờ toàn cục `CanEditBlog` / `CanPublishBlog` trên tài khoản Staff, chỉ cấp bằng CLI `--staff-blog-access`, đọc từ DB mỗi request; sửa không tự có quyền publish; không quyền Property nào cấp được. Migration 18 `AddBlogFoundation` (`Down()` từ chối khi có nội dung/quyền Blog). Kiểm chứng trên PostgreSQL thật: 75 unit + 55 integration mới cho Blog; chi tiết trong `docs/reports/BHA-BLOG-001-CP01-completion.md`. Thiết kế: `docs/design/BHA-BLOG-001-blog-content-publishing.md`. `REVIEW: NOT_RUN`.

Cập nhật 2026-10-21 (`BHA-BOOKING-PROMOTIONS-001`, branch `feature/bha-booking-promotions-001` từ `develop` `65135cea4126f6d3188fc13d928cc62ca8301ec4`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): ưu đãi đặt phòng xuyên suốt Admin → giá → hold → confirm → Customer. Một thực thể `Promotion` vừa là quy tắc giảm (phần trăm `0<p<100` hoặc số tiền cố định mỗi phòng mỗi đêm bằng tiền tệ rate plan; cửa sổ đặt, cửa sổ lưu trú (theo đêm), số đêm tối thiểu tính trên cả booking; một ưu đãi mỗi booking, chọn tổng giảm cao nhất, hoà thì cũ hơn rồi `Id`) vừa là nội dung website (tiêu đề, mô tả, các đoạn chi tiết, ảnh bìa, `ShowOnHomepage`, thứ tự, cửa sổ hiển thị). **Hai cờ tách bạch:** `Status` (`Draft`/`Active`/`Disabled`) là cờ duy nhất quyết định tính giá; `ShowOnHomepage` + cửa sổ hiển thị chỉ đặt thẻ. Công khai khi `Active` ∧ `ShowOnHomepage` ∧ trong cửa sổ hiển thị ∧ hạn đặt chưa qua (một hàm cho list, detail và ảnh; ETag theo nội dung nên đổi ngày là rớt thẻ, không giữ bản cũ khi API lỗi). Backend: `PromotionPricing` là hàm tính giá duy nhất cho báo giá (`AvailabilityOfferDto` thêm trường) và hold (trong transaction hiện có); `DailyRoomRate` không đổi; làm tròn nửa-ra-xa-không về đồng (VND) / 2 số lẻ, cố định trong code; một đêm sau giảm dưới mức nhỏ nhất hợp lệ thì ưu đãi không áp dụng (không tự cắt) và Admin bị từ chối khi lưu theo giá hiện có. Hold nhận `expectedTotalAmount` + `expectedCurrencyCode` (tuỳ chọn trên wire); lệch tổng hoặc tiền tệ ở lần tạo mới trả `409 hold.price-changed` kèm báo giá mới, replay hold đã tạo không kiểm lại. Snapshot: `UnitAmount` vẫn là số tiền phải trả, thêm `ListUnitAmount` mỗi đêm và `BookingPromotionApplications`; confirm sao chép, không tính lại, nên sửa/tắt/hết hạn ưu đãi không đổi hold hay reservation. Migration 17 `AddBookingPromotions` (backfill `ListUnitAmount = UnitAmount`; `Down()` từ chối khi có dữ liệu ưu đãi). Quyền: `StaffPermission.PromotionManage` theo cơ sở, chỉ Manager (ADR 0009); route đóng ở LocalGate; ghi có `Version`, audit append-only, `Idempotency-Key` cho tạo. Admin_Web: `/promotions` ("Ưu đãi đặt phòng") với cổng truy cập theo vai trò cơ sở. Customer_Web: khối homepage và `/offers` đọc API công khai (ẩn khi không có, không còn dữ liệu mẫu), `/offers/[slug]`, giá gốc gạch chỉ khi có giảm, hold gửi giá khách đang xác nhận và hiện báo giá mới để xác nhận lại, receipt `/paydone` có giảm giá. Demo: `--seed-promotion-demo` (cùng quy tắc đích của Riverside seed, idempotent theo slug, không ghi đè bản sửa của Admin). Nghiệm thu trình duyệt trên DB riêng `thebha_promo_demo`; chi tiết trong `docs/reports/BHA-BOOKING-PROMOTIONS-001-completion.md`. Thiết kế: `docs/design/BHA-BOOKING-PROMOTIONS-001-booking-promotions.md`.

Cập nhật 2026-10-19 (`BHA-PRODUCT-ADMIN-001-CP01-C3-C1`, trên Draft PR #124): ba API tạo catalog có CORS policy credentialed riêng, giới hạn vào Admin origins đã cấu hình, POST, `Content-Type` và `Idempotency-Key`; Calendar/login allowlist không đổi. Admin giữ actor, parent, payload và operation ID khi kết quả chưa rõ; action `Tiếp tục yêu cầu` replay đúng cùng operation, Hủy chỉ mở khi lần thử được xác nhận an toàn. Pipeline integration, recovery regressions, build/typecheck/lint và backend/Admin suites được chạy; headless Chrome xác nhận OPTIONS rồi POST 401 không xác thực trên HTTPS. Không có sessionStorage Owner-tab operationId để ghép với operation/audit DB; read-only truy vấn tại thời điểm kiểm tra không có operation/audit rows nhưng không loại trừ request còn in-flight. Signed-in browser create/list/recovery chưa nghiệm thu; `STATUS: BLOCKED`, `IMPLEMENTATION_STATUS: IMPLEMENTATION_COMPLETE_WITH_BLOCKERS`, chờ Owner kiểm tra Draft và tiếp tục đúng operation đang lưu. Chi tiết: `docs/reports/BHA-PRODUCT-ADMIN-001-CP01-C3-C1-completion.md`.

Cập nhật 2026-10-18 (`BHA-PRODUCT-ADMIN-001-CP01-C2`, trên Draft PR #124): Admin `/products` hiện bắt đầu bằng danh sách card summary, mở detail theo lựa chọn và quay lại cùng Property; The BHA Hotel cũ được resolve/hiển thị như The BHA Riverside trên Property ID `10000000-0000-0000-0000-000000000001`, giữ slug `the-bha-hotel` và DLX/FAMILY trong vùng legacy. API summary Staff-gated không tải gallery; Riverside embed preview resolve bằng URL media allowlist để tương thích MediaId cũ. Trên DB Development `thebha_dev` mà Admin API đang dùng, seed opt-in local đã chuẩn hóa tên và thêm 3 RIV types, stock 3/2/6, gallery 6/6/9, Property gallery 10, 180 nightly demo rates cho 2026-10-18..2026-12-16; một lần rerun không có thay đổi. API HTTPS readback xác nhận 31/31 ảnh trả `image/webp`; Owner/legacy stock, 7 reservations và existing slug giữ nguyên. Xem `docs/reports/BHA-PRODUCT-ADMIN-001-CP01-completion.md` phần C2; live browser chưa chạy nếu không có browser-control harness.

Cập nhật 2026-10-18 (`BHA-PRODUCT-ADMIN-001-CP01-C1`, cùng Draft PR #124): CatalogWorkspace giữ revision/baseline gốc của draft, room selector dùng danh sách của đúng property, unknown chỉ được giải quyết bằng readback cùng owner, discard xoá draft owner và trạng thái tạm, toàn editor khóa suốt Save+readback. Regression component tests đã tái hiện đỏ F1–F5 trước sửa. Upload cleanup chỉ xóa file sau khi DB xác nhận metadata chưa commit; trạng thái DB không đọc được thì giữ file. Acceptance DB riêng `thebha_catalog_demo_c1_20261018` được tạo mới sau guard, áp migration rồi official Riverside seeder dry-run/apply; DB đối chiếu 1 property, 3 room types, 11 physical rooms và gallery 10/6/6/9 với manifest/cover. Staff nghiệm thu được tạo/cấp `WebsiteSettingsManage` bằng CLI trên DB này, sau thử nghiệm đã bị disable; credential local đã xoá. Live HTTPS API save/reload, ảnh preview, upload→Save, restart cùng PostgreSQL+`WebsiteMedia:RootPath`, unlink/public 404 và giữ file đều PASS. PostgreSQL integration mới gồm liên kết owner, lỗi storage/DB, lost acknowledgement, Origin/LocalGate/disable/revoke. Không có Chrome DevTools/browser harness được cài sẵn; UI desktop/mobile A10 `NOT_RUN`. Owner review trực tiếp theo ngoại lệ work item; không gọi reviewer. Chi tiết và lệnh tại `docs/reports/BHA-PRODUCT-ADMIN-001-CP01-completion.md` phần Correction C1.

Cập nhật 2026-10-17 (`CUST-WEB-SOCIAL-001-CP01`, Draft PR vào `develop`, implementer Codex / Owner review trực tiếp theo ngoại lệ của work item): thêm Website → Social media với một lần Lưu revisioned, migration 14 seed Phone bật `0899474888`, Messenger/Zalo tắt-trống, Về đầu trang bật; Customer có một cụm nổi root-layout, cập nhật runtime ≤15 giây. Backend chuẩn hóa số VN/tự sinh `tel:` và Zalo URL, giới hạn Messenger vào chat URL được duyệt; không xác minh account bên ngoài. Messenger/Zalo còn chờ Owner cấu hình và tự thử destination. Evidence: `docs/reports/CUST-WEB-SOCIAL-001-CP01-completion.md`, runbook `docs/runbooks/CUST-WEB-SOCIAL-001-contact-actions.md`.

Cập nhật 2026-10-17 (`CUST-WEB-HERO-001-CP01`, PR Draft mới vào `develop` sau PR #120, implementer Claude / reviewer Codex read-only do Owner gọi): Admin chỉnh slideshow hero trang chủ tại Website → Banner trang chủ (`/website/hero`, quyền `WebsiteSettingsManage`): tải ảnh lên / thay / xoá / đổi thứ tự (JPEG, PNG, WebP ≤ 10 MB, kiểm tra theo nội dung ở máy chủ), tiêu đề, mô tả, nhãn hai nút dùng chung với nhãn vi/en/fr theo ID ổn định (cơ chế bản dịch runtime sẵn có), alt/caption riêng từng ảnh, một font cho tiêu đề và mô tả (4 lựa chọn), bật/tắt tự chuyển ảnh và số giây 3–60 (mặc định 6); một lần Lưu nguyên tử, 409 khi cũ, preview trước khi lưu. Customer đọc cấu hình động (tab mở cập nhật ≤ 15 s, request mới thấy ngay, không build/restart). Migration 13 `AddWebsiteHero` (seed một lần: 4 ảnh, chữ, thứ tự, 6 giây); ảnh tải lên nằm ở `WebsiteMedia:RootPath` (thư mục do host cấp, ngoài source, cần mount bền vững), ảnh có sẵn nhúng trong API; multipart chỉ mở cho đúng một endpoint upload. Thiết kế `docs/design/CUST-WEB-HERO-001-CP01-admin-hero-slideshow.md`, vận hành `docs/runbooks/CUST-WEB-HERO-001-hero-media.md`, bằng chứng `docs/reports/CUST-WEB-HERO-001-CP01-completion.md`. Chờ Owner nghiệm thu sản phẩm và review.

Cập nhật 2026-10-16 (`CUST-WEB-HEADER-001-CP04`, PR Draft mới sau khi PR #119 đã merge, implementer Claude / reviewer Codex read-only do Owner gọi): menu header (và drawer) do Admin quản lý tại Website → Menu (cây tối đa 4 cấp, nhãn vi/en/fr theo ID ổn định, một lần Lưu nguyên tử, 409 khi cũ), Customer cập nhật không cần build/deploy (tab đang mở trong ≤ 15 s), thêm trang `/faq`; migration 12 `AddWebsiteMenus`; thiết kế `docs/design/CUST-WEB-HEADER-001-CP04-dynamic-menus-faq.md`, bằng chứng `docs/reports/CUST-WEB-HEADER-001-CP04-completion.md`. Chờ Owner nghiệm thu và review.

Cập nhật 2026-10-16 (`CUST-WEB-HEADER-001-CP02-C2-R1`, cùng PR #119, implementer Claude / reviewer Codex read-only do Owner gọi): Customer_Web đọc ngôn ngữ/tiền tệ từ API (vi/en/fr, thêm ngôn ngữ bằng gói qua Admin không cần build/restart), mọi bề mặt tiền quy đổi hiển thị (DB luôn VND), migration 11 `AddRuntimeLanguagePacks`; trạng thái, bằng chứng và giới hạn ở `docs/reports/CUST-WEB-HEADER-001-CP02-completion.md` §9, vận hành ở `docs/runbooks/CUST-WEB-HEADER-001-languages-and-rates.md`. Dịch toàn bộ Admin vận hành: chưa làm (PR sau). Chờ Owner nghiệm thu và review lại.

Cập nhật 2026-10-15 (`CUST-WEB-HEADER-001-CP02`, WEBSITE_LOCALIZATION_SETTINGS, branch `feature/cust-web-header-001-cp02-site-localization-settings` từ `develop` `3f4254d4e05dcb310f258131014637d26ddf57d7`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #118 (`CUST-WEB-HEADER-001-CP01`) đã merged tại baseline `3f4254d`; Owner xác nhận đã dọn nhánh (không xác minh trên máy Owner). CP02 thêm cấu hình **toàn site** (không theo Property) cho ngôn ngữ, bản dịch UI và tiền tệ/tỷ giá: migration 10 `AddWebsiteLocalizationSettings` (3 bảng `WebsiteLanguages`/`WebsiteTranslations`/`WebsiteCurrencies` + cột `StaffAccounts.CanManageWebsite` mặc định `false`, seed đóng băng trong migration: `vi` bật+mặc định, `en` có sẵn nhưng tắt với 25 key, VND base/mặc định tỷ giá 1, USD/EUR tắt chưa có tỷ giá), quyền site-wide `WebsiteSettingsManage` (ADR 0008; cấp/thu hồi chỉ bằng CLI `--staff-website-access --email <e> --enabled true|false`; kiểm tra từ DB mỗi request; `me`/login trả `permissions`), Admin API `/api/admin/v1/website/{languages|translations|currencies}` (đọc GET, mọi ghi POST + `expectedVersion`, `409 stale-version`, khóa advisory toàn cục), API công khai `GET /api/v1/website/config` và `/dictionary?locale=`, và ba màn Admin_Web (Website → Languages, UI translations, Currencies and rates) trên API thật. **Customer_Web chưa đọc bất kỳ phần nào** (giai đoạn sau); tỷ giá chỉ là tham chiếu, giá phòng/hold/reservation vẫn VND. Calendar, role map, session policy không đổi. Chi tiết: `docs/design/CUST-WEB-HEADER-001-CP02-website-localization-settings.md`, `docs/reports/CUST-WEB-HEADER-001-CP02-completion.md`. Codex đã review tại `923336a` (một finding P2: danh sách ISO 4217 lỗi thời) → correction `CUST-WEB-HEADER-001-CP02-C1` cùng PR #119: allowlist đồng bộ SIX List One `Pblshd=2026-09-17` (bỏ `ZWL`/`ANG`/`BGN`, thêm `XCG`, giữ `SVC`/`ZWG`, `XAD` vẫn loại), regression unit + API, browser smoke tiền tệ và bằng chứng logout-pending trên trình duyệt thật; không đổi cây Admin. Head sau correction: re-review pending (Owner gọi). Chưa deploy.

Cập nhật 2026-10-15 (`CUST-WEB-HEADER-001-CP01`, HEADER_LOGO_AND_TYPOGRAPHY, branch `feature/cust-web-header-001-cp01-logo-typography` từ `develop` `00bff78e5c7c7294648344b915a9b367138114b4`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #117 đã merged (`00bff78`); PR #114 (`CP08a`, `-C1`, `-C2`) và #115 (`CP08a-C3`) đã merged (`ec1d99e`, `b1fdd3e`), nên các câu “Draft PR”/“Review Codex và duyệt thị giác của Owner: chờ” của CP08a ngay bên dưới đã hết hiệu lực. Chỉ Customer_Web: logo `Logo.tsx` thành hai PNG trong suốt (sáng/tối, cùng hình học; bản tối chỉ đổi mực sang off-white, vàng giữ nguyên) chuyển bằng CSS `dark:`, thay JPG nền trắng gây hộp trắng ở dark mode (JPG gốc được giữ làm nguồn); chữ menu dùng Be Vietnam Pro (`--font-header`, SIL OFL 1.1, subset vietnamese) chỉ ở dải header và drawer vì Poppins không có glyph tiếng Việt ("Ư" rơi xuống serif), một thang chung (menu chính 15/16px weight 500, submenu 14px weight 400). Không đổi tên/link/thứ tự menu, ngôn ngữ/tiền tệ, backend/Admin/dependency. Bằng chứng trên production build cây frontend `def73bb620f1b1029e92f9aeda0615e17dd0d94d` (Chrome 153, API + PostgreSQL demo, khách ẩn danh): vòng logo đỏ 37/74 (toàn dark) → xanh 0/74; font `Ưu đãi` Poppins+Liberation Serif → Be Vietnam Pro; 0/24 tổ hợp tràn ngang; 312/312 kiểm tra tương tác, 0 POST đặt phòng; tsc/lint sạch, Vitest 1152/1152, build 0. `HEADER_LOGO_DARK_MODE`: `FIXED_VERIFIED_LOCAL`; `HEADER_VIETNAMESE_TYPOGRAPHY`: `FIXED_VERIFIED_LOCAL`; body, hero và app bar dưới vẫn Poppins (ngoài scope); `LIVE_DEPLOY_VERIFICATION`: `NOT_RUN`; Review Codex và duyệt thị giác của Owner: chờ. Evidence: `docs/reports/CUST-WEB-HEADER-001-CP01-completion.md`.

Cập nhật 2026-10-14 (`CUST-WEB-001-CP08a-C2`, OWNER_PRODUCT_REVISION, cùng PR #114; implementer Claude / reviewer Codex read-only do Owner gọi): theo yêu cầu Owner sau khi xem preview, `/` trở thành cổng đặt phòng (slideshow 4 ảnh Đà Nẵng CC0/CC BY/CC BY-SA full width + form tìm phòng thật, ưu đãi mẫu, điểm đến, tin tức, newsletter UI), trang Riverside nguyên vẹn ở `/riverside`, header khôi phục menu Chisfis (Dịch vụ, Giao diện mẫu, Ngôn ngữ/Tiền tệ chỉ là UI) và nút sáng/tối thật ở mọi độ rộng, thêm `/offers`, `/blog` (+ `/blog/<slug>` từ một registry có nguồn), `/media-credits`; “Tài khoản của tôi” đi qua `/login?returnTo=/account` (allowlist chặt). Chỉ Customer_Web + docs; không backend/schema/CD, không migration, không biến môi trường mới. Acceptance trên production build cây `5acb2f5676f3ff99d8238ff9f20fab8e1c2141a0`: 507 entry = 485 PASS + 18 FINDING kế thừa + 2 NOT_RUN (+2 INFO), 0 FAIL; ba lượt đặt phòng thật (khách desktop, khách mobile, đã đăng nhập) +1 hold +1 reservation `Confirmed` mỗi lượt. Lỗi thật được sửa: vuốt hero quay lại trang trước, slug blog lạ trả HTTP 200, ô tìm kiếm gọn tràn header ở 390 px. Chưa có: lưu/gửi newsletter, giảm giá thật, i18n/quy đổi tiền, House/Villa, deploy/Vercel live. Review Codex và duyệt thị giác của Owner: chờ.

Cập nhật 2026-10-14 (`CUST-WEB-001-CP08a-C1`, AUTH_BROWSER_EVIDENCE, docs-only, cùng PR #114): OC yêu cầu bổ sung browser evidence cho auth pending/recovery (MEP CP08a §9). Trên production build đúng cây frontend `8e5235187f33b25047ff8559176943f305bcf3ac` (không đổi so với C0), Chrome 153 desktop + mobile, API baseline + PG 18.3 dùng một lần: logout pending (giữ trước khi gọi API) rồi hoàn tất, và recovery chưa xác minh (logout mất phản hồi sau commit + `me` 503) rồi “Kiểm tra lại” — header/footer/app bar biểu đạt đúng trạng thái, booking bị chặn trước network, không lệnh auth thứ hai hay thử lại tự động, UI cuối khớp `GET me` thật; 75 mục = 73 PASS + 2 FINDING (baseline: Esc không đóng menu tài khoản khi pending). Không đổi source. `AUTH_PENDING_RECOVERY_BROWSER: VERIFIED_AT_UNCHANGED_FRONTEND_TREE`; FINDING `GallerySlider` kế thừa vẫn mở; `LIVE_DEPLOY_VERIFICATION: NOT_RUN`; `COMMERCIAL_READINESS: NOT_CERTIFIED`. Evidence: `docs/reports/CUST-WEB-001-CP08a-completion.md` §12. Dòng CP08a ngay bên dưới nói pending/recovery chưa có browser run đã được khép bởi C1.

Cập nhật 2026-10-14 (`CUST-WEB-001-CP08a`, HOMEPAGE_RIVERSIDE_RELEASE, branch `feature/cust-web-001-cp08a-riverside-homepage-release` từ `develop` `c989fc355d26d5c3e061e4dcdadaffa583b68bc9`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi; Owner đổi thứ tự roadmap có chủ đích): PR #113 (`CP05a`) đã merged (`c989fc3`, CI `38503158977` success). CP08a chỉ Customer_Web: trang chủ là The BHA Riverside (hero một H1 + ảnh property, loại phòng thật ở dạng browse không giá, lý do đặt, thư viện ảnh property, ba bước, vị trí và FAQ); header/drawer/app bar/footer chỉ dẫn tới nơi chạy được; mọi điểm vào tìm kiếm (hero, header mobile kể cả trang phòng) đi qua một quyết định tới URL `/listing-stay` chuẩn bằng một navigation (`HOME_GLOBAL_HEADER_SEARCH: CANONICAL_LISTING_URL`); trang chủ không hỏi availability và không giữ giá (`HOME_PRICES: DATED_RESULTS_ONLY — NO_STALE_HOME_QUOTES`); House/Villa hoãn (`HOUSE_VILLA: DEFERRED_NOT_BOOKABLE`). Không đổi backend/Admin/foundation/migration. `DEMO_CANDIDATE: VERIFIED_LOCAL`, `LIVE_DEPLOY_VERIFICATION: NOT_RUN`, `COMMERCIAL_READINESS: NOT_CERTIFIED`; `DP-01`…`DP-11` vẫn `OPEN`; `CUSTOMER_WEBSITE: NOT_COMPLETE`. Evidence: `docs/reports/CUST-WEB-001-CP08a-completion.md`. Các dòng CP05a ngay bên dưới nói “search ở header/trang chủ không đổi (chờ CP08)” đã hết hiệu lực: CP08a đã chuyển các điểm vào đó sang URL chuẩn.

Cập nhật 2026-10-14 (`CUST-WEB-001-CP05a`, LIVE_STAY_RESULTS_URL_PARAMS, branch `feature/cust-web-001-cp05a-live-stay-results` từ `develop` `b6706f621a99dd9ce0c242e5a1ffae59849c0b7b`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #112 (`CP04`) đã merged (`b6706f6`, CI `38423874866` success). CP05a chỉ Customer_Web: `/listing-stay` là trang catalog/availability thật của The BHA Riverside với **URL là nguồn tìm kiếm** (`SEARCH_QUERY_AUTHORITY: URL`; parser/serializer `stayListingQuery.ts`, controller `stayListingSearch.ts`), form riêng có draft, thẻ `RoomTypeStayCard` không rating/tim mẫu, giá từ offer đúng property/roomType/query, không giữ chỗ khi tải/đổi URL; `/listing-stay-map` là alias redirect (`LISTING_MAP_ROUTE: ALIAS_TO_RESULTS — MAP_NOT_IMPLEMENTED`); House/Villa giữ “Chưa hỗ trợ đặt phòng trực tuyến” (`HOUSE_VILLA_BOOKABLE: NO_NEW_ACTIVATION`). Search ở header/trang chủ **không đổi** (`HOME_GLOBAL_HEADER_SEARCH: UNCHANGED_BASELINE — FOLLOW_UP`, thống nhất ở `CP08`). Không đổi backend/Admin/foundation. `DP-01`…`DP-11` vẫn `OPEN`; `CUSTOMER_WEBSITE: NOT_COMPLETE`. Evidence: `docs/reports/CUST-WEB-001-CP05a-completion.md`. Dòng CP04 ngay bên dưới (“Draft PR”) đã hết hiệu lực: CP04 đã merged (PR #112).

Cập nhật 2026-10-13 (`CUST-WEB-001-CP04`, CUSTOMER_ACCOUNT_READ_UI, branch `feature/cust-web-001-cp04-customer-account-read` từ `develop` `127850780ac6b2fbd96febe8aa45d8679c9d500d`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #111 (`CP03` + `C1`) đã merged (`1278507`). CP04 chỉ Customer_Web: `/account` thật, chỉ đọc email từ `me` của provider (`ACCOUNT_DATA_AUTHORITY: PROVIDER_ME_ONLY`); anonymous đã xác minh → `/login`, `loading`/`unknown`/pending không redirect và không lộ email; `/account-password|billing|savelists` hiện “Chức năng này chưa được hỗ trợ”; mục “Tài khoản” ở header/mobile/`FooterNav` theo `me`. Không đổi backend/foundation. Lịch sử/ownership API/chỉnh sửa hồ sơ `NOT_IMPLEMENTED`; `DP-01`…`DP-11` vẫn `OPEN`; `CUSTOMER_WEBSITE: NOT_COMPLETE`. Evidence: `docs/reports/CUST-WEB-001-CP04-completion.md`. Dòng CP03 ngay bên dưới (“Draft PR”) đã hết hiệu lực: CP03 + C1 đã merged (PR #111).
Cập nhật 2026-10-13 (`CUST-WEB-001-CP03`, CUSTOMER_SIGNUP_UI, branch `feature/cust-web-001-cp03-customer-signup-ui` từ `develop` `cdf41cf74dc1b6a1d870b073109603dcb9448dea`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #110 (`CP02`) đã merged (`cdf41cf`). CP03 chỉ Customer_Web: `/signup` thật gọi `register`; `register` **không** tạo session, không đi qua identity coordinator, không đổi hold/receipt; thành công chỉ là “tạo tài khoản, chưa đăng nhập” + CTA `/login`. `REGISTER_CREATES_SESSION: NO`; tài khoản/lịch sử (CP04+) `NOT_IMPLEMENTED`; `DP-01`…`DP-11` vẫn `OPEN`; `CUSTOMER_WEBSITE: NOT_COMPLETE`. Correction `CP03-C1` (finding F1, P2): thông báo signup thành công không còn nói “Bạn chưa đăng nhập” khi provider `unknown`/`loading` — kết quả tạo tài khoản và hiểu biết về phiên được tách riêng; `register` vẫn không tạo session. Evidence: `docs/reports/CUST-WEB-001-CP03-completion.md` (mục C1). Dòng CP02 ngay bên dưới (“Draft PR”) đã hết hiệu lực: CP02 đã merged (PR #110).
Cập nhật 2026-10-13 (`CUST-WEB-001-CP02`, CUSTOMER_LOGIN_LOGOUT_AND_IDENTITY_UI, branch `feature/cust-web-001-cp02-customer-auth-ui` từ `develop` `1964a7b4cebb4595eaab2c7aee5525a1e40fa2d8`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #109 (`CP01b` + `C1`) đã merged (`1964a7b`). CP02 chỉ Customer_Web: `/login` thật, mục tài khoản theo `me` ở Header 1/2/3, mobile và `FooterNav`, UI trạng thái guard/recovery, nút “Đóng biên nhận”; không đổi backend/foundation. Owner chỉ kích hoạt lõi đăng nhập/đăng xuất; đăng ký (CP03), tài khoản/lịch sử (CP04+) `NOT_IMPLEMENTED`; `DP-01`…`DP-11` vẫn `OPEN`; `CUSTOMER_WEBSITE: NOT_COMPLETE`. Evidence: `docs/reports/CUST-WEB-001-CP02-completion.md`. Đoạn CP01b ngay bên dưới (“Draft PR”, “chưa có UI”) đã hết hiệu lực.

Cập nhật 2026-10-13 (`CUST-WEB-001-CP01b`, BOOKING_IDENTITY_CHANGE_GUARD, branch `feature/cust-web-001-cp01b-booking-identity-guard` từ `develop` `c81f06f68cb16b6a2e5e74976c20c0654789e353`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #108 (`CUST-WEB-001-CP01a` + `C1`) đã merged (merge `c81f06f`, CI run `38352160727` success trên đúng commit); contract Customer vẫn `PROPOSAL`, `DP-01`…`DP-11` vẫn `OPEN`. CP01b chỉ Customer_Web: `src/lib/customerIdentityChange.ts` (coordinator), `CustomerSessionProvider.tsx` (guarded login/logout, binding), `BookingHoldProvider.tsx`, `bookingHoldFlow.ts`/`bookingHoldFlowController.ts` (reset draft, `finishBooking`, mirror đồng bộ, guard hai chiều), `customerSession.ts` (`read`, `beginIdentityChange`). Không UI đăng nhập/đăng ký/đăng xuất/tài khoản (`CP02+`), không đổi backend/transport/CSRF. **Quyết định Owner 2026-10-13: bỏ mọi giới hạn và mục tiêu số dòng PR** (áp dụng cho CP01b trở đi; governance chưa đồng bộ). Correction `CP01b-C1` (cùng PR): transport outcome `refused` chỉ cho `400/401/429`; 5xx/408/status lạ ⇒ `lost`. Evidence: `docs/reports/CUST-WEB-001-CP01b-completion.md`. Các câu “Draft PR” của CP01a/CP00 ngay bên dưới đã hết hiệu lực.

Cập nhật 2026-10-13 (`CUST-WEB-001-CP01a`, CUSTOMER_SESSION_FOUNDATION, branch `feature/cust-web-001-cp01a-session-foundation` từ `develop` `3be18c3384af9f10bea783f5efc0463b5181f48a`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #107 (`CUST-WEB-001-CP00`) đã merged (merge `3be18c3`, CI run `38344533208` success trên đúng commit); contract Customer vẫn `PROPOSAL`, `DP-01`…`DP-11` vẫn `OPEN`. CP01a chỉ Customer_Web: `src/lib/api/authService.ts`, `src/lib/customerSession.ts`, `src/app/CustomerSessionProvider.tsx` (root, chỉ đọc `GET /api/v1/auth/me`), sửa generation trong `src/lib/api/csrf.ts`. Không UI đăng nhập/đăng ký/đăng xuất/tài khoản (`CP02+`), không khoá đổi danh tính (`CP01b`), không đổi backend. Correction `CP01a-C1` (cùng PR): kiểm generation CSRF ngay lúc dispatch và sửa hai hook test để `tsc` exit 0. Evidence: `docs/reports/CUST-WEB-001-CP01a-completion.md`. Cập nhật CP00 ngay bên dưới (“Draft PR”, “đang thực thi”) đã hết hiệu lực.

Cập nhật 2026-10-13 (`CUST-WEB-001-CP00`, CUSTOMER_PRODUCT_AND_RELEASE_CONTRACT, docs-only, branch `docs/cust-web-001-cp00-product-contract` từ `develop` `2ad2bc967735931a9390112d796c3cdd870ed1df`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): Owner đã chuyển trọng tâm sang Customer frontend; không mở rộng Calendar/Admin. Checkpoint này chỉ audit và viết hợp đồng sản phẩm/release `docs/design/CUST-WEB-001-product-contract.md` (`PROPOSAL`, chưa Owner duyệt; mọi quyết định `OPEN`) và report `docs/reports/CUST-WEB-001-CP00-completion.md`; không đổi source, test, config, schema; không chạy trình duyệt/build. Customer web: `CUSTOMER_WEBSITE: NOT_COMPLETE`. Checkpoint triển khai đầu tiên được đề xuất (chưa kích hoạt): `CUST-WEB-001-CP01a` — client auth + provider `me` + làm mới CSRF (kế tiếp `CP01b`: khoá đổi danh tính). **Active-status narration bị thay thế bởi cập nhật này** (giữ nguyên các đoạn lịch sử bên dưới, gắn với SHA cũ): các câu “Draft, chưa merge” của PR #83 (`CUST-WEB-SHOWCASE-001-CP02`) nay lỗi thời — Git: PR #82 (`9ad8edc`), #83 (`6ae3fdd`), #86 `release: The BHA Riverside booking showcase` (`57fc1b7`), #87/#89 proxy Customer (`f3c9616`/`45511fb`) đều merged; PR #106 (`PMS-CAL-004-CP01`, merge `2ad2bc9`) merged `2026-10-12`, nên đoạn “Draft PR” của `PMS-CAL-004-CP01` ngay bên dưới đã hết hiệu lực. Tại baseline: 0 PR mở; CI run `38274194162` (Backend/Frontend/Admin) success trên `2ad2bc9`; Backend image run `38274194088` success (không chứng minh Backend CD/live deploy); commit status Vercel “the-bha-hotels-booking” success, “the-bha-hotels-booking-p5rj” failure (chưa điều tra, ngoài CP00).

Cập nhật 2026-10-12 (`PMS-CAL-004-CP01`, INACTIVE_ROOM_BLOCK_VISIBILITY, branch `feature/pms-cal-004-cp01-inactive-room-block-visibility` từ `develop` `ab838897861d3e636c4e7433b5898e3eb9c0ae0e`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #105 (`PMS-CAL-003-CP03`) đã merged, `PMS-CAL-003` đóng với qualifier lịch sử. Backend: `GET …/reservation-board` trả mọi phòng Active của Property **cộng** phòng Inactive/OutOfService cùng Property có Effective block giao với window (cùng predicate cũ; không thêm theo Cancelled/ngoài window/chỉ chạm biên half-open/chỉ assignment/Property khác/phòng inactive không có block), `operationalStatus` thật qua raw-data shape tới DTO (bỏ gán cứng `Active`), mỗi phòng một dòng, `roomTypes` gồm type của phòng bổ sung (kể cả type inactive), vẫn một RepeatableRead snapshot (query block chạy trước query phòng, gắn tag `OperationalBlocksQueryTag`), không route/field/enum/auth/schema mới. Admin_Web: `ReservationBoardServerTimeline` vẽ dòng phòng kèm trạng thái, header RoomType cho phòng được liệt kê nhưng chỉ type có phòng **Active** mới giữ Unassigned lane rỗng; `Move block…`/`Cancel block` hiện hữu dùng được từ bar của phòng inactive; mọi destination vẫn Active-only (pickers, drag, callback ép). Test: backend 244 unit + 930 integration (+10) trên PostgreSQL 18.3 cô lập; Admin 1660 Vitest (50 file), lint/tsc/build sạch; mutation 11/11 bị bắt. RED ở baseline được tái hiện (6 test thất bại). Nghiệm thu thật (Chrome, Admin build production, Kestrel Staff, PostgreSQL 18.3 cô lập): GET thật trả trạng thái inactive **trước** khi mở dialog; move (FrontDesk, OutOfService; Manager, Inactive, khác RoomType) và cancel thành công, một POST mỗi lần, status phòng/commercial không đổi; hai segment cùng header trên một phòng: row giữ khi còn sibling, biến mất sau segment cuối; mất phản hồi sau commit → `unknown`, hai phòng khóa, reload không gửi lại, reread → `observed`. `INACTIVE_BLOCK_BOARD_VISIBILITY`: `IMPLEMENTED`; `INACTIVE_SOURCE_MOVE_CANCEL_ISOLATED_REAL_API`: `PASS`; `PMS_CAL_003_INACTIVE_SOURCE_QUALIFIER`: `RESOLVED_BY_NEW_EVIDENCE` (hàng PARTIAL của CP03 giữ nguyên tại SHA cũ); `PMS_CAL_004`: `IMPLEMENTED_AWAITING_OWNER_REVIEW_MERGE`; `OLD_BUILD_DOWNGRADE_RUNTIME`: `NOT_VERIFIED`. Inventory/sellability Active-only, giới hạn storage-readback của CP03, lifecycle/folio/templates vẫn như cũ; không cloud/deploy; Backend CD AWS `PAUSED / NOT_COMPLETE`. Chi tiết: `docs/reports/PMS-CAL-004-CP01-completion.md`, `docs/design/PMS-CAL-004-inactive-room-block-visibility.md`.

Cập nhật 2026-10-12 (`PMS-CAL-003-CP03`, BLOCK_MOVE_DIALOG_BOARD_ACCEPTANCE, branch `feature/pms-cal-003-cp03-block-move-dialog-board-acceptance` từ `develop` `3dfab2954a169a58ed4c7a7e1dd3b2b4a2ecaf48`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #104 (`PMS-CAL-003-CP02`) đã merged. Chỉ Admin_Web. Popover block có `Move block…` cạnh `Cancel block` (FrontDesk và Manager, kể cả khác RoomType, không xác nhận cross-type; disabled kèm lý do khi board stale/đang chờ re-read/segment hoặc phòng còn unresolved/không có phòng đích/khoảng không hợp lệ hoặc >366 đêm — block đó vẫn cancel được), `ReservationBlockMoveDialog` (full đêm của segment, header reason *unchanged*, chọn phòng Active, reason tùy chọn ≤500, không ô ngày/xác nhận), `blockMoveSubmission.ts` (offer + plan gửi + khóa, thuần) và `submitBlockMove` trong board: kiểm lại tại thời điểm gửi từ ref sống (key/board/header/id/version/phòng/khoảng, phòng đích, quyền, sign-out/access-check, storage, board chờ re-read, `isBlockSegmentWriteUnresolved` — nay cũng chặn cancel hiện hữu — và khóa hai phòng toàn khoảng), một request, `unknown` giữ một record + khóa hai phòng, `200` luôn là moved, thông báo chỉ vẽ trên board gốc. Test: 1643 Vitest (49 file), lint/tsc/build sạch; mutation 44 (43 bị bắt, 1 tương đương). Nghiệm thu thật (Chrome 153, build production, Kestrel Staff, PostgreSQL 18.3 cô lập, proxy lỗi ngoài sản phẩm): ma trận 1–9 PASS; phát hiện `physicalRooms` của API chỉ trả phòng Active nên block ở phòng không Active không hiện trên board (ghi nhận, chưa sửa). `UI_OPERATIONAL_BLOCK_MOVE`: `IMPLEMENTED`; `BLOCK_MOVE_ISOLATED_REAL_API`: `PASS`; `PMS_CAL_003`: `IMPLEMENTED_AWAITING_OWNER_REVIEW_MERGE`; `OLD_BUILD_DOWNGRADE_RUNTIME`: `NOT_VERIFIED`. Không cloud/deploy; Backend CD AWS vẫn `PAUSED / NOT_COMPLETE`. Chi tiết: `docs/reports/PMS-CAL-003-CP03-completion.md`, `docs/design/PMS-CAL-003-operational-block-move.md` §6.

Cập nhật 2026-10-12 (`PMS-CAL-003-CP02`, BLOCK_MOVE_CLIENT_TARGET_RECONCILIATION_STORAGE, branch `feature/pms-cal-003-cp02-block-move-client-reconciliation-storage` từ `develop` `1a09e656af128a6df93875bb5ae12de8f70ce435`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #103 (`PMS-CAL-003-CP01`, backend) đã merged. Chỉ Admin_Web, **nền** cho block move, chưa có action/dialog/đường gửi: client `moveOperationalBlock` (một lần gửi, body đúng `expectedVersion`+`destinationPhysicalRoomId`+`reason?`, `200` luôn là moved, 403/404 không detail, không nhánh cross-RoomType), `buildBlockMoveTarget` (khớp chính xác header/segment/version/phòng/khoảng, ngày Gregorian thật, 1…366 đêm, phòng nguồn có thể không Active, ứng viên là phòng Active khác nguồn và không phải bằng chứng capacity), target reconcile `move` (`observed` chỉ khi nguồn không còn hiện và có segment khác id cùng header ở phòng đích đúng đêm; nguồn còn nguyên → `unresolved`; còn lại `changed`, không khẳng định đã lưu), khóa cả phòng nguồn lẫn phòng đích trên toàn bộ đêm xuyên mọi view, predicate `isBlockSegmentWriteUnresolved` (cancel/move cùng segment — CP03 sẽ nối), và record `move` trong storage v1 (giữ hai key và thuật toán token; không lưu reason/actor/PII; parser chặt). `UncertainBlockNotice` chỉ thêm wording cho move khôi phục. Test: 1464 Vitest (46 file), lint/tsc/build sạch, mutation guard bị bắt (1 mutant tương đương). `UI_OPERATIONAL_BLOCK_MOVE`: `NOT_IMPLEMENTED`; `PMS_CAL_003`: `IN_PROGRESS` (CP03 chưa bắt đầu); `OLD_BUILD_DOWNGRADE_RUNTIME`: `NOT_VERIFIED`. Không cloud/deploy; Backend CD AWS vẫn `PAUSED / NOT_COMPLETE` (hai cờ release do Owner ghi `false` ở bước trước, CP02 không đọc lại/đổi). Chi tiết: `docs/reports/PMS-CAL-003-CP02-completion.md`, `docs/design/PMS-CAL-003-operational-block-move.md`.

Cập nhật 2026-10-12 (`PMS-CAL-003-CP01`, OPERATIONAL_BLOCK_MOVE_API, branch `feature/pms-cal-003-cp01-operational-block-move-api` từ `develop` `c7041c17ef619ecac90d2d2f1ed7869b9eb21b0b`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #102 (`PMS-CAL-002-CP05`) đã merged sau review của Owner và isolated acceptance; **`PMS-CAL-002` (split-move) đóng**, chưa deploy production. Chỉ backend: thêm `MoveOperationalBlockCommand` + `IOperationalBlockMutationStore.MoveAsync` (adapter hẹp: đọc phòng/đêm gốc của segment bằng pre-read AsNoTracking theo Id+Property+Type OperationalBlock, từ chối cùng phòng và nguồn dài hơn 366 đêm bằng `Invalid` trước khi engine liệt kê, rồi uỷ quyền đúng một supersession một replacement cho `SupersedeSegmentsAsync` **không đổi**) và route `POST /api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/move` (body `expectedVersion`, `destinationPhysicalRoomId`, `reason?`; 200 `[source Cancelled, successor Effective]`; 400/401/403/404/409/415 như create/cancel). Chỉ cần `BlockWrite` (FrontDesk và Manager, kể cả khác RoomType; không có evidence/xác nhận cross-RoomType vì block không có sold RoomType); actor `staff:{id}` hoặc hằng LocalGate; RoomBlock header, đêm, booking/giá không đổi. Tests trên PostgreSQL 18.3 task-owned: store (full-state trước/sau cho mọi refusal, overlap/capacity/hold, span 366/367/cực đoan, race move/move, move/cancel, tranh phòng đích và capacity) và API/Staff/OpenAPI; 11/11 mutation guard bị bắt. `HTTP_OPERATIONAL_BLOCK_MOVE`: `IMPLEMENTED`; `UI_OPERATIONAL_BLOCK_MOVE`: `NOT_IMPLEMENTED`; `PMS_CAL_003`: `IN_PROGRESS` (CP02 client/reconciliation/storage và CP03 dialog/board/browser **chưa bắt đầu**); block split/resize/batch/swap, lifecycle, folio, template vẫn TARGET/DEFERRED. Không cloud, không deploy; Backend CD AWS vẫn `PAUSED / NOT_COMPLETE` (hai cờ release do Owner ghi `false` ở bước trước, CP01 không đọc lại/đổi). Chi tiết: `docs/reports/PMS-CAL-003-CP01-completion.md`, `docs/design/PMS-CAL-003-operational-block-move.md`.

Cập nhật 2026-10-12 (`PMS-CAL-002-CP05`, SPLIT_MOVE_BOARD_WIRING_AND_ISOLATED_BROWSER_ACCEPTANCE, branch `feature/pms-cal-002-cp05-split-move-board-acceptance` từ `develop` `6e31cfda92eb5a81356ca60366867adb7d28fc01`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #101 (`PMS-CAL-002-CP04`) đã merged (`6e31cfd`). Chỉ Admin_Web: popover có action **`Move from a date…`** cho segment đã gán ≥ 2 đêm (FrontDesk/Manager; disabled kèm lý do khi board cũ, đang chờ re-read, có move/unassign/split-move chưa chắc chắn trên segment hoặc phòng, hoặc — với FrontDesk — nguồn đang ở RoomType khác loại đã bán); `ReservationBoard` mount `ReservationSplitMoveDialog` và gửi **đúng một** request `POST …/split-move` qua seam thuần `splitMoveSubmission.ts`, kiểm lại tại thời điểm gửi trên board hiện tại (board/key, segment id+version+phòng+khoảng, ngày Gregorian thật nằm trọn bên trong, phòng đích còn Active và khác nguồn, cross-RoomType prefix HOẶC suffix → Manager + xác nhận + reason ≤ 500, acknowledgement ngày quá khứ so với `localToday` hiện tại của Property), body 5 trường dựng từng field, khóa phòng-đêm (nguồn cả khoảng, đích từ `splitDate`), pending intent/record trước khi gửi, Sign out bị chặn khi đang bay; `isSegmentAssignmentWriteUnresolved` nay gate move/unassign/drag/split-move theo segment id. Không optimistic bar; `200` luôn là đã lưu; kết quả chỉ hiện trên board gốc. **Acceptance Chrome thật** (Chrome 153, Staff mode, Kestrel API, PostgreSQL 18.3 loopback scratch, fault injection bằng proxy task-owned ngoài product code): FrontDesk same-type; Manager suffix-only/prefix-only/both-cross (evidence mới chỉ ở successor cross-type); ngày quá khứ (zero POST khi chưa acknowledge; cross+past độc lập); 409 stale version và capacity; unknown sau khi server đã commit → `observed`; unknown API không nhận → `unresolved` rồi `changed`; cửa sổ chỉ thấy suffix không phải `observed`; reload khi pending/giữ GET; sign-out/sign-in giữ record, không gửi lại; điều hướng trước confirm/khi pending; 403 chung sau khi hạ role; lỗi storage phía trình duyệt; smoke assign/move/drag/unassign/block create+cancel. Commercial snapshot không đổi. Test: 1338 Vitest (+104), lint/tsc/build sạch, 25/25 mutation bị bắt. `UI_SPLIT_MOVE_BOARD`: `IMPLEMENTED`; `UI_SPLIT_MOVE_ISOLATED_REAL_API`: `PASS`; `PMS_CAL_002`: `IMPLEMENTED_AWAITING_OWNER_REVIEW_MERGE` (milestone split-move, **không** phải mọi tính năng PMS: lifecycle/folio/template vẫn chưa nối backend). `OLD_BUILD_DOWNGRADE_RUNTIME`: `NOT_VERIFIED`. Chưa deploy; không cloud; `LIVE_DEPLOY`/`CLOUD_CALLS`: `NOT_RUN`. Backend CD AWS vẫn `PAUSED / NOT_COMPLETE` (hai cờ release do Owner ghi `false` ở bước trước, CP05 không đọc lại/đổi, không dispatch/publish/deploy). Chi tiết: `docs/reports/PMS-CAL-002-CP05-completion.md`, `docs/design/PMS-CAL-002-split-move.md`, `docs/runbooks/PMS-ADMIN-AUTH-001-staff-calendar.md`.

Cập nhật 2026-10-12 (`PMS-CAL-002-CP04`, SPLIT_MOVE_DIALOG, branch `feature/pms-cal-002-cp04-split-move-dialog` từ `develop` `fc5e29024bd9ec7a7699162fc586faa336cd1627`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #99 (`PMS-CAL-002-CP03`) và #100 (`-CP03-C1`) đã merged (`fc5e290`). **Owner chốt D4 và D6 theo đề xuất (APPROVED 2026-10-12)**: server giữ nguyên không có luật today; dialog cảnh báo `splitDate < localToday` (ngày của Property, không phải trình duyệt) và đòi acknowledgement RIÊNG (mặc định bỏ chọn, độc lập với xác nhận cross-RoomType, không bắt buộc reason chỉ vì ngày quá khứ); D6 không thêm luật check-in/lifecycle hay repricing. D1–D6 đều APPROVED. Chỉ Admin_Web, thêm `ReservationSplitMoveDialog.tsx` **chưa mount ở đâu** và không có đường gửi (không import client; chỉ nhận `onSubmit` từ parent — CP05): cận ngày `start+1 … end-1` trên lịch Gregorian thật 0001–9999 (`splitMoveDates.ts`, dùng lại `gregorianDayNumber` được export từ `splitMoveTarget.ts`), preview nửa-mở hai phần, mặc định `localToday` chỉ khi nằm trọn bên trong, nguồn một đêm/range lỗi/`localToday` lỗi thì fail closed, cross-RoomType = prefix HOẶC suffix khác loại đã bán (Manager, xác nhận + reason ≤ 500), một submit đồng bộ, không đóng khi đang gửi, kết quả terminal không gửi lại, target đổi thì từ chối, và `describeSplitMoveOutcome` cho 6 loại kết quả (unknown = có thể đã hoặc chưa lưu). `UI_SPLIT_MOVE_ACTION`: `NOT_IMPLEMENTED`; `SPLIT_MOVE_DIALOG`: `IMPLEMENTED_UNMOUNTED`; CP05 chưa bắt đầu (cần Chrome + API thật + PostgreSQL scratch). Backend CD AWS vẫn `PAUSED / NOT_COMPLETE` (CP04 không đọc/đổi cờ, không gọi cloud). Chi tiết: `docs/reports/PMS-CAL-002-CP04-completion.md`, `docs/design/PMS-CAL-002-split-move.md`.

Cập nhật 2026-10-12 (`PMS-CAL-002-CP03`, SPLIT_MOVE_CLIENT_TARGET_RECONCILIATION_STORAGE, branch `feature/pms-cal-002-cp03-split-move-client-reconciliation-storage` từ `develop` `402c8f8`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #98 (`PMS-CAL-002-CP02`) đã merged (merge `402c8f8d48a9701e84d0465a26691c0a1a29bd30`); `main` vẫn `0243160`, không promote. Chỉ Admin_Web, **nền** cho split-move, chưa có action/dialog/đường gửi: client `splitMoveReservationAssignment` (một lần gửi, body đúng 5 trường dựng từng field, `200` luôn là thành công), `buildSplitMoveTarget` (khớp chính xác id/version/phòng/khoảng, nguồn ≥ 2 đêm, `localToday` chỉ là dữ kiện), target reconcile `split-move` (`observed` chỉ khi cửa sổ board có `from < splitDate < to` và thấy đủ hai successor đúng phòng/đêm; nguồn còn nguyên → `unresolved`; còn lại `changed`), khóa phòng-đêm (phòng nguồn cả khoảng, phòng đích từ `splitDate`), predicate theo segment id dùng chung cho move/unassign/split-move (đã có và test, **chưa nối**, CP05 sẽ nối) và record `split-move` trong storage tab v1 (giữ `FORMAT_VERSION=1`, record cũ đọc nguyên). `UncertainWriteNotice` chỉ được thêm cách mô tả "room split-move" cho record khôi phục. OC hoãn phụ thuộc D4 ("today flag") sang CP04 — CP03 không tạo luật ngày quá khứ/xác nhận nào; D4 và D6 vẫn OPEN, lệnh tiếp tục không phải Owner phê duyệt. `UI_SPLIT_MOVE_ACTION_DIALOG`: `NOT_IMPLEMENTED`; CP04–CP05 chưa bắt đầu. Backend CD AWS vẫn `PAUSED / NOT_COMPLETE` (hai cờ release do Owner ghi `false` ở bước trước, CP03 không đọc lại, không gọi cloud, không đổi cờ). Chi tiết: `docs/reports/PMS-CAL-002-CP03-completion.md`, `docs/design/PMS-CAL-002-split-move.md`.

Cập nhật 2026-10-12 (`PMS-CAL-002-CP03-C1`, TARGET_CALENDAR_RANGE_AND_EVIDENCE, branch `feature/pms-cal-002-cp03-c1-target-calendar-range-evidence` từ `develop` `999cb59`): PR #99 đã merged (`999cb59`) và nhánh cũ bị xóa trước khi sửa, nên C1 đi trên nhánh mới + Draft PR mới (nội dung `999cb59` ≡ `dc8a634`). Sửa `buildSplitMoveTarget`: guard "≥ 2 đêm" trước đây dùng `diffDaysIso` (`Date.UTC` ánh xạ năm 0–99 → 1900–1999) nên từ chối nguồn hợp lệ `[0099-12-31, 0100-01-02)` và để range lỗi (`NaN`) lọt qua; nay đếm bằng số học Gregorian 0001–9999 ngay trong `splitMoveTarget.ts` (`dateMath.ts` không đổi), từ chối ngày không tồn tại/năm 0000/đảo/rỗng, giữ nguyên chuỗi ngày của server. Đính chính bằng chứng: hành vi build cũ/downgrade là `NOT_VERIFIED` (chỉ có source inspection đường parse dự kiến; pending intent lạ → dự kiến `beginPendingWrite` từ chối, outcome record lạ → dự kiến cảnh báo "could not be restored", không khẳng định khôi phục lock hay chặn mọi write); fixture v1 literal chứng minh tương thích tiến với parser hiện tại, test `split-move-v2` chỉ chứng minh parser hiện tại. Review của `dc8a634` không bao phủ C1 (`REVIEW_CP03_C1: NOT_RUN — OWNER_ONLY`). D4/D6 vẫn OPEN; CP04–CP05 chưa bắt đầu; CD `PAUSED / NOT_COMPLETE`. Chi tiết: `docs/reports/PMS-CAL-002-CP03-completion.md` §9.

Cập nhật 2026-10-10 (`PMS-CAL-002-CP02`, HTTP_SPLIT_MOVE_STAFF_AUDIT, branch `feature/pms-cal-002-cp02-http-split-move-staff-audit` từ `develop` `81acab8`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): PR #97 (`PMS-CAL-002-CP01`) đã merged (merge `81acab8`). Owner chốt thêm D3 (reason tùy chọn khi cả hai successor cùng RoomType đã bán, bắt buộc khi prefix hoặc suffix khác loại) và D5 (route/response/`LocalGate`); D4 và D6 còn OPEN. Mở **đúng một** route `POST /api/admin/v1/properties/{propertyId}/reservation-assignments/{segmentId}/split-move`, mỏng trên `SplitMoveAsync` của CP01, cùng attribute Staff/`LocalGate` như `move`/`unassign`: body 5 trường, `200` với `[source Cancelled, prefix, suffix]`, actor/evidence do server quyết định (Staff: `staff:{id}` + `staff-rbac:…`). Không đổi store, auth, schema hay Admin_Web; `UI_SPLIT_MOVE` vẫn `NOT_IMPLEMENTED`, CP03–CP05 chưa bắt đầu. Chi tiết: `docs/reports/PMS-CAL-002-CP02-completion.md`, `docs/design/PMS-CAL-002-split-move.md`. Backend CD AWS vẫn `PAUSED / NOT_COMPLETE`: hai biến repository `BACKEND_RELEASE_PUBLISH_ENABLED` và `BACKEND_RELEASE_DEPLOY_ENABLED` do Owner ghi `false` ở bước trước (đọc lại `false`); checkpoint CP02 không gọi cloud, không đổi cờ, không chạy workflow release.

Cập nhật 2026-10-10 (`PMS-CAL-002-CP01`, SPLIT_MOVE_STORE_COMMAND, branch `feature/pms-cal-002-cp01-split-move-store` từ `develop` `841b4b7`, Draft PR vào `develop`, implementer Claude / reviewer Codex read-only do Owner gọi): Owner chốt D1 (nguồn khác RoomType đã bán vẫn cần Manager + xác nhận + lý do cho prefix, không kế thừa evidence cũ) và D2 (phòng đích trùng phòng nguồn bị từ chối); D3–D6 còn OPEN. Thêm **chỉ** entry point nội bộ `SplitMoveAssignmentCommand` + `IAssignmentMutationStore.SplitMoveAsync`: đọc room/đêm thật của segment, kiểm `start < splitDate < end` và đích ≠ nguồn (`Invalid`), dựng đúng một supersession prefix/suffix rồi gọi `SupersedeAsync` nguyên trạng (lock, version, capacity, audit theo successor). Không route HTTP, không UI, không schema; `HTTP_SPLIT_MOVE`/`UI_SPLIT_MOVE` vẫn `NOT_IMPLEMENTED`, CP02–CP05 chưa bắt đầu. Kiểm trên PostgreSQL 18.3 scratch: 27 test mới, unit 244 + integration 873. Chi tiết: `docs/reports/PMS-CAL-002-CP01-completion.md`, `docs/design/PMS-CAL-002-split-move.md`. Backend CD AWS: Owner **tạm dừng** `BHA-BACKEND-CD-001-CP04` P1 và kế hoạch CD AWS (dự kiến chuyển hosting sau); code CD đã merge được giữ nguyên, không đổi pipeline. Owner đã ghi hai biến repository `BACKEND_RELEASE_PUBLISH_ENABLED=false` và `BACKEND_RELEASE_DEPLOY_ENABLED=false` (Claude đọc lại chỉ-đọc 2026-10-10T07:37Z: cả hai `false`; chưa có environment `backend-production`; `main` vẫn `0243160`). P1 mới có đọc chỉ-đọc, chưa promote/probe/IAM/host; `SETUP_LIVE`, `PUBLISH_LIVE`, `DEPLOY_LIVE`, `ROLLBACK_LIVE`: không chạy; `BACKEND_CD`: `PAUSED / NOT_COMPLETE`.

Cập nhật 2026-10-09 (`BHA-BACKEND-CD-001-CP04`, OWNER_LIVE_ACTIVATION, branch `feature/bha-backend-cd-001-cp04-owner-live-activation` từ `develop` `1f039b5`, Draft PR vào `develop`; CP01–CP03 đã merge): checkpoint đầu **chưa có bằng chứng live nào** — chỉ thêm workflow chẩn đoán `backend-oidc-probe.yml` (`workflow_dispatch`, chỉ `main`, environment `backend-production`, không gọi AWS, che token, chỉ in `sub`/`aud` và vài claim) để Owner đọc `sub` thật trước khi viết trust, và runbook `docs/runbooks/BHA-BACKEND-CD-001.md` §11 (gói lệnh Owner A–G, pha P1–P4, chính sách lỗi). Đọc chỉ-đọc bởi Claude (`CLAUDE_VERIFIED_READ_ONLY`): ECR `the-bha-api` là IMMUTABLE; chưa có biến repository hay environment `backend-production`. Cả hai cờ vẫn TẮT; publish/deploy/SSM/rollback live đều `NOT_RUN`/`WAITING_OWNER`. Hiệu chỉnh 2026-10-10 (`CP04-C1`): packet C của runbook §11.3 đã thêm guard worktree sạch fail-closed (staged/unstaged/untracked, lỗi `git status` = từ chối) và dựng commit promotion bằng `commit-tree` + `switch --no-overwrite-ignore` (kiểm chứng RED/GREEN trên fixture Git rời, 88/88). Hiệu chỉnh `CP04-C2` (2026-10-10): packet D ràng buộc bằng chứng OIDC vào đúng run ID trả về từ một lần dispatch (REST `2026-03-10`, không dùng `gh run list`/`watch`), packet E render + kiểm tra từng file fail-closed, packet F chỉ báo `BOOTSTRAP_MATCH` khi cả hai inspect thành công và image ID khớp, packet B không PUT lên environment đã có (419 check trên stub/fixture; chưa có dispatch thật). Hiệu chỉnh `CP04-C3` (2026-10-10): packet E giờ chỉ render khi evidence khớp danh tính Owner đã chọn (`BHA_REPO`, `PROBE_WORKFLOW_ID`/`RUN_ID`/`RUN_ATTEMPT`/`PINNED_SHA`, `EVIDENCE_DIR` tuyệt đối; kiểu số, URL, workflow chính xác) và render thêm `backend-release-publish-policy.json` (mới, chưa áp dụng; có `ecr:BatchGetImage` theo ví dụ push của AWS), 409 check trên fixture. Hiệu chỉnh `CP04-C4` (2026-10-10): packet D đọc log job (endpoint job logs, redirect tới plain text — không phải archive) bằng bytes, giải mã UTF-8 tường minh (BOM/CRLF/Unicode hợp lệ; byte lỗi → `LOGS_NOT_UTF8`), chỉ GET log mới truyền `--allow-escape-sequences` (không in output của gh), tách dòng theo `\n`, dòng claim có ký tự điều khiển bị từ chối (`LOG_CLAIM_CONTROL_*`), `gh` thiếu flag dừng trước khi dispatch; vẫn đúng một POST và giữ nguyên các gate danh tính/claim, schema evidence và packet E (RED 11/11 với `gh` thật + server loopback, GREEN 1062/1062, handoff sang E 27/27; chưa có dispatch thật). Chi tiết: `docs/reports/BHA-BACKEND-CD-001-CP04-completion.md`.

Cập nhật 2026-10-09 (`BHA-BACKEND-CD-001-CP03`, SSM_RELEASE_WIRING, branch `feature/bha-backend-cd-001-cp03-ssm-release-wiring` từ `develop` `f385f52`, Draft PR vào `develop`; CP01+C1 = PR #93 và CP02+C1+C2 = PR #94 đã merge): nối main → SSM mặc định TẮT: job `deploy-main` (cùng run với `publish-main`, chỉ push `main`, cờ repository `BACKEND_RELEASE_DEPLOY_ENABLED` đúng `true`, environment `backend-production`, cấu hình env-only `BACKEND_RELEASE_DEPLOY_AWS_ROLE_ARN`/`BACKEND_RELEASE_EC2_INSTANCE_ID`/`BACKEND_RELEASE_HOST_CONFIG_PATH` theo mẫu C1, kiểm tra commit còn là đầu `main`), packet release dựng từ git object của đúng SHA (hash do runner tính), client SSM (một lệnh `AWS-RunShellScript` tới đúng một instance, xác nhận CommandId+InstanceId+JSON kết quả, không bao giờ gửi lại khi kết quả mơ hồ, ngân sách timeout cụ thể), wrapper trên host dùng lại engine CP02 và sở hữu `EXPECTED_CURRENT_IMAGE` (ghi nguyên tử, đối soát container thật, `PENDING` sau crash), mẫu IAM chưa apply và gói setup cho Owner. Diễn tập end-to-end local isolated với ranh giới SSM/ECR-login được mock (engine, Docker, PostgreSQL 18.3 là thật); không có AWS thật: `SSM_LIVE`, `DEPLOY_LIVE`, `ROLLBACK_LIVE`, `PUBLISH_LIVE`, `CLOUD_WRITES`: `NOT_RUN`; CP04 (Owner kích hoạt live) chưa bắt đầu; backend CD chưa hoàn thành. Chi tiết: `docs/runbooks/BHA-BACKEND-CD-001.md` §10, `docs/reports/BHA-BACKEND-CD-001-CP03-completion.md`.

Cập nhật 2026-10-09 (`BHA-BACKEND-CD-001-CP02`, EC2_DEPLOY_ROLLBACK, branch `feature/bha-backend-cd-001-cp02-ec2-deploy-rollback` từ `develop` `56c8b77`, Draft PR vào `develop`; CP01+C1 = PR #93 đã merge): thêm engine deploy theo digest cho EC2 + Docker + Caddy — `backend-deploy.sh` (preflight/deploy/rollback/recover/status; lock theo target; journal + state machine; create-before-stop; swap có downtime giới hạn; giữ env/keys/CA/runtime; rollback container), `backend-migration-preflight.sh` (đọc `__EFMigrationsHistory` trong transaction READ ONLY, verify-full, so khớp tuyệt đối với manifest) và `backend-migration-manifest.py` (manifest theo commit SHA). Chỉ diễn tập **local isolated** (PostgreSQL 18.3 scratch, registry loopback, TLS proxy riêng): success theo digest, rollback explicit, lỗi sau stop → khôi phục, Staff session sống sót; mock fault-injection cho các case còn lại. Không chạm EC2/RDS/ECR/SSM: `DEPLOY_LIVE`, `ROLLBACK_LIVE`, `SSM_LIVE`, `CLOUD_WRITES`: `NOT_RUN`; CP03 (SSM/IAM/workflow) và CP04 (kích hoạt live) chưa bắt đầu; backend CD chưa hoàn thành. **C2 (cùng PR #94)**: sửa finding P2 thứ hai — file `docker image inspect` thô (`Config.Env` có thể chứa bí mật) không còn nằm lại trong journal: mọi kết thúc run đều xóa theo tên chính xác các file inspect/env tạm trong thư mục evidence của đúng run; lỗi dọn được báo (`__EVIDENCE_CLEANUP_FAILED`) mà không đổi kết quả deploy. **C1 (cùng PR #94)**: sửa finding P2 của Codex — kết quả JSON nay do serializer thật tạo (đúng một dòng, một object), `--image`/`--source-sha` được kiểm tra ngay khi parse nên giá trị xấu không bao giờ vào journal/records/output. Hợp đồng: `docs/runbooks/BHA-BACKEND-CD-001.md` §9; bằng chứng: `docs/reports/BHA-BACKEND-CD-001-CP02-completion.md`.

Cập nhật 2026-10-09 (`BHA-BACKEND-CD-001-CP01`, Draft PR vào `develop` từ baseline `a6d45bf`, implementer Claude / reviewer Codex read-only): **trạng thái hiện tại do Owner xác nhận (`OWNER_VERIFIED`, Claude không kiểm tra cloud)** — Customer Web, Admin Web và backend đều đã deploy/test thành công; hai frontend có CI/CD, backend có CI và deploy thủ công (EC2 + Docker + Caddy, RDS PostgreSQL 18.3, ECR). Không suy ra mọi module template của Admin đã nối backend. Các entry 2026-10-07/08 bên dưới là lịch sử, giữ nguyên. CP01 chỉ chuẩn bị release artifact, **không** hoàn thành backend CD: `backend-image.yml` verify (PostgreSQL 18.3) + build image đúng một lần, kiểm tra non-root/Production key-path/OCI label, save→rmi→load để chứng minh identity; push `main` publish ECR (environment `backend-production`, OIDC chỉ ở job publish) chỉ khi biến repository `BACKEND_RELEASE_PUBLISH_ENABLED` đúng `true` (mặc định tắt; `ECR_PUBLISH_ENABLED` chỉ điều khiển `develop`); helper ECR fail-closed (chỉ `ImageNotFoundException` là tag vắng, repository phải `IMMUTABLE`, tag đã tồn tại → fail, digest được validate); bỏ `workflow_dispatch`; `ci.yml` backend chuyển sang PostgreSQL 18.3; parser tên env trong packet EC2 nhận tên có dấu chấm. Chi tiết và giới hạn: `docs/runbooks/BHA-BACKEND-CD-001.md`, `docs/reports/BHA-BACKEND-CD-001-CP01-completion.md`. **C1 (cùng ngày, cùng PR)**: cấu hình main đổi sang `BACKEND_RELEASE_AWS_ROLE_ARN`/`_AWS_REGION`/`_ECR_REPOSITORY` chỉ trong environment `backend-production`; giá trị kế thừa từ organization/repository hoặc thiếu giá trị đều fail trước AWS (không fallback sang tên của develop). CP02 (deploy/rollback EC2), CP03 (SSM/IAM), CP04 (kích hoạt live) chưa triển khai; `PUBLISH_LIVE`, `DEPLOY_LIVE`, `ROLLBACK_LIVE`, `CLOUD_WRITES`: `NOT_RUN`; review Codex do Owner gọi.

Cập nhật 2026-10-08 (`BHA-ADMIN-PROXY-001`, Admin_Web, branch `feat/bha-admin-proxy-001` từ `develop` `f3c9616`, Draft PR vào `develop`): chuẩn bị Admin demo trên project Vercel riêng — chỉ code + diễn tập local + packet cho Owner, **không thao tác cloud**. `next.config.ts` thêm `rewrites()` opt-in qua `API_PROXY_ORIGIN` (server/build-time, validator `scripts/api-proxy-origin.ts`: https, không credentials/query/fragment/path, không trùng origin Admin; sai thì fail lúc load config, không in giá trị): chỉ `/api/admin/v1/:path*` → `<upstream>/api/admin/v1/:path*` (`beforeFiles`; không proxy Customer `/api/v1`, health hay `/api/*` chung); webpack/turbopack SVG giữ nguyên; không middleware/BFF/dependency mới. Diễn tập local: (1) fixture HTTPS + CA tạm — GET có query, POST login-shaped, Origin/Cookie tới upstream, nhiều `Set-Cookie` (Strict/HttpOnly/Secure/Path) và `no-store` giữ nguyên, logout expiry, sai CA → 500; (2) Staff auth thật: PostgreSQL 18.3 cô lập + image API `6ae3fdd` + tài khoản Staff tạm qua proxy Admin đã build: login 200 → me 200 (membership) → board 200 → logout 204 → me 401; sai Origin 403, thiếu Origin 403, sai mật khẩu 401 (curl cookie jar — **không phải trình duyệt**, SameSite/Vercel `NOT_RUN`). Guard release API (runbook step 1) nay chỉ kiểm `Back_End` (trừ tests), `deploy`, `.github` với `6ae3fdd`; Customer/Admin release là commit `main` mà Vercel build. Packet Owner: runbook §7b (checklist Vercel, env Production, thêm `Cors__AdminOrigins__<index>=https://the-bha-hotels-booking.vercel.app` trên EC2 + recreate container, verify, đối chiếu booking `e659d463…`, hướng promotion). Evidence cloud (Customer live, CSRF/booking vào RDS, Staff Manager, Caddy/sslip.io) là `OWNER_VERIFIED`, không phải test của Claude. `VERCEL_CONFIG_APPLY`, `ADMIN_REDEPLOY`, `EC2_ADMIN_ORIGINS_APPLY`, `ADMIN_LOGIN_LIVE`, `ADMIN_CALENDAR_READ_LIVE`, `ADMIN_CALENDAR_WRITE_LIVE`: `NOT_RUN`; `REVIEW: NOT_RUN`. Report: `docs/reports/BHA-ADMIN-PROXY-001-completion.md`.

Cập nhật 2026-10-08 (`BHA-WEB-PROXY-001`, Customer_Web, branch `feat/bha-web-proxy-001-customer` từ `develop` `5eb0a38`, Draft PR vào `develop`): code proxy cùng origin cho demo trên URL Vercel. `next.config.js` thêm `rewrites()` opt-in qua `API_PROXY_ORIGIN` (server-only, validate bằng URL parsing: https, không credentials/query/fragment/path, không trùng origin Customer; sai thì fail lúc load config, không in giá trị): `/api/:path*` → `<upstream>/api/:path*` (`beforeFiles`, giữ tiền tố `/api` và query; không redirect). Phát hiện khi diễn tập: `src/middleware.ts` chặn `/api/*` bằng 404 **trước** rewrite nên config đơn thuần không chạy — hai nhóm ngoài allowlist: (1) middleware/routePolicy — `routePolicy.decideRoute` nhận `apiProxyEnabled`, chỉ cho `/api` (đúng chữ thường) đi qua khi build đã bake cờ `BHA_API_PROXY_ENABLED` (do `next.config.js` `env` chỉ đặt khi proxy bật); mặc định vẫn 404; (2) validator runtime `scripts/api-proxy-origin.cjs`. Codex review: no findings (test của reviewer `NOT_RUN`; Claude 572/572). Diễn tập local (Next + fixture HTTPS giả, CA tạm, dữ liệu giả): GET có query, POST JSON, Cookie/Origin/`X-CSRF-TOKEN`/`Idempotency-Key` tới upstream, status 201/body, hai `Set-Cookie` riêng và `no-store` giữ nguyên; thiếu CA thì 500 (không tắt TLS verify). Evidence cloud (Caddy/sslip.io, `/health/ready`, `/api/v1/auth/csrf`, cert, image `6ae3fdd`) là `OWNER_VERIFIED`, không phải test của Claude. Env Owner (Production only, rồi redeploy): `API_PROXY_ORIGIN=https://the-bha-api.52-65-145-145.sslip.io`, `NEXT_PUBLIC_API_BASE_URL=https://the-bha-hotels-booking-p5rj.vercel.app`; host `sslip.io` phụ thuộc IP công khai EC2. `VERCEL_CONFIG_APPLY`, `CUSTOMER_REDEPLOY`, `CUSTOMER_LOGIN_LIVE`, `CUSTOMER_BOOKING_LIVE`, `ADMIN_DEPLOY`: `NOT_RUN`; `REVIEW: NOT_RUN`. Report: `docs/reports/BHA-WEB-PROXY-001-completion.md`; runbook §7a.

Cập nhật 2026-10-07 (`BHA-PG18-001-C1`, chỉ tài liệu, cùng Draft PR #85): sửa hai finding. (F1) runbook §11 buộc Owner (đã tạo role, đổi owner `thebha`, qua gate `btree_gist`) phải dừng nếu role tồn tại rồi CREATE ROLE/ALTER DATABASE lại — nay có bảng định tuyến A (mới) / B (có sẵn, chưa bootstrap) / **R (resume — trạng thái Owner)** / stop; R bỏ qua step 3–4, thêm **3R** (đọc kiểm role flags, owner, membership, TLS; lệch thì dừng, không reset) và **4R** (hardening còn pending: `REVOKE ALL … FROM PUBLIC`, `GRANT CONNECT … TO bha_app`, do `bha_operator` chạy, trước lần đăng nhập `bha_app` đầu tiên); gate extension đã `OWNER_VERIFIED_PASS` không chạy lại; emptiness gate chạy lại ngay trước apply; chuỗi R: 3R → 4R → emptiness → snapshot → migration → verify → grant + login `bha_app`. Diễn tập local trên PostgreSQL 18.3 cô lập đã chạy đúng các khối lệnh của route R (và hai lỗi trong bản nháp của mình được phát hiện: PG16+ tự tạo membership admin-only cho master nên "không có hàng" là sai; master stand-in mất CONNECT sau REVOKE PUBLIC — chưa kiểm trên RDS). (F2) lệnh kiểm release `git diff --quiet 6ae3fdd HEAD -- Back_End Front_End deploy .github` trả exit 1 vì PR thêm test; nay loại đúng `Back_End/tests`, báo `STOP` nếu runtime lệch, và liệt kê 5 file test thay đổi có chủ đích (exit 0 trên checkout hiện tại, exit 1 với commit runtime khác). Kết quả 244 + 847 giữ từ `ef5d2de` (runtime không đổi). `CLOUD_*`, `DEPLOY_*`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`; `REVIEW: NOT_RUN`.

Bản cập nhật trước (BHA-PG18-001):
Cập nhật 2026-10-07 (`BHA-PG18-001`, test-only, branch `test/bha-pg18-001-compatibility` từ `develop` `17c15e7`, Draft PR): chốt ba assertion fail trên PostgreSQL 18.3 ở C1. Đọc call site: chỗ duy nhất map SQLSTATE khoá ngoại là `RoomOccupancySegmentMutationSupport` (commit cuối của mutation segment — vi phạm phía bảng con, vẫn `23503` trên 18); production **không** có đường xoá dòng cha nào (chỉ `DailyInventoryControlStore.DeleteAsync` xoá dòng con) → **không có finding production**. Sửa test: helper `PostgresVersionSupport` (major hỗ trợ 17/18, `RestrictedParentDelete`: 17 → `23503`, 18 → `23001`, major khác ném lỗi), test migration đổi tên và nhận 17/18, hai test xoá-dòng-cha dùng mã theo major và có thêm kiểm dòng cha/con còn nguyên; child insert/`NO ACTION` giữ `23503`. Kết quả trên hai server riêng, cô lập: **PostgreSQL 18.3 — unit 244/244, integration 847/847; PostgreSQL 17.10 — 244/244, 847/847** (846 + 1 test helper); RED trên 18.3 tái hiện 3 lỗi cũ; SQL `idempotent.sql` không đổi (SHA-256 `d7d38722…019b406`, `--check` đạt). `PG18_COMPATIBILITY: LOCAL_TESTS_PASS`, `BACKEND_INTEGRATION_LOCAL18: PASS` — chỉ là gate local; kết quả C1 `843/846` giữ làm lịch sử của head cũ. Bằng chứng RDS của Owner (`OWNER_VERIFIED`): role `bha_operator`/`bha_app`, ownership `thebha`, đăng nhập TLS 1.3 và `CREATE EXTENSION btree_gist` trong transaction rollback đều PASS; chưa migration/import/grant bảng/đăng nhập `bha_app`/deploy. `CLOUD_MIGRATION`, `CLOUD_DATA`, `DEPLOY_*`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`; `REVIEW: NOT_RUN`. Report: `docs/reports/BHA-PG18-001-completion.md`; runbook §11 đã cập nhật trạng thái.

Bản cập nhật trước (CP01-C1):
Cập nhật 2026-10-07 (`BHA-DEPLOY-001-CP01-C1`, cùng Draft PR #84, bootstrap ordering + PostgreSQL 18.3): finding Codex (runbook §11 kết nối tới database/role chưa tồn tại) đã sửa — §11 viết lại với **hai đường**: A (database chưa có: master tạo role rồi `CREATE DATABASE … OWNER bha_operator`) và B (`thebha` đã được Owner tạo bằng `postgres`, rỗng: giữ nguyên, chỉ `ALTER DATABASE … OWNER TO bha_operator`); ba identity tách biệt (master = bootstrap, `bha_operator` = owner/migration/import, `bha_app` = API/Staff CLI), `verify-full` giữ nguyên, image build (từ `git archive` của `6ae3fdd`) trước khi Staff CLI dùng, smoke sau Customer deploy. Target theo Owner (`OWNER_VERIFIED`): RDS `the-bha-db`, `ap-southeast-2`, **PostgreSQL 18.3**, database `thebha` rỗng, TLS 1.3; chưa áp migration/import/role. Diễn tập local trên `postgres:18.3` (digest `sha256:7e32e983…684db`) bằng chính các khối lệnh runbook: cả hai đường PASS (áp SQL 2 lần: 9 history, 28 bảng, `btree_gist`; oid database đường B không đổi), role chỉ DML không DDL, import catalog 352 INSERT, Staff CLI + API chạy qua `SSL Mode=VerifyFull`. **Backend sau build: unit 244/244, integration 843/846 trên 18.3** — 3 test fail là assertion (một pin version `17.`; hai test đòi SQLSTATE `23503` nhưng PostgreSQL 18 trả `23001` cho `ON DELETE RESTRICT`; ràng buộc vẫn được thực thi) → `PG18_COMPATIBILITY: PARTIAL`, `BACKEND_INTEGRATION_LOCAL18: FAIL (3/846)`, cần work item riêng cho test; không dùng kết quả PG17.10 thay thế. `RDS_EXTENSION_PERMISSION`, `AWS_INVENTORY`, `CLOUD_*`, `DEPLOY_*`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`; `REVIEW: NOT_RUN`. Bước tiếp theo duy nhất của Owner: truy vấn chỉ-đọc kiểm `btree_gist` trên `thebha` (report §11.7). Report: `docs/reports/BHA-DEPLOY-001-CP01-completion.md` §11.

Bản cập nhật trước (CP01):
Cập nhật 2026-10-07 (`BHA-DEPLOY-001-CP01`, Owner-led deploy readiness, branch `ops/bha-deploy-001-cp01-rds-demo`, release `6ae3fdd3306c50736c734712df5a0f2a1ab5054a` = `develop` sau khi PR #83 merged; CI `CI` 37554976232 và `Backend image` 37554976283 xanh, publish ECR skipped): theo quyết định mới của Owner, **Owner trực tiếp thao tác AWS/Vercel/DNS/database; Claude chỉ chuẩn bị, kiểm tra, hướng dẫn** — quyền cũ tạo `thebha_showcase_demo` và seed trên RDS đã rút, không dùng. Đã kiểm: SQL `idempotent.sql` (SHA-256 `d7d38722…019b406`, `--check` đạt) **không chỉ là schema** — migration 7 có `INSERT … SELECT` chuyển dữ liệu booking cũ (0 dòng trên DB rỗng) và migration 8 chạy `CREATE EXTENSION btree_gist`; diễn tập trên PostgreSQL 17.10 tạm (owner không phải superuser): áp 2 lần, 9 history, 28 bảng, schema giống DB local, API Production + role chỉ DML chạy được hold → confirm và Staff login/board; import catalog 11 bảng (352 INSERT, đổi origin media sang `https://thebhariverside.com`, một transaction, rerun fail không đổi gì). Kiểm kê local: catalog đúng danh sách Owner (1 Property, 3 RoomType, 11 phòng, 270 giá 1.0/1.1/1.6 triệu, 31 media toàn URL `localhost:3000`); 24 Reservations/28 holds/1 block/1 Staff là dữ liệu test E2E — không chuyển. Khuyến nghị: migration → Owner xác nhận trường còn "demo" (số phòng `DEMO-*`, tên rate plan, mô tả/địa chỉ) → import catalog → Staff CLI; **không** dùng seeder Development trên DB vận hành. Còn thiếu từ Owner: account/region/endpoint RDS (`the-bha-db` chưa xác minh), tên DB vận hành, role, đường mạng + TLS, runtime API (đề xuất ECS Fargate + EFS mã hóa), ECR, domain/ACM, hai Vercel project, Staff. Rủi ro mới: **giá theo đêm hết 2027-01-04 và Production không có công cụ gia hạn**; image không có RDS CA bundle. AWS inventory `NOT_RUN` (không có `aws` CLI/profile); `CLOUD_DATA`, `DEPLOY_API`, `DEPLOY_ADMIN`, `DEPLOY_CUSTOMER`, `END_TO_END_LIVE`, `PUBLISH` đều `NOT_RUN`; `REVIEW: NOT_RUN`. Report: `docs/reports/BHA-DEPLOY-001-CP01-completion.md`; packet từng bước: runbook §11.

Bản cập nhật trước (C4):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02-C4-SAFE-TOOLS`, cùng PR #83, Draft, chưa merge): sửa hai finding của Codex trên head C3 — (F1) `deploy/showcase/scripts/verify-key-persistence.sh`
dùng tên scratch cố định rồi DROP/xóa nên có thể xóa tài nguyên có sẵn; nay mỗi lần chạy có run id ngẫu nhiên, tài nguyên scratch (DB/container/2 volume) mang run id, không DROP để chuẩn bị, từ chối khi tên đã tồn tại,
chỉ xóa thứ mình đã tạo (xác minh bằng label), cổng do Docker cấp; có harness Python `deploy/showcase/scripts/tests/test_verify_key_persistence.py` (RED 12/15 trên script cũ, GREEN 15/15) và một lượt chạy thật với canary tên cũ (before/after giống hệt);
(F2) seed CLI từ chối `--from`/`--days` có ngày kết thúc exclusive không biểu diễn được bằng `DateOnly` bằng usage error 2 trước khi mở DB (test options + CLI). Cũng: generator SQL giữ đúng một newline cuối file (diff chỉ một dòng trống, `git diff --check` toàn PR sạch);
và theo yêu cầu Owner, panel đặt phòng trang chi tiết không còn là sticky scroll-container nên calendar/guest popover không bị cắt. Backend C4: unit 244 + integration 846. Bằng chứng UI/booking C3 giữ nguyên là bằng chứng C3; `REVIEW: NOT_RUN` cho head C4. Chi tiết: report §13.

Bản cập nhật trước (C3):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02-C3`, cùng PR #83, Draft, chưa merge): Owner đảo quyết định C2 — **template Chisfis được khôi phục
đầy đủ** (menu, dropdown, template/currency switcher, ảnh, mọi section, trang template; logo The BHA; không khôi phục secret/NextAuth/`/api/*`) và
các route template mở lại, riêng `/api/*` vẫn 404, `/showcase`→`/`, `/pay-done`→`/paydone`. Hero Stays dùng popover template (Location: The BHA House /
Riverside / Villa; lịch hai tháng; chọn khách) làm **component có kiểm soát** dùng chung cho desktop, modal mobile, Featured và trang phòng; Riverside
lấy offer thật theo ngày, ba card `StayCard2` hiển thị giá API hoặc "Chọn ngày để xem giá". Trang phòng: mosaic 1+4, Share/Save, rating 4.5 (112) ghi rõ
là mẫu, picker template trong panel đặt phòng; validate liên hệ trước khi gửi; giữ chỗ chuyển sang `/paydone` ("Đã giữ chỗ", chưa xác nhận, chưa thanh toán);
chỉ nút "Xác nhận đặt phòng" gọi confirm. **Media:** 31 ảnh (Property 10, 2PN 9, 1PN 6, 1PN view thoáng 6) theo thư mục Owner phân loại, Owner cho phép publish
dù quét thấy generator marker/không metadata — `MEDIA_COVERAGE: PASS`, `MEDIA_PROVENANCE: UNVERIFIED` (C2PA `NOT_RUN`); DB demo được patch bằng migration chỉ-media
(40 dòng một lần, rerun 0). Bằng chứng C3 chạy trên build thật + API container + PostgreSQL demo, desktop và mobile touch, Safari `NOT_RUN`:
`docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md` §12; kết quả C2 (§10) chỉ còn là lịch sử. `REVIEW: NOT_RUN` cho head C3; lỗi cookie khách cũ (401),
500 sau khi DB restart và key XML không mã hóa còn mở.

Bản cập nhật trước (C2, bị C3 thay thế ở phần giao diện):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02-C2`, cùng PR #83, Draft, chưa merge): Owner chốt giữ **homepage Chisfis** tại `/`
(thay trang đặt phòng một trang của CP01) và đặt phòng ở **trang chi tiết phòng**. `Featured places to stay` có ba tab tĩnh
The BHA Riverside / House / Villa: Riverside lấy Property theo slug `the-bha-riverside` và hiển thị **ba loại phòng** từ API, House/Villa
"Sắp ra mắt" (không gọi API); mỗi card mở `/listing-stay-detail?propertyId=&roomTypeId=` (route template có sẵn, nay là route thật duy
nhất của nhóm listing; các route template khác vẫn 404). Trang chi tiết: dữ liệu RoomType/Property từ API, một panel đặt phòng duy nhất
(tìm offer đúng phòng → liên hệ → hold → confirm) cho desktop và mobile, hold vẫn giữ qua điều hướng; các section dịch vụ của homepage
là preview inert có nhãn, ảnh mẫu thay bằng khung placeholder (không gọi ảnh template/Pexels). Đường demo: `/` → card phòng → chi tiết →
đặt phòng (không còn "Showcase" một trang). Bằng chứng C2 chạy trên build thật + API container + PostgreSQL demo (desktop và mobile touch;
Safari `NOT_RUN`): `docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md` §10. Kết quả E2E cũ ở `2bb70bb` thuộc luồng một trang và
**không** được tính cho giao diện mới. `MEDIA: PARTIAL` (1PN chưa có ảnh), `REVIEW: NOT_RUN` cho head C2, lỗi cookie khách cũ (401) còn mở.

Bản cập nhật trước (CP02, trước C2; phần mô tả "luồng đặt phòng một trang" bên dưới đã bị C2 thay thế):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02`, Draft PR, chưa merge; PR #82 đã merged, baseline
`9ad8edce4171f9b26a3f274cd544758be21f9162`): PR thứ hai và cuối của showcase. **Bằng chứng ảnh (đã chỉnh ở C1):** quét byte (heuristic, `validation: NOT_RUN`, không có
validator C2PA): 62/86 PNG chứa marker nêu dịch vụ sinh ảnh (`trainedAlgorithmicMedia`, `gpt-image`, `OpenAI Media Service`) — dấu hiệu cần
xác minh, chưa phải chứng minh; 23 JPEG có metadata editor (nguồn camera chưa được xác minh độc lập); 1 không metadata. 13 ảnh được publish
(chỉ loại `editor-metadata-present`); hai loại 1PN chưa có ảnh (placeholder), chờ Owner làm rõ ảnh 1PN là ảnh thật đã chỉnh hay ảnh sinh mới;
`MEDIA: PARTIAL`. Backend có
seeder insert-only `RiversideDemoSeeder` + CLI `--seed-riverside-demo` (chỉ Development, `--expected-database` phải khớp và chứa
`demo`/`showcase`, dry-run/apply, idempotent); `Hosting:TrustedProxy` (mặc định tắt) tin `X-Forwarded-For/-Proto` chỉ từ proxy liệt kê;
`Back_End/Dockerfile`, `deploy/showcase/` (PostgreSQL 17 bền vững, API, nginx TLS, key ring bền vững, SQL migration idempotent),
workflow `backend-image.yml` (build trên PR và push `develop`; publish ECR **tắt mặc định**, chỉ từ `develop` khi `ECR_PUBLISH_ENABLED=true`, tag = SHA nguồn, không rollout; `PUBLISH: NOT_RUN`). Catalog Riverside 3 loại/11 phòng
(1PN 3 phòng ₫1.000.000, 1PN view thoáng 2 phòng ₫1.100.000, 2PN 6 phòng ₫1.600.000; max 2/2/4) đã seed vào DB demo local bền vững
`thebha_showcase_demo` (cửa sổ 2026-10-07..2027-01-04, 316 dòng, rerun 0 insert) và chạy E2E trình duyệt + container + Admin Staff
(`DATA_LOCAL/UI_LIVE/CONTAINER: PASS`, `MEDIA: PARTIAL`). Chưa làm: `CLOUD_DATA`, `DEPLOY_LIVE` (Owner deploy theo runbook
`docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md`), Vercel `NOT_TESTED`, Safari `NOT_RUN`, `REVIEW: NOT_RUN`. Yêu cầu cứng: Customer, Admin
và API cùng một registrable domain (cookie Lax/Strict); Owner cung cấp `thebhariverside.com` / `admin.` / `api.` (cấu hình dự kiến, DNS/live `NOT_TESTED`); `*.vercel.app` + hostname AWS mặc định sẽ không giữ được đăng nhập.
Rủi ro mở: key ring Data Protection lưu không mã hóa trên volume; không có EF retry (request đầu sau restart DB trả 500); lỗi cookie
khách cũ (401) vẫn mở. Evidence: `docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md`.

Bản cập nhật trước (2026-10-06, `CUST-WEB-SHOWCASE-001-CP01`; PR #82 nay đã merged):

Cập nhật 2026-10-06 (`CUST-WEB-SHOWCASE-001-CP01`, Draft PR, chưa merge): `PMS-CAL-002-CP00`
đã merged (PR #81, `b6e28a6`); split-move **tạm dừng** theo quyết định Owner (thiết kế giữ nguyên,
CP01–CP05 không mở). Objective Customer: `/` của Customer_Web là luồng thật (Property → RoomType →
availability/giá từng đêm → hold → confirm); mọi route template trả 404 "chưa có"; shell tối thiểu.
Correction C1 (cùng PR #82) sửa hai finding Codex: điều hướng header không làm mất guest hold;
CTA tới form khi catalog đang tải. Correction C2 (cùng PR #82) làm `/` render live page trực tiếp,
giữ alias an toàn trên loopback-IP và realign fragment khi catalog/RoomType đang settle; production
loopback, browser booking và isolated DB regression đã chạy. Correction C3 (Claude, MEP mới) giữ nguyên thao tác cuộn của khách khi catalog về (controller `anchorAlignment` + 18 regression test; catalog về sau 5 giây không còn được căn lại — hệ quả chấp nhận được, ghi trong report). Owner (06/10): work item này không còn target dòng, tối đa hai PR;
PR thứ hai (CP02) seed The BHA Riverside 3 RoomType / 11 PhysicalRoom (3/2/6), giá Owner, ảnh thật,
database demo riêng — chỉ mở sau khi Owner merge PR #82. Chưa nghiệm thu: dữ liệu demo, xử lý/hiển thị
ảnh, deploy Vercel (`NOT_TESTED`); lỗi cookie khách cũ (401) còn mở. Evidence:
`docs/reports/CUST-WEB-SHOWCASE-001-CP01-completion.md`.

Bản cập nhật trước (2026-10-06, `PMS-CAL-002-CP00`, viết khi PR #81 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP07` (PR #80) đã **merged** (`2026-10-04T09:32:21Z`), merge commit
`38d4a9d964fde411aa4c03b46323f250fd54221b`; CI run `37192482384` `success` trên đúng
commit đó. Milestone `PMS-ADMIN-AUTH-001` (CP00–CP07, PR #73–#80) là **PASS — CLOSED**:
Calendar mặc định `Staff` ở mọi môi trường, `LocalGate` chỉ là opt-in Development. Kết quả
review của CP07 không được ghi trong repository (report CP07 ghi `REVIEW: NOT RUN` tại thời
điểm viết). **Chưa deploy Production.** Objective mới là `PMS-CAL-002-CP00` — thiết kế
contract cho đổi phòng giữa kỳ bằng split assignment (split-move):
`docs/design/PMS-CAL-002-split-move.md`, evidence
`docs/reports/PMS-CAL-002-CP00-completion.md`. Đó là **đề xuất**, chưa phải CURRENT và
chưa được Owner duyệt: split-move vẫn **TARGET**, chưa có route/UI; quyết định D1–D6 còn
**OPEN**; CP01–CP05 chưa được kích hoạt.

Bản cập nhật trước (2026-10-04, `PMS-ADMIN-AUTH-001-CP07`, viết khi PR #80 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP06` cùng correction C1–C4 (PR #79) đã **merged**
(`2026-10-04T08:03:02Z`), merge commit `c62719b9fe8b947ef001cc2b20ea1a6a7d5e226e`. Review C4:
RUN — no actionable regressions (Reviewed SHA: UNVERIFIED). CP07 là checkpoint cuối của
milestone Staff auth: `AdminCalendar:AccessMode` không khai báo → `Staff` ở mọi môi trường
(parser CP04-C1 giữ nguyên cho giá trị rỗng/không hợp lệ); `LocalGate` chỉ là opt-in
Development — Production/Staging/môi trường khác từ chối khởi động; hai guard Production cho
local flags giữ nguyên, kể cả ở `Staff`. Launch profile `https` không còn bật read flag.
Admin_Web: `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` không đặt → `Staff`; `LocalGate` bị từ
chối trong production build. Calendar có Staff authentication/RBAC/audit (CP03–CP06); các module
Admin mẫu khác vẫn ngoài phạm vi. Runbook vận hành:
`docs/runbooks/PMS-ADMIN-AUTH-001-staff-calendar.md`. **Chưa deploy Production.** Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP07-completion.md`. Review CP07: NOT RUN.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP06`, viết khi PR #79 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP05` (PR #78) đã **merged** (`2026-10-03T08:23:15Z`), merge commit
`8f6222984b8678027e71523f27274407f8eeeb35`. CP06 chỉ đổi Admin_Web (không backend, schema,
dependency hay CI): `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` = `LocalGate` (mặc định khi
không đặt) | `Staff`; rỗng/giá trị khác là lỗi cấu hình và không gửi request Calendar nào;
không probe, không fallback, đổi giá trị cần rebuild/restart. `Staff` mode: trang `/signin`
đăng nhập Staff (password gửi nguyên văn), `/calendar` chờ `me` (401 → `/signin`, lỗi →
Retry), selector Property từ `me.memberships`, UI theo role (FrontDesk không có
cross-RoomType, Manager có), 401 kết thúc session, 403 đọc lại `me` và cập nhật quyền;
login/logout/me/board/năm write dùng `credentials: "include"`. `LocalGate` giữ nguyên
hành vi CP05. Pending/unknown uncertain writes giữ nguyên qua reload, sign-out và đổi
Staff (không namespace theo Staff). Acceptance browser thật (Chrome, cert tin cậy) chạy
trên PostgreSQL 17 riêng đã dọn. Default/Production vẫn CP07. Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP06-completion.md`. Review CP06: RUN — 2 findings (P2:
logout bị refresh ghi đè; ghi mới trong lúc logout pending), Reviewed SHA: UNVERIFIED;
correction C1 trên cùng PR #79 sửa cả hai. Review C1: RUN — 2 findings (P2: refresh bị
logout ngắt bị mất; logout kết thúc trước recovery), Reviewed SHA: UNVERIFIED; correction C2
trên cùng PR #79 sửa cả hai. Review C2: RUN — 1 finding (P2: permission refresh lỗi sau
403 bị bỏ qua), Reviewed SHA: UNVERIFIED; correction C3 trên cùng PR #79 sửa. Review C3: RUN — 1 finding (P2: deferred access failure
lỗi thời đóng Board sau check mới hơn), Reviewed SHA: UNVERIFIED; correction C4 trên cùng PR #79
sửa. Review C4: NOT RUN.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP05`, viết khi PR #78 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP04` (PR #77) đã **merged** (`2026-10-03T06:40:05Z`), merge commit
`f3f705f5e033fbcb231e19ed8ba9051f9b901dc8` — gồm correction C1. Owner chốt D8 khi kích
hoạt CP05: audit actor `staff:{StaffAccountId}` (GUID, không PII), evidence cross-RoomType
`staff-rbac:{role}:{propertyId}:cross-room-type-confirmed` từ authorization server-side.
CP05 chuyển đổi đúng năm Calendar POST: trong `Staff` mode mỗi action cần Staff session
và permission tại Property của route (`AssignmentWrite`/`BlockWrite`), rồi Origin/JSON —
tất cả trước model binding; create/move có `confirmCrossRoomType` cần thêm
`AssignmentCrossRoomType` (Manager) trước store; audit ghi Staff thực hiện (block cancel
giữ creator của header). `LocalGate` (mặc định) giữ write gate và constants cũ. Admin_Web
chưa dùng Staff cookie/login (CP06); default/Production vẫn CP07; Calendar chưa mở công
khai. Evidence: `docs/reports/PMS-ADMIN-AUTH-001-CP05-completion.md`. Review CP05: NOT RUN.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP04`, viết khi PR #77 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP03` (PR #76) đã **merged** (`2026-10-03T05:18:26Z`), merge commit
`c89efc22246771541f6aefecf0221374076a192f` — gồm correction C1/C2; reviewed SHA của các
lần review vẫn UNVERIFIED. Owner chốt D7 khi kích hoạt CP04:
`AdminCalendar:AccessMode` = `LocalGate` | `Staff` (thiếu key → `LocalGate`; giá trị
khai báo rỗng/không hợp lệ → host không khởi động; mode cố định từ startup). CP04 thêm
`IStaffAccessEvaluator` (membership đọc từ DB mỗi request theo `propertyId` của route,
map cố định FrontDesk/Manager), và **chỉ** Board GET được chuyển: trong `Staff` mode
Board cần Staff session + `BoardRead` tại Property (401/403 trước model binding, local
flags bị bỏ qua, CORS credentialed GET cho Admin origins); mọi route `/api/admin` khác
không có Staff permission — gồm năm Calendar POST — trả 404 trong `Staff` mode, trừ
login/logout/`me` của CP03. `LocalGate` (mặc định) giữ nguyên hành vi. Default chưa đổi
sang `Staff`; writes Staff chờ CP05, Admin_Web CP06, default/Production cut-over CP07;
D8 (audit actor) vẫn **mở**. Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP04-completion.md`. Review CP04: RUN, 1 finding P2
(`"AccessMode": {}`/`[]` trong JSON bị coi như không khai báo → âm thầm `LocalGate`);
correction `CP04-C1` sửa: chỉ key thực sự không được khai báo mới là `LocalGate`, khai
báo rỗng/null/có child bị từ chối khi khởi động. Review C1: RUN — không có regression cần
xử lý.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP03`, viết khi PR #76 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP02` (PR #75) đã **merged**, merge commit
`6baefe90c409ba22f050c235bc2d5d0cf060cbd6`. Owner chốt D3/D4 khi kích hoạt CP03:
scheme riêng `TheBha.Staff` (cookie `.TheBha.Staff`, `Path=/api/admin`,
`SameSite=Strict`, 8 giờ tuyệt đối, không sliding), Customer vẫn là default
scheme; CSRF cho Staff bằng `SameSite=Strict` + exact Origin + JSON content type,
không antiforgery token. CP03 thêm `POST /api/admin/v1/auth/login`,
`POST /api/admin/v1/auth/logout`, `GET /api/admin/v1/me` (memberships đọc từ DB mỗi
request), CORS credentialed `admin-staff`, limiter `staff-login`, và tách predicate
Origin/JSON của `AdminCalendarWriteGateFilter` thành `AdminRequestBoundary` (hành vi
gate không đổi). Staff session **không** cấp quyền vào Calendar: Board và các route
ghi vẫn chỉ sau gate local; D7 (`AccessMode`) và D8 (audit actor) vẫn **mở**.
Evidence: `docs/reports/PMS-ADMIN-AUTH-001-CP03-completion.md`. CP04–CP07 chưa được
kích hoạt. Review Codex đầu tiên (Owner gọi): RUN, 2 finding P2; correction
`CP03-C1` sửa cả hai — reset failed count thất bại thì không cấp Staff session (401
chung), và bỏ `MaxLength(128)` của password login để password dài do CLI CP02 cấp
đăng nhập được. Review C1: RUN, 1 finding P2 (count = 0 không có update kiểm tra
concurrency); correction `CP03-C2` sửa: login thành công luôn ghi lại account bằng
update kiểm tra `ConcurrencyStamp` (reset khi count > 0, `UpdateAsync` khi count = 0)
trước khi cấp session. Review C2: RUN — không có regression cần xử lý (reviewed
SHA: UNVERIFIED).

Bản cập nhật trước (2026-10-01, `PMS-ADMIN-AUTH-001-CP02`, viết khi PR #75 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP01` (PR #74) đã **merged**, merge commit
`3c1eefd5836e6fb1710817ff86021e391c55179d`. Owner quyết định D6: Staff chỉ được
tạo/quản lý qua CLI bốn verb trên API host (`--staff-create`, `--staff-grant`,
`--staff-disable`, `--staff-reset-password`), không HTTP, không Staff trong seed;
Production do Owner hoặc người Owner chỉ định chạy sau khi xác nhận database đích;
mật khẩu qua hidden prompt (hoặc `BHA_STAFF_PASSWORD` ngắn hạn), không qua
argument. CP02 thêm `Api/Authentication/StaffBootstrapCommand.cs` — chưa có đăng
nhập Staff, cookie, route authorization hay audit Staff; các gate local
unauthenticated vẫn là cơ chế duy nhất truy cập Admin và Calendar chưa sẵn sàng
mở công khai. Owner cũng đổi chính sách kích thước: 100–400 dòng mỗi PR là
**mục tiêu, không phải giới hạn** (`docs/governance/WORKFLOW.md` §6); câu "CP02–CP07
vẫn giữ giới hạn" ở đoạn CP01 bên dưới đã hết hiệu lực. Vẫn **mở**: D3 (scheme
`TheBha.Staff`), D4, D7, D8. Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP02-completion.md`. CP03–CP07 chưa được kích hoạt.

Bản cập nhật trước (2026-10-01, `PMS-ADMIN-AUTH-001-CP01`, viết khi PR #74 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP00` (PR #73) đã **merged**, merge commit
`874f1481808afbcc83e18950b00d6ab07368b1be`. Owner đã duyệt: Staff là identity
riêng (D1); role chỉ `FrontDesk`/`Manager`, không `Viewer`; Staff dùng password/
lockout policy của Customer, MFA hoãn; ADR 0007 nằm trong CP01; riêng CP01 được
vượt giới hạn 100–400 dòng kèm lời giải thích (phần lớn là output EF sinh tự
động; CP02–CP07 vẫn giữ giới hạn). Vẫn **mở**, không được duyệt bởi merge #73
hay CP01: D3 (scheme `TheBha.Staff`), D4, D6 và bootstrap Production, D7, D8.
CP01 thêm `StaffAccount`, `StaffPropertyMembership`, migration 9
`20261001141847_AddStaffIdentityFoundation` và ADR 0007 — **chỉ schema và
Identity store**: chưa có đăng nhập Staff, cookie, endpoint, CLI bootstrap,
route authorization hay audit Staff; các gate local unauthenticated vẫn là cơ chế duy nhất
truy cập Admin. Evidence: `docs/reports/PMS-ADMIN-AUTH-001-CP01-completion.md`.
CP02–CP07 chưa được kích hoạt.

Cập nhật 2026-09-30 (`PMS-ADMIN-AUTH-001-CP00`, docs, không đổi source):
`PMS-CAL-001.5-CP04` (PR #72) đã **merged**, merge commit
`0952e1b58e274a055b47ca3f04beb6fe08ed5ed8` (`origin/develop`). Owner chọn Admin
authentication/RBAC làm milestone tiếp theo; `PMS-ADMIN-AUTH-001-CP00` là PR
thiết kế (Draft) —
`docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md`. Đó là **đề xuất chờ Owner
duyệt**, chưa phải CURRENT: chưa có Staff, role, membership hay đăng nhập
Admin nào; các gate local unauthenticated vẫn là cơ chế duy nhất. CP01–CP07
chưa được kích hoạt.

Bản cập nhật trước (2026-09-30, `PMS-CAL-001.5-CP04`, docs/evidence, không đổi source):
`origin/develop` = `3d7eb12b09286bbb2aa79590442f4ace69321563` (PR #71). PR
#48–#71 đều **merged**; các câu bên dưới nói CP04B là "đang thực thi" đã hết
hiệu lực. Trong `develop` hiện có, trên Admin Reservation Board (local
Development, write gate CP01, không Admin authentication/RBAC): assign
(#45/#46), move bằng dialog (#52–#55), unassign (#56–#63), tạo và hủy
operational block (#64–#67), kéo một assigned segment sang phòng khác để
**mở dialog Move** (#68; drop chỉ chọn phòng, ngày và `expectedVersion` lấy
từ segment, chỉ confirm mới gửi), và bảo vệ write qua reload **cùng tab**
(#70/#71 cùng C2–C4 trong #71: lưu intent vào `sessionStorage` trước khi gửi,
khôi phục thành "gửi rồi, chưa rõ kết quả", khóa đúng Property/phòng/đêm,
không tự gửi lại). Đây **không** phải idempotency phía server, không bảo vệ
qua tab/thiết bị khác hay khi đóng browser. Evidence live của checkpoint này:
`docs/reports/PMS-CAL-001.5-CP04-completion.md`. Chưa hoàn tất: Admin
authentication/RBAC, deploy công khai, lifecycle/payment, split/swap/batch qua
HTTP, OperationalBlock move/split, OTA thật.

Lần cập nhật này ghi nhận `PMS-CAL-001.1` — Reservation Board Read
Projection & Frontend Integration — đã **merged và closed**: PR #41 merge
vào `develop` lúc `2026-09-03T03:11:21Z`, merge commit
`e0f5a395aec15cc02e328433a97850e30e165675`. Bản Snapshot trước mô tả PR #41
là **Draft/OPEN/chưa merge**; mô tả đó được viết trước thời điểm merge và
nay đã hết hiệu lực. Mọi câu "đang chờ Codex review trên C11 PR head" trong
các bản trước cũng đã hết hiệu lực.

`PMS-CAL-001.2-CP01` — Local Admin Write Gate foundation — đã **merged**:
PR #43 merge vào `develop` lúc `2026-09-11T12:53:38Z`, merge commit
`c8c1ea50e2b2eec44b1ae30e65a7919596458f99`, remote feature branch đã xóa.
`PMS-CAL-001.2-CP02` (PR #44, merge commit
`2f50951b8197eab7e2180e2ea4498a9fea1042d8`), `CP03A` (PR #45, merge commit
`261f75595042d9549ac3133b503cd09a66ed193a`), `CP03B` (PR #46, merge commit
`16303edd472e4b960db8b765f69b394f58411246`) và `CP04A` (PR #47, merge commit
`2fefb6295e4b772411dc2c63c270e298253690db`) đều đã **merged**; CI `success`
trên đúng từng merge commit, remote feature branch đã xóa. `CP04B` (PR #48)
và các PR sau đến #71 cũng đã merged (đoạn cập nhật ở đầu file). Không có mô
tả nào ở đây tuyên bố production readiness.

Lịch sử checkpoint của `PMS-CAL-001.1` được giữ lại vì mỗi CI run và review
result trích dẫn dưới đây gắn với **đúng SHA nêu kèm**, không tự động áp cho
SHA khác (xem §1, §2, §8; evidence canonical ở
`docs/reports/PMS-CAL-001.1-completion.md`):

- **Product-reviewed checkpoint** — `63d9b6019e4af37e146d943a1b8c1c13ac096469`:
  implementation cộng correction cycles `C1`–`C9`. CI run `33707673146`
  `success` trên đúng SHA đó; Codex review trên chính checkpoint này trả
  về **không có actionable correctness defect**. Đây là checkpoint mà
  product code đã được review, **không phải** PR head hiện tại.
- **C10 docs-only checkpoint** — `e6999914dd7a5afbf791506ffb598a99b8c320e6`:
  đồng bộ Snapshot, không đụng product code. CI run `33708652703` `success`.
  Codex review trên checkpoint này trả về **hai finding tài liệu**, không
  phát hiện thêm defect nào trong product code.
- **C11**: docs-only correction xử lý hai finding đó; là commit cuối trên
  feature branch trước khi Owner merge.
- **Merge commit** — `e0f5a395aec15cc02e328433a97850e30e165675`: CI run
  `33710458612` `success` (Backend/Frontend/Admin) trên đúng merge commit.

Repository SHA và PR state bên dưới đã được xác minh trực tiếp qua
`git`/`gh` tại thời điểm cập nhật tài liệu này, không phải cam kết rằng SHA
này sẽ còn là `develop` HEAD sau các commit tiếp theo; revalidate lại
`origin/develop` trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `c81f06f68cb16b6a2e5e74976c20c0654789e353` (merge commit của PR #108, xác minh 2026-10-13 bằng `git fetch --prune origin`; trước đó `3be18c3` = PR #107, `2ad2bc9` = PR #106; đọc lại từ Git sau `git fetch --prune origin` trước khi dùng làm baseline) |
| PR #31 | merged — `docs(pms): record core database blueprint v2`, merge commit `bfb3377b701e9309d3cbbea22bb18159bc37a2e0`, merged `2026-08-19T10:56:01Z`. Persists PMS blueprint documentation foundation (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006). |
| PR #32 | merged — `feat(admin): add PMS reservation board UI baseline`, merge commit `17e929d7c1f82941599223344b5f4cdc3aa34307`, merged `2026-08-22T14:42:31Z`. Closes `ADMIN-002.1`. |
| PR #33 | merged — `docs(project): close ADMIN-002.1 and record next sequence`, merge commit `2c38face7cf51d7271c361e6d684adea466edcf9`, merged `2026-08-22T15:38:25Z`. Closes `ADMIN-002.1-DOCS-CLOSEOUT`. |
| PR #34 | merged — `docs(project): record Graphify tooling adoption`, merge commit `7db8844dfde5ccc0651949f83ddfff76a3a977b9`, merged `2026-08-22T19:08:04Z`. Closes `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`; remote branch `docs/tool-graphify-001-closeout` deleted. This row is the current-state truth, replacing a since-corrected stale reference that had lingered in this file's own §7 section. |
| PR #35 | merged — `feat(booking): normalize commercial commitments`, feature branch `feature/pms-be-001-1-commercial-commitment-v2-foundation` (head `9e25f7cb6247420467957061a13c04801ce9b3c7`), merge commit `265d10006b219e456c30ed92bbb6c153a946944d`, merged `2026-08-24T16:46:46Z`. Closes `PMS-BE-001.1`. GitHub CI (Admin/Backend/Frontend) confirmed `pass` on this PR as of this Snapshot update (`gh pr checks 35`). Remote feature branch deleted (confirmed empty via `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`); the linked worktree `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for its implementation is confirmed removed (directory absent, not listed by `git worktree list --porcelain`) — see §4. |
| PR #36 | merged — `docs(project): close PMS-BE-001.1 and restore single-checkout workflow`, feature branch `docs/pms-be-001-1-closeout-single-checkout` (head `c8938c731dd5647868a07f0c3654d919e5d60e9a`), merge commit `298b7fd53c47824550e955b98c2bed370b38a646`, merged `2026-08-24T19:17:44Z`. Closes `PMS-BE-001.1-DOCS-CLOSEOUT`. |
| PR #37 | merged — `feat(pms): add physical room schedule and availability authority`, feature branch `feature/pms-be-001-2-physical-room-schedule-availability` (head `4b2de0ab50fa1703f0b125a043d2461cc0309417`), merge commit `0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`, merged `2026-08-26T10:33:13Z`. Closes `PMS-BE-001.2`. GitHub Actions (Backend/Frontend/Admin) confirmed `success` on this head (run `32957454881`). Remote feature branch confirmed deleted (`git ls-remote --heads origin feature/pms-be-001-2-physical-room-schedule-availability` empty). |
| PR #38 | merged — `docs(project): close PMS-BE-001.2 and record calendar handoff`, feature branch `docs/pms-be-001-2-closeout` (head `9b627fb29ce4b5b955e6e5640a465aa03953304f`), merge commit `f0eef23c59608d2aba1e43063c38074ea863edef`, merged `2026-08-26T12:01:07Z`. Closes `PMS-BE-001.2-DOCS-CLOSEOUT`. |
| PR #39 | merged — `docs(governance): allow prompt-selected single implementer`, merge commit `89b631cc58cb4d21e99d6054d2a9094338283fc7`, merged `2026-09-01T15:44:40Z`. Closes `AI-OPS-GOV-003`. |
| PR #40 | merged — `test(backend): pin clock in reservation-cancellation integration test`, feature branch `fix/pin-clock-reservation-cancellation-test`, merge commit `ff9d5b0c8d58efe64b562c631ecb36d488887df8`, merged `2026-09-01T15:57:51Z`. Unplanned CI fix: `AssignmentAwareAvailabilityTests.Reservation_cancellation_atomically_cancels_effective_assignments_and_removes_demand` never pinned `factory.Clock.UtcNow`, so it silently depended on real wall-clock time staying before its hardcoded `2026-09-01` check-in date. GitHub Actions (Admin/Backend/Frontend) confirmed `pass` on this head. Remote feature branch confirmed deleted. |
| PR #41 | merged — `feat(pms): Reservation Board read projection & Admin frontend integration`, feature branch `feature/pms-cal-001-1-board-read-integration`, checked out directly in the one repository checkout (no `git worktree add`), baseline `ff9d5b0c8d58efe64b562c631ecb36d488887df8` (PR #40), merge commit `e0f5a395aec15cc02e328433a97850e30e165675`, merged `2026-09-03T03:11:21Z`. Closes `PMS-CAL-001.1`. GitHub Actions (Backend/Frontend/Admin) `success` trên đúng merge commit (run `33710458612`). Remote feature branch confirmed deleted. Checkpoint/correction history (`C1`–`C11`) và toàn bộ evidence: `docs/reports/PMS-CAL-001.1-completion.md` (không liệt kê lại ở đây). |
| PR #42 | **CLOSED, NOT MERGED** — `fix(governance): reconcile merged PR state`, base `develop`, head branch `chore/ai-ops-gov-004-reconcile-pr41`. Một nỗ lực governance reconcile sau merge của PR #41; Owner đóng PR mà không merge, nên **không có** nội dung nào của nó nằm trong `develop` và không có commit nào của nó là ancestor của baseline hiện tại. Ghi ở đây chỉ để `#42` không bị đọc nhầm là đang mở hoặc đã merge. |
| PR #43 | merged — `feat(admin): local Admin Calendar write gate foundation`, feature branch `feature/pms-cal-001-2-cp01-local-write-gate`, baseline `e0f5a395aec15cc02e328433a97850e30e165675` (PR #41), merge commit `c8c1ea50e2b2eec44b1ae30e65a7919596458f99`, merged `2026-09-11T12:53:38Z`. Closes `PMS-CAL-001.2-CP01` (implementation cộng correction `C1`). Remote feature branch confirmed deleted (`git ls-remote --heads origin feature/pms-cal-001-2-cp01-local-write-gate` rỗng). Evidence: `docs/reports/PMS-CAL-001.2-CP01-completion.md`. |
| PR #44 | merged — `feat(admin): Admin reservation-assignment create API (PMS-CAL-001.2-CP02)`, merge commit `2f50951b8197eab7e2180e2ea4498a9fea1042d8`, merged `2026-09-13T08:02:12Z`. CI run `34746682303` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #45 | merged — `feat(admin): same-RoomType reservation assignment from the board (PMS-CAL-001.2-CP03A)`, merge commit `261f75595042d9549ac3133b503cd09a66ed193a`, merged `2026-09-14T17:09:04Z`. CI run `34872986691` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #46 | merged — `feat(admin): controlled cross-RoomType reservation assignment (PMS-CAL-001.2-CP03B)`, merge commit `16303edd472e4b960db8b765f69b394f58411246`, merged `2026-09-14T18:02:54Z`. CI run `34878420882` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #47 | merged — `fix(backend): record SupersedeAsync authorization evidence per audit event (PMS-CAL-001.2-CP04A)`, merge commit `2fefb6295e4b772411dc2c63c270e298253690db`, merged `2026-09-14T18:58:06Z`. CI run `34884020638` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #48–#71 | merged (2026-09 → 2026-09-30); CI của từng PR nằm trong mô tả PR đó, riêng merge #71 (`3d7eb12`) là run `36690121585` `success`: CP04B route move/unassign (#48, `b898c39`); CP04C–D move/unassign trên board (#49–#63); `PMS-CAL-001.3` block create/cancel API và board (#64–#67, `21240aa`); `PMS-CAL-001.4-CP01` kéo-để-mở-dialog-move (#68, `27c962d`); `PMS-CAL-001.5` CP01 (#69, `56eff1c`), CP02 (#70, `80f582e`), CP03 (#71, merge `3d7eb12b09286bbb2aa79590442f4ace69321563`). |
| PR #72–#80 | merged: `PMS-CAL-001.5-CP04` (#72, `0952e1b`); `PMS-ADMIN-AUTH-001` CP00 (#73, `874f148`), CP01 (#74, `3c1eefd`), CP02 (#75, `6baefe9`), CP03 (#76, `c89efc2`), CP04 (#77, `f3f705f`), CP05 (#78, `8f62229`), CP06 (#79, `c62719b`), CP07 (#80, merge `38d4a9d964fde411aa4c03b46323f250fd54221b`, `2026-10-04T09:32:21Z`, CI run `37192482384` `success`). Tại 2026-10-13 (Git/GitHub): PR #81–#106 đều merged trừ #88 (CLOSED, không merge), không có PR mở; `develop` = `2ad2bc967735931a9390112d796c3cdd870ed1df` (PR #106). |

## 2. Work item state

### Hoàn tất

- `FE-001`: closed trước baseline hiện tại.
- `DATA-001.1`: đạt technical gate, PR #22 đã merge; `DATA-001.2` vẫn
  dormant/deferred (xem §5).
- `AI-OPS-GOV-002`: `PASS`.
- `AI-OPS-PILOT-001`: `PASS` — PR #27, merge `bb64f7e1592f4924049935ecc08922539c532bf8`.
- `FE-002.1` — Hold Confirmation UI: `PASS — CLOSED`. PR #28, merge commit
  `3f68bd79eff7f6c553e5516431abd09a93298f71`, merged 2026-08-12T13:39:21Z.
  Full evidence in `docs/daily/2026-08/2026-08-12-worklog.md`.
- `ADMIN-001.1` — Admin Web Template Baseline: `PASS — CLOSED`. PR #30
  merged (`f97c3529fb94c08fafad0da059ec1cf2b839b0d0`, 2026-08-18T10:12:53Z).
  Imports TailAdmin 2.3.0 as `Front_End/Admin_Web`.
- `PMS-DATA-DOCS-001`: `PASS — CLOSED`. PR #31 merged as above. Persists the
  Owner-approved TARGET PMS/database architecture into durable
  documentation. No table, column, constraint, migration, entity, endpoint,
  or UI described there is implemented by that documentation.
- `ADMIN-002.1` — PMS Reservation Board UI Baseline: `PASS — CLOSED`. PR #32
  merged as above. **This is the completed frontend phase**: an
  interactive Admin Reservation Board/Calendar prototype in
  `Front_End/Admin_Web` (room/date timeline, multi-property demo switching,
  assigned/unassigned reservations, operational blocks, front-desk
  reservation-creation and lifecycle/folio/notes/activity workspaces). Full
  evidence in `docs/reports/ADMIN-002.1-completion.md`. Only the frontend
  UI baseline is complete — see §5 for its mock-only boundary.
- `ADMIN-002.1-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #33 merged as above.
  Docs-only synchronization; no product source touched.
- `TOOL-GRAPHIFY-001` (Graphify tooling-adoption): `PASS — CLOSED`, adopted
  as an **optional, workspace-local** code-navigation tool. Full evidence in
  `docs/reports/TOOL-GRAPHIFY-001-completion.md`;
  `docs/governance/WORKFLOW.md` §12 is the canonical invocation policy.
- `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #34 merged as
  above. Docs-only diff; no product source touched.
- `PMS-BE-001.1` — Commercial Commitment V2 Foundation: `PASS — CLOSED`. PR
  #35 merged as above. Replaces the single-RoomType
  `BookingHold`/`BookingHoldNight`/`Reservation`/`ReservationNight`
  commercial authority with the normalized ADR 0005 `InventoryHold →
  InventoryHoldItem → InventoryHoldItemNight` / `Reservation →
  ReservationUnit → ReservationUnitNight` authority (migration 7,
  `CommercialCommitmentV2Foundation`), while preserving the public
  `/api/v1` contract byte-identical. Correction `PMS-BE-001.1-C1` (a Codex
  `[P1]` finding on the guarded downgrade's cross-night RatePlan check) was
  fixed and closed before merge — see
  `docs/reports/PMS-BE-001.1-completion.md`. Final Codex review: `PASS`, no
  discrete actionable correctness issue (Owner/OC-confirmed context for
  this closeout; not independently re-derivable from GitHub, since this
  repository's Codex review results are relayed through Owner/OC rather
  than posted as PR comments — no `gh pr view 35` comment trail exists to
  quote verbatim). Full detail in §4.
- `PMS-BE-001.1-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #36 merged as above
  (§1). Docs-only closeout of `PMS-BE-001.1` and restoration of
  single-primary-checkout-by-default governance; no product source touched.
- `PMS-BE-001.2` — Physical Room Schedule & Availability Authority:
  `PASS — CLOSED`. PR #37 merged as above (§1). Delivers the PhysicalRoom
  schedule database authority, block-adjusted/assignment-attributed
  availability, whole-Reservation cancellation cleanup, and an
  internal-only assignment/block mutation boundary with no HTTP/Admin
  exposure and no Staff/RBAC model — full as-built detail in ADR 0006 and
  `docs/reports/PMS-BE-001.2-completion.md`, not repeated here. Two
  Owner-invoked Codex corrections (`C1`: active-Hold demand omitted from
  mutation capacity validation; `C2`: booked-night coverage trigger let a
  `ReservationUnitNight` transfer ownership between Units unvalidated) were
  fixed and closed before merge — see the completion report. Does **not**
  implement: multi-RoomType public request shape, `Organization`, Admin
  authentication/RBAC, Staff identity, any HTTP exposure of the schedule
  authority, OTA, `FolioEntries`, or `DATA-001.2`.
- `PMS-BE-001.2-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #38 merged as above
  (§1). Docs-only closeout of `PMS-BE-001.2` after PR #37 merged; records
  `PMS-CAL-001.1` as the next Control-Tower-selected product work item,
  authorized for OC planning only, not implementation.
- `AI-OPS-GOV-003` — Prompt-Selected Single Implementer and Independent
  Reviewer: `PASS — CLOSED`. PR #39 merged as above (§1). Governance-only:
  replaces the repository's fixed Claude-implements/Codex-reviews
  assignment with a prompt-selected role pair (`docs/governance/RULES.md`
  §2.4), while preserving one writer, independent read-only review, OC
  authority and Owner-only merge. Went through correction cycles
  `C1`/`FINAL-SIMPLIFICATION`/`RESIDUAL-FIX`/`FINAL-INVOCATION-FIX` before
  merge — full detail in `docs/daily/2026-09/2026-09-01-worklog.md`.
- `CI fix (unplanned)`: `PASS — CLOSED`. PR #40 merged as above (§1). Fixed
  a test-time-bomb (`AssignmentAwareAvailabilityTests`, unpinned
  `factory.Clock.UtcNow` against a hardcoded 2026-09-01 date) that broke CI
  once real wall-clock time caught up. Not tied to any work-item ID; not a
  product/schema change.
- `PMS-CAL-001.1` — Reservation Board Read Projection & Frontend
  Integration: `PASS — CLOSED`. PR #41 merged as above (§1), merge commit
  `e0f5a395aec15cc02e328433a97850e30e165675`, `2026-09-03T03:11:21Z`. Adds
  the read-only Admin Reservation Board projection
  (`GET /api/admin/v1/properties/{propertyId}/reservation-board`, gated to
  same-machine development by `AdminCalendar:EnableUnauthenticatedRead`) and
  wires `Front_End/Admin_Web`'s board to it. Correction history `C1`–`C11`
  and all evidence — **canonical** — in
  `docs/reports/PMS-CAL-001.1-completion.md`. Does **not** implement: any
  mutation endpoint, Admin authentication/RBAC, Staff identity, or a schema
  change (still migration 8).

- `PMS-CAL-001.2-CP02` (PR #44), `CP03A` (PR #45), `CP03B` (PR #46) — merged.
  CP02 expose đúng một endpoint local-only
  `POST /api/admin/v1/properties/{propertyId:guid}/reservation-assignments`
  trên `IAssignmentMutationStore.CreateAsync`; CP03A cho Admin Reservation
  Board gọi nó để gán một unassigned range vào phòng Active cùng sold
  RoomType; CP03B mở rộng cùng dialog sang cross-RoomType có xác nhận thao
  tác và reason bắt buộc. Evidence nằm trong mô tả của từng PR.

### Hoàn tất (tiếp)

- `PMS-CAL-001.2-CP04A` (PR #47) — merged. `SupersedeAsync` ghi
  `AuthorizationEvidence` per audit event, không còn copy nguyên command
  evidence vào mọi row.

### Đang thực thi

- `PMS-ADMIN-AUTH-001` — Staff authentication/RBAC cho Admin Calendar: `PASS — CLOSED`.
  CP00–CP07 merged (PR #73–#80, CP07 merge `38d4a9d`). Chưa deploy Production.

### Đang thực thi

- `CUST-WEB-001-CP00` — Customer Web: audit và hợp đồng sản phẩm/release: merged (PR #107, `3be18c3`; contract `PROPOSAL`, chưa Owner duyệt). Evidence: `docs/reports/CUST-WEB-001-CP00-completion.md`, `docs/design/CUST-WEB-001-product-contract.md`.
- `CUST-WEB-001-CP01a` — nền Customer session: merged (PR #108, `c81f06f`; evidence `docs/reports/CUST-WEB-001-CP01a-completion.md`).
- `CUST-WEB-001-CP01b` — guard đổi danh tính ↔ booking: merged (PR #109, `1964a7b`; evidence `docs/reports/CUST-WEB-001-CP01b-completion.md`).
- `CUST-WEB-001-CP02` — UI đăng nhập/đăng xuất/identity (merged PR #110, `cdf41cf`; evidence `docs/reports/CUST-WEB-001-CP02-completion.md`).
- `CUST-WEB-001-CP03` — UI đăng ký Customer (+ `C1`; merged PR #111, `1278507`; evidence `docs/reports/CUST-WEB-001-CP03-completion.md`).
- `CUST-WEB-001-CP04` — trang tài khoản Customer chỉ đọc (Draft PR; evidence `docs/reports/CUST-WEB-001-CP04-completion.md`). `CP05+` chưa bắt đầu.
- (Đã hoàn tất, thay thế các dòng “Draft PR” cũ ở đây) `CUST-WEB-SHOWCASE-001` CP01–CP02: PR #82, #83, #86, #87/#89 merged (xem đầu file). `PMS-CAL-002` CP00–CP05 merged (PR #81, #97–#102), `PMS-CAL-003` CP01–CP03 merged (PR #103–#105), `PMS-CAL-004-CP01` merged (PR #106).
- Các mutation khác (assignment swap/batch, operational-block move/split) **chưa kích
  hoạt**; Snapshot này không tự mở chúng.

### Quyết định đang hiệu lực

`PMS_ADMIN_AUTH_001_CLOSED__CUST_WEB_001_CP01B_IDENTITY_GUARD_ACTIVE`

Ý nghĩa:

- `PMS-CAL-001.1` đã merge và đóng (`PASS — CLOSED`). Merge commit
  `e0f5a395aec15cc02e328433a97850e30e165675`; CI run `33710458612`
  `success` trên đúng commit đó. Remote feature branch đã bị xóa. Không còn
  bước review hay merge nào đang chờ cho work item này; mọi mô tả "đang chờ
  Codex review trên C11 PR head" trong các bản Snapshot trước đã hết hiệu
  lực.
- Owner đã thay kế hoạch một PR lớn cho `PMS-CAL-001.2` bằng các checkpoint
  độc lập. `CP01`–`CP04D` đã merge (PR #43–#63); `PMS-CAL-001.3`–`.5`
  cũng đã merge đến PR #71; các checkpoint sau chưa được kích hoạt.
- Admin Calendar (Board read và năm route ghi) có Staff authentication,
  RBAC theo Property/role và audit `staff:{id}` (`PMS-ADMIN-AUTH-001` CP03–CP06,
  merged); CP07 (PR #80, merged) làm `Staff` thành mặc định và giới hạn `LocalGate`
  (write/read gate same-machine development, không auth) thành opt-in
  Development. Chưa có Production deployment; các module Admin mẫu khác vẫn
  ngoài phạm vi. Admin Reservation Board là caller duy nhất của các route.
- Chỉ Owner được mark Ready, merge và branch cleanup. Claude không merge,
  không mark Ready, không xóa branch, và không tự invoke Codex.
- Governance vẫn dùng đúng một checkout repository duy nhất cho execution
  (`docs/governance/RULES.md` §5); `git worktree add` và mọi checkout thực
  thi bổ sung đều bị cấm, không có ngoại lệ.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET vượt ngoài phạm
  vi `PMS-BE-001.1`/`PMS-BE-001.2` và ngoài phạm vi planning-only của
  `PMS-CAL-001.1` (Organization, multi-RoomType Hold/Reservation
  **request** shape, HTTP/Admin/Calendar exposure của
  `RoomOccupancySegments`/`RoomBlock` vượt ngoài `PMS-CAL-001.1` và
  `PMS-CAL-001.2`'s exact scope, `FolioEntries`, OTA
  adapter/inbox/outbox): **locked** — documented as TARGET/APPROVED by
  `PMS-DATA-DOCS-001`, not authorized for implementation until its own
  Master Execution Prompt.
  Staff identity và Admin Calendar authentication/RBAC không còn locked: chúng
  CURRENT qua `PMS-ADMIN-AUTH-001` (PR #73–#80).
- Payments/refunds, full housekeeping/maintenance modules, production
  migrations for any remaining PMS TARGET entity, and adapter-specific OTA
  design: locked, unrelated separately authorized future work.

## 3. Current PostgreSQL schema and Hold/Reservation model

- `PMS-ADMIN-AUTH-001-CP01` (merged, PR #74) adds migration 9,
  `20261001141847_AddStaffIdentityFoundation`: `StaffAccounts` and
  `StaffPropertyMemberships` (ADR 0007; `docs/DATABASE.md`). Migrations 1–8
  are unchanged. The bullet below records the chain as of `PMS-BE-001.2`.
- Migration chain is now **eight** migrations, ending at
  `20260826035254_PhysicalRoomScheduleAvailabilityAuthority` (`PMS-BE-001.2`
  migration 8, this work item). Migrations 1–7 (pre-existing before
  `PMS-BE-001.2`) are byte-identical to `origin/develop` — confirmed via
  `git diff origin/develop` at this Snapshot update. No ninth migration was
  created; Phase 4's mutation-command work reused migration 8's schema and
  the ADR 0006 exclusion/trigger invariants without any further schema
  change. No other PMS migration exists (`Organization`, `FolioEntries`, OTA
  inbox/outbox remain unimplemented — see below).
- CURRENT commercial commitment authority (`BE-003.1`–`BE-003.5`,
  `PMS-BE-001.1`) is the ADR 0005 normalized model:
  `InventoryHold → InventoryHoldItem → InventoryHoldItemNight` and
  `Reservation → ReservationUnit → ReservationUnitNight`. Every persisted
  Item/Unit represents exactly one room (no `Quantity`/`Rooms` field exists
  on Item/Unit/Night); every nightly row carries its own `RatePlanId` and
  accepted money. `ReservationUnit.CommitmentStatus = Committed | Cancelled`
  is the sole demand predicate — committed demand counts every
  `InventoryHoldItemNight` of an `Active`, unexpired Hold and every
  `ReservationUnitNight` of a `Committed` Unit, exactly once. The public
  `/api/v1` contract, and the CURRENT limitation to exactly one
  RoomType/RatePlan per public Hold/Reservation request, are both unchanged
  — the request is atomically normalized into `Q` independent Items/Units
  internally; multi-RoomType **request** shape remains TARGET. The legacy
  `BookingHold`/`BookingHoldNight`/`ReservationNight` tables and the
  `RoomTypeId`/`RatePlanId`/`Rooms` columns previously on `Reservations` no
  longer exist — there is no dual-write and no dormant normalized table.
- CURRENT physical-room schedule authority (`PMS-BE-001.2`, ADR 0006,
  migration 8): `RoomOccupancySegment` is the sole PhysicalRoom schedule —
  no separate `RoomAssignments` dual-write model — with PostgreSQL-enforced
  exclusion, booked-night-coverage, unit-commitment-consistency, and
  same-Property invariants, `xmin` optimistic concurrency, and append-only
  audit. Availability is block-adjusted and assignment-attributed.
  Whole-Reservation cancellation atomically cancels its assignment segments.
  Assignment/OperationalBlock mutation commands live behind the
  application/persistence boundary. Trên `develop` các operation được expose
  qua HTTP — từ `PMS-ADMIN-AUTH-001-CP07` mặc định cần Staff session và permission
  theo Property/role (`AccessMode=Staff`); `LocalGate` (write gate của CP01, PR #43)
  chỉ còn là opt-in Development —
  là: `CreateAsync` qua
  `POST /api/admin/v1/properties/{propertyId}/reservation-assignments` (CP02,
  PR #44; được Admin Reservation Board gọi qua PR #45/#46), `SupersedeAsync`
  dạng một-segment qua `POST .../reservation-assignments/{segmentId}/move` và
  `.../unassign` (CP04B), và `CreateBlockAsync` dạng một-segment qua
  `POST /api/admin/v1/properties/{propertyId}/operational-blocks`
  (`PMS-CAL-001.3-CP01`; Admin Reservation Board gọi từ CP03; endpoint từ chối
  `[startDate, endDate)` dài hơn **366 đêm** ngay tại HTTP boundary — chốt
  chặn tài nguyên, không phải business rule về độ dài closure), và
  `SupersedeSegmentsAsync` dạng một-segment, không replacement, qua
  `POST .../operational-blocks/{segmentId}/cancel` (`PMS-CAL-001.3-CP02`;
  Admin Reservation Board gọi từ CP04 — block bar → popover → dialog xác nhận
  hiển thị đúng toàn bộ nights của segment và `expectedVersion` từ board, rồi
  đọc lại board). `SupersedeAsync` dạng split/batch và
  OperationalBlock move/split/multi-segment supersede **vẫn** internal-only (thiết kế
  split-move một-segment: `PMS-CAL-002-CP00`, TARGET). Cross-RoomType assignment
  requires an `AuthorizationEvidence`/`Reason` pair: ở `Staff` mode evidence là
  `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed` từ authorization
  server-side (permission `AssignmentCrossRoomType`, Manager) và actor là
  `staff:{id}`; ở `LocalGate` vẫn là hằng số opaque. A
  shared `AdvisoryLockCoordinator` is now used by every advisory-lock-taking
  writer. Exact constraint names, SQLSTATEs, lock order, and error mapping
  are recorded in ADR 0006 and `docs/reports/PMS-BE-001.2-completion.md`,
  not duplicated here.
- No `Organization` entity, no `FolioEntries` table, and no OTA
  inbox/outbox exist anywhere in the current schema or codebase.
- CURRENT Admin Calendar read exposure (`PMS-CAL-001.1`, no schema change):
  one HTTP `GET` endpoint,
  `/api/admin/v1/properties/{propertyId}/reservation-board`, projects the
  existing `RoomOccupancySegment`/`RoomBlock` authority (above) into a
  frozen read-only JSON contract for the Admin Reservation Board frontend.
  **Read-only**: các route ghi (CP02/CP04B, merged) là những route riêng và
  không thuộc contract đọc này. Mỗi
  request chỉ được phục vụ khi **tất cả** điều kiện sau đúng, kiểm tra
  trước model binding: HTTPS; host environment là Development; địa chỉ
  local **và** remote của connection đều là loopback; và
  `AdminCalendar:EnableUnauthenticatedRead` là `true` — mà cờ này mặc định
  `false` **kể cả trong Development**, chỉ được bật bởi supported local
  HTTPS launch profile (từ CP07: biến môi trường local tường minh cùng
  `AdminCalendar__AccessMode=LocalGate`; `AdminCalendar__EnableUnauthenticatedRead=true`,
  bind duy nhất vào `localhost`), và không thể bật ở Production
  (startup-fatal). Mọi request không thỏa mãn nhận `404` + `no-store`,
  không phân biệt được với route không tồn tại. Đây là endpoint
  **same-machine development only** — không public production-ready; đó là
  `AccessMode=LocalGate`. Mặc định (`Staff`, CP07) thay các điều kiện này bằng
  Staff session + membership/role kiểm tra trên server (design §7). Exact contract/coverage-
  classification detail: `docs/reports/PMS-CAL-001.1-completion.md`.
- The `ADMIN-002.1` frontend's Reservation Board (§5) now reads this real
  endpoint instead of browser-memory mock state (`PMS-CAL-001.1`, §2); the
  rest of that prototype (front-desk creation workspace, lifecycle/folio/
  move demonstrations) is unchanged and still mock-only.

## 4. Verification evidence — prior closed work items

Full verification evidence for `FE-002.1` (PR #28) and `AI-OPS-PILOT-001`
(PR #27) remains recorded in `docs/daily/2026-08/2026-08-12-worklog.md`.

`ADMIN-001.1` (PR #30): Admin CI (independent job) green; template imported
with upstream TailAdmin attribution preserved; no backend/API/database
change.

`PMS-DATA-DOCS-001` (PR #31): docs-only diff, no product source/schema/API
change; Owner-invoked Codex review and Owner merge.

`ADMIN-002.1` (PR #32): full C1–C8 iteration history, final CI run
`32567637108` (Admin/Frontend/Backend all `success`), final Codex review
"No actionable correctness defects were identified in the reviewed diff."
Full detail in `docs/reports/ADMIN-002.1-completion.md`.

`ADMIN-002.1-DOCS-CLOSEOUT` (PR #33): docs-only diff, merged
`2c38face7cf51d7271c361e6d684adea466edcf9` at `2026-08-22T15:38:25Z`;
confirmed via `gh pr view 33` and remote branch deletion.

`TOOL-GRAPHIFY-001` / `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (PR #34): functional
gate evidence (not corpus-count comparisons) — exact CLI version confirmed;
Claude ran the project-scoped install and cleaned its known side effects;
code-only graph build completed; pilot query correctly identified the three
required ownership areas in `Front_End/Admin_Web`, independently checked
against source. Merge confirmed via `gh pr view 34` (`MERGED`, merge commit
`7db8844d...`, merged `2026-08-22T19:08:04Z`) and empty
`git ls-remote --heads origin docs/tool-graphify-001-closeout`. Full detail
in `docs/reports/TOOL-GRAPHIFY-001-completion.md`.

`PMS-BE-001.1` (PR #35): full C0–C1 implementation and correction history
in `docs/reports/PMS-BE-001.1-completion.md`,
`docs/daily/2026-08/2026-08-23-worklog.md`, and
`docs/daily/2026-08/2026-08-24-worklog.md`. Merge and cleanup evidence
independently verified for this Snapshot update via:

- `gh pr view 35`: `state=MERGED`, `headRefOid=9e25f7cb6247420467957061a13c04801ce9b3c7`,
  `mergeCommit=265d10006b219e456c30ed92bbb6c153a946944d`,
  `mergedAt=2026-08-24T16:46:46Z`.
- `gh pr checks 35`: Admin/Backend/Frontend all `pass`.
- `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`:
  empty — remote feature branch deleted.
- `git worktree list --porcelain` at this Snapshot's preflight: the linked
  worktree `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for this
  work item's implementation is **not** listed, and the directory itself is
  absent from disk — cleanup confirmed. (Two unrelated historical linked
  worktrees from discontinued Orca dry-runs, dated 2026-08-07, remain
  registered under `/home/admin1/orca/workspaces/...`; audited, not
  mutated — out of scope for this work item.)
- Backend test suite reproduced independently in this Claude Code session,
  built from the merged commit (`9e25f7cb6...`) against real PostgreSQL 17:
  **243/243** unit tests, **257/257** integration tests, **6/6**
  `CommercialCommitmentV2MigrationTests` — all PASS, matching the counts
  recorded in `docs/reports/PMS-BE-001.1-completion.md`'s C1 section.
  `Front_End/Customer_Web` **298/298** test count is sourced from that
  completion report (not independently re-run in this session).
- Manual, end-to-end acceptance test performed in this session against the
  live merged code: built and ran `TheBha.Api` from a clean checkout of the
  merged commit against a disposable, migration-7-applied PostgreSQL
  database (isolated from `thebha_dev`); exercised the exact API sequence
  `Front_End/Customer_Web` uses (`GET .../availability` →
  `POST /api/v1/booking-holds` → `POST .../confirm` →
  `POST /api/v1/reservations/{id}/cancel`) for a 2-room × 2-night case:
  - availability search: `requestedRooms=2`, `availableRooms=2`,
    `totalAmount=6,000,000 VND` (2 × 2 × 1,500,000).
  - Hold creation: exactly 1 `InventoryHold`, 2 `InventoryHoldItems`, 4
    `InventoryHoldItemNights`; `SUM(UnitAmount)` of the Nights equals
    `InventoryHolds.TotalAmount` exactly.
  - Confirmation: exactly 1 `Reservation`, 2 `ReservationUnits`, 4
    `ReservationUnitNights`; the 2 Units carry 2 **distinct**
    `SourceInventoryHoldItemId` values; all Units `CommitmentStatus =
    Committed`; `SUM(UnitAmount)` equals `Reservations.TotalAmount` exactly.
  - Availability after confirmation: raw committed-demand aggregation
    (reconstructed directly in SQL, before the API's `Math.Max(0, …)`
    clamp) equals exactly 2 rooms/night, not 4 — confirming the Hold's
    demand is excluded once its status flips to `Confirmed` and only the
    `Committed` Reservation Units are counted, with no double-count.
  - Cancellation: both Units transition to `CommitmentStatus = Cancelled`;
    their Night rows (`RatePlanId`, `UnitAmount`, `StayDate`) are byte-for-
    byte unchanged; availability search afterward returns
    `availableRooms=2` again.
  - All 5/5 manual acceptance criteria PASS. This is Owner-requested manual
    UI/database acceptance evidence performed via direct API calls (no
    Customer Web UI click-through — the Claude-in-Chrome browser extension
    was not connected in this session) against the real running system and
    real PostgreSQL, not a mock or unit-test double.

`PMS-BE-001.2` (PR #37): full checkpoint/correction history, self-review,
and local/CI verification evidence (build, full unit/integration/
migration/concurrency test counts, EF pending-model check, frontend CI
parity, forbidden-file review) recorded in
`docs/reports/PMS-BE-001.2-completion.md` and
`docs/daily/2026-08/2026-08-26-worklog.md` — not duplicated here. Merge
evidence independently verified for this closeout via:

- `gh pr view 37`: `state=MERGED`, `headRefOid=4b2de0ab50fa1703f0b125a043d2461cc0309417`,
  `mergeCommit=0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`,
  `mergedAt=2026-08-26T10:33:13Z`.
- `gh run view 32957454881`: `conclusion=success`, Backend/Frontend/Admin
  all `success`, on the exact merged head.
- `git ls-remote --heads origin feature/pms-be-001-2-physical-room-schedule-availability`:
  empty — remote feature branch deleted.
- Final Codex/OC review outcome: `PASS`, Owner/OC-confirmed; not
  independently re-derivable from GitHub, since this repository's Codex
  review results are relayed through Owner/OC rather than posted as PR
  comments — no `gh pr view 37` comment trail exists to quote verbatim.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`, `PMS-BE-001.1`), không đổi backend request/response shape.
- Admin Web hiện có một **interactive Reservation Board frontend** trên nền
  TailAdmin template baseline (PR #30, `ADMIN-002.1`). Kể từ
  `PMS-CAL-001.1` (§2), phần đọc chính của Reservation Board
  (`ReservationBoard.tsx`/`ReservationBoardServerTimeline.tsx`/
  `ReservationBoardStayPopover.tsx`) đọc **dữ liệu thật, read-only**, qua
  HTTPS, từ `GET /api/admin/v1/properties/{propertyId}/reservation-board`
  (§3) — không còn dùng `mockData.ts`/`reservationRuntime.ts`. Các phần
  khác của prototype `ADMIN-002.1` (front-desk creation workspace,
  lifecycle/folio/move demonstrations tại `reservationRuntimeReducer` trong
  `reservationRuntime.ts`, `formReducer` trong `CreateReservationForm.tsx`)
  **vẫn** chỉ chạy trên local deterministic mock state — không có backend
  call, không có persistence, không có Admin authentication/RBAC thật và
  không có OTA behavior thật. Riêng Admin Reservation Board là caller thật
  của các route assignment (Staff-authorized mặc định từ `PMS-ADMIN-AUTH-001`;
  `LocalGate` chỉ là opt-in Development): create của CP02 (CP03A/CP03B, merged),
  move một segment (CP04C, PR #53/#55) và unassign một segment (CP04D, PR
  #63) của CP04B, và của route tạo một OperationalBlock segment
  (`PMS-CAL-001.3-CP01`) qua dialog trên toolbar từ CP03 — khoảng đêm nằm
  trong board đang hiển thị, rồi đọc lại board từ server. Route hủy block
  (CP02) được board gọi từ CP04. Assignment split/batch và OperationalBlock
  move/split vẫn chưa có route HTTP.
- `PROJECT_BIBLE.md`, `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`,
  ADR (0001–0007), test baseline và source code là nguồn sự thật sản phẩm/
  kiến trúc. Chúng phân biệt rõ CURRENT frontend prototype (mock-only),
  CURRENT backend (`PMS-BE-001.1` normalized Item/Unit authority, một
  RoomType/RatePlan mỗi public request; `PMS-BE-001.2` physical-room
  schedule database authority/availability/internal mutation boundary — cả
  hai đã hoạt động; phần HTTP exposure của schedule authority (Staff mặc định) đã
  CURRENT theo `PMS-CAL-001.1`/`PMS-CAL-001.2`/`PMS-CAL-001.3` CP01–CP02) và
  TARGET (multi-RoomType public request, phần HTTP/Admin/Calendar mutation
  còn lại của schedule authority, OTA — chưa implement; Staff
  authentication/RBAC của Admin Calendar đã CURRENT qua `PMS-ADMIN-AUTH-001`).
- Local Graphify tooling state (đọc/graph hoá source hiện có trên máy
  Claude, không commit vào Git) không được gộp với tracked repository
  state hay product/backend implementation state — nó không tạo, sửa hay
  xoá bất kỳ table, migration, endpoint hay UI nào.
- Template hotel assets hiện có trạng thái quyền sử dụng chưa được chứng
  minh đầy đủ; chỉ dùng development/reference, không được tự động promote
  sang production.

## 6. Operating model đang được áp dụng

- Owner Hồ Đình Lâm: quyết định cuối, Ready/merge, branch cleanup và mở task
  tiếp theo. Control Tower: objective/execution order cấp cao và
  escalation. OC: phân rã work item/checkpoint, viết Master Execution
  Prompt, review report/diff/PR. Implementer được Master Execution Prompt
  chọn (Claude hoặc Codex): duy nhất có quyền ghi code/working tree.
  Reviewer ghép cặp: read-only (`docs/governance/RULES.md` §2.4).
- Mô hình lịch sử trước `AI-OPS-GOV-003` (không còn là policy hiện tại,
  xem §2.4 `docs/governance/RULES.md`): `Claude writes. Codex reviews. OC
  decides. Owner merges.` — đã chứng minh hoạt động xuyên suốt
  `AI-OPS-PILOT-001`, `FE-002.1`, `ADMIN-001.1`, `PMS-DATA-DOCS-001`,
  `ADMIN-002.1`, `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`, `PMS-BE-001.1`, và
  `PMS-BE-001.2` (bao gồm hai correction cycle `C1`/`C2` trước khi merge).
- **Single-checkout workflow (khôi phục từ `PMS-BE-001.1-DOCS-CLOSEOUT`):**
  dự án dùng đúng một checkout repository đang tồn tại
  (`/home/admin1/The_BHA_hotels_Booking`). Một work item dùng một feature
  branch, checkout trực tiếp trong đó; chỉ `ACTIVE_EXECUTOR` được Master
  Execution Prompt chọn có write lock.
  `git worktree add` và mọi checkout thực thi bổ sung đều bị **cấm** —
  không có ngoại lệ, không có field ủy quyền, không có policy matrix cho
  việc này (PR #35 từng dùng và sau đó đã xóa một linked worktree trong
  quá trình implementation của nó — xem §4 — đó là lịch sử đã kết thúc,
  không phải cơ chế còn hiệu lực). Chi tiết và vòng đời branch chuẩn:
  `docs/governance/RULES.md` §5 (canonical), `AGENTS.md` §8,
  `docs/governance/WORKFLOW.md` §8.
- Sau implementation/correction và mandatory checks, `ACTIVE_EXECUTOR`
  dừng ghi tại checkpoint ổn định và công bố `READY_FOR_<REVIEWER>_REVIEW`;
  chỉ Owner mới invoke reviewer đã chọn (`/codex:review --base
  origin/develop`, hoặc base do prompt chỉ định, khi reviewer là Codex;
  một phiên Claude read-only riêng khi reviewer là Claude). Không dùng
  rescue, transfer, Codex write mode, automatic review gate hoặc parallel
  implementation. Subagent (kể cả chạy song song) được phép dưới quyền
  `ACTIVE_EXECUTOR` — mô hình single-primary-checkout không thay đổi bất
  biến này.

## 7. Tooling migration state

- `openai/codex-plugin-cc`: review-only bridge, operating throughout all
  closed work items above.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`. Graphify
  adoption does not imply GitNexus removal.
- Graphify: adopted as an optional, workspace-local code-navigation tool
  (§2). `docs/governance/WORKFLOW.md` §12 is the canonical policy —
  `GRAPHIFY_POLICY` values, freshness, and install/rebuild boundaries live
  there, not duplicated here. Queried once during `PMS-BE-001.1` Phase 0
  preflight (graph fresh at that time; every result cross-checked directly
  against source); not invoked by `PMS-BE-001.1-DOCS-CLOSEOUT`
  (docs-only, `NOT_APPLICABLE` per the WORKFLOW.md §12 mapping table).
- `diagnosing-bugs` (`mattpocock/skills`): conditional global skill. Not
  invoked by `PMS-BE-001.1` (no concrete reproducible defect — every test
  failure during that session was an immediately obvious authoring mistake,
  fixed directly). Not applicable to `PMS-BE-001.1-DOCS-CLOSEOUT`
  (docs-only, no defect in scope).
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 8. Current objective

`PMS-CAL-001.1` — Reservation Board Read Projection & Frontend Integration
— đã đóng (`PASS — CLOSED`, PR #41 merged, merge commit
`e0f5a395aec15cc02e328433a97850e30e165675`, `2026-09-03T03:11:21Z`; §1,
§2, §4). Không còn review gate hay merge nào đang chờ trên work item đó.

`PMS-ADMIN-AUTH-001` đã đóng (`PASS — CLOSED`, CP07 = PR #80 merged, merge commit
`38d4a9d964fde411aa4c03b46323f250fd54221b`). Production deployment chưa thực hiện và cần
quyết định riêng của Owner.

Objective hiện tại là `CUST-WEB-001` (Customer Web thương mại trên template Chisfis): `CP00` (merged, PR #107) audit và hợp đồng
sản phẩm/release (`PROPOSAL`); `CP01a` nền Customer session (merged, PR #108); `CP01b` guard đổi danh tính ↔ booking (Draft PR). `CUST-WEB-SHOWCASE-001` và các chuỗi `PMS-CAL-002/003/004-CP01`
đã merged (PR #82–#106; xem đầu file). Review Codex chỉ do Owner gọi, OC quyết định, Owner giữ
Ready/merge/branch cleanup. Không tự bắt đầu work item khác từ Snapshot này.

## 9. Main risks

- Coi tài liệu này là đúng mà không đối chiếu Git/GitHub — đây chính là
  drift đã xảy ra với PR #41: bản Snapshot trước mô tả PR #41 là
  Draft/OPEN/chưa merge sau khi PR đã merge. Chạy `git fetch --prune origin`
  và đọc `origin/develop` HEAD từ Git trước khi dùng file này làm baseline.
- Trích một CI run hoặc review result sang một SHA khác với SHA nêu kèm nó
  — không hợp lệ. Mỗi con số trong tài liệu này gắn với đúng commit được ghi
  bên cạnh.
- Nhầm các route ghi local-only với một Admin Calendar đã có mutation/CRUD
  thật — không đúng. `PMS-CAL-001.2-CP02` expose route tạo assignment
  (`POST .../reservation-assignments`), `CP04B` expose route move/unassign
  một segment (`.../{segmentId}/move`, `.../{segmentId}/unassign`), và
  `PMS-CAL-001.3` expose route tạo một OperationalBlock segment
  (`POST .../operational-blocks`, tối đa 366 đêm tại HTTP boundary; CP01) và
  route hủy một segment (`.../{segmentId}/cancel`; CP02). Ở `Staff` mode
  (mặc định từ CP07) mỗi route cần Staff session và permission theo
  Property/role (CP05); ở `LocalGate` (chỉ Development) chúng chỉ chạy trên
  host loopback đã bật `AdminCalendar:EnableUnauthenticatedWrite` (mặc định
  tắt), không có authentication. Caller duy nhất của create/move/unassign assignment
  và tạo/hủy block là Admin Reservation Board. Assignment split/batch và
  OperationalBlock move/split vẫn chỉ tồn tại ở tầng application/persistence
  nội bộ (`PMS-BE-001.2`), không có route HTTP.
- Nhầm phần còn lại của frontend mock prototype (`ADMIN-002.1`: front-desk
  creation workspace, lifecycle/folio/move demonstrations) — vẫn hoàn toàn
  mock-only — với backend PMS behavior thật.
- Coi `AdminCalendar:EnableUnauthenticatedRead` hoặc
  `AdminCalendar:EnableUnauthenticatedWrite` là bằng chứng sẵn sàng
  public-Internet production — không đúng; "commercial-quality" ở đây nghĩa
  là robust/verified/merge-ready, không phải public production-ready. Cả hai
  đều là **same-machine development only**: mặc định tắt kể cả ở Development,
  và chỉ phục vụ request HTTPS loopback-to-loopback ở host Development (§3).
  Write flag còn từ chối thêm mọi request mang header `Forwarded`/
  `X-Forwarded-*`. Hai flag độc lập: bật read không bật write và ngược lại.
  Không được để lộ qua LAN/public listener hay external-facing proxy — việc
  không đặt proxy công khai trước API local là **điều kiện vận hành**, không
  phải thứ code phát hiện được. Từ CP07 hai flag chỉ có tác dụng với
  `AccessMode=LocalGate` (chỉ Development); `Staff` mặc định không đọc chúng.
- Nhầm database authority/internal mutation boundary của `RoomOccupancySegment`/
  `RoomBlock` (`PMS-BE-001.2`, đã CURRENT) với HTTP/Admin/Calendar
  integration đầy đủ — ngoài năm route ghi (assignment create của
  `PMS-CAL-001.2` CP02, one-segment move/unassign của CP04B, và
  single-segment operational-block create/cancel của `PMS-CAL-001.3`
  CP01/CP02), các mutation khác (split, swap/batch, block move/split) vẫn
  TARGET, chưa implement. Staff identity/RBAC và audit actor Staff đã CURRENT
  (`PMS-ADMIN-AUTH-001`); chỉ ở `LocalGate` `ActorReference`/`AuthorizationEvidence`
  mới là hằng số opaque.
- Coi thiết kế `PMS-CAL-002-CP00` (split-move) là CURRENT hoặc đã được Owner duyệt
  — không đúng: chưa có route/UI, D1–D6 còn OPEN.
- Nhầm foundation normalized Item/Unit (`PMS-BE-001.1`, single-RoomType
  public request) với multi-RoomType public request TARGET đã implement —
  vẫn chưa implement.
- Coi các đoạn cert/HTTPS-trust runtime-only dùng cho Phase 3 browser
  acceptance của `PMS-CAL-001.1` (`Kestrel:Certificates:Default:*` trỏ vào
  một chứng chỉ `mkcert` cục bộ, `mkcert -install` vào system trust store)
  là một phần cấu hình đã commit — không đúng: đó chỉ là tiện ích kiểm thử
  cục bộ, không nằm trong bất kỳ file được commit nào, và không thay đổi
  cách backend chạy ở Development/Production.
- Tạo `git worktree add` hoặc bất kỳ checkout thực thi bổ sung nào — luôn
  bị cấm, không có ngoại lệ (`docs/governance/RULES.md` §5).
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate working tree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.

## 10. First action

Chạy `git fetch --prune origin` và đọc `origin/develop` HEAD trực tiếp từ
Git — **không** lấy SHA từ tài liệu này — trước khi dùng Snapshot này làm
planning baseline.

Work item đang thực thi là `CUST-WEB-001-CP01b` (branch `feature/cust-web-001-cp01b-booking-identity-guard`, Draft PR vào
`develop`). Owner invoke `/codex:review --base origin/develop` trên đúng PR head, OC quyết định, Owner
Ready/merge; `CP02` (UI đăng nhập) chỉ mở khi Owner kích hoạt.
Evidence: `docs/reports/CUST-WEB-001-CP01b-completion.md`, `docs/design/CUST-WEB-001-product-contract.md`. (Các đoạn First
action cũ trỏ tới `CUST-WEB-SHOWCASE-001-CP01` và `PMS-CAL-001.2-CP04B` đã hết hiệu lực: PR #48 và #82 merged.)

10. Cập nhật 2026-10-18 (`BHA-PRODUCT-ADMIN-001-CP01-C3`, Draft PR #124): Workspace `/products` có ba modal Thêm cơ sở/loại phòng/phòng bên trong khối Cơ sở; tạo Property, RoomType, PhysicalRoom qua Staff API có transaction/audit/idempotency key; RoomType summary chỉ đếm nhóm chính, legacy mẫu riêng; detail liệt kê PhysicalRoom thật. Migration `20261018154408_AddAdminCatalogCreateOperations` additive. Chi tiết và trạng thái kiểm thử/browser trong phần C3 của report completion.
