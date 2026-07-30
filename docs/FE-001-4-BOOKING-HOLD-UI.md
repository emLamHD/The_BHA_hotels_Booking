# FE-001.4 Booking Hold creation from a live Availability offer

## Scope

FE-001.4 extends the merged FE-001.1–FE-001.3 Property/RoomType/Availability
UI on `/home-2` so a customer can select a real server offer, enter contact
details, and create a real 15-minute Booking Hold through
`POST /api/v1/booking-holds`. It ends once the Hold is created and
represented safely in the current tab. Hold read/confirm/cancel, Reservation
read/cancel, authentication UI, and payment remain out of scope.

> **Correction (post-review):** an earlier revision of this document and
> implementation had `SectionAvailabilitySearch` own the active Hold
> session as local component `useState`, and had `BookingHoldPanel` own the
> in-flight submission/`AbortController` as local state. Two P1 defects
> followed from that ownership: (1) an unresolved `submitting`/`uncertain`
> attempt could be abandoned — and a second Hold created — by switching
> offers, starting a new search, or unmounting the panel; (2) the one-time
> guest access token was lost on ordinary Next.js client-side navigation
> away from `/home-2`, since it lived in a component that unmounted. Both
> are fixed by moving all of this into an app-lifetime root provider — see
> "Corrected ownership: the root Booking Hold provider" below. Everything
> in this document describes the **corrected** architecture.

## Inherited architecture

- `src/lib/api/httpClient.ts` — the one lazy Axios instance
  (`withCredentials: true`, case-insensitive header dedup, `AbortSignal`
  support) — extended, not replaced.
- `src/lib/api/errors.ts` — `ApiConfigError` / `ApiNetworkError` /
  `ApiHttpError` / `ApiValidationError`, `isRequestCancelledError` —
  unchanged.
- `src/components/AvailabilityOfferCard.tsx` — extended with an optional
  `onHold`/`holdDisabled` CTA; the existing read-only Availability search,
  draft/submitted-query separation, and stale-response guarding in
  `SectionAvailabilitySearch` are otherwise unchanged.

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

## Corrected ownership: the root Booking Hold provider

Authoritative Booking Hold flow state — the selected offer, the immutable
in-flight/retryable attempt, the submission phase, the active session, and
the one-time guest token — lives in `BookingHoldProvider`
(`src/app/BookingHoldProvider.tsx`), a client component mounted once in
`src/app/layout.tsx` inside `<body>`, wrapping the whole page tree. Because
the root layout stays mounted across ordinary Next.js App Router client
navigation, this state now survives:

- switching between `/home-2` and any other route and back;
- `SectionAvailabilitySearch`/`BookingHoldPanel` unmounting and remounting
  (e.g. because an unrelated sibling section's own data reload temporarily
  gates their render tree);

and is lost only on a hard reload, tab close, or crash — an explicit,
documented FE-001.4 limitation, never silently promised otherwise. The
provider is per-mounted-app `useReducer`/`useRef` state, not a module-level
mutable singleton, so nothing can leak across SSR requests or users.

