# BHA-NEWSLETTER-003-C4 — correction report

- Work item `BHA-NEWSLETTER-003`, correction `BHA-NEWSLETTER-003-C4` (implementer CLAUDE, reviewer CODEX_READ_ONLY). Branch `feature/bha-newsletter-003-management-welcome`, Draft PR #134, base `feature/bha-newsletter-002-email-verification` (unchanged).
- `START_HEAD` `bc3a0702d04ddece5fcdd094debf124de8932923`. Code commits: `8956d12` (the guard), `4966cbb` (mirrors set where the state changes, dialog buttons, per-dialog tests). **Tested code SHA: `4966cbb`.** Everything after it is documentation only.
- Scope kept to `NewsletterSubscriptionsPanel.tsx`, `NewsletterSubscriptionDialogs.tsx`, the Newsletter Admin test file, this report and the worklog. No shared hook (`useWriteAction`, `useWebsiteList`), backend, migration, API contract, RBAC or workflow change.

## Finding (Codex P2) and reproduction

`readAgain` called `write.release()` unconditionally. While A's recovery read was out, the screen still accepted a write of another row B; if B ended `unverified` before the read came back, the old answer lifted B's new hold although the data could predate B's mutation.

Reproduced on `bc3a070` with a deferred list answer (a temporary test, deleted afterwards; the two source files were put back from a saved copy and compared): A stale, recovery read pending, B's invite sent (**1 invite request during the read**), the invite ends `unverified` and the hold is taken, the older read answers: **`newsletter-write-unverified` no longer shown, Add enabled again** — the hold is gone.

## The guard (two directions, synchronous)

Chosen design: serialise the recovery read and the writes inside the Newsletter screen, no shared-hook change.

- `readingRef` and `writingRef` are plain refs of the screen. Every write of this screen — add, edit, invite, and the four confirmations — goes through `write.run`, and `write` is a handle that wraps the hook's `run` (`{ ...hookWrite, run }`); `hookWrite` is used nowhere else. A grep of Panel and Dialogs shows all seven calls (`create`, `update`, `invite`, `unsubscribe`, `archive`, `restore`, `delete`) inside `write.run(...)`.
- Write → read: `run` returns `null` when `readingRef` or `writingRef` is set; otherwise it sets `writingRef` before delegating (before the first `await`) and clears it in `finally`, after the hook has taken its hold.
- Read → write: `readAgain` returns at once when `readingRef` or `writingRef` is set, and sets `readingRef` before `list.reload()`. It is cleared in `finally`, so a read that throws ends as a failed read; the screen is never locked for good (a test covers it). `openDialog` also refuses while a read is out.
- The refs change before any `await` and before the next render, so a callback taken from an earlier render, Enter, a direct submit and two calls in one tick meet them. The disabled buttons (table actions, Add, the banner's read button while a write is pending, and the open dialogs' buttons while a read is out) are only the picture of the guard.
- Held and stale are read by the recovery through refs that are set where the state changes (the wrapper sets the held mirror the moment a write ends `unverified`; `markStale`/`readAgain` set the stale mirror) as well as at render. Found in review of `8956d12`: with render-only mirrors, a recovery run from an old callback after an unknown outcome and before React rendered it saw "not held" and showed only the conflict wording. A test in exactly that window failed before the fix.

## Behaviour (the eight points)

1. No write starts while the recovery read is out. 2. No recovery read starts while a write is on the wire; it can be run after the write ends. 3–4. The guard is the refs above (tests call the handler React holds for a button, taken before the other action started, with no re-render between, and the real Enter/submit path). 5. A failed or replaced read frees neither the hold nor the stale set. 6. A successful read behaves as in C2/C3 (closes the dialog, asks to reopen from fresh data, resends nothing). 7. The notice follows the state the read clears: unknown-outcome warning when a hold was engaged, reopen advice when stale rows were cleared, both when both apply. 8. Search, filters, scope and page are the ones read again. Only the recovery read is serialised; the ordinary list reads (filters, paging, the read after a successful write) are unchanged.

C3's "free only the rows stale when the read started" is kept as a backstop; it is now unreachable through the UI, because no write can make another row stale while a read is out.

## Tests

`NewsletterSubscriptionStale.test.tsx` now has 27 cases (14 from C3 and 13 new for C4), asserting the mocked API calls and the hold, not the disabled attribute alone:
- a write of another row during the read sends nothing (held callback) and the buttons are disabled; after the read the write works;
- a recovery cannot start while an invite is on the wire (button disabled, held callback starts no read) and can after it ends;
- same tick, write first (one invite, no read) and read first (one read, no invite);
- an `unverified` write keeps its hold through a failed recovery; the next, successful one lifts it with both warnings; a replaced recovery frees neither the hold nor the stale row; a read that throws leaves no permanent lock;
- an unknown outcome seen by a recovery that runs before React has rendered it (the window above);
- edit and the four confirmations: a handler held from an open dialog sends nothing once the read is out (5 cases), plus the real `submit` event.

