# BHA-CHECKOUT-001-S1 — Nền tảng reservation trực tiếp và số dư folio

- **Trạng thái:** Proposed (chờ Owner xem xét; chưa phải quyết định kiến trúc, không phải ADR).
- **Ngày:** 2026-11-22.
- **Work item:** `BHA-CHECKOUT-001-S1` (spike tài liệu). Baseline `b2a3a5819b79ffdd683f95e74be0a62d664b8c4d` (`origin/develop`).
- **Phạm vi áp dụng:** thí điểm The BHA Riverside (`a1000000-0000-0000-0000-000000000001`, `Back_End/src/TheBha.Infrastructure/Persistence/Demo/RiversideDemoCatalog.cs:64`, tiền tệ VND).
- **Đứng trước:** PR 01 (schema reservation trực tiếp) và PR 02 (sổ tiền). Tài liệu này chỉ chốt thiết kế và tiêu chí nghiệm thu cho hai PR đó; PR 05 (API trả tại quầy) chỉ được mô tả ranh giới.
- **Không chiếm số ADR.** ADR 0007 đang dùng cho Staff auth (`docs/ADR/0007-separate-staff-identity-with-property-memberships.md`). Nếu Owner chấp nhận, PR 01 mới cập nhật ADR 0005 (xem OI-13).

## 0. Kết luận đề xuất theo nguồn

| # | Quyết định | Đề xuất | Nguồn bằng chứng chính |
|---|---|---|---|
| D1 | Cách lưu reservation không qua hold | Thêm `Reservations.Source` (`Hold` \| `Direct`), cho `Reservations.SourceHoldId` nhận NULL, ràng buộc `CK_Reservations_Source` ghép hai cột; không tạo hold giả. Đơn cũ giữ nguyên, nhận `Source='Hold'` bằng default hằng số. | Mã (§1.1) + probe PG thực thi trên shape tổng hợp (§8) |
| D2 | Nguồn dữ liệu tài chính cho số dư | Backend **chưa có folio ở bất kỳ tầng nào** (§2.1), nên không có gì để tái sử dụng. Thêm sổ bút toán tối thiểu, append-only `FolioEntries` (đúng tên entity đã được blueprint/Bible đặt), số dư luôn suy ra từ sổ bằng một hàm dùng chung, không lưu cột số dư. | Mã + tài liệu (§2) + probe PG (§8) |
| D3 | Dữ liệu cũ | Đơn cũ không có bút toán được hiển thị là **"chưa ghi nhận thanh toán"**, không bao giờ là "chưa trả" hay "đã trả". | Suy luận từ thiết kế (§2.5) |

Có ba điểm Owner phải quyết trước khi PR 01 hoặc PR 05 được viết, vì chúng đổi schema hoặc giá khách thấy: **OI-1** (khuyến mãi trên đơn trực tiếp), **OI-2** (khách vãng lai mất phản hồi thì lấy lại quyền truy cập thế nào), **OI-3** (phạm vi idempotency). Danh sách đầy đủ ở §5.

### Quy ước nhãn bằng chứng

| Nhãn | Nghĩa |
|---|---|
| `[CODE]` | Đọc trực tiếp từ mã tại baseline, có `path:line`. Chưa chạy test của repo. |
| `[EXEC]` | Đã chạy trong phiên này (chỉ có probe PostgreSQL ở §8). |
| `[INFER]` | Suy ra từ mã nhưng chưa chạy. |
| `[PROPOSED]` | Đề xuất chờ Owner. |
| `[LATER]` | Để PR sau, không thuộc PR 01–02. |

## 1. Reservation trực tiếp và dữ liệu cũ

### 1.1 Thực trạng tại baseline `[CODE]`

| Điều đã xác minh | Dẫn chứng |
|---|---|
| `Reservation.SourceHoldId` là `Guid` không nullable; hàm tạo bắt buộc id khác rỗng. | `Back_End/src/TheBha.Domain/Bookings/Reservation.cs:41`, `:105` |
| Hàm tạo `Reservation` là `public`, nhận `sourceHoldId` ở vị trí 3. Có 1 nơi gọi trong domain và 6 nơi trong test (xem §4.1). | `Reservation.cs:19-38`; `InventoryHold.cs:173`; `tests/.../BookingPersistenceTests.cs:784`, `RoomOccupancySegmentInvariantTests.cs:433,486`, `BookingHoldApiTests.cs:720`, `UnitTests/BookingDomainTests.cs:752`, `ReservationReplayCoherenceTests.cs:347` |
| Cột `SourceHoldId` NOT NULL, unique index, và FK ghép `(PropertyId, SourceHoldId) → InventoryHolds(PropertyId, Id)`, `Restrict`. | `Persistence/Configurations/ReservationConfiguration.cs:94`, `:98-106`; snapshot `TheBhaDbContextModelSnapshot.cs:1050`, `:1069`, `:1072` |
| `CK_Reservations_Ids` so `SourceHoldId` với uuid rỗng. Với NULL, CHECK trả NULL nên vẫn qua. | `ReservationConfiguration.cs:16-21`; probe T1 (§8) |
| Đã có thể lưu unit không nguồn: `ReservationUnit.SourceInventoryHoldItemId` là `Guid?`, cột nullable, unique index, FK ghép `(PropertyId, SourceInventoryHoldItemId)`. | `ReservationUnit.cs:24`, `:53`; `ReservationUnitConfiguration.cs:35`, `:43-51`; migration `20260823084717_CommercialCommitmentV2Foundation.cs:181` |
| ADR 0005 mục 3 đã cho phép unit không hold và đang ghi là TARGET. ADR không nói gì về header `Reservation`, mà header đang đòi hold. | `docs/ADR/0005-separate-commercial-commitment-from-physical-allocation.md:102-114` |
| Giá theo đêm nằm ở `ReservationUnitNight` (`RatePlanId`, `UnitAmount`, `ListUnitAmount`, `numeric(18,2)`), khóa `(ReservationUnitId, StayDate)`. `Reservation.TotalAmount` = tổng đêm, tính khi dựng. | `ReservationUnitNightConfiguration.cs:16-31`, `:36`; `Reservation.cs:90-94` |
| Trạng thái: `Reservation.Status ∈ {Confirmed, Cancelled}`, `ReservationUnit.CommitmentStatus ∈ {Committed, Cancelled}`. Hủy là bỏ tồn, không xóa. | `ReservationConfiguration.cs:40-42`; `ReservationUnit.cs:45`, `:64-72` |
| Ownership: đúng một trong `CustomerAccountId` hoặc `GuestAccessTokenHash`. | `ReservationConfiguration.cs:47-50`; `BookingGuard.cs:128-151` |
| Tồn đã đếm đơn không hold: `LoadAttributedReservationDemandAsync` lấy mọi `ReservationUnit` `Committed` của property, không join hold. Hold chỉ đếm khi `Active` và chưa hết hạn. | `Persistence/PhysicalCapacityDataLoader.cs:91-113`, `:126-147` |
| Bảng điều khiển Admin đọc reservation không dùng `SourceHoldId`. | `Persistence/ReservationBoardDataLoader.cs:154-167` |
| `ReservationDto` do `Map` dựng không chứa `SourceHoldId`, nên hợp đồng công khai không lộ hold. | `Persistence/BookingHoldConfirmationStore.cs:174-217` |

### 1.2 Các consumer đang giả định mọi đơn đều có hold `[CODE]`

