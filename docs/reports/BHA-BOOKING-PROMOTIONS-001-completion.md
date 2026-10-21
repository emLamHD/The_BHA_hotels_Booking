# BHA-BOOKING-PROMOTIONS-001 — Completion report

- **Status:** PASS — every acceptance item above is met and CI is green; the Codex review is the Owner's next step.
- **Work item:** `BHA-BOOKING-PROMOTIONS-001` — booking promotions from Admin to Customer Web and the real booking flow.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (invoked by Owner only).
- **Branch:** `feature/bha-booking-promotions-001`
- **BASELINE_SHA = START_HEAD:** `65135cea4126f6d3188fc13d928cc62ca8301ec4` (`develop`; re-fetched before the branch was created, `origin/develop` identical, tree clean). The two old Orca worktrees on this machine were audited and left alone (RULES §5).
- **FINAL_HEAD:** ``425f9cf27aa57ea3ec42e31048d5155794c4d0e9` (code; the commit that adds this report is documentation only and changes no code)`
- **Review base:** `origin/develop`
- **Draft PR:** https://github.com/emLamHD/The_BHA_hotels_Booking/pull/125 (Draft, base `develop`)
- **Design and decisions:** `docs/design/BHA-BOOKING-PROMOTIONS-001-booking-promotions.md`; permission: `docs/ADR/0009-per-property-promotion-manage-permission.md`.

## Owner decisions (confirmed 2026-10-21)

D1–D16 as proposed in the two P0 reports, with four mandatory adjustments:

1. **No free booking (D3).** Percent is `0 < p < 100` with two decimals; a fixed amount is `> 0`. A discount may never take a night below the smallest valid amount; validation, run-time pricing and Customer copy all say so.
2. **Price confirmation (D7).** Customer Web always sends `expectedTotalAmount` and `expectedCurrencyCode` from the quote the guest confirms. A changed price on a *new* hold is `409 hold.price-changed` with the new quote; the guest confirms again. A refusal for a changed price is a known result (new attempt, new key); an unknown result is retried with the same key and payload, never a changed one. A replay of a created hold is returned as stored and not re-checked.
3. **CTA scope (D14).** No `promo` parameter; the links carry the Property and the room type(s) of the promotion, one link per applicable room type, so the guest is never sent to an empty or unscoped list. The backend decides the promotion from the dates.
4. **Public eligibility (D11).** One rule for list, detail and picture: `Active` ∧ on the homepage ∧ inside the display window ∧ booking window not over. Hiding the card or ending the display window never stops pricing while the promotion is `Active`; a cache never keeps an ended card (ETag from the body).

## Pricing formula and snapshot

`PromotionPricing` (`TheBha.Application`) is the only place a discount is computed; availability and the hold (inside its transaction) both call it. For one offer: the list rate is `DailyRoomRate.Amount` per night (never modified). A promotion is a candidate when it is `Active`, covers the room type, the Property's local today is inside its booking window, the **whole booking** has at least its minimum nights, a fixed amount is in the offer's currency, and at least one night is inside its stay window (night `D` is eligible when `stayFrom <= D <= stayTo`; the check-out date is not a night). Per eligible night and room: percent = `round(list × p / 100)`, half away from zero, to whole đồng (VND) or two decimals; fixed = the value. A promotion that would leave any eligible night below 1 đồng (0.01), or discounts nothing, is *not applicable* — never trimmed. The candidate with the highest total discount wins (tie: older, then lower id); one promotion per booking. `Final = Σ(list − discount) × rooms`.

Snapshot: `UnitAmount` stays what is paid, so `TotalAmount = Σ nights` and every `> 0` / replay-coherence rule is unchanged; each night also stores `ListUnitAmount`, and `BookingPromotionApplications` stores the promotion id/version/title/kind/value and the list/discount totals at the moment of the hold. Confirm copies, never recalculates, and links the reservation. Editing, disabling or letting a promotion expire changes no hold or reservation (tests: confirm after the promotion was edited then disabled keeps the held price and the held value). The 15-minute hold lifetime and the idempotency behaviour are unchanged.

## Migration 17 `AddBookingPromotions` and old data

