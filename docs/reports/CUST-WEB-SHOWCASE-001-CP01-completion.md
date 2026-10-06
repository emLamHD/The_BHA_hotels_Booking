# CUST-WEB-SHOWCASE-001-CP01 — public entry and honest demo surface

> Draft PR into `develop`. Implementer Claude, reviewer Codex (read-only, Owner invokes). Baseline `b6e28a6cb889c000b3a39d3d4c864a9abc34dda0`, branch `feature/cust-web-showcase-001-cp01-live-entry`. Correction C1 (Codex findings F1/F2) starts at `cceaf926d66efc326a5f71d94d7bc9af76cae6db`. FINAL_HEAD, PR #82 size and CI are in the PR body (this file is part of the final commit). Review of the C1 head: `NOT RUN`.

## What changed (Customer_Web only)

- `/` is the live flow: `src/middleware.ts` rewrites it to `src/app/showcase/page.tsx` (intro, steps, CTA to `#booking`, then the existing `SectionGridFeatureProperty` → room types → availability → hold → confirm). Chosen over editing `app/page.tsx` to keep the diff small; the template file stays unused.
- `/home-2` and `/showcase` redirect (307) to `/`. Every other page path — listings, details, maps, `/checkout`, `/pay-done`, `/login`, `/signup`, accounts, add-listing, author, blog, subscription, about, contact, `/api/*`, public template SVGs, unknown paths — is default-denied: rewritten to `showcase-unavailable` (404, "Chức năng này chưa có trong bản hiện tại", link to `/`). Only `/_next/*` (runtime, chunks, fonts, image optimizer) bypasses the middleware; `/icon.jpg` (BHA Riverside logo) passes.
- Root layout: template header, footer and mobile nav replaced by `ShowcaseShell` (text brand, three anchors, demo-data banner, plain footer). One `BookingHoldProvider` kept.
- Live cards and offer card: the bundled template bitmap fallback is replaced by a neutral block ("Ảnh đang được cập nhật"). API media still render when usable.
- `.env.local.example`: the unused Cloudinary entries removed (values never printed). **Owner: check whether those keys are live and rotate them; Git history still contains them.**
- No change to API contracts, CSRF, idempotency, guest-token lifecycle, backend, packages or CI.

## Acceptance (CP01)

| | Result |
|---|---|
| A1 | PASS — browser `/` desktop and mobile shows The BHA, live catalog, CTA reaches the form; `/home-2` no longer wraps the flow. |
| A2 | PASS — loading, network error ("We couldn't reach the property service", Retry), empty catalog, 0 offers, invalid contact (no request sent) all observed; no fake fallback. |
| A3 | PASS — routes/nav/footer clean; production build: offers render the neutral block, 0 `<img>` on the page. `AvailabilityOfferCard.tsx` was outside the allowlist — see Deviations. |
| A4 | PASS — `routePolicy.test.ts` 60 tests: allow/alias/deny table, nested, query, trailing slash, case, dotted paths, matcher for `/_next/*`; browser and HTTP evidence below. |
| A5 | PASS — no contract change; full suite 388/388 (after C1). |
| A6 | See PR body for size and CI on FINAL_HEAD. |

## Checks (Node 22.23.2, npm 10.9.8, `Front_End/Customer_Web`)

`npm ci` 0 (lockfile unchanged) · `npm run lint` 0 (no warnings) · `npx tsc --noEmit -p .` 0 · `npx vitest run src/lib/routePolicy.test.ts` 60/60 · `npm test` 20 files, 383/383 · `npm run build` 0 (`/showcase` static, `/showcase-unavailable` dynamic, middleware 24.2 kB).

Production smoke (`next start`): `/` 200; `/home-2`, `/showcase` 307; 37 denied paths 404 with the unavailable page; JS, CSS, font 200; `/icon.jpg` 200. The first production run returned **200** for denied paths (prerendered not-found page); fixed by rendering the unavailable page per request, re-verified.

## Live evidence (isolated, not the Owner demo target)

Separate PostgreSQL 17 container (removed afterwards; `the-bha-postgres-1` untouched), 9 migrations, `--seed-development` on an empty database (rates 2026-10-06..19; DLX-KING sellable limit 1 on 10-07; FAMILY stop-sell 10-08). API `https://127.0.0.1:7145`, web `https://127.0.0.1:3000`, mkcert-trusted, Chrome, 2026-10-06 ~17:57 +07.

