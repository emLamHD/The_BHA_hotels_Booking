# PMS-CAL-004-CP01 — completion report

`INACTIVE_ROOM_BLOCK_VISIBILITY` · implementer CLAUDE · reviewer CODEX_READ_ONLY (Owner invokes) · 2026-10-12

## 1. Identity

| | |
|---|---|
| Branch | `feature/pms-cal-004-cp01-inactive-room-block-visibility` (created in the single checkout) |
| Baseline / START_HEAD | `ab838897861d3e636c4e7433b5898e3eb9c0ae0e` (= `origin/develop`, PR #105 merged; `PMS-CAL-003` closed with its historical qualifier) |
| Validation SHA (application source) | `7aba35885633cdb03108f8d01bc8a19caa5d965b` — the backend and Admin suites and the real-browser build ran on exactly this source |
| Later commit | documentation only — unchanged-source proof in §6 |
| Draft PR / FINAL_HEAD / CI | in the PR description and the hand-off message |

## 2. What changed

Backend (`Back_End/`, no route, schema, auth, DTO field or enum change):

- `ReservationBoard.cs`: `ReservationBoardPhysicalRoomData` gains `OperationalStatus`; the mapper passes it through instead of hard-coding `Active`.
- `ReservationBoardDataLoader.cs`: the Effective-block query now runs first (tagged `OperationalBlocksQueryTag`) and the room query is `PropertyId = p AND (Active OR Id ∈ block rooms)`, in the same `RepeatableRead` snapshot (or ambient transaction), `AsNoTracking`, cancellation token and `CandidateUnitsQueryTag` unchanged. Block predicate, `RoomBlock` join and every other query are unchanged.

Admin_Web (`src/components/calendar/reservation-board/`):

- `ReservationBoardServerTimeline.tsx`: a listed non-Active room gets its normal row with a status badge (`Inactive` / `Out of service`) and an accessible name on its block bars; RoomType headers/rows come from the *listed* rooms while the always-present empty Unassigned lane comes only from *Active* rooms (a visible unassigned stay still gets a lane by the old rule). Filters unchanged.
- `assignmentTarget.ts`: comment only (the status check is now decisive; it was already enforced). No other eligibility code needed to change: every candidate list goes through `selectAssignableRoomCandidates`, the block-move target already filters Active, and the board's drop refusal already says "Room N is not Active."

Tests: backend `AdminReservationBoardInactiveBlocksApiTests` (9) and one Staff-boundary test; Admin `ReservationBoardInactiveBlocks.test.tsx` (8), seven timeline tests, and an `Inactive`-status regression each in `assignmentTarget.test.ts` and `splitMoveTarget.test.ts`.

## 3. Checks (local, validation SHA)

| Command | Outcome |
|---|---|
| `dotnet restore` / `dotnet build Back_End/TheBha.Booking.sln -c Release` (SDK 8.0.423) | 0 warnings, 0 errors |
| `dotnet test Back_End/TheBha.Booking.sln -c Release --no-build` on task-owned **PostgreSQL 18.3** (container `bha-cp04-pg`, loopback), fixture clock pinned | **unit 244 passed; integration 930 passed** (was 920; +10), 0 failed / 0 skipped |
| `npm test` (Vitest 2.1.9, Admin_Web) | **50 files, 1660 tests passed** (was 49 / 1643) |
| `npx tsc --noEmit`, `npm run lint` | clean |
| `npm run build` (Next 16.1.6, `NEXT_PUBLIC_API_BASE_URL` set) | success; this build ran the browser matrix |
| `git diff --check`, secret scan | clean |

**RED (baseline reproduction).** The new backend tests were run against the baseline room filter (only the query tag added): **6 of 9 failed** — a block in an Inactive/OutOfService room produced no `physicalRooms` row (`KeyNotFoundException` for the room id; `Assert.Single` on an empty collection; room-type, ordering and both race tests failing for the same reason); the 3 that passed are the guards against over-widening. The frontend: 3 of the new timeline tests fail against the old `ReservationBoardServerTimeline.tsx`. After the change all pass.

**Concurrency.** Two deterministic tests pause the projection with `ReservationBoardSnapshotBarrierInterceptor` right after the block query and before the room query — no sleeps: (a) a room turned Active mid-projection is still `Inactive` with its block in that read and `Active` in the next; (b) a block cancelled mid-projection still shows its room and block in that read and the next read drops both. The existing candidate-unit snapshot test and the interceptor are unchanged and pass.

**Mutation checks** (a throwaway script outside the repository flipped one guard at a time, rebuilt or re-ran the affected suites, restored the file): backend 6 — rooms Active-only, rooms all, blocks include Cancelled, half-open boundaries widened, mapper hard-codes `Active`, loader drops the status; frontend 5 — lane for an inactive-only type, no header for it, no status badge, no accessible name, candidates allow non-Active. **11 of 11 caught.**

## 4. Acceptance by contract group

| Group | Result |
|---|---|
| A. Bounded read projection | met — §2/§3 (exact inclusion rule, real status, full dates, unique rows, room types, ordering, snapshot, read-only, Staff/gate boundaries unchanged); real payload in §5 |
| B. UI and write eligibility | met — status row, inactive-only type header without a spurious lane, filters, existing Move/Cancel from the bar, Active-only destinations (pickers, drag, forced callbacks), row removal/persistence; real cases 1–7 |
| C. Evidence boundaries | met — RED reproduced; the `PMS-CAL-003-CP03` row stays PARTIAL at its own SHA; resolved only by §5 (status seen from the GET before the dialog; move and cancel succeeded) |
| Mandatory checks | local met; GitHub FINAL_HEAD CI in the hand-off |

## 5. Isolated browser acceptance (real Chrome, real Staff API, real PostgreSQL)

Stack (loopback, task-owned, removed afterwards): **PostgreSQL 18.3** (`PostgreSQL 18.3 (Debian 18.3-1.pgdg13+1)`), container `bha-cp04-pg` (label `task=pms-cal-004-cp01`), database `thebha_cp04_demo`; the Staff CLI printed `target database 127.0.0.1/thebha_cp04_demo` before every change. Kestrel (Development, Staff mode; LocalGate not used) `https://localhost:17545`, mkcert leaf, `Cors:AdminOrigins=https://localhost:13501`; Admin_Web production build of the validation SHA, `next start` on `127.0.0.1:13601` behind a task-owned TLS terminator `https://localhost:13501` (`NEXT_PUBLIC_API_BASE_URL=https://localhost:17645`); a task-owned fault proxy `https://localhost:17645` → Kestrel (outside the repository) that forwards everything unchanged, or destroys a socket before forwarding, or after Kestrel answered, or holds a board `GET`; it never fabricates an answer. Chrome `153.0.8010.52`, trusted mkcert CA, no certificate warning accepted, no TLS verification disabled. Node 22.23.2, npm 10.9.8, .NET SDK 8.0.423, Docker 29.8.1, Next 16.1.6.

Source hashes (first 16 hex of SHA-256): `ReservationBoardServerTimeline.tsx 145816073d433636`, `assignmentTarget.ts 03c911ea9619fafb`, `ReservationBoardDataLoader.cs 81914792f9e6cafa`, `ReservationBoard.cs e594ae2d91d19458`.

**Fixtures (provenance).** The development seeder; by SQL in the scratch database: Deluxe King rooms 103–120, Family Suite rooms 202–205, an extra RoomType `Archive Wing` with rooms 901–903, and deletion of the seeder's two `DailyInventoryControls` rows; three reservations through the public hold/confirm API and one assignment through the Staff API; every operational block through the Staff API **while its room was Active** (one cancelled through the API); **one extra Effective segment under the same `RoomBlock` header on room 113 inserted by SQL** (HTTP create makes one segment per header; the engine reads segments, so the state is faithful); then, **before any browser GET or dialog**, rooms 109 and 902 were set `OutOfService` and 111–117, 901 and 903 `Inactive` by SQL. Staff: FrontDesk, Manager and a second FrontDesk through the CLI; credentials private and never printed. `Property.localToday` `2026-10-12`; board window `Oct 5–Oct 18`. Baseline commercial hash (all `Reservations`, `ReservationUnits`, `ReservationUnitNights`, 13 rows) `24f554a69faa2a4bbea3a943a591be62` — **identical after every case and at the end**; the room-status hash (every room's status and `UpdatedAt`) was identical after every case — nothing on the board changed a room's status.

