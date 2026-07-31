# CLAUDE CODE REMEDIATION PROMPT — PR #13 / BE-003.4

You are continuing an existing, already implemented work item. This is a
remediation pass after Control Tower review, not a new feature task.

## 1. Repository and pull-request guardrails

- Repository: `emLamHD/The_BHA_hotels_Booking`
- Existing branch: `feature/be-003-4-hold-confirmation-reservation-read`
- Existing Draft PR: <https://github.com/emLamHD/The_BHA_hotels_Booking/pull/13>
- PR base: `develop`
- Verified PR base SHA before remediation:
  `0dea6e571b64eb4d2933498beec48031cc7942d9`
- Expected current branch head before remediation:
  `6b14bde39eb46715b582f04c5d862350f36eb1ee`
- Current PR state: open, Draft, not merged.
- Current verified CI state: green, 325/325 tests before remediation.

First read and obey the repository's root `CLAUDE.md` and every source-of-truth
document it requires, in its required order. Inspect the existing PR diff and
the BE-003.3/BE-003.4 documentation before editing.

Then verify:

1. You are at the correct repository root and on the branch above.
2. The working tree is clean.
3. Local HEAD and remote branch head match the expected SHA above.
4. PR #13 still targets `develop`, is open and Draft, and has not been merged.

If the branch head has changed through work that is not already understood and
authorized in this session, or the working tree contains unrelated changes,
stop and report the discrepancy. Do not overwrite, discard, amend, rebase, or
force-push anyone else's work.

Work only on the existing branch and Draft PR. Do not create another branch or
PR. Append remediation commits; do not rewrite or squash the six existing
commits. Do not merge, mark Ready, enable auto-merge, delete any branch, or push
directly to `develop` or `main`.

## 2. Control Tower verdict

`CHANGES REQUIRED`.

The existing implementation is broadly correct, but it is not yet mergeable.
Fix all three blocking defects and complete the missing mandatory regression
matrix below.

Preserve the already approved public API:

```text
POST /api/v1/booking-holds/{holdId}/confirm
GET  /api/v1/reservations/{reservationId}
```

Preserve the existing status-code, antiforgery, ownership, immutable-snapshot,
advisory-lock, Availability, and no-repricing contracts unless this prompt
explicitly tightens them.

## 3. Blocking defect A — Reservation ID does not contain 128 random bits

### Root cause

The first confirmation currently creates the Reservation ID with
`Guid.NewGuid()`. A UUID v4 reserves version/variant bits and therefore provides
only 122 random bits. Base32-encoding all 16 Guid bytes does not restore the
missing entropy.

The BE-003.4 contract requires the server-generated Reservation ID, from which
the confirmation number is derived one-to-one, to originate from a full
16 cryptographically random bytes.

### Required fix

1. Generate exactly 16 bytes with `RandomNumberGenerator` or an equivalent
   cryptographically secure OS-backed generator.
2. Construct the Reservation `Guid` from those exact bytes without applying
   UUID version/variant-bit normalization.
3. Reject and retry the all-zero result so `Guid.Empty` is impossible.
4. Use that same Reservation ID as the sole input to
   `ConfirmationNumberGenerator`; the confirmation number must remain a
   deterministic, one-to-one encoding of all 16 bytes.
5. Do not introduce a counter, timestamp-derived ID, database round trip,
   client-supplied value, second persisted idempotency field, or credential
   semantics for the confirmation number.
6. Keep the existing database schema and unique indexes unchanged.
7. Use a small injectable generator abstraction if that is the cleanest way to
   make the behavior deterministic in tests, following existing project
   conventions and Clean Architecture boundaries.

Production code on the confirmation path must no longer use `Guid.NewGuid()` to
create a Reservation ID. Tests may still use fixed or ordinary Guids as test
data.

### Required tests/evidence

- Generated Reservation IDs are never `Guid.Empty`.
- The confirmation-number format remains uppercase, bounded, pattern-valid,
  culture-invariant, deterministic for the same ID, and different for
  different IDs.
