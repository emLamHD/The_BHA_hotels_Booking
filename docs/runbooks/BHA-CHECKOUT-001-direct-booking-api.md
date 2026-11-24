# Runbook — Direct booking, pay at the property (BHA-CHECKOUT-001-PR05)

`POST /api/v1/reservations` confirms **one** reservation in one step: no Hold, nothing collected now, the whole room charge becomes the balance due at the property. This page is the contract for PR 06 (manage link), PR 07 (e-mail handler) and PR 08 (Customer_Web), plus what an operator needs: the two switches, the lock order, the migration and how to roll back. It is a contract, not a screen guide: no frontend exists yet.

## Request

`POST /api/v1/reservations`, JSON, **HTTPS in production**. Same antiforgery as the other public POSTs (`GET /api/v1/auth/csrf`, header `X-CSRF-TOKEN`).

| Header | Required | Meaning |
|---|---|---|
| `Idempotency-Key` | yes | Opaque, case-sensitive, ≤ 256 UTF-8 bytes (the Hold rule). Raw value never stored. |
| `X-Booking-Access-Token` | guest only | A token **the client generated**: 32 random bytes from a CSPRNG, base64url **without padding** (43 characters). Kept together with the key before the first request and resent on every retry. Only its SHA-256 is stored; the server never issues, returns or logs it. **Refused with a customer session** (`400 validation.access-token-with-session`). |
| `X-CSRF-TOKEN` | yes | From `GET /api/v1/auth/csrf`. |

Body (exactly these fields; **any other property is `400 request.invalid`**, so nothing can set a deposit, a fee or an amount to collect): `propertyId`, `roomTypeId`, `ratePlanId`, `checkIn`, `checkOut`, `adults`, `children`, `rooms`, `fullName`, `email`, `phone`, `expectedTotalAmount`, `expectedCurrencyCode`, `paymentMethod`.

- One RoomType and RatePlan per request; `rooms` of them. Field limits and normalization are the Hold's.
- `expectedTotalAmount` + `expectedCurrencyCode` are **required**: the price the guest saw and confirmed, not an amount the server trusts. A different current price is `409 reservation.price-changed` with the new `quote` (same shape as `hold.price-changed`), and nothing is written.
- `paymentMethod` must be `PayAtProperty` (any other value or none: `400 validation.payment-method-invalid`). Collected at booking is always 0.
- Only a price the folio can write is bookable: VND, whole đồng, positive, within `numeric(18,2)`. Anything else is `409 reservation.amount-unsupported` (never converted, never rounded); checked **before** the price comparison so a quote that could never be booked is not offered.

## Owner

| Caller | Owner of the reservation | Notes |
|---|---|---|
| Valid customer session cookie | that `CustomerAccountId` | No token allowed. |
| Session cookie that does not validate | — | `401 auth.session-invalid`; **never** treated as a guest. |
| No cookie | the guest holding the token | Missing or malformed token: `401 booking.credential-invalid`. |

If the guest loses the token (and the key), PR 05 cannot give access back to that reservation: no token is reissued. A support flow for that is separate scope. **PR 08:** keep `{ idempotencyKey, token }` before the first request, and retry the *whole* request unchanged (same owner mode, token, key and body) after a timeout or a lost answer.

## Answer

| Status | Meaning |
|---|---|
| `201` | Created. `Location: /api/v1/reservations/{id}`. Body = the existing reservation answer **plus** `paymentMethod` (`PayAtProperty`), `ledgerState` (`Recorded`), `receivableAmount`, `collectedAmount` (**0**), `balanceDueAmount` (= receivable). Nothing secret (no token, hash or request hash). |
| `200` | Replay: the reservation this key, owner and body already produced, same shape. Its status and balance are **current** (a cancelled reservation reads `Cancelled`, never `Confirmed` again); its price is the stored snapshot. |
| `400` | `validation.*` (field rules), `validation.expected-price-invalid`, `validation.payment-method-invalid`, `validation.access-token-with-session`, `validation.idempotency-key-*`, `auth.csrf-invalid`, `request.invalid` (malformed JSON or an unknown field). |
| `401` | `auth.session-invalid`, `booking.credential-invalid`. |
| `404` | `booking.selection-not-found` (property, room type or rate plan missing or inactive). |
| `409` | `reservation.price-changed` (+ `quote`), `reservation.rooms-unavailable`, `reservation.pricing-unavailable`, `reservation.pricing-out-of-range`, `reservation.amount-unsupported`, `reservation.offer-not-bookable`, `reservation.idempotency-conflict`, `checkout.direct-unavailable`. |
| `429` | `booking.rate-limited` — before anything is written. |
| `503` | `booking.closed`. |

Read and cancel are the existing routes, unchanged (`GET /api/v1/reservations/{id}`, `POST /api/v1/reservations/{id}/cancel`), with the same owner (token header or session). Their answer has **no** Direct-only fields.

## Idempotency and replay

