# CUST-WEB-SHOWCASE-001-CP02 — Riverside showcase: photos, catalog, demo seed, deploy artifacts

> Draft PR into `develop` (the second and last PR of the showcase work item). `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes). Baseline `9ad8edce4171f9b26a3f274cd544758be21f9162`, branch `feature/cust-web-showcase-001-cp02-riverside-demo`. FINAL_HEAD, PR number, PR size and CI on FINAL_HEAD are in the PR body. `REVIEW: NOT_RUN`.

> **C2 supersedes the UI of this report.** The browser/E2E results in §4 below (and the home/details parts of §5) were taken at `2bb70bb` against the *old single-page flow* (`/` was one booking page). Owner then decided on the Chisfis home page plus a room details page (see **§10, C2**). The old results are history; they are **not** credited to the new home or details pages — §10 has the evidence for those, taken on the C2 build. `DATA_LOCAL`, `MEDIA`, the container/proxy/key-ring evidence (§5) and the seeder/deploy results are unaffected by C2.

## 0. Media evidence — what the scan does and does not show (corrected in C1)

The first version of this report called 62 originals "AI-signed" and 13 "camera photographs". That overstated what a byte scan can show. The accurate statement, from `build_media.py` re-run on the originals (86 files, hashes unchanged, originals never modified):

| Scan classification | Files | Meaning |
|---|---:|---|
| `generator-markers-present` | 62 (all PNG) | Each contains the markers `trainedAlgorithmicMedia`, `gpt-image`, `OpenAI Media Service` and the generic `c2pa`, `caBX`, `jumb`. These **indicate** a generative-image service; the C2PA signature was **not validated**, so it is an indication to verify, not proof, and says nothing yet about whether the Owner's images depict the real rooms (e.g. an edited photo versus a newly generated one). |
| `content-credentials-detected` | 0 | Generic C2PA/JUMBF container only (would mean capture or edits; not AI by itself). |
| `editor-metadata-present` | 23 (JPEG) | Adobe Lightroom/Photoshop metadata. **Camera origin is not independently verified**, nor that the scene is the real room. |
| `no-metadata` | 1 (`zalo.jpg`) | Nothing to verify (messaging-app re-encode). |

- **Validation: `NOT_RUN`.** No C2PA validator (`c2patool` or other) was run in CP02 or C1 and none is installed; no signature result is claimed. `manifest.json` (schema 2) records, per original: SHA-256, the exact markers found, editor software, classification and `validation: NOT_RUN`.
- **Publication policy (unchanged):** only `editor-metadata-present` files can be published; the 13 derivatives (property 10, 2PN 3; 3,082,576 bytes; byte-identical to CP02 and reproducible by the script) are the Owner's photos for those areas at that evidence level — **not** "camera cryptographically verified". Files with generator markers or no metadata are not published by the script.
- **The two 1PN room types have no published photo** and show the neutral placeholder: every 1PN original with a usable room picture carries the generator markers; the only editor-metadata file in each 1PN folder is a close-up of a wall hair dryer (identical in both), not a room.
- **Pending Owner factual clarification:** are the 1PN images edited photographs of the real rooms, or newly generated? The Owner has said the origin of the images does not matter for the showcase and that the folders are already split per room type; C1 deliberately does **not** change the publication policy or add images (that is a separate, explicit change). Labelling an image as AI does not by itself satisfy a request for real photographs.
- `MEDIA` stays **PARTIAL**: 1PN imagery is not accepted.

## 1. What changed

- **Customer_Web** — API-driven photo gallery (`MediaGallery`, `mediaPresentation.ts`: cover first, failed-image fallback, thumbnails with `aria-pressed`), strict media namespace in `routePolicy.ts` (`/media/the-bha-riverside/<kebab>.webp` only; everything else stays default-deny), 13 derivatives in `public/media/the-bha-riverside/`, generator script and manifest.
- **Backend** — `RiversideDemoSeeder` + `RiversideDemoCatalog` (Infrastructure) and the operator command `--seed-riverside-demo` (Api). Insert-only, natural keys, one transaction, idempotent; refuses anything but Development, requires `--expected-database` equal to `current_database()` and containing `demo`/`showcase`, exactly one of `--dry-run`/`--apply`, explicit `--from`/`--media-base-url`; exit codes 0/1/2/3/4; never prints connection details. Operator edits (names, prices, status, covers) are never reverted; conflicts stop the run.
- **Trusted proxy** — `Hosting:TrustedProxy` (off by default): `X-Forwarded-For`/`-Proto` honoured only from listed proxies/networks; no implicit loopback/private range; empty, malformed or over-broad lists stop the host. `app.UseForwardedHeaders` is first in the pipeline.
- **Deploy artifacts** — `Back_End/Dockerfile` (+`.dockerignore`), `deploy/showcase/` (compose: PostgreSQL 17 with durable volume, API, nginx TLS terminator, durable key volume; `.env.example`; idempotent migration SQL and scripts), `.github/workflows/backend-image.yml` (build on PR and `develop` push; ECR publish gated off, develop-only), runbook `docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md`.
- **Not changed:** auth/session rules, SameSite, CSRF, idempotency, RBAC, API contracts, EF schema/migrations (9 before and after), packages, Admin_Web source.

## 2. OWNER_REPORTED vs VERIFIED

| Claim | Source | Status |
|---|---|---|
| Catalog: 1 Property, RIV-1BR 3 rooms, RIV-1BR-OPEN 2, RIV-2BR 6, max 2/2/4 | Owner | **VERIFIED** in the seeded DB (RIV-1BR 3 rooms/max 2, RIV-1BR-OPEN 2/max 2, RIV-2BR 6/max 4 = 11) and through the API/UI (2BR sells `rooms=4`, `rooms=7` returns none) |
| Prices ₫1,000,000 / 1,100,000 / 1,600,000 per apartment-night | Owner | **VERIFIED** in UI and DB (2 nights = 2.0M / 2.2M / 3.2M; 2BR ×4 rooms = 12.8M; reservation nights 1,000,000 each) |
| The photo folder is real photographs | Owner | **UNRESOLVED**: 62/86 files contain generator markers (signature not validated); 23 carry editor metadata (camera origin not verified); see §0 |
| Real address, description, amenities | — | **NOT PROVIDED**: placeholders ("Đang cập nhật"); amenities limited to pool and rooftop, which are visible in published photos |
| Deploy topology Vercel ×2 + API on AWS/RDS | Owner | **NOT_TESTED** (Owner executes; runbook only) |

## 3. Status lines (as of CP02/C1; `UI_LIVE` and `END_TO_END` are restated for C2 in §10)

| Line | Status | Evidence |
|---|---|---|
| `DATA_LOCAL` | **PASS** | Persistent PostgreSQL 17 demo DB `thebha_showcase_demo` (container `the-bha-showcase-postgres-1`, volume `the-bha-showcase_showcase-pg-data`, `127.0.0.1:55432`). 9 migrations via the idempotent SQL applied twice (second run no-op). Seeder dry-run 316 rows → apply 316 → rerun 0 inserts. Window 2026-10-07 .. 2027-01-04 (90 nights), media origin `https://localhost:3000`. |
| `MEDIA` | **PARTIAL** | 13 photographs (editor metadata present; origin not independently verified) published and served: every image URL the API returns answers `200 image/webp` (13/13, `smoke.sh`). 1PN types have no photo (§0). |
| `UI_LIVE` | **PASS** (Chrome headless, production builds, mkcert TLS) | Desktop 1440×900 and mobile 390×844: three room types, gallery with 3 thumbnails on 2BR, placeholders on 1PN, 16/16 Riverside `<img>` loaded after scrolling, no horizontal overflow (scrollWidth 390). Screenshots in the session scratchpad only. **Safari/WebKit: NOT_RUN.** |
| `CONTAINER` | **PASS** | Image builds; runs as non-root; `/health/ready` 200 through the proxy; with the database stopped it answers **503** (Docker's own health state still read `healthy` after 12 s — only the 503 is claimed) and returns to 200 after restart; key persistence proven twice (see §5). |
| `CLOUD_DATA` | **NOT_RUN** | No RDS touched; no local rows copied. |
| `PUBLISH` | **NOT_RUN** | Workflow gated off; nothing pushed to ECR. |
| `DEPLOY_LIVE` | **NOT_RUN** | Owner deploys. |
| `REVIEW` | **NOT_RUN** | Codex review pending. |
| Vercel | **NOT_TESTED** | |
| Stale-cookie 401 (CP01 defect) | **OPEN** | Not fixed (backend auth change). |

## 4. Browser/E2E evidence — SUPERSEDED by §10 (old single-page flow at `2bb70bb`; production builds against the containerized API, own DB)

- **Occupancy/quantity searches** (2 nights, 2026-10-18→20): 2 adults/1 room → 3 offers (₫2.0M, ₫2.2M, ₫3.2M); 3 adults → 2BR only; 5 adults/1 room → no offers (UI explains); 2 adults/4 rooms → 2BR only ₫12.8M; 7 rooms → none; 6 adults/2 rooms → 2BR ₫6.4M; a window past the seeded range → none; a past range → "checkIn cannot be earlier than the Property local date".
- **Happy path (1PN, 2026-10-11→13):** double-click Create Hold = **1** POST (201), double-click Confirm = **1** POST (201); header/brand navigation kept the same hold; guest GET with the token: hold `Confirmed`, reservation `Confirmed` total 2,000,000, nights 1,000,000 ×2; anonymous read 401. DB reconciliation: reservation `Confirmed` 2,000,000.00, 1 reservation unit, 2 nights ×1,000,000.00, hold `Confirmed`.
- **Lost response (2BR, 2026-10-13→15):** the confirm response was dropped at the network layer after the server handled it; the UI said it could not confirm whether the reservation completed and offered Retry; Retry replayed idempotently (200) → `Reservation confirmed`; hold `Confirmed`; still exactly one reservation for it (2 reservations in the DB in total).
- **Deny matrix (live Customer production build):** `/` 200; `/login`, `/signup`, `/listing-stay-map`, `/checkout`, `/pay-done`, `/subscription`, `/author/x`, `/api/x`, `/images/x.png` 404; `/showcase` 307; media: exact namespace `.webp` 200; wrong extension, `..`, other directory, unknown file 404. (`/_next/static/<missing>` returns 500 under `next start` on Node 22 — framework behavior, listed in the runbook.)
- **Admin same-site (Staff via CLI, Manager, password via environment only):** board without a session 401; login 200 setting only `.TheBha.Staff`; login with a foreign `Origin` 403; `me` 200 Manager; board 200 (11 rooms, 2 stays). Browser: `/calendar` unauthenticated → `/signin`; sign-in → `/calendar` shows The BHA Riverside, 11 rooms and both guests. **Controlled write:** one operational block (DEMO-1BR-01, 2027-01-02→04) created through the proxy → 201, then cancelled → 200; DB: segment `Cancelled`, 2 audit rows (`Created`, `Cancelled`) with actor `staff:<id>`.
- **Mobile 390×844 and C3 scroll regressions (real images loaded, production build, native scroll anchoring disabled to emulate Safari):** tap "Đặt phòng" → same document, `#booking` at 112 px under a 109 px header, first field visible, no horizontal overflow; catalog/room types arriving afterwards keeps the form in view (123 px vs 93 px header on desktop); from a denied page the header link is a client navigation to `/#booking` in the same document; **visitor takeover**: with `#booking` in the URL and the catalog pending, a deliberate scroll to the top stays at the top after the catalog arrives (scrollY 0).
- Assigning/moving through the Admin UI was not exercised in the browser (API-level write only).

## 5. Container, proxy and key-ring evidence

- Trust boundary (30 hosted tests): trusted peer + `X-Forwarded-Proto: https` over cleartext → Staff login 200 with a `Secure; HttpOnly` cookie and `me` 200; untrusted peer, trusted peer without the header, `http` header, feature off, and loopback-not-listed → 404; wrong `Origin` → 403; rate limiting partitions by the forwarded client and ignores entries a client prepended to the chain; a forged `X-Forwarded-For` from an untrusted peer buys no new partition; validation refuses empty/unspecified/malformed/over-broad (`/0`, wider than `/8`, IPv6 wider than `/32`) lists and limits outside 1..5; an enabled-but-empty configuration refuses to start.
- Key ring: the image deliberately does **not** set `DataProtection__KeysPath` — Production refuses to start without it (checked: the image run without it exits non-zero with `DataProtection:KeysPath must point to durable shared storage`), so a task launched without a volume fails loudly instead of running on ephemeral keys; the operator/compose sets `/var/keys` and mounts the volume. Through the real nginx and the real key volume — login, CSRF, `docker compose up -d --force-recreate api`, same cookie and token → `me` 200, logout 204 (re-run on the final image). Scratch check (`verify-key-persistence.sh`): same volume → 200/204; fresh volume → 401 and refused logout. The ASP.NET warning "No XML encryptor configured" confirms keys are stored **unencrypted** on the volume: required mitigation (encrypted EFS, restricted access point) is in the runbook; adding encryption needs packages/certificates and was out of scope.
- Stopping the database: readiness 503, recovery 200. **Risk observed:** the first request after the database restart (`/api/v1/properties`) returned 500 on a stale pooled connection (`57P01`) before succeeding; there is no EF retry strategy. An RDS failover or maintenance restart will 500 the first requests. Not fixed (out of scope).

## 6. Checks (all run in this session; PostgreSQL 17 throwaway container for backend tests)

| Check | Result |
|---|---|
| `dotnet restore` / `build -c Release` | 0 warnings, 0 errors |
| `dotnet test -c Release --no-build` | Unit **244/244**, Integration **827/827** (incl. 71 Riverside seeder/CLI/catalog, 30 trusted-proxy) |
| Customer_Web `npm ci`, `lint`, `tsc --noEmit`, `npm test`, `npm run build` | 0 / 0 / 0 / **456/456** (24 files) / 0 |
| Admin_Web `npm ci`, `lint`, `tsc --noEmit`, `npm test`, `npm run build` | 0 / 0 / 0 / **838/838** (36 files) / 0 (source unchanged) |
| `docker build`, compose up, `smoke.sh`, `verify-key-persistence.sh` (incl. the no-key-directory guard), the workflow's non-root/writable-`/var/keys` step run locally | pass (§3, §5) |
| `regenerate-migration-sql.sh --check` | up to date |
| `git diff --check` | clean (see PR body for the final run) |

## 7. State left in the persistent demo database (for the Owner)

2 Confirmed reservations from the E2E (guests "Gate Reviewer", 1PN 2026-10-11→13, ₫2,000,000; "Gate Lost Response Post", 2BR 2026-10-13→15, ₫3,200,000) with their Confirmed holds — they consume inventory on those nights; 1 cancelled operational block + 2 audit rows; 1 Staff account `showcase-e2e@example.test` (Manager) **disabled** after the run; the test Customer account used for the key check was deleted by exact email. Nothing else was edited. The volumes (`the-bha-showcase_showcase-pg-data`, `the-bha-showcase_showcase-api-keys`) and containers are left running. `the-bha-postgres-1` and the Owner database were never touched. Safe stop: `docker compose --env-file .env stop` in `deploy/showcase`; **never `down -v`**.

## 8. Deviations and risks

- The 100–400 line PR target does not apply (Owner, CP01); this PR is large because it carries 13 binary derivatives, the seeder, tests, the deploy artifacts and docs.
- `backend-image.yml` adds a new PR check (image build, no push) that runs when `Back_End/**` changes.
- The proxy test runs the same container topology as the runbook but on Docker, not AWS: ALB behavior, EFS permissions, RDS TLS and Vercel are all unverified.
- The room-type name styling (title case) comes from the existing template CSS; copy is still partly English (CP01 note).

## 9. Correction C1 (CP02-C1, same PR #83) — tooling, workflow and docs only

- **Range:** start `2bb70bbc2f3bae5001d14229afd182eb86c7f559` → FINAL_HEAD in the PR body. No runtime, seeder, schema, API, auth, proxy or media-byte change; the 13 derivatives are byte-identical (re-generation produced no diff). CP02 browser/E2E/container evidence above stays attributed to the start head and was **not re-run** (nothing it covers changed).
- **Provenance (F1):** scan rewritten to record markers/software/classification/`validation: NOT_RUN`; wording corrected here, in the runbook, SNAPSHOT, PROJECT_BIBLE §14.1 and the PR body; 10 Python `unittest`s (`test_build_media.py`: generic C2PA is not "generated", editor metadata is not "camera-verified", explicit markers are listed exactly, no metadata is unverified, validation never "run", manifest has no verified-camera claims) and the backend manifest-contract test updated to the new schema (a test file outside the allow-list, changed only because it asserted the old "no AI credentials" claim).
- **ECR (F2):** `backend-image.yml` now builds on PRs and `develop` pushes and publishes only from `develop` when `ECR_PUBLISH_ENABLED=true`, after the backend suite on the exact SHA with real PostgreSQL; missing role/region/repository with opt-in true fails the run; tag = source commit SHA (the PR head, not the merge commit), existing tag not overwritten; OIDC only in the publish job; no `pull_request_target`; no rollout. `workflow_dispatch` is kept but only works once the file is on `main` (GitHub requirement) and never publishes from another ref. Runbook §3 rewritten (trigger table, Owner set-up, manual Docker alternative, digest rollback).
- **Domain:** runbook uses `https://thebhariverside.com` (Customer), `https://admin.thebhariverside.com` (Admin), `https://api.thebhariverside.com` (API) as planned configuration; DNS/live `NOT_TESTED`. The local demo DB holds `https://localhost:3000` media URLs and must not be copied to RDS; RDS is seeded fresh with `--media-base-url https://thebhariverside.com`.
- **Verification actually run:** Python unittest 10/10; manifest regenerated, no diff in hashes/derivatives/associations; `RiversideDemoCatalogTests` and the full backend suite re-run (see PR body for counts); workflow YAML parsed and the publish-decision script executed over 12 event/config cases (PR, push develop with opt-in unset/false/true/missing role/missing region, push main, dispatch main/develop/feature with and without publish) — publishes only for `develop` + opt-in + full config; image build, non-root/`/var/keys` writable and the Production-without-KeysPath guard run locally with the workflow's own commands. **NOT_RUN:** a YAML expression linter (none installed, none added); any AWS/ECR action; the `publish`/`verify` jobs on GitHub (they are skipped by design and will first run after merge when the Owner opts in).
- Review recorded earlier: Codex `/codex:review --base origin/develop` at `2bb70bb`: RUN, "no actionable defects" (Owner-forwarded). That result concerns the pre-C1 version; **C1 needs a new review** (`REVIEW: NOT_RUN` for the C1 head).
- Known limits unchanged: DB-restart first-request 500, unencrypted key XML, stale-cookie 401.

## 10. Correction C2 (CP02-C2-R2, same PR #83) — Chisfis home page and room details

- **Range / traceability:** start `2e3c231face5a662c5cc04ef114a2432becadeb0`; all UI evidence below was taken on the build of commit `1b7e581dfe85526b7075924147b56de5394e3a6a` (`NEXT_PUBLIC_API_BASE_URL=https://localhost:7443`, `next start` behind a mkcert TLS proxy at `https://localhost:3000`, API container + the persistent demo DB). Commits after it are documentation only. FINAL_HEAD and CI are in the PR body.
- **Scope:** `Front_End/Customer_Web/` only (the whole C2 range touches no other directory): 62 files, +2,331/−1,792; **binary files changed: 0** (`git diff --name-only 2e3c231..HEAD -- '*.webp' '*.png' '*.jpg' '*.svg'` is empty; the 13 published photographs are untouched). No backend, seed, deploy, workflow, auth/session/CSRF/idempotency/CORS, provider lifetime, coordinator or anchor-engine change.

### What the Owner asked for, and what exists now

| Area | Result |
|---|---|
| `/` | The Chisfis home composition again, in the template's order: hero, categories slider, features, **Featured places to stay**, how-it-works, discovery slider, newsletter, authors, categories box, become-an-author, types slider, videos, testimonials, footer. `app/page.tsx` composes it; `app/layout.tsx` is the template layout (sticky header, footer + mobile app bar) with `BookingHoldProvider` above everything. `/showcase` and `/home-2` still redirect to `/`. |
| Featured places to stay | `SectionGridFeaturePlaces` + `HeaderFilter` (template) with three static tabs in order **The BHA Riverside / The BHA House / The BHA Villa**; Riverside default. Riverside: `GET /api/v1/properties` → the Property with slug `the-bha-riverside` (no `properties[0]` fallback) → `GET …/room-types` → **three room-type cards** (`RoomTypeStayCard`, StayCard2 markup with `GallerySlider`). House/Villa: "Sắp ra mắt — chưa hỗ trợ đặt phòng trực tuyến", no API call. Loading / error+retry / not-found / empty are separate states; no demo listing, no endless spinner button, no mock "View all". |
| Cards | Gallery, title and price row all link to `/listing-stay-detail?propertyId=<id>&roomTypeId=<id>` for **their own** RoomType (3 distinct ids, 1 property id). No price is shown: the catalog has none, so the row says "Chọn ngày để xem giá". No "còn N phòng" claim. |
| `/listing-stay-detail` | The template route, now one RoomType: validated query, resolved against the API (property, then room type of that property), loading/error/retry, explanations for missing / malformed / duplicated / unknown-property / unknown-or-mismatched room, never a default room. Template layout kept: top mosaic gallery (API images; 0 images → neutral block; 1PN has none), `listingSection__wrap` content blocks (room info, amenities, "Không gian chung" = property photographs labelled as shared, other room types, check-in/out times), sticky sidebar. |
| Booking | The sidebar is the **single** booking panel for desktop and mobile: dates/guests/rooms → availability locked to this room (only this RoomType's offers) → offer → contact → hold (CSRF + idempotency as before) → confirm → confirmation number and nightly snapshot, all on the details page. A fixed mobile bar (replaces the template's checkout modal) scrolls to that panel and states whether a booking is in progress. |
| Hold across navigation | `BookingHoldProvider` unchanged at the root; links to `/#rooms` are client navigations. A booking in progress shows a "Tiếp tục đặt phòng" link on the home page and on any other room, which has no form while it is in progress. |
| Routing | `/listing-stay-detail` is now `pass`; the rest of the listing group, checkout, pay-done, login, signup, account, car/flight/experience/real-estate pages, `/api/*` stay 404. |

### Template reuse, preview and removed content

| Item | Treatment |
|---|---|
| Reused as is / with small props: `SectionHero`, `BgGlassmorphism`, `SectionGridFeaturePlaces`, `HeaderFilter`, `StayCard2` markup, `GallerySlider`, `listingSection__wrap`/`listingSectionSidebar__wrap` layout, `ListingImageGallery` + modal, `Footer`, `FooterNav`, `MenuBar`, `Logo`, header frame (`MainNav2`) | live or structural |
| Service preview (inert, labelled "Dịch vụ đang được phát triển · Nội dung mẫu", placeholder frames, no request): categories slider, our-features, how-it-works, discovery slider, newsletter, authors, categories box, become-an-author, types slider, videos, testimonials; hero tabs Experiences/Cars/Flights | `ServicePreview` makes the block `inert`; images are `PreviewImage` (neutral frame/inline SVG, no template or Pexels request, 0 external requests measured); sample copy carries no brand claim (tests assert no "The BHA"/"Riverside"/vendor name) |
| Removed from the public site | header demo "Customize" panel (header/home-demo switchers), template dropdowns, language/notification/account controls, "List your property", "Get Template", social links, footer placeholder menus, wishlist/login in the mobile bar, `LikeSaveBtns`, CP01 demo banner (the footer note remains) |
| Removed from the details route | `PHOTOS`/`Amenities_demos`/USD prices/rating/Beach House/host Kevin Francis/reviews/Google-Maps embed/rates table/cancellation text, `SectionDateRange` (not mounted), "Reserve → /checkout", `ModalReserveMobile` (checkout `PageMain`), `MobileFooterSticky` (2023 dates, $311), the layout's template gallery and extra marketing sections |
| Hero | right picture is the published Riverside photograph `rooftop-pool-day.webp` (template illustration has no rights evidence); search form is a pill that goes to the room section |

### Evidence (C2 build `1b7e581`, Chrome headless, desktop 1440×900 and touch emulation 390×844, production build)

| | Result |
|---|---|
| **H1 HOME** | 3 tabs in order; Riverside renders 3 room-type cards (Căn hộ hai phòng ngủ, một phòng ngủ, một phòng ngủ view thoáng) from the API; House/Villa show "Sắp ra mắt", 0 API calls while on them; back to Riverside renders the same 3; mobile: same, `scrollWidth` 390 = viewport; 0 requests to Pexels/Unsplash/etc. Screenshots below. |
| **H2 LINKS** | 3 distinct `roomTypeId`, 1 `propertyId`; each card opens its own room (title/URL checked); direct URL, reload, and the photo modal (`modal`, `photoId`) keep the identity: open → `…&modal=PHOTO_TOUR_SCROLLABLE`, photo → `…&photoId=0`, Esc closes the photo only, back arrow closes the tour → identity only; 390 px touch the same. Missing / one id / malformed / duplicated / unknown property / unknown room → explanatory page, 0 POST, no Beach House, no form, no `$`. |
| **D1 DETAILS** | API data only; 2BR gallery 3 photographs (mosaic), 1PN neutral block; property photographs under "Không gian chung"; Property amenities (pool, rooftop) labelled as shared; no beds/baths/area/address/map/reviews/host/price table; picture failures drop the picture (probe + `onError`), never swap it. |
| **D2 AVAILABILITY** (dates 50 nights ahead, API values) | 1PN 2 adults → ₫2,000,000 (3 available); 1PN view thoáng → ₫2,200,000 (2); 2PN 4 adults → ₫3,200,000 (6); 2PN 2 rooms → ₫6,400,000. Over occupancy (1PN 3 adults, 2PN 5), over inventory (2PN 7 rooms, 1PN 4 rooms), outside the seeded window → "No offers for <room> …"; past date → server validation message. 0 POST. Only the viewed room's offers ever appear. Prices come from the response, none are hard-coded. |
| **D3 END-TO-END** (desktop and touch) | `/` → Riverside card → details → search → offer → contact → hold → confirm: **1 POST** `booking-holds` (201) and **1 POST** `confirm` (201) despite double-click on each; same document throughout (marker kept). Guest GET with the one-time token (never printed): hold `Confirmed`, reservation `Confirmed`, total 2,000,000, nights 1,000,000 ×2; anonymous read 401. **DB:** Reservation `Confirmed` 2,000,000.00 with a confirmation number, `SourceHoldId` = the hold, exactly 1 reservation per hold, 1 unit, 2 nights ×1,000,000.00, hold `Confirmed`. |
| **D4 RACES** | Hold kept through the brand link, "← Tất cả phòng" (`/#rooms` client navigation), the header "Phòng nghỉ" link and the mobile-menu item; "Tiếp tục đặt phòng" returns to the same hold. Opening room B while A's hold is active: B shows the notice + link to A, **no form**, no A hold shown under B, 1 hold POST in total, 0 availability searches on B, A's hold intact. Room A → B (same pathname, B's catalog response held) → Back to A → B's late response released: page stays A (aborted request cannot overwrite), 0 POST. **Lost response:** confirm response dropped after the server committed (Fetch interception of the POST *response*, not a preflight): UI "couldn't confirm", no auto-retry (1 confirm POST after 6 s), manual exact retry → `200` replay → "Reservation confirmed"; DB: the hold has exactly 1 Reservation (`Confirmed`, 3,200,000.00). |
| **D5 MOBILE** | 390×844 touch: tabs (incl. Villa) and cards usable, no overflow (`scrollWidth` 390); details gallery/modal open+close; one panel for both viewports; the fixed bar's top is at 783 of 844 px; focused full name / email / phone / submit all end above the bar (rect bottom < bar top 783); keyboard Tab through the hold form shows a visible focus indicator on every stop. **Safari/WebKit: NOT_RUN.** |
| **R1 ROUTES** | `next start -H 127.0.0.1`: `/`, `/?ref=demo`, details 200; `/home-2`, `/showcase` 307 to the same origin keeping the query; `/login /checkout /listing-stay /listing-stay-map /listing-car-detail /pay-done /signup /author /api/x` 404; media 200 / wrong extension 404; JS/CSS/font/`icon.jpg` 200; also on `https://localhost:3000`. Link sweep desktop+mobile (+menu open): every non-inert link answers 200; the 41–44 template links are inside inert previews; clicking sample CTAs changes nothing and sends no request (prefetch disabled on sample cards). No `/checkout` link on the details page. |

Screenshots (opened and read in this session, scratchpad `…/scratchpad/cp02run/final/`): `home-desktop-full.png` (+`-upper`, `-lower`), `journey-desktop-offers.png`, `journey-desktop-hold.png`, `journey-desktop-confirmed.png`, `journey-mobile-offers.png`, `journey-mobile-hold.png`, `journey-mobile-confirmed.png`; earlier checkpoint views `…/shots2/home-desktop-rooms.png`, `home-mobile-pair.png`, `detail-trio.png`. Raw evidence JSON: `…/scratchpad/cp02run/evidence/`.

### Automated checks (Customer_Web, Node 22.23.2)

`npm ci` ok · `npm run lint` 0 · `npx tsc --noEmit` 0 · `npm test` **30 files, 539/539** (new: `featuredBrands`, `roomDetailsRoute` incl. query/mismatch/offer filter/booking status, `routePolicy` 114 incl. the details allowlist and lookalikes, home section first render, `ServicePreview`/`PreviewImage`/brand-free sample sections, details root without a room, public navigation links) · `npm run build` ok with no prerender warning. Backend and Admin were not touched by C2 (CI runs both on FINAL_HEAD).
The node-environment tests cannot run effects, so tab switching, data rendering, query handling at runtime and the races were verified in the browser (above), not by a fake DOM.

### State left in the persistent demo database

11 `Reservation` rows in total, all `Confirmed` (2 from CP02, 9 from C2 E2E runs: 1PN and 2PN stays, check-in dates between 2026-10-11 and 2027-01-02), several `Active` holds that expire on their own (15 min) from the other-room and aborted runs, no customer accounts, the Staff account still disabled. The demo stack is the one from CP02 (`the-bha-showcase-*`, volumes kept).

### Deviations (scope notes the MEP asked to disclose)

- Files edited **outside** the MEP's edit list, each because the listed file could not meet the requirement on its own: `CardCategory3/4/5`, `CardCategoryBox1`, `CardAuthorBox`, `CardAuthorBox2`, `shared/Avatar.tsx` (they render the sample pictures, so the placeholder frames needed them to use `PreviewImage`; the cards also got `prefetch={false}` so sample links do not prefetch denied routes); `shared/MenuBar.tsx` (accessible label on the menu button); `shared/Navigation/NavMobile.tsx` (rewritten: it carried "Get Template", language and social controls); `components/listing-image-gallery/*` (API images, `unoptimized`, no trailing-slash push that lost the query); `components/GallerySlider.tsx` (`unoptimized`, `onImageError`); `app/(client-components)/(HeroSearchForm)/*` (stay form, preview wrapping); `routePolicy.test.ts`. The site-wide `shared/Button` change considered earlier was **not** kept.
- New files: `PreviewImage`, `ServicePreview`, `RoomTypeStayCard`, `featuredBrands`, `roomDetailsRoute` (the MEP allowed this helper), `HomeFeaturedRooms`, `RoomDetails{Root,Content}`, `RoomHeaderGallery`, `MobileBookingBar`, six test files. Deleted template files: `showcase/page.tsx`, `ShowcaseShell`, the stay detail's `StayDatesRangeInput`, `GuestsInput`, `constant.ts`, `MobileFooterSticky`, `ModalReserveMobile`.
- **Date inputs are the native date inputs** of the existing availability form, laid out in the template's sidebar card, not the template's pop-over date/guest pickers (one draft/one coordinator, testable, accessible); the guest counts are the existing number inputs.
- An extra "Loại phòng khác" block links the other room types of the Property (needed for same-pathname navigation and the race test).

### Known leftovers / visible changes (not fixed)

- Dead components still compiled through the template `home-2` page (`SectionGridFeatureProperty`, `SectionGridRoomTypes`, `PropertyLiveCard`, `RoomTypeLiveCard`); they are unreachable (the route redirects).
- Booking-flow labels stay English (Search availability, Hold this room …); Vietnamese is used in the new chrome. The offer card's `capitalize` class title-cases Vietnamese names there.
- Hard reload still drops the in-memory hold and token (unchanged); stale-cookie 401 still **OPEN**; DB-restart first-request 500, unencrypted key XML unchanged.
- `MEDIA: PARTIAL` unchanged: 1PN rooms have no published photograph (placeholder); provenance policy untouched.
- No cloud, DNS, Vercel or Safari testing; `PUBLISH`/`DEPLOY_LIVE` `NOT_RUN`. This is a local rehearsal, not a commercial-readiness certificate.
- **REVIEW:** the Codex results above (and in C1) concern earlier heads. C2 needs a new review of the final head: `NOT_RUN`.

## 11. Reviewer focus (requested)

Seed target safety and idempotency; media mapping and provenance claims versus evidence (C1); proxy trust boundary; container key storage; deploy boundaries (nothing publishes or deploys by default); ECR trigger/default branch/source SHA/no privileged PR (C1); for C2: tab/RoomType identity, details query and races, gallery and group layout, sidebar/mobile sharing one draft, guest hold across navigation, exact retry, default-deny routes.