- Search 2026-10-07→09, 2 adults: one offer DLX-KING STANDARD, 2 × ₫1,500,000 = ₫3,000,000, "1 available" (FAMILY absent: stop-sell).
- Double-click "Create 15-minute Hold": one CSRF GET, **one** POST `/booking-holds` → 201. Double-click "Confirm reservation": **one** POST `/confirm` → 201, confirmation `BHAKUBYIOE4WXIGBZJ6ZJFKNCO4BM`.
- DB before → after: holds 0→1 (`Confirmed`), hold items 0→1, hold nights 0→2, reservations 0→1 (`Confirmed`, `SourceHoldId` = hold, guest), units 0→1 (`Committed`), unit nights 0→2 (DLX-KING, STANDARD, 1,500,000 each). Same search afterwards: 0 offers; 10→12 still sells both types.
- First run did not GET hold/reservation with the guest token, simulate slow responses or test 390 px; C1 below covers all three.

**Defect found (outside scope, for OC):** with a stale `.TheBha.Customer` cookie on the API host (customer missing or session invalid), `POST /booking-holds` returns 401 "The supplied customer session is invalid." and `POST /auth/logout` requires authentication, so a guest cannot book or recover without clearing cookies. Reproduced first at `https://localhost:3000`; every passing run here used `127.0.0.1` (a clean cookie jar) with runtime env only, which is **not** a fix: a browser holding a stale cookie still gets 401. **Still open.**

## Status lines

- `UI_LIVE: PASS` (isolated stack) · `END_TO_END: PARTIAL` (happy path, double-click, guest GET, slow/error/empty PASS; lost-response simulation NOT_RUN) · `DATA: BLOCKED` (no Owner-designated demo database; SQL in PR body) · `MEDIA: NOT_STARTED` (CP02) · `DEPLOY_BOOKING: BLOCKED` (no same-site HTTPS API and no browser write smoke on the deploy topology).
- Owner prices (session instruction 2026-10-06, unchanged since: 1PN ₫1,000,000; 1PN view thoáng ₫1,100,000; 2PN ₫1,600,000 per apartment-night) need RoomTypes that do not exist yet (catalog has DLX-KING, FAMILY); PR 2 seeds them.
- Photos: `BHA_riverside_real_image/` read only — 86 files, ~167 MB: Căn hộ 1PN 10, 1PN view thoáng 18, 2PN 20, Sảnh 15, Các khu vực khác 23 (PNG 62, JPEG 24, 1014–2560 px wide). Untracked, not committed.
- Mixed language: new chrome is Vietnamese; existing flow components stay English (CP02 candidate).
- Hard reload drops the in-memory hold and guest token (CURRENT).

## Deviations (Owner, 2026-10-06: 100–400 lines is a target, out-of-scope edits allowed with an explanation)

- `src/components/AvailabilityOfferCard.tsx` (+4/−9), outside the MEP allowlist: same placeholder change as the two live cards. Why: it is the only component on the live surface still importing a template bitmap, so A3 could not pass without it. No behaviour, data or API change.
- Owner accepted this change into the work item's scope (C1 prompt).
- Not taken: the stale-cookie 401 defect. Its fix changes backend auth/session behaviour, which needs explicit authorisation. Only the happy path on a clean cookie jar is proven: any browser that already holds an invalid `.TheBha.Customer` (e.g. after `/api/v1/auth/*` use) still cannot book. Known issue, recommended as its own work item.

## Correction C1 — Codex review findings (RUN on `cceaf92`, base `origin/develop`)

Review result, verbatim from Owner:

> Header navigation can discard an active guest hold, and the primary booking CTA can fail during initial loading. Targeted tests could not execute because the read-only sandbox prevented temporary-directory creation.
>
> - [P2] Preserve the booking session during header navigation — `ShowcaseShell.tsx:18-23`. After a guest creates a hold, clicking the brand performs a full-page navigation, destroying the in-memory state and guest token in `BookingHoldProvider`; the guest can no longer confirm that hold. The section links also reload when the current URL contains a query string. The previous logo used Next.js `Link`, which preserved the provider. Use client-side navigation for these internal links.
> - [P2] Keep the booking anchor available during catalog loading — `SectionGridFeatureProperty.tsx:128-130`. If the property request is slow and a visitor clicks "Tìm phòng trống" before it completes, `#booking` does not exist because this wrapper is inside the success-only branch. The URL fragment changes without scrolling, and rendering the form later does not retry that click. Keep the anchor mounted during loading, or defer scrolling until the target becomes available.

