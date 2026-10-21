# BHA-BLOG-001 — CP01 completion report

- **IMPLEMENTATION:** PASS for CP01 only (see "Not done" for what the module still lacks). **REVIEW:** NOT_RUN — the Owner invokes Codex.
- **Work item:** `BHA-BLOG-001` checkpoint **CP01** — content and publishing foundation (backend). The module is **not** complete: CP02–CP05 are not started.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (invoked by Owner only). The Master Execution Prompt states these in words ("Claude Code, người triển khai … Owner chủ động gọi Codex review"), not as the literal `IMPLEMENTER:` / `REVIEWER:` / `GRAPHIFY_POLICY` / stop-condition fields `AGENTS.md` §2.A lists; the mapping is unambiguous, so work proceeded and this is recorded rather than treated as `BLOCKED`. Graphify was not used (no `GRAPHIFY_POLICY`).
- **Branch:** `feature/bha-blog-001-cp01-content-publishing` (no earlier branch of that name or purpose existed).
- **BASE_SHA = START_HEAD:** `c7d559793d405e4eaad6b5e18804b36ebe5f57f3` = `origin/develop` after `git fetch --prune origin`; working tree clean. PR #125 (booking promotions) is in it, verified by content (`Promotion`, `PromotionManage`, `/offers`, ADR 0009), not by the word "latest".
- **Code head:** `35b11da9fd2d0b86f08cf80a8450aaa5964592df` (the commit that adds this report is documentation only).
- **Draft PR:** https://github.com/emLamHD/The_BHA_hotels_Booking/pull/126 (Draft, base `develop`).
- **Design and decisions:** `docs/design/BHA-BLOG-001-blog-content-publishing.md` (Owner-decided vs technical choices are labelled); `docs/ADR/0010-global-blog-edit-and-publish-permissions.md`; `docs/DATABASE.md` (migration 18).
- **UI_LIVE:** `NOT_APPLICABLE` (no UI changed).

## Governance notes

- The prompt allows "a separate worktree if the tree is dirty"; `AGENTS.md` §8 / `RULES.md` §5 forbid any extra checkout with no exception. The tree was clean, so it never came up; no worktree was created. The contradiction is recorded here for the Owner/OC.
- Nothing was merged, marked ready, deployed or rebased; no Codex command was run by the implementer.

## Done (map: already had → missing → changed)

| Area | Reused as it was | Added / changed |
|---|---|---|
| Staff RBAC | `StaffWebsitePermissionAttribute`, request boundary, DB-read global flags (ADR 0008), CLI verbs | `StaffGlobalPermission.BlogEdit` / `BlogPublish` / `BlogAccess`; columns `CanEditBlog` / `CanPublishBlog`; `--staff-blog-access`; `me`/login list the names |
| Media | `IHeroMediaStorage`, `LocalHeroMediaStorage`, `HeroImageInspector`, `WebsiteMedia:RootPath` | `BlogMedia` table, upload + staff read + gated public serving; key regex widened to `blog/` |
| Public caching | weak ETag + `no-cache` pattern of promotions | same pattern on every Blog read |
| Seeds / migrations | frozen idempotent seed class + `Down()` guard pattern | `BlogSeed`, migration 18 |
| Blog | only the static registry in Customer_Web (untouched) | everything below |

Backend: 13 tables, composite foreign keys and partial unique indexes (one draft, one live address, one primary category, a translation can only point at its own revisions), `RESTRICT` references (nothing a revision uses can be deleted), audit; `BlogBody` validator; `AdminBlogService` (posts, revisions, categories, pins, settings, media) and `WebsiteBlogService`; `AdminBlogController` (21 routes, every write a POST) and `WebsiteBlogController` (6 read routes).

## Technical decisions that matter (details in the design)

