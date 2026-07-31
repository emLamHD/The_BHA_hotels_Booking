# PROJECT BIBLE — The BHA Hotels Booking

- **Status:** Active
- **Document type:** Stable project knowledge

File này mô tả dự án và các nguyên tắc thiết kế tương đối ổn định. Trạng thái
task/PR hiện tại nằm trong `docs/project/SNAPSHOT.md`.

## 1. Tầm nhìn kinh doanh

The BHA Hotels Booking là website chính thức và nền tảng đặt phòng trực tiếp
cho The BHA Hotel.

Mục tiêu:

- Xây dựng bộ mặt trực tuyến chính thức của khách sạn.
- Cho phép khách tìm phòng và đặt trực tiếp.
- Giảm phụ thuộc và chi phí hoa hồng từ OTA.
- Tạo nền tảng có thể mở rộng cho quản lý giá, tồn phòng, booking và tích hợp
  vận hành trong tương lai.
- Cải thiện khả năng xuất hiện khi khách tìm kiếm thương hiệu The BHA Hotel.

## 2. Phạm vi sản phẩm

### Năng lực cốt lõi của MVP

- Public property/room catalog.
- Room type và physical room inventory foundation.
- Rate plan.
- Giá theo từng đêm.
- Daily sellable limit và stop-sell.
- Availability search và stay pricing.
- Booking commitment/hold/reservation là capability riêng, không được trộn vào
  lớp availability chỉ đọc.

### Ngoài phạm vi nền tảng hiện tại hoặc phải có Epic riêng

- OTA/channel manager.
- Payment và refund.
- Promotion/coupon/discount.
- Tax và service charge phức tạp.
- Meal plan.
- Multi-currency conversion.
- Mixed RoomType allocation.
- Guest profile nâng cao.
- Check-in/check-out, housekeeping và maintenance scheduling.
- Admin Web đầy đủ.

Các capability này không được triển khai “tiện tay” trong Epic khác.

## 3. Tech stack

### Backend

- .NET 8.
- ASP.NET Core Web API.
- Clean Architecture.
- Entity Framework Core 8.
- PostgreSQL 17.
- Npgsql.
- Swagger/OpenAPI và health checks.

### Frontend

- Next.js Customer Web.
- Frontend và backend được thay đổi theo phạm vi riêng; task backend không mặc
  định được phép sửa frontend.

### Delivery

- GitHub repository:
  `https://github.com/emLamHD/The_BHA_hotels_Booking`
- GitHub Actions cho verification.
- `develop` là integration branch.
- `main` không nhận thay đổi trực tiếp từ task phát triển thông thường.

## 4. Kiến trúc và dependency

- Domain không phụ thuộc Application, Infrastructure hoặc API.
- Application không phụ thuộc Infrastructure hoặc API.
- Infrastructure triển khai persistence và tích hợp kỹ thuật.
- API chỉ chịu trách nhiệm transport/composition.
- Không expose EF Core entity trực tiếp qua public API.
- Không thêm generic repository chỉ để bọc `DbContext`.
- Không thêm abstraction hoặc framework nếu chưa có nhu cầu nghiệp vụ rõ ràng.
- Read path phải tránh N+1, hỗ trợ `CancellationToken` và dùng read-only query
  convention phù hợp.

## 5. Domain model cốt lõi

### Catalog và inventory vật lý

- `Property`: khách sạn/cơ sở; sở hữu timezone và dữ liệu catalog.
- `RoomType`: loại phòng thuộc một Property.
- `PhysicalRoom`: phòng vật lý cụ thể thuộc RoomType.
- `Amenity`: tiện nghi.
- `Media`: nội dung hình ảnh/media của catalog.

`PhysicalRoom` là dữ liệu nội bộ. Public API không được lộ ID hoặc room number
của phòng vật lý.

### Rate và availability

- `RatePlan`: kế hoạch giá thuộc một Property và sở hữu currency.
- `DailyRoomRate`: giá của một RoomType theo RatePlan cho một `StayDate`.
- `DailyInventoryControl`: sellable limit/stop-sell của RoomType theo ngày.
- Availability offer: projection chỉ đọc kết hợp catalog, giá và tồn hiệu lực.

Quan hệ cùng Property phải được bảo vệ ở cả domain và PostgreSQL khi khả thi.

## 6. Quy tắc ngày lưu trú

- Dùng `DateOnly` trong domain/application.
- PostgreSQL dùng kiểu `date`.
- Ngày được diễn giải theo `Property.TimeZone`.
- Khoảng lưu trú là nửa mở:
  `checkIn <= stayDate < checkOut`.
- Checkout không bị tính giá và không tiêu thụ room-night.
- Không dùng UTC timestamp để đại diện cho một đêm khách sạn.
- Logic “ngày hiện tại” phải có clock/time provider để test được.

Xem [ADR 0003](../ADR/0003-model-hotel-stays-with-half-open-date-ranges.md).

## 7. Quy tắc tiền và giá

- Giá dùng `decimal`; không dùng `float`/`double`.
- Persistence dùng `numeric(18,2)` hoặc convention tương đương.
- Amount phải lớn hơn 0.
- `CurrencyCode` thuộc RatePlan và được chuẩn hóa theo mã ISO 4217 ba chữ cái.
- DailyRoomRate không lặp lại CurrencyCode.
- Một offer chỉ hợp lệ khi có giá cho mọi đêm.
- Không dùng fallback price, giá 0 hoặc giá mặc định ẩn.
- Tổng giá:
  `sum(nightlyRates) × requestedRooms`.
- Không tự động quy đổi tiền tệ.

## 8. Quy tắc tồn và availability

