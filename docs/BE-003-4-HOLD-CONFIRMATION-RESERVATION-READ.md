# BE-003.4 Hold confirmation and Reservation read

## Scope

This work adds `POST /api/v1/booking-holds/{holdId}/confirm`, atomic
ownership-protected confirmation of a valid Hold into exactly one `Confirmed`
Reservation, idempotent confirmation replay by source Hold, and
`GET /api/v1/reservations/{reservationId}`, an ownership-protected Reservation
read for guests and authenticated customers.

It does not add Hold reads, Hold cancellation, Reservation cancellation,
payment behavior, a persisted `Expired` status, background expiry cleanup, or
guest-to-account claiming. Those lifecycle responsibilities remain deferred to
`BE-003.5` and later approved work items.

## Public confirmation contract

`POST /api/v1/booking-holds/{holdId}/confirm` accepts only the `holdId` route
segment and no business body. Ownership, price, currency, time, status, and
confirmation number are never accepted as client input. The global
antiforgery policy applies identically to Hold creation: callers obtain
`X-CSRF-TOKEN` from `GET /api/v1/auth/csrf` first.

An authorized, `Active`, non-expired Hold returns `201 Created` with a
`Location` pointing at the new Reservation and a customer-safe Reservation
DTO. An authorized replay of an already-confirmed Hold returns `200 OK` with
the same Reservation. Expired-at-boundary, expired, or cancelled Holds return
`409 Conflict`. A missing Hold or one the caller does not own returns
`404 Not Found` — the same response either way, so the endpoint cannot be used
as a foreign-resource existence oracle. A missing, malformed, or otherwise
unusable credential returns `401 Unauthorized`.

## Ownership and the reused guest access token

Confirmation and read share one credential-resolution policy. Authenticated
ownership comes only from `ICurrentCustomer` and the existing secure cookie
session. Guest ownership is proved with the *original* one-time token from
Hold creation (`BE-003.3`), presented through a custom header:

```http
X-Booking-Access-Token: <opaque token returned once by Hold creation>
```

The header is never treated as a bearer token, never accepted via query
string, route, cookie, or body, and OpenAPI documents it without a real
example value. `BookingAccessTokenValidator` rejects any value that is not a
strict, unpadded Base64URL encoding of exactly 32 bytes before it is ever
hashed or compared; only the lowercase SHA-256 hash is persisted, generated,
or compared, and comparison happens as a database equality predicate — never
a variable-time plaintext comparison. No confirmation flow generates,
rotates, or returns a new guest token; the hash copied onto the Reservation
is the same hash already stored on the Hold.

Ownership is exclusive per resource (`CustomerAccountId` XOR
`GuestAccessTokenHash`, enforced since `BE-003.2`), but the *caller's*
presented credentials are resolved with OR semantics: a caller may be
authenticated, present a guest token, or both. This lets a logged-in customer
confirm or read a genuinely guest-owned Hold/Reservation by presenting its
correct token without that access changing, claiming, or mutating the
resource's stored ownership fields. Email, phone, confirmation number, and
source Hold ID are never alternative authorization paths.

## Immutable snapshot copy and confirmation number

`BookingHold.Confirm(reservationId, confirmationNumber, utcNow)` is the single
Domain operation that validates the transition and builds the Reservation. It
copies every business field — ownership, contact, stay dates, occupancy,
currency, total, and all night snapshots — directly from the Hold with no
re-read of current rates, stop-sell, sellable limits, or catalog state. A
confirmed Reservation starts `Confirmed` with `ConfirmedAtUtc` set to the
post-lock server UTC instant and both cancellation fields `null`.

The confirmation number is derived one-to-one from the server-generated
128-bit Reservation ID: `ConfirmationNumberGenerator` encodes the ID's 16
bytes as an uppercase, unpadded RFC 4648 Base32 string prefixed with `BHA`
(29 characters total, within the existing 32-character/`^[A-Z0-9-]+$`
constraint). Because the encoding is a bijection over the Reservation ID,
its uniqueness tracks the existing `Reservation.Id` primary key and the
existing unique `ConfirmationNumber` index — no separate counter or
persisted idempotency column was added. The confirmation number is never
accepted as authorization for confirm, read, or any other operation.

## Transaction and advisory-lock contract

Every confirmation attempt uses one explicit PostgreSQL transaction:

1. Acquire a new transaction-scoped Hold-transition advisory lock,
   `thebha:booking:hold-transition:v1:<lowercase Hold UUID>`, derived with the
   same SHA-256-to-`int64` algorithm as the existing `BE-003.3` lock keys.
2. Load the Hold and its nights; resolve ownership without disclosing whether
   a foreign resource exists.
3. Look up an existing Reservation by `SourceHoldId`. If found, this is an
   authorized replay: return it immediately without touching any inventory
   lock.
4. If the Hold is not `Active`, return `409` without an inventory-lock wait.
5. Otherwise acquire the exact `BE-003.3` inventory advisory locks
   (`BookingAdvisoryLockKeys.ForInventory`) for every distinct
   `(PropertyId, RoomTypeId, StayDate)`, in ascending stay-date order — the
   same keys and ordering `BookingHoldCreationStore` uses, so a concurrent new
   Hold creation for the same night correctly serializes against this
   confirmation.
6. Capture `utcNow` from `TimeProvider` only after every lock wait completes,
   then call `hold.Confirm(...)`. Expiry is therefore always evaluated against
   how long the transaction actually had to wait, not when the request
   arrived.
7. Insert the Reservation and its nights, update the Hold's status, and commit
   once.

A defensive `DbUpdateException` catch on the unique `SourceHoldId` constraint
resolves to the same replay path rather than surfacing a raw database error;
the advisory lock is expected to prevent this race in practice, and the catch
exists only as final defense-in-depth, matching the equivalent idempotency
safeguard in `BookingHoldCreationStore`. Rollback, exception, or request
cancellation leaves no partial Reservation, no partial night rows, no
incorrect Hold status, and no lingering transaction-scoped lock.

## Availability committed-demand invariance

No change was made to `AvailabilityDataSource` or `AvailabilitySearch`. The
`BE-003.3` formula (`Active Holds where ExpiresAtUtc > utcNow` plus
`Confirmed Reservations`) already yields identical committed demand
immediately before and immediately after a successful confirmation: the
source Hold's demand disappears from the formula the instant its status
leaves `Active`, exactly as the new Reservation's equal demand appears under
`Confirmed`, inside the same committed transaction. Confirmed source Holds
and their Reservations are never double-counted.

## Reservation read

`GET /api/v1/reservations/{reservationId}` applies the same
credential-resolution policy as confirmation, then `ReservationReadStore`
applies OR-ownership filtering directly inside one bounded, `AsNoTracking`
query (`Id` match plus `CustomerAccountId` or `GuestAccessTokenHash` match),
with nights returned in stable ascending stay-date order. No cancellation
fields are populated yet since Reservation cancellation is out of scope, but
the response DTO already carries `CancelledAtUtc`/`CancellationReason` so
`BE-003.5` can populate them without a read-contract change. GET does not
require antiforgery.

## Database and migration impact

No migration and no EF Core model-snapshot change. `Reservation` and
`ReservationNight` already existed with every constraint this work relies on
— the unique `SourceHoldId` and `ConfirmationNumber` indexes, the exclusive
ownership check, the `Confirmed`/`Cancelled` status check, and the night
uniqueness/amount checks — all delivered by `BE-003.2`'s persistence
foundation and reused unchanged.