| Consumer | Giả định | Hệ quả khi `SourceHoldId` nhận NULL |
|---|---|---|
| `ReservationCancellationStore` | Chiếu `(Guid?)item.SourceHoldId` rồi coi `null` là **NotFound**; sau đó khóa `ForHoldTransition(sourceHoldId)`. `ReservationCancellationStore.cs:37-48` | Đơn trực tiếp hợp lệ bị trả "không tồn tại"; không thể hủy. **PR 01 bắt buộc sửa**: tách "không thấy đơn" khỏi "đơn không có hold", và dùng khóa riêng cho đơn trực tiếp. |
| `InventoryHold.IsCoherentReservation` | `reservation.SourceHoldId != Id` (`InventoryHold.cs:247`) | Biên dịch được với `Guid?`; vẫn trả `false` cho đơn trực tiếp, đúng ý. Chỉ gọi từ luồng confirm theo hold. |
| `BookingHoldConfirmationStore` | Tìm đơn theo `SourceHoldId == holdId` (`:53`, `:129`); bắt vi phạm `IX_Reservations_SourceHoldId` (`:219-224`) | Không đổi: các hàng NULL không bao giờ khớp `holdId`. |
| Mapper `BookingHoldConfirmationStore.Map` | `Units[0]`, `Nights[0]` đại diện cho cả đơn (`:176-177`) | Đúng với đơn trực tiếp một RoomType/RatePlan. Giữ nguyên ràng buộc "một dòng hàng" cho thí điểm. |
| `BookingPromotionApplication` | **Khóa chính là `HoldId`**, FK cascade tới `InventoryHold`; `ReservationId` chỉ là cột liên kết nullable. `Configurations/PromotionConfigurations.cs:110`, `:119-120`; `BookingPromotionApplication.cs:40-41` | Đơn trực tiếp không thể mang snapshot khuyến mãi. Đây là OI-1. |
| Hàm tạo `Reservation` | Không có kiểm tra "đêm giảm giá phải có khuyến mãi" mà `InventoryHold` có. `InventoryHold.cs:105-113`; `Reservation.cs:90-101` | Đường tạo trực tiếp phải tự lặp kiểm tra này. |

Không phát hiện consumer nào khác dùng `SourceHoldId` ở mã nguồn (`grep -rnE 'SourceHoldId|SourceInventoryHoldItemId' Back_End/src --include=*.cs`, loại `Migrations/`, chỉ trả các file trên). Test hiện có tham chiếu cột này nằm ở `§4.1`.

### 1.3 Đề xuất biểu diễn nguồn `[PROPOSED]`

1. Thêm cột `Reservations."Source" varchar(20) NOT NULL DEFAULT 'Hold'`. Enum domain `ReservationSource { Hold, Direct }`. Chọn cột tường minh thay vì chỉ dựa vào NULL vì ADR 0005 mục 3 còn nói tới Admin, walk-in và OTA; thêm nguồn sau này là đổi một CHECK, không phải đổi nghĩa của NULL.
2. `Reservations."SourceHoldId"` thành nullable. Giữ nguyên unique index và FK ghép. Postgres mặc định `MATCH SIMPLE` bỏ qua FK khi một cột là NULL, và unique index mặc định cho phép nhiều NULL; cả hai đã được probe (§8, T1, T2, T5).
3. Thêm `CONSTRAINT "CK_Reservations_Source" CHECK (("Source"='Hold' AND "SourceHoldId" IS NOT NULL) OR ("Source"='Direct' AND "SourceHoldId" IS NULL))`.
4. Domain: giữ nguyên hàm tạo hiện có (nguồn Hold) để không phải sửa 7 nơi gọi; thêm factory `Reservation.CreateDirect(...)`. `SourceHoldId` đổi thành `Guid?`. `CreateDirect` bắt buộc mọi unit có `SourceInventoryHoldItemId = null` và lặp kiểm tra "đêm giảm giá phải có khuyến mãi".
5. Không tạo `InventoryHold` giả cho đơn trực tiếp. Ràng buộc ở mục 3 cấm điều này ngay ở DB.

Ghi chú về nhãn `Source`: PR 01 chỉ có hai giá trị. Không có cột hay giá trị nào dành riêng cho thanh toán online (yêu cầu của prompt).

### 1.4 Nullability và invariant

| Invariant | Nơi bảo đảm | Ghi chú |
|---|---|---|
| `Source='Hold'` ⇔ `SourceHoldId IS NOT NULL` | DB: `CK_Reservations_Source` | `[EXEC]` probe T3, T4 |
| Mỗi hold có tối đa một reservation | DB: `IX_Reservations_SourceHoldId` (đã có) | `[EXEC]` probe T5 trên shape tổng hợp |
| Hold ⇒ FK tồn tại cùng property | DB: FK ghép (đã có) | `[EXEC]` probe T2 |
| `Source='Direct'` ⇒ **mọi** unit có `SourceInventoryHoldItemId IS NULL` | Aggregate (`CreateDirect`) + test + SQL kiểm tra ở §1.6 | Xuyên bảng, chưa có ở DB. Xem OI-9. |
| Mỗi đơn có ít nhất một unit; đêm phủ kín `[checkIn, checkOut)` | Aggregate (đã có) | `BookingGuard.cs:171-213`, `Reservation.cs:46-49` |

**Vì sao không dùng constraint trigger cho invariant xuyên bảng ở PR 01.** Repo có tiền lệ (`trg_reservations_status`, ADR 0006; `PhysicalRoomScheduleAvailabilityAuthority.cs:333-374`), nhưng các fixture hiện có dựng đơn **nguồn Hold với unit không có nguồn** (`BookingPersistenceTests.cs:776-783`, nên chiều ngược lại "Hold ⇒ unit có nguồn" không thể ép ở DB mà không sửa fixture). Chiều thuận "Direct ⇒ unit không nguồn" vẫn có thể bằng trigger nếu Owner muốn. Đề xuất mặc định: aggregate + test + SQL kiểm tra; trigger là tùy chọn (OI-9).

### 1.5 Trình tự migration và triển khai `[PROPOSED]`

Migration của PR 01 chỉ cộng thêm, không viết lại hàng nào:

```sql
ALTER TABLE "Reservations" ALTER COLUMN "SourceHoldId" DROP NOT NULL;
ALTER TABLE "Reservations" ADD COLUMN "Source" varchar(20) NOT NULL DEFAULT 'Hold';
ALTER TABLE "Reservations" ADD CONSTRAINT "CK_Reservations_Source"
  CHECK (("Source"='Hold' AND "SourceHoldId" IS NOT NULL)
      OR ("Source"='Direct' AND "SourceHoldId" IS NULL)) NOT VALID;
ALTER TABLE "Reservations" VALIDATE CONSTRAINT "CK_Reservations_Source";
```

`ADD COLUMN ... DEFAULT <hằng>` và `DROP NOT NULL` chỉ đổi metadata, không viết lại bảng. Một migration EF chạy cả bốn câu trong một transaction và hai câu đầu đã giữ khóa `ACCESS EXCLUSIVE` đến khi commit, nên tách `NOT VALID`/`VALIDATE` ở đây chỉ làm bước quét kiểm tra ngắn lại, không bỏ được khóa. Nếu bảng đủ lớn để quan trọng, `VALIDATE` phải chạy ở migration hoặc transaction riêng (quyết định của PR 01). Các câu này đã chạy đúng trên shape tổng hợp (§8). Chưa chạy trên schema thật của EF.

`Down` phải **từ chối** khi còn hàng `Source='Direct'` (mẫu của repo: `PhysicalRoomScheduleAvailabilityAuthority.cs:398-408`); probe T6 minh họa.

Trình tự phát hành:

1. **PR 01 merge và deploy trước mọi thao tác ghi trực tiếp.** Sau PR 01 vẫn chưa có route nào tạo `Direct`; hành vi công khai không đổi.
2. Chạy SQL kiểm tra (§1.6) trước và sau deploy migration; hai bộ checksum phải bằng nhau.
3. PR 05 mới mở đường ghi, mặc định tắt (§3.7).
4. **Mức sàn rollback.** Binary trước PR 01 đọc `SourceHoldId` vào `Guid` không nullable (`Reservation.cs:105`; snapshot `:1050`). Khi đã có một hàng `Direct`, `[INFER]` mọi lần nạp entity `Reservation` đầy đủ (ví dụ `ReservationReadStore.cs:14-24`, `ReservationCancellationStore.cs:53-62`) sẽ lỗi vì EF không gán được NULL vào `Guid`. Vì vậy rollback ứng dụng xuống dưới bản PR 01 chỉ được phép sau khi đã tắt nhận đơn mới và Owner xử lý các hàng `Direct` còn lại; `Down` từ chối trong trường hợp này.

