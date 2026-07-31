# CODEX EXECUTION PROMPT — BE-003.3 ATOMIC BOOKING HOLD

## Role and authority

You are the implementation agent for **The BHA Hotels** backend.

- Work item: `BE-003.3 — Atomic booking hold`
- Control Order: `CT-BE-003`
- Repository: `emLamHD/The_BHA_hotels_Booking`
- Target branch: `develop`
- Working branch: `feature/be-003-3-atomic-booking-hold`
- Verified `origin/develop` baseline: `b468511c75d87c7a691f4f204a819185b4bffe17`
- Baseline source: merge commit of PR #10, `BE-003.2`
- Merge authority: **Hồ Đình Lâm only**
- You may create commits, push the working branch, and open a **Draft PR** targeting `develop`.
- You must **not merge** the PR and must not push directly to `develop` or `main`.

Implement only `BE-003.3`. This task adds the atomic, idempotent Hold-creation API, guest-token generation, PostgreSQL transaction-scoped advisory locking, and committed-demand subtraction in public Availability.

`BE-003.4` and `BE-003.5` remain out of scope and must not be started.

## Required startup sequence

1. Read and obey repository governance and project-context files, if present, in this order:
   1. `RULES.md`
   2. `PROJECT_BIBLE.md`
   3. `SNAPSHOT.md`
   4. the current daily plan/worklog relevant to BE-003
   5. every applicable `AGENTS.md`
2. Inspect the current repository rather than assuming paths or conventions. Pay particular attention to:
   - the `BookingHold`, `BookingHoldNight`, `Reservation`, and nightly snapshot model merged in `BE-003.2`;
   - `BookingHoldConfiguration`, demand-support indexes, and the unique idempotency-key hash;
   - `AvailabilitySearch`, `AvailabilityDataSource`, and public Availability API behavior;
   - `DailyRoomRate`, `DailyInventoryControl`, PhysicalRoom active-count logic, Property timezone, and half-open date conventions;
   - `ICurrentCustomer`, `HttpCurrentCustomer`, cookie authentication, antiforgery, CORS, Problem Details, and OpenAPI conventions from `BE-003.1`;
   - service-registration, integration-test factory, fixed-clock, PostgreSQL concurrency-test, and documentation conventions.
3. Run read-only Git checks:
   - `git status --short`;
   - current branch and HEAD SHA;
   - configured remotes.
4. Fetch `origin`, resolve the latest `origin/develop` SHA, and compare it with the verified baseline above.
5. If `origin/develop` has advanced:
   - inspect every intervening commit and relevant diff;
   - continue only if the new baseline does not conflict with this order;
   - record the actual base SHA in the completion report.
6. Before editing, run the repository-native backend restore, Release build, and full automated-test baseline.
7. The verified post-`BE-003.2` reference is:
   - six applied migrations;
   - **218 passing tests**: 105 unit/domain/architecture and 113 PostgreSQL integration tests;
   - 0 failed and 0 skipped;
   - Release build with 0 warnings and 0 errors.
8. If the actual baseline fails for a reason outside this task, or overlapping user changes cannot be preserved safely, stop and report `BLOCKED`.
9. Create the working branch from the verified latest `origin/develop`. Do not reuse a stale branch.

Do not assume exact namespaces, filenames, commands, or implementation types. Discover and follow the repository.

## Outcome

Deliver the first inventory-committing booking workflow:

1. A guest or authenticated customer submits a server-priced Hold request.
2. `POST /api/v1/booking-holds` requires an `Idempotency-Key`.
3. The server validates the requested Property, RoomType, RatePlan, stay, occupancy, contact, pricing completeness, and current inventory.
4. Within one PostgreSQL transaction, the server acquires transaction-scoped advisory locks for every requested inventory date in stable order.
5. After acquiring the locks, the server re-reads base inventory, daily controls, active committed demand, and nightly prices.
6. If every night has enough remaining inventory, the server creates one `BookingHold` with immutable contact and nightly-price snapshots.
7. A guest receives a new opaque booking access token with at least 256 bits of entropy; only its SHA-256 hash is persisted.
8. An authenticated customer owns the Hold through the server-resolved `CustomerAccountId`; no guest token is created.
9. Same idempotency key plus the same normalized semantic request returns the same Hold and never creates duplicate demand.
10. Same idempotency key plus a different normalized semantic request returns `409 Conflict`.
11. Public Availability subtracts active, non-expired Holds and confirmed, non-cancelled Reservations from controlled physical inventory.
12. Expired Holds stop consuming Availability without a cleanup job.
13. Concurrent requests for the last room produce at most one successful Hold.

