# BHA-CONTENT-PERSIST-001-C8 — the two findings of the eighth Codex review (completion report)

- **WORK_ITEM** `BHA-CONTENT-PERSIST-001-C8` · branch `feature/bha-content-persist-001` · Draft PR #131 (into `develop`, unchanged) · **START_HEAD** `294e9af` (verified before editing: tree clean, equal to the remote's, PR open and draft) · **CODE_HEAD** `e929e8f` (see §4 for `017dfe1`, the superseded first code commit). The commit that adds §4 follows it and changes only this file; the PR head is the `FINAL_HEAD`. CI: §4.
- Implementer Claude, reviewer Codex (invoked by Owner), merge Owner.
- **C8 tests: PASS (local) · REVIEW: NOT_RUN · PRODUCTION_VERIFICATION: NOT_RUN.** The C2 deployment simulation is not repeated and is not evidence for C8.
- **Schema / inventory / frontend / API contract / manifest:** none. One lock statement in `AdminBlogService.UpdateCategoryAsync` (a concurrency-rule change the C8 prompt authorised), one changed predicate in `ContentPackImporter.ResolveReferencesAsync`.

## 1. Findings and change

| # | Cause | Change |
|---|---|---|
| **F1** lock order | the importer (C5 F1) locks the category row first (`SELECT … FOR UPDATE`, `LockSeedCategoriesAsync`) and then writes the category's slugs and texts. `UpdateCategoryAsync` did it the other way round: it read the category **without** a lock, rewrote the old slug (set-based `UPDATE`, row lock on the slug) and only then updated the category row at `SaveChanges`. A rename in flight holds the slug and waits for the category; the importer holds the category and waits for the slug → `40P01` | `UpdateCategoryAsync` takes the category row lock **first** (`AdminBlogService.Categories.cs:163`, `SELECT 1 … FOR UPDATE` inside its transaction) and reads the category, checks `ExpectedVersion` and writes slugs/texts under it. Both writers now go category row → slugs/texts. A save that lost the race waits, then finds the version changed and is refused as stale (the existing contract); one that came first is seen by the importer's locked re-read (C5), which keeps the Staff's category, texts and slugs. No retry on `40P01` was added |
| **F2** property check | the promotions-group check demanded the property of **every** pack `Promotions` and `PromotionMedia` row, including offers mapped to the target's own (slug, other id) and covers in `_skipPromoMedia`, which the write step never writes | the check (`ContentPackImporter.cs:355` area) keeps only the offers **not** in `_maps["PromotionId"]` and the media **not** in `_skipPromoMedia`: the same two predicates the write step uses. A new offer, or a cover a new offer still needs (C7), keeps its check. The room-type check below it is unchanged (C7) |

## 2. Evidence

Red run on **START_HEAD `294e9af`** (the C8 tests added, the fixes absent): `~/bha-content-backup-20261026/c8-red-run-on-294e9af.log` — 3 of the 5 tests fail, 2 pass.

