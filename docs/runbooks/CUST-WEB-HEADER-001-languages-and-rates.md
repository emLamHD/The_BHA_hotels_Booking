# Vận hành: ngôn ngữ, bản dịch và tỷ giá hiển thị (Admin)

Áp dụng cho `CUST-WEB-HEADER-001-CP02` (C2/R1). Mọi thao tác dưới đây làm trong Admin (`/website/...`), cần tài khoản Staff có quyền Website (`--staff-website-access --email <email> --enabled true` trên máy chạy API). Không thao tác nào cần build, sửa mã hay khởi động lại Customer_Web/API.

## 1. Tỷ giá (làm trước khi cho khách chọn USD/EUR)

1. `/website/currencies` → chọn tiền tệ (USD, EUR…) → nhập **VND cho 1 đơn vị** (ví dụ USD = 26060), nguồn và thời điểm của tỷ giá, lưu.
2. Bật tiền tệ. Tiền tệ chưa có tỷ giá không bật được và không được đưa ra cho khách.
3. Ghi lại nguồn/thời điểm ở nơi vận hành (Admin lưu `RateSource`, `RateUpdatedAtUtc`). Giá **lưu và thanh toán luôn là VND**; giá USD/EUR chỉ là hiển thị tham khảo tính từ tỷ giá này (làm tròn từng dòng, tổng = tổng các dòng).
4. Khi demo: tỷ giá nhập tay từ nguồn công khai (ví dụ cột “Bán ra” của Vietcombank), ghi rõ nguồn và giờ; không đưa tỷ giá vào seed hay migration.

## 2. Bật ngôn ngữ dựng sẵn (vi/en/fr)

`/website/languages` → **Nhập gói** → thẻ thư viện (`bha-vi`, `bha-en`, `bha-fr`) → xem trước → áp dụng (tick “Bật ngay nếu đủ”). Thẻ ngôn ngữ hiện độ phủ thật (đã dịch/bắt buộc), tiền tệ mặc định của ngôn ngữ (đổi ngay trên thẻ), nút bật/tắt (chỉ bật được khi đủ), đặt mặc định, xuất gói, cập nhật từ thư viện, xóa.

## 3. Thêm một ngôn ngữ mới bằng gói (không cần mã)

1. **Nhập gói → Tải mẫu** để lấy khung gói (hoặc **Xuất gói** từ một ngôn ngữ có sẵn), dịch nội dung, giữ nguyên biến `{...}`.
2. **Nhập gói → Tải lên** chọn file `.json` (schema `bha.language-pack/1`). Server kiểm và trả bản xem trước: thêm/đổi/giữ nguyên/bị từ chối/còn thiếu. File hỏng hoặc sai biến bị từ chối kèm lý do và không cài gì.
3. Chọn chế độ **Giữ chỉnh sửa tay** (mặc định) hoặc **Ghi đè**, bấm kiểm tra lại nếu đổi chế độ, rồi **Áp dụng**. Gói chưa đủ khóa bắt buộc vẫn cài được nhưng ở trạng thái **tắt/nháp** — khách không thấy.
4. Sửa/bổ sung từng câu ở `/website/translations` (so song song nguồn và đích, lọc “thiếu/cần cập nhật/chỉnh tay”). Khi đủ 100% thì bật trên thẻ ngôn ngữ; Customer_Web dùng ngay ở lần tải trang kế tiếp.
5. Khách chọn ngôn ngữ ở biểu tượng địa cầu trên header; tiền tệ đi theo ngôn ngữ (theo “tiền tệ mặc định” của thẻ) nhưng khách có thể chọn riêng.

## 4. Lưu ý

- Bản dịch máy chỉ là nháp; không bật công khai một ngôn ngữ nếu chưa có người đọc lại các câu về giá, giữ phòng, hủy, xác nhận, thanh toán và lỗi.
- Khóa mới do mã thêm vào danh mục làm mọi ngôn ngữ hiện có “chưa đủ” cho tới khi dịch khóa đó (xem mục “Thiếu” trên thẻ).
- Dịch toàn bộ Admin vận hành chưa nằm trong phạm vi này.