This task must not confirm, read, or cancel a Hold; create or read a Reservation; or add frontend/payment behavior.

## Locked public contract

### Endpoint

```http
POST /api/v1/booking-holds
Idempotency-Key: <opaque bounded value>
X-CSRF-TOKEN: <token from GET /api/v1/auth/csrf>
Content-Type: application/json
```

The existing global antiforgery policy remains in force. Do not exempt this endpoint. Both guest and authenticated callers must obtain the antiforgery cookie/request-token pair from `GET /api/v1/auth/csrf` and send the configured header.

The endpoint permits:

- anonymous guest callers;
- callers authenticated by the existing secure customer cookie.

Do not accept an access token, `CustomerAccountId`, `UserId`, ownership flag, current time, expiry, currency, nightly rate, total, available-room count, or guest-token value from the request body.

### Minimal request body

The request contains only client-authoritative selection and contact data:

- `propertyId`
- `roomTypeId`
- `ratePlanId`
- `checkIn`
- `checkOut`
- `adults`
- `children`
- `rooms`
- `fullName`
- `email`
- `phone`

Use repository-native JSON naming and model-binding conventions. Reject unknown additional business fields only if that is already the repository-wide JSON convention; do not introduce a global serializer change for this task.

### Minimal response body

Return a customer-safe Hold representation containing at least:

- `holdId`
- `status`
- `propertyId`
- `roomTypeId`
- `ratePlanId`
- `checkIn`
- `checkOut`
- `adults`
- `children`
- `rooms`
- `currencyCode`
- `totalAmount`
- `createdAtUtc`
- `expiresAtUtc`
- deterministic current expiry information if the implementation exposes it
- ordered nightly snapshots:
  - `stayDate`
  - `rooms`
  - `unitAmount`
  - `nightTotal`
- nullable/omitted `guestAccessToken`

Do not expose:

- `CustomerAccountId`;
- idempotency-key hash;
- request fingerprint;
- guest-token hash;
- PhysicalRoom IDs/numbers/floors/status;
- inventory-control rows;
- internal lock keys;
- Identity internals.

Contact fields need not be echoed in the response. Prefer the smallest customer-safe response consistent with repository conventions.

### HTTP behavior

- `201 Created`: a new Hold was committed.
- `200 OK`: same idempotency key and same normalized semantic request replayed the existing Hold.
- `400 Bad Request`: malformed/missing/oversized idempotency key, model-binding error, invalid dates/occupancy/contact, past check-in, stay/room limit violation, or another request-validation failure.
- `401 Unauthorized`: the request presents an invalid authenticated session or an authenticated principal cannot resolve a valid customer account identifier.
- `404 Not Found`: the active Property, RoomType, or RatePlan does not exist in the requested Property scope.
- `409 Conflict`: idempotency mismatch, incomplete/unavailable pricing, stop-sell, insufficient remaining inventory, or another current-offer conflict.
- `429 Too Many Requests`: only if an already-applicable repository policy produces it; do not invent a new booking quota in this task.

All errors use the existing Problem Details convention and must not reveal other customers’ data, raw keys/tokens, SQL details, or internal inventory counts beyond what the public Availability contract already exposes.

Do not add a fake `Location` that points to a read endpoint that does not exist yet.

## Locked Hold-creation rules

### Server-authoritative validation

- Use `DateOnly` and `[checkIn, checkOut)`.
- Preserve existing Availability limits:
  - maximum 30 nights;
  - maximum 10 requested rooms.
