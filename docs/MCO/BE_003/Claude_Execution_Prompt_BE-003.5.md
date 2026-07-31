# CLAUDE CODE EXECUTION PROMPT — BE-003.5 CANCELLATION AND LIFECYCLE HARDENING

## 1. Role and authority

You are the implementation executor for **The BHA Hotels** backend.

- Work item: `BE-003.5 — Cancellation and lifecycle hardening`
- Control Order: `CT-BE-003`
- Repository: `emLamHD/The_BHA_hotels_Booking`
- Target branch: `develop`
- Working branch: `feature/be-003-5-cancellation-lifecycle-hardening`
- Verified `origin/develop` baseline:
  `a59d8187d2e6f997304b10d6c38ca338694666c3`
- Baseline source: merged PR #13 / `BE-003.4`
- Verified baseline tests: **192 unit + 172 integration = 364 passed**
- Merge authority: **Hồ Đình Lâm only**

You may inspect, implement, test, commit, push the working branch, and open a
Draft PR targeting `develop`.

You must not:

- push directly to `develop` or `main`;
- merge the PR;
- delete any branch;
- rewrite history;
- modify or stage unrelated pre-existing files;
- redesign the booking architecture;
- expand into payment, frontend, administration, PMS, notification, or later
  work;
- begin another work item after this one.

This is one complete, self-contained work order. Do not rely on conversational
memory or an instruction to “continue where we left off.”

## 2. Outcome

Close the remaining BE-003 MVP reservation lifecycle by delivering:

1. ownership-protected Booking Hold read;
2. idempotent Booking Hold cancellation;
3. idempotent Reservation cancellation before the Property-local check-in
   date;
4. immediate, atomic inventory release after cancellation;
5. expiry-boundary and concurrency hardening;
6. final OpenAPI, documentation, migration, security, and end-to-end evidence
   for BE-003.

The Hold read endpoint is deliberately included here. It is part of the
approved Master Control Order public API target and was explicitly deferred by
BE-003.3 and BE-003.4. Omitting it would leave the BE-003 public lifecycle
incomplete.

## 3. Mandatory initial gate

Before editing any file:

1. Read repository instructions and project sources in this order:
   - root `CLAUDE.md`, if present;
   - `README.md`;
   - `docs/ARCHITECTURE.md`;
   - `docs/ADR/0001-use-dotnet-8.md`;
   - `docs/ADR/0002-use-postgresql.md`;
   - `docs/DATABASE.md`;
   - the BE-003 documents in order:
     - `docs/BE-003-1-CUSTOMER-BOOKING-IDENTITY.md`;
     - `docs/BE-003-2-HOLD-RESERVATION-DOMAIN-FOUNDATION.md`;
     - `docs/BE-003-3-ATOMIC-BOOKING-HOLD.md`;
     - `docs/BE-003-4-HOLD-CONFIRMATION-RESERVATION-READ.md`;
   - the supplied `MASTER CONTROL ORDER — BE-003 RESERVATION LIFECYCLE`;
   - this execution prompt.
2. Run `git status --short --branch` and preserve every pre-existing tracked or
   untracked user file. Do not stage an unrelated local `CLAUDE.md` or any other
   unrelated file.
3. Fetch origin and verify that `origin/develop` is exactly
   `a59d8187d2e6f997304b10d6c38ca338694666c3`.
4. Verify PR #13 is already merged and the old
   `feature/be-003-4-hold-confirmation-reservation-read` branch is not the
   branch being reused.
5. Create
   `feature/be-003-5-cancellation-lifecycle-hardening` from the verified
   `origin/develop`.
6. Establish the baseline:
   - restore the backend solution;
   - build Release with zero warnings and zero errors;
   - run the full backend suite against PostgreSQL 17;
   - expect exactly 364 existing tests to pass before adding new tests.

Stop and report `BLOCKED` before implementation if the baseline SHA differs,
the existing suite is not green, the working tree cannot be preserved safely,
or the actual repository materially contradicts this order.

## 4. Locked public API scope

Add exactly these missing lifecycle endpoints:

```http
GET  /api/v1/booking-holds/{holdId}
POST /api/v1/booking-holds/{holdId}/cancel
POST /api/v1/reservations/{reservationId}/cancel
```

Do not change the existing routes or semantics of:

