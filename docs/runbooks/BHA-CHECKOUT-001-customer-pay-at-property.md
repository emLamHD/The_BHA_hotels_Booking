# Runbook — Customer_Web, pay at the property (BHA-CHECKOUT-001-PR08)

Customer_Web calls `POST /api/v1/reservations` (contract: `BHA-CHECKOUT-001-direct-booking-api.md`). Nothing in `Back_End/` changed except four localization data files (see **Texts**). This page is what an operator needs to switch it on and what PR09 (management UI) can rely on.

## The two switches (both default off, neither is set in any committed file)

| Switch | Where | Effect when the property is not listed |
|---|---|---|
| `NEXT_PUBLIC_DIRECT_BOOKING_PROPERTY_IDS` | Customer_Web **build** env, comma-separated property GUIDs. Unset/blank/any malformed entry = off everywhere. | The offer button keeps its Hold label and the Hold flow runs exactly as before. |
| `Booking:DirectCheckout:PropertyIds` | API setting (runbook above) | `409 checkout.direct-unavailable`: the form shows it and keeps the guest's input. |

Turn both on for the pilot property only (Riverside `a1000000-0000-0000-0000-000000000001`). The web value is baked at build time: changing it needs a rebuild. The API still decides eligibility, price and stock; the web switch only decides whether the choice is offered. A Direct refusal never becomes a Hold.

## What the guest sees

1. Offer card button **Đặt phòng / Book / Réserver** (pilot property only) opens a dialog: **Thanh toán khi nhận phòng** (enabled) and **Thanh toán hoặc đặt cọc** (visible, `aria-disabled`, "not available yet"). Two columns from `md`, stacked below. Headless UI supplies the focus trap, Esc and focus return; after choosing, focus moves to the form heading.
2. A confirmation form: price just confirmed, "you pay nothing now", who the booking is for (account e-mail / guest), name, e-mail, phone.
3. `/paydone` receipt (the existing page): returned number, status, property, dates, total, **collected** and **balance due**; a replay of a cancelled reservation shows the returned status and a "cancelled" title. No e-mail claim and no link to a management page (PR09).

## Rules the code enforces (tests: `directBookingFlowController.test.ts`)

- **Owner**: signed-in account → session cookie only, no token; confirmed guest → a fresh 32-byte base64url token (Web Crypto) and a key, generated before the first send. Session `loading`/`unknown`, an identity change under way, or an owner different from the one the form opened with → nothing is sent, the session is re-read, the guest is told. A guest is never inferred from a failed session read.
- **One request**: the whole flow is locked synchronously; a double click/Enter sends once.
- **Uncertain result** (network error, 5xx other than `booking.closed`, unusable 2xx body): the attempt (owner, token, key, body) stays in tab memory and **only an exact resend** is offered, and only while the session is still that owner. A rejected retry (e.g. 429) shows its message but the first attempt stays unresolved. Only a 2xx resolves it (`200` replay: same reservation number).
- **Reload**: before the first send a flag `bha.direct-booking.unresolved=1` is written to `sessionStorage` (nothing else is ever stored: no body, PII, token or key). It is cleared on a 2xx or on a rejection of an attempt that never went uncertain. After a reload the flag shows "cannot be verified, contact the property"; a new booking needs the guest to acknowledge it first. No booking is created or resent by a reload.
- **Known refusals keep the form**: `reservation.price-changed` + quote → shows the new price and needs an explicit confirmation, then a new key and the new expected price; `reservation.rooms-unavailable`, `reservation.pricing-*`, `reservation.amount-unsupported`, `reservation.offer-not-bookable`, `checkout.direct-unavailable`, `booking.closed`, `booking.rate-limited` (429), `reservation.idempotency-conflict` have their own text.
- After a success the token, key and contact are dropped from memory; the receipt is shown only while the verified session is the owner that booked.

## Texts (the one Back_End exception)

All Customer_Web texts are served by `/api/v1/website/dictionary` from `Back_End/src/TheBha.Application/Website/Localization/`. PR08 adds **44 keys** (additions only, no existing key changed, pack versions not bumped) to exactly `catalog.json` and `packs/{vi,en,fr}.json`. The dictionary layers the **built-in pack under the stored rows**, so a database that already holds the older installed packs returns the new keys as soon as the new API build runs: **no pack refresh is required**. Until the Admin re-applies the built-in packs (Admin → language packs → apply, mode keep-manual) the coverage report lists those 44 keys as "missing" (they are not stored); applying stores them and changes nothing visible.

## Not in PR08

PR09 management page and links, deposits/QR/card payments, fees, reservation-hold policy, any backend, schema, auth or API change. The management link for a guest-owned Direct reservation arrives by e-mail (PR07); the browser token of this page is never kept after the receipt and never shown.
