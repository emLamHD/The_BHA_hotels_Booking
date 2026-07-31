# BE-003.5 Cancellation and lifecycle hardening

## Scope

This work closes the BE-003 MVP reservation lifecycle by adding
`GET /api/v1/booking-holds/{holdId}`, `POST
/api/v1/booking-holds/{holdId}/cancel`, and `POST
/api/v1/reservations/{reservationId}/cancel`. The Hold read endpoint was
deliberately deferred by `BE-003.3` and `BE-003.4`; it is included here so the
public lifecycle (create, read, confirm, cancel) is complete for both Holds
and Reservations.

It does not add payment, refund, fee, no-show, modification, rebooking,
reinstatement, guest-to-account claiming, lookup by confirmation
number/email/phone, notifications, a persisted `Expired` status, or
background expiry cleanup. Those remain deferred.

## Public contracts

```http
GET  /api/v1/booking-holds/{holdId}
POST /api/v1/booking-holds/{holdId}/cancel
POST /api/v1/reservations/{reservationId}/cancel
```

`GET` returns the existing customer-safe `BookingHoldDto` with nights in
ascending stay-date order; the guest-token field is always `null` on read and
is never regenerated. It does not mutate the Hold or refresh its expiry,
price, token, or snapshot, and does not require antiforgery (ASP.NET Core's
`AutoValidateAntiforgeryTokenAttribute` only validates unsafe HTTP methods).

`POST .../cancel` on a Hold accepts no business body. `Active` transitions to
`Cancelled` and returns `200` with the cancelled snapshot. A `Cancelled` Hold
retried is an idempotent replay: same `200` snapshot, no mutation, and no
inventory-lock wait. An `Active` Hold may be cancelled even at or after its
`ExpiresAtUtc`, since expiry has already released logical demand and
cancellation only records the terminal state. A `Confirmed` Hold cannot be
cancelled — its commitment now belongs to its Reservation — and returns
`409`.

`POST /api/v1/reservations/{reservationId}/cancel` accepts:

```json
{ "reason": "Required customer-supplied cancellation reason" }
```

`reason` is required, trimmed, non-blank, and limited to 500 characters (the
existing Domain/schema constraint). A `Confirmed` Reservation transitions to
`Cancelled` only while the server-derived Property-local date is strictly
earlier than `CheckIn`; at or after that local date the request returns
`409`. A `Cancelled` Reservation retried is an idempotent replay that
preserves the original `CancelledAtUtc`/`CancellationReason` even if the
retry supplies a different reason or arrives after the cutoff. Malformed
request data (missing/blank/over-length reason) returns `400` before any
credential or ownership check. Cancellation never changes confirmation
number, ownership, contact, stay, occupancy, currency, price, totals,
confirmation time, or nightly snapshots, and never deletes the Reservation or
its nights.

Both cancellation `POST` endpoints remain under the existing global
antiforgery policy (`X-CSRF-TOKEN`, obtained from `GET /api/v1/auth/csrf`).

## Ownership and disclosure

All three endpoints reuse the exact BE-003.4 credential model unchanged:
authenticated ownership from `ICurrentCustomer` and the customer cookie
session, guest ownership from the original one-time `X-Booking-Access-Token`
(strict unpadded Base64URL, exactly 32 bytes, SHA-256-hashed and compared as
a database equality predicate). Caller credentials resolve with OR
semantics — a logged-in caller may also present the correct token for a
genuinely guest-owned resource without claiming it. Email, phone,
confirmation number, source Hold ID, request body, and sequential
identifiers never establish ownership. A missing or malformed usable
credential returns `401`. A missing resource and a foreign resource return
the same non-disclosing `404`. An invalid customer cookie returns `401`
rather than being silently ignored.

A small internal `BookingCredentialResolver` (Application) and
`BookingOwnership.IsOwner` (Infrastructure) factor out this credential/
ownership logic so the three new use cases and stores do not each
independently re-derive it; the existing `BookingHoldConfirmation`/
`ReservationRead` code from BE-003.4 is unchanged.

## Domain cancellation transitions

`BookingHold.Cancel()` changes only `Active` to `Cancelled`, treats
`Cancelled` as an idempotent no-op, rejects `Confirmed`, and never evaluates
expiry or accepts client time — it is a pure state transition.

