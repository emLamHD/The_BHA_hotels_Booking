# BHA-PG18-001 — Backend tests on PostgreSQL 17 and 18 before the cloud migration

> `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes). Branch `test/bha-pg18-001-compatibility`, `START_HEAD = base = origin/develop = 17c15e7ecf8ec7e2ff977d9c20f79f72b3957f65` (merge of PR #84, documentation only). The application release `6ae3fdd3306c50736c734712df5a0f2a1ab5054a` is unchanged: `Back_End/src`, `Front_End`, `deploy` and `.github` are identical between `6ae3fdd` and the start head. Test code and documents only; no production code, schema, SQL, Dockerfile, workflow or package changed. `REVIEW: NOT_RUN`.

## 1. Evidence supplied by the Owner (`OWNER_VERIFIED`, not run by Claude)

RDS `the-bha-db`, `ap-southeast-2`, endpoint `the-bha-db.cpesw6uoopkp.ap-southeast-2.rds.amazonaws.com:5432`, PostgreSQL 18.3; database `thebha` had 0 public tables; `rds.allowed_extensions = *`; `btree_gist` 1.8, `trusted = true`, not installed; the Owner created `bha_operator` and `bha_app` (`LOGIN`; not `SUPERUSER`/`CREATEDB`/`CREATEROLE`/`REPLICATION`/`BYPASSRLS`; passwords set with `\password`), moved ownership of `thebha` to `bha_operator` and revoked the temporary membership; `bha_operator` logged in over TLS 1.3 (`session_user = current_user = bha_operator`) and ran `BEGIN; CREATE EXTENSION btree_gist; ROLLBACK;` successfully (`installed_version` still empty). `OWNER_RDS_ROLE_BOOTSTRAP: OWNER_VERIFIED_PASS`, `RDS_EXTENSION_PERMISSION: OWNER_VERIFIED_PASS`. **Not done / not verified:** migration, catalog import, table privileges for `bha_app`, `bha_app` login, API/Admin/Customer deployment — none is reported as PASS.

## 2. A — does any production path depend on the changed SQLSTATE?

PostgreSQL 18 reports `23001` (`restrict_violation`) for a parent `DELETE` (or key `UPDATE`) blocked by an `ON DELETE RESTRICT` foreign key; PostgreSQL 17 reports `23503`. Inserts/updates of child rows and `NO ACTION` keep `23503` on both (re-isolated in C1 on bare tables; the corrected tests below also exercise it on the real schema).

Searched `Back_End/src` (excluding migrations) for `ForeignKeyViolation`, `RestrictViolation`, `23503`, `23001`, `PostgresErrorCodes`, `SqlState`, `.Remove(`, `RemoveRange`, `ExecuteDelete`, `EntityState.Deleted`, `DELETE FROM`, `TRUNCATE` and `OnDelete(`:

- **`Persistence/RoomOccupancySegmentMutationSupport.cs`** — the only place that maps a foreign-key SQLSTATE. `IsRecognized` (line ~179) and `Describe` (line ~190) treat `PostgresErrorCodes.ForeignKeyViolation` as "One or more referenced records do not exist in the same Property", used by the `catch (PostgresException …)` / `catch (DbUpdateException …)` around the **final commit** of Admin segment mutations (lines ~90–96). Those commits insert/update child rows (`RoomOccupancySegments`, audits) that point at missing parents — a child-side violation, which stays `23503` on 18. A parent delete never reaches it.
- **Parent deletes in production code: none.** The only entity removal in `src` is `Persistence/DailyInventoryControlStore.DeleteAsync` (`dbContext.DailyInventoryControls.Remove(control)`), which removes a *child* row nothing references. No `ExecuteDelete`, no raw `DELETE`/`TRUNCATE` outside tests, and no code that re-keys a parent. `OnDelete(Restrict)` configurations (Property, RoomType, RatePlan, Reservation, InventoryHold, Staff memberships, …) only guard against such deletes; `Cascade` ones are unaffected by the code change.
- `BookingHoldConfirmationStore.cs:213` and `BookingHoldCreationStore.cs:441` map `UniqueViolation` (`23505`), unaffected. `RiversideDemoSeeder` uses an advisory lock and an `UPDATE` of `RoomTypeMedia`, not a delete.

**Conclusion: no production path is affected; the change is test-only.** Basis: reading the call sites above plus the full suites on both majors; not a formal proof beyond the code paths found.

## 3. B — the test changes (test project only)

- New `PostgresVersionSupport` (helper, ~30 lines): `SupportedMajors = [17, 18]`, `ServerMajorAsync(connectionString)` (from `NpgsqlConnection.PostgreSqlVersion.Major`) and `RestrictedParentDelete(major)` → `PostgresErrorCodes.ForeignKeyViolation` for 17, `PostgresErrorCodes.RestrictViolation` for 18; **any other major throws** instead of being guessed. New test `PostgresVersionSupportTests` pins that mapping and that majors 16 and 19 are rejected (this is the +1 test, 846 → 847).
- `PropertyInventoryPersistenceTests`: `Migration_applies_to_clean_postgresql_17_database` renamed `Migration_applies_to_clean_postgresql_database_on_a_supported_major`; the `StartsWith("17.")` pin became "the server major is one of 17/18" with the server version in the failure message; the 9 applied migrations and no pending ones are still asserted.
- `BookingPersistenceTests.Nullable_customer_linkage_and_restrictive_history_deletes_are_enforced`: the five parent-delete assertions (`AspNetUsers`, `RoomTypes`, `RatePlans`, `Properties`, `InventoryHolds`) expect the per-major restrict code; **added** behavior checks with fresh contexts — after the four refused deletes all four parents and the hold still exist, and after the last refused delete the hold and the reservation still exist.
- `StaffIdentityPersistenceTests.Memberships_enforce_key_role_and_restricting_foreign_keys`: the two parent deletes expect `(restrict code, same constraint name)`; **added** counts proving the property, the Staff account and the membership still exist. The child insert (`23503`), `23505` and `23514` assertions are untouched.
- Not done: no test skipped or disabled, no `Assert.Throws` generalisation, no acceptance of the whole `23xxx` class, no package or version change. That all seven parent-delete assertions pass on **both** majors with the *same* constraint-specific expectations shows each of those foreign keys is `RESTRICT` (an `ON DELETE NO ACTION` key would have failed the 18 run).

## 4. Validation (this session; isolated local servers only)

Two containers named after a random run id (`bha-pg18-001-<id>-17`, `-18`), label `bha.pg18001.run=<id>`, random loopback ports, both removed afterwards with their anonymous volumes; images `postgres:17.10` = `sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317` (server `17.10 (Debian 17.10-1.pgdg13+1)`) and `postgres:18.3` = `sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db` (server `18.3 (Debian 18.3-1.pgdg13+1)`). Each run used its own server (different ports; the version of each was read from the server). Target, redacted: `Host=127.0.0.1;Port=<random>;Database=thebha;Username=bha_test;Password=<redacted>`; the test factory connects to that container's `postgres` database and creates/drops only `thebha_integration_<guid>` databases (0 left on either server). Nothing was pointed at RDS or at the Owner's local stack.

| Run | Command | Result |
|---|---|---|
| RED, 18.3, unchanged tests, the 3 targeted tests | `dotnet test …IntegrationTests.csproj -c Release --no-build --filter <3 names>` | 3 failed (`Expected "23503" Actual "23001"` ×2 incl. the Staff tuple; `Expected start "17."`) |
| GREEN targeted, 18.3 and 17.10 | same filter, new names | 3/3 passed on each |
| Helper test | `--filter PostgresVersionSupportTests` | 1/1 |
| Full, **PostgreSQL 18.3** | `dotnet build Back_End/TheBha.Booking.sln -c Release` (0 warnings, 0 errors) then `dotnet test Back_End/TheBha.Booking.sln -c Release --no-build`, exit 0 | unit **244/244**, integration **847/847**, 0 skipped |
| Full, **PostgreSQL 17.10** | same | unit **244/244**, integration **847/847**, 0 skipped |

Count change explained: 846 → 847 integration is exactly the one new `PostgresVersionSupportTests` test over the 846 baseline; the 244 unit tests are unchanged. The 18.3 result is its own run and is not derived from the 17.10 run.

Schema/migration unchanged: `deploy/showcase/scripts/regenerate-migration-sql.sh --check` → "idempotent.sql is up to date" (exit 0); SHA-256 of `deploy/showcase/migrations/idempotent.sql` = `d7d38722dee4ac0c2cc6412df8fbdda22286f28e3a918531881117da7019b406`. `git diff --check` clean.

## 5. Status lines and what this does not prove

`PG18_COMPATIBILITY: LOCAL_TESTS_PASS` · `BACKEND_INTEGRATION_LOCAL18: PASS` (847/847; and 847/847 on 17.10) · `MIGRATION_SQL_LOCAL18: PASS` (C1) · production mapping findings: **none open** · `OWNER_RDS_ROLE_BOOTSTRAP` and `RDS_EXTENSION_PERMISSION: OWNER_VERIFIED_PASS` · `CLOUD_MIGRATION`, `CLOUD_DATA`, `PUBLISH`, `DEPLOY_API`, `DEPLOY_ADMIN`, `DEPLOY_CUSTOMER`, `END_TO_END_LIVE`: `NOT_RUN` · `REVIEW: NOT_RUN`. This is a **local compatibility gate**: it proves the suite on two local PostgreSQL majors, not RDS permissions on the real instance, security groups, the CA used by the API, or any deployment. A green GitHub CI run (PostgreSQL 17) does not replace the 18.3 local run above.

Supersession: the C1 result "BACKEND_INTEGRATION_LOCAL18: FAIL (3/846)" and "PG18_COMPATIBILITY: PARTIAL" (`BHA-DEPLOY-001-CP01-completion.md` §11.3–11.4) describe the head `bfd79da`/`28772f4` and stay as history; for the corrected head they are replaced by §4–5 here. The deployment runbook §0/§11/§9 now carries the Owner's later RDS evidence and these results.

## 6. Local state and limits

Created and removed by name/label: the two containers and their anonymous volumes, the password file (shredded) and temporary logs in the session scratchpad. Kept: the pulled images `postgres:17.10` and `postgres:18.3` (cache) and everything of the Owner's stack. The runbook steps 6–15 (snapshot, apply, grants, import, Staff, API, Vercel, DNS) are still the Owner's and unexecuted; the next gate for the Owner remains the packet's step 5 emptiness check, then step 6.
