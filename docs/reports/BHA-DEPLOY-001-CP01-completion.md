# BHA-DEPLOY-001-CP01 — Owner-led deploy readiness (RDS migration, catalog import, run packet)

> `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes). Branch `ops/bha-deploy-001-cp01-rds-demo`, `BASELINE_SHA = RELEASE_SHA = 6ae3fdd3306c50736c734712df5a0f2a1ab5054a` (`origin/develop`, merge of PR #83). This is the Owner's 2026-10-07 replacement of the earlier CP01: **the Owner performs every AWS, Vercel, DNS and database write; Claude prepares, checks and guides.** The earlier permission to create `thebha_showcase_demo` on RDS and seed it is withdrawn and was not used. `REVIEW: NOT_RUN`. Files: this report, the runbook (new §11 packet and corrections), SNAPSHOT, worklog — no code, schema, workflow, Dockerfile, package or local data was changed.

## 0. Status

| Line | Status |
|---|---|
| `PLAN_READY` (packet complete for the inputs available today) | **PASS** — with the Owner inputs listed in §6 still missing |
| `RELEASE_VERIFIED` (source/CI/SQL at `6ae3fdd`) | **PASS** |
| `MIGRATION_PACKET` (checksum, guards, expected output, rehearsed) | **PASS** on a throwaway local PostgreSQL 17 |
| `LOCAL_DATA_INVENTORY` | **PASS** (read-only) |
| `AWS_INVENTORY` | **NOT_RUN** — no `aws` CLI and no `~/.aws` profile on this machine; console checklist only (§2) |
| `CLOUD_DATA`, `DEPLOY_API`, `DEPLOY_ADMIN`, `DEPLOY_CUSTOMER`, `END_TO_END_LIVE`, `PUBLISH` | **NOT_RUN** — nothing was written to AWS/Vercel/DNS; they stay `NOT_RUN` until the Owner executes and returns evidence |
| `REVIEW` | **NOT_RUN** |

A rehearsal on a local scratch database is **not** `CLOUD_DATA` or `END_TO_END_LIVE` and is not credited to either.

## 1. A1 — release, CI, source

- Preflight: `git fetch --prune origin`; `origin/develop` = `6ae3fdd…` = local `develop`; checkout clean; branch created from that commit (it did not exist). PR #83 is `MERGED` (merge commit `6ae3fdd…`, `2026-10-07T01:01:11Z`, base `develop`, PR head `b33bc54`). `origin/main` is an old history (`3668e72…`, 2026-07-08) and is not used; it does not contain `backend-image.yml`.
- CI on `6ae3fdd`: `CI` run 37554976232 success (Admin, Backend, Frontend); `Backend image` run 37554976283 success — Plan and Build image pass, **`Backend suite on the source commit` and `Publish to ECR` skipped**. Skipped means nothing was published or deployed.
- Publish configuration (read-only GitHub): repository variables — none set (`ECR_PUBLISH_ENABLED` absent, so publishing is off); environments — `Preview`, `Production` only (no `showcase-publish`); default branch `main`, where the workflow file is absent, so "Run workflow" is not available. Consequence: the release commit has already gone through its `push` event with publishing off; **to put exactly `6ae3fdd` into ECR the Owner uses the manual build/push in runbook §3/§11 from a checkout of that commit** (a later `develop` push would publish a different SHA).
- Observation outside CP01: the hero change (Riverside photos + Vietnamese introduction, commit `a3ef231`) was never pushed and is **not** in `develop`; the commit still exists in the local object store only. Not touched here.

## 2. TARGET_INVENTORY (non-secret packet)

AWS read-only inventory could not run (no CLI/profile; nothing was installed or logged in). Fields to read from the console or `aws` and confirm **before any write** — none is assumed:

| Field | Expected / to confirm | Status |
|---|---|---|
| AWS account id, region | Owner | `OWNER_INPUT` |
| RDS identifier | `the-bha-db` | **unverified** |
| Endpoint (host:port) | from the console; must match the identifier | `OWNER_INPUT` |
| Engine / version / status | PostgreSQL **17.x**, `available`, encrypted, not publicly accessible | unverified |
| Operational database name | chosen by the Owner (not `thebha_showcase_demo`; the seeder's "demo/showcase" naming rule does not apply because the seeder is not used) | `OWNER_DECISION` |
| Roles | an owner/operator role for migrations (owns the database) and a separate application role | `OWNER_DECISION` |
| Network path | SSM port forward or bastion for the operator; API security group → RDS 5432; **do not** open 5432 to all IPs or make RDS public | `OWNER_INPUT` |
| TLS to RDS | operator: `sslmode=verify-full` with the RDS CA bundle; API: see §5 of the runbook (the image has no RDS CA bundle) | `OWNER_DECISION` |
| API runtime | proposal only: ECS on Fargate + encrypted EFS at `/var/keys`; App Runner is unsuitable (ephemeral disk) | `OWNER_DECISION` |

## 3. MIGRATION_CHECK

- **Artifact:** `deploy/showcase/migrations/idempotent.sql` at `6ae3fdd`: 1,780 lines, 83,437 bytes, **SHA-256 `d7d38722dee4ac0c2cc6412df8fbdda22286f28e3a918531881117da7019b406`**. `regenerate-migration-sql.sh --check` → "idempotent.sql is up to date" (exit 0, run in this session). 9 migrations (`20260721175848_InitialPropertyRoomInventory` … `20261001141847_AddStaffIdentityFoundation`) = the 9 `INSERT INTO "__EFMigrationsHistory"` statements; ProductVersion `8.0.29`.
- **Not purely schema (inspected in the source and the SQL):** migration 7 `CommercialCommitmentV2Foundation` contains `INSERT … SELECT` statements that convert rows of the legacy booking tables (`BookingHolds`, `BookingHoldNights`, `Reservations`, `ReservationNights`) into `InventoryHolds/Items/ItemNights` and `ReservationUnits/UnitNights`, followed by a verification block that raises on any mismatch. **On an empty database these move zero rows**; on a database that already holds bookings they change data, so a non-empty target needs a backup and review first. Migration 8 runs `CREATE EXTENSION IF NOT EXISTS btree_gist`, creates two trigger functions and five constraint triggers. Migration 9 only creates the Staff tables (its `Down` refuses to drop non-empty Staff tables). No migration inserts catalog, rate, room, media or Staff rows.
- **`apply-migration-sql.sh` is for the local compose stack only** (it execs into the local `postgres` container); it must not be used for RDS. The RDS command is plain `psql -v ON_ERROR_STOP=1 -f …` with a private credentials file (runbook §11).
- **Rehearsal (throwaway PostgreSQL 17.10 container, database owned by a non-superuser role — the closest local model of "database owner, not superuser"):** apply #1 exit 0, history = 9 rows, 28 public tables, extension `btree_gist` created by the non-superuser owner (it is a trusted extension; **on RDS this is not tested**, RDS may still require `rds_superuser`), 5 triggers; apply #2 (rerun) exit 0 with only the "already exists, skipping" notice, history still 9. The resulting schema is **identical** to the schema of the local demo database (`pg_dump --schema-only`, comments/restrict tokens stripped: 0 differing lines).
- **Least-privilege application role (rehearsed):** with `GRANT SELECT, INSERT, UPDATE, DELETE` on all tables and `USAGE, SELECT` on sequences (plus matching default privileges), the Production API ran as that role and completed customer register → login → CSRF → availability → hold (201) → confirm (201) → reservation read, i.e. the triggers and the booking flow need no DDL or owner rights at runtime. Role creation itself needs `CREATEROLE` (denied to the non-superuser owner), which RDS's master user has.
- **Production CLI behavior (release image built locally from `6ae3fdd`, `sha256:8fd9eb9ca50d…`, non-root `app`, `ASPNETCORE_ENVIRONMENT=Production`; this is a local image ID, not an ECR digest):** the Staff CLI works in Production and prints the target as `host/database` only; it needs `DataProtection__KeysPath` set (Production startup validation: without it the process exits with "DataProtection:KeysPath must point to durable shared storage"; a scratch directory is enough for the CLI, the CORS settings are not needed), refuses an existing email, and `--role` accepts only `FrontDesk` or `Manager`. Staff login requires an `Origin` header equal to the configured `Cors__AdminOrigins` entry (403 without it); with it, login 200, `/api/admin/v1/me` 200, reservation-board read 200, anonymous `/me` 401.

## 4. LOCAL_DATA_INVENTORY (read-only; local database `thebha_showcase_demo`, PostgreSQL 17.10, container `the-bha-showcase-postgres-1`, started for this and stopped again)

**4.1 Catalog the Owner wants in operation** — matches `RiversideDemoCatalog` and the Owner's list:

| Table | Rows | Notes |
|---|---:|---|
| Properties | 1 | `a1000000-…-0001`, slug `the-bha-riverside`, `Asia/Ho_Chi_Minh`, check-in 14:00 / check-out 12:00 |
| RoomTypes | 3 | `RIV-1BR` (id `…a3…01`, 2/2 guests), `RIV-1BR-OPEN` (`…02`, 2/2), `RIV-2BR` (`…03`, 4/4) |
| PhysicalRooms | 11 | 3 + 2 + 6, all `Active`, floor 0 |
| RatePlans | 1 | `a6…01`, `STANDARD`, VND |
| DailyRoomRates | 270 | 90 nights × 3 types, 2026-10-07 … 2027-01-04; **1,000,000 / 1,100,000 / 1,600,000 VND per night, one price per type, no variation** — matches the Owner's table |
| Amenities / PropertyAmenities | 2 / 2 | `RIV-POOL`, `RIV-ROOFTOP`; RoomTypeAmenities 0 |
| Media | 31 | ids `a5…01`–`a5…31`; **all 31 URLs use `https://localhost:3000`** |
| PropertyMedia / RoomTypeMedia | 10 / 21 | links by id |
| DailyInventoryControls | 0 | none set |