`Reservation.Cancel(reason, utcNow, propertyLocalDate)` changes only
`Confirmed` to `Cancelled`, receiving server-derived UTC time and the
server-derived Property-local date. It enforces `propertyLocalDate <
CheckIn`, normalizes/validates the reason with the existing 500-character
limit, sets `CancelledAtUtc` once, and treats `Cancelled` as an idempotent
no-op that returns before re-applying the cutoff. Both methods preserve
every other immutable field and all night snapshots; neither Domain nor
Application depends on ASP.NET Core, EF Core, Npgsql, or `HttpContext`.

## Transaction and advisory-lock contract

Every mutating request uses one explicit PostgreSQL transaction and the
established lock order: lifecycle-transition lock first, then inventory
locks for every distinct stay date in ascending order, then post-lock time
capture and final validation, then one aggregate update, then a single save
and commit.

**Hold cancellation** acquires the existing
`BookingAdvisoryLockKeys.ForHoldTransition(holdId)`, loads the Hold and
nights, and resolves ownership without disclosing a foreign resource. A
`Cancelled` replay returns before any inventory lock. For an `Active` Hold it
acquires the existing `ForInventory` keys for every night in ascending
stay-date order, then applies `Cancel()` and commits.

**Reservation cancellation** first resolves the owned Reservation (without
disclosing a foreign resource) to obtain its `SourceHoldId`, then acquires
the *same* Hold-transition lock used by Hold creation/confirmation/
cancellation for that source Hold — serializing the complete lifecycle on
one identity. It reloads the Reservation under that lock to observe any
transition a concurrent request already committed; a `Cancelled` row at that
point is a replay returned before any inventory lock. Otherwise it acquires
the existing `ForInventory` keys for every night in ascending order, captures
`utcNow` from `TimeProvider` only after every lock wait completes, loads
`Property.TimeZone` without filtering on Property/RoomType/RatePlan
activation, derives the Property-local date, and applies `Cancel(...)`
before saving and committing once.

Rollback, exception, or request cancellation at any point leaves no partial
status change, no partial cancellation fields, no altered night rows, no
leaked advisory lock, and no incorrect Availability result — verified by
dedicated forced-failure and natural-cancellation integration tests for both
cancellation paths.

## Availability and expiry invariants

The BE-003.3 committed-demand formula (`Active` Holds where `ExpiresAtUtc >
utcNow`, plus `Confirmed` Reservations) is unchanged and already yields the
correct result across cancellation: a `Cancelled` Hold or Reservation
contributes zero demand the instant its status changes, inside the same
committed transaction that releases the room(s). `AvailabilityDataSource` and
`AvailabilitySearch` were not modified. No persisted `Expired` status,
background cleanup, scheduler, or hosted service was added — an expired
`Active` Hold already stops counting at the exact expiry boundary, and
explicit cancellation of such a Hold does not double-release inventory.

## Database and migration impact

None. The six migrations delivered through `BE-003.2` already contain the
`Cancelled` status values, `CancelledAtUtc`/`CancellationReason` columns, the
cancellation consistency check constraint, and the committed-demand indexes
this work reuses unchanged. `dotnet ef migrations has-pending-model-changes`
reports no drift.

## OpenAPI

`ReservationLifecycleOperationFilter` documents all five ownership-protected
lifecycle operations (Hold read, Hold confirm, Hold cancel, Reservation
read, Reservation cancel): the optional customer-cookie security scheme, the
opaque (non-bearer) `X-Booking-Access-Token` header, `X-CSRF-TOKEN` on every
unsafe mutation, the Reservation-cancellation request-body schema and
500-character limit, and per-operation status coverage (`200`/`400`/`401`/
`404`/`409` as applicable). No real token or credential example values are
included.

## Deferred

Payment, refund, cancellation fee, no-show, modification, rebooking,
reinstatement, guest-to-account claiming, lookup/cancellation by
confirmation number or contact detail, notifications, a persisted `Expired`
status, background expiry cleanup, PMS/OTA integration, and any
Customer/Admin Web change remain explicitly out of scope for this work item.
