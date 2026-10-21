# BHA-BLOG-001 — Blog / Cẩm nang: content publishing foundation (CP01)

- Status: CP01 implemented on `feature/bha-blog-001-cp01-content-publishing` (Draft PR into `develop`). CP02–CP05 are not started.
- Base: `origin/develop` @ `c7d5597` (contains PR #125, booking promotions — verified by content: `Promotion`, `PromotionManage`, `/offers`).
- Reading guide: **[Owner]** = decided by the Owner in the Master Execution Prompt; **[Tech]** = a technical choice made here (reasoned, reversible before CP02).

## 1. What already exists / what is missing / what changes

| Area | Already in the repo | Missing | CP01 does |
|---|---|---|---|
| Customer blog | `/blog`, `/blog/[...slug]` read the static registry `data/travelPosts.ts` (6 destination guides, 5 news/sample posts, 2 categories). Home `HomeDestinationSection` = the registry's `diem-den-noi-bat` category (6 cards, "Xem thêm" → `/blog?category=diem-den-noi-bat`) | any backend, any Admin screen, real URLs/SEO | **nothing** (Customer is CP04). The public contract below replaces the registry there |
| Admin menu | `Website` group (languages, translations, currencies, menus, hero, social) | Blog entry | nothing (CP03) |
| Staff / RBAC | Property roles (ADR 0007), global `WebsiteSettingsManage` flag column (ADR 0008), `StaffWebsitePermissionAttribute` closes routes in LocalGate, audit actor from session | Blog edit vs publish | two global flags + CLI verb (ADR 0010) |
| Media | Hero/Promotion stack: `IHeroMediaStorage`, `LocalHeroMediaStorage`, `HeroImageInspector`, `WebsiteMedia:RootPath`, `/media/{id}` serving | blog media rows, "referenced by published content" gate | `BlogMedia` table + upload + gated public serving (library/variants/usage = CP02) |
| Localization | `WebsiteLanguages` (vi default; en/fr installed by operator), `WebsitePublicReader.Resolve` | strict (no-fallback) locale for content | strict locale resolution for Blog |
| Public cache | promotions: weak ETag + `Cache-Control: no-cache` (always revalidated) | — | same pattern |
| Sitemap/SEO | none for blog | everything | CP05; CP01 only exposes the data (dates, alternates, SEO fields) |

## 2. Model (publication = per translation, immutable revisions)

A **post** is only an identity. All content lives in **translations** (one per locale), and each translation has its **own** publication state. Content is stored in **revisions**; a revision that has been published (or superseded) is immutable. Everything the public sees — title, slug, summary, body, cover, SEO, **and the categories** — comes from one row, the published revision, so it can never be half old/half new.

```
BlogPosts(Id)                                   identity only (+ created audit)
 └ BlogPostTranslations(Id, PostId, Locale)     Status, Version (concurrency token), DraftRevisionId, PublishedRevisionId, FirstPublishedAtUtc
    └ BlogPostRevisions(Id, TranslationId, Number)   State Draft|Frozen, content + SEO, PublishedAtUtc?
        ├ BlogRevisionCategories(RevisionId, CategoryId, IsPrimary)   FK Restrict → a category in use cannot be deleted
        └ BlogRevisionMedia(RevisionId, MediaId)                      FK Restrict → usage tracking, an asset in use cannot be deleted
BlogCategories(Id, SystemKey?, SortOrder, Version)
 ├ BlogCategoryTranslations(CategoryId, Locale, Name, Slug, Description)
 ├ BlogCategorySlugs(Locale, Slug → CategoryId, IsCurrent)            slug history (301)
 └ BlogCategoryPins(CategoryId, PostId, Position)                      pin/order belongs to the post–category relation
BlogPostSlugs(Locale, Slug → TranslationId, State Draft|Current|Redirect)
BlogMedia(Id, StorageKey, …)    BlogSettings(1, HomeSectionCategoryId, Version)    BlogAudits(…)
```

- **Draft vs public [Owner]**: editing never touches the published revision. One mutable `Draft` revision per translation (partial unique index). `Publish` freezes the draft and points `PublishedRevisionId` at it in one transaction; the next edit clones the published revision into a new draft. **[Tech]** a draft is edited in place (no revision per keystroke); history = every published revision + every draft superseded by a restore.
- **Status** (per translation): `Draft` (never published) → `Published` ⇄ `Unpublished`; `Archived` from any; `Unarchive` returns to `Unpublished` (had a published revision) or `Draft`. Public sees only `Published`. No hard delete of posts **[Owner]**.
- **Classification is versioned content [Owner]**: categories (and which one is primary, for the breadcrumb) are rows of the revision, so changing categories in a draft does not move the public post until publish. **[Tech]** categories are therefore per locale-revision; the Admin normally sets the same set on every translation.
- **Pin/order [Owner]**: `BlogCategoryPins` is a (category, post) relation, not a site-wide flag. **[Tech]** pin order is a live editorial placement (publish permission, audited, category `Version`), applied immediately and only *effective* while a published revision of that post is in that category — so a draft cannot leak through it. Replaced as a whole list (`PUT …/pins`), max 50.
- **Locale [Owner]**: a translation exists only in a language the site has; reads are strict (no fallback, no mixing). `Locale` is the normalized `WebsiteLanguages.NormalizedCode`, validated against active languages on write (not an FK, so language management stays independent).
- **Dates [Owner]**: `FirstPublishedAtUtc` is set once (first publish; unpublish/republish keeps it). `modifiedAt` = `PublishedAtUtc` of the published revision (set when *that revision* went live). Draft saves, reads, restores, archive/unpublish never move either.
- **Concurrency [Owner]**: every operation on a translation carries `expectedVersion` and bumps `Version`; EF also enforces it as a concurrency token, so two writers on the same version cannot both win (publish/update/unpublish/archive/restore included) → `409 blog.stale-version`. Categories, pins and settings have their own `Version`.
- **Slug ownership [Owner]**: `BlogPostSlugs` is unique on `(Locale, Slug)` in the database. States: `Draft` (reserved by a not-yet-published draft; at most one per translation), `Current` (the live slug; at most one), `Redirect` (an old live slug, owned by the same translation forever → 301 to the current one). A claimed slug is never given to another post (no hijacking of old URLs). A redirect always points at the translation's *current* slug (resolved at read time), so there are no chains or loops. Reserved words (`category`, `page`, `tag`, `feed`, `rss`, `search`, `preview`, `sitemap`) are refused. Slugs are ASCII `[a-z0-9-]`, 2–120.
- **URL plan (for CP04/CP05)**: post `/blog/{slug}` (independent of any category), category `/blog/category/{slug}`; locale prefix per the existing i18n routing.
- **Featured destinations [Owner]**: category with `SystemKey = 'featured-destinations'` seeded **idempotently by the migration** (stable Guid; vi name `Điểm đến nổi bật`, and en/fr if those languages exist when it runs — the texts already in the packs). `BlogSettings.HomeSectionCategoryId` links the home section to it by **ID**; renaming it changes nothing. The category is seeded empty: no posts, figures or pictures.
- **Media [Tech]**: `BlogMedia` mirrors `PromotionMedia` (key `blog/<32 hex>.<ext>`, hero storage and inspector). Revisions reference media by id only (cover, OG image, body images) → `BlogRevisionMedia`; the public model never carries arbitrary URLs. Public file serving is gated: an asset is served only while a **published** revision of a **published** translation uses it. Alt text belongs to the usage (cover alt, image-block alt) and therefore to the revision's locale.

## 3. Body format (editor contract for CP03) [Tech]

Structured JSON, not HTML: `{"schemaVersion":1,"blocks":[…]}`, validated and re-serialized by the server (unknown fields/types are refused, nothing is copied through). Rendering is by the template (no raw HTML anywhere → no script injection surface).

| Block | Fields |
|---|---|
| `heading` | `level` 2–4 (**H1 is the template's**), `text` |
| `paragraph` | `inlines` |
| `list` | `ordered`, `items` (each: inlines) |
| `quote` | `inlines`, optional `cite` |
| `image` | `mediaId`, `alt`, optional `caption` |
| `gallery` | `items`: `{mediaId, alt, caption?}` (2–12) |
| `toc` | — (built from headings by the template) |
| `propertyIntro` | `propertyId` (an existing Property; no price/availability is stored) |

Inline: `{"text":…, "bold"?, "italic"?, "href"?}`. `href` is an internal path (`/…`, not `//`) or `https://…`; `javascript:`, `data:`, `http:`, protocol-relative and control characters are refused. Limits: ≤ 400 blocks, text ≤ 5 000 per node, body ≤ 200 000 bytes.

## 4. Permissions [Owner/Tech] (ADR 0010)

Blog content is brand-wide, so it uses **global** Staff permissions (no Property role grants it, a Manager of any Property gets nothing). Two flag columns on the Staff account, set only by the operator CLI (`--staff-blog-access --email … [--edit true|false] [--publish true|false]`), read from the database on every request:

| Permission | Allows |
|---|---|
| `BlogEdit` | list/read posts, create posts and translations, save drafts, restore a revision to draft |
| `BlogPublish` | publish, unpublish, archive, unarchive; create/update/delete categories; set pins; blog settings; upload media; **read** (it implies being able to see what it publishes) |
| read | `BlogEdit` or `BlogPublish` |

Edit does not imply publish **[Owner]**. Routes use `StaffWebsitePermissionAttribute`: HTTPS only, Staff session (401), permission (403), Origin + JSON boundary on writes, `Cache-Control: no-store`, closed (404) in `LocalGate`. The audit actor is the session's Staff id, never a body field. `me`/login report the names (`BlogEdit`, `BlogPublish`) for display only.

## 5. Admin API (`api/admin/v1/website/blog`) — all `application/json`, errors `ProblemDetails` with `code`/`field`

| Route | Perm | Notes |
|---|---|---|
| `GET settings` / `PUT settings` | read / publish | `homeSectionCategoryId`, `version` |
| `GET categories` | read | with per-locale texts, `inUse` counts, `version` |
| `POST categories` | publish | client `id` (Guid), `translations{locale:{name,slug,description}}`, `sortOrder` |
| `PUT categories/{id}` | publish | `expectedVersion`; upsert translations (a locale is never removed); slug change keeps the old as redirect |
| `DELETE categories/{id}` | publish | refused `blog.category-in-use` if any revision, pin or the section references it |
| `GET categories/{id}/pins` / `PUT categories/{id}/pins` | read / publish | `expectedVersion`, ordered `postIds`; each must be published in the category |
| `GET posts?search&categoryId&status&locale&page&pageSize` | read | one row per post with a per-locale summary (status, title, slug, version, `hasDraft`, updatedAt/by) |
| `GET posts/{id}` | read | per locale: status, version, `draft` and `published` revisions in full, firstPublishedAt, who/when |
| `POST posts` | edit | client `id` (Guid; a repeat of an existing id → 409 `blog.duplicate-id`), first translation (locale + draft content) |
| `PUT posts/{id}/translations/{locale}/draft` | edit | full draft; `expectedVersion` (0 creates the translation); incomplete allowed, malformed never |
| `POST …/{locale}/publish` · `unpublish` · `archive` · `unarchive` | publish | `{expectedVersion}`; publish validates completely |
| `GET …/{locale}/revisions` · `GET …/revisions/{revisionId}` | read | history, full content |
| `POST …/{locale}/revisions/{revisionId}/restore` | edit | `{expectedVersion}`; creates/replaces the **draft** (a replaced draft is kept as a frozen revision); the public version is untouched; a slug that is no longer available is cleared |
| `POST media` (multipart `file`) · `GET media/{id}` | publish · read | CP02 extends |

**Publish validation** (first failure, `400` + `code`/`field`): title, valid and available slug, summary, non-empty body, ≥ 1 category (a primary one when several), every category has a text **in this locale**, cover picture + cover alt, every referenced media/property exists, SEO limits. Draft saving validates only what could be unsafe or malformed (shapes, URLs, ids, lengths).

**Preview (contract for CP03, nothing built)**: a Staff-only `GET …/translations/{locale}/preview` returning the draft in the *public detail shape*, `no-store`, never reachable without a session.

## 6. Public API (`api/v1/website/blog`) — read only, no auth, no Staff ids, no drafts/revisions/audit

`locale` is optional (default language); an unknown/inactive language → `400 blog.locale-unsupported`. There is no language fallback.

| Route | Result |
|---|---|
| `GET posts?locale&category=<slug>&page&pageSize` | published posts, `pageSize` 1–50 (default 12). With `category`: **pinned first (by position), then newest `firstPublishedAt`**; always tie-broken by translation id → total order, one row per post, no duplicates across pages |
| `GET posts/{slug}?locale` | `200` detail · `301` + `Location` + `{slug}` when the slug is an old live slug of a published post · `404` otherwise (draft, unpublished, archived, other locale) |
| `GET categories?locale` | categories with ≥ 1 published post in the locale (+ `postCount`) |
| `GET categories/{slug}?locale` | category texts (`404` if it has no text in the locale; `301` for an old slug) |
| `GET home-section?locale` | the settings' category (by id) + up to 6 posts (`limit` ≤ 12) in category order; `items: []` ⇒ the Customer hides the section |
| `GET media/{id}` | the file, only while a published revision of a published translation uses it |

List item: `id, slug, title, summary, cover{url,alt,width,height}, author, firstPublishedAt, modifiedAt, primaryCategory{slug,name}, categories[]`. Detail adds `body` (the validated JSON), `media{id→{url,width,height}}`, `properties{id→{slug,name}}`, `seo{metaTitle,metaDescription,ogImage}`, `alternates[{locale,slug}]` (other **published** translations only), `breadcrumb` (primary category). Cache: weak `ETag` + `Cache-Control: no-cache` (always revalidated → an unpublish is visible on the next request, tested); media `public, max-age=300` (a hidden picture can linger in a shared cache ≤ 5 minutes).

## 7. Checkpoints

| CP | Scope | Acceptance (summary) |
|---|---|---|
| **CP01** (this) | this document, schema + migration + seed, domain rules, body validator, Admin + public API, permissions/CLI, audit, tests on real PostgreSQL | see the completion report |
| CP02 | media library & pipeline: multi-upload with per-file errors, search/re-pick, variants + WebP/AVIF where supported, focal point, caption/credit/licence, usage view, durable storage check | uploads survive restart/deploy per environment config; referenced assets undeletable |
| CP03 | Admin Blog screens (posts, categories, library, settings), editor for §3, translations, preview, conflict UI, workflow | browser acceptance with the real API |
| CP04 | Customer `/blog`, category, article, home section from the category, CTA to the real Property, cache | HTML contains content + metadata; unpublish disappears within the verified window |
| CP05 | canonical, hreflang, Open Graph, `BlogPosting`/breadcrumb JSON-LD, sitemap + lastmod, redirects, robots, end-to-end acceptance | crawl of the real HTML |

Out of scope for the whole first wave: scheduled publishing, personalization, public comments, tour tools, analytics, multi-level approval, bulk generated content, page builder.

## 8. Known limits (CP01)

- Category classification is per locale revision (§2); there is no cross-locale consistency check.
- A category's translation cannot be removed, only edited.
- Post creation is idempotent by client id only in the sense that a repeat is refused (409), not replayed.
- Media: one file per upload call, no variants, no WebP/AVIF conversion, no per-asset metadata (CP02).
- `propertyIntro` stores a Property id; the public detail resolves slug and name at read time and drops a block whose Property is no longer public.