- Base inventory là số `PhysicalRoom` có `OperationalStatus = Active`.
- `Inactive` và `OutOfService` không được tính.
- Nếu không có daily control, effective inventory bằng base inventory.
- Nếu stop-sell, effective inventory bằng 0.
- Nếu có sellable limit, effective inventory không vượt base inventory.
- Tồn của cả kỳ nghỉ là giá trị nhỏ nhất của các đêm.
- Availability là snapshot tại thời điểm truy vấn, chưa phải cam kết giữ phòng.
- Hold/reservation và concurrency protection phải được bổ sung ở capability
  riêng trước khi hệ thống có thể bảo đảm chống overbooking.

Xem [ADR 0004](../ADR/0004-compute-effective-inventory-with-daily-controls.md).

## 9. Quy tắc occupancy MVP

- Request tối thiểu: check-in, check-out, adults, children và rooms.
- Adults > 0; children >= 0; rooms > 0.
- Người lớn và trẻ em đều tính là một người khi kiểm tra `MaxOccupancy`.
- Điều kiện:
  `adults + children <= MaxOccupancy × rooms`.
- Một offer chỉ gồm các phòng cùng một RoomType.
- Chưa có child pricing, surcharge hoặc mixed RoomType allocation.

## 10. Quy ước public API

- Endpoint được version hóa theo convention `/api/v1/...`.
- Validation error dùng error format thống nhất của dự án.
- Resource không tồn tại/không public trả 404 theo convention.
- DTO công khai không expose domain/EF entity.
- Kết quả collection phải có thứ tự ổn định.
- Swagger/OpenAPI phải phản ánh đúng contract thực tế.

Availability contract hiện hành:

`GET /api/v1/properties/{propertyId}/availability`

Query:

- `checkIn=YYYY-MM-DD`
- `checkOut=YYYY-MM-DD`
- `adults`
- `children`
- `rooms`

## 11. Persistence và migration

- PostgreSQL phải bảo vệ invariant quan trọng, không chỉ dựa vào C#.
- Integration test dùng PostgreSQL thật; không thay bằng EF InMemory hoặc SQLite.
- Mỗi task thay đổi schema có migration riêng.
- Không sửa hoặc viết lại migration đã merge.
- Không dùng `EnsureCreated()`.
- Không tự chạy migration khi API startup.
- Development seed phải idempotent, không chạy trong Production và không tự
  chạy trong startup bình thường.
- Không commit secret hoặc connection string thật.

## 12. Branch strategy

- Epic được chia thành các task theo business behavior.
- Một task = một branch = một PR = một squash commit.
- Task phụ thuộc nhau được thực hiện và merge tuần tự.
- Branch task tạo từ `origin/develop` mới nhất.
- PR ban đầu ở Draft.
- Không push trực tiếp vào `develop`/`main`.
- Không stacked PR nếu chưa được Control Tower phê duyệt.

## 13. Definition of Done tổng quát

Một task chỉ `DONE` khi:

1. Business behavior và invariant đúng phạm vi.
2. Domain/database cùng bảo vệ ràng buộc quan trọng.
3. Migration/seed áp dụng được và an toàn nếu có.
4. Unit, PostgreSQL integration, architecture, health và OpenAPI tests liên
   quan PASS.
5. Restore/build PASS.
6. Diff chỉ chứa một behavior, không chứa task kế tiếp.
7. Không có secret, automatic migration hoặc frontend ngoài scope.
8. Documentation phản ánh chức năng thực tế.
9. PR/CI PASS và merge được xác nhận trên `origin/develop`.
10. Feature branch được xử lý theo merge protocol.

## 14. Content, sellable catalog và media ownership

Content phải được phân loại theo source of truth; không sao chép toàn bộ field
hoặc ảnh của template vào database chỉ để lấp đầy giao diện.

| Nhóm dữ liệu | Source of truth | Quy tắc |
| --- | --- | --- |
| Transactional/operational | PostgreSQL qua domain/API | RatePlan, giá, inventory, availability và booking rules do server sở hữu; frontend không tự tính hoặc hard-code |
| Sellable catalog | PostgreSQL qua domain/API | Property, RoomType, occupancy, amenities, mô tả bán hàng và media metadata; phải có thể được Admin quản lý trong capability tương lai |
| Media binaries | Object storage do dự án kiểm soát, phân phối qua CDN | PostgreSQL chỉ giữ asset key/path và metadata như alt text, type, sort order, cover flag; không lưu image bytes |
| Marketing/editorial | Frontend configuration trong MVP hoặc content domain/CMS riêng về sau | Hero copy, brand story, FAQ, local guide và promotion không được ép vào Property/RoomType nếu chưa có quyết định content-domain |
| Template/demo | Không có production source of truth | Fake review, fake host, unsupported badge/CTA và field chưa được nghiệp vụ xác nhận phải bị loại bỏ hoặc để unused |

Development dataset dùng controlled mixture:

- dữ liệu thật của The BHA khi đã được xác nhận;
- synthetic Development-only cho price, inventory hoặc availability khi chưa có
  nguồn vận hành;
- không dùng dữ liệu khách hàng thật;
- asset phải có quyền sử dụng phù hợp, không hotlink từ OTA;
- mọi asset đi kèm template hiện tại được xem là **chưa xác minh quyền sử dụng**
  nếu chưa có license/provenance evidence cụ thể; chỉ được dùng làm
  Development/reference và không được promote sang production;
- Owner phải xác nhận rights review trước khi một template asset được coi là
  production-eligible;
- seed phải explicit, deterministic, idempotent, Development-only và không phá
  rate/inventory đã được developer tùy chỉnh.

Chỉ thêm field vào domain khi có yêu cầu bán phòng hoặc vận hành thật. Việc chọn
nhà cung cấp object storage/CDN, upload UI, media manager và Admin CRUD thuộc
work item riêng.