### 1.6 Kiểm tra dữ liệu cũ

Toàn bộ chỉ đọc (`SELECT`). Tên bảng và cột lấy từ `Configurations/*.cs` và snapshot; **chưa chạy trên schema thật** (không có DB cô lập chứa schema EF trong phiên này).

```sql
-- C1. Tổng quan và checksum của các cột cũ. Trước và sau migration phải bằng nhau.
-- Mỗi hàng được mã hóa bằng to_jsonb (khóa sắp xếp, NULL là null, chuỗi được thoát ký tự, số giữ nguyên scale)
-- chỉ trên các cột cũ, nên cột Source mới không làm đổi kết quả; sau đó băm từng hàng và băm chuỗi các
-- hash độ dài cố định. Không có dấu phân cách nào có thể trùng với dữ liệu.
SET TIME ZONE 'UTC';  -- cố định cách in timestamptz, dùng cùng cài đặt cho lần chạy trước và sau
SELECT count(*) AS reservations,
       sum("TotalAmount") AS total_amount,
       md5(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t."Id")) AS legacy_checksum
FROM (SELECT "Id", "ConfirmationNumber", "SourceHoldId", "PropertyId", "CustomerAccountId",
             "GuestAccessTokenHash", "TotalAmount", "Status", "CurrencyCode",
             "ConfirmedAtUtc", "CancelledAtUtc"
      FROM "Reservations") t;

-- C2. Hold mồ côi (kỳ vọng 0 hàng).
SELECT r."Id" FROM "Reservations" r
LEFT JOIN "InventoryHolds" h ON h."Id" = r."SourceHoldId" AND h."PropertyId" = r."PropertyId"
WHERE h."Id" IS NULL;

-- C3. TotalAmount khớp tổng đêm (kỳ vọng 0 hàng).
SELECT r."Id" FROM "Reservations" r
JOIN "ReservationUnits" u ON u."ReservationId" = r."Id"
JOIN "ReservationUnitNights" n ON n."ReservationUnitId" = u."Id"
GROUP BY r."Id", r."TotalAmount" HAVING sum(n."UnitAmount") <> r."TotalAmount";

-- C4. Unit của đơn cũ không có nguồn item (báo cáo, không sửa).
SELECT r."Id", count(*) AS units_without_source
FROM "Reservations" r JOIN "ReservationUnits" u ON u."ReservationId" = r."Id"
WHERE u."SourceInventoryHoldItemId" IS NULL GROUP BY r."Id";

-- C5. Số tiền VND có phần thập phân (đầu vào của PR 02 và PR 05).
SELECT r."Id" FROM "Reservations" r
WHERE r."CurrencyCode" = 'VND' AND r."TotalAmount" <> trunc(r."TotalAmount");
SELECT count(*) AS non_vnd FROM "Reservations" WHERE "CurrencyCode" <> 'VND';

-- C6. Sau migration: Source khớp SourceHoldId (kỳ vọng 0 hàng).
SELECT "Id" FROM "Reservations" WHERE ("Source" = 'Hold') <> ("SourceHoldId" IS NOT NULL);

-- C7. Khuyến mãi của hold đã confirm nhưng chưa nối với đơn (báo cáo).
SELECT p."HoldId" FROM "BookingPromotionApplications" p
JOIN "InventoryHolds" h ON h."Id" = p."HoldId"
WHERE h."Status" = 'Confirmed' AND p."ReservationId" IS NULL;
```

**`BACKFILL_REHEARSAL: NOT RUN`.** Điều kiện còn thiếu: (a) một DB cô lập có schema EF thật cùng fixture tổng hợp gồm đơn confirmed, đơn cancelled, đơn khách vãng lai, đơn khách đăng nhập, đơn có khuyến mãi; (b) bản migration thật của PR 01 (chưa tồn tại); (c) Owner cho phép dùng bản sao dữ liệu thật nếu muốn diễn tập trên dữ liệu thật (S1 không kết nối DB thật). Việc **bắt buộc trước khi PR 01 được nghiệm thu**: áp migration thật lên DB cô lập với fixture trên, chạy C1–C7 trước/sau, ghi `legacy_checksum` bằng nhau và C2, C3, C6 rỗng. Probe ở §8 chỉ chứng minh ngữ nghĩa Postgres trên shape tổng hợp, không thay thế việc này.

Không có thông tin về dữ liệu thật ở bất kỳ môi trường nào (kể cả AWS) trong phiên này; số đơn cũ và phân bố trạng thái là chưa biết (OI-11).

### 1.7 Tắt nhận đơn mới và rollback ứng dụng

PR 01 không thêm công tắc nào vì chưa có đường ghi trực tiếp. Công tắc thuộc PR 05 và được định nghĩa ở §3.7 để PR 01 không phải đoán. Quy trình rollback ứng dụng áp dụng từ khi PR 05 bật:

1. Đặt `Booking:AcceptingNewReservations=false`. Cả tạo hold lẫn tạo đơn trực tiếp trả `503 booking.closed`.
2. Chờ các giao dịch đang chạy kết thúc (mỗi giao dịch ngắn, đều trong một transaction).
3. Rollback binary, không xuống dưới bản PR 01 khi còn hàng `Direct` (§1.5, mục 4).
4. Chỉ mở lại sau khi bản đang chạy đã xác nhận đọc/hủy đơn `Direct` đúng.

Giữ nguyên mọi thứ của đơn cũ: PR 01 không sửa mã đơn, ID, liên kết hold, giá, trạng thái, `CustomerAccountId`, `GuestAccessTokenHash`. C1 là bằng chứng kiểm chứng điều này (checksum chỉ trên các cột cũ, mã hóa từng hàng không nhập nhằng; xem §1.6).

### 1.8 Chạy chung với luồng hold và test hai khách tranh suất cuối

**Chạy chung.** Hold và đơn trực tiếp cùng trừ vào một nguồn tồn: hold đang `Active` (`PhysicalCapacityDataLoader.cs:91-113`) cộng unit `Committed` (`:126-147`). Tạo đơn trực tiếp phải dùng cùng công thức tồn và cùng thứ tự khóa như tạo hold (`BookingHoldCreationStore.cs:29-54`, `:174-230`, `:358-397`). Khi một hold confirm, nhu cầu hold biến mất và nhu cầu unit xuất hiện trong cùng transaction, dưới cùng khóa RoomType (`BookingHoldConfirmationStore.cs:80-109`), nên không có khoảng đếm đôi.

**Test hai khách tranh suất cuối** (mẫu: `BookingHoldApiTests.cs:360-386`, `ReservationCancellationApiTests.cs:395-413`). Chia theo PR vì PR 01 chưa có route:

| Ca | PR | Kỳ vọng |
|---|---|---|
| Hai đơn trực tiếp khác khóa, cùng phòng cuối | PR 05 | Đúng một `201`, một `409 reservation.rooms-unavailable`; `Reservations`=1, `ReservationUnits`=1, tồn còn 0. |
| Đơn trực tiếp và tạo hold, cùng phòng cuối | PR 05 | Đúng một thắng; không bao giờ cả hai. |
| Phòng cuối đang bị hold `Active`; khách khác đặt trực tiếp | PR 05 | `409`. Hold đó vẫn confirm được sau đó (không tự chặn mình). |
| Hai request cùng khóa idempotency, cùng nội dung, song song | PR 05 | Một tạo, một replay `200`; một đơn. |
| Cùng khóa, khác nội dung, song song | PR 05 | Một tạo, một `409 reservation.idempotency-conflict`. |
| Persistence: đơn `Direct` đã `Committed` làm tồn giảm đúng và hủy thì tồn hồi | PR 01 | Kiểm tra qua `PhysicalCapacityDataLoader` trên PG thật. |
| Hủy đồng thời hai lần một đơn `Direct` | PR 01 | Một kết quả terminal, lần hai là `Replayed` (mẫu `ReservationCancellationApiTests.cs:365-376`). |

