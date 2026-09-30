# PMS-ADMIN-AUTH-001-CP00 — design and checkpoints for Staff authentication and property-scoped RBAC

> Draft PR into `develop`. Documentation only: no source, test, migration, dependency or behaviour change.
> Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Baseline `0952e1b58e274a055b47ca3f04beb6fe08ed5ed8` (PR #72 merged). The design is a **proposal**; nothing in it is CURRENT. Original head `0ff7a9019cc098e9ddbd024b0cf9336d623717ea`; correction C1 (Owner decisions) follows it.

## Deliverable

`docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md`: verified CURRENT (with source paths), eight decisions, Staff identity options, role/permission proposal, session and browser design, bootstrap, route cut-over, audit, seven checkpoints with acceptance and size, and the questions for Owner. `docs/project/SNAPSHOT.md`: CP04 merged, this milestone active, the objective and state token updated (no auth described as CURRENT; `PROJECT_BIBLE.md` untouched).

## Design chosen

- **Identity:** a separate `StaffAccount : IdentityUser<Guid>` as a second Identity user type in the same `TheBhaDbContext` (own table). Rejected: reusing `CustomerAccount` (customer cookie could become staff), a second `DbContext` (the documented single `dotnet ef database update` becomes ambiguous), hand-rolled hashing, JWT/IdP (out of scope).
- **Authorization:** `StaffPropertyMembership(Staff, Property, Role)`, roles mapped to a fixed permission set in code, checked on the server on every request with the route's `propertyId` as the resource. Proposed `Viewer` / `FrontDesk` / `Manager` over `BoardRead`, `AssignmentWrite`, `BlockWrite`, `AssignmentCrossRoomType`. Since C1 the Owner has decided that `FrontDesk` has read, assignment and block permissions and `Manager` adds cross-RoomType; `Viewer` and final role names stay open. Property-scoped only; `Organization` stays TARGET and plugs in behind one evaluator seam.
- **Session:** own cookie scheme `TheBha.Staff` (`SameSite=Strict`, `Path=/api/admin`, 8 h absolute — Owner decision), 401/403 as ProblemDetails, login/logout/`me`, credentialed `admin-staff` CORS policy, exact-Origin CSRF check instead of tokens, per-request Staff/security-stamp/membership validation so disable, password change and membership loss take effect on the next request. Customer_Web unchanged.
- **Bootstrap:** CLI verbs on the API host, password only from an environment variable or hidden prompt; no HTTP registration, no default, no Git credential.
- **Cut-over:** `AdminCalendar:AccessMode = LocalGate | Staff`; in `Staff` mode the local flags are not consulted and a route without a Staff policy is closed. Production requires `Staff` at CP07.
- **Audit:** `staff:{StaffAccountId}` and `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed`; history is not rewritten.

## Verification done

- Every CURRENT claim and referenced path was checked against the source (`Program.cs`, the two gate filters, the three Admin controllers, `TheBhaDbContext`, `HttpCurrentCustomer`, `SchedulingFieldLimits`, `AssignmentMutationStore`, Admin_Web `client.ts`, the blueprint §3/§12).
- The riskiest assumption — two Identity user types in one context — was tested with a **throwaway spike outside the repo** (same package versions, a scratch PostgreSQL database that was dropped): create, duplicate rejection, case-insensitive lookup, password check, lockout, security-stamp rotation, change password and weak-password rejection all worked, and the customer store was unaffected. It is a feasibility probe, not a repo test; `SignInManager` and the real migration are left to CP01 to verify.
- `git diff --check` clean; the diff contains only the three allowed files. No repo test or build was run (docs only).

## Checkpoint sizes (from the design §9)

CP01 ≈ 300 hand-written + ≈ 1,700 generated (migration Designer + snapshot; cannot honestly be split from the model); CP02 ≈ 350; CP03 ≈ 400; CP04 ≈ 350; CP05 ≈ 400; CP06 ≈ 400; CP07 ≈ 250. This PR is well under 400 changed lines.

## Owner decisions

**Decided (C1):** `FrontDesk` = read + assignment + block write; `Manager` = `FrontDesk` + cross-RoomType; Admin_Web and API deployed same-site; Staff session 8 h absolute, not sliding.

**Still open before CP01:** whether `Viewer` exists and the final role names; password policy and MFA; who bootstraps production and how the secret is handed over; ADR 0007; the CP01 size exception (~300 hand-written + ~1,700 generated). Choosing the milestone is not consent to any of these, and the design as a whole is not approved. Wording in design §10.

## Limits

Design only; the feasibility spike does not replace CP01's tests. No CP01 prompt was issued or executed. Residuals stated in the design: a stolen cookie lives until expiry or stamp rotation; shared `IdentityOptions`; unused claim/login/token tables stay keyed to customers.

## Review

**Original review (before C1)** — `ORIGINAL_REVIEW: RUN`. One invocation of `/codex:review --base origin/develop`, run by Owner. `REVIEWED_HEAD: 0ff7a9019cc098e9ddbd024b0cf9336d623717ea`. No finding. Codex's result, verbatim:

> The diff is documentation-only and clearly separates the proposed Staff auth/RBAC design from current behavior. No actionable defects were found against the existing source and repository rules. Diff whitespace validation passed; builds and tests were not run.

The reviewer read docs and source only: it did not run builds or tests and did not reproduce the feasibility spike. CI on that head: run 36700162116, Admin / Backend / Frontend success.

**C1 (Owner decisions)** — `REVIEW: RUN`. One invocation of `/codex:review --base origin/develop`, run by Owner. `REVIEWED_HEAD: 7b5cef64d2689a4e413f8b508663259d2d1cb0b7`. `REVIEW_BASE: origin/develop`, baseline `0952e1b58e274a055b47ca3f04beb6fe08ed5ed8`. No finding. Codex's result, verbatim:

> The documentation-only diff clearly distinguishes proposed Staff auth/RBAC behavior from current functionality. No actionable defects were found against the referenced source and repository rules; whitespace validation passed. Builds, tests, and the reported feasibility spike were not run during this review.

- The reviewer did not run builds or tests and did not reproduce the feasibility spike; the spike remains the implementer's evidence.
- CI on `7b5cef6`: run 36705086978, Admin / Backend / Frontend success.
- The reviewed diff is +197 / −10 across 3 files against `origin/develop`.
- **OC_DISPOSITION (as communicated by Owner): PASS** for CP00-C1. The design is still a proposal; the items under "Still open" and the CP01 size exception remain undecided, and neither the milestone choice nor this review approves them.
- The commit that records this section is a separate reporting commit **after** `7b5cef6`. Codex did not review it; the reviewed head stays `7b5cef6`.
