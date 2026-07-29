# FE-001.3 Live availability search and real stay offers

## Scope

FE-001.3 extends the merged FE-001.1/FE-001.2 Property and RoomType catalog
on `/home-2` with a real, customer-usable availability search. This is still
a read-only slice: no Booking Hold, Reservation, CSRF, Idempotency-Key,
guest-token, or authentication work is included.

## Inherited architecture

- `src/lib/api/httpClient.ts` — the one lazy Axios instance
  (`withCredentials: true`, `AbortSignal` support, no automatic retry) —
  unchanged.
- `src/lib/api/errors.ts` — `ApiConfigError` / `ApiNetworkError` /
  `ApiHttpError` / `ApiValidationError`, and `isRequestCancelledError` —
  unchanged.
- `src/lib/api/propertyPresentation.ts#selectCoverImage` is reused as-is for
  Availability offer media; no third copy of media-selection logic exists.
- `SectionGridFeatureProperty` still owns the single
  `GET /api/v1/properties` request. `SectionAvailabilitySearch` receives the
  already-loaded `PropertyDto[]` as a prop, composed below the RoomType
  catalog — no duplicate Property request.

## Availability contract and service

- Endpoint: `GET /api/v1/properties/{propertyId}/availability`, confirmed
  against the live `/swagger/v1/swagger.json` document, the backend source
  (`AvailabilitySearch.cs`), and real calls against seeded data.
- `AvailabilityQuery` covers the five query values (`checkIn`, `checkOut`,
  `adults`, `children`, `rooms`). `AvailabilityOfferDto` and
  `NightlyRateDto` (`src/lib/api/availabilityTypes.ts`) reuse the existing
  `MediaDto`; no duplicate media wire shape was introduced. Casing/
  nullability follows the same established Swashbuckle convention already
  used for `PropertyDto`/`RoomTypeDto`: reference-type fields (`roomTypeCode`,
  `roomTypeName`, `roomTypeDescription`, `ratePlanCode`, `ratePlanName`,
  `currencyCode`, `media`, `nightlyRates`) are nullable in the generated
  schema; GUID/date/numeric fields (`propertyId`, `roomTypeId`, `ratePlanId`,
  `checkIn`, `checkOut`, `nights`, `requestedRooms`, `availableRooms`,
  `totalAmount`) are required.
- `src/lib/api/availabilityService.ts#searchAvailability(propertyId, query,
  options)` calls the exact nested route, passes the five values via Axios
  `params` (no manual query-string concatenation), forwards `AbortSignal`,
  normalizes a no-content/empty response to `[]`, and never adds CSRF,
  Idempotency-Key, or booking-access-token headers.

## Property/form data flow

`SectionAvailabilitySearch` (`src/app/(home)/SectionAvailabilitySearch.tsx`):

- Renders a required Property `<select>` populated from the live
  `PropertyDto[]` it receives, defaulting to the first Property.
- If the Property list changes such that the selected Property is no longer
  present, any in-flight request is aborted and the section deterministically
  falls back to the first still-valid Property, resetting search state
  rather than keeping results attributed to a Property that no longer
  exists.
- Keeps editable **draft** form state (`AvailabilityDraft`, raw strings)
  completely separate from the **last submitted query** (`submittedQuery`).
  Field edits never trigger a network call; only an explicit form submit
  does. Editing the draft after a result does not relabel that result.
- Uses native `<select>`, `<input type="date">`, `<input type="number">`,
  `<label htmlFor>`, and `<button type="submit">` — not the template's
  modal/`react-datepicker`-based search form, which depends on
  `StayDataType`/demo data incompatible with a real, honest offer contract.
  Enter-to-submit works through normal HTML form semantics.

## Client and server validation behavior

`src/lib/api/availabilityValidation.ts` rejects only clear structural
violations before any request is attempted: missing dates, an equal/reversed
date range, a stay over 30 nights, adults < 1, children < 0, rooms outside
`[1, 10]`, and non-integer guest/room values. Each error is associated with
its own field (`aria-invalid` + `aria-describedby` + an inline `role="alert"`
message).

`calculateNights` converts the two ISO "YYYY-MM-DD" strings to a calendar-day
distance using Howard Hinnant's "days from civil" integer algorithm — it
never constructs a `Date` and subtracts timestamps, so it is immune to
local-time/DST drift regardless of the host's time zone (verified in tests
by toggling `process.env.TZ`).

The client deliberately does **not** enforce the Property-local past-date
rule — the backend remains the sole authority (it derives "today" from
`TimeProvider` + `Property.TimeZone`, which the browser cannot know). A
server `400` for this rule surfaces its exact `detail` message
("checkIn cannot be earlier than the Property local date.") through the
existing normalized error model, verified live.

## Offer fields and pricing semantics

`AvailabilityOfferCard` (`src/components/AvailabilityOfferCard.tsx`) renders
one card per server offer, keyed by `roomTypeId:ratePlanId`, preserving
server order. Visible fields: RoomType name/description, RatePlan name,
check-in/check-out, nights, requested/available rooms, every
`nightlyRates` row (date + amount + currency), and the server's
`totalAmount`/`currencyCode`.

`src/lib/api/availabilityPresentation.ts#formatCurrencyAmount` uses
`Intl.NumberFormat` purely for display — it never recomputes the total from
the nightly rows, never converts currency, and falls back to a plain
formatted number with the raw currency code appended if the code is absent
or unrecognized (rather than fabricating a currency or crashing). No tax,
discount, "from" price, average rate, or booking CTA is rendered.

## Loading/empty/error/retry/search-again

An explicit `SearchStatus` (`initial | loading | success | empty | error`)
drives rendering — the state is never inferred solely from an empty array:

