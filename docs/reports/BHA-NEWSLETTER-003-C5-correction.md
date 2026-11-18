# BHA-NEWSLETTER-003-C5 — correction report

- Work item `BHA-NEWSLETTER-003`, correction `BHA-NEWSLETTER-003-C5` (implementer CLAUDE, reviewer CODEX_READ_ONLY). Branch `feature/bha-newsletter-003-management-welcome`, Draft PR #134, base `feature/bha-newsletter-002-email-verification` (unchanged).
- `START_HEAD` `374d687a8706397ae1eec1dc82db56a3f5b15ac6`. Code commits: `5fd9c12` (backend F1, F2, F3 and their tests), `05f2e53` (Admin client and screen for F2). **Tested code SHA: `05f2e53`.** Everything after it is documentation only.
- Scope: `NewsletterSubscriptionService`, `NewsletterSubscriptionAdminService`, `NewsletterLifecycle`, `NewsletterVerificationDispatcher`, `WebsiteNewsletter.cs` (the Application interface), `AdminWebsiteNewsletterController`, Admin `website.ts` and `NewsletterSubscriptionsPanel.tsx`, their tests, the invite line of the completion report, this report and the worklog. **No migration, no public Customer API, RBAC, OAuth, workflow or shared-hook change.** The one contract change is the one the correction prompt authorised (below).

## Contract change (authorised): verification invitations carry the row version

