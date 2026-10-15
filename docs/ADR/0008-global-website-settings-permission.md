# ADR 0008: A global Staff permission for the website settings

- Status: Accepted (Owner, work item `CUST-WEB-HEADER-001-CP02`, 2026-10-15). Implemented by that work item (migration 10, `AddWebsiteLocalizationSettings`).
- Date: 2026-10-15
- Related: ADR 0007 (Staff identity and Property memberships), which this ADR does not amend.

## Context

ADR 0007 authorizes Staff per Property: a `StaffPropertyMembership` role (`FrontDesk`, `Manager`) is checked against the Property of the request. The website's languages, UI translations and currencies are not Property data — they are one site-wide configuration that Customer_Web reads for every visitor. Deriving the right to change them from a Property role would either grant it to every Manager of any Property (a Property role leaking into a site-wide setting) or invent a fake "site" Property.

## Decision

- A site-wide permission is a column on the Staff account: `StaffAccounts.CanManageWebsite boolean NOT NULL DEFAULT false`. It is the only source of the permission `WebsiteSettingsManage`; a Property role grants nothing here, and the permission grants nothing for a Property.
- It is granted and revoked only by the operator CLI on the API host (`--staff-website-access --email <email> --enabled true|false`), never over HTTP, never by a seed or by migration 10. Granting is refused for a disabled account. The verb changes nothing else (no password, no security stamp).
- It is checked on the server for every request, from the database row the Staff cookie's principal reloads, so a revoke or a disable takes effect on the next request. The cookie carries no permission.
- `GET /api/admin/v1/me` and the login response return `permissions` (`["WebsiteSettingsManage"]` or `[]`) so Admin_Web can show or hide the screens. That is display only; the server decides again.
- The website routes are opened in `Staff` access mode by metadata on the controllers (an attribute), not by a path prefix: `StaffCalendarModeGuard` still closes every Admin route that is not explicitly opened. They are closed (404) in `LocalGate`; the anonymous local gates never reach them.
- ADR 0007's Calendar role map, session policy, cookie, Origin/JSON checks and the anonymous local gates are unchanged. The website routes reuse the same request boundary (Admin origin allow-list, JSON content type on every `POST`, `Cache-Control: no-store`).

## Consequences

- One more column and one more CLI verb; no new table for permissions. If a second global permission appears, a small permission table or flags column is a later, explicit decision.
- An operator, not the Admin UI, decides who can change the site's languages and currencies. There is no screen to grant it.
- `Down()` of migration 10 refuses while any website data was administered or any account holds the permission, so a rollback cannot silently drop either.
