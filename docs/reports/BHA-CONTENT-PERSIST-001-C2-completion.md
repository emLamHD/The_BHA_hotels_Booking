# BHA-CONTENT-PERSIST-001-C2 — the five findings of the second Codex review (completion report)

- **WORK_ITEM** `BHA-CONTENT-PERSIST-001-C2` · branch `feature/bha-content-persist-001` · Draft PR https://github.com/emLamHD/The_BHA_hotels_Booking/pull/131 (into `develop`, unchanged) · base `origin/develop` `9e792ba` · **START_HEAD** `8a5583f` (verified before editing: working tree clean, PR open and draft, head equal to the remote's) · **CODE_HEAD** `3e7ad99` (the commit that adds this paragraph follows it and changes only this file; the PR head is the `FINAL_HEAD`). **CI on `3e7ad99`:** Backend pass (unit 676, integration 1322 on PostgreSQL, 23 m 1 s — all 25 content-pack tests ran there), Admin pass, Frontend pass, Vercel previews pass. **PR size from GitHub:** +8234 -16 in 113 files (C1 head: +7,753 / −16 in 111 files); the C2 growth is the 6 new tests, the report and the local code changes.
- Implementer Claude, reviewer Codex (invoked by Owner), merge Owner.
- **IMPLEMENTATION: PASS · DEPLOYMENT_SIMULATION: PASS · REVIEW: NOT_RUN · PRODUCTION_VERIFICATION: NOT_RUN.**
- **Schema:** none. No migration added (the ledger of C1 is unchanged). **Inventory:** unchanged — the pack is the same 804 rows / 36 tables / 43 files. No frontend, API or Admin change. The importer was **not rewritten**: the changes are local (one reorder, three guards, one filter, one check, one nullable).

## 1. The five findings

All five were reproduced on `8a5583f` with regression tests (`ContentPackC2Tests`, 6 tests) before any fix: 6 of 6 red, the log is kept in `~/bha-content-backup-20261026/c2-red-run-on-8a5583f.log`; after the fix 6 of 6 green.

| # | Cause | Change | Before → after |
|---|---|---|---|
| **F1 P1** staff lock | the importer's own advisory lock does not coordinate with the Admin writers, which all take `pg_advisory_xact_lock(BookingAdvisoryLockKeys.ForWebsiteSettings())` through `WebsiteTransaction.InLockAsync` (hero, menus, social, currencies, languages, translations, language packs); and it read the hero/menu "pristine" state, the references and the ledger **before** its transaction | the transaction starts first; the importer's own lock is taken (non-blocking), then, when the `website` group is written, the website-settings lock (blocking, `lock_timeout` 60 s, then a clear stop with nothing written), **then** every read that decides anything (references, pristine flags, ledger, file plan); both are held to commit/rollback; the order is the same everywhere (importer's key, then the website key; the staff writers take only the second: no cycle). `dry-run` takes them too (same transaction, rolled back); `verify` reads one snapshot and takes none. A configuration row is updated `WHERE … AND "Version" = <the version read under the lock>`, so nothing committed since can be overwritten (0 rows → CONFLICT, nothing written) | **Before:** the importer never waits for the website lock (`TimeoutException: nobody is waiting`). **After:** (1) the staff hold the lock and have an uncommitted hero edit → the import waits (confirmed by `pg_locks`, no sleep), the staff commit, the importer reads the new state and **keeps the staff's hero**; (2) the importer holds the lock (test seam, explicit signals) → the **real** Admin writer `IWebsiteSocialSettings.SaveAsync` starts, is seen waiting in `pg_locks`, the importer commits, the save then **succeeds** (the writer really takes part in the protocol, not only another importer); (3) a failed import (a slug conflict) rolls back and **both** locks are immediately free (`pg_try_advisory_xact_lock` true) |
| **F2 P2** edited collections | `PrepareConfigTableAsync` only skipped *deleting*; `ProcessTableAsync` still inserted every absent pack child | for `WebsiteHeroSlides` / `WebsiteHeroMedia` / `WebsiteMenuItems`: when the target's parent row is edited, an absent pack child is **not added** (counted as kept, listed "kept (the target's collection was edited)"), the pack's uploaded hero pictures are not copied, and `verify` does not call them missing. **How it is told apart, from the system's own data, never from the ledger:** every Admin save of a hero or menu calls `Saved(...)`, which raises `Version` above 1 and records `UpdatedByStaffId` (checked in `WebsiteHero.cs`, `WebsiteMenu.cs`, the services above); a row still at version 1 with no author has never been saved by staff | **Before:** the staff's 1 slide + the pack's 4 (and the removed menu item restored). **After:** slides replaced by the staff stay 1, a removed menu item stays removed, an emptied menu stays empty (0 items), `dry-run`/`apply`/`verify` exit 0; a database whose collections are still the migration's receives the pack's whole (4 slides, 54 items). Also on the Production image (§2) |
| **F3 P2** legacy hash | `row["OriginalSha256"]!.GetValue<string>()` on a JSON null | read as nullable; the size recorded in the row is still checked and the pack carries the file's own sha256 | **Before:** `NullReferenceException`. **After:** a legacy picture (null hash, generation 0, original present) exports and imports, the import's pipeline gives it variants; original missing → `PROBLEM: <key> … missing`, exit 1, no stack trace, no pack; a recorded hash that is not the file's → "does not match", exit 1. The source database is not touched and no backfill is needed |
| **F4 P2** scoped export | a Blog revision is exported whatever the property scope | the exporter checks **every** exported `BlogPostRevisions` row (history included) for `propertyIntro` ids outside the export and **refuses**, naming the property and the revisions (5 shown) and what to do; no pack is left behind. Chosen over filtering because dropping revisions or blocks would change content silently | **Before:** `--property-slug the-bha-riverside` reported success and the pack failed to import. **After:** refused (exit 1) with `the Blog needs the property 'the-bha-hotel' (…): 5 revisions have a propertyIntro block for it (…)`; a source without such revisions (catalog and offers only) exports scoped and imports into an empty database; the full two-property export is unchanged. The runbook no longer presents the scoped export as a way to leave the dev property out |
| **F5 P2** deleted pictures | the file plan ignored the ledger decision | pictures whose row an import placed and that are absent now (BlogMedia, PromotionMedia, hero uploads) are left out of the file plan unless `--restore-deleted`; the output lists them with their key; `verify` and `apply` do not count or copy their files | **Before:** `apply` re-created the file without its row and `verify` failed. **After**, with the real `IAdminBlog.DeleteMediaAsync` on a picture of the pack nothing uses: row and files gone; `dry-run`, `verify`, `apply` all exit 0 with `deleted since the import (not put back): BlogMedia <id> (<key>)`, row and file stay absent, the file count does not change; `--restore-deleted` restores row (generation ≥ 1, variants rebuilt) and file, `verify` exit 0; a further `apply` adds no row and no file (41 pictures, same file count) |

