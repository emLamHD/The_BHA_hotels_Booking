# Runbook — Customer_Web reservation management page (BHA-CHECKOUT-001-PR09)

`/reservations/{id}/manage` in Customer_Web: the page behind the guest's e-mailed link (PR07) and behind the account owner's receipt button. It uses the PR06 API exactly as documented in `BHA-CHECKOUT-001-reservation-management.md`; **nothing in `Back_End/` changed except the four localization data files** (44 new text keys, see **Texts**). No schema, API, auth or cookie change.

## Who gets in

| Visitor | How | What the page does |
|---|---|---|
| Guest | The link in the confirmation e-mail: `https://<customer-web>/reservations/{id:D}/manage#<secret>` | Reads the secret from the fragment, removes it, sends it **once** to `POST …/manage/exchange`, then reads the reservation with the session cookie. |
| Account owner | The **Quản lý đặt phòng / Manage booking / Gérer la réservation** button on `/paydone`, shown only for a **Direct** reservation, only while the verified customer session is the account that booked it | A clean link (no token). `GET …/manage` with the customer session; no exchange. A Hold receipt, a guest receipt and an unverified or different session get no button. Nothing attaches a guest reservation to an account. |
| Anyone else | — | One generic "this booking can't be opened from this browser or account" text (API 401/403/404 look the same), plus the contact page. |

