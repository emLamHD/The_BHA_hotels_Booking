# BHA-CONTENT-PERSIST-001 — website content survives a deploy (completion report)

- **WORK_ITEM** `BHA-CONTENT-PERSIST-001` · branch `feature/bha-content-persist-001` · base `origin/develop` = `START_HEAD` `9e792ba3a7ab` (PR #130 merged; no open PR, no other writer) · implementer Claude, reviewer Codex (read-only, invoked by Owner), merge Owner.
- **Draft PR:** https://github.com/emLamHD/The_BHA_hotels_Booking/pull/131 (into `develop`). **Code head** `dacf290`; the commit that adds this paragraph follows it and changes only this file (the PR head is `FINAL_HEAD`). **CI on `dacf290`:** Backend pass (unit 676, integration 1305 on PostgreSQL, 16 m 32 s — the 8 `ContentPackTests` ran there, on the committed pack), Admin pass, Frontend pass, Vercel previews pass.
- **IMPLEMENTATION: PASS · DEPLOYMENT_SIMULATION: PASS · PRODUCTION_VERIFICATION: NOT_RUN · REVIEW: NOT_RUN** (Claude does not invoke Codex).
- No migration, no change to any public or Admin API, no frontend change. New: an operator command in the API image, a content pack, tests, a runbook.

## 1. What was found (inventory, before any edit)

The source is the database that serves the website the Owner has been looking at (`thebha_blog_demo`, API Release build, Customer production build, Admin), compared table by table with a database that has only the migrations (`thebha_baseline_tmp`), plus the media directory (283 files) and the repository's static photographs. Backed up first (`pg_dump`, media, tools, sha256 manifest, public-API projection) outside git and outside the scratchpad.

| Group | Rows / files in the source | Found by |
|---|---|---|
| Catalog of the property `the-bha-riverside` | Properties 1 · Amenities 2 · RatePlans 1 · RoomTypes 3 · PropertyAmenities 2 · PhysicalRooms 11 · DailyRoomRates 180 · Media 31 · PropertyMedia 10 · RoomTypeMedia 21 | baseline diff |
| Offers (Ưu đãi) | Promotions 4 · PromotionRoomTypes 3 · PromotionMedia 3 (+3 files `promo/`) | baseline diff |
| Blog | BlogCategories 5 (+10 translations, 10 slugs) · BlogPosts 23 · translations 30 (vi 23, en 7) · slugs 30 · revisions 35 · revision categories 35 · revision media 66 · pins 6 · BlogMedia 40 (originals 24,834,428 B; 240 variants) | baseline diff |
| Active languages | `en` switched on (the only difference from the migration defaults in the website configuration; hero, menus, social, currencies, translations were compared and match) | baseline diff |
| **Not content, listed with a reason in the manifest** | StaffAccounts 1, StaffPropertyMemberships 2 (people); BlogAudits 159, PromotionAudits 4 (history of the source's Staff); BlogMediaVariants 240 (rebuilt by the pipeline); identity tables; schema history | — |
| **Booking / test-transaction tables** | Reservations, ReservationUnits(+Nights), InventoryHolds(+Items, +ItemNights), RoomBlocks, RoomOccupancySegments(+Audits), BookingPromotionApplications, AdminCatalogCreateOperations, CatalogContentAudits, CatalogUploads: **all 0 rows** — nothing to convert or exclude | — |
| **Owner decision (open): the development fixture property** | `the-bha-hotel` (Ho Chi Minh City, `images.example.com` pictures) with 2 room types, 3 rooms, 28 rates, 2 inventory controls, 4 amenities — made by `--seed-development`, **not reachable from any Customer page** (the stay search finds the property by the slug `the-bha-riverside`), left out and named in `manifest.excluded`. Including it is one flag at export time. | code + data |

Also checked: every picture row has its file with the recorded sha256 (40/40 originals, 240/240 variants, 3/3 covers); several Staff columns of the Blog tables are NOT NULL (`BlogPosts.CreatedByStaffId`, `BlogMedia.CreatedByStaffId`, revisions, translations, pins; the others are nullable), so the importer needs an existing Staff to record as author (`--actor-email`); the Blog translation ↔ revision foreign keys form a cycle (handled in two passes); the Customer renders every page per request (route table: all `λ`), so nothing is baked at build; the promotions have no validity dates; the rates end on 2026-12-25.

## 2. What was built

* `deploy/content/bha-site-content/` — **the pack**: `manifest.json` (tables with row counts and sha256, files with sha256, the 31 static pictures the catalog points at, active languages, exclusions with reasons), `rows/<Table>.jsonl` (563 rows in 27 tables, sorted by key, deterministic), `files/` (40 Blog originals + 3 promotion covers, 25.1 MB). No Staff id, no secret, no local address (the exporter refuses one; `Media.Url` carries a `{{MEDIA_ORIGIN}}` token).
* `TheBha.Infrastructure/ContentPack/` + `TheBha.Api/Seeding/ContentPackCommand.cs` — `--content-pack-export | --content-pack-import | --content-pack-verify`, any environment, `--expected-database`, `--dry-run | --apply`, `--groups catalog,promotions,blog`, exit codes 0/1/2/3/4. Rules: insert what is missing; keep what exists (staff edits win); use the target's own Property / RoomType / RatePlan / Amenity when it has the same slug or code under another id and re-point everything (including the Blog `propertyIntro` ids); keep the target's own night rates (same room type, rate plan and date, any id) and its own offers (same slug, any id) — added after rehearsing against a database loaded by the earlier route (see §3); every other collision is a CONFLICT, listed, nothing written; one transaction + advisory lock; pictures copied (temp + rename, identical skipped, different = conflict) just before the commit; Blog variants made by the existing pipeline; `en` activated only while it is still the migration default; a final verification. The exporter refuses an unclassified table, a damaged picture, a missing static photograph and a local address.
* `deploy/content/import-content-pack.sh` — the operator entrypoint (`dry-run | apply | verify`) around `docker run` of the API image; no connection string is ever printed.
* `docs/runbooks/BHA-CONTENT-PERSIST-001.md` — backup, order, commands, recovery, post-deploy checks, values still to fill in, limits. `docs/project/SNAPSHOT.md` updated.
* No CD workflow exists after the AWS retirement (`ci.yml` is the only workflow), so there is nothing to wire the import into; the entrypoint above is the supported route and the runbook says why `apply` must not run on every deploy.

## 3. Verification (real PostgreSQL 17, real files, real Chrome 153; commands in §5)

| Scenario | Evidence |
|---|---|
| **A. new database** | migrate → import `catalog,promotions` → create Staff → import all → `verify`; table-by-table normalized hash (staff columns and the picture origin removed) of all 25 content tables equal to the source on three imported databases (`BlogCategories` is compared without `Version` and timestamps: the featured category is the migration's own row, which the importer keeps, at `Version` 1 here and 2 in the source — an optimistic-lock token, not content); public-API projection (62 → 59 keys: only the excluded dev property is missing; 25 differing items = that property + one migration timestamp); **22 Customer pages in Chrome: status, title, h1, image count, whole text, links identical to the source; 0 broken images**; 343/343 picture URLs answer 200 with the same sha256 |
| **B. database that already has data** | `ContentPackTests`: catalog first, then everything — only the missing rows go in; a category slug owned by another category → exit 4, every conflict listed, 0 rows and 0 files written; the same command finishes after the conflict is removed; a property that exists under another id is used and the whole pack follows it (3 room types, 180 rates, 4 offers, Blog `propertyIntro` ids) |
| **B′. a database shaped like the one the earlier route produced** | `thebha_promo_demo` (one property, the same property/room-type/photograph ids, but a different seeding date: rate window 2026-10-22..2026-12-20, **165 overlapping nights with different ids**, 5 offers with **different ids** including one the staff made) restored with `pg_dump`/`pg_restore` into a scratch database (the original untouched), migrated to the latest schema, Staff given Blog access: `--dry-run` exit 0, no conflict: 165 nights identical (kept), 15 later nights added, the 4 offers mapped to the target's own (their links and covers left out, no cover file copied), the staff-made offer untouched, the Blog inserted whole; `--apply` + verify exit 0; rerun 0 inserts. **Red → green:** before this rule the same situation made every overlapping night a conflict (`23505 IX_DailyRoomRates_…`, exit 4), which would have forced the operator to delete the target's own rates; the new test `B_a_database_loaded_by_the_earlier_route…` fails on the earlier code and passes now |
| **C. rerun / staff edits** | rerun inserts 0 rows, copies 0 files; a staff edit of an offer title, a room-type name, a language switched off and — in Admin, in Chrome — a post's draft summary are all still there after a second `apply` (output: `kept (target differs from the pack)`; `en` "left inactive") |
| **D. failure half-way** | damaged pack (missing file, changed rows file) refused before the database is touched (exit 1); a file copy that fails after every row was accepted rolls the rows back (0 rows), and the same command finishes after the cause is removed |
| **E. Production mode** | the repository's `Back_End/Dockerfile` image (`ASPNETCORE_ENVIRONMENT=Production`) with named volumes for media and keys: import (`--dry-run`, `--apply`, `verify`) run as one-off containers, then the API container: 312 picture URLs served by the API (Blog variants, covers, hero) byte-identical (sha256) to the source — **variants regenerated by the pipeline are identical to the originals' variants**; `docker rm -f` and a new container on the same volumes: same result. A Production-mode API process + a `next build`/`next start` Customer on another database behaved the same |
| **Build-time data** | Customer built while the database was full, API database dropped and re-created **empty** (home shows none of the blocks), content imported, **no rebuild, no restart of the Customer**: the blocks and 13 blog links are there, and the 22-page comparison again shows 0 differences |
| **F. Browser acceptance** | Chrome (Playwright, system Chrome) on source and on the imported target: home (hero, offers, destinations, Riverside, news), `/riverside` and its 3 room-type pages, `/offers` and 4 offer pages, `/blog` (page 1, 2, English), 5 categories, 4 posts, an English post, draft/archived = 404, FAQ; Admin on the target: Blog posts (23, with statuses and covers), categories, picture library, Promotions (4 with covers), catalog (RIV-1BR, RIV-1BR-OPEN, RIV-2BR), post editor opens and a draft saves |

**Evidence for the offers (Ưu đãi):** 4 promotions, 3 room-type links, 3 cover files; the home block "Ưu đãi phòng" shows "Đặt sớm giảm 15%" and "Ở dài giảm 200.000 ₫ mỗi đêm" with their covers; `/offers` lists them and each detail page is identical to the source; an availability search returns `appliedPromotion` data identical to the source; Admin → Ưu đãi lists all 4 (including the draft); a staff edit of a title survives a rerun.
**Evidence for the room types (Loại phòng):** 3 room types, 11 rooms, 180 nightly rates, 31 photographs; the home Riverside block, the "Loại phòng tại The BHA Riverside" section of `/riverside` and the 3 detail pages are identical to the source (names, capacity, photographs, text); the availability search returns the same offers and totals; Admin → Cơ sở & loại phòng lists RIV-1BR, RIV-1BR-OPEN, RIV-2BR; a staff rename survives a rerun.

## 4. Checks run

`dotnet build Back_End/TheBha.Booking.sln -c Release` (0 errors); **unit 676/676**; **integration 1304/1304** on PostgreSQL 17 (15 min; includes the 7 new `ContentPackTests`: fresh database + dry run + rerun, staff edits, conflict, damaged pack + failed copy, wrong database / missing actor / local origin / group order, remap, export round trip + unclassified table); `git diff --check` clean; `bash -n` and a live run of the entrypoint against the Production image (dry-run, verify, apply, three usage errors). Frontend untouched, so no frontend suite locally; CI on the PR is above.

## 5. Commands that produced the evidence (secrets omitted)

```
dotnet ef database update …                      # scratch databases thebha_import_a/b/c, thebha_baseline_tmp (dropped at the end)
dotnet TheBha.Api.dll --content-pack-export --expected-database thebha_blog_demo --out deploy/content/bha-site-content --property-slug the-bha-riverside --source-media-origin https://localhost:3000 --public-dir Front_End/Customer_Web/public
dotnet TheBha.Api.dll --content-pack-import --expected-database thebha_import_a --pack … --media-base-url https://bha.example.org [--actor-email …] [--groups …] (--dry-run|--apply)
dotnet TheBha.Api.dll --content-pack-verify --expected-database … --pack … --media-base-url …
docker build -t thebha-api:content-persist-test Back_End ;  deploy/content/import-content-pack.sh dry-run|apply|verify   # Production image, named volumes
node snapshot.mjs <api> <customer> <out>  (public API + 8 pages + 343 pictures)   ·   node accept.mjs <label> <customer> <out> (22 pages in Chrome)   # tools kept in the backup directory
dotnet test Back_End/TheBha.Booking.sln -c Release --no-build
```

## 6. Deviations, risks, `NOT_RUN`, and what the Owner decides

1. **`PRODUCTION_VERIFICATION = NOT_RUN`.** Nothing was written to any real environment; no hosting is configured in the repository after the AWS retirement. Values still to fill in are in runbook §2 (image, database name, connection string, public Customer origin, durable media mount, key-ring mount, an existing Staff with Blog access).
2. **Dev property excluded** (§1) — Owner decision; one flag to include.
3. **Rates end on 2026-12-25.** After it the availability search returns no rooms, import or not (Admin has no rate management). Not extended; Owner decision and separate work. The offers have no validity dates.
4. **`apply` is not "undo-aware".** A row the staff deleted on purpose is absent, so a later `apply` adds it back; run it once per database, then use `verify` / `dry-run`. There is no import-marker table (that would be a migration, not authorized here).
5. **The content is sample content.** Pictures are Wikimedia Commons illustrations (licences recorded in the library and in each post's "Nguồn ảnh" line — keep them); the author "Ban biên tập The BHA", the facts and the placeholders of the catalog (address "Địa chỉ đang được cập nhật", the seeder's rate plan and room numbers) need the Owner's review before they are treated as published content. The pack preserves them exactly; the staff edit them afterwards and later imports keep the edits.
6. **No audit trail for the imported Blog/offer rows** (BlogAudits/PromotionAudits are history of the source's Staff, not content). Authorship columns carry the Staff named at import.
7. **Not separately tested:** a *post* slug collision (the category-slug collision and the shared rule `SlugOwner` are; both use the same code path), a real RDS/Neon/other managed PostgreSQL, a pack imported while the API serves traffic (done once against the running API container, no error), a second browser engine.
8. **Tests were written after the code** (no red run recorded); the conflict, rollback and staff-edit tests assert counts in the database, not messages only.
9. **Tooling and clean-up:** the Chrome extension disconnected mid-session; the browser evidence is Playwright on system Chrome (the project's usual recipe). At the end the temporary processes (ports 7245, 3200, 3300, 3201), the API container and its two volumes, the scratch databases (`thebha_import_a/b/c`, `thebha_rehearsal`, `thebha_baseline_tmp`), the copies of the Customer/Admin trees (they held the developer's `.env.local`) and the temporary certificate/env files were removed; the source database, the source stack (ports 3000, 3001, 3100, 7145) and the backup directory were left as they were.
10. **Website configuration is not part of a pack** (hero, menus, social, currencies, translations; only the active languages travel). It equals the migration defaults in this source, so this pack is complete; an export from a database whose staff edited it prints a warning and says so in the manifest, but does not carry the edits (runbook §7).
11. **PR size** from GitHub: +2,717 / −1 in 84 files, outside the 100–400 line target (`docs/governance/WORKFLOW.md` §6): ≈ 1,200 lines of code and tests, ≈ 1,175 lines of data (563 JSONL rows + the manifest) and 43 binary picture files (25 MB). The data and the pictures are the point of the work item (the rows can not be split from the files they refer to); the reviewable code is `ContentPack*` (≈ 850 lines) and `ContentPackTests` (343).

## 7. Handoff

`ACTIVE_EXECUTOR` has stopped writing. Owner invokes the review (Claude does not):

```
READY_FOR_CODEX_REVIEW
Owner must now invoke:
codex review --base origin/develop
```
