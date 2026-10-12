# PMS-CAL-002-CP04 — SPLIT_MOVE_DIALOG — completion report

Date: 2026-10-12 (Asia/Saigon). Scope: a standalone split-move dialog on the merged target/client contracts — split-date bounds on real Gregorian dates, a two-part preview, role-aware cross-RoomType confirmation, the D4 past-date acknowledgement and honest outcomes. Admin_Web only. The dialog is **not mounted** anywhere, imports no client function and has no send path. No backend, schema, auth, board wiring, optimistic UI or storage change. `BACKEND_CD` is `PAUSED / NOT_COMPLETE` and untouched.

## 1. Identity

| | |
|---|---|
| Work item / roles | `PMS-CAL-002-CP04` — `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Branch / base | `feature/pms-cal-002-cp04-split-move-dialog` → `develop`; START_HEAD = baseline = `fc5e29024bd9ec7a7699162fc586faa336cd1627` (= `origin/develop` after `git fetch --prune`; clean tree; the branch did not exist locally or on the remote) |
| Draft PR, commits, FINAL_HEAD, GitHub additions/deletions, CI run IDs | A commit cannot contain its own hash or the runs of its own push: they are in the handoff, taken after the last push |
| Write ownership | One checkout, no worktree/clone/nested agent. `diagnosing-bugs` not triggered (no unexplained failure; the two test failures during development were test-side — duplicate "Close" names, and an acknowledgement ticked before a date change that correctly resets it). `GRAPHIFY_POLICY: NOT_APPLICABLE` |

## 2. Owner decisions recorded (2026-10-12)

* **D4 APPROVED**: the server keeps no today rule. A split date before the Property's `localToday` is allowed, but the dialog warns and needs a separate acknowledgement before it sends.
* **D6 APPROVED**: no check-in/lifecycle rule (it is mock-only) and no repricing. The dialog keeps price, Unit/night rows and the commercial commitment out of its words and states only that the stay dates, prices and booking are not changed.
* D1/D2/D3/D5 were already APPROVED. PR #99 (CP03) and PR #100 (CP03-C1) are merged. The OC review of PR #100 raised a P3 "trailing newline" finding classified `NOT_SUBSTANTIATED` (the regex has no `m` flag); no correction was opened — `splitMoveDates.test.ts` still pins the `"…\n"` cases.

## 3. Change

| File | Change |
|---|---|
| `…/reservation-board/ReservationSplitMoveDialog.tsx` (new) | Props: `target`, `boardReloadStatus`, `uncertainResolution?`, `assignmentWriteEnabled` (default `false`), `crossRoomTypeEnabled` (default `false`), `onSubmit(intent) → SplitMoveAssignmentOutcome`, `onClose`. `SplitMoveIntent` = `{ splitDate, destinationPhysicalRoomId, confirmCrossRoomType, reason?, pastDateAcknowledged }` — no Property, segment, version, actor, role or evidence; `pastDateAcknowledged` is UI-only and not in the API body. Separate from the mock `ReservationMoveConfirmDialog` |
| `…/splitMoveDates.ts` (new) | Pure helpers on `gregorianDayNumber`: `isoFromGregorianDayNumber` (inverse, zero-padded year), `shiftIsoDate`, `countNights`, `splitDateBounds` (`start+1 … end-1`), `checkSplitDate`, `compareSplitDateToToday`, `defaultSplitDate`. No `Date`, clock, timezone or `dateMath.ts` |
| `…/splitMoveTarget.ts` | **One word and a comment**: `function gregorianDayNumber` → `export function gregorianDayNumber`. The target guard and behaviour are unchanged (`git diff` below) |
| `…/assignmentOutcome.ts` | `describeSplitMoveOutcome(outcome, { crossRoomTypeEnabled })` and its context type, appended; create/move/unassign functions untouched |
| Tests | `ReservationSplitMoveDialog.test.tsx` (121), `splitMoveDates.test.ts` (64), `assignmentOutcome.test.ts` (+20 on the split-move describer) |
| `docs/design/PMS-CAL-002-split-move.md`, `docs/project/SNAPSHOT.md`, this report | D4/D6 APPROVED, #99/#100 merged, CP04 status and allowlist |

`git diff fc5e290 -- …/splitMoveTarget.ts`: the `export` keyword plus the three comment lines — nothing else.

### Behaviour as built

* **Dates.** Picker bounds `start+1 … end-1` of the segment's own range (not the visible window); default = `localToday` only when it is a real date strictly inside, else empty — never clamped. A one-night source, an invalid/reversed range or an invalid `localToday` shows a notice, hides the form and Confirm, and focuses Close. The handler re-validates (`checkSplitDate`); `min`/`max` are only a convenience. Server date strings are carried unchanged.
* **Preview.** `Room X keeps N nights [start, split) · last night …` and `Room Y takes M nights [split, end)`. Rooms are called candidates; the server decides capacity.
* **Role/RoomType.** Cross = prefix (`target.currentRoomTypeId ≠ stay.soldRoomTypeId`, from the board's room — not the segment's field) **or** suffix (`candidate.roomTypeId ≠ sold`, compared directly — not the precomputed flag). Without `crossRoomTypeEnabled` only sold-type rooms are offered, and a prefix-cross source disables the dialog with "A Manager must split a stay placed in a different room type than sold." Cross needs the checkbox and a reason; the reason is trimmed, ≤ 500 characters (`SchedulingFieldLimits.Reason`), blank = absent; optional otherwise. The source room is never offered (D2).
* **D4.** `splitDate < localToday` (Property date) → warning and an unchecked, separate acknowledgement; on/after needs none. Independent of the cross confirmation. A change of date or destination resets both acknowledgements (and a destination change clears the reason). Invalid `localToday` fails closed rather than skipping the warning.
* **Submission.** `inFlightRef` set before the first `await`; pending = fieldset disabled, handlers guarded, Close/Escape/backdrop inert and not consuming the one close; a sync throw or rejection = unknown; terminal outcomes lock Confirm permanently (edits, re-renders, reloads, a changed target); only not-sent, a 400 and the store cross-type 403 for a role that may confirm can be sent again, by a new Confirm. A changed Property/segment id/version/room/range marks the dialog stale (a changed board window does not), without hiding a result. Unmount while pending: no state, no `onClose`.
* **Words.** Saved on any `200`; successors are never painted; unknown = "may or may not have been saved… not retried automatically… Close does not undo". Reload line: a known outcome ignores `uncertainResolution`; after an unknown outcome `done` alone says only that the reload does not show whether it was saved; `observed` = matches both parts without proving this request; `changed` = can no longer take effect; `unresolved` = source room and destination nights stay locked, use Check again.

## 4. Acceptance evidence

| # | Acceptance | Evidence |
|---|---|---|
| 1 | Own range, strict bounds, preview counts, candidates; intent has no identity/evidence | Dialog tests: min/max, nearest interior dates accepted, endpoints/outside refused through the DOM, a two-night source with one valid date, 0099/0100, leap/non-leap, 0001, 9999, window independence; `toStrictEqual` on the exact intent and a key-set assertion |
| 2 | D1/D3 prefix/suffix, permissions re-checked; D4 separate; D6 no lifecycle | FrontDesk same type; no write; source cross + sold destination blocked; Manager suffix / prefix / both; reason optional, 500 ok, 501 refused (also padded); permissions lowered mid-dialog; `localToday` re-read at submit; before/on/after, browser date 2020/2040 vs Property date, 0099/0100, all four cross×past combinations, resets, no auto-submit |
| 3 | Single submit, pending unclosable, stale refused, terminal, truthful words | Same-tick submits + double click + held Enter = 1; pending edits/Escape/Close/backdrop; sync throw and rejection = unknown; terminal outcomes survive edits and re-render; target change; unmount-pending with a `console.error` spy |
| 4 | Accessibility; old outcomes unchanged | Labelled dialog/controls, errors associated and focused, Tab/Shift+Tab trap, focus on open/result, scroll classes; existing create/move/unassign describers re-asserted and their suites unchanged |
| 5 | No mount/action/API path; docs; PR; CI | Source test: no client-function import, `fetch`, storage, `Date.now`/`new Date`, `dateMath`; the board, popover and timeline do not mention the dialog. Docs updated. PR and final-head CI: handoff |

### Date and jsdom note

`<input type="date">` sanitises an invalid string to `""` in jsdom (as browsers do while a date is half-typed), so a non-existent day, year 0000, a trailing newline or a five-digit year cannot be driven through the DOM. They are covered in `splitMoveDates.test.ts` (including `"2026-09-22\n"`), which feeds the same `checkSplitDate` the handler calls; the DOM tests cover everything a real date input can produce (endpoints, outside, empty, interior). The date goldens are hand-written Gregorian facts; the inverse is checked against an independent day-by-day calendar walk of all 3,652,059 days of 0001–9999.

## 5. Commands and outcomes (Front_End/Admin_Web, Node 22.23.2 / npm 10.9.8, Vitest 2.1.9)

| Command | Outcome |
|---|---|
| `git fetch --prune origin` | `origin/develop` = `fc5e290…` = baseline; branch absent |
| Targeted: `splitMoveDates.test.ts`, `ReservationSplitMoveDialog.test.tsx`, `assignmentOutcome.test.ts`, `splitMoveTarget.test.ts` | 4 files, 314 passed; the same 314 under `TZ` = UTC, Asia/Ho_Chi_Minh, America/Los_Angeles, Pacific/Kiritimati |
| `npm test` (full) | 41 files, **1234 passed**, 0 failed (was 1029 at `fc5e290`: +205) |
| `npm run lint` / `npx tsc --noEmit` / `npm run build` | 0 problems / exit 0 / compiled successfully |
| `git diff --check` | clean |
| Dialog mutation spot-checks (each reverted; file compared with a saved copy) | prefix cross ignored → 2 fail; past acknowledgement not required → 3; in-flight guard removed → 1; terminal lock removed → 1; comparison against the browser date → 54; source room offered → 1; stale check off → 7; reason limit 501 → 2; write permission ignored → 7 |
| Source-unchanged proof, `git diff --stat fc5e290` over `ReservationBoard.tsx`, stay popover, server timeline, the move/unassign/assignment dialogs, `reconciliation.ts`, `dateMath.ts`, `calendarAccess.ts`, `src/lib`, `src/components/auth`, `package*.json`, `Back_End`, `.github`, `deploy`, `Customer_Web` | empty |

`npm ci` was not needed (dependencies present, lockfile untouched). `.NET`/PostgreSQL/Chrome/live API: `NOT_REQUIRED` for an unmounted dialog; CP05 is where browser acceptance on a real API and scratch PostgreSQL becomes mandatory. A stray `npx vitest --version` run from the repository root (outside `Front_End/Admin_Web`) downloaded Vitest 5.0.3 into the npx cache only; no project file or lockfile changed and the project's Vitest is 2.1.9.

## 6. Self-review

* Files changed are the allowlist; `git diff --name-only fc5e290` was compared with it. Existing tests were not edited to change behaviour (additions only in `assignmentOutcome.test.ts`).
* No `any`, cast or default fallback hides a type; `tsc` and ESLint (react-hooks 7) are clean. Refs are written only in handlers and effects.
* Secret scan of the diff, this report and the docs: none.

## 7. Limits and risks

* **Size.** Far over the 100–400 line target (`docs/governance/WORKFLOW.md` §6): about 1,024 source lines (dialog 776, outcome describer 128, dates 116, export 4), about 1,503 test lines (dialog 1,116, dates 271, outcome 116) and about 100 lines of docs and this report. The roadmap estimated ~450 and named the dialog plus accessibility/focus tests as the safety case; no test was cut. A split into dates+outcome / dialog is possible if Owner prefers.
* The dialog trusts its props for `localToday`, the permissions and the candidates; CP05 owns the authoritative send-time guards (§7.3 of the design), the room/night locks, the pending-write record and the board entry.
* The `SplitMoveIntent` carries `pastDateAcknowledged` so the parent can assert it; the API body must not.
* A native date input cannot show a half-typed invalid string to the handler; it surfaces as an empty date ("Choose the date…").
* `observed` shows the schedule matches the request, which another operator could also have produced; only a `200` proves this request committed.
* NOT_REQUIRED/NOT_RUN: backend, local .NET/PostgreSQL, Chrome acceptance, any cloud call, live deploy, release workflow dispatch.

## 8. Status

`IMPLEMENTATION_CP04: PASS` (mandatory local checks above; final-head CI in the handoff). `REVIEW_CP04: NOT_RUN — OWNER_ONLY`. `SPLIT_MOVE_DIALOG: IMPLEMENTED_UNMOUNTED`. `UI_SPLIT_MOVE_ACTION: NOT_IMPLEMENTED`. `CP05: NOT_STARTED`. `D1–D6: APPROVED`. `BACKEND_CD: PAUSED / NOT_COMPLETE`. `CLOUD_CALLS_CP04`, `LIVE_DEPLOY_CP04`: `NOT_RUN`. The two release flags were written `false` by Owner at an earlier step and were not read again; this checkpoint called no cloud and changed no flag.
