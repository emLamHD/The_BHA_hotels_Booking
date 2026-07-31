# CODEX EXECUTION PROMPT — BE-003.4 HOLD CONFIRMATION AND RESERVATION READ

## Role and authority

You are the implementation agent for **The BHA Hotels** backend.

- Work item: `BE-003.4 — Hold confirmation and reservation read`
- Control Order: `CT-BE-003`
- Repository: `emLamHD/The_BHA_hotels_Booking`
- Target branch: `develop`
- Working branch: `feature/be-003-4-hold-confirmation-reservation-read`
- Verified `origin/develop` baseline: `927a4113b90465df75e08a2415e9fa8d1c4ac3a5`
- Baseline source: squash-merge commit of PR #11, `BE-003.3`
- Merge authority: **Hồ Đình Lâm only**
- You may create commits, push the working branch, and open a **Draft PR** targeting `develop`.
- You must **not merge** the PR and must not push directly to `develop` or `main`.

Implement only `BE-003.4`. This task adds:

1. ownership-protected atomic confirmation of a valid `BookingHold`;
2. creation of exactly one `Confirmed` `Reservation` from the immutable Hold snapshot;
3. deterministic, collision-safe confirmation-number generation;
4. idempotent confirmation replay by source Hold;
5. ownership-protected Reservation read for guests and authenticated customers.

`BE-003.5` remains out of scope and must not be started. In particular, do not add Hold cancellation, Reservation cancellation, Hold read, payment, background cleanup, or frontend behavior.

## Required startup sequence

1. Read and obey repository governance and project-context files, if present, in this order:
   1. `RULES.md`
   2. `PROJECT_BIBLE.md`
   3. `SNAPSHOT.md`
   4. the current daily plan/worklog relevant to BE-003
   5. every applicable `AGENTS.md`
2. Inspect the current repository rather than assuming paths or conventions. Pay particular attention to:
   - `BookingHold`, `BookingHoldNight`, `BookingHoldStatus`, `Reservation`, `ReservationNight`, `ReservationStatus`, `BookingNightSnapshot`, and the current Domain guards;
   - `BookingHoldConfiguration`, `ReservationConfiguration`, their unique constraints, ownership constraints, restrictive relationships, demand indexes, and the six merged migrations;
   - `BookingHoldCreation`, `BookingHoldCreationStore`, `BookingAdvisoryLockKeys`, the documented lock-key algorithm, and the remediation that generates guest tokens only in the new-Hold path;
   - `AvailabilitySearch` and `AvailabilityDataSource`, especially the exact committed-demand formula already delivered by `BE-003.3`;
   - `ICurrentCustomer`, cookie authentication, invalid-cookie handling, global antiforgery, CORS allowed headers, Problem Details, and OpenAPI conventions;
   - the PostgreSQL integration-test factory, fixed `TimeProvider`, separate-scope concurrency tests, and existing test timeout conventions;
   - `docs/BE-003-2-HOLD-RESERVATION-DOMAIN-FOUNDATION.md` and `docs/BE-003-3-ATOMIC-BOOKING-HOLD.md`.
3. Run read-only Git checks:
   - `git status --short`;
   - current branch and HEAD SHA;
   - configured remotes.
4. Fetch `origin`, resolve the latest `origin/develop` SHA, and compare it with the verified baseline above.
5. If `origin/develop` has advanced:
   - inspect every intervening commit and relevant diff;
   - continue only if the new baseline does not conflict with this order;
   - record the actual base SHA in the completion report.
6. Before editing, run the repository-native backend restore, Release build, and complete automated-test baseline.
7. The verified post-`BE-003.3` reference is:
   - six applied migrations;
   - **267 passing tests**: 131 unit/domain/Application/architecture and 136 PostgreSQL integration tests;
   - 0 failed and 0 skipped;
   - Release build with 0 warnings and 0 errors;
   - backend and frontend GitHub Actions green on PR #11.
8. If the actual baseline fails for a reason outside this task, or overlapping user changes cannot be preserved safely, stop and report `BLOCKED`.
9. Create the working branch from the verified latest `origin/develop`. Do not reuse a stale branch.

Do not assume exact namespaces or implementation type names. Discover and follow the repository. Do not replace a repository convention merely to match an illustrative name in this prompt.

## Outcome

Deliver this public lifecycle:

```http
POST /api/v1/booking-holds/{holdId}/confirm
GET  /api/v1/reservations/{reservationId}
```

### Initial confirmation

For an authorized, `Active`, non-expired Hold:

1. Start one explicit PostgreSQL transaction.
2. Serialize lifecycle work for the source Hold.
3. Acquire the existing inventory advisory-lock identities for every Hold night in stable ascending date order.
4. Re-read the Hold and any Reservation with that `SourceHoldId` inside the transaction.
5. Capture one server UTC instant through `TimeProvider` after required locks are held.
6. Reject an active Hold at or after `ExpiresAtUtc`.
7. Create one `Reservation` with status `Confirmed`.
8. Copy the complete immutable booking snapshot from the Hold.
9. Transition the Hold to `Confirmed`.
10. Persist the Hold transition, Reservation, and Reservation nights atomically.
11. Commit once.
12. Return `201 Created`, the customer-safe Reservation DTO, and a `Location` for the Reservation read endpoint.