- `adults >= 1`, `children >= 0`, and `rooms >= 1`.
- `Adults + Children <= RoomType.MaxOccupancy * Rooms`, using overflow-safe arithmetic.
- Check-in cannot be earlier than the Property-local current date.
- Resolve the current instant through the injected `TimeProvider`; never use a client time.
- Property must be active.
- RoomType and RatePlan must be active and belong to that Property.
- Every stay date must have one current DailyRoomRate for the selected Property/RoomType/RatePlan.
- Do not synthesize a missing rate or use a fallback.
- Currency comes from the selected RatePlan.
- `NightTotal = UnitAmount * Rooms`.
- `TotalAmount = sum(NightTotal)`, using `decimal` only.
- Hold creation uses the rates re-read inside the locked transaction, not rates or totals from a prior Availability response.
- Rate changes after commit do not mutate an existing Hold snapshot.

### Ownership

- Resolve authenticated ownership exclusively from `ICurrentCustomer`.
- Never accept a customer/account identifier from the client.
- If the caller is authenticated, require a valid non-empty current `CustomerAccountId`; persist that ID and no guest-token hash.
- If the caller is anonymous, persist `CustomerAccountId = null` and a guest-token hash.
- Contact email never establishes ownership and never links a guest Hold to an account.
- Do not add guest-booking claim/link behavior.

### Guest access token

- Generate guest tokens with a cryptographically secure generator.
- Raw entropy must be at least 256 bits.
- Use an opaque transport-safe encoding, such as unpadded Base64URL.
- Persist only the lowercase hexadecimal SHA-256 hash expected by the merged Domain/schema.
- Return the raw token only in the response that successfully creates the guest Hold.
- Never persist, cache durably, or log the raw token.
- On idempotent replay, return the same Hold but return no raw guest token because it is not recoverable from the hash.
- Authenticated Hold responses never contain a guest token.
- Do not implement guest-token header parsing or authorization yet because no Hold read/confirm/cancel endpoint exists in this task.
- Document clearly that losing the one-time raw token prevents later guest access; changing that contract requires a future explicit security decision.

### Hold time and lifecycle

- A new Hold begins in `Active`.
- `CreatedAtUtc` is captured from server-controlled UTC time after the required inventory locks have been acquired and before persistence.
- `ExpiresAtUtc` remains exactly `CreatedAtUtc + 15 minutes`, derived by the merged Domain aggregate.
- Expiry is logical: `Status == Active && ExpiresAtUtc <= utcNow` does not consume committed demand.
- Do not add an `Expired` status or background cleanup.
- Do not implement confirmation, cancellation, or any status-transition method in this task.
- A replay of an existing Hold returns that same Hold even if it is now logically expired; it must not create a replacement under the same key.

## Idempotency contract

### Header handling

- `Idempotency-Key` is mandatory.
- Treat it as an opaque, case-sensitive value.
- Apply a documented, bounded UTF-8 length and reject blank, control-character, or oversized values before database work.
- Do not trim or silently rewrite a valid key in a way that changes its identity.
- Persist only a lowercase hexadecimal SHA-256 hash; never store or log the raw header.

### Request fingerprint

Build a deterministic, versioned, culture-invariant fingerprint over the normalized semantic request:

- Property, RoomType, and RatePlan IDs;
- check-in/check-out;
- adults, children, and rooms;
- normalized contact full name, email, and phone;
- ownership scope:
  - authenticated customer account ID, or
  - an explicit guest marker.

The fingerprint must not include:

- raw idempotency key;
- server current time;
- generated Hold ID;
- generated guest token;
- current nightly prices, total, or current inventory;
- JSON property order or culture-sensitive formatting.

Persist only the lowercase hexadecimal SHA-256 fingerprint expected by the merged Domain/schema.

“Same payload” means the same normalized semantic request and ownership scope, not merely byte-identical JSON.

### Replay behavior

- Same key hash + same fingerprint + same ownership scope returns the existing Hold.
- Replay does not:
  - acquire new inventory demand;
  - refresh expiry;
  - reprice;
  - regenerate a guest token;
  - create new nightly rows.
- Same key hash + different fingerprint or ownership scope returns `409 Conflict`.
- An idempotency key owned by one authenticated customer cannot replay a Hold for another customer.
- Failed validation, unavailable pricing, insufficient inventory, cancellation, or transaction failure must not leave a partial Hold or reserve an idempotency key.
- Concurrent same-key requests must converge to exactly one persisted Hold. For guest callers, only the request that actually creates the Hold receives the one-time raw token.
- Use the existing unique idempotency-hash index as the final database safeguard.
- Handle unique-constraint races deterministically. Do not surface an unhandled `DbUpdateException`/PostgreSQL error.

