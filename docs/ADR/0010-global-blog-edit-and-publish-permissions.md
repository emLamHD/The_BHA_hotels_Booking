# ADR 0010: Two global Staff permissions for the Blog — edit and publish

- Status: Accepted (Owner, work item `BHA-BLOG-001-CP01`, 2026-10-21). Implemented by migration 18 (`AddBlogFoundation`).
- Date: 2026-10-21
- Related: ADR 0007 (Staff identity and Property memberships), ADR 0008 (the global website-settings permission, which this ADR extends and does not amend), ADR 0009 (per-Property promotion permission, the contrast case).

## Context

The Blog (guides, destinations, news) is brand-wide content: one article is read by every visitor of the website and is not owned by a Property. ADR 0007 would derive a right from a Property role, which would hand a site-wide right to the Manager of any single Property; ADR 0009 is per Property for the same reason in reverse. The Owner also decided that **editing a draft must not imply publishing** — writing is separate from making content public.

ADR 0008 allowed a single site-wide flag (`CanManageWebsite`) and said that "if a second global permission appears, a small permission table or flags column is a later, explicit decision". This is that decision.

## Decision

- Two more columns on the Staff account, both `boolean NOT NULL DEFAULT false`: `CanEditBlog` and `CanPublishBlog`. They are independent. No Property role, no membership and no other flag (including `CanManageWebsite`) grants either.
- Permissions the server checks (`StaffGlobalPermission`): `BlogEdit` (= `CanEditBlog`), `BlogPublish` (= `CanPublishBlog`), `BlogAccess` (= either; used only for reading the Admin and for uploading a picture, so an editor can attach a cover to their own draft and a publisher can look at what they publish).
- `BlogEdit`: create posts and translations, save drafts, restore a revision to a draft. `BlogPublish`: publish, unpublish, archive, unarchive, and everything that changes what is public without a draft step — categories (create, update, delete), pins and the Blog settings. Edit does **not** publish; publish does **not** edit.
- Granted and revoked only by the operator CLI on the API host: `--staff-blog-access --email <email> --edit true|false --publish true|false`. Both values are always stated and must be exactly `true` or `false` (a typo cannot revoke by accident); granting to a disabled account is refused; the verb changes nothing else. Never over HTTP, never by a seed or by the migration.
- Checked from the database on every request, as in ADR 0008: the account must exist, be active and hold the flag, so a revoke or a disable ends the access on the next request with a cookie that is still valid. The cookie carries no permission.
- The Blog routes use the existing `StaffWebsitePermissionAttribute` (HTTPS only, Staff session → 401, permission → 403, Origin and JSON checks on a write, `Cache-Control: no-store`, closed with 404 in `LocalGate`). The attribute is not changed; "edit or publish" is its own enum value evaluated in the evaluator, so the attribute never grows any-of semantics.
- `GET /api/admin/v1/me` and the login response list `BlogEdit` / `BlogPublish` next to `WebsiteSettingsManage` for display only; the server decides again on every request. Admin_Web tolerates names it does not know: it keeps every non-empty string (`Front_End/Admin_Web/src/lib/api/staff.ts:104-108`) and its website gate only tests whether the list *includes* `WebsiteSettingsManage` (`src/components/website/WebsiteAccessGate.tsx:60`), so granting a Blog flag to a real account cannot break its sign-in. Admin_Web has no Blog gate yet (CP03).
- Every Blog mutation is audited (`BlogAudits`) with the Staff id of the verified session; no request field can name the actor.

## Consequences

- Two more columns and one more CLI verb; still no permission table. A third site-wide permission, or a need for per-category rights, is the point to introduce one (a new explicit decision).
- An operator, not the Admin UI, decides who may write and who may publish. There is no screen to grant either.
- `Down()` of migration 18 refuses while any Blog content, picture, audit line, edited category or Blog permission exists, so a rollback cannot silently drop any of it.
