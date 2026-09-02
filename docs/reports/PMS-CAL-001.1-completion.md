# PMS-CAL-001.1 — Reservation Board Read Projection & Frontend Integration — Completion Report

`IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (`docs/governance/RULES.md`
§2.4). Feature branch `feature/pms-cal-001-1-board-read-integration`, checked
out directly in the single primary repository checkout — no `git worktree
add` used at any phase. Baseline `origin/develop` at
`ff9d5b0c8d58efe64b562c631ecb36d488887df8` (PR #40 merge commit); confirmed
via `git merge-base HEAD origin/develop`.

Commits on this branch:

1. `77225ea` — `feat(pms): add Admin Reservation Board read projection over HTTPS` (Phase 1, backend).
2. `fbdea50` — `fix(api): allow the Admin origin to read the Property catalog over CORS` (Phase 3 correctness fix — see §5).
3. `c59c9e2` — `feat(admin): connect the Reservation Board to the live Admin API` (Phase 2, frontend).
4. `2a99176` — `docs(pms-cal-001.1): record completion report, worklog, and doc updates`.
5. `b4cef33` — `fix(pms-cal-001.1): correction C1 — restore credentialed customer CORS, remove dead inactive filter` (see §10).
6. `4dc07a2` — `docs(pms-cal-001.1): record Correction Cycle C1 evidence` (this documentation commit).

## 1. What was delivered

One vertical slice: PostgreSQL authority (already CURRENT from
`PMS-BE-001.2`) → a new backend read projection → an HTTPS Admin API → the
Admin Reservation Board frontend, reading real data instead of
`mockData.ts`/`reservationRuntime.ts`. No schema/migration change (still
migration 8, confirmed clean via `dotnet ef migrations
has-pending-model-changes` at the final checkpoint). No mutation API, no
Admin authentication/RBAC, no Customer Web change, no create-reservation
integration.

### Backend (Phase 1)

- `TheBha.Application/Scheduling/ReservationBoard.cs`: the frozen response
  contract (`ReservationBoardDto` and its nested DTOs), `ReservationBoardQuery`
  (validation → data load → per-Unit coverage classification
  `FullyAssigned`/`PartiallyAssigned`/`FullyUnassigned` → deterministic DTO
  assembly), and `BuildContiguousRanges` for grouping uncovered nights into
  maximal disjoint spans.
- `TheBha.Infrastructure/Persistence/ReservationBoardDataLoader.cs`: bounded,
  `AsNoTracking` queries — Property lookup, active `PhysicalRooms`, candidate
  committed Units overlapping `[from, to)`, their full unclipped Unit
  nights/assignments (for complete-Unit coverage classification), Effective
  `OperationalBlocks` overlapping the window, and only the referenced
  `RoomTypes`.
- `TheBha.Api/Controllers/AdminReservationBoardController.cs`: `GET
  /api/admin/v1/properties/{propertyId}/reservation-board?from=&to=`,
  `Cache-Control: no-store`, gated behind `AdminCalendar:EnableUnauthenticatedRead`
  (default `false`; a Production-environment startup guard throws if it is
  ever `true` there — no exception, no override).
- `Program.cs`: HTTPS-only, non-wildcard `Cors:AdminOrigins` validation at
  startup; a second, uncredentialed `admin-calendar` CORS policy
  (`GET`-only) separate from the credentialed `customer-web` policy;
  `app.UseHttpsRedirection()`.
- 22 new integration tests (`AdminReservationBoardApiTests.cs`) against real
  PostgreSQL, covering the majority of the Master Execution Prompt's 35
  mandatory backend acceptance items: validation, Production-gate rejection,
  gate-disabled unavailability, CORS on/off, PII omission, cross-Property
  isolation, deterministic ordering, all four coverage classifications
  (including multi-span partial), cross-RoomType attribution, cancelled-Unit
  exclusion, and effective-vs-cancelled block visibility.
- One necessary, direct-consequence fix to a pre-existing test
  (`BookingPersistenceTests.OpenApi_exposes_only_the_approved_hold_and_reservation_lifecycle_paths`):
  the new route added to the allowlist, plus two new assertions that it
  exposes only `GET`.

### Frontend (Phase 2)

- `src/lib/api/env.ts` / `types.ts` / `client.ts`: HTTPS-only
  `NEXT_PUBLIC_API_BASE_URL` resolution (rejects missing, malformed,
  non-HTTPS — including `http://localhost` — and any URL carrying
  credentials/query/fragment); a byte-for-byte TypeScript mirror of the
  backend JSON contract; a `requestJson` boundary that turns every
  config/network/HTTP/parse failure into one safe `ApiResult<T>` — callers
  never see a raw exception.
