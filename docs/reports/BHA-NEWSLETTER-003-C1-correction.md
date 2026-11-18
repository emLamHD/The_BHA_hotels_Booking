# BHA-NEWSLETTER-003-C1 — correction report

- Work item: `BHA-NEWSLETTER-003`, correction `BHA-NEWSLETTER-003-C1` (implementer CLAUDE, reviewer CODEX_READ_ONLY)
- Branch `feature/bha-newsletter-003-management-welcome`, Draft PR #134, base `feature/bha-newsletter-002-email-verification`
- `START_HEAD` `1fac52df1715a52cd2c0fede15eff400fd0f8277`, fix commits `9ea9a81801ef2c7abfa95505a3285ff5f9a46fc8` (the three findings) and `4e330893d9e3382c040bca72e258e07ec3e82c0e` (narrowed `Down` guard); the tested code SHA is `4e33089`
- Scope kept to `NewsletterSubscriptionService`, migration `AddNewsletterManagement`, their tests and this report. No frontend change was needed.

## Evidence per finding

Every test below was written first and run against the unfixed code (`1fac52d` + tests only).

### P2 #1 — unsubscribe token re-checked under the lock
- Cause: `UnsubscribeAsync` found the Welcome token, then waited for the subscription lock. Staff changing the address in that gap revoked the token, but the `UPDATE` only matched the subscription id.
- Fix: after `LockAsync`, the token is read again (hash, `Purpose = Welcome`, same subscription, `RevokedAtUtc IS NULL`) from what is committed then. If it is gone the transaction rolls back and the answer is `Invalid`. Lock order is unchanged (subscription, then its mails).
- Test `An_unsubscribe_link_read_before_Staff_changed_the_address_is_void_when_it_gets_the_lock`: the test SQL gate (new `afterRead` mode) parks the request right after its token lookup. Staff change the address A to B through the real API and invite B. The request is released.
  - Before the fix: `200 unsubscribed` (B unsubscribed).
  - After the fix: `400 newsletter-unsubscribe-invalid`. B stays `PendingVerification`, its version is unchanged, its confirmation mail is still `Pending`, and the worker sends it to B afterwards.
- Test `A_valid_unsubscribe_link_still_works_when_an_unrelated_edit_lands_between_its_lookup_and_its_lock`: same park point, but Staff only change the language, so the link still unsubscribes. A replay returns `already-unsubscribed`. Existing tests still cover once, repeat and twelve at once.

### P2 #2 — `AlreadyVerified` only for a verified address
- Cause: in the not-spendable branch of `ConfirmAsync`, `UsedAtUtc IS NOT NULL` matched before the status was looked at.
- Fix: the answer is decided from the row read under the lock. `Invalid` when the link is unknown or revoked, `AlreadyVerified` only when the address is `Verified`, `Invalid` when it is `Unsubscribed` or the link was used and the address is pending again, otherwise `Expired`.
- Test `A_used_confirmation_link_answers_for_the_state_the_address_is_in_now` walks the whole chain:
  - confirm, replay while verified: `200 already-verified`, still one Welcome;
  - unsubscribe, replay the old link: `400 invalid`, stays `Unsubscribed`, no Welcome;
  - subscribe again, replay the old link: `400 invalid`, stays `PendingVerification`, no Welcome;
  - confirm with the new link: `200 verified`, exactly one more Welcome (two in total, one `Pending`), and a replay is `already-verified`.
  - Before the fix the replay after unsubscribing returned `200 already-verified`.
- Customer Web needed no change, and its tests were not rerun (no frontend file changed). `lib/newsletterApi.ts` maps `400` to `invalid` (error tone) and only `200 already-verified` to the success `already` state; this is already pinned in `newsletterConfirmApi.test.ts`.
- Note for test authors: the test clock stands still, and `UX_NewsletterVerificationRequests_WelcomePerVerification` refuses a second Welcome for the same verification instant (a 500 in the first draft of the test). The test advances the clock between rounds; production time always does.

