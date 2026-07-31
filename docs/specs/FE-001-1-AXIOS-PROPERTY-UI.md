# FE-001.1 Axios foundation and live Property UI

## Scope

FE-001.1 adds the customer web's first API integration layer: a shared
Axios foundation and one live, customer-facing Property section. RoomType,
Availability, CSRF, and booking behavior are explicitly out of scope.

## Local topology

- Customer Web: `http://localhost:3000` (Next.js 13.4.x, App Router).
- API: `http://localhost:5145` (ASP.NET Core, Development environment).
- PostgreSQL 17 via `docker compose up -d postgres`, migrated and seeded per
  `docs/DATABASE.md` / `docs/BE-001-PROPERTY-INVENTORY.md`.

## Environment configuration

One public variable, validated on first use by `src/lib/api/env.ts`:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:5145
```

- Must be an absolute `http`/`https` URL; anything else throws rather than
  falling back to a default.
- Trailing slashes are stripped.
- A non-secret example lives in `Front_End/Customer_Web/.env.local.example`.
  Copy it to `.env.local` (untracked) for local development.

## Axios foundation (`src/lib/api`)

- `httpClient.ts` builds one lazily-created Axios instance from the
  validated base URL, with `withCredentials: true` on the instance and on
  every request.
- Caller headers are merged case-insensitively (a case-only duplicate
  collapses to the last value) before being sent.
- Requests accept an `AbortSignal` so callers can cancel stale requests.
- No automatic retry is implemented anywhere in the client.
- No request body, cookie, credential, or token is ever logged.

## HTTP and ProblemDetails behavior

- `204 No Content` responses resolve to `undefined`.
- A successful empty-array JSON body (`[]`) is returned as `[]`, not
  coerced to `undefined`/`null`.
- Errors are normalized into three focused types instead of raw Axios
  internals:
  - `ApiConfigError` — the base URL is missing/malformed; no request was
    attempted.
  - `ApiNetworkError` — the request could not reach the server (no HTTP
    response).
  - `ApiHttpError` — a non-2xx HTTP response, normalized to
    `{ type, title, status, detail, instance }` (RFC 7807 ProblemDetails).
    `ApiValidationError extends ApiHttpError` and additionally exposes
    `errors: Record<string, string[]>` when the body is a validation
    ProblemDetails.
- A non-ProblemDetails or malformed error body falls back to a safe
  generic problem (`title: "Request failed"`) instead of throwing on
  unexpected shapes.

## Property endpoint and typed contract

- Endpoint: `GET /api/v1/properties`, confirmed against the live
  `/swagger/v1/swagger.json` document and a real call against seeded data.
- Types in `src/lib/api/propertyTypes.ts` (`PropertyDto`, `AmenityDto`,
  `MediaDto`) match the live OpenAPI schema's casing and nullability
  exactly. `PhysicalRoom`, RoomType, RatePlan, Availability, and booking
  contracts are not included.
- `src/lib/api/propertyService.ts#getProperties` is the one read service,
  calling the exact route above and returning `[]` rather than `undefined`
  when the transport yields no body.
- `src/lib/api/propertyPresentation.ts` holds pure, backend-value-preserving
  presentation helpers (`selectCoverImage`, `formatLocation`, `formatTime`)
  used by the UI; none of them fabricate a value when the source field is
  absent.

## Customer-facing route

`http://localhost:3000/home-2` (linked from primary navigation) renders
`SectionGridFeatureProperty`
(`Front_End/Customer_Web/src/app/(home)/SectionGridFeatureProperty.tsx`),
adapted from the template's existing Property-oriented grid section. Cards
are rendered by the new `PropertyLiveCard` component
(`Front_End/Customer_Web/src/components/PropertyLiveCard.tsx`).

The original `PropertyCardH`/`StayDataType` template card was not reused
directly: it requires price, review, bed/bath/sqft, and host fields the
Property API does not provide, and populating them would mean fabricating
data. `PropertyLiveCard` renders only genuine `PropertyDto` fields: name,
city/country, description (when present), formatted check-in/check-out
times, real amenity names, and a cover image.

## Loading, empty, error, and retry behavior

`SectionGridFeatureProperty` fetches on mount via `getProperties` with an
`AbortController`-backed signal:

- **Loading** — `role="status"` region with visible "Loading properties…"
  text.
- **Empty** — `role="status"` region with "No properties are available
  right now." when the API returns `[]`.
- **Error** — `role="alert"` region showing a message derived from the
  normalized error type, plus a keyboard-operable Retry button
  (`ButtonSecondary`, a native `<button>`).
- **Retry** — re-invokes the same fetch; a new request aborts any request
  still in flight, so duplicate/stale responses cannot race the UI.
- No page reload is required for any transition.

## Image fallback behavior

`selectCoverImage` (`src/lib/api/propertyPresentation.ts`) picks the API's
flagged cover image (or, absent a flag, the lowest `SortOrder`/media-ID
image), but only from media whose URL passes `isUsableMediaUrl`: a
well-formed absolute `http`/`https` URL that is not an RFC 2606 reserved
example host (`example.com`, `example.net`, `example.org`, or a
subdomain — e.g. the seed data's `images.example.com`). Reserved-example
and malformed URLs are excluded *before* an image `src` is ever assigned,
so the browser never issues a request known in advance to fail.

`PropertyLiveCard` renders that selected image when one exists; otherwise
it renders the bundled template asset
`Front_End/Customer_Web/src/images/placeholder-large-h.png` via
`next/image` immediately, with no intermediate failed request. No new
image assets were downloaded. A defensive `onError` handler remains on the
`<img>` element to catch unexpected runtime failures (e.g. a legitimate,
non-reserved host returning 404) by swapping to the same placeholder — it
is a safety net for cases the URL-usability check cannot know about ahead
of time, not the mechanism used for the seeded `images.example.com` data,
which is filtered out before rendering.

## Manual UI verification steps

1. `docker compose up -d postgres`, then apply the migration and run
   `dotnet run --project Back_End/src/TheBha.Api/TheBha.Api.csproj --
   --seed-development` once (see `docs/BE-001-PROPERTY-INVENTORY.md`).
2. `$env:ASPNETCORE_ENVIRONMENT = "Development"; dotnet run --project
   Back_End/src/TheBha.Api/TheBha.Api.csproj` (listens on
   `http://localhost:5145`).
3. `cd Front_End/Customer_Web; npm ci; npm run build; npm start`
   (listens on `http://localhost:3000`).
4. Open `http://localhost:3000/home-2`. Confirm the "Featured properties"
   section shows real seeded Property data (e.g. "The BHA Hotel").
5. Stop the API process; click Retry on the section (or reload the page)
   to observe the inline error state; restart the API and click Retry
   again to confirm recovery without a page reload.
6. Resize to a mobile viewport and confirm the section remains usable;
   confirm the Retry button and any focusable controls are reachable and
   operable by keyboard (Tab + Enter/Space).

## Explicit exclusions

- No RoomType, Availability, CSRF, Hold, Reservation, or authentication UI.
- No native `fetch` in any new integration code.
- No React Query, SWR, Redux, Zustand, Zod, or generated OpenAPI client.
- No Next.js proxy/BFF; the browser calls the API origin directly.
- No debug/demo/API-exploration page.
- No changes under `Back_End/`, no schema/migration change, no CORS or
  auth change.

## Verification evidence

See the FE-001.1 completion report for exact command output, test counts,
lint/build results, and browser verification status.