## 2. Acceptance

| Scenario | Evidence |
|---|---|
| **Full pack → new database** | `ContentPackTests.A_…` (2 properties, 5 room types, 14 rooms, 208 rates, 35 media, 4 offers, 23 posts, 40 pictures + 240 variants) — green after C2 |
| **Staff edits before the first import** | F2 tests and the **Production image**: hero with a slide of its own and a removed menu item, then `apply` through `deploy/content/import-content-pack.sh`: the staff's title and slide kept, the 4 pack slides and the removed item not added (listed), 798 rows match, 6 keep the target's version, 0 missing, `verify` and a rerun exit 0 |
| **Different ids** | the C1 tests (`B_a_database_loaded_by_the_earlier_route…`, `The_targets_own_property…`, F1/F3 of C1) — green after C2 |
| **Scoped export / import with the Blog dependency** | F4 test and the same refusal from the Production image (exit 1, property and 5 revisions named, nothing left behind) |
| **Legacy and deleted pictures** | F3 and F5 tests |
| **Rerun after failure and success** | the C1 S3/S4 tests, F1(3) (a failed import releases both locks and writes nothing), the container reruns — all green |
| **Production image, durable storage, recreate** | `Back_End/Dockerfile` image (`ASPNETCORE_ENVIRONMENT=Production`), named volumes: import by the wrapper, API container, snapshot of 62 API projections and 309 API-served pictures (200 each); the differences from the source are exactly the hero, menus and config endpoints (the staff's own edits kept: 42 items), 0 picture sha256 differences; `docker rm -f` and a new container on the same volumes: **0** differences |
| **C1 guarantees** | the 19 C1 content-pack tests (mapping, selected groups, snapshot export, variant hash check, configuration preservation) — green; the full suite below |

## 3. Checks

`dotnet build Back_End/TheBha.Booking.sln -c Release` (0 errors) · content-pack tests **25/25** (`ContentPackTests` 8, `ContentPackCorrectionTests` 6, `ContentPackScopeTests` 5, `ContentPackC2Tests` 6) · **unit 676/676, integration 1322/1322** (20 m 13 s locally) and CI as above. Frontend untouched.

**NOT_RUN:** production (no hosting in the repository; values to fill in: runbook §2); a managed PostgreSQL other than the local 17; a second browser engine; the Chrome-extension path (the project's Playwright-on-Chrome recipe was used in C1; C2 needed no browser: it changed no page). The catalog, offers and Blog writers have their own locks and are **not** under the website lock (stated in the runbook): a staff change to them during an import is handled by the transaction and the unique keys, not by that lock.

## 4. Known and recorded, not changed here

* Admin "Cơ sở & loại phòng" labels the development property "The BHA Riverside" (a mapping in `CatalogWorkspace.tsx`), so with both properties in the pack two entries have that name and the dev one is selected first (recorded in C1; **no frontend change** in this correction).
* Rates end on 2026-12-25 (the source's values, not extended).
* The dev property can not be left out of this content by a scoped export (F4); doing so needs a separate piece of work on the five revisions.

## 5. Clean-up

The Production-image resources (container, volumes, image, scratch database, env and certificate files) were removed. The source database, the source stack (3000, 3001, 3100, 7145) and `~/bha-content-backup-20261026/` (with the C2 red log) were left as they were.

## 6. Handoff

`ACTIVE_EXECUTOR` has stopped writing. Owner invokes the review (Claude does not):

```
READY_FOR_CODEX_REVIEW
Owner must now invoke:
codex review --base origin/develop
```