## 2. Folio và số dư

### 2.1 Xác minh từng lớp `[CODE]`

| Lớp | Kết quả | Dẫn chứng |
|---|---|---|
| Schema / migration | **Không có.** Không migration nào tạo bảng folio, thanh toán, đặt cọc, hoàn tiền. Khớp duy nhất với từ "ledger" là `ContentPackLedger` (nhập nội dung website, không liên quan). | `grep -rliE 'folio|ledger|payment|deposit|refund' Back_End` (cs, sql, json) chỉ trả `ContentPackLedger*`, `TheBhaDbContext.cs:82-83`, danh sách tên migration trong test và chuỗi giao diện trong `Localization/catalog.json` và `packs/*.json` (không phải mã nghiệp vụ); `docs/project/SNAPSHOT.md:650-651` |
| Entity / mapping | **Không có.** Không `DbSet`, không configuration, không entity. | `TheBhaDbContext.cs:19-24`, `:67` (chỉ hold, reservation, promotion) |
| Đường ghi | **Không có.** Không code nào ghi nhận thanh toán, cọc, hoàn tiền. | như trên |
| Đường đọc | **Không có.** `ReservationDto` chỉ có `TotalAmount`, đêm, khuyến mãi. | `BookingHoldConfirmationStore.cs:174-217` |
| Tài liệu | `FolioEntries` là **TARGET**, "không thiết kế chi tiết schema": ghi charge, payment, adjustment; điều chỉnh là bút toán mới, không sửa snapshot giá. | `docs/design/PMS-DATA-001-core-database-blueprint-v2.md:125-126`, `:178-179`, `:1061-1066`; `docs/project/PROJECT_BIBLE.md:210-211` |
| UI Admin | **Chỉ là mock cục bộ.** Có sổ kiểu `room-charge`, `extra-charge`, `deposit`, `payment`, `refund`, `adjustment`; trạng thái thanh toán suy ra từ sổ, "không bao giờ là trường lưu riêng". | `Front_End/Admin_Web/src/components/calendar/reservation-board/types.ts:111-121`, `:140`; `reservationRuntime.ts:95-135`; `AGENTS.md:14` |
| UI Customer | Biên nhận hiển thị chuỗi tĩnh "không thanh toán online", không có số dư. | `Front_End/Customer_Web/src/app/paydone/PayDoneReceipt.tsx:249` |
| Test | **Không có** test backend cho folio (vì không có mã). Mock Admin có test UI (`ReservationBoardStayPopover.test.tsx`), không chứng minh gì về backend. | `grep -rli folio Front_End/Admin_Web/src` |

**Kết luận:** "tái sử dụng folio hiện có nếu đủ" không áp dụng được vì không có folio ở backend. Chỉ có mock UI làm mẫu hình dạng.

### 2.2 Đề xuất: sổ bút toán tối thiểu `FolioEntries` `[PROPOSED]`

Đặt tên theo blueprint để không thêm từ vựng mới. Một bảng, append-only, một hàm tính số dư. Không có cột số dư trên `Reservation`, theo đúng nguyên tắc mock đã dùng ("suy ra, không lưu").

Cột (đã dựng và thử các ràng buộc trên shape tổng hợp, §8):

| Cột | Ý nghĩa |
|---|---|
| `Id` uuid PK | |
| `PropertyId`, `ReservationId` | FK ghép `(PropertyId, ReservationId) → Reservations(PropertyId, Id)` (alternate key đã có: `ReservationConfiguration.cs:61`), `Restrict` |
| `Kind` | `RoomCharge`, `RoomChargeReversal`, `Payment`, `Refund`, `GatewayFee` (CHECK đóng) |
| `Amount` bigint | VND đồng nguyên, `> 0`; chiều tính do `Kind` quyết định |
| `CurrencyCode` char(3) | CHECK `= 'VND'` ở PR 02 (OI-12) |
| `PostingKey` varchar(128) | Chống ghi trùng; unique `(ReservationId, PostingKey)` |
| `ReferenceEntryId` uuid null, FK tự thân | Bắt buộc cho `RoomChargeReversal`, `Refund`, `GatewayFee`; cấm cho kind còn lại |
| `ActorKind` (`System`/`Staff`/`Public`/`Gateway`), `ActorStaffId` null | Nguồn bút toán; Staff lấy từ phiên Staff đã xác thực (ADR 0007) |
| `Reason` null | Bắt buộc khi `RoomChargeReversal` hoặc `Refund` |
| `OccurredAtUtc`, `RecordedAtUtc` | Thời điểm nghiệp vụ và thời điểm server ghi |

Bất biến chặn bằng DB: `Amount > 0`, kind thuộc tập đóng, `Reference` đúng kind, `Reason` đúng kind, unique `PostingKey`, và trigger `BEFORE UPDATE OR DELETE` từ chối (tiền lệ: `RoomOccupancySegmentAudit` append-only). Sửa sai là bút toán mới ngược dấu, không sửa hàng cũ.

### 2.3 Một nguồn số dư và phân biệt các loại tiền

| Khái niệm | Định nghĩa | Nằm ở đâu |
|---|---|---|
| **Giá đặt phòng** | Tổng `UnitAmount` các đêm của unit `Committed` | Snapshot thương mại bất biến (`ReservationUnitNight`), **không** phải bút toán |
| **Khoản phải thu** `R` | Σ `RoomCharge` − Σ `RoomChargeReversal` | `FolioEntries` |
| **Đã thu** `C` | Σ `Payment` − Σ `Refund` | `FolioEntries` |
| **Số dư còn phải thu** `B` | `R − C` (`B < 0` nghĩa là đã thu dư) | suy ra |
| **Phí cổng khấu trừ** `F` | Σ `GatewayFee` (tham chiếu `Payment`) | `FolioEntries`; **không** vào `B`, chỉ vào báo cáo đối soát (`C − F`) |

Lý do `R` không bằng `Reservation.TotalAmount`: `TotalAmount` cố định lúc dựng và còn tính cả đêm có thể bị hủy sau này (`Reservation.cs:90`); khoản phải thu phải đi theo bút toán.

**Nguồn số dư dùng chung** cho email, lễ tân và checkout là một hàm thuần duy nhất `ReservationBalance.From(entries)` cùng một reader `IFolioReader`, và mọi nơi hiển thị phải đi qua nó. Không có nơi nào được cộng trừ tay, không cache số dư vào `Reservation`.

### 2.4 VND nguyên, chống ghi trùng, audit

- **VND nguyên.** Cột `bigint`. Việc chuyển từ `decimal` phải do mã ứng dụng làm và **từ chối** số có phần thập phân; không làm tròn. Lý do thực thi được: `numeric → bigint` trong Postgres làm tròn im lặng (`1000000.5 → 1000001`, probe F3), nên không thể để DB gánh. Rủi ro có thật: DB chỉ ép `Amount > 0` và hai chữ số thập phân cho giá đêm (`DailyRoomRateConfiguration.cs:11`, `BookingGuard.cs:272-290`); chỉ khuyến mãi mới làm tròn về đồng (`PromotionRules.cs:56-66`). C5 phải chạy để biết có đơn VND lẻ hay không. PR 05 phải từ chối đặt khi tổng VND có phần lẻ (OI-10).
- **Chống ghi trùng.** `PostingKey` + unique `(ReservationId, PostingKey)`. Khóa xác định theo sự kiện: `charge:initial`, `payment:{provider}:{txnId}` (online, sau này), `staff:{clientKey}` (lễ tân). Ghi lại cùng khóa cùng nội dung là no-op trả bút toán cũ; cùng khóa khác `Kind`/`Amount` là lỗi xung đột. Mọi bút toán của một đơn đi qua một khóa advisory `ForReservationFolio(reservationId)` để kiểm tra "hoàn không vượt thu" an toàn khi chạy song song (`[PROPOSED]`, cùng họ với `BookingAdvisoryLockKeys` ở `BookingHoldCreationStore.cs:495-510`).
- **Audit.** `ActorKind`, `ActorStaffId`, `Reason`, hai mốc thời gian, bảng append-only (probe F4, F5).

