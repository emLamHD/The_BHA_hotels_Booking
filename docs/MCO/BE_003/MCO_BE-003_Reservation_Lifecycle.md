# MASTER CONTROL ORDER — BE-003 RESERVATION LIFECYCLE

**Control Order ID:** CT-BE-003  
**Status:** APPROVED — `BE-003.1` READY; các task sau WAITING  
**Priority:** P0  
**Repository:** `emLamHD/The_BHA_hotels_Booking`  
**Target branch:** `develop`  
**Verified baseline:** `3e4be8a2759fe0542a74a594891b43d85cdcf401`  
**Merge authority:** Hồ Đình Lâm only

## 1. Outcome

BE-003 xây dựng lifecycle đặt phòng hoàn chỉnh ở mức MVP:

1. Khách chọn offer từ Availability.
2. API tạo `BookingHold` và giữ inventory trong 15 phút.
3. Khách có thể đặt với tư cách guest hoặc customer đã đăng nhập.
4. API xác nhận riêng chuyển Hold hợp lệ thành `Reservation`; chưa cần thanh toán.
5. Hold hết hạn hoặc bị hủy sẽ giải phóng inventory.
6. Reservation bị hủy sẽ giải phóng inventory.
7. Availability trừ đúng active Hold và confirmed Reservation.
8. Idempotency và PostgreSQL concurrency protection ngăn duplicate booking và overbooking.

## 2. Baseline đã xác minh

- BE-001 và BE-002 đã hoàn thành.
- `develop` đang ở SHA `3e4be8a2759fe0542a74a594891b43d85cdcf401`.
- 134 automated tests PASS; backend/frontend CI SUCCESS.
- Availability hiện chỉ là snapshot và chưa trừ committed demand.
- Repository chưa có authentication setup, `CustomerAccount`, JWT/cookie setup hoặc current-customer abstraction.
- PostgreSQL là nguồn dữ liệu chính thức; không tích hợp PMS ngoài.
- Stack giữ nguyên: .NET 8, ASP.NET Core Web API, Clean Architecture, EF Core 8, PostgreSQL 17 và Npgsql.

## 3. Quyết định đã khóa

### 3.1 Booking flow

- Tạo Hold trước, không tạo Reservation trực tiếp.
- Hold có hiệu lực đúng 15 phút.
- Hold chiếm inventory ngay khi transaction tạo Hold commit.
- Hold hết hạn không còn được tính vào committed demand, kể cả khi chưa có background cleanup.

### 3.2 Guest và authenticated customer

- BE-003 hỗ trợ cả guest checkout và customer đã đăng nhập.
- Vì baseline chưa có authentication, `BE-003.1` phải triển khai customer identity tối thiểu trước Hold.
- Không được nhận `CustomerAccountId` hoặc `UserId` do client tự truyền để giả lập đăng nhập.
- Reservation luôn lưu contact snapshot: full name, email và phone.
- `CustomerAccountId` là nullable:
  - có giá trị khi Hold được tạo bởi authenticated customer;
  - null khi guest checkout.
- Không tự động nhận ownership của guest booking chỉ vì email trùng với account.

### 3.3 Hold confirmation

- Dùng API xác nhận riêng.
- Payment không phải điều kiện xác nhận trong BE-003.
- Xác nhận thành công tạo Reservation trạng thái `Confirmed`.
- Việc chuyển Hold → Reservation phải atomic trong một database transaction.
- Xác nhận lặp lại cùng một Hold trả về cùng Reservation, không tạo bản ghi thứ hai.
- Hold đã hết hạn hoặc đã hủy không thể xác nhận và trả `409 Conflict`.

### 3.4 Time policy

- Expiry instant dùng UTC và clock do server kiểm soát qua `TimeProvider`; không nhận thời gian từ client.
- `ExpiresAtUtc = CreatedAtUtc + 15 minutes`.
- Stay dates tiếp tục dùng `DateOnly` và half-open interval:
  `CheckIn <= StayDate < CheckOut`.
- Property timezone chỉ dùng khi cần diễn giải ngày khách sạn, ví dụ giới hạn hủy trước check-in.

### 3.5 Price snapshot

- Hold chỉ được tạo từ một offer hợp lệ gồm Property, RoomType và RatePlan.
- Hold lưu nightly price snapshot, currency và total tại thời điểm giữ phòng.
- Thay đổi rate sau đó không làm đổi giá của Hold còn hiệu lực.
- Khi xác nhận, Reservation nhận immutable nightly price snapshot từ Hold.
- Không thêm tax, surcharge, discount, currency conversion hoặc payment status trong BE-003.

### 3.6 Inventory commitment

Committed demand theo từng `(PropertyId, RoomTypeId, StayDate)`:

```text
CommittedRooms =
    active, non-expired Holds
    + confirmed, non-cancelled Reservations
```

```text
RemainingRooms =
    NightInventory từ BE-002
    - CommittedRooms
```

- Inventory dùng chung giữa các RatePlan của cùng RoomType.
- Active Hold đã chuyển thành Reservation không được đếm hai lần.
- Hold hết hạn, Hold cancelled và Reservation cancelled không được tính.
- Public Availability phải trừ committed demand trên mọi stay date.

### 3.7 Concurrency và overbooking

- Mọi thao tác làm thay đổi committed demand phải chạy trong PostgreSQL transaction.
- Trước khi kiểm tra và commit inventory, Infrastructure lấy transaction-scoped advisory locks theo từng `(PropertyId, RoomTypeId, StayDate)`.
- Lock keys phải được lấy theo thứ tự ổn định để tránh deadlock.
- Sau khi có lock, hệ thống phải đọc lại base inventory, inventory controls và committed demand; không tin snapshot Availability mà client đã thấy.
- Chỉ commit nếu mọi đêm còn đủ số phòng yêu cầu.
- Hai request cạnh tranh phòng cuối cùng phải cho kết quả: tối đa một request thành công; request còn lại trả `409 Conflict`.
- Không được dựa riêng vào application-level mutex vì API có thể chạy nhiều instance.

### 3.8 Idempotency

- `POST /api/v1/booking-holds` bắt buộc có header `Idempotency-Key`.
- Key được persist dưới dạng hash cùng request fingerprint.
- Cùng key + cùng payload trả lại Hold cũ.
- Cùng key + payload khác trả `409 Conflict`.
- `Reservation.HoldId` có unique constraint.
- Confirm/cancel là state transition idempotent; retry không tạo duplicate hoặc đảo ngược trạng thái.

### 3.9 Guest booking security

- Guest Hold trả một opaque booking access token có entropy tối thiểu 256 bit.
- Database chỉ lưu SHA-256 hash của token; raw token chỉ trả về một lần.
- Guest phải cung cấp token qua header để đọc, xác nhận hoặc hủy Hold/Reservation.
- Authenticated customer được authorize bằng account ownership.
- Không cho phép lookup hoặc mutation chỉ bằng email, confirmation number hay sequential ID.
- PII, cookie, raw guest token và idempotency key không được ghi vào log.

### 3.10 Cancellation

- Active Hold có thể bị hủy; thao tác này giải phóng inventory.
- Confirmed Reservation có thể bị hủy trước local check-in date.
- Cancellation chỉ là lifecycle transition; không xóa bản ghi.
- Cancellation lặp lại trả lại trạng thái hiện tại và không lỗi do retry.
- Không có cancellation fee, refund hoặc payment reversal trong BE-003.

## 4. Domain và persistence target

### Customer identity

- Dùng ASP.NET Core Identity Core với PostgreSQL store cho customer account tối thiểu.
- Application chỉ biết current-customer abstraction; Domain/Application không phụ thuộc ASP.NET Core Identity.
- Authenticated session dùng secure HttpOnly cookie; không trả access token để frontend lưu trong localStorage.
- Unsafe authenticated endpoints phải có CSRF protection phù hợp.
- Cookie production phải `Secure`, `HttpOnly` và có SameSite policy rõ ràng.

### BookingHold

Tối thiểu gồm:

- Id
- PropertyId
- RoomTypeId
- RatePlanId
- CustomerAccountId nullable
- Guest/contact snapshot
- CheckIn, CheckOut
- Adults, Children, Rooms
- CurrencyCode
- TotalAmount
- Status
- CreatedAtUtc
- ExpiresAtUtc
- IdempotencyKeyHash
- RequestFingerprint
- GuestAccessTokenHash nullable

### BookingHoldNight

- BookingHoldId
- StayDate
- Rooms
- UnitAmount
- NightTotal

Unique theo `(BookingHoldId, StayDate)`.

### Reservation

Tối thiểu gồm:

- Id
- ConfirmationNumber
- SourceHoldId
- PropertyId
- RoomTypeId
- RatePlanId
- CustomerAccountId nullable
- Guest/contact snapshot
- CheckIn, CheckOut
- Adults, Children, Rooms
- CurrencyCode
- TotalAmount
- Status
- ConfirmedAtUtc
- CancelledAtUtc nullable
- CancellationReason nullable
- GuestAccessTokenHash nullable

`SourceHoldId` và `ConfirmationNumber` phải unique.

### ReservationNight

- ReservationId
- StayDate
- Rooms
- UnitAmount
- NightTotal

Unique theo `(ReservationId, StayDate)`.

## 5. Public API target