### Idempotent replay

For the same authorized Hold after a Reservation already exists:

- return that exact Reservation;
- return `200 OK`;
- do not create another Reservation or night row;
- do not change `ConfirmedAtUtc`;
- do not generate another confirmation number;
- do not reprice;
- do not refresh the Hold;
- do not generate, rotate, return, or persist a new guest token;
- do not require a separate confirmation idempotency key.

Confirmation idempotency is keyed by the immutable source `holdId` and protected by:

- transaction serialization for the Hold transition;
- the existing unique `Reservation.SourceHoldId` database constraint;
- the existing unique `Reservation.ConfirmationNumber` constraint;
- replay lookup by `SourceHoldId`.

Do **not** add another persisted idempotency-key field, request fingerprint, migration, or mutable confirmation counter.

## Public API contract

### Confirm Hold

```http
POST /api/v1/booking-holds/{holdId}/confirm
```

- The route contains only `holdId`.
- The request has no business body.
- Do not accept contact, owner ID, guest-token hash, price, currency, totals, dates, rooms, status, current time, expiry, confirmation number, or Reservation ID from the client.
- Do not require `Idempotency-Key`; the source Hold is the idempotency identity.
- The existing global antiforgery policy applies to this unsafe POST for both guest and cookie-authenticated callers.
- A guest supplies the original one-time raw booking credential through one explicit custom header. Use a clear contract such as:

  ```http
  X-Booking-Access-Token: <opaque token returned by Hold creation>
  ```

  If the repository has already established an equivalent canonical name, reuse it. Do not use query strings, route segments, cookies, request bodies, email, or confirmation number to transport guest authorization.
- An authenticated customer is resolved only through `ICurrentCustomer` and the existing secure cookie session.
- Do not add bearer JWT authentication.

Response behavior:

- `201 Created`: this request performed the first successful Hold → Reservation transition.
- `200 OK`: authorized idempotent replay returning the already-created Reservation.
- `400 Bad Request`: structurally invalid route/header input under existing API conventions.
- `401 Unauthorized`: no usable credential, malformed guest credential, or an invalid presented customer session.
- `404 Not Found`: source resource is absent or must be hidden because ownership cannot be established. Do not turn the endpoint into a resource-existence oracle.
- `409 Conflict`: Hold exists and is authorized but is expired, cancelled, or in another invalid lifecycle transition.
- Error responses use the repository’s Problem Details convention.

The response must never include `CustomerAccountId`, guest-token hash, raw guest token, idempotency hash, request fingerprint, lock key, database key material, or internal demand data.

### Read Reservation

```http
GET /api/v1/reservations/{reservationId}
```

- Authenticated ownership is resolved from the existing cookie session.
- Guest ownership is proved with the same original `X-Booking-Access-Token` value whose hash was copied from the source Hold to the Reservation.
- Do not create a new guest token for Reservation access.
- Do not allow lookup or access by email, phone, confirmation number, source Hold ID, sequential value, or contact match.
- A valid logged-in account does not automatically own a guest Reservation because its email matches.
- An authenticated Reservation cannot be accessed through an unrelated guest token.
- A caller who is logged in may still present the correct guest token for a genuinely guest-owned Reservation; this proves guest ownership but must not claim or mutate account ownership.
- If an invalid customer cookie is presented, preserve the existing invalid-session behavior rather than silently falling back to a guest credential.
- `200 OK`: authorized read.
- `401 Unauthorized`: no usable credential, malformed guest credential, or invalid presented session.
- `404 Not Found`: Reservation is absent or hidden because the caller does not own it.
- GET is safe and does not require antiforgery validation.

The read DTO may expose only owner-safe booking information required by the lifecycle, including:

- Reservation ID;
- confirmation number;
- status;
- Property, RoomType, and RatePlan IDs;
- contact snapshot;
- half-open stay;
- occupancy and room quantity;
- currency and total;
- `ConfirmedAtUtc`;
- cancellation fields already represented by the Domain, if applicable to persisted data;
- ordered nightly snapshots.

It must not expose ownership IDs/hashes, raw credentials, Hold idempotency data, lock data, or internal inventory data.

### Credential and disclosure policy

Implement one consistent policy across confirmation and read:

1. Validate the shape and bounded size of a presented guest token before hashing.
2. The BE-003.3 token is 32 random bytes encoded as unpadded Base64URL. Reject malformed encoding and decoded lengths other than 32 bytes.
3. Persist and compare only its lowercase SHA-256 hash.
4. Never log the raw header, its hash, contact PII, cookie values, or authorization query parameters.
5. Use database equality or a fixed-time comparison for fixed-size hashes; do not introduce a variable-time plaintext-secret comparison.
6. Do not reveal whether a foreign booking ID exists through different detail strings, DTO shapes, timing shortcuts, or status behavior.
7. `403` must not be used in a way that creates a foreign-resource existence oracle. Follow a stricter existing repository convention if one is already tested.

