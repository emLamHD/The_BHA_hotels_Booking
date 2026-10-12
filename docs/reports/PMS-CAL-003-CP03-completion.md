# PMS-CAL-003-CP03 — completion report

`BLOCK_MOVE_DIALOG_BOARD_ACCEPTANCE` · implementer CLAUDE · reviewer CODEX_READ_ONLY (Owner invokes) · 2026-10-12

## 1. Identity

| | |
|---|---|
| Branch | `feature/pms-cal-003-cp03-block-move-dialog-board-acceptance` (created in the single checkout) |
| Baseline / START_HEAD | `3dfab2954a169a58ed4c7a7e1dd3b2b4a2ecaf48` (= `origin/develop`, PR #104 merged; CP01 and CP02 closed) |
| Validation SHA (application source) | `93b3e2f2e957d814f7517e63115c960828d200ba` — the unit/board suites and the real-browser build ran on exactly this source |
| Later commit | documentation only (this report, design §6, BIBLE, SNAPSHOT, runbook) — unchanged-source proof in §6 |
| Draft PR / FINAL_HEAD / CI | in the PR description and the hand-off message |

## 2. What changed (Admin_Web only)

Production, all under `Front_End/Admin_Web/src/components/calendar/reservation-board/`:

- `ReservationBlockMoveDialog.tsx` (new): segment's own full nights, header reason *unchanged*, Active candidate rooms (same room type first), optional reason ≤500 (trimmed, audit only), no date input / cross-type confirmation / past-date acknowledgement. Hands `{ destinationPhysicalRoomId, reason? }` to the board; never calls the client. One synchronous guard; no edit/Close/Escape/backdrop while pending; no resend after a terminal outcome; only `not-sent` and `400` may be corrected.
- `blockMoveSubmission.ts` (new, pure): `evaluateBlockMoveOffer` (why the popover action is disabled), `checkBlockMoveLocks`, `planBlockMoveSend` (everything re-checked against the board as it is now; body built field by field).
- `ReservationBoard.tsx`: `handleMoveBlock`, `submitBlockMove` (`beginPendingWrite` → `trackWrite` → one request → outcome → `finishIntent`/`afterWrite`; activity balanced on a throw), own dialog/notice/reconciliation ids (retention and referenced-block handling), navigation/stale handling like the other block dialogs, and `isBlockSegmentWriteUnresolved` now also gating the **existing cancel** at open (`handleCancelBlock`), at send (`submitBlockCancel`) and in the popover.
- `ReservationBoardStayPopover.tsx`: opt-in `onMoveBlock` + `moveBlockUnavailableReason` (`Move block…` before `Cancel block`; block popover only).
- `assignmentOutcome.ts`: `describeBlockMoveOutcome` (existing functions unchanged).
- `calendarAccess.ts`: wording only (one added sentence; the asserted existing sentence is intact; permission mapping unchanged).

Tests: three new files — `blockMoveSubmission.test.ts` (36), `ReservationBlockMoveDialog.test.tsx` (39), `ReservationBoardBlockMove.test.tsx` (60) = 135 of the +179 tests — plus additions to the popover, outcome, cross-write-lock (two matrix rows: destination-locked and source-locked), Staff-access, block-cancel and static-wiring suites. In `ReservationBoardBlockMoveFoundation.test.tsx` only the two assertions that said "no action / no import" were replaced (the move action is now offered; restore/lock/resolve coverage and "restoring or resolving never calls the move client" are kept). No other existing assertion was changed; no client mock needed `moveOperationalBlock` added in the compatibility-allowance suites.

Not touched (proof in §6): backend, schema, auth/permissions, `lib/api` client/types, `blockMoveTarget`, `blockCreateReconciliation`, `reconciliation`, `uncertainWriteStorage` (engines, formats and keys), date/Gregorian helpers, existing dialogs, StaffSession/provider, timeline/drag, packages/config/workflows/deploy/governance.

## 3. Local checks (current session, validation SHA)

| Command | Outcome |
|---|---|
| `npm test` (Vitest 2.1.9, Admin_Web) | **49 files, 1643 tests passed** (was 46 / 1464) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` (Next 16.1.6, `NEXT_PUBLIC_API_BASE_URL=https://localhost:17445`) | success; this build was the one used in §5 |
| `dotnet restore` + `dotnet build Back_End/TheBha.Booking.sln -c Release` (SDK 8.0.423) | 0 warnings, 0 errors; used only to run Kestrel |
| `git diff --check`, secret scan | clean |
| Local .NET/PostgreSQL **test suites** | NOT_REQUIRED (backend unchanged); CI Backend remains mandatory |

**Mutation checks** (a throwaway script outside the repo flipped one guard at a time, ran ten affected suites, restored the file; 44 mutations): in-flight guard, send-time capability / storage verification / opened-vs-live board key, tracking and balanced untracking, throw → `unknown`, `finishIntent`, `afterWrite`, notice painted on any board, open-time capability and key checks, cancel gated by the segment predicate (open / send / popover), referenced move ids, sent-dialog navigation, dialog permission, resubmit flag, any-destination, reason limit/trim, destination/source/segment/awaiting locks, board identity, confirmation in the body, offer locks, stale refusals, dialog guard/close/edit/terminal lock/trim/limit/room/stale-key, outcome flags and role wiring. **43 caught; 1 equivalent.** The first run produced five survivors and one mutation that did not apply (its pattern matched two places). Tests were added for four survivors — open-time capability (a stale popover callback during a sign-out), retained move ids (a move notice must keep its re-read status while another block write is made), the `submitted` reset (a corrected `400` dialog must close on navigation), the dialog terminal ref (a submit landing between the answer and the re-render) — and the unapplied throw mutation was made specific and is caught. The fifth survivor, `board-open-no-key-check`, **still survives and is the one equivalent mutant**: `evaluateBlockMoveOffer` already requires `currentBoardKeyRef` to equal the board's key, so the board's explicit open-time check is defence in depth.

## 4. Acceptance by contract group

| Group | Result |
|---|---|
| A. Action / dialog | met — §2; real-browser cases 1–7, 17, 18 |
| B. Send-time authority | met — live refs, role/sign-out/access pause, storage, locks, zero-POST refusals; unit + real cases 7, 8, 17, 19, 20 |
| C. Write lifecycle / outcomes | met — one request, 200 always known, 409/unknown re-read, 401/403/404 policy, no optimistic bars, board-keyed notices, unknown/locks/records across reload/sign-out; real cases 8–16, 18, 19 |
| Foundation reuse | met — client, target, reconciliation, locks and storage v1 unchanged (§6) |
| Mandatory checks | local met; GitHub FINAL_HEAD CI in the hand-off |
| Isolated real-API acceptance | `BLOCK_MOVE_ISOLATED_REAL_API: PASS` **qualified**: every matrix row passed except the inactive-source row, which is **PARTIAL** (§5 case 6, §7) pending an OC decision |

## 5. Isolated browser acceptance (real Chrome, real Staff API, real PostgreSQL)

Stack (all loopback, task-owned, removed afterwards):

- **PostgreSQL 18.3** (`PostgreSQL 18.3 (Debian 18.3-1.pgdg13+1)`), container `bha-cp03-pg` (label `task=pms-cal-003-cp03`), `127.0.0.1:55433`, database `thebha_cp03_demo`. The Staff CLI printed `staff: target database 127.0.0.1/thebha_cp03_demo` before every change, and `pg_stat_activity` showed the API connected as `cp03` from the Docker bridge to this database only. Not RDS, not `the-bha-postgres-1` (untouched, still up), not the showcase stack.
- **API**: Kestrel (Development, `AdminCalendar:AccessMode` unset = Staff; LocalGate not used), `https://localhost:17345`, mkcert leaf, `Cors:AdminOrigins=https://localhost:13401`.
- **Admin Web**: production build of the validation SHA, `next start` on `127.0.0.1:13301` behind a task-owned TLS terminator `https://localhost:13401`, `NEXT_PUBLIC_API_BASE_URL=https://localhost:17445`.
- **Fault boundary**: a task-owned Node proxy `https://localhost:17445` → Kestrel (outside the repository). It forwards everything unchanged; a fault destroys the socket before forwarding, destroys it after Kestrel answered (committed, response lost), delays a response, or holds/destroys a board `GET`. It never synthesises an API answer. Chrome `153.0.8010.52`, trusted mkcert CA, no certificate warning accepted, no TLS verification disabled. The browser's CORS preflight `OPTIONS` (204) precedes each write and is not counted below as a request.
- Versions: Node 22.23.2, npm 10.9.8, .NET SDK 8.0.423, Docker 29.8.1, Next 16.1.6, Vitest 2.1.9.
- Source hashes (first 16 hex of SHA-256, identical at build time and at report time): `ReservationBoard.tsx 263e9e446103dd41`, `ReservationBlockMoveDialog.tsx b73471cf6950cca4`, `blockMoveSubmission.ts f862f55bc7a2dd36`, `ReservationBoardStayPopover.tsx 8b1076e3ac166aeb`, `assignmentOutcome.ts 33869f9caac0d2e2`, `calendarAccess.ts 04ea479412b307f0`.
- Fixtures (provenance): the development seeder (Property, two room types, three rooms; its two `DailyInventoryControls` rows deleted), **synthetic rooms** by SQL (Deluxe King 101–125, Family Suite 201–205), three Staff accounts through the CLI (FrontDesk, Manager, a second FrontDesk), **seven reservations through the public hold/confirm API** (five Family Suite on `[Oct 20, Oct 22)` to exhaust that type's capacity, two Deluxe), and synthetic operational blocks through the Staff API. `Property.localToday` was `2026-10-12`; the board window `Oct 5–Oct 18`. Baseline commercial hash (all `Reservations`, `ReservationUnits`, `ReservationUnitNights`, 29 rows) = `ec5cedee2ecc87a28b496607d0b1a84a`; it was **identical after every case and at the end**. Baselines were captured after fixture preparation and compared per case (segments with `xmin`, header, audits, counts, a whole-state hash); external fixture mutations are listed and never counted as product mutations.
- Driver: real mouse/keyboard for cases 1–3, the sign-in/out steps and the drag; for the remaining mechanics the page was driven by a small injected helper that clicks the real controls and fills the real fields (the app and API are real; the events are not `isTrusted`). Credentials are private (never printed or committed); the sign-in form was filled from a scratch loopback helper.

| # | Case | What the browser did | Requests that reached the API | DB / audit / UI result |
|---|---|---|---|---|
| 1 | FrontDesk same-type (`CP03-1`, 101→102, `[10-13,10-16)`) | popover → `Move block…` → room 102 → Confirm | one `POST …/move` **200**, then 1 board `GET` | source `Cancelled`, successor `Effective`, same `RoomBlock` header (22 blocks before/after, creator/reason unchanged; every fixture header has one segment, so **siblings under one header were not exercised in the real browser** — the CP01 backend suite covers them), one new mutation group (`Cancelled` + `Created`), actor `staff:{FrontDesk}`, evidence none, reason none; board shows the block in 102 only after the `GET`; commercial identical |
| 2 | Manager cross-type (`CP03-2`, 103→Family 201) | same, no confirmation field | one **200** + 1 `GET` | same shape; actor `staff:{Manager}`, header creator still FrontDesk; commercial identical |
| 3 | FrontDesk cross-type (`CP03-3`, 104→Family 202) | same | one **200** + 1 `GET` | same shape; actor FrontDesk; no confirmation, no evidence |
| 4 | one night + reason (`CP03-4`, 105→106, `[10-16,10-17)`, reason `"  Pipe fixed  "`) | reason typed with spaces | one **200** | audit rows carry `Pipe fixed` (trimmed) on the new `Cancelled`/`Created` only; header reason unchanged |
| 5 | partly visible source (`CP03-5`, 107→108, `[10-14,10-25)`, window ends 10-18) | dialog read `[2026-10-14, 2026-10-25) · 11 nights` | one **200** | the full 11 nights moved |
| 6 | source room not Active (`CP03-6`) — **PARTIAL** | dialog opened with room 109 Active; room 109 set `OutOfService` in the scratch DB (fixture mutation); Confirm | one **200** | server moves the block out of a room that is no longer Active (109→110). **PARTIAL: the client never saw an inactive source** — the board still showed room 109 as Active when the dialog opened, because the API's board projection never lists a non-Active room (§7). A block already in an inactive room has no bar to click, so the client's inactive-source allowance is verified only by unit tests |
| 7 | reason limit (`CP03-7`) | 501 characters; then `"  " + 500 chars + "  "` | **0** requests for 501 (error "at most 500 characters (now 501)", whole-state hash identical); then one **200** | audit reason stored as exactly the 500 trimmed characters |
| 8 | stale (`CP03-8`) | dialog opened; the same segment was moved elsewhere through the Staff API (scratch fixture, not the UI path); Confirm | one **409** ("no longer Effective"), then 1 `GET` | state identical to the post-fixture baseline; dialog terminal; no resend |
| 9 | destination overlap (`CP03-9`→102, occupied) | Confirm | one **409** ("destination PhysicalRoom already has an overlapping Effective entry"), 1 `GET` | state unchanged |
| 10a | first capacity attempt (`CP03-10`→Family 203) | Confirm | one **200** | my fixture had put the five Family reservations on Oct 20–22, not on the block's nights (Oct 17–19): the server rightly accepted it. Kept as a second Manager cross-type success, not as capacity evidence |
| 10b | capacity (`CP03-10b`, 113, `[10-20,10-22)`→Family 203, free) | next date range; Confirm | one **409** ("Insufficient usable physical capacity for 2026-10-20"), 1 `GET` | room 203 had **0** overlapping Effective entries (free): the refusal is the server's, not inferred from the candidate list; state unchanged |
| 11 | committed, response cut (`CP03-11`, 106→204) | proxy: forward → API **200** → socket destroyed; board `GET` held | `POST` forwarded (200, response dropped), `GET` held | UI: "may or may not have been moved … not sent again", unconfirmed notice "Checking the board…", one record in tab storage (ids, rooms, version, dates; **no reason, actor or PII**), intent handed over (pending key empty), **both popover actions disabled**; DB shows the move committed. After release: notice "no longer shown in room 106 … now shown in room 204 … does not prove this request moved it"; storage cleared; actions enabled; still **one** POST |
| 12 | never forwarded (`CP03-12`, 111→205) | proxy destroyed the socket before forwarding | `POST` **not forwarded**; 1 `GET` | DB identical; "still shown in room 111 exactly as it was … rooms 111 and 205 stay locked"; Create-block probes: 111 **and** 205 refused ("earlier request … still unconfirmed"), 112 allowed (no request sent) |
| 12b | …then changed | the source was moved elsewhere through the Staff API (scratch); **Check again** | only a board `GET` | notice "changed on the server, so this request can no longer take effect … not a record that the move was saved"; record removed; never "Saved" |
| 13 | dismiss (`CP03-13`, 112→125) | the move was left unknown (not forwarded); the source was then cancelled through the Staff API (scratch) so **Check again** gave `changed`; that notice was dismissed while a restored unresolved move (118→119) existed | only a board `GET` | the other record and its lock stayed in storage |
| 14 | look-alike (`CP03-14`, 114→115) | unknown (not forwarded); scratch: source cancelled and an independent block with **another header** created in 115 over the same dates; **Check again** | only a `GET` | `changed`, **not observed** |
| 15 | reload while the POST is pending (`CP03-15`, 116→117) | proxy delayed the response 10 s and held the next `GET`; page reloaded mid-flight | one `POST` (API committed), 1 held `GET` | one restored in-flight notice ("sent just before this page was reloaded or left"), intent handed over once; after release: observed, still one POST |
| 16 | reload while unknown (`CP03-16`, 118→119) | unknown; page reloaded; then real **sign-out and sign-in as another Staff member** | one POST total | one restored notice ("from before this page was reloaded or left"); 118 and 119 locked, 120 free; the record survived sign-out/in; nothing resent; DB identical |
| 17 | navigation before Confirm (`CP03-17`) | dialog open, room chosen, **Next date range** | **0** POSTs (two `GET`s) | the dialog closed; DB identical |
| 18 | navigation during the request + sign-out in flight (`CP03-18`, 121→114) | 10 s delayed response; **Next date range**; clicked **Sign out** | one POST **200** | Sign out was disabled while the write was on the wire (click did nothing) and re-enabled after; the dialog stayed open and reported "moved … The view changed before the board was reloaded"; **no** "Block moved" notice on the other range |
| 19a | membership revoked (`CP03-19`) | membership row deleted in the scratch DB while the dialog was open; Confirm | one `POST` **403**, then **one** `GET /me` | "Moving operational blocks is not available … Nothing was changed"; no resend; access re-read once; DB identical; membership restored with `--staff-grant` |
| 19b | account disabled (`CP03-21`) | `--staff-disable` while the dialog was open; Confirm | one `POST` **401** | session ended → `/signin`; no intent left; DB identical |
| 20 | browser storage faults (`CP03-20`) | page-side patches: `setItem` throwing for the pending key; then a write that cannot be read back | **0** requests for both | "Nothing was sent: this browser tab could not keep the safety record …"; DB identical; after the patches were removed (and the one leftover record cleared, see §7) the same dialog sent one **200** as the second FrontDesk |
| 8b | mixed lists | proxy `fail-write`: an assignment create not forwarded, alongside the unresolved block move of case 16 | assignment `POST` not forwarded | both lists in the tab record; after a reload each is restored once and nothing is lost or resent; DB identical |
| 9 | smoke | assign (201), Move room (200), split-move (200), Remove room assignment (200), block create (201) + cancel (200), board read, and a **real mouse drag** of an assigned bar onto another room (opens the Move room dialog; Confirm → 200) | the writes listed | no regression; commercial hash unchanged |

A first attempt of case 11 consumed its `hold-board` fault on a navigation `GET`; it was released, the DB was confirmed unchanged and the case repeated with the faults armed after the board was loaded.

Console: `read_console_messages` was first called after the matrix, so it could not see earlier messages; from that point no error or exception was captured. Console behaviour during the matrix itself is therefore **not** claimed.

## 6. Unchanged foundation and backend, and the docs-only final commit

`git diff --stat 3dfab29 HEAD -- Back_End Front_End/Admin_Web/src/lib Front_End/Admin_Web/package.json Front_End/Admin_Web/package-lock.json …/blockMoveTarget.ts …/blockCreateReconciliation.ts …/reconciliation.ts …/uncertainWriteStorage.ts …/dateMath.ts …/splitMoveTarget.ts .github` prints nothing at the validation SHA. The commits after it change only `docs/`; the six production files above hash identically before and after.

## 7. Findings, deviations and limitations

- **Finding 1 — OC decision needed (matrix item 2, inactive source: PARTIAL; not fixed, outside the allowlist): the board projection returns only Active rooms** (`Back_End/src/TheBha.Application/Scheduling/ReservationBoard.cs:246` builds every `physicalRooms` entry as `OperationalStatus.Active`; `Back_End/src/TheBha.Infrastructure/Persistence/ReservationBoardDataLoader.cs:91` filters on `Active`). A block whose room is no longer Active therefore has no row and no bar on the board: it cannot be moved *or cancelled* from the UI, and `buildBlockMoveTarget`'s allowance for an inactive source is reachable only through tests and through the §5 case 6 timing (the room changes after the board was read). The server does allow moving such a block (case 6). OC decision needed if operators must manage blocks of inactive rooms from the board (projection would have to list them with their status).
- A write whose read-back fails (case 20, the injected "cannot be read back") leaves the intent that was written; it would be restored after a reload as an in-flight write although nothing was sent. This is the existing, conservative behaviour of `beginPendingWrite` and was not changed; the browser-side fault is injected, and the leftover record was cleared by hand between cases.
- An unresolved write is answered before "waiting for the board to be re-read" in `checkBlockMoveLocks` (more precise, and what the cross-write matrix asserts); the awaiting message still applies when only a settled write has not been re-read.
- Fixture slip (10a) is reported as such above; the capacity case was repeated correctly (10b).
- No edit outside the allowlist; `ReservationBoardAssignment.test.tsx` and the other compatibility-allowance suites are untouched.
- `OLD_BUILD_DOWNGRADE_RUNTIME`: **NOT_VERIFIED** (no baseline parser was run; the storage format is unchanged since CP02).
- Skills: `diagnosing-bugs` not triggered; Graphify NOT_APPLICABLE. No Docker image was built or dispatched; CI is the image/preview evidence.
- PR size is above the 100–400 target: roughly 1254 production lines (dialog 514, board 337, seam 268, popover 32, outcomes 101, wording 2), 2851 test lines and the docs; the production change is the dialog, the pure seam and the board wiring, and the tests carry the safety coverage the prompt requires (guards, lifecycle, locks, storage, regressions). The exact GitHub additions/deletions are in the PR description.

## 8. Cleanup

Stopped and removed: Kestrel, `next start`, the TLS terminator and fault proxy (all listeners closed), container `bha-cp03-pg` with its anonymous volume (`docker rm -f -v`; no container with the task label remains); `the-bha-postgres-1` was never touched and is still up. The scratch directories outside the repository (`cp03h` harness/logs/fixture scripts and `cp03` mutation script) were deleted before this commit and their absence checked; the credential files were shredded as soon as the browser run ended. The browser tab was closed. `.next`, `bin/`, `obj/` are ignored build output. No secret, certificate or config was added to the repository.

## 9. Status

`IMPLEMENTATION_CP03: PASS` (acceptance qualified as above) · `UI_OPERATIONAL_BLOCK_MOVE: IMPLEMENTED` · `BLOCK_MOVE_ISOLATED_REAL_API: PASS (qualified — inactive-source row PARTIAL, §7 Finding 1, OC decision)` · `REVIEW_CP03: NOT_RUN — OWNER_ONLY` · `PMS_CAL_003: IMPLEMENTED_AWAITING_OWNER_REVIEW_MERGE` · `OLD_BUILD_DOWNGRADE_RUNTIME: NOT_VERIFIED` · `CLOUD_CALLS_CP03 / LIVE_DEPLOY_CP03: NOT_RUN` · `BACKEND_CD: PAUSED / NOT_COMPLETE` (the two release flags were not read or changed; the `false` readbacks of 2026-10-10 are earlier evidence).