**The real GET (FrontDesk, before the browser opened anything):** 200; non-Active rooms listed `109 OutOfService`, `111`, `112`, `113`, `117`, `901` `Inactive`; all 17 Active rooms listed; **not** listed: `114` (only a Cancelled block), `115` (its Effective block is Nov 1–3, outside the window), `116`/`902`/`903` (no block); room types `Archive Wing`, `Deluxe King`, `Family Suite`. The browser's board showed the same six rows with their statuses.

| # | Case | What the browser did | Requests that reached the API | DB / audit / UI result |
|---|---|---|---|---|
| 1 | FrontDesk, **OutOfService** source (`CP04-1`, 109→110, `[10-13,10-16)`) | real pointer: bar → `Move block…` → dialog "109 (Deluxe King) · OutOfService" → room 110 → Confirm | one `POST …/move` **200**, 1 board `GET` | source `Cancelled`, successor `Effective` in 110, same header (9 blocks before/after), one new group, actor FrontDesk, evidence none; **room 109 still OutOfService**; the row 109 disappeared in the re-read; the dialog offered only the 17 Active rooms (no 109, 111, 112, 113, 117, 901) |
| 1b | Manager, **Inactive** source, cross-RoomType (`CP04-1b`, 111→Family 201) | same, no confirmation field | one **200** + 1 `GET` | actor Manager, header creator still FrontDesk, evidence none; 111 still Inactive; row gone |
| 2 | Block **already** in an Inactive room (`CP04-2`, 112) | bar → `Cancel block` → Confirm | one `POST …/cancel` **200**, 1 `GET` | segment `Cancelled`, audit actor FrontDesk, header unchanged, room 112 still Inactive; row gone |
| 3 | Two Effective segments, one header, Inactive 113 (`CP04-3`) | one row and two bars; moved the first to 108; cancelled the last | `move` **200** + `GET`; `cancel` **200** + `GET` | after the first: **row and sibling bar stayed**, notice focused ("Block moved from room 113 to room 108"); after the last: **row gone**; both headers' segments consistent; room 113 still Inactive |
| 4 | Destinations | opened assign, Move room, split-move, block-create and block-move pickers | **0** | none offered an inactive room (FrontDesk: assign 12, Move room 11, split-move 11, block-create 18 select options incl. the placeholder, block move 17 candidates); a **real mouse drag** of an assigned bar onto the Inactive 111 row opened no dialog ("Nothing was moved."), **0 POSTs**, whole-state hash unchanged; the same drag onto Active 105 opened Move room with 105 preselected (closed unsent). Forced callbacks are covered by behavioural tests, not the browser |
| 5 | Bounds and window | 114, 116, 902, 903 never listed; Next range | **0** POSTs | the later window listed only 115 with `[2026-11-01, 2026-11-03)` and its dialog showed those full nights; Operational Blocks filter off hid the bar and kept the row; back to the first window the original rows returned; Active rooms unaffected |
| 6 | Real move, response cut, source Inactive (`CP04-6`, 117→118) | proxy: forward → API **200** → socket destroyed; the re-read `GET` held; page reloaded; next `GET` held, then released | one `POST` (committed), `GET`s held/released, no second `POST` | UI "may or may not have been moved … not sent again"; one record in tab storage (no reason/actor); both popover actions disabled; after the reload the restored notice "from before this page was reloaded or left"; after release **observed** ("no longer shown in room 117 … now shown in room 118 … does not prove this request moved it"), row 117 gone, record cleared |
| 6b | Not forwarded, Inactive-only RoomType (`CP04-3b`, 901→103) | proxy destroyed the socket before forwarding | `POST` **not forwarded**; `GET`s | DB identical; "still shown in room 901 exactly as it was"; Move and Cancel disabled; Create-block on destination 103 refused ("earlier request … still unconfirmed"); reload restored the record, **no resend**; then a scratch independent cancel of the source and **Check again** (only a `GET`) → `changed`, never "saved"; the `Archive Wing` header and row disappeared; dismissed |
| 7 | Smoke | assign (201), Move room (200), split-move (200), unassign (200), block create (201) and cancel (200), then **Sign out** | the writes listed; `POST /auth/logout` 204; `GET /me` afterwards 401 | no regression; commercial and room-status hashes identical |

