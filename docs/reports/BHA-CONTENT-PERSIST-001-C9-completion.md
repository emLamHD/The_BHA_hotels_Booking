# BHA-CONTENT-PERSIST-001-C9 — the default-language finding of the ninth Codex review (completion report)

- **WORK_ITEM** `BHA-CONTENT-PERSIST-001-C9` · branch `feature/bha-content-persist-001` · Draft PR #131 (into `develop`, unchanged) · **START_HEAD** `4c209bf` (verified before editing: tree clean, equal to the remote's) · **CODE_HEAD** `8f66316`. The commit that adds this report follows it and changes only this file; the PR head is the `FINAL_HEAD`. CI: §4.
- Implementer Claude, reviewer Codex (invoked by Owner), merge Owner.
- **C9 tests: PASS (local) · REVIEW: NOT_RUN · PRODUCTION_VERIFICATION: NOT_RUN.**
- **Schema / migrations / inventory / frontend / API contract / manifest:** none. `CK_WebsiteLanguages_DefaultIsActive` and `CK_WebsiteCurrencies_DefaultIsActive` are unchanged.

## 1. Finding and change

| Cause | Change |
|---|---|
| When the target's default stands (`DecideDefaultAsync` put the table in `_keepsTargetDefault`), `ExistingRowAsync` rewrote the pack row's `IsDefault` to the target's value but left the pack's `IsActive`. A pack that carries the target's default language switched off (the source made another language the default and switched this one off) therefore wrote `IsDefault = true, IsActive = false` → `23514 CK_WebsiteLanguages_DefaultIsActive`, in dry-run and apply. | In `ExistingRowAsync` (`ContentPackImporter.cs`), when the target's default is kept and the row is the target's default, the row also keeps the target's `IsActive`. The row then matches the target, is counted as `kept-target`, and its line lists `IsDefault, IsActive`. One decision for dry-run, apply and verify (the same method serves all three). Currencies share the code and the same CHECK, so they get the same protection (not exercised by a new test: no pack in the suite switches the default currency off). |

## 2. Evidence

Red run on **START_HEAD `4c209bf`** (C9 tests added, fix absent): `~/bha-content-backup-20261026/c9-red-run-on-4c209bf.log` — the regression test fails, the control passes:

`NOTE: WebsiteLanguages: the pack's default is en; the target keeps vi as its default (the target's en was edited by its staff).`
`CONFLICT: WebsiteLanguages 7b0c8a10-0001-4000-8000-000000000001: 23514 CK_WebsiteLanguages_DefaultIsActive`

Setup of the regression test (`ContentPackC9Tests`), all through the real settings services: **source** — English installed and made the default (`SetDefaultLanguageAsync`), then Vietnamese switched off (`UpdateLanguageAsync`); exported. **Target** — English installed (so its row was edited by Staff, version > 1), Vietnamese still the migration default and active.

| | `4c209bf` | C9 |
|---|---|---|
| dry-run | fails (`CONFLICT … 23514`), nothing written | exit 0; note gives the reason (`the target's en was edited by its staff`); `kept (the target's default stands): WebsiteLanguages <vi id> — IsDefault, IsActive`; every `WebsiteLanguages` row byte-identical (`to_jsonb`) before and after |
| apply | not reached | exit 0; `vi` is the only default and is active; **all rows identical to before**, so the Staff's English edit (its version and values) is kept |
| verify | — | exit 0; same note and `kept` line; `WebsiteLanguages … matches N kept-target ≥1` (kept configuration reported apart from matching rows) |
| second apply | — | exit 0; rows still identical (no new write) |
| **control** — untouched target (no English edit), same pack | passes | passes unchanged: dry-run exit 0, apply makes `en` the default and active and `vi` `false/false` as in the source; verify 0; second apply 0 |

The existing C3 tests (`F1_language_…`, `F1_currency_…`) cover the neighbouring paths and pass unchanged.

## 3. Checks (local)

- **Environment:** PostgreSQL **17.10**, `timezone = UTC` (`select version(), current_setting('TimeZone')` on the server used), private cluster on 127.0.0.1:54329. An earlier run on a cluster in `Asia/Ho_Chi_Minh` failed 2 tests that format timestamps (`+07:00` vs `+00:00`); that was my environment, not the code, and the cluster was restarted in UTC (as in C8 and CI). A first full run with `Password=x` failed 27 `RiversideDemoSeedCommandTests` because those tests assert the output never contains the password and `x` appears in `x_demo`; the class passes 47/47 with a distinctive password.
- Build 0 errors. Unit **676/676**. Integration (full suite, UTC): **1372** tests = 1345 passed in the full run + the 27 above passed on re-run (47/47 of the class); `ContentPackC9Tests` 2/2. `ContentPack|Blog` filter: 206 passed in the run made before the test's report-line assertion was corrected (the one failure then was my assertion expecting `vi` where the report prints the row id); the final code was then run in full as above.
- CI's PostgreSQL is the `postgres:18.3` service container.

## 4. CI and PR size

- **Run `42765893458` on `4c209bf`** (C8 report-only head, the start of C9): `conclusion = success` (Frontend, Admin, Backend). A baseline; it says nothing about C9.
- **CI on `8f66316`** (C9 code): https://github.com/emLamHD/The_BHA_hotels_Booking/actions/runs/42952337528 — `conclusion = success`: Backend (PostgreSQL 18.3 service container; the C9 tests ran there), Frontend, Admin.
- **The report-only commit after CI:** its diff is only this file; its own CI status is stated in the completion message.
- **PR size:** outside the 100–400 line target as for C1–C8 (the pack, importer and tests of the work item). C9 adds 4 lines of importer code, one 95-line test file and this report.

## 5. Limits

- Staff's own default-language and currency choices are untouched; the fix only changes which `IsActive` is written to the row that stays the default.
- The default **currency** has the same CHECK and now the same protection but no dedicated C9 test.
- Production was not touched: `PRODUCTION_VERIFICATION = NOT_RUN`.