- Scope = **Property + verified owner** (`customer:{id}` or `guest:{tokenHash}`), hashed: `direct:v1:{propertyId}:{owner}`. Two guests with different tokens, or an account and a guest, never share keys; the same key under another owner or Property is another request and never returns the first result.
- Table `ReservationCreationRequests`: primary key `(ScopeHash, KeyHash)`, `RequestFingerprint`, FK `(PropertyId, ReservationId)` → `Reservations(PropertyId, Id)` (Restrict), unique `ReservationId`. Only hashes; a row is written in the **same transaction** as its reservation and **never deleted** (a retry hours later must still find it).
- Fingerprint (`thebha-direct-reservation-request:v1`, length-prefixed fields): property, room type, rate plan, dates, adults, children, rooms, name, e-mail, phone, owner, expected total and currency, payment method. Same key + same fingerprint → `200`; same key + different fingerprint → `409 reservation.idempotency-conflict`.
- A replay is answered **before** the switches, the pricing and the stock are looked at, after re-reading the reservation and re-checking Property, source and owner on it. It reprices nothing, takes no lock on inventory, and writes no charge, event or Calendar row. So it still works after the price changed, the room sold out, either switch turned off, or the reservation was cancelled.

## Switches (application settings, frozen at start-up, no screen)

| Setting | Default | Effect |
|---|---|---|
| `Booking:DirectCheckout:PropertyIds` | empty = Direct **off everywhere** | Properties that may be booked directly. Others: `409 checkout.direct-unavailable`. Validated at start-up (non-empty GUIDs, no duplicates) or the host does not start. Pilot: Riverside only (`a1000000-0000-0000-0000-000000000001`); **not** set in any committed settings file. |
| `Booking:AcceptingNewReservations` | `true` | `false` refuses every **new** Hold (`POST /api/v1/booking-holds`) and every **new** Direct reservation with `503 booking.closed`. |
| `Booking:DirectCheckout:RateLimiting:PermitLimit` / `WindowSeconds` | 10 / 60 | Per client address, only on `POST /api/v1/reservations`. The address is the connection's (forwarded headers count only from the trusted proxy configured for the host); never a header, e-mail or token the client states. Must be positive. |

Neither switch stops: reading, cancelling, a replay of something committed, or **confirming a Hold that is already Active**. Turning Direct off does not turn Holds off. Neither overrides a stop-sell: stop-sell lives in the daily inventory both flows read, so a closed night is closed for both.

## One transaction, one lock order

READ COMMITTED, one `SaveChanges`-flushed transaction; any failure (including a folio or outbox status other than success) rolls **everything** back and no hint is sent:

1. Direct idempotency advisory key (class 1, `ForDirectIdempotency(scope, key)`; its own namespace).
2. Replay lookup (the exit above). Then the two switches.
3. RoomType scope lock, then the per-night inventory locks, sorted (`BookingOfferEvaluator.BuildLockPlan`: **the same plan the Hold takes**).
4. Under those locks, the one shared `BookingOfferEvaluator` (the Hold's availability, stop-sell, blocks, sellable limit, committed + Active Hold demand, and `PromotionPricing`): no second formula.
5. Folio-writability and expected-price checks; `Reservation.CreateDirect` (units, nights, promotion snapshot) + the idempotency row; `SaveChanges`.
6. `IFolioPosting`: one `RoomCharge`, `PostingKey = charge:initial`, `System` actor, `OccurredAtUtc = ConfirmedAtUtc`, amount = the confirmed total. **No Payment.** The folio lock is a leaf: taken after every booking lock, never before one.
7. One `ReservationConfirmed` outbox event (below).
8. One Calendar event per **unit** (last statement: it takes the Calendar stream's counter row until COMMIT).
9. COMMIT, then the best-effort Calendar hint.

No provider is called and no Staff lookup is made inside the transaction. A Hold confirmation is unchanged: it still writes no charge and no event.

## Events

- **Calendar:** action `Created`, kind `reservation-unit`, key = the `ReservationUnitId`, actor `Public` (no Staff id), title `Reservation {checkIn} to {checkOut}` (dates only: no guest, confirmation number or amount).
- **E-mail outbox (for PR 07):** event type `ReservationConfirmed`, **schema version 1**, one per reservation, `PropertyId` in the envelope, payload `{"reservationId":"<guid>"}` and nothing else. `EventId` = first 16 bytes of SHA-256(`thebha:email-outbox:event:v1:ReservationConfirmed:{reservationId:D}`) with UUID-v5 version and variant bits (`BookingEmailEvents.EventId`); it is not the reservation id, so another event type about the same reservation gets another id by the same rule. Until PR 07 registers a handler for the pair the event stays `Pending`, is never claimed and costs no attempt. The handler reads the guest address and the amounts from the database itself.

## Migration and rollback

Migration `AddDirectReservationCreationRequests` only adds the table; nothing is read, backfilled or changed, and no folio line or event is invented for older reservations. Deploy it before turning Direct on (the PR01 floor still applies: a binary older than `AddDirectReservationSource` cannot load a `Direct` row).

`Down` locks the table (`ACCESS EXCLUSIVE ... NOWAIT`) and **refuses while any row exists**: dropping them would let a late retry create a second reservation. To go back: set `Booking:AcceptingNewReservations=false` (or remove the Property from `PropertyIds`), let in-flight requests finish, and only then decide deliberately what to do with the rows. Rolling the application back below this release is safe for existing data; the rows simply stop being consulted.

## Not in this release

eta/early/late check-in, cancellation policy or fees, e-mail handler/template/worker, Staff router, card/QR/deposit/online payment, any frontend, the manage-by-link read API (PR 06), the Customer_Web CTA (PR 08), a way to recover a lost guest token.
