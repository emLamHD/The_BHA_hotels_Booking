# Runbook — Guest reservation management link, session and estimated arrival (BHA-CHECKOUT-001-PR06)

A guest who booked **directly** (`POST /api/v1/reservations`, no account) can be given a link that opens a private management page for that one reservation. PR 06 is the backend of it: an internal way to issue the link (for the e-mail work item, PR 07), one route that turns the link into a 24-hour session, one private read and one estimated-arrival update. This page is the contract for PR 07 (the e-mail that carries the link), PR 09 (the management page) and the operator. No e-mail, template, worker or screen exists in this release.

## The flow

1. **Issue (internal, PR 07).** Inside its own transaction, the mail handler calls `IReservationManagementLinkIssuer.IssueAsync(propertyId, reservationId, ttl?)`. The result carries the raw secret **once**; only its hash is stored.
2. **Deliver (PR 07).** The mail contains a URL with the secret in the **fragment**: `https://<customer-web>/…#<secret>`.
3. **Exchange (PR 09).** The page reads the secret from the fragment, removes it from the address bar (`history.replaceState`), and sends it in the **body** of `POST /api/v1/reservations/{id}/manage/exchange`. The link is consumed and a session cookie is set.
4. **Manage (PR 09).** `GET /api/v1/reservations/{id}/manage` and `POST /api/v1/reservations/{id}/manage/estimated-arrival`, with the cookie.

A GET never consumes a link; there is no GET that accepts a secret.

## Issuance (internal only)

`IReservationManagementLinkIssuer` is an Application interface; **no HTTP route issues, searches for or resends a link.**

| Rule | Detail |
|---|---|
| Who gets a link | Only a **guest-owned Direct** reservation of exactly that `propertyId` (`Source = Direct`, `CustomerAccountId` null). An account-owned, Hold-sourced, other-Property or unknown reservation answers `NotEligible` and writes nothing. |
| Secret | 32 bytes from a CSPRNG, base64url without padding (43 characters, the shape of the guest booking token). Hashed as SHA-256 over `thebha:reservation-management:link:v1:` + secret; the secret is never stored, logged or returned by any route. The result type hides it from `ToString()`. |
| Lifetime | `ttl` omitted = **72 hours**; must be positive and at most 30 days (else `ArgumentOutOfRangeException`). Instants come from `TimeProvider` and are cut to whole microseconds (what PostgreSQL keeps). A link is usable **strictly before** its `ExpiresAtUtc`: at exactly that instant it is expired. |
| Transaction | The caller **must** hold an explicit READ COMMITTED transaction on the same `TheBhaDbContext`; without one the call throws. The link row joins it: the issuer never commits, rolls back or disposes it, and a rolled-back caller leaves no link. So the secret can only be committed together with whatever the caller stores to deliver it (the outbox row). It calls `SaveChanges`, which also flushes anything else the caller has pending. |
| More than one | Each call makes a new link. Earlier links stay valid until they expire or are used. Nothing revokes them. |
| Not done | Not at Direct creation (PR 05 is unchanged), nothing is sent, no outbox event is written by issuing. |

## Exchange

`POST /api/v1/reservations/{reservationId}/manage/exchange`, JSON `{ "token": "<secret>" }` (any other property is `400 request.invalid`). Same antiforgery (`GET /api/v1/auth/csrf`, header `X-CSRF-TOKEN`), CORS (`customer-web` policy: credentialed, configured origins only) and HTTPS handling as the other public POSTs. The customer session is not read here.