- **Initial** — form only, no claim a search has run.
- **Loading** — `role="status" aria-live="polite"`, tied to the just-submitted
  criteria.
- **Success** — real offer cards, with a summary labeled by the exact
  submitted criteria.
- **Empty** — a distinct `role="status"` message for a valid `200 []`
  response, still labeled by Property/criteria.
- **Error** — `role="alert"`, message derived from the normalized error
  types (preferring the server's RFC 7807 `detail`), with a
  "Retry last search" button that re-submits the exact last submitted query
  (not unsubmitted draft edits) through the same request lifecycle.

"Search again" is simply editing the draft and submitting — no page reload,
no separate code path.

## Cancellation and stale-response evidence

Every submit creates a new `AbortController` and increments a
`latestRequestId` ref; a response is only committed to state if its captured
request ID still matches the ref *and* the controller was not aborted.

Live-proven (see verification below) with a scoped, non-committed
browser-only fault injection (never written to the repository):

- Normal double-submit: the first request is genuinely aborted; no
  cancellation error is ever shown to the user; the final state reflects the
  second (latest) submission.
- Stress case: `AbortController.prototype.abort` was temporarily neutered to
  a no-op and one request's underlying XHR was artificially delayed, so the
  *older* request's real `200` response arrived *after* the newer request's
  `200` response. The UI still showed only the newer result — proving the
  `latestRequestId` guard independently of `AbortController`, exactly the
  "AbortController alone is insufficient" requirement.

## Media/fallback behavior

Identical to the established pattern: `selectCoverImage` (unmodified) picks
a usable backend cover image and excludes the seeded
`images.example.com` URLs before a `src` is ever assigned; the existing
bundled `placeholder-large-h.png` renders immediately when no usable image
exists. No new image assets, no Cloudinary integration.

## Responsive/accessibility evidence

- Form grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-6` (mobile-first).
  Offer-card grid: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` — the same
  Tailwind breakpoints already used and approved for the Property/RoomType
  grids; no custom `screens` override exists in `tailwind.config.js`.
- All controls are native (`<select>`, `<input>`, `<button>`) with
  `<label htmlFor>` associations, visible focus rings inherited from the
  shared `Input`/`Select`/`Button` components, and touch-sized tap targets.
- Live-verified keyboard-only path: Tab reaches Property → Check-in →
  Check-out → Adults → Children → Rooms → the submit button in that exact
  DOM order (confirmed via `document.activeElement`), Enter submits the
  form, and Enter activates a focused "Retry last search" button.
- Direct viewport-resize screenshots were not obtainable in this sandbox —
  `resize_window` does not change the tab's actual `window.innerWidth`
  (confirmed via script, the same limitation recorded in FE-001.2).
  Responsiveness was verified via the rendered Tailwind classes above.

## Automated tests

Node-environment Vitest only; no jsdom/RTL/Playwright/Cypress/MSW added.

- `availabilityService.test.ts` (11 tests) — exact route, live-Property-ID
  parameterization, exact five query params via Axios `params`, `AbortSignal`
  forwarding, no CSRF/Idempotency-Key/booking-token headers, unchanged
  success/empty/no-content passthrough, and normalized
  validation/HTTP/cancellation error propagation.
- `availabilityValidation.test.ts` (18 tests) — half-open night calculation
  (including a month/year/leap-year boundary and TZ-independence via
  `process.env.TZ` toggling), equal/reversed dates, the 30-night boundary,
  adults/children/rooms boundaries, non-integer rejection, per-field error
  association, and confirmation that the past-date rule is *not*
  client-validated.
- `availabilityPresentation.test.ts` (7 tests) — currency formatting without
  conversion, selecting the exact server total rather than recomputing it,
  a graceful fallback for a missing/malformed currency code, and the shared
  media selector rejecting the reserved example host for Availability media.

Existing 60 FE-001.1/FE-001.2 tests remain green; final count is **96/96**.

## Live verification evidence

- `/home-2` loads with zero console/hydration errors; the catalog still
  performs exactly one Property request and one RoomType request per
  Property; zero Availability request before form submit.
- A valid search (`checkIn=2026-07-29&checkOut=2026-07-30&adults=1&
  children=0&rooms=1`) sent exactly one `GET .../availability` and rendered
  real `Deluxe King` and `Family Suite` offers with real description, rate
  plan, nightly rate (`1.500.000 ₫` / `2.200.000 ₫`), and total.
- An occupancy-exceeding search (`adults=10`) returned `200 []` and rendered
  the distinct empty-state message.
- An out-of-range past date (`checkIn=2020-01-01`) returned a `400` with
  `"checkIn cannot be earlier than the Property local date."`, rendered
  verbatim in the error region.
- Stopping the API produced the network-error state; restarting the API and
  activating "Retry last search" (via a real, focused-then-Enter keyboard
  action) recovered the results with no page reload.
- Stale-response race proven both in the normal (aborted) case and, more
  rigorously, with `AbortController.abort` neutered and one response
  artificially delayed past a second, undelayed response — the UI kept only
  the later submission's result, and both underlying requests were confirmed
  via the Network log to have actually completed with `200`.
- Zero requests observed to `images.example.com`, any Booking Hold endpoint,
  any Reservation endpoint, or any CSRF endpoint throughout the session.

## Explicit exclusions

No `POST /api/v1/booking-holds`, Hold/Reservation read/confirm/cancel, CSRF
token acquisition, `Idempotency-Key`, `X-Booking-Access-Token`, guest-token
persistence, login/register/logout, booking state store, or payment. The
Availability response is treated only as a query-time snapshot in all
customer-facing copy — never implied as a held offer or a locked price.

`SNAPSHOT.md` was not modified by this task.
