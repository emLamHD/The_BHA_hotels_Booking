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

## Correction C1 (`PMS-ADMIN-AUTH-001-CP06-C1`)

Codex review of CP06 (`/codex:review --base origin/develop`, invoked by Owner): RUN — 2 findings, both P2. Reviewed SHA: UNVERIFIED (the review output names no commit). START_HEAD of C1: `571f33b1946754694e302602bf6002d69c530997`.

| Finding | Root cause | Fix |
|---|---|---|
| F1 — a refresh supersedes a pending sign-out | `refresh()` and `signOut()` shared one generation counter; a board 403 during a pending logout ran `refresh()`, which bumped it, so the confirmed `204` was treated as stale and the identity and board stayed mounted | `StaffSession.tsx`: a pending sign-out is held in a ref. A refresh asked for meanwhile reads nothing and waits; a confirmed logout (`204`/`401`) always ends the session and invalidates every `me` still on the wire; an unconfirmed one runs that refresh once and reports back only after it answered, so changes never resume on memberships a denial asked to re-check. Retry is ignored while signing out; a throwing logout is reported unconfirmed, never a stuck lock |
| F2 — new writes during a pending sign-out | the gate disabled only Sign out; the board kept its controls and handlers, and the "write in flight" signal reached the gate through an effect, one render late | `CalendarAccessGate.tsx`: two refs (signing out, writing) decide both directions synchronously. `ReservationBoard.tsx`/`calendarAccess.ts`: write activity is reported from `trackWrite`/`untrackWrite` directly; `capabilitiesFor` takes `writesPaused` (render: `access.signingOut`; send time: `access.isSigningOut()`), so every control closes and all five submit handlers refuse before recording an intent (`not-sent`, "Signing out — this change was not sent"). The board stays mounted until the sign-out is confirmed |

`uncertainWriteStorage.ts`, the API client and the outcome semantics are unchanged.

Red/green (deterministic deferred promises, no sleeps): 25 new tests — `StaffSession.test.tsx` +4, `CalendarAccessGate.test.tsx` +21 (one F1 gate test, the closed controls, the five writes × {dialog opened before Sign out, Sign out then submit in one tick, submit then Sign out in one tick}, an existing record untouched, a write on the wire holding Sign out for a success and an unknown outcome, LocalGate). Run against START_HEAD's four product files: **21 failed / 17 passed** — every failure a defect assertion (write spy called, `me` read during sign-out, identity kept after a confirmed logout, control not disabled, logout sent while a write was in flight); the 4 green ones are guards that hold on both. On the fixed code: 38/38.

| Command (final code) | Result |
|---|---|
| `npm test` | exit 0 — 36 files, 791 tests |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm run build` | exit 0 |
| `git diff --check` | exit 0 |

Browser acceptance (real Chrome, trusted mkcert certificate, TLS verification on; PostgreSQL 17 container `cp06c1-pg` and database `c1_accept` created for this run; API and Admin_Web in `Staff` mode from the corrected tree). Responses were coordinated in the tab by wrapping `window.fetch` (hold a request before it is sent, or hold the answer after the server replied, then release or fail it); the backend was not changed. A real server 403 came from removing the Staff member's Second Hotel membership in the throwaway database (re-granted with the CLI between scenarios).

| # | Scenario | Result |
|---|---|---|
| 1 | logout held; board read → real 403; logout released | no `me` during the pending logout; after release one logout POST, page on `/signin`, identity and board gone, `me` 401 |
| 2 | assign dialog opened before Sign out, submitted while logout held | "Signing out — this change was not sent"; no assignment request; nothing in storage; database 0 segments / 0 audit rows |
| 3 | logout failed (transport) | "sign-out was not confirmed", session kept; the same dialog resubmitted → 201. Second run: Second Hotel 403 while logout held → no `me`; after the unconfirmed answer exactly one `me` → selector lists only The BHA Hotel, board switched, Sign out back |
| 4 | write before logout | response held after the server committed (201): Sign out disabled, and even with `disabled` removed a click sent no logout; released as a transport failure → unknown, not retried, reconciled from the board. An unassign failed before sending → unknown, record kept; Sign out → `/signin`, `me` 401, the record unchanged in `sessionStorage` |

Database afterwards: two `Created` audit rows, both `staff:{id}` (scenario 3's write and scenario 4's committed write); no row from the refused submit or the failed unassign. Secret scan (the throwaway password, `Set-Cookie`, the Staff cookie name) over the API, web and CLI logs: 0. Cleanup: processes stopped, container and its volume removed (`docker rm -fv`), secret files deleted, tab closed; `the-bha-postgres-1` untouched.

`ORIGINAL_REVIEW: RUN — 2 findings`. (C1 review status: see Correction C2.)

## Correction C2 (`PMS-ADMIN-AUTH-001-CP06-C2`)

Codex review of C1 (`/codex:review --base origin/develop`, invoked by Owner): RUN — 2 findings, both P2. Reviewed SHA: UNVERIFIED. START_HEAD of C2: `8292041e19d462458b0269ee5f8e5340676cf5d7`.

| Finding | Root cause | Fix (`StaffSession.tsx`) |
|---|---|---|
| F1 — a permission re-read interrupted by Sign out is lost | `signOut()` aborted the `me` on the wire (`begin()`) but started with `refreshWanted = false`; after an unconfirmed logout nothing re-read, the caller got `superseded`, and the board resumed on the old memberships | the public refresh on the wire is tracked in a ref; Sign out takes it over before aborting it (`refreshWanted = true`) and the interrupted caller then waits for the sign-out and returns its re-read. Its own late answer is dropped by the generation check |
| F2 — sign-out ends before its recovery re-read | `signOutRef` was cleared before the recovery `readMe()` finished, so a second denial started a new read that aborted the recovery; the logout promise resolved and the gate reopened writes on unverified roles | the marker stays until the whole transition ends (only its owner clears it, in `finally`); a refresh during recovery joins it; the recovery uses the internal read, never the public `refresh` that waits on the transition; a repeated Sign out returns the same promise (no second POST) |

Recovery outcomes: authenticated → new memberships/role applied, then the sign-out reports back; `401` → session ended (`expired`, `/signin` once); network/5xx/unreadable → access closed as an error ("Sign-out was not confirmed, and your access could not be checked again: … Retry to check it.") with Retry, never "signed out" and never the old roles; an expiry or unmount meanwhile is final. `CalendarAccessGate.tsx`: after a sign-out settles, the write lock reopens in an effect — after the render carrying the re-read roles, whose board effects hand them to the handlers first — not in the promise continuation.

Red/green: 14 new tests (`StaffSession.test.tsx` +8, `CalendarAccessGate.test.tsx` +6 with the real board), deferred promises only. On START_HEAD's product code: **7 failed / 45 passed** — F1 provider and gate (`me` called 2 times, expected 3: the interrupted check is never redone), F2 provider and gate (`me` called 3 times, expected 2: a second denial starts a new read during the recovery; the old code also sent a second logout POST), recovery that cannot check access (provider: state not `error`; gate: no error panel, the board stays on the old roles), recovery `401` at provider level (state not ended). The gate-level `401`, the confirmed-logout and no-refresh controls and the expiry case pass on both. On the fixed code 52/52; all C1 regressions green.

| Command (final code) | Result |
|---|---|
| `npm test` | exit 0 — 36 files, 805 tests |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm run build` | exit 0 |
| `git diff --check` | exit 0 |

