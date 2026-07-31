# BE-002 Epic Completion Report

- **Overall status:** PASS — DONE
- **Completed:** 2026-07-22
- **Develop HEAD:** `3e4be8a2759fe0542a74a594891b43d85cdcf401`

## Coordinator ledger

| Task | PR | Business behavior | Merge status | Result |
|---|---|---|---|---|
| BE-002.1 | [#5](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/5) | Rate Plan Foundation | Squash merged | PASS |
| BE-002.2 | [#6](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/6) | Daily Room Rate | Squash merged | PASS |
| BE-002.3 | [#7](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/7) | Daily Inventory Controls | Squash merged | PASS |
| BE-002.4 | [#8](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/8) | Availability Search & Stay Pricing | Squash merged | PASS |

Các task được thực hiện và merge tuần tự. Feature branches BE-002 đã xóa.

## Implemented architecture

### Domain and relationships

- Property có nhiều RatePlan.
- RoomType và RatePlan cùng thuộc Property.
- DailyRoomRate định giá theo:
  `(Property, RoomType, RatePlan, StayDate)`.
- DailyInventoryControl quản lý theo:
  `(Property, RoomType, StayDate)`.
- Quan hệ cùng Property và uniqueness được bảo vệ bằng domain/database
  constraints phù hợp.

### Stay dates

- Domain/application: `DateOnly`.
- PostgreSQL: `date`.
- Property timezone được dùng cho ngày kinh doanh.
- Khoảng nửa mở:
  `checkIn <= stayDate < checkOut`.
- Checkout không bị tính giá.

### Pricing

- Amount dùng decimal/numeric.
- Currency thuộc RatePlan.
- Phải có giá cho mọi đêm; không fallback.
- Total:
  `sum(nightlyRates) × requestedRooms`.

### Inventory

- Base inventory = số PhysicalRoom Active.
- Inactive/OutOfService không được tính.
- Không có control: dùng base inventory.
- Stop-sell: effective inventory bằng 0.
- Sellable limit:
  `min(BaseInventory, SellableLimit)`.
- Tồn của kỳ nghỉ là giá trị nhỏ nhất của các đêm.
- BE-002 chưa trừ hold/reservation.

### Occupancy MVP

- Adults > 0; children >= 0; rooms > 0.
- Điều kiện:
  `adults + children <= MaxOccupancy × rooms`.
- Tất cả phòng trong một offer cùng RoomType.

## Public API

`GET /api/v1/properties/{propertyId}/availability`

Query:

- `checkIn`
- `checkOut`
- `adults`
- `children`
- `rooms`

Giới hạn hiện hành:

- Maximum stay: 30 nights.
- Maximum rooms per search: 10.

Response gồm room type/rate plan, currency, nightly breakdown, requested rooms,
available rooms và total amount. Không expose PhysicalRoom ID/RoomNumber hoặc EF
entity.

## Persistence and seed

- Mỗi task thay đổi schema có migration riêng.
- Migration chain áp dụng sạch trên PostgreSQL.
- Pending migrations: 0.
- Development seed được mở rộng theo từng capability và giữ idempotent.
- Không dùng `EnsureCreated()` hoặc automatic production seed/migration.

## Verification evidence

- Tổng backend tests: 134 PASS.
- Skipped: 0.
- GitHub Actions Backend: SUCCESS.
- GitHub Actions Frontend: SUCCESS.
- Migration chain: clean.
- Không còn feature branch BE-002.
- `develop` ở trạng thái sạch theo handoff.

## Acceptance summary

- Bốn task hoàn thành đúng thứ tự: PASS.
- Bốn PR riêng, đã squash merge: PASS.
- Rate plan, daily rate, daily controls và availability API: PASS.
- Nightly pricing và inventory rules: PASS.
- PostgreSQL migrations/tests: PASS.
- Không expose PhysicalRoom: PASS.
- Không có frontend/BE-003 trong scope BE-002: PASS.
- Không ghi nhận secret hoặc pending migration: PASS.

## Deviations

- Không ghi nhận deviation chưa được chấp thuận trong handoff cuối.

## Remaining boundary and risk

- Availability là snapshot, không phải cam kết giữ phòng.
- Chưa có hold/reservation hoặc concurrency protection chống overbooking.
- Đây là ranh giới chủ động của BE-002 và phải được giải quyết trong capability
  riêng trước khi nhận booking đồng thời an toàn.

## Final assessment

`BE-002 = DONE`

Đủ điều kiện để Control Tower bắt đầu thiết kế BE-003.