### Minimal customer identity

```http
GET  /api/v1/auth/csrf
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

### Hold lifecycle

```http
POST /api/v1/booking-holds
GET  /api/v1/booking-holds/{holdId}
POST /api/v1/booking-holds/{holdId}/cancel
POST /api/v1/booking-holds/{holdId}/confirm
```

### Reservation lifecycle

```http
GET  /api/v1/reservations/{reservationId}
POST /api/v1/reservations/{reservationId}/cancel
```

### HTTP behavior

- `200/201`: thành công hoặc idempotent replay.
- `400`: invalid model/validation.
- `401`: thiếu hoặc sai authenticated session/guest token.
- `403`: principal hợp lệ nhưng không sở hữu resource.
- `404`: resource không tồn tại; không làm lộ resource của người khác.
- `409`: insufficient inventory, expired/cancelled Hold, invalid transition hoặc idempotency mismatch.
- Error responses dùng Problem Details theo convention hiện có.

## 6. Scope in

- Customer account/session tối thiểu để hỗ trợ authenticated booking.
- Guest booking ownership bằng opaque access token.
- Hold domain, persistence, migration và API.
- Hold expiry, explicit cancellation và logical release.
- Reservation confirmation, read và cancellation.
- Price/contact snapshots.
- Idempotency.
- PostgreSQL concurrency protection chống overbooking.
- Availability trừ active Hold và confirmed Reservation.
- Domain, application, persistence, API, concurrency và security tests.
- OpenAPI và tài liệu migration/API/lifecycle.

## 7. Scope out

- Customer Web hoặc Admin Web changes.
- Social login, OAuth, MFA.
- Email verification, password reset và account recovery.
- Admin/staff roles và authorization.
- Guest-booking claim/link flow.
- Payment, webhook, refund, reconciliation.
- Cancellation fee/no-show policy.
- Room-unit assignment.
- Check-in/check-out, folio, invoice.
- Housekeeping, maintenance.
- Email/SMS notification.
- PMS ngoài, OTA/channel manager.
- Mixed RoomType allocation.
- Background cleanup job; expiry logic phải đúng mà không cần job.

## 8. Sequential task ledger

Chỉ một task được `READY` hoặc `IMPLEMENTING` tại một thời điểm.

| Order | Task | Outcome | Status |
|---:|---|---|---|
| 1 | BE-003.1 — Customer booking identity foundation | Account/session tối thiểu, current customer abstraction và security baseline | **READY** |
| 2 | BE-003.2 — Hold and reservation domain foundation | Aggregates, invariants, EF mappings và migration; chưa public mutation | WAITING |
| 3 | BE-003.3 — Atomic booking hold | Idempotent Hold API, guest token, advisory locking và Availability committed demand | WAITING |
| 4 | BE-003.4 — Hold confirmation and reservation read | Atomic Hold → Reservation, confirmation number và ownership-protected read | WAITING |
| 5 | BE-003.5 — Cancellation and lifecycle hardening | Hold/Reservation cancellation, expiry edge cases, final concurrency/OpenAPI/e2e evidence | WAITING |

Không phát prompt thi công cho task sau cho đến khi task hiện tại đã merge vào `develop`, target CI xanh và baseline mới được xác minh.

---

# CONTROL ORDER — BE-003.1 CUSTOMER BOOKING IDENTITY FOUNDATION

**Status:** READY FOR PROMPT GENERATION  
**Branch:** `feature/be-003-1-customer-booking-identity`  
**Base:** latest verified `origin/develop`

## 9. BE-003.1 outcome

Tạo identity/session foundation tối thiểu để các task Hold/Reservation sau có thể phân biệt:

- anonymous guest booking;
- authenticated customer booking;
- resource owner hợp lệ.

Task này chưa tạo Hold hoặc Reservation.

## 10. BE-003.1 approved implementation constraints

- Dùng ASP.NET Core Identity Core và EF Core PostgreSQL store.
- Identity persistence thuộc Infrastructure.
- API chịu transport/authentication composition.
- Application nhận identity qua abstraction, ví dụ `ICurrentCustomer`; không phụ thuộc `HttpContext`.
- Domain không phụ thuộc Identity hoặc API.
- Primary key của customer account phải tương thích với nullable `CustomerAccountId` trong booking domain sau này.
- Email normalized unique.
- Password phải được hash bằng framework password hasher; không tự viết crypto.
- Auth dùng secure HttpOnly cookie.
- Có antiforgery mechanism cho unsafe cookie-authenticated requests.
- Auth failure không làm lộ account tồn tại hay không.
- Không log password, cookie hoặc antiforgery secret.
- Có rate limiting hợp lý cho register/login.
- Không sửa frontend.

## 11. BE-003.1 scope in

- Identity entity/store/configuration.
- EF Core migration mới; không sửa migration đã merge.
- Registration, login, logout, current-user và CSRF contract.
- Current-customer Application abstraction và API adapter.
- Cookie, antiforgery, CORS/credentials configuration cần thiết ở backend, không hard-code production origin.
- Unit/integration/security/OpenAPI tests.
- Tài liệu local-development và production cookie/Data Protection considerations.

## 12. BE-003.1 scope out

- Hold, Reservation hoặc Availability changes.
- Guest access token.
- Social login, email verification, password reset, MFA.
- Admin role/permission.
- Customer profile CRUD ngoài dữ liệu tối thiểu.
- Frontend integration.

## 13. BE-003.1 acceptance criteria

1. Customer account được persist bằng PostgreSQL 17 và email normalized unique.
2. Migration apply thành công từ database sạch cùng toàn bộ migration chain hiện tại.
3. Register tạo account hợp lệ; duplicate email trả lỗi nhất quán mà không tạo duplicate.
4. Login hợp lệ tạo secure HttpOnly session cookie.
5. Login sai trả generic authentication failure.
6. Logout invalidates session theo contract đã triển khai.
7. `/api/v1/auth/me` trả authenticated customer tối thiểu và không expose sensitive fields.
8. Anonymous `/me` trả `401`.
9. Unsafe authenticated request thiếu/sai antiforgery token bị từ chối.
10. Cookie policy có Secure/HttpOnly/SameSite rõ ràng và không hard-code production domain.
11. Application current-customer abstraction hoạt động mà không phụ thuộc `HttpContext`.
12. Register/login có rate limiting và integration tests cho success/failure path.
13. OpenAPI phản ánh auth/CSRF contract, status codes và cookie behavior.
14. Existing 134-test baseline và toàn bộ test mới PASS.
15. Release build không có warning/error mới.
16. Không có secret, password, cookie value hoặc production connection string trong diff/log/test output.
17. Không có Hold/Reservation/Availability hoặc frontend diff.

## 14. Required tests and evidence

- Domain/Application architecture tests.
- PostgreSQL integration tests cho Identity persistence và unique email.
- API integration tests cho register/login/logout/me.
- Security tests cho invalid credentials, cookie flags, antiforgery và rate limit.
- Migration apply từ database sạch.
- `dotnet ef migrations has-pending-model-changes`.
- Full solution restore/build/test.
- OpenAPI regression tests.
- Secret/scope scan và `git diff --check`.

## 15. Git and PR rules

- Fetch origin và xác minh `origin/develop` trước khi sửa.
- Nếu SHA đã drift khỏi baseline, báo SHA mới và xác minh không có xung đột với MCO trước khi tiếp tục.
- Tạo branch từ latest `origin/develop`.
- Không push trực tiếp vào `develop` hoặc `main`.
- Một task = một branch = một Draft PR target `develop`.
- Không merge.
- Không sửa hoặc xóa thay đổi ngoài scope.
- Hồ Đình Lâm là người duy nhất quyết định merge.

## 16. Stop/escalate when

Codex phải dừng và báo `BLOCKED` nếu:

- Baseline có authentication/customer identity chưa được Control Tower biết tới và xung đột với order.
- Cần chọn auth transport khác cookie hoặc cần thay đổi lớn CORS/deployment topology.
- Không thể bảo vệ unsafe cookie-authenticated endpoint khỏi CSRF.
- Migration có nguy cơ phá schema/data đã merge.
- Existing tests fail trước thay đổi vì nguyên nhân ngoài BE-003.1.
- Cần secret, production domain hoặc credential không có sẵn.
- Cần kéo social login, verification, reset password, Admin auth hoặc frontend vào task.

## 17. Completion report bắt buộc

```text
CODEX COMPLETION REPORT
Status: PASS / BLOCKED
Work item / branch / base SHA:
Outcome delivered:
Files and behavior changed:
Database/migration impact:
API/OpenAPI impact:
Authentication/cookie/CSRF design:
Tests run and exact results:
Security/secret checks:
Acceptance criteria checklist:
Commit SHA / Draft PR URL:
Deviations from scope:
Risks and deferred work:
Recommended next action:
Explicit confirmation: not merged
```

## 18. Control Tower decision

- BE-003 architecture: **APPROVED**.
- BE-003 task sequence: **APPROVED**.
- `BE-003.1`: **READY FOR OPERATIONS COORDINATOR**.
- `BE-003.2`–`BE-003.5`: **WAITING**.
- First action: Operations Coordinator đóng gói riêng `BE-003.1` thành một Codex Execution Prompt; chưa phát prompt cho task khác.