OpenAPI must document the custom guest header without representing it as a bearer token and without embedding a real example token.

## Ownership rules

Ownership is immutable and exclusive:

- authenticated Hold/Reservation:
  - non-null `CustomerAccountId`;
  - null `GuestAccessTokenHash`;
- guest Hold/Reservation:
  - null `CustomerAccountId`;
  - non-null `GuestAccessTokenHash`.

Confirmation must copy the ownership fields exactly from the source Hold:

- never accept `CustomerAccountId` from the request;
- never infer account ownership by matching email;
- never convert a guest Hold into an authenticated Reservation;
- never convert an authenticated Hold into a guest Reservation;
- never rotate or regenerate guest-token material;
- never return raw token material from confirmation or read.

Authorization must occur before returning any booking DTO or lifecycle detail. An authorized replay must still prove ownership; the unique `SourceHoldId` is not itself authorization.

## Immutable snapshot-copy contract

The Reservation is a server-created immutable snapshot of the source Hold. Copy exactly:

- `SourceHoldId = BookingHold.Id`;
- `PropertyId`;
- `RoomTypeId`;
- `RatePlanId`;
- `CustomerAccountId`;
- `GuestAccessTokenHash`;
- full name;
- email;
- phone;
- `CheckIn`;
- `CheckOut`;
- adults;
- children;
- rooms;
- currency code;
- total amount;
- every ordered night:
  - stay date;
  - rooms;
  - unit amount;
  - night total.

Set only server-owned confirmation fields:

- new server-generated Reservation ID;
- new server-generated confirmation number;
- `Status = Confirmed`;
- `ConfirmedAtUtc = TimeProvider` UTC instant;
- `CancelledAtUtc = null`;
- `CancellationReason = null`.

Do not:

- re-read current nightly rates;
- reprice the Hold;
- replace contact data;
- revalidate current RatePlan pricing completeness;
- substitute a current currency;
- alter occupancy or rooms;
- use Availability output as authority;
- require current stop-sell or current sellable-limit capacity as though this were a new Hold;
- change totals because catalog/rate/inventory data changed after Hold creation.

An active Hold already owns committed demand. Confirmation is an atomic representation swap:

```text
before commit:
    Active non-expired Hold demand = Rooms
    Reservation demand             = 0

after commit:
    Confirmed Hold demand           = 0
    Confirmed Reservation demand    = Rooms
```

The total committed demand for every night must remain unchanged by successful confirmation.

## Domain lifecycle behavior

Add the smallest Domain behavior required to make the transition valid without exposing public setters or manipulating EF state through reflection.

Required semantics:

- a new Hold remains `Active`;
- `Active` and `utcNow < ExpiresAtUtc` may transition once to `Confirmed`;
- `Active` and `utcNow >= ExpiresAtUtc` cannot confirm;
- `Cancelled` cannot confirm;
- `Confirmed` is an idempotent terminal result for confirmation and cannot be reversed;
- all instants must be UTC;
- the exact expiry boundary is invalid for a new confirmation.

The Domain may expose a focused transition method/result and/or a Domain-owned Reservation factory if that best fits the current design. Keep:

- Domain independent of EF Core, Npgsql, ASP.NET Core, `HttpContext`, controllers, and transport DTOs;
- invariant enforcement inside Domain;
- mapping to public DTOs outside Domain;
- cancellation behavior out of this task.

Do not add an `Expired` persisted state merely for logical expiry. Do not add confirmation timestamps to `BookingHold`; the approved schema does not contain one.

## Confirmation-number contract

Generate a confirmation number entirely on the server.

Requirements:

- uppercase only;
- matches the existing database/Domain format: letters, digits, and optional hyphens;
- maximum 32 characters;
- culture-invariant;
- not sequential or guessably derived from a database sequence;
- at least 128 bits of server-generated uniqueness;
- never accepted from the client;
- unique under the existing database constraint;
- stable on replay;
- not an authorization credential and never sufficient for lookup, confirm, read, or cancellation.

Prefer the smallest design that cannot leave a PostgreSQL transaction aborted merely to handle a normal collision path. A strong option is:

1. generate one 128-bit Reservation ID on the server;
2. encode the complete 128 bits deterministically with an uppercase fixed alphabet;
3. derive the confirmation number one-to-one from that same ID within the 32-character limit.

This makes confirmation-number uniqueness track the Reservation primary-key uniqueness without a separate counter. If another repository-consistent cryptographic generator is used, collision handling must be bounded, tested, and transaction-safe. Do not weaken or remove the unique constraint.

## PostgreSQL transaction and locking contract

Every confirmation attempt that may transition state uses one explicit PostgreSQL transaction.

### Required serialization

Serialize concurrent lifecycle transitions for the same Hold using a database-wide mechanism, not an in-process lock. Use a stable transaction-scoped advisory-lock namespace such as:

```text
thebha:booking:hold-transition:v1:<lowercase canonical Hold UUID>
```

Derive the `int64` key with the exact existing BE-003.3 algorithm:

