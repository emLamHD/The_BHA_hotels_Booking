# PMS-CAL-002-CP03 — SPLIT_MOVE_CLIENT_TARGET_RECONCILIATION_STORAGE — completion report

Date: 2026-10-12 (Asia/Saigon). Scope: the Admin_Web foundation for the merged HTTP split-move — client, exact target, reconciliation of a lost response, room/night locks and tab-storage continuity. Admin_Web only. No backend, schema, auth, action entry, dialog, submit handler or optimistic UI. `BACKEND_CD` is `PAUSED / NOT_COMPLETE` and untouched.

## 1. Identity

| | |
|---|---|
| Work item / roles | `PMS-CAL-002-CP03` — `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Branch / base | `feature/pms-cal-002-cp03-split-move-client-reconciliation-storage` → `develop`; START_HEAD = baseline = `402c8f8d48a9701e84d0465a26691c0a1a29bd30` (= `origin/develop` after `git fetch --prune`, clean tree, branch absent locally and on the remote before creation) |
| Draft PR, commits, FINAL_HEAD, GitHub additions/deletions, CI run IDs | A commit cannot contain its own hash or the runs of its own push: they are in the handoff, taken after the last push |
| Write ownership | One writable checkout. The two `orca/workspaces` worktrees were already registered before the session and were not touched; the AWS P1 branch was not touched |

## 2. Decisions and scope adjustment

* D1/D2/D3/D5 APPROVED (2026-10-10), as built into PR #98: a successor that crosses the sold RoomType needs Manager permission, confirmation and a fresh reason; destination = source is refused; reason optional when both successors are the sold type.
* **D4 and D6 remain OPEN.** CP03 carries `localToday` from the board as a fact. It creates no past-date default, permission, restriction or acknowledgement. The roadmap's "needs D4 for the today flag" moves to CP04. Continuing the work is not Owner approval of D4/D6. Cases with a `splitDate` before `localToday` only exercise transport, range and storage.
* Compatibility allowance (OC): `UncertainWriteNotice` words a restored split-move as a room split-move. It is storage/reconciliation compatibility, not CP05: no action entry, dialog, client call or handler.

## 3. Change

| File | Change |
|---|---|
| `src/lib/api/types.ts` | `SplitMoveReservationAssignmentRequest` (`expectedVersion`, `splitDate`, `destinationPhysicalRoomId`, optional `confirmCrossRoomType`, `reason`) — the API type, not the mock view-model |
| `src/lib/api/client.ts` | `splitMoveReservationAssignment` and `SplitMoveAssignmentOutcome` (`split` / `not-sent` / `rejected` / `unknown`). One attempt; Property and segment encoded separately; the body is built field by field (optional fields only when supplied), never the request object; Staff `include`, LocalGate `omit`, `no-store`, `redirect: "error"`; invalid mode/config or an already-aborted signal → `not-sent`; abort/timeout/network after send, 5xx and any unexpected non-4xx/non-200 → `unknown`; `200` is always `split`, even with an unreadable body; 400 validation, 401 session-ended, 403 exact title `Cross-RoomType confirmation required` apart from permission/Origin, 404 generic not-permitted, 409 conflict, 415/other 4xx refused. Existing calls untouched |
| `…/reservation-board/splitMoveTarget.ts` (new) | `SplitMoveTarget`, `buildSplitMoveTarget`: exact Property/Unit/segment id/version/room/range match or `null`; source full range, at least two nights; actual RoomType and names from the board's room, not the selection; candidates = Active rooms minus the source, sold type first; `localToday` from the board; no `Date.now`, no default split date |
| `…/reconciliation.ts` | `SplitMoveReconciliationTarget` in the union (`startDate`/`endDate` = FULL source range, `physicalRoomId` = destination, `sourcePhysicalRoomId`, `segmentId`, `expectedVersion`, `splitDate`); verdict in `evaluateUncertainWrite`; `roomsTouchedBy` → `roomRangesTouchedBy` (room-and-range facts); `isSegmentSplitMoveUnresolved`; `isSegmentAssignmentWriteUnresolved`; the "complete for any Unit" comment corrected. `boardCanEvaluate` is unchanged and still the one predicate for evaluator and Check again |
| `…/uncertainWriteStorage.ts` | `split-move` record: serialized with `splitDate`; validated with all identity fields, a finite integer `uint` version (≤ 4 294 967 295), real Gregorian dates by arithmetic (years 0001–9999, not `Date`), `start < splitDate < end` and distinct rooms. `FORMAT_VERSION` 1, both keys, tokens and dedup unchanged; other operations validated exactly as before |
| `…/ReservationBoard.tsx` | `UncertainWriteNotice` only: exhaustive `OPERATION_LABELS` record over the target union, split-move wording, comment. No import of the new client or target |
| Tests (5 new/extended suites + 1 matrix) | see §4 |
| `docs/design/PMS-CAL-002-split-move.md`, `docs/project/SNAPSHOT.md`, this report | CP02 merged (PR #98), CP03 status and scope adjustment, D4/D6 OPEN, CD paused |

### Verdict and locks as built

* `observed` only when `board.from < splitDate < board.to` **and** the same Unit has both an assignment in the source room exactly `[start, splitDate)` and one in the destination exactly `[splitDate, end)`. Otherwise `unresolved` while the source's id, version, room and full range are all intact, else `changed` (the stale `expectedVersion` can never commit; it does not say the request succeeded or rolled back). Wrong Property or a window that does not overlap the source's range → no verdict. Sequence gates, failed-read handling, `settled` certainty and reference stability are the existing `settleReconciliations`.
* Room locks: source room over `[start, end)`; destination room over `[splitDate, end)` (prefix-only nights in the destination are free); half-open edges do not overlap; `done`-but-`unresolved` stays locked. The per-Unit lock (`isUnassignedRangeUnresolved`) holds the whole source range because the target's range is the full range. Create, move, unassign and block locks keep their old results.
* `isSegmentAssignmentWriteUnresolved` (move, unassign or split-move of one segment id; id only) exists and is tested. **It is not wired to any handler**; CP05 connects it. Until then the room-range lock on the source room is what refuses a second Move or Unassign of the restored source (proved in the restore test).

## 4. Acceptance evidence

| # | Acceptance | Evidence |
|---|---|---|
| 1 | Client wire contract, mode, certainty, no retry; valid `200` with unreadable body is `split` | `splitMoveReservationAssignment.test.ts` (24): exact URL/body/encoded ids; widened object stripped to the three/five fields; optional fields only when supplied (incl. explicit `false`); `200` valid and unreadable; 400, 401, store-403, three permission/Origin/lookalike 403s, 404 (body and empty), 409, 415, 422, 5xx/503/204/302/100 → `unknown`; network, timeout (timer count 0), abort after send (listener removed), already-aborted and missing base URL → `not-sent`, fetch 0; one attempt. `clientAccessMode.test.ts` (39): Staff include / LocalGate omit / no actor-role-evidence / 401 / invalid mode and LocalGate-in-production sends 0, now including split-move |
| 2 | Pure target exact/stale-safe, full range, actual RoomType, candidates; `localToday` is data | `splitMoveTarget.test.ts` (14): wrong/none Property, missing Unit/segment, each of version/room/start/end mismatch, one night refused and two accepted, long and partial source, board-room RoomType wins over a stale selection, Active candidates/source exclusion/group order, input immutability, `localToday` taken from the board under a faked 2040 system clock |
| 3 | Clipped-window reconciliation | `reconciliation.test.ts` (86, +37 new): straddling both/one/wrong room/range/swapped, destination-whole-range, wrong Unit; source version/id/room/end changed; window ending at or starting at the split date can never observe (also if both successors were listed); one night either side straddles; long source with un-clipped successors; `boardCanEvaluate` overlap, edges, wrong Property; settle: sequence gate, failed read, stable references |
| 4 | Room/night/segment locks, old operations unchanged | Same file: source prefix+suffix locked, destination suffix locked and prefix free, half-open edges, wrong room/Property, settled/observed/changed release, done-unresolved locked, per-Unit whole range, create/move locks asserted again; segment predicates by id only; the move/unassign predicates still ignore split-move |
| 5 | v1 storage; notice does not mislabel; nothing resent | `uncertainWriteStorage.test.ts` (81, +38): round-trip of outcome and in-flight records (both rooms, full range, `splitDate`, no guest/confirmation/reason/localToday/actor), same-write dedup and owned-token cleanup, **literal pre-CP03 v1 fixtures** (create/move/unassign/in-flight/block/pending) read as before and re-persisted beside a split-move with `v: 1`, 27 damaged variants (each field missing/wrong type, uint bounds, same room, split at/outside endpoints, non-existent day/month 00/13/day 00, 29 Feb in 2026 and 2100, year 0000) → unreadable beside valid siblings, 10 accepted boundaries (leap days, year ends, 0001, 0004-02-29, 9999, outside the mock 2020–2035), damaged pending intent refuses new writes without overwriting, set/read-back/delete failure, read failure = incomplete. `ReservationBoardCrossWriteLock.test.tsx` (98, +8): synthetic unknown-outcome and in-flight records show "room split-move", prefix and suffix ranges, never "unassign" or a full-range destination assignment, locks on prefix and suffix windows, Check again only reads, a Move or Unassign of the source is refused with 0 POST, `observed` says it does not prove this request made it, `changed` says it can no longer take effect, a non-overlapping view says where to look; no write method is called by any restore |
| 6 | Scope, docs, PR, CI | Allowlist only (§6). HTTP route already existed; action/dialog UI not built; D4/D6 OPEN; CD paused. Draft PR, size and final-head CI: handoff |

Old-build compatibility (design §7.7) — **corrected in C1, see §9:** the older-build behaviour is `NOT_VERIFIED`. Reading the baseline `readAssignment` (every unknown `operation` falls to `return null`) shows the *expected* parse path only; no old client or old parser was run. What the tests prove: (a) the current parser reads literal pre-CP03 v1 fixtures unchanged (forward compatibility); (b) the current parser's own fall-through for an operation it does not know (`"split-move-v2"`: unreadable beside valid siblings; pending write refused with the stored text byte-identical) — current behaviour, not a build that predates CP03.

## 5. Commands and outcomes (Front_End/Admin_Web, Node 22.23.2 / npm 10.9.8)

| Command | Outcome |
|---|---|
| `git fetch --prune origin` | `origin/develop` = `402c8f8…` = baseline |
| `npm ci` | completed from the lockfile; `package.json`/`package-lock.json` unchanged |
| Targeted Vitest: the six client/mode/target/reconciliation/storage/restore-lock suites | 6 files, 342 passed |
| `npm test` (full) | 39 files, **993 passed**, 0 failed |
| `npm run lint` | 0 errors, 0 warnings |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | compiled successfully |
| `git diff --check` | clean |

Mutation spot-checks (reverted): widening the straddle test to `<=` fails the two non-straddling cases; locking the destination from `startDate` fails the destination-prefix case.

## 6. Self-review

* Files changed are exactly the allowlist; `git diff --name-only origin/develop` was compared to it. No `package*.json`, lockfile, config, `next-env.d.ts`, `.github/`, `deploy/`, `Back_End/` or `Customer_Web/` file changed. `moveTarget.ts`, `assignmentTarget.ts`, `dateMath.ts` and the mock `types.ts` are read-only reuse.
* `ReservationBoard.tsx` has no import of `splitMoveReservationAssignment` or `buildSplitMoveTarget`; no handler, dialog, popover entry or send path was added.
* Existing tests were not edited to change behaviour: additions only (the mode matrix gained one write, with its status).
* Secret scan of the diff and this report: none. Scratch: one backup of `reconciliation.ts` for the mutation spot-checks, in the session scratchpad, restored and not part of the diff.

## 7. Limits and risks

* **Size.** The PR exceeds the 100–400 line target (`docs/governance/WORKFLOW.md` §6): about 491 source lines (client 144, target 104, reconciliation ~165, storage 47, notice ~40), ~1,154 test lines and ~110 lines of docs and this report. The roadmap estimated ~480 for CP03 and named the window matrix and storage invariants as the safety case; no test was compressed. Owner may ask for a client+target / reconciliation+storage split.
* ~~`buildSplitMoveTarget` measures "at least two nights" with `diffDaysIso`~~ — **defect, corrected in C1 (§9).** At the initial head (`dc8a634`) the guard used `diffDaysIso` (`Date.UTC`, years 0–99 mapped onto 1900–1999), so a valid source `[0099-12-31, 0100-01-02)` was refused. "Unrealistic for server data" was not a bound Owner had set, and was wrong to rely on.
* `observed` shows the schedule matches the request, which another operator could also have produced; only a `200` proves this request committed.
* No idempotency; cross-tab/device duplicates stay possible; tab storage is not protection across tabs, devices or a closed session.
* NOT_REQUIRED/NOT_RUN: backend, local .NET/PostgreSQL, Chrome acceptance against a live API (no UI exists), any cloud call, live deploy, release workflow dispatch. No backend totals from CP02 are claimed for this head.

## 8. Status

`IMPLEMENTATION_CP03: PASS` (mandatory local checks above; final-head CI in the handoff). `REVIEW_CP03: NOT_RUN — OWNER_ONLY`. `CLIENT_TARGET_RECONCILIATION_STORAGE: IMPLEMENTED`. `HTTP_SPLIT_MOVE: ALREADY_IMPLEMENTED`. `UI_SPLIT_MOVE_ACTION_DIALOG: NOT_IMPLEMENTED`. `CP04/CP05: NOT_STARTED`. `D4/D6: OPEN`. `BACKEND_CD: PAUSED / NOT_COMPLETE`. `CLOUD_CALLS_CP03`, `LIVE_DEPLOY_CP03`: `NOT_RUN`. The two release flags were written `false` by Owner at an earlier step and were not read again; this checkpoint called no cloud and changed no flag.

## 9. Correction C1 — `PMS-CAL-002-CP03-C1` (TARGET_CALENDAR_RANGE_AND_EVIDENCE)

Sections 1–8 above are the evidence for the initial head `dc8a634` and keep their attribution (their CI and the Codex review of `dc8a634` do **not** cover C1).

**Branch situation (deviation from the prompt).** PR #99 was merged into `develop` (merge `999cb595f0dbd249ea5fa0d52bdb1e88c5792be6`, `2026-10-12T02:55:43Z`) and its feature branch deleted locally and on the remote before C1 started, so the prompt's START_HEAD/branch/"update Draft PR #99" could not hold. By Owner instruction C1 starts from `origin/develop` = `999cb59` on a new branch `feature/pms-cal-002-cp03-c1-target-calendar-range-evidence`, with its own Draft PR into `develop`. `git diff dc8a634 999cb59` is empty (the merge changed no content), so the code under correction is byte-identical to `dc8a634`.

**Finding F1 (OC).** `diffDaysIso("0099-12-31", "0100-01-02")` = -693958 (`Date.UTC` maps years 0–99 onto 1900–1999), so the `< 2` guard refused a valid two-night source; an unparsable range yields `NaN`, for which `NaN < 2` is false, so the guard passed it. **Fix** (`splitMoveTarget.ts` only): `gregorianDayNumber` — a strict `YYYY-MM-DD` parse, year 0001–9999, real month lengths and the Gregorian leap rule, integer day number (no `Date`, clock or timezone) — and `spansAtLeastTwoNights` (`null` for any invalid date, else `end - start >= 2`). The server's strings are carried verbatim in `target.segment`. Not changed: board identity, exact selection match, current room/RoomType, candidates, `localToday`; no default date, past-date rule or acknowledgement; `dateMath.ts` untouched.

**Finding E1 (OC) — evidence attribution.** §4 and design §7.7 reworded: old-build/downgrade runtime is `NOT_VERIFIED`; source inspection shows the expected path only. Unknown **pending intent** (expected: `beginPendingWrite` refuses, by source inspection) is kept apart from unknown **outcome record** (expected: "could not be restored" warning; nothing is claimed about locks being recovered or all writes staying closed). Literal pre-CP03 v1 fixtures prove forward compatibility with the current parser; the `"split-move-v2"` tests prove current-parser behaviour only. No old build was run and no downgrade safety is claimed.

### C1 acceptance

| # | Acceptance | Evidence |
|---|---|---|
| 1 | Valid ≥ 2 nights on 0001–9999 incl. 0099/0100; reject 1 night / invalid | `splitMoveTarget.test.ts` +36 cases through the real `buildSplitMoveTarget` with exact board + selection: 14 accepted (0099/0100, 0099, 0050, 0001, 9999, 0004/0400/2028 leap Feb, 0100 and 1900 non-leap Feb, modern, ancient→modern), 8 one-night refused (same boundaries incl. 28→29 Feb 0004, 29 Feb→1 Mar 0400, 28 Feb→1 Mar 0100), 14 invalid refused (year 0000, 30 Feb, 29 Feb 0100, 31 Apr, month 13, day 00, reversed, empty range, not zero-padded, text, empty string, 5-digit year). Expected values are hand-written Gregorian facts; accepted cases assert the strings are unchanged |
| 2 | Range/match/candidates/`localToday`, D4/D6 OPEN unchanged | All 14 pre-existing tests unchanged and passing; no D4/D6 text changed |
| 3 | RED/GREEN + mutation; Admin regressions pass | below |
| 4 | Docs claim no unproven old-build guarantee; pending/outcome and current/old parser separated | §4 note, §7, this section, design §7.7, Snapshot |
| 5 | Narrow scope, same base, clean/aligned head, final-head CI | handoff (needs the pushed head) |

### C1 actual checks (Front_End/Admin_Web, Node 22.23.2 / npm 10.9.8)

| Check | Outcome |
|---|---|
| RED: `npx vitest run src/components/calendar/reservation-board/splitMoveTarget.test.ts` with the new tests on the unchanged `dc8a634` source | 13 failed / 37 passed. `accepts … crossing the 0099/0100 year boundary` failed (guard refused a valid source: target `null`); 12 of the 14 invalid-range cases failed (the plain reversed and empty ranges were already refused) — (year 0000, non-existent days/months, reversed 0100→0099, malformed, empty, 5-digit year all produced a target) |
| GREEN: same command after the fix | 50 passed, in `TZ` = UTC, Asia/Ho_Chi_Minh, America/Los_Angeles, Pacific/Kiritimati |
| Mutation (reverted; file hash restored and compared): `end - start >= 2` → `>= 1` | 9 failed / 41 passed (the one-night cases incl. the pre-existing "refuses a one-night source"); restored → 50 passed |
| Exhaustive cross-check (scratchpad script, not committed) of `gregorianDayNumber` against every `YYYY-MM-DD` with year 0001–9999, month 1–12, day 1–31 | 3,652,059 valid dates accepted, numbered consecutively 1…3,652,059 with 0 mismatches — the count of days 0001-01-01…9999-12-31 per Python `datetime.date.toordinal()`; every non-existent day returned `null` |
| `npm test` (full) | 39 files, **1029 passed**, 0 failed (was 993; +36) |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | 0 problems / exit 0 / compiled successfully |
| `git diff --check` | clean |
| `dateMath.ts`, `uncertainWriteStorage.ts`, `reconciliation.ts`, `ReservationBoard.tsx`, `client.ts` and their tests, `package*.json`, backend: `git diff --stat` against START_HEAD `999cb59` | empty |

`npm ci` was not needed (dependencies present, lockfile untouched). `.NET`/PostgreSQL/browser/live API: `NOT_REQUIRED` (backend and action UI unchanged). Skill: `diagnosing-bugs` not triggered (root cause known; no unexplained failure). `GRAPHIFY_POLICY: NOT_APPLICABLE`. Secret scan of diff and docs: none.

**Status.** `IMPLEMENTATION_CP03_C1: PASS` (local mandatory checks). `REVIEW_CP03_C1: NOT_RUN — OWNER_ONLY`; the review of `dc8a634` does not cover C1. `CP04/CP05: NOT_STARTED`. `D4/D6: OPEN`. `BACKEND_CD: PAUSED / NOT_COMPLETE`. `CLOUD_CALLS_CP03_C1`, `LIVE_DEPLOY_CP03_C1`: `NOT_RUN`. Commits, PR, FINAL_HEAD, GitHub size and final-head CI run IDs are in the handoff, taken after the last push.
