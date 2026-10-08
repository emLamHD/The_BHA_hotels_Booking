# BHA-ADMIN-PROXY-001 — Admin same-origin proxy and Owner deployment packet (completion report)

Implementer: CLAUDE (`ACTIVE_EXECUTOR`) · Reviewer: CODEX_READ_ONLY (not yet run) · Date: 2026-10-08
Branch `feat/bha-admin-proxy-001` from `origin/develop` = baseline `f3c96160aa4e2aae0e785b6cf5a9994a2cf14a1b` (START_HEAD; verified after `git fetch --prune origin`; `origin/main` = `45511fbbb868a22530103672deb3a6190359c59f`; both trees `65e1be9992413721a500cc076ea71e10c1d650fc`). The final head and PR number are in the PR (a commit cannot contain its own SHA).

## Status

| Item | Status |
|---|---|
| CONFIG_IMPLEMENTATION | PASS |
| LOCAL_TRANSPORT | PASS — fixture HTTPS upstream, fake data |
| LOCAL_STAFF_AUTH | PASS — real API image + PostgreSQL 18.3, curl cookie jar (no browser) |
| BUILD / lint / tests (local) | PASS; CI result in the Owner-facing chat report and the PR checks |
| REVIEW | RUN by Owner on `7952fe9` — no findings (verbatim, Review section). Correction C1 (EC2 packet mounts): NOT_RUN, awaiting Owner |
| VERCEL_CONFIG_APPLY, ADMIN_REDEPLOY, EC2_ADMIN_ORIGINS_APPLY, ADMIN_LOGIN_LIVE, ADMIN_CALENDAR_READ_LIVE, ADMIN_CALENDAR_WRITE_LIVE | NOT_RUN |

Customer live, CSRF 200/no-store, guest booking written to RDS, RDS migration/import, the Staff Manager and Caddy/sslip.io are `OWNER_VERIFIED` history and were not re-tested or reset.

## What changed (all inside the allowlist)

- `Front_End/Admin_Web/next.config.ts`: `async rewrites()` returning `{ beforeFiles: [{ source: "/api/admin/v1/:path*", destination: "<origin>/api/admin/v1/:path*" }] }` when enabled, `[]` otherwise. The webpack SVG rule and the turbopack rules are unchanged (asserted by a test). No middleware, route handler or BFF; no dependency, `package.json` or lockfile change. Admin has no middleware blocking `/api`, so — unlike Customer — nothing outside the allowlist was needed.
- `Front_End/Admin_Web/scripts/api-proxy-origin.ts` (new): `API_PROXY_ORIGIN` unset/blank → direct mode. Otherwise a bare `https:` origin: no credentials, no query/fragment (the raw text is also checked for a bare `?`/`#`), path `/`; normalized (lower-case host, default port and trailing slash dropped). It must not equal the origin of `NEXT_PUBLIC_API_BASE_URL` or of `VERCEL_URL`/`VERCEL_BRANCH_URL`/`VERCEL_PROJECT_PRODUCTION_URL` (self-loop guard). Errors name the variable and the rule only, never the value, and the URL parser's exception is discarded. No http fallback; nothing touches TLS verification.
- `src/lib/api/apiProxyConfig.test.ts` (new, 29 tests): accept/normalize, 12 rejection cases that must not echo the value, self-origin (incl. case/trailing slash), Vercel hosts, unparseable `NEXT_PUBLIC_API_BASE_URL`, the rewrite shape (only `/api/admin/v1/:path*`), unset ⇒ `[]`, SVG rules preserved, config-load failure. These do **not** prove transport; the rehearsal below does.
- `.env.local.example` (empty `API_PROXY_ORIGIN=` with comment; local base unchanged), `README.md` (direct vs proxy table).
- `docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md`: §1 note, §7 table pointer, new **§7b Owner packet**, step-14 pointer, and the **API release guard** rewritten (below). `docs/runbooks/PMS-ADMIN-AUTH-001-staff-calendar.md` §2: the cookie/same-site and `Cors:AdminOrigins` wording now covers the proxy mode. `docs/project/SNAPSHOT.md`: short entry.

## API release guard (runbook step 1)

The API image contains only `Back_End`. The check is now `git diff --quiet 6ae3fdd… HEAD -- Back_End deploy .github ':(exclude)Back_End/tests'`: it still prints `STOP` for any backend (other than tests), Dockerfile/deploy artifact or workflow change, so it is not a guard that always passes. `Front_End` (both apps) is no longer in the `if`; the last command lists `Back_End/tests Front_End` differences and the runbook names the expected files (5 PG18 test files, 8 Customer files, 5 Admin files) and says anything else is unexpected. The Customer/Admin source release is the `main` commit Vercel builds, not `6ae3fdd`. Verified on this branch: the `if` succeeds; migration SQL SHA-256 is still `d7d38722dee4ac0c2cc6412df8fbdda22286f28e3a918531881117da7019b406`.

## Local transport rehearsal (evidence)

Setup (outside Git, in the session scratchpad): throw-away OpenSSL CA + `localhost` leaf (2-day validity); HTTPS fixture on `127.0.0.1:47841`; `npm run build` with `API_PROXY_ORIGIN=https://localhost:47841 NEXT_PUBLIC_API_BASE_URL=https://admin.rehearsal.invalid NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE=Staff`; `next start -p 47842` with `NODE_EXTRA_CA_CERTS=<CA>` for that process only (no `NODE_TLS_REJECT_UNAUTHORIZED`). Fake cookies/passwords only; no RDS, no production API.

- `routes-manifest.json` `rewrites.beforeFiles` has one entry: `source /api/admin/v1/:path*`, `destination https://localhost:47841/api/admin/v1/:path*`, regex `^/api/admin/v1(?:/(…))?(?:/)?$`. A direct-mode build has `beforeFiles: []`.
- GET `/api/admin/v1/me` without a cookie → upstream 401 with `no-store`, `cdn-cache-control` and `vercel-cdn-cache-control: no-store` returned. GET board path with `roomTypeId=a&roomTypeId=b` → upstream received the exact query string and the `Cookie`.
- POST `/api/admin/v1/auth/login` (JSON body, `Origin`, `Cookie`) → upstream received method, identical body, `Content-Type`, `Origin`, `Cookie`; client got 200, **two separate `Set-Cookie` lines** (`.TheBha.Staff=…; path=/api/admin; secure; httponly; samesite=strict` and a second) unchanged, and `no-store`.
- POST logout → 204, expired `.TheBha.Staff` cookie (`expires=1970`, `max-age=0`) and `no-store` returned; upstream saw the `Origin` and cookie.
- Namespace: `/api/v1/properties`, `/api/v1/auth/csrf`, `/api/hello`, `/health/ready`, `/api/admin/v2/me`, `/api/admin/v1x/me` → 404 from Admin (not proxied). `/API/admin/v1/me` → proxied (Next's rewrite regex is case-insensitive; the destination is the canonical lower-case path, so it reaches the same Staff namespace and nothing else). A trailing-slash request gets Next's default 308 to the slash-less path (the Admin client uses no trailing slash and fetches Staff calls with `redirect: "error"`).
- Without the CA trust → 500, log `Failed to proxy … UNABLE_TO_VERIFY_LEAF_SIGNATURE` (TLS verification is on).
- Config load with `http://…`, credentials, path, query, fragment, own-origin and non-URL values threw the expected errors (unit tests; the message never contains the value).

## Local Staff auth rehearsal (evidence)

Run id `ap6198`; every resource carried the label `bha.rehearsal=ap6198`. Isolated docker network `172.31.77.0/24`; PostgreSQL **18.3** container with the release SQL `deploy/showcase/migrations/idempotent.sql` applied (9 rows in `__EFMigrationsHistory`); one fake Property row inserted; API container from the local image `bha-api:6ae3fdd` (image id `d01c7d9d2b9d`, equal to the first 12 hex digits of the approved digest), `ASPNETCORE_ENVIRONMENT=Production`, `Cors__AdminOrigins__0=https://admin.rehearsal.invalid`, `Hosting__TrustedProxy__KnownProxies__0=172.31.77.1`, `ForwardLimit=1`, a named keys volume; Staff Manager created with the release CLI (`--staff-create`, random temporary password via an env file, never printed). A small local TLS terminator (leaf above) set `X-Forwarded-Proto: https` in front of the API; the Admin proxy build pointed at it.

| Step (through the Admin proxy, curl cookie jar) | Result |
|---|---|
| `me` before login | 401, `Cache-Control: no-store` |
| login (allowlisted Origin) | 200; `Set-Cookie .TheBha.Staff` with `path=/api/admin; secure; samesite=strict; httponly`; `Cache-Control: no-cache,no-store` |
| `me` | 200, membership "Rehearsal Property" / Manager |
| board GET for the fake property | 200 |
| logout (real client shape: JSON `{}`) | 204, expiry cookie; jar cleared |
| `me` after logout | 401 |
| login with a non-allowlisted Origin / no Origin / wrong password | 403 / 403 / 401 |

An earlier logout without a JSON body returned 415 — my test request was wrong (the real client sends `Content-Type: application/json` and `{}`), not a proxy defect. **Limits:** this is an HTTP client with a cookie jar, not a browser: browser SameSite handling, Vercel's edge, the real Vercel/Caddy header chain and the live API are `NOT_RUN`. The API's login responses carry `no-cache,no-store` (the extra `CDN-Cache-Control` headers exist only behind Caddy per Owner evidence).

Cleanup: after the run, only resources labelled `bha.rehearsal=ap6198` were removed (2 containers, 1 volume, 1 network; 0 left), the temporary env/password/cookie-jar files were deleted, and the three local listener processes were stopped. The Owner's `the-bha-postgres-1` container was not touched; no image was removed, pushed or published; no `docker prune`.

## Checks run (Node v22.23.2, npm 10.9.8; `.nvmrc` 22.23.1)

- `npm ci` in `Front_End/Admin_Web` — run.
- Targeted `src/lib/api/apiProxyConfig.test.ts`: 29/29. Full Admin `vitest run`: **37 files, 867 tests passed** (Admin count; not inherited from Customer).
- `npm run lint` — exit 0. `npm run build` (Next 16.1.6, Turbopack) succeeded in direct mode (env `NEXT_PUBLIC_API_BASE_URL=https://localhost:7145`, no proxy) and in proxy mode (above, twice with different fixture origins).
- `git diff --check` clean. No diff in `Back_End`, `Front_End/Customer_Web`, `.github`, `deploy/`, `package.json`, `package-lock.json`, Dockerfile or governance. Owner's untracked `Front_End/Customer_Web/.vercel/` and the stash holding the Customer `.gitignore` change were left alone and are not in the diff.

## Owner deployment packet

`docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md` §7b: (A) Vercel project checklist, (B) Production env (`API_PROXY_ORIGIN=https://the-bha-api.52-65-145-145.sslip.io`, `NEXT_PUBLIC_API_BASE_URL=https://the-bha-hotels-booking.vercel.app`, `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE=Staff`), (C) the EC2 script, browser verification and the booking `e659d463-4a07-20b0-3ce9-8f0588491394` cross-check, (D) the promotion approach (no commands before the new SHAs exist). Section 1 of the runbook is retitled (the shared registrable domain applies to direct mode only), its status header gets a dated Owner-verified update, and the Staff runbook's stale "Proxies" bullet now matches `Hosting:TrustedProxy`.

**EC2 script (C): hardened, then corrected in C1 for the Owner's real mounts.** It is create-before-stop: it asserts the running container's image reference, network mode (`default` or `bridge` — Docker 29 reports `bridge`), the exact `127.0.0.1:8080:8080` binding, and — C1 — **exactly the two bind mounts the Owner uses**, read from the container's runtime `.Mounts` (which `--mount` and `-v` both populate): `/var/lib/the-bha/keys` → `/var/keys` **read-write** and `/opt/the-bha/certs/rds-ca.pem` → `/certs/rds-ca.pem` **read-only**; each mount's type, source, destination and RW flag are matched exactly (any third mount, a wrong source, a read-write CA or a read-only key directory is a STOP). It also checks that the source directory/file exist on the host, prints their owner/mode, requires a non-empty key directory (the Data Protection key ring behind the Staff/Customer sessions and antiforgery tokens) and, with `docker exec` as the container's own user, that `/var/keys` is readable and writable and the CA is readable but not writable — in the old container before anything changes and again in the new one before the swap completes. The new container is created with `--mount type=bind,src=…,dst=/var/keys` and `--mount type=bind,src=…,dst=/certs/rds-ca.pem,readonly`, so it uses the **same host directory** (sessions stay valid; the key-file count before/after is printed and may not shrink); image digest, `127.0.0.1:8080:8080`, restart policy, log driver/options, `--env-file` and network are carried over. It STOPs if the container carries a variable name that is in neither the env file nor the image defaults; backs up the env file without ever replacing a backup; appends one `Cors__AdminOrigins__<index>=https://the-bha-hotels-booking.vercel.app` line (index from the existing entries); writes a rollback file with literal values; `docker create`s the new container under a temporary name; compares the two containers' settings (`HostConfig.Binds`/`Mounts`, runtime mounts with source, ports, restart, log config, network, caps, security options, user, entrypoint/cmd); and only then stops the old one, starts the new one, waits up to 60 s for `/health/ready` = 200 and renames. Any failure after the env edit runs the rollback automatically. A container created with `-v` instead of `--mount` has a different `HostConfig` shape, so it stops at the settings comparison before anything is stopped (not exercised).

**Local exercise of the exact configuration (C1).** Disposable containers named with run id `pm25615` on the default bridge: the real image `bha-api:6ae3fdd`, PostgreSQL 18.3 and **the old container created with `--mount type=bind,src=<keys dir>,dst=/var/keys --mount type=bind,src=<ca file>,dst=/certs/rds-ca.pem,readonly`**, `--restart unless-stopped`, json-file `max-size=10m`/`max-file=3`, an env file, host port parametrized (test copy only: paths, name, image, port; `sudo` shimmed because the files were mine). A real key file existed in the key directory.

| Case | Result |
|---|---|
| A. Happy path | settings identical; new container healthy (200); in the new container `/var/keys` writable, CA readable and not writable; both mounts present with the same sources; key ring 1 file before / 1 after (same directory); old kept stopped with `restart=no`; env line appended after the other origin; backup and rollback file written |
| B. Run the post-swap rollback file | names swapped back, `restart=unless-stopped` re-applied, both mounts intact, old container healthy (200), env restored from the backup (the added line gone), key file unchanged |
| C. `docker create` fails after the env edit (simulated) | `STOP … rolled back`; old container untouched and healthy, env restored |
| D. New container never healthy (database stopped) | `STOP: /health/ready was not 200 within 60 s; rolled back`; one container left under the name, env restored |
| E1–E4. CA mounted read-write / a third mount / keys mounted read-only / wrong keys source | each: `STOP` naming the rule at C1; old container untouched; no backup, no env change, no rollback file |
| E6. CA file mode 600 (unreadable by the app user) | `STOP` from the in-container permission check; nothing changed |

Not exercised: the empty-key-directory STOP (the API creates a key at startup, so an empty directory cannot be staged with a running container; the check is defensive), a `-v`-created container, Docker itself being down, and a new container that fails after the swap (the rollback file covers that manually). Defects found by these exercises and fixed: `sort`/`comm` collation (`LC_ALL=C`), a failing rollback hiding the STOP message, and — during C1 — nothing further in the script; two of my test runs failed because of the test setup (a `sudo` shim not exported to the rollback file, and the test PostgreSQL container getting a new IP after a restart, 172.17.0.2 → .3, which made the *test* API unhealthy; this also explains the 503 I saw after case D in the earlier exercise, which I had attributed to the EF retry risk — corrected here). Everything was removed afterwards (3 containers, no volumes or networks; temporary files and the rollback files in the home directory deleted). `EC2_ADMIN_ORIGINS_APPLY` stays `NOT_RUN`: nothing was run against the real EC2 host, container or env file.

## Risks / not verified

- The Admin Vercel project (`the-bha-hotels-booking`) Root Directory (`Front_End/Admin_Web`) and Production branch are unverified — checklist A. An earlier PR showed three Vercel checks (two passing, one failing); which project is which was not established.
- Recreating the container is only as faithful as `docker inspect` of the running one; the settings comparison and the variable-name check catch the usual hand-set flags, but a flag outside the compared fields (for example `--ulimit`, `--dns`, `--add-host`, health options) would not be carried over. Read the C1 output against your original `docker run` before proceeding.
- Through Vercel → Caddy the API sees Vercel egress IPs as the client IP; the per-IP `auth-register`/`auth-login`/Staff login limiters are shared by all users of the demo.
- The proxy exposes only the Staff namespace of the API on the Admin origin; the Staff `Origin` allowlist and permission checks still apply server-side.
- `sslip.io` depends on the EC2 public IP. Preview deployments are not a working proxy.
- Promotion `develop` → `main` is the Owner's; `main` and `develop` are different squash histories with equal trees, so §7b D describes the cherry-pick approach and does not issue commands before the new SHAs exist.

## PR size and skill policy

Target 100–400 lines (WORKFLOW §6); this PR is above it. Exact GitHub additions/deletions are in the PR body and the chat report (the report file cannot contain its own final count). From `git diff --numstat origin/develop` before this sentence was written: **+520/−20 = 540**. By group (additions/deletions): code and config — `next.config.ts` 22/0, `scripts/api-proxy-origin.ts` 93/0 (validator with the no-echo error policy); tests — `apiProxyConfig.test.ts` 114/0; Admin docs — README 12/2, `.env.local.example` 11/1; runbooks — deployment runbook 147/9 (the Owner packet, including the hardened and locally exercised EC2 script, is the bulk) and Staff runbook 15/7; SNAPSHOT 3/1; this report ≈105/0. Nothing was padded or compressed; the packet and its tests are the deliverable the Owner executes, so they were not trimmed to reach the target.

Skills: none invoked. `diagnosing-bugs` NOT triggered (no unexpected behavior to diagnose; the 415 was a wrong test request). GRAPHIFY_POLICY `NOT_APPLICABLE`; GitNexus not used; no subagent.

## Review

Reviewer: `CODEX_READ_ONLY`, invoked by Owner (one invocation for this implementation completion) as `/codex:review --base origin/develop`, against PR head `7952fe9c2cf8bd7a890fe6d6a7fba8d987026e69` (diff `origin/develop...HEAD`: 9 files, +520/−20). Result: **no findings**. Its output reports no test run of its own, so its checks are **NOT_RUN** as far as this record shows; the PASS results above (Admin vitest 867/867, lint, builds, local transport, local Staff auth, packet exercise) are Claude's local checks. Codex output, verbatim as forwarded by Owner:

```text
# Codex Review

Target: branch diff against origin/develop

The proxy is opt-in, forwards only the Admin Staff API namespace, and validates the upstream origin before configuring rewrites. I found no actionable regressions in the diff.
```

This review record is a documentation-only commit after the reviewed head; no code, test or packet content changed in it. No finding was left to fix.

## Correction C1 (EC2 packet mounts)

Scope: runbook §7b C and this report only; no proxy code, no cloud. Start `f59eef94147b7c9ae1ad0ed7b3f408921ffaeb40`. The packet now supports the two bind mounts the Owner actually uses (above) and was exercised with exactly that `--mount` configuration, including a successful run and rollbacks. The Codex result above covers `7952fe9`; this correction is **not yet reviewed**.

`READY_FOR_CODEX_REVIEW` — Owner must invoke `/codex:review --base origin/develop` (limit: 1 invocation per correction completion).