### 2.5 Hiển thị dữ liệu cũ chưa ghi nhận thanh toán

Đơn cũ không có `RoomCharge`. Hàm số dư trả `LedgerState = NotRecorded` khi chưa có bút toán `RoomCharge` của đơn. Khi đó giao diện và email hiển thị giá đặt phòng (từ snapshot) kèm "Chưa ghi nhận thanh toán", **không** hiển thị "chưa thanh toán", "đã thanh toán" hay số dư, vì tiền có thể đã thu ngoài hệ thống. Không backfill bút toán cho đơn cũ trong PR 02 (OI-7).

### 2.6 Khoản tiền online đến trước khi có reservation (chỉ ranh giới) `[LATER]`

- Mỗi khoản tiền online được lưu theo **giao dịch cổng** trong bảng riêng `PaymentTransactions` (PR sau), khóa duy nhất `(Provider, ProviderTransactionId)`, gắn với **một lần thử đặt** (khóa idempotency + fingerprint), chưa có `ReservationId`. Số tiền do server tính; khách không nhập.
- **Chỉ khi** giao dịch ở trạng thái `Succeeded` do cổng xác nhận phía server (không phải redirect của trình duyệt), một bút toán `Payment` với `PostingKey = payment:{provider}:{txnId}` mới được ghi vào sổ, **trong cùng transaction** tạo reservation hoặc nối giao dịch vào reservation đã có. Trước thời điểm đó khoản tiền không xuất hiện trong bất kỳ số dư nào.
- Phí cổng ghi bằng `GatewayFee` tham chiếu `Payment`, khi dữ liệu đối soát có. Trường hợp đã thu tiền nhưng không tạo được đơn (hết phòng) cần luồng hoàn ở mức giao dịch; chưa thiết kế ở S1.
- Tỷ lệ cọc 30%, VietQR, thẻ, hết hạn thanh toán: ngoài S1 và ngoài PR 01–02. Chỉ ghi định hướng: server quyết định số tiền, khách không nhập số tiền.

## 3. Ranh giới API cho PR 05 (đơn trả tại quầy)

Đây là ranh giới để PR 01–02 không chặn PR 05; chưa phải thiết kế cuối.

### 3.1 Route và yêu cầu `[PROPOSED]`

`POST /api/v1/reservations` (cùng tài nguyên với `GET /{id}` và `POST /{id}/cancel`: `ReservationsController.cs:16`, `:50`).

- Header: `Idempotency-Key` bắt buộc (cùng luật `BookingHoldCreation.cs:235-260`), CSRF như các POST công khai hiện có, cookie khách đăng nhập tùy chọn.
- Body: `propertyId`, `roomTypeId`, `ratePlanId`, `checkIn`, `checkOut`, `adults`, `children`, `rooms`, `fullName`, `email`, `phone`, **`expectedTotalAmount` và `expectedCurrencyCode` bắt buộc**, `paymentMethod` (PR 05 chỉ nhận `PayAtProperty`).
- Không có trường số tiền nào khác. Số phải thu lúc đặt là 0đ và do server quyết.
- Khác luồng hold: ở hold, giá kỳ vọng là tùy chọn (`BookingHoldCreation.cs:30-31`) vì bước hold hiển thị giá trước; ở đơn trực tiếp không có bước đệm nên giá phải được khách xác nhận.

### 3.1b Phản hồi thành công

- `201 Created`, header `Location: /api/v1/reservations/{id}`, thân là hình dạng `ReservationDto` hiện có (`BookingHoldConfirmationStore.cs:174-217`) cộng các trường **bổ sung**: `paymentMethod` và khối số dư `ledgerState`, `receivableAmount`, `collectedAmount`, `balanceDueAmount` (lấy từ hàm ở §2.3; với đơn mới `collectedAmount = 0`, `balanceDueAmount = receivableAmount`).
- Token truy cập của khách vãng lai xuất hiện trong thân lần thành công đầu tiên hay không phụ thuộc OI-2: nếu token do client sinh thì server không trả token; nếu server sinh thì chỉ trả đúng một lần và replay không trả lại.
- Replay cùng `Idempotency-Key` và cùng nội dung trả `200` với cùng thân (không có token do server sinh).
- Các trường thêm vào là thay đổi **additive** của hợp đồng công khai và thuộc PR 05, không thuộc PR 01–02.

### 3.2 Ownership

Giống mô hình hiện có: phiên khách đăng nhập → `CustomerAccountId`; ngược lại token truy cập khách → `GuestAccessTokenHash`. DB ép "đúng một trong hai" (`ReservationConfiguration.cs:47-50`), tài nguyên đọc/hủy xác thực bằng `X-Booking-Access-Token` (`ReservationsController.cs:23`).

### 3.3 Xác nhận giá và tồn lúc ghi

Dưới khóa, dùng đúng hàm giá và đúng công thức tồn của hold (`BookingHoldCreationStore.cs:153-262`). Nếu `expectedTotalAmount`/`expectedCurrencyCode` lệch giá hiện tại, trả `409 reservation.price-changed` kèm `quote` (mẫu: `BookingHoldsController.cs:57-67`, `BookingHoldCreationStore.cs:264-280`), không ghi gì. Replay phải trả **trước** bước định giá và kiểm tồn (mẫu: `:33-43`, `:56-66`), để một yêu cầu đã thành công không bị đổi kết quả khi giá thay đổi. Cần tách phần "đọc tồn + so công thức" (`:174-230`, `:358-397`) thành hàm dùng chung thay vì sao chép.

### 3.4 Idempotency có scope và fingerprint `[PROPOSED]`

Hiện tại idempotency của hold là **toàn cục**: unique index chỉ trên `IdempotencyKeyHash` (`InventoryHoldConfiguration.cs:89`), và `Reservations` không có cột idempotency. Đề xuất bảng `ReservationCreationRequests(ScopeKey, KeyHash, RequestFingerprint, ReservationId unique, CreatedAtUtc)`, unique `(ScopeKey, KeyHash)`, ghi trong cùng transaction với đơn. `ScopeKey = direct:v1:{propertyId}:{customer:{id}|guest}`. Fingerprint theo mẫu `CreateFingerprint` (`BookingHoldCreation.cs:340-375`, đã gồm danh tính khách và giá kỳ vọng) cộng `paymentMethod`. Khóa advisory lớp 1 lấy từ `(ScopeKey, KeyHash)` với namespace riêng. Cùng khóa khác fingerprint là `409 reservation.idempotency-conflict`. Chờ Owner xác nhận ở OI-3.

### 3.5 Mất phản hồi sau khi đã thành công

