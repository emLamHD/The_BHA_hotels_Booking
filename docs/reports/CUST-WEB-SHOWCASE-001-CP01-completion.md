# CUST-WEB-SHOWCASE-001-CP01 — public entry and honest demo surface

> Draft PR into `develop`. CP01 and C1 implementer Claude; C2 correction implementer Codex (its history below is unchanged); C3 implementer Claude under a new MEP the Owner authorized, reviewer Codex read-only (Owner invokes). Baseline `b6e28a6cb889c000b3a39d3d4c864a9abc34dda0`, branch `feature/cust-web-showcase-001-cp01-live-entry`. C2 started at `e2933dbcc469307b70363098da5caf4ad2d15768`; C3 starts at `89aec98e2c6b192b104850b8abaf87aa9c01ec4e`. FINAL_HEAD and CI for C3 are in the PR #82 body. `REVIEW: NOT_RUN` for the C3 head.

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
- `next start -H 127.0.0.1` re-ran middleware after the rewrite (`/` → 307). The historical Vercel claim is corrected: **Vercel was NOT_TESTED**; no deployment smoke was run.
- All servers, the proxy and the DB were created and removed by this session.

Checks: targeted 65/65; `npm run lint` 0; `npx tsc --noEmit -p .` 0; `npm test` 21 files, 388/388; `npm run build` 0; `git diff --check` clean; lockfile unchanged.

## Owner decisions recorded in C1 (2026-10-06)

- No line target or cap for this work item.
- At most two PRs: PR #82 (CP01 + C1) and PR 2 (CP02).
- The `AvailabilityOfferCard.tsx` change is accepted into scope.
- PR 2 seeds The BHA Riverside: three RoomTypes with 3/2/6 PhysicalRooms (11 rooms), demo max occupancy 2/2/4, prices as above, real photos, and a dedicated demo database. It starts only after Owner merges PR #82 and OC issues its prompt.

`CHECKPOINT: PASS` for A1–A6 and F1/F2 (pending Codex re-review and OC). `CP02 NOT STARTED`. `DATA`/`MEDIA`/deploy belong to PR 2 and Owner. `Production/Vercel NOT TOUCHED`.

## Correction C2 — loopback home entry and fragment realignment

Work item `CUST-WEB-SHOWCASE-001-CP01-C2-CODEX`; implementer Codex, reviewer Claude read-only. Review base `origin/develop` at `b6e28a6cb889c000b3a39d3d4c864a9abc34dda0`; correction start `e2933dbcc469307b70363098da5caf4ad2d15768`. This correction stays in PR #82. The prior C1 work and its review history above remain distinct.

**F1 — home request on loopback IP.** The prior production build at `127.0.0.1:3000` returned a 307 from `/` to `http://localhost:3000/`, followed by a 200 after one redirect; this was a host-changing redirect, not an observed infinite chain. On the corrected build `src/app/page.tsx` imports/re-exports the existing live showcase entry, while middleware lets `/` continue directly. `/showcase` and `/home-2` remain aliases; unavailable paths remain denied. The alias redirect preserves same-origin for `localhost` and `127.0.0.1` without trusting forwarded headers.

Production build smoke ran `next start -H 127.0.0.1 -p 3001`, and separately followed routes through both IP and localhost authorities. On `127.0.0.1`, `/` and `/?ref=demo` returned 200 with zero redirects; `/showcase` and `/home-2` (including query/trailing-slash cases) reached `/` with at most two redirects (canonical slash plus alias), preserving the IP origin and query. `/pay-done`, `/checkout`, `/login`, `/listing-stay-detail`, and `/unknown` returned unavailable 404s without redirects. `localhost/` returned 200. JS/CSS/font assets returned 200. No forwarded host was injected to make the smoke pass. C1's redirect is therefore fixed on the actual loopback-IP production server.

**F2 — fragment changes while data loads.** The mounted section subscribes to `hashchange` and same-fragment navigation, re-reads the current target on each intent and readiness change, and tracks only that target/container with one `ResizeObserver`. A newer fragment replaces the prior tracking window. Wheel, touch, key, mouse, timeout (5 seconds), and unmount clean up observer/listeners/timer. It does not search or create a hold. The 5-second window is a bounded policy for this implementation; it does not claim to cover arbitrary network or browser latency beyond the observed sequences.