| | `294e9af` | C8 |
|---|---|---|
| **F1, importer first** — importer paused after taking the category lock (`categories-locked` checkpoint); Staff `UpdateCategoryAsync` renames the seeded category's English slug (`featured-destinations` → `staff-places`) and is released together with the import | **Reproduction:** the Staff save fails with `Npgsql.PostgresException 40P01: deadlock detected` (wrapped in the EF `DbUpdateException`) | Staff is seen waiting in `pg_stat_activity` on the category row; both tasks finish with no exception; the import is applied; the Staff save is refused as stale; one current slug `featured-places`, `featured-destinations` is history and redirects to it, `staff-places` was never written; verify 0 |
| **F1, Staff first** — a third session holds the old slug row; Staff's rename is stopped there; the import starts and the third session is released | the importer does not wait for the Staff's category at all (its lock is granted at once), so the test fails at its precondition (`the importer did not wait for the staff's category`). **This is a test that fails on the old ordering, not a second reproduction of the deadlock** | the importer is seen waiting for the Staff's category; both finish; the Staff save succeeds (version 2), the importer's locked re-read sees it and keeps the Staff's name, description and slug `staff-places`; the old slug redirects to it; the pack's slug was not added; verify 0 |
| **F2** — pack = committed pack; target: fresh database, **its own property** (not the pack's) and its own four offers (same slugs, other ids, own covers, own property), one of them with a real room-type link to a room type of the target's own property | `--groups promotions` dry-run: `PROBLEM: the promotions group needs the property 'the-bha-riverside' …` (non-zero) | dry-run, two applies and verify (`--groups promotions`) exit 0; offers, media rows, links, properties, room types and media files unchanged in count; a snapshot of every offer's `(slug, id, cover, property, links)` is identical before and after, the link included; no catalog row, no source cover file |
| **F2 guard** — the same target, but one pack offer (`ban-nhap-chua-mo`, no cover; or `dat-som-giam-15`, with a cover) is **not** the target's own | `PROBLEM … needs the property` | the same message, in dry-run and apply; offers, media rows, properties and files unchanged; verify non-zero |

The two F2 guards pass on both heads by design; the C7 tests (shared cover, room-type links) pass unchanged. The C5 test that waits for a held Staff save looked for `UPDATE "BlogCategories"`; the save now waits one statement earlier (the `FOR UPDATE`), so its pattern is `%"BlogCategories"%` (`ContentPackC5Tests.cs:112`); its assertions are unchanged and pass.

The F1 tests also read `pg_stat_database.deadlocks` (0). That counter is flushed with a delay, so it only corroborates; the evidence is that both tasks completed without an exception.

## 3. Checks (local)

- Build 0 errors; unit **676/676**.
- Private **PostgreSQL 17.10, `timezone = UTC`** (`select version()` and `show timezone` on the server used for this run): `ContentPack|Blog` integration filter **205/205**, of which the content-pack tests are **73** (listed with `--list-tests`: the 68 of C1–C7 and the 5 new in `ContentPackC8Tests`). CI's PostgreSQL is the `postgres:18.3` service container.
- The full integration suite ran in CI only.

## 4. CI and PR size

- **CI on `294e9af`** (C7 report-only head, the start of C8): https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/42750293190 — `conclusion = success`. A baseline; it says nothing about C8.
- **`017dfe1`** (first C8 code commit: both fixes, 5 tests): run 42762809304 — **cancelled**, superseded by the next push; not cited as evidence.
- **CI on `e929e8f`** (C8 code: adds a real room-type link and a before/after offer snapshot to the F2 test): https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/42763132125 — `conclusion = success`: Backend (unit 676, integration 1370 on PostgreSQL 18.3; the 73 content-pack tests ran there), Admin, Frontend.
- **The report-only commit after CI:** its diff is only `docs/reports/BHA-CONTENT-PERSIST-001-C8-completion.md` (this file). Its own CI status is stated in the completion message; the code it describes is `e929e8f`.
- **PR size from GitHub** (before this report): +10,557 −16 in 125 files (`294e9af` was +10,318 −16 in 123); outside the 100–400 line target as for C1–C7 (the pack, importer and tests of the work item). C8 adds one lock statement, one predicate, 5 tests, one wait-pattern change, two runbook sentences and this report.

## 5. Limits and decisions for OC

- **Lifts** the C5 report §3 limit "a Staff category save already in flight can deadlock with the import (`40P01`), not observed": it was observed, in the rename path, and is fixed; and the C7 §5 "adjacent, not changed" property check. Those reports stay as history.
- **`UpdateCategoryAsync` now takes a row lock first.** The API contract and error codes are unchanged; a concurrent save of the same category now waits for the lock where it used to fail later at `SaveChanges` (same stale result). Authorised by the C8 prompt as a concurrency-rule change.
- **Same class, not changed (outside the two findings):** `SetPinsAsync` (`AdminBlogService.Categories.cs:292`) reads the category without a lock and writes the pin rows before the category row is touched (`category.Touch`, line 344). The pack carries `BlogCategoryPins` (`ContentPackSpec.cs:69`). If the importer writes a pin row of a locked category while a pins save of that category is in flight, the same two-way wait is conceivable. Not reproduced, not tested, not verified that the importer writes such a row in that state. **OC decision** whether to take the category lock first there too (one statement).
- `DeleteCategoryAsync` reads without a lock and deletes the category row first (its slugs follow by cascade): no slug is held before the category, so no cycle with the importer was found.
- Production was not touched: `PRODUCTION_VERIFICATION = NOT_RUN`.