```http
POST /api/v1/booking-holds
POST /api/v1/booking-holds/{holdId}/confirm
GET  /api/v1/reservations/{reservationId}
```

### 4.1 Shared ownership and disclosure policy

All three new endpoints must reuse the established BE-003.4 credential model:

- authenticated ownership comes only from `ICurrentCustomer` and the existing
  customer cookie session;
- guest ownership requires the original opaque token in
  `X-Booking-Access-Token`;
- the token must pass the existing strict unpadded Base64URL / exact 32-byte
  validation before SHA-256 hashing;
- caller credentials use OR semantics: a logged-in caller may also present the
  correct token for a genuinely guest-owned resource without claiming it;
- email, phone, confirmation number, source Hold ID, request body, route
  guesses, and sequential identifiers never establish ownership;
- a missing or malformed usable credential returns `401`;
- a missing resource and a foreign resource return the same non-disclosing
  `404`;
- an invalid customer cookie follows the existing explicit `401` behavior;
- raw token, token hash, cookie, CSRF value, idempotency key, and PII must not
  be logged.

`GET` does not require antiforgery. Both cancellation `POST` endpoints remain
under the existing global antiforgery policy and must require the established
`X-CSRF-TOKEN` contract for guest and authenticated callers.

### 4.2 Booking Hold read

`GET /api/v1/booking-holds/{holdId}`:

- returns `200 OK` with the existing customer-safe `BookingHoldDto`;
- applies ownership filtering in a bounded, no-tracking query;
- returns nights in ascending stay-date order;
- never returns or regenerates the raw guest access token; the DTO field must
  be `null` on read;
- returns the persisted lifecycle status and `ExpiresAtUtc`;
- does not add or persist an `Expired` status;
- does not mutate the Hold or refresh its expiry, price, token, or snapshot.

### 4.3 Booking Hold cancellation

`POST /api/v1/booking-holds/{holdId}/cancel` accepts no business request body.

Locked behavior:

- `Active -> Cancelled` returns `200 OK` with `BookingHoldDto`;
- cancelling an already `Cancelled` Hold is an idempotent replay: return the
  same current snapshot with `200`, without changing any data or timestamp and
  without acquiring inventory locks unnecessarily;
- an `Active` Hold may be explicitly cancelled even at or after its expiry
  instant; expiry has already released logical demand, and cancellation merely
  records the terminal lifecycle state;
- a `Confirmed` Hold cannot be cancelled because commitment now belongs to its
  Reservation; return `409 Conflict` and do not mutate either aggregate;
- cancellation never deletes the Hold or its nights;
- cancellation never regenerates or returns the raw guest token.

### 4.4 Reservation cancellation

`POST /api/v1/reservations/{reservationId}/cancel` accepts only:

```json
{
  "reason": "Required customer-supplied cancellation reason"
}
```

The reason is required, trimmed, non-blank, and limited to the existing
500-character Domain/schema constraint.

Locked behavior:

- a `Confirmed` Reservation may transition to `Cancelled` only while the
  server-derived Property-local date is strictly earlier than `CheckIn`;
- calculate the local date from `TimeProvider.GetUtcNow()` and the persisted
  `Property.TimeZone`; never accept current time, local date, time zone, status,
  or cancellation timestamp from the client;
- at the exact start of the local `CheckIn` date and afterward, a still
  `Confirmed` Reservation returns `409 Conflict`;
- first success returns `200 OK` with the existing `ReservationDto`, populated
  with `Status = Cancelled`, `CancelledAtUtc`, and the normalized reason;
- cancelling an already `Cancelled` Reservation is an idempotent replay:
  return the existing Reservation with `200`, even if the retry arrives on or
  after the check-in date;
- replay must preserve the original `CancelledAtUtc` and reason; a later valid
  reason must not overwrite them;
- cancellation never changes confirmation number, ownership, contact, stay,
  occupancy, currency, price, totals, confirmation time, or nightly snapshots;
- cancellation never deletes the Reservation or its nights.

Malformed request data returns `400`. Ownership-safe `401`/`404` behavior
precedes disclosure. A valid owner attempting a prohibited lifecycle
transition receives `409`.

## 5. Domain constraints

Implement lifecycle transitions on the aggregates rather than setting EF
properties from Infrastructure.