Red/green evidence used Chrome headless with native scroll anchoring disabled (simulation, **Safari NOT_RUN**). The C1 baseline sequence had the booking anchor at 496px, first form control at 640px, and a 437px viewport after RoomType content settled: the control was below the viewport. On C2 production, catalog was ready before the header click, the RoomType response was held, and `#booking` changed after readiness. After releasing RoomTypes, the anchor was at 463px, first control at 607px, header bottom at 93px, viewport 900px: the form remained visible without another click. This particular C2 green run used 1440×900; it is not a same-viewport numerical comparison to the C1 437px run. A separate `#room-types` fragment-change case aligned at 112px beneath a 93px sticky header after release. A client navigation from the unavailable route to `/#booking` while the property catalog was held was also exercised. Same-fragment click, query preservation, new-fragment takeover, user wheel takeover, and unmount cleanup were exercised; observer instrumentation observed maximum one active observer and zero after unmount.

**Browser booking regression.** Production Customer_Web through trusted mkcert HTTPS at `https://localhost:3000`, API through a test TLS proxy to an isolated ASP.NET API and PostgreSQL 17 database. Chrome headless desktop 1440×900. Search 2026-10-07→08 for two adults returned Deluxe King / Standard Rate, one night at ₫1,500,000. Double-click Hold created one POST (201); double-click Confirm created one confirm POST (201); navigation through brand and booking header retained the in-memory hold. Guest GET for the hold and confirmed reservation each returned 200 using the in-memory guest credential (credential not logged). DB evidence: one `Confirmed` hold, one `Confirmed` reservation linked to a source hold, one hold-night row and one reservation-night row on 2026-10-07 at ₫1,500,000; no duplicate reservation per hold. This is isolated happy-path evidence, not a claim that all booking failure modes are covered.

Chrome 390×844 touch emulation measured `innerWidth === documentElement.scrollWidth === 390`; a real CDP touch on the header booking link preserved `?ref=demo` and set `#booking` at 112px with the sticky header ending at 109px. Keyboard Tab focus was visible (`:focus-visible`, 1px `auto` outline). This is browser emulation, not a physical-device test. No Safari or deployed Vercel smoke was run. The known stale `.TheBha.Customer` cookie 401 remains open and was not addressed. Lost-response simulation remains `NOT_RUN`.

**Original photographs.** Owner-authorized originals are at `/home/admin1/The_BHA_assets/BHA_riverside_real_image/`. The post-move SHA-256 manifest check matched 86/86 files and 166,663,251 bytes; the checkout source directory is absent. The manifest remains under `/tmp`, and neither it nor binary originals are in Git. CP02 may read originals from the destination; C2 did not optimize/copy them into web assets or seed media.

**Correction checks and handoff.** Final implementation checks: targeted Vitest `npx vitest run 'src/lib/routePolicy.test.ts' 'src/app/(home)/SectionGridFeatureProperty.test.ts'` — 2 files, 70/70; `npm run lint` — exit 0; `npx tsc --noEmit -p .` — exit 0; `npm test` — 21 files, 393/393 (the first sandbox run was 392/393 because its child-process launcher was blocked; the requested full rerun outside the sandbox passed); `NEXT_PUBLIC_API_BASE_URL=https://localhost:7245 npm run build` — exit 0; `git diff --check` — exit 0. No dependency or lockfile change, and `npm ci` was not needed. Production route and asset smoke ran against the final build on `127.0.0.1:3001` after restart. Vercel remains `NOT_TESTED`; `CP02 NOT STARTED`; review is `NOT RUN` pending Owner's separate Claude read-only review of the final SHA against `origin/develop`. No merge, Ready, deploy, reviewer invocation, or backend/auth/schema/API change was made.

## Correction C3 — visitor takeover survives catalog readiness (Claude)