- `ReservationBoardServerTimeline.tsx` / `ReservationBoardStayPopover.tsx`:
  a new, independent, read-only rendering path for the real
  `ReservationBoardResponse`. Every bar is an inert `<button>` — no drag
  handlers, no click-to-mutate; the popover shows only guest name,
  confirmation #, dates, sold/actual room type, and coverage status, with an
  explicit "not recorded" disclaimer for everything this read-only view
  cannot show (contact details, payment/folio, lifecycle timestamps). The
  legacy mock-typed `ReservationTimeline.tsx`/`TimelineItemDetailsDialog.tsx`
  and the mock data/runtime modules are left in the tree, untouched, for a
  future mutation slice, but the import-graph no longer reaches them from
  this component (verified by a static test — §4).
- `ReservationBoard.tsx`: rewritten as the server-data-driven orchestrator —
  an initial Properties-load effect (deterministic first-Property
  selection, anchor date derived from that Property's own IANA time zone via
  `Intl.DateTimeFormat("en-CA", …)`, never browser-local time), and a
  board-fetch effect keyed on `[propertyId, range.start, range.endExclusive,
  retryToken]` with an `AbortController` per request plus a monotonic
  request-sequence guard so a slower, superseded response can never
  overwrite a newer one. Loading/error/empty/populated states, a Retry
  action, and the read-only popover wiring.
- `ReservationBoardToolbar.tsx`: one-line badge-text change — "Live data —
  read-only" instead of "Demo data — not connected to backend".
- Vitest + Testing Library added as the frontend's first unit/component
  test stack (`TEST_DEPENDENCY_POLICY`: minimal, no Playwright). 46 new
  tests across 6 files — see §4.
- `README.md` / `.env.local.example`: local HTTPS dev-setup instructions
  (`npm run dev:https` on port 3001, `dotnet dev-certs https --trust` once
  for the backend certificate, `.env.local` from the example file).

### Correctness fix found during Phase 3 acceptance (Phase 3)

`GET /api/v1/properties` — the Customer-facing Property catalog read reused
by the Admin frontend's Property selector — only carried the credentialed
`customer-web` CORS policy (`http://localhost:3000` only). This is invisible
to `curl` (no CORS enforcement) and to the Vitest/RTL suite (`fetch` is
mocked, no real CORS check either), so it was not caught until a real
browser exercised the real, running frontend against the real, running
backend (§6). Fixed by adding a third, uncredentialed, `GET`-only CORS
policy (`properties-catalog-read` — origins = `customer-web` ∪
`AdminOrigins`) applied only to the `GetProperties` action; every other
action on `PropertiesController`, and the credentialed `customer-web`
policy itself, is unchanged. Re-verified with `curl -H "Origin: ..."` for
both origins and with the full backend suite (§6) — no regression.

## 2. Contract

Half-open `[from, to)` date ranges throughout, `MinNights = 1`, `MaxNights =
31`. Response shape (exact field names, see `ReservationBoardResponse` in
`types.ts` for the frontend mirror):

```
{ property, from, to, roomTypes[], physicalRooms[], stays[], operationalBlocks[] }
```

`stays[].coverageStatus` ∈ `FullyAssigned | PartiallyAssigned |
FullyUnassigned`, computed from the Unit's *full, unclipped* night/assignment
data — not just the nights inside the requested visible window — so
classification is correct even when a stay extends outside `[from, to)`.
`assignments[].actualRoomTypeId` may differ from `stays[].soldRoomTypeId`
(cross-RoomType assignment); both are always present so the frontend can
show "sold as X, assigned into Y" without fabricating either.

## 3. What this does not do

No mutation endpoint of any kind (no assignment/block create, split, move,
cancel exposed over HTTP — those remain internal-only per `PMS-BE-001.2`).
No Admin authentication/RBAC, no Staff identity. No Customer Web change. No
create-reservation integration. No schema/migration change. The
`AdminCalendar:EnableUnauthenticatedRead` gate exists specifically because
of this — it is a development/internal-deployment convenience, not a claim
of public-Internet production-readiness, and Production startup makes it
impossible to enable.

## 4. Test evidence

### Backend

