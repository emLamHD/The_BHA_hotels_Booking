# BHA-BOOKING-PROMOTIONS-001 — Booking promotions

- Work item: `BHA-BOOKING-PROMOTIONS-001` (implementer Claude, reviewer Codex read-only, invoked by Owner only).
- Branch: `feature/bha-booking-promotions-001`, from `develop` `65135cea4126f6d3188fc13d928cc62ca8301ec4` (re-verified equal to `origin/develop` before branching).
- Status: implemented on this branch (Draft PR into `develop`); evidence in `docs/reports/BHA-BOOKING-PROMOTIONS-001-completion.md`.
- Supersedes the `DEFERRED` line "Promotion/coupon/discount" in `docs/project/PROJECT_BIBLE.md`: this work item is that Epic.

## 1. Scope

One `Promotion` entity serves two jobs, so nothing is entered twice:

1. **Pricing rule.** An automatic discount the backend applies in availability quotes, holds and confirmation.
2. **Marketing content.** Title, summary, body and conditions, cover image, homepage visibility, order and a display window, shown in the homepage "Ưu đãi" block and on `/offers`.

No voucher code. No stacking. No tax, fee or add-on discounts. Out of scope: payment, OTA, inventory and assignment behavior, customer authentication.

## 2. Owner decisions (2026-10-21)

D1–D16 were approved as proposed in the two P0 reports, with the four mandatory adjustments marked **(adj)**.

| # | Decision |
|---|---|
| D1 | New per-Property permission `StaffPermission.PromotionManage`, granted to `Manager` only. FrontDesk has no access. The routes are closed (404) in `LocalGate` mode. See ADR 0009. |
| D2 | A fixed discount is per room per night, in the rate plan's currency (VND). It applies only to an offer in that same currency. |
| D3 **(adj)** | Percent is `0 < p < 100` with at most 2 decimals. No free booking in this release. A fixed amount is `> 0`. A discount may never take an eligible night's final price below the smallest valid amount (1 VND, or 0.01 for a 2-decimal currency). Rounding is per night per room, half away from zero, to whole đồng (VND) or 2 decimals (others); the rule is fixed in code and does not read `WebsiteCurrencies.MinorUnits`, which is editable display configuration. Validation and Customer copy state exactly this rule. |
| D4 | A booking with only some nights inside the promotion's stay window gets the discount on those nights only. Minimum nights is counted on all nights of the booking. At least one eligible night is required. |
| D5 | Booking window, stay window and display window are `DateOnly`, inclusive at both ends, evaluated in the Property's `TimeZone`. The stay window is a window of nights: night `D` is eligible when `stayFrom <= D <= stayTo`; the check-out date is not a night. |
| D6 | When several promotions are valid, the one with the highest total discount wins. A tie goes to the older `CreatedAt`, then the lower `Id`. One promotion per booking, no per-night mixing. |
| D7 **(adj)** | Customer Web always sends `expectedTotalAmount` and `expectedCurrencyCode` from the quote the guest is confirming. Any difference in total or currency on a **new** hold returns `409 hold.price-changed` with the current quote; the guest re-confirms. The check runs after the idempotency lookup. A replay of a hold that was created returns the stored snapshot and is not re-checked. A refusal for a changed price is a known result and starts a new attempt (new key, new quote). An attempt whose result is unknown is retried with the same key and the same payload; its payload is never changed. The two fields are optional on the wire so existing callers keep working; such callers keep today's behavior. |
| D8 | A promotion referenced by bookings can still be edited (versioned and audited); bookings keep their own snapshot. No hard delete. |
| D9 | A promotion applies to every rate plan of the chosen room types. |
| D10 | Scope is the whole Property or a subset of its room types; the backend checks each room type belongs to the Property. |
| D11 **(adj)** | A promotion is public when: status `Active` **and** `ShowOnHomepage` **and** inside its display window **and** its booking window has not ended. The same rule applies to the list and to the detail page. Hiding the card or ending the display window does not stop the promotion from pricing while it is `Active` and its booking conditions hold. A cache must not keep serving a card whose public eligibility ended. |
| D12 | The body is plain-text paragraphs, at most 8 of up to 1,000 characters, each its own translation key. No HTML. Figures such as the discount and the dates come from the rule fields, not from typed text. |
| D13 | Detail route `/offers/[slug]`; the slug is unique and stable. Old `/offers?offer=<mock slug>` links return to `/offers`. |
| D14 **(adj)** | No `promo` query parameter; the backend always decides the price. The call-to-action keeps the Property and the room-type scope of the promotion. For one room type it goes to that room's page. For several, the promotion page lists the applicable room types, each with its own link, so the guest is not sent to an empty or unscoped list. |
| D15 | Display order is an integer in the form (lower first, then newer first), no drag and drop. Source language `vi`; `en`/`fr` through the existing translation mechanism. |
| D16 | Cover images use the Website Hero media stack (`WebsiteMedia:RootPath`, local disk), JPEG/PNG/WebP, at most 10 MB, at least 600×400; unused uploads are not garbage collected. |