The reservation id is written once, **lowercase 36-character**, in the exchange, the read and the update (the session cookie's path follows the spelling of the exchange and browsers match cookie paths case-sensitively). An upper-case address in the browser is accepted and canonicalized; an id that is not a GUID asks for nothing.

## The link secret: what the page does and does not do

- The fragment is read once (`parseManageFragment`: exactly 43 base64url characters; anything else that is present is "malformed" and **nothing is sent**), then removed with `history.replaceState(history.state, …)` **and** `router.replace(…)`: the App Router keeps its own copy of the address and would write the secret back on every `router.refresh()` (a language switch). The entry keeps its router state.
- The secret lives only in the controller's memory until it is handed to the one exchange request; it is in no URL, state, storage, console line, thrown error or text. Checked in the browser: no request URL, `Referer`, console line, DOM, `localStorage`/`sessionStorage`, Customer_Web log or API log contained it.
- **One exchange per link-open.** A new no-retry request path (`submitCsrfProtectedRequestOnce` in `lib/api/csrf.ts`) reads a CSRF token (a GET, repeated only for the token) and then sends the POST once. The shared `submitCsrfProtectedRequest` retries once after the exact antiforgery failure; it is not used for the exchange or for the arrival update. A module-level in-flight registry makes a re-mounted page join the exchange instead of sending another, and a read waits for it.
- The exchange starts **automatically** when the page opens (that is the PR06/PR07 contract). Consequence: a mail scanner or preview tool that **executes JavaScript** would spend the link; a plain GET/prefetch of the HTML or RSC payload does not (verified: the link stays unspent). A spent link needs a new one; there is no resend feature in this release.

## What the guest is told

| Case | Text | Request behaviour |
|---|---|---|
| 401 (malformed, unknown, used, expired, another reservation's link) or a malformed fragment | `linkInvalid`: not valid / expired / used; reload if you already opened it here; otherwise contact the property | One POST (none for a malformed fragment); no read; no retry |
| 429 on the exchange, or the antiforgery 400, or the CSRF token unreadable | `linkRateLimited` / `linkNotSent`: **the link was not used up**, open it from the e-mail again shortly | One POST at most; never repeated by the page |
| Network error, 5xx, an unusable 2xx (outcome unknown) | `exchangeUncertain`: reload or press **Try again** to check the current session; if you still can't get in, contact the property | One POST; **Try again only reads** |
| Read: 401 `reservation.manage-session-invalid`, 403, 404 | `noAccess` (generic, never says whether a booking exists; mentions contacting the property if the link was already used) | — |
| Read: 401 `auth.session-invalid` (customer cookie invalid) | "Your session has ended" + sign-in link; one re-read of the customer session; **never treated as a guest**, no loop | — |
| Read: 429 / network / 5xx / unusable body | its own text and **Try again** (a read) | — |

## The view and identity changes

A view belongs to `(reservation id, verified identity)`, where identity is `verifiedOwnerKey(session)` (`guest` / `customer:<id>`). While the session is loading or unknown nothing is requested and nothing private is shown. Any change of reservation or identity clears the data in the same call, aborts the read, and drops late answers (reads and arrival updates alike); the render also refuses state that belongs to another key, so no frame shows the old booking. A response for another reservation id is refused.

## Reservation details and estimated arrival

Shown from the PR06 DTO only: booking number, status, property (name/address from the public catalog), stay dates and nights, guests/rooms, **pay at the property**, total, **collected** and **balance due**. `ledgerState = NotRecorded` shows "Chưa ghi nhận thanh toán" and no amount (nothing inferred). Guest name, e-mail, phone and room/plan ids are not kept.

**Decision to confirm:** for a **cancelled** booking the page shows its status, a cancelled notice, the total and the collected amount, but **not** the "balance due" line or the pay-on-arrival note: the API keeps the folio's balance after a cancellation and presenting it as still payable would mislead. (The PR08 receipt of a cancelled replay is unchanged.)

Estimated arrival: the date list is the check-in day and the next day (UTC arithmetic on the text); the time is `<input type="time" step="60">`, sent as `yyyy-MM-dd` / `HH:mm` — the **property's wall clock**, labelled with `propertyTimeZoneId`; nothing goes through the browser's time zone (checked from a Los Angeles browser). The API decides the window, DST, status and permission. The form is disabled for a cancelled booking.

- Two clicks in the same tick send one request. Never replayed automatically (also not after an antiforgery refusal).
- **Known refusal** (400/409/429): its localized text, the form stays usable; a 409 re-reads the reservation so it locks.
- **Unknown result** (network, 5xx, unusable answer): duplicate submit is disabled and the server is **read first**; "saved" only if it holds exactly what was sent, otherwise "not saved" with an explicit retry; if that read fails too, "check again" (a read) is the only action.
- It changes no price, status, folio, night, unit, outbox event, delivery, inventory control, link or session (SQL snapshot before/after identical).

## Response headers (the page, not the API)

| Header | Value | Where |
|---|---|---|
| `Referrer-Policy` | `no-referrer` | `next.config.js` `headers()` for exactly `/reservations/:reservationId/manage` (+ `<meta name="referrer">`) |
| `X-Robots-Tag` | `noindex, nofollow` | same rule (+ `<meta name="robots">`) |
| `Cache-Control` | `private, no-cache, no-store, max-age=0, must-revalidate` on `next start` | Not configurable for a page: Next replaces a configured value. The page is `export const dynamic = "force-dynamic"`, which is what produces it. The API's own `no-store` on `/manage` is separate. |

## Before enabling the e-mail link in an environment (Owner / operator; production configuration was **not** changed by this PR)

1. Deploy this build at the origin that will be `Booking:ConfirmationEmail:CustomerWebOrigin` (HTTPS only).
2. From outside, with that origin and a real reservation id: `curl -sI https://<origin>/reservations/<guid>/manage` must answer `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` and a `Cache-Control` containing `private` and `no-store`. A CDN, proxy or hosting rule in front must not drop or rewrite them, and must not cache the page.
3. The API must be reachable from the browser over HTTPS (`NEXT_PUBLIC_API_BASE_URL` https, or the same-origin proxy `API_PROXY_ORIGIN`). If Customer_Web and the API are different **sites**, `Authentication:Cookie:SameSite` must be `None` (PR06); with the same-origin proxy the cookie is first-party and `Lax` is enough.
4. API `Cors:AllowedOrigins` includes that origin (credentialed). The exchange limit (`Booking:ReservationManagement:RateLimiting`, default 10 / 60 s per connection address) is per address: an office NAT or a shared proxy address shares one bucket.
5. Click tracking is off at the mail provider (PR07 list) and the mailbox/scanner policy is understood (see the automatic-exchange note above).
6. The three switches of PR07 stay off until 1–5 are done.

## Texts

44 keys, additions only, to exactly `Back_End/src/TheBha.Application/Website/Localization/{catalog.json,packs/vi.json,packs/en.json,packs/fr.json}`: 39 `customer.manage.*` / `customer.meta.manage` / `customer.receipt.manageBooking` plus 5 `shared.apiError.*` for the arrival codes (`validation.arrival-date-invalid`, `…-time-invalid`, `…-out-of-window`, `…-time-nonexistent`, `reservation.arrival-not-changeable`). Existing keys reused where the meaning matches. Same layering as PR08: the built-in pack sits under stored rows, so a database with older installed packs serves the new keys once the new API build runs; no pack refresh is required (the coverage report counts them as missing until the built-in packs are applied again).

## Not in PR09

Resend-link / new-link flow, cancellation or any other change from a management session, no-show or fee policy, deposits/cards/QR, linking a guest reservation to an account, Admin_Web, any Backend code/schema/API/auth/cookie change, a stored locale for the e-mail, a "My bookings" list, real provider sends.