Client gửi lại cùng `Idempotency-Key` và cùng body → `200` với đúng reservation đó, không tạo lần hai. **Vấn đề đã xác minh:** với khách vãng lai, replay hiện chỉ trả `null` cho token (`BookingHoldCreationStore.cs:352`, `:422`) vì DB chỉ lưu hash. Với hold điều đó vô hại (hold hết hạn sau 15 phút); với đơn trực tiếp nó để lại một đơn đã xác nhận, còn chiếm tồn, mà khách không truy cập được. Cần một thiết kế lấy lại quyền truy cập. Phương án đề xuất: client sinh token ngẫu nhiên đủ entropy, gửi lên; server chỉ lưu hash (`BookingAccessTokenValidator.cs:5-40` đã kiểm dạng base64url), fingerprint gồm hash token; replay không cần trả token vì client đang giữ. Phương án khác: server dẫn xuất token bằng HMAC từ khóa bí mật (cần secret mới, nằm ngoài quyền của S1). Là OI-2, **phải chốt trước PR 05**.

### 3.6 Transaction, dữ liệu tài chính ban đầu, sự kiện xác nhận

Một transaction: khóa lớp 1 → kiểm replay → xác thực property/room type/rate plan active, ngày nhận phòng không quá khứ theo múi giờ property, sức chứa → khóa RoomType và khóa tồn từng đêm → giá + khuyến mãi → so giá kỳ vọng → dựng `Reservation.CreateDirect` (`ConfirmedAtUtc = utcNow`) → bút toán `RoomCharge` (`PostingKey=charge:initial`, `Amount = TotalAmount` nguyên, `ActorKind=System`), **không có `Payment`** (thu 0đ lúc đặt) → bản ghi `ReservationCreationRequests` → sự kiện lịch → hàng outbox email → `SaveChanges` → `COMMIT` → hint sau commit.

- **Thứ tự khóa:** lớp 1 (idempotency/aggregate) → lớp 2 (khóa `ReservationUnit`, không cần vì unit mới) → lớp 3 (RoomType) → lớp 4 (tồn từng đêm), đúng thứ tự cố định của `AdvisoryLockCoordinator` (mô tả ở `Persistence/AdvisoryLockCoordinator.cs:117-130`). Giống `BookingHoldCreationStore.cs:29-54` và hold confirm (`BookingHoldConfirmationStore.cs:25-88`) nên không tạo chu trình khóa.
- **Hủy đơn trực tiếp:** khóa lớp 1 mới `ForReservationTransition(reservationId)`; đơn nguồn Hold tiếp tục dùng `ForHoldTransition` để confirm-replay và hủy vẫn tuần tự hóa. Đây là yêu cầu của PR 01 (§4.1).
- **Sự kiện lịch.** `ReservationCancellationStore` ghi một sự kiện công khai cho mỗi unit rồi bắn hint sau commit (`:169-183`). **`BookingHoldConfirmationStore` không ghi sự kiện nào** (không có `IAdminActivityRecorder`), nên hôm nay một đơn mới xác nhận không tạo sự kiện lịch. Đơn trực tiếp nên ghi để bảng Admin biết; đồng thời cần Owner xác nhận có áp dụng cho confirm theo hold không (OI-6).
- **Email là hệ quả sau khi lưu.** Hiện không có bộ gửi email đặt phòng (`grep` chỉ thấy bộ gửi newsletter: `Persistence/Newsletter/NewsletterSenderService.cs`, chưa xem sâu). Ranh giới: ghi hàng outbox trong transaction, gửi sau commit; gửi lỗi không làm hỏng hay hoàn tác đơn. Bộ gửi không thuộc PR 01–02. Nội dung email lấy số dư từ hàm ở §2.3.

### 3.7 Hai công tắc tách biệt `[PROPOSED]`

| Công tắc | Ý nghĩa | Tác động |
|---|---|---|
| `Booking:DirectCheckout:PropertyIds` (danh sách cho phép; rỗng = tắt) | Property nào được **dùng** luồng đơn trực tiếp. Thí điểm: chỉ Riverside. | Property ngoài danh sách: `POST /api/v1/reservations` trả `409 checkout.direct-unavailable`; luồng hold không đổi. |
| `Booking:AcceptingNewReservations` (bool, mặc định `true`) | **Dừng nhận đơn mới** toàn hệ thống. | `false`: cả `POST /api/v1/booking-holds` và `POST /api/v1/reservations` trả `503 booking.closed`. Đọc, hủy, và confirm một hold đã `Active` vẫn chạy (OI-5). |

Hai công tắc độc lập. Chuyển từ đơn trực tiếp về luồng hold chỉ cần tắt công tắc thứ nhất; việc đó không mở bán lại thứ gì đang đóng, vì nếu bán đang dừng thì công tắc thứ hai (`false`) vẫn chặn cả tạo hold. Dừng hẳn bằng công tắc thứ hai chặn cả hai đường.

| `DirectCheckout` cho property | `AcceptingNew` | Kết quả |
|---|---|---|
| bật | `true` | Đặt trực tiếp hoạt động |
| tắt | `true` | Chỉ luồng hold (chuyển về hold) |
| bật hoặc tắt | `false` | Không nhận đơn mới ở cả hai đường |

Thí điểm Riverside chưa có cơ chế danh sách cho phép nào trong mã: `Property` không có cờ vận hành (`Property.cs:40-55`) và `appsettings`/`Program.cs` không nhắc Riverside ngoài lệnh seed demo (`Program.cs:622-632`). Đề xuất dùng cấu hình, kiểm hợp lệ lúc khởi động như `Website:Newsletter` (`Program.cs:248-254`). Cờ lưu trong DB theo property để đổi không cần deploy là lựa chọn sau (OI-4). Cách Customer_Web biết nên dùng luồng nào thuộc PR frontend sau.

### 3.8 Mã lỗi quan trọng

| Tình huống | HTTP | `code` đề xuất | Ghi chú |
|---|---|---|---|
| Dữ liệu sai | 400 | `validation.*` (tái dùng) | `PublicProblemCodes.cs:19-46` |
| Phiên khách sai | 401 | `auth.session-invalid` | |
| Property, room type, rate plan không có | 404 | `property.not-found`, `room-type.not-found`, `booking.selection-not-found` | |
| Giá đổi | 409 | `reservation.price-changed` + `quote` | mẫu `hold.price-changed`, `PublicProblemCodes.cs:63` |
| Hết phòng | 409 | `reservation.rooms-unavailable` | mẫu `:65` |
| Cùng khóa khác nội dung | 409 | `reservation.idempotency-conflict` | mẫu `:67` |
| Property chưa bật luồng này | 409 | `checkout.direct-unavailable` | |
| Dừng nhận đơn | 503 | `booking.closed` | |

Thêm mã vào `PublicProblemCodes.Known` là việc của PR 05; mã đã phát hành là API (`PublicProblemCodes.cs:11`).

## 4. Bàn giao PR 01–02

### 4.1 PR 01 — Schema reservation trực tiếp

**Thay đổi `[PROPOSED]`:**

1. Migration §1.5 và `Down` có chốt chặn (`[PROPOSED]`).
2. Domain: `ReservationSource`; `Reservation.SourceHoldId` thành `Guid?`; `Source` là thuộc tính; `Reservation.CreateDirect(...)` với kiểm tra "đêm giảm giá phải có khuyến mãi" và "mọi unit không nguồn".
3. EF: `ReservationConfiguration` (cột `Source`, `CK_Reservations_Source`; `CK_Reservations_Ids` giữ nguyên vì CHECK trả NULL cho `SourceHoldId` NULL, probe T1), snapshot và Designer sinh lại.
4. `ReservationCancellationStore`: chiếu `(Source, SourceHoldId)` thay vì `(Guid?)SourceHoldId`; phân biệt "không thấy đơn" và "đơn không hold"; thêm `BookingAdvisoryLockKeys.ForReservationTransition`; giữ `ForHoldTransition` cho đơn nguồn Hold.
5. Khuyến mãi theo OI-1. Nếu Owner chọn re-key: bảng `BookingPromotionApplications` đổi khóa chính sang `Id` mới, `HoldId` nullable unique, `CK` bảo đảm đúng một dòng gốc (`HoldId` hoặc `ReservationId` có giá trị), backfill `Id` cho dữ liệu cũ. Nếu chọn từ chối khuyến mãi cho đơn trực tiếp ở thí điểm: PR 01 không đụng bảng này, nhưng đổi cách báo giá của luồng trực tiếp (OI-1).
6. Test phải sửa vì thay đổi hợp lệ: hai danh sách migration chờ cố định ở `CommercialCommitmentV2MigrationTests.cs:97`, `:192` (thêm migration mới vào cuối); các assert tên index/constraint ở `BookingPersistenceTests.cs:574-576` và danh sách CHECK ngay sau đó; các fixture gọi hàm tạo `Reservation` ở bảy nơi (§1.1) chỉ cần đổi nếu chữ ký bị đổi (đề xuất giữ nguyên).
7. Tài liệu: cập nhật trạng thái ADR 0005 mục 3 và `SNAPSHOT.md` (OI-13). S1 không sửa các file này.

