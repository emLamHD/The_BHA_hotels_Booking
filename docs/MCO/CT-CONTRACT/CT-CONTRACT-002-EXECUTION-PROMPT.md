# Claude Code Execution Prompt — CT-CONTRACT-002

You are a senior ASP.NET Core application engineer with 10 years of experience
and the executor for The BHA Hotels Booking.

Execute exactly one prerequisite contract-fix work item:
`CT-CONTRACT-002`.

Do not resume `FE-001.4`, do not modify the Customer Web, and do not begin any
Hold/Reservation lifecycle or payment work.

## Work item

- **ID:** `CT-CONTRACT-002`
- **Title:** Return stable Problem Details for MVC antiforgery failures
- **Status:** `READY`

## Why this prerequisite exists

The preflight for `FE-001.4` correctly stopped before branching because the
backend cannot currently expose the antiforgery failure discriminator required
for a safe one-time CSRF refresh retry.

At the required baseline:

- `AutoValidateAntiforgeryTokenAttribute` performs antiforgery validation as an
  MVC authorization filter;
- the post-`next` middleware in `Program.cs` checks
  `IAntiforgeryValidationFeature`;
- that feature is not populated by the current MVC authorization-filter path;
- consequently the middleware's intended antiforgery Problem Details body is
  not emitted;
- live missing/invalid-token scenarios return only the framework's generic
  `400` Problem Details;
- existing backend tests assert only `400` and
  `application/problem+json`, so they do not protect the intended
  title/detail contract.

An arbitrary `400` must never be treated by the frontend as an antiforgery
failure. The backend therefore needs one stable, generic, non-sensitive
antiforgery Problem Details contract before `FE-001.4` may resume.

## Required outcome

Every request rejected specifically by the existing global MVC antiforgery
policy must return RFC 7807 Problem Details with:

```json
{
  "title": "Invalid antiforgery token",
  "status": 400,
  "detail": "A valid antiforgery token is required for this operation."
}
```

Additional standard Problem Details members such as `type`, `instance`, or
`traceId` are allowed. The response media type must remain
`application/problem+json`.

The contract must be based on the actual MVC antiforgery failure result, not on
status-code matching, response-body matching, exception-message matching, or
endpoint-name matching.

Valid CSRF requests and every non-antiforgery response must retain their current
behavior.

Hồ Đình Lâm is the only merge authority.

## Authoritative baseline

- Repository: `emLamHD/The_BHA_hotels_Booking`
- Integration branch: `develop`
- Required local `HEAD`, local `develop`, and `origin/develop` SHA:

  `3a150b2030285cdded80bee3a86252468d6d2c27`

- Expected open PRs: none.
- Expected FE-001.4 branch locally and remotely: none.
- Required new branch:

  `fix/ct-contract-002-antiforgery-problem-details`

- Baseline frontend:
  - `96/96` tests;
  - lint and build pass.
- Baseline backend:

  `490 passed — 241 unit + 249 PostgreSQL integration`

- Expected EF migrations: 6, with no pending model changes.
- Working tree must be completely clean before branch creation.

## Owner decisions

### Snapshot timing

Do not edit `SNAPSHOT.md`, governance files, daily plans, or worklogs. The
project owner updates `SNAPSHOT.md` once at the end of the workday.

### Existing deferred environment note

The repository owner has declared the existing Cloudinary-looking value in the
tracked environment example to be a fake credential and deferred it.

Do not modify, copy, or repeat that value. Prove only that this work item
introduces no new secret or credential.

## Approved technical direction

Preserve the existing global
`AutoValidateAntiforgeryTokenAttribute` policy and all current
`IgnoreAntiforgeryToken` exceptions.

Handle the MVC authorization-filter failure at the MVC result layer. The
preferred design is a small global always-run result filter that:

1. observes an `AntiforgeryValidationFailedResult`;
2. replaces only that result with the stable Problem Details response above;
3. delegates every other result unchanged.

An `IAsyncAlwaysRunResultFilter` or the smallest equivalent MVC-native design
is appropriate because it can observe results produced when an authorization
filter short-circuits the action pipeline.

Remove the current dead post-`next` middleware in `Program.cs` after the
replacement is proven. Do not leave two competing antiforgery failure
formatters.

If the preferred MVC-native design cannot be made correct on this repository's
.NET 8 baseline, stop and report `BLOCKED` before introducing custom
antiforgery validation middleware, replacing the global policy, or broadening
the architecture.

## Scope in

- Add the smallest API-layer result filter or equivalent required to format
  MVC antiforgery failures.
- Register it globally with the existing MVC configuration.
- Remove the ineffective
  `IAntiforgeryValidationFeature` post-`next` response middleware.
- Add focused integration regression coverage for the exact public contract.
- Prove that business-validation `400` responses are not rewritten.
- Prove that valid CSRF behavior, Create Hold creation, and idempotent replay
  remain unchanged.
