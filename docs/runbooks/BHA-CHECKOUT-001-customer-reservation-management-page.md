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

**Decided (Owner/OC, PR09-C1):** for a **cancelled** booking the page shows its status, a cancelled notice, the total and the collected amount (when the folio is `Recorded`), but **not** the "balance due" line or the pay-at-property note. PR06 returns `balanceDueAmount` from the folio, and the folio does not post anything on cancellation, so a cancelled booking keeps its original positive balance in the API (shown by a real cancelled Direct booking: `Cancelled`, `Recorded`, total 2,000,000, collected 0, balance 2,000,000). Neither that balance nor a "0 ₫" would be a true statement of what is owed after a cancellation; that is the property's to say. Acceptance criterion for PR09 accordingly: the brief's "show the remaining amount" applies to **non-cancelled** bookings. Locked by `lib/reservationManagementMoney.test.ts`: Cancelled + Recorded (balance > 0) hides the balance line and the note in vi/en/fr; Confirmed + Recorded shows exactly the API balance; `NotRecorded` shows "Chưa ghi nhận thanh toán" and infers neither a collected nor a remaining amount (Confirmed and Cancelled). (The PR08 receipt of a cancelled replay is unchanged.)

Estimated arrival: the date list is the check-in day and the next day (UTC arithmetic on the text); the time is `<input type="time" step="60">`, sent as `yyyy-MM-dd` / `HH:mm` — the **property's wall clock**, labelled with `propertyTimeZoneId`; nothing goes through the browser's time zone (checked from a Los Angeles browser). The API decides the window, DST, status and permission. The form is disabled for a cancelled booking.