### Booking Hold

Add a Domain cancellation transition that:

- changes only `Active` to `Cancelled`;
- treats `Cancelled` as an idempotent no-op;
- rejects `Confirmed`;
- does not use client time and does not create a persisted `Expired` state;
- leaves every immutable booking and ownership field unchanged.

### Reservation

Add a Domain cancellation transition that:

- changes only `Confirmed` to `Cancelled`;
- receives server-derived UTC time and the server-derived Property-local date,
  or an equivalently clean transport-independent representation;
- enforces `propertyLocalDate < CheckIn`;
- normalizes and validates the required reason using the existing limits;
- sets `CancelledAtUtc` once and never rewrites it;
- treats `Cancelled` as an idempotent no-op before applying the cutoff again;
- preserves every immutable snapshot field.

Do not make Domain or Application depend on ASP.NET Core, EF Core, Npgsql,
`HttpContext`, or database-specific locking.

## 6. Application constraints

Add transport-neutral contracts/use cases for:

- Booking Hold read;
- Booking Hold cancellation;
- Reservation cancellation.

Reuse the existing:

- `ICurrentCustomer`;
- `BookingAccessTokenValidator`;
- customer-safe Hold and Reservation DTO shapes;
- result/status patterns established by Hold confirmation and Reservation read.

Application must not:

- accept authoritative ownership, price, inventory, time, expiry, status, or
  cancellation timestamp from API DTOs;
- expose persisted guest-token hashes, account internals, EF entities, or raw
  database exceptions;
- use confirmation number or email as an access path.

Avoid three independently drifting copies of credential resolution and mapping
logic. Reuse or narrowly extract shared booking lifecycle helpers where that
reduces real duplication without introducing a broad redesign.

## 7. PostgreSQL transaction and locking contract

Cancellation changes committed demand and must be serialized with Hold
creation, confirmation, and competing cancellation requests.

### 7.1 General lock order

Every mutating lifecycle request uses one explicit PostgreSQL transaction and
the existing transaction-scoped advisory-lock mechanism.

The stable order is:

1. lifecycle transition lock;
2. inventory locks for all distinct stay dates in ascending order;
3. post-lock time capture and final state/cutoff validation;
4. one aggregate state update;
5. save and commit once.

Never acquire inventory locks before the lifecycle transition lock. Never use
an application-only mutex.

### 7.2 Hold cancellation

- Acquire the existing `BookingAdvisoryLockKeys.ForHoldTransition(holdId)`.
- Load the Hold and nights under the transaction and resolve ownership without
  disclosing foreign-resource existence.
- A `Cancelled` replay may return before inventory locks.
- A `Confirmed` Hold returns `409`.
- For an `Active` Hold, acquire the exact existing `ForInventory` keys for all
  nights in ascending date order, then apply the Domain transition and commit.

### 7.3 Reservation cancellation

- Resolve the owned Reservation sufficiently to obtain its `SourceHoldId`
  without exposing a foreign resource.
- Acquire the existing Hold-transition lock for that `SourceHoldId`, so the
  complete lifecycle remains serialized on the same source Hold identity.
- Reload and revalidate ownership/state inside the transaction after the lock.
- A `Cancelled` replay returns before inventory locks and before applying the
  local-date cutoff again.
- For a still `Confirmed` Reservation, acquire the exact existing
  `ForInventory` keys for all nights in ascending date order.
- Capture UTC time only after all lock waits complete.
- Load `Property.TimeZone` without requiring the Property or current catalog
  selections to remain active.
- Derive the Property-local date, enforce the cutoff through the Domain
  transition, save, and commit.

Rollback, exception, request cancellation, or database failure must leave:

- no partial status change;
- no partial cancellation fields;
- no altered night rows;
- no leaked advisory lock;
- no incorrect Availability result.

## 8. Availability and expiry invariants

The existing committed-demand formula remains authoritative:

```text
active, non-expired Holds
+ Confirmed Reservations
```

Therefore:

- `Cancelled` Holds contribute zero demand;
- `Active` Holds at `utcNow >= ExpiresAtUtc` contribute zero demand without a
  cleanup job;
- `Cancelled` Reservations contribute zero demand;
- successful cancellation releases all booked rooms on every stay date
  atomically at commit;