Browser acceptance (real Chrome, trusted mkcert certificate, TLS verification on; PostgreSQL 17 container `cp06c2-pg`, database `c2_accept`; API and Admin_Web in `Staff` mode from the corrected tree; Staff `lead` created by the CLI as Manager at both Properties). **The order of answers was simulated** by wrapping `window.fetch` in the tab: chosen requests were held before being sent and then released (`send`) or failed as a transport error (`fail`). Server changes were real: memberships removed in the throwaway database, roles changed with the CLI. The backend was not modified.

| # | Scenario | Requests (in order) and result |
|---|---|---|
| 1 | `me` re-read on the wire before Sign out → logout unconfirmed → recovery with new roles | Second Hotel read 403 → `me` #3 held; Sign out (logout held); CLI: Manager → FrontDesk at The BHA Hotel; logout failed → replacement `me` #6. While #6 was held: Create operational block disabled, "Signing out…". Released → 200: selector only "The BHA Hotel", role FrontDesk, writes reopened. #3 released last: the page had already aborted it; nothing changed |
| 2 | second denial during the recovery | while #6 was held: Second Hotel read 403 (#7) → no new `me`, writes still closed, "Signing out…"; one logout POST in total; no write request at all |
| 3 | recovery cannot check access, then Retry | logout held; The BHA Hotel membership removed; read 403 → re-read waits; logout failed → recovery `me` failed → error panel (sign-out not confirmed, access not checked) with Retry, board gone, not on `/signin`. CLI: The BHA Hotel back as Manager, Second Hotel FrontDesk; Retry → `me` 200 → both Properties, Manager at The BHA Hotel, writes enabled |
| 4 | control: confirmed logout | one logout POST → `/signin`, identity gone, `me` 401, no further requests |

The recovery error message was later re-worded (punctuation only; the acceptance run showed it with parentheses). Database: 0 segments, 0 audit rows — nothing was written during any transition. Secret scan (the throwaway password, `Set-Cookie`, the Staff cookie name) over API, web, migrate and seed logs: 0; browser storage afterwards: `theme` only. Cleanup: processes stopped, container and its volume removed (`docker rm -fv`), secret files deleted, tab closed; `the-bha-postgres-1` untouched.

`C1_REVIEW: RUN — 2 findings`. (C2 review status: see Correction C3.)

## Correction C3 (`PMS-ADMIN-AUTH-001-CP06-C3`)

Codex review of C2 (`/codex:review --base origin/develop`, invoked by Owner): RUN — 1 finding, P2. Reviewed SHA: UNVERIFIED. START_HEAD of C3: `0a03e3b55e6bbc513aeb0d9d9f8b8684f6a4316b`.

