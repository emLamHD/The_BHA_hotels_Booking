# BHA-BLOG-001 — CP03 completion report

- **IMPLEMENTATION:** PASS for CP03 (C2 fix + Admin Blog) and for its correction CP03-C1 (below). **REVIEW:** the original review of `9097726` was **RUN** by the Owner (one P2, quoted verbatim below); the review of the correction is **NOT_RUN** — only the Owner invokes it.
- **Work item:** `BHA-BLOG-001-CP03`. CP04 (Customer) and CP05 (SEO) are **not** started.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner only).
- **Branch:** `feature/bha-blog-001-cp03-admin-blog` (did not exist; created in the single checkout with `git switch -c`). **BASE_SHA = START_HEAD:** `cde026daca8611c16982543dbca407e4b5de929b` = `origin/develop` after `git fetch --prune origin`; tree clean; `REQUIRED_ANCESTOR` `22affeb4…` is an ancestor. Two old Orca linked worktrees exist on disk (`dry-run-orca-*`): noted, not used or touched (`RULES.md` §5).
- **Draft PR / FINAL_HEAD / CI:** given in the hand-off message (this file is part of the head it would describe).
- **UI_LIVE:** `PASS` — 13 acceptance items on the real Admin (Next.js, HTTPS) + the real API (Kestrel, HTTPS, mkcert leaf) + a throwaway PostgreSQL 17 database, driven in Chrome 153 (below). Component tests and mocks are *not* what this rests on.
- **Skills / tools:** Graphify (`GRAPHIFY_POLICY: ALLOWED_IF_RELEVANT`): a graph exists at `graphify-out/`; it was **not queried** — source and tests were read directly (two read-only lookup subagents mapped the Admin and backend files). `diagnosing-bugs` (`ALLOWED_IF_TRIGGERED`): **not invoked**; every failure found had a direct repeatable loop (the failing test or script itself) and is listed under "Defects found". Advisor consulted before locking the plan; a final consultation precedes the hand-off.

## Governance notes

- Nothing merged, marked Ready, deployed, rebased or force-pushed; no branch deleted; no worktree added; no Codex command run; PR #127 untouched. The one amended commit is the unpushed C2 commit, reworded (same tree) before anything was built on it.
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
| Admin `npm run lint` / `npm test` / `npm run build` (typecheck included) | exactly as CI runs them (`.github/workflows/ci.yml`, Admin job), on `85bfa75`: `npm ci` exit 0; `npm run lint` exit 0; `npm test` **72 files / 2097 tests, 0 failed** (baseline before my edits: 66 / 2022); `npm run build` exit 0 (7 Blog routes listed); tree clean afterwards. Backend CI uses PostgreSQL 18.3; the suite here ran on 17.10 (the version `AGENTS.md` names) — a difference to watch in CI |
| `git diff --check origin/develop...HEAD` | clean (run after the last commit of the code; one trailing blank line in the design document was found by it and fixed) |

New tests: `BlogPreviewApiTests` (8, HTTP + PostgreSQL), 3 body-validator unit tests; Admin: body model + schema + paste safety + comparison (28), gate by role (8), form writes (17), upload queue (10), the real editor in jsdom (7), posts list (4), `returnTo` (+1). Mutation checks: the two negative lost-publish tests fail on the old reconciliation logic and pass on the fix.

## Acceptance → evidence (browser, real stack)

Environment: API `dotnet TheBha.Api.dll` (Development, HTTPS :7145, mkcert leaf, `WebsiteMedia__RootPath` = a scratch folder, login rate limits raised for the run), Admin `next dev --experimental-https` :3001, PostgreSQL 17.10 database `thebha_cp03_accept` (migrated, `--seed-development`, English switched on with one `UPDATE`), five Staff accounts made with `--staff-create` / `--staff-blog-access` (passwords random, kept in a 0600 file, never printed), Playwright 1.49.1 driving `/usr/bin/google-chrome` 153. Each scenario ran against a rebuilt database or continued the same lineage; every PASS below is a recorded assertion of the run.

| # | Evidence |
|---|---|
| 1 | Anonymous: direct route → `/signin?returnTo=…`, API 401. No-Blog and Property-Manager accounts: no-permission panel, no list, API 403. Edit-only: list opens, "new post" offered, server refuses create-category / publish / settings (403). Publish-only: list opens, no "new post", `/posts/new` explains it, server refuses create / save draft / media metadata (403). Both: all. A Blog permission does **not** open `/website/hero` or `/languages`. |
| 2 | Category with vi + en texts; new post: slug suggested from the title, cover uploaded in the picker and chosen, alt, category, body with heading, bold / italic / link, list, quote + cite, picture with alt and caption, 2-picture gallery, contents, property intro → Save → server body has every block in order with runs and spaces intact → reload: fields, formats and every block back, form not dirty. |
| 3 | Private preview of the draft: cover, all body pictures (naturalWidth > 0, through the Staff session), link, contents, property; anonymous: public article 404, public list empty, public cover address 404, Staff picture address 401. |
| 4 | Publish → public API serves the snapshot; editing the draft **and which categories it is in** leaves it unchanged (badge "unpublished changes" shown); publish again updates it. Note for OC: category *membership* is snapshotted in the revision, but category *names* are read live (design §2, §6), so renaming a category shows publicly at once — that is how CP01 was built and CP03 did not change it. |
| 5 | EN tab starts empty (nothing copied); a category with a vi text only gives a hint, and the publish refusal appears beside the categories with the input kept; Cuisine → en published; en and vi lists show only their own titles; switching language with unsaved edits asks, "stay" keeps the edit. |
| 6 | Two tabs on one version: tab B gets 409, keeps its input, the server keeps A's save; the conflict panel compares both; "use server's copy" replaces only on request; nothing is sent automatically. |
| 7 | Restore → draft (public unchanged); unpublish → public 404; archive; unarchive → "unpublished"; history grew; pictures still preview. |
| 8 | 4 files (2 valid, 1 cut, 1 fake) with the upload throttled: intermediate progress values 12…86 % were observed before "processing" and "done"; 2 stored, 2 failed with the server's reasons, siblings unaffected; an existing picture is chosen again without a re-upload. |
| 9 | Lost answers (the server commits, the browser never hears), four kinds. **Save** and **publish**: Playwright forwards the request to the API, then fails it — "unconfirmed", exactly one request, the server really committed, "Check server" reconciles, no second request. **Upload**: a small TLS fault proxy (Admin pointed at it on :7146 for that run) forwards, waits for the API's answer, then truncates and resets the connection (Playwright's `route.fetch` cannot forward an XHR file body — it sent 308 bytes and the API answered 400) — one picture exists, "send again" was not offered before asking, the SHA-256 check confirmed it. **Create** (new post): Playwright forward-then-fail — one post exists, "Check server" found it by its own id and opened it. On the **final head** (`4eb1f3f`+): "Lưu và xuất bản" whose publish **never reached** the server (save committed, version +1, nothing published) → "Check server" says it was *not* recorded; "Lưu và xuất bản" whose publish **was committed** but whose answer was lost → recognised from the published copy; one publish request in both. |
| 10 | Credit + focal point (arrow keys) saved against the picture's version = 2, post versions unchanged; usage panel lists 5 uses (cover; draft, live, history); delete of a used picture is disabled and the server answers 409 `blog.media-in-use`; an unused picture is deleted after confirmation (detail 404). |
| 11 | Two posts pinned and reordered by the buttons, saved with the category version, both effective; the home-section category is saved against the settings version; renaming that category keeps `HomeSectionCategoryId` (same id, same settings version) and the settings screen shows the new name; delete of that category is disabled and refused (409 `category-in-use`). |
| 12 | 5 pages × light/dark × desktop (1280) / mobile (390): no horizontal overflow, no broken picture, dark background applied; screenshots taken; **0 console errors** unfiltered on every Blog page; a publish refusal moves keyboard focus to the field and shows the reason; Tab order, visible focus, Enter opens the picker, Escape closes it; the focal slider works with arrows. |
| 13 | Slow save (4 s): language tabs, Sign out and Save are disabled while it runs, the language did not change; permission revoked with a page open: next Save → 403 → forms closed, nothing stored; Sign out: signed-out state with a sign-in link, the form gone, a later write answers 401. |

## Defects found by this work (all fixed in this PR)

1. Body validator trimmed inline runs (above) — found while designing the round trip; red→green.
2. The hidden editor of a **locked** body reported an empty body; saving would have replaced the real body with nothing. Found by the jsdom editor test; fixed (not reported when locked).
3. The pins dialog took the category title from the first translation (English) instead of the website's language order. Found in the browser; fixed.
4. The upload queue released the write slot twice on a duplicate id (could free another writer's slot). Found in review of my own code; fixed before commit.
5. **A lost publish after "save and publish" could be reported as recorded.** `checkServer` judged the publish with the version of the render that built the callback (the pre-save one) and with "status is Published" alone, which is also true of a published post that merely has a saved draft; the read after a save showed version +1 and the screen said the publish had been recorded. Found by the final advisor review of the code (my browser run of 9b used two separate clicks and missed it); fixed in `4eb1f3f` (the request records the version it carries; a publish counts only when the translation is Published with no draft and its published copy is the one sent; otherwise a conflict is shown), with tests that fail on the old logic and a browser re-run of both variants.
6. The preview dialog shared a `data-testid` with the "preview" button (test hygiene); renamed in `85bfa75`.

## Run history of the browser evidence (so nothing is read as cleaner than it was)

The scenarios were scripts run one after another; several had to be fixed or split while running, and the database was rebuilt from nothing between some of them:

- **Harness faults, all in my scripts, none in the product:** typing before hydration (sign-in button still disabled), the Linux word-select shortcut (`Ctrl+Shift+←`), keystrokes sent before the editor had taken focus back, an alt label that matched the cover alt too, public-API checks run from an `about:blank` page (CORS), a missing English body in the translation scenario, Playwright forwarding of file bodies (above), a header bug in my fault proxy. One test line recorded a **FAIL** (item 11: the settings were read before the save had landed); it was re-checked by `s4c` reading the API until the value arrived, and the evidence file still contains the failing line.
- **Server misconfiguration of my own, fixed:** the first API start used the repository root as content root, so `appsettings*.json` (and therefore CORS) was not loaded; the API is now started from its build folder (noted in the runbook).
- **Which code each item ran on.** Items 1, 8, 10, 11, 12 (five pages × light/dark × desktop/mobile) and 13 ran on `fa8acdc`/`00e65ff`. After the later fixes (`4eb1f3f` lost-publish reconciliation and the shared comparison form; `85bfa75` test id) the following were **re-run on `85bfa75`/`4eb1f3f` with a freshly rebuilt database**: 2, 3 (preview), 4, 5, 6, 7, both variants of 9 (publish), and the preview dialog at 390 px (item 12). Items 1, 8, 10, 11, 13 and the five-page responsive sweep were **not** re-run after those two commits, which do not touch the gate, uploads, picture details, pins, settings or the session handling; say so if the reviewer wants them repeated.
- The browser ran on `next dev` (HTTPS), not on the production build; `npm run build` was run separately.

## PR size

63 files, **+6422 / −56** by `git diff --numstat origin/develop...HEAD` (the GitHub numbers are in the hand-off message), above the 100–400 target, as the prompt allows for this scope:

| Group | Files | + / − | Why it cannot be smaller |
|---|---|---|---|
| lockfile + `package.json` | 2 | +478 / −4 | the editor dependency (TipTap 3.32.0 and its extension packages), generated by `npm install --save-exact` |
| Admin source (screens, editor, client, routes) | 36 | +4173 / −2 | the feature itself: 7 routes, editor + node views, post/translation form, media library, picker, upload queue, focal point, categories, pins, settings, preview, client |
| Admin tests | 8 | +1137 | headless schema/model tests, gate by role, form writes and lost-answer cases, upload queue, the real editor, list races |
| Backend source | 9 | +198 / −46 | preview endpoint and DTO, shared public-shape helper (moved out of the public service), cover on list rows, validator fix, C2 |
| Backend tests | 3 | +236 | preview HTTP tests, validator unit tests, the permission matrix |
| Docs | 5 | +200 / −4 | design §10, runbook, SNAPSHOT, worklog, this report |

## Left on the machine (outside the repository; none of it is committed)

The throwaway PostgreSQL cluster (`pgdata`, port 54329) was **stopped**; its databases `thebha_cp03_accept` and `thebha_test` were **dropped**; the Staff password file was shredded; the scratch media folder and data-protection keys were removed; the API, Admin dev server and fault proxy were stopped (no listener on 3001 / 7145 / 7146 / 54329). Still present in the session scratch folder: the cluster's data files, logs, the Playwright scripts and fault proxy (`pw/`), generated test pictures, screenshots and `evidence.jsonl`. `~/pgsql17`, `~/.local/share/mkcert` and `Front_End/Admin_Web/node_modules` (reinstalled by `npm ci`) are the pre-existing tools. The project's own `the-bha-postgres-1` container and `thebha_dev` were never touched.

## Not done / limits / risks

- Customer_Web is not connected (CP04); SEO, sitemap, hreflang, structured data (CP05). Focal point and credit are not in the public JSON (design §9.1 stays open). Production has no media mount (design §9.12). AVIF is not produced.
- Uploads use the single-file route one at a time, not `media/bulk`; a cancel proves nothing about the server (the picture is then looked up by its id).
- The acceptance scripts and the fault proxy are not in the repository (they live in the session scratch folder); the report states how each loss was simulated. Two kinds of simulation were used because Playwright cannot forward a file body.
- `window.confirm` is still used by the shared leave guard and the sign-out confirmation (existing code); the Blog's own confirmations are in-page.
- The Admin dev server was used for the browser run, the production build was checked separately (`npm run build`).
- Review is the Owner's step. No blocker.

## Review of `9097726` (RUN by the Owner) — original, kept as received

Command `/codex:review --base origin/develop`; target: branch diff against `origin/develop` (`cde026d`); head reviewed: `90977265b29bcf3e0b7e0d279026ff0d9a231e82`; result:

> # Codex Review
>
> Target: branch diff against origin/develop
>
> The new preview endpoint throws for archived translations that have never been published and have no draft. This is a reachable translation state and should be handled without a server error.
>
> Review comment:
>
> - [P2] Handle archived translations without a published revision — /home/admin1/The_BHA_hotels_Booking/Back_End/src/TheBha.Infrastructure/Persistence/AdminBlogService.Preview.cs:31-31
>   When a translation is archived before its first publication, `PublishedRevisionId` remains null; if it also has no draft, this null-forgiving `.Value` throws and the Staff preview request returns a 500 instead of a controlled response. Select a revision only when one exists and return an appropriate not-found/state result otherwise.

The implementer did not touch the finding before the OC correction prompt `BHA-BLOG-001-CP03-C1`, as `CLAUDE.md` requires.

## CP03-C1 — correction (same implementer, same branch, same Draft PR #128)

- **START_HEAD:** `90977265b29bcf3e0b7e0d279026ff0d9a231e82` (= local = remote = PR head at the start; #128 OPEN, Draft, base `develop`). `origin/develop` = `cde026daca8611c16982543dbca407e4b5de929b` = `BASELINE_SHA`, unchanged. **FINAL_HEAD / CI:** in the hand-off message. Two old Orca worktrees noted, not touched. Graphify `NOT_APPLICABLE` (not inspected). `diagnosing-bugs` not invoked: the failure had a direct red→green loop; the one unrelated flake is described below. Advisor consulted before the plan was fixed and before the report.
- **Root cause.** `GetPreviewAsync` selected `translation.DraftRevisionId ?? translation.PublishedRevisionId!.Value`; with both null the `.Value` throws.
- **Reachability — stated as found, not as Codex worded it.** The schema allows an Archived translation with both pointers null (its checks only require a published pointer for `Published` / `Unpublished`). But every write that moves the two pointers runs in **one transaction** (create, save draft, publish, restore — a `ClearDraft()` is always followed in the same transaction by a new draft or a publish), `Archive()` changes **only the status** (it does not clear a draft), and no current API route commits the state. So it is reachable **at the persistence level**, not through the API or the UI as they are now. It was therefore built as a **persistence fixture**: the real API up to the archive, then one SQL change that mirrors what `ClearDraft()` would leave (the draft revision frozen, the draft pointer null). The database accepted it under its real constraints. It is **not** claimed as a reproduced UI/API sequence.
- **Red → green (PostgreSQL, HTTP).** On `9097726` the fixture test got **HTTP 500** (`"An error occurred while processing your request."`). After the fix (`1e0ddd3`): **404** `application/problem+json`, `Cache-Control: no-store`, detail `The translation has no revision to preview.`; the service returns a controlled `NotFound` result. By the Blog's convention a `NotFound` carries the message only — the body has no `code` / `field` extension (`BlogResults.From` is shared by every Blog route and was not touched).
- **Fix.** Nullable selection, guarded before anything is queried; the order is unchanged (saved draft, else the published revision); nothing else is ever chosen for the editor, nothing is created or changed; no broad catch, no default id. An Archived translation that still has a draft or a published revision is previewed as before.
- **Regression outcomes (all green):** archived with its draft → previews the draft (`source: draft`, `status: Archived`); published then archived → previews the published revision (public still 404); published with a newer draft → the draft is preferred and the public keeps the old one; a successful preview writes nothing; the 404 writes nothing — `Version`, `UpdatedAtUtc`, both pointers, status and the `BlogAudits` row count are identical before and after, for Editor, Publisher and Both; anonymous → 401, no Blog permission → 403, unknown post → 404, unknown language → 400, other language → 404 (unchanged); pictures of a draft stay Staff-only (existing tests).
- **Same root, found, NOT fixed (out of scope; OC decision).** `AdminBlogService.Posts.cs:76` in `ListPostsAsync` reads `revisions[t.PublishedRevisionId!.Value]` for a row with no draft. With one fixture row present the **posts list endpoint answers 500 for everyone** (observed in the browser run). It is not produced by the API either. No other `PublishedRevisionId!` / `.Value` dereference exists in the Blog services (grep).
- **Admin.** On this 404 the preview dialog does not crash and draws no article (the data is rendered only when the load is ready and the post/language match); it shows the shared not-found text "Mục này không còn tồn tại trên máy chủ." with "Thử lại". That wording is generic (it says "no longer exists" about a translation that does exist) and Retry cannot help; per the prompt it was **not** changed (no stale or crashing UI), and is noted for OC. Tests added: the 404 path, an earlier preview not staying on screen, an answer for another post/language not drawn.
- **Checks (this correction).** Backend Release build 0 errors; full suite on PostgreSQL 17.10 (`thebha_test`): **676 unit + 1295 integration, 0 failed** (CP03 had 1292; +3 new). Admin on the same head: lint exit 0; build exit 0; `npm test` **73 files / 2100 tests, 0 failed**. **One flake, not in the diff:** on the first full run `WebsiteAccessGate.test.tsx > 403 when me cannot be read …` failed once (`TypeError … 'onDenied'` of a null host; a jsdom "navigation" message); the same file passed 3 of 3 alone and the whole suite passed on the re-run. I did not diagnose it further (it is outside this correction); it is probably the "Admin flake" already noted in the CP02 report. `git diff --check origin/develop...HEAD` clean.
- **Browser smoke at `1e0ddd3` (real Admin `next dev` HTTPS + real API + a rebuilt throwaway database, Chrome 153).** Real lifecycle: draft-only preview; the same post archived through the UI and previewed (still the draft); a post published through the API, archived through the UI and previewed (the published revision). Persistence fixture (made last — it breaks the posts list on that database): over HTTPS the preview answers 404 problem+json; in the real Admin the post page opens, the dialog shows the shared 404 text, no article is drawn, nothing is written; no unexpected console errors. **UI_LIVE for C1: PASS for these items. The fixture state is not a UI lifecycle reproduction.**
- **What was NOT re-run.** The CP03 acceptance evidence above keeps its SHA labels exactly as written (items 1, 8, 10, 11, 13 and the five-page responsive sweep on `fa8acdc`/`00e65ff`; 2–7, 9 and the 390 px preview on `4eb1f3f`/`85bfa75`). C1 changes one guard in the preview service and tests; nothing in those flows is touched, so they were not repeated.
- **C2 (unchanged conclusion).** `using var srgb` is correct ownership; SkiaSharp 4.153.1's `CreateSrgb()` returns a shared instance whose `Dispose` is a no-op. No memory leak was measured and none is claimed.
- **Limits / NOT_RUN.** The review of C1 is `NOT_RUN`. The PostgreSQL 17.10 used here differs from CI's 18.3. The fault-injection claim of "UI 404 via a fault" was not needed: the fixture state was served by the real API. No blocker.

## Review of the correction (Owner invokes — not me)

READY_FOR_CODEX_REVIEW
Owner must now invoke:
/codex:review --base origin/develop

