# The BHA Control Tower Documentation

Bộ tài liệu này là bộ nhớ vận hành chính thức của dự án The BHA Hotels Booking.

## Gói khởi động cho phiên Control Tower mới

Đọc đúng thứ tự mặc định:

1. [`governance/RULES.md`](governance/RULES.md)
2. [`project/PROJECT_BIBLE.md`](project/PROJECT_BIBLE.md)
3. [`project/SNAPSHOT.md`](project/SNAPSHOT.md)
4. File kế hoạch của ngày hiện tại trong `daily/YYYY-MM/`

Sau đó chỉ xuất xác nhận ngắn:

```text
Current state:
Today's objective:
Execution order:
Main risks:
First action:
```

`governance/WORKFLOW.md` không thuộc packet khởi động mặc định. ADR, report và
worklog được nạp theo nhu cầu (on demand), không thuộc packet mặc định. Tài
liệu lịch sử chỉ được truy xuất khi có tranh cãi về một quyết định trước đó,
cần điều tra lỗi/defect, cần phục hồi context cho một task dang dở, hoặc khi
`SNAPSHOT.md` không đủ chi tiết để bàn giao. Quá trình khởi động mặc định
không kể lại toàn bộ nội dung các file đã đọc.

## Mục đích từng khu vực

| Khu vực | Trả lời câu hỏi | Cách cập nhật |
|---|---|---|
| `governance/` | Các AI phải làm việc theo luật và quy trình nào? | Chỉ sửa khi luật vận hành thay đổi lâu dài |
| `project/PROJECT_BIBLE.md` | Dự án là gì và được thiết kế theo nguyên tắc nào? | Chỉ sửa khi kiến thức dự án ổn định thay đổi |
| `project/SNAPSHOT.md` | Dự án đang đứng ở đâu ngay lúc này? | Ghi đè bằng trạng thái mới nhất |
| `ADR/` | Vì sao một quyết định kiến trúc quan trọng được chọn? | Tạo ADR mới; không viết lại lịch sử tùy tiện |
| `daily/` | Hôm đó dự định làm gì và thực tế đã xảy ra gì? | Tạo file riêng theo ngày |
| `reports/` | Epic/task đã hoàn thành với bằng chứng nào? | Tạo một báo cáo ngắn cho mốc hoàn thành |

## Quy ước tên file

- Worklog: `YYYY-MM-DD-worklog.md`
- Kế hoạch: `YYYY-MM-DD-plan.md`
- ADR: `NNNN-kebab-case.md`
- Completion report: `<TASK-OR-EPIC>-completion.md`

Ngày trong tên file luôn dùng định dạng ISO `YYYY-MM-DD`.