Work item `CUST-WEB-SHOWCASE-001-CP01-C3-CLAUDE`. OC withdrew the earlier C3-CODEX activation; the Owner passed this MEP to Claude, pair `CLAUDE` / `CODEX_READ_ONLY`, same branch and PR #82. Claude also wrote CP01 and C1, so the review a previous Claude turn ran on `89aec98` is **not** an independent review and is not counted as the gate. At preflight a Codex process was running on the machine; HEAD, remote and PR head were all `89aec98`, the working tree was clean and no new commit existed, so nothing was overwritten.

**Findings handled** (from the review of `89aec98`): (1) P3, a visitor who scrolled away is pulled back to `#booking` when the catalog arrives; (2) P3, no repository test protects the alignment lifecycle; (3) nit, the loopback test pinned an exact `Location` string.

**Root cause (1).** The alignment effect depended on `ready`. Every readiness change cleaned up and re-ran `alignCurrentHash()`, which re-read the old hash and started a new session, so data arriving counted as a navigation intent.

**Fix.** The lifecycle is `createAnchorAlignment` in `src/lib/anchorAlignment.ts`. A session starts only from an explicit intent: the hash present when the section mounts, `hashchange`, or a same-fragment click. It ends on the first of a visitor takeover (wheel, touchstart, keydown, mousedown), the deadline (5 s from the intent that started it), a newer intent, a hash that is not a section, or unmount. Data and layout changes neither start nor extend a session. At most one observer, one timer and one set of takeover listeners exist. A callback queued after a session ended, or for a target the hash no longer names or the page has replaced, does nothing. `SectionGridFeatureProperty` creates the controller once (`useEffect(..., [])`), so it cannot be re-entered by readiness. Provider, token handling, middleware and routing are untouched.

**Tests (kept in the repository).** `src/lib/anchorAlignment.test.ts`, 18 Vitest tests that run the same controller with a fake window, observer and clock: alignment at creation and as layout settles; no session without a section hash; takeover by each of the four events, after which late layout, queued callbacks and time scroll nothing and create nothing; same-fragment click and hash change open a fresh window (old target never called again, never two observers); a hash that stops naming a section; a replaced target; the deadline ends the session, is not restarted, and is measured from the active intent; `dispose` removes every observer, timer and listener; no leaks over 25 intents. A mutation check in a scratchpad copy broke seven rules one at a time (no takeover listeners, old session kept on new intent, no session check in callbacks, deadline never ends, dispose keeps listeners, resize extends the deadline, stale-target guard removed); all seven were caught (the last needed one more test, since added). **Limit:** Vitest here runs in node and cannot execute React effects, and the brief forbids a DOM framework, so the effect's wiring (one effect, no dependency on `ready`) is protected structurally and proven by the browser run below, not by these tests.

**Nit.** `routePolicy.test.ts` now asserts what the redirect resolves to for the `127.0.0.1` and `localhost` authorities (origin, path, query, equal to a relative `/?ref=x`), and that an arbitrary `Host` is not trusted, instead of the exact serialized header. The middleware encodes the authority, the running server sends a relative `Location`, and only the resolved target is the contract. `middleware.ts` is unchanged.

**Red / green, same conditions.** Production builds of `89aec98` (red) and `860690b` (green), Chrome headless over CDP, API stubbed with the Fetch domain (no real API), native scroll anchoring disabled to approximate Safari (**Safari NOT_RUN**), viewport 1100×560. Order: open `/#booking` with the properties response held, wheel up to the top, then release the response (RoomTypes answer at once).

| Step | red `89aec98` | green `860690b` |
|---|---|---|
| after load, catalog pending | `scrollY` 724, `#booking` top 301 | same |
| visitor scrolled to the top | `scrollY` 0 | `scrollY` 0 |
| catalog arrives | `scrollY` **2183**, `#booking` 123 (pulled back) | `scrollY` **0** (visitor kept), `#booking` 2306 |

Unchanged in both builds (C2 behaviour kept): fragment change after the catalog is ready while RoomTypes load (`#booking` at 123 px, first control at 243 px, `scrollY` 1158 → 2183); header link from `/pay-done` (client navigation, same document, `#booking` at 123 px).

