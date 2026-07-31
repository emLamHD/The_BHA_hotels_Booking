# ADR 0004: Compute effective inventory with daily controls

**Status:** Accepted  
**Date:** 2026-07-22

## Context

The BHA cần tìm phòng còn bán được dựa trên tồn vật lý, đồng thời cho phép giới
hạn lượng bán hoặc đóng bán theo ngày. BE-002 chưa có hold/reservation nên
không được giả vờ rằng kết quả availability là một cam kết giữ phòng.

## Decision

Tồn vật lý cơ sở:

`BaseInventory = count(PhysicalRoom where OperationalStatus = Active)`

Với mỗi RoomType và StayDate:

- Không có DailyInventoryControl:
  `EffectiveInventory = BaseInventory`.
- Có `IsStopSell = true`:
  `EffectiveInventory = 0`.
- Có `SellableLimit`:
  `EffectiveInventory = min(BaseInventory, SellableLimit)`.

Quy tắc bổ sung:

- `SellableLimit` nullable; nếu có phải `>= 0`.
- Control row phải có ít nhất một tác dụng: sellable limit hoặc stop-sell.
- `Inactive`/`OutOfService` PhysicalRoom không được tính.
- Tồn của kỳ nghỉ là giá trị nhỏ nhất của tất cả các đêm.
- Offer chỉ xuất hiện khi effective inventory của mọi đêm đủ
  `requestedRooms`.
- Không lưu một trường `IsAvailable` suy diễn trên RoomType/PhysicalRoom.
- BE-002 không trừ hold hoặc reservation.
- Capability reservation phải mở rộng công thức bằng committed inventory và
  concurrency protection trước khi cam kết chống overbooking.

## Consequences

### Positive

- Tồn bán không thể vượt tồn vật lý.
- Daily limit và stop-sell có semantics rõ ràng.
- Không lưu dữ liệu availability suy diễn dễ lỗi thời.
- Mô hình sẵn sàng để bổ sung committed inventory ở Epic riêng.

### Limitations

- Availability hiện là snapshot tại thời điểm query.
- Hai khách có thể thấy cùng một tồn trước khi có cơ chế hold/reservation.
- Không thể quảng bá là chống overbooking cho đến khi concurrency protection
  được triển khai và kiểm thử.

## Rejected alternatives

- `IsAvailable` trên RoomType: quá thô và không biểu diễn theo ngày.
- Sellable limit thay thế hoàn toàn base inventory: có thể bán vượt số phòng
  vật lý.
- Trừ booking trong BE-002: làm trộn availability read model với capability
  reservation chưa được thiết kế.
