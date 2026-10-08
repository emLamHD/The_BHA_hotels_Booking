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
| REVIEW | NOT_RUN (Owner invokes) |
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

`docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md` §7b: (A) Vercel project checklist, (B) Production env (`API_PROXY_ORIGIN=https://the-bha-api.52-65-145-145.sslip.io`, `NEXT_PUBLIC_API_BASE_URL=https://the-bha-hotels-booking.vercel.app`, `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE=Staff`), (C) EC2 `Cors__AdminOrigins__<index>` with the concrete origin, env backup, recreate with the settings read back from the running container and a settings diff, rollback and verification, then browser steps and the booking `e659d463-4a07-20b0-3ce9-8f0588491394` cross-check, (D) the promotion approach. The only value left to be determined at run time is the `<index>`, which the script computes from the existing entries (no placeholder to fill). The packet's env-edit logic was tested against temporary files (existing entries, no trailing newline, gap, none, already present); the `docker` parts were syntax-checked but not run against any container of the target (`EC2_ADMIN_ORIGINS_APPLY` is `NOT_RUN`).

## Risks / not verified

- The Admin Vercel project (`the-bha-hotels-booking`) Root Directory (`Front_End/Admin_Web`) and Production branch are unverified — checklist A. An earlier PR showed three Vercel checks (two passing, one failing); which project is which was not established.
- Recreating the container is only as faithful as `docker inspect` of the running one; the C5 diff and the C2 variable-name comparison are there to catch hand-set flags. Anything the Owner's original `docker run` did that those fields do not show would be missed.
- Through Vercel → Caddy the API sees Vercel egress IPs as the client IP; the per-IP `auth-register`/`auth-login`/Staff login limiters are shared by all users of the demo.
- The proxy exposes only the Staff namespace of the API on the Admin origin; the Staff `Origin` allowlist and permission checks still apply server-side.
- `sslip.io` depends on the EC2 public IP. Preview deployments are not a working proxy.
- Promotion `develop` → `main` is the Owner's; `main` and `develop` are different squash histories with equal trees, so §7b D describes the cherry-pick approach and does not issue commands before the new SHAs exist.

## PR size and skill policy

Target 100–400 lines (WORKFLOW §6); the GitHub additions/deletions are in the PR body and the chat report. Groups: tests ≈ 130, validator ≈ 85, config ≈ 22, README/env example ≈ 40, runbooks ≈ 130 (the Owner packet is the bulk), SNAPSHOT ≈ 2, this report ≈ 75. Nothing padded; the packet is the deliverable the Owner executes.

Skills: none invoked. `diagnosing-bugs` NOT triggered (no unexpected behavior to diagnose; the 415 was a wrong test request). GRAPHIFY_POLICY `NOT_APPLICABLE`; GitNexus not used; no subagent.

## Review

`READY_FOR_CODEX_REVIEW` — Owner must invoke `/codex:review --base origin/develop` (limit: 1 invocation per implementation/correction completion). Result: `NOT_RUN`; to be inserted verbatim if Owner forwards it.