MEP fields approved: `FEATURE_BRANCH feature/bha-booking-promotions-001`, `diagnosing-bugs: ALLOWED_IF_TRIGGERED`, `CODEX_REVIEW_COMMAND /codex:review --base origin/develop`, `CODEX_REVIEW_INVOKER OWNER_ONLY`. Claude prints `READY_FOR_CODEX_REVIEW` and the command; the Owner invokes it. A correction needs the Owner to forward the findings and ask for it.

## 3. Pricing

One pure function, `PromotionPricing`, in `TheBha.Application`, is the only place a discount is computed. `AvailabilitySearch` (quote) and `BookingHoldCreationStore` (hold, inside its transaction) both call it, so a quote and a hold cannot disagree.

For one offer (room type, rate plan, `[checkIn, checkOut)`, `rooms`, currency):

1. `list(n)` is the `DailyRoomRate.Amount` of night `n`; it is never modified.
2. A promotion is a candidate when it is `Active`, in the Property, covers the room type, `bookingFrom <= today <= bookingTo` (open ends allowed, `today` is the Property's local date), the booking's total nights `>= minNights`, a fixed amount matches the offer currency, and at least one night is in the stay window.
3. For each eligible night: percent gives `round(list × p / 100)`; a fixed amount gives `value`. If `list - discount` is below the smallest valid amount, the promotion is not applicable to this quote (it is never silently trimmed).
4. `totalDiscount = sum(eligible nights' discount) × rooms`. The candidate with the highest `totalDiscount` wins (D6).
5. `final(n) = list(n) - discount(n)`; `ListTotal = sum(list) × rooms`; `Final = sum(final) × rooms = ListTotal - totalDiscount`.

Amounts are `decimal`. `Final > 0` always holds, so the existing `> 0` and 2-decimal checks hold.

### Contract (additive)

- `AvailabilityOfferDto.totalAmount` keeps meaning *the amount payable* (the final price). New fields: `listTotalAmount`, `discountTotalAmount`, `appliedPromotion` (id, slug, title, kind, value, currency), and per night `listAmount` and `discountAmount`.
- `nightlyRates[].amount` is the **final** per-room price of the night, so `sum × rooms = totalAmount` still holds for existing readers.
- `CreateBookingHoldApiRequest` gains optional `expectedTotalAmount` and `expectedCurrencyCode` (both or neither). `409 hold.price-changed` carries the current quote.

### Snapshot

- `InventoryHoldItemNight.UnitAmount` and `ReservationUnitNight.UnitAmount` stay the **final** per-night price, so `TotalAmount = sum(nights)`, the `> 0` checks and `IsCoherentReservation` are unchanged. Each night also records `ListUnitAmount` and `DiscountUnitAmount` (`CK: ListUnitAmount = UnitAmount + DiscountUnitAmount`). The migration backfills existing rows with `ListUnitAmount = UnitAmount`, `DiscountUnitAmount = 0`.
- A `BookingPromotionApplications` row (key: hold id; nullable unique reservation id) stores the promotion id, version, title, kind, value, currency, list total and discount total at the moment of the hold. Confirm copies the hold's snapshot, never recalculates, and links the reservation. Editing, disabling or letting a promotion expire does not change a hold or a reservation. Holds and reservations without a promotion are unchanged.
- The hold lifetime (15 minutes) and the idempotency behavior are unchanged.

## 4. Data model

- `Promotions`: id, `PropertyId`, unique `Slug`, status (`Draft`/`Active`/`Disabled`), `DiscountKind`, `DiscountValue`, `CurrencyCode` (fixed amount only), `AllRoomTypes`, booking, stay and display windows, `MinNights`, `Title`, `Summary`, `BodyParagraphs` (`text[]`), `CoverMediaId`, `CoverAltText`, `ShowOnHomepage`, `SortOrder`, `Version` (concurrency token), audit columns, create operation id and fingerprint (unique per actor).
- `PromotionRoomTypes`, `PromotionMedia` (same shape as `WebsiteHeroMedia`, key `promo/{id}.{ext}`), `PromotionAudits` (before/after JSON, append only, like `CatalogContentAudits`).
- `en`/`fr` texts are `WebsiteTranslations` rows `content.promotion.<id>.<title|summary|altText|body1..8>`, written in the same transaction as the promotion save and registered in `ContentCatalog`.
- Latest existing migration: `20261018154408_AddAdminCatalogCreateOperations`. The new migration only adds tables and columns and preserves data.

## 5. API

Admin (`TheBha.Staff` cookie, `PromotionManage` on the route's `propertyId`):

- `GET /api/admin/v1/properties/{propertyId}/promotions` (filters: status, search, visibility), `GET .../promotions/{id}`, `GET .../promotions/room-types`
- `POST .../promotions` (`Idempotency-Key`), `POST .../promotions/{id}/save` (`expectedVersion`), `POST .../promotions/{id}/status` (`expectedVersion`)
- `POST .../promotions/media` (multipart `file`), `GET .../promotions/media/{mediaId}`

Public (anonymous): `GET /api/v1/website/promotions?locale=`, `GET /api/v1/website/promotions/{slug}?locale=`, `GET /api/v1/website/promotions/media/{id}` (immutable). Texts are resolved on the server (visitor language, default language, source column). Drafts, disabled, hidden, out-of-window and Admin-only fields are never returned. The list and the detail share one eligibility function. The weak `ETag` is computed from the response body, so it changes when the visible set changes by date without any save.

## 6. Customer Web

- `HomeOfferSection`, `OfferCard` and `/offers` read the public API (server fetch `no-store`, last good value, `[promotions] could not be read` log, as for the hero). With no eligible promotion the block is hidden; there is no sample fallback.
- `/offers/[slug]` shows the full content and conditions, the Property and room types, the booking, stay and minimum-night conditions and the call-to-action. Without dates it shows no price.
- The quote UI shows the list price struck through only when a discount applies, the discount, the final price and the conditions. A `hold.price-changed` answer shows the new quote and asks the guest to confirm again before a new attempt.
- New strings are added to `catalog.json` and the `vi`/`en`/`fr` packs.

## 7. Acceptance

See the work item's P3 checklist: Staff creates a promotion with image and content and shows it on the homepage; the homepage card and the detail page match; edits and order reach the Customer without redeploy; hiding the card does not change the price; draft, hidden and out-of-window data never leave the public API; from the card the guest reaches booking, picks valid dates and sees the real discount through hold and confirm; a promotion changed or disabled after the hold does not change the confirmed price; desktop/mobile, light/dark and error states.

## 8. Known limits (stated, not hidden)

- **Promotion title language.** The quote carries the promotion's title in the content source language (Vietnamese). The Customer shows it only when the visitor reads Vietnamese; other languages read the rule ("15% off", "Save 200,000 ₫/room/night"). The public promotions API and the `/offers` pages are fully translated (server-resolved).
- **Per-line currency rounding.** For a display currency other than VND the site converts and rounds each figure on its own (the existing `display-prices` rule); list price, saving and total can differ from each other by a minor unit. VND, the base currency, is exact.
- **Rate-based validation is as of save time.** The Admin save checks the discount against the rates that exist then; rates added or lowered later are covered by the run-time rule (a promotion that would leave a night below the smallest valid amount is not applicable to that quote), not by a new error.
- **Display order is a number.** There is no drag and drop; the order is site-wide while the permission is per Property, so a Manager of one Property can place their card among another's. It never affects a price.
- **Brand lookup in Customer_Web.** The existing Featured/Riverside code finds the Riverside Property by slug `the-bha-riverside`. The promotion pages link by Property and room-type ids, so they work for the legacy slug `the-bha-hotel` too, but the extra "search rooms at Riverside" button is shown only for the Riverside slug.
- **Picture storage** is the existing local disk (`WebsiteMedia:RootPath`); unused uploads are not garbage collected (same as the hero).
- **Not in scope:** voucher codes, stacking, tax/fee/add-on discounts, payment, OTA, inventory and assignment behavior, customer authentication.