**Phụ thuộc:** không phụ thuộc PR nào. **Compatibility:** hợp đồng công khai không đổi (`ReservationDto` không có `SourceHoldId`); không route nào tạo `Direct`; đơn cũ không thay đổi; binary cũ không đọc được hàng `Direct` (§1.5, mục 4), nên PR 01 phải deploy trước mọi đường ghi.

**Ca test cụ thể (nghiệm thu PR 01):**

| # | Ca | Kỳ vọng |
|---|---|---|
| T-01 | Áp migration lên DB có đơn cũ (confirmed, cancelled, khách vãng lai, khách đăng nhập, có/không khuyến mãi) | `legacy_checksum` (C1) bằng nhau trước/sau; tất cả `Source='Hold'`; C2, C3, C6 rỗng |
| T-02 | `Down` khi có hàng `Direct`; `Down` khi không có | Lần đầu từ chối với thông báo rõ; lần hai khôi phục NOT NULL |
| T-03 | Ràng buộc DB | Hai hàng `Direct` cùng NULL được phép; `Direct` kèm hold, `Hold` thiếu hold, hold tham chiếu không tồn tại, đơn thứ hai trên cùng hold đều bị từ chối |
| T-04 | `CreateDirect` | Mọi unit không nguồn; tổng đúng; thiếu khuyến mãi cho đêm giảm giá bị từ chối; ownership đúng một nguồn |
| T-05 | Persist và đọc lại đơn `Direct` | Nạp entity không lỗi; `ReservationReadStore` trả đúng, chủ sở hữu bằng token và bằng phiên khách đều đọc được |
| T-06 | Hủy đơn `Direct` | Hủy thành công, không phải NotFound; dùng khóa `ForReservationTransition`; hủy lần hai là `Replayed`; hai hủy song song cho một kết quả terminal; hủy đơn nguồn Hold vẫn dùng `ForHoldTransition`; id không tồn tại vẫn NotFound |
| T-07 | Tồn | Unit `Direct` `Committed` làm tồn giảm; hủy thì hồi; gán phòng vật lý (ADR 0006) cho unit không nguồn hoạt động |
| T-08 | Confirm theo hold khi đã có đơn `Direct` | Không ảnh hưởng; replay confirm vẫn đúng |
| T-09 | Bảng điều khiển Admin có đơn `Direct` | Hiển thị bình thường (`ReservationBoardDataLoader.cs:154-167` không đọc hold) |
| T-10 | Khuyến mãi (theo OI-1) | Đơn `Direct` có khuyến mãi lưu, đọc, hủy được; hoặc bị từ chối theo lựa chọn Owner |

**Đã xác minh / chờ Owner / để sau:** đã xác minh = §1.1–§1.2. Chờ Owner = OI-1, OI-9, OI-11, OI-13. Để sau = đường tạo trực tiếp (PR 05), `ForReservationFolio` (PR 02).

### 4.2 PR 02 — Sổ tiền

**Thay đổi `[PROPOSED]`:** migration tạo `FolioEntries` (§2.2) với CHECK, unique, FK, trigger append-only; entity `FolioEntry` và configuration; `ReservationBalance.From(entries)` thuần; `IFolioReader`; dịch vụ ghi `IFolioPosting` idempotent theo `PostingKey` với khóa `ForReservationFolio`; chuyển `decimal → long` chỉ khi số nguyên.

**Không thuộc PR 02:** route HTTP, UI, ghi `RoomCharge` khi confirm hold, backfill đơn cũ, hoàn tiền theo chính sách hủy, `PaymentTransactions`, tích hợp cổng. Mọi thứ đó là PR sau.

**Phụ thuộc:** cần `Reservations` có alternate key `(PropertyId, Id)` (đã có). Về logic không chờ PR 01; nhưng PR 05 cần cả hai. **Compatibility:** chỉ thêm bảng mới, không đụng đường hiện có.

**Ca test cụ thể:**

| # | Ca | Kỳ vọng |
|---|---|---|
| F-01 | Số dư | `RoomCharge 3.000.000`, `Payment 1.000.000` → `R=3.000.000`, `C=1.000.000`, `B=2.000.000`; thêm `Refund 200.000` (tham chiếu `Payment`, có lý do) → `C=800.000`, `B=2.200.000` |
| F-02 | Phí cổng | `GatewayFee` tham chiếu `Payment` không đổi `B`; xuất hiện ở báo cáo đối soát |
| F-03 | Đã thu dư | `Payment` lớn hơn `R` → `B<0`, trạng thái "thu dư" |
| F-04 | Đơn không có bút toán | `LedgerState = NotRecorded`; không trả "đã trả/chưa trả" |
| F-05 | Chống ghi trùng | Cùng `PostingKey`, cùng nội dung → no-op trả bút toán cũ; khác `Amount` hoặc `Kind` → xung đột; hai lần ghi song song → một hàng |
| F-06 | Bất biến DB | `Amount ≤ 0`, `Kind` lạ, `Refund` không lý do, `Refund` không tham chiếu, tiền tệ khác VND đều bị từ chối |
| F-07 | Append-only | `UPDATE` và `DELETE` đều bị trigger từ chối |
| F-08 | VND nguyên | `decimal` có phần lẻ bị từ chối ở mã ứng dụng, không bị làm tròn; số lớn tối đa của domain (`9.999.999.999.999.999,99`) vẫn nằm trong `bigint` |
| F-09 | Hoàn không vượt thu | Tổng `Refund` tham chiếu một `Payment` không vượt `Payment`, kể cả khi hai hoàn chạy song song |
| F-10 | Đơn `Direct` và đơn nguồn Hold dùng chung hàm số dư | Cùng kết quả cho cùng bút toán |

**Đã xác minh / chờ Owner / để sau:** đã xác minh = §2.1. Chờ Owner = OI-7, OI-8, OI-12. Để sau = HTTP/UI, `PaymentTransactions`, cổng, chính sách hủy.

## 5. Danh sách việc mở

Cột "PR bị ảnh hưởng" chỉ rõ chỗ phải chốt. "Pending" ghi các giá trị vận hành chưa chốt nhưng **không** ảnh hưởng PR 01–02.