## PostgreSQL transaction and advisory-lock rules

Every successful new Hold must be created in one explicit PostgreSQL transaction.

### Lock identity and ordering

- Acquire a transaction-scoped advisory lock for each:

  ```text
  (PropertyId, RoomTypeId, StayDate)
  ```

- Use PostgreSQL `pg_advisory_xact_lock`, not session-scoped locks.
- Define one deterministic, documented lock-key algorithm shared by this task and future confirmation/cancellation work.
- The algorithm must be stable across API instances, processes, machines, and cultures.
- Hash collisions may cause harmless extra serialization but must never weaken correctness.
- Keep inventory-lock keys in a dedicated namespace if the implementation also uses an idempotency serialization lock.
- Remove duplicate keys and acquire all inventory keys in ascending `StayDate`/stable key order to avoid deadlocks.
- Do not use only an in-process mutex, `lock`, semaphore, cache lock, or single-instance assumption.

### Work inside the lock

After the transaction and all required inventory locks are active:

1. Re-check idempotency as required for concurrent replay safety.
2. Capture a server UTC instant through `TimeProvider`.
3. Re-read active Property, RoomType, RatePlan, and Property timezone data required by the command.
4. Re-read complete nightly rates.
5. Re-read Active PhysicalRoom base inventory.
6. Re-read DailyInventoryControl for every stay date.
7. Re-read committed demand for every stay date:

   ```text
   Active Holds where ExpiresAtUtc > utcNow
   + Confirmed Reservations
   ```

8. Compute controlled nightly inventory:

   ```text
   ControlledInventory =
       IsStopSell
           ? 0
           : min(ActivePhysicalRooms, SellableLimit ?? ActivePhysicalRooms)
   ```

9. Compute:

   ```text
   RemainingRooms = ControlledInventory - CommittedRooms
   ```

10. Continue only if every stay date has `RemainingRooms >= requested Rooms`.
11. Create and persist the Hold plus every immutable nightly snapshot.
12. Commit once.

Do not maintain a mutable “booked rooms” counter or decrement PhysicalRoom/inventory-control rows.

All commands that change committed demand in later tasks must reuse the same lock identity/order contract. Put PostgreSQL-specific lock acquisition in Infrastructure. Keep Domain and Application independent of Npgsql/EF Core/SQL transport details.

Use cancellation tokens throughout. A cancelled/failed command must roll back the complete transaction and release transaction-scoped locks.

## Availability committed demand

`BE-003.3` owns this change. Do not defer it to `BE-003.5`.

Update:

```http
GET /api/v1/properties/{propertyId}/availability
```

so every nightly result uses:

```text
CommittedRooms =
    Active Holds with ExpiresAtUtc > utcNow
    + Confirmed Reservations
```

```text
AvailableRooms =
    max(0, ControlledInventory - CommittedRooms)
```

The stay offer’s `AvailableRooms` remains the minimum across every stay date. The offer is excluded when `AvailableRooms < RequestedRooms`.

Rules:

- Evaluate one server-controlled UTC instant consistently for the Availability request.
- Expiry boundary is exact: a Hold with `ExpiresAtUtc == utcNow` consumes zero demand.
- Active non-expired Holds consume demand immediately after their transaction commits.
- Active expired Holds consume zero demand without cleanup.
- Cancelled Holds consume zero demand.
- Confirmed Holds consume zero demand; their corresponding confirmed Reservation is counted instead.
- Confirmed Reservations consume demand.
- Cancelled Reservations consume zero demand.
- A confirmed source Hold plus its Reservation must never be double-counted.
- Demand is shared across RatePlans for the same Property/RoomType/date.
- Clamp public remaining inventory at zero if inconsistent legacy/test data produces demand above controlled inventory.
- Preserve the existing customer-safe response; do not expose raw demand rows or booking identifiers.
- Preserve stable offer ordering, half-open stays, complete pricing, occupancy logic, Property-local past-date validation, and all existing API behavior.
- Keep the read bounded and no-N+1; query count may increase by a fixed number but must not grow with candidate count or stay length.
- Availability remains a snapshot; Hold creation revalidates under locks.

