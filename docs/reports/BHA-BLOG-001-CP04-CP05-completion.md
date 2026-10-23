# BHA-BLOG-001-CP04–CP05 — Customer Blog, SEO and sitemap (completion report)

- **Status: IMPLEMENTATION PASS** · **Review: NOT_RUN** (Owner invokes `/codex:review --base origin/develop`) · Implementer Claude, reviewer Codex read-only.
- Branch `feature/bha-blog-001-public-blog-seo`, Draft PR #130 into `develop`. `BASE_SHA` = `START_HEAD` = `bb9f7f279a15a5dbf121a2d226948dee399ff91f` (`origin/develop`, contains #128 and #129). `FINAL_HEAD`: see the PR (docs-only commits follow the browser source).
- **Browser source:** `9986ea4bb740ea8de552e40b0cecdf46078b607f`, `Front_End/Customer_Web` tree `0027da3ea5b9fc932d75e79805405b134e2c4cb8` (the docs commits do not change it). Mode: `next build` + `next start` behind a TLS front (`https://localhost:3000`), API Release `https://localhost:7145`, Admin dev `https://localhost:3001`, one throw-away PostgreSQL 17 database, Chrome 153. Proxy mode: the same tree built with `API_PROXY_ORIGIN`.

## Scope delivered
`/blog`, `/blog/category/{slug}`, `/blog/{slug}` and the home "Điểm đến nổi bật" / "Tin tức nổi bật" read the published Blog API (no Staff session; no registry fallback); locale via `?locale=`; server pagination; schemaVersion-1 body renderer; pictures as the API sized them; canonical / hreflang / Open Graph / Twitter / JSON-LD; `/sitemap.xml`, `/robots.txt`; 301 for old slugs. Contract as built: design §11. **Backend: no API, schema or Admin change** — only 11 `customer.blog.*` messages (catalog + vi/en/fr). One new setting: `SITE_URL` (`.env.local.example`). Footer's "featured destinations" link (a registry category) was removed; `HomeNewsSection` now shows the latest published posts (its registry links would have been 404s).

## What the production run found (unit tests had not)
Each is fixed in its own commit, with a test: (1) `sitemap.ts`/`robots.ts` are rendered **at build time** by Next 13.4.3 whatever `dynamic` says — a build without `SITE_URL` failed and robots froze the sitemap line → route handlers; (2) a middleware 301 behind a TLS terminator redirected to `http://` and its adapter rejects a relative `Location` (500) and does not see `SITE_URL` / `x-forwarded-proto` → middleware rewrites to `/blog-moved`, a route handler answering 301 with a relative `Location` (exact-shape allow-list, no open redirect); (3) `router.push` on a language switch left the header and `<html lang>` in the old language → push + `router.refresh()`; (4) the client router cache kept an unpublished post for > 70 s in the same tab → each Blog page refreshes its route when shown by a soft navigation.

## Checks (all run in this work item)
Customer: `tsc` clean, `npm run lint` clean, `vitest` 78 files / 1412 tests pass, `npm run build` passes both direct and proxy mode and without `SITE_URL` (CI-like). Backend: `LocalizationTests` 74 pass; integration `Website|Blog|Localization` 269 pass on PostgreSQL; `git diff --check` clean. CI on the final head: see the PR (Admin / Backend / Frontend).

## Browser acceptance — 83 real-HTTP/Chrome checks, 83 pass (`evidence.jsonl` kept in the scratchpad)
| # | What | Result |
|---|---|---|
| 1 | **Real Admin editor** (category, cover, typed body) → Save draft: public API 404, Customer HTTP 404, not in list/sitemap; Publish: HTTP 200 with H1/summary/body in the HTML, on `/blog`, category, home and sitemap; a post with every block type | 5/5 |
| 2 | Edit a Published post's draft: Customer keeps the old title/body/SEO; republish: new body, `<title>`, description, OG, later `dateModified` (≈ 0.2 s); unpublish and archive: 404 and gone from list, category, home, sitemap on the next request (≈ 0.1 s) | 5/5 |
| 3 | Post slug renamed twice, category renamed twice, `/blog?category=<old>`: 301 in one hop to the current Customer URL (relative `Location`, keeps `?page=`/language), no loop, never `/api`; unknown = 404 | 7/7 |
| 4 | vi / en / en-US with different slugs, a post with no translation, fr (empty), `?locale=EN-us`; `<html lang>`, title, canonical, hreflang (published translations only, `en-US` casing); another window with a Vietnamese cookie opening the English URL; header switch vi→en→vi on a post and on an untranslated post (→ English index); no hydration mismatch | 12/12 |
| 5 | 62 more posts (66 vi): 6 pages of 12 = the API's whole list in its order, pins first on the category and home (≤ 6), zero-item category hides the home section, **API stopped**: pages say "could not load" (no 404/empty/registry link; post `noindex`; sitemap 500), recovery on the next request; total shrinking 6 → 4 pages redirects (307) to the last page; `?page=0/abc/1.5` = 404 | 16/16 |
| 6 | Chrome desktop + 390 px, light + dark: pictures load (WebP + JPEG fallback both served), TOC anchors, links, gallery, Property CTA (Riverside only), contrast ≥ 4.5, no overflow, no unexpected console error; smoke of home, Riverside, offers, stay search, login, signup, FAQ, contact | 15/15 |
| 7 | Real HTML/HTTP: one H1, metadata, OG image serves, JSON-LD parses (dates = API's, no invented author/rating), breadcrumbs, sitemap = exactly the public pages (all **API pages** — 52 vi posts at the time —, 4 languages, `lastmod`), robots, real 404s, 301 | 13/13 |
| 8 | Windows measured (below) | 3/3 |
| 9 | **Proxy mode**: pages, picture addresses on the Customer origin and loading in Chrome, 301, sitemap/robots on the proxy origin, publish/unpublish | 7/7 |

**Cache windows (measured).** New HTTP request: unpublish visible in ≈ 0.1 s. Same tab, back to a visited post: the old page can flash ≈ 0.4 s, then the 404 (without the fix it stayed > 70 s). Pictures: the API refuses an unpublished picture at once; a browser that holds it may show it ≤ 300 s (the API's `max-age`); no `/_next/image` copy exists.

**Fixtures / harness (not product behaviour).** Languages `en-US` and `fr` created through the Admin API and activated by SQL; the seeded Property renamed to the Riverside slug and a second active Property inserted by SQL (so the CTA rule is exercised both ways); login rate limits raised for the harness; posts beyond scenario 1 made through the Admin API the editor calls; `?locale` dictionary of a created language falls back to shared texts only.

## Limits and risks
Focal point / credit / source / licence stay Admin-only (not public). One sitemap file, no index (> 50,000 URLs), and it reads every API page per request. Index/category pages have no hreflang; the language switch on a category goes to the index. Registry leftovers (`PostCard.tsx`, `homepageContent.ts`, `content.post.*` in the dictionary payload) are unused cleanup candidates, not removed. The CP02 deployment limit (durable media mount on the VPS) is untouched. A language installed from a pack needs the 11 new texts (re-apply the pack). Not run: production deployment, a second browser engine, real crawlers.

## Owner manual checklist
Set `SITE_URL` where the Customer runs; in Admin publish a post with cover + category, open `/blog`, the post, its category and `/sitemap.xml`; unpublish and reload; rename its slug and open the old URL (expect 301 and the new page); switch the language on a translated and on an untranslated post; open `/robots.txt`.