**Accepted consequence of the 5 s deadline** (the brief says readiness must not extend it): with the catalog held for about 7 s after `/#booking`, red (C2) realigned (`#booking` 123 px) and green does not (`scrollY` stays 724, `#booking` 1582 px, first control 1702 px, below the 560 px viewport). Browsers with native scroll anchoring (Chrome, Firefox) are not affected; a slow-network visitor in a browser without it must scroll to the form. OC decision whether that is acceptable.

**Mobile 390×844** (Chrome emulation, touch, measured `innerWidth` 390, same stub): a touch on "Đặt phòng" with RoomTypes pending gives `#booking` at 112 px under a header ending at 109 px, unchanged after RoomTypes arrive (`scrollY` 1507 → 2767); `scrollWidth` 390, 0 elements overflow; Tab focus lands on an input below the header with a solid outline. Same numbers on red and green.

**Production smoke** (build of `860690b`, no credentials). `next start -H 127.0.0.1`: `/` and `/?ref=demo` 200; `/home-2` 307 → `http://127.0.0.1:3305/`, `/home-2?ref=x` and `/showcase?ref=x` → `…/?ref=x` (`curl -L` ends 200 at that URL); `/checkout`, `/pay-done`, `/login`, `/signup`, `/home-3`, `/listing-stay`, `/account`, `/add-listing/1`, `/blog/x`, `/about`, `/contact`, `/api/hello`, `/next.svg`, `/favicon.ico`, `/showcase-unavailable` 404 with the unavailable page; `/icon.jpg`, one JS, one CSS and one font file 200; no proxy errors in the log. `-H localhost` gives the same results.

**Booking regression on the final build** (`860690b`; trusted mkcert HTTPS through a TLS terminator to `next start`, real API, isolated PostgreSQL 17, Chrome with real pointer events, 2026-10-06). Search for two adults returns Deluxe King ₫1,500,000 and Family Suite ₫2,200,000. Double-click on the hold button sent **one** POST (201). Clicking the brand and the three header links kept the same document and hold. Double-click on confirm sent **one** POST (201). Guest GET with the in-memory access code (never logged): hold 200 `Confirmed`, reservation 200 `Confirmed`, 2 × ₫1,500,000; the same read without the code 401. Database: 1 hold, 1 item, 2 hold nights, 1 reservation, 1 unit, 2 nights; the hold is `Confirmed` and linked to its reservation, the unit is `Committed` (`DLX-KING`), and no hold has more than one reservation. Nothing here says the stale `.TheBha.Customer` cookie defect is fixed.

**Lost response, rerun at C3** (same stack; the response of the confirm POST was cut after it reached the server, `OPTIONS` left alone): the page shows that the outcome could not be confirmed, no success, and sends no second confirm in 14 s; the offered Retry returns **200** (the committed result replayed) and the page then shows the reservation; the database has one reservation for that hold; totals 2 holds, 2 reservations, 0 duplicates per hold. The earlier run at `89aec98` by the Claude session that wrote CP01/C1 gave the same outcome; it is a **supplemental, non-independent** run and is not attributed to the Codex C2 work.

**Checks** (Node 22.23.2, npm 10.9.8, `Front_End/Customer_Web`): `npx vitest run src/lib/anchorAlignment.test.ts src/lib/routePolicy.test.ts 'src/app/(home)/SectionGridFeatureProperty.test.ts'` 3 files, 90/90; `npm run lint` 0; `npx tsc --noEmit -p .` 0 (the first run failed on iterator spreads in the new test with the project's ES5 target; fixed with `Array.from`); `npm test` 22 files, 413/413; `npm run build` 0; `git diff --check` clean; no dependency or lockfile change, `npm ci` not needed. `diagnosing-bugs` was not available in this environment; the defect was reproduced and verified directly.

**Open, unchanged:** stale `.TheBha.Customer` cookie 401 (OPEN, no clean-cookie run counts as a fix), Vercel `NOT_TESTED`, Safari `NOT_RUN`, `CP02 NOT_STARTED`, `REVIEW: NOT_RUN`. The isolated runs above do not certify the product for sale.
