# BHA-PRODUCT-ADMIN-001-CP01 — completion report

Status: `IMPLEMENTATION_COMPLETE_WITH_BLOCKERS` — implementation and code checks are complete; live Riverside browser acceptance remains outstanding. Draft PR is for Owner review of the code and blockers.

- Work item: `BHA-PRODUCT-ADMIN-001-CP01`
- Implementer: CODEX. Owner Hồ Đình Lâm is the direct reviewer under the work-item exception to the repository's paired CODEX/CLAUDE and AI-review handoff rules. No reviewer or other coding agent was invoked; self-check is not independent review.
- BASELINE_SHA / START_HEAD: `d1d08d6fa5a622197e6e016f43890f988414df00` (`origin/develop`, fetched and verified)
- Branch: `feature/bha-product-admin-001-cp01-riverside-room-types`

## Implementation

Admin `/products` uses the existing Property, RoomType, Media, PropertyMedia, RoomTypeMedia and Amenity records. House/Riverside/Villa choices are resolved from database properties; known absent slugs render an unconfigured empty state and are never sent as IDs. Property and room content can be edited; operational IDs, occupancy, stock, active state, schedule, rates and physical rooms remain read-only. Room area, bedroom count and bed description are nullable.

All catalog Admin routes require HTTPS Staff session and `WebsiteSettingsManage`, use the session actor and existing Origin/CSRF boundary, and scope gallery reads/writes to the requested property or room type. Save uses expected content version, one transaction for owner content/associations/audit, and a 409 on stale version. A non-empty gallery requires one cover; removing the cover promotes the first remaining image. Alt text is stored as an owner-link override, so it does not edit global Media. Upload stages validated JPEG/PNG/WebP bytes under the server-generated `catalog/` namespace, and only Save links them. Private previews require Staff authorization; uploaded media is exposed through the unchanged `Media.Url` contract only while linked. Existing Riverside pictures are embedded from their existing Customer media source for private Admin preview; Customer files and proxies are unchanged.

Migration `20261018044944_AddAdminCatalogContent` is additive: nullable descriptive fields, content version/actor columns, per-link alt overrides and new upload/audit tables. Existing IDs, rows and links are not reseeded. Storage must be persisted and backed up with PostgreSQL at `WebsiteMedia:RootPath/catalog/`; restoring only the database can leave uploads unavailable. Existing translation rows remain intact; `vi` is the source language and current per-locale overrides continue to win. Future Customer integration must preserve the existing translation override and default-language fallback behavior. Because saves update the shared catalog, existing public catalog readers may reflect new source text, amenities, image ordering or link alt text immediately. Date-specific weekday, holiday and event prices remain a later use of `DailyRoomRate`.

## Acceptance evidence

- A1 — Partial: Admin route, database-backed choices and no-ID empty states are implemented. Live Staff/Riverside browser evidence is unavailable because the verified local `thebha_dev` database has zero Staff accounts and no Riverside property. The official Riverside seeder refuses this database name; it was not bypassed.
- A2 — Partial: PostgreSQL integration test proves save, reload, audit, nullable room metadata and stale 409. Riverside Owner data could not be exercised on the current database.
- A3 — Not verified against DB: Git seed/manifest records 10/6/6/9 images and the existing covers, and code keeps each gallery owner-scoped. Current database has no Riverside row, so actual gallery counts/covers and drift could not be compared. No reseed performed.
- A4 — Partial: a real WebP upload is validated, written to storage and served by private/public API routes after Save. API restart with that upload was not exercised.
- A5 — Partial: invalid script bytes and foreign/unlinked Media IDs are rejected; a gallery with no cover is rejected; staged media stays private until linked. Storage-failure cleanup and deleting a linked image/amenity while proving another owner is unchanged are not yet covered by a targeted test.
- A6 — Pass by diff and contract checks: no `Front_End/Customer_Web` changes; no homepage visibility/publishing state. Existing `Media.Url` remains valid and public catalog query behavior only adds per-link alt override resolution.
- A7 — Partial: targeted tests verify anonymous 401, missing global permission 403, missing property/room owner 404, and Staff-only private media; Origin and LocalGate use the existing shared Staff route boundary but catalog-specific negative tests were not added. Session revoke/disable was not directly repeated on catalog routes.
- A8 — Partial: stale expectedVersion returns 409 and does not overwrite; UI preserves dirty draft, prevents duplicate writes, scopes response state by owner and offers save/discard/stay prompts. Browser-level delayed-response, property switching and sign-out evidence was not run.
- A9 — Pass by targeted integration test and diff: physical-room count remains unchanged on catalog save; no RatePlan, rate, hold, reservation, assignment or inventory code is modified.
- A10 — Not run: Google Chrome is installed, but no permitted browser-control harness is available in this session; the local DB also has no eligible Staff/Riverside account for a meaningful live flow. Orca remains disabled and unused. Desktop/mobile, keyboard/focus and image-error behavior remain Owner acceptance items.