No migration is expected for this task. The merged `BE-003.2` schema and indexes were intentionally created for these reads. If a model/schema change or new migration appears necessary, stop and report `BLOCKED` with the exact missing safeguard rather than casually changing the approved schema.

## Application, Infrastructure, and API boundaries

- Domain remains independent of Application, Infrastructure, EF Core, Npgsql, ASP.NET Core, Identity, and API.
- Application owns transport-neutral command/result contracts, validation/orchestration abstractions, deterministic hashing/fingerprint behavior where appropriate, and current-customer consumption.
- Application must not depend on `HttpContext`, controllers, EF entities, Npgsql, or raw SQL.
- API owns:
  - request/header binding;
  - current HTTP/auth context adapter already established;
  - status-code and Problem Details mapping;
  - antiforgery/OpenAPI composition.
- Infrastructure owns:
  - EF Core persistence;
  - PostgreSQL transaction;
  - advisory-lock acquisition;
  - server-side re-read of rates/inventory/committed demand;
  - atomic insertion and concurrent idempotency resolution.
- Do not return tracked EF entities across the Infrastructure/Application boundary.
- Follow the repository’s current service-registration style; do not add a generic repository/unit-of-work framework.
- Keep implementation types narrowly scoped to the Hold-creation use case and future reuse of inventory advisory locks.

## Database and migration requirements

- PostgreSQL 17 remains the only persistence target.
- Do not add EF InMemory or SQLite.
- Reuse the six merged migrations unchanged.
- Add **no migration** and make **no model snapshot change** unless a mandatory stop condition is reached and Control Tower approves a revised schema.
- Do not edit, rename, regenerate, squash, or reorder merged migrations.
- Do not apply migrations automatically during API startup.
- Do not add Hold/Reservation rows to Development seed.
- Existing unique/check/FK/index safeguards remain intact.
- SQL used for advisory locks must be parameterized.
- Do not interpolate PII, token material, idempotency keys, UUIDs, or dates into SQL strings.

## Strict scope in

- `POST /api/v1/booking-holds`.
- Request/response DTOs and Problem Details mapping required by that endpoint.
- Mandatory idempotency-key parsing, hashing, fingerprinting, replay, mismatch, and concurrency behavior.
- Guest access-token generation, one-time response, and SHA-256 persistence.
- Authenticated ownership through `ICurrentCustomer`.
- Server-authoritative offer revalidation and immutable Hold price snapshots.
- PostgreSQL explicit transaction and transaction-scoped advisory locks.
- Atomic remaining-inventory check and Hold insert.
- Availability subtraction of active non-expired Holds and confirmed Reservations.
- Domain/Application/API/PostgreSQL/concurrency/security/OpenAPI/regression tests for this task.
- Narrow documentation for Hold creation, idempotency, guest token, advisory-lock contract, committed-demand formula, and deferred lifecycle work.

## Strict scope out

- `GET /api/v1/booking-holds/{holdId}`.
- `POST /api/v1/booking-holds/{holdId}/confirm`.
- `POST /api/v1/booking-holds/{holdId}/cancel`.
- `GET /api/v1/reservations/{reservationId}`.
- `POST /api/v1/reservations/{reservationId}/cancel`.
- Reservation creation, confirmation-number generation, or Hold-to-Reservation copying.
- Any Hold/Reservation lifecycle transition.
- Guest-token header parsing or resource authorization.
- Guest-booking claim/link.
- Background expiry cleanup.
- Mutable booked/held inventory counters.
- Payment, tax, surcharge, discount, currency conversion, refund, webhook, or payment status.
- Customer Identity redesign, social login, verification, recovery, MFA, roles, or Admin auth.
- New booking rate-limit/business-quota policy.
- Frontend changes.
- PMS, OTA, notifications, housekeeping, room assignment, check-in/out, folio, or invoice work.
- Broad refactors, speculative abstractions, distributed caches, queues, or new infrastructure not required by atomic Hold creation.

