# FE-001.4 Booking Hold creation from a live Availability offer

## Scope

FE-001.4 extends the merged FE-001.1–FE-001.3 Property/RoomType/Availability
UI on `/home-2` so a customer can select a real server offer, enter contact
details, and create a real 15-minute Booking Hold through
`POST /api/v1/booking-holds`. It ends once the Hold is created and
represented safely in the current tab. Hold read/confirm/cancel, Reservation
read/cancel, authentication UI, and payment remain out of scope.

## Inherited architecture

- `src/lib/api/httpClient.ts` — the one lazy Axios instance
  (`withCredentials: true`, case-insensitive header dedup, `AbortSignal`
  support) — extended, not replaced.
- `src/lib/api/errors.ts` — `ApiConfigError` / `ApiNetworkError` /
  `ApiHttpError` / `ApiValidationError`, `isRequestCancelledError` —
  unchanged.
- `src/components/AvailabilityOfferCard.tsx` and
  `src/app/(home)/SectionAvailabilitySearch.tsx` — extended with an optional
  `onHold`/`holdDisabled` CTA and Hold selection/session state; the existing
  read-only Availability search, draft/submitted-query separation, and
  stale-response guarding are unchanged.

## New transport contracts (`src/lib/api/bookingHoldTypes.ts`)

`CsrfTokenResponse`, `CreateBookingHoldRequest`, `BookingHoldNightDto`,
`BookingHoldDto`, and the serialized `BookingHoldStatus` union
(`"Active" | "Confirmed" | "Cancelled"`), matched field-for-field against
`GET /api/v1/auth/csrf`, `POST /api/v1/booking-holds`, and the live
`/swagger/v1/swagger.json` document confirmed against a running Development
API and seeded PostgreSQL data. `CreateBookingHoldRequest` carries only the
eleven fields the backend accepts as authoritative client input — no price,
currency, status, expiry, ownership, or token field exists on the type.

## Shared Axios unsafe path (`src/lib/api/httpClient.ts`)

`apiUnsafeRequest<T>(path, method, body, options)` is a small, generic
addition alongside the existing `apiGet`:

- reuses the same lazily-created Axios instance and `withCredentials: true`;
- adds `Content-Type: application/json` only when a body is supplied;
- returns `{ data, status }` so a caller can distinguish `201 Created` from
  `200 OK` without inferring it from the response body;
- shares the same Problem Details normalization as `apiGet` (extracted into
  `normalizeRequestError`) and the same case-insensitive header
  deduplication (`mergeHeaders`, now exported for reuse by the CSRF module);
  supports `204` the same way `apiGet` does;
- contains no Hold- or CSRF-specific logic.

The existing 96 baseline tests pass unchanged; `apiGet`'s behavior and
request shape are untouched.

## Memory-only CSRF helper (`src/lib/api/csrf.ts`)

- Lazily calls `GET /api/v1/auth/csrf` on first unsafe request; validates
  `token`/`headerName` are non-empty strings before trusting them.
- Caches both only in module memory (never `localStorage`, `sessionStorage`,
  a cookie, a URL, or a log).
- Concurrent first callers share one in-flight acquisition promise.
- Injects the returned header via `mergeHeaders`, so a caller-supplied
  case-variant of the same header name never produces a duplicate — the
  acquired token always wins.