## Checks

- `git fetch --prune origin` and baseline verification — PASS; `origin/develop` equals baseline SHA above.
- `dotnet restore Back_End/TheBha.Booking.sln` — PASS.
- `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` — PASS on final code, 1 pre-existing nullable warning in `WebsiteTranslationsApiTests.cs:141`; no errors.
- Targeted `AdminCatalogApiTests` on PostgreSQL 17.10 — PASS, 5/5.
- Targeted migration/OpenAPI/catalog checks — PASS, 29/29.
- `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` against real PostgreSQL 17.10 — PASS: unit 543/543; integration 1,088/1,088. A prior run exposed historic migration-count/route expectations and a fingerprint helper including new columns; both were corrected, targeted checks passed 29/29, then the full rerun passed.
- Admin Web `npm test` — PASS, 1,950/1,950 across 63 files.
- Admin Web `npm run lint` — PASS.
- Admin Web `npx tsc --noEmit` — PASS.
- Admin Web `npm run build` — PASS; `/products` appears as a generated route.
- `git diff --check` — PASS at last run.
- `UI_LIVE`: `NOT_RUN` as explained in A10.
- `dotnet ef database update --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj` — PASS on the verified PostgreSQL 17.10 development database `thebha_dev`: migration history advanced from 8 to 15, property ID/slug remained `10000000-0000-0000-0000-000000000001` / `the-bha-hotel`, `ContentVersion=1`, and catalog audit count is 0. Readback shows no Riverside property and no Staff accounts; House/Riverside/Villa were not seeded. Existing rows were not reset or reseeded.

## Handoff

