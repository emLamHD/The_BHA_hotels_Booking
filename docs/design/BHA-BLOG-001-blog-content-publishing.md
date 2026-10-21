# BHA-BLOG-001 — Blog / Cẩm nang: content publishing foundation (CP01)

- Status: CP01 implemented and merged (PR #126; migration 18 `AddBlogFoundation`, ADR 0010). **CP02 (picture library and pipeline) implemented on `feature/bha-blog-001-cp02-media-library-pipeline`** (Draft PR into `develop`; migration 19 `AddBlogMediaLibrary`); its contract as built is **§9**, and §1–§8 below keep the CP01 text with the CP02 changes marked. CP03–CP05 are not started. Section 5 and 6 list the routes exactly as implemented.
- Base: `origin/develop` @ `c7d5597` (contains PR #125, booking promotions — verified by content: `Promotion`, `PromotionManage`, `/offers`).
- Reading guide: **[Owner]** = decided by the Owner in the Master Execution Prompt; **[Tech]** = a technical choice made here (reasoned, reversible before CP02).

## 1. What already exists / what is missing / what changes

| Area | Already in the repo | Missing | CP01 does |
|---|---|---|---|
| Customer blog | `/blog`, `/blog/[...slug]` read the static registry `data/travelPosts.ts` (6 destination guides, 5 news/sample posts, 2 categories). Home `HomeDestinationSection` = the registry's `diem-den-noi-bat` category (6 cards, "Xem thêm" → `/blog?category=diem-den-noi-bat`) | any backend, any Admin screen, real URLs/SEO | **nothing** (Customer is CP04). The public contract below replaces the registry there |
| Admin menu | `Website` group (languages, translations, currencies, menus, hero, social) | Blog entry | nothing (CP03) |
| Staff / RBAC | Property roles (ADR 0007), global `WebsiteSettingsManage` flag column (ADR 0008), `StaffWebsitePermissionAttribute` closes routes in LocalGate, audit actor from session | Blog edit vs publish | two global flags + CLI verb (ADR 0010) |
| Media | Hero/Promotion stack: `IHeroMediaStorage`, `LocalHeroMediaStorage`, `HeroImageInspector`, `WebsiteMedia:RootPath`, `/media/{id}` serving | blog media rows, "referenced by published content" gate | CP01: `BlogMedia` table + upload + gated public serving. **CP02: library, metadata, variants, usage, guarded delete (§9)** |
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
- **Concurrency [Owner]**: every operation on a translation carries `expectedVersion` and bumps `Version`; EF also enforces it as a concurrency token, so two writers on the same version cannot both win (publish/update/unpublish/archive/restore included) → `409 blog.stale-version`. **[Tech]** every write on a translation starts by reading it with `SELECT … FOR UPDATE` inside its transaction: concurrent writers queue on that row, the second one sees the committed result and is refused cleanly, and no two transactions take the translation and its revision in opposite orders (a deadlock or serialization failure, should one ever happen, is also answered `409`, never `500`). Categories, pins and settings have their own `Version`.
- **Slug ownership [Owner]**: `BlogPostSlugs` is unique on `(Locale, Slug)` in the database. States: `Draft` (reserved by a not-yet-published draft; at most one per translation), `Current` (the live slug; at most one), `Redirect` (an old live slug, owned by the same translation forever → 301 to the current one). A claimed slug is never given to another post (no hijacking of old URLs). A redirect always points at the translation's *current* slug (resolved at read time), so there are no chains or loops. Reserved words (`category`, `page`, `tag`, `feed`, `rss`, `search`, `preview`, `sitemap`) are refused. Slugs are ASCII `[a-z0-9-]`, 2–120.
- **URL plan (for CP04/CP05)**: post `/blog/{slug}` (independent of any category), category `/blog/category/{slug}`; locale prefix per the existing i18n routing.
- **Featured destinations [Owner]**: category with `SystemKey = 'featured-destinations'` seeded **idempotently by the migration** (stable Guid; vi name `Điểm đến nổi bật`, and en/fr if those languages exist when it runs — the texts already in the packs). `BlogSettings.HomeSectionCategoryId` links the home section to it by **ID**; renaming it changes nothing. The category is seeded empty: no posts, figures or pictures.
- **Media [Tech]** (CP02 extends this: §9): `BlogMedia` mirrors `PromotionMedia` (key `blog/<32 hex>.<ext>`, hero storage and inspector). Revisions reference media by id only (cover, OG image, body images) → `BlogRevisionMedia`; the public model never carries arbitrary URLs. Public file serving is gated: an asset is served only while a **published** revision of a **published** translation uses it. Alt text belongs to the usage (cover alt, image-block alt) and therefore to the revision's locale.

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

Every text field (title, summary, alt, caption, author, SEO, category texts, and every text node of the body) is **plain text**: no control characters and no `<` or `>` (the same rule as the hero texts), so no text can ever be read as markup; quotes and ampersands are data. The author is a text the editor writes, never read from the Staff account.

## 4. Permissions [Owner/Tech] (ADR 0010)

Blog content is brand-wide, so it uses **global** Staff permissions (no Property role grants it, a Manager of any Property gets nothing). Two flag columns on the Staff account, set only by the operator CLI (`--staff-blog-access --email … --edit true|false --publish true|false`; both always stated, anything but `true`/`false` refused), read from the database on every request:

| Permission | Allows |
|---|---|
| `BlogEdit` | create posts and translations, save drafts, restore a revision to a draft |
| `BlogPublish` | publish, unpublish, archive, unarchive; create/update/delete categories; set pins; Blog settings |
| `BlogAccess` (= `BlogEdit` **or** `BlogPublish`) | read the whole Admin; upload pictures (single and bulk) and read the picture library, its detail, usage and previews (so an editor can attach a cover to their own draft). Evaluated in the evaluator as its own enum value; the route attribute is unchanged |

CP02 adds no permission: a picture's name, description, credit, source, licence and focal point are written with **`BlogEdit`**; deleting an unused picture needs **`BlogPublish`** (it removes files that published history could have needed, so it sits with the publish-side structural actions). No Property role gives any of it.

Edit does not imply publish **[Owner]**. Routes use `StaffWebsitePermissionAttribute`: HTTPS only, Staff session (401), permission (403), Origin + JSON boundary on writes, `Cache-Control: no-store`, closed (404) in `LocalGate`. The audit actor is the session's Staff id, never a body field. `me`/login report the names (`BlogEdit`, `BlogPublish`) for display only.

## 5. Admin API (`api/admin/v1/website/blog`) — `application/json`, every write is a `POST` (like the other website routes), errors are `ProblemDetails` with `code`/`field`

| Route | Perm | Notes |
|---|---|---|
| `GET settings` · `POST settings/save` | access · publish | `homeSectionCategoryId`, `expectedVersion` |
| `GET categories` | access | per-locale texts, `revisionCount` / `pinCount` (what refers to it), `isHomeSection`, `version` |
| `POST categories` | publish | client `id` (Guid; a repeat → 409 `blog.duplicate-id`), `sortOrder`, `translations{locale:{name,slug,description}}` |
| `POST categories/{id}/save` | publish | `expectedVersion`; upserts the given languages (a language is never removed); a changed slug keeps the old one as a redirect the category owns |
| `POST categories/{id}/delete` | publish | `204`; `409 blog.category-in-use` if any revision (published, draft or past), any pin or the section refers to it |
| `GET categories/{id}/pins` · `POST categories/{id}/pins/save` | access · publish | `expectedVersion`, ordered `postIds` (replaces the list, ≤ 50, no duplicates); a **new** pin needs a post published in that category; `effective` reports whether a pin currently counts |
| `GET posts?q&categoryId&status&locale&page&pageSize` | access | one row per post with a summary per language; a post matches a filter when any of its translations does (`locale` narrows both) |
| `GET posts/{id}` | access | per language: `status`, `version`, `hasDraft`, `draft` and `published` revisions in full, `firstPublishedAtUtc`, who/when |
| `POST posts` | edit | client `id`, `locale`, `draft` (a title is required to start); a repeat id → 409 `blog.duplicate-id` |
| `POST posts/{id}/translations/{locale}/draft` | edit | `expectedVersion` (**0 creates the translation**), `draft`; incomplete allowed, malformed or dangling never |
| `POST …/{locale}/publish` · `unpublish` · `archive` · `unarchive` | publish | `{expectedVersion}`; publish validates fully; publish with no draft on an `Unpublished` translation re-publishes the last published revision unchanged (dates do not move) |
| `GET …/{locale}/revisions` · `GET …/revisions/{revisionId}` | access | history (newest first, `isDraft`, `isPublished`) and full content |
| `POST …/{locale}/revisions/{revisionId}/restore` | edit | `{expectedVersion}`; creates the **draft**; a draft it replaces is kept as a frozen revision; the public version is untouched; a slug since given to another page is cleared |
| `POST media` (multipart `file`) · `GET media/{id}` | access | one picture per call (PNG/JPEG/WebP by content, ≤ 10 MB, ≥ 600×400). **CP02:** same route and same answer plus additive fields; `GET media/{id}` is now `no-store`. The rest of the library routes are in §9.4 |

**Publish validation** (first failure, `400` + `code`/`field`; the cover and cover-alt requirements are a **[Tech]** choice because the home cards are picture cards — relaxable in one place): title, valid slug, summary, a body with text, every body picture has alt text, ≥ 1 category (a main one when several), every category has a text **in this locale**, a cover picture and its alt. Media and Property references are checked at save time too, so a dangling id never gets stored. Draft saving validates only what could be unsafe or malformed (shapes, URLs, ids, lengths).

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
| `GET media/{id}` | **CP02:** the article-size fallback (JPEG, or PNG when the picture has transparency) of a processed picture, or the original of a picture from before CP02; only while a published revision of a published translation uses it (cover, OG image or a body picture). The sized variants are at `GET media/{id}/{generation}/{preset}.{format}` (§9.7) |

List item: `id, slug, title, summary, cover{url,alt,width,height}, author, firstPublishedAt, modifiedAt, primaryCategory{slug,name}, categories[]`. Detail adds `body` (the validated JSON), `media{id→{url,width,height}}`, `properties{id→{slug,name}}`, `seo{metaTitle,metaDescription,ogImageUrl}`, `alternates[{locale,slug}]` (other **published** translations only). Every payload carries `contentHash` (what the `ETag` is made from; it is not a revision id). Cache: weak `ETag` + `Cache-Control: no-cache` (always revalidated → an unpublish is visible on the next request, tested; `304` when unchanged); media `public, max-age=300` (a hidden picture can linger in a shared cache ≤ 5 minutes).

## 7. Checkpoints

| CP | Scope | Acceptance (summary) |
|---|---|---|
| **CP01** (this) | this document, schema + migration + seed, domain rules, body validator, Admin + public API, permissions/CLI, audit, tests on real PostgreSQL | see the completion report |
| CP02 (**implemented**, §9) | media library & pipeline: multi-upload with per-file errors, search/re-pick, variants + WebP (AVIF not available), focal point, caption/credit/licence, usage view, durable storage check | uploads survive restart/deploy per environment config; referenced assets undeletable |
| CP03 | Admin Blog screens (posts, categories, library, settings), editor for §3, translations, preview, conflict UI, workflow | browser acceptance with the real API |
| CP04 | Customer `/blog`, category, article, home section from the category, CTA to the real Property, cache | HTML contains content + metadata; unpublish disappears within the verified window |
| CP05 | canonical, hreflang, Open Graph, `BlogPosting`/breadcrumb JSON-LD, sitemap + lastmod, redirects, robots, end-to-end acceptance | crawl of the real HTML |

Out of scope for the whole first wave: scheduled publishing, personalization, public comments, tour tools, analytics, multi-level approval, bulk generated content, page builder.

## 8. Known limits (CP01)

- Category classification is per locale revision (§2); there is no cross-locale consistency check.
- A category's translation cannot be removed, only edited; there is no category deactivation (delete only when nothing refers to it).
- The seed gives the featured category a text for the languages that exist when the migration runs; a language installed later has none until an editor adds it (publishing in that language is refused until then, `blog.category-locale-missing`).
- The public detail resolves a Property's `slug` and `name` as stored (not localized); CP04 may use the content dictionary.
- Post and category creation are idempotent by client id only in the sense that a repeat is refused (409 `blog.duplicate-id`), not replayed.
- Media (CP01 text; **resolved by CP02**, see §9): one file per upload call, no variants, no WebP/AVIF conversion, no per-asset metadata. The CP02 limits that remain are in §9.12.
- `propertyIntro` stores a Property id; the public detail resolves slug and name at read time and drops a block whose Property is no longer public.

## 9. CP02 — picture library and pipeline (as built)

Reading guide as above. Source of truth for behaviour is the code and `BlogMedia*Tests`; this section is the contract CP03 (Admin screens) and CP04 (Customer) build on.

### 9.1 A picture is not a use of a picture

| | Lives in | Examples | Changed by |
|---|---|---|---|
| **The asset** | `BlogMedia` (+ `BlogMediaVariants`) | name, original file name, description (the default caption the editor may offer), credit, source (https address), licence note, **focal point** (x, y in 0..1, default 0.5/0.5), size, type, hash, generation | `BlogEdit` through `media/{id}/save`, against `Version` |
| **A use** | the **revision** (and so its locale) | cover alt, image-block alt and caption, gallery item alt and caption, which picture is the cover / OG image | the draft, through the post routes |

Editing the asset never touches a revision, a translation's `Version`, publication or any date, and what it changes is not in the public JSON (so no public `contentHash`/`ETag` moves; tested). **Per-language alt/caption suggestions are not stored** (the prompt made them optional); `description` is the only default text. Alt text stays per use and per locale.

**Open decision for OC (§9.13): the focal point and the credit are not in the public JSON.** They are written under `BlogEdit`; if the public answer carried them live, an editor's change would go public without `BlogPublish` and break "edit does not publish" (ADR 0010). CP04 needs one of: a snapshot taken into the revision at publish (the safe one, needs a column or a body field), or a reading of the live asset by a publisher-approved rule. CP02 only guarantees the data exists and is versioned.

### 9.2 Storage, variants, generation

All files are under `WebsiteMedia:RootPath` (the same storage abstraction as Hero/Promotion; the key shape `blog/<32 hex>.<jpg|png|webp>` and its check constraint are unchanged, so nothing shared changed). Every file written by CP02 has a **fresh random key** and a key is **never reused**:

- the **original** (private; only the Admin routes serve it; for a picture from before CP02 it is also what the plain public address serves, §9.8);
- the **variants**, one row each in `BlogMediaVariants(MediaId, Preset, Format, StorageKey, Width, Height, ByteSize, Sha256)`, unique per `(MediaId, Preset, Format)`.

| Preset | Longest allowed width | Notes |
|---|---|---|
| `thumb` | 320 | library grid, cards in lists |
| `card` | 640 | home / category cards |
| `article` | 1280 | article cover and body pictures |

A picture narrower than a preset **keeps its own width** (nothing is enlarged); the ratio is kept (±1 px rounding). Every preset is written as **WebP** (lossy, quality 82) and as a **fallback**: JPEG (quality 85) or, when the picture has at least one transparent pixel, **PNG** (WebP also keeps the alpha). The picture is decoded for real, converted to sRGB, turned by its EXIF orientation (the stored `Width`/`Height` are the **shown** size, so a portrait photo saved sideways is portrait) and written without any metadata: no EXIF, no GPS, no ICC. `Generation` (on the asset) is part of every public variant address: **0** = uploaded before CP02 (original only), **1** = this pipeline. A future change of presets writes new rows and files and a new generation; bytes under an address never change.

**Order of a write (files first):** the original and every variant are written (atomic temp-file-then-rename each), then the row and its variants are inserted in **one transaction**. So a row that exists always has all its files, and a picture is complete or absent. If anything fails before the commit the files written for it are deleted. A file is deleted after a failure **only when the database is known not to have the row**: when the commit's outcome is unknown (lost acknowledgement, connection dropped) the files are kept (tested). A crash leaves at most orphan files; `--blog-media-maintain` finds them (§9.9).

### 9.3 Limits (published)

| Limit | Value | Where it is decided |
|---|---|---|
| Types | PNG, JPEG, still WebP — by decoding, never by extension or client type; animated, SVG, executables, anything else refused | container check (`HeroImageInspector`, unchanged) then a real Skia decode |
| One file | 10 MB; ≥ 600×400 (CP01's Blog minimum, on the stored size); ≤ 8000 px a side; ≤ 40 megapixels | unchanged from CP01 |
| Decoded memory | width × height × 4 bytes (≤ 160 MB at the limit) per picture; **at most 2 decodes at once per process** → ≤ 320 MB plus the small presets | `BlogMediaLimits.MaxConcurrentDecodes` |
| Bulk | ≤ 10 pictures and ≤ 50 MB in all, refused **before** any picture is processed; the pictures are then taken in one after another | controller |
| Page size | library list ≤ 50 (default 24) | |

The multipart body is read by ASP.NET before the action (above 64 KB it is spooled to disk, not held in memory), which is why the total budget can be refused up front.

### 9.4 Admin API additions (`api/admin/v1/website/blog`)

| Route | Perm | Notes |
|---|---|---|
| `GET media?q&usage&page&pageSize` | access | newest first with a total tie-break (stable pages, no repeats); `q` searches name, file name, credit, description (any case; `%` and `_` are plain letters); `usage=used|unused`; only complete pictures exist, so no broken row is ever listed |
| `POST media` (multipart `file`, optional `id`) | access | as CP01 plus additive fields. `id` (Guid) becomes the picture's id; a repeat is `409 blog.duplicate-id` |
| `POST media/bulk` (multipart `files`, optional `ids` in the same order) | access | `200` with `{items:[{index, fileName, id, media?, error?}], succeeded, failed}`; a bad file does not undo the others. `400 blog.media-batch-invalid` (none, > 10, `ids` not one distinct Guid per file); `413`/`400` when over 50 MB. (Named `bulk`, not `batch`: an existing Calendar contract test refuses any path containing "batch".) |
| `GET media/{id}/detail` | access | the picture with `pipeline` (`current` or `legacy`), `variants`, `originalSha256`, `usage` counts (all revisions, live, open drafts), `version` |
| `GET media/{id}/usage` | access | up to 100 uses: post, locale, post status, title, revision (number, `Draft`/`Frozen`), `isPublished`, `kinds` (`cover`, `og`, `body`); `total` and `truncated` |
| `POST media/{id}/save` | edit | `expectedVersion`, `displayName`, `description`, `credit`, `sourceUrl`, `licence`, `focalX`, `focalY` (all replaced); `409 blog.stale-version` |
| `POST media/{id}/delete` | publish | `expectedVersion`; `204`; `409 blog.media-in-use` while any revision (draft, live, past; also of unpublished/archived articles) uses it |
| `GET media/{id}` | access | the original, `no-store` (was `private, max-age=3600` in CP01) |
| `GET media/{id}/preview/{thumb\|card\|article}` | access | the WebP of that size (the original for a picture not yet processed), `no-store` |

Errors keep the Blog shape (`ProblemDetails` with `code` and `field`). File problems keep the CP01 codes: `hero-image-empty`, `-too-large`, `-unsupported`, `-corrupt`, `-dimensions`; `blog.storage-not-configured` (409); new: `blog.media-in-use` (409), `blog.media-batch-invalid` (400), `blog.media-processing-failed` (a file of a bulk request that could not be stored; the single route answers 500). A save that names a picture deleted meanwhile is `400 blog.media-missing`.

**Usage is read from `BlogRevisionMedia`** (the foreign-key table CP01 already maintains for every revision) and the kind from the revision's own `CoverMediaId`/`OgImageMediaId` plus a structural read of its body — never a search of JSON text. Nothing in the schema had to change for it.

### 9.5 Deleting, and the race with writers that start using a picture

`delete` takes the picture's row `FOR UPDATE`, counts its uses, and removes the row (variants cascade) in one transaction; the files are removed after the commit. A save, create or restore that is adding a use of the picture holds a key-share lock on the row through its foreign key, so the two are **ordered by PostgreSQL**: if the use is committed first the delete sees it (`409 blog.media-in-use`); if the delete wins, the writer's foreign key refuses and the answer is `400 blog.media-missing`. Never a `500`, never a dangling use, and the translation-first lock order of CP01 is not touched (delete takes no translation lock). Both orders are tested deterministically with real locks, plus a concurrent run. Publish and restore cannot start a *new* use of an unused picture (they re-use rows that already hold the reference), so the only racing writers are save and create. If removing a file fails after the commit, the row is already gone, so nothing can refer to the file: it is an orphan for the maintenance command.

There is deliberately **no "hide" and no "replace bytes"**: hiding would not stop serving a live picture, and replacing bytes under a used picture would rewrite published history.

### 9.6 Retry and cancellation (what is promised)

There is no idempotent upload and nothing is retried by the server. What a client gets instead: it may send an `id` per picture; after a timeout or a disconnect it reads `GET media/{id}/detail` (200 = it arrived complete, 404 = it did not) and re-sends the same `id` only if 404; a re-send of an `id` that exists is `409 blog.duplicate-id`, never a second copy. A bulk request that is cancelled stops between pictures; pictures already taken in stay complete (row + all files); the one in progress leaves nothing (its files are deleted, its row never commits). The answer of a cancelled request is lost, so the client reads the library. Exactly-once is **not** claimed.

### 9.7 Serving, publication gate and cache

| Address | Who | Result |
|---|---|---|
| `GET api/v1/website/blog/media/{id}` | anyone | only while a published revision of a published translation uses the picture: the article-size fallback of a processed picture, the original of a legacy one; otherwise `404` |
| `GET api/v1/website/blog/media/{id}/{generation}/{preset}.{format}` | anyone | the variant at that exact address (`generation` = the picture's current one, preset ∈ thumb/card/article, format ∈ webp/jpg/png and it must exist); otherwise `404` |
| every Admin media route | Staff | `no-store` |

The gate is evaluated **on every request before any byte, redirect or 304**. The media routes send no `ETag` and no `Last-Modified`, so a conditional request (`If-None-Match`, `If-Modified-Since`) is a plain request: a `200` while published and a `404` the moment the article is unpublished, archived or no longer uses the picture. A picture used only by a draft or only by history is never public, even if its address is guessed. No other route serves a Blog picture (the hero and promotion routes look in their own tables; there is no static-file serving of the media root) and the private original of a processed picture has no public address.

**Cache.** Pictures: `Cache-Control: public, max-age=300` — exactly the 300 s CP01 accepted: a picture that stops being public can remain in a valid shared/browser cache for at most 300 s after its last validation; **no `stale-while-revalidate`, no `stale-if-error`, no `immutable`**; origin requests after an unpublish are refused at once. Public JSON stays `no-cache` + weak `ETag` (always revalidated); its `contentHash` is computed from the whole answer, so it changes when the variants, sizes or alt text it carries change (also when the backfill adds variants). Nothing can be purged in a user's cache; nothing promises it.

Public DTO additions (additive): `cover.variants[]` and `media[id].variants[]` — `{preset, format, type, url, width, height}` ordered thumb→article, WebP before the fallback. For a processed picture `url`/`width`/`height` describe what the plain address serves (the article-size fallback); for a legacy one they are the original's. Not in the public answer: focal point, credit, source, licence, description, file name, hash, storage key or path, Staff id.

### 9.8 CP01 pictures (compatibility and the one honest gap)

Migration 19 keeps every CP01 picture's id, key and references and gives it: `DisplayName` = `Picture <first 8 of id>`, focal 0.5/0.5, `Version` 1, `Generation` 0, no hash, no variants. Its public plain address, article JSON and Admin routes work as in CP01 (no 404 because of the upgrade). **Until the backfill runs, a legacy picture is still served as its original** — which can carry EXIF/GPS as it always could in CP01. The backfill (§9.9) is therefore a **required step of the deploy that brings CP02** to any environment that already has Blog pictures; CP01 was merged on 2026-10-21 with an empty Blog, so in practice there is nothing to backfill unless pictures were uploaded since.

### 9.9 Operator command (backfill and orphan files)

`dotnet TheBha.Api.dll --blog-media-maintain --expected-database NAME [--grace-minutes N] (--dry-run | --apply)` (from source: `dotnet run --project Back_End/src/TheBha.Api -- …`). Any environment; the operator names the database and it must equal `current_database()` (exit 3 otherwise); neither or both of `--dry-run`/`--apply` is exit 2. It (1) gives every generation-0 picture its variants — the original is read, decoded, processed, variants written, then one transaction sets generation, hash, shown size and the variant rows (descriptive fields and `Version` untouched; the original is never modified); a dry run does everything but write, so it shows what would be refused; (2) lists — and with `--apply` deletes — files in `blog/` that no row refers to **and are older than the grace period** (default 60 min; an upload in progress has its files before its row), plus half-written `*.tmp` files left by a killed process; files that are not ours are never touched. Safe to run again. Exit 0, 4 when it reports a `PROBLEM` (e.g. an original that is missing from storage), 1 on a failure. It writes no audit row (the audit needs a Staff id); its output is the record.

### 9.10 Capability matrix

| | Supported | Evidence |
|---|---|---|
| Input | PNG, JPEG, static WebP | container check + decode (`BlogImagePipelineTests`, `BlogMediaLibraryApiTests`) |
| Output | WebP (all presets) · JPEG fallback · PNG fallback only for real transparency | decoded again in tests; magic bytes checked |
| **AVIF** | **No.** `SKImage.Encode(Avif)` returns `null` in the SkiaSharp 4.153.1 build the API ships; no `.avif` file or address exists; the key constraints do not allow it | `AVIF_is_not_offered_and_the_bundled_encoder_really_cannot_write_it` fails if this ever changes, so enabling AVIF is a deliberate decision (key regex + constraint + format list) |
| Orientation | EXIF 1–8 | `Every_exif_orientation_is_applied…` (8 cases, marker corner checked) |
| Metadata in output | none (no EXIF/GPS/ICC) | `No_variant_carries_exif_or_gps` and the same over HTTP |
| Library / dependency | SkiaSharp 4.153.1 (MIT), already shipped; `SkiaSharp.NativeAssets.Linux.NoDependencies` (no system packages) | no dependency added |

### 9.11 Backup and restore

The database (`BlogMedia`, `BlogMediaVariants`) and the media directory are one unit: back up and restore them **together**. `BlogMedia.OriginalSha256` and `BlogMediaVariants.Sha256` let a restore be checked: every recorded file must exist and hash to its recorded value (the integration test `What_is_recorded_survives_a_restart…` does exactly that check). A row whose file is missing is not repaired by the application; restore the file from the backup. Run `--blog-media-maintain --dry-run` after a restore: it reports an original that is missing, and any file the restored database does not know.

### 9.12 Known limits (CP02)

- No per-language alt/caption suggestions; no crop tool; no focal/credit in the public JSON (§9.1).
- Processing is synchronous inside the upload request (bounded: 10 files, 2 decodes at a time); a 10-picture request of large pictures can take tens of seconds. No queue or worker (not needed at this size).
- The decode runs in the API process (native Skia codecs); a hostile file is checked by the container parser first, but a codec crash would take the process down. The sizes above bound the work; isolating the decode in another process is not done.
- Durability was verified on a local filesystem and in the showcase container shape (§ runbook `BHA-BLOG-001-blog-media.md`). **Production (AWS) has no media mount in its supported container shape** (`BHA-BACKEND-CD-001`: exactly two bind mounts), so uploads there answer `409 blog.storage-not-configured` until that runtime shape is extended — a deployment decision outside CP02.
- A legacy picture is served as its original until the backfill (§9.8).

### 9.13 What CP03 and CP04 take from here, and what is left open

CP03: the routes of §9.4 (library grid on `preview/thumb`, picker, upload with per-file progress through `media/{id}/detail` and the client `id`, usage panel before delete, focal-point editor writing `focalX/focalY`), the descriptive fields, and `description` as the default caption. CP04: `variants[]` for `<picture>` / `srcset` (WebP first, fallback second), `width`/`height` for layout, the 300 s picture cache. **Open for OC/Owner:** (1) how the focal point and the credit reach the public page without breaking edit ≠ publish (§9.1); (2) whether to extend the production runtime shape with a media mount (§9.12); (3) whether per-locale alt/caption suggestions are wanted.