### P2 #3 — language backfilled in migration 24
- Fix, in the existing (unmerged) migration, right after the `Language` column is added: each subscription takes the `Language` of its latest verification request (`DISTINCT ON ("SubscriptionId")`, ordered by `CreatedAtUtc DESC, "Id" DESC`, so a tie on the instant always gives the same answer). Subscriptions without a request keep `vi`.
- `Down()` guard (second commit): the old guard refused on any `Language <> 'vi'`, which after the backfill would refuse the rollback of every database with an English or French subscriber. Dropping it altogether would lose data: a visitor who chose English while no mail could be sent (Gmail not connected) has `Version = 1`, an `en` row and no request. The guard now refuses only when `Language` differs from what Up would derive (latest request by `CreatedAtUtc DESC, Id DESC`, else `vi`). The V23 test asserts that Down succeeds on the freshly backfilled rows (and Up repeats with the same result), and is refused for an `en` row with no request.
- Test `V23_subscribers_keep_the_language_of_their_latest_confirmation_mail_and_fall_back_to_Vietnamese` (real V23 then V24): en, fr, several languages (newest wins: fr), a tie (larger request id wins: fr), no mail (vi), verified with an en mail (en). The requests keep their own language, there is no Welcome, and the verified address stays verified.
- Test `A_confirmation_link_written_before_the_upgrade_makes_its_Welcome_in_the_language_the_upgrade_gave_the_address` (en, fr): Admin API shows the row's language, the old link confirms, and the Welcome is in that language (greeting, `lang`, request `Language`) with the subject `Welcome to the BHA`. This one is green before and after the fix, because P2 #3 changed only the migration: it inserts the row with `Language` already set. It proves that the Welcome follows the subscription's language, not that the backfill happened. Together: the V23 migration test proves the backfill, this HTTP test proves what the Welcome does with it, and the real-data copy below proves the real upgrade.
- Real-data check: a copy of `thebha_newsletter_demo` (V23, real rows plus seeded en/fr subscribers) was upgraded with `dotnet ef database update`. Languages came out en, fr, fr (multi), vi (no mail), fr (verified), and the existing vi subscribers stayed vi. No Welcome was created. The copy was dropped.

## Databases that already applied migration 24
None. Latest applied migration per database (checked 2026-11-18): `thebha_dev` and `thebha_newsletter_demo` are at `…ClaimFences` (V23); the `thebha_cp_*`, demo and integration databases are older. The earlier acceptance copy `bha_nl3` was dropped. EF does not re-run an applied migration, so a database that had applied the old form would need `UPDATE "NewsletterSubscriptions" s SET "Language" = r."Language" FROM (SELECT DISTINCT ON ("SubscriptionId") "SubscriptionId","Language" FROM "NewsletterVerificationRequests" ORDER BY "SubscriptionId","CreatedAtUtc" DESC,"Id" DESC) r WHERE r."SubscriptionId" = s."Id"` once. Today nothing needs it: `thebha_dev` gets the corrected migration when the Owner applies migration 24 (command in `AGENTS.md` §9).

## Checks (local, real PostgreSQL)
- Regression tests on the unfixed code (`1fac52d` + tests only): the three new tests for the three findings failed as above; the two en/fr Welcome cases and the valid-unsubscribe case passed, as they should (see the note under P2 #3).
- After the fixes, Newsletter + migration groups (`FullyQualifiedName~Newsletter|StaffIdentityMigration`) on code `4e33089`: 140 passed, 0 failed.
- Whole solution on code `4e33089` (`dotnet build -c Release`: 0 errors; `dotnet test --no-build`): unit 676 passed, 0 failed; integration 1510 passed, 0 failed (29 min 55 s).
- An earlier full run on `9ea9a81` (before the `Down` guard change) had 1509 passed and 1 failed: `AssignmentMutationStoreTests.Authorized_cross_room_type_assignment_succeeds`, `Npgsql … Timeout during reading attempt` after 42 s, in an area this correction does not touch. The class passed alone (60 of 60) and the test passed in the final full run, so it is recorded as passed on rerun.
- CI: `CI_NOT_TRIGGERED` for this PR. `.github/workflows/ci.yml` only runs for PRs whose base is `develop` or `main`, and this PR's base is the #133 branch. The local results above are the evidence. After the base moves to `develop`, normal CI must pass before any merge decision.

## Limits kept from the earlier report
No real e-mail was sent. Sending to a real mailbox (Gmail OAuth, inbox rendering, spam placement) is an Owner-run acceptance step; everything here used the local Google stub.

## Not done / risks
- The check inside `UnsubscribeAsync` is a second read under the lock (READ COMMITTED); it relies on Staff edits committing before they release the subscription lock, which they do.
- The new gate mode is test infrastructure only (`NewsletterSqlGate`, no production change).
