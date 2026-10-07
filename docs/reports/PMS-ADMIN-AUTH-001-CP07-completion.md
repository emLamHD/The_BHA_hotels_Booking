# PMS-ADMIN-AUTH-001-CP07 — Staff by default, LocalGate as a Development-only opt-in

> Draft PR into `develop`, not merged. Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline and START_HEAD `c62719b9fe8b947ef001cc2b20ea1a6a7d5e226e` (PR #79, CP06 with C1–C4, merged `2026-10-04T08:03:02Z`; C4 review: no actionable regressions, Reviewed SHA UNVERIFIED). Branch `feature/pms-admin-auth-001-cp07-staff-default-production-guard`. FINAL_HEAD, PR URL and CI are in the PR body and the handoff (this file is part of the final commit).
> **Production deployment: NOT PERFORMED.** "Production" below is the environment name of throwaway test hosts.

## Mode / environment matrix (as implemented)

| `AdminCalendar:AccessMode` | Development | Production, Staging, any other |
|---|---|---|
| not declared | `Staff` | `Staff` |
| `Staff` | `Staff` | `Staff` |
| `LocalGate` | LocalGate (local gates and opt-ins still required) | **refuses to start** |
| declared empty / `{}` / `[]` / null / nested / other spelling | refuses to start | refuses to start |

The two Production guards on `EnableUnauthenticatedRead`/`EnableUnauthenticatedWrite` are kept and apply in `Staff` mode too.

| `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` | `next dev` / tests | production build (`next build`/`next start`) |
|---|---|---|
| unset | `Staff` | `Staff` |
| `Staff` | `Staff` | `Staff` |
| `LocalGate` | LocalGate | configuration error, no Calendar request |
| empty / other | configuration error, no request | configuration error, no request |

## Deliverable

| Area | Change |
|---|---|
| `Back_End/src/TheBha.Api/AdminCalendarOptions.cs` | `FromConfiguration`: an undeclared key is `Staff` (the default now comes from the parser); the CP04-C1 parsing is otherwise unchanged; doc comments updated |
| `Program.cs` | after the two Production flag guards and the mode parse: a host whose mode is `LocalGate` refuses to start unless the environment is Development |
| `Properties/launchSettings.json` | the `https` profile no longer sets `AdminCalendar__EnableUnauthenticatedRead`; no profile sets a mode or local flag |
| `Front_End/Admin_Web/src/lib/api/accessMode.ts` | unset → `Staff`; `LocalGate` refused when `NODE_ENV=production`; messages updated; `.env.local.example` |
| tests | LocalGate suites select `LocalGate` explicitly (`WithLocalGate` in the test factory; Admin_Web fixtures stub `LocalGate`); default/non-Development hosts run the real Staff default; new startup tests; non-Development LocalGate-host tests rewritten to the new contract |
| docs | root and Admin_Web READMEs, new runbook `docs/runbooks/PMS-ADMIN-AUTH-001-staff-calendar.md`, design (§4 status, §7 as-implemented, §9, D7 activation), ADR 0007 amendment, SNAPSHOT, PROJECT_BIBLE, `AGENTS.md` §1 (product description only) |

Unchanged: schema/migrations, Identity, session/cookie, CLI behaviour, evaluator, controllers, stores, CORS, permissions, audit, Customer, DataProtection, dependencies, CI, and the CP06 Admin_Web session/refresh/logout/write-outcome/uncertain-write behaviour.

## Evidence map (MEP §10)

| # | Group | Tests (positive controls in the same tests) | Real host / browser |
|---|---|---|---|
| 1 | Missing mode selects Staff | `StaffCalendarAuthorizationTests`: JSON-provider theory (`{}`, `{"AdminCalendar":{}}`, a file with only a local flag → `Staff`); `An_explicit_local_gate_mode_…_and_an_absent_mode_is_staff` (host mode `Staff`, anonymous board 401); `The_same_json_source_selects_either_mode_and_an_undeclared_mode_is_staff` | Production host without the key: board 401, `me` 401 |
| 2 | Parser unchanged | the CP04-C1 JSON-provider theory (empty/null/`{}`/`[]`/nested/casing/precedence rows unchanged), `A_declared_access_mode_must_be_exactly_…` (10 values), nested-section and empty-JSON startup tests | `{}` and `[]` in `appsettings.Production.json` → refused |
| 3 | LocalGate only in Development | `A_non_development_host_refuses_to_start_with_local_gate` (Production, Staging, QA; exact message) | Production + LocalGate and QA + LocalGate → refused, no listener |
| 4 | Production missing/Staff starts | `A_production_host_starts_in_staff_mode_when_the_mode_is_missing_or_staff` | Production, mode missing, flags off, valid HTTPS/CORS/DataProtection → listening, Staff |
| 5 | Production flags refused, Staff too | `A_production_host_refuses_either_local_flag_in_staff_mode_too` (read/write × missing/`Staff`); existing read/write Production startup tests | read flag (missing and `Staff`) and write flag → refused |
| 6 | Mode frozen | `The_mode_is_captured_at_startup_and_a_later_configuration_change_does_not_switch_it` (unchanged, both directions) | – |
| 7 | Default Staff refuses anonymous/Customer | the CP04/CP05 Staff suites (anonymous, Customer cookie, Customer value under the Staff name → 401 on the board and all five writes, store spies 0); Board-suite Production/Staging default hosts → 401, query never reached | browser: only a Customer cookie → Staff `me` 401, board 401, write 401, `/calendar` → `/signin` |
| 8 | Staff routes by membership/role; flags do not bypass | CP04/CP05 suites unchanged and green; Staging default host with the write flag at startup and Production with a late flip stay closed (write-gate suite) | FrontDesk five writes; Manager cross-type create and move; Property without membership 403 |
| 9 | Unconverted route guard, HTTP refusal | `In_staff_mode_an_admin_endpoint_without_staff_permission_metadata_is_closed`, cleartext tests (unchanged) | – |
| 10 | Explicit LocalGate keeps its contract | every LocalGate suite (board, write gate, assignment, move/unassign, block create/cancel) on explicit `LocalGate`; local actor/evidence constants, uncredentialed CORS | Development + `LocalGate` + flags: anonymous board 200, block create 201, actor `admin-calendar-local-development` |
| 11 | Frontend: missing → Staff; invalid/production LocalGate send nothing | `accessMode.test.ts`; `clientAccessMode.test.ts` (Staff contract explicit and unset; LocalGate in a production build → nothing sent); `CalendarAccessGate.test.tsx` (unset → Staff gate, me first, no board/catalog; production LocalGate → configuration error) | production builds: `LocalGate` → prerendered `/calendar` is the "refused in a production build" error; unset → the Staff gate |
| 12 | Credentials, selector, C1–C4 | `clientAccessMode.test.ts`; the whole CP06/C1–C4 suite unchanged and green | browser: login → me → selector → board over the Staff contract |

## Checks (final code)

| Command | Result |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | exit 0 |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | exit 0, 0 warnings, 0 errors |
| targeted `dotnet test … --filter AdminReservationBoardApiTests\|AdminCalendar\|AdminOperationalBlock\|StaffCalendar\|StaffAuthenticationTests` | first run after the default change: 147 failed / 207 passed (every LocalGate suite had inherited the default); after the explicit opt-ins: 362/363 (the launch-profile test, then moved to the CP07 contract and covered by the full run below) |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` (PostgreSQL 17 in a container created for this run) | exit 0 — unit 244/244, integration 726/726 |
| `npm ci` | exit 0, lockfile unchanged |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm test` | exit 0 — 36 files, 838 tests |
| `npm run build` | exit 0 (mode unset; also built once with `LocalGate`, see group 11) |
| `git diff --check` | exit 0 |

## Real-host and browser acceptance

Throwaway PostgreSQL 17 (database `cp07_accept` in a container created for this run), migrated; Property and room data from the existing development seeder run once as a **separate Development process** (never in the Production host); a second Property inserted; Staff created with the CLI **in the Production test configuration**; one reservation (two units) booked through the public hold/confirm flow against the Production test host.

Real Kestrel (`TheBha.Api.dll`, Release, mkcert leaf, `https://localhost:7251`):

| Host | Result |
|---|---|
| Production + `LocalGate` | exit 134, no listener — "AdminCalendar:AccessMode=LocalGate is a Development-only opt-in; this host's environment is 'Production'." |
| QA + `LocalGate` | same, environment 'QA' |
| Production + read flag (mode missing) / + `Staff` | refused — read-flag message |
| Production + write flag (mode missing) | refused — write-flag message |
| Production + `{}` / `[]` (JSON) | refused — "must be exactly LocalGate or Staff." |
| Production, mode missing, flags off, valid config | listening; board 401, `me` 401 |
| Development + `LocalGate` + read flag | listening; anonymous board 200 |

Browser (real Chrome, trusted certificate, TLS verification on). API: **Production test host, no `AccessMode`**, `DataProtection:KeysPath` set, `Cors:AdminOrigins=https://localhost:3001`. Admin Web: `next dev --experimental-https` with the access-mode variable **unset**.

| Step | Result |
|---|---|
| anonymous `/calendar` | `me` → `/signin`; no board or catalog request |
| FrontDesk (CLI) sign-in | login 200 → `me` 200 → selector "The BHA Hotel" → board; role FrontDesk |
| FrontDesk five writes | assign 201 (only 101/102 offered), move 200 (only 102 offered), unassign 200, block create 201, block cancel 200 |
| Property without membership | Second Hotel board with the FrontDesk session → 403 "Access denied" |
| Manager (CLI) cross-RoomType | create to Room 201 (offered) with confirmation and reason → 201; move back 200; cross-type move to 201 with reason → 200 |
| Customer session | a real Customer register/login on the API origin; with the Staff session signed out: Customer `me` 200, Staff `me` 401, board 401, write 401, `/calendar` → `/signin` |
| unknown write + reload | assignment held in the page (never sent) → reload → "Unconfirmed … request" notice, range locked, no request resent, audit rows unchanged (11) |
| disable via CLI | next board read 401 → `/signin`; the record kept |
| explicit LocalGate (Development API with `LocalGate` + flags; Admin Web `LocalGate`) | no Staff UI, public catalog, LocalGate banner, anonymous block create 201 |

Audit (`RoomOccupancySegmentAudits`): every Staff-mode row `staff:{id}` of the acting member (FrontDesk 6, Manager 5); `staff-rbac:Manager:{P1}:cross-room-type-confirmed` only on the Manager's two cross-type `Created` rows; the LocalGate row `admin-calendar-local-development`.

Secret scan (both throwaway passwords, `Set-Cookie`, the Staff cookie name) over the API and web logs: 0. Cleanup: processes stopped, container and its volume removed (`docker rm -fv`), secret files, keys directory and scratch logs deleted, tabs closed; `the-bha-postgres-1`, the Owner's `.env.local` and deployment settings untouched.

## Deviations and residuals

- `Back_End/src/TheBha.Api/Controllers/AdminReservationBoardController.cs:22` still calls LocalGate "(the default)" in a doc comment; controllers are outside the CP07 allowlist, so it was not changed (comment only, no behaviour).
- Two CP03 tests in `StaffAuthenticationTests` now select `LocalGate` explicitly: one pins the LocalGate Calendar CORS policies, the other uses a test-only Admin probe route that the Staff default closes (404) before the scheme is reached. Their evidence is unchanged.
- The non-Development LocalGate-host tests (Board read late flip / Staging flag; write gate Staging / Production late flip) cannot exist any more — those hosts refuse to start. They now prove the default Staff host there ignores the flags and refuses anonymous access, and the startup refusal is a separate theory.
- Production frontend behaviour was verified by tests and by inspecting the prerendered `/calendar` of two production builds; the browser run used `next dev` (as allowed).
- Forwarded headers/proxies remain unconfigured (runbook says so); no production deployment was performed.

## PR size (target 100–400, not a limit — `docs/governance/WORKFLOW.md` §6)

Local `git diff --numstat origin/develop...HEAD`: **+835 / −288 = 1,123** in 32 files (the PR body carries the GitHub figure checked against it).

| Group | + / − | Why |
|---|---|---|
| backend product | +30 / −17 | default, startup guard, launch profile, comments |
| frontend product + env example | +32 / −18 | default, production refusal, messages |
| backend tests | +291 / −108 | every LocalGate suite made explicit (one helper, call-site switches), non-Development tests rewritten, three new startup theories |
| frontend tests | +67 / −19 | explicit LocalGate fixtures, Staff-default and production-LocalGate cases |
| docs | +415 / −126 | runbook (new), READMEs, design, ADR, SNAPSHOT, BIBLE, AGENTS §1, this report |

Not split: the default switch, the startup guard, the explicit test opt-ins and the operational documents describe one cut-over and are only consistent together.

`REVIEW: NOT RUN` (Owner invokes `/codex:review --base origin/develop`). Production deployment: NOT PERFORMED.
