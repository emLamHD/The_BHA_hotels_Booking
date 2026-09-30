# PMS-ADMIN-AUTH-001-CP00 — design and checkpoints for Staff authentication and property-scoped RBAC

> Draft PR into `develop`. Documentation only: no source, test, migration, dependency or behaviour change.
> Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline `0952e1b58e274a055b47ca3f04beb6fe08ed5ed8` (PR #72 merged). The design is a **proposal**; nothing in it is CURRENT.

## Deliverable

`docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md`: verified CURRENT (with source paths), eight decisions, Staff identity options, role/permission proposal, session and browser design, bootstrap, route cut-over, audit, seven checkpoints with acceptance and size, and the questions for Owner. `docs/project/SNAPSHOT.md`: CP04 merged, this milestone active, the objective and state token updated (no auth described as CURRENT; `PROJECT_BIBLE.md` untouched).

## Design chosen

- **Identity:** a separate `StaffAccount : IdentityUser<Guid>` as a second Identity user type in the same `TheBhaDbContext` (own table). Rejected: reusing `CustomerAccount` (customer cookie could become staff), a second `DbContext` (the documented single `dotnet ef database update` becomes ambiguous), hand-rolled hashing, JWT/IdP (out of scope).
- **Authorization:** `StaffPropertyMembership(Staff, Property, Role)`, roles mapped to a fixed permission set in code, checked on the server on every request with the route's `propertyId` as the resource. Proposed `Viewer` / `FrontDesk` / `Manager` over `BoardRead`, `AssignmentWrite`, `BlockWrite`, `AssignmentCrossRoomType` — **needs Owner approval**. Property-scoped only; `Organization` stays TARGET and plugs in behind one evaluator seam.
- **Session:** own cookie scheme `TheBha.Staff` (`SameSite=Strict`, `Path=/api/admin`, 8 h absolute), 401/403 as ProblemDetails, login/logout/`me`, credentialed `admin-staff` CORS policy, exact-Origin CSRF check instead of tokens, per-request Staff/security-stamp/membership validation so disable, password change and membership loss take effect on the next request. Customer_Web unchanged.
- **Bootstrap:** CLI verbs on the API host, password only from an environment variable or hidden prompt; no HTTP registration, no default, no Git credential.
- **Cut-over:** `AdminCalendar:AccessMode = LocalGate | Staff`; in `Staff` mode the local flags are not consulted and a route without a Staff policy is closed. Production requires `Staff` at CP07.
- **Audit:** `staff:{StaffAccountId}` and `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed`; history is not rewritten.

## Verification done

- Every CURRENT claim and referenced path was checked against the source (`Program.cs`, the two gate filters, the three Admin controllers, `TheBhaDbContext`, `HttpCurrentCustomer`, `SchedulingFieldLimits`, `AssignmentMutationStore`, Admin_Web `client.ts`, the blueprint §3/§12).
- The riskiest assumption — two Identity user types in one context — was tested with a **throwaway spike outside the repo** (same package versions, a scratch PostgreSQL database that was dropped): create, duplicate rejection, case-insensitive lookup, password check, lockout, security-stamp rotation, change password and weak-password rejection all worked, and the customer store was unaffected. It is a feasibility probe, not a repo test; `SignInManager` and the real migration are left to CP01 to verify.
- `git diff --check` clean; the diff contains only the three allowed files. No repo test or build was run (docs only).

## Checkpoint sizes (from the design §9)

CP01 ≈ 300 hand-written + ≈ 1,700 generated (migration Designer + snapshot; cannot honestly be split from the model); CP02 ≈ 350; CP03 ≈ 400; CP04 ≈ 350; CP05 ≈ 400; CP06 ≈ 400; CP07 ≈ 250. This PR is well under 400 changed lines.

## Owner decisions needed before CP01

Role names and matrix; same-site deployment of Admin_Web and API; session model; Staff password policy and deferred MFA; who bootstraps production and how the secret is handed over; ADR 0007 in CP01. Full wording in the design §10.

## Limits

Design only; the feasibility spike does not replace CP01's tests. No CP01 prompt was issued or executed. Residuals stated in the design: a stolen cookie lives until expiry or stamp rotation; shared `IdentityOptions`; unused claim/login/token tables stay keyed to customers.

## Review

`REVIEW: NOT RUN`. Owner must run `/codex:review --base origin/develop` on the pushed head.