- failed or rolled-back cancellation releases nothing;
- cancellation must not briefly double-count or under-count demand in a
  committed state;
- current rate, stop-sell, sellable-limit, RoomType, RatePlan, PhysicalRoom, or
  Property activation changes must not prevent an owner from cancelling an
  existing commitment.

Do not rewrite `AvailabilityDataSource` or Hold-creation committed-demand logic
unless a focused failing regression demonstrates a narrow defect. Their
existing status filters should already make cancellation release logical
demand.

Do not add:

- a persisted `Expired` Hold status;
- background expiry cleanup;
- a scheduler, hosted service, or queue.

## 9. Database and migration expectation

Expected schema impact: **none**.

The merged BE-003.2 migration already contains:

- `BookingHoldStatus.Cancelled`;
- `ReservationStatus.Cancelled`;
- `CancelledAtUtc`;
- `CancellationReason`;
- the required cancellation consistency check;
- committed-demand indexes.

Do not edit a merged migration or model snapshot. If implementation genuinely
requires a schema change or a seventh migration, stop and report `BLOCKED` with
the exact reason instead of creating it silently.

## 10. HTTP and OpenAPI contract

Document all three new operations without real secrets or token examples.

Required status coverage:

| Endpoint | Success | Validation | Credential | Not found/foreign | Conflict |
| --- | --- | --- | --- | --- | --- |
| Hold read | `200` | — | `401` | `404` | — |
| Hold cancel | `200` | — | `401` | `404` | `409` |
| Reservation cancel | `200` | `400` | `401` | `404` | `409` |

OpenAPI must describe:

- optional customer cookie ownership;
- `X-Booking-Access-Token` as the opaque guest credential, not a bearer scheme;
- `X-CSRF-TOKEN` on both unsafe cancellation endpoints;
- the required Reservation cancellation reason and 500-character limit;
- first-call and idempotent-replay behavior;
- the non-disclosing `404` policy;
- the Property-local check-in-date cutoff.

Errors use the existing Problem Details convention.

## 11. Required test matrix

Use unit tests for pure Domain/Application behavior and real PostgreSQL 17
integration tests for persistence, API, transaction, locking, time-zone,
security, and Availability behavior. Do not use EF InMemory or SQLite.

### 11.1 Domain and Application

Cover at minimum:

- Hold `Active -> Cancelled`;
- Hold cancellation replay;
- Hold cancellation rejects `Confirmed`;
- expired-but-persisted-Active Hold can transition to `Cancelled`;
- Reservation `Confirmed -> Cancelled`;
- required/trimmed/max-length reason behavior;
- non-UTC rejection where applicable;
- cancellation before the local check-in date;
- rejection at the exact local-date boundary and after it;
- Reservation cancellation replay preserves original timestamp/reason and
  succeeds after the cutoff;
- all immutable fields and nights remain unchanged;
- guest-token missing/malformed/valid resolution;
- authenticated and OR-ownership resolution;
- customer-safe mapping never exposes hashes or raw tokens.

### 11.2 API and ownership

For Hold read, Hold cancel, and Reservation cancel, cover:

- guest owner success;
- authenticated owner success;
- logged-in caller plus correct guest token success for a guest resource;
- missing credential `401`;
- malformed token `401`;
- invalid customer cookie `401`;
- missing resource and foreign resource indistinguishable as `404`;
- unrelated guest token;
- cross-Hold/cross-Reservation token reuse;
- matching contact email without ownership;
- antiforgery enforced on both cancellation POSTs;
- GET Hold read does not require antiforgery;
- raw guest token is absent from every read/cancel response and replay.

### 11.3 Lifecycle, expiry, Availability, and concurrency

Cover at minimum:

- Availability releases the exact room count on every night after Hold
  cancellation;
- Availability releases the exact room count on every night after Reservation
  cancellation;
- an expired Hold is excluded at the exact expiry boundary without cleanup;
- cancelling an already expired Hold does not change Availability incorrectly;
- simultaneous cancel requests are idempotent and preserve one terminal
  result;
- Hold cancel racing Hold confirm is serialized: exactly one terminal
  transition wins, the loser receives the correct existing-state response, and
  committed demand remains coherent;
- Reservation cancel racing new-Hold creation for the last room is serialized
  by the shared inventory locks and cannot overbook;
