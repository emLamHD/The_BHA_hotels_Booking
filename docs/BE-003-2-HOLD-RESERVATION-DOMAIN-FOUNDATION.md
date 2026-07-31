# BE-003.2 Hold and Reservation domain foundation

## Scope

This work adds the Domain and PostgreSQL persistence foundation for
`BookingHold`, `BookingHoldNight`, `Reservation`, and `ReservationNight`. It adds
no Application command/query, controller, transport DTO, authorization policy,
guest-token transport, public booking endpoint, committed-demand calculation,
advisory lock, background worker, or frontend behavior.

BE-003.3 owns Hold creation and idempotent replay orchestration. BE-003.4 owns
atomic confirmation and concurrency. BE-003.5 owns booking reads, ownership
authorization, cancellation, and committed-demand behavior.

## Aggregate rules

A new Hold is always `Active`. Its server-controlled UTC creation instant derives
an expiry exactly 15 minutes later. `IsExpiredAt` is a pure UTC-time comparison;
an active Hold expires at the exact boundary, so no cleanup process is required
for logical correctness.

Hold states are `Active`, `Confirmed`, and `Cancelled`. Reservation states are
`Confirmed` and `Cancelled`. This foundation does not implement state
transitions.

Both aggregates capture:

- one Property, RoomType, and RatePlan;
- nullable authenticated `CustomerAccountId` or a required guest-token hash;
- trimmed contact full name, email, and phone;
- a half-open `[CheckIn, CheckOut)` stay;
- occupancy and room quantity;
- normalized uppercase currency;
- exact `decimal` total;
- immutable nightly snapshots in stable date order.

Night dates must be unique, contiguous, and cover the stay exactly once. Every
night uses the parent room count, has positive two-decimal `UnitAmount` and
`NightTotal`, and satisfies `NightTotal = UnitAmount * Rooms`. The parent total
must equal the exact sum of the nights. These cross-row coverage and sum rules
remain Domain invariants because safe row-local PostgreSQL checks cannot express
them.

Contact limits are 200 characters for full name, 256 for email, and 32 for phone.
Email requires a simple address shape. Phone accepts 7–32 common international
dialing characters and must contain a digit. Confirmation numbers are uppercase
letters, digits, and hyphens up to 32 characters; generation remains deferred.
Cancellation reasons are limited to 500 characters.

## Hash and ownership representation

`IdempotencyKeyHash`, `RequestFingerprint`, and `GuestAccessTokenHash` contain
only 64-character lowercase hexadecimal SHA-256 representations. Raw
idempotency keys and guest tokens are not fields on the aggregates and are not
persisted.

Ownership is exclusive:

- authenticated snapshot: non-null CustomerAccount ID and null guest-token hash;
- guest snapshot: null CustomerAccount ID and required guest-token hash.

Contact email never establishes ownership.

## PostgreSQL schema

Migration `20260723105404_AddBookingHoldReservationFoundation` adds four tables.
Dates use PostgreSQL `date`; instants use `timestamp with time zone`; amounts use
`numeric(18,2)`; hashes use `character(64)`; lifecycle states use bounded
strings.

Foreign keys restrict deletion of Property, RoomType, RatePlan, CustomerAccount,
and a Reservation's source Hold. Composite `(PropertyId, Id)` keys ensure that
RoomType and RatePlan belong to the same Property as the booking snapshot.
Aggregate deletion cascades only to its child nights. Lifecycle cancellation is
state, never deletion.

PostgreSQL uniquely enforces:

- `(BookingHoldId, StayDate)`;
- `(ReservationId, StayDate)`;
- Hold `IdempotencyKeyHash`;
- Reservation `SourceHoldId`;
- Reservation `ConfirmationNumber`.

The unique Hold hash is the concurrency foundation for future semantics where
the same idempotency key and fingerprint replays the same Hold, while a changed
fingerprint conflicts. No replay workflow is implemented here.

Row-local checks cover non-empty IDs, contact text, stay order, positive counts
and amounts, currency/status formats, fixed Hold lifetime, hash formats,
exclusive ownership, night multiplication, and coherent Reservation
cancellation fields.

Bounded lookup indexes are:

- Hold `(PropertyId, RoomTypeId, Status, ExpiresAtUtc)`;
- Hold night `(StayDate, BookingHoldId)`;
- Reservation `(PropertyId, RoomTypeId, Status)`;
- Reservation night `(StayDate, ReservationId)`.

These support later joined committed-demand reads without changing Availability
in this task.

## Deliberately deferred

No confirmation-number generator, Hold creation handler, idempotency middleware,
raw token generation/return, resource authorization, advisory lock, confirmation
transaction, cancellation method/use case, committed-demand query, background
expiry cleanup, payment/tax/discount/refund behavior, API route, OpenAPI booking
path, or frontend change is included.