All ids are deterministic (catalog constants) except `DailyRoomRates.Id` (random, natural key = room type + rate plan + night). House/Villa: no rows and none to invent.

**Fields still showing demo/placeholder values and needing the Owner's confirmation before import:** room numbers `DEMO-1BR-01…03`, `DEMO-1BR-OPEN-01…02`, `DEMO-2BR-01…06` (floor 0); rate plan name "Giá tiêu chuẩn (demo)" (shown to guests on the offer card); property description (says "…của bản demo"), address "Địa chỉ đang được cập nhật", city "Đang cập nhật"; amenities beyond pool/rooftop; the rate window ends 2027-01-04 (see §7); the 31 photographs' provenance is `UNVERIFIED` (Owner-authorized, C2PA `NOT_RUN`).

**4.2 Test data produced by the many E2E runs — do not carry over as business data:** Reservations 24 (all `Confirmed`, total 70,800,000 VND, stays 2026-10-07 … 2027-01-05; 21 with `example.com` emails and 3 with `gmail.com` — treat all as test), InventoryHolds 28 (24 `Confirmed`, 4 `Active`) with 28 items / 65 item-nights, ReservationUnits 24 / UnitNights 57, RoomBlocks 1, RoomOccupancySegments 1, RoomOccupancySegmentAudits 2.

