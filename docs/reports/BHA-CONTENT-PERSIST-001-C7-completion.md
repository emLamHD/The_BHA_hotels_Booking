# BHA-CONTENT-PERSIST-001-C7 — the two findings of the seventh Codex review (completion report)

- **WORK_ITEM** `BHA-CONTENT-PERSIST-001-C7` · branch `feature/bha-content-persist-001` · Draft PR #131 (into `develop`, unchanged) · **START_HEAD** `b917f92` (verified before editing: tree clean, equal to the remote's, PR open and draft) · **CODE_HEAD** `7fe6917` (importer, 4 tests, one runbook row). The commit that adds §4 follows it and changes only this file; the PR head is the `FINAL_HEAD`. CI: §4.
- Implementer Claude, reviewer Codex (invoked by Owner), merge Owner.
- **C7 tests: PASS (local) · REVIEW: NOT_RUN · PRODUCTION_VERIFICATION: NOT_RUN.** The C2 deployment simulation is not repeated and is not evidence for C7.
- **Schema / inventory / frontend / API contract / manifest:** none. Two statements in `ContentPackImporter.ResolveReferencesAsync`.

## 1. Findings and change

An offer the target already has under the same slug (another id) is the target's own: its cover and room-type links stay, the pack's copy of them is left out (`_maps["PromotionId"]`).

| # | Cause | Change |
|---|---|---|
| **F1** shared cover | each mapped offer added **its** cover to `_skipPromoMedia` on the spot, so a cover two source offers share was skipped (row and file) even when the other, new offer still refers to it → `FK_Promotions_PromotionMedia_CoverMediaId` conflict, rollback | the set is computed **after** every offer is known to be mapped or not (`ContentPackImporter.cs:345` area): the covers of the mapped offers **minus** the covers of the offers still to be imported. The media rows (`ProcessTableAsync`) and the file plan (`skippedCovers`) already read this one set, so both follow it |
| **F2** dependency check | the promotions-group check required the room type of **every** pack `PromotionRoomTypes` row, including the links of mapped offers, which `ProcessTableAsync` skips (`ContentPackImporter.cs:481`) | the check (`:356`) now filters out links whose `PromotionId` is mapped — the identical predicate to the one the write step uses; every link that is still imported keeps its check |

## 2. Evidence

| | `b917f92` | C7 (`7fe6917`) |
|---|---|---|
| **F1** — source: two offers (`o-dai-giam-200k`, `gia-dinh-giam-10`) share one cover; target: catalog imported, its own `gia-dinh-giam-10` (own id, own cover and link), no copy of the shared cover | dry-run: `CONFLICT: Promotions 1ffaeb48…: 23503 FK_Promotions_PromotionMedia_CoverMediaId`, nothing written, exit non-zero | dry-run 0 and writes nothing (media/offer rows and media files counted before/after); apply 0: the mapped offer keeps its id, **its own cover** and link, the new offer arrives with the shared cover row and a **byte-identical file**; verify 0; a second apply leaves rows and files unchanged |
| **F1 guard** — both offers mapped, each with its own cover | the shared cover is not copied (row and file absent) | the same (the cover is skipped because no offer to import needs it) |
| **F2** — source: the mapped offer is also linked to a room type (`RIV-C7`) the target has no code/slug match for; target: catalog imported, own `gia-dinh-giam-10` linked to `RIV-1BR` | `PROBLEM: the promotions group needs the room type 53f5d548…, which the target does not have; import the catalog group first` (dry-run, apply and verify fail) | dry-run, apply and verify (`--groups promotions`) exit 0; the target's own links are unchanged; the `RoomTypes` count is unchanged and `RIV-C7` is not created |
| **F2 guard** — the target has **no** offer under that slug, so the link is imported and its room type is missing | named (`needs the room type …`), non-zero, nothing written | the same, in dry-run and apply: offers, media rows and media files unchanged; verify non-zero |

Red run: `~/bha-content-backup-20261026/c7-red-run-on-b917f92.log` — the 4 new tests on the code of `b917f92`: the two F1/F2 positive tests fail with exactly the messages above; the two guards pass in both (by design). The tests set the scenarios up with SQL, not through the Admin promotion service (the shared cover, the extra room type and link at the source, the target's own offer — the same technique as the C1 test B); the source is a real import of the committed pack and the pack a real export. The committed pack's four offers have distinct covers, so its import behaviour is unchanged.

## 3. Checks (local)

- Build 0 errors; unit **676/676**.
- Content-pack integration tests on a private **PostgreSQL 17.10, `timezone = UTC`**: **68/68** — the 64 of C1–C6.1 (group limits, media verification, Staff-edit preservation among them) and the 4 new in `ContentPackC7Tests`. CI's PostgreSQL is the `postgres:18.3` service container.
- The full integration suite ran in CI only.

## 4. CI and PR size

- **CI on `b917f92`** (the C6.1 report-only head, the start of C7; code `1cfbb89`): https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/42742848897 — success: Backend (unit 676, integration 1361 on PostgreSQL 18.3), Admin, Frontend. Its result is the baseline the review ran on; it says nothing about C7.
- **CI on `7fe6917`** (C7 code): https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/42747634464 — success: Backend (unit 676, integration 1365 on PostgreSQL 18.3, 22 m 11 s; the 68 content-pack tests ran there), Admin, Frontend.
- **The report-only commit after CI:** its diff is only `docs/reports/BHA-CONTENT-PERSIST-001-C7-completion.md` (this file). Its own CI status is stated in the completion message to Owner (the workflow is triggered by the push); the code it describes is `7fe6917`.
- **PR size from GitHub:** stated in the PR body and the completion message (outside the 100–400 line target, as for C1–C6.1: the pack, importer and tests of the work item; C7 adds two statements, 4 tests, this report and one runbook row).

## 5. Limits for OC

- **Adjacent, not changed:** the property dependency check just above F2 (`NeedsProperty`) runs over every pack `Promotions` and `PromotionMedia` row, including mapped offers and skipped covers. A promotions-only import whose offers are all mapped, onto a target lacking the pack's property, would still ask for the catalog. Rare and outside the two findings; **OC decision** whether to apply the same filter.
- Production was not touched: `PRODUCTION_VERIFICATION = NOT_RUN`.
