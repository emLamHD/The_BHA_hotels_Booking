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

Correction `PMS-CAL-001.2-CP01-C1` applied the three `[P2]` findings from the
Owner-invoked Codex review of `0ea5e3d`. §10 records them in full; §1, §3 and
§4 below are written as corrected, not as originally submitted.

## 1. What was delivered

The foundation a later Admin Calendar write endpoint will opt into — and
nothing that can be written to.

1. **A separate write opt-in, frozen at startup.**
   `AdminCalendarOptions.EnableUnauthenticatedWrite`, default `false`
   everywhere including Development, set by no checked-in `appsettings` file
   and no launch profile. It is independent of `EnableUnauthenticatedRead` in
   both directions. `Program.cs` refuses to start a Production host with it
   enabled, with its own message naming its own flag, and hands the gate the
   bound value as a plain `bool` — the gate never resolves `IOptions<T>` per
   request, so nothing but a restart can change the boundary (C1, finding 1).
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
| `Back_End/src/TheBha.Api/Program.cs` | Production startup guard for the write flag; DI registration of the write gate filter with the startup-frozen opt-in and startup-validated Admin origins; `admin-calendar-write` CORS policy |
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
| 4 | The startup-frozen `EnableUnauthenticatedWrite` | 404 |
| 5 | Exactly one `Origin`, ordinal-equal to a configured HTTPS Admin origin | 403 |
| 6 | `Content-Type: application/json`, optionally `charset=utf-8` | 415 |

Why this order and these answers:

- Every environmental and opt-in failure answers the one same 404 in the read
  gate's shape, so no closed request can be told apart from any other closed
  request: a caller learns nothing about which condition it failed, nor about
  what the route would have accepted. Only after the boundary is established as
  present and local does it answer with a diagnosable 403/415, and those bodies
  state the rule, never the request. This is **not** a claim that a closed
  route is indistinguishable from an absent one — see §10, finding 2.
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
- The opt-in the gate reads is **frozen at startup**, so there is no later
  value for any configuration source to supply. The Production startup guard is
  kept alongside it: the guard fails loudly and early, the gate fails closed.
  The Admin origin allowlist is captured the same way and for the same reason.

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
| Write opt-in | read on + write default → 404 while the read endpoint still serves; write on + read off → probe 204 while the board returns the read gate's closed 404; no checked-in config or launch profile sets the write flag; a value applied **after** startup cannot open a host that started closed **or** close one that started open, and the filter's constructor cannot accept a bound option at all |
| Transport | cleartext with a valid and a malformed body; an approved `Origin` does not rescue cleartext |
| Environment | Staging with the flag on at startup → 404; Production with the flag flipped after startup → 404; Production **refuses to start** with the flag on |
| Locality | 10 non-loopback/null/wildcard connection shapes → 404; 5 loopback representations (v4, v6, mapped, `127.0.0.53`) → 204; `Host`/`Referer` claiming localhost do not rescue a remote connection |
| Forwarded | 7 header spellings, both families, case-insensitive → 404; `X-Forwarded` and `X-Requested-With` do **not** close the gate |
| Origin | 13 shapes — missing, empty, literal `null`, Customer origin, unknown, prefix/suffix lookalike, trailing path, scheme downgrade, case-different, comma-joined, two header values, duplicated — all 403, all with a malformed body present to prove the decision precedes model binding, all with no `errors`, no echo of the body, no `WWW-Authenticate`, no `Location` |
| Media type | 15 rejected types → 415, including every non-UTF-8 encoding (`us-ascii`, UTF-16, ISO-8859-1, windows-1252), a duplicate charset and a charset plus a second parameter; 5 accepted JSON spellings with no charset or `charset=utf-8` (quoted and mixed-case) → 204; a non-JSON body over cleartext is still the closed-gate 404, not a 415 |
| After the gate opens | malformed JSON, empty body, missing/null/empty required field → 400, action not run, `no-store` present |
| Closed gate | the same four bodies all return the identical generic 404 — type, title, status compared field by field — so a closed boundary never reveals that a body would have failed validation |
| CORS | Admin preflight allowed with POST + `Content-Type` and **no** `Access-Control-Allow-Credentials`; Customer and unknown origins get no allow-origin; an answered preflight does **not** make the POST succeed; the write policy grants the Admin origin nothing on a Customer route; a **closed** gate still carries the one configured allow-origin for an approved Admin origin while the POST is refused and the action never runs, and an unapproved origin gets no such header |
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
- The gate's accepted media types are now exactly what the action behind it can
  read. A gate that accepts more than its boundary honours is a gate that
  documents a contract it does not govern.
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

## 10. Correction cycle C1

