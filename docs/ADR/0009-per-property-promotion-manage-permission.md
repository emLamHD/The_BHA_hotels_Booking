# ADR 0009: A per-Property permission to manage booking promotions

- Status: Accepted (Owner, work item `BHA-BOOKING-PROMOTIONS-001`, 2026-10-21).
- Date: 2026-10-21
- Related: ADR 0007 (Staff identity and Property memberships), ADR 0008 (global website permission). This ADR amends the permission map of ADR 0007; it does not add a role.

## Context

A booking promotion changes the price a guest pays at one Property. ADR 0008's `WebsiteSettingsManage` is global and never checks a Property membership, so reusing it would let any account with that permission change the price of every Property. The Owner requires Staff RBAC per Property for promotions.

## Decision

- Add `StaffPermission.PromotionManage`. `StaffPermissions.RoleGrants` grants it to `Manager` only. `FrontDesk` does not have it. No role is added, so no migration is needed for the permission.
- Promotion Admin routes are `.../properties/{propertyId:guid}/promotions...` and carry `[StaffCalendarPermission(StaffPermission.PromotionManage, ...)]`, so the existing filter checks the Staff session, the membership of that `propertyId` and the Origin/JSON boundary on the server, on every request. The role is never read from the cookie, body or query.
- In the `LocalGate` mode the routes are closed (404), as the website routes are. `StaffCalendarModeGuard` opens them in `Staff` mode only because of the attribute.
- The audit actor is `staff:{StaffAccountId}`, as in ADR 0007; the Staff id is also stored in the promotion's audit rows.
- Admin_Web gates the screen with the Staff session memberships (the Calendar precedent), shows only Properties where the account is `Manager`, and treats the check as display only.

## Consequences

- A Manager of Property A cannot read or write promotions of Property B.
- The homepage display order is site-wide although the permission is per Property; the order is a plain integer in each promotion, so the worst effect of a conflicting value is the order of cards, never a price.
- A third role or a finer permission is a later, explicit decision.