- `dotnet build --configuration Release`: 0 warnings, 0 errors.
- `dotnet test --configuration Release --no-build` (real PostgreSQL 17,
  `thebha_dev`): **244/244** unit tests, **348/348** integration tests — the
  313 pre-existing integration tests plus the 22 new
  `AdminReservationBoardApiTests` plus 13 more added since `PMS-BE-001.2`'s
  317 baseline from unrelated already-merged work. Re-run identically after
  the Phase 3 CORS fix (§1): same 244/348, zero regressions.
- `dotnet ef migrations has-pending-model-changes`: clean, both before and
  after the CORS fix.
- Migration count: **8** (`ls
  Back_End/src/TheBha.Infrastructure/Persistence/Migrations/*.cs`, excluding
  `*.Designer.cs`/`*ModelSnapshot.cs`) — unchanged from baseline.

### Frontend (`Front_End/Admin_Web`)

- `npm ci`: required a `package-lock.json` update for the new
  `vitest`/`@testing-library/*`/`jsdom`/`@vitejs/plugin-react` devDependency
  trees (2,375 insertions), then `npm ci` reproduced cleanly from that lock
  file.
- `npm run lint`: 0 errors, 0 warnings (two initially-present unnecessary
  `eslint-disable-next-line react-hooks/exhaustive-deps` comments were
  removed once no longer needed).
- `npm test` (Vitest): **46/46** passing across 6 files —
  `src/lib/api/env.test.ts` (12: HTTPS-only base-URL resolution, every
  rejection reason, trailing-slash normalization), `src/lib/api/client.test.ts`
  (8: exact request URL/params for both endpoints, config/network/http/abort
  error mapping, ProblemDetails-vs-plain-text failure bodies, unreadable-body
  handling), `ReservationBoardServerTimeline.test.tsx` (8: room/RoomType/
  unassigned-lane rendering, assigned/unassigned/block bar selection and
  payload correctness including cross-RoomType sold-type preservation,
  filter toggling, inactive-RoomType omission, non-draggable bars),
  `ReservationBoardStayPopover.test.tsx` (5: only-real-fields rendering, the
  not-recorded disclaimer, conditional assigned-room-type row, close
  behavior), `ReservationBoard.test.tsx` (9: loading/error/empty-Properties/
  empty-board/board-error+retry states, Property-change and range-change
  triggering the correct new request, a slower superseded response never
  overwriting a newer one, popover open/close), and a static source-scan
  test (4: `ReservationBoard.tsx`'s import statements — not its doc comment
  — never reference `mockData`/`reservationRuntime`/`TimelineItemDetailsDialog`/
  `ReservationTimeline`, still imports the real API client, and the
  Calendar page still renders both `<Calendar />` and a prop-less
  `<ReservationBoard />`).
- `npm run build`: succeeds (Turbopack, TypeScript, static generation for
  all 22 routes). One real type error was self-caught and fixed during this
  pass — `IsoDate` was imported from `./dateMath` (which only re-exports it
  internally) instead of `./types`, where it is actually exported; Vitest's
  transpile-only pipeline does not full-type-check, so only `next build`'s
  `tsc` pass caught it.

### `Front_End/Customer_Web` CI parity (re-run because `Program.cs`/CORS/HTTPS changed)

- `npm ci`, `npm run lint` (clean), `npm test` (**298/298** passing),
  `npm run build` (succeeds; three pre-existing "deopted into client-side
  rendering" warnings on unrelated listing-detail pages, not caused by this
  branch).

## 5. Real HTTPS + PostgreSQL + browser acceptance (Phase 3)

Performed against a **disposable** database (`thebha_pmscal001_e2e`,
created/migrated/dropped for this pass only — never `thebha_dev`, never a
production seeding endpoint) and a real running backend + Admin frontend,
driven by an actual Chrome browser via the Claude-in-Chrome extension.

**Seeding.** A throwaway, uncommitted xUnit fact
(`_PmsCal001E2ESeed.cs`, deleted immediately after use — not part of any
commit) reused the exact fixture-construction pattern already proven in
`AdminReservationBoardApiTests.cs` (direct EF Core writes: `Property`,
2 `RoomTypes`, 4 `PhysicalRooms`, an `InventoryHold.Confirm(...)` per
Reservation, and `RoomOccupancySegment` rows for assignments/blocks — there
is no mutation HTTP API to create these, by design, per §3) to produce five
concurrent scenarios in one property/date window: a fully-assigned stay, a
fully-unassigned stay, a partially-assigned stay (disjoint uncovered
spans), a cross-RoomType assignment, and an operational block.

**Environment obstacles resolved, in order:**