## Required tests

Follow existing repository conventions and use real PostgreSQL 17 for persistence/concurrency behavior.

### Unit/Application tests

Cover at least:

- valid guest request normalization;
- valid authenticated request and current-customer ownership;
- invalid authenticated principal with no valid customer ID;
- missing/blank/control-character/oversized idempotency key;
- deterministic case-sensitive key hash;
- deterministic, versioned, culture-invariant request fingerprint;
- semantic normalization behavior for contact fields;
- fingerprint changes for every business-significant request field and authenticated owner;
- fingerprint does not change because of JSON property order, server time, price, inventory, generated ID, or generated token;
- invalid IDs, date range, stay limit, occupancy counts, room limit, contact, and Property-local past date;
- guest token uses a cryptographically secure 256-bit-or-greater source, transport-safe encoding, and expected SHA-256 representation;
- authenticated Hold generates no guest token;
- response mapping never exposes hashes, fingerprints, customer IDs, or internal inventory/room data;
- Availability demand math for active/non-expired, expiry-boundary, expired, confirmed, and cancelled lifecycle states;
- decimal nightly and aggregate totals without floating-point arithmetic;
- cancellation-token propagation where repository patterns support unit coverage.

### PostgreSQL/Application integration tests

Cover at least:

- guest Hold creation persists one Hold and exact ordered nightly snapshots;
- authenticated Hold creation persists the server-resolved customer FK and no guest-token hash;
- raw guest token is returned only on initial creation, hashes to the stored value, and is absent on replay;
- authenticated creation and guest creation both comply with existing antiforgery behavior;
- request-supplied ownership, price, expiry, or token fields cannot influence persistence;
- active/inactive/missing/cross-Property Property, RoomType, and RatePlan behavior;
- Property-local past-date boundary using a fixed clock;
- occupancy and request-limit validation;
- complete nightly rates required, with no fallback;
- current rates are snapshotted after lock acquisition;
- totals and currency are server-derived;
- stop-sell, controlled limit, inactive PhysicalRooms, and insufficient inventory conflicts;
- failed creation leaves no Hold/night rows;
- same key + same semantic request returns the same Hold with exactly one aggregate/night set;
- same key + different request or authenticated owner returns `409`;
- replay does not refresh expiry or reprice;
- replay of a logically expired Hold does not create a replacement;
- concurrent same-key/same-payload requests persist exactly one Hold and do not expose database exceptions;
- concurrent same-key/different-payload requests persist at most one Hold and return a deterministic conflict for the loser;
- concurrent different-key requests competing for the last room produce exactly one success and one `409`, with committed demand never exceeding controlled inventory;
- multi-night competing requests acquire locks in stable order and complete without deadlock;
- transaction rollback releases locks and leaves no partial demand;
- cancellation tokens/failed commands do not leave open transactions or partial rows.

### Availability integration tests

Cover at least:

- a committed active Hold reduces AvailableRooms for every held stay date;
- demand is shared across RatePlans for the same RoomType;
- a Hold affects only its Property/RoomType/date range;
- checkout date is excluded;
- a Hold is ignored immediately at `ExpiresAtUtc`;
- an expired Hold restores Availability without deletion or cleanup;
- cancelled and confirmed Holds are excluded from Hold demand;
- confirmed Reservations are included;
- cancelled Reservations are excluded;
- a confirmed source Hold and its Reservation are not double-counted;
- public remaining rooms never become negative;
- current no-demand Availability behavior remains unchanged;
- existing stable ordering, complete pricing, occupancy, stop-sell, controls, 400/404/empty-200, response-exposure, fixed-clock, and no-N+1/bounded-query behavior remains green.

It is acceptable for focused integration setup to persist valid Reservation rows directly through repository-native test fixtures because public confirmation is deliberately out of scope. Do not add a production confirmation shortcut merely to support tests.

### Security/OpenAPI/architecture tests

