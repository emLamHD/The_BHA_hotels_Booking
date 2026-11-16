# BHA-CONTENT-PERSIST-001-C6 / C6.1 — the sixth Codex review's finding and its completion (completion report)

- **Branch** `feature/bha-content-persist-001` · Draft PR #131 (into `develop`, unchanged) · implementer Claude, reviewer Codex (invoked by Owner), merge Owner.
- **C6** `75afc1b` → CODE_HEAD `247e7e8` (verified before editing: tree clean, equal to the remote's, PR open and draft). **C6.1** (OC correction) `247e7e8` → CODE_HEAD `1cfbb89` (`f8b9bde` is the first C6.1 code commit, `1cfbb89` adds one test and narrows the runbook wording). The commit that adds §5 follows and changes only this file; the PR head is the `FINAL_HEAD`. CI: §5.
- **Tests: PASS (local) · REVIEW: NOT_RUN · PRODUCTION_VERIFICATION: NOT_RUN.** The C2 deployment simulation is not repeated and is not evidence for C6/C6.1.
- **Schema / inventory / frontend / API contract:** none. A new optional manifest field (`CompleteTextLanguages`, format version unchanged — an older pack and an older importer both ignore/lack it), one importer method, the exporter's statement of it, a seed-key set read from the frozen seed scripts, tests, runbook.

## 1. The finding (P2) and the two stages

When the source's staff removed a hero or menu text (e.g. the English `content.heroSlideshow.main.secondaryAction`), a target that took the source's content still showed the migration's seed text, because `WebsiteTranslations` is processed only for the rows the pack has.

- **C6 (`247e7e8`)** removed such a text when the importer replaced a pristine hero/menu with the source's *saved* one (the source's parent version > 1). Verified for the hero/menu **save** flow.
- **C6.1 (OC correction)**: the Admin translation editor (`ClearTranslationAsync`) deletes the row **without raising the hero's or the menu's version**; the source parent stays at version 1, C6 saw "unedited" and left the seed. The decision is now **separate from replacing slides/items and does not read the source's parent version.**

## 2. The rule (C6.1)

A target text is removed only when **all** hold:

