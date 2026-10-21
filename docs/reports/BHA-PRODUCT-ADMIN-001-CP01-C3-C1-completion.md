# BHA-PRODUCT-ADMIN-001-CP01-C3-C1 — correction report

Status: `BLOCKED`
IMPLEMENTATION_STATUS: `IMPLEMENTATION_COMPLETE_WITH_BLOCKERS`
REVIEW: `OWNER_REVIEW_PENDING`

## Owner decision

> “Trong BHA-PRODUCT-ADMIN-001-CP01 và correction C3-C1, Codex là writable implementer duy nhất; Hồ Đình Lâm trực tiếp review. Không yêu cầu hoặc gọi Claude/Codex reviewer riêng. Kết thúc bằng bàn giao Owner; Owner giữ quyền Ready/merge/delete branch. Ngoại lệ chỉ áp dụng lựa chọn reviewer và cơ chế handoff tương ứng, không thay single-writer, kiểm thử, phạm vi hoặc bảo vệ dữ liệu.”

## P0 — preflight and reproduction

- Work item/correction: `BHA-PRODUCT-ADMIN-001-CP01` / `BHA-PRODUCT-ADMIN-001-CP01-C3-C1`.
- Implementer: `CODEX`; direct reviewer: `OWNER_HO_DINH_LAM` under the Owner workflow exception recorded above. No reviewer agent, subagent, Orca, or second checkout used.
- Branch: `feature/bha-product-admin-001-cp01-riverside-room-types`.
- Original work item baseline: `d1d08d6fa5a622197e6e016f43890f988414df00`.
- Correction baseline / `CORRECTION_START_HEAD`: `ad4b89de6af7d4d68ef521eeae3d4cd2238c8c50`.
- `origin/develop` at preflight: `d1d08d6fa5a622197e6e016f43890f988414df00`.
- PR #124: OPEN, Draft, base `develop`, head matches correction baseline.
- Initial working tree: clean. No source was changed before this Owner decision was recorded.
- Reproduction: API `https://localhost:7145` returns 204 for preflight on all three catalog create routes, with `Access-Control-Allow-Origin: https://localhost:3001`, credentials enabled and method `POST`, but `Access-Control-Allow-Headers: Content-Type` omits `Idempotency-Key`. Unknown Origin receives no CORS allow headers. This matches the browser report.
- Effective-policy source: `Program.cs` attaches `StaffCalendarModeGuard.WriteCorsPolicy` to Staff website POST endpoints; that policy only permits `Content-Type`. Catalog create calls send `Idempotency-Key`.
- Local API and Admin listeners are present on 7145 and 3001. API readiness is healthy. Runtime CORS mode is Staff. PostgreSQL `current_database()` is `thebha_dev`, server version `17.10`.
- DB evidence at preflight: `AdminCatalogCreateOperations` contains 0 rows and `CatalogContentAudits` contains 0 rows. Riverside currently has 14 physical rooms. No specific pending operation ID, current actor, RoomNumber or payload was accessible from the active Chrome tab at this checkpoint, so the 14-room list cannot identify the user's attempted operation. This point-in-time query does not establish that an old request is not in flight or cannot later commit.
- TLS is separate from CORS. API serves a `CN=localhost` development certificate valid 2026-08-06 through 2027-08-06; Admin serves a separate mkcert `localhost` certificate. The API certificate is trusted as a peer in this user's NSS DB and validates locally. A separate Chrome process/profile accepted both HTTPS endpoints; the existing Owner Chrome process predates the NSS import and was not restarted. No TLS bypass is used.
- The active Owner Chrome process has no CDP port, and the computer-use Orca surface is disabled by this MEP. It was not accessed, closed or restarted. A separate headless Chrome test profile loaded both local HTTPS sites using the current NSS trust, then issued the exact cross-origin credentialed POST shape without a Staff cookie. Browser Network events were `OPTIONS 204`, then `POST 401`; `fetch` resolved with status 401 rather than rejecting. This proves the browser accepted both TLS connections and the CORS preflight; it is not a signed-in `/products` creation test.
- P0 status: `BLOCKED` for operation-specific DB correlation and signed-in Owner browser verification; independent CORS reproduction and source/runtime trace passed. Separate headless browser verified TLS and CORS transport only.