- multi-night cancellation and overlapping creation use the shared ascending
  lock order and complete without deadlock;
- a Reservation cancellation blocked on an inventory lock rechecks the
  Property-local cutoff using time captured after the wait;
- cancellation of a deactivated Property/catalog selection still succeeds for
  the owner;
- natural request cancellation and at least one forced mid-transaction failure
  prove rollback, lock release, and no partial state for the new mutation
  paths;
- replay short-circuits before unnecessary inventory-lock waits;
- existing confirmation replay coherence and availability invariance tests
  remain green.

Concurrency tests must prove the request acquired the intended lock; do not
write a test whose blocker merely observes the lock it acquired itself.

### 11.4 OpenAPI and architecture

Cover:

- exact new paths and methods;
- status codes, headers, cookie security alternative, request schema, and no
  real credential examples;
- Domain/Application dependency guards;
- no frontend or admin changes;
- no unexpected package dependency;
- no migration/model-snapshot drift.

## 12. Documentation scope

Add:

- `docs/BE-003-5-CANCELLATION-LIFECYCLE-HARDENING.md`

Update only the relevant sections of:

- `README.md`;
- `docs/ARCHITECTURE.md`;
- `docs/DATABASE.md`;

so they accurately describe the completed BE-003 lifecycle. Include the
previously deferred README link to
`docs/BE-003-3-ATOMIC-BOOKING-HOLD.md` while adding the BE-003.5 link.

Document:

- the three endpoint contracts;
- ownership/disclosure and CSRF behavior;
- cancellation state machines and replay behavior;
- Property-local cutoff;
- transaction and advisory-lock order;
- logical expiry without cleanup;
- Availability release;
- zero-migration impact;
- explicit deferred work.

Do not edit Control Tower governance, daily plan, worklog, Snapshot, or Project
Bible files unless they are explicitly part of the repository task and this
prompt is amended.

## 13. Explicit scope out

- Customer Web or Admin Web changes.
- Payment, webhook, refund, fee, reconciliation, or payment status.
- Cancellation fee, refund policy, no-show, modification, rebooking, or
  reinstatement.
- Guest booking claim/link to an account.
- Lookup or cancellation by confirmation number, email, or phone.
- Email/SMS notification.
- Social login, verification, recovery, MFA, or staff roles.
- PMS, OTA, channel manager, room-unit assignment, check-in/check-out, folio,
  invoice, housekeeping, or maintenance.
- Persisted `Expired` status or background cleanup.
- Deleting Hold, Reservation, or night records.
- Changing price/contact/stay snapshots during cancellation.
- Frontend integration.
- Deployment or production secrets.

## 14. Acceptance criteria

1. Baseline is exactly the merged PR #13 commit.
2. All 364 baseline tests pass before implementation.
3. Owned Hold read works for guest and authenticated owners.
4. Hold read never returns a raw guest token or exposes a foreign resource.
5. Active Hold cancellation is atomic and returns the cancelled snapshot.
6. Expired Active Hold may be explicitly cancelled without restoring or
   double-releasing inventory.
7. Cancelled Hold retry is `200` and does not mutate state.
8. Confirmed Hold cancellation is rejected with `409`.
9. Confirmed Reservation cancellation succeeds only before the Property-local
   check-in date.
10. The exact local-date boundary and later attempts return `409`.
11. Cancelled Reservation retry remains `200` after the cutoff and preserves
    its original timestamp and reason.
12. Reservation reason validation matches the existing 500-character
    Domain/schema rule.
13. All cancellation timestamps come from server `TimeProvider` UTC time.
14. Both mutation paths use explicit PostgreSQL transactions and the approved
    lifecycle-then-inventory lock order.
15. Concurrent cancel/confirm/create operations cannot overbook, deadlock, or
    produce incoherent terminal state.
16. Successful cancellation releases the exact committed demand atomically
    across all nights.
17. Rollback and request cancellation leave no partial state and release all
    transaction-scoped locks.
18. Missing/malformed credentials produce `401`; missing/foreign resources
    share non-disclosing `404`; invalid transitions produce `409`.
19. Both cancellation endpoints enforce antiforgery; Hold GET does not.
20. OpenAPI fully documents the new contract without real secrets.
21. No migration or model-snapshot change exists; the migration chain remains
    exactly six migrations.