- Matches the exact CT-CONTRACT-002 antiforgery Problem Details only by
  `status === 400 && title === "Invalid antiforgery token" && detail === "A
  valid antiforgery token is required for this operation."` — never by
  status code alone, so an ordinary business-validation `400` (e.g. Create
  Hold's own `"Invalid booking Hold request"`) is never retried.
- On that exact match: invalidates the cached token, reacquires once, and
  retries the exact same body/headers/signal exactly once. A second
  antiforgery failure is surfaced to the caller without a third request.
- `invalidateCsrfToken()` is exported as a narrow memory-invalidation hook
  for a future login/logout transition; no auth UI is implemented now.

## Hold creation service (`src/lib/api/bookingHoldService.ts`)

`createBookingHold(request, idempotencyKey, options)` calls exactly
`POST /api/v1/booking-holds` through the shared CSRF-protected path, sends
exactly one caller-supplied `Idempotency-Key` header, forwards an optional
`AbortSignal`, and returns `{ hold, outcome: "created" | "replayed" }` based
on the transport's `201`/`200` status — with no price/availability/status/
expiry/token inference of its own.

## Attempt/session state (`src/lib/api/bookingHoldAttempt.ts`)

Pure, framework-free types and functions used by `BookingHoldPanel`:

- `SelectedOfferSnapshot` — the exact live offer IDs plus the exact
  submitted Availability criteria (never the unsubmitted draft).
- `normalizeContact` / `validateContact` — mirrors the backend's structural
  contact rules (trimmed full name ≤200 chars; email ≤256 chars matching
  the backend's simple pattern; phone 7–32 chars from the backend's allowed
  character set, containing at least one ASCII digit).
- `buildBookingHoldRequest` — combines the offer snapshot and normalized
  contact into the exact allowed request body.
- `requestsAreEqual` — field-by-field equality, used to reason about when a
  new immutable attempt (and key) is required.
- `mergeHoldSession` — the guest-token retention rule: a same-Hold replay
  whose `guestAccessToken` is `null` never overwrites a previously retained
  non-null token; a different Hold ID never carries a token across; a
  replay with nothing retained stays honestly tokenless.

`src/lib/api/idempotencyKey.ts#generateIdempotencyKey()` uses
`crypto.randomUUID()` (never `Math.random`, a timestamp, or request/contact
data) with a short `bha-hold-` prefix, well under the 256 UTF-8 byte limit.

## UI wiring

- `AvailabilityOfferCard` renders one honest `Hold this room` action per
  card (only when the parent supplies `onHold`), disabled once an active
  Hold session exists.
- `SectionAvailabilitySearch` owns `selectedOffer` (offer snapshot + label)
  and `activeHoldSession` state. Selecting an offer snapshots the *exact
  last submitted* Availability criteria — never the live draft. A new
  explicit search (initial submit or "Retry last search") abandons any
  unsubmitted/failed selection; once a Hold has actually succeeded, that
  session is preserved rather than silently replaced, and every other
  offer's CTA is disabled — no second Hold can be created in this flow.
- `BookingHoldPanel` (`src/components/BookingHoldPanel.tsx`) owns the
  contact form and the mutation state machine:
  `idle → selected (implicit) → submitting → success | known-error |
  uncertain`, using native inputs with `<label htmlFor>`, `aria-invalid`,
  `aria-describedby`, and `role="alert"` field errors, matching the
  established Availability form pattern.
  - **Submitting** — the submit button is disabled and shows "Creating your
    Hold…"; a `role="status" aria-live="polite"` region announces it.
  - **Known error** — `ApiConfigError` / `ApiHttpError` / `ApiValidationError`
    (a normalized, non-ambiguous failure) render a `role="alert"` message
    from the normalized Problem Details.
  - **Uncertain** — `ApiNetworkError` or any other unclassified failure
    renders an honest "we couldn't confirm" message plus an explicit
    `Retry exact request` button that reuses the exact same immutable
    attempt (body + idempotency key); it is never fired automatically.
  - **Success** — renders only server-backed fields: status, Hold ID, stay
    dates, room/occupancy counts, the server's per-night snapshot, the
    server's total/currency (via the existing `formatCurrencyAmount`
    helper — no recomputation), `createdAtUtc`/`expiresAtUtc` as returned
    (no client-derived countdown), and the `created`/`replayed` outcome.
    When a guest token is retained, the panel tells the customer to remain
    in the tab; when a replay has no retained token, it says so honestly
    rather than implying recovery. No Confirm/Cancel/Pay/Login/Reservation
    action is rendered.
  - The panel's heading receives focus (`tabIndex={-1}` + a ref) when it
    first renders, satisfying the "move focus or announce" requirement
    without a route change.

## Security/disclosure invariants

- The raw idempotency key, CSRF token, and guest access token are never
  written to `localStorage`, `sessionStorage`, IndexedDB, a cookie, a URL,
  a DOM attribute, or a log statement anywhere in the new code.
- The one-time guest access token is captured into `ActiveHoldSession`
  state immediately on the initial anonymous `201` and is never rendered —
  only a presence/absence-derived message is shown.

## Focused automated tests

Node-environment Vitest only; no jsdom/RTL/Playwright/Cypress/MSW added.
64 new tests across five files, on top of the 96 existing tests (**160/160**
total):

- `httpClientUnsafe.test.ts` (13) — credentials, exact JSON body,
  conditional `Content-Type`, caller headers/signal forwarding, header
  case-dedup, `201`/`200`/`204` status exposure, Problem Details/network/
  cancellation normalization, no self-retry.
