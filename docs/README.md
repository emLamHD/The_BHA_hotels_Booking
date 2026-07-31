# The BHA Control Tower Documentation

Bộ tài liệu này là bộ nhớ vận hành chính thức của dự án The BHA Hotels Booking.

## Gói khởi động cho phiên Control Tower mới

Đọc theo thứ tự:

1. [`governance/RULES.md`](governance/RULES.md)
2. [`governance/WORKFLOW.md`](governance/WORKFLOW.md)
3. [`project/PROJECT_BIBLE.md`](project/PROJECT_BIBLE.md)
4. [`project/SNAPSHOT.md`](project/SNAPSHOT.md)
5. File kế hoạch của ngày hiện tại trong `daily/YYYY-MM/`
6. Chỉ đọc ADR liên quan đến Epic đang thiết kế

Không đọc toàn bộ worklog hoặc completion report trong lúc khởi động thông
thường. Chỉ mở chúng khi phải kiểm tra bằng chứng, truy vết một quyết định cũ
hoặc xử lý mâu thuẫn.

## Mục đích từng khu vực

| Khu vực | Trả lời câu hỏi | Cách cập nhật |
|---|---|---|
| `governance/` | Các AI phải làm việc theo luật và quy trình nào? | Chỉ sửa khi luật vận hành thay đổi lâu dài |
| `project/PROJECT_BIBLE.md` | Dự án là gì và được thiết kế theo nguyên tắc nào? | Chỉ sửa khi kiến thức dự án ổn định thay đổi |
| `project/SNAPSHOT.md` | Dự án đang đứng ở đâu ngay lúc này? | Ghi đè bằng trạng thái mới nhất |
| `project/adr/` | Vì sao một quyết định kiến trúc quan trọng được chọn? | Tạo ADR mới; không viết lại lịch sử tùy tiện |
| `daily/` | Hôm đó dự định làm gì và thực tế đã xảy ra gì? | Tạo file riêng theo ngày |
| `reports/` | Epic/task đã hoàn thành với bằng chứng nào? | Tạo một báo cáo ngắn cho mốc hoàn thành |

## Quy ước tên file

- Worklog: `YYYY-MM-DD-worklog.md`
- Kế hoạch: `YYYY-MM-DD-plan.md`
- ADR: `ADR-NNN-ten-quyet-dinh.md`
- Completion report: `<TASK-OR-EPIC>-completion.md`

Ngày trong tên file luôn dùng định dạng ISO `YYYY-MM-DD`.
