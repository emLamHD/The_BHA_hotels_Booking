# CUST-WEB-SHOWCASE-001-CP02 — Riverside showcase: photos, catalog, demo seed, deploy artifacts

> Draft PR into `develop` (the second and last PR of the showcase work item). `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes). Baseline `9ad8edce4171f9b26a3f274cd544758be21f9162`, branch `feature/cust-web-showcase-001-cp02-riverside-demo`. FINAL_HEAD, PR number, PR size and CI on FINAL_HEAD are in the PR body. `REVIEW: NOT_RUN`.

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

## 3. Status lines

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

## 4. Browser/E2E evidence (production builds against the containerized API, own DB)

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

## 10. Reviewer focus (requested)

Seed target safety and idempotency; media mapping and provenance claims versus evidence (C1); proxy trust boundary; container key storage; deploy boundaries (nothing publishes or deploys by default); ECR trigger/default branch/source SHA/no privileged PR (C1).
