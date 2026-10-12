# PMS-CAL-002-CP05 — completion report

`SPLIT_MOVE_BOARD_WIRING_AND_ISOLATED_BROWSER_ACCEPTANCE` · implementer CLAUDE · reviewer CODEX_READ_ONLY (Owner invokes) · 2026-10-12

## 1. Identity

| | |
|---|---|
| Branch | `feature/pms-cal-002-cp05-split-move-board-acceptance` (created in the single checkout, from `develop`) |
| Baseline / START_HEAD | `6e31cfda92eb5a81356ca60366867adb7d28fc01` (= `origin/develop`, PR #101 merged) |
| Validation SHA (code + tests) | `fbca276` — every runtime and browser result below ran on this code |
| Later commits | documentation only (this report, design, BIBLE, SNAPSHOT, runbook); the source hash of `Front_End/Admin_Web/src` is the validation SHA's |
| Draft PR / FINAL_HEAD / CI | in the PR description and the hand-off message (a report cannot contain the CI of the commit that contains it) |
| Decisions | D1–D6 APPROVED (not re-asked) |

## 2. What changed (Admin_Web only)

- `ReservationBoardStayPopover.tsx`: optional `onSplitMove` + `splitMoveUnavailableReason`; the button `Move from a date…`. It reports only the clicked `{ stay, segment }`.
- `splitMoveSubmission.ts` (new, pure): `evaluateSplitMoveOffer`, `planSplitMoveSend`, `checkSplitMoveLocks`, `segmentCanBeSplit`. No API call, state or clock.
- `ReservationBoard.tsx`: mounts `ReservationSplitMoveDialog`; `handleSplitMove`; `submitSplitMove`; a split notice; navigation handling; a synchronously-updated board ref (`boardStateRef`/`commitBoardState`) so a handler that runs before React re-renders still sees the board on screen; referenced reconciliation ids include the split dialog and notice; **move, unassign and drag now use `isSegmentAssignmentWriteUnresolved`** (all three operations consume one segment version).
- `calendarAccess.ts`: wording only (the summary mentions the split-move). No permission mapping change.
- Not touched: backend, `client.ts`, `reconciliation.ts`, `uncertainWriteStorage.ts`, storage keys/format, `dateMath.ts`, `splitMoveTarget.ts`, `splitMoveDates.ts`, `ReservationSplitMoveDialog.tsx`, `assignmentOutcome.ts`, `StaffSession`/provider, `.github`, `deploy`, packages.

Send order (`submitSplitMove`): synchronous in-flight flag → role (`assignmentWrite`) → storage readable → `planSplitMoveSend` on the **live** board (board identity, exact source, real Gregorian date strictly inside, destination Active and ≠ source, cross-RoomType for prefix **or** suffix from the board's own RoomTypes, Manager + confirmation + non-blank reason ≤ 500, D4 against the board's current `localToday`, locks: board awaiting a re-read, unresolved move/unassign/split-move on the segment id, source room over its full range, the Unit over those nights, destination over `[splitDate, end)` only) → `beginPendingWrite` → `trackWrite` → one request. A throwing client is `unknown`. The body is `expectedVersion, splitDate, destinationPhysicalRoomId, confirmCrossRoomType`, optional trimmed `reason`; the past-date acknowledgement, actor, evidence, version or ids from the form never reach it.

## 3. Checks (local, current session)

| Command | Outcome |
|---|---|
| `npm test` (Vitest 2.1.9, Admin_Web) | **43 files, 1338 tests passed** (was 41 / 1234: +2 files, +104 tests) |
| `npm run lint` | clean |
| `npx tsc --noEmit` | clean |
| `npm run build` (Next 16.1.6, with `NEXT_PUBLIC_API_BASE_URL` for the proxy) | success |
| `git diff --check` | clean |
| `dotnet restore` / `dotnet build Back_End/TheBha.Booking.sln -c Release` | 0 warnings, 0 errors (needed for the Kestrel stack; the backend suite was not re-run — backend unchanged) |
| `dotnet ef database update` (existing migrations, 9) | applied to the scratch database |
| Secret scan of the diff | no credential, token or key in the commit (see §8) |

Tests added/changed: `ReservationBoardSplitMove.test.tsx` 58 (behaviour: action offered/absent/disabled, body whitelist, FrontDesk/Manager and the three cross-type shapes, D4 and the independence of the two controls, send-time refusals with zero POST — navigation before React re-renders, version/destination/role/sign-out/locks/storage —, double submit, direct calls to the board's `onSubmit` bypassing the dialog, outcomes incl. `200` with unreadable body + failed re-read, throw, 401, generic 403 vs store 403, unknown → `observed`/`changed`/partial, locks outliving navigation and reload, pending reload/restore, storage faults, mixed lists, focus); `splitMoveSubmission.test.ts` 31; popover +6; cross-write lock +4 (the three operations share one lock; destination locked only from the split date); drag +1; Staff access +1; static boundary +3. The existing suites' assertions were not rewritten.

**Mutation checks** (a throwaway script flipped one guard at a time, ran the six affected suites, restored the file): 25 mutations — D4 acknowledgement, prefix-cross, reason limit, destination/segment/source-room/Unit/awaiting locks, live-board key, confirm taken from the form, source room allowed, no pending-guard, no catch, no untrack, no intent check, no `finishIntent`, no `afterWrite`, notice on any board, no storage check, unassign/drag/open ignoring the segment lock, referenced ids dropped, no re-read, source taken from the opener. **All 25 were caught.** Four first survived (the segment-id lock, the unassign/drag/open guards, and the retained notice reference) because room locks subsume them on ordinary data; tests that isolate each were added and now kill them.

## 4. Isolated browser acceptance (real Chrome, real Staff API, real PostgreSQL)

Stack (all loopback, task-owned, removed afterwards):

- **PostgreSQL 18.3** container `bha-cp05-pg` (label `task=pms-cal-002-cp05`), `127.0.0.1:55432`, database `thebha_cp05_demo`; the API's connections were read back from `pg_stat_activity` (only this container). Not RDS, not the demo/showcase databases, not `the-bha-postgres-1` (untouched, still up).
- **API**: Kestrel (Development env, Staff mode — `AdminCalendar:AccessMode` unset, LocalGate not used), `https://localhost:17145`, mkcert leaf, `Cors:AdminOrigins=https://localhost:13201`.
- **Admin Web**: production build, `next start` on `127.0.0.1:13101` behind a task-owned TLS terminator `https://localhost:13201`; `NEXT_PUBLIC_API_BASE_URL=https://localhost:17245`.
- **Fault boundary**: a task-owned Node proxy `https://localhost:17245` → Kestrel (outside the repo, scratch dir). It forwards everything unchanged; a fault either destroys the socket before forwarding, destroys it **after** Kestrel answered (committed, response lost), delays a response, or holds/destroys a board `GET`. It never synthesises an API answer. Chrome 153.0.8010.52, trusted mkcert CA, no certificate warning accepted, no TLS verification disabled.
- Versions: Node 22.23.2, .NET SDK 8.0.423, PostgreSQL 18.3.
- Fixtures: the development seeder, synthetic extra rooms (SQL), two Staff accounts through the CLI, 26 reservations through the **public hold/confirm API**, initial assignments through the Staff API. `Property.localToday` was `2026-10-12`; the board window `Oct 5–Oct 18`.
- Baseline `commercial` hash (all `Reservations`, `ReservationUnits`, `ReservationUnitNights` rows, 182 rows) = `ea2a5a6add5cf78be025fcefa155680f`. It was **identical after every case and at the end** (also after every move/unassign/block smoke).

| # | Case | What the browser did | Requests that reached the API | DB / audit result |
|---|---|---|---|---|
| 1 | FrontDesk same-type | popover → dialog → `Split and move to room 118` | `POST …/split-move` **200**, then 1 board `GET` | source `Cancelled`; prefix `[10-13,10-15)` room 101 and suffix `[10-15,10-18)` room 118 `Effective`; one mutation group; actor `staff:{FrontDesk}`; evidence none; board shows both bars and "Room split-move saved … reloaded"; commercial unchanged. FrontDesk's room list had no Family rooms |
| 4b | capacity conflict (first attempt, destination room 102 already occupied) | same | `POST` **409** (one), then 1 `GET` | nothing written (same `xmin`); dialog terminal ("not saved … overlapping Effective entry"), board re-read, no resend |
| 2a | Manager suffix-only → Family 203 | tried Confirm without the box → no POST; box only → no POST (reason); box + reason | **0** POSTs for the two refusals, then one **200** | evidence `staff-rbac:Manager:…:cross-room-type-confirmed` **only** on the new Family suffix row; prefix `-`; new reason; the old `Created` row of the earlier assignment unchanged |
| 2b | Manager prefix-only (stay already in Family 201 → Deluxe 119) | box + reason | one **200** | evidence only on the new `Created` prefix (201), none on the 119 suffix; the older fixture evidence is not reused |
| 2c | Manager both parts cross (202 → Family 204) | box + reason | one **200** | evidence on both new rows |
| 3a | past date alone (`splitDate` 2026-10-10 < `localToday`) | Confirm → "Acknowledge … already passed" → no POST; tick → Confirm | **0** then one **200** | no reason needed; request carries no acknowledgement |
| 3b | past + cross (Family 203) | ack only → refused; cross box only → refused (ack); both | **0**, **0**, then one **200** | independent controls; evidence only on the cross successor |
| 4 | stale version | dialog open; the source was moved out-of-band (direct API call, not through the UI path); Confirm | one `POST` **409** ("no longer Effective"), 1 `GET` | rejected request wrote nothing; no retry; dialog terminal |
| 5 | unknown, **committed** | proxy: forward → API **200** (committed) → socket destroyed; board `GET` held | `POST` forwarded (200, response dropped), `GET` held | UI: "may or may not have been saved … not retried"; notice "Checking the board…"; **all three popover actions disabled while held**; tab storage held the `split-move` record; after release: notice "now shows both parts … does not prove this request made it"; storage cleared; still **one** POST |
| 6a | unknown, **never reached the API** | proxy destroyed the socket before forwarding | `POST` **not forwarded**; 1 `GET` | DB unchanged; notice "original room assignment is still shown unchanged … still unknown", locked, no resend |
| 6b | … then the source changed elsewhere | out-of-band move; "Check again" | 1 `GET` | notice "changed on the server … can no longer take effect" — not "saved" |
| 6c | partial window | committed + response dropped + first re-read destroyed ("could not be reloaded", unresolved); then 7-day view `Oct 16–22` showing only the suffix | 1 `POST` | not `observed` (reported as `changed`); a failed re-read resolved nothing |
| 7 | reload while pending | `delay-split` (API commits, response held 10 s), page reloaded after 300 ms; pending record held the full identity (`op`, segment id, version, source/destination room, full range, `splitDate`); **Sign out was disabled while the request was on the wire** | one `POST` (200) | after reload: "…sent just before this page was reloaded or left"; **no resend**; reread observed it, record cleared |
| 7b | reload while the re-read is held, then sign-out/sign-in | `fail-before-forward`; reload with the board `GET` held → notice from before the reload shown **before** the data refresh; after release still unresolved and locked; sign-out (record kept) → sign-in as FrontDesk | 1 `POST` total | record kept across sign-out; new Staff session sees the notice and all three actions disabled; **no `split-move` POST** after sign-in |
| 8a | navigation **before** confirm | changed the range with the dialog open | **0** POSTs | dialog closed with "Nothing was sent; start the split-move again" |
| 8b | navigation **while pending** | `delay-split`; moved to the next range while "Splitting…"; sign-out disabled | one `POST` (200) | dialog stayed (uncloseable), then reported "saved … the view changed before the board was reloaded"; **no success notice on the other board** |
| 8c | role lowered while the dialog is open | Manager dialog for a Family destination; `--staff-grant … FrontDesk`; Confirm | one `POST` **403**, one `GET /me` | nothing saved; terminal "not permitted"; the board's capability summary became FrontDesk; **no resend** (the role was restored afterwards) |
| 9a | intent cannot be stored (browser-side `setItem` throws) | Confirm | **0** | "…could not keep the safety record…", dialog still usable, no pending record |
| 9b | damaged pending record | Confirm | **0** | record left untouched, same message |
| 9c | mixed lists | a block create made to fail browser-side (unknown) then an unconfirmed split-move | the block never reached the API; the split was not forwarded | tab storage held `blocks:[create]` and `assignments:[split-move, split-move]` together; no pending intent left |
| 10 | smoke of existing actions | assign, move, **drag-and-drop** (real mouse drag opened Move room with the room preselected), unassign, block create, block cancel, board read | each one request, 200/201 | all reflected in the segment table; **console: no errors** |

Also verified: `Sign out` → `/signin` and `GET /me` = 401; `Sign in` as FrontDesk/Manager → board; the FrontDesk summary mentions the split-move.

DB totals after the run: 44 `Created` + 16 `Cancelled` audit rows, **all** `staff:{id}` actors (0 non-Staff); reservation assignments 28 Effective / 15 Cancelled, one block Cancelled; no row outside the cases above.

## 5. Provenance of mocks, faults and fixtures

- Vitest/jsdom results use a mocked client and are **not** the acceptance; the table above is real Chrome + real API + real PostgreSQL. Faults were injected by the proxy/browser only, never by changing product code; where a case used a browser-side `fetch`/`setItem` patch (9a, 9c block) it is said above.
- Two reservations (C05, C06) were created through the public API and their `Reservations`/`ReservationUnitNights` dates shifted four days earlier with SQL in the scratch database, to obtain a valid segment that starts before `localToday` (the public API cannot book past nights, and the browser clock was not touched). The dev seeder's two `DailyInventoryControls` rows were deleted and extra rooms inserted (capacity). Out-of-band fixture mutations (cases 4, 6b, 8c) used the real Staff API/CLI, never the UI path.
- The first attempt of case 1 hit a destination that fixture C02 already occupied: it is kept as the real capacity-conflict evidence (4b); case 1 was then repeated into a free room.
- Form fields were filled by page JavaScript (native setters + `input` events); bars, the popover close/confirm buttons, sign-out (when the click took) and the drag were real pointer events. A `computer` click on Sign out occasionally did nothing; a DOM click was used then. Staff passwords were random, created per run, supplied through a loopback scratch endpoint so they never entered a command, log or file in the repo, and were shredded.

## 6. Deviations (explained)

1. `ReservationSplitMoveDialog.test.tsx` is outside the allowlist: its source-scan test asserted the dialog is "mounted nowhere" (a CP04-state assertion); CP05 deliberately mounts it. The one loop and the title words were removed (5 lines); mounting is asserted by the board tests and the static test.
2. `ReservationBoard.tsx` was changed beyond the new feature in one place: every `setBoardState` now goes through `commitBoardState`, which also assigns `boardStateRef` (behaviour-neutral; required so send-time checks see the board before React re-renders).
3. The `ReservationBoard.test.tsx`/`…Assignment`/`…BlockCancel`/`…BlockCreate`/`…ServerTimeline` mock allowance was **not needed** (a missing member of a `vi.mock` factory throws only when accessed).
4. PR size is above the 100–400 target: the size and reason are in the PR description; the bulk is behavioural tests (§3) and the real-browser evidence needed safety coverage.

## 7. Limits and NOT_RUN

- `OLD_BUILD_DOWNGRADE_RUNTIME`: **NOT_VERIFIED** (not asked, not checked).
- The Chrome-side localisation of the date picker is `dd/mm/yyyy` here; the dialog's `YYYY-MM-DD` value is what was asserted.
- `LIVE_DEPLOY_CP05`, `CLOUD_CALLS_CP05`: NOT_RUN (no AWS/SSM/ECR/RDS/EC2, no GitHub/Vercel/AWS setting changed, no workflow dispatched). `BACKEND_CD`: **PAUSED / NOT_COMPLETE**; the two release flags were not read or changed (the `false` readbacks of 2026-10-10 are earlier evidence, not a new check).
- The local backend suite and the generic-`403`/`401` timing paths beyond the cases above rely on the existing backend tests and the board unit tests.
- Orca/worktree leftovers and a stash named `owner-gitignore` already existed in the checkout and were not touched.

## 8. Cleanup

Stopped and removed: the API, `next start`, both TLS fronts and the fault proxy (all listeners closed); container `bha-cp05-pg` removed with its anonymous volume (`docker rm -f -v`); other containers (`the-bha-postgres-1`, the showcase set) untouched. The scratch directory outside the repo held the harness; its credential files were shredded. `.next`, `bin/`, `obj/` are ignored build output. No secret, certificate or config was added to the repository; `.env.local` and the certificates were read-only.

## 9. Status

`IMPLEMENTATION_CP05: PASS` · `UI_SPLIT_MOVE_BOARD: IMPLEMENTED` · `UI_SPLIT_MOVE_ISOLATED_REAL_API: PASS` · `REVIEW_CP05: NOT_RUN — OWNER_ONLY` · `PMS_CAL_002: IMPLEMENTED_AWAITING_OWNER_REVIEW_MERGE` · `LIVE_DEPLOY_CP05 / CLOUD_CALLS_CP05: NOT_RUN` · `BACKEND_CD: PAUSED / NOT_COMPLETE`. Lifecycle, folio and templates are still not connected to the backend.
