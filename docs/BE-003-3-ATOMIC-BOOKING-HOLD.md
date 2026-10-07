# BE-003.3 Atomic booking Hold

## Scope

This work adds `POST /api/v1/booking-holds`, atomic server-priced Hold creation,
idempotent replay, one-time guest access-token generation, PostgreSQL
transaction-scoped advisory locking, and booking committed-demand subtraction
in public Availability.

It does not add Hold reads, confirmation, cancellation, Reservation APIs,
guest-token authorization, payment behavior, or background expiry cleanup.
Those lifecycle responsibilities remain deferred to later approved work items.

## Public creation contract

Both guests and authenticated customers call `POST /api/v1/booking-holds`.
The global antiforgery policy applies: callers first obtain the cookie and
request token from `GET /api/v1/auth/csrf`, then send `X-CSRF-TOKEN`.
`Idempotency-Key` is mandatory, case-sensitive, cannot be blank or contain
control characters, and is limited to 256 UTF-8 bytes.

The request contains only Property, RoomType, RatePlan, half-open stay,
occupancy, room quantity, and contact selections. Ownership, price, currency,
inventory, server time, expiry, and token values are never accepted as
authoritative client input.

New Holds return `201 Created`; matching replays return `200 OK`. Validation
uses `400`, missing active selections use `404`, and changed idempotent requests,
incomplete pricing, stop-sell, or insufficient inventory use `409`. Errors use
Problem Details. No `Location` is emitted because no Hold read endpoint exists.

## Idempotency and fingerprint

Only the lowercase SHA-256 hash of the raw idempotency key is persisted. The
versioned `thebha-booking-hold-request:v1` fingerprint uses length-prefixed,
strict UTF-8 fields in a fixed order:

- Property, RoomType, and RatePlan UUIDs;
- ISO check-in and check-out dates;
- adults, children, and rooms using invariant decimal text;
- Domain-equivalent trimmed full name, email, and phone;
- `guest` or the authenticated customer UUID.

It deliberately excludes the raw key, current time, generated identifiers,
guest token, price, and inventory. A matching hash and fingerprint returns the
persisted immutable Hold without refreshing expiry or price. A changed
fingerprint returns `409`.

An idempotency advisory lock serializes same-key attempts before the unique
idempotency-hash index acts as the final database safeguard.

## Ownership and one-time guest token

Authenticated ownership comes only from `ICurrentCustomer` and is revalidated
against the customer store. Authenticated Holds persist the customer UUID and no
guest-token hash.

Guest creation uses 32 cryptographically random bytes encoded as unpadded
Base64URL. Only its lowercase SHA-256 hash is persisted. The raw token appears
only in the initial successful guest `201` response. It is absent from replay
and from every authenticated response and cannot be recovered from storage.
Losing this one-time token prevents later guest access; changing that security
contract requires a future explicit decision.

Token generation occurs only inside the Infrastructure new-creation path, after
the transaction holds the idempotency advisory lock, replay checks find no
existing Hold, and the locked offer revalidation succeeds. Sequential and
concurrent replays therefore never invoke the token generator.

## Transaction and advisory-lock contract

Every new Hold uses one explicit PostgreSQL transaction. Lock keys are stable
across processes and cultures:

1. Construct the UTF-8 text using the applicable namespace:
   `thebha:booking:idempotency:v1:` plus the idempotency hash, or
   `thebha:booking:inventory:v1:` plus lowercase canonical Property UUID,
   RoomType UUID, and ISO stay date separated by colons.
2. Compute SHA-256.
3. Interpret the first eight digest bytes as a signed, big-endian `int64`.
4. Pass that value as a parameter to `pg_advisory_xact_lock`.

The idempotency namespace is separate from inventory. Inventory locks cover
every `(PropertyId, RoomTypeId, StayDate)`, remove date duplication by
construction, and are acquired in ascending stay-date order. Hash collisions
can only add serialization; they cannot weaken correctness.

After all inventory locks, the transaction rechecks idempotency and re-reads the
active selections, Property timezone, complete nightly rates, active physical
rooms, daily controls, and committed demand. It creates the aggregate and all
night snapshots, saves once, and commits once. Failed work rolls back without a
partial Hold or mutable inventory counter.

## Availability committed demand

Public Availability now evaluates one server UTC instant and subtracts:

```text
Active Holds where ExpiresAtUtc > utcNow
+ Confirmed Reservations
```

from controlled inventory for each Property, RoomType, and stay date. Demand is
shared across RatePlans. Confirmed or cancelled Holds do not count; expired
Holds stop counting exactly at the expiry boundary; cancelled Reservations do
not count. A confirmed source Hold and its confirmed Reservation are therefore
not double-counted. Remaining public inventory is clamped at zero.

The read remains bounded: committed Hold and Reservation demand each add one
set-based query, independent of candidate count and stay length.

## Database impact

No migration or model-snapshot change is required. This workflow reuses all six
merged migrations, the unique Hold idempotency-hash index, booking demand
indexes, ownership constraints, and immutable night tables delivered by
BE-003.2.