Reviewer tests: NOT_RUN (sandbox), not an implementation failure. OC verdict before C1: CORRECTION_REQUIRED.

**Fixes.**
- F1: brand and "Về trang đặt phòng" use `next/link`; the three header links use the new `ShowcaseNavLink.tsx`, an adjacent file declared before writing. On `/` (with or without a query) it changes the fragment natively; elsewhere it is a client `Link`. Root cause of a second defect found while testing: Next 13.4.3 scrolls a Link's hash target with `window.scrollTo(0, el.offsetTop)` (`next/dist/client/components/layout-router.js:188`). That position is relative to the nearest positioned ancestor, so `#booking` landed 499 px low and ignored the sticky header's scroll margin. Provider, controller, CSRF, idempotency and token storage are unchanged.
- F2: `#room-types` and `#booking` are mounted once in every state, showing a loading, error or empty note in place until the real sections render. When the catalog becomes usable, the section named in the hash is kept aligned while content above settles (room types load separately), until the visitor scrolls, taps or types, or 5 s pass. No search or hold is triggered.

**Red → green.**
- `SectionGridFeatureProperty.test.ts` (server render of the real loading state, 5 tests): 4 failed on `cceaf92`, 5/5 pass after.
- Browser, production build of `cceaf92` behind a TLS proxy: after a hold, clicking the brand loaded a new document; the in-page marker and the hold panel were gone and Confirm was impossible.

**Verification after C1.** Isolated PostgreSQL 17, seeded. API `https://127.0.0.1:7145`. Production build behind a TLS-terminating proxy at `https://127.0.0.1:3000`, mkcert-trusted.
1. Hold `aab601b5…` (1 create POST, 201). Brand click: same document (marker kept, 1 navigation entry), same hold, Confirm present. Double-click Confirm: 1 POST (201), reservation `6c239fb0…`.
2. Guest GET with the in-memory token (never logged): hold 200 `Confirmed`, reservation 200 `Confirmed`, 2 × 1,500,000 = 3,000,000. Without the token: 401.
3. New tab `/?ref=demo`, hold `92da46bd…`. Each header link: `/?ref=demo#catalog|#room-types|#booking`, section top 112 px (header bottom 93), same document, same hold, still 1 POST.
4. Client navigation to `/pay-done` (via the app's own router) shows the unavailable page. "Về trang đặt phòng" returns with the same hold. Double-click Confirm: 1 POST (201), GET hold/reservation 200 `Confirmed`.
5. Headless Chrome (CDP), API paused with SIGSTOP:
   - Hero CTA and header "Đặt phòng" both reach the booking loading note (hash `#booking`, in view).
   - After resume, the form appears in view with no second click (page bottom reached; first label 583 px, below the 93 px header).
   - Error (client timeout ≈ 28.6 s) and empty catalog: the note is found at `#booking`.
6. Mobile 390×844 (CDP device emulation, measured `innerWidth` 390): scroll width 390, nothing overflows. Tapping "Đặt phòng" puts `#booking` at 112 px (header bottom 109) with the form. Keyboard Tab focus shows a solid outline.
7. DB: 4 holds (2 `Confirmed`, 2 deliberately abandoned), 2 reservations, 2 units, 4 nights, each reservation linked to its hold, 0 duplicates per hold.

Tooling notes:
- Chrome extension clicks failed while the window was hidden, so step 5 used CDP.
- `next start -H 127.0.0.1` re-ran middleware after the rewrite (`/` → 307); `-H localhost` and Vercel are unaffected.
- All servers, the proxy and the DB were created and removed by this session.

Checks: targeted 65/65; `npm run lint` 0; `npx tsc --noEmit -p .` 0; `npm test` 21 files, 388/388; `npm run build` 0; `git diff --check` clean; lockfile unchanged.

## Owner decisions recorded in C1 (2026-10-06)

- No line target or cap for this work item.
- At most two PRs: PR #82 (CP01 + C1) and PR 2 (CP02).
- The `AvailabilityOfferCard.tsx` change is accepted into scope.
- PR 2 seeds The BHA Riverside: three RoomTypes with 3/2/6 PhysicalRooms (11 rooms), demo max occupancy 2/2/4, prices as above, real photos, and a dedicated demo database. It starts only after Owner merges PR #82 and OC issues its prompt.

`CHECKPOINT: PASS` for A1–A6 and F1/F2 (pending Codex re-review and OC). `CP02 NOT STARTED`. `DATA`/`MEDIA`/deploy belong to PR 2 and Owner. `Production/Vercel NOT TOUCHED`.
