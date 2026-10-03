# PMS-ADMIN-AUTH-001-CP06 — Staff session in Admin_Web

> Draft PR into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline and START_HEAD `8f6222984b8678027e71523f27274407f8eeeb35` (PR #78, CP05, merged `2026-10-03T08:23:15Z`). Branch `feature/pms-admin-auth-001-cp06-admin-web-staff-session`. FINAL_HEAD, PR URL and CI are in the PR body and the handoff (this file is part of the final commit).

CP06 is frontend only. No backend, schema, CLI, CORS, cookie, evaluator, audit, Customer, dependency, lockfile or CI file changed. The backend contract (CP03–CP05) was used as merged.

## Deliverable (`Front_End/Admin_Web`)

| File | Change |
|---|---|
| `src/lib/api/accessMode.ts` | new: `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` → `LocalGate` (unset) / `Staff` / configuration error (empty or any other value); read literally so Next.js inlines it |
| `src/lib/api/staff.ts` | new: `staffLogin`, `fetchStaffSession` (`me`), `staffLogout`; `credentials: "include"`, `cache: "no-store"`, `redirect: "error"`; strict parse of the backend DTO; distinct outcomes (signed-in / invalid-credentials / rate-limited / invalid-request / refused / network / config; authenticated / unauthenticated / error; logged-out / session-ended / unconfirmed) |
| `src/lib/api/client.ts` | mode check before every Calendar request (invalid → nothing sent); board read and the five writes use `include` in `Staff`, `omit` for writes in `LocalGate`; a write 401 is a refusal (`SESSION_ENDED_DETAIL`); public catalog unchanged |
| `src/components/auth/StaffSession.tsx` | new: session provider — checking / authenticated / unauthenticated (none, expired, signed-out) / error; generations drop late answers; `refresh` reports but only applies an authenticated answer; `signOut` ends the session only on a confirmed outcome |
| `src/components/auth/SignInForm.tsx`, `signin/page.tsx` | the template form replaced by the Staff form (no social login, signup or "keep me logged in"); `LocalGate` and invalid-mode messages instead of a form |
| `src/components/calendar/reservation-board/calendarAccess.ts` | new: capabilities per role (FrontDesk / Manager / anything else = none), toolbar wording per mode and role |
| `src/components/calendar/reservation-board/CalendarAccessGate.tsx`, `calendar/page.tsx` | new gate in front of the board: config error / `LocalGate` board / `Staff` session check → `/signin`, error with Retry, or identity bar + board keyed by the Staff id |
| `src/components/calendar/reservation-board/ReservationBoard.tsx` | optional `access` prop (default `LocalGate`, i.e. unchanged): selector from memberships, permission guards in every control **and** handler, 401/403 lifecycle after the existing outcome handling, deferred session end while writes are in flight, write-activity report for Sign out |
| `ReservationBoardToolbar.tsx` | the access text is a prop |
| `src/components/header/UserDropdown.tsx` | template identity removed; it no longer presents a template user as the signed-in Staff |
| `.env.local.example`, `README.md` | the new variable (commented out, since empty is an error), build-time note, Staff-mode behaviour |
| tests | 7 new files (92 tests) + 3 existing pins updated to the CP06 wording/wiring |

`uncertainWriteStorage.ts` is **unchanged**: no new field, no Staff namespace, no clearing on session change.

## Evidence map (MEP §9)

| # | Group | Tests | Live (browser) |
|---|---|---|---|
| 1 | Mode missing/valid/invalid; invalid sends nothing | `accessMode.test.ts` (unset → LocalGate; exact values; 10 invalid spellings incl. `""`, `" "`, `staff`, `Staff `); `clientAccessMode.test.ts` "an invalid access mode sends no Calendar request at all"; `CalendarAccessGate.test.tsx` "an invalid mode shows a configuration error and sends nothing"; `staff.test.ts` "sends nothing when the access mode is invalid"; `SignInForm.test.tsx` invalid mode | `Staff` and unset (LocalGate) runs below |
| 2 | Credentials per call; LocalGate keeps `omit` | `staff.test.ts` (login/me/logout `include`); `clientAccessMode.test.ts` board `include`, each of the five writes `include` in Staff and `omit` in LocalGate, board/catalog default in LocalGate | Staff: cookie accepted by me, board and writes (200/201); LocalGate: anonymous write 201 |
| 3 | Login 200 / generic 401 / 429 / network; >128-char password | `staff.test.ts` (raw password incl. 200 chars and surrounding spaces, no Origin header; 401/429/400/403/5xx/network mapping; no retry); `SignInForm.test.tsx` (raw password, me confirmation before `/calendar`, password cleared, each failure message, no retry, double submit sends one request, eye button never submits, me failure after 200 does not open the board) | desk, manager, desk (again) and desk2 sign-ins |
| 4 | Logout 204 / 401 / unconfirmed | `staff.test.ts` (204 confirmed, 401 already ended, 403/5xx/network never a logout); `StaffSession.test.tsx` "signs out only on a confirmed outcome"; `CalendarAccessGate.test.tsx` confirmed and unconfirmed Sign out | Sign out → `/signin`, board gone, `me` 401 afterwards |
| 5 | Gate before Board; unauthenticated reads neither board nor catalog | `CalendarAccessGate.test.tsx` (nothing before me; 401 → `/signin` once; error → Retry, never redirect or LocalGate); `StaffSession.test.tsx` (only 401 is signed out) | unauthenticated `/calendar` → `/signin`; real `me` 401 `no-store`; no `/api/v1/properties` in Staff mode |
| 6 | Selector from memberships; empty; valid change | `ReservationBoardStaffAccess.test.tsx` group 6 (lists memberships, no catalog, switches; no membership → message, no board read; a refreshed session without the selected Property drops it) | desk sees "Second Hotel" and "The BHA Hotel"; switching reads the right Property |
| 7 | FrontDesk / Manager / unknown — controls and handlers | groups 7/8 (unknown role: no board, no read; FrontDesk offered only the sold type; role lowered while the dialog is open → refused at send time; blocks for FrontDesk) | FrontDesk dialog: 101/102 only; Manager: 201 under "Other room types" |
| 8 | Cross-RoomType create/move by permission | groups 7/8 (create and move offers per role; Manager's confirmed create body has only the allowed fields) | Manager cross-type create to 201 with reason: 201 Created |
| 9 | Read/write 401 lifecycle; no loop, no resend | groups 9/10/12 (board 401 once → session handed back; write 401 settled as a rejection first, intent dropped, nothing resent; success then board 401 still "saved"); `CalendarAccessGate.test.tsx` "a board read 401 … no loop" | password reset and disable via CLI → one board GET 401 → `/signin` |
| 10 | 403 refreshes permissions; no logout, no resend | write 403 → one me re-read, no resend, session kept; store's cross-RoomType 403 → no me refresh; board 403 → no data, one re-read; 403 whose me is 401 → ends | Manager lowered to FrontDesk by CLI → confirmed cross create: one POST 403, one `me` 200, toolbar now FrontDesk, Room 201 no longer offered |
| 11 | Stale answers never drawn | `ReservationBoardStaffAccess.test.tsx` group 11 (board answer for the Property just left); `StaffSession.test.tsx` (refresh answer after the session ended → `superseded`); board keyed by Staff id | – |
| 12 | Success / rejected / not-sent / unknown unchanged | `clientAccessMode.test.ts` (200/201 with unreadable body = success; lost answer = unknown; write 401 = rejected); group 9/10/12 board tests; the existing per-write client and dialog suites unchanged and green | lost-after-commit create: one POST (201 at the server), page shows "could not be confirmed … not retried", reconciled from the board |
| 13 | Pending/unknown through reload, expiry, logout/login, other Staff | "an unknown create stays recorded and locked across sign-out and another Staff member at the same Property" | hung create to 102 → reload: no resend, notice "These nights stay locked", range not offered; sign out → desk2 signs in: lock and notice still there; desk2 disabled → expiry: record still in storage; switch to LocalGate: still locked |
| 14 | Storage unavailable/corrupt blocks writes; reconciliation green | "refuses to send when this tab cannot record the write's intent"; `uncertainWriteStorage.test.ts`, `reconciliation.test.ts`, `blockCreateReconciliation.test.ts` unchanged and green | – |
| 15 | No secrets stored or exposed; no actor/evidence in bodies | `SignInForm.test.tsx` (no `Storage.setItem` during sign-in, password field cleared); `staff.test.ts` (body exactly `{email,password}`); Manager create body test (no actor/role/evidence) | after the runs: `sessionStorage` holds only `thebha.adminCalendar.uncertainWrites` (no JWT, email, password or Staff id), `localStorage` only `theme`; the only JS-visible cookie is an unrelated `_clck`; URL carries nothing; API log has no password value |
| 16 | LocalGate regression | `ReservationBoardStaffAccess.test.tsx` group 16; `CalendarAccessGate.test.tsx` LocalGate; all pre-CP06 board/write suites green (only 3 wording/wiring pins updated) | API without `AccessMode` + local flags, web with the variable unset: public catalog, no `me`, LocalGate banner, anonymous block create 201 |

## Checks (final code, Admin_Web)

| Command | Result |
|---|---|
| `npm ci` | exit 0; `package-lock.json` unchanged |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm test` | exit 0 — 36 files, 766 tests passed (7 new files, 92 new tests) |
| `npm run build` | exit 0 — `/calendar` and `/signin` static |
| `git diff --check` | exit 0 |

Backend: not rebuilt or changed for CP06; the acceptance ran the Release `TheBha.Api.dll` built from this branch, whose `Back_End/` is identical to START_HEAD. CI (Backend, Admin, Frontend) on FINAL_HEAD: see the PR.

## Browser acceptance (real Chrome, TLS verification on)

Configuration:
- PostgreSQL 17 in a container created for this run (`cp06-staff-pg`, `127.0.0.1:55438`, database `cp06_accept`): migrated, `--seed-development`, one extra Property ("Second Hotel"); one real reservation (two Deluxe King units, [2026-10-05, 2026-10-08)) booked through the public API. Staff via the CP02 CLI only: desk (FrontDesk at both Properties), manager (Manager at The BHA Hotel), desk2 (FrontDesk at The BHA Hotel); throwaway passwords generated into files and passed via `BHA_STAFF_PASSWORD`.
- API: `TheBha.Api.dll` (Release), `ASPNETCORE_ENVIRONMENT=Development`, `AdminCalendar__AccessMode=Staff`, no local flags, Kestrel on `https://localhost:7251` with the local mkcert leaf trusted by Chrome (and `http://127.0.0.1:5251`).
- Admin_Web: `next dev --experimental-https -p 3001` with `NEXT_PUBLIC_API_BASE_URL=https://localhost:7251` and `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE=Staff` in the process environment; the Owner's `.env.local` was not modified (it sets only the API URL).
- LocalGate control: API restarted without `AccessMode` and with `EnableUnauthenticatedRead/Write=true`; Admin_Web restarted with the variable unset.

| Step | Result |
|---|---|
| `/calendar` without a session | → `/signin`; `me` 401 `no-store` |
| desk signs in | login preflight + POST 200, `me` 200, board GET 200; no public catalog; identity bar; FrontDesk toolbar text |
| FrontDesk: assign 101, move to 102, unassign, block 201, cancel block | 201, 200, 200, 201, 200 — each followed by a board re-read |
| Sign out | `/signin`, board not rendered, `me` 401 |
| manager signs in; cross-type create of the second unit to 201 with confirmation and reason | Room 201 offered as another type; 201 Created |
| CLI `--staff-grant` manager → FrontDesk while signed in; same confirmed cross create | one POST 403, one `me`, toolbar FrontDesk, no resend; reopened dialog offers 101/102 only |
| CLI `--staff-reset-password` manager; next board read | one GET 401 → `/signin`, no loop |
| desk: create whose answer is lost after the server committed (page `fetch` wrapped in the tab to throw after the real response) | one POST (server 201), page "could not be confirmed … not retried", board shows it |
| desk: create to 102 whose request never completes (wrapper returns a pending promise), then reload | pending intent recorded (`inFlight`), Sign out disabled while it was in flight; after reload: no POST, notice "These nights stay locked and the request will not be sent again", range not offered |
| Sign out, desk2 signs in at the same Property | same notice and lock, no POST |
| CLI `--staff-disable` desk2; Check again | one GET 401 → `/signin`; uncertain record kept |
| LocalGate control | no `me`, public catalog, LocalGate banner, lock still shown, anonymous block create 201 |

Database audit (`RoomOccupancySegmentAudits`, 10 rows): every Staff-mode row has `staff:{id}` of the acting Staff member (desk 8 rows, manager 1); `AuthorizationEvidence` only on the manager's cross-type `Created` row (`staff-rbac:Manager:<P1>:cross-room-type-confirmed`, reason recorded); the LocalGate block row has `admin-calendar-local-development`. The refused 403 attempt and the never-completed request left no row.

Chrome's extension network log labels some requests "503" (aborted dev-mode duplicates of `me`, and the logout POST). The API log has no 503; the logout was confirmed by the frontend only on 204/401, and `me` answered 401 right after.

Cleanup: both processes stopped (ports 7251/5251/3001 free), container `cp06-staff-pg` and its anonymous volume (verified to hold `cp06_accept`) removed, the secret files deleted, the Chrome tab closed (its `sessionStorage` with it). `the-bha-postgres-1` was not touched and is still up. Other dangling Docker volumes on the machine predate this run and were left alone.

## PR size (target 100–400, not a limit — `docs/governance/WORKFLOW.md` §6)

Local `git diff --numstat origin/develop...HEAD`: **+2,605 / −208 = 2,813** in 27 files (the PR body carries the GitHub figure checked against it).

| Group | + / − | Why |
|---|---|---|
| product (5 new + 7 changed files) | +1,232 / −183 | a new session layer (mode, Staff API, provider, gate, sign-in form) and permission guards on every board control and handler; 185 of the added lines are comments on the safety rules |
| tests (7 new + 3 updated files) | +1,192 / −13 | the 16 evidence groups, each negative with a positive control; not trimmed |
| docs (README, env example, design, SNAPSHOT, this report) | +181 / −12 | the configuration, the as-implemented record, CP05 merged sync and this evidence |

Not split: the design (§9) named login/`me` as a possible seam, but a sign-in without the board's 401/403 lifecycle would ship Staff writes whose session end is not handled; the MEP also says not to split the checkpoint on my own.

## Risks and residuals

- The frontend mode must match the backend's `AdminCalendar:AccessMode`; a mismatch is not detected by the frontend. A `Staff` frontend against a `LocalGate` backend sends writes with credentials to an uncredentialed CORS policy: the browser blocks them, the page cannot prove they were not sent, and they show as unknown and locked (no duplicate, but no write either).
- A request that never completes stays locked until the board shows a matching change or the tab is closed (existing reconciliation behaviour, unchanged).
- The UI hides what the role lacks, but the server is the authority; roles other than FrontDesk/Manager get nothing in the UI.
- Next.js dev mode runs the session check twice (the first is aborted); production builds send one. Unit tests pin one `me` per mount.
- The rest of Admin_Web (template dashboard pages) is not protected by the Staff session; only `/calendar` is in CP06 scope. `README.md`'s older "template-only" note predates CP06 and was left as is.
- CP03–CP05 residuals unchanged (a copied cookie is valid until 8 h or the next disable/reset; logout does not rotate the stamp).

`REVIEW: NOT RUN` (Owner invokes `/codex:review --base origin/develop`). CP07 NOT STARTED. Production NOT TOUCHED.