1. strict UTF-8 namespace text;
2. SHA-256;
3. first eight digest bytes;
4. signed big-endian `int64`;
5. parameterized `pg_advisory_xact_lock`.

Then acquire the existing inventory locks for every distinct:

```text
(PropertyId, RoomTypeId, StayDate)
```

using `BookingAdvisoryLockKeys.ForInventory` or its safely refactored equivalent. Acquire:

1. one Hold-transition lock;
2. inventory locks in ascending `StayDate` and stable key order.

Do not create a second incompatible inventory-lock algorithm. Any narrow refactor to share the existing lock-key code must preserve byte-for-byte key identities used by `BE-003.3` and its tests.

### Work under locks

Inside the same transaction:

1. Acquire the Hold-transition lock.
2. Load the source Hold with its ordered nights.
3. Establish authorization without exposing foreign resource details.
4. Check for an existing Reservation by `SourceHoldId`.
5. If a Reservation exists:
   - verify that its ownership and complete immutable snapshot are coherent with the Hold;
   - return it as replay;
   - do not mutate either aggregate.
6. For a first transition, acquire all inventory locks in stable order.
7. Re-read the tracked Hold and existing Reservation after locks as needed to avoid stale state.
8. Capture `utcNow` through `TimeProvider` after lock waits complete.
9. If the Hold is still `Active`, require `utcNow < ExpiresAtUtc`.
10. If it is `Cancelled`, return `409`.
11. Create the Reservation from the Hold snapshot.
12. Transition the Hold to `Confirmed`.
13. Save the Hold status, Reservation, and all Reservation nights.
14. Commit once.

Concurrent same-Hold confirmations from separate API instances/connections must converge to:

- exactly one Reservation;
- exactly one Reservation-night set;
- one initial success and authorized replay response(s);
- no leaked PostgreSQL unique violation;
- no changed confirmation number or timestamp on replay.

The unique `SourceHoldId` and confirmation-number indexes remain final database safeguards. Handle a defensive unique-conflict race only by resolving the already-persisted Reservation and verifying it belongs to the same Hold; never reinterpret an unrelated unique conflict as success.

Use cancellation tokens throughout. Rollback, exception, request cancellation, or failed authorization must leave no partial Reservation, no partial night rows, no incorrect Hold status, and no lingering transaction-scoped lock.

## Expiry and concurrency semantics

Use server UTC only.

- `ExpiresAtUtc = CreatedAtUtc + 15 minutes` remains immutable.
- A Hold is confirmable only when `utcNow < ExpiresAtUtc`.
- At `utcNow == ExpiresAtUtc`, confirmation returns `409`.
- Waiting for a lock does not preserve an earlier right to confirm. Capture/check time after the necessary lock wait.
- A previously confirmed Hold replays its Reservation even if the original expiry instant is now in the past.
- An expired `Active` Hold stays logically expired; do not add a cleanup mutation or new status in this task.

Confirmation must coordinate correctly with Hold creation:

- if confirmation converts an active Hold before expiry under the shared inventory locks, a competing Hold creation sees confirmed Reservation demand and cannot take the same last room;
- if another operation obtains the inventory lock after the Hold has logically expired and commits new demand first, a delayed confirmation must re-check time and fail;
- successful confirmation must not create a moment, visible after commit, where neither the Hold nor Reservation counts as committed demand;
- successful confirmation must not double-count the Hold and Reservation.

Do not use only `lock`, mutex, semaphore, cache, or application-instance coordination.

## Reservation read implementation

Implement a bounded, no-N+1 query for one Reservation and its nights.

- Query by `reservationId`, never by confirmation number or contact.
- Return nights in stable ascending `StayDate`.
- Apply ownership in the query or before mapping so a foreign aggregate is never returned.
- Use no tracking for the read path unless the repository has a documented reason otherwise.
- Do not return an EF entity across the Infrastructure/Application boundary.
- Do not expose raw ownership values.
- Preserve cancellation-shaped fields already in the aggregate/DTO so `BE-003.5` can transition state without redesigning the read contract, but do not implement cancellation now.

If one transport-neutral Reservation DTO can be safely shared between confirmation and read, prefer that to two drifting schemas.

## Application, Infrastructure, and API boundaries

- Domain owns lifecycle invariants and immutable snapshot validity.
- Application owns transport-neutral command/query/result contracts, guest-token shape/hash validation, current-customer consumption, and customer-safe DTOs.
- Application must not depend on `HttpContext`, controllers, EF Core, Npgsql, or raw SQL.
- API owns:
  - route and header binding;
  - invalid-cookie/session transport behavior;
  - antiforgery composition;
  - status-code, `Location`, and Problem Details mapping;
  - OpenAPI metadata.
- Infrastructure owns:
  - EF Core queries and persistence;
  - explicit PostgreSQL transaction;
  - transition and inventory advisory-lock acquisition;
  - atomic Hold status update plus Reservation insertion;
  - bounded ownership-protected Reservation reads;
  - defensive database uniqueness resolution.