1. `dotnet dev-certs https --trust` and `next dev --experimental-https`'s
   own `mkcert -install` both failed in this sandboxed session — no `sudo`
   TTY available to either the Bash tool or the `!` interactive passthrough,
   and `certutil` (`libnss3-tools`) was not installed. Owner ran `sudo
   apt-get install -y libnss3-tools` in their own terminal.
2. Chrome's cert-warning bypass ("thisisunsafe" typed into the interstitial)
   covers page navigation only, not background `fetch()` — confirmed by
   executing `fetch(...)` directly in the page via the browser's JS console
   and observing a real `TypeError: Failed to fetch`, while `curl` against
   the identical URL returned `200` throughout. A shared certificate (issued
   once by `mkcert` for `localhost`/`127.0.0.1`/`::1`, used by both the
   frontend's `dev:https` server and a Kestrel override for the backend) was
   trusted into Chrome once the Owner ran `mkcert -install` (system trust
   store, not just NSS — Chrome's Linux build does not read the NSS
   database for TLS-root decisions, only its own/OS trust store) and
   restarted Chrome.
3. With the certificate trusted, the frontend still failed with "Could not
   reach the Admin API" — this was the real, product-level CORS defect
   described in §1, not an environment issue; fixed and the full backend
   suite re-verified (§4) before resuming the browser pass.

**What was verified live, in the browser, against real data:**

- Property selector populated from the real `GET /api/v1/properties`
  response ("The BHA E2E Demo").
- All five seeded scenarios rendered correctly in one screenshot: the
  cross-RoomType stay's bar sits in the *physical* Deluxe room's row while
  its popover correctly shows "Sold room type: Standard" / "Assigned room
  type: Deluxe"; the fully-assigned stay's bar spans exactly its booked
  nights; the partially-assigned stay shows both its assigned-nights bar
  *and* two separate dashed unassigned-range bars in the Standard
  Unassigned lane, matching the two disjoint uncovered spans; the
  fully-unassigned stay shows only its unassigned-range bar; the
  Maintenance block renders with the correct room/dates/reason in both the
  timeline and its popover.
- Filter toggling: unchecking "Unassigned" hides both unassigned lanes and
  their bars live, without a refetch; assigned/block bars are unaffected.
- Range navigation ("Next date range"): moved the window to a range with no
  seeded data and correctly rendered the empty-board message, confirmed via
  the real network request (`from=2026-09-09&to=2026-09-23`, `200`, empty
  arrays).
- Mutation gating: attempting to drag the "Nguyen Van A" bar to a different
  column produced no movement, no request, no error — the bar is a plain
  inert `<button>`.
- Zero browser console errors across the whole pass; the Events Calendar
  (FullCalendar) below the Reservation Board rendered unaffected, confirming
  layout preservation.
- Database state inspected via `psql` after the full interactive pass:
  reservation/assignment/block counts identical to the seed (4/3/1) —
  confirms the read-only invariant held under real interactive use, not
  just under test.

**Cleanup:** both dev servers stopped, `thebha_pmscal001_e2e` dropped,
`certificates/` (private key material) confirmed already `.gitignore`d, no
seed/throwaway file left in the diff.

## 6. Exclusions / remaining TARGET boundary

Unchanged from `PMS-BE-001.2`'s boundary (ADR 0006): no
assignment/OperationalBlock mutation HTTP endpoint, no Admin
authentication/RBAC, no Staff identity, no real permission check behind
`AuthorizationEvidence`/`Reason`, no OTA, no `FolioEntries`, no
`Organization`. `ADMIN-002.1`'s mock-driven components
(`mockData.ts`/`reservationRuntime.ts`/`ReservationTimeline.tsx`/
`TimelineItemDetailsDialog.tsx`) remain in the tree, reserved for a future
mutation slice, but no longer drive the Reservation Board.

## 7. Push, Draft PR, and GitHub CI

Branch pushed, Draft PR #41 opened against `develop`
(https://github.com/emLamHD/The_BHA_hotels_Booking/pull/41). Superseded by
Correction Cycle C1 (§10) — see §10's "Final corrected state" for the
current PR HEAD and CI result.

## 8. Known risks

- The disposable-DB browser-acceptance pass exercised one Property/date
  window with hand-picked scenarios, not the full 27-item frontend
  acceptance matrix as literal live-browser clicks — the 46 automated
  Vitest/RTL tests (§4) cover the matrix's edge cases (stale-response
  races, error/retry states, config validation) that are impractical to
  drive one-by-one through a live browser session.
- `Kestrel__Certificates__Default__*` and the shared `mkcert` certificate
  used for the Phase 3 browser pass are a local-only testing convenience —
  they are not part of any committed configuration and do not change how
  the backend is configured to run in Development/Production.

## 9. Governance note

`ACTIVE_EXECUTOR` (Claude) made no repository mutation after the checkpoint
this report describes without an explicit Owner/OC instruction to continue.
The reviewer (`CODEX_READ_ONLY`) has not yet been invoked — only Owner may
invoke it, per `AGENTS.md` §2.B/§13.

## 10. Correction Cycle C1

Owner invoked `/codex:review --base origin/develop` against PR #41 at HEAD
`2a991765618bc005a70e8debcc48d4f3226bd093`. Codex returned two findings,
relayed verbatim to Owner, then routed back as an OC correction prompt
(`PMS-CAL-001.1-C1`) that returned write authority to Claude as the same
implementer of this work item.

### Finding 1 (P1) — root cause and fix

**Root cause:** `Program.cs`'s `properties-catalog-read` CORS policy (added
in the Phase 3 fix, commit `fbdea50`) unioned the configured Customer and
Admin origins onto `GET /api/v1/properties`, but never called
`AllowCredentials()`. `Front_End/Customer_Web/src/lib/api/httpClient.ts`
sends every request — including this one, via
`src/app/(home)/SectionGridFeatureProperty.tsx`'s client-side
`getProperties()` call — with `withCredentials: true`. A browser rejects a
credentialed request whose response lacks
`Access-Control-Allow-Credentials: true`, so any cross-origin Customer_Web
deployment would have silently lost its property catalog.

