# CUST-WEB-SHOWCASE-001 — deploy runbook (Owner executes)

> Status: **reviewable plan, nothing here has been executed in any cloud.** The Owner performs every step that touches AWS, Vercel, DNS or a real database. Claude (CP02) prepared the artifacts and rehearsed the same arrangement locally with Docker (see `docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md`). Statuses: `DEPLOY_LIVE: NOT_RUN`, Vercel `NOT_TESTED`, `PUBLISH: NOT_RUN`.

## 0. Shape

```
Browser ──https──> Vercel project A  (Customer_Web)   book.<domain>
        ──https──> Vercel project B  (Admin_Web)      admin.<domain>
        ──https──> ALB (TLS) ──http──> API container  api.<domain>   ──> RDS PostgreSQL 17
                                        └─ /var/keys  (durable shared volume: Data Protection key ring)
```

The API is one container image (`Back_End/Dockerfile`). Nothing is seeded at startup and migrations are not run at startup.

## 1. Hard requirement: one registrable domain (custom domain is mandatory)

Customer and Staff sessions are cookies set by the API and sent with `credentials: include` from the browser apps. The Customer cookie is `SameSite=Lax`, the Staff cookie is `SameSite=Strict`, and the antiforgery cookie rides with the Customer flow. Those rules are not changed by this work item.

- Two Vercel projects on `*.vercel.app` plus an API on an AWS default hostname are **three different sites** (`vercel.app` is on the Public Suffix List, so each project is its own site). Browsers do not send `Lax` cookies on cross-site `fetch`/XHR and never send `Strict` ones, so Staff sign-in and the Customer session would fail. This is a property of the cookie rules, **not** a test result — it was not tested on Vercel.
- Therefore: put all three under **one registrable domain you control**, e.g. `book.example.vn` (Customer), `admin.example.vn` (Admin), `api.example.vn` (API). Same-site holds across those subdomains.
- CORS must list exactly those origins (§5). Wildcards are refused by the API at startup.

## 2. Decisions the Owner makes first

| # | Decision | Notes |
|---|---|---|
| D1 | Domain and the three hostnames | Needed before anything else (§1). |
| D2 | RDS database name | Must contain `demo` or `showcase`; the seed CLI refuses any other target. |
| D3 | API runtime | **Recommended: ECS on Fargate + encrypted EFS** (the key ring needs a durable volume shared by all tasks). App Runner has no durable shared volume, so it cannot satisfy §5 without a code change that is out of scope. |
| D4 | Final Customer origin for the seed (`--media-base-url`) | = `https://book.<domain>`. Changing it later is **not** a rerun: new URLs insert 13 more Media rows and links (§6). |
| D5 | Photo policy | Only 13 camera photographs are published; 62 originals carry AI-generation credentials and 1 is unverifiable. The 1PN and 1PN-view types therefore show a neutral placeholder. Replacing them with real photographs is an Owner/content task. |
| D6 | Real property details | Address, city, description, amenities beyond pool/rooftop are placeholders ("Đang cập nhật") until the Owner supplies them. |

## 3. Build and publish the API image

`.github/workflows/backend-image.yml` builds the image on every pull request touching `Back_End/**` (no push, no credentials). Publishing to ECR is **off by default**:

1. Owner creates the ECR repository and an IAM role trusted for GitHub OIDC (repo `emLamHD/The_BHA_hotels_Booking`, the `showcase-publish` environment) with push-only permissions on that repository.
2. Owner sets repository variables `ECR_PUBLISH_ENABLED=true`, `AWS_ECR_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY` and optionally protects the `showcase-publish` environment.
3. Run the workflow manually (`Actions → Backend image → Run workflow`, `publish = true`). The tag is the commit SHA.

Manual alternative: `docker build -t thebha-api:<sha> Back_End` then push from an authenticated machine. Image properties (verified locally): non-root user `app`, port 8080, `ASPNETCORE_ENVIRONMENT=Production`, `/var/keys` owned by `app`, no secrets baked in.

## 4. RDS and migrations

1. RDS for PostgreSQL **17**, encrypted, in private subnets. Security group: inbound 5432 only from the API task's security group and from the operator's access path (SSM port forward or bastion). Create a role for the application (not the master user) and the database named per D2.
2. Apply the schema with the checked-in idempotent script — safe to run twice, nothing is applied at startup:

   ```bash
   psql "<connection string from a secret store, via env var>" -v ON_ERROR_STOP=1 -f deploy/showcase/migrations/idempotent.sql
   ```

   Expect 9 rows in `"__EFMigrationsHistory"`. Regenerate/verify the file after any migration change: `deploy/showcase/scripts/regenerate-migration-sql.sh [--check]`.
3. Never commit or print the connection string. Never copy rows from a local database to RDS.

## 5. API runtime configuration

Environment variables (values from the secret store; none belong in Git):

| Variable | Value |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` (image default) |
| `ConnectionStrings__TheBhaDatabase` | Npgsql connection string for the application role (SSL required on RDS) |
| `Cors__AllowedOrigins__0` | `https://book.<domain>` |
| `Cors__AdminOrigins__0` | `https://admin.<domain>` |
| `DataProtection__KeysPath` | `/var/keys` (image default) — **must** be a durable volume shared by every task |
| `Hosting__TrustedProxy__Enabled` | `true` |
| `Hosting__TrustedProxy__KnownNetworks__0` | CIDR of the ALB subnets (or the VPC range), e.g. `10.0.0.0/16`. No `/0`, nothing wider than `/8` (the API refuses to start). |
| `Hosting__TrustedProxy__ForwardLimit` | `1` (one TLS terminator) |

TLS terminator rules: terminate TLS at the ALB; target group protocol HTTP to port 8080, health check `GET /health/ready` expecting 200 (503 means the database is unreachable). The ALB must send `X-Forwarded-Proto` and `X-Forwarded-For` (it does by default). Redirect HTTP→HTTPS at the ALB itself. Do not expose port 8080 to anything but the ALB: the API trusts forwarded headers only from the configured network, so any other peer's claim of HTTPS is ignored (verified by tests).

Data Protection key ring: keys are written to `/var/keys` **unencrypted at rest** (the ASP.NET Core warning "No XML encryptor configured"; adding key encryption needs packages or certificates, which this work item may not add). Mitigation to require: encrypted EFS, an access point restricted to the container user (uid 1654), no other mounts, backup excluded or encrypted. Losing the directory logs every user out and invalidates antiforgery tokens; sharing it across tasks is what keeps sessions valid. Verified locally: recreating the container on the same volume keeps Customer sessions and antiforgery tokens valid; a fresh volume does not (`deploy/showcase/scripts/verify-key-persistence.sh`).

Single instance recommended for the showcase: the rate limiter is in-process, so N tasks multiply the effective limits.

## 6. Seed the demo catalog (operator machine, Development mode on purpose)

The seeder is a guarded operator command, not a startup step. It runs only with `ASPNETCORE_ENVIRONMENT=Development` on the operator's machine, against a database whose name (`current_database()`) equals `--expected-database` and contains `demo` or `showcase`. It inserts only (natural keys, never UPDATE/DELETE) and is idempotent.

```bash
export ASPNETCORE_ENVIRONMENT=Development
export ConnectionStrings__TheBhaDatabase="<RDS connection string via SSM/secret, not typed into history>"
dotnet Back_End/src/TheBha.Api/bin/Release/net8.0/TheBha.Api.dll --seed-riverside-demo \
  --expected-database <D2 name> --media-base-url https://book.<domain> \
  --from <YYYY-MM-DD, today or later in Vietnam time> --days 90 --dry-run
# review the plan (expect: property 1, amenities 2, room types 3, rate plan 1, rooms 11, rates 3 x days, media 13, links 15)
# then the same command with --apply; a rerun with the same options must report 0 inserts.
```

Exit codes: 0 ok, 1 failure, 2 usage, 3 target refused (environment/database name), 4 conflict (data that must not be overwritten). Extend the window later by re-running with a larger `--days`; only the missing nights are inserted. **Do not change `--media-base-url` on a rerun** (it would insert a second set of Media rows).

Staff accounts (Admin sign-in) are created with the Staff CLI, password only via environment or hidden prompt:

```bash
BHA_STAFF_PASSWORD='<from a secret store>' dotnet TheBha.Api.dll --staff-create --email <staff email> --property-id <property id> --role Manager
```

## 7. Vercel (two projects, same repository)

| | Customer project | Admin project |
|---|---|---|
| Root directory | `Front_End/Customer_Web` | `Front_End/Admin_Web` |
| Domain | `book.<domain>` | `admin.<domain>` |
| Node | 22 (`.nvmrc` 22.23.1) | 22 |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.<domain>` (**https only, build-time**; rebuild after changing) | same |
| Other | — | leave `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` unset (Staff is the default; `LocalGate` is refused in a production build) |

The Riverside photographs are static files in `Front_End/Customer_Web/public/media/the-bha-riverside/` and are served by the Customer project at `https://book.<domain>/media/the-bha-riverside/<name>.webp`; the seeded `Media.Url` values must therefore use that origin (D4). Only that exact path shape bypasses the template's default-deny routing. Hard reloads drop an in-memory hold (existing behavior).

## 8. Post-deploy verification

```bash
API_BASE=https://api.<domain> MEDIA_BASE=https://book.<domain> deploy/showcase/scripts/smoke.sh
```

It checks `/health/ready` 200, the public properties route, that the Staff session route answers 401 without a session (404 would mean the forwarded HTTPS scheme is **not** trusted — fix `Hosting__TrustedProxy__*`), and that every image URL the API returns answers `200 image/webp`. Then, in a real browser on the three real hostnames: Customer search → hold → confirm; Admin sign-in → `/calendar`. Safari/WebKit was not run in CP02.

## 9. Known risks (not fixed here)

- **Stale Customer cookie → 401** on `POST /booking-holds` and `POST /auth/logout` still open (backend auth change needs its own work item).
- **No EF retry strategy.** Observed locally: after the database was restarted, the first request on a pooled connection returned 500 (`57P01`), later ones succeeded. Expect the same for the first requests after an RDS failover or maintenance restart.
- `/_next/static/<missing>` returns 500 under `next start` on Node 22 locally (framework behavior, not served by Vercel's static layer).
- Key ring unencrypted at rest (§5). In-process rate limiter (§5). Placeholder property details (D6). Two room types have no photographs (D5).

## 10. Rollback

Redeploy the previous image tag (migrations are forward-only and additive in this release: the SQL is the same 9 migrations as before CP02). Seeding is insert-only; removing demo rows is a deliberate Owner decision — there is no blanket delete script.
