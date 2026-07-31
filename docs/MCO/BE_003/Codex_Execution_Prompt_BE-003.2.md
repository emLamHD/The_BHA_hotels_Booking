# CODEX EXECUTION PROMPT — BE-003.2 HOLD AND RESERVATION DOMAIN FOUNDATION

## Role and authority

You are the implementation agent for **The BHA Hotels** backend.

- Work item: `BE-003.2 — Hold and reservation domain foundation`
- Control Order: `CT-BE-003`
- Repository: `emLamHD/The_BHA_hotels_Booking`
- Target branch: `develop`
- Working branch: `feature/be-003-2-hold-reservation-domain-foundation`
- Verified `origin/develop` baseline: `c965989b77f9bfc3a4a5790a971d772a1a53e87c`
- Baseline source: merge commit of PR #9, `BE-003.1`
- Merge authority: **Hồ Đình Lâm only**
- You may create commits, push the working branch, and open a **Draft PR** targeting `develop`.
- You must **not merge** the PR and must not push directly to `develop` or `main`.

Implement only `BE-003.2`. This task establishes Domain and PostgreSQL persistence foundations for Booking Hold and Reservation. It must not add public booking mutations, committed-demand changes, advisory locking, guest-token transport, confirmation/cancellation use cases, or frontend behavior.

`BE-003.3`, `BE-003.4`, and `BE-003.5` remain out of scope and must not be started.

## Required startup sequence

1. Read and obey repository governance and project-context files, if present, in this order:
   1. `RULES.md`
   2. `PROJECT_BIBLE.md`
   3. `SNAPSHOT.md`
   4. the current daily plan/worklog relevant to BE-003
   5. every applicable `AGENTS.md`
2. Inspect the current repository rather than assuming paths or conventions. Pay particular attention to:
   - Domain entity construction and invariant patterns;
   - EF Core entity configurations, naming, indexes, alternate/composite keys, check constraints, delete behavior, and timestamp mappings;
   - `Property`, `RoomType`, `RatePlan`, `DailyRoomRate`, and `DailyInventoryControl`;
   - the `CustomerAccount` persistence added by `BE-003.1`;
   - migration and PostgreSQL integration-test conventions;
   - architecture tests and documentation conventions.
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
7. The verified post-`BE-003.1` reference is:
   - five applied migrations;
   - **142 passing tests**: 67 unit/application/architecture and 75 PostgreSQL integration tests;
   - 0 failed and 0 skipped;
   - Release build with 0 warnings and 0 errors.
8. If the actual baseline fails for a reason outside this task, or overlapping user changes cannot be preserved safely, stop and report `BLOCKED`.
9. Create the working branch from the verified latest `origin/develop`. Do not reuse a stale branch.

Do not assume exact namespaces, filenames, commands, or implementation types. Discover and follow the repository.

## Outcome

Add a persistence-ready domain foundation for the locked lifecycle:

1. A future command can create a `BookingHold` for one Property, one RoomType, one RatePlan, and a half-open stay range.
2. The Hold owns immutable nightly price snapshots and expires exactly 15 minutes after server-controlled creation time.
3. Ownership can be either a nullable authenticated `CustomerAccountId` or a guest access-token hash.
4. A future atomic confirmation command can create exactly one `Reservation` from a Hold.
5. The Reservation can own an immutable copy of the Hold’s contact, stay, ownership, and nightly price snapshots.
6. PostgreSQL protects structural invariants and uniqueness needed by later idempotency, confirmation, ownership, and committed-demand work.

This task delivers domain types, EF mappings, one additive migration, focused tests, and documentation. It exposes no new booking API.

## Locked business rules

- Booking starts with a Hold; no direct Reservation creation flow is public.
- Hold lifetime is exactly 15 minutes:

  ```text
  ExpiresAtUtc = CreatedAtUtc + 15 minutes
  ```

- Time is UTC and server-controlled. Future callers will obtain the current instant through `TimeProvider`; no client-supplied current time or expiry duration is accepted.
- Stay dates use `DateOnly` and a half-open interval:

  ```text
  CheckIn <= StayDate < CheckOut
  ```

- A booking uses one Property, one RoomType, and one RatePlan.
- Inventory is shared among RatePlans for the same RoomType.
- Both guest and authenticated booking are supported.
- `CustomerAccountId` is nullable:
  - non-null for authenticated ownership;
  - null for guest ownership.
