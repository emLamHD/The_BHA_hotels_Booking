# CUST-WEB-SHOWCASE-001-CP01 — public entry and honest demo surface

> Draft PR into `develop`. Implementer Claude, reviewer Codex (read-only, Owner invokes). Baseline `b6e28a6cb889c000b3a39d3d4c864a9abc34dda0`, branch `feature/cust-web-showcase-001-cp01-live-entry`. FINAL_HEAD, PR URL, GitHub size and CI are in the PR body (this file is part of the final commit). `REVIEW: NOT RUN`.

## What changed (Customer_Web only)

- `/` is the live flow: `src/middleware.ts` rewrites it to `src/app/showcase/page.tsx` (intro, steps, CTA to `#booking`, then the existing `SectionGridFeatureProperty` → room types → availability → hold → confirm). Chosen over editing `app/page.tsx` because that would delete 213 template lines and break the size cap; the template file stays unused.
- `/home-2` and `/showcase` redirect (307) to `/`. Every other page path — listings, details, maps, `/checkout`, `/pay-done`, `/login`, `/signup`, accounts, add-listing, author, blog, subscription, about, contact, `/api/*`, public template SVGs, unknown paths — is default-denied: rewritten to `showcase-unavailable` (404, "Chức năng này chưa có trong bản hiện tại", link to `/`). Only `/_next/*` (runtime, chunks, fonts, image optimizer) bypasses the middleware; `/icon.jpg` (BHA Riverside logo) passes.
- Root layout: template header, footer and mobile nav replaced by `ShowcaseShell` (text brand, three anchors, demo-data banner, plain footer). One `BookingHoldProvider` kept.
- Live cards and offer card: the bundled template bitmap fallback is replaced by a neutral block ("Ảnh đang được cập nhật"). API media still render when usable.
- `.env.local.example`: the unused Cloudinary entries removed (values never printed). **Owner: check whether those keys are live and rotate them; Git history still contains them.**
- No change to API contracts, CSRF, idempotency, guest-token lifecycle, backend, packages or CI.

## Acceptance (CP01)

| | Result |
|---|---|
| A1 | PASS — browser `/` desktop and mobile shows The BHA, live catalog, CTA reaches the form; `/home-2` no longer wraps the flow. |
| A2 | PASS — loading, network error (API stopped: "We couldn't reach the property service", Retry), 0 offers ("No offers matched …"), invalid contact (no request sent) all observed; no fake fallback. |
| A3 | PASS — routes/nav/footer clean; production build: offers render the neutral block, 0 `<img>` on the page. `AvailabilityOfferCard.tsx` was outside the allowlist — see Deviations. |
| A4 | PASS — `routePolicy.test.ts` 60 tests: allow/alias/deny table, nested, query, trailing slash, case, dotted paths, matcher for `/_next/*`; browser and HTTP evidence below. |
| A5 | PASS — no contract change; full suite 383/383. |
| A6 | See PR body for size and CI on FINAL_HEAD. |

## Checks (Node 22.23.2, npm 10.9.8, `Front_End/Customer_Web`)

`npm ci` 0 (lockfile unchanged) · `npm run lint` 0 (no warnings) · `npx tsc --noEmit -p .` 0 · `npx vitest run src/lib/routePolicy.test.ts` 60/60 · `npm test` 20 files, 383/383 · `npm run build` 0 (`/showcase` static, `/showcase-unavailable` dynamic, middleware 24.2 kB).

Production smoke (`next start`): `/` 200; `/home-2`, `/showcase` 307; 37 denied paths 404 with the unavailable page; JS, CSS, font 200; `/icon.jpg` 200. The first production run returned **200** for denied paths (prerendered not-found page); fixed by rendering the unavailable page per request, re-verified.

## Live evidence (isolated, not the Owner demo target)

Separate PostgreSQL 17 container (removed afterwards; `the-bha-postgres-1` untouched), 9 migrations, `--seed-development` on an empty database (rates 2026-10-06..19; DLX-KING sellable limit 1 on 10-07; FAMILY stop-sell 10-08). API `https://127.0.0.1:7145`, web `https://127.0.0.1:3000`, mkcert-trusted, Chrome, 2026-10-06 ~17:57 +07.

- Search 2026-10-07→09, 2 adults: one offer DLX-KING STANDARD, 2 × ₫1,500,000 = ₫3,000,000, "1 available" (FAMILY absent: stop-sell).
- Double-click "Create 15-minute Hold": one CSRF GET, **one** POST `/booking-holds` → 201. Double-click "Confirm reservation": **one** POST `/confirm` → 201, confirmation `BHAKUBYIOE4WXIGBZJ6ZJFKNCO4BM`.
- DB before → after: holds 0→1 (`Confirmed`), hold items 0→1, hold nights 0→2, reservations 0→1 (`Confirmed`, `SourceHoldId` = hold, guest), units 0→1 (`Committed`), unit nights 0→2 (DLX-KING, STANDARD, 1,500,000 each). Same search afterwards: 0 offers; 10→12 still sells both types.
- Not run: GET hold/reservation with the guest token (memory-only by design, not extracted); slow-response and lost-response fault simulation; 390 px width (Chrome's minimum window gave a 500 px viewport — no horizontal overflow).

**Defect found (outside scope, for OC):** with a stale `.TheBha.Customer` cookie on the API host (customer missing or session invalid), `POST /booking-holds` returns 401 "The supplied customer session is invalid." and `POST /auth/logout` requires authentication, so a guest cannot book or recover without clearing cookies. Reproduced first at `https://localhost:3000`; the run above used `127.0.0.1` (separate cookie jar) with runtime env only.

## Status lines

- `UI_LIVE: PASS` (isolated stack) · `END_TO_END: PARTIAL` (happy path PASS; D4 lost-response, D5 guest GET, D6 slow response NOT_RUN) · `DATA: BLOCKED` (no Owner-designated demo database; SQL in PR body) · `MEDIA: NOT_STARTED` (CP02) · `DEPLOY_BOOKING: BLOCKED` (no same-site HTTPS API and no browser write smoke on the deploy topology).
- Owner prices (1PN ₫1,000,000; 1PN view thoáng ₫1,100,000; 2PN ₫1,600,000) need RoomTypes that do not exist yet (catalog has DLX-KING, FAMILY); not mapped or applied.
- Photos: `BHA_riverside_real_image/` read only — 86 files, ~167 MB: Căn hộ 1PN 10, 1PN view thoáng 18, 2PN 20, Sảnh 15, Các khu vực khác 23 (PNG 62, JPEG 24, 1014–2560 px wide). Untracked, not committed.
- Mixed language: new chrome is Vietnamese; existing flow components stay English (CP02 candidate).
- Hard reload drops the in-memory hold and guest token (CURRENT).

## Deviations (Owner, 2026-10-06: 100–400 lines is a target, out-of-scope edits allowed with an explanation)

- `src/components/AvailabilityOfferCard.tsx` (+4/−9), outside the MEP allowlist: same placeholder change as the two live cards. Why: it is the only component on the live surface still importing a template bitmap, so A3 could not pass without it. No behaviour, data or API change.
- Not taken: the stale-cookie 401 defect. Its fix changes backend auth/session behaviour, which the MEP forbids and RULES treat as needing explicit authorisation. It also does not affect demo guests: the Customer Web has no login UI, so a guest's browser never gets `.TheBha.Customer`; only browsers that used `/api/v1/auth/*` directly (developers, Swagger) do. Recommended as its own work item.

`CHECKPOINT: PASS` (A1–A6). `CP02 NOT STARTED`. `Production/Vercel NOT TOUCHED`.
