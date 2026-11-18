# BHA-NEWSLETTER-003-C3 — correction report

- Work item `BHA-NEWSLETTER-003`, correction `BHA-NEWSLETTER-003-C3` (implementer CLAUDE, reviewer CODEX_READ_ONLY). Branch `feature/bha-newsletter-003-management-welcome`, Draft PR #134, base `feature/bha-newsletter-002-email-verification` (unchanged).
- `START_HEAD` `be90c372c89e28c9c5ec0811679833dcea8b40e2`. Code commits: `47076d6` (the fix, written in an earlier session of this same correction and left unpushed; inspected and kept), `dc2a395` (one gap found in review of it). **Tested code SHA: `dc2a395`.** Everything after it is documentation only.
- Scope kept to `NewsletterSubscriptionsPanel.tsx`, `NewsletterSubscriptionDialogs.tsx`, the Newsletter Admin tests, this report and the worklog. No backend, migration, API contract, RBAC, workflow or shared hook change.

## Finding

After a write answered `newsletter-version-conflict`, "Tải lại danh sách" only called `list.reload()`. The table refreshed but the Edit and Confirm dialogs kept the old `row` and `expectedVersion`, so every further attempt got 409 again.

## Behaviour now (the eight points of the prompt)

1. A conflict is a certain refusal (nothing applied), shown as a refusal, never as a lost answer. The dialog explains that the record changed and must be read again; the submit button is disabled and the submit handler itself returns early, so Enter or a direct submit send nothing with the known-stale snapshot.
2. "Tải lại danh sách" awaits the read from the server (`readAgain`, the same single-flight path as the C2 recovery).
3. Success closes the old dialog and shows a short notice to reopen the record from the fresh list. Nothing is resent.
4. A read that fails, or that a newer read replaced, is not a recovery: the dialog stays, stays locked, says the read failed and the button can be pressed again.
5. Reopening takes the row and `version` from the fresh list. A row no longer in the filter has no action left and the notice does not claim it was deleted.
6. Search, filters, scope and page are the ones read again.
7. A dialog closed before the read leaves that row's Edit/Invite/Unsubscribe/Archive-Restore/Delete locked and a screen-level banner with the same read, so the stale row still in the table cannot bypass it. The lock is a **set** of row ids: `47076d6` held one id, so a conflict on row B after A was closed unread freed A again (found while reviewing the commit, reproduced, fixed in `dc2a395`). One successful read clears all.
8. The C2 hold after an `unverified` outcome is unchanged (its tests pass untouched, one assertion of an older C2 test was changed to the new conflict flow).

Note: when a read fails, `useWebsiteList` replaces the table with its error panel, so no stale row is on screen to click; the screen-level banner still offers the read and the lock stays until a read succeeds. That panel's own "retry" calls `list.reload()` directly and does not clear the lock, so after using it the row stays locked until the banner's read is pressed once (safe, one extra click; the same pre-existing gap as for the C2 hold, not widened here).

## Tests

- New `NewsletterSubscriptionStale.test.tsx`, 12 cases, asserting the mocked API calls (payload, `expectedVersion`, total mutation count), not only that `reload` ran: edit (N → server N+1, reopened save sends N+1); unsubscribe, archive, restore, delete parameterised; nothing sent during a read or after a failed one, retry can succeed; a replaced read does not close or unlock; search/filters/page kept; a row that left the filter has no action and no "deleted" claim; closed-before-read locks that row; two stale rows both stay locked; the C2 hold still works beside it.
- Before-fix evidence: with `NewsletterSubscriptionsPanel.tsx` and `NewsletterSubscriptionDialogs.tsx` taken from `be90c37` and the new tests on top, **12 failed** (11 of the 12 cases of the new file, plus the conflict case of `NewsletterSubscriptionUnverified.test.tsx` rewritten for the new flow) and 14 passed (13 C2 cases and the C2-hold guard of the new file). The single-id gap was shown separately: on `47076d6` the new "second stale row" test failed on `a@example.com: expected false to be true`, passed after `dc2a395`.
- The sources were put back immediately; the tree was clean afterwards.

## Browser acceptance (Admin over HTTPS, real API, real PostgreSQL)

Done on a separate PostgreSQL 17 cluster (own data dir, port 54330, no Docker, not `thebha_dev`), migrated with `dotnet ef database update` (all migrations, migration 24 included), Riverside demo seed, two throw-away Staff (A and B, Manager + website access), API `https://127.0.0.1:7246` (mkcert leaf), Admin dev server from a copy outside the repo `https://127.0.0.1:3101`, Playwright 1.49.1 on `/usr/bin/google-chrome`. The Admin copy's `src` was `diff`-identical to the repo at `dc2a395`. No mail was sent (Admin add/edit queue none; no Google connection). 28 of 28 checks passed:
- **Edit:** A opens version 1; B saves version 2; A's save gets the 409 (exactly one mutation, `expectedVersion":1`), shown as a refusal and not as unknown; button disabled; `requestSubmit` and Enter send nothing; DB untouched; "Tải lại danh sách" issues one list read and the dialog closes; the notice says to reopen; search `c3q-` kept; reopened dialog shows B's language; the save sends `expectedVersion":2` and the DB goes to version 3.
- **Confirmation (archive):** same shape; the conflict sent version 1, the reopened confirmation sent version 2 and the row is archived.
- **Failed read (delete):** list GET aborted in the browser; the dialog stays, says the read failed, confirm stays disabled, Enter sends nothing, a second failed read behaves the same and the button stays usable; the table is gone (error panel) and the screen banner offers the read; once reads work again the fresh row returns unlocked, the reopened delete sends version 2 and the row is gone from the DB.
- **Closed before any read:** all four actions of the row are locked while the table still shows version 1, a forced click opens nothing and sends nothing, other rows are free, the banner's read unlocks it, the reopened dialog shows the server's value and the save sends version 2.
API, Admin and PostgreSQL were stopped by PID; the throw-away files (password, data directory, Admin copy) are in the session scratchpad, not in the repository. Not run in the browser: the C2 lost-answer hold (its logic is untouched and its 14 vitest cases pass).

## Checks on the tested code SHA `dc2a395`

| Check | Result |
|---|---|
| Admin_Web `tsc --noEmit`, `eslint src/components/website` | clean |
| Newsletter + `src/components/website` + `src/lib/api` vitest | 29 files, 572 passed |
| Admin_Web vitest (whole suite) | 89 files, 2557 passed |
| Admin_Web production build (`next build`, Turbopack, in a copy with its own `node_modules`) | passed |
| Backend, Customer_Web | not run: nothing they depend on changed (Admin component files only) |

## CI

`CI_NOT_TRIGGERED`: `.github/workflows/ci.yml` runs only for pull requests whose base is `develop` or `main`; this PR's base is the #133 branch. The local results above are the evidence, not CI. The workflow was not changed. After the base moves to `develop`, normal CI must pass before any merge decision.

## Risks and limits

- A stale lock is per tab: reloading the page forgets it (the first read of a fresh page is the server's truth and the version check still protects every write).
- The error panel's own retry does not clear the stale lock (see above); one more click on the banner's read does.
- Staff who press "Tải lại danh sách" while a different row's dialog is open also clear the other stale rows, because the read is of the whole screen query; that is the intended single recovery.
- No automatic merging of the user's unsaved edits into the fresh row (out of scope by the prompt): the dialog is reopened from fresh data and the change is typed again.