**4.3 Accounts / sessions — do not carry over:** StaffAccounts 1 and StaffPropertyMemberships 1 (local test Staff), AspNetUsers (customer accounts) 0, claims/logins/tokens 0. Staff for operation are created on the target by the CLI. Cookies and the Data Protection key ring are not in the database and are not copied.

Counts only; no emails, names, phones, tokens or hashes were printed or stored. Nothing local was modified.

## 5. Recommended transfer: migrate, then import only the confirmed catalog

Not recommended: copying the whole local database (it carries the test reservations/holds/blocks/audit rows, a test Staff account and `localhost` media URLs). Whole-database restore only if the Owner names the exact source and accepts the test transactions — Claude will not dump or restore the full database.

Recommended order: (1) migrations on the operational database; (2) the Owner confirms the §4.1 fields; (3) import the catalog tables only, in one transaction, with the media origin rewritten; (4) Staff via the CLI. The import is **not** part of the migration SQL, not run at API startup, and the Development seeder (`--seed-development`, `--seed-riverside-demo`) is **not** used on the operational database (it only runs in Development against a database named `*demo*`/`*showcase*`; the environment and database names must not be changed to get past that guard).

**Rehearsed (local only):** `pg_dump --data-only --column-inserts` of exactly 11 catalog tables (`Amenities, Properties, RatePlans, RoomTypes, PhysicalRooms, PropertyAmenities, RoomTypeAmenities, Media, PropertyMedia, RoomTypeMedia, DailyRoomRates`) → 352 `INSERT`s (2/270/31/11/1/2/10/1/21/3; no personal data: no email/phone/password strings), `https://localhost:3000` → `https://thebhariverside.com` in all 31 media rows by a plain text substitution (0 `localhost` left), imported with `psql --single-transaction -v ON_ERROR_STOP=1` into the migrated scratch database in the order pg_dump emits (parents first: all inserted, exit 0): Amenities 2, Properties 1, RatePlans 1, RoomTypes 3, PhysicalRooms 11, PropertyAmenities 2, Media 31, PropertyMedia 10, RoomTypeMedia 21, DailyRoomRates 270, Reservations/Holds/Staff 0. **Rerun guard:** running the same file again fails on the first primary key (`PK_Amenities`), exit 3, and — being one transaction — changes nothing (270 rates still). The Production API on that database then returned the property and three room types, availability for 2026-12-10→12 of 3 / 2 / 6 rooms at 2,000,000 / 2,200,000 / 3,200,000 VND, and every media URL under `https://thebhariverside.com`.