- A booking always keeps a contact snapshot containing full name, email, and phone. Do not infer ownership from matching email.
- Hold and Reservation store currency, total, and immutable nightly price snapshots.
- Rate changes after Hold creation must never rewrite existing snapshots.
- No tax, surcharge, discount, currency conversion, payment, refund, or payment status is introduced.
- Confirmation and cancellation are future lifecycle tasks. Do not implement their Application/API workflows here.
- Expiration must remain logically correct without a background cleanup job.
- Lifecycle operations must never require hard deletion of Hold or Reservation records.

## Aggregate and domain model target

Use repository-native entity/value-object patterns and keep the Domain independent of EF Core, ASP.NET Core, Identity, and transport types.

### `BookingHold` aggregate root

Persist at least:

- `Id`
- `PropertyId`
- `RoomTypeId`
- `RatePlanId`
- nullable `CustomerAccountId`
- contact snapshot: full name, email, phone
- `CheckIn`
- `CheckOut`
- `Adults`
- `Children`
- `Rooms`
- `CurrencyCode`
- `TotalAmount`
- `Status`
- `CreatedAtUtc`
- `ExpiresAtUtc`
- `IdempotencyKeyHash`
- `RequestFingerprint`
- nullable `GuestAccessTokenHash`
- owned/child collection of `BookingHoldNight`

At minimum, model states required by the approved lifecycle: active, confirmed, and cancelled. Expiry is a time-based condition for an otherwise active Hold; do not require a cleanup job or prematurely implement an expiry worker.

Provide a pure domain way to determine whether an active Hold is expired at a supplied UTC instant. The aggregate must derive the fixed expiry from its creation instant; it must not accept an arbitrary client-selected expiry.

Do not add public confirm/cancel handlers, controllers, or orchestration. Avoid implementing future state-transition behavior merely because the enum already exists.

### `BookingHoldNight`

Persist at least:

- `BookingHoldId`
- `StayDate`
- `Rooms`
- `UnitAmount`
- `NightTotal`

The aggregate must prevent duplicate stay dates. Night rows must cover the aggregate’s half-open stay range exactly once, in stable date order, with the same room quantity as the parent.

### `Reservation` aggregate root

Persist at least:

- `Id`
- `ConfirmationNumber`
- `SourceHoldId`
- `PropertyId`
- `RoomTypeId`
- `RatePlanId`
- nullable `CustomerAccountId`
- contact snapshot: full name, email, phone
- `CheckIn`
- `CheckOut`
- `Adults`
- `Children`
- `Rooms`
- `CurrencyCode`
- `TotalAmount`
- `Status`
- `ConfirmedAtUtc`
- nullable `CancelledAtUtc`
- nullable `CancellationReason`
- nullable `GuestAccessTokenHash`
- owned/child collection of `ReservationNight`

At minimum, model states required by the approved lifecycle: confirmed and cancelled.

Do not invent confirmation-number generation, confirmation orchestration, ownership authorization, or cancellation policy in this task. `BE-003.4` and `BE-003.5` own those behaviors.

### `ReservationNight`

Persist at least:

- `ReservationId`
- `StayDate`
- `Rooms`
- `UnitAmount`
- `NightTotal`

The aggregate must prevent duplicate stay dates. Night rows must cover the parent’s half-open stay range exactly once, in stable date order, with the same room quantity as the parent.

### Shared invariants

Enforce domain invariants at construction/mutation boundaries and duplicate critical structural safeguards in PostgreSQL where practical:

- all aggregate and referenced IDs are non-empty;
- `CheckIn < CheckOut`;
- `Adults >= 1`;
- `Children >= 0`;
- `Rooms >= 1`;
- contact full name, email, and phone are non-blank after trimming;
- currency is a normalized uppercase three-letter alphabetic code, consistent with the existing `RatePlan` convention;
- every nightly unit amount and night total is positive;
- `NightTotal = UnitAmount * Rooms`;
- aggregate `TotalAmount` is positive and equals the sum of its nightly totals;
- night dates are unique, contiguous, and exactly cover `[CheckIn, CheckOut)`;
- Hold creation and expiry instants are UTC and `ExpiresAtUtc` is exactly 15 minutes after `CreatedAtUtc`;
- Reservation confirmation time is UTC;
- cancelled timestamp, reason, and status cannot form an impossible persisted combination;
- ownership representation is unambiguous: authenticated resources reference a customer account; guest resources carry the required guest token hash; never derive ownership from contact email;
- hash/fingerprint representations have explicit, non-PII storage formats and lengths;
- raw guest tokens and raw idempotency keys are never persisted or logged.

