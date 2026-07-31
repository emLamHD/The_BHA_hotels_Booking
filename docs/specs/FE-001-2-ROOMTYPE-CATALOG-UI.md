# FE-001.2 Live RoomType catalog with template-derived cards

## Scope

FE-001.2 extends the FE-001.1 Axios/Property integration so `/home-2`
renders the real RoomTypes belonging to the real Properties returned by the
backend. This is a read-only catalog slice. Availability, pricing, search,
CSRF, Idempotency-Key, Hold, Reservation, and authentication UI are
explicitly out of scope and were not touched.

## Inherited architecture

FE-001.2 reuses the FE-001.1 foundation unchanged:

- `src/lib/api/httpClient.ts` — the one lazy Axios instance
  (`withCredentials: true`, `AbortSignal` support, no automatic retry).
- `src/lib/api/errors.ts` — `ApiConfigError` / `ApiNetworkError` /
  `ApiHttpError` / `ApiValidationError`, and `isRequestCancelledError`.
- `src/lib/api/propertyPresentation.ts` — `selectCoverImage` is generic over
  `MediaDto[]` and is reused as-is for RoomType media; no RoomType-specific
  media logic was written.
- `SectionGridFeatureProperty` — still owns the single
  `GET /api/v1/properties` request; FE-001.2 only adds a render call after
  its existing success branch.

## RoomType endpoint and wire contract

- Endpoint: `GET /api/v1/properties/{propertyId}/room-types`, confirmed
  against the live `/swagger/v1/swagger.json` document and real calls
  against seeded data (`Deluxe King`, `Family Suite`).
- `RoomTypeDto` (`src/lib/api/propertyTypes.ts`) reuses the existing
  `AmenityDto` and `MediaDto` types verbatim — no duplicate Amenity/Media
  wire shapes were introduced. Fields: `id`, `propertyId`, `code`, `name`,
  `slug`, `description`, `baseOccupancy`, `maxOccupancy`, `amenities`,
  `media`. `PhysicalRoom`, `RatePlan`, pricing, and availability fields are
  intentionally absent.
- Casing/nullability matches the generated OpenAPI schema, which — like
  `PropertyDto` before it — marks every reference-type property nullable
  regardless of the backend record's C# nullable annotations (a known
  Swashbuckle/records quirk already resolved this way for `PropertyDto` in
  FE-001.1; the same convention is applied here rather than re-litigated).
- `src/lib/api/roomTypeService.ts#getRoomTypes(propertyId, options)` calls
  the exact nested route, forwards `AbortSignal`, returns `[]` (never
  `undefined`) on a no-content transport result or a real empty JSON array,
  and never retries automatically or adds CSRF/Idempotency-Key/booking
  tokens. It never calls the single-RoomType detail endpoint
  (`GET /api/v1/room-types/{roomTypeId}`) to render a list.

## Property-to-RoomType data flow

- `SectionGridFeatureProperty` fetches Properties exactly once (unchanged).
- On success, it renders `SectionGridRoomTypes`
  (`src/app/(home)/SectionGridRoomTypes.tsx`), passing the already-loaded
  `PropertyDto[]` as a prop. No second `GET /api/v1/properties` request is
  ever issued.
- `SectionGridRoomTypes` renders one independent `PropertyRoomTypes` child
  per Property, keyed by `property.id`. Each child owns its own RoomType
  read lifecycle (`getRoomTypes(propertyId, { signal })`) and displays its
  results under a `"Room types at {propertyName}"` heading, so multiple
  Properties remain grouped and labeled rather than merged into one
  anonymous list.
- Backend ordering (name, then ID) is preserved; no client-side re-sorting
  or popularity ranking is applied.

## Loading, empty, error, retry, and cancellation

Each `PropertyRoomTypes` instance mirrors the already-reviewed
`SectionGridFeatureProperty` lifecycle pattern exactly:

- **Loading** — `role="status" aria-live="polite"` region ("Loading room
  types…").
- **Empty** — `role="status"` region distinguishing a genuine empty
  RoomType list from an error, scoped to its own Property
  ("No room types are available for {propertyName} right now.").
- **Error** — `role="alert"` region with a message derived from the
  existing normalized error types, plus a native, keyboard-operable Retry
  button (`ButtonSecondary`). A failed Property's RoomTypes are never
  silently presented as empty.
- **Retry** — re-runs only that Property's RoomType read; no page reload.
- **Cancellation** — each load attempt gets its own `AbortController`; a new
  attempt (retry) or unmount aborts the previous one before starting/
  cleaning up. `isRequestCancelledError` prevents a cancelled request from
  being surfaced as a user-facing failure. Because each Property's section
  is keyed by `property.id`, an added/removed Property naturally
  remounts/unmounts its own request via React's effect cleanup — no manual
  stale-property-set bookkeeping was needed.

Live-tested: stopping the API and clicking Retry shows the error state;
restarting the API and clicking Retry (including via a real keyboard Enter
press while the button was focused) restores the catalog without a page
reload. A client-side-only fault injection (test-only XHR override,
scoped to the `/room-types` URL, never committed) was used to prove the
RoomType section can show its own labeled error independently while the
Property section stays successful — i.e. a RoomType failure never masks or
gets merged into the Property section's state.

## Template-derived cards

`RoomTypeLiveCard` (`src/components/RoomTypeLiveCard.tsx`) is visually
adapted from the existing `PropertyLiveCard`/`PropertyCardH` card language
(rounded card, image region, badges) but accepts `RoomTypeDto` directly —
it does not accept or map through `StayDataType` or `DEMO_STAY_LISTINGS`.

Rendered fields: RoomType name, description (when present), base/maximum
occupancy (`formatDesignedForOccupancy` / `formatMaxOccupancy` in
`src/lib/api/roomTypePresentation.ts` — e.g. "Designed for 2 guests · Up to
4 guests", singular/plural handled, never reinterpreted as beds, bedrooms,
or available-room counts), and real amenities.

Deliberately omitted (no fake data): price/`/night`, currency, reviews or
ratings, sale/discount badges, "ADS" badges, beds/baths/room size/floor/room
number, like/favorite state, fake category or address, fake `href`/detail
route, availability, or a booking CTA. The card is not wrapped in a link —
there is no implemented RoomType detail route in this slice.

## Media and fallback behavior

`selectCoverImage` (existing, unmodified, generic over `MediaDto[]`) is
reused as-is: it prefers the server-flagged cover image, otherwise the
lowest `SortOrder`/media-ID image, and excludes malformed or RFC 2606
reserved-example-host URLs (the current seed's `images.example.com` media)
before a `src` is ever assigned. When no usable backend image exists,
`RoomTypeLiveCard` renders the existing bundled
`src/images/placeholder-large-h.png` asset via `next/image` immediately —
the same fallback asset already used by `PropertyLiveCard`. No new image
assets were downloaded or added. A defensive `onError` handler remains for
unexpected runtime failures on an otherwise-valid URL.

## Responsive and accessibility verification

- `SectionGridRoomTypes`'s grid uses `grid-cols-1 sm:grid-cols-2
  xl:grid-cols-3` (mobile-first single column, same Tailwind breakpoints —
  no custom `screens` override exists in `tailwind.config.js` — already
  used by the approved Property grid's `grid-cols-1 sm:grid-cols-1
  xl:grid-cols-2`).
- Card image uses a stable `aspect-w-6 aspect-h-5` container; text uses
  `line-clamp-2` and amenity badges wrap (`flex-wrap`).
- Retry is a native `<button>` (via `ButtonSecondary`/`Button`), confirmed
  keyboard-operable: programmatically focused, then activated with a real
  Enter keypress, recovering the section without a page reload.
- Image alt text uses the backend's `altText` when present, or an honest
  `"{name} photo"` / `"{name} photo placeholder"` fallback otherwise.
- Direct viewport-resize screenshots could not be captured in this session
  because the browser-automation sandbox's `resize_window` tool did not
  change the tab's actual `window.innerWidth` (confirmed via script — a
  tooling limitation, not a code issue). Responsive behavior was instead
  verified by inspecting the rendered Tailwind grid classes and confirming
  no custom breakpoint overrides exist, mirroring the already-approved
  Property grid's verified pattern.

## Automated tests

Node-environment Vitest only; no jsdom/RTL/Playwright/Cypress was added.

- `src/lib/api/__tests__/roomTypeService.test.ts` (8 tests) — exact nested
  route construction, live-Property-ID (not fixed seed ID) parameterization,
  `AbortSignal` forwarding, unchanged success/empty-array passthrough,
  no-content-to-`[]` normalization, normalized `ApiHttpError` propagation,
  and cancellation-error propagation (not converted to a user failure).
- `src/lib/api/__tests__/roomTypePresentation.test.ts` (8 tests) — occupancy
  singular/plural formatting with no beds/rooms/availability wording, and
  RoomType-media selection/rejection via the shared `selectCoverImage`.

Existing 44 FE-001.1 tests remain green; final count is **60/60**.

## Live verification evidence

- `GET http://localhost:5145/api/v1/properties` → 200, exactly one request
  from the live catalog area.
- `GET http://localhost:5145/api/v1/properties/10000000-0000-0000-0000-000000000001/room-types`
  → 200, exactly one request per Property.
- `Deluxe King` and `Family Suite` rendered with their real descriptions,
  occupancy ("Designed for 2 guests · Up to 2 guests" / "Designed for 2
  guests · Up to 4 guests"), and amenities (Air Conditioning, Complimentary
  Wi-Fi, Breakfast).
- No request to `images.example.com`; the bundled placeholder rendered for
  both seeded RoomTypes.
- No console error or hydration error.
- No `Availability`, auth, CSRF, Hold, or Reservation request was observed.
- Stop/Retry/restart/Retry recovery proven for both the Property section and
  (via a scoped, non-committed client-side fault injection) the RoomType
  section independently, including one keyboard-triggered (`Enter`)
  activation of a focused Retry button.

## Explicit exclusions

- No Availability form, query state, or endpoint call.
- No RatePlan, nightly rate, total, currency, or available-room count.
- No search-results page, CSRF, Idempotency-Key, `X-Booking-Access-Token`,
  Hold/Reservation create/read/cancel, or login/register/logout UI.
- No RoomType detail route.
- No PhysicalRoom or physical-inventory data.
- No hard-coded Property/RoomType ID in application code (test fixtures use
  literal seed-shaped IDs only to prove contract/route correctness).
- No `StayDataType`/`DEMO_STAY_LISTINGS` reuse.
- No new HTTP client, automatic retry layer, state-management library, or
  generated OpenAPI client.
- No changes under `Back_End/`; no schema, migration, CORS, or auth change.

FE-001.3 was not started.