- **One transaction.** A single `UPDATE … WHERE TokenHash = @h AND ReservationId = @id AND ConsumedAtUtc IS NULL AND ExpiresAtUtc > @now` decides the winner; the session row is inserted in the same transaction. Concurrent requests: exactly one `200`, the rest `401` (the second waits for the first row lock, re-evaluates, and finds the link used). A failure after the `UPDATE` rolls the consumption back: no session, and the link works again.
- **Answer `200`:** `{ "reservationId", "expiresAtUtc" }` only. The session secret is only in the cookie.
- **Answer `401 reservation.manage-link-invalid`**, one body for: missing, malformed, unknown, expired, already used, a link of another reservation, a reservation that does not exist. A wrong-reservation attempt does not consume the link.
- **Answer `429 booking.rate-limited`** before anything is read (the exchange route's own limit, per connection address; see Settings). **`400 auth.csrf-invalid`** before the action; neither spends the link.
- `Cache-Control: no-store` on every answer of the `/manage` resource, refusals included.

### The cookie

| Attribute | Value |
|---|---|
| Name | `.TheBha.ReservationManagement` (value = the session secret, 43 characters; SHA-256 over `thebha:reservation-management:session:v1:` + secret is stored) |
| Scope | **Host-only** (no `Domain`), `Path=/api/v1/reservations/{id}/manage` with the **lower-case** GUID (cookie paths are case-sensitive: a client must request exactly that spelling for the browser to send it), so it is never sent to another reservation, to `exchange`'s siblings of other reservations, or to any other route |
| Flags | `HttpOnly`, `Secure` (always, even in Development: over plain http a browser or `HttpClient` drops it), `SameSite` = `Authentication:Cookie:SameSite` (the topology the customer and antiforgery cookies use) |
| Lifetime | `Expires` and `Max-Age` = 24 hours from the exchange (the session row says the same instant; the server never trusts the cookie's own expiry, only the row) |

If Customer_Web and the API are different **sites**, the existing `Authentication:Cookie:SameSite` must be `None` for the browser to send this cookie on a cross-site `fetch(…, { credentials: "include" })`; that is a deployment setting shared with the customer session, not changed here.

## Private read and arrival update

- `GET /api/v1/reservations/{id}/manage` → `ReservationManagementDto`.
- `POST /api/v1/reservations/{id}/manage/estimated-arrival` (antiforgery required), body `{ "arrivalDate": "yyyy-MM-dd", "arrivalTime": "HH:mm" }` (other properties: `400 request.invalid`) → the updated `ReservationManagementDto`.

**Who may call (OR, never a fallback).** The signed-in customer who is exactly the reservation's `CustomerAccountId`, **or** a guest holding a live session of that exact reservation and Property. A `.TheBha.Customer` cookie that does not validate is `401 auth.session-invalid` and is never treated as a guest (same rule as the other private reservation routes). Nothing attaches a guest reservation to an account, and no route crosses Properties.

| Caller | Result |
|---|---|
| Valid owner session / valid guest session of this reservation | `200` |
| Signed-in account that does not own it (or the reservation is absent) | `404 reservation.not-found` |
| Guest with no, malformed, unknown, expired or other-reservation session | `401 reservation.manage-session-invalid` (one body; it does not say whether the reservation exists) |
| Invalid customer cookie | `401 auth.session-invalid` |

**Interpretation to confirm:** the management resource serves **Direct reservations only**, for the owner account too. A Hold-sourced reservation answers `404` here (its cancellation lock is the Hold's, not the reservation transition lock this resource must take; the existing `GET /api/v1/reservations/{id}` is unchanged and still serves it).

`ReservationManagementDto` (its own shape; `ReservationDto` is unchanged): the reservation as the guest booked it (`reservationId`, `confirmationNumber`, `status`, `propertyId`, `roomTypeId`, `ratePlanId`, `fullName`, dates, occupancy, `rooms`, `currencyCode`, prices, nights, promotion, cancellation fields), `paymentMethod` (`PayAtProperty`), the folio balance from `IFolioReader` (`ledgerState`, `receivableAmount`, `collectedAmount`, `balanceDueAmount`; `NotRecorded` means no amount), `propertyTimeZoneId`, and `estimatedArrival` (`null` or `{ arrivalDate, arrivalTime, timeZoneId, updatedAtUtc }`). **No e-mail address, phone number, token, hash or customer id.** It offers no cancel action and the session cannot cancel (PR 09 or later).

## Estimated arrival

Informational only: it never changes a hold, status, inventory, price, fee, cancellation or no-show rule, folio, Calendar row or outbox event.

- `arrivalDate` is exactly `yyyy-MM-dd` and `arrivalTime` exactly `HH:mm` (24 h, whole minutes). Anything else (`9:30`, `21:30:00`, `21:30+07:00`, `…T…Z`, `24:00`) is `400` (`validation.arrival-date-invalid` / `validation.arrival-time-invalid`). They are the **Property's wall clock**: no offset is accepted, nothing is converted through the server's zone, and nothing is stored as an instant, so there is no offset to guess across a daylight-saving change.
- The date must be the **check-in date or the next day** (overnight arrivals): else `400 validation.arrival-out-of-window`. A wall time that does not exist in the Property's zone (the skipped hour when clocks go forward) is `400 validation.arrival-time-nonexistent`; one that occurs twice (clocks go back) is kept as stated. No "in the past" rule is applied.
- Stored in `ReservationArrivalEstimates` (one row per reservation, replaced by each update): date, time, the Property's `TimeZone` id **copied at write time**, `UpdatedAtUtc`.
- A **cancelled** reservation answers `409 reservation.arrival-not-changeable` (it can still be read).
- **Serialization against cancellation.** After authorizing, the update takes `BookingAdvisoryLockKeys.ForReservationTransition(reservationId)` (the lock a Direct cancellation takes), then re-reads authorization and `Status` under it and writes in the same transaction. A caller with no valid access is refused **before** the lock, so only an authorized caller can make a request wait. An update and a cancellation never interleave: whichever takes the lock second sees the other's result.

## Settings

| Setting | Default | Effect |
|---|---|---|
| `Booking:ReservationManagement:RateLimiting:PermitLimit` / `WindowSeconds` | 10 / 60 | Per connection address (forwarded headers only from the configured trusted proxy), only on the exchange route; the host does not start unless both are positive. The 429 is `booking.rate-limited` (the `/api/v1/reservations` prefix wording), `no-store`. |
| `Authentication:Cookie:SameSite` | `Lax` | Shared with the customer and antiforgery cookies. |

Link lifetime (72 h, `ttl` argument) and session lifetime (24 h) are constants in `ReservationManagementRules`, not settings.

## Migration and rollback

Migration `AddReservationManagementAccess` only adds three tables, **empty on deploy**, nothing read or backfilled: `ReservationManagementLinks` (hash, expiry, `ConsumedAtUtc`; unique `TokenHash`), `ReservationManagementSessions` (hash, expiry; unique `SessionHash` and unique `LinkId`, so one link makes one session) and `ReservationArrivalEstimates`. All three reference `Reservations(PropertyId, Id)` (Restrict), so a row can only name a reservation of its own Property.

`Down` locks the three tables (`ACCESS EXCLUSIVE … NOWAIT`) and **refuses while any row exists in any of them**: a link or session is a guest's access, and an estimate is something the guest said; dropping them would destroy it silently. Stop issuing links, let sessions expire, and clear the rows deliberately before going back. Rolling the application back below this release is safe for existing data; the rows simply stop being consulted.

## Handoff

**PR 07 (e-mail).** Issue inside the transaction that writes the delivery; put the secret in the URL fragment only (never the path or query: they reach logs, proxies and `Referer`); send the page `Referrer-Policy: no-referrer`; never log, store in the outbox payload or render the secret anywhere except the one mail body. The outbox event contract is unchanged (`ReservationConfirmed` payload is `{"reservationId"}`); the handler decides when to issue (this release does not issue at creation).

**PR 09 (page).** Read the fragment, call `exchange` once with `credentials: "include"`, clear the fragment, then use `GET /manage` and the arrival update with the cookie and a CSRF token. Treat any `401` on `/manage` as "this session ended" and ask for a new link; the page must not retry an `exchange` with the same secret.

**Known limitation — a lost exchange response.** If the exchange commits but the response never reaches the browser, the link is spent and the session secret was never stored in a recoverable form: nothing can reissue that session or revive that link. The guest needs a **new link** (a resend flow does not exist in this release). The same holds when a link expires unused.

## Not in this release

Resend/search/public issuance routes, a way to cancel or change a reservation from a management session, attaching a guest reservation to an account, management of a Hold-sourced reservation, session revocation or logout (a session ends only at its expiry), revoking older links when a new one is issued, e-mail handler/template/worker, any screen, a setting for the two lifetimes.
