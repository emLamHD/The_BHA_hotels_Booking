# ADR-001 — Model hotel stays with half-open date ranges

**Status:** Accepted  
**Date:** 2026-07-22

## Context

Giá và tồn phòng của khách sạn được quản lý theo đêm khách lưu trú. Nếu dùng
timestamp UTC hoặc coi checkout là một đêm, logic giá/tồn dễ bị lệch ngày theo
timezone của Property và tính thừa room-night.

Hệ thống cần một mô hình thống nhất cho domain, database, API và test.

## Decision

- Dùng `DateOnly` trong domain/application cho ngày lưu trú.
- PostgreSQL dùng kiểu `date`.
- Ngày được diễn giải theo `Property.TimeZone`.
- Khoảng lưu trú dùng nửa mở:
  `checkIn <= stayDate < checkOut`.
- `checkIn` phải trước `checkOut`.
- Checkout không được tính giá và không tiêu thụ tồn phòng.
- Không dùng UTC timestamp để biểu diễn một hotel night.
- Logic xác định ngày hiện tại phải đi qua clock/time provider có thể test.

## Consequences

### Positive

- Loại bỏ ambiguity về checkout.
- Nightly pricing và inventory dùng cùng một tập `StayDate`.
- Test một đêm/nhiều đêm rõ ràng.
- Giảm lỗi timezone và off-by-one.

### Cost

- Code phải chuyển đổi ngày hiện tại theo timezone của Property.
- API validation và seed/test phải dùng clock có thể kiểm soát.
- Mọi capability booking sau này phải giữ cùng semantics.

## Rejected alternatives

- Khoảng đóng bao gồm checkout: tính thừa một room-night.
- UTC timestamp cho hotel night: không phù hợp với ngày kinh doanh địa phương.
- Dựa trực tiếp vào clock của máy/CI: làm test phụ thuộc môi trường.