Draft PR: [#124](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/124), base `develop`, state `OPEN`, `isDraft=true`. Implementation commit `a6da58fd1aa5b4454e25b76c382f224e029e9530` (`feat(admin): add property and room catalog editor`). This report is included in the final documentation commit; after pushing it, the PR head was read back and matched the remote feature branch. The exact final head and all commit SHAs are recorded in the completion message. Diff: 42 files, +3,795/−25. It exceeds the 100–400 line target because the generated EF migration designer/snapshot account for 2,554 lines; the rest is the complete Admin/API/storage and tests. The final branch head is verified again after the last report commit and included in the completion message. Working tree was clean after push. No merge, Ready transition, deploy or branch deletion was performed. `CUSTOMER_WEB_UNCHANGED: yes`; `ORCA_NOT_USED: yes`; `OWNER_REVIEW_PENDING: yes`.

## Correction C1 — CatalogWorkspace state and Riverside acceptance

This correction supersedes the initial report's Riverside dataset and partial-evidence statements above. Work item scope remains Admin + backend only. The Owner's direct-review exception is recorded here: Owner Hồ Đình Lâm is the reviewer; CODEX is the sole implementer. No Claude, reviewer or coding agent was called; this self-check is not independent review.

`BASELINE_SHA`: `d1d08d6fa5a622197e6e016f43890f988414df00` (`origin/develop`, fetched). `CORRECTION_START_HEAD`: `2ac3476695db49bf941fdffd14ef4c627c3072d1`. Work resumed on the same branch and Draft PR #124; the start head matched the correction reference and no unrelated edits/writer were present.

`CORRECTION_CODE_COMMIT`: `04cff7721e7f90a69ada43ecef344437dce2f9a7` (`fix(admin): preserve catalog editor draft state`). This is the stable code/test SHA used for the post-correction local evidence; the final PR head also includes the documentation evidence commit.

| Finding | Reproduction before fix | Correction | Regression evidence |
|---|---|---|---|
| F1 — draft revision drift | Component test: tab A reads v1 and edits name; tab B saves description as v2; A's Amenity refresh left its old body paired with v2 and the server accepted that body. | Draft retains its original expectedVersion and baseline across background reads; only explicit successful same-owner reconciliation replaces both. | Workspace test ran red against the old component, then green: v1 is sent, receives 409 and tab B's description remains. |
| F2 — room choices disappear | After reading a room DTO, room selector rendered only the property option. | Render room choices from the current property's property or room DTO; never reuse choices after property ID changes. | Workspace test switches property → room A → room B → property and verifies the choices remain. |
| F3 — unknown state stays stuck | `readAgain` updated the draft but left `useWriteAction` unverified, blocking later Save/upload. | Successful same-owner readback clears the matching unknown status. Failed, superseded or wrong-owner reads preserve it. Unknown upload is never retried and its file is explicitly unidentified. | Workspace tests cover Save/Upload recovery and failed/wrong-owner reads. PostgreSQL API test injected an exception after a real metadata commit and exposed deletion of the committed file; service now removes bytes only when DB absence is confirmed, retaining bytes when commit state cannot be queried. |
| F4 — discard resurrects a draft | Discard/switch changed owner only; returning to the earlier key revived old local content. | Discard clears that owner's draft and transient preview, file, Amenity and write state before switching. Save then switch and Continue editing remain separate. | Workspace tests cover property/room switching with edits, discard, Continue and Save then switch. |
| F5 — edits lost during Save/readback | Inputs remained mutable while POST/readback was pending; late readback replaced their values. | Lock selectors and all editor controls for the full mutation + reconciliation; synchronous busy and owner/mount checks reject late edits/responses. | Deferred Save/readback component test asserts controls are disabled, attempted changes do not alter the draft, and a late response is not applied to a switched/unmounted owner. |

The new component suite runs the real `CatalogWorkspace`, `WebsiteAccessGate` and shared request hooks with controlled API responses. Seven regression scenarios failed against the pre-fix component, as expected; final suite is 11/11 PASS. Backend `AdminCatalogFailureTests` uses the real API and PostgreSQL. It verifies unlink/reorder/alt/cover and Amenity isolation between owners, file retention on unlink, missing-file refusal, storage and DB failure cleanup, lost acknowledgement after commit, bad Origin, LocalGate, permission revoke and Staff disable.

### Riverside data and live API evidence

Created only a new local PostgreSQL database `thebha_catalog_demo_c1_20261018` after verifying it did not exist; the local Postgres container reported version 17.10 and local `thebha_dev` role has `CREATEDB`. The database was migrated with `dotnet ef database update`. Official Riverside seeder `--dry-run` confirmed `current_database()` exactly matched `--expected-database`; dry-run planned 1 Property, 3 RoomTypes, 11 PhysicalRooms, 31 Media, 33 links and 90 demo DailyRoomRates; `--apply` inserted 172 rows. No existing database was dropped, renamed, reset or reseeded.

Manifest comparison against this PostgreSQL database passed exact owner, file name, sort order and cover equality: Property 10; RIV-1BR 6; RIV-1BR-OPEN 6; RIV-2BR 9. Covers match `entrance-logo.webp`, `one-bedroom-living.webp`, `open-view-living.webp` and `two-bedroom-living.webp`. A temporary Staff account and `WebsiteSettingsManage` were created using the existing CLI only on this demo database, then disabled after the live check; its local-only password file was removed. No credential, cookie or connection string is in this report.

The API ran over HTTPS from its API content root with the same demo database and persistent `WebsiteMedia:RootPath=/home/admin1/.local/share/thebha/catalog-c1-media`, then was stopped and restarted. Real Staff API checks passed: anonymous catalog read 401; login and Riverside read 200; one property and three room choices; original property/room cover previews returned WebP with `nosniff`; property description Save → reload → restore persisted. A valid WebP upload was prepared, explicitly linked by Save, read back, and served with WebP/nosniff after restart using the same DB and storage root. Save then unlinked it: public image route returned 404 while committed file stayed on disk. Final DB readback: 1 property, 3 room types, 11 physical rooms, 10 property media links, room links 6/6/9 and 1 unlinked upload record/file; original manifest links remain unchanged.

### Acceptance A1–A10

| ID | Result and evidence |
|---|---|
| A1 | PARTIAL — live API returned exactly Riverside and its three RoomTypes. House/Villa empty states and navigation are implemented from dynamic property choices, but browser UI was not controlled here. |
| A2 | PASS — HTTPS API Save/reload/restore persisted property text; PostgreSQL integration tests verify room content, audit and stale-write behavior. Nullable room fields remain empty until entered. |
| A3 | PASS — exact 10/6/6/9 database-to-manifest owner/file/order/cover comparison; no drift and no forced reseed of existing data. |
| A4 | PASS — WebP upload linked only on Save and served after API restart from persistent root outside source/build. |
| A5 | PASS — PostgreSQL isolation tests preserve other Property/RoomType Media, alt, Amenity and links; unlink retains global records and committed bytes. Missing file, storage failure, DB rejection and post-commit lost acknowledgement have targeted tests. |
| A6 | PASS — no `Front_End/Customer_Web` diff; no homepage visibility/publish workflow. `Media.Url` stays absolute HTTP(S); uploaded public image is 404 while unlinked. Existing public catalog remains the same shared Property/RoomType source. |
| A7 | PASS — PostgreSQL API tests cover anonymous 401, permission 403, wrong owner 404, bad Origin 403, LocalGate closed, permission revoke 403 and Staff disable 401 for catalog routes/private preview/upload/save. |
| A8 | PASS in automated regression coverage — workspace tests exercise stale two-tab conflict, reconciliation, discard/continue/save-then-switch, deferred Save/readback lock, wrong-owner/late response and sign-out/permission-loss write prevention. Real browser two-tab session was not run. |
| A9 | PASS — acceptance DB retains 11 PhysicalRooms, 90 DailyRoomRates, one RatePlan and zero Reservations; content edits leave occupancy, active state, IDs and slugs unchanged. Migration is additive. |
| A10 | NOT_RUN — Chrome is installed, but no Chrome DevTools MCP or browser harness is available in this session. No tool was installed and Orca was not used. Desktop/mobile visual, keyboard focus and live image-error checks remain for browser review. |

### Checks and handoff

Correction checks (all ran on the correction tree):

- `npm test -- src/components/catalog/CatalogWorkspace.test.tsx` — PASS, 11/11; pre-fix red run, 7/7 expected failures.
- `npm test` — PASS, 1,961/1,961 across 64 files; `npx tsc --noEmit`, `npm run lint` and `npm run build` — PASS; `/products` is generated.
- `dotnet test Back_End/tests/TheBha.IntegrationTests/TheBha.IntegrationTests.csproj --configuration Release --no-restore --filter FullyQualifiedName~AdminCatalogFailureTests` on real PostgreSQL — PASS, 6/6 after lost-ack fix; the pre-fix run failed the committed-file assertion as expected.
- `dotnet restore Back_End/TheBha.Booking.sln` — PASS; `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` — PASS, 0 warnings / 0 errors; `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` with local PostgreSQL 17.10 — unit 543/543 PASS and integration 1,094/1,094 PASS.
- `dotnet ef database update ...` on the new guarded acceptance DB — PASS.
- Official seed `--dry-run` then `--apply` — PASS as above.
- Live HTTPS API save/readback, gallery upload/link/unlink and restart persistence — PASS as above.
- Customer_Web read-only CI parity: `npm test` 1,297/1,297; `npx tsc --noEmit`; `npm run lint`; `npm run build` — PASS. Build emitted the existing Next client-side deopt warnings for `/blog/[...slug]` and `/offers` and an outdated Browserslist data notice; no Customer source changed.
- `git diff --check` / staged diff check — PASS. The correction adds 578 lines and deletes 62 across seven files. The overall PR stays above the 100–400 line target because the original change includes the generated 2,554-line EF migration designer/snapshot plus the full catalog API/Admin implementation and integration suite.
- The pre-correction PR head `2ac3476695db49bf941fdffd14ef4c627c3072d1` had Backend, Admin and Frontend CI pass (run `39100022711`). The correction commits were pushed after these local checks; their exact GitHub CI run/status is recorded in the Owner completion message against the verified PR head.

`UI_LIVE: NOT_RUN`; no fake browser evidence is claimed. This section supersedes the initial report's evidence and blockers. `CUSTOMER_WEB_UNCHANGED: yes`; `ORCA_NOT_USED: yes`; no merge, Ready transition, deploy or branch deletion. `OWNER_REVIEW_PENDING: yes`.