- Do not return tracked EF entities across layer boundaries.
- Follow existing service-registration style.
- Do not add a generic repository, unit-of-work framework, mediator framework, AutoMapper, or speculative lifecycle engine.

## Availability invariants

Do not redesign Availability in this task.

The existing BE-003.3 formula remains:

```text
CommittedRooms =
    Active Holds where ExpiresAtUtc > utcNow
    + Confirmed Reservations
```

Successful confirmation must leave Availability unchanged for every affected night:

- immediately before confirmation, the active Hold contributes demand;
- immediately after confirmation, the confirmed Reservation contributes the same demand;
- the confirmed source Hold contributes zero;
- no double count;
- no temporary state is externally visible because the transition commits atomically.

Add regression coverage proving identical public availability before and after successful confirmation with a fixed clock. Preserve:

- shared demand across RatePlans;
- half-open stay dates;
- exact expiry boundary;
- Property/RoomType/date isolation;
- stable offer ordering;
- complete pricing rules;
- stop-sell and sellable-limit behavior;
- bounded query count;
- customer-safe response.

Do not add a mutable booked-room counter or decrement PhysicalRoom/inventory-control rows.

## Database and migration requirements

- PostgreSQL 17 remains the only persistence target.
- Do not add EF InMemory or SQLite.
- Reuse the six merged migrations unchanged.
- Add **no migration** and make **no model-snapshot change**.
- Do not edit, rename, regenerate, squash, or reorder merged migrations.
- Do not add a seventh migration.
- Do not apply migrations automatically during API startup.
- Do not add Hold/Reservation rows to Development seed.
- Preserve all existing unique, check, FK, and demand-support indexes.
- Preserve restrictive deletion behavior and cascade only from aggregate to its night rows.
- SQL for advisory locks must be parameterized.
- Do not interpolate raw guest tokens, hashes, contact PII, cookie/session material, UUIDs, or dates into executable SQL text.

The current schema was deliberately prepared for this task:

- unique `Reservation.SourceHoldId`;
- unique `Reservation.ConfirmationNumber`;
- exclusive guest/account ownership checks;
- restrictive Hold → Reservation relationship;
- exact Reservation-night uniqueness;
- existing committed-demand indexes.

If a migration or model-snapshot change appears necessary, stop and report `BLOCKED` with the exact missing safeguard rather than changing the approved schema.

## Strict scope in

- `POST /api/v1/booking-holds/{holdId}/confirm`.
- `GET /api/v1/reservations/{reservationId}`.
- Transport-neutral confirmation and Reservation-read contracts.
- Customer-safe Reservation DTO and ordered nightly DTOs.
- Guest access-token header parsing, strict validation, SHA-256 hashing, and ownership checks.
- Authenticated ownership through `ICurrentCustomer`.
- Domain Hold-confirmation transition behavior.
- Server-generated Reservation ID and confirmation number.
- Atomic immutable Hold → Reservation snapshot copy.
- PostgreSQL Hold-transition and existing inventory advisory locks.
- Idempotent confirmation replay by source Hold.
- Problem Details, antiforgery, CORS-header compatibility, and OpenAPI documentation required by these endpoints.
- Domain/Application/API/PostgreSQL/concurrency/security/OpenAPI/Availability regression tests for this task.
- Narrow documentation for confirmation, ownership, confirmation number, locking, snapshot copy, replay, Reservation read, and deferred cancellation.

## Strict scope out

- `GET /api/v1/booking-holds/{holdId}`.
- `POST /api/v1/booking-holds/{holdId}/cancel`.
- `POST /api/v1/reservations/{reservationId}/cancel`.
- Any Hold or Reservation cancellation transition.
- New `Expired` persisted status or background expiry cleanup.
- Guest-booking claim/link or ownership conversion.
- Lookup/read by confirmation number, email, phone, or contact details.
- Generating, rotating, recovering, or returning another raw guest token.
- A second confirmation idempotency key/fingerprint or persistence column.
- Repricing, new pricing fallback, or current-rate replacement.
- Requiring payment for confirmation.
- Payment, tax, surcharge, discount, currency conversion, refund, webhook, reconciliation, or payment status.
- Mutable inventory counters.
- Customer Identity redesign, JWT, social login, verification, recovery, MFA, roles, or Admin auth.
- New booking rate-limit/business-quota policy.
- Frontend changes.
- PMS, OTA, notifications, housekeeping, room assignment, check-in/out, folio, or invoice work.
- Broad refactors, distributed cache/locks, queues, or speculative abstractions.

## Required tests

Follow existing repository conventions. Use real PostgreSQL 17 for persistence, ownership, transaction, and concurrency behavior.

### Domain/unit/Application tests

Cover at least:

- Active Hold confirms immediately before expiry;
- Active Hold conflicts exactly at expiry;
- Active Hold conflicts after expiry;
- Cancelled Hold cannot confirm;
- Confirmed Hold produces idempotent confirmation semantics and cannot revert;
- non-UTC transition time is rejected;
- Reservation factory/copy includes every ownership, contact, stay, occupancy, currency, amount, and night field exactly;
- Reservation starts `Confirmed` with null cancellation fields;
- confirmation number format, length, uppercase behavior, culture invariance, and full entropy representation;
- confirmation number is stable for one Reservation identity and changes for different identities;
- guest token strict Base64URL shape and decoded 32-byte length;
- malformed, padded, control-character, oversized, and wrong-length guest tokens are rejected before store work;
- guest token hash is deterministic lowercase SHA-256 and raw token is absent from persistence contracts;
- authenticated current-customer ownership cannot be supplied or replaced by client data;
- response DTO does not expose customer ID, token hash, raw token, Hold idempotency hash/fingerprint, or lock internals;
- cancellation-token propagation.

### Confirmation API/PostgreSQL integration tests

Cover at least:

- guest Hold confirms with its original token and returns `201`;
- persisted guest Reservation contains the same guest-token hash and no account ID;
- raw guest token is not present in the confirmation response, database, logs, or Problem Details;
- authenticated Hold confirms only for the server-resolved owner and persists no guest-token hash;
- confirmation copies exact contact, stay, occupancy, currency, total, and ordered nights;
- changing rates, stop-sell, sellable limit, catalog activity, or Property data after Hold creation does not reprice or mutate the valid Hold snapshot;
- current inventory is not decremented or mutated;
- initial confirmation sets one server UTC `ConfirmedAtUtc`, `Confirmed` status, and null cancellation fields;
- confirmation number satisfies format/length/uniqueness and is not accepted from request data;
- successful confirmation updates Hold status and inserts Reservation/nights in one commit;
- forced failure before commit leaves Hold `Active` and inserts no Reservation/night;
- authorized sequential replay returns `200`, same Reservation ID, confirmation number, `ConfirmedAtUtc`, totals, and nights;
- replay works after the original Hold expiry instant because the Hold was already confirmed;
- expired active Hold immediately before transition returns `409` and creates no Reservation;
- exact expiry boundary returns `409`;
- cancelled Hold returns `409`;
- missing Hold and foreign-owned Hold do not leak existence;
- missing/malformed/wrong guest token and invalid customer session follow the approved disclosure policy;
- a correct guest token does not authorize an authenticated Hold;
- a foreign account does not authorize another account’s Hold;
- email/contact equality never grants ownership;
- POST confirmation rejects missing/invalid antiforgery token for guest and authenticated flows;
- no confirmation endpoint accepts business body fields or `CustomerAccountId`;
- existing unique `SourceHoldId` and confirmation-number constraints remain effective.

### Mandatory confirmation concurrency tests

Use separate scopes, DbContexts/connections, real concurrent tasks, and bounded timeouts.

Cover at least:

1. **Concurrent same-Hold confirmation**
   - two authorized requests attempt the same active Hold concurrently;
   - exactly one Reservation and one night set persist;
   - one request performs the first transition and the other resolves as replay;
   - both successful responses identify the same Reservation;
   - no unique/deadlock/database exception leaks.
2. **Multi-night lock order**
   - overlapping multi-night operations complete without deadlock;
   - inventory locks retain the BE-003.3 key identities and ascending-date order.
3. **Expiry while waiting**
   - block confirmation on an inventory lock;
   - advance/use a fixed clock at the exact expiry boundary before lock acquisition completes;
   - confirmation re-checks time after the wait and returns `409`;
   - no Reservation persists and Hold is not incorrectly marked Confirmed.
4. **Confirmation versus last-room Hold creation**
   - prove the shared inventory locks serialize the operations;
   - if valid confirmation wins before expiry, the competing new Hold sees Reservation demand and cannot overbook;
   - no committed state exceeds controlled inventory.
5. **Rollback/cancellation**
   - transaction rollback releases the transition and inventory locks;
   - request `CancellationToken` releases locks and leaves no partial transition;
   - a later valid attempt can proceed.

Do not claim concurrency correctness from sequential tests or one shared DbContext.

### Reservation read integration tests

Cover at least:

- authenticated owner receives `200`;
- guest owner with original token receives `200`;
- logged-in caller with the correct token can read a genuinely guest-owned Reservation without claiming it;
- no credential and malformed credential return `401`;
- wrong syntactically valid token, foreign account, and missing ID follow non-disclosing `404` behavior;
- invalid presented customer cookie is not silently ignored;
- email, phone, confirmation number, and source Hold ID are not alternative authorization paths;
- response contains the complete safe snapshot in stable night order;
- response contains no account ID, token/hash, idempotency data, or inventory internals;
- query count is bounded and no-N+1;
- GET does not require antiforgery;
- OpenAPI describes cookie-or-guest-token ownership without showing a real token.

### Availability regression tests

Cover at least:

- public Availability is identical immediately before and after successful confirmation;
- a confirmed Hold is excluded while its confirmed Reservation is included;
- confirmed source Hold plus Reservation is never double-counted;
- every affected stay date retains the same committed room count;
- RatePlans continue to share RoomType demand;
- other Property/RoomType/date ranges remain unaffected;
- checkout date remains excluded;
- failed/expired confirmation does not create Reservation demand;
- current no-demand and BE-003.3 Availability behavior stays green;
- existing bounded-query test stays green.

