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
> "Corrected ownership: the root Booking Hold provider" below.
>
> **Second correction (post-review):** two follow-up findings on that same
> provider/reducer/controller design. **P1** — `SectionAvailabilitySearch`
> checked a *React-rendered* `searchLocked` boolean before calling
> `runSearch()`, but `runSearch()` itself performed abort/request-identity/
> local-state/network side effects; because `BookingHoldFlowController`'s
> synchronous `inFlight` lock can be set a full render ahead of that
> boolean updating, a same-tick Hold submit followed by an Availability
> submit could still slip through and run those side effects. Fixed by
> adding a synchronous, authoritative gate —
> `tryBeginAvailabilitySearch()` — at the coordinator itself (see "The
> synchronous Availability gate" below), which every Availability entry
> point now consults *before* any side effect. **P2** — the
> `attempt-succeeded` reducer case spread `...state`, so a definitive
> success kept the just-submitted contact PII and the now-obsolete offer
> selection in memory instead of scrubbing them. Fixed by constructing the
> post-success state explicitly (see "Definitive-success scrubbing"
> below). Everything in this document describes the **fully corrected**
> architecture.

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
### Definitive-success scrubbing

`attempt-succeeded` is constructed deliberately — never `...state` — so a
definitive success retains only what later lifecycle work actually needs:

- `phase` becomes `active-session`;
- `session` is the correctly merged current session/result, via the
  existing `mergeHoldSession` (reading the reducer's *current*
  `state.session`, never a stale closure) — the same-Hold replay-null
  guest-token retention rule is unaffected;
- `contact` is reset to `{ fullName: "", email: "", phone: "" }`,
  `offer`/`offerLabel`/`attempt`/`fieldErrors`/`errorMessage` are all
  `null` — the just-submitted contact PII and the now-obsolete offer
  selection are scrubbed from memory, not merely hidden by the UI.

This scrub is specific to a *definitive* success. `uncertain` and
`known-error` are unaffected: `uncertain` keeps the exact retained
`attempt`/`contact`/`offer` (required for manual exact retry — scrubbing
those early would break "Retry exact request"), and `known-error` keeps
`contact`/`offer` so the customer can correct and resubmit.

### Synchronous guards (`src/lib/api/bookingHoldFlowController.ts`)

React state updates are not visible until the next render, so two clicks in
the same tick would both see the "old" state if the only guard were
`phase`. The coordinator additionally holds plain closure state (not React
state, so it is unaffected by render/commit timing):

- `inFlight` — set **before** the idempotency key is generated or the
  service is called, cleared only in the settling operation's `finally`.
  Combined with a monotonic `operationId` counter (incremented
  synchronously, before any `await`/microtask): two same-tick submits (a
  rapid double-click, or a click plus the Enter-key firing a second
  `submit()` in the same tick) produce exactly one key generation and one
  `createBookingHold` call, and a stale completion (identified by its
  captured `operationId` no longer matching the coordinator's current one)
  never updates the reducer, even if the underlying network call is still
  technically in flight when a newer operation starts.
- `offerSelectionActive` — mirrors "is there a live, submittable offer
  selection right now," set `true` by an accepted `selectOffer` and `false`
  by an accepted `tryBeginAvailabilitySearch()` (see below). `submit()`
  checks this *before* trusting `getState().offer`, because `getState()`
  (backed by a ref updated during render) can still show the old offer for
  one tick after an Availability search has already been accepted and
  dispatched a reset — this flag closes that gap.

### The synchronous Availability gate

`tryBeginAvailabilitySearch(): boolean` is the single authoritative,
synchronous decision point for whether an explicit Availability operation
(a fresh search or "Retry last search") may begin — network execution is
authorized here, not by a rendered `searchLocked` boolean:

1. Rejects if `inFlight` (a Hold submit/retry has already acquired the
   synchronous lock this tick, even before React commits `phase`) or if
   `getState().phase` is `submitting`/`uncertain`/`active-session`.
2. On acceptance, synchronously sets `offerSelectionActive = false` and
   dispatches the reducer's `search-reset` — invalidating the current Hold
   offer selection *before* the caller is allowed to start the Availability
   request.

`runIfAvailabilitySearchAllowed(tryBeginAvailabilitySearch, performSearch)`
(also in `bookingHoldFlowController.ts`) wraps this: `performSearch` (the
abort/request-identity bump/local state mutation/`searchAvailability()`
call) only runs if the gate accepts — none of those side effects happen on
rejection. `SectionAvailabilitySearch.runSearch` calls this helper directly,
so the exact same guarded path is both what the UI runs and what Vitest
exercises.

Search and Hold submission therefore serialize safely in **both** same-tick
orders:

- **Hold submit/retry first, then Availability** — `inFlight` is already
  `true`, so the gate rejects; zero Availability side effects run, and the
  Hold submit/retry remains the only mutation.
- **Availability first, then Hold submit** — the gate accepts and
  synchronously clears `offerSelectionActive`; the same-tick `submit()`
  call sees `offerSelectionActive === false` and rejects before generating
  a key or calling the service, so the now-obsolete offer can never produce
  a Hold. A genuinely new offer selected from the new search's results can
  still be submitted normally.

### `BookingHoldPanel` and `SectionAvailabilitySearch`

Both render purely from `useBookingHoldFlow()` — the panel owns no
submission state, immutable attempt, or `AbortController` of its own:

- **Submitting** — the submit button is disabled and shows "Creating your
  Hold…"; a `role="status" aria-live="polite"` region announces it.
- **Known error** — a normalized, non-ambiguous failure (`ApiConfigError` /
  `ApiHttpError` / `ApiValidationError`) renders a `role="alert"` message;
  contact stays editable and a fresh submit mints a genuinely new
  attempt/key.
- **Uncertain** — an honest "we couldn't confirm" message; the ordinary
  `Confirm Hold` button is not rendered at all (only `Retry exact request`
  is), and contact fields are disabled. `Retry exact request` reuses the
  exact retained body and `Idempotency-Key` and is never fired
  automatically.
- **Active session** — renders only server-backed fields: status, Hold ID,
  stay dates, room/occupancy counts, the server's per-night snapshot, the
  server's total/currency (via the existing `formatCurrencyAmount` helper —
  no recomputation), `createdAtUtc`/`expiresAtUtc` as returned (no
  client-derived countdown), and the `created`/`replayed` outcome. When a
  guest token is retained, the panel tells the customer to remain in the
  tab; when a replay has no retained token, it says so honestly rather than
  implying recovery. No Confirm/Cancel/Pay/Login/Reservation action is
  rendered.
- The panel's heading receives focus (`tabIndex={-1}` + a ref) whenever the
  phase or the selected offer changes, satisfying the "move focus or
  announce" requirement without a route change.
- `SectionAvailabilitySearch` derives one shared `flowLocked` predicate
  (`phase` is `submitting`/`uncertain`/`active-session`) for
  display/accessibility, and disables every Availability input (Property,
  check-in, check-out, adults, children, rooms), the search submit and
  "Retry last search" buttons, and every offer's `Hold this room` CTA when
  it is true — including `active-session` (a succeeded Hold locks new
  searches and offer switching too, not only `submitting`/`uncertain`).
  This is display/UX only; the actual behavioral authority is the
  synchronous gate above, which a stale render of `flowLocked` can never
  bypass.

## Security/disclosure invariants

- The raw idempotency key, CSRF token, and guest access token are never
  written to `localStorage`, `sessionStorage`, IndexedDB, a cookie, a URL,
  a DOM attribute, or a log statement anywhere in the new code.
- The one-time guest access token is captured into `ActiveHoldSession`
  state immediately on the initial anonymous `201` and is never rendered —
  only a presence/absence-derived message is shown.

## Focused automated tests

Node-environment Vitest only; no jsdom/RTL/Playwright/Cypress/MSW added.
107 new tests across seven files, on top of the 96 original baseline tests
(**203/203** total):

- `bookingHoldFlow.test.ts` (22) — every reducer transition and its guard
  (offer selection/contact edits/fresh submit/search-reset rejected outside
  their allowed phases); the stale-operation guard directly, including the
  case where it would otherwise have turned a real `active-session` back
  into `uncertain`; and the P2 definitive-success scrub — `contact` reset
  to empty values and `offer`/`offerLabel`/`attempt`/`fieldErrors`/
  `errorMessage` cleared on success, while `uncertain` and `known-error`
  are proven to retain `contact`/`offer`/`attempt` unscrubbed.
- `bookingHoldFlowController.test.ts` (21) — exercises the real
  React-free coordinator (and the exported `runIfAvailabilitySearchAllowed`
  helper `SectionAvailabilitySearch` actually uses) against a real reducer
  instance, with `createBookingHold`/`generateIdempotencyKey` mocked: two
  same-tick `submit()` calls (and a simulated Enter-key double-submit)
  produce exactly one key and one service call; `submitting`/`uncertain`
  block offer switching, search, and a fresh submit; `retryExact()` reuses
  the exact same request body and key; a `known-error` unlocks a genuinely
  new key; and the P1 cross-flow races — a Hold submit/retry followed
  same-tick by an Availability attempt (rejected, zero new requests, the
  Hold remains the only mutation), and an accepted Availability search
  followed same-tick by a Hold submit (the now-obsolete offer produces
  zero keys and zero POSTs) — are proven directly against
  `tryBeginAvailabilitySearch()`, including through
  `runIfAvailabilitySearchAllowed` with a stand-in "abort/request-id/local
  state" side effect to prove rejection happens before any of it runs.
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

### Cross-flow race and success-scrub evidence (second post-review correction)

Using the same kind of temporary, non-committed browser-only response delay
on `POST /api/v1/booking-holds`:

1. With a real Create Hold response held pending, a rapid repeated
   `Confirm Hold` click, a fresh Availability search submit, another
   offer's `Hold this room` click, and an attempted Adults-field edit were
   all fired in immediate succession. The Network panel showed exactly one
   `POST /api/v1/booking-holds` (still `pending`), one `GET
   /api/v1/auth/csrf`, and **zero** `GET .../availability` requests; the
   Availability inputs/buttons did not transition to a loading state and
   the typed Adults value did not take effect (the field was `disabled`).
   Once the delay elapsed, the pending request resolved with a real `201`
   exactly as if the disruptive attempts had never happened.
2. From that same **active-session**, the Availability submit button, both
   offer `Hold this room` buttons, and every Availability input were
   confirmed `disabled` via their DOM property (not just visually); clicking
   the search and offer buttons anyway produced zero new network requests,
   and the retained Hold's ID was unchanged before and after.
3. A genuine backend outage (process stopped) produced a real **uncertain**
   phase; a fresh Availability search and another offer's CTA were
   attempted and produced zero new requests, confirmed both by the Network
   panel and by reading `disabled` directly off the DOM elements (search
   submit, both offer buttons, all six Availability inputs, and all three
   contact inputs). Restarting the API and clicking `Retry exact request`
   resolved with a real `201`.
4. After a definitive success, the app's live in-memory state was read
   directly (via the React fiber tree — the same technique React DevTools
   itself uses, not a new dependency) and asserted as booleans/presence
   only, never printing a raw value: `phase` was `"active-session"`;
   `offer`, `offerLabel`, `attempt`, `fieldErrors`, and `errorMessage` were
   all confirmed `null`; `contact.fullName`/`.email`/`.phone` were all
   confirmed to equal the empty string; `session` was confirmed present
   with a non-null `guestAccessToken`. The same inspection during the
   preceding **uncertain** phase confirmed the opposite — `attempt`,
   `offer`, and `contact` all still non-empty/retained — proving the scrub
   is specific to definitive success, not premature.
5. A normal, single Availability search (no Hold attempt yet) still worked
   exactly as before, and two ordinary back-to-back searches (both
   unlocked) each still produced their own live `GET .../availability`
   request — the pre-existing abort/latest-request-identity mechanism is
   untouched by this correction.
6. Zero unexpected console errors were observed at any point in this
   verification pass; the only `localhost:5145` endpoints observed were the
   same allowed set as before (properties, room-types, availability, csrf,
   booking-holds plus its CORS preflight).

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
