# BHA-WEB-PROXY-001 — Customer same-origin proxy (completion report)

Implementer: CLAUDE (`ACTIVE_EXECUTOR`) · Reviewer: CODEX_READ_ONLY (not yet run) · Date: 2026-10-08
Branch `feat/bha-web-proxy-001-customer` from `origin/develop` = baseline `5eb0a387e51ee863d9b1edb3ddb6e8e773bf05c9` (verified after `git fetch --prune origin`). The final head and PR number are in the PR itself (a commit cannot contain its own SHA).

## Status

| Item | Status |
|---|---|
| CONFIG_IMPLEMENTATION | PASS (with one documented out-of-allowlist change, below) |
| LOCAL_PROXY_REHEARSAL | PASS — transport only, fake data, local fixture |
| BUILD / lint / tests | PASS locally (CI: see PR checks) |
| VERCEL_CONFIG_APPLY, CUSTOMER_REDEPLOY, CUSTOMER_LOGIN_LIVE, CUSTOMER_BOOKING_LIVE, ADMIN_DEPLOY | NOT_RUN |
| REVIEW | NOT_RUN (Owner invokes) |

## What changed

- `Front_End/Customer_Web/scripts/api-proxy-origin.cjs` (new, CommonJS so `next.config.js` stays a plain `module.exports`): reads `API_PROXY_ORIGIN`. Unset/blank → proxy off. Otherwise it must parse as an `https:` origin with no credentials, no query/fragment (the raw text is also checked for a bare `?`/`#`) and path `/`; it is normalized (lower-case host, no default port, no trailing slash). It must not equal the origin of `NEXT_PUBLIC_API_BASE_URL` or of `VERCEL_URL`/`VERCEL_BRANCH_URL`/`VERCEL_PROJECT_PRODUCTION_URL` (loop guard). Errors name the variable and the rule only — never the value, and the URL parser's own exception is discarded (same policy as `src/lib/api/env.ts`). There is no http fallback and nothing touches TLS verification.
- `next.config.js`: `async rewrites()` returning `{ beforeFiles: [{ source: "/api/:path*", destination: "<origin>/api/:path*" }] }` when enabled, `[]` otherwise; `experimental`, `images` unchanged. When enabled it also sets `env: { BHA_API_PROXY_ENABLED: "true" }` (a boolean, not the origin).
- **Out of the allowlist, necessary (Owner guidance 2026-10-06: explain each):** `src/middleware.ts` + `src/lib/routePolicy.ts` (+ tests in `routePolicy.test.ts`). The middleware matches every path except `/_next/` and answered `/api/*` with a rewrite to the 404 page (CP02-C3 default-deny). Next runs middleware **before** `rewrites()`, so the config alone never reached the upstream. Reproduced before the fix: with the proxy build running, `GET /api/v1/auth/csrf` returned the `/showcase-unavailable` 404 page and the fixture saw no request. Fix: `decideRoute(path, { apiProxyEnabled })` passes `/api` and `/api/…` (exact lower-case prefix only — `/API/x` stays closed) when the build baked `BHA_API_PROXY_ENABLED`; the flag exists only if the same build configured the rewrite, so they cannot disagree. Default (no proxy) still 404s `/api/*`. Not done: no change to what other routes pass, no route handler, no catch-all. Using `beforeFiles` (instead of `afterFiles`) also stops the template stub `app/api/hello/route.ts` from answering `/api/hello` in proxy mode: everything under `/api` goes upstream.
- `.env.local.example`: local base unchanged; new empty `API_PROXY_ORIGIN=` with comment. `README.md`: direct/proxy table and Vercel env. `docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md`: new §7a (env, limits, read-only checks) and the API-release diff check now excludes `Front_End/Customer_Web` (the API image does not contain it; otherwise the check would print `STOP` after this PR). `docs/project/SNAPSHOT.md`: short entry.
- Tests: new `src/lib/api/__tests__/apiProxyConfig.test.ts` (validation, no value echo, self-origin, rewrite shape, unrelated config preserved, unset ⇒ no proxy) and extended `routePolicy.test.ts`. These do **not** prove transport; the rehearsal does.

## Local transport rehearsal (evidence)

Setup (all outside Git, in the session scratchpad, removed with the session): throw-away OpenSSL CA + `localhost` leaf (2-day validity, SAN `localhost`/`127.0.0.1`); HTTPS fixture on `127.0.0.1:47831` echoing what it received and replying with fake cookies; `npm run build` with `API_PROXY_ORIGIN=https://localhost:47831 NEXT_PUBLIC_API_BASE_URL=https://customer.rehearsal.invalid`; `next start -p 47832` with `NODE_EXTRA_CA_CERTS=<CA>` for that one process only (no `NODE_TLS_REJECT_UNAUTHORIZED`). No RDS, no production API, no real credentials.

- `.next/routes-manifest.json` → `rewrites.beforeFiles[0]`: `source /api/:path*`, `destination https://localhost:47831/api/:path*` (prefix kept). Direct build (env unset): `rewrites` is `[]`.
- GET `/api/v1/auth/csrf?x=1&y=a%20b&x=2` → upstream received `/api/v1/auth/csrf?x=1&x=2&y=a%20b`: status 200, query kept (Next regroups repeated keys and re-orders parameters; values and `%20` preserved).
- POST `/api/v1/booking-holds`, JSON body `{"roomTypeId":"fake","guests":2}`: upstream received method POST, the identical body, `Content-Type`, `Cookie: dummy_session=abc; dummy_af=def`, `Origin`, `X-CSRF-TOKEN`, `Idempotency-Key`; the client got `201 Created` and the upstream JSON.
- Response: two separate `Set-Cookie` lines (`fixture_a …; SameSite=Lax`, `fixture_b …; Path=/api; SameSite=Strict; Max-Age=60`) with their attributes unchanged, and `Cache-Control`, `CDN-Cache-Control`, `Vercel-CDN-Cache-Control` all `no-store`.
- Negative: the same server without the CA → `500`, log `Failed to proxy … UNABLE_TO_VERIFY_LEAF_SIGNATURE` (TLS verification is on). `/API/v1/auth/csrf` → 404. Direct-mode build: `/api/v1/auth/csrf` → 404. A normal page (`/listing-stay`) → 200.
- Config load with `http://…`, `https://user:pass@…`, a path, a query, an own-origin value and a non-URL each threw the expected error with no value in the message.
- Observed, not changed: under `next start` the forwarded `X-Forwarded-For`/`-Proto` arrive doubled (`127.0.0.1,127.0.0.1`, `http,http`) — Next's local proxy. On Vercel its edge does the proxying, and Caddy (default `reverse_proxy`, untrusted client) replaces `X-Forwarded-*` with its own before the API's `ForwardLimit=1`; that chain is Owner-side and was **not** tested. A trailing-slash request (`/api/x/`) is answered by Next's default 308 to the slash-less path.

## Checks run (Node v22.23.2, npm 10.9.8; `.nvmrc` 22.23.1)

- `npm ci` — run (replaced `node_modules`).
- Full `npx vitest run` (= `npm test`): 32 files, 572 tests passed. This includes the existing env/httpClient/csrf suites, unchanged and green.
- `npm run lint` — no warnings or errors.
- `npm run build` — proxy configuration (env above) succeeded; direct configuration (env unset) also succeeded (separate baseline).
- `git diff --check` — clean. No diff in `Back_End`, `Front_End/Admin_Web`, `.github`, `package.json`, `package-lock.json`. The Owner's `Front_End/Customer_Web/.gitignore` modification (`+.vercel`, `+.env*`) was left as is, not staged or committed; it remains modified in the working tree. Note: `.env*` there would ignore a *new* `.env.local.example`; the tracked file is unaffected.

## Owner actions after the code is on `main` (NOT done here)

1. Vercel → Customer project → Environment Variables, **Production only**: `API_PROXY_ORIGIN` = `https://the-bha-api.52-65-145-145.sslip.io`; `NEXT_PUBLIC_API_BASE_URL` = `https://the-bha-hotels-booking-p5rj.vercel.app`.
2. Redeploy Production from `main` (a rebuild is required — `NEXT_PUBLIC_*` and `rewrites()` are fixed at build).
3. Read-only checks: runbook §7a (`curl` the three URLs; Network tab shows calls only to the Vercel host).

## Risks / not verified

- Cookie behavior through Vercel, login and booking are unverified; the Vercel edge's rewrite handling (multiple `Set-Cookie`, headers, `no-store`) is as documented, not observed. Cloud facts are `OWNER_VERIFIED`.
- `sslip.io` host depends on the EC2 public IP. Preview deployments are not a working proxy (Production-only env).
- Out-of-allowlist middleware change touches the `/api/*` closed-by-default policy: closed unless the build opts in. Reviewer attention requested there.
- The proxy exposes the whole `/api/*` surface of the API on the Customer origin (including `/api/admin/v1/*`), as specified; the API's own Staff/Origin checks still apply. Restricting the source to `/api/v1/:path*` would be narrower — not done because the contract says `/api/:path`.
- `Origin` is forwarded unchanged; the API's CORS/Origin handling for the Vercel origin was not tested.

## Review

`READY_FOR_CODEX_REVIEW` — Owner must invoke `/codex:review --base origin/develop` (target: the Draft PR head; diff `origin/develop...HEAD`). Result: `NOT_RUN`; to be inserted verbatim if Owner forwards it.