### Security/OpenAPI/architecture tests

- confirmation and Reservation read routes are documented with exact response codes;
- confirmation documents antiforgery requirements;
- guest-token custom header is documented for guest confirmation/read;
- the header is permitted by relevant credentialed CORS configuration without hard-coding a production origin;
- no bearer token is introduced;
- no raw guest token, token hash, cookie, antiforgery value, contact PII, or booking secret is logged;
- Application contains no `HttpContext`, EF Core, Npgsql, API, or raw SQL dependency;
- Domain remains transport/persistence independent;
- no Hold read or cancellation endpoint appears;
- no Reservation cancellation endpoint appears;
- no frontend file changes;
- no migration/model-snapshot change;
- existing auth, Hold creation, Availability, and OpenAPI tests remain green.

Do not weaken, delete, skip, or rewrite existing tests merely to obtain a green result.

## Mandatory verification

Run repository-native equivalents and report exact commands and results:

1. Restore the complete backend solution.
2. Release build with 0 warnings and 0 errors.
3. Run the full existing and new automated test suite.
4. Apply the complete existing six-migration chain from an empty PostgreSQL 17 database.
5. Verify all six migrations apply in order and no seventh migration exists.
6. Run:

   ```bash
   dotnet ef migrations has-pending-model-changes
   ```

   Use the correct project, startup project, context, configuration, and connection settings discovered from the repository.
7. Verify PostgreSQL catalog evidence that:
   - unique `Reservation.SourceHoldId`;
   - unique `Reservation.ConfirmationNumber`;
   - Reservation ownership check;
   - Hold/Reservation status checks;
   - Hold → Reservation restrictive FK;
   - night uniqueness and demand indexes

   remain present and unchanged.
8. Run focused Domain/Application confirmation and credential tests.
9. Run focused real-PostgreSQL confirmation, ownership, read, rollback, expiry, and concurrency tests.
10. Run focused Availability before/after-confirmation regression tests.
11. Run architecture, security, CORS, antiforgery, and OpenAPI tests.
12. Run `git diff --check`.
13. Inspect `git diff --stat`, changed filenames, and the complete final diff.
14. Scan the diff and test output for:
    - secrets and real connection strings;
    - PII;
    - raw guest tokens or their hashes;
    - raw idempotency keys;
    - cookies/CSRF values;
    - confirmation-number-as-authorization behavior;
    - non-parameterized SQL;
    - session-scoped advisory locks;
    - application-level-only locking;
    - altered BE-003.3 inventory-lock identities/order;
    - mutable inventory counters;
    - repricing during confirmation;
    - edits to merged migrations/model snapshot;
    - frontend changes;
    - Hold read, cancellation, payment, cleanup, or other `BE-003.5` scope creep.

Report the exact final test total and category split, including skipped tests. Do not merely state “tests pass.”

## Acceptance criteria

Mark every item `PASS`, `FAIL`, or `BLOCKED` in the completion report:

1. The branch starts from verified latest `origin/develop` containing merged `BE-003.1`–`BE-003.3`.
2. `POST /api/v1/booking-holds/{holdId}/confirm` exists and accepts no client-authoritative booking data.
3. `GET /api/v1/reservations/{reservationId}` exists and is ownership protected.
4. Guest confirmation/read uses the original opaque guest token through one documented custom header.
5. Authenticated confirmation/read uses only the current server-resolved customer.
6. Missing, malformed, wrong, foreign, and invalid-session credentials follow a consistent non-disclosing policy.
7. Raw guest tokens/hashes, account IDs, idempotency data, PII, cookies, and antiforgery values are not exposed or logged.
8. Guest/account ownership remains exclusive and is copied exactly from Hold to Reservation.
9. Email/contact/confirmation number never grants ownership.
10. Active Hold confirms only while `utcNow < ExpiresAtUtc`; exact boundary and expired/cancelled states return `409`.
11. Server UTC time comes only from `TimeProvider` after required lock waits.
12. Reservation copies the exact immutable Hold snapshot without repricing or accepting client overrides.
13. Reservation starts `Confirmed` with null cancellation fields.
14. Confirmation number is server-generated, uppercase, within 32 characters, culture-invariant, at least 128-bit unique, stable, and never an authorization credential.
15. Initial confirmation returns `201` with `Location`; authorized replay returns `200` and the same Reservation.
16. Replay does not alter ID, confirmation number, timestamp, ownership, price, expiry, or nights and generates no token.
17. Hold status transition and Reservation/night insertion commit atomically.
18. A PostgreSQL transaction-scoped Hold-transition lock serializes same-Hold lifecycle work.
19. Confirmation reuses the exact BE-003.3 inventory lock identities and stable date order.
20. Concurrent same-Hold confirmation persists exactly one Reservation and leaks no database exception.
21. Expiry while waiting for a lock is re-evaluated correctly.
22. Rollback/cancellation releases locks and leaves no partial lifecycle transition.
23. Confirmation versus Hold creation cannot overbook the last room.
24. Successful confirmation preserves committed demand and public Availability exactly.
25. Reservation read is bounded, no-N+1, safely mapped, and stably ordered.
26. Problem Details, antiforgery, CORS, and OpenAPI fully describe the new contracts.
27. Domain/Application/Infrastructure/API dependency boundaries remain clean.
28. No new migration/model-snapshot change exists; six migrations apply cleanly and EF reports no pending model changes.
29. Existing unique/check/FK/index safeguards remain unchanged and effective.
30. Existing Hold creation, guest-token one-time behavior, idempotency, Availability, Identity, and regression behavior remains green.
31. Release build has 0 warnings/errors; all tests pass with 0 unexplained skips.
32. No frontend, cancellation, payment, cleanup, lookup-by-confirmation, or unrelated refactor exists.
33. Documentation records ownership, token reuse, confirmation-number, transaction/lock, snapshot, replay, read, and deferred-cancellation contracts.
34. Commit, push, and Draft PR succeed; the PR is not merged.