Adds `Promotions`, `PromotionRoomTypes`, `PromotionMedia`, `PromotionAudits`, `BookingPromotionApplications` and `ListUnitAmount` on the two night tables. Existing nights are backfilled with `ListUnitAmount = UnitAmount` *before* the column becomes `NOT NULL` and before `CK: ListUnitAmount >= UnitAmount` is added. The migration tests found a real defect in the first draft: the backfill `UPDATE` followed by `ALTER TABLE` in one transaction is refused by PostgreSQL (`pending trigger events` from the night tables' deferred constraint triggers); fixed with `SET CONSTRAINTS ALL IMMEDIATE`. `Down()` refuses while any promotion or snapshot exists. The existing V9 → latest upgrade test with booking, customer and staff data passes with every row intact (its seeding adds the new column temporarily and drops it again so the upgrade under test still has to add and backfill it). Holds and reservations without a promotion read as `appliedPromotion: null`, `discountTotalAmount: 0`.

## Acceptance

Unit/integration/component evidence is in the checks below. **Browser acceptance** (Playwright driving the system Chrome 153; real API, real PostgreSQL; Admin Web, Customer Web and the API served over the mkcert leaf; no certificate error ignored):

| # | Check | Result |
|---|---|---|
| 1 | Manager signs in, lists the 4 seeded promotions, creates one with a cover (upload), body and conditions, shows it on the homepage, activates it | PASS |
| 2 | Homepage shows the card (first, by order); the card opens `/offers/<slug>` with the content, the three kinds of dates, minimum nights, property and one link per room type | PASS (desktop + mobile) |
| 3 | Changing title and order in Admin shows on the Customer after reload, no redeploy | PASS |
| 4 | Hiding the card removes it from the homepage and its page (404) and does **not** change the quote (`2.400.000 → 2.400.000`, same promotion) | PASS |
| 5 | Draft, hidden and expired data are not in the public API (list, detail, picture) and no Admin field leaks; the old `?offer=` link returns to `/offers` | PASS |
| 6 | From the card to the room page (ids only, no promotion in the URL), valid dates show the backend's discounted price with the list price struck; 1 night (below the minimum) shows no discount and no strike; hold → panel shows the price being confirmed → hold at the same price → promotion disabled in Admin → confirm keeps the held price and the snapshot agrees with the reservation row | PASS |
| 7 | Price changed between quote and hold: the new price is shown, nothing is held, the hold button is disabled until the guest accepts, then the hold is made at exactly the new price (one `409 hold.price-changed` in the console is that known refusal) | PASS |
| 8 | `/listing-stay` results strike exactly the cards the backend discounted (3 of 3 for the 3-night dates; 1 of 3 for 1 night: the hidden-but-active 10% promotion on the 2-bedroom) and nothing without dates | PASS |
| 9 | `/paydone` receipt shows list price, saving and final price | PASS |
| 10 | Desktop and mobile (390×844), light and dark, validation error state in Admin (100% refused on screen), API-down state (homepage block absent with no sample, `/offers` says it could not load, no stale card) | PASS |

Three defects were found only in the browser and fixed: the fixed-amount label overlapped the card badge; the offers heading fell back to the template's English default description; `/paydone` did not show the discount. A fourth (the *Check server* button disabled exactly when the result was unknown) was caught by a component test.

**Environment:** isolated database `thebha_promo_demo` on the local PostgreSQL (`the-bha-postgres-1`, `localhost:5432`); `thebha_dev` was not used for any write test. Seeded with `--seed-riverside-demo --expected-database thebha_promo_demo --media-base-url https://localhost:3000 --from <tomorrow> --days 60 --apply` and the promotion demo below; a temporary Manager Staff account was created with the Staff CLI. No credential is in the repository or in this report.

Demo data: `dotnet run --project Back_End/src/TheBha.Api -- --seed-promotion-demo --expected-database <demo|showcase database> [--cover-dir <dir of the Riverside .webp covers>] [--property-id <guid> --allow-existing-local-property] (--dry-run | --apply)`. It runs only with `ASPNETCORE_ENVIRONMENT=Development`, refuses a database whose name is not a demo/showcase one (or a non-loopback host), checks the name against `current_database()`, seeds four promotions for `RIV-1BR`, `RIV-1BR-OPEN` and `RIV-2BR` (three Active, one Draft), and is idempotent by slug: it never overwrites an Admin's edit. It creates nothing in production (refused outside Development).

## Checks run (all on the final tree)

| Area | Command / evidence | Result |
|---|---|---|
| Backend build | `dotnet restore` + `dotnet build Back_End/TheBha.Booking.sln -c Release` | succeeded (3 compiler warnings, the one inspected is in an existing test file this work item does not touch) |
| Backend unit tests | `dotnet test Back_End/TheBha.Booking.sln -c Release --no-build` — `TheBha.UnitTests` | **576 / 576 passed** |
| Backend integration tests | same command — `TheBha.IntegrationTests`, real PostgreSQL 17 (no InMemory/SQLite) | **1166 / 1166 passed** on the final code (`425f9cf`). A first full run found 2 real failures — the pinned Admin-mutation-route registry and the pinned role map did not yet list the promotion routes / `PromotionManage`; both registries were updated deliberately and the full suite rerun green |
| New backend tests | `PromotionPricingTests` (33 pure: formula, rounding, windows, minimum nights, multi-room, selection/ties, scope, currency, floor); `BookingPromotionPricingApiTests` (17: quote, hold, snapshot, stale/forged/lower/higher/other-currency price, replay, same-key-other-price, confirm after edit+disable, expiry, legacy callers); `AdminPromotionsApiTests` (31: role matrix incl. FrontDesk / global website permission / Manager of another Property / anonymous, LocalGate 404, create idempotency, slug, 16 validation cases, rate-based floor, stale tab, status path, filters, homepage vs pricing, translations, cover upload/preview/foreign cover, attribute pin); `PublicPromotionsApiTests` (8: public filter, inclusive window ends, no admin field, scope, language fallback, ETag/date rollover without a save, picture only while public, hiding keeps pricing); `PromotionDemoSeederTests` (9); migration tests (V9 → latest upgrade with booking/customer/staff data, fresh apply, counts) | included above |
| Admin_Web | `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build` | clean; **66 files / 2022 tests passed**; build ok (`/promotions` listed) |
| Customer_Web | `npx tsc --noEmit` from a clean `.next`, `npx eslint src --max-warnings=0`, `npx vitest run`, `npm run build` (CI parity) | clean; **66 files / 1337 tests passed**; build ok (`/offers`, `/offers/[slug]` dynamic) |
| Browser | Playwright on system Chrome, real stack, isolated demo database | acceptance table above, all PASS |
| CI on PR #125 (head `425f9cf`) | GitHub Actions | `Plan`, `Admin`, `Backend`, `Backend suite on the source commit`, `Build image`, `Frontend` **pass**; the ECR/EC2 publish and deploy jobs are skipped by design (not `main`); the two Vercel previews pass. No Google Fonts timeout, no rerun |

Skill policy: `diagnosing-bugs: ALLOWED_IF_TRIGGERED` — not invoked (see self-review). Graphify not used. Read-only subagents were used for the P0 survey (lookup only; they wrote nothing and invoked no reviewer). Orca, `/codex:*` commands and any reviewer: not touched by the implementer.

Review: `/codex:review --base origin/develop` — **NOT RUN** (Owner invokes it).

## Self-review

- Authorization is the existing seam (`StaffCalendarPermission` → `IStaffAccessEvaluator`) with a new Manager-only permission; every action of `AdminPromotionsController` carries it (reflection test), the global website permission grants nothing here (test), the routes are closed in LocalGate, the actor is never read from the request.
- The client never states a price: the only price-related request fields are the two the guest is confirming, and a mismatch (lower, higher, wrong currency) is refused. The server-side price of a hold is always recomputed in its transaction.
- Translations: promotion texts are `WebsiteTranslations` rows that are deliberately **not** registered in `ContentCatalog`, so the public dictionary cannot expose a draft. Checked every path that removes translation rows: pack install never deletes; the single-row clear needs a registered key; deleting a language (inactive, non-default) removes all of its rows by design, promotion texts included, as for every other content translation.
- `diagnosing-bugs` was not invoked: the one defect with a failing check (the migration) had a direct red/green loop (the existing migration tests) and no diagnosis was needed.

## Known limits, risks, NOT RUN

See §8 of the design doc. In short: the quote carries the promotion's Vietnamese title (shown only to Vietnamese readers; other languages read the rule); non-VND display currencies round each figure per line; the Admin's rate check is as of save time (the run-time rule covers later rate changes); display order is a site-wide number under a per-Property permission; the extra Riverside search button needs the slug `the-bha-riverside`; cover pictures are on local disk (`WebsiteMedia:RootPath`) with no garbage collection — whether that disk is durable and backed up on the real backend host was **not verified**. **NOT RUN:** a real deployment, production data, and a browser pass of an in-page date change on the results page (covered by unit tests only); the browser run covered URL-driven dates.

Leftovers on this machine (not in the repository): database `thebha_promo_demo` with its temporary Manager account, a private password file and media files in the session scratchpad, and a Playwright install there. They can be deleted on request.

## PR size

GitHub (PR #125): **+10,759 / −577 across 128 files (11,336 lines)** against the 100–400 target (`WORKFLOW.md` §6). Reason, by group (approximate, from `git diff --numstat`): generated EF migration + designer + snapshot ≈ 3,660; hand-written backend (domain, pricing, hold/confirm, admin service and controller, public service and controller, demo seeder, DI/CORS) ≈ 2,200; localization catalog and the three packs ≈ 300 (35 keys added, 25 sample-offer keys removed); backend tests ≈ 1,640 (about 100 test cases); Admin_Web ≈ 1,420 (screen, model, API client, gate rule, tests); Customer_Web ≈ 1,720 net of 318 deleted lines (offers block and pages, price presentation, hold flow, tests); docs ≈ 270 (design, ADR, snapshot, worklog, this report). The work item is a single Epic that the Owner scoped as one PR across Admin, API, pricing, booking and Customer; the pieces cannot ship separately without a price that Admin cannot manage or a card that prices nothing. No padding or test reduction was used; commits are checkpoints (docs → pricing/hold/migration → admin API → public API → Admin_Web → Customer_Web → seed → fixes) so the review can proceed in that order.

## Requested decision

Owner: invoke the review below, forward the result, and decide Ready/merge. Nothing here merges, marks Ready, deploys or deletes a branch.