- Update one focused existing backend contract document, preferably
  `docs/BE-003-1-CUSTOMER-BOOKING-IDENTITY.md`, with the stable generic
  antiforgery failure response.
- Run the full repository verification required below.
- Push the branch and open a Draft PR.

## Scope out

- No frontend changes.
- Do not resume or partially implement `FE-001.4`.
- No change to `GET /api/v1/auth/csrf`.
- No change to the antiforgery cookie name, flags, SameSite mode, header name,
  token generation, validation rules, or identity binding.
- No change to global antiforgery coverage or current
  `IgnoreAntiforgeryToken` actions.
- No change to CORS, authentication, authorization, rate limiting, Data
  Protection, or exception handling.
- No change to Hold/Reservation business logic, ownership, tokens,
  idempotency, pricing, inventory, expiry, confirmation, cancellation, or
  payment.
- No new endpoint, status code, database object, migration, seed, package, or
  dependency.
- No attempt to expose the internal antiforgery exception or its reason.
- No arbitrary `400` detection or rewriting.
- No OpenAPI header-scope changes.
- No broad refactor or unrelated formatting churn.
- No `SNAPSHOT.md`, governance, worklog, or daily-plan edit.

## Security invariants

- The public title/detail are intentionally generic and fixed.
- Never return or log:
  - the request token;
  - the antiforgery cookie;
  - internal validation exception text;
  - Data Protection details;
  - identity/claim comparison details;
  - customer credentials;
  - booking access tokens;
  - idempotency keys.
- Missing token, missing cookie, malformed token, invalid token/cookie pair, and
  identity-invalidated token must use the same public contract whenever they
  are rejected by the MVC antiforgery policy.
- Do not weaken antiforgery enforcement to make tests pass.
- Do not convert an application/model-validation `400` into the antiforgery
  contract.

## Acceptance criteria

### Exact antiforgery contract

Focused integration coverage must prove at least these independent scenarios:

1. unsafe request with neither antiforgery cookie nor request header;
2. antiforgery cookie present but request header missing;
3. antiforgery cookie present with a malformed or invalid request token.

Each must assert:

- `400 Bad Request`;
- `application/problem+json`;
- `title == "Invalid antiforgery token"`;
- `status == 400`;
- `detail == "A valid antiforgery token is required for this operation."`;
- no sensitive token/cookie/exception text in the response.

Use `POST /api/v1/booking-holds` for the focused contract cases unless a
smaller existing unsafe endpoint produces more reliable coverage without
weakening the connection to the FE-001.4 blocker.

### Non-antiforgery `400` isolation

With a valid CSRF token/cookie pair, send an invalid Create Hold business
request and prove:

- it remains `400 application/problem+json`;
- its current controller/application Problem Details title is preserved;
- it is not relabeled as `Invalid antiforgery token`.

Do not make the assertion depend on unstable internal error text.

### Valid request and idempotent replay

Using a real seeded Availability offer and a valid CSRF token/cookie pair:

- first Create Hold succeeds with `201`;
- replay with the exact same request and `Idempotency-Key` succeeds with `200`;
- no duplicate Hold is created;
- Hold price, expiry, ownership, and guest-token behavior remain unchanged.

### Existing policy preservation

Prove through focused assertions or existing full-suite coverage that:

- unsafe actions still require antiforgery unless explicitly ignored;
- safe `GET` actions still do not require antiforgery;
- registration/login actions that currently ignore antiforgery remain
  unchanged;
- OpenAPI still documents exactly one `X-CSRF-TOKEN` header on every current
  unsafe booking mutation;
- Create Hold still documents exactly one `Idempotency-Key`;
- no non-create booking mutation gains an `Idempotency-Key`.

### Code-quality constraints

- The formatter is small, stateless, endpoint-agnostic, and API-layer only.
- It matches the framework's antiforgery failure result type, not a string or
  a generic status code.
- It leaves non-antiforgery results untouched.
- There is one authoritative antiforgery failure formatter after the change.
- `git diff --check` is clean.
- No generated artifacts, secrets, environment files, dependencies, or
  unrelated files are committed.

## Preflight — run before branch creation

1. Confirm the repository root and `origin` URL.
2. Confirm the current branch is `develop`.
3. Fetch/prune `origin`.
4. Confirm all three are exactly the required baseline SHA:
   - `HEAD`;
   - local `develop`;
   - `origin/develop`.
5. Confirm the working tree is clean, including untracked files.
6. Confirm there are no open PRs.
7. Confirm no local or remote branch exists for:
   - `feature/fe-001-4-booking-hold-ui`;
   - `fix/ct-contract-002-antiforgery-problem-details`.