Use explicit maximum lengths and decimal precision consistent with existing repository conventions. Where this order does not prescribe an exact contact-field limit or internal representation, choose the smallest repository-consistent design, document it, and cover it with tests. Do not introduce a broad new validation framework.

## Persistence and migration requirements

- Integrate the new aggregates into the existing `TheBhaDbContext` and Infrastructure mapping conventions.
- Add exactly one new additive EF Core migration after `20260723085814_CustomerBookingIdentity`.
- Do not modify, rename, regenerate, or reorder any of the five merged migrations.
- PostgreSQL 17 remains the only persistence target. Do not add EF InMemory or SQLite.
- Use PostgreSQL `date` for stay dates and the repository’s existing UTC timestamp convention for instants.
- Use the existing monetary precision convention, expected to be `numeric(18,2)` unless current code proves otherwise.
- Map aggregate-owned night collections without exposing mutable public collections.
- Add foreign keys from Hold and Reservation to:
  - Property;
  - RoomType;
  - RatePlan;
  - nullable CustomerAccount.
- Preserve same-Property ownership with existing composite/alternate-key patterns for `(PropertyId, RoomTypeId)` and `(PropertyId, RatePlanId)`.
- Use restrictive delete behavior for referenced catalog/customer data so booking history cannot be silently deleted through cascades.
- Choose and document aggregate-child delete behavior consistently with the repository while preserving the rule that lifecycle cancellation is never a delete.
- Enforce unique:
  - `(BookingHoldId, StayDate)`;
  - `(ReservationId, StayDate)`;
  - `Reservation.SourceHoldId`;
  - `Reservation.ConfirmationNumber`.
- Add the database uniqueness required for future concurrent idempotency replay of a Hold. The approved semantics are: same `Idempotency-Key` + same payload returns the same Hold; same key + different payload conflicts. Do not implement the API replay workflow yet.
- Add bounded indexes that support future committed-demand reads by Property, RoomType, StayDate, status, and expiry without speculative over-indexing.
- Add PostgreSQL check constraints for practical row-local invariants: positive counts/amounts, valid date order, currency shape, timestamp order/fixed Hold lifetime, hash length, allowed status values when required by the chosen enum mapping, and valid cancellation-state combinations.
- Do not attempt database checks for cross-row sums or contiguous date coverage if they cannot be expressed safely as row-local constraints; keep those in the aggregate and prove them with domain tests.
- Do not apply migrations automatically during API startup.
- Do not add booking rows to the Development seed. Holds and Reservations are transactional data, not stable catalog demo data.

Migration naming must describe the task and follow repository conventions, for example `AddBookingHoldReservationFoundation`; discover the final convention rather than copying this example blindly.

## Strict scope in

- Domain aggregates/entities/value objects/enums required for Hold and Reservation structure.
- Aggregate construction and structural invariant enforcement required to make invalid snapshots impossible.
- A pure Hold-expiry check at a supplied UTC instant.
- EF Core configurations, DbSets, relationships, indexes, check constraints, and one migration.
- Domain and PostgreSQL integration tests for mappings and invariants.
- Migration-chain and pending-model-change verification.
- Architecture and regression tests.
- Documentation of the domain/schema foundation and deliberately deferred behavior.

## Strict scope out

- Any new public or internal Application command/query for Hold or Reservation.
- `POST /api/v1/booking-holds`.
- Hold read, cancel, or confirm endpoints.
- Reservation read or cancel endpoints.
- Controllers, request/response DTOs, Problem Details additions, auth policies, or OpenAPI booking paths.
- Guest access-token generation, return, header parsing, or resource authorization.
- Idempotency middleware, replay orchestration, or HTTP header handling.
- PostgreSQL advisory-lock acquisition or concurrency orchestration.
- Availability/committed-demand query changes.
- Inventory decrement/update columns.
- Hold confirmation, confirmation-number generation, cancellation workflows, or state-transition orchestration.
- Background expiry cleanup.
- Payment, tax, surcharge, discount, currency conversion, refund, or webhook behavior.
- Customer Identity/auth changes beyond the minimum mapping needed for nullable FK integration.
- Social login, verification, recovery, MFA, roles, or Admin auth.
- Frontend changes.
- PMS, OTA, notifications, housekeeping, room assignment, check-in/out, folio, or invoice work.
- Broad refactors, new repositories/frameworks, or speculative abstractions not required by this foundation.