## Correction changes and verification

- Added a dedicated credentialed CORS policy for exactly the three catalog create actions. It explicitly allows configured Admin origins, `POST`, `Content-Type` and `Idempotency-Key`; the Staff endpoint convention preserves this action-level policy. Login, Calendar and other Staff write policies keep their existing header allowlists.
- Catalog create recovery now retains actor, property/room parent, payload snapshot and operation ID for an unknown result. The recovery action is labelled `Tiếp tục yêu cầu` and explains it replays the same idempotent operation, which may complete it if it has not committed. A later 400/401/403/409 does not clear a previous unknown result. Successful create clears only its own matching recovery record. A known pre-write refusal/configuration failure clears its record and enables Hủy. Wrong-actor recovery remains stored and blocks replacement creates until the original Staff account returns. The editor's readback action no longer resets an unknown create gate.
- Integration regression exercises all three route preflights through the ASP.NET pipeline; allowed/denied origins, methods and headers; no mutation on OPTIONS; credentialed CORS headers on denied/invalid POST responses; and unchanged login allowlist. Focused `AdminCatalogApiTests`: PASS, 10/10 on PostgreSQL.
- Admin regression covers unknown replay preserving actor/parent/payload/key across a refused retry and reload; known config refusal then Hủy without recovery resurrection; wrong actor preserving pending state; slow POST/readback locking cancellation and double-submit; and successful readback cleanup. Focused `CatalogWorkspace.test.tsx`: PASS, 22/22; TypeScript: PASS.
- Live API before restart reproduced missing `Idempotency-Key`; after restart from the changed Release build, all three Kestrel preflights return `Access-Control-Allow-Headers: Content-Type,Idempotency-Key`, credentials `true`, POST, and exact Admin origin. A separate real Chrome request produced OPTIONS 204 and POST 401, proving CORS/TLS browser transport; no Staff credential or DB mutation was used.
- Unknown user's original browser operation remains uncorrelated: the current Owner tab's sessionStorage was not accessible under the explicit no-Orca constraint. The read-only query at preflight found 0 create-operation rows and 0 catalog audit rows at that instant, but this does not identify the unknown operation, prove its absence from a later commit, or authorize a new key. No live business rows were created, changed, deleted or reseeded.
- UI live status: `PARTIAL` (real Chrome TLS/CORS transport verified; signed-in `/products` create, live list/count and Owner tab recovery interaction not run). TLS is separately verified for a new Chrome process/profile; the existing Owner Chrome was left open.

## P2 — integrated/local checks

- Backend focused PostgreSQL integration: PASS, 10/10. Full `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build`: PASS, Unit 543/543 and Integration 1,101/1,101. `dotnet restore Back_End/TheBha.Booking.sln` and Release build: PASS, 0 warnings / 0 errors.
- Admin focused workspace regression: PASS, 22/22. Full `npm test`: PASS, 64 files / 1,973 tests. `npm run lint`, TypeScript check and `npm run build`: PASS.
- `git diff --check`: pending final pre-commit run. Browser signed-in create/list/count and Owner-tab recovery: `NOT_RUN`; no browser harness could access the existing signed-in tab without Orca/CDP.
- Current Dev DB remains `thebha_dev`/PostgreSQL 17.10. Operation-specific matching remains BLOCKED until the Owner tab's pending record is available. The only safe continuation for that original intent is `Tiếp tục yêu cầu`, which reuses its stored operation ID and payload.
- P2 status: `BLOCKED` for original-operation correlation and signed-in Owner-tab live UI verification; independent code, API pipeline, browser CORS/TLS and automated checks continue.

## Final handoff

### FIX-A1–FIX-A8

