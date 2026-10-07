# CUST-WEB-SHOWCASE-001 — deploy runbook (Owner executes)

> Status: **Owner-led deployment (`BHA-DEPLOY-001-CP01`, 2026-10-07): nothing here has been executed in any cloud.** The Owner performs every step that touches AWS, Vercel, DNS or a real database and enters credentials on their own machine; Claude prepares, checks and guides. The release is `develop` at `6ae3fdd3306c50736c734712df5a0f2a1ab5054a` (merge of PR #83). The **operational database name is not chosen yet**, the **API runtime is undecided**, and **importing the catalog is a different operation from applying migrations** (§6, §11). Evidence: `docs/reports/BHA-DEPLOY-001-CP01-completion.md` (rehearsal on a local scratch PostgreSQL only). Statuses: `CLOUD_DATA`, `DEPLOY_API`, `DEPLOY_ADMIN`, `DEPLOY_CUSTOMER`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`.

## 0. Shape

```
Browser ──https──> Vercel project A  (Customer_Web)   thebhariverside.com
        ──https──> Vercel project B  (Admin_Web)      admin.thebhariverside.com
        ──https──> ALB (TLS) ──http──> API container  api.thebhariverside.com   ──> RDS PostgreSQL 17
                                        └─ /var/keys  (durable shared volume: Data Protection key ring)
```

The API is one container image (`Back_End/Dockerfile`). Nothing is seeded at startup and migrations are not run at startup.

## 1. Hard requirement: one registrable domain (planned: `thebhariverside.com`)

Customer and Staff sessions are cookies set by the API and sent with `credentials: include` from the browser apps. The Customer cookie is `SameSite=Lax`, the Staff cookie is `SameSite=Strict`, and the antiforgery cookie rides with the Customer flow. Those rules are not changed by this work item.

- Two Vercel projects on `*.vercel.app` plus an API on an AWS default hostname are **three different sites** (`vercel.app` is on the Public Suffix List, so each project is its own site). Browsers do not send `Lax` cookies on cross-site `fetch`/XHR and never send `Strict` ones, so Staff sign-in and the Customer session would fail. This is a property of the cookie rules, **not** a test result — it was not tested on Vercel.
- Therefore all three live under the Owner's registrable domain: Customer `https://thebhariverside.com`, Admin `https://admin.thebhariverside.com`, API `https://api.thebhariverside.com` (planned configuration — DNS, certificates and live behavior are `NOT_TESTED`). Same-site holds across the apex and its subdomains.
- CORS must list exactly those origins (§5). Wildcards are refused by the API at startup.

## 2. Decisions the Owner makes first

| # | Decision | Notes |
|---|---|---|
| D1 | ~~Domain and hostnames~~ **Provided by the Owner:** Customer `https://thebhariverside.com`, Admin `https://admin.thebhariverside.com`, API `https://api.thebhariverside.com` | Planned configuration; DNS, certificates and the live sites are `NOT_TESTED`. |
| D2 | Operational RDS database name (+ an owner/operator role and a separate application role) | **Chosen by the Owner, not yet chosen.** Do not reuse `thebha_showcase_demo`. The seeder's "must contain `demo`/`showcase`" rule is irrelevant because the seeder is **not** used on the operational database (§6). |
| D3 | API runtime | **Recommended: ECS on Fargate + encrypted EFS** (the key ring needs a durable volume shared by all tasks). App Runner has no durable shared volume, so it cannot satisfy §5 without a code change that is out of scope. |
| D4 | Final Customer origin for the catalog media URLs | = `https://thebhariverside.com` (decided). **The local database holds `https://localhost:3000` media URLs in all 31 Media rows: they must be rewritten during the catalog import (§11 step 7), never copied as they are.** |
| D5 | Photographs | 31 derivatives are published (Property 10, 2PN 9, 1PN 6, 1PN view thoáng 6; Owner-selected per room type). The Owner authorized publishing them although the byte scan found generator markers or no metadata on some originals; **provenance is `UNVERIFIED`** (heuristic scan, C2PA validation `NOT_RUN`) and no document may call them verified camera photographs. Media bytes and ids are not changed by this work item. |
| D6 | Real property details | Address, city, description, amenities beyond pool/rooftop, the rate plan name "Giá tiêu chuẩn (demo)" and the room numbers `DEMO-*` are placeholders until the Owner supplies real values; they must be confirmed **before** the catalog import (§11 step 7). |

## 3. Build and publish the API image

Workflow: `.github/workflows/backend-image.yml`. Publishing is **off by default** and happens only from **`develop`**, never from a pull request or `main`.

| Event | What happens |
|---|---|
| `pull_request` (touching `Back_End/**`, `deploy/showcase/**`, the workflow) | Builds the PR head, checks non-root + writable `/var/keys` + "Production refuses to start without `DataProtection__KeysPath`". No credentials, no AWS action, no publish. |
| `push` to `develop` (same paths) | Always builds. Publishes **only if** the repository variable `ECR_PUBLISH_ENABLED` is `true`: first the backend build + tests run against real PostgreSQL on that exact commit (`verify`), then the `publish` job (environment `showcase-publish`, OIDC, `id-token: write` only there) pushes the image. |
| `workflow_dispatch` | Same rules, and only when run on ref `develop`. **GitHub offers "Run workflow" only for a workflow file that exists on the default branch (`main`).** Until the Owner promotes the file there, use the push trigger; do not change the default branch just to get the button. Any other ref (including an old `main`) never publishes. |

**State at the release commit `6ae3fdd`:** its `push` run built the image with publishing off (no repository variables are set, the environment `showcase-publish` does not exist, the workflow file is not on the default branch `main`), so **nothing is in ECR**. To publish exactly `6ae3fdd` use the manual alternative below from a checkout of that commit; setting the variables only affects later `develop` pushes (a different SHA).

Image tag = the exact source commit SHA (for a PR build, the PR head — never the synthetic merge commit). An existing tag is not overwritten. Publishing **does not deploy**: nothing rolls out an ECS service; a skipped `publish` job means "nothing published".

Owner set-up (once, nothing is done for you):

1. Create the ECR repository (enable tag immutability) and an IAM role trusted for GitHub OIDC (repo `emLamHD/The_BHA_hotels_Booking`, environment `showcase-publish`) with push-only permissions on that repository.
2. Create the GitHub environment `showcase-publish` (optionally with a required reviewer).
3. Set repository variables `AWS_ECR_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY`, then `ECR_PUBLISH_ENABLED=true`. If it is `true` but any of the three is missing, the run **fails** with a clear error instead of silently skipping.
4. Merge to `develop` (or, once the file is on `main`, dispatch on `develop` with `publish = true`). The run summary lists the tag and digest.

Manual alternative (from a checkout of the approved commit, e.g. `git switch --detach <sha>`; AWS CLI authenticated by the Owner):

```bash
SHA=$(git rev-parse HEAD)           # must be the approved develop commit
REGISTRY=<account>.dkr.ecr.<region>.amazonaws.com
docker build -t "$REGISTRY/<repository>:$SHA" Back_End
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin "$REGISTRY"
docker push "$REGISTRY/<repository>:$SHA"
aws ecr describe-images --repository-name <repository> --image-ids imageTag=$SHA --query 'imageDetails[0].imageDigest' --output text
```

Rollback: point the service back at the previous image **digest or SHA tag** (record the digest of every release); never retag. Image properties (verified locally): non-root user `app`, port 8080, `ASPNETCORE_ENVIRONMENT=Production`, `/var/keys` created and owned by `app` (not configured: set `DataProtection__KeysPath`), no secrets baked in.

## 4. RDS and migrations

1. RDS for PostgreSQL **17**, encrypted, in private subnets. Security group: inbound 5432 only from the API task's security group and from the operator's access path (SSM port forward or bastion). Create a role for the application (not the master user) and the database named per D2.
2. Apply the schema with the checked-in idempotent script — safe to run twice, nothing is applied at startup. **Use the exact command, guards and checks of §11 steps 3–6**; `deploy/showcase/scripts/apply-migration-sql.sh` is for the local compose stack only and must never be pointed at RDS:

   ```bash
   psql "<connection string from a secret store, via env var>" -v ON_ERROR_STOP=1 -f deploy/showcase/migrations/idempotent.sql
   ```

   Expect 9 rows in `"__EFMigrationsHistory"` (SHA-256 of the file at `6ae3fdd`: `d7d38722dee4ac0c2cc6412df8fbdda22286f28e3a918531881117da7019b406`). The SQL is not purely schema: migration 7 converts rows of the legacy booking tables (zero rows on an empty database) and migration 8 runs `CREATE EXTENSION IF NOT EXISTS btree_gist`, so a non-empty target needs a backup and review first. Regenerate/verify the file after any migration change: `deploy/showcase/scripts/regenerate-migration-sql.sh [--check]`. The generator keeps exactly one newline at EOF, so `--check` and `git diff --check` stay clean.
3. Never commit or print the connection string. Never copy rows from a local database to RDS.

## 5. API runtime configuration

Environment variables (values from the secret store; none belong in Git):

| Variable | Value |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` (image default) |
| `ConnectionStrings__TheBhaDatabase` | Npgsql connection string for the application role (SSL required on RDS) |
| `Cors__AllowedOrigins__0` | `https://thebhariverside.com` |
| `Cors__AdminOrigins__0` | `https://admin.thebhariverside.com` |
| `DataProtection__KeysPath` | `/var/keys` — **required**: the image does not set it, so a task started without it (and without the volume) fails at startup instead of running on ephemeral keys. Mount a durable volume shared by every task there. |
| `Hosting__TrustedProxy__Enabled` | `true` |
| `Hosting__TrustedProxy__KnownNetworks__0` | CIDR of the ALB subnets (or the VPC range), e.g. `10.0.0.0/16`. No `/0`, nothing wider than `/8` (the API refuses to start). |
| `Hosting__TrustedProxy__ForwardLimit` | `1` (one TLS terminator) |

TLS terminator rules: terminate TLS at the ALB; target group protocol HTTP to port 8080, health check `GET /health/ready` expecting 200 (503 means the database is unreachable). The ALB must send `X-Forwarded-Proto` and `X-Forwarded-For` (it does by default). Redirect HTTP→HTTPS at the ALB itself. Do not expose port 8080 to anything but the ALB: the API trusts forwarded headers only from the configured network, so any other peer's claim of HTTPS is ignored (verified by tests).

Data Protection key ring: keys are written to `/var/keys` **unencrypted at rest** (the ASP.NET Core warning "No XML encryptor configured"; adding key encryption needs packages or certificates, which this work item may not add). Mitigation to require: encrypted EFS, an access point restricted to the container user (uid 1654), no other mounts, backup excluded or encrypted. Losing the directory logs every user out and invalidates antiforgery tokens; sharing it across tasks is what keeps sessions valid. Verified locally: recreating the container on the same volume keeps Customer sessions and antiforgery tokens valid; a fresh volume does not (`deploy/showcase/scripts/verify-key-persistence.sh`).

Key persistence check (local stack only, needs the showcase stack up and the image): `KEYTEST_IMAGE=<image tag> deploy/showcase/scripts/verify-key-persistence.sh` (default image `thebha-api:showcase`). Each run draws a random run id and creates its own scratch database `bha_kt_<id>`, container `bha-kt-<id>` and volumes `bha-kt-<id>-keys-a/-b`; it never drops, reuses or removes anything that existed before (CREATE DATABASE and a volume pre-check refuse an existing name; ownership is verified by a `bha.keytest.run` label), the API port is chosen by Docker, and cleanup removes only what the run created, also on failure or SIGINT/SIGTERM. If cleanup cannot finish it names the leftover scratch resources on stderr and exits non-zero; remove those exact names by hand. Older runs of the previous script may have left `<db>_keytest` or `the-bha-showcase-keytest*` resources: they are not touched by this script and must be inspected and removed manually. Regression tests (stubbed Docker, no daemon needed): `python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py" -v`.

Single instance recommended for the showcase: the rate limiter is in-process, so N tasks multiply the effective limits.

## 6. Catalog and Staff for the operational database (import, not seed)

**The Development seeder (`--seed-riverside-demo`, `--seed-development`) is not used on the operational database.** It is a local, Development-only operator command (it refuses any other environment and any database whose name lacks `demo`/`showcase`); do not rename the database or change `ASPNETCORE_ENVIRONMENT` to get past that guard. It is still how the local rehearsal database was created, and its documented behavior is unchanged (insert-only, idempotent, exit codes 0 ok / 1 failure / 2 usage including an unrepresentable `--from`/`--days` range / 3 target refused / 4 conflict; `--media-base-url` must not change on a rerun).

For the operational database the schema comes from the migrations (§4) and the catalog is a **separate, reviewed import** of exactly the tables `Amenities, Properties, RatePlans, RoomTypes, PhysicalRooms, PropertyAmenities, RoomTypeAmenities, Media, PropertyMedia, RoomTypeMedia, DailyRoomRates` — never the local reservations, holds, blocks, audit rows, Staff or customer accounts (they are E2E test data). §11 step 7 has the procedure; it was rehearsed on a scratch database.

Staff accounts are created on the target with the existing CLI (§11 step 8), password only via environment/`--env-file` or the hidden prompt:

```bash
BHA_STAFF_PASSWORD='<from a secret store>' dotnet TheBha.Api.dll --staff-create --email <staff email> --property-id <property id> --role Manager   # role: Manager or FrontDesk
```

## 7. Vercel (two projects, same repository)

| | Customer project | Admin project |
|---|---|---|
| Root directory | `Front_End/Customer_Web` | `Front_End/Admin_Web` |
| Domain | `thebhariverside.com` | `admin.thebhariverside.com` |
| Node | 22 (`.nvmrc` 22.23.1) | 22 |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.thebhariverside.com` (**https only, build-time**; rebuild after changing) | same |
| Other | — | leave `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` unset (Staff is the default; `LocalGate` is refused in a production build) |

Customer: Node 22.x, npm 10.x (`engines`, `.nvmrc` 22.23.1), lockfile v3. Admin: no `engines` field; use Node 22 (Next 16), lockfile v3. `Front_End/Customer_Web/.env.local` on the Owner's machine also holds Cloudinary variable names (`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER`): **no code reads them — do not copy them to Vercel**; the only variable either project needs is `NEXT_PUBLIC_API_BASE_URL`.

The Riverside photographs are static files in `Front_End/Customer_Web/public/media/the-bha-riverside/` and are served by the Customer project at `https://thebhariverside.com/media/the-bha-riverside/<name>.webp`; the seeded `Media.Url` values must therefore use that origin (D4). Only that exact path shape bypasses the template's default-deny routing. Hard reloads drop an in-memory hold (existing behavior).

## 8. Post-deploy verification

```bash
API_BASE=https://api.thebhariverside.com MEDIA_BASE=https://thebhariverside.com deploy/showcase/scripts/smoke.sh
```

It checks `/health/ready` 200, the public properties route, that the Staff session route answers 401 without a session (404 would mean the forwarded HTTPS scheme is **not** trusted — fix `Hosting__TrustedProxy__*`), and that every image URL the API returns answers `200 image/webp`.

Then, in a real browser on the three real hostnames, walk the demo path: **`/` (the Chisfis home page) → Stays search: location The BHA Riverside, dates, guests → Search → a Featured room card (price from the API) → `/listing-stay-detail?propertyId=…&roomTypeId=…` (dates carried in the URL) → offer → contact → hold → `/paydone` ("Đã giữ chỗ", not yet confirmed) → "Xác nhận đặt phòng" → "Đặt phòng đã xác nhận"**, then Admin sign-in → `/calendar`. The Customer site serves the Chisfis template pages (demo content, no backend) except `/api/*`, which answers 404 by design; `/showcase` redirects to `/` and `/pay-done` to `/paydone`. Only The BHA Riverside rooms, prices and booking are real; House and Villa tabs are static "coming soon" panels; the currency dropdown is template-only. Opening `/paydone` directly (no hold in the tab) shows a recovery message, never a receipt. Safari/WebKit was not run.

## 9. Known risks (not fixed here)

- **Stale Customer cookie → 401** on `POST /booking-holds` and `POST /auth/logout` still open (backend auth change needs its own work item).
- **No EF retry strategy.** Observed locally: after the database was restarted, the first request on a pooled connection returned 500 (`57P01`), later ones succeeded. Expect the same for the first requests after an RDS failover or maintenance restart.
- `/_next/static/<missing>` returns 500 under `next start` on Node 22 locally (framework behavior, not served by Vercel's static layer).
- **Nightly rates end on 2027-01-04 and nothing in Production can extend them** (only the Development seeder writes rates; Admin has no rate management): after that date the API offers no rooms. Decide an extension route before launch.
- **No RDS CA bundle in the image**: `SSL Mode=VerifyFull` needs the bundle delivered to the task; `SSL Mode=Require` encrypts but does not verify the server certificate.
- Key ring unencrypted at rest (§5). In-process rate limiter (§5). Placeholder property details (D6). Two room types have no photographs (D5).

## 10. Rollback

Redeploy the previous image tag/digest. Migrations are forward-only: before applying them take an RDS snapshot (§11 step 4) and restore it if the schema must go back; there is no down-migration script for production use. The catalog import is one transaction, so a failed run changes nothing; removing imported rows afterwards is a deliberate Owner decision — there is no blanket delete script.

## 11. Owner-led run packet (`BHA-DEPLOY-001-CP01`)

Every step is performed by the Owner. Commands containing `<…>` are **templates**: they are not ready to run until the value is supplied, and the missing inputs are listed in the report §6. Never put a password, connection string or token on a command line, in shell history or in chat. **Stop and do not continue** if any "expected" result below differs.

**Operator machine set-up (once).** Use a private password file and environment variables instead of arguments:

```bash
install -m 600 /dev/null ~/.bha-pgpass         # then add ONE line with an editor, not echo:  <endpoint>:5432:<db>:<operator_role>:<password>
export PGPASSFILE=~/.bha-pgpass PGSSLMODE=verify-full PGSSLROOTCERT=<path to the RDS CA bundle you downloaded from AWS>
export PGHOST=<RDS endpoint>  PGPORT=5432  PGDATABASE=<operational database>  PGUSER=<operator_role>
```

**Step 1 — verify the release you deploy.**

```bash
git fetch --prune origin && git switch --detach 6ae3fdd3306c50736c734712df5a0f2a1ab5054a && git status --short   # expect: no output
sha256sum deploy/showcase/migrations/idempotent.sql      # expect d7d38722dee4ac0c2cc6412df8fbdda22286f28e3a918531881117da7019b406
```

Optional re-check of the generator (needs `dotnet-ef`): `deploy/showcase/scripts/regenerate-migration-sql.sh --check` → `idempotent.sql is up to date`.

**Step 2 — confirm the target (read-only).** In the console or with the AWS CLI on the right account: instance `the-bha-db` (unverified — confirm it is the intended one), engine PostgreSQL **17.x**, status `available`, storage encrypted, **not** publicly accessible, security group allows 5432 only from the API's security group and your operator path (SSM port forward or bastion). Then, through that path:

```bash
psql -At -c "select current_database(), current_user, inet_server_addr(), split_part(version(),' ',2)"
psql -At -c "select count(*) from information_schema.tables where table_schema='public'"
psql -At -c "select to_regclass('public.\"__EFMigrationsHistory\"')"
```

Expect: the database name you chose, your operator role (not the master user, not a superuser), the RDS address, `17.x`; **0** tables and an empty last result on a fresh database. **If the table count is not 0 or the history table exists: stop** — the database is not new; take a snapshot and compare the schema before anything is applied (migration 7 converts legacy booking rows).

**Step 3 — create the database and roles (master user, once).** Use `\password` inside psql so passwords are prompted, not typed into history: create the operator role (owns the database), the application role, `CREATE DATABASE <db> OWNER <operator_role>`, `REVOKE ALL ON DATABASE <db> FROM PUBLIC`. The extension `btree_gist` is created by migration 8 as the database owner: this worked for a non-superuser owner on local PostgreSQL 17 (trusted extension) but is **untested on RDS**; if it fails with a permission error, ask for `rds_superuser` membership for that one step rather than changing the SQL.

**Step 4 — snapshot, then apply.** Take a manual RDS snapshot (console or `aws rds create-db-snapshot`) and wait for `available`. Re-run the two guard queries of step 2 (name/user/host/version/table count) and then:

```bash
psql -v ON_ERROR_STOP=1 -f deploy/showcase/migrations/idempotent.sql
```

Expected: no `ERROR`; exit 0. (Rehearsed locally.)

**Step 5 — verify the schema.**

```bash
psql -At -c 'select "MigrationId" from "__EFMigrationsHistory" order by 1'       # expect 9 rows: 20260721175848_… through 20261001141847_AddStaffIdentityFoundation
psql -At -c "select count(*) from information_schema.tables where table_schema='public'"   # expect 28 (27 tables + history)
psql -At -c "select extname from pg_extension order by 1"                          # expect btree_gist and plpgsql
psql -At -c "select count(*) from pg_trigger where not tgisinternal"               # expect 5
```

Rerun the same `psql -f` once: expect exit 0, only the notice `relation "__EFMigrationsHistory" already exists, skipping`, and the history still 9 rows.

**Step 6 — application role.** As the operator role, after step 5 (replace the names):

```sql
GRANT CONNECT ON DATABASE <db> TO <app_role>;
GRANT USAGE ON SCHEMA public TO <app_role>;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO <app_role>;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO <app_role>;
ALTER DEFAULT PRIVILEGES FOR ROLE <operator_role> IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <app_role>;
ALTER DEFAULT PRIVILEGES FOR ROLE <operator_role> IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO <app_role>;
```

A role with exactly these rights ran the whole customer booking flow (hold → confirm → read) and Staff login/board read in the rehearsal. The API connects as `<app_role>`, never as the operator or master user.

**Step 7 — import the confirmed catalog (after the Owner confirms the report §4.1 fields).**

7a. Decide, in writing, the real values for: room numbers (currently `DEMO-*`), rate plan name, property description/address/city, and the rate window to sell (the local window ends 2027-01-04). Anything that is still a placeholder is imported as a placeholder.

7b. Produce the file from the **local** database (start only its PostgreSQL container; this reads, writes nothing):

```bash
docker exec the-bha-showcase-postgres-1 pg_dump -U thebha_showcase -d thebha_showcase_demo --data-only --column-inserts --no-owner --no-privileges \
  -t public.\"Amenities\" -t public.\"Properties\" -t public.\"RatePlans\" -t public.\"RoomTypes\" -t public.\"PhysicalRooms\" -t public.\"PropertyAmenities\" \
  -t public.\"RoomTypeAmenities\" -t public.\"Media\" -t public.\"PropertyMedia\" -t public.\"RoomTypeMedia\" -t public.\"DailyRoomRates\" > catalog-export.sql
sed 's#https://localhost:3000#https://thebhariverside.com#g' catalog-export.sql > catalog-import.sql
```

Check before using it: `grep -c "^INSERT INTO" catalog-import.sql` → **352** (Amenities 2, Properties 1, RatePlans 1, RoomTypes 3, PhysicalRooms 11, PropertyAmenities 2, Media 31, PropertyMedia 10, RoomTypeMedia 21, DailyRoomRates 270); `grep -c localhost catalog-import.sql` → **0**; `grep -ci "email\|phone\|password" catalog-import.sql` → **0**; and edit the file (or apply `UPDATE`s after the import) for the values decided in 7a. Keep the file private and out of Git.

7c. Import into the operational database as the operator role, one transaction:

```bash
psql --single-transaction -v ON_ERROR_STOP=1 -f catalog-import.sql
```

Expected: exit 0. Rerunning the same file fails on the first primary key (`PK_Amenities`) with exit 3 and changes nothing. Check: row counts as in 7b for those tables and **0** in `Reservations`, `InventoryHolds`, `StaffAccounts`; `select substring("Url" from '^https?://[^/]+'), count(*) from "Media" group by 1` → only `https://thebhariverside.com` (31).

**Step 8 — Staff accounts (existing CLI; the Production image, not the seeder).** Password in a private env file (`chmod 600`), not on the command line:

```bash
docker run --rm --env-file <private env file> -e ASPNETCORE_ENVIRONMENT=Production -e DataProtection__KeysPath=/tmp/keys \
  -e Logging__LogLevel__Microsoft.EntityFrameworkCore=Warning <image> \
  --staff-create --email <staff email> --property-id a1000000-0000-0000-0000-000000000001 --role Manager
```

The env file holds `ConnectionStrings__TheBhaDatabase=<application-role Npgsql string for the operational database>` and `BHA_STAFF_PASSWORD=<…>`. The CLI needs `DataProtection__KeysPath` only to pass Production startup validation (a scratch directory is enough; it does not touch the production key ring). Expected: `staff: target database <host>/<db>` then `staff: created Staff <id> with Manager membership.` (roles: `Manager` or `FrontDesk`); an existing email → "already exists; nothing was changed". Check the host/database in the first line is the operational RDS before entering a password.

**Step 9 — build and publish the image for exactly `6ae3fdd`** (no automatic publish exists for it, see §3): from the clean checkout of step 1, `docker build -t <registry>/<repository>:6ae3fdd3306c50736c734712df5a0f2a1ab5054a Back_End`, push, then record the digest with `aws ecr describe-images …`. Deploy by digest. Expect the image to run as user `app`, port 8080, and to exit at startup without `DataProtection__KeysPath`.

**Step 10 — API runtime (decision pending).** Proposal: ECS on Fargate + encrypted EFS access point (uid 1654) at `/var/keys`, ALB with ACM certificate, health check `GET /health/ready` = 200. Environment: §5 table. Connection string for the application role with SSL: `SSL Mode=Require` works without extra files; `SSL Mode=VerifyFull;Root Certificate=<path>` requires delivering the RDS CA bundle to the task (not in the image). The API must serve **Production** with `AdminCalendar` access mode left at its default **Staff**; never `LocalGate`. `Cors__AdminOrigins__0` must equal `https://admin.thebhariverside.com` exactly: Staff requests without that `Origin` get 403. A task started without the key volume must fail (guard) — do not point `KeysPath` at ephemeral disk to make it start.

**Step 11 — DNS and API checks.** `api.thebhariverside.com` → ALB. Then: `API_BASE=https://api.thebhariverside.com MEDIA_BASE=https://thebhariverside.com deploy/showcase/scripts/smoke.sh` (the media check needs step 13 done; before that expect only its image check to fail). Independent checks: `/health/ready` 200; `/api/v1/properties` lists one property `the-bha-riverside`; `/api/admin/v1/me` without a session 401 (404 means the forwarded HTTPS scheme is not trusted → fix `Hosting__TrustedProxy__*`); availability for a future in-window range returns 3 / 2 / 6 rooms at 1,000,000 / 1,100,000 / 1,600,000 VND per night.

**Step 12 — Admin (Vercel project B).** Root `Front_End/Admin_Web`, Node 22, `NEXT_PUBLIC_API_BASE_URL=https://api.thebhariverside.com` (HTTPS, build-time — rebuild after any change), domain `admin.thebhariverside.com`, do not set `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE`. Check: sign in with the Staff account of step 8, `/calendar` shows the Riverside board from the API, sign out. Only the calendar is backed by the API; the other Admin template modules are mock/template and must not be reported as live. One write with audit (for example an operational block, then cancel it) is a separate Owner decision on live data.

**Step 13 — Customer (Vercel project A).** Root `Front_End/Customer_Web`, Node 22 / npm 10, same `NEXT_PUBLIC_API_BASE_URL`, domain `thebhariverside.com`. Check on the real hostnames: `/` → Stays search (Riverside, dates inside the rate window, guests) → Featured card with the API price → room page → offer → contact → hold → `/paydone` ("Đã giữ chỗ") → "Xác nhận đặt phòng" → confirmed. Then verify in the database as the operator role: one row each in `InventoryHolds` and `Reservations` (`Confirmed`) for that booking, and decide how to treat/cancel the test booking — it is real data in the operational database. Customer sign-in pages of the template are not a real customer auth UI; Staff login is the real login.

**Stop conditions.** Wrong account/region/endpoint; database name or user differs from the plan; the database is not empty at step 2; any step's expected output differs; the API would need an ephemeral key directory; 5432 would have to be opened to the internet. Report the exact output (without secrets) back for review before continuing.
