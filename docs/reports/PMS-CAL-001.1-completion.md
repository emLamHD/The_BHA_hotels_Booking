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

Not yet performed as of this checkpoint — see the completion report's
requested-decision line at the end of this document / the accompanying
chat message for current status.

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