1. Publication per **translation** (not per post): `Version` is the concurrency token of every write on it, EF enforces the same token, so publish / unpublish / save / restore racing on one version leave exactly one winner.
2. Categories are part of the **revision**; pins are a live post–category placement (publish permission, audited, only effective while a published revision is in that category).
3. Old live slugs are redirects owned by the same translation (resolved to the *current* slug at read time → no chains/loops); a claimed address is never given to another post.
4. Body = versioned structured JSON, plain text only, links limited to internal paths and `https`, unknown fields refused.
5. Two global permission flags instead of a table (ADR 0010); upload and read need "edit or publish" so an editor can attach a cover to their own draft.
6. Cover + cover alt required to publish is **my** choice (home cards are picture cards), not an Owner rule; it is one check to relax.

## Checks run (real PostgreSQL 17, local container; databases created per run and dropped)

| Check | Command (from `Back_End/`) | Result |
|---|---|---|
| Restore + build | `dotnet build TheBha.Booking.sln --configuration Release` | 0 errors |
| Unit | `dotnet test TheBha.Booking.sln --configuration Release --no-build` | **651 / 651** (75 new for Blog) |
| Integration (full backend suite) | same command, `ConnectionStrings__TheBhaDatabase` → local PostgreSQL | **1221 / 1221** (55 new Blog tests; develop at the base commit ran 576 unit + 1166 integration; the pinned registries — migration lists/counts, Admin mutation paths — updated on purpose) |
| Migration | clean database `MigrateAsync`; `BlogMigrationTests`; `StaffIdentityMigrationTests` (V8 → latest, rollback refusals) | pass; model has no pending changes; `Down()` refuses with Blog content or permissions |
| Whitespace | `git diff --check` | clean |
| Frontend | not changed → not run | `NOT_RUN` (no Customer/Admin diff) |

Evidence → test (all in `BlogPublicationApiTests`, `BlogAuthorizationApiTests`, `BlogPublicReadApiTests`, `BlogCategoriesApiTests`, `BlogSchemaTests`, `BlogMigrationTests`, `BlogDomainTests`): (1) migration + constraints/unique/FK · (2) draft invisible → publish → exact version · (3) draft content / category / SEO / slug edits not public until publish, then change together · (4) unpublish / archive hide list, category, detail, section, media; history stays · (5) restore → new draft, replaced draft kept, public unchanged · (6) two writers on one version; publish vs unpublish vs update race; concurrent creates for one slug · (7) slug collision, retired slugs, redirects without chains, locale isolation, inactive/unknown language → 400 · (8) category source, pins by category, pagination, same-instant ties, no repeats · (9) 20 routes (+ the picture upload) × anonymous / customer / no flag / website-only / editor / publisher / both; revocation and disabling on the next request; LocalGate 404; Origin / JSON · (10) script text, bad links, raw HTML, external image URL, dangling media / category / property — all refused, nothing stored · (11) audit actor from the session (a body naming someone else is ignored); no internal field or Staff identity in any public payload · (12) the full existing backend suite (Staff, website, promotions, booking) passes.

Real defects found by these tests and fixed before the PR: two `HasIndex` on the same column silently merged into one (lost the "one draft per slug owner" index); an EF projection into a positional record that could not be translated; publishing an archived translation answering the wrong code; a JSON writer that threw while unwinding a refusal. See the worklog.

## Not done / limits (by design, each is a later checkpoint)

- CP02 media library & pipeline (multi-upload, variants, WebP/AVIF, focal point, credits, usage view, durable storage verification) — only single-file upload exists.
- CP03 Admin screens / editor / translations UI / private preview — the preview contract is in the design, nothing is built. CP04 Customer pages, homepage section from the API, CTA, cache. CP05 canonical / hreflang / Open Graph / JSON-LD / sitemap / robots, HTML acceptance. None of these exist yet; the Customer still shows its static registry.
- Category text per language is per revision (no cross-language consistency check); a category's language text cannot be removed; no category deactivation.
- Post and category creation are idempotent by client id only as "a repeat is refused (409)", not replayed.
- A hidden picture can stay in a shared cache ≤ 5 minutes (`public, max-age=300`); every JSON answer is revalidated.
- No production service, migration or deploy was touched.

## Next checkpoint

CP02 — media library and image pipeline (separate Draft PR). Owner to run when ready:

```
READY_FOR_CODEX_REVIEW
Owner must now invoke:
/codex:review --base origin/develop
```