`BookingHoldProvider` is a thin wrapper: it supplies `useReducer`'s
`dispatch` and a ref-backed `getState` (so guards always read the current
state, never a stale closure) to a React-free coordinator,
`createBookingHoldFlowController` (`src/lib/api/bookingHoldFlowController.ts`),
which owns the actual guard/network logic and is exercised directly by
Vitest — see "Focused automated tests" below. `AbortController` creation is
also owned by the provider (via the coordinator's `onAttemptStart` hook),
so a page/panel unmounting during navigation never aborts the in-flight
request — only the provider's own (whole-app) teardown may.

### Phase machine (`src/lib/api/bookingHoldFlow.ts`)

A pure reducer drives six phases — `idle`, `selected`, `submitting`,
`known-error`, `uncertain`, `active-session` — and every transition is
guarded in the reducer itself, not only by disabled button styling:

- **`selected`/`known-error`** — contact is editable and a fresh, newly
  keyed submit is allowed.
- **`submitting`/`uncertain`/`active-session`** — offer switching, a new
  Availability search, and a fresh submit are all rejected as no-ops by the
  reducer (`offer-selected`, `search-reset`, `submit-requested` are ignored
  outside `selected`/`known-error`). `retry-requested` is the *only* action
  accepted in `uncertain`, and only when an attempt is retained.
- Every `attempt-succeeded`/`attempt-known-error`/`attempt-uncertain`
  action carries the operation's identity and is applied only if
  `phase === "submitting"` and that identity still matches the reducer's
  current `operationId` — a stale completion from a superseded operation is
  silently ignored, so it can never resurrect an old outcome over a newer
  one (including turning a real success back into `uncertain`).
- `attempt-succeeded` merges into `session` via the existing
  `mergeHoldSession` (reading the reducer's *current* `state.session`, never
  a stale closure) and clears the immutable attempt — only the active
  session and its guest token are retained past a definitive success.

### Synchronous guards (`src/lib/api/bookingHoldFlowController.ts`)

React state updates are not visible until the next render, so two clicks in
the same tick would both see the "old" state if the only guard were
`phase`. The coordinator additionally holds a plain closure boolean
(`inFlight`, not React state) that is set **before** the idempotency key is
generated or the service is called, and cleared only in the settling
operation's `finally`. Combined with a monotonic `operationId` counter
(incremented synchronously, before any `await`/microtask), this guarantees:

- two same-tick submits (a rapid double-click, or a click plus the
  Enter-key firing a second `submit()` in the same tick) produce exactly
  one key generation and one `createBookingHold` call;
- a stale completion (identified by its captured `operationId` no longer
  matching the coordinator's current one) never updates the reducer, even
  if the underlying network call is still technically in flight when a
  newer operation starts.

### `BookingHoldPanel` and `SectionAvailabilitySearch`

Both now render purely from `useBookingHoldFlow()` — the panel owns no
submission state, immutable attempt, or `AbortController` of its own:

- **Submitting** — the submit button is disabled and shows "Creating your
  Hold…"; a `role="status" aria-live="polite"` region announces it; the
  Availability form's own submit/retry buttons and every offer's `Hold this
  room` CTA are also disabled (`SectionAvailabilitySearch` derives
  `searchLocked`/`offerSelectionLocked` from the shared `phase`).
- **Known error** — a normalized, non-ambiguous failure (`ApiConfigError` /
  `ApiHttpError` / `ApiValidationError`) renders a `role="alert"` message;
  contact stays editable and a fresh submit mints a genuinely new
  attempt/key.
- **Uncertain** — an honest "we couldn't confirm" message; the ordinary
  `Confirm Hold` button is not rendered at all (only `Retry exact request`
  is), contact fields are disabled, and search/offer controls are disabled
  too. `Retry exact request` reuses the exact retained body and
  `Idempotency-Key` and is never fired automatically.
- **Active session** — renders only server-backed fields: status, Hold ID,
  stay dates, room/occupancy counts, the server's per-night snapshot, the
  server's total/currency (via the existing `formatCurrencyAmount` helper —
  no recomputation), `createdAtUtc`/`expiresAtUtc` as returned (no
  client-derived countdown), and the `created`/`replayed` outcome. When a
  guest token is retained, the panel tells the customer to remain in the
  tab; when a replay has no retained token, it says so honestly rather than
  implying recovery. No Confirm/Cancel/Pay/Login/Reservation action is
  rendered, and every offer's CTA stays disabled — no second Hold can be
  created in this flow.
- The panel's heading receives focus (`tabIndex={-1}` + a ref) whenever the
  phase or the selected offer changes, satisfying the "move focus or
  announce" requirement without a route change.
- `SectionAvailabilitySearch`'s own initial/automatic effects (Property
  list validation) never call `resetSearchSelection()` — only an *explicit*
  user search submit or "Retry last search" does, and that call is itself a
  no-op while the flow is `submitting`/`uncertain`/`active-session` — so a
  page remount after navigating back to `/home-2` can never clear or
  replace an app-retained in-flight attempt or a succeeded Hold.

## Security/disclosure invariants

- The raw idempotency key, CSRF token, and guest access token are never
  written to `localStorage`, `sessionStorage`, IndexedDB, a cookie, a URL,
  a DOM attribute, or a log statement anywhere in the new code.