- `csrf.test.ts` (17) — lazy acquisition and header injection, in-memory
  reuse, concurrent-first-call dedup, case-duplicate collapse, acquired
  header overriding a caller variant, the one CT-CONTRACT-002 retry
  (preserving body/Idempotency-Key), a second antiforgery failure
  surfacing without a third request, non-retry of ordinary
  400/401/404/409/429/5xx/network/cancellation, and safe failure on a
  malformed CSRF payload (no mutation sent).
- `bookingHoldService.test.ts` (7) — exact route/method, allowed-fields-only
  body, exactly one `Idempotency-Key`, `201`→created/`200`→replayed,
  `AbortSignal` forwarding, no client-authoritative price/expiry/ownership/
  token/inventory field sent.
- `idempotencyKey.test.ts` (4) — non-empty/bounded value, uniqueness,
  `crypto.randomUUID` (not `Math.random`) as the entropy source, and a
  thrown error (not a silent fallback) when secure randomness is
  unavailable.
- `bookingHoldAttempt.test.ts` (23) — contact trimming and every documented
  boundary (name/email/phone length, phone character set, phone digit
  requirement), the request builder using the offer snapshot rather than
  draft edits, `requestsAreEqual` across offer/criteria/contact changes,
  and the full guest-token retention matrix (initial token, same-Hold
  replay-null non-overwrite, no-retained-token honesty, different-Hold
  isolation, authenticated no-token case).

## Live verification evidence

Verified against the Development API (`http://localhost:5145`) with real
PostgreSQL and existing seed data, and the Customer Web dev server
(`http://localhost:3000`):

- `/home-2` still loads Property/RoomType/Availability with zero console
  errors; zero CSRF/Hold requests before an offer is explicitly selected
  and submitted.
- Selecting a real offer opened the contact panel labeled with that exact
  offer and Property; editing the search form afterward did not relabel or
  alter the pending selection.
- The first real Hold attempt sent, in order, exactly one
  `GET /api/v1/auth/csrf` then exactly one `POST /api/v1/booking-holds`
  (plus the browser's own CORS preflight `OPTIONS`), carrying browser-
  managed credentials, one `X-CSRF-TOKEN`, one `Idempotency-Key`, and only
  the allowed JSON fields with real IDs and the submitted stay/occupancy —
  confirmed via the Network panel and cross-checked against direct
  `curl` calls against the same live endpoints (`201` create, `200`
  replay with `guestAccessToken: null`, the exact CT-CONTRACT-002 body for
  missing/absent/malformed antiforgery tokens, and a distinct ordinary
  business-validation `400`).
- The API returned a real `201`, and the UI rendered the real Active Hold:
  status, Hold ID, stay dates, per-night snapshot, total/currency, and
  server `createdAtUtc`/`expiresAtUtc` — with the one-time guest token
  retained only in memory (confirmed absent from the DOM text, URL, and
  browser storage).
- A deliberate duplicate click on `Confirm Hold` produced no duplicate
  `POST`; after success, every offer's `Hold this room` CTA was disabled
  and a click produced no new request — the retained Hold was never
  silently replaced.
- A deliberate backend outage (process stopped mid-flow) produced exactly
  one failed `POST` and the honest **uncertain** state with no automatic
  retry; restarting the API and clicking the explicit `Retry exact
  request` button reused the same immutable attempt and recovered with a
  real `201`.
- No `GET`/confirm/cancel Hold request, Reservation request, or auth
  mutation occurred at any point in the session.
- Responsive verification followed the FE-001.2/FE-001.3 precedent: this
  sandbox's `resize_window` does not change the tab's actual
  `window.innerWidth`, so mobile-first behavior was verified via the
  rendered Tailwind classes (the panel and form reuse the same
  `Input`/`ButtonPrimary`/`ButtonSecondary` primitives and single-column
  layout already approved for the Availability form) rather than a resized
  screenshot.

No raw guest access token, CSRF token, idempotency key, cookie value, or
contact PII appears in this document, the branch diff, or any committed
fixture.

## Explicit exclusions

Hold read/confirm/cancel, Reservation read/cancel, login/register/logout,
`/auth/me`, profile or auth-state UI, `localStorage`/`sessionStorage`/
IndexedDB/cookie persistence of any booking secret, reload/crash recovery,
multiple concurrent active Holds, background expiry cleanup, a
client-derived countdown, payment/tax/discount/currency conversion, and any
Backend/schema/migration/CORS/cookie-policy change.

`SNAPSHOT.md` was not modified by this task.
