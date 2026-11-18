# BHA-NEWSLETTER-003-C2 — correction report

- Work item `BHA-NEWSLETTER-003`, correction `BHA-NEWSLETTER-003-C2` (implementer CLAUDE, reviewer CODEX_READ_ONLY). Branch `feature/bha-newsletter-003-management-welcome`, Draft PR #134, base `feature/bha-newsletter-002-email-verification` (unchanged).
- `START_HEAD` `832946db000977bd3f3bb872cbd7c90fccc80239`. Code commits: `7c553c2` (backend F1 + F2), `02b1639` (Admin F3). **Tested code SHA: `02b1639`.** Everything after it is documentation only.
- Scope kept to `NewsletterSubscriptionService`, `NewsletterLifecycle`, the Newsletter Admin screen and its write hook, tests, this report and the worklog. No migration, no public API contract, RBAC or workflow change.

## F1 — lock and re-check the visitor's address before queuing

- Cause: for an existing visible address `SubscribeAsync` kept no row lock, then read the id (`SingleAsync`) and queued by that id. Staff renaming/deleting the row in the gap gave a 500 (no row) or a confirmation queued for the replacement address (the claim matched the id, not the e-mail).
- Fix: after the INSERT ON CONFLICT the request locks the row by e-mail (`SELECT … WHERE "Email" = @email FOR UPDATE`; PostgreSQL re-checks the condition on the committed version after waiting, so a row that is no longer this address is not returned). No row means the address is free again (renamed away or deleted): the request starts over for it, as if it had arrived after Staff's change (it inserts a fresh row and queues that row's mail). Bounded at 5 rounds; if Staff keeps changing it under every attempt nothing is recorded or queued and the answer is `confirmation: none` (it claims no mail), never a 500. The un-hide and un-unsubscribe updates and the cooldown claim now run on the locked id. Lock order unchanged (subscription, then its mails); no transaction is held across a Google call.
- Tests (real PostgreSQL, SQL gate `afterRead` mode that parks a statement after it ran; teardown frees parked requests so one failure cannot cascade):
  - Staff first (rename and delete between the visitor's INSERT and its lock): before 500 / after 202, a fresh row for the typed address with exactly its own mail, nothing for the replacement, no orphan request, the worker sends one mail to the typed address.
  - Visitor first (parked right after it holds the lock, before it queues; Staff rename and delete): before, Staff did not wait (no lock held); after, Staff wait for the lock and then withdraw what the visitor queued (`email-changed`, tokens revoked) or delete the row with its requests, nothing left waiting.
  - Two visitors at once on one visible address: one request, one cooldown stamp. This one passed before the fix as well (a guard, not a reproduction).

## F2 — the language follows the accepted resend

- Cause: the Vietnamese row recorded while Gmail was disconnected stayed `vi` when an English resend was queued; the Welcome (which reads the subscription's language) and Admin disagreed with the confirmation.
- Fix: the statement that claims the cooldown (`TryQueueVerificationAsync`) also writes the normalized language and adds 1 to `Version` only when it changes, in the same transaction as the cooldown and the outbox row. A request the cooldown turns away matches no row and changes nothing. Callers of the shared helper: the public form and Admin's invitation; the invitation passes the row's own language, so it changes neither language nor version.
- Tests: `vi` recorded while disconnected, sender connected, resend as `en` and `fr`: DB, Admin DTO (language, version + 1), the request, the confirmation and the Welcome all agree; a replay of the used link makes no second Welcome. A resend in another language inside the cooldown changes neither language, version nor mail count. A Staff version taken before a language change gets `409 newsletter-version-conflict`. Before the fix these three failed on the language/version assertions.

## F3 — no write while an earlier outcome is unknown

- Cause: `useWriteAction` reported `unverified` but `run` accepted a new write, and the dialogs locked only on `pending`; after a timeout, 5xx or an unreadable success a second update/create could be sent while the first might still apply.
- Fix, two layers:
  - Shared hook: `useWriteAction({ holdWhenUnverified })`, **opt-in** (default behaviour is byte-for-byte what it was). When on, the hold is taken synchronously the moment a write ends `unverified`; `run` returns `null` while held (so Enter, a direct submit, a fast second click or two calls in one tick cannot get past it); `reset` leaves the hold; only `release` lifts it.
  - Screen: the subscriber screen owns ONE write slot for add, edit, invite and the four confirmation dialogs, so closing and reopening a dialog cannot lift the hold. While held, Add, Edit, Invite, Unsubscribe, Archive/Restore and Delete are disabled and cannot open a dialog.
- Recovery: "Đọc lại trạng thái" (inside the dialog and on the screen) re-reads the screen's own query. A read that fails, or that a newer read replaced, keeps everything locked and says so; the button stays usable (disabled only while its own read is in flight). A successful read releases the hold, closes the dialog that held the old row (it is reopened from the fresh list, so it carries the server's version), and shows a notice that says what to check and that a row missing from the current filter may have changed or been deleted (no claim either way). The search, filters and page are kept. Nothing is retried or announced as a success automatically. Refusals that are certain (validation, version conflict, 4xx/5xx with an error answer) do not lock.
- Shared-hook impact: `useWriteAction` is used by about 20 screens (website, blog, promotions, catalog). Only the Newsletter subscriber screen passes the option; every other caller gets the same hook as before (`reset` and `run` behave as they did when the option is absent; covered by a test). Their own `unverified` handling is unchanged. The same latent gap exists on those screens and was not widened into this correction.
- Tests (Admin vitest, new file `NewsletterSubscriptionUnverified.test.tsx`, 14 cases): for add, edit, archive and invite, after an unknown outcome the total mutation count stays 1 under direct submit, Enter and forced clicks; stays locked across close/reopen; a read in flight or failed does not unlock; a read replaced by a newer one does not unlock; a success unlocks, closes the old dialog and the next edit uses the fresh version (`expectedVersion` 5, not 4); search/filters/page kept and no deletion claimed when the row left the filter; validation, version conflict and plain error answers do not lock; the hook alone (hold, reset, release, default unchanged). Before the fix 10 of the 14 failed; the 4 that passed are the guards (certain refusals and the default hook).

## Browser acceptance (Admin over HTTPS, real API, real PostgreSQL)

Done on a throw-away copy of `thebha_newsletter_demo` (V23, migrated with the corrected migration 24), a throw-away QA Staff, the local Google stub, Playwright on the system Chrome; API 7245, Admin 3101 and the stub on `127.0.0.1`, so the Owner's `localhost` stack and session were not touched. The answer of a write was lost by letting the request reach the server and aborting it in the browser. 26 of 26 checks passed:
- Add: the server wrote the row; the screen said the outcome was unknown; Enter, `requestSubmit` and a forced click sent nothing (1 mutation request); the dialog closed and Add stayed locked and would not reopen; a failing read kept the lock; a successful read unlocked, kept the typed search (`search=lost-add&page=1`), showed the row, and the notice made no claim of deletion.
- Edit: the server applied language `en` and version + 1 although the client heard nothing; retries sent nothing and the version stayed; a failing read kept the lock; the successful read closed the old dialog and the list showed English; reopened from the fresh row, a new edit used the fresh version and returned 200 (`fr`, version + 2); exactly one more mutation.
The copy database was dropped, the three processes were stopped by PID, the QA password and connection file were deleted. No real e-mail was sent.

## Checks on the tested code SHA `02b1639`

| Check | Result |
|---|---|
| Backend `dotnet build -c Release` | 0 errors |
| Backend unit | 676 passed |
| Backend integration (real PostgreSQL, whole suite) | 1518 passed, 0 failed (27 min 6 s); 1510 before C2 + 8 new |
| Newsletter + migration groups | 148 passed |
| Admin_Web `tsc --noEmit`, `eslint src` | clean |
| Admin_Web vitest (whole suite) | 88 files, 2531 passed |
| Admin_Web production build (`next build`, in a copy outside the repo because the Owner's dev server owns `.next`) | passed |
| Customer_Web | not run: no Customer file or dependency changed |

An earlier whole-suite Admin run had one failure in `ReservationBoardSplitMove.test.tsx` ("a failed re-read never resolves it"); it passed alone and in the later whole-suite run, so it is recorded as passed on rerun (calendar code, not touched here).

Before-fix evidence: the backend tests written first failed on `832946d` as described (7 of 8 failed, the two-visitors test passed), and 10 of 14 frontend tests failed.

## CI

`CI_NOT_TRIGGERED`: `.github/workflows/ci.yml` runs only for pull requests whose base is `develop` or `main`, and this PR's base is the #133 branch. The local results above are the evidence, not CI. The workflow was not changed. After the base moves to `develop`, normal CI must pass before any merge decision.

## Risks and limits

- F1 after five consecutive Staff rename/delete rounds on the same address gives `confirmation: none` and records nothing; this needs five Staff changes inside one request and is documented rather than looped forever.
- The hold lives in the browser tab: reloading the page forgets it (the first read of a fresh page is itself the server's truth, and the version check still protects against stale writes).
- The shared hook change is additive and opt-in; other screens still lock only their own buttons on `unverified`.
- Real e-mail delivery (Gmail OAuth, inbox rendering, spam placement) remains an Owner-run acceptance step; everything here used the local Google stub.