- Add a deterministic test showing the encoder preserves distinctions in bits
  that UUID v4 would normally reserve; all 128 input bits participate in the
  one-to-one output.
- If an injectable random-byte seam is introduced, deterministically prove
  that an all-zero 16-byte result is rejected and generation retries.
- The existing “1,000 values have no collision” test may remain as a smoke
  test, but it must not be presented as evidence of 128-bit entropy.

## 4. Blocking defect B — Idempotent replay does not validate snapshot coherence

### Root cause

After authorization, when a Reservation already exists for
`SourceHoldId == holdId`, the normal replay path returns `200` immediately.
It does not prove that the stored Reservation is actually the immutable copy of
that Hold. The defensive `SourceHoldId` unique-violation recovery path has the
same weakness.

Idempotency must never turn inconsistent or corrupted persistence state into a
successful replay.

### Required fix

Create one shared, side-effect-free replay-coherence check and use it in both:

1. the normal existing-Reservation replay path; and
2. the defensive unique-violation recovery path.

The check must compare the existing Reservation against the source Hold using
exact snapshot semantics. At minimum it must verify:

- `Reservation.SourceHoldId` equals the Hold ID;
- exclusive ownership fields match exactly:
  `CustomerAccountId` and `GuestAccessTokenHash`;
- property, RoomType, RatePlan, check-in and check-out match;
- full name, email and phone match exactly as stored on the Hold;
- adults, children and rooms match;
- currency and total amount match;
- Reservation nights match Hold nights exactly as a logical set/ordered
  sequence after stable date ordering:
  - same count;
  - same stay dates;
  - same rooms;
  - same unit amounts;
  - same nightly totals;
- the source Hold is in the state expected after a successful confirmation.

Do not re-normalize, reprice, recompute from current RatePlan/catalog data, or
silently repair either aggregate during replay.

If coherence fails:

- fail closed;
- do not return a Reservation DTO;
- do not create another Reservation;
- do not mutate the Hold or existing Reservation;
- return a safe `409 Conflict` for an already-authorized owner, with no stored
  PII, token hash, database detail, or field-by-field mismatch disclosure;
- keep foreign/missing-resource behavior non-disclosing (`404`) by retaining
  ownership authorization before replay disclosure.

After a `DbUpdateException`, respect EF Core/PostgreSQL transaction state:
rollback/dispose the failed transaction and clear or replace poisoned tracking
state before any defensive re-read. Do not expose raw unique-constraint or
provider errors.

Do not duplicate two slightly different coherence implementations. Both replay
paths must call the same logic.

### Required tests/evidence

- A coherent sequential replay still returns `200` with the exact original
  Reservation ID, confirmation number, `ConfirmedAtUtc`, total and nights.
- A coherent concurrent same-Hold confirmation still persists exactly one
  Reservation.
- Deliberately inconsistent ownership, contact, stay/occupancy/financial data,
  or night snapshots cannot replay successfully and cause no mutation.
- A mismatched state returns safe `409`, not `200`, and leaks no mismatch
  values.
- Prove by test or by a single shared method plus targeted tests that the
  defensive unique-violation recovery path applies exactly the same coherence
  gate.
- Do not add a production-only lock bypass or a production test hook merely to
  force the unique-violation branch. If no safe deterministic race can reach it
  without distorting production design, test the shared coherence component
  exhaustively and document why both callers are mechanically identical.

## 5. Blocking defect C — Cancellation test observes the blocker, not the request

### Root cause

The current cancellation test holds `ForHoldTransition` with its blocker
connection. `WaitUntilLockIsHeldAsync()` can therefore observe the blocker
itself; it does not prove that the HTTP confirmation request started its
transaction, acquired the Hold-transition lock, or released it when cancelled.

### Required replacement test

Build a deterministic PostgreSQL integration test with this sequence:

1. Create a valid active Hold.
2. An external blocker transaction acquires an inventory advisory lock needed
   by that Hold. The blocker must not acquire the Hold-transition lock.