8. Confirm the current source still contains:
   - global `AutoValidateAntiforgeryTokenAttribute`;
   - the ineffective post-`next`
     `IAntiforgeryValidationFeature` middleware;
   - the intended fixed title/detail in that middleware.
9. Confirm the existing Create Hold antiforgery test still asserts only generic
   `400` Problem Details.
10. Run the frontend baseline:
    - clean `npm ci`;
    - `npm run lint`;
    - exactly `96/96` tests;
    - `npm run build`.
11. Run the backend/PostgreSQL baseline:
    - restore;
    - Release build with 0 warnings and 0 errors;
    - exactly `490/490` tests, 0 failed, 0 skipped.
12. Confirm exactly six migrations and no pending EF model changes.
13. Reproduce and record the current live generic `400` for the three invalid
    antiforgery scenarios before editing.

Only after every preflight gate passes, create:

`fix/ct-contract-002-antiforgery-problem-details`

## Mandatory `BLOCKED` conditions

Stop without creating a branch or modifying files if:

- the exact SHA, working tree, PR state, or branch state differs;
- frontend or backend baseline verification fails;
- test counts differ at preflight;
- migration state differs;
- the reported antiforgery defect cannot be reproduced;
- valid CSRF/Create Hold/replay behavior no longer matches the baseline;
- the fix requires replacing the global antiforgery policy, weakening
  validation, changing cookie/header/token semantics, changing an endpoint, or
  adding a dependency;
- the MVC antiforgery failure cannot be distinguished from ordinary `400`
  results by a framework result type;
- any backend, database, frontend, or architecture change outside the approved
  scope becomes necessary.

Report the evidence and stop. Do not improvise a broader fix.

## Implementation sequence and checkpoint commits

Keep the branch reviewable with small checkpoints:

1. Add the MVC-native antiforgery Problem Details formatter, register it, remove
   the ineffective middleware, and add focused tests.
2. Add or update the focused backend contract documentation.

Suggested commit subjects:

1. `fix(api): stabilize antiforgery problem details`
2. `docs(api): document antiforgery failure contract`

Do not create empty commits merely to match the suggested count. Do not squash,
amend published history, rebase published commits, force-push, or rewrite
history.

## Verification after implementation

Run:

### Targeted backend checks

- focused antiforgery contract tests;
- Create Hold API tests;
- booking OpenAPI header contract tests;
- customer authentication tests when touched behavior is covered there.

### Full backend checks

- restore;
- Release build with 0 warnings and 0 errors;
- full unit suite;
- full PostgreSQL integration suite;
- 0 failed and 0 skipped;
- final passing test count must not be lower than the `490`-test baseline.

### Frontend regression checks

Even though no frontend file may change:

- clean `npm ci`;
- lint with 0 warnings/errors;
- exactly `96/96` tests;
- production build pass;
- no live API request during build.

### Database and repository checks

- exactly six migrations;
- no pending EF model changes;
- no migration/model snapshot change;
- `git diff --check`;
- scope review;
- secret/credential scan;
- generated-artifact scan;
- dependency/lockfile review.

### Live API verification

Run the API in Development and verify:

- the three independent invalid-antiforgery cases return the exact stable
  Problem Details contract;
- a valid-CSRF business-validation `400` is not rewritten;
- a valid seeded Create Hold returns `201`;
- exact replay returns `200`;
- OpenAPI headers/status codes remain unchanged;
- no token, cookie, key, internal exception, or server-only field is exposed;
- no new console/server error is introduced.

Record exact commands and concise results in the completion report and focused
documentation.

## PR and Git restrictions

After all verification passes:

- push only the new fix branch with an ordinary non-force push;
- open one Draft PR targeting `develop`;
- include outcome, root cause, exact contract, tests, migration impact, risk,
  and no-merge confirmation in the PR body;
- wait for both Frontend and Backend CI jobs to finish;
- report the final CI state.

Claude Code must not:

- merge the PR;
- mark it ready for review;
- enable auto-merge;
- push to `develop` or `main`;
- delete a local or remote branch;
- rewrite history;
- force-push;
- edit `SNAPSHOT.md`;
- resume `FE-001.4`;
- begin another work item.

## Completion Report format

Return exactly one report:

```text
STATUS: PASS | BLOCKED

Work item: CT-CONTRACT-002 — Return stable Problem Details for MVC antiforgery failures
Branch:
Base SHA:
Feature commits:
Root cause verified:
Outcome delivered:
Exact public antiforgery contract:
Files and behavior changed:
Non-antiforgery behavior preserved:
Tests and commands run:
Live API evidence:
Database/migration impact:
API/OpenAPI impact:
Frontend impact:
Scope/secret/artifact review:
Documentation and SNAPSHOT confirmation:
CI/PR:
Self-review findings:
Risks or deviations:
Blockers:
No-merge confirmation:
FE-001.4 not-started confirmation:
```

After returning the report, stop and wait for Control Tower review.