## 6. OWNER_RUN_PACKET and what is missing

The step-by-step packet (commands, expected output, checks, stop conditions) is **`docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md` §11**. Commands that still contain `<…>` are templates, not ready-to-run: they cannot be made concrete until the Owner supplies:

1. AWS account/region and the verified RDS endpoint (`the-bha-db` unverified); the operational database name; operator and application role names.
2. The access path to RDS (SSM/bastion) and the TLS decision (CA bundle for the operator; connection-string SSL mode for the API).
3. The API runtime decision (proposal: ECS Fargate + encrypted EFS), ECR repository and the publish route for `6ae3fdd` (manual push, or variables + a later `develop` push), ALB/ACM certificate and DNS for `thebhariverside.com`, `admin.` and `api.`.
4. The two Vercel projects (names, Node 22, `NEXT_PUBLIC_API_BASE_URL=https://api.thebhariverside.com` once the API is ready; Customer's `.env.local` holds Cloudinary variable names that no code reads — do not copy them).
5. The Owner's confirmation of the §4.1 fields, the rate window to sell, and which Staff accounts (email, role `Manager`/`FrontDesk`, password via private input) to create.
6. Budget/approval for the infrastructure.

## 7. Risks and gaps found (not fixed — outside scope)

- **Nightly rates stop on 2027-01-04 and there is no operational way to extend them:** the only writer is the Development seeder (`--days`, insert-only), which must not run on the operational database; the Admin application has no rate management. After that date the API offers nothing. Extending rates (an import window or an Admin capability) needs its own work item/decision before launch.
- Demo labels in guest-visible data (rate plan name, property description, address/city) and `DEMO-*` room numbers — see §4.1.
- The image carries no RDS CA bundle (no `ca-certificates.crt` is present in it): `SSL Mode=VerifyFull` needs the bundle delivered to the task; `Require` (encrypted, certificate unchecked) works without it. Baking the bundle in = a Dockerfile change = separate work item.
- The Staff CLI runs the full application startup validation; it logs SQL statements at Information level unless `Logging__LogLevel__Microsoft.EntityFrameworkCore=Warning` is set (rehearsed with it).
- Open from earlier work, unchanged: stale-cookie 401, first-request 500 after a database restart, unencrypted key XML, in-process rate limiter, Google Fonts fetched at build time, template "Get Template" link, `MEDIA_PROVENANCE: UNVERIFIED`.

## 8. Checks (this session)

| Check | Result |
|---|---|
| `git fetch --prune`, base/HEAD/PR/CI at `6ae3fdd` | RUN, matches |
| `regenerate-migration-sql.sh --check`; SHA-256/size of the SQL | RUN, up to date; hash in §3 |
| Source/SQL data-statement inspection (migrations 1–9) | RUN, §3 |
| SQL applied twice on scratch PostgreSQL 17.10 (non-superuser owner); schema diff vs local | RUN, pass; 0 differing lines |
| Least-privilege role + customer flow; Staff CLI/login/board on the release image | RUN, pass (scratch only) |
| Catalog export/import/rerun-guard rehearsal on scratch | RUN, pass |
| Local read-only inventory | RUN |
| AWS read-only inventory | **NOT_RUN** (no CLI/profile) |
| Vercel inventory | **NOT_RUN** (Owner operates Vercel) |
| `git diff --check`; secret scan of the diff (no credentials, connection strings, tokens, contact data) | RUN, clean |
| App test suites | NOT_RUN by design — no code changed |

## 9. State, cleanup, confirmation

I started the local showcase PostgreSQL container only to run SELECTs and stopped it again afterwards; the rest of the local stack stays stopped (it was stopped at the Owner's request earlier today). Scratch artifacts of the rehearsal (a throwaway PostgreSQL container, one key volume, a locally built API image, export/import files containing catalog rows, all in the session scratchpad) were removed after use; the export/import files are not committed. **No AWS, Vercel, DNS or other cloud resource was read with credentials or written; no row was written to any database other than the local scratch databases; no secret was requested, stored or printed.**

## 10. Reviewer focus

SQL/data-statement statements in §3 against the source; that the packet never routes the Development seeder or `apply-migration-sql.sh` at RDS; target guards (database/user/host checked before apply, empty-database precondition, snapshot first); the import order, rerun behavior and media-origin rewrite; the claims marked `NOT_RUN`/`unverified`.