- The one-time guest access token is captured into `ActiveHoldSession`
  state immediately on the initial anonymous `201` and is never rendered —
  only a presence/absence-derived message is shown.

## Focused automated tests

Node-environment Vitest only; no jsdom/RTL/Playwright/Cypress/MSW added.
91 new tests across seven files, on top of the 96 original baseline tests
(**187/187** total):

- `bookingHoldFlow.test.ts` (17) — every reducer transition and its guard
  (offer selection/contact edits/fresh submit/search-reset rejected outside
  their allowed phases), and the stale-operation guard directly: a
  superseded operation's late `attempt-succeeded`/`attempt-uncertain`/
  `attempt-known-error` is proven to leave state completely unchanged,
  including the case where it would otherwise have turned a real
  `active-session` back into `uncertain`.
- `bookingHoldFlowController.test.ts` (10) — exercises the real
  React-free coordinator against a real reducer instance (a small
  dispatch/getState harness, no mocked state machine) with
  `createBookingHold`/`generateIdempotencyKey` mocked: two same-tick
  `submit()` calls (and a simulated Enter-key double-submit) produce
  exactly one key and one service call; `submitting` blocks offer
  switching, search-reset, and a fresh submit; a network failure preserves
  the exact attempt and enters `uncertain`; `uncertain` rejects a fresh
  submit without generating a new key and keeps search/offer locked;
  `retryExact()` reuses the exact same request body and key (never
  regenerating one); a same-tick double retry produces exactly one retry
  call; a `known-error` unlocks editing and a genuinely new key on the next
  submit; and constructing the controller (simulating a remount) never
  calls the service or generates a key by itself.
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

### Race and client-navigation evidence (post-review correction)

Using a temporary, non-committed browser-only response delay (never written
to the repository) on `POST /api/v1/booking-holds`:

1. With the Create Hold response held pending, a rapid repeated submit
   click, an Enter-key submit, clicking the other offer's `Hold this room`,
   and submitting a fresh Availability search were all attempted in quick
   succession. Exactly one `POST /api/v1/booking-holds` was ever sent
   (confirmed by an injected send-counter observed before and after); once
   the pending request resolved, both offer CTAs were correctly disabled.
2. A genuine backend outage (process stopped, not merely delayed) produced
   exactly one failed request and the **uncertain** phase. While uncertain:
   the ordinary `Confirm Hold` button was not rendered at all; the
   Availability search submit/retry buttons and both offer `Hold this room`
   buttons were confirmed `disabled` in the DOM; clicking them anyway
   produced zero new network requests. Restarting the API and clicking
   `Retry exact request` sent the identical body/key and resolved safely
   with a real `201`.
3. From an **active session**, a real Next.js client-side navigation (a
   `next/link` click, confirmed by the absence of any full-document reload
   network entry) away from `/home-2` and back — via `history.back()` —
   preserved the exact same Hold ID, `createdAtUtc`/`expiresAtUtc`, and the
   guest-token-retained message, with **zero** new `GET /api/v1/auth/csrf`
   or `POST /api/v1/booking-holds` requests on return. `localStorage`
   contained only the pre-existing, unrelated `theme` key; `sessionStorage`
   and `document.cookie` were empty; the URL carried no query/hash state.
4. From an **uncertain** attempt, the same client-side navigate-away and
   `history.back()` was repeated — additionally surviving an unrelated
   remount of `SectionAvailabilitySearch`/`BookingHoldPanel` (triggered by
   the sibling Property-list section's own load/retry cycle while the API
   was still down). On return, the flow still showed **uncertain** with the
   exact same retained contact values and `Retry exact request` button —
   never reset to idle, never auto-submitted, never re-keyed. Restarting
   the API and clicking `Retry exact request` then resolved with a real
   `201`, using the one attempt/key that existed for the entire scenario.
5. Across the whole corrected-flow verification session, the only
   `localhost:5145` endpoints ever called were `GET /api/v1/properties`,
   `GET .../room-types`, `GET .../availability`, `GET /api/v1/auth/csrf`,
   and `POST /api/v1/booking-holds` (plus its CORS preflight) — no Hold
   read/confirm/cancel, Reservation, auth mutation, or payment request.
6. Zero unexpected console errors were observed at any point.

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