**Fix:** `properties-catalog-read` now deduplicates the union of
`Cors:AllowedOrigins` and `Cors:AdminOrigins` and adds `AllowCredentials()`
back, while staying explicit-origin (no wildcard), `GET`-only, and scoped to
this one controller action — `customer-web` and `admin-calendar` are
unchanged, and no other Customer-facing action gained the Admin origin.
`PropertiesController.cs`'s comment on `GetProperties` was corrected to
describe the policy as still credentialed.

**New regression test:**
`PropertyCatalogApiTests.Property_catalog_read_stays_credentialed_for_customer_and_also_allows_admin_without_widening_other_customer_routes`
— against real PostgreSQL, proves: the configured Customer origin gets
`Access-Control-Allow-Origin`+`Access-Control-Allow-Credentials: true` on
both a plain `GET` and an `OPTIONS` preflight; the configured Admin origin
gets `Access-Control-Allow-Origin` on both; an unapproved origin gets
neither; no response ever contains a wildcard origin; and the Admin origin
is denied on the unrelated `GET /api/v1/properties/{propertyId}` route.

### Finding 2 (P2) — root cause and fix

**Root cause:** `ReservationBoardToolbar.tsx`'s `FILTER_OPTIONS` still
listed an "Inactive (cancelled/no-show)" checkbox (inherited from
`ADMIN-002.1`'s mock-driven toolbar) toggling `filters.showInactive` in
`ReservationBoard.tsx`'s state, but `ReservationBoardServerTimeline.tsx`
never received or read that prop, and the read API contract has no
lifecycle-status field to filter on (cancelled/no-show units are excluded
server-side by design — see `docs/ARCHITECTURE.md`). The checkbox rendered,
looked interactive, and did nothing: a regressed, dead control.

**Fix (OC product decision — do not expand the backend contract in this
correction):** removed the `showInactive` filter end to end — the
`FILTER_OPTIONS` entry in `ReservationBoardToolbar.tsx`, the field on
`ReservationBoardFilters` in `types.ts`, and the initial state in
`ReservationBoard.tsx`. A repository-wide search confirms no other
`showInactive` reference remains anywhere in `Front_End/Admin_Web`. The
three real filters (`showAssigned`/`showUnassigned`/`showOperationalBlocks`)
and the mock-driven prototype's own, unrelated inactive-lifecycle rendering
(`isInactiveLifecycleStatus`/`LIFECYCLE_STATUS_LABEL` in `types.ts`, used by
the still-intentionally-present `ReservationTimeline.tsx`) are untouched.

**New/updated regression tests** in `ReservationBoard.test.tsx`:
- confirms the toolbar renders exactly the Assigned/Unassigned/Operational
  Blocks filter checkboxes and no Inactive control;
- seeds one assigned stay, one unassigned stay, and one operational block,
  then toggles each of the three remaining filters and asserts the
  corresponding bar disappears from the server-backed timeline while the
  others remain — proving they still drive real rendering.

### Fresh validation evidence (all rerun from corrected HEAD, not reused)

- Static: repository-wide `showInactive` search returned no remaining
  reference; `git diff --check` clean; migration count unchanged at 8
  (`Back_End/src/TheBha.Infrastructure/Persistence/Migrations`);
  `dotnet ef migrations has-pending-model-changes` → "No changes have been
  made to the model since the last migration."
- Backend: `dotnet build` 0 warnings/0 errors; targeted
  `PropertyCatalogApiTests` filter — 6/6 (including the new CORS test);
  full suite — **244/244** unit + **349/349** integration (was 348, +1 for
  the new CORS test), against real PostgreSQL.
- Admin Web: `npm run lint` clean; targeted `ReservationBoard.test.tsx` —
  11/11; full `npm test` — **48/48** (was 46, +2); `npm run build`
  succeeds.
- Customer Web (full gate, since P1 is a Customer-facing regression):
  `npm run lint` clean; `npm test` — **298/298**; `npm run build` succeeds.
- Real browser acceptance: a disposable PostgreSQL database
  (`thebha_pmscal001_c1_e2e`, migrated and seeded via the existing
  `--seed-development` `DevelopmentDataSeeder` path, dropped afterward) fed
  two backend processes against the same database — an HTTP-only instance
  on `:5145` (matching the documented Customer dev profile, avoiding
  `UseHttpsRedirection`'s https-port-detection confound when both an HTTP
  and HTTPS endpoint are bound on one process) and an HTTPS-only instance
  on `:7145` using the same `mkcert`-issued certificate trusted into
  Chrome's system store during Phase 3 (`Front_End/Admin_Web/certificates`)
  — alongside Customer Web (`npm run dev`, port 3000) and Admin Web
  (`npm run dev:https`, port 3001). In real Chrome:
  1. Customer Web's `/home-2` page loaded "The BHA Hotel" from a genuine
     client-side, credentialed, cross-origin `GET /api/v1/properties` —
     200, zero console errors — proving the P1 fix live, not just in curl.
  2. Admin Web's Reservation Board opened against the same origin-gated
     endpoint, Property selector showing "The BHA Hotel".
  3. The toolbar showed exactly three filter chips (Assigned/Unassigned/
     Operational Blocks) — no Inactive chip, confirmed by a zoomed
     screenshot.
  4. Toggling the Unassigned filter live-removed the board's "Unassigned"
     lane rows; all three checkboxes toggled without error.
  5. A live `fetch("https://localhost:7145/api/v1/properties/{propertyId}",
     {credentials:"include"})` issued from the Admin origin's own page
     context was blocked by the browser itself
     (`TypeError: Failed to fetch`) — proving the Admin origin gained no
     access to an unrelated Customer route, not just that curl saw no
     header.
  6. Zero CORS-related (or any) browser console errors throughout.
  7. `psql` against the disposable database after the session confirmed 0
     `Reservations`, 0 `RoomOccupancySegments`, 0 `RoomBlocks` — the
     interactive session never mutated reservation/assignment/block state
     (structurally impossible anyway: no HTTP mutation endpoint exists).

### Final corrected state

- Code/test correction commit: `b4cef33867f6326b57ddb199a1081c33a6d97ddd`
  — GitHub Actions on that exact SHA (run `33619047212`): Admin `pass`
  (54s), Frontend `pass` (1m16s), Backend `pass` (2m22s) — all three green.
- This documentation commit (`docs(pms-cal-001.1): record Correction Cycle
  C1 evidence`) is docs-only, on top of `b4cef33`. PR #41 HEAD after push:
  `4dc07a2bba050ec6daa9505a7a274fed9071faf7` (confirmed via
  `gh pr view 41 --json headRefOid`); PR left as Draft, not merged.
  GitHub Actions on this exact SHA (run `33619451259`, watched to
  completion via `gh run watch`): Frontend `pass` (1m36s), Backend `pass`
  (2m2s), Admin `pass` (51s) — all three green.
- No statement elsewhere in this report claiming the prior HEAD
  (`2a991765618bc005a70e8debcc48d4f3226bd093`) is production-ready still
  applies; the corrected HEAD above is the current state of the PR.
- `ACTIVE_EXECUTOR` (Claude) stopped all writes at this checkpoint. Codex
  has not been re-invoked by Claude; only Owner may invoke
  `/codex:review --base origin/develop` again.