```text
POST /api/admin/v1/website/newsletter-subscriptions/{id}/verification-invitations
Body (required):  { "expectedVersion": <version of the row the Staff member is looking at> }
200  queued | cooldown (+ retryAfterSeconds) | not-connected     (unchanged)
409  newsletter-version-conflict   the row changed since (its address included): no request, no cooldown, no "invited" audit row   (new)
409  newsletter-invite-not-pending / newsletter-subscription-archived    (unchanged)
404  newsletter-subscription-not-found                                    (unchanged)
400  body without the field, null, or not an integer (e.g. "one", 1.5, [1])                                (new)
```
- No fallback and no default: a body without `expectedVersion` is a 400 and nothing is filled in. (ASP.NET's JSON options read the string `"1"` as the number 1 for every route of this controller; that is the existing behaviour and is not changed here.)
- Callers updated: Application `INewsletterSubscriptionAdmin.InviteAsync(actor, id, expectedVersion, ct)`, `NewsletterSubscriptionAdminService.InviteAsync`, the controller action (reuses `NewsletterVersionRequest`, the same record as unsubscribe/archive/restore/delete), Admin `inviteNewsletterSubscription(id, expectedVersion)`, the screen's `sendInvite`, and every test and fixture that posted `{}`: 6 places in `NewsletterManagementTests`, `website.test.ts`, `NewsletterSubscriptionManagement.test.tsx`. The route registry in `AdminCalendarAssignmentApiTests` is unchanged (same route, same method).
- **Deployment order:** the API with this change must be deployed before, or together with, the new Admin. The new API refuses an old Admin's invitation with a 400 (it fails closed; nothing is queued). The new Admin against the old API would work but without the protection (the old route ignores the extra field), so it must not go out alone. There is no path that skips the version check to support an old client.

## F1 (P2) — an earlier round's confirmation link must not verify a new opt-in round

- Cause: unsubscribing (the visitor's Welcome link or Staff) keeps the round's Verification tokens (`revokeTokens: false`). When the visitor came back, `SubscribeAsync` moved `Unsubscribed -> PendingVerification` without touching them, so an unexpired, unused link of the previous round still passed `ConfirmAsync`'s conditional UPDATE (`RevokedAtUtc IS NULL AND UsedAtUtc IS NULL AND ExpiresAtUtc > now`) and verified the new request (and queued another Welcome) without the new confirmation link.
- Fix: the restart `UPDATE` reports how many rows it moved; when it moved the row, `NewsletterLifecycle.RevokeConfirmationLinksAsync` sets `RevokedAtUtc` on every `Purpose = 'Verification'` request of that subscription, in the same transaction, under the subscription lock, before the new mail is queued and whether or not a sender is connected. Welcome rows are not touched (they are the visitor's way out). It uses only the existing `Purpose` and `RevokedAtUtc` columns: no opt-in generation, no schema. Resends inside one round are unchanged (nothing revokes them).
- Lock ordering: subscription first, then its requests, as everywhere. The confirmation was already correct for a press that looked its link up before the restart: its spend `UPDATE` requires `RevokedAtUtc IS NULL` and runs under the lock, so after the restart commits it matches nothing (concurrency test below).
- Tests (real PostgreSQL), written first:
  - `A_confirmation_link_of_an_earlier_opt_in_round_confirms_nothing_once_the_visitor_has_come_back` (theory: visitor Welcome link / Staff unsubscribe x sender connected / disconnected): two links of one round, one pressed (a Welcome queued), leave, come back; the earlier round's links are revoked in the database (unrevoked Verification count is 1 with a sender, 0 without), the Welcome link is not; the unused old link is `400 newsletter-confirmation-invalid`, the row stays pending and there is still one Welcome; the new link confirms and makes exactly one more Welcome. Before the fix all four cases failed on the revocation count (`Expected 1, Actual 3` / `Expected 0, Actual 2`).
  - `A_confirmation_link_read_before_the_visitor_came_back_is_void_when_it_gets_the_lock`: the SQL gate parks the press right after its token lookup; the visitor comes back; the press is released. Before the fix it verified; now `400 invalid`, pending, one Welcome.
  - `The_Welcome_link_stays_the_visitors_way_out_after_a_new_opt_in_round_started`: a guard that passed before and after (Welcome links are not revoked; the link still unsubscribes, a replay says `already-unsubscribed`).
  - The existing tests for a used link, an address change and a duplicate Welcome pass unchanged.

## F2 (P2) — an invitation made from a row that has changed

- Cause: the route took only the id, so after another Staff member replaced the address of a row, the stale button invited the unseen replacement while the screen said the shown address had been invited.
- Fix (backend): `InviteAsync` takes `expectedVersion` and uses the same `LockAndCheckAsync` as the other row actions: lock the row, read it, compare the version, only then decide readiness, cooldown or outbox. Stale -> `409 newsletter-version-conflict`; the transaction is rolled back before anything is written, so there is no request, no cooldown stamp and no audit row. Not-found, not-pending, archived and the `queued`/`cooldown`/`not-connected` results are unchanged.
- Fix (Admin): `inviteNewsletterSubscription(id, row.version)`; in `sendInvite` a `newsletter-version-conflict` marks the row stale (the C3 set: its buttons are locked, the screen offers the read) and returns: no "Đã xếp lời mời" notice, no unknown-outcome banner, no retry. A callback held from before the conflict returns at once for a stale row (it reads the synchronous stale mirror). After the read the screen shows the current row and its invitation carries the new version. The C2 hold and the C4 read/write serialisation are untouched (the invitation still goes through the screen's one guarded `write.run`).
- Tests, written first:
  - Backend: `An_invitation_made_from_a_row_that_has_since_changed_is_a_409_and_queues_nothing_for_the_address_that_replaced_it` (no request, no audit, no cooldown, no mail dispatched, then the current version queues and the mail goes to the new address); `An_invitation_that_waited_for_the_rows_lock_checks_the_version_it_finds_after_waiting` (Staff's rename is parked after its UPDATE holding the lock, the invitation is sent with the old version and waits for the lock, Staff commit, the invitation is a 409 and nothing is queued; before the fix it queued a mail for the replacement); `An_invitation_needs_the_version_of_its_row_and_a_body_without_one_changes_nothing` (missing, null, `"one"`, `1.5`, `[1]` -> 400; stale -> 409; unknown id -> 404; no side effect; the current version queues). Existing invite tests (cooldown, not connected, not pending, archived) pass with the version in the body.
  - Admin client: payload is `{"expectedVersion": n}` to the row's own route; a 409 is a refusal with its code, not `unverified`; the "what is an unknown outcome" table sends the version.
  - Admin screen (`NewsletterSubscriptionStale.test.tsx`, 4 new cases + the invite payload case in `NewsletterSubscriptionManagement.test.tsx`): the call carries version 4 and a conflict shows no notice and no unknown banner, locks the row's buttons and sends exactly once; a held callback sends nothing; after the read the new address is shown and the next invitation carries version 5; a failed read keeps it locked and unsent, the next frees it.

## F3 (P3) — a request deleted right after the claim

- Cause: after `ClaimAsync` committed its lease it re-read the request with `SingleAsync`. A Staff delete (it removes the row and its requests) between the commit and that read made it throw `Sequence contains no elements`: the batch failed, the worker logged an error and unrelated mail waited for the next poll. The null-safe read in `ProcessBatchAsync` was never reached.
- Fix: `SingleOrDefaultAsync`; a vanished request returns `await ClaimAsync(...)`, i.e. the next due request is taken in the same batch (the same recursion as the expired and gave-up cases). ClaimId, lease, attempts, expiry and the last-look checks are untouched; a genuine database error still throws.
- Test `A_request_deleted_right_after_the_claim_is_skipped_and_the_next_mail_goes_out_in_the_same_batch`: two requests (a@ due first, b@ a second later); the SQL gate parks the worker right BEFORE the first outbox read after the claim, which is the one inside `ClaimAsync` (not the later one in `ProcessBatchAsync`); a@'s request is `Sending` (lease committed); Staff delete a@; release. Before the fix the batch threw `Sequence contains no elements`. After: no error, the batch handled exactly one request (b@), one mail to b@, none for a@.

## Evidence summary: before and after

- Backend, on `374d687` plus the new tests (the 10 new cases): **9 failed, 1 passed** (the Welcome-link guard). After the fix all pass.
- Admin, on the unfixed Admin code plus the new tests: **8 failed** (client payload; the invite payload case of the screen's management test updated to expect the version, three variants; the four new stale-row cases); 1 guard (the 409 is a refusal, not unverified) passed.

## Browser acceptance (Admin over HTTPS, real API, real PostgreSQL, Google stub)

Own PostgreSQL 17 cluster (port 54330, no Docker, not `thebha_dev`), all migrations applied (no new one), API `https://127.0.0.1:7246` in Development (the only mode that lets the Google endpoints be overridden) with a local HTTPS Google stub on `127.0.0.1:7290` (token, userinfo, revoke, send; it records every message the real worker sent), resend cooldown 0 and worker poll 1 s so two links can be sent in one round, Admin dev server from a copy outside the repo `https://127.0.0.1:3101` (its `src` `diff`-identical to the repo at `05f2e53`), two Staff browser sessions (Playwright on system Chrome). The public form and the confirmation were called over HTTPS with the Customer origin (the Customer site was not run). No real mail was sent. **23 of 23 checks passed:**
- Invitation from a stale row: Staff A shows a@ at version 1; Staff B renames it to b@ in the UI (version 2); A's invitation sends `{"expectedVersion":1}` and gets 409; no "invited" notice and no unknown-outcome banner, the row is stale and locked; after 2.5 s (the worker polls every second) the database holds no request, no cooldown stamp and no new audit row, and the stub received no mail; the screen made no second attempt. A's "Tải lại danh sách" shows b@ (not a@) and says to reopen; the read sent nothing; the new invitation sends `{"expectedVersion":2}`, gets 200, and exactly one mail reaches b@.
- Opt-in rounds: subscribe twice in one round (two different links), the first link verifies (one Welcome sent); Staff stop the address in the UI; the visitor subscribes again (pending); the database shows the earlier round's confirmation links revoked and the Welcome link not; the unused old link gets `400 newsletter-confirmation-invalid`, the address stays pending with one Welcome; the new link verifies and exactly one more Welcome is made (two in total).
The stack was stopped by PID, the QA password files were deleted; the database directory, logs and Admin copy remain only in the session scratchpad.

## Checks on the tested code SHA `05f2e53`

| Check | Result |
|---|---|
| Backend `dotnet build -c Release` | 0 errors |
| Backend unit | 676 passed |
| Backend integration, whole suite (real PostgreSQL) | 1528 passed, 0 failed (19 min 16 s run: 1527 passed and 1 failed, then 47/47 of that class passed on rerun — see note) |
| Newsletter + migration groups after the fix | 158 passed |
| Admin_Web `tsc --noEmit`, `eslint src` (whole) | clean |
| Admin_Web vitest (whole suite) | 89 files, 2578 passed |
| Admin_Web production build (`next build`, Turbopack, copy with its own `node_modules`) | passed |
| Customer_Web | not run: no Customer file, dependency or contract changed |

Note on the one integration failure of the whole run: `RiversideDemoSeedCommandTests.A_past_start_date_is_a_usage_error` failed with `Assert.DoesNotContain() … Found: "local"`. That harness asserts the command output never contains the connection password, and the password of my scratch cluster was the word `local`, which the output contains in "local today". It is an artefact of the scratch password, not of the code: with a different password the whole class passes (47/47). It was recorded as passed on rerun; no product code is involved.

## CI

`CI_NOT_TRIGGERED`: `.github/workflows/ci.yml` runs only for pull requests whose base is `develop` or `main`; this PR's base is the #133 branch (only Vercel previews ran). The local results above are the evidence, not CI. The workflow was not changed. After the base moves to `develop`, normal CI must pass before any merge decision.

## Protections kept (C2–C4 and earlier)

Token protections (used link, address change revoking every link, one Welcome per verification, Welcome link outliving its sending deadline), the resend cooldown and language-with-the-mail rule, the dispatcher's ClaimId/lease/epoch fences and last look before sending, the C1 lock-and-recheck of the visitor's address, and the Admin C2 hold after an unknown outcome, C3 stale-row set and C4 read/write serialisation: their tests all pass unchanged (the only edits to existing tests are the invitation bodies and the invite payload expectation).

## Risks and limits

- F1 revokes at the restart of a round, not at the end of the previous one: a link of the current round keeps working until the visitor leaves and comes back, as before. A link that was already used keeps its used state; after a restart it is also revoked, so a replay of it answers `invalid` (already the answer for a used link of an earlier round).
- A database that already moved addresses `Unsubscribed -> Pending` before this change keeps the older links unrevoked until their own expiry (48 h by default); there is no backfill, by design (no migration).
- The invitation's 400 for a body without the version means an old Admin cannot invite until it is updated.
- F3 tolerates only a vanished request; a real database failure inside `ClaimAsync` still throws and ends the batch.
- Real mail delivery (Gmail OAuth, inbox rendering, spam placement) stays an Owner-run acceptance step; everything here used the local stub.