- OpenAPI documents `POST /api/v1/booking-holds`, request/response schema, mandatory `Idempotency-Key`, antiforgery header/cookie flow, cookie-auth optionality, one-time guest token, and every declared response status.
- Existing auth endpoints and security scheme remain unchanged.
- The create-Hold endpoint is not antiforgery-exempt.
- Raw idempotency keys, raw guest tokens, cookies, antiforgery values, contact PII, and SQL parameters are not logged.
- Application contains no `HttpContext`, EF Core, Npgsql, or API dependency.
- Domain remains transport/persistence independent.
- No forbidden Hold/Reservation endpoint appears.
- No frontend file changes.
- No migration/model-snapshot change.

Do not weaken, delete, skip, or rewrite existing tests to obtain a green result.

## Mandatory PostgreSQL concurrency evidence

Do not claim overbooking protection from sequential tests alone.

At minimum, demonstrate with separate scopes/DbContexts/connections and real concurrent tasks that:

1. both requests target the same Property/RoomType/stay date and see the last room as available before execution;
2. both attempt Hold creation concurrently with different idempotency keys;
3. the implementation serializes them using transaction-scoped advisory locks;
4. exactly one transaction commits;
5. the other returns the application’s `409 Conflict` result;
6. only one Hold and its expected nights persist;
7. Availability reports zero remaining rooms afterward;
8. no PostgreSQL unique/deadlock/serialization exception leaks to the API.

Also verify a multi-night overlap in reversed request/date setup completes without deadlock because locks are acquired in stable order.

Tests must have bounded timeouts so a broken lock order fails rather than hanging CI.

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
7. Verify PostgreSQL catalog evidence that required merged Hold/Reservation indexes and constraints remain present and unchanged.
8. Run focused real-PostgreSQL Hold/idempotency/concurrency tests.
9. Run focused Availability committed-demand tests.
10. Run architecture, security, and OpenAPI tests.
11. Run `git diff --check`.
12. Inspect `git diff --stat`, changed filenames, and the complete final diff.
13. Scan the diff and test output for:
    - secrets and real connection strings;
    - PII;
    - raw guest tokens;
    - raw idempotency keys;
    - cookie/CSRF values;
    - non-parameterized lock SQL;
    - session-scoped advisory locks;
    - application-level-only locking;
    - mutable inventory counters;
    - edits to merged migrations/model snapshot;
    - frontend changes;
    - confirmation, cancellation, reads, payment, or other later-task scope creep.

Report the exact final test total and category split, including skipped tests. Do not merely state “tests pass.”

## Acceptance criteria

Mark each item `PASS`, `FAIL`, or `BLOCKED` in the completion report:

1. The actual branch starts from verified latest `origin/develop`, containing the merged `BE-003.1` and `BE-003.2` foundations.
2. `POST /api/v1/booking-holds` supports guest and authenticated callers without accepting client ownership identifiers.
3. Request price, currency, totals, availability, current time, expiry, and guest token are entirely server-authoritative.
4. The endpoint requires a bounded `Idempotency-Key`, persists only its SHA-256 hash, and never logs the raw value.
5. The deterministic request fingerprint covers every normalized semantic field and ownership scope while excluding server/generated/current-offer values.
6. Same key + same semantic request returns one unchanged Hold; same key + different request/owner returns `409`.
7. Concurrent idempotent requests converge to one persisted Hold without leaking database exceptions.
8. Guest token generation has at least 256 bits of cryptographic entropy; only its SHA-256 hash is stored.
9. Raw guest token is returned only for the initial successful guest creation, absent on replay, never returned for authenticated Holds, and never logged.
10. Existing cookie identity and antiforgery behavior is preserved; create-Hold is not antiforgery-exempt.
11. Property/RoomType/RatePlan activity and same-Property ownership are revalidated.
12. Stay, request limits, occupancy, contact, Property-local past date, and complete pricing are validated.
13. Currency, nightly snapshots, totals, creation time, and exact 15-minute expiry are derived by the server.
14. A new Hold is inserted atomically with all nights in one PostgreSQL transaction.
15. Transaction-scoped PostgreSQL advisory locks cover every `(PropertyId, RoomTypeId, StayDate)` in stable order.
16. After locks, the implementation re-reads prices, controlled inventory, and committed demand before deciding.
17. Two different-key requests competing for the last room yield at most one committed Hold; the loser receives `409`.
18. No application-only mutex or mutable inventory counter is used as the correctness mechanism.
19. Availability subtracts active non-expired Holds and confirmed Reservations, excludes every non-demand state, and never double-counts a confirmed source Hold.
20. Expiry boundary is exact and expired Holds release Availability logically without cleanup.
21. Demand is shared across RatePlans and isolated by Property/RoomType/stay date.
22. Existing Availability pricing, controls, ordering, limits, validation, safe response, and bounded-query behavior remains green.
23. Problem Details and OpenAPI fully describe create/replay/conflict/antiforgery/idempotency/one-time-token behavior.
24. Application and Domain dependency boundaries remain clean; PostgreSQL/EF/HTTP details stay in their approved layers.
25. No new migration or model-snapshot change exists; the clean six-migration PostgreSQL 17 chain applies and EF reports no pending model changes.
26. No seed booking rows, startup auto-migration, frontend changes, or unrelated refactor exists.
27. Release build has 0 warnings and 0 errors; all existing/new tests pass with 0 unexplained skips.
28. No secret, credential, real connection string, PII log, raw token/key, cookie/CSRF value, or unsafe SQL appears in diff/output.
29. No Hold read/confirm/cancel, Reservation workflow/read/cancel, payment, background cleanup, or `BE-003.4`/`BE-003.5` behavior appears.
30. Documentation records the idempotency, one-time guest-token, advisory-lock, committed-demand, and deferred-lifecycle contracts.