Root cause: `ReservationBoard.refreshAfterDenial()` acted only on `unauthenticated`. After a board read or write `403`, a `me` re-read that failed (network/CORS, 5xx, unreadable) returned `error`, the board ignored it, and the provider kept the session — so the board stayed writable on the roles the denial had just called into question, with no error and no Retry. Nothing paused writes while the re-read was on the wire either.

Final behaviour (one contract for every re-read after a denial):

| Re-read result | Behaviour |
|---|---|
| `authenticated` | the re-read memberships/roles apply; writes reopen on them only after that render has committed |
| `unauthenticated` | the session ends through the existing lifecycle (after in-flight writes are settled) |
| `error` | access closes as an error with Retry: "Your Staff access could not be checked again: {reason} Retry to check it." — not a sign-out, no `/signin`, never `LocalGate` |
| `superseded` | not a verification: a newer check decides; if none is newer, access closes as for `error` |

While the re-read is under way no write starts — `capabilitiesFor` pauses every write control, and all five send-time checks refuse before recording an intent ("Checking your access again after a refusal — this change was not sent."). The board hands the failure to the page (`onAccessCheckFailed` → provider `failAccessCheck`) only once no write of its own is on the wire, so the refused write stays `rejected`, a write on the wire is settled as success/unknown by its own handler, and its record is kept. `failAccessCheck` acts only on an authenticated session outside a sign-out transition and invalidates any `me` still on the wire. Retry reads `me` again (existing provider path): authenticated → a fresh board on the current memberships; error → still closed; `401` → `/signin` once. C1/C2 serialization, `LocalGate`, the cross-RoomType-confirmation exception and `uncertainWriteStorage.ts` are unchanged.

Files: `StaffSession.tsx` (`failAccessCheck`, last read error), `ReservationBoard.tsx` (check pause, latest-check decision, deferred handover), `CalendarAccessGate.tsx` and `calendarAccess.ts` (wiring, message).

Red/green: 9 new gate tests with the real board (`CalendarAccessGate.test.tsx`), deferred promises only — block write `403` then `me` failing (network/CORS, 5xx, unreadable; with Retry to a lower role and one Property fewer), board read `403` then `me` failing (Retry failing again, then Retry `401` → `/signin` once), a dialog opened before the denial and the controls during the re-read, a write on the wire when the re-read fails (success and unknown), an unconfirmed record through error → Retry → reload, and an older re-read answering after a newer one failed. On START_HEAD's product code: **9 failed** — 7 at the missing access-check error (the board stays writable), 1 where the dialog's write was sent during the re-read (`createReservationAssignment` called), 1 at the missing error after the in-flight write settled. On the fixed code all pass, with every C1/C2 regression.

| Command (final code) | Result |
|---|---|
| `npm test` | exit 0 — 36 files, 814 tests |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm run build` | exit 0 |
| `git diff --check` | exit 0 |

Browser acceptance (real Chrome, trusted mkcert certificate, TLS verification on; PostgreSQL 17 container `cp06c3-pg`, database `c3_accept`; API and Admin_Web in `Staff` mode from the corrected tree; Staff `lead` created by the CLI as Manager at both Properties). **Response order was simulated** in the tab by holding chosen requests before they were sent and then releasing or failing them (transport failure); **the permission changes were real** — memberships removed in the throwaway database, roles set with the CLI. The backend was not modified.

| Step | Result |
|---|---|
| unconfirmed record first | assignment to Room 101 held and failed before sending → unknown, record (439 chars) and notice |
| real denial | Create block dialog reviewed; The BHA Hotel membership removed in the DB; Create block → real `403`; `me` re-read held: Create operational block disabled while it was pending |
| re-read fails | `me` failed (transport) → "Your Staff access could not be checked again: Could not reach the Admin API … Retry to check it."; board and identity gone; not on `/signin`; no further request; record unchanged |
| Retry with new roles | CLI: The BHA Hotel back as FrontDesk; Second Hotel removed in the DB; Retry → `me` 200 → selector only "The BHA Hotel", FrontDesk, writes enabled; the unconfirmed notice and record (439 chars) back |
| permitted write | FrontDesk block on Room 102 → 201 |
| reload | the notice and record still there |
| control: confirmed logout | one logout POST → `/signin`, `me` 401; the record kept |

Database afterwards: one audit row — the permitted block, `staff:{id}`; nothing from the refused write or the assignment that failed before sending. Secret scan (the throwaway password, `Set-Cookie`, the Staff cookie name) over API, web, migrate and seed logs: 0; browser storage: the unconfirmed record and `theme` only. Cleanup: processes stopped, container and its volume removed (`docker rm -fv`), secret files deleted, tab closed; `the-bha-postgres-1` untouched.

`C2_REVIEW: RUN — 1 finding`. `C3_REVIEW: NOT RUN` (Owner invokes `/codex:review --base origin/develop`). CP07 NOT STARTED. Production NOT TOUCHED.
