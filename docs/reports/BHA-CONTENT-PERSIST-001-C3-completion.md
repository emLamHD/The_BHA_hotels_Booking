# BHA-CONTENT-PERSIST-001-C3 — the three findings of the third Codex review (completion report)

- **WORK_ITEM** `BHA-CONTENT-PERSIST-001-C3` · branch `feature/bha-content-persist-001` · Draft PR #131 (into `develop`, unchanged) · **START_HEAD** `d97715b` (verified before editing: tree clean, PR open and draft, head equal to the remote's) · the `FINAL_HEAD` and CI link are the PR head after the last commit (see the PR).
- Implementer Claude, reviewer Codex (invoked by Owner), merge Owner.
- **C3 tests: PASS (local) · REVIEW: NOT_RUN · PRODUCTION_VERIFICATION: NOT_RUN.** The C2 deployment simulation (Production image) is **not** repeated and is not evidence for C3.
- **Schema:** none. **Inventory / frontend / API contract:** unchanged. The importer was not rewritten: one decision function, one guard, one check.

## 1. Findings

| # | Cause | Change | Before → after |
|---|---|---|---|
| **F1** default currency / language | `PrepareConfigTableAsync` freed the pristine default (VND) as soon as the pack's non-default row looked edited, *before* the row that was to take the default (USD) was found to be the target staff's and kept. A dry-run rolls back, and the "exactly one default" trigger is deferred to commit, so the dry-run never met `XBHA4` | `DecideDefaultAsync`: **one decision per table**, in every mode. The pack's default is taken only when the source's staff chose it, the target's current default and the pack's default row are still the migration's, and the pack's row was not deleted since an import (ledger). Otherwise the target keeps its own default, every row of the table is written with that flag, and a `NOTE` names both codes and the reason. Taking it frees the old flag once, before any row. `dry-run`/`apply` also run `SET CONSTRAINTS ALL IMMEDIATE` before the rollback/commit gate, so a commit-time refusal shows in the dry-run (`the database would refuse the commit`) and apply stops before it copies a file. Languages share the code path | **Before:** dry-run exit 0, no note about the default. **After**, on PostgreSQL 17: staff-edited target USD → dry-run, apply and verify exit 0, VND is still the single default, the staff's rate 26000 kept, verify prints the note and counts the rows as `keep the target's own version`; untouched target → default moves to USD (one default), verify red before and green after, a second apply changes nothing; the same four cases for `en`/`vi`; a target rule that fires only at commit makes the dry-run and the apply fail with nothing written |
| **F2** `BHA_RESTORE_DELETED` | `[ -z "$v" ] \|\| --restore-deleted`: `0` also turned the restore on | `1` turns it on; unset, empty, `0` off; any other value: stderr message, exit 2, Docker not run. Runbook table updated | **Before:** `0` passed `--restore-deleted`; `true`/`yes`/`2` too. **After** (stub `docker` on `PATH` records its arguments): unset/empty/`0` → no flag; `1` → flag; `true`, `yes`, `2`, ` 1` → exit 2, no Docker call |
| **F3** exit code after apply | the post-apply check's `Conflicts` were not copied into the apply's report, so `VERIFICATION FAILED` could exit 0 | extracted `ContentPackCommand.MergeVerification` and `ExitCode` (same logic as before plus `Conflicts`); the failure line says the rows and files **are committed**; an exception after the commit says so too (it used to say "the database was not changed") | **Before:** a conflicts-only check → exit 0 (red test without the one line). **After:** the conflict is printed and the exit code is non-zero; a problems-only check fails too; a clean check prints `VERIFIED` and exits 0 |

## 2. Checks (this phase, local)

- `dotnet build Back_End/TheBha.Booking.sln -c Release`: 0 errors. `bash -n deploy/content/import-content-pack.sh`: ok.
- Unit 676/676. Content-pack integration tests on a private PostgreSQL 17.10 (port 54329, `timezone=UTC`): **40/40** — 25 existing + 15 new in `ContentPackC3Tests`.
- Red runs: on the old importer and script, 8 of the 15 failed (F1 currency, F1 language, the dry-run check, F2 four refusals and `0`); F3 failed with the `Conflicts` line removed. The F1 take-the-default tests and the F2 cases that match old behaviour passed before the fix by design.
- The full integration suite was not run locally; CI on the PR head runs it.
- `ContentPackTests.Export_of_an_imported_database…` compares a `timestamptz` as text and fails on a server whose time zone is not UTC (+07:00 here): environmental, unrelated to C3, green with `timezone=UTC` and in CI.

## 3. Limits that remain

- A staff-edited default that the pack disagrees with is **kept**, not merged: moving the default needs a Staff decision in Admin.
- `SET CONSTRAINTS ALL IMMEDIATE` covers deferred constraints of the target; a rule that depends on data written by someone else between the dry-run and the apply is still decided at the apply.
- Production was not touched: `PRODUCTION_VERIFICATION = NOT_RUN`.
