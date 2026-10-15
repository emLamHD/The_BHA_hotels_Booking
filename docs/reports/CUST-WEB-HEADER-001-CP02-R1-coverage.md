# CUST-WEB-HEADER-001-CP02-R1 — Customer_Web coverage inventory (A1)

Mục đích: chứng minh phạm vi “toàn bộ Customer_Web” theo R1 bằng danh sách có thể kiểm. Bằng chứng chạy nằm ngoài repo (`~/bha-evidence/CUST-WEB-HEADER-001-CP02/r1/`), gắn với đúng `FINAL_HEAD` trong báo cáo hoàn tất.

## 1. Tuyến đã quét (build production, API HTTPS, DB thử) — vi, en, fr

`/`, `/riverside`, `/offers`, `/blog` (+ 2 bộ lọc danh mục), 11 bài `/blog/<slug>`, `/about`, `/contact`, `/author`, `/subscription`, `/checkout`, `/login`, `/signup`, `/account`, `/account-billing`, `/account-password`, `/account-savelists`, `/listing-stay`, `/listing-stay-map`, `/listing-stay-detail`, `/listing-car`, `/listing-car-map`, `/listing-car-detail`, `/listing-experiences`, `/listing-experiences-map`, `/listing-experiences-detail`, `/listing-flights`, `/listing-real-estate`, `/listing-real-estate-map`, `/home-2`, `/home-3`, `/media-credits`, `/paydone`, `/showcase-unavailable`, `/add-listing/1…10`, và 404. **56 tuyến × 3 ngôn ngữ = 168 trang.** (`/pay-done` là bí danh 307 của `/paydone`; bộ proxy TLS của harness không chuyển giao thức nên chỉ kiểm bằng mã 307.) Trạng thái đang tải / lỗi / hộp thoại của luồng đặt phòng được kiểm trong E2E đặt phòng (hold, receipt, xác nhận, lỗi mạng, hold đang chờ).

Cách phát hiện chữ sai ngôn ngữ: script quét văn bản hiển thị, `alt`, `aria-label`, `title`, `placeholder` của từng trang; một dòng bị đánh dấu khi (a) có chữ cái đặc trưng tiếng Việt trong trang en/fr, (b) có ≥ 3 từ en/fr trong trang khác ngôn ngữ, (c) có từ **chỉ thuộc một ngôn ngữ** của ba gói (từ vựng suy ra từ chính các gói) xuất hiện trong trang của ngôn ngữ khác, (d) ký hiệu tiền sai (`$` ngoài en, `₫` trong en, `€` trong vi), (e) `<html lang>` sai. Thêm: mọi `[i18n] missing template text` do trình duyệt ghi ra được gom thành danh sách chuỗi chưa có khóa.

## 2. Ngoại lệ được ghi nhận (không dịch, có chủ ý)

| Nhóm | Ví dụ | Lý do |
|---|---|---|
| Tên riêng / dữ liệu mẫu của template | tên người, khách sạn mẫu, hãng bay, số nhà/đường mẫu, địa chỉ email mẫu | Tên riêng và dữ liệu giả; không phải nội dung của The BHA |
| Văn bản giả (lorem) | “generate interactive markets”, “Photo booth tattooed prism…” | Dữ liệu điền chỗ của template |
| Tiêu đề/nhà xuất bản của nguồn bên ngoài | tiêu đề bài báo tiếng Việt/tiếng Anh, “Báo Văn hoá”, “South China Morning Post” trong danh sách nguồn của bài blog | Tên gốc của tài liệu được trích dẫn, hiển thị đúng như được xuất bản |
| Tên tệp ảnh trên trang nguồn ảnh | `Gate in the Citadel of Huế.jpg` | Tên tệp gốc trên Wikimedia Commons |
| Thông báo do Google Maps tự sinh | “This page didn't load Google Maps correctly…” | Không do ứng dụng sinh (không có khóa API cho demo) |
| Nội dung nhập bởi người dùng, mã đặt phòng, ID hold | — | Dữ liệu, không phải giao diện |
| Địa chỉ/tên địa danh của The BHA | “162 Nghiêm Xuân Yêm, Đà Nẵng” | Địa chỉ thật, giữ nguyên chính tả |

## 3. Bề mặt tiền (đều qua `Money`/`Amount`/`PriceBreakdown`/`DemoPrice` → `POST /api/v1/website/display-prices` hoặc VND như lưu)

Thẻ/ưu đãi phòng (`OfferCard`, `AvailabilityOfferCard`, `RoomTypeStayCard`), chi tiết phòng và thanh giá cố định trên mobile (`MobileFooterSticky`), bảng giá theo đêm/tổng (`PriceBreakdown`), hold và biên nhận (`BookingHoldPanel`, `PayDoneReceipt`), các thẻ/bộ lọc của trang template (stay/car/experience/flight/real-estate: `StayCard*`, `CarCard*`, `ExperiencesCard*`, `FlightCard`, `PropertyCardH`, các `TabFilters`, `PriceRangeInput`), `subscription`, `checkout`, câu mẫu có giá của trang car/experience detail. Giá mẫu của template = “đơn vị template” × 25.000 VND, đi qua cùng đường quy đổi; không còn ký hiệu `$` cố định. VND = đúng giá lưu (không gọi API); USD/EUR = tỷ giá do operator nhập, làm tròn từng dòng.

## 4. Chuỗi UI

Tin nhắn có khóa trong gói: 1213 (+225 nội dung tĩnh/thực thể) mỗi ngôn ngữ = 1438 chuỗi; chữ mẫu của template dùng khóa `customer.tpl.<hash>` (xem design §9). Mỗi ngôn ngữ phát hành phải đủ 100% khóa bắt buộc mới được bật.
