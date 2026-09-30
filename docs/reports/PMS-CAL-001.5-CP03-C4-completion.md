# PMS-CAL-001.5-CP03-C4 — read the intent record once when restoring

> Correction of Draft PR #71 (`feat/pms-cal-001-5-inflight-reload-safety`). Not merged. Owner decides Ready/merge.
> Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only).
> START_HEAD `513650e`. Code commit `cce7613`; reviewed head `241b212`; later commits are docs-only (see PR / `git log`).

## Finding → cause → fix

**Finding (Codex P2 on C3):** `restoreUncertainWrites` read the pending key into `pendingText`, then `readPendingEntries(storage)` read the same key again. If the second read threw, the catch marked the record `unreadable` but left `incomplete: false`: no pending locks were restored, the restoration was not retried, and an overlapping write became possible once storage answered.

**Cause:** the C3 read/parse split was done at the wrong place: the parse helper also did the storage read, so a storage failure inside it was indistinguishable from a damaged payload.

**Fix (`uncertainWriteStorage.ts`, +10/−2):** the parse and format check moved into `parsePendingEntries(text)`, which never touches storage. `readPendingEntries(storage)` (used by `beginPendingWrite`/`endPendingWrite`, unchanged) is now `parsePendingEntries(storage.getItem(...))`. Restore parses the `pendingText` it already read, so the pending key is read exactly once per restoration; a failed `getItem` is `incomplete`, a bad payload is `unreadable`, as before. Validation is not duplicated. Board, persisted format, retry, gate and hand-over are untouched.

## Evidence

- Start `513650e`: targeted suite 131 passed.
- RED (two new tests on unchanged source): `npx vitest run …uncertainWriteStorage.test.ts …ReservationBoardCrossWriteLock.test.tsx` → exit 1, **2 failed / 131 passed (133)**.
  - unit: pending key read twice (`expected 2 to be 1`);
  - board: with the second read of the pending key throwing, no lock notice appears (the record is treated as unreadable).
- GREEN: same command → exit 0, **133 passed**. Unit asserts one read, the intent restored, `pendingTokens` reported, `unreadable` and `incomplete` both false. Board asserts one block notice, no unreadable banner, and the overlapping assign confirm refused as "still unconfirmed" with 0 POST.
- Read-vs-parse distinction stays covered by the C3 unit cases (read throws → `incomplete`; corrupt payload → `unreadable`; verified empty; no window).
- Checks on the final source (from `Front_End/Admin_Web`): `npm test` 29 files / **674 passed**; `npm run lint` exit 0; `npx tsc --noEmit` exit 0; `npm run build` exit 0. Root: `git diff --check` clean.

## Size

Correction: 3 code/test files, +49 / −2 (source +10/−2, tests +39), plus this report. Below the 100–400 guideline because the finding is a one-function defect; nothing added to reach a number. Whole PR against `origin/develop` at `cce7613` (with this report): +2648 / −105 across 9 files, per GitHub. The report-only follow-up commit adds a few lines to this file.

## Not run / residual

- UI_LIVE was **not re-run** for C4: the change is a parse of text already read, proven by the two tests above. UI_LIVE for the PR stays **PARTIAL** as in C2/C3 (intents and storage faults were seeded/injected; move/unassign/cancel dialogs and a permanently refused `sessionStorage` were not exercised live).
- Residuals unchanged: same-tab only, no server idempotency, no Admin authentication/RBAC; a permanently unreadable `sessionStorage` keeps the tab gated.
- `diagnosing-bugs` and Graphify not used (root cause given by the finding and confirmed by a one-read counter).

## Review

- **REVIEW: RUN.** One invocation of `/codex:review --base origin/develop`, run by Owner.
- **REVIEWED_HEAD: `241b212`.** REVIEW_BASE: `origin/develop` (baseline `80f582e`). Reviewer: `CODEX_READ_ONLY`.
- **Result: no finding.** Codex's conclusion, verbatim:

  > No actionable regressions were identified in the reviewed diff. Tests could not run because the read-only sandbox blocked Vitest's temporary-file creation.

- The reviewer did not run the tests: targeted 133/133 and full 674/674 are the implementer's results, not confirmed by the reviewer.
- CI on `241b212`: run 36663622746, Admin / Backend / Frontend success.
- **UI_LIVE: PARTIAL**, with the limits stated above unchanged (intents and storage faults seeded/injected; move/unassign/cancel dialogs and a permanently refused `sessionStorage` not exercised live; UI_LIVE not re-run for C4).
- **OC disposition (as communicated by Owner): PASS for correction C4.** Merge/Ready remain Owner decisions.
- The commit that records this section is a separate docs-only commit **after** `241b212`. Codex did not review that commit; the reviewed code and tests are those of `241b212`.
