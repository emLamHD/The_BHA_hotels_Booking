# CODEX EXECUTION PROMPT — BE-003.1 CUSTOMER BOOKING IDENTITY FOUNDATION

## Role and authority

You are the implementation agent for **The BHA Hotels** backend.

- Work item: `BE-003.1 — Customer booking identity foundation`
- Control Order: `CT-BE-003`
- Repository: `emLamHD/The_BHA_hotels_Booking`
- Target branch: `develop`
- Working branch: `feature/be-003-1-customer-booking-identity`
- Verified control-order baseline: `3e4be8a2759fe0542a74a594891b43d85cdcf401`
- Merge authority: **Hồ Đình Lâm only**
- You may create commits, push the working branch, and open a **Draft PR** targeting `develop`.
- You must **not merge** the PR and must not push directly to `develop` or `main`.

Implement only `BE-003.1`. Do not begin `BE-003.2` or add Hold, Reservation, Availability, guest-token, payment, frontend, admin-role, or unrelated changes.

## Required startup sequence

1. Read and obey the repository governance and project-context files, if present, in this order:
   1. `RULES.md`
   2. `PROJECT_BIBLE.md`
   3. `SNAPSHOT.md`
   4. the current daily plan/worklog relevant to BE-003
   5. `AGENTS.md` files applicable to paths you will change
2. Inspect the repository structure, solution/project files, existing architecture conventions, API conventions, test infrastructure, EF Core migrations, OpenAPI setup, CORS configuration, error handling, and dependency versions.
3. Run read-only Git checks:
   - `git status --short`
   - current branch and HEAD SHA
   - remotes
4. Fetch `origin`, resolve the latest `origin/develop` SHA, and compare it with the verified baseline above.
5. If `origin/develop` has advanced:
   - inspect the intervening commits and diff;
   - continue only if they do not conflict with this control order;
   - record the actual base SHA in the completion report.
6. Before editing, run the existing backend restore/build/test baseline using repository-native commands.
7. If pre-existing tests fail for reasons outside this task, or the worktree contains overlapping user changes that cannot be preserved safely, stop and report `BLOCKED`.
8. Create the working branch from the verified latest `origin/develop`. Do not reuse a stale branch with unrelated changes.

Do not assume exact project names, paths, namespaces, conventions, or test commands. Discover and follow the repository.

## Outcome

Create the minimum customer identity and secure cookie-session foundation required for later booking tasks to distinguish:

- an anonymous guest;
- an authenticated customer;
- the authenticated owner of a future booking resource.

This task must not create Booking Hold or Reservation behavior.

## Architecture constraints

- Use **ASP.NET Core Identity Core** with the **EF Core PostgreSQL store**.
- PostgreSQL 17 is the source of truth; use the repository’s existing EF Core 8/Npgsql conventions.
- Identity persistence belongs in `Infrastructure`.
- Authentication/authorization, cookie, antiforgery, rate-limiting, CORS, and HTTP composition belong in the API layer.
- Application code consumes a current-customer abstraction such as `ICurrentCustomer`.
- Application and Domain must not depend on `HttpContext`, ASP.NET Core Identity, or API implementation types.
- Domain must remain independent of Identity and transport concerns.
- Choose a customer-account primary-key type compatible with the future nullable `CustomerAccountId`. Follow existing identifier conventions unless doing so would violate Identity/store requirements.
- Normalized email must be unique at the persistence level.
- Use the framework password hasher and Identity validation mechanisms. Do not implement password hashing or cryptography manually.
- Do not add secrets, production credentials, production connection strings, or hard-coded production origins/domains.
- Do not modify existing merged migrations; add a new migration.
- Preserve all unrelated work and existing behavior.

## Required API contract

Implement under the existing API versioning and endpoint conventions:

```http
GET  /api/v1/auth/csrf
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Use the repository’s existing Problem Details/error-response conventions.

Expected behavior:

- Register creates a valid customer account.
- Duplicate email returns a consistent safe client error without creating a duplicate.
- Login success establishes the authenticated session.
- Invalid login returns a generic authentication failure that does not reveal whether the account exists.
- Logout invalidates the current session according to the implemented contract.
- `/me` returns only the minimum non-sensitive authenticated-customer representation.
- Anonymous `/me` returns `401`.
- Authentication/authorization failures must not leak account or resource existence.

Document final status-code and response-body choices in OpenAPI and the completion report. Follow existing API conventions when the control order does not prescribe an exact `400`, `401`, or `409` choice.

## Cookie, CSRF, CORS, and Data Protection requirements

- Authentication uses a secure HttpOnly cookie. Do not return an access token for frontend storage.
- Configure explicit cookie policy:
  - `HttpOnly = true`;
  - `Secure` for production;
  - an explicit `SameSite` policy compatible with the actual deployment topology;
  - no hard-coded production domain.
- Local development may use environment-specific behavior only when necessary and must not silently weaken production settings.
- Implement an antiforgery contract suitable for JavaScript clients using cookie authentication.
- `GET /api/v1/auth/csrf` must safely provide the client-visible token portion needed by the chosen double-submit/header flow while the secret cookie remains protected as designed.
- Every unsafe cookie-authenticated endpoint, including logout and future-compatible protected mutations, must reject missing or invalid antiforgery tokens.
- Registration and login also require a documented CSRF decision. If they are exempt because no authenticated ambient authority is used, encode that deliberately and test/document the behavior; do not leave it accidental.
- Configure credentialed CORS only from configuration and fail safely. Never combine credentials with wildcard origins.
- Document production Data Protection key persistence requirements so sessions remain usable and secure across restarts/multiple instances.
- Never log passwords, cookies, antiforgery secrets/tokens, or sensitive request bodies.

## Rate limiting

- Add named or endpoint-specific rate limiting for registration and login.
- Use configuration for meaningful limits where consistent with repository conventions.
- Return the appropriate standard response when limited.
- Add deterministic integration coverage for rate-limit behavior without making the suite flaky.

## Implementation guidance

Use repository patterns rather than introducing a parallel architecture. A compliant implementation will normally include:

- a minimal customer Identity entity;
- Infrastructure Identity DbContext/store configuration integrated safely with the existing persistence setup;
- a new EF Core migration;
- Application current-customer contract and minimal customer representation;
- API adapter for the current authenticated customer;
- auth request/response contracts and validation;
- register/login/logout/me/CSRF endpoints;
- cookie, antiforgery, authentication, authorization, CORS/credentials, rate-limiting, and Data Protection composition;
- OpenAPI auth/CSRF/status-code documentation;
- local-development and production-security documentation;
- unit, architecture, PostgreSQL integration, API integration, security, and OpenAPI regression tests.

Minimize new dependencies. Any dependency addition must be necessary, version-compatible with .NET 8, and explained in the report.

## Mandatory verification

Run repository-native equivalents of all checks below and report exact commands and results:

1. Restore the complete solution.
2. Release build with no new warning or error.
3. Run the full existing and new automated test suite.
4. Apply the complete migration chain to a clean PostgreSQL database.
5. Verify Identity persistence and normalized unique-email enforcement against PostgreSQL.
6. Run:

   ```bash
   dotnet ef migrations has-pending-model-changes
   ```

   Use the correct startup/project arguments discovered from the repository.
7. Verify API integration paths:
   - CSRF token acquisition;
   - register success;
   - duplicate email;
   - login success and cookie creation;
   - invalid credentials;
   - authenticated `/me`;
   - anonymous `/me`;
   - logout;
   - missing/invalid antiforgery token;
   - rate-limit enforcement.
8. Verify cookie flags in integration tests as far as the test host can observe them.
9. Run architecture tests proving Domain/Application do not gain forbidden dependencies.
10. Run OpenAPI regression checks.
11. Run `git diff --check`.
12. Inspect the final diff and scan it for secrets, passwords, cookie values, antiforgery values, production connection strings, accidental PII logging, unrelated files, and scope creep.
13. Confirm there are no frontend, Hold, Reservation, Availability, guest-token, payment, or admin-auth changes.

The previous verified baseline contained **134 passing automated tests**. Report the new exact total and separate skipped tests if any; do not merely say “tests pass.”

Do not weaken, delete, skip, or rewrite existing tests just to obtain a green result.

## Acceptance criteria

Mark each item `PASS`, `FAIL`, or `BLOCKED` in the completion report:

1. Customer account persists in PostgreSQL 17 and normalized email is unique.
2. A clean database accepts the complete migration chain.
3. Register works; duplicate email is consistent and creates no duplicate.
4. Valid login creates a secure HttpOnly session cookie.
5. Invalid login returns a generic failure.
6. Logout invalidates the session according to the implemented contract.
7. `/api/v1/auth/me` returns a minimal authenticated customer without sensitive fields.
8. Anonymous `/me` returns `401`.
9. Unsafe authenticated requests reject missing/invalid antiforgery tokens.
10. Cookie `Secure`, `HttpOnly`, and `SameSite` policies are explicit and production-safe without a hard-coded production domain.
11. The Application current-customer abstraction works without `HttpContext`.
12. Register/login have rate limiting with integration coverage.
13. OpenAPI describes auth, CSRF, cookie behavior, and status codes.
14. Existing baseline behavior and all new tests pass.
15. Release build adds no warning/error.
16. No secret, password, cookie value, antiforgery secret, or production connection string appears in diff/log/test output.
17. No Hold, Reservation, Availability, or frontend diff exists.

## Mandatory stop conditions

Stop immediately and report `BLOCKED`—without improvising a broader design—if:

- the current baseline already contains an unknown authentication/customer-identity implementation that conflicts with this order;
- the required solution needs a different auth transport than a secure HttpOnly cookie;
- the deployment topology requires a material CORS/SameSite design choice not supported by current configuration/context;
- unsafe cookie-authenticated endpoints cannot be protected correctly from CSRF;
- the migration threatens merged schema/data or cannot be made additive and safe;
- existing tests fail before your changes for an unrelated reason;
- a required secret, production domain, or credential is unavailable;
- implementation would require social login, verification, password reset, MFA, admin auth, frontend work, Hold/Reservation/Availability changes, or another out-of-scope feature;
- overlapping uncommitted user changes cannot be preserved safely.

## Git and Draft PR procedure

After all verification passes:

1. Review `git status` and the complete diff.
2. Commit only files belonging to `BE-003.1` with an intentional commit message.
3. Push `feature/be-003-1-customer-booking-identity`.
4. Open a **Draft PR** targeting `develop`.
5. Include outcome, architecture/security decisions, migration impact, API contract, exact test evidence, risks, and deferred scope in the PR body.
6. Do not merge, enable auto-merge, or modify branch protections.

If push or Draft PR creation is impossible because authentication or remote access is unavailable, preserve the verified local commit and report the exact blocker. Do not misrepresent local work as published.

## Required final response

Return exactly one completion report using this structure:

```text
CODEX COMPLETION REPORT
Status: PASS / BLOCKED
Work item / branch / base SHA:
Outcome delivered:
Files and behavior changed:
Database/migration impact:
API/OpenAPI impact:
Authentication/cookie/CSRF design:
Tests run and exact results:
Security/secret checks:
Acceptance criteria checklist:
Commit SHA / Draft PR URL:
Deviations from scope:
Risks and deferred work:
Recommended next action:
Explicit confirmation: not merged
```

Do not claim `PASS` unless implementation, mandatory verification, commit, push, and Draft PR creation all succeeded. If any required gate fails, use `BLOCKED`, state the first blocking fact precisely, and preserve all evidence gathered so far.