3. Start the confirmation request with a cancellable token.
4. Prove through a separate probe connection/transaction that the request has
   acquired `ForHoldTransition(holdId)` and is blocked waiting for inventory.
   The observation must distinguish the request lock from every blocker lock.
5. Cancel the request while the inventory blocker remains open.
6. Assert the request ends through cancellation rather than success.
7. While the inventory blocker is still open, prove the Hold-transition lock
   becomes acquirable again.
8. Assert the Hold remains Active and no Reservation or ReservationNight was
   persisted.
9. Release/rollback the blocker in `finally` cleanup.

Polling must be bounded by a timeout. The test must not hang indefinitely or
pass merely because it observed its own probe/blocker lock.

### Required forced-rollback test

Add another deterministic PostgreSQL integration test:

1. Let the confirmation operation acquire both its Hold-transition lock and all
   required inventory locks.
2. Force a failure after those locks have been acquired but before commit.
3. Prove both lock classes are released after rollback.
4. Prove no partial Reservation/ReservationNight exists and the Hold remains
   Active.

Prefer a test-host-only `DbCommandInterceptor`, a temporary test-database
failure mechanism, or another isolated integration-test technique. Do not add
test-only branches, failpoints, lock bypasses, or environment switches to
production code. Clean up all test database objects/connections in `finally`.

## 6. Complete the missing mandatory regression matrix

Add focused tests for every scenario below.

### 6.1 Multi-night lock order and deadlock freedom

- Run concurrent confirmations for overlapping multi-night Holds that contend
  on more than one inventory key.
- Use sufficient valid inventory so both business operations may succeed.
- Assert both operations complete within a bounded timeout, no PostgreSQL
  deadlock occurs, and each Hold produces exactly one coherent Reservation.
- The implementation must continue using the exact BE-003.3 inventory-lock
  identity and ascending stay-date order. Do not create a second ordering
  scheme.

### 6.2 Replay after the original Hold expiry time

- Confirm once while the Hold is valid.
- Advance server time to the exact expiry boundary or later.
- Replay confirmation and assert `200` with the identical Reservation.
- Prove replay does not reprice, refresh timestamps, create another
  Reservation, or become a `409` merely because the original expiry time has
  passed.
- Prefer additionally blocking an inventory key to show coherent replay
  short-circuits without waiting for inventory locks.

### 6.3 Server/catalog changes after Hold creation but before first confirmation

The active Hold is already committed demand and is an immutable commercial
snapshot. After creating the Hold, mutate current server state before the first
confirmation:

- enable stop-sell for the held offer/date;
- reduce the current sellable limit below the held quantity;
- change or deactivate relevant current catalog entities, including
  representative RoomType/RatePlan/PhysicalRoom state;
- retain the already covered current-rate-change scenario.

First confirmation must still use and persist the Hold snapshot without
repricing or revalidating current commercial/catalog availability. It must not
overbook or change the Availability committed-demand invariant.

Do not weaken Hold-creation validation. These mutations are permitted only
after a valid Hold already exists.

### 6.4 Ownership-negative cases

- A well-shaped guest token cannot confirm an authenticated/customer-owned Hold
  when no owning customer session is present. Return non-disclosing `404`, not
  success.
- A token for guest Hold A cannot confirm or read guest Hold/Reservation B,
  even when both records use identical email, full name or phone.
- An authenticated account whose email/contact text matches a guest-owned
  Hold/Reservation does not own it without the correct guest token.
- Confirmation number, source Hold ID, email, phone and full name remain
  non-credentials.
- Preserve approved OR semantics for a caller who genuinely owns the resource
  through either the customer session or the correct guest token.

Cover confirmation and Reservation read wherever the same ownership resolver
or store predicate could regress.

## 7. Commit plan

Keep the remediation reviewable. Append small commits in this order unless the
existing dependency structure requires a clearly explained minor adjustment:

1. `fix(booking): use full-entropy reservation identifiers`
2. `fix(booking): validate confirmation replay coherence`
3. `test(booking): prove confirmation lock rollback semantics`
4. `test(booking): complete confirmation regression matrix`
5. `docs(booking): update BE-003.4 remediation evidence` — only if tracked
   documentation or PR evidence actually needs updating.

After each commit:

- run its focused unit/integration tests;
- inspect the staged diff before committing;
- include only files belonging to that behavior cluster;
- do not amend or squash earlier PR commits;
- stop immediately if a focused gate fails and fix that cluster before
  continuing.

Do not manufacture empty commits merely to match this list. Do not combine all
remediation into one opaque commit.

## 8. Scope exclusions

Do not implement or modify:

- Hold read;
- Hold cancellation;
- Reservation cancellation;
- persisted expiry/background cleanup;
- payment;
- guest-to-account claim/linking;
- frontend or Admin/PMS behavior;
- new migration or EF model snapshot;
- new database columns, indexes or constraints;
- seed data or startup migration behavior;
- unrelated refactors or formatting;
- the pre-existing missing README link for BE-003.3.

`BE-003.5` remains `WAITING` and must not be started.

If a correct remediation appears to require a migration, schema/model-snapshot
change, public contract change, ownership-policy change, or BE-003.5 behavior,
stop and report the blocker to the Operations Coordinator. Do not improvise.

## 9. Mandatory verification

After all remediation commits, run from the repository root using the
repository's documented commands:

1. `dotnet restore Back_End/TheBha.Booking.sln`
2. Release build of the full backend solution:
   - 0 warnings;
   - 0 errors.
3. Focused unit tests for Reservation ID generation and confirmation-number
   encoding.
4. Focused replay/coherence tests.
5. Focused real-PostgreSQL confirmation, concurrency, authorization,
   cancellation and rollback tests.
6. Full backend test suite in Release with `--no-build`:
   - 0 failed;
   - 0 skipped.
7. `git diff --check`
8. EF pending-model check:
   - no pending model changes.
9. EF migration list:
   - still exactly the existing six migrations.
10. Inspect `git diff origin/develop...HEAD` and confirm:
    - no migration/model-snapshot change;
    - no `Front_End/` change;
    - no generated `bin/` or `obj/` artifact;
    - no secret, connection string, raw guest token, token hash, cookie or PII
      logging;
    - no scope creep into BE-003.5.
11. Push the appended commits to the same remote feature branch.
12. Verify PR #13 remains open and Draft and that its new CI run succeeds.
13. Update the Draft PR description only where needed to replace stale test
    counts and accurately describe the new entropy, coherence and lock evidence.
    Do not mark it Ready or merge it.

Do not claim `PASS` from local tests alone if the newly pushed PR CI is failing
or still incomplete. If CI cannot be observed, state that precisely in the
report rather than guessing.

## 10. Required completion report

Return one `CLAUDE CODE REMEDIATION COMPLETION REPORT` containing:

- Status: `PASS` or `BLOCKED`;
- work item, branch, verified starting SHA and final head SHA;
- root cause and exact fix for each of the three blockers;
- the shared replay-coherence fields and failure behavior;
- how the cancellation test proves the request's lock rather than the blocker;
- how forced rollback was triggered and how both lock classes were verified as
  released;
- every new/updated test grouped by the regression matrix above;
- exact focused and full test counts, failures and skips;
- exact Release build warning/error counts;
- EF pending-model and migration-list results;
- commit SHA and subject for every appended remediation commit;
- final Draft PR URL and CI result;
- files/scope summary;
- deviations, unresolved risks or intentionally unforced defensive paths;
- explicit confirmations:
  - PR #13 is still Draft and not merged;
  - no history was rewritten;
  - no branch was deleted;
  - no migration/model snapshot/frontend change was made;
  - `BE-003.5` was not started.

Do not merge. The next action after a successful report is Control Tower
re-review of the updated Draft PR #13.