| ID | Việc mở | Loại | PR ảnh hưởng | Đề xuất |
|---|---|---|---|---|
| OI-1 | Khuyến mãi trên đơn trực tiếp: `BookingPromotionApplication` khóa theo `HoldId` (`PromotionConfigurations.cs:110`, `:119`). Hoặc đổi khóa (đổi schema trên dữ liệu thật), hoặc đơn trực tiếp không áp khuyến mãi (khách thấy giá khác luồng hold). | Owner quyết | **PR 01**, PR 05 | Đổi khóa, vì báo giá hiện áp khuyến mãi và giá xác nhận phải khớp báo giá |
| OI-2 | Khách vãng lai mất phản hồi: replay không trả được token (`BookingHoldCreationStore.cs:352`) | Owner/bảo mật quyết | PR 05 | Token do client sinh, server lưu hash |
| OI-3 | Phạm vi idempotency (hiện toàn cục: `InventoryHoldConfiguration.cs:89`) và bảng `ReservationCreationRequests` | Owner xác nhận | PR 05 | Như §3.4 |
| OI-4 | Cơ chế khoanh thí điểm Riverside: cấu hình danh sách cho phép hay cờ DB theo property | Owner quyết | PR 05 | Cấu hình trước |
| OI-5 | Khi dừng nhận đơn, có chặn cả confirm hold đang `Active` không | Owner quyết | PR 05 | Không chặn (hold đã chiếm tồn) |
| OI-6 | Đơn mới có tạo sự kiện lịch; và hold confirm hiện không tạo (khoảng trống đã có) | Owner quyết | PR 05 | Đơn trực tiếp có; hold confirm xét riêng |
| OI-7 | Ghi `RoomCharge` khi confirm hold; backfill `RoomCharge` cho đơn cũ | Owner quyết | PR sau PR 02 | Không backfill; đơn cũ giữ `NotRecorded` |
| OI-8 | Chính sách hủy và phí hủy để sinh `RoomChargeReversal` | Owner quyết | PR sau PR 02 | Chưa thiết kế |
| OI-9 | Ép invariant "Direct ⇒ unit không nguồn" bằng constraint trigger hay aggregate+test+SQL | Owner quyết | PR 01 | Aggregate + test + SQL (§1.4) |
| OI-10 | Chính sách số VND có phần lẻ (rate list, discount cố định) | Owner quyết | PR 01 (C5), PR 02, PR 05 | Từ chối, không làm tròn |
| OI-11 | Số lượng và phân bố đơn cũ ở môi trường đã deploy; diễn tập trên bản sao thật cần phép | Owner cấp | **PR 01** nghiệm thu | Diễn tập trên DB cô lập trước; bản sao thật chỉ khi Owner cho |
| OI-12 | Tiền tệ ngoài VND trong sổ | Owner quyết | PR 02 | VND-only; đơn khác tiền tệ giữ `NotRecorded` |
| OI-13 | Cập nhật ADR 0005 mục 3, `SNAPSHOT.md`, `PROJECT_BIBLE.md` khi PR 01 vào | Quy trình | PR 01 | Làm trong PR 01 |
| OI-14 | Giới hạn tốc độ cho POST công khai mới | Chưa kiểm tra | PR 05 | Xét cùng PR 05 |

**Pending, không ảnh hưởng PR 01–02:** tỷ lệ cọc 30% và quy tắc làm tròn, thời hạn thanh toán online, khung hủy, định dạng và ngôn ngữ email, cách Customer_Web chọn luồng.

## 6. Giới hạn bằng chứng và những gì chưa chạy

- **Không chạy test của repo.** Mọi `[CODE]` là đọc mã; chưa build, chưa chạy `dotnet test`.
- **`BACKFILL_REHEARSAL: NOT RUN`** (điều kiện ở §1.6).
- **`[EXEC]` chỉ gồm probe PostgreSQL ở §8**, trên cụm Postgres 17.10 dựng tạm ngoài repo, với bảng tổng hợp bắt chước shape. CI dùng `postgres:18.3` (`.github/workflows/ci.yml:93-94`), `AGENTS.md` ghi PostgreSQL 17; phiên bản 18 chưa được probe.
- Chưa chạy các câu SQL kiểm tra C1–C7 trên schema EF thật.
- `[INFER]`: hành vi EF khi nạp NULL vào `Guid` (mức sàn rollback) chưa thực thi.
- Chưa kết nối DB thật, chưa đọc dữ liệu thật ở bất kỳ môi trường nào.
- Không dùng Graphify; mã nguồn đủ để truy vết, mọi kết luận đã đối chiếu trực tiếp với source.
- `NewsletterSenderService` chỉ được nêu làm tiền lệ; chưa đọc sâu.
- Chưa xem rate limit và CSRF chi tiết của POST công khai (OI-14).

## 7. Nhắc lại ràng buộc nghiệp vụ đã dùng

Trả khi nhận phòng xác nhận trực tiếp với 0đ thu lúc đặt, không bắt đầu hold 15 phút (`InventoryHold.Lifetime`, `InventoryHold.cs:15`, **không** áp dụng cho luồng này). Đơn xác nhận tiếp tục chiếm tồn đúng những đêm đã đặt vì unit `Committed` được đếm vào tồn (`PhysicalCapacityDataLoader.cs:126-147`). Email là hệ quả sau khi lưu đơn thành công. Online, cọc 30%, VietQR, thẻ và hết hạn thanh toán thuộc PR sau.

## 8. Phụ lục: probe PostgreSQL đã chạy `[EXEC]`

Chạy ngày 2026-11-22 trên cụm Postgres 17.10 tạm (đã dừng, thư mục dữ liệu đã xóa), cổng loopback riêng, dữ liệu nằm ngoài repo, bảng tổng hợp bắt chước shape (`InventoryHolds`, `Reservations`, `FolioEntries`), **không phải schema EF thật và không phải diễn tập dữ liệu cũ**. Một hàng đơn cũ tổng hợp được tạo trước khi áp DDL đề xuất.

| Ca | Nội dung | Kết quả quan sát |
|---|---|---|
| (DDL) | `DROP NOT NULL`, `ADD COLUMN Source DEFAULT 'Hold'`, `ADD CHECK NOT VALID`, `VALIDATE` | Chạy được; hàng cũ giữ nguyên, `Source='Hold'`, hold id nguyên vẹn |
| T1 | Hai hàng `Direct` cùng `SourceHoldId` NULL; `CK_Reservations_Ids` với NULL | Cả hai insert thành công (unique cho phép nhiều NULL; FK `MATCH SIMPLE` bỏ qua; CHECK qua với NULL) |
| T2 | Hàng nguồn `Hold` trỏ hold không tồn tại | Bị FK từ chối |
| T3 | `Direct` kèm hold id | Bị `CK_Reservations_Source` từ chối |
| T4 | `Hold` với hold id NULL | Bị `CK_Reservations_Source` từ chối |
| T5 | Đơn thứ hai trên cùng hold | Bị `IX_Reservations_SourceHoldId` từ chối |
| T6 | Chốt chặn `Down` khi còn hàng `Direct` | Ném lỗi "Cannot downgrade: 2 Direct Reservation row(s)..." |
| T7 | SQL kiểm tra `Source` khớp `SourceHoldId` | 0 hàng |
| F1, F2 | `FolioEntries`: một `RoomCharge`; ghi lại cùng `PostingKey` | Lần đầu thành công; lần hai bị unique từ chối |
| F3 | `numeric → bigint` với `1000000.5` | Làm tròn im lặng thành `1000001`, nên việc từ chối số lẻ phải ở mã ứng dụng |
| F4, F5 | `UPDATE`, `DELETE` trên sổ | Cả hai bị trigger append-only từ chối |
| F6, F7 | `Refund` thiếu lý do; `Refund` thiếu tham chiếu | Cả hai bị CHECK từ chối; tổng số hàng trong sổ còn đúng 1 |
| C1 (sau correction) | Checksum `to_jsonb` theo hàng trên bảng `Reservations` tổng hợp 1 hàng, chạy ở một cụm PG 17.10 tạm khác (đã dừng và xóa) | Giá trị không đổi sau khi thêm cột `Source`; đổi khi dữ liệu đổi theo kiểu làm `concat_ws('|', ...)` cũ trùng (`'A|B', NULL, 'x'` so với `'A', 'B|x'` cho cùng chuỗi, đã quan sát). Chỉ trên bảng tổng hợp, không phải schema EF thật |

Probe chưa kiểm tra unique index của `ReservationUnits.SourceInventoryHoldItemId` (cùng cơ chế với T1; không chạy riêng) và chưa kiểm tra bất kỳ hành vi nào của EF Core.