## Mandatory stop conditions

Stop immediately and report `BLOCKED` without widening the design if:

- latest `origin/develop` does not contain merge commit `927a4113b90465df75e08a2415e9fa8d1c4ac3a5` or an inspected descendant compatible with this order;
- baseline restore/build/tests fail for a reason outside this task;
- the current Hold/Reservation Domain or six-migration schema cannot represent exact snapshot copying and exclusive ownership;
- confirmation would require a migration, model-snapshot change, new persisted idempotency field, or new token field;
- atomic Hold status + Reservation/night persistence cannot be implemented in one PostgreSQL transaction;
- existing BE-003.3 inventory advisory-lock identities/order cannot be safely reused;
- same-Hold concurrent confirmation cannot converge safely using database-wide serialization and the existing unique constraints;
- guest ownership cannot be verified without persisting/recovering plaintext, logging a secret, or trusting email/contact;
- the original guest-token hash cannot be copied safely to Reservation;
- confirmation would need to trust client price, time, ownership, status, or confirmation-number data;
- safe non-disclosing authorization cannot be implemented with the existing identity/current-customer foundation;
- a transaction-safe confirmation-number strategy within current constraints cannot be established;
- implementation requires a secret, production credential/domain, or unavailable access;
- implementation would require Hold read, cancellation, payment, frontend, background cleanup, or another `BE-003.5` behavior;
- overlapping uncommitted user changes cannot be preserved safely.

If an exact internal representation is not prescribed but can be chosen safely from repository conventions without changing business behavior, choose the smallest consistent design, document it, and test it. Escalate only when the choice changes a locked contract, security property, transaction correctness, migration safety, or later-task boundary.

## Git and Draft PR procedure

After every verification gate passes:

1. Review `git status`, changed filenames, and the complete diff.
2. Commit only files belonging to `BE-003.4` with an intentional commit message.
3. Push `feature/be-003-4-hold-confirmation-reservation-read`.
4. Open a **Draft PR** targeting `develop`.
5. In the PR body include:
   - outcome and strict deferred scope;
   - confirmation and Reservation-read HTTP contracts;
   - guest-token header, validation, hash-only authorization, and invalid-cookie behavior;
   - authenticated ownership and non-disclosure behavior;
   - exact immutable snapshot-copy contract;
   - Domain lifecycle and exact expiry-boundary behavior;
   - confirmation-number generation and uniqueness design;
   - transaction, Hold-transition lock, reused inventory-lock identity/order, rollback, and cancellation behavior;
   - idempotent replay and database-constraint safeguards;
   - committed-demand/Availability invariance evidence;
   - exact PostgreSQL concurrency evidence;
   - explicit statement that no migration/model-snapshot change exists;
   - exact build/test totals;
   - security/OpenAPI/scope scans;
   - risks and work deferred to `BE-003.5`.
6. Do not merge, enable auto-merge, mark Ready, alter branch protection, or delete branches.

If push or Draft PR creation is impossible because authentication or remote access is unavailable, preserve the verified local commit and report the exact blocker. Do not claim local work was published.

## Required final response

Return exactly one completion report using this structure:

```text
CODEX COMPLETION REPORT
Status: PASS / BLOCKED
Work item / branch / base SHA:
Outcome delivered:
Files and behavior changed:
Confirmation API and idempotent replay:
Reservation read and ownership authorization:
Guest-token and authenticated-ownership design:
Immutable snapshot and confirmation-number design:
Domain lifecycle and expiry semantics:
Transaction/advisory-lock design:
Availability committed-demand impact:
Database/migration impact:
API/OpenAPI impact:
Tests run and exact results:
PostgreSQL concurrency/catalog/migration evidence:
Security/secret/scope checks:
Acceptance criteria checklist:
Commit SHA / Draft PR URL:
Deviations from scope:
Risks and deferred work:
Recommended next action:
Explicit confirmation: BE-003.5 not started; not merged
```

Do not claim `PASS` unless implementation, every mandatory verification item, commit, push, and Draft PR creation succeed. If any gate fails, use `BLOCKED`, state the first blocking fact precisely, preserve the gathered evidence, and do not start a later task.
