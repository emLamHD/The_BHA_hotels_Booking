# BHA-PRODUCT-ADMIN-001-CP01 — completion report

Status: `IMPLEMENTATION_COMPLETE_WITH_BLOCKERS` — implementation and code checks are complete; live Riverside browser acceptance remains outstanding. Draft PR is for Owner review of the code and blockers.

- Work item: `BHA-PRODUCT-ADMIN-001-CP01`
- Implementer: CODEX. Owner Hồ Đình Lâm is the direct reviewer under the work-item exception to the repository's paired CODEX/CLAUDE and AI-review handoff rules. No reviewer or other coding agent was invoked; self-check is not independent review.
- Baseline: `d1d08d6fa5a622197e6e016f43890f988414df00` (`origin/develop`, fetched and verified)
- Branch: `feature/bha-product-admin-001-cp01-riverside-room-types`

## Implementation

Admin `/products` uses the existing Property, RoomType, Media, PropertyMedia, RoomTypeMedia and Amenity records. House/Riverside/Villa choices are resolved from database properties; known absent slugs render an unconfigured empty state and are never sent as IDs. Property and room content can be edited; operational IDs, occupancy, stock, active state, schedule, rates and physical rooms remain read-only. Room area, bedroom count and bed description are nullable.

All catalog Admin routes require HTTPS Staff session and `WebsiteSettingsManage`, use the session actor and existing Origin/CSRF boundary, and scope gallery reads/writes to the requested property or room type. Save uses expected content version, one transaction for owner content/associations/audit, and a 409 on stale version. A non-empty gallery requires one cover; removing the cover promotes the first remaining image. Alt text is stored as an owner-link override, so it does not edit global Media. Upload stages validated JPEG/PNG/WebP bytes under the server-generated `catalog/` namespace, and only Save links them. Private previews require Staff authorization; uploaded media is exposed through the unchanged `Media.Url` contract only while linked. Existing Riverside pictures are embedded from their existing Customer media source for private Admin preview; Customer files and proxies are unchanged.

Migration `20261018044944_AddAdminCatalogContent` is additive: nullable descriptive fields, content version/actor columns, per-link alt overrides and new upload/audit tables. Existing IDs, rows and links are not reseeded. Storage must be persisted and backed up with PostgreSQL at `WebsiteMedia:RootPath/catalog/`; restoring only the database can leave uploads unavailable. Existing translation rows remain intact; `vi` is the source language and current per-locale overrides continue to win. Future Customer integration must preserve the existing translation override and default-language fallback behavior. Because saves update the shared catalog, existing public catalog readers may reflect new source text, amenities, image ordering or link alt text immediately. Date-specific weekday, holiday and event prices remain a later use of `DailyRoomRate`.

## Acceptance evidence

- A1 — Partial: Admin route, database-backed choices and no-ID empty states are implemented. Live Staff/Riverside browser evidence is unavailable because the verified local `thebha_dev` database has no `StaffAccounts` table and no Riverside property. The official Riverside seeder refuses this database name; it was not bypassed.
- A2 — Partial: PostgreSQL integration test proves save, reload, audit, nullable room metadata and stale 409. Riverside Owner data could not be exercised on the current database.
- A3 — Not verified against DB: Git seed/manifest records 10/6/6/9 images and the existing covers, and code keeps each gallery owner-scoped. Current database has no Riverside row, so actual gallery counts/covers and drift could not be compared. No reseed performed.
- A4 — Partial: a real WebP upload is validated, written to storage and served by private/public API routes after Save. API restart with that upload was not exercised.
- A5 — Partial: invalid script bytes and foreign/unlinked Media IDs are rejected; a gallery with no cover is rejected; staged media stays private until linked. Storage-failure cleanup and deleting a linked image/amenity while proving another owner is unchanged are not yet covered by a targeted test.
- A6 — Pass by diff and contract checks: no `Front_End/Customer_Web` changes; no homepage visibility/publishing state. Existing `Media.Url` remains valid and public catalog query behavior only adds per-link alt override resolution.
- A7 — Partial: targeted tests verify anonymous 401, missing global permission 403, missing property/room owner 404, and Staff-only private media; Origin and LocalGate use the existing shared Staff route boundary but catalog-specific negative tests were not added. Session revoke/disable was not directly repeated on catalog routes.
- A8 — Partial: stale expectedVersion returns 409 and does not overwrite; UI preserves dirty draft, prevents duplicate writes, scopes response state by owner and offers save/discard/stay prompts. Browser-level delayed-response, property switching and sign-out evidence was not run.
- A9 — Pass by targeted integration test and diff: physical-room count remains unchanged on catalog save; no RatePlan, rate, hold, reservation, assignment or inventory code is modified.
- A10 — Not run: no browser automation was available without the disabled Orca tooling, and the local DB has no eligible Staff/Riverside account for a meaningful live flow. Desktop/mobile, keyboard/focus and image-error behavior remain Owner acceptance items.

## Checks

- `git fetch --prune origin` and baseline verification — PASS; `origin/develop` equals baseline SHA above.
- `dotnet restore Back_End/TheBha.Booking.sln` — PASS.
- `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` — PASS, 0 warnings on the initial build. A later targeted test-project build has one pre-existing nullable warning in `WebsiteTranslationsApiTests.cs:141`.
- Targeted `AdminCatalogApiTests` on PostgreSQL 17.10 — PASS, 5/5.
- Targeted migration/OpenAPI/catalog checks — PASS, 29/29.
- `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` against real PostgreSQL 17.10 — PASS: unit 543/543; integration 1,088/1,088. A prior run exposed historic migration-count/route expectations and a fingerprint helper including new columns; both were corrected, targeted checks passed 29/29, then the full rerun passed.
- Admin Web `npm test` — PASS, 1,950/1,950 across 63 files.
- Admin Web `npm run lint` — PASS.
- Admin Web `npx tsc --noEmit` — PASS.
- Admin Web `npm run build` — PASS; `/products` appears as a generated route.
- `git diff --check` — PASS at last run.
- Live browser/UI: `NOT_RUN` as explained in A10.
- `dotnet ef database update --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj` — PASS on the verified PostgreSQL 17.10 development database `thebha_dev`: migration history advanced from 8 to 15, property ID/slug remained `10000000-0000-0000-0000-000000000001` / `the-bha-hotel`, `ContentVersion=1`, and catalog audit count is 0. Readback shows no Riverside property and no Staff accounts; House/Riverside/Villa were not seeded. Existing rows were not reset or reseeded.

## Handoff

Draft PR URL/head, commits, final test results and diff size are to be added after the authorized push and PR read-back. No merge, Ready transition, deploy or branch deletion is authorized or performed. `CUSTOMER_WEB_UNCHANGED: yes`; `ORCA_NOT_USED: yes`; `OWNER_REVIEW_PENDING: yes`.