Console: tracking started after the first board load; no error or exception was captured from then on. Network evidence is the proxy log above (each case's requests, statuses, held/dropped boundary).

**Not separately exercised in the browser:** a deliberate "status fault" (a room status changed between the GET and the dialog) — the matrix kept the status fixed after fixture preparation, as required, and the race is proven by the deterministic backend tests; row disappearance never lost an unconfirmed record or notice (cases 3, 6, 6b). The popover of a block does not state the room's status (the popover is outside the allowlist); the status is on the board row and in the move dialog.

Driver note: the first move (case 1) and the drag, the sign-in/out clicks used real pointer actions; the other mechanics were driven by a small injected helper that clicks the real controls and fills the real fields (the app and API are real; those events are not `isTrusted`). Two helper calls hit a 45 s CDP timeout while the page was busy; the page-side script had completed (checked against the proxy log and DB) or was repeated in smaller steps.

## 6. Unchanged authorities and the docs-only final commit

`git diff --stat ab83889 HEAD` over `Back_End/src/TheBha.Domain`, `…/Migrations`, `Back_End/src/TheBha.Api` (controllers, routes, auth, `Program`), `OperationalBlockMutationStore.cs`, `AssignmentMutationStore.cs`, `Front_End/Admin_Web/src/lib` (client/types), `package*.json`, `ReservationBoard.tsx`, the block-reconciliation/storage engines, the block-move dialog, the popover and `.github` prints nothing. The commits after the validation SHA change only `docs/`; the four production files above hash identically before and after.

## 7. Deviations and limitations

- No edit outside the allowlist; `ReservationBoard.tsx` and the popover needed none (their guards and refusals already covered the new rows).
- `assignmentTarget.ts` changed in a comment only.
- The hand-run real-browser matrix is single-run evidence; the deterministic coverage is the automated suites.
- Out of scope and unchanged: inventory/sellability (Active-only), room status editing/reactivation, date resize, any Manager-only rule, lifecycle/folio/templates, block split/batch/swap, the CP03 storage-readback intent limitation (not recovered here, and the manual cleanup used in CP03 is not a recovery for users), and every cloud or deploy step. `OLD_BUILD_DOWNGRADE_RUNTIME`: **NOT_VERIFIED**.
- Skills: `diagnosing-bugs` not triggered; Graphify NOT_APPLICABLE. No Docker image was built or dispatched; CI is the image/preview evidence.
- PR size: GitHub additions/deletions and the source/tests/docs split are in the PR description; the production change is small (≈130 lines) and the tests carry the safety coverage the contract requires.

## 8. Cleanup

Stopped and removed: Kestrel, `next start`, the TLS terminator and fault proxy (all listeners closed), container `bha-cp04-pg` with its anonymous volume (and a second throw-away container used only for the mutation runs); no container with the task label remains; `the-bha-postgres-1` was never touched and is still up. The scratch directory outside the repository (harness, logs, fixture and mutation scripts) was deleted before this commit; credential files were shredded as soon as they were no longer needed. The browser tab was closed. No secret, certificate or config was added to the repository.

## 9. Status

`IMPLEMENTATION_CP01: PASS` · `INACTIVE_BLOCK_BOARD_VISIBILITY: IMPLEMENTED` · `INACTIVE_SOURCE_MOVE_CANCEL_ISOLATED_REAL_API: PASS` · `PMS_CAL_003_INACTIVE_SOURCE_QUALIFIER: RESOLVED_BY_NEW_EVIDENCE` · `REVIEW_CP01: NOT_RUN — OWNER_ONLY` · `PMS_CAL_004: IMPLEMENTED_AWAITING_OWNER_REVIEW_MERGE` · `CLOUD_CALLS_CP01 / LIVE_DEPLOY_CP01: NOT_RUN` · `OLD_BUILD_DOWNGRADE_RUNTIME: NOT_VERIFIED` · `BACKEND_CD: PAUSED / NOT_COMPLETE` (the two release flags were not read or changed).