Owner invoked the Codex review on `0ea5e3d` with base `origin/develop`. It
returned three `[P2]` findings and no `[P1]`. OC ruled all three valid and
issued correction prompt `PMS-CAL-001.2-CP01-C1`. All three are fixed; no
finding was dismissed, and none was silently fixed ahead of that prompt.

### C1-1 — the write opt-in was not actually startup-only

**Valid, and worse than a documentation defect.** The filter resolved
`IOptions<AdminCalendarOptions>` and read `.Value` per request.
`IOptions<T>` materializes lazily on first access, so a Development host
started with the opt-in **off** could have it bound to `true` by a reloadable
configuration source before the first Admin request — and the boundary would
open. Environment-first ordering made that unreachable in Production and
Staging but not in Development, which is the only environment this gate ever
runs in. The documentation claimed a startup-only, environment-variable opt-in;
the code did not implement one.

**Fix:** `Program.cs` passes `adminCalendarOptions.EnableUnauthenticatedWrite`
— the value already bound for the startup guard — to the filter as a plain
`bool`. The filter takes no `IOptions`, `IOptionsSnapshot`, `IOptionsMonitor`
or configuration dependency. The Admin origin allowlist was already passed this
way. `Services.Configure<AdminCalendarOptions>` stays, because the read gate
still uses it and the read gate is out of scope here. No new options type, no
configuration provider, no reload watcher: a constructor `bool`.

**Red/green evidence.** The regression test was run against the pre-correction
code by temporarily restoring the `IOptions` registration. It reproduced the
exploit exactly: the request returned **`204` with the action executed** on a
Development host that started with the opt-in off, where the corrected code
returns 404 with the spy at 0. Restored and green. A second test pins the other
direction — a host that started **open** stays open when a later value says
closed — so the frozen value is genuinely frozen rather than merely
fail-closed. A third asserts by reflection that the constructor cannot take a
bound option, which is a compile-time guarantee in practice: reverting the
registration during the red check failed to compile until the test helper was
also temporarily patched.

### C1-2 — the "indistinguishable from an absent route" claim was false

**Valid.** Once a real action carries `[EnableCors("admin-calendar-write")]`,
the CORS middleware wraps MVC and stamps `Access-Control-Allow-Origin` on the
response of an approved `Origin` even when the filter closed it, while an
absent route has no endpoint CORS metadata and receives no such header. This
was measured, not inferred: a closed-gate 404 to the approved Admin origin
carries `Access-Control-Allow-Origin: https://localhost:3001`.

**OC decision, applied as written:** no middleware, no response-header
stripping, no custom CORS implementation to hide route existence. Route
existence is not an authorization boundary, and the configured Admin origin
already knows the API contract. The corrected contract is:

- every environmental/opt-in failure returns the same 404 body and status with
  `no-store`;
- valid and malformed bodies are indistinguishable **to the gate**, and neither
  reaches the action, a store or the database when it is closed;
- CORS headers are governed independently by endpoint metadata and may reveal
  route existence to an explicitly allowed Admin origin;
- a disallowed origin receives no allow-origin header, and CORS never grants
  write authority.

Every claim of global absent-route parity was removed from the filter
documentation, the closed-gate test helper and this report. The proxy statement
in §3 is unrelated and unchanged. The new hosted test asserts the header's
presence as **fact** rather than tolerating it as a possibility, so the
corrected contract is pinned rather than merely no longer contradicted. This is
an intentional contract correction: not an accepted vulnerability, and not a
new authentication mechanism.

### C1-3 — the charset contract was wider than the boundary behind it

**Valid.** `Encoding.GetEncoding(charset)` accepts encodings that MVC's
System.Text.Json input formatter does not, so
`application/json; charset=us-ascii` passed the gate and was then refused by
the formatter with its own 415. The gate was governing a contract it could not
honour.

**Fix:** accept `application/json` case-insensitively with either no parameters
or exactly one `charset` equal to `utf-8` (quoted or unquoted, any casing).
Everything else is refused with the gate's 415 before model binding: any other
encoding, a duplicate charset, an empty charset, and any non-charset parameter.
The generic `Encoding.GetEncoding` validation and its `System.Text` import are
gone; the filter inspects no MVC internals and injects no formatter. Future
Admin `fetch` JSON is UTF-8, so the narrow contract is the honest one. The 415
detail, the filter comments, the README and this report now say UTF-8 rather
than "any valid charset".

### C1 scope

Files touched: the filter, `AdminCalendarOptions`, `Program.cs`, both write-gate
test files, `README.md`, this report, and the day's worklog. No new file, no
probe-controller change, no read-gate change, no schema, route, dependency or
governance change. The test-host inotify handling from the initial
implementation was left alone: no test demonstrated a defect in it.