22. Release build has zero warnings and zero errors.
23. All existing and new tests pass with zero failures and zero skips.
24. No secret, PII, raw token, cookie, idempotency key, production connection
    string, generated artifact, frontend change, or unrelated diff is present.
25. Documentation closes BE-003 accurately and names deferred work.

## 15. Required final verification

Run and report exact results for:

```text
dotnet restore Back_End/TheBha.Booking.sln --verbosity minimal
dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
dotnet ef migrations list
dotnet ef migrations has-pending-model-changes
git diff --check
git status --short --branch
```

Also:

- apply the full migration chain to a clean PostgreSQL 17 database;
- inspect the PostgreSQL catalog to confirm cancellation columns/constraints
  remain valid and no seventh migration is needed;
- run the new targeted concurrency tests repeatedly to detect timing flakes;
- run the full Release test suite **three consecutive times** after the final
  code change;
- review the complete diff for scope, secrets, PII, raw tokens, logs,
  generated files, and accidental frontend/migration changes;
- verify the Draft PR CI is green.

Do not report only “tests pass.” Report unit/integration counts, failures,
skips, build warnings/errors, migration count, and CI conclusion.

## 16. Suggested commit sequence

Keep commits reviewable and independently coherent:

1. `feat(booking): add hold and reservation cancellation transitions`
2. `feat(booking): add hold read and cancellation application contracts`
3. `feat(booking): add atomic PostgreSQL cancellation workflows`
4. `feat(api): expose booking lifecycle read and cancellation endpoints`
5. `test(booking): harden cancellation expiry and concurrency lifecycle`
6. `docs(backend): close BE-003 reservation lifecycle`

Adjust the exact split only if required for compilable checkpoints. Do not
squash or rewrite published history unless Hồ Đình Lâm explicitly requests it.

## 17. Draft PR contract

Open one Draft PR:

- base: `develop`
- head: `feature/be-003-5-cancellation-lifecycle-hardening`
- suggested title:
  `feat(backend): add cancellation and lifecycle hardening (BE-003.5)`

The PR body must state:

- outcome and exact endpoints;
- state-transition and idempotent replay rules;
- ownership/disclosure/CSRF contract;
- Property-local cutoff;
- PostgreSQL transaction and lock ordering;
- Availability and expiry behavior;
- migration impact;
- exact tests and repeated concurrency evidence;
- explicit scope exclusions;
- confirmation that the PR is not merged.

## 18. Stop and escalate

Stop and report `BLOCKED` if:

- `origin/develop` is not the verified baseline;
- existing tests fail before implementation;
- a pre-existing local change overlaps the task and cannot be preserved;
- a seventh migration or merged-migration edit appears necessary;
- cancellation cannot use the established cookie/guest-token/CSRF model;
- the Property-local cutoff would require accepting client-controlled time or
  time zone;
- the approved lock order conflicts with actual merged lifecycle locking;
- payment, refund, fee, frontend, staff authorization, background cleanup,
  guest claiming, deployment secrets, or external PMS/OTA work becomes
  necessary;
- a production credential, domain, or secret is required;
- any acceptance criterion cannot be met without expanding scope.

Do not silently choose a new architecture. Report:

1. the exact blocker;
2. evidence from the repository/test;
3. the smallest decision required from Control Tower;
4. safe options and trade-offs;
5. current branch/status with confirmation that nothing was merged.

## 19. Completion report

Return exactly this structure:

```text
CLAUDE CODE COMPLETION REPORT
Status: PASS / BLOCKED
Work item / branch / verified base SHA:
Outcome delivered:
Files and behavior changed:
Database/migration impact:
API/OpenAPI impact:
Ownership/cookie/guest-token/CSRF design:
Cancellation and Property-local cutoff behavior:
Transaction/advisory-lock behavior:
Availability/expiry behavior:
Tests run and exact unit/integration/repeat results:
Migration and clean-database evidence:
Security/secret/PII/scope checks:
Acceptance criteria checklist:
Commit SHAs / Draft PR URL:
CI conclusion:
Deviations from scope:
Risks and deferred work:
Recommended next action:
Explicit confirmation: not merged
```

End after the completion report. Do not merge, delete the branch, update the
next work item, or start post-BE-003 work.

Lưu ý là phải trả report bằng tiếng Việt.