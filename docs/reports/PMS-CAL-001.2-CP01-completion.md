# PMS-CAL-001.2-CP01 — Local Admin Write Gate Foundation — Completion Report

`IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (`docs/governance/RULES.md`
§2.4). Feature branch `feature/pms-cal-001-2-cp01-local-write-gate`, checked out
directly in the single primary repository checkout — no `git worktree add`, no
additional execution checkout, no subagent or parallel implementation at any
phase. Baseline `origin/develop` at
`e0f5a395aec15cc02e328433a97850e30e165675` (PR #41 merge commit), verified with
`git fetch --prune origin` before the branch was created.

Owner replaced the single large `PMS-CAL-001.2` PR with independent
checkpoints. **Only `CP01` is activated.** `CP02` is not started, and nothing in
this checkpoint begins it.

## 1. What was delivered

The foundation a later Admin Calendar write endpoint will opt into — and
nothing that can be written to.

1. **A separate write opt-in.** `AdminCalendarOptions.EnableUnauthenticatedWrite`,
   default `false` everywhere including Development, set by no checked-in
   `appsettings` file and no launch profile. It is independent of
   `EnableUnauthenticatedRead` in both directions. `Program.cs` refuses to start
   a Production host with it enabled, with its own message naming its own flag.
2. **A write-only resource filter.** `AdminCalendarWriteGateFilter`, registered
   in DI, never added to `MvcOptions.Filters`, never attached to the read board
   or any Customer route. No middleware, no policy engine, no base controller,
   no authorization framework.
3. **A CORS policy for future write routes.** `admin-calendar-write`: explicit
   `Cors:AdminOrigins`, POST only, `Content-Type` only, **no**
   `AllowCredentials()`. The default policy and the `admin-calendar`,
   `customer-web` and `properties-catalog-read` policies are unchanged.
4. **The composition contract**, proven rather than asserted: write gate filter
   + `[EnableCors("admin-calendar-write")]` + scoped `[IgnoreAntiforgeryToken]`
   on the same controller/action. The global Customer
   `AutoValidateAntiforgeryTokenAttribute` is untouched.
5. **No production mutation endpoint.** The composition is pinned by a
   test-only controller that lives in the test assembly and is registered only
   by a test `WebApplicationFactory`. `TheBha.Api` contains no controller that
   applies the gate, and the OpenAPI document publishes no new path or method.

Enabling the flag today opens nothing: no assignment, move or block route
exists to be opened.

## 2. Files changed

| File | Change |
|---|---|
| `Back_End/src/TheBha.Api/AdminCalendarOptions.cs` | adds `EnableUnauthenticatedWrite` (default `false`) and its boundary documentation |
| `Back_End/src/TheBha.Api/Program.cs` | Production startup guard for the write flag; DI registration of the write gate filter with the startup-validated Admin origins; `admin-calendar-write` CORS policy |
| `Back_End/src/TheBha.Api/Controllers/AdminCalendarWriteGateFilter.cs` | **new** — the gate |
| `Back_End/tests/TheBha.IntegrationTests/AdminCalendarWriteGateProbe.cs` | **new** — test-only probe controller, its antiforgery control, DTO and spy |
| `Back_End/tests/TheBha.IntegrationTests/AdminCalendarWriteGateApiTests.cs` | **new** — hosted acceptance matrix |
| `Back_End/tests/TheBha.IntegrationTests/AdminCalendarWriteGateFilterTests.cs` | **new** — direct filter matrix |
| `Back_End/tests/TheBha.IntegrationTests/PostgreSqlWebApplicationFactory.cs` | disables host config file-watching in test hosts (see §5) |
| `README.md` | local enable/disable instructions and the boundary's operating conditions |
| `docs/project/SNAPSHOT.md` | factual state correction (PR #41 MERGED, PR #42 CLOSED NOT MERGED, CP01 current, CP02 not activated) |
| `AGENTS.md` | §1 factual product summary only — the Admin board reads the real backend; mutations/auth still absent |
| `docs/daily/2026-09/2026-09-11-plan.md`, `…-worklog.md`, this report | execution record |

No frontend file, no migration, no model snapshot, no `.github/workflows`, no
governance rule, no dependency, no formatting sweep.

## 3. The gate contract

`Cache-Control: no-store` is set unconditionally as the filter's first
statement — before any check — so it also covers a response written after the
gate opens, such as a model-binding failure that short-circuits before any
action body could set it. Then, in this order:

| # | Condition | Failure |
|---|---|---|
| 1 | `Request.IsHttps` and a Development host | 404 |
| 2 | Both `Connection.LocalIpAddress` and `RemoteIpAddress` loopback | 404 |
| 3 | No `Forwarded` and no `X-Forwarded-*` header | 404 |
| 4 | `EnableUnauthenticatedWrite == true` | 404 |
| 5 | Exactly one `Origin`, ordinal-equal to a configured HTTPS Admin origin | 403 |
| 6 | `Content-Type: application/json` (optional valid `charset`) | 415 |

Why this order and these answers:

- Everything that describes **whether the boundary exists at all** answers a
  bare 404 in the read gate's shape, so a closed deployment is
  indistinguishable from an absent route. Only after the boundary is
  established as present and local does it answer with a diagnosable 403/415,
  and those bodies state the rule, never the request.
- Being a **resource filter** puts the gate before model binding and before
  `[ApiController]`'s automatic validation, so a closed gate answers a valid
  body and a malformed one identically and reaches no action, store or
  database. The JSON requirement is checked here rather than with `[Consumes]`
  precisely because `[Consumes]` runs at action-selection time and would leak a
  415 ahead of the environmental checks.
- A **null address fails closed**; IPv4-mapped IPv6 is unwrapped before the
  loopback test; `0.0.0.0` and `::` are not loopback.
- The **forwarded-header rule is a refusal, not a trust decision**: no
  forwarded header is read, parsed or believed, and no forwarded-header
  middleware is enabled. Their presence means the request was relayed, and an
  unauthenticated write boundary refuses a relayed request rather than
  reasoning about it. It is explicitly **not** a proxy detector — a local proxy
  that strips every trace of itself is indistinguishable from a direct client
  at this layer, which is why keeping the local API un-proxied remains a
  condition of running it rather than something code enforces.
- The **`Origin` check runs at the server**, not via CORS, because CORS
  restricts browsers only and never `curl` or a server-to-server client. The
  allowlist is the startup-validated `Cors:AdminOrigins` snapshot, so a later
  configuration reload cannot introduce an entry that skipped `Program.cs`'s
  HTTPS/no-wildcard validation; the filter re-checks the HTTPS scheme itself so
  it states its own rule.
- The 403 is an explicit `ObjectResult`, never `Forbid()`, which would invoke
  the Customer cookie scheme's access-denied handler and answer an Admin
  request with a Customer authentication response.
- The environment is checked **before** the option is materialized. The startup
  guard binds one configuration snapshot, but `IOptions<T>` binds lazily, so a
  reloadable source could supply `true` after the guard passed. Environment
  first makes that later value unreachable outside Development. Both are kept:
  the guard fails loudly and early, the gate fails closed.

## 4. Acceptance evidence

Full backend suite, real PostgreSQL, Release configuration — **244 unit +
500 integration passed, 0 failed** (§5). Of those, 156 cover this checkpoint.

**The one allowed combination** — HTTPS + Development + loopback both ends +
write enabled + approved `Origin` + JSON — runs the action exactly once,
returns 204 with `no-store`, and needs no Customer cookie and no CSRF token.

**Refusals**, each asserted twice: the status the caller sees *and* the probe
spy's invocation count, because a status code alone cannot distinguish
"refused" from "ran the action and then failed" — and for a write boundary the
second would already have mutated something. Every refusal below leaves the
count at 0.

| Group | Cases |
|---|---|
| Write opt-in | read on + write default → 404 while the read endpoint still serves; write on + read off → probe 204 while the board returns the read gate's closed 404; no checked-in config or launch profile sets the write flag |
| Transport | cleartext with a valid and a malformed body; an approved `Origin` does not rescue cleartext |
| Environment | Staging with the flag on at startup → 404; Production with the flag flipped after startup → 404; Production **refuses to start** with the flag on |
| Locality | 10 non-loopback/null/wildcard connection shapes → 404; 5 loopback representations (v4, v6, mapped, `127.0.0.53`) → 204; `Host`/`Referer` claiming localhost do not rescue a remote connection |
| Forwarded | 7 header spellings, both families, case-insensitive → 404; `X-Forwarded` and `X-Requested-With` do **not** close the gate |
| Origin | 13 shapes — missing, empty, literal `null`, Customer origin, unknown, prefix/suffix lookalike, trailing path, scheme downgrade, case-different, comma-joined, two header values, duplicated — all 403, all with a malformed body present to prove the decision precedes model binding, all with no `errors`, no echo of the body, no `WWW-Authenticate`, no `Location` |
| Media type | 10 non-JSON/parameterized types → 415; 4 JSON spellings with and without a valid charset → 204; a non-JSON body over cleartext is still the closed-gate 404, not a 415 |
| After the gate opens | malformed JSON, empty body, missing/null/empty required field → 400, action not run, `no-store` present |
| Closed gate | the same four bodies all return the identical generic 404 — type, title, status compared field by field — so a closed boundary never reveals that a body would have failed validation |
| CORS | Admin preflight allowed with POST + `Content-Type` and **no** `Access-Control-Allow-Credentials`; Customer and unknown origins get no allow-origin; an answered preflight does **not** make the POST succeed; the write policy grants the Admin origin nothing on a Customer route |
| Antiforgery | the global Customer policy still rejects an anonymous `POST /api/v1/booking-holds` for a missing token **on the same host**; the identical probe route *without* the scoped opt-out is rejected by that global policy before the gate runs at all |
| Route surface | the ordinary host 404s the probe route as an absent route (no gate header), and the OpenAPI document contains no `test-only`/`write-gate-probe` path and no POST/PUT/PATCH/DELETE under `/api/admin/` |
| Reflection | no controller in `TheBha.Api` applies the write gate |

The direct-filter suite (75 cases) covers the same matrix without a host, which
is what makes "the *gate* refused it" provable for cleartext: on a TestServer
host `UseHttpsRedirection` cannot discover an HTTPS port and passes the request
through, so a hosted 404 alone is only indirect evidence. It also pins the
precedence rules — an environmental failure outranks an origin or media-type
failure, and an origin failure outranks a media-type failure — so a refactor
cannot reorder the checks and still pass.

Each of the three composition attributes was verified to be load-bearing.
`[IgnoreAntiforgeryToken]` was removed experimentally: the happy-path request
then failed with the antiforgery 400 before the gate ran. That result is now
permanent coverage (`AdminCalendarWriteGateAntiforgeryControlController` plus
`Without_the_scoped_opt_out_the_global_antiforgery_policy_rejects_the_request_first`),
so the opt-out cannot be dropped from a future write action without the suite
noticing.

## 5. Checks run

All commands from the repository root, in this session, against the real local
PostgreSQL 17 instance (connection supplied by environment variable; the value
is not reproduced here).

```
dotnet restore Back_End/TheBha.Booking.sln                                  → success
dotnet build   Back_End/TheBha.Booking.sln --configuration Release --no-restore → success, 0 warnings, 0 errors
dotnet test    Back_End/TheBha.Booking.sln --configuration Release --no-build   → 244 + 500 passed, 0 failed
git diff --check                                                            → clean
```

Diff inspection confirms no schema, migration, model-snapshot, frontend or
production API route-surface change. No migration was required or created for
this API-only change.

**One fix was needed in the test host, and it is worth recording.** The first
full-suite run failed 58 tests with `IOException: The configured user limit
(128) on the number of inotify instances has been reached`, thrown from
`WebApplication.CreateBuilder` — not from anything under test. Each
`WebApplicationFactory` build puts an inotify watch on the appsettings files
(`reloadOnChange: true` is the host default), and this checkpoint's boundary
matrix pushed the suite past the Linux per-user limit of 128 — the same default
the GitHub Actions runner uses, so this would have failed CI as readily as a
workstation. Two changes, both in test code, neither touching the machine:
`PostgreSqlWebApplicationFactory` now sets
`hostBuilder:reloadConfigOnChange=false` (no test depends on a configuration
*file* being re-read; the late-value cases deliberately rebind the bound
options object instead, which is what the gates guard against), and cases
sharing one host configuration now run against one host rather than one host
each. The suite is green after both.

## 6. Self-review

- The gate is deliberately not reusable machinery. It is one filter with six
  checks in a fixed order; the read gate's small loopback helper is duplicated
  rather than extracted, because refactoring the shipped read gate to share a
  few lines would have put a merged, reviewed security boundary back in scope
  for no behavioural gain.
- The order of the checks *is* the contract, and it is pinned by tests, not
  only by comments.
- The 403/415 bodies name the rule and never echo the request; the direct-filter
  suite asserts that they contain neither an address nor an origin.
- `no-store` is asserted on success and on every error group.
- CP01 claims a verified, merge-ready gate. It does **not** claim public
  deployment readiness: there is still no Admin authentication/RBAC and no
  business write endpoint, and the boundary is same-machine development only.

## 7. Deviations, risks, NOT RUN

- **Deviation:** none from the prompt's scope. The only change outside the
  gate's own files is the test-host config-watcher fix in §5, which the prompt's
  "backend tests and test-only factory wiring" scope covers and which was
  required to make the mandatory full suite runnable at all.
- **Risk (accepted, documented):** the forwarded-header refusal cannot detect a
  local proxy that removes its own traces. This is stated in the filter, the
  README and `SNAPSHOT.md` §9 as an operating condition, and no
  proxy-detection service was built for it.
- **Risk (accepted):** the `Origin` match is ordinal, so a differently-cased
  origin is refused. Browsers send a lowercase origin, and exactness is what
  defeats lookalikes.
- **NOT RUN:** no browser walkthrough and no database-mutation walkthrough.
  CP01 has no UI and no write behaviour to exercise; the PRs that connect a UI
  are where browser-HTTPS and DB evidence become required.
- Frontend lint/test/build were not re-run locally: no frontend file is
  touched, and CI runs those suites.

## 8. Skills and tools

- `GRAPHIFY_POLICY: ALLOWED_IF_RELEVANT` — **not invoked**. The dependency
  question ("what applies this filter, and in what order do MVC filter stages
  run") is answered directly by `Program.cs`, the existing read gate and the
  tests; a graph would not have added confidence.
- `diagnosing-bugs: ALLOWED_IF_TRIGGERED` — **not invoked**. The one failure
  encountered (§5) named its own root cause in the exception message and had a
  direct feedback loop; the skill's heavy diagnostic process was not warranted.
- GitNexus not used. No tool was installed, rebuilt or reconfigured.

## 9. Review handoff

`ACTIVE_EXECUTOR` stopped all writes at a stable checkpoint. Implementation
`PASS` is not review `PASS` and is not authorization to merge. Only Owner
invokes the review; only OC decides `PASS`/`CORRECTION_REQUIRED`/`BLOCKED`;
only Owner marks Ready, merges, deletes the branch and activates `CP02`.
