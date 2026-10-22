# BHA-BLOG-001 — CP03 completion report

- **IMPLEMENTATION:** PASS for CP03 (C2 fix + Admin Blog). **REVIEW:** `NOT_RUN` — only the Owner invokes it (below).
- **Work item:** `BHA-BLOG-001-CP03`. CP04 (Customer) and CP05 (SEO) are **not** started.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner only).
- **Branch:** `feature/bha-blog-001-cp03-admin-blog` (did not exist; created in the single checkout with `git switch -c`). **BASE_SHA = START_HEAD:** `cde026daca8611c16982543dbca407e4b5de929b` = `origin/develop` after `git fetch --prune origin`; tree clean; `REQUIRED_ANCESTOR` `22affeb4…` is an ancestor. Two old Orca linked worktrees exist on disk (`dry-run-orca-*`): noted, not used or touched (`RULES.md` §5).
- **Draft PR / FINAL_HEAD / CI:** given in the hand-off message (this file is part of the head it would describe).
- **UI_LIVE:** `PASS` — 13 acceptance items on the real Admin (Next.js, HTTPS) + the real API (Kestrel, HTTPS, mkcert leaf) + a throwaway PostgreSQL 17 database, driven in Chrome 153 (below). Component tests and mocks are *not* what this rests on.
- **Skills / tools:** Graphify (`GRAPHIFY_POLICY: ALLOWED_IF_RELEVANT`): a graph exists at `graphify-out/`; it was **not queried** — source and tests were read directly (two read-only lookup subagents mapped the Admin and backend files). `diagnosing-bugs` (`ALLOWED_IF_TRIGGERED`): **not invoked**; every failure found had a direct repeatable loop (the failing test or script itself) and is listed under "Defects found". Advisor consulted before locking the plan; a final consultation precedes the hand-off.

## Governance notes

- Nothing merged, marked Ready, deployed, rebased or force-pushed; no worktree added; no Codex command run; PR #127 untouched. The one amended commit is the unpushed C2 commit, reworded (same tree) before anything was built on it.
- Out-of-scope files touched, with the reason: `AppSidebar.tsx` and `returnTo.ts(.test)` (navigation and sign-in allowlist — in scope: "navigation/gate Blog"); the Blog authorization matrix test gained the preview route.
- Not touched: Customer_Web, registry, homepage, SEO, schema/migrations, auth/Identity/grants, storage/codec/presets (beyond C2), CI/CD, Docker, governance, Booking/Calendar.

## A. C2 (commit `b212090`)

`SkiaBlogImagePipeline.Process`: `using var srgb = SKColorSpace.CreateSrgb();`. Disposal order: C# disposes in reverse declaration order, `srgb` is declared before `source` (and `target` is inside the loop), so both bitmaps are disposed before it on every return, error and cancellation path. Release build 0 errors; 63 pipeline / media-library tests (incl. the C1 GUID-value and 64-bit offset regressions) green.
**Honest finding:** a probe outside the repo on SkiaSharp 4.153.1 shows `CreateSrgb()` returns **one shared managed instance** (same handle) and `Dispose()` on it is a no-op (the handle stays valid and usable). So the change is correct ownership and future-proofing, **not** the fix of a measured leak; the commit message says exactly that.

## B. What was built

| Area | Result |
|---|---|
| Backend | Staff-only preview `GET posts/{id}/translations/{locale}/preview` (BlogAccess, `no-store`, draft else published, public-detail field names, Staff picture addresses, `cover` nullable); shared helper `BlogPublicShape` used by the public read and the preview; `coverMediaId` on list rows. |
| Backend (needed for acceptance) | The body validator trimmed every inline run — `"Đây là <b>đậm</b> chữ"` was stored as `"Đây làđậmchữ"`, so "save, reload, unchanged" was impossible. A run is now non-empty plain text and keeps its end spaces; everything else is still trimmed. Red→green unit tests + an HTTP test. |
| Admin client/model | `lib/api/blog.ts` (typed client on the existing fetch wrapper; Staff Blob reads; XHR upload with real progress), `lib/blog/bodyModel.ts` (JSON ↔ editor, server limits and rules, unknown content kept), `editorSchema.ts` (TipTap restricted to the server's shapes), `blogModel.ts`. TipTap `3.32.0` (MIT, React 19 peer ok, explicit extension packages, exact pins, lockfile). |
| Admin screens | Gate with the Blog rule; posts list; editor with a tab per language, history, restore, preview; categories + pins; picture library + picker + upload queue + focal point + usage + guarded delete; settings; flat "Blog: …" menu entries; sign-in return allowlist. |

Source-of-truth contract: `docs/design/BHA-BLOG-001-blog-content-publishing.md` §10. Operator steps: `docs/runbooks/BHA-BLOG-001-admin-blog.md`.

## Checks (all run in this work item)

| Check | Result |
|---|---|
| Backend Release build | 0 errors |
| Backend full suite (`dotnet test Back_End/TheBha.Booking.sln -c Release`, real PostgreSQL 17.10 on port 54329) | **676 unit + 1292 integration, 0 failed** (integration 8 m 41 s), run on the final backend code (`8091ce8` and nothing in `Back_End/` after it) |
| Backend, earlier on the preview commit | 673 unit + 1291 integration, 0 failed |
| Admin `npm run lint` / `npm test` / `npm run build` (typecheck included) | lint exit 0; vitest **72 files / 2093 tests, 0 failed** (baseline before my edits: 66 / 2022); build exit 0 (7 Blog routes listed) |
| `git diff --check origin/develop...HEAD` | clean (run after the last commit of the code; one trailing blank line in the design document was found by it and fixed) |

New tests: `BlogPreviewApiTests` (8, HTTP + PostgreSQL), 3 body-validator unit tests; Admin: body model + schema + paste safety (27), gate by role (8), form writes (14), upload queue (10), the real editor in jsdom (7), posts list (4), `returnTo` (+1).

## Acceptance → evidence (browser, real stack)

Environment: API `dotnet TheBha.Api.dll` (Development, HTTPS :7145, mkcert leaf, `WebsiteMedia__RootPath` = a scratch folder, login rate limits raised for the run), Admin `next dev --experimental-https` :3001, PostgreSQL 17.10 database `thebha_cp03_accept` (migrated, `--seed-development`, English switched on with one `UPDATE`), five Staff accounts made with `--staff-create` / `--staff-blog-access` (passwords random, kept in a 0600 file, never printed), Playwright 1.49.1 driving `/usr/bin/google-chrome` 153. Each scenario ran against a rebuilt database or continued the same lineage; every PASS below is a recorded assertion of the run.

| # | Evidence |
|---|---|
| 1 | Anonymous: direct route → `/signin?returnTo=…`, API 401. No-Blog and Property-Manager accounts: no-permission panel, no list, API 403. Edit-only: list opens, "new post" offered, server refuses create-category / publish / settings (403). Publish-only: list opens, no "new post", `/posts/new` explains it, server refuses create / save draft / media metadata (403). Both: all. A Blog permission does **not** open `/website/hero` or `/languages`. |
| 2 | Category with vi + en texts; new post: slug suggested from the title, cover uploaded in the picker and chosen, alt, category, body with heading, bold / italic / link, list, quote + cite, picture with alt and caption, 2-picture gallery, contents, property intro → Save → server body has every block in order with runs and spaces intact → reload: fields, formats and every block back, form not dirty. |
| 3 | Private preview of the draft: cover, all body pictures (naturalWidth > 0, through the Staff session), link, contents, property; anonymous: public article 404, public list empty, public cover address 404, Staff picture address 401. |
| 4 | Publish → public API serves the snapshot; editing the draft and its categories leaves it unchanged (badge "unpublished changes" shown); publish again updates it. |
| 5 | EN tab starts empty (nothing copied); a category with a vi text only gives a hint, and the publish refusal appears beside the categories with the input kept; Cuisine → en published; en and vi lists show only their own titles; switching language with unsaved edits asks, "stay" keeps the edit. |
| 6 | Two tabs on one version: tab B gets 409, keeps its input, the server keeps A's save; the conflict panel compares both; "use server's copy" replaces only on request; nothing is sent automatically. |
| 7 | Restore → draft (public unchanged); unpublish → public 404; archive; unarchive → "unpublished"; history grew; pictures still preview. |
| 8 | 4 files (2 valid, 1 cut, 1 fake) with the upload throttled: intermediate progress values 12…86 % were observed before "processing" and "done"; 2 stored, 2 failed with the server's reasons, siblings unaffected; an existing picture is chosen again without a re-upload. |
| 9 | Lost answers (server commits, browser never hears): **save** and **publish** (Playwright forwards the request, then fails it): "unconfirmed", exactly one request, the server really committed, "Check server" reconciles, no second request. **Upload** and **create** (a small TLS fault proxy forwards, waits for the API's answer, then truncates and resets the connection — Playwright cannot forward a file body): one picture / one post exists, nothing offered to resend, the SHA-256 or the client id confirms it. |
| 10 | Credit + focal point (arrow keys) saved against the picture's version = 2, post versions unchanged; usage panel lists 5 uses (cover; draft, live, history); delete of a used picture is disabled and the server answers 409 `blog.media-in-use`; an unused picture is deleted after confirmation (detail 404). |
| 11 | Two posts pinned and reordered by the buttons, saved with the category version, both effective; the home-section category is saved against the settings version; renaming that category keeps `HomeSectionCategoryId` (same id, same settings version) and the settings screen shows the new name; delete of that category is disabled and refused (409 `category-in-use`). |
| 12 | 5 pages × light/dark × desktop (1280) / mobile (390): no horizontal overflow, no broken picture, dark background applied; screenshots taken; **0 console errors** unfiltered on every Blog page; a publish refusal moves keyboard focus to the field and shows the reason; Tab order, visible focus, Enter opens the picker, Escape closes it; the focal slider works with arrows. |
| 13 | Slow save (4 s): language tabs, Sign out and Save are disabled while it runs, the language did not change; permission revoked with a page open: next Save → 403 → forms closed, nothing stored; Sign out: signed-out state with a sign-in link, the form gone, a later write answers 401. |

## Defects found by this work (all fixed in this PR)

1. Body validator trimmed inline runs (above) — found while designing the round trip; red→green.
2. The hidden editor of a **locked** body reported an empty body; saving would have replaced the real body with nothing. Found by the jsdom editor test; fixed (not reported when locked).
3. The pins dialog took the category title from the first translation (English) instead of the website's language order. Found in the browser; fixed.
4. The upload queue released the write slot twice on a duplicate id (could free another writer's slot). Found in review of my own code; fixed before commit.

## Not done / limits / risks

- Customer_Web is not connected (CP04); SEO, sitemap, hreflang, structured data (CP05). Focal point and credit are not in the public JSON (design §9.1 stays open). Production has no media mount (design §9.12). AVIF is not produced.
- Uploads use the single-file route one at a time, not `media/bulk`; a cancel proves nothing about the server (the picture is then looked up by its id).
- The acceptance scripts and the fault proxy are not in the repository (they live in the session scratch folder with the throwaway database); the report states how each loss was simulated. Two kinds of simulation were used because Playwright cannot forward a file body.
- `window.confirm` is still used by the shared leave guard and the sign-out confirmation (existing code); the Blog's own confirmations are in-page.
- The Admin dev server was used for the browser run, the production build was checked separately (`npm run build`).
- Review is the Owner's step. No blocker.

## Review (Owner invokes — not me)

READY_FOR_CODEX_REVIEW
Owner must now invoke:
/codex:review --base origin/develop