- Two clicks in the same tick send one request. Never replayed automatically (also not after an antiforgery refusal).
- **Known refusal** (400/429): its localized text, the form stays usable. A **409** (PR09-C2) shuts the form in the controller **and** the UI *before* the re-read starts, keeps the refusal text, and sends no second POST while the read is out. The read then decides: a still-editable booking opens the form again (refusal text kept); `Cancelled` stays shut by its status; a temporary read failure keeps writing shut and offers "Check again" (a read only); losing access clears the private view. A read that returns after the reservation or identity changed is dropped and neither opens nor shuts the new view's form.
- **Unknown result** (network, 5xx, unusable answer; PR09-C2, rule changed by PR09-C3): the server is **read first** and the read only refreshes the arrival shown. A read can never prove the earlier POST finished (the same value may have been stored before the request, and the lost POST may still be on its way), so it **never** says "saved" and never opens the form, whether it matches the submitted value or not. The state is always *not confirmed*: the submit lock holds for the rest of this view, the text says the earlier request may still be applied, and "Check again" (a GET, never a POST) is the only action. A valid POST response still says "saved". The state "not saved" no longer exists.
- **Token could not be read** (`CsrfTokenUnavailableError`, PR09-C3): the POST never reached the transport, so nothing can be applied later. The page shows `customer.manage.eta.error.notSent` (vi/en/fr: not sent, nothing changed, press Save again), releases the lock, keeps the entered values, does **not** read to verify and does not resend; the visitor's own next Save sends one POST. Network errors after dispatch, 5xx, unusable answers, 400 antiforgery and 409 keep their own handling above.
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
4. API `Cors:AllowedOrigins` includes that origin (credentialed). The exchange limit (`Booking:ReservationManagement:RateLimiting`, default 10 / 60 s per connection address) is per address: an office NAT or a shared proxy address shares one bucket. **With the same-origin proxy every guest's exchange reaches the API from the Next server's address**: unless that address is the configured trusted proxy (forwarded headers, `TrustedProxy` settings), all guests share one bucket of 10 exchanges per 60 s and the 429 text appears under moderate load. Configure that before enabling the proxy for this page (a real 429 through the proxy, from the Next server's single address, was verified in PR09-C1: the page shows the "link not used up" text after one exchange POST; the shared-bucket effect for many guests is not load-tested).
5. Click tracking is off at the mail provider (PR07 list) and the mailbox/scanner policy is understood (see the automatic-exchange note above).
6. The three switches of PR07 stay off until 1–5 are done.

## Texts

44 keys, additions only (44 before PR09-C2; PR09-C2 dropped `customer.manage.eta.notSaved` together with the "not saved" state and reworded `customer.manage.eta.unverified` in vi/en/fr, giving 43; PR09-C3 added `customer.manage.eta.error.notSent`, giving 44 again), to exactly `Back_End/src/TheBha.Application/Website/Localization/{catalog.json,packs/vi.json,packs/en.json,packs/fr.json}`: 39 `customer.manage.*` / `customer.meta.manage` / `customer.receipt.manageBooking` plus 5 `shared.apiError.*` for the arrival codes (`validation.arrival-date-invalid`, `…-time-invalid`, `…-out-of-window`, `…-time-nonexistent`, `reservation.arrival-not-changeable`). Existing keys reused where the meaning matches. Same layering as PR08: the built-in pack sits under stored rows, so a database with older installed packs serves the new keys once the new API build runs; no pack refresh is required (the coverage report counts them as missing until the built-in packs are applied again). A database whose installed pack already holds the older `customer.manage.eta.unverified` text keeps serving it until the built-in packs are applied again (stored rows win); the old wording ("saved or not, press Check again before saving once more") is not wrong for the failed-read case but does not mention that the request may still be applied. An already stored `notSaved` row is simply never read.

## Known limitations

- A guest who opens the **same e-mail link a second time** in a browser that already holds the session sees the "link is not valid / already used — reload to check" text first; **reload** (the fragment is already gone) then shows the booking. The page does not try a read after a 401 exchange.
- The automatic exchange can be spent by a mail scanner that runs JavaScript.
- The submit lock lives in the page's controller: **reloading** the page during an unknown update result starts a fresh view that can submit again (the read on load shows what the server holds then; a lost POST that is still on its way can still be applied afterwards, and reload cannot tell). The PR09-C2/C3 guarantee is "no automatic or in-view replay", not a server-side idempotency key (the API has none for this endpoint; changing that is a contract change, out of scope).
- A change of reservation id while a request is in flight is covered by unit tests only (the browser covers logout and an account change in flight).
- Daylight-saving behaviour is the API's (PR06 tests); not exercised in the browser (Asia/Ho_Chi_Minh has none).
- `Cache-Control` is Next's dynamic-page value, not the literal `private, no-store`.

## Not in PR09

Resend-link / new-link flow, cancellation or any other change from a management session, no-show or fee policy, deposits/cards/QR, linking a guest reservation to an account, Admin_Web, any Backend code/schema/API/auth/cookie change, a stored locale for the e-mail, a "My bookings" list, real provider sends.

## PR09-C2 — the two P2 findings of the Codex review of PR #166

Fixed in `lib/reservationManagement.ts`, `manage/ManageReservation.tsx` and two texts in the localization data (behaviour above). Regressions use deferred promises, no sleeps: `lib/reservationManagement.test.ts` (controller; the lost-answer test and a 409 `describe` block) and `lib/reservationManagementArrivalForm.test.ts` (what the form locks and offers per save state, vi/en/fr texts).

- **P2-1** (lost POST, a read that shows the old value was reported as "not saved" and re-enabled the form): red before — the old "not saved + explicit retry" test asserted exactly that and was replaced; after — a first read with the old value, a read with no arrival and a read with another value all stay *not confirmed* with one POST in total; only a read that shows the submitted date and time says "saved" (one POST).
- **P2-2** (a 409 re-read ran with the form open, so a second submit could succeed and the late read then overwrote its result): the behaviour-only test `P2-2 (behaviour only)` (409, re-read held on a deferred, second Save, then the read answers last) was run against the pre-fix controller (`git show HEAD~1:…/reservationManagement.ts`) and failed both ways — `expected null to be '22:00'` (the late read replaced the accepted save) and `expected "spy" to be called 1 times, but got 2 times` (a second POST went out while the read was held) — and passes on the fix. The other new 409 tests (Cancelled / temporary read failure / still editable / lost access / identity change while waiting) assert the new `conflict` state and so fail on the old controller by construction; they are behaviour locks for the fix, not independent red evidence.

## PR09-C3 — the two P2 findings of the Codex review of C2 on PR #166

Fixed in `lib/reservationManagement.ts` (controller) plus one text key (`customer.manage.eta.error.notSent`) in the localization data. No API, schema, CSRF-helper or backend-logic change.

- **P2-1** (the stored arrival already equals the submitted one; a matching read after a lost POST was reported as "saved" and unlocked the form, so a later update could be overwritten by the delayed first POST): red before — the new tests run against the `5255ac6` controller (`git show 5255ac6:…/reservationManagement.ts`): the `PR09-C3 P2-1` tests (stored arrival equal to the submitted one; first read differs, a later read matches) and the rewritten lost-answer tests failed with `expected { status: 'saved' } to deeply equal { status: 'unverified' }`; after — every verifying read ends *not confirmed*, one POST in total, a different later Save sends nothing. This replaces the C2 rule "a read that equals the submitted value says saved". Limit: the lock is per view; after a reload it is gone (see Known limitations); no server-side idempotency (a contract change, out of scope).
- **P2-2** (token unavailable was treated as an unknown update, which locked the form): red before (same controller) — `expected { status: 'unverified' } to deeply equal { status: 'error', …(1) }` in both `lib/reservationManagement.test.ts` (controller) and `lib/reservationManagementArrivalTransport.test.ts` (real service + real CSRF helper, only the HTTP client replaced); after — token failure sends 0 POSTs and 0 verifying GETs, the form is open with the input kept, and the next Save (token read) sends exactly one POST. The C1 (cancelled booking) and C2 (form shut during the re-read after a 409) tests are unchanged and pass.