Before the fix (`8956d12`'s tests on `bc3a070`-equivalent behaviour): 5 of the first 7 new cases failed — two ordering cases (`expected 2 to be 1` reads; `expected "spy" to not be called at all, but actually been called 1 times`), the recovery that started during a write, the disabled buttons, and the read that threw (`Unable to find … newsletter-stale-failed`, the screen stayed locked). The two `unverified` cases passed (guards for the existing C2 hold). The render-window test failed on `8956d12` (`expected 'Đã đọc lại danh sách từ máy chủ với b…' to contain 'chưa rõ kết quả'`) and passes on `4966cbb`; the per-dialog cases already passed on `8956d12` (coverage of the guard, not reproductions).

One C3 test deliberately wrote during a read ("a row that goes stale while a read is in flight is not freed by that read") and was replaced by "another row cannot go stale while a read is in flight": under C4 that situation cannot arise. All other C2/C3 tests (hold after an unknown outcome, duplicate sends, the set of stale ids, reopening with the fresh version) pass unchanged.

## Browser acceptance (Admin over HTTPS, real API, real PostgreSQL, controlled responses)

Same isolated environment as C3: own PostgreSQL 17 cluster (port 54330, no Docker, not `thebha_dev`), all migrations applied, Riverside demo seed, two throw-away Staff, API `https://127.0.0.1:7246`, Admin dev server from a copy outside the repo `https://127.0.0.1:3101` (its `src` `diff`-identical to the repo at `4966cbb`), Playwright 1.49.1 on system Chrome. Staff A's list read and invite POST were held, released or dropped with Playwright routes in the browser (client-side race control; the server and the database were real). A dropped invite never reached the server, so it exercises "no answer", not "the server applied it and the answer was lost" (that variant was covered in C2). Held callbacks were called in the page through React's `__reactProps$` handler of the button, with no re-render between. No mail was sent (Gmail not connected); the only rows were `c4q-*`, deleted at the end. **19 of 19 checks passed**:
- Read first: the read is out (held), B's invite and Add are disabled, a held callback for B's invite sends no request, the read ends with the notice and no invite sent by itself, then one invite works.
- Write first: B's invite on the wire (held), the recovery button is disabled, a held callback for it starts no read, after the invite ends the recovery runs and clears the stale row.
- Same tick, both orders: write then read gives one invite and no read; read then write gives one read and no invite.
- Unknown outcome: the unanswered invite shows the unknown outcome and holds the screen; a failed recovery keeps the hold, the stale lock and the way back and sends nothing more; the next recovery lifts both and the notice carries both warnings.
- Replaced recovery: a newer read (filter change) leaves the hold and the stale row; the next recovery succeeds.
Not shown in the browser: add/edit/confirm submits during a read (vitest only, above). The stack was stopped by PID, the QA password files were deleted; the cluster directory, logs and Admin copy remain only in the session scratchpad.

## Checks on the tested code SHA `4966cbb`

| Check | Result |
|---|---|
| Admin_Web `tsc --noEmit`, `eslint src` (whole) | clean |
| `src/components/website` vitest | 13 files, 213 passed |
| Admin_Web vitest (whole suite) | 89 files, 2572 passed |
| Admin_Web production build (`next build`, Turbopack, copy with its own `node_modules`) | passed |
| Backend, Customer_Web | not run: nothing they depend on changed (Admin component files only) |
| Browser check of the C2 lost-answer hold where the server applied the write | not run in C4 (C2 evidence stands; vitest covers the hold) |

## CI

`CI_NOT_TRIGGERED`: `.github/workflows/ci.yml` runs only for pull requests whose base is `develop` or `main`; this PR's base is the #133 branch. The local results above are the evidence, not CI. The workflow was not changed. After the base moves to `develop`, normal CI must pass before any merge decision.

## Risks and limits

- The guard lives in the browser tab (as the hold does): another tab or Staff session is not covered, and the server's version check still protects every write.
- While a recovery read is out, the table actions and Add are disabled and writes are refused; a read that never answers keeps them locked until it ends or is replaced (the read can be superseded by changing a filter). A read that fails or throws unlocks.
- The error panel's own retry still calls `list.reload()` directly, so it neither takes the read guard nor clears a stale lock (same pre-existing gap as in C2/C3).
- Opening a dialog while a read is out is refused; a dialog already open when a read starts is locked and closed when the read succeeds.
