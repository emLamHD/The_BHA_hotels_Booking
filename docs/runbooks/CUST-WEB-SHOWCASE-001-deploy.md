# CUST-WEB-SHOWCASE-001 — deploy runbook (Owner executes)

> **Current status, 2026-10-09 (`BHA-BACKEND-CD-001-CP01`).** `OWNER_VERIFIED` (the Owner's statement; Claude did not re-test the cloud): the Customer Web, the Admin Web and the backend are all deployed and tested successfully. Both frontends have CI/CD (Vercel); the backend has CI and a **manual** deployment (EC2 + Docker + Caddy, RDS PostgreSQL 18.3, ECR). This does not mean every Admin template module is wired to the backend — only the Staff calendar surface listed in §7b/§11 step 14 is. The dated updates and the 2026-10-07 status paragraph below are history, kept as written. Backend continuous delivery is **not** complete: CP01 only prepares the release artifact (workflow, ECR publish helper, runbook `docs/runbooks/BHA-BACKEND-CD-001.md`); CP02 (EC2 deploy/rollback), CP03 (SSM/IAM wiring) and CP04 (Owner live activation) are not implemented. `PUBLISH_LIVE`, `DEPLOY_LIVE`, `ROLLBACK_LIVE`: `NOT_RUN`.
>
> **CP02 (2026-10-09, `BHA-BACKEND-CD-001-CP02`)** adds a scripted digest deploy/rollback engine for this EC2 + Docker shape (`deploy/showcase/scripts/backend-deploy.sh`, contract in `docs/runbooks/BHA-BACKEND-CD-001.md` §9). It was rehearsed only on a local isolated stack: the manual EC2 packet in §7b/§11 remains the way the live host is changed until CP03/CP04, and `DEPLOY_LIVE`, `ROLLBACK_LIVE`, `SSM_LIVE` stay `NOT_RUN`.
>
> **Update 2026-10-08 (`BHA-WEB-PROXY-001`, `BHA-ADMIN-PROXY-001`).** Since the paragraph below was written, the Owner has verified (`OWNER_VERIFIED`; Claude did not re-test the cloud): the API runs on EC2 behind Caddy at `https://the-bha-api.52-65-145-145.sslip.io` (image digest `sha256:d01c7d9d…98b4b6`), RDS `thebha` (PostgreSQL 18.3) is migrated and the catalog imported, the Staff Manager exists, and the Customer site `https://the-bha-hotels-booking-p5rj.vercel.app` is live (CSRF 200/no-store; a guest booking was written to RDS). The paragraph below is the 2026-10-07 state of this packet and is kept as history. Admin on its own Vercel project, the EC2 Admin origin and Admin login/calendar live are **not** done: `NOT_RUN` (§7b).
>
> Status: **Owner-led deployment (`BHA-DEPLOY-001-CP01`, 2026-10-07): nothing here has been executed in any cloud.** The Owner performs every step that touches AWS, Vercel, DNS or a real database and enters credentials on their own machine; Claude prepares, checks and guides. The release is `develop` at `6ae3fdd3306c50736c734712df5a0f2a1ab5054a` (merge of PR #83). The operational database is **`thebha` on RDS `the-bha-db` (`ap-southeast-2`, PostgreSQL 18.3), created empty by the Owner; the Owner has since created `bha_operator` and `bha_app`, handed the database to `bha_operator` and passed the `btree_gist` permission gate (all Owner-verified, §11); the database-level hardening, snapshot, migration, import and table grants are still pending**, the **API runtime is undecided**, and **importing the catalog is a different operation from applying migrations** (§6, §11). Evidence: `docs/reports/BHA-DEPLOY-001-CP01-completion.md` and `docs/reports/BHA-PG18-001-completion.md` (rehearsals and test suites on local scratch PostgreSQL only). Statuses: `CLOUD_DATA`, `DEPLOY_API`, `DEPLOY_ADMIN`, `DEPLOY_CUSTOMER`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`.

## 0. Shape

```
Browser ──https──> Vercel project A  (Customer_Web)   thebhariverside.com
        ──https──> Vercel project B  (Admin_Web)      admin.thebhariverside.com
        ──https──> ALB (TLS) ──http──> API container  api.thebhariverside.com   ──> RDS PostgreSQL 18.3
                                        └─ /var/keys  (durable shared volume: Data Protection key ring)
```

The API is one container image (`Back_End/Dockerfile`). Nothing is seeded at startup and migrations are not run at startup.

## 1. Direct mode needs one registrable domain (planned: `thebhariverside.com`); the interim proxy mode does not

Customer and Staff sessions are cookies set by the API and sent with `credentials: include` from the browser apps. The Customer cookie is `SameSite=Lax`, the Staff cookie is `SameSite=Strict`, and the antiforgery cookie rides with the Customer flow. Those rules are not changed by this work item.

- Two Vercel projects on `*.vercel.app` plus an API on an AWS default hostname are **three different sites** (`vercel.app` is on the Public Suffix List, so each project is its own site). Browsers do not send `Lax` cookies on cross-site `fetch`/XHR and never send `Strict` ones, so Staff sign-in and the Customer session would fail. This is a property of the cookie rules, **not** a test result — it was not tested on Vercel.
- Therefore all three live under the Owner's registrable domain: Customer `https://thebhariverside.com`, Admin `https://admin.thebhariverside.com`, API `https://api.thebhariverside.com` (planned configuration — DNS, certificates and live behavior are `NOT_TESTED`). Same-site holds across the apex and its subdomains.
- CORS must list exactly those origins (§5). Wildcards are refused by the API at startup.
- **Interim alternative without a purchased domain (same-origin proxy).** Each Vercel project forwards its API namespace to the API from its own server, so the browser only talks to its own origin and the API's cookies are first-party there: Customer `/api/*` (`BHA-WEB-PROXY-001`, §7a) and Admin `/api/admin/v1/*` (`BHA-ADMIN-PROXY-001`, §7b). The cookie rules above are unchanged (Staff stays `SameSite=Strict`, `HttpOnly`, `Secure`, path `/api/admin`); the domain requirement applies only to the direct mode.

## 2. Decisions the Owner makes first

| # | Decision | Notes |
|---|---|---|
| D1 | ~~Domain and hostnames~~ **Provided by the Owner:** Customer `https://thebhariverside.com`, Admin `https://admin.thebhariverside.com`, API `https://api.thebhariverside.com` | Planned configuration; DNS, certificates and the live sites are `NOT_TESTED`. |
| D2 | Operational RDS database and roles | **Database `thebha` exists** (created by the Owner as `postgres`, 0 tables). Roles still to create: an operator role that owns it (`bha_operator`) and a runtime role (`bha_app`) — §11 steps 3–5. Do not reuse `thebha_showcase_demo`. The seeder's "must contain `demo`/`showcase`" rule is irrelevant because the seeder is **not** used on the operational database (§6). |
| D3 | API runtime | **Recommended: ECS on Fargate + encrypted EFS** (the key ring needs a durable volume shared by all tasks). App Runner has no durable shared volume, so it cannot satisfy §5 without a code change that is out of scope. |
| D4 | Final Customer origin for the catalog media URLs | = `https://thebhariverside.com` (decided). **The local database holds `https://localhost:3000` media URLs in all 31 Media rows: they must be rewritten during the catalog import (§11 step 9), never copied as they are.** |
| D5 | Photographs | 31 derivatives are published (Property 10, 2PN 9, 1PN 6, 1PN view thoáng 6; Owner-selected per room type). The Owner authorized publishing them although the byte scan found generator markers or no metadata on some originals; **provenance is `UNVERIFIED`** (heuristic scan, C2PA validation `NOT_RUN`) and no document may call them verified camera photographs. Media bytes and ids are not changed by this work item. |
| D6 | Real property details | Address, city, description, amenities beyond pool/rooftop, the rate plan name "Giá tiêu chuẩn (demo)" and the room numbers `DEMO-*` are placeholders until the Owner supplies real values; they must be confirmed **before** the catalog import (§11 step 9). |

## 3. Build and publish the API image

Workflow: `.github/workflows/backend-image.yml` (since `BHA-BACKEND-CD-001-CP01`, 2026-10-09; the contract is in `docs/runbooks/BHA-BACKEND-CD-001.md`). Publishing is **off by default**, never happens from a pull request, and has two separate lanes: `develop` (`ECR_PUBLISH_ENABLED`, environment `showcase-publish`, not a production release) and `main` (`BACKEND_RELEASE_PUBLISH_ENABLED`, environment `backend-production`). The paragraphs below up to "State at the release commit" describe the 2026-10-07 develop-only behavior; where they differ, `BHA-BACKEND-CD-001.md` wins.

| Event | What happens |
|---|---|
| `pull_request` (touching `Back_End/**`, `deploy/showcase/**`, the workflow, `ci.yml`) | Verifies the PR head (backend suite on PostgreSQL 18.3), builds the image once, checks non-root + writable `/var/keys` + "Production refuses to start without `DataProtection__KeysPath`". No credentials, no AWS action, no publish. |
| `push` to `develop` (same paths) | Always verifies and builds. Publishes **only if** the repository variable `ECR_PUBLISH_ENABLED` is `true` (environment `showcase-publish`, OIDC, `id-token: write` only in that job). Not a production release; nothing is deployed. |
| `push` to `main` (same paths) | Always verifies and builds. Publishes **only if** the repository variable `BACKEND_RELEASE_PUBLISH_ENABLED` is exactly `true` (environment `backend-production`). Never controlled by `ECR_PUBLISH_ENABLED`. |
| `workflow_dispatch` | **Removed** by CP01. Retry a failed publish with "Re-run failed jobs" of the same run. |

**State at the release commit `6ae3fdd`:** its `push` run built the image with publishing off (no repository variables are set, the environment `showcase-publish` does not exist, the workflow file is not on the default branch `main`), so **nothing is in ECR**. To publish exactly `6ae3fdd` use the manual alternative below from a checkout of that commit; setting the variables only affects later `develop` pushes (a different SHA).

Image tag = the exact source commit SHA (for a PR build, the PR head — never the synthetic merge commit). An existing tag fails the run (it is never overwritten, re-tagged or reused). Publishing **does not deploy**: nothing rolls out an ECS service; a skipped `publish` job means "nothing published".

Owner set-up (once, nothing is done for you):

1. Create the ECR repository (enable tag immutability) and an IAM role trusted for GitHub OIDC (repo `emLamHD/The_BHA_hotels_Booking`, environment `showcase-publish`) with push-only permissions on that repository.
2. Create the GitHub environment `showcase-publish` (optionally with a required reviewer).
3. Set repository variables `AWS_ECR_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY`, then `ECR_PUBLISH_ENABLED=true`. If it is `true` but any of the three is missing, the run **fails** with a clear error instead of silently skipping.
4. Merge to `develop`. The run summary lists the tag and digest. (The `workflow_dispatch` trigger no longer exists.)

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

1. RDS for PostgreSQL **18.3** (the Owner's instance `the-bha-db`, `ap-southeast-2`; Owner-verified, see §11), encrypted, in private subnets. Security group: inbound 5432 only from the API task's security group and from the operator's access path (SSM port forward or bastion). Create a role for the application (not the master user) and the database named per D2.
2. Apply the schema with the checked-in idempotent script — safe to run twice, nothing is applied at startup. **Use the exact commands, guards and checks of §11 steps 3–8** (three routes: a fresh database, an existing database that is not bootstrapped yet, or the Owner's resume state — §11 table); `deploy/showcase/scripts/apply-migration-sql.sh` is for the local compose stack only and must never be pointed at RDS:

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

Staff accounts are created on the target with the existing CLI (§11 step 10), password only via `--env-file`/environment or the hidden prompt:

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
| Other | — | leave `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` unset (Staff is the default; `LocalGate` is refused in a production build). Proxy demo on `*.vercel.app` (no purchased domain): see §7b instead of the direct values above |

Customer: Node 22.x, npm 10.x (`engines`, `.nvmrc` 22.23.1), lockfile v3. Admin: no `engines` field; use Node 22 (Next 16), lockfile v3. `Front_End/Customer_Web/.env.local` on the Owner's machine also holds Cloudinary variable names (`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER`): **no code reads them — do not copy them to Vercel**; the only variable either project needs is `NEXT_PUBLIC_API_BASE_URL`.

The Riverside photographs are static files in `Front_End/Customer_Web/public/media/the-bha-riverside/` and are served by the Customer project at `https://thebhariverside.com/media/the-bha-riverside/<name>.webp`; the seeded `Media.Url` values must therefore use that origin (D4). Only that exact path shape bypasses the template's default-deny routing. Hard reloads drop an in-memory hold (existing behavior).

### 7a. Demo on the Vercel URL, API on `sslip.io` (`BHA-WEB-PROXY-001`)

Interim demo (Owner decision: keep `https://the-bha-hotels-booking-p5rj.vercel.app`, no domain purchased yet). §1's cookie analysis still holds, so the browser must never call the API cross-site: the Customer project proxies `/api/*` to the API (`rewrites()` in `Front_End/Customer_Web/next.config.js`, opt-in via `API_PROXY_ORIGIN`), and the API's cookies are then first-party to the Vercel hostname. Owner-verified before this work item (`OWNER_VERIFIED`, not re-tested): API behind Caddy at `https://the-bha-api.52-65-145-145.sslip.io`, `/health/ready` 200, `/api/v1/auth/csrf` 200, Let's Encrypt certificate, image `6ae3fdd…` (digest above). Not verified anywhere yet: cookies through Vercel, login, live booking.

Vercel Customer project, **Production only** (then rebuild/redeploy — `NEXT_PUBLIC_*` is compiled into the bundle and `rewrites()` is fixed at build; the proxy code must be on `main`, which Vercel Production builds):

| Variable | Value |
|---|---|
| `API_PROXY_ORIGIN` | `https://the-bha-api.52-65-145-145.sslip.io` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://the-bha-hotels-booking-p5rj.vercel.app` |

A Preview deployment keeps the Production hostname as its API base, so it is not a working proxy; do not report Preview as working. The `sslip.io` host embeds the EC2 public IP: if it changes, the name, certificate and `API_PROXY_ORIGIN` all change (an Elastic IP or a real domain removes the limit; neither is done here). The browser's `Origin` (the Vercel URL) is forwarded unchanged to the API. Read-only source check (not run against the live API): the Customer routes are behind `app.UseCors("customer-web")` (`Back_End/src/TheBha.Api/Program.cs:513`), which only decides whether CORS response headers are added — it does not reject a request — and a server-side `Origin` check exists only for Staff/Admin routes (`Authentication/StaffRequestBoundaryFilter.cs:47`, against `Cors:AdminOrigins`). So no `Cors__AllowedOrigins__0` change is expected for proxied Customer calls, and nothing here treats CORS as the source of a 403 (CORS does not return one). If a proxied Customer call fails unexpectedly, first identify the endpoint and where the error comes from (the API response body and logs, Caddy, or Vercel) before changing any configuration; do not change `Cors__*` on a guess. Also: the API sees Vercel's egress addresses as the client IP, so the in-process per-IP `auth-register`/`auth-login` rate limits (`Program.cs:559`) are shared by every demo user. The API sends `Cache-Control`/`CDN-Cache-Control`/`Vercel-CDN-Cache-Control: no-store`; nothing on the frontend adds caching for auth, availability or booking.

Read-only checks after the redeploy (no data written; `<CUSTOMER>` = the Vercel URL):

```bash
curl -sS -D - -o /dev/null "<CUSTOMER>/api/v1/auth/csrf"                  # expect 200 and Cache-Control: no-store; note whether a Set-Cookie arrives for the Vercel host (not yet observed)
curl -sS -o /dev/null -w '%{http_code}\n' "<CUSTOMER>/health/ready"        # 404 expected: only /api/* is proxied, health is not
curl -sS -o /dev/null -w '%{http_code}\n' "<CUSTOMER>/API/v1/auth/csrf"    # 404 expected: only the exact-case /api prefix is forwarded
```

Then, in a browser on the Vercel URL, DevTools → Network: the API calls must go to the Vercel hostname (`/api/v1/...`), never to `sslip.io`.

### 7b. Admin on its own Vercel project, same-origin proxy (`BHA-ADMIN-PROXY-001`, Owner executes)

Status: **code and local rehearsal only.** `VERCEL_CONFIG_APPLY`, `ADMIN_REDEPLOY`, `EC2_ADMIN_ORIGINS_APPLY`, `ADMIN_LOGIN_LIVE`, `ADMIN_CALENDAR_READ_LIVE`, `ADMIN_CALENDAR_WRITE_LIVE`: `NOT_RUN`. Owner-provided Admin production origin: `https://the-bha-hotels-booking.vercel.app` (no trailing `/`); that the project exists with that URL, its Root Directory and its Production branch are **not verified by Claude** (checklist A). Customer stays at `https://the-bha-hotels-booking-p5rj.vercel.app`. Cloud facts below (API behind Caddy at `https://the-bha-api.52-65-145-145.sslip.io`, image digest `sha256:d01c7d9d2b9d6cd311f77dcd8a1e49daae12a101efb6c8e1db50c9a07d98b4b6`, RDS data, the existing Staff Manager of Riverside `a1000000-0000-0000-0000-000000000001`) are `OWNER_VERIFIED`, not re-tested.

How it works: with `API_PROXY_ORIGIN` set at build time, `Front_End/Admin_Web/next.config.ts` rewrites exactly `/api/admin/v1/:path*` to `<upstream>/api/admin/v1/:path*` (prefix, suffix and query kept). Customer `/api/v1/*`, `/health/*` and every other path are **not** forwarded. `NEXT_PUBLIC_API_BASE_URL` is the Admin origin itself, so Staff sign-in, `me`, the board and the five writes are same-origin calls and the Staff cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/admin`) is first-party on the Vercel host. The API still requires, for every Staff `POST` (login, logout, the writes), exactly one `Origin` that is in `Cors:AdminOrigins` (`StaffRequestBoundaryFilter`) — the browser sends the Admin origin on those same-origin POSTs, so the allowlist change in **C** is mandatory, and CORS headers are irrelevant to it.

**A. Vercel checklist (confirm before applying anything)**
1. The Admin project is separate from the Customer project, connected to this repository, **Root Directory `Front_End/Admin_Web`**, framework Next.js, **Production Branch `main`**, Node.js **22.x**, install `npm ci`, build `npm run build`. Do not use a Preview URL.
2. The code of this work item is on `main` (promotion is the Owner's; see D).

**B. Vercel Production environment (Production only; no database password or secret belongs here)**

| Variable | Value |
|---|---|
| `API_PROXY_ORIGIN` | `https://the-bha-api.52-65-145-145.sslip.io` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://the-bha-hotels-booking.vercel.app` |
| `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` | `Staff` |

`API_PROXY_ORIGIN` is server/build-time only and never `NEXT_PUBLIC_`. Both variables and the rewrite are fixed at build: **redeploy Production after setting them or after any code change**. A Preview build would keep the Production hostname as its API base and is not a working proxy — do not report Preview as working. The `sslip.io` host embeds the EC2 public IP (same limit as §7a).

**C. EC2: allow the Admin origin on the API (apply this before Vercel is redeployed)** — run on the EC2 host. Nothing below prints a secret; `/etc/the-bha/api.env` is only ever appended to, after a backup that is never replaced. No value in this block is a placeholder. Save it as a file and run it with `bash <file>` (it uses `set -e`: a STOP ends the script, not your login shell). Set `D="sudo docker"` if your user cannot run `docker` directly. The script is **create-before-stop**: the new container is created and checked first, the old one is stopped only then, and any failure after that point runs a rollback file that it wrote beforehand with literal values (path printed). It supports exactly the two bind mounts in use — `/var/lib/the-bha/keys` → `/var/keys` (read-write) and `/opt/the-bha/certs/rds-ca.pem` → `/certs/rds-ca.pem` (read-only), created with `--mount` (a container created with `-v` has a different `HostConfig` shape and stops at the settings comparison, before anything is stopped) — and recreates them with `--mount`; every other setting it reads back from the running container. It STOPs, changing nothing, if the container is not shaped as expected (image, network, port binding, exactly those two mounts with those modes, variable names, empty key directory).

```bash
set -euo pipefail
export LC_ALL=C          # sort and comm must agree on the collation
D="docker"
ENVF=/etc/the-bha/api.env
ADMIN=https://the-bha-hotels-booking.vercel.app
OLD=the-bha-api
IMG=944850790466.dkr.ecr.ap-southeast-2.amazonaws.com/the-bha-api@sha256:d01c7d9d2b9d6cd311f77dcd8a1e49daae12a101efb6c8e1db50c9a07d98b4b6
CPORT=8080
HPORT=8080
KEYS_SRC=/var/lib/the-bha/keys          # -> /var/keys, read-write (Data Protection key ring = session/antiforgery keys)
CA_SRC=/opt/the-bha/certs/rds-ca.pem    # -> /certs/rds-ca.pem, read-only (RDS CA bundle)
fail() { echo "STOP: $*" >&2; exit 1; }
# As the container's own user: the key ring is readable and writable, the CA readable but NOT writable.
mount_check() { $D exec "$1" sh -c 'test -r /var/keys && test -w /var/keys && test -r /certs/rds-ca.pem && ! test -w /certs/rds-ca.pem'; }

# C1. Read-only: the running container must be the approved image, shaped as the brief describes.
test "$($D inspect -f '{{.Config.Image}}' $OLD)" = "$IMG" || fail "$OLD is not the approved image reference"
case "$($D inspect -f '{{.HostConfig.NetworkMode}}' $OLD)" in default|bridge) ;; *) fail "not the default bridge network" ;; esac
test "$($D inspect -f '{{json .HostConfig.PortBindings}}' $OLD)" = "{\"$CPORT/tcp\":[{\"HostIp\":\"127.0.0.1\",\"HostPort\":\"$HPORT\"}]}" || fail "port bindings are not 127.0.0.1:$HPORT:$CPORT"
# Exactly the two bind mounts the Owner uses (created with --mount): the keys directory
# (read-write) and the RDS CA file (read-only). Source, destination and read/write mode of each are asserted.
test "$($D inspect -f '{{len .Mounts}}' $OLD)" = 2 || fail "expected exactly 2 mounts (keys, RDS CA)"
MOUNTS=$($D inspect -f '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' $OLD)
printf '%s\n' "$MOUNTS" | grep -qxF "bind|$KEYS_SRC|/var/keys|true" || fail "keys mount must be: bind $KEYS_SRC -> /var/keys, read-write"
printf '%s\n' "$MOUNTS" | grep -qxF "bind|$CA_SRC|/certs/rds-ca.pem|false" || fail "CA mount must be: bind $CA_SRC -> /certs/rds-ca.pem, read-only"
sudo test -d "$KEYS_SRC" || fail "$KEYS_SRC is not a directory on this host"
sudo test -f "$CA_SRC" || fail "$CA_SRC is not a file on this host"
sudo stat -c '%n owner=%u:%g mode=%a' "$KEYS_SRC" "$CA_SRC"     # information for you to read
KEYS_BEFORE=$(sudo ls -A "$KEYS_SRC" | wc -l)
[ "$KEYS_BEFORE" -gt 0 ] || fail "$KEYS_SRC is empty: there is no key ring to preserve (wrong directory?)"
mount_check $OLD || fail "inside $OLD the keys are not read-write or the CA is not read-only-readable"
RESTART=$($D inspect -f '{{.HostConfig.RestartPolicy.Name}}' $OLD)
LOGDRV=$($D inspect -f '{{.HostConfig.LogConfig.Type}}' $OLD)
LOGOPTS=$($D inspect -f '{{range $k,$v := .HostConfig.LogConfig.Config}}--log-opt {{$k}}={{$v}} {{end}}' $OLD)
echo "restart=$RESTART logdriver=$LOGDRV logopts=$LOGOPTS keyfiles=$KEYS_BEFORE"

# C2. Variable NAMES (never values) the container has that are in neither the env file nor the image defaults.
$D inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $OLD | cut -d= -f1 | sort -u > /tmp/bha-names-container
sudo sed -n 's/^\([A-Za-z_][A-Za-z0-9_.]*\)=.*/\1/p' "$ENVF" | sort -u > /tmp/bha-names-file
$D image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$IMG" | cut -d= -f1 | sort -u > /tmp/bha-names-image
EXTRA=$(comm -23 /tmp/bha-names-container <(sort -u /tmp/bha-names-file /tmp/bha-names-image))
[ -z "$EXTRA" ] || fail "variables set by hand on the container, not in $ENVF or the image: $(echo $EXTRA) — add them to the env file first"

# C3. Existing admin origins (public values), next free index, backup, append.
sudo grep -E '^Cors__AdminOrigins__[0-9]+=' "$ENVF" || echo "(no Cors__AdminOrigins entries yet)"
BK=""
if sudo grep -E '^Cors__AdminOrigins__[0-9]+=' "$ENVF" | cut -d= -f2- | grep -qxF "$ADMIN"; then
  echo "already present: nothing to add to $ENVF"
else
  IDX=$(sudo sed -n 's/^Cors__AdminOrigins__\([0-9][0-9]*\)=.*/\1/p' "$ENVF" | sort -n | tail -1)
  IDX=$(( ${IDX:--1} + 1 ))
  BK="$ENVF.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  sudo cp --preserve=all -n "$ENVF" "$BK"          # -n: never replaces an existing backup
  echo "backup: $BK"
  [ -z "$(sudo tail -c1 "$ENVF")" ] || echo | sudo tee -a "$ENVF" >/dev/null
  printf 'Cors__AdminOrigins__%s=%s\n' "$IDX" "$ADMIN" | sudo tee -a "$ENVF" >/dev/null
fi
sudo grep -E '^Cors__AdminOrigins__[0-9]+=' "$ENVF"     # the exact origin is present; other origins and Cors__AllowedOrigins__* untouched

# The rollback file, written NOW with literal values (no shell variable is needed to run it later).
RB="$HOME/bha-admin-origin-rollback-$(date -u +%Y%m%dT%H%M%SZ).sh"
cat > "$RB" <<EOF
#!/bin/bash
set -x
if $D inspect ${OLD}-prev >/dev/null 2>&1; then
  $D rm -f $OLD
  $D rename ${OLD}-prev $OLD
  $D update --restart=$RESTART $OLD
else
  $D rm -f ${OLD}-new || true
fi
$D start $OLD
$( [ -n "$BK" ] && echo "sudo cp --preserve=all '$BK' '$ENVF'" || echo "# env file was not changed" )
EOF
chmod 700 "$RB"; echo "rollback file: $RB"
rollback() { bash "$RB" || echo "ROLLBACK FILE FAILED - run it by hand: bash $RB" >&2; }

# C4. Create the new container first (nothing is stopped yet; docker reads the env file here).
$D create --name ${OLD}-new --restart "$RESTART" --log-driver "$LOGDRV" $LOGOPTS -p 127.0.0.1:$HPORT:$CPORT --env-file "$ENVF" \
  --mount type=bind,src="$KEYS_SRC",dst=/var/keys --mount type=bind,src="$CA_SRC",dst=/certs/rds-ca.pem,readonly "$IMG" >/dev/null \
  || { rollback; fail "docker create failed (env file unreadable by this user? set D=\"sudo docker\"); rolled back"; }
# Same settings as the running one? (mounts included). Differences end the run before anything is stopped.
F='{{json .HostConfig.Binds}} {{json .HostConfig.Mounts}} {{range .Mounts}}{{.Type}}:{{.Source}}:{{.Destination}}:{{.RW}} {{end}} {{json .HostConfig.PortBindings}} {{json .HostConfig.RestartPolicy}} {{json .HostConfig.LogConfig}} {{.HostConfig.NetworkMode}} {{json .HostConfig.CapAdd}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}} {{json .HostConfig.ReadonlyRootfs}} {{json .Config.User}} {{json .Config.Entrypoint}} {{json .Config.Cmd}}'
diff <($D inspect -f "$F" $OLD) <($D inspect -f "$F" ${OLD}-new) || { rollback; fail "container settings differ (see the diff above); rolled back"; }
echo "container settings identical"

# C5. Swap: stop the old, start the new, wait for /health/ready = 200, then rename. Any failure rolls back.
$D stop $OLD >/dev/null || { rollback; fail "could not stop $OLD; rolled back"; }
$D start ${OLD}-new >/dev/null || { rollback; fail "new container did not start; rolled back"; }
OK=no
for i in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$HPORT/health/ready || true)" = 200 ] && { OK=yes; break; }
  sleep 1
done
[ "$OK" = yes ] || { rollback; fail "/health/ready was not 200 within 60 s; rolled back"; }
mount_check ${OLD}-new || { rollback; fail "in the new container the keys are not read-write or the CA is not readable/read-only; rolled back"; }
KEYS_AFTER=$(sudo ls -A "$KEYS_SRC" | wc -l)
[ "$KEYS_AFTER" -ge "$KEYS_BEFORE" ] || { rollback; fail "key ring files went from $KEYS_BEFORE to $KEYS_AFTER; rolled back"; }
echo "key ring files: $KEYS_BEFORE before, $KEYS_AFTER after (the same directory, so existing sessions stay valid)"
$D rename $OLD ${OLD}-prev
$D update --restart=no ${OLD}-prev >/dev/null
$D rename ${OLD}-new $OLD
echo "done: $OLD is the new container; ${OLD}-prev (stopped, restart=no) is kept for rollback"
```

Rollback (C): run the file the script printed (`bash <the rollback file>`): it removes the new container (or swaps the names back if the swap had completed), re-applies the original restart policy, starts the old container and, if the env file was changed, restores it from the backup. Never delete `/var/lib/the-bha/keys`, never change the image, the Caddy config or `Hosting__TrustedProxy__*`. Remove `${OLD}-prev` and the backup only after the verification below passes and you decide to.

Verify after the recreate (from any machine; no cookie/password involved; `<ADMIN>` = `https://the-bha-hotels-booking.vercel.app`, `<API>` = `https://the-bha-api.52-65-145-145.sslip.io`):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' <API>/health/ready                      # 200
curl -sS -D - -o /dev/null <API>/api/v1/auth/csrf | head -n 12                    # Customer CSRF: 200, Cache-Control no-store
# Origin gate: a fake-credential login from the Admin origin must now be 401 (credentials refused), not 403 (Origin refused). Writes nothing; counts toward the login rate limit.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST <API>/api/admin/v1/auth/login -H 'Content-Type: application/json' -H 'Origin: https://the-bha-hotels-booking.vercel.app' --data '{"email":"nobody@example.invalid","password":"x"}'
```

**After the Vercel redeploy (B):**
```bash
curl -sS -D - -o /dev/null <ADMIN>/api/admin/v1/me | head -n 12                   # not signed in: 401, Cache-Control no-store
curl -sS -o /dev/null -w '%{http_code}\n' <ADMIN>/api/v1/properties               # 404: the Customer namespace is not proxied by Admin
```
Browser (DevTools → Network, "Preserve log"): open `<ADMIN>/signin`, sign in with the existing Staff Manager (you type the credentials; never paste them anywhere); `GET /api/admin/v1/me` → 200 with the Riverside membership; `/calendar` shows the board; reload keeps the session; Sign out, then `me` → 401. Every API call must go to `<ADMIN>` (never to `sslip.io`); the cookie `.TheBha.Staff` shows `HttpOnly`, `Secure`, `SameSite=Strict`, path `/api/admin`. Compare the board with the real booking `e659d463-4a07-20b0-3ce9-8f0588491394` on 15–17/10/2026. Do not assign, cancel or block anything for this check; `ADMIN_CALENDAR_WRITE_LIVE` is `PASS` only if you perform a write separately and keep the evidence. Do not copy cookies or passwords into any report.

**D. Promotion to `main` (Owner).** `main` and `develop` are different squash histories with the same tree, so a `develop` → `main` merge/PR conflicts. After this work item is squash-merged into `develop`, the release approach is: branch from `origin/main`, apply the new squash commit from `develop` (cherry-pick), open a PR into `main`, and check tree equality (`git rev-parse origin/main^{tree} origin/develop^{tree}` must match after the merge). Concrete commands are issued only once the new SHAs exist. Claude does not perform the promotion.

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
- **Backend tests on PostgreSQL 17.10 and 18.3** (`BHA-PG18-001`, test-only change): unit 244/244 and integration 847/847 on each, on separate local servers. The three assertions that failed on 18.3 in C1 were corrected (the version pin now accepts the verified majors 17 and 18; the parent-delete `RESTRICT` code is `23503` on 17 and `23001` on 18 — child inserts/updates and `NO ACTION` stay `23503`). No production code path depends on that code (report `BHA-PG18-001-completion.md`). This is a **local** gate: it proves nothing about RDS permissions, network or the CA.
- **No RDS CA bundle in the image**: `SSL Mode=VerifyFull` needs the bundle delivered to the task; `SSL Mode=Require` encrypts but does not verify the server certificate.
- Key ring unencrypted at rest (§5). In-process rate limiter (§5). Placeholder property details (D6). Two room types have no photographs (D5).

## 10. Rollback

Redeploy the previous image tag/digest. Migrations are forward-only: before applying them take an RDS snapshot (§11 step 6) and restore it if the schema must go back; there is no down-migration script for production use. The catalog import is one transaction, so a failed run changes nothing; removing imported rows afterwards is a deliberate Owner decision — there is no blanket delete script.

## 11. Owner-led run packet (`BHA-DEPLOY-001-CP01`, correction C1)

Rehearsal: routes A and B below (C1 of the earlier work item) and route R (`BHA-PG18-001` correction C1, evidence in `docs/reports/BHA-PG18-001-completion.md`), the roles/privileges, the migration (twice), the catalog import, the Staff CLI and the API (as `bha_app` over `sslmode=verify-full`/`SSL Mode=VerifyFull`) were exercised by running these very command blocks (with only the host, port, database, master role name and CA path substituted) against an isolated local PostgreSQL 18.3 — see `docs/reports/BHA-DEPLOY-001-CP01-completion.md` §11. That proves the ordering and the SQL; it does **not** prove anything about RDS permissions, network or the RDS CA.

Every step is performed by the Owner on the Owner's machine; Claude has not run, and does not run, anything against AWS, RDS, Vercel or DNS. **Never** put a password, connection string or token on a command line, in shell history or in chat.

**Target facts supplied by the Owner (`OWNER_VERIFIED`, not checked by Claude — no `aws` CLI/profile on Claude's machine):** RDS instance `the-bha-db`, region `ap-southeast-2`, endpoint `the-bha-db.cpesw6uoopkp.ap-southeast-2.rds.amazonaws.com:5432`, engine **PostgreSQL 18.3**, client `psql` 18.4. The Owner has, as evidenced: created the database `thebha` as the RDS master `postgres` (0 public base tables observed at that time); read `rds.allowed_extensions = *` and `btree_gist` default 1.8, `trusted = true`, not installed; created `bha_operator` and `bha_app` (both `LOGIN`; `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`; passwords set with `\password`); moved ownership of `thebha` to `bha_operator` and revoked the temporary membership `bha_operator → postgres`; logged in directly as `bha_operator` over TLS 1.3 (`session_user = current_user = bha_operator`); and, as `bha_operator`, run `BEGIN; CREATE EXTENSION btree_gist; ROLLBACK;` successfully (`installed_version` empty afterwards) — `OWNER_RDS_ROLE_BOOTSTRAP` and `RDS_EXTENSION_PERMISSION`: `OWNER_VERIFIED_PASS`.

**Not evidenced / still pending — none of it may be assumed done:** `REVOKE ALL ON DATABASE thebha FROM PUBLIC` and `GRANT CONNECT ON DATABASE thebha TO bha_app` (the last two statements of step 4; this packet keeps them as pending hardening, step 4R), a fresh emptiness check (the 0 tables were seen *before* migration and are not a substitute), the RDS snapshot, migration, table privileges and default privileges for `bha_app`, a `bha_app` login, catalog import, Staff accounts, deployment. **Not verified by anyone:** security-group/public-access settings, CA validation as used by the API, API runtime, IAM, ECR, Vercel, DNS.

**Which route? Read the table; the read-only checks decide, not memory.** The Owner's evidenced state is the last row but one (route **R**).

| What is actually on the target | Route | Steps |
|---|---|---|
| database `thebha` does not exist, and `bha_operator`/`bha_app` do not exist | **A — fresh** | 1, 2, 3, 4 (create roles, `CREATE DATABASE … OWNER bha_operator`), 5, 6 … |
| `thebha` exists, owned by the master, and the roles do not exist (the state before the Owner's bootstrap) | **B — existing, not yet bootstrapped** | 1, 2, 3, 4 (create roles, `ALTER DATABASE … OWNER TO bha_operator`; never drop/recreate/truncate), 5, 6 … |
| `thebha` is owned by `bha_operator`, both roles exist with the evidenced flags and no stray memberships (**the Owner's evidenced state**) | **R — resume** | 1, 2, **3R** (read-only verification), **4R** (pending hardening), 5, 6 … — **skip steps 3 and 4 entirely**: no `CREATE ROLE`, no password reset, no `CREATE DATABASE`, no `ALTER DATABASE … OWNER`, no membership grant to the master |
| anything else: roles with those names but different flags, unexpected memberships, a database owned by another role, or a role of unknown origin | **stop** | report the exact output (no secrets) and decide with the Owner/OC; do not proceed and do not "fix" it by resetting or dropping |

Whatever the route, nothing may `DROP`, recreate, truncate or seed `thebha`, and the Development seeders are never used.

**Three identities, never mixed:**

| Identity | Used for | Never used for |
|---|---|---|
| bootstrap = RDS master `postgres` | routes A/B, steps 3–4 only: inventory, roles, database creation/ownership (route R does not need it: that bootstrap is already evidenced) | migrations, import, the API, the Staff CLI |
| operator `bha_operator` | owns database `thebha` and its objects: pending hardening (step 4R), migration, privilege grants, catalog import | the API |
| application `bha_app` | runtime: API and Staff CLI — `SELECT/INSERT/UPDATE/DELETE` only, no DDL, not an owner | migrations |

**Conventions.** A line that still contains `<…>` is a **template — do not paste it until every `<…>` is replaced**; this includes `<RDS CA bundle path>` and `<image>`. `psql` meta-commands (`\password`) are written on their own lines for an interactive session. Verification ("Expect") lines are results to compare; stop if one differs.

```bash
# --- once per shell: no secrets here ---
export BHA_HOST=the-bha-db.cpesw6uoopkp.ap-southeast-2.rds.amazonaws.com
export BHA_PORT=5432
export BHA_DB=thebha
export BHA_MASTER=postgres
export BHA_CA=<RDS CA bundle path>            # TEMPLATE: the PEM bundle you downloaded from AWS
export PGPASSFILE="$HOME/.bha-pgpass"

pgas() {   # pgas <database> <role> [psql options]   — always verify-full; the password comes from PGPASSFILE
  local db="$1" role="$2"; shift 2
  psql "host=$BHA_HOST port=$BHA_PORT dbname=$db user=$role sslmode=verify-full sslrootcert=$BHA_CA" -v ON_ERROR_STOP=1 "$@"
}
```

Password file — **keep what is already in it**: the first line creates the file only if it does not exist (it never truncates an existing one). Add the lines with an editor, not with `echo` into shell history:

```bash
test -e "$PGPASSFILE" || install -m 600 /dev/null "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
stat -c '%a' "$PGPASSFILE"     # expect: 600
# add (editor), one line per identity — '*' matches any database; the operator/app lines may use thebha instead of '*':
#   <BHA_HOST>:5432:*:postgres:<master password>
#   <BHA_HOST>:5432:thebha:bha_operator:<operator password>      (routes A/B: after step 4; route R: needed for step 3R — keep an existing line)
#   <BHA_HOST>:5432:thebha:bha_app:<application password>        (routes A/B: after step 4; route R: needed from step 8 — keep an existing line)
```

**Step 1 — verify the release and this packet's checkout (no branch switch needed).**

```bash
git fetch --prune origin
git show 6ae3fdd3306c50736c734712df5a0f2a1ab5054a:deploy/showcase/migrations/idempotent.sql | sha256sum   # expect d7d38722dee4ac0c2cc6412df8fbdda22286f28e3a918531881117da7019b406
sha256sum deploy/showcase/migrations/idempotent.sql                                                    # the file you will apply: expect the same hash
if git diff --quiet 6ae3fdd3306c50736c734712df5a0f2a1ab5054a HEAD -- Back_End deploy .github ':(exclude)Back_End/tests'; then
  echo "API source (Back_End minus tests), Dockerfile, deploy files and workflows identical to the release; Back_End/tests and Front_End are not part of the API image (listed below)"
else
  echo "STOP: the API runtime source differs from the release 6ae3fdd" >&2; false
fi
git diff --name-only 6ae3fdd3306c50736c734712df5a0f2a1ab5054a HEAD -- Back_End/tests Front_End
```

The API image contains only `Back_End`, so the `if` guards the **API release** and nothing else: it exits non-zero and prints `STOP` if anything under `Back_End` other than `Back_End/tests`, under `deploy`, or under `.github` differs from `6ae3fdd`. `Front_End` is deliberately outside the `if`: Customer_Web and Admin_Web are deployed by their own Vercel builds and cannot change the API release `6ae3fdd` / digest `sha256:d01c7d9d…98b4b6`. The guard is not "every runtime file of the repository" and it does not always pass: any backend, Dockerfile, deploy-artifact or workflow change still trips it.

Do not confuse the releases. **`6ae3fdd`** is the approved *API application release* (what step 2 builds). The **Customer and Admin source releases** are the `main` commit each Vercel project builds, recorded per deployment; they are not `6ae3fdd`. `17c15e7` is the earlier documentation-only `develop` commit; your checkout's HEAD additionally contains the `BHA-PG18-001` test changes, the Customer/Admin proxy work and later documentation.

The last command lists the excluded paths that differ, and what you see depends on the checkout. Expected: the five `BHA-PG18-001` test files under `Back_End/tests/TheBha.IntegrationTests/` (`BookingPersistenceTests.cs`, `PostgresVersionSupport.cs`, `PostgresVersionSupportTests.cs`, `PropertyInventoryPersistenceTests.cs`, `StaffIdentityPersistenceTests.cs`); the eight `Front_End/Customer_Web` files of `BHA-WEB-PROXY-001` (`.env.local.example`, `README.md`, `next.config.js`, `scripts/api-proxy-origin.cjs`, `src/lib/api/__tests__/apiProxyConfig.test.ts`, `src/lib/routePolicy.test.ts`, `src/lib/routePolicy.ts`, `src/middleware.ts`); and, on a checkout that includes `BHA-ADMIN-PROXY-001`, its five `Front_End/Admin_Web` files (`.env.local.example`, `README.md`, `next.config.ts`, `scripts/api-proxy-origin.ts`, `src/lib/api/apiProxyConfig.test.ts`). Any other path is unexpected: stop and report it. Optional: `deploy/showcase/scripts/regenerate-migration-sql.sh --check` (needs `dotnet-ef`) → `idempotent.sql is up to date`.

**Step 2 — build the image for exactly `6ae3fdd` (needed by step 10 and by the API; nothing is pushed here).** Built from an archive of the release into a temporary directory, so your checkout stays where it is:

```bash
tmp="$(mktemp -d)" && git archive 6ae3fdd3306c50736c734712df5a0f2a1ab5054a Back_End | tar -x -C "$tmp"
docker build -t bha-api:6ae3fdd -f "$tmp/Back_End/Dockerfile" "$tmp/Back_End"
docker image inspect bha-api:6ae3fdd --format '{{.Id}} user={{.Config.User}}'   # expect: an image id and user=app; note the id
rm -rf "$tmp"
```

**Step 3 — bootstrap connection and inventory (routes A and B only — route R skips to step 3R; identity: master, database `postgres` — which always exists; read-only).** Do not connect to `thebha` or as `bha_operator` yet (the one read-only `btree_gist` question below is the only exception, and only for route B): on a fresh target they may not exist.

```bash
pgas postgres "$BHA_MASTER" -At -c "select current_database(), current_user, split_part(version(),' ',2), s.ssl, s.version from pg_stat_ssl s where s.pid = pg_backend_pid()"
pgas postgres "$BHA_MASTER" -At -c "select datname, pg_get_userbyid(datdba) from pg_database where not datistemplate order by 1"
pgas postgres "$BHA_MASTER" -At -c "select rolname from pg_roles where rolname in ('bha_operator','bha_app')"
pgas postgres "$BHA_MASTER" -At -c "select rolsuper, rolcreaterole, rolcreatedb, (select pg_has_role(current_user, r2.oid, 'member') from pg_roles r2 where r2.rolname = 'rds_superuser') from pg_roles where rolname = current_user"
```

Expect: `postgres|<master>|18.3|t|TLSv1.3`; a database list that either contains `thebha|postgres` (**route B**) or does not contain `thebha` (**route A**); **no rows** for the third query (if `bha_operator`/`bha_app` already exist, stop — they were not created by this packet; do not reset them blindly); on RDS the last query should show the master as a member of `rds_superuser` (`f|t|t|t`); on a server without that role the last column is empty (as in the local rehearsal). The query is written so that a missing `rds_superuser` role gives an empty value, not an error. If the endpoint, version or TLS result differs from the Owner's facts above, stop.

*The single read-only question to answer before anything else* — can this server create `btree_gist` (a trusted extension on PostgreSQL ≥ 13)? Run it **in `thebha` as the master** (route B) — it only reads:

```bash
pgas "$BHA_DB" "$BHA_MASTER" -At -c "select v.name, v.version, v.trusted, coalesce(e.installed_version,'-') from pg_available_extension_versions v join pg_available_extensions e on e.name = v.name where v.name = 'btree_gist' and v.version = e.default_version"
```

Expect `btree_gist|<version>|t|-`. Report the output; it tells nothing yet about RDS permissions beyond availability (that is gate 5).

**Step 3R — route R only: verify the evidenced bootstrap, read-only (identity: `bha_operator`, database `thebha`).** The master is not used. These queries re-read what the Owner reported; any mismatch means *stop*, not *repair*:

```bash
pgas "$BHA_DB" bha_operator -At -c "select current_database(), current_user, session_user, split_part(version(),' ',2), s.ssl, s.version from pg_stat_ssl s where s.pid = pg_backend_pid()"
pgas "$BHA_DB" bha_operator -At -c "select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolvaliduntil is null from pg_roles where rolname in ('bha_operator','bha_app') order by 1"
pgas "$BHA_DB" bha_operator -At -c "select datname, pg_get_userbyid(datdba) from pg_database where datname = current_database()"
pgas "$BHA_DB" bha_operator -At -c "select r.rolname, m.rolname, am.admin_option, am.inherit_option, am.set_option from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member where r.rolname in ('bha_operator','bha_app') or m.rolname in ('bha_operator','bha_app') order by 1, 2"
pgas "$BHA_DB" bha_operator -At -c "select nspname, pg_get_userbyid(nspowner) from pg_namespace where nspname = 'public'"
```

Expect: `thebha|bha_operator|bha_operator|18.3|t|TLSv1.3`; exactly two role rows `bha_app|t|f|f|f|f|f|t` and `bha_operator|t|f|f|f|f|f|t` (can log in; not superuser/createdb/createrole/replication/bypassrls; no expiry); `thebha|bha_operator`; for memberships, **either no rows or only** the automatic administrative entries that PostgreSQL 16+ gives the creating master for each role it created — `bha_app|postgres|t|f|f` and/or `bha_operator|postgres|t|f|f` (admin option only: it can *manage* the role but cannot use its privileges: no inherit, no `SET`; revoking the Owner's temporary membership may or may not have removed such an entry — both outcomes are acceptable). The Owner's temporary membership was a different, usable entry (inherit/`SET`) and must be gone: **any row with `inherit_option` or `set_option` true, any member other than the master, or any membership of `bha_operator`/`bha_app` in another role is a mismatch**; `public|pg_database_owner`. **Stop and report** if a role is missing or has other flags, if a membership differs from that, if the owner is someone else, or if the TLS result differs — do not reset a password, recreate a role or change ownership to make it match. The extension gate is already `OWNER_VERIFIED_PASS` for exactly this database and role, so it is not run again on this route (step 5 says when to repeat it).

**Step 4 — roles and database ownership (routes A and B only — route R skips to step 4R; identity: master; database `postgres`; the Owner's explicit changes).** Open an interactive session — passwords are typed at the prompts, never in the statement:

```bash
pgas postgres "$BHA_MASTER"
```

```sql
CREATE ROLE bha_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password bha_operator
CREATE ROLE bha_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password bha_app
GRANT bha_operator TO CURRENT_USER;
```

`GRANT bha_operator TO CURRENT_USER` lets the master hand a database to that role (the RDS master is not a real superuser; rehearsed locally with a non-superuser master, and the Owner has since performed this sequence on RDS — `OWNER_VERIFIED`; the temporary membership was revoked afterwards). Then exactly one of:

```sql
-- route A (thebha does not exist):
CREATE DATABASE thebha OWNER bha_operator;
```

```sql
-- route B (thebha exists, created by the master and not yet bootstrapped; keep it, change only its owner):
ALTER DATABASE thebha OWNER TO bha_operator;
```

and, for both:

```sql
REVOKE ALL ON DATABASE thebha FROM PUBLIC;
GRANT CONNECT ON DATABASE thebha TO bha_app;
```

Verify (master, `postgres` database for the first, `thebha` for the second):

```bash
pgas postgres "$BHA_MASTER" -At -c "select datname, pg_get_userbyid(datdba) from pg_database where datname = 'thebha'"                  # expect: thebha|bha_operator
pgas "$BHA_DB" "$BHA_MASTER" -At -c "select nspname, pg_get_userbyid(nspowner) from pg_namespace where nspname = 'public'"            # expect: public|pg_database_owner
```

If the schema owner is not `pg_database_owner` (for example `postgres`), the operator cannot create tables in `public`: the master must run `ALTER SCHEMA public OWNER TO bha_operator;` in `thebha` — another explicit ownership change; record it. Add the operator and application lines to the password file now. After the `REVOKE ALL ON DATABASE thebha FROM PUBLIC` above, the master has no `CONNECT` right on `thebha` unless it holds one through the roles it belongs to — in the local rehearsal a non-superuser master lost access; whether the RDS master keeps it was not tested. Nothing in this packet needs the master in `thebha` after step 4 (everything runs as `bha_operator`), so do not grant it back just to look around.

**Step 4R — route R only: the database hardening that is still pending (identity: `bha_operator`, the database owner; database `thebha`).** Step 4's last two statements were **not** evidenced as run, and they are not skipped just because the roles exist. The owner of a database may revoke and grant on it, so the master is not needed and no membership is granted back to it. Run as an interactive session:

```bash
pgas "$BHA_DB" bha_operator
```

```sql
REVOKE ALL ON DATABASE thebha FROM PUBLIC;
GRANT CONNECT ON DATABASE thebha TO bha_app;
```

Verify:

```bash
pgas "$BHA_DB" bha_operator -At -c "select datacl::text from pg_database where datname = current_database()"
pgas "$BHA_DB" bha_operator -At -c "select has_database_privilege('bha_app', current_database(), 'CONNECT'), has_database_privilege('bha_operator', current_database(), 'CONNECT')"
```

Expect the ACL to list `bha_operator` (with its own privileges) and `bha_app=c/bha_operator` and **no** `=…` entry for PUBLIC, then `t|t`. Dependency: this must be done before the first `bha_app` login (step 8) and is independent of the migration. It changes who may connect, not any data. Stop if the owner is not `bha_operator`, or the `REVOKE`/`GRANT` is refused — report the message.

**Step 5 — gates before any migration (all routes; identity: operator; database `thebha`).** The connection that will apply the SQL (routes A/B: its first use; route R: already read in step 3R). The earlier observation of 0 tables was made before any of this and is not accepted in its place — run it now:

```bash
pgas "$BHA_DB" bha_operator -At -c "select current_database(), current_user, session_user, inet_server_addr(), split_part(version(),' ',2)"
pgas "$BHA_DB" bha_operator -At -c "select ssl, version from pg_stat_ssl where pid = pg_backend_pid()"
pgas "$BHA_DB" bha_operator -At -c "select count(*) from information_schema.tables where table_schema='public'"
pgas "$BHA_DB" bha_operator -At -c "select to_regclass('public.\"__EFMigrationsHistory\"')"
pgas "$BHA_DB" bha_operator -At -c "select pg_get_userbyid(d.datdba) = current_user, has_schema_privilege('public','CREATE'), r.rolsuper from pg_database d, pg_roles r where d.datname = current_database() and r.rolname = current_user"
pgas "$BHA_DB" bha_operator -At -c "select count(*) from pg_extension where extname = 'btree_gist'"
```

Expect: `thebha|bha_operator|bha_operator|<RDS address>|18.3`; `t|TLSv1.3`; **`0`** tables; an empty line; `t|t|f` (owns the database, may create in `public`, not a superuser); `0`. **If the table count is not 0, the history table exists or `btree_gist` is already installed, stop**: the database is not empty or not in the evidenced state — take a snapshot, have the Owner compare the schema, and do not apply (migration 7 converts legacy booking rows). Never `DROP`, recreate, truncate or seed to get back to 0.

Extension permission gate (a write attempt that is rolled back; nothing remains). **Routes A and B: run it once. Route R: do not run it — the Owner already ran exactly this as `bha_operator` on `thebha` (`OWNER_VERIFIED_PASS`); repeat it only if the database, the role, its privileges or the server configuration changed since, or you need to check a new difference.**

```bash
pgas "$BHA_DB" bha_operator <<'SQL'
BEGIN;
CREATE EXTENSION btree_gist;
ROLLBACK;
SQL
pgas "$BHA_DB" bha_operator -At -c "select count(*) from pg_extension where extname = 'btree_gist'"
```

Expect `BEGIN`, `CREATE EXTENSION`, `ROLLBACK` with no `ERROR`, then `0`. **If it fails with a permission error: stop and report the exact message.** Do not grant `rds_superuser` to `bha_operator` or `bha_app`. If the Owner decides the master should create the extension once (`CREATE EXTENSION btree_gist;` run as master in `thebha`), migration 8's `IF NOT EXISTS` then skips it — that route is untested; decide it explicitly. `RDS_EXTENSION_PERMISSION` is `OWNER_VERIFIED_PASS` for `bha_operator` on `thebha` (the Owner ran this very rolled-back test); repeat it only if the database or role changes.

**Step 6 — snapshot, then apply (identity: operator).** Take a manual RDS snapshot (console or `aws rds create-db-snapshot`) and wait for `available`. Right before applying, repeat the identity, table-count, history-table and extension-count queries of step 5 (not the rolled-back extension test), then:

```bash
pgas "$BHA_DB" bha_operator -f deploy/showcase/migrations/idempotent.sql
```

Expect: exit 0 and no `ERROR` (psql stops at the first error and the script is transactional per migration).

**Step 7 — verify the schema, then rerun once.**

```bash
pgas "$BHA_DB" bha_operator -At -c 'select "MigrationId" from "__EFMigrationsHistory" order by 1'   # expect 9 rows: 20260721175848_… through 20261001141847_AddStaffIdentityFoundation
pgas "$BHA_DB" bha_operator -At -c "select count(*) from information_schema.tables where table_schema='public'"   # expect 28 (27 tables + history)
pgas "$BHA_DB" bha_operator -At -c "select extname from pg_extension order by 1"                  # expect btree_gist and plpgsql
pgas "$BHA_DB" bha_operator -At -c "select count(*) from pg_trigger where not tgisinternal"        # expect 5
pgas "$BHA_DB" bha_operator -At -c "select count(*) from pg_tables where schemaname='public' and tableowner <> 'bha_operator'"   # expect 0
pgas "$BHA_DB" bha_operator -f deploy/showcase/migrations/idempotent.sql
```

Rerun expectation: exit 0, only the notice `relation "__EFMigrationsHistory" already exists, skipping`; repeat the first two queries: still 9 rows and 28 tables.

**Step 8 — application role privileges and first `bha_app` login (identity: operator for the grants; routes A/B did the `CONNECT` grant in step 4, route R in step 4R — it must exist before the login below).**

```bash
pgas "$BHA_DB" bha_operator <<'SQL'
ALTER DEFAULT PRIVILEGES FOR ROLE bha_operator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bha_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bha_operator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bha_app;
GRANT USAGE ON SCHEMA public TO bha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bha_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bha_app;
SQL
pgas "$BHA_DB" bha_app -At -c "select current_user, has_schema_privilege('public','CREATE'), pg_has_role(current_user,'bha_operator','member'), (select count(*) from \"Properties\")"
pgas "$BHA_DB" bha_app -c "CREATE TABLE public.bha_app_must_not_create (id int)"
```

Expect `bha_app|f|f|0`, and the last command to fail with `permission denied for schema public`. The application role owns nothing and cannot change the schema; a role with exactly these rights completed the whole customer booking flow and Staff login in the rehearsal.

**Step 9 — catalog import (identity: operator; only after the Owner confirms the report §4.1 fields).**

9a. Decide, in writing, the real values for: room numbers (currently `DEMO-*`), rate plan name, property description/address/city, and the rate window to sell (the local window ends 2027-01-04). Anything still a placeholder is imported as a placeholder.

9b. Produce the file from the **local** database (start only its PostgreSQL container; this reads, writes nothing):

```bash
docker exec the-bha-showcase-postgres-1 pg_dump -U thebha_showcase -d thebha_showcase_demo --data-only --column-inserts --no-owner --no-privileges \
  -t public.\"Amenities\" -t public.\"Properties\" -t public.\"RatePlans\" -t public.\"RoomTypes\" -t public.\"PhysicalRooms\" -t public.\"PropertyAmenities\" \
  -t public.\"RoomTypeAmenities\" -t public.\"Media\" -t public.\"PropertyMedia\" -t public.\"RoomTypeMedia\" -t public.\"DailyRoomRates\" > catalog-export.sql
sed 's#https://localhost:3000#https://thebhariverside.com#g' catalog-export.sql > catalog-import.sql
```

Check before using it: `grep -c "^INSERT INTO" catalog-import.sql` → **352** (Amenities 2, Properties 1, RatePlans 1, RoomTypes 3, PhysicalRooms 11, PropertyAmenities 2, Media 31, PropertyMedia 10, RoomTypeMedia 21, DailyRoomRates 270); `grep -c localhost catalog-import.sql` → **0**; `grep -ci "email\|phone\|password" catalog-import.sql` → **0**; edit the file (or run `UPDATE`s after the import) for the values of 9a. Keep it private and out of Git. Never dump the reservation, hold, block, audit, Staff or customer tables.

9c. Import as the operator, one transaction:

```bash
pgas "$BHA_DB" bha_operator --single-transaction -f catalog-import.sql
```

Expected: exit 0. Rerunning the same file fails on the first primary key (`PK_Amenities`), exit 3, and changes nothing. Check the row counts of 9b for those tables and **0** in `Reservations`, `InventoryHolds`, `StaffAccounts`, and `select substring("Url" from '^https?://[^/]+'), count(*) from "Media" group by 1` → only `https://thebhariverside.com` (31).

**Step 10 — Staff accounts (existing CLI in the Production image of step 2; identity: application role).** Needs the image from step 2 and the schema from step 7. The environment file is private (`chmod 600`) and holds `ConnectionStrings__TheBhaDatabase` and `BHA_STAFF_PASSWORD`; the connection string keeps certificate verification and mounts your CA file (no image change needed):

```bash
# env file contents (TEMPLATE — fill in with an editor):
#   ConnectionStrings__TheBhaDatabase=Host=<BHA_HOST>;Port=5432;Database=thebha;Username=bha_app;Password=<application password>;SSL Mode=VerifyFull;Root Certificate=/certs/rds-ca.pem
#   BHA_STAFF_PASSWORD=<staff password>
docker run --rm --env-file <private env file> -v "$BHA_CA":/certs/rds-ca.pem:ro \
  -e ASPNETCORE_ENVIRONMENT=Production -e DataProtection__KeysPath=/tmp/keys -e Logging__LogLevel__Microsoft.EntityFrameworkCore=Warning \
  bha-api:6ae3fdd --staff-create --email <staff email> --property-id a1000000-0000-0000-0000-000000000001 --role Manager
```

Expected first line `staff: target database <host>/thebha` (check it before any password matters), then `staff: created Staff <id> with Manager membership.` (roles `Manager` or `FrontDesk`); an existing email → "already exists; nothing was changed". The Property must exist, so this step comes **after** step 9 (or after any other way the Property was created). `DataProtection__KeysPath` only satisfies Production startup validation; use a scratch directory, not the production key ring. If a multi-certificate RDS bundle is rejected by the connection string, use the single-CA PEM for the region (untested with the real bundle).

**Step 11 — publish the image for exactly `6ae3fdd` (no automatic publish exists for it, see §3).** Create the ECR repository (immutable tags) first; then, with the image of step 2: `docker tag bha-api:6ae3fdd <registry>/<repository>:6ae3fdd3306c50736c734712df5a0f2a1ab5054a`, log in with `aws ecr get-login-password`, `docker push`, and record the digest with `aws ecr describe-images --repository-name <repository> --image-ids imageTag=6ae3fdd3306c50736c734712df5a0f2a1ab5054a --query 'imageDetails[0].imageDigest' --output text`. Deploy by digest.

**Step 12 — API runtime (decision pending).** Proposal: ECS on Fargate + encrypted EFS access point (uid 1654) at `/var/keys`, ALB with ACM certificate, health check `GET /health/ready` = 200. Environment: §5 table; `ConnectionStrings__TheBhaDatabase` for **`bha_app`** (never `postgres`), `SSL Mode=VerifyFull;Root Certificate=<path inside the task>` — **delivering the RDS CA bundle to the task is a dependency of this phase** (the image does not contain it; changing the image is a separate work item), and `SSL Mode=Require` is not an accepted shortcut. The API must serve **Production** with the `AdminCalendar` access mode left at its default **Staff**; never `LocalGate`. `Cors__AdminOrigins__0` must equal `https://admin.thebhariverside.com` exactly: Staff requests without that `Origin` get 403. A task started without the key volume must fail (guard) — do not point `KeysPath` at ephemeral disk to make it start.

**Step 13 — DNS and API checks.** `api.thebhariverside.com` → ALB. Independent checks: `/health/ready` 200; `/api/v1/properties` lists one property `the-bha-riverside`; `/api/admin/v1/me` without a session 401 (404 means the forwarded HTTPS scheme is not trusted → fix `Hosting__TrustedProxy__*`); availability for a future in-window range returns 3 / 2 / 6 rooms at 1,000,000 / 1,100,000 / 1,600,000 VND per night. **Do not run `smoke.sh` yet**: its image check requests `https://thebhariverside.com/media/...`, which exists only after step 15.

**Step 14 — Admin (Vercel project B).** Root `Front_End/Admin_Web`, Node 22, `NEXT_PUBLIC_API_BASE_URL=https://api.thebhariverside.com` (HTTPS, build-time — rebuild after any change), domain `admin.thebhariverside.com`, do not set `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE`. Check: sign in with the Staff account of step 10, `/calendar` shows the Riverside board from the API, sign out. Only the calendar is backed by the API; the other Admin template modules are mock/template and must not be reported as live. One write with audit (for example an operational block, then cancel it) is a separate Owner decision on live data. With the interim same-origin proxy (no purchased domain) use §7b instead: its EC2 `Cors__AdminOrigins__<index>` change and recreate come first.

**Step 15 — Customer (Vercel project A), then the smoke script.** Root `Front_End/Customer_Web`, Node 22 / npm 10, same `NEXT_PUBLIC_API_BASE_URL`, domain `thebhariverside.com`. When it is live: `API_BASE=https://api.thebhariverside.com MEDIA_BASE=https://thebhariverside.com deploy/showcase/scripts/smoke.sh` (health, properties, Staff route 401, every image URL `200 image/webp`). Then on the real hostnames: `/` → Stays search (Riverside, dates inside the rate window, guests) → Featured card with the API price → room page → offer → contact → hold → `/paydone` ("Đã giữ chỗ") → "Xác nhận đặt phòng" → confirmed. Verify in the database as the operator: one row each in `InventoryHolds` and `Reservations` (`Confirmed`) for that booking; the test booking is real data in the operational database — decide how to treat or cancel it. Customer sign-in pages of the template are not a real customer auth UI; Staff login is the real login.

**Never** run the integration tests (`dotnet test` of `TheBha.IntegrationTests`) with `ConnectionStrings__TheBhaDatabase` pointing at RDS: the test factory connects to the `postgres` database of the server it is given and issues `CREATE DATABASE`, `DROP DATABASE … WITH (FORCE)` and `TRUNCATE` for its own throw-away databases. Also never use `deploy/showcase/scripts/apply-migration-sql.sh` or the Development seeders against RDS.

**Stop conditions.** Wrong account/region/endpoint; version or TLS result differs from the Owner's facts; `bha_operator`/`bha_app` already exist unexpectedly; the database is not empty at step 5; the extension gate fails; any "Expect" differs; the API would need an ephemeral key directory or `SSL Mode=Require`; 5432 would have to be opened to the internet. Report the exact output (without secrets) before continuing.