- FIX-A1: PASS — all three pipeline preflights allow configured Admin origin, credentials, POST, Content-Type and Idempotency-Key; OPTIONS did not invoke catalog handlers.
- FIX-A2: PASS — wrong origin, method and unlisted request header are not granted; login allowlist remains unchanged. POST permission/validation error responses retain CORS only for allowed origin. Staff permission/owner boundary tests remain in the full backend suite.
- FIX-A3: PARTIAL — live configured API preflight passed for all three routes; separate real Chrome issued OPTIONS then POST 401 without Staff authentication. Authenticated browser create/readback/reload/list count and database entity-parent proof: NOT_RUN.
- FIX-A4: PASS — regression covers pre-submit refusal/cancel cleanup, form retention, pending/double-submit locking and no reload resurrection after known refusal.
- FIX-A5: PASS — recovery tests preserve immutable original payload/key through unknown and refused retry/reload, then clear only after verified same-entity completion; existing backend idempotency tests passed in full suite. No live replay of the Owner's unidentified key was attempted.
- FIX-A6: PASS — pre-fix OPTIONS was reproduced missing Idempotency-Key; post-fix browser accepted preflight and sent POST. Generic rejected fetch remains unverified, and editor readback cannot clear unknown create.
- FIX-A7: PARTIAL — component regressions cover changed actor, delayed write/readback, refusal after unknown and reload. Owner's actual browser session transition and operation row/audit correlation: NOT_RUN.
- FIX-A8: PARTIAL — TLS/CORS verified in a separate Chrome profile; existing Owner browser and UI light/dark/focus interaction not exercised. Required backend/Admin checks and diff check pass; Customer_Web unchanged; Orca unused.

### Closeout

- `CORRECTION_START_HEAD`: `ad4b89de6af7d4d68ef521eeae3d4cd2238c8c50`. `BASE_BRANCH`: `develop`; `REVIEW_BASE`: `origin/develop`; `CORRECTION_DIFF_BASE`: same start head. Implementation commit: `fa39d45d6e9edf705cb4b032bc48d4bffac110c1` (`fix(admin): recover catalog creates safely`). Final head is this closeout report commit, directly following the implementation commit on the same feature branch; exact remote head is also confirmed in Draft PR #124.
- `UI_LIVE: PARTIAL`; TLS transport: PASS in separate Chrome profile; Owner Chrome trust after NSS import and signed-in UI: NOT_RUN.
- `CUSTOMER_WEB_UNCHANGED: yes`; `ORCA_NOT_USED: yes`; no database mutation/reseed during verification. Dev DB at readback was `thebha_dev`, PostgreSQL 17.10; operation and audit tables each had 0 rows at that instant, Riverside had 14 physical rooms. This does not resolve the Owner's original attempt or exclude a delayed commit.
- `PR #124`: OPEN/Draft, base `develop`, head is the remote feature branch. Implementation commit `fa39d45d6e9edf705cb4b032bc48d4bffac110c1` is confirmed on `origin`.
- CI for implementation commit `fa39d45d6e9edf705cb4b032bc48d4bffac110c1`: Admin PASS (2m31s), Backend PASS (8m37s, PostgreSQL 18.3), Frontend PASS (1m52s), source Backend suite PASS (7m9s), image build PASS (46s), Plan PASS; Vercel preview checks PASS. Deploy/publish-to-ECR jobs were skipped by workflow conditions. The closeout report commit triggers a docs-only CI rerun; its checks are pending at report commit time.
- `git diff --check`: PASS. Working tree was clean after implementation commit; the closeout report is the only intended follow-up commit and is pushed before handoff.
- `STATUS: BLOCKED` because the exact pending operation ID/actor/payload and corresponding DB operation/entity/audit cannot be read from the Owner's active browser, and signed-in browser recovery was not exercised. `IMPLEMENTATION_STATUS: IMPLEMENTATION_COMPLETE_WITH_BLOCKERS`.
- Owner action: inspect the correction on Draft PR #124. On the existing signed-in Admin tab, reload `/products` if needed to restore the pending record, then use `Tiếp tục yêu cầu`; this deliberately replays the same operation ID and immutable payload and may complete the create if the original did not commit. Do not start a replacement create until its result is verified. Review remains pending; no reviewer agent was called.