1. **its key is a seeded hero/menu key**: the set `ContentPackSpec.SeedTextKeys` is read from the frozen seed scripts (`WebsiteHeroSeed`, `WebsiteMenuSeed`), so a key the staff created is never in it; its entity (`heroSlideshow`/`heroSlide`/`menuItem`) says which collection it belongs to;
2. **the pack proves the source lacks it**: `manifest.json` states `CompleteTextLanguages` — the languages whose every `WebsiteTranslations` row the pack carries, written by the exporter from the same REPEATABLE READ snapshot as the rows (the exporter's predicate for the table is `true`) — the key's language is one of them (and a `WebsiteLanguages` row of the pack), and the pack has no row for (language, key). **A pack without the statement (an older export), or without that language, removes nothing**; the apply/dry-run prints a NOTE with the number of seeded texts it did not reconcile;
3. **the target's row is still the seed** (version 1, not manual, no author) and **the target's collection has not been saved by its staff** (the hero/menu parent is still the migration's). A collection the staff saved is theirs: its seed texts stay (counted `kept-target`). The `DELETE` repeats the seed check, so a text saved since is never removed (a mismatch is a CONFLICT, nothing written).

Dry-run is the same transaction, rolled back, and lists the removals; apply deletes in the apply transaction under the existing website-settings lock; verify reports each such text as a problem (and, like every verify, stops at the first table with problems — a source that also differs elsewhere is reported there first). Data the source cleared **before** this change is handled the same way: only the pack's rows are read. Texts of a slide or item the source removed go too, in every stated language (lifts the "unused label texts" limit of C1 §6.6 / C5 §3, kept there as history).

## 3. Evidence

| | `247e7e8` | C6.1 |
|---|---|---|
| **Translator path, hero + menu, fresh migrated target** (logs `~/bha-content-backup-20261026/c61-translator-before-after.log`, a scratch test, not committed). Source: English switched on, the staff clear the English hero secondary label and the English label of the "Ưu đãi" menu item through `IWebsiteSettingsStore.ClearTranslationAsync`; both parents still at **version 1** | source rows 0/0, target rows 1/1 → apply exit 0 → **target rows 1/1** (lines `kept …`); public `en`: hero **`View Riverside`** (source `Xem Riverside`), menu **`Offers`** (source `Ưu đãi`); **verify exit 0 although the target differs** | apply exit 0 with `removed … secondaryAction` / `removed … menuItem…label`; **target rows 0/0**; public `en`: hero `Xem Riverside`, menu `Ưu đãi` — equal to the source's; verify exit 0 |
| **Red run** (`c61-red-run-on-247e7e8.log`, the C6.1 tests on the code of `247e7e8`) | 4 of 10 fail: hero and menu translator tests (`Expected 0, Actual 1` — the seed survives apply), the verify test (verify exits 0 when it must not), and the weak-pack test (fails only on the missing NOTE — a new-feature assertion, not a reproduction). The other 6 (C6 tests and guards) pass | all pass |

C6 evidence (save flow), kept: plain hero save, row 1 → 0, public `View Riverside` → `Xem Riverside` (`c6-plain-hero-before-after.log`; red runs `c6-red-run-on-75afc1b*.log`).

Acceptance (all in `ContentPackC6Tests`, real PostgreSQL, the staff's actions through the real services):

- **Hero and menu through the translator** — `A_hero_label_cleared_in_the_translator_…` and `A_menu_label_cleared_in_the_translator_…`: row and parent version checked at the source (rows 0, `WebsiteHero`/`WebsiteMenu` version 1), source public reader on the fallback; dry-run names the key and writes nothing; apply removes; the other labels stay; the texts outside the hero/menu are compared row by row before/after; the public `en` hero and menu equal the source's; verify 0; second apply changes nothing. `Verify_names_the_seeded_text_cleared_in_the_translator_…`: verify exits non-zero naming the key before the apply (no other table differs) and 0 after.
- **Target's own edits and deletions kept** — `What_the_targets_staff_did_survives_a_translator_cleared_source`: (a) a label the target's staff **edited** in the translator keeps their wording (version 2, author), a text outside the hero stays; (b) a target whose staff **saved the hero** keeps its title, its interval and its seed texts. `A_label_the_targets_staff_cleared_in_the_translator_after_an_import_is_not_put_back…`: fresh target, apply, the staff clear a hero label and a menu label in the translator (parents at version 1), dry-run and second apply keep both absent (`deleted-since` > 0, the ledger), verify 0. Plus the C6 tests (save flow, SQL-set edited text, out-of-collection key).
- **Insufficient pack** — `A_pack_without_the_text_scope_or_without_the_language_…`: the same pack with `CompleteTextLanguages` removed (an older export) and with it set to `["vi"]`: dry-run and apply exit 0, the English seed stays, verify 0; the first prints the NOTE.
- **Re-run** — each test applies a second time: row counts unchanged, nothing removed returns.

## 4. Checks (local)

- Build 0 errors (2 pre-existing CA2200 warnings in services not touched); unit **676/676**.
- Content-pack integration tests on a private **PostgreSQL 17.10, `timezone = UTC`**: **64/64** — the 53 of C1–C5 (C4/C5 guarantees on a deleted target text, category replacement and hero files among them), 5 of C6 and 6 of C6.1. (CI's PostgreSQL is the `postgres:18.3` service container.)
- The full integration suite ran in CI only.
- One counting change: C6.1 skips a target text the staff saved silently, where C6 counted it as `kept-target`; the "kept-target" numbers for `WebsiteTranslations` can be lower.

## 5. CI, PR and delivery

- **CI on `247e7e8`** (C6 code): https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/42736813304 — success: Backend (unit 676, integration 1355 on PostgreSQL 18.3), Admin, Frontend.
- **CI on `f8b9bde`** (first C6.1 code commit): run 42739570803 — **cancelled**, superseded by the next push; not cited as evidence.
- **CI on `1cfbb89`** (final C6.1 code): https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/42739980515 — success: Backend (unit 676, integration 1361 on PostgreSQL 18.3, 22 m 9 s; every content-pack test ran there), Admin, Frontend.
- **The report-only commit after CI:** its diff is only `docs/reports/BHA-CONTENT-PERSIST-001-C6-completion.md` (this file). Its own CI status is stated in the completion message to Owner (the workflow is triggered by the push); the code it describes is `1cfbb89`.
- **PR size from GitHub:** stated in the completion message and the PR body (above the 100–400 line target as for C1–C5: the pack, importer and tests of the work item; the C6/C6.1 growth is one importer method, the manifest field, 11 tests, this report and the runbook rows).

## 6. Limits and decisions for OC / Owner

- **The committed pack has no `CompleteTextLanguages`**, so applying it removes nothing — the same as before for the committed artifact, since the source it was exported from had cleared no seeded text. Measured: a dry-run of `deploy/content/bha-site-content` on a fresh migrated target (`c61-committed-pack-dry-run.log`): `WebsiteTranslations` matches 114, inserted 0, **no NOTE** — the pack has every seeded text of the languages it lists, so nothing is lost. The statement appears in a pack only after a re-export with this version; a source whose staff clear a seeded text later needs that re-export before the removal travels. **Not regenerated here** (Owner/OC decision: re-export the committed pack from the source database).
- **A target the staff cleared a seeded text on before its first import:** the import puts it back (no ledger entry and no version records it). After the first import the clear is kept (tested). Not implemented: a missing seeded text cannot be told from one the target never had (a language created after the seed has none) without a marker the schema does not have. **OC question** whether to accept this.
- **A target already imported by an older version** (its hero/menu now carries the source's version, so it is no longer "untouched") keeps any leftover seed text: a collection the target's staff may have saved is theirs and nothing proves otherwise. Those are not reconciled.
- A removed text is counted in `Updated` (the summary reads "took the pack's value over a default") and its line shows the language id, not the code. Cosmetic.
- Production was not touched: `PRODUCTION_VERIFICATION = NOT_RUN`.