## Mandatory stop conditions

Stop immediately and report `BLOCKED` without widening the design if:

- latest `origin/develop` does not contain the verified PR #10 merge or conflicts with this order;
- baseline restore/build/tests fail for a reason outside this task;
- the merged Domain/schema cannot represent the approved Hold request without a model or migration change;
- required committed-demand lookup cannot be supported safely by the merged schema/indexes;
- PostgreSQL transaction-scoped advisory locking cannot be implemented or verified with the available environment;
- a stable lock-key/order contract cannot be established without changing a locked business/architecture decision;
- same-key concurrency cannot be resolved safely with the existing unique idempotency hash without changing schema;
- the one-time raw guest-token contract cannot be honored without persisting/recovering plaintext or adding a new secret;
- identity cannot distinguish anonymous from a valid authenticated customer through the existing `ICurrentCustomer`;
- implementation would need to trust client price/inventory/time/ownership data;
- a migration/model-snapshot change appears necessary;
- implementation requires a secret, production credential/domain, or unavailable access;
- implementation would require confirmation, cancellation, resource read/authorization, payment, background cleanup, frontend, or another later task;
- overlapping uncommitted user changes cannot be preserved safely.

If an exact internal representation is not prescribed but can be chosen safely from current repository conventions without changing business behavior, choose the smallest consistent design, document it, and test it. Escalate only when the choice changes a locked contract, security property, transaction correctness, migration safety, or later-task boundary.

## Git and Draft PR procedure

After all verification passes:

1. Review `git status`, changed filenames, and the complete diff.
2. Commit only files belonging to `BE-003.3` with an intentional commit message.
3. Push `feature/be-003-3-atomic-booking-hold`.
4. Open a **Draft PR** targeting `develop`.
5. In the PR body include:
   - outcome and strict deferred scope;
   - endpoint/request/response and HTTP contract;
   - idempotency hash/fingerprint/replay design;
   - guest-token generation, storage, and one-time response behavior;
   - authenticated ownership and antiforgery behavior;
   - transaction and stable advisory-lock-key/order design;
   - server-authoritative price/inventory revalidation;
   - Availability committed-demand formula and bounded-query evidence;
   - exact concurrency evidence;
   - explicit statement that no migration/model-snapshot change exists;
   - exact build/test totals;
   - security/OpenAPI/scope scans;
   - risks and deferred work.
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
Hold API and server-authoritative pricing:
Idempotency and fingerprint design:
Guest-token and authenticated-ownership design:
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
Explicit confirmation: BE-003.4 not started; not merged
```

Do not claim `PASS` unless implementation, every mandatory verification item, commit, push, and Draft PR creation succeed. If any gate fails, use `BLOCKED`, state the first blocking fact precisely, preserve the gathered evidence, and do not start a later task.