## Required tests

Add focused tests following repository conventions.

### Domain tests

Cover at least:

- valid guest Hold snapshot;
- valid authenticated Hold snapshot;
- exact 15-minute expiry;
- expiry boundary behavior at immediately before, exactly at, and after `ExpiresAtUtc`;
- invalid/non-UTC instants;
- invalid stay interval;
- zero/negative adults, children, or rooms;
- blank/invalid contact and currency data;
- duplicate, missing, extra, out-of-range, or non-contiguous Hold nights;
- night room-count mismatch;
- night-total mismatch and aggregate-total mismatch;
- positive decimal totals without floating-point arithmetic;
- valid guest and authenticated Reservation snapshots;
- Reservation source-Hold and confirmation-number requirements;
- duplicate/invalid Reservation nights;
- impossible Reservation status/cancellation timestamp combinations;
- no mutation path exposes raw token/idempotency material or mutable night collections.

Do not write tests for public Hold/Reservation endpoints because they must not exist yet.

### PostgreSQL integration tests

Use real PostgreSQL 17 and cover at least:

- full round trip for guest and authenticated Hold;
- full round trip for guest and authenticated Reservation;
- nullable CustomerAccount FK behavior and valid existing-account linkage;
- Property/RoomType/RatePlan same-Property ownership;
- required relationships and restrictive catalog/customer deletion;
- exact PostgreSQL column types for dates, timestamps, amounts, and binary/text hash representation;
- unique Hold-night and Reservation-night dates;
- unique Reservation `SourceHoldId`;
- unique `ConfirmationNumber`;
- unique idempotency-key hash needed by the future replay contract;
- row-local check constraints for invalid counts, amounts, dates, currency, timestamps, hashes, status/cancellation combinations;
- query-shape indexes required for future committed-demand lookup;
- no automatic/seeded booking data.

Where aggregate invariants are intentionally stronger than database row-local checks, state that boundary clearly in tests/documentation.

### Regression and architecture tests

- Domain remains independent of Infrastructure, EF Core, Identity, ASP.NET Core, and API.
- Application gains no booking workflow or forbidden transport dependency.
- Existing Identity Core mapping and all five previous migrations remain intact.
- Existing availability contract and OpenAPI contain no new booking mutation/read paths.
- No frontend files change.

## Mandatory verification

Run repository-native equivalents and report exact commands and results:

1. Restore the complete backend solution.
2. Release build with 0 warnings and 0 errors.
3. Run the full existing and new automated test suite.
4. Apply the complete migration chain from an empty PostgreSQL 17 database.
5. Verify the resulting schema through PostgreSQL catalog queries:
   - tables and columns;
   - PostgreSQL data types;
   - foreign keys and delete behavior;
   - unique constraints/indexes;
   - check constraints;
   - committed-demand support indexes.
6. Run:

   ```bash
   dotnet ef migrations has-pending-model-changes
   ```

   Use the correct project, startup project, context, configuration, and connection settings discovered from the repository.
7. Confirm the clean database has exactly the previous five migrations plus the one new `BE-003.2` migration and no pending migrations.
8. Run architecture tests.
9. Run OpenAPI regression tests proving no Hold/Reservation paths were added.
10. Run `git diff --check`.
11. Inspect `git diff --stat`, changed filenames, and the complete final diff.
12. Scan the diff and test output for:
    - secrets and real connection strings;
    - PII;
    - raw guest tokens;
    - raw idempotency keys;
    - cookie/CSRF values;
    - frontend changes;
    - edits to merged migrations;
    - public API/Application workflow scope creep;
    - `BE-003.3`–`BE-003.5` behavior.

Report the exact final test total and category split, including skipped tests. Do not merely state “tests pass.”

Do not weaken, delete, skip, or rewrite existing tests to obtain a green result.

## Acceptance criteria

Mark each item `PASS`, `FAIL`, or `BLOCKED` in the completion report:

1. `BookingHold` and `BookingHoldNight` model every field required by `CT-BE-003`.
2. `Reservation` and `ReservationNight` model every field required by `CT-BE-003`.
3. Domain invariants reject invalid IDs, contact, stay, occupancy, room count, currency, nightly snapshots, totals, time, ownership, and lifecycle-state combinations.
4. Hold expiry is derived as exactly 15 minutes and boundary behavior is deterministic using supplied UTC instants.
5. Night collections are immutable externally, unique, contiguous, and exactly cover `[CheckIn, CheckOut)`.
6. Guest and authenticated ownership representations are both supported without trusting contact email as identity.
7. Raw guest tokens and raw idempotency keys are neither persisted nor logged.
8. EF mappings persist both aggregates and their nights in PostgreSQL 17 using repository-consistent types and precision.
9. Property/RoomType/RatePlan ownership and nullable CustomerAccount relationships are protected by foreign keys.
10. Night uniqueness, Reservation `SourceHoldId`, ConfirmationNumber, and future Hold-idempotency uniqueness are enforced in PostgreSQL.
11. Practical row-local invariants are duplicated as PostgreSQL check constraints.
12. Required bounded indexes support future committed-demand lookup without adding Availability logic.
13. Exactly one additive migration follows the five merged migrations; no merged migration is edited.
14. The complete six-migration chain applies to a clean PostgreSQL 17 database, and EF reports no pending model changes.
15. No booking rows are added to Development seed and API startup still does not auto-migrate.
16. Existing Identity, catalog, pricing, inventory-control, Availability, health, architecture, and OpenAPI behavior remains green.
17. Release build has 0 warnings and 0 errors; all existing and new tests pass with 0 unexplained skips.
18. No public/internal booking workflow, controller, DTO, guest-token transport, idempotency orchestration, advisory lock, committed-demand change, confirmation, cancellation, frontend, or payment behavior appears in the diff.
19. No secret, production credential, real connection string, sensitive token material, or accidental PII logging appears in diff/output.
20. Documentation describes the new domain/schema foundation and explicitly defers `BE-003.3`–`BE-003.5`.

## Mandatory stop conditions

Stop immediately and report `BLOCKED` without widening the design if:

- latest `origin/develop` does not contain the verified `BE-003.1` merge or conflicts with this order;
- the existing customer-account key cannot be referenced by nullable booking ownership without a material Identity redesign;
- Property/RoomType/RatePlan ownership cannot be protected using existing relational keys without changing merged catalog behavior;
- a required invariant cannot be protected in Domain/PostgreSQL without a new business or architecture decision;
- the migration is destructive, rewrites a merged migration, threatens existing data/schema, or cannot apply after the current chain;
- baseline restore/build/tests fail for a reason outside this task;
- implementation requires a secret, production credential/domain, or unavailable access;
- implementation would require any Application/API booking workflow, Availability committed demand, advisory locking, guest-token transport, confirmation/cancellation behavior, payment, frontend, or another later task;
- overlapping uncommitted user changes cannot be preserved safely.

If an exact internal representation is not prescribed but can be chosen safely from current repository conventions without changing business behavior, choose the smallest consistent design, document it, and test it. Escalate only when the choice changes a locked contract, invariant, migration safety, or later task boundary.

## Git and Draft PR procedure

After all verification passes:

1. Review `git status`, changed filenames, and the complete diff.
2. Commit only files belonging to `BE-003.2` with an intentional commit message.
3. Push `feature/be-003-2-hold-reservation-domain-foundation`.
4. Open a **Draft PR** targeting `develop`.
5. In the PR body include:
   - outcome and strict deferred scope;
   - aggregate/invariant design;
   - schema, relationship, index, and check-constraint decisions;
   - migration name and clean-chain evidence;
   - exact build/test totals;
   - PostgreSQL catalog evidence;
   - API/OpenAPI non-impact;
   - security/scope scans;
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
Domain aggregates and invariants:
Database/migration impact:
API/OpenAPI impact:
Tests run and exact results:
PostgreSQL catalog/migration evidence:
Security/secret/scope checks:
Acceptance criteria checklist:
Commit SHA / Draft PR URL:
Deviations from scope:
Risks and deferred work:
Recommended next action:
Explicit confirmation: BE-003.3 not started; not merged
```

Do not claim `PASS` unless implementation, all mandatory verification, commit, push, and Draft PR creation succeed. If any gate fails, use `BLOCKED`, state the first blocking fact precisely, preserve the gathered evidence, and do not start a later task.
