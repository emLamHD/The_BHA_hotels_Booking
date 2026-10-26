# Runbook — carrying the website's content to another database (BHA-CONTENT-PERSIST-001, C1)

What the website shows — the website configuration (languages and texts, hero, menus, social links, currencies), the property catalog (properties, room types, rooms, rates, photographs), the offers (Ưu đãi) and the Blog (categories, posts, pictures, pins) — lives in the database and the media directory, not in the code. This page is how an operator puts that content into a database that does not have it, **without retyping it in Admin and without replacing anything the staff already changed or deleted on purpose**.

The content is the repository's `deploy/content/bha-site-content/` (a **content pack**). The command is part of the API image: `--content-pack-import` (and `--content-pack-verify`, `--content-pack-export`). It runs in any environment, exits when done, and is never a startup step. Hosting after the AWS retirement is not fixed in the repository; every value this runbook needs from the hosting is a placeholder in §2.

## 1. What is in the pack, and what is not

| Group (`--groups`) | Tables | Pictures |
|---|---|---|
| `website` | WebsiteCurrencies, WebsiteLanguages (switched-off ones too), WebsiteTranslations, WebsiteHero, WebsiteHeroMedia, WebsiteHeroSlides, WebsiteMenu, WebsiteMenuItems, WebsiteSocialSettings | hero pictures the staff uploaded (`hero/`); the built-in `seed/` pictures are part of the API |
| `catalog` | Properties, Amenities, RatePlans, RoomTypes, PropertyAmenities, RoomTypeAmenities, PhysicalRooms, Media, PropertyMedia, RoomTypeMedia, DailyRoomRates, DailyInventoryControls — **every property of the source, including the development fixture `the-bha-hotel`** | the Riverside photographs are static files of the Customer project (`Front_End/Customer_Web/public/media/the-bha-riverside/`); only their addresses travel (`Media.Url`, rewritten to `--media-base-url`) |
| `promotions` | PromotionMedia, Promotions, PromotionRoomTypes | 3 cover files (`promo/`) |
| `blog` | BlogCategories (+ translations, slugs), BlogMedia, BlogPosts, BlogPostTranslations, BlogPostSlugs, BlogPostRevisions, BlogRevisionCategories, BlogRevisionMedia, BlogCategoryPins, BlogSettings | 40 originals (`blog/`, 24.8 MB); their variants (thumb/card/article, WebP + JPEG) are **made by the picture pipeline** at the end of `--apply`, not shipped |

The pack's `manifest.json` lists every table with its row count and sha256, every picture file with its sha256, the static pictures the catalog points at and — with the reason — everything that is **not** in it: Staff accounts and memberships (people), Blog and promotion audit history (history of the source's Staff), the Blog variants (derived), identity tables, the schema history and the import ledger; and the booking tables (reservations, holds, blocks, occupancy; all empty in the source, so there is nothing to convert). The exporter refuses a database with a table nobody classified.

**Consequence to know about the development fixture.** The pack includes the property `the-bha-hotel` ("The BHA Hotel", 1 BHA Avenue, Ho Chi Minh City, pictures at `images.example.com`) because it is seeded content of the source (Owner decision). The Customer site finds the Riverside property by its slug and shows no page for the other one, but the **public API lists it**: `GET /api/v1/properties`, its room types and its availability answer for it on the target as they do on the source. **It can not be left out of this content with a scoped export**: `--property-slug the-bha-riverside` is **refused**, because five Blog *revisions* (history included, not only the published text) have a `propertyIntro` block for `the-bha-hotel`; the command names the property and the revisions and writes no pack. Dropping the property would mean changing those revisions, which is separate work.

## 2. Values to fill in (nothing here is known to the repository)

| Name | What | Example |
|---|---|---|
| `BHA_API_IMAGE` | the API image that serves the site (it must contain the migration `AddContentPackLedger`) | `<registry>/thebha-api:<tag>` |
| `BHA_DB_NAME` | the database's name; must equal `current_database()` | `thebha` |
| `ConnectionStrings__TheBhaDatabase` | connection string of the role that owns the tables (a private env file, `chmod 600`, named by `BHA_ENV_FILE`) | — |
| `BHA_MEDIA_BASE_URL` | the public Customer origin (https, no path); the catalog photographs load from `<origin>/media/the-bha-riverside/…` | `https://thebhariverside.com` |
| `BHA_MEDIA_MOUNT` | **the same durable volume or directory the API container mounts as `WebsiteMedia__RootPath`** (the image has `/var/media`; there is no default, see `BHA-BLOG-001-blog-media.md`) — with or without a trailing `/` | `bha-media` |
| `BHA_KEYS_MOUNT` | the Data Protection key ring volume | `bha-keys` |
| `BHA_ACTOR_EMAIL` | an existing, active Staff account (with Blog edit **and** publish when the Blog is imported); it is recorded as the author of every imported post, revision, picture and pin, and of any website row the staff edited in the source. Not needed when the groups chosen carry no author (`catalog`, `promotions`; `website` only while the source's configuration is unedited) | the Owner's own account |

If the media directory is not durable, the pictures are lost at the next container recreate while the database still points at them. Fix that first.

## 3. Procedure

Every step is repeatable. Nothing is written without `apply`; `dry-run` runs the whole transaction and rolls it back.

1. **Back up** the database (`pg_dump -Fc`) and the media directory, and keep them until §6 passes.
2. **Migrate** the schema as usual. This version adds **one table, `ContentPackLedger`** (migration 20, `AddContentPackLedger`): the importer's record of the rows it placed. `apply` refuses a database without it; `dry-run` and `verify` read without it.
3. **A database that has no Staff yet** (brand new): `catalog` and `promotions` need no Staff (the `website` group does when the source's staff edited the configuration, because it records who), so import those two first, create the Staff with the existing CLI (the Property must exist, hence this order), then import everything:
   ```bash
   export BHA_GROUPS=catalog,promotions; deploy/content/import-content-pack.sh dry-run && deploy/content/import-content-pack.sh apply; unset BHA_GROUPS
   # Staff: docker run … <image> --staff-create --email <email> --property-id a1000000-0000-0000-0000-000000000001 --role Manager
   #        docker run … <image> --staff-blog-access --email <email> --edit true --publish true      (BHA_STAFF_PASSWORD from a secret store)
   ```
4. **Dry run**, read it, **apply**, **verify**:
   ```bash
   deploy/content/import-content-pack.sh dry-run     # per table: inserted / matches / kept-target / mapped / updated / deleted-since; every CONFLICT; exit 0 only when there is none
   deploy/content/import-content-pack.sh apply       # writes, copies the pictures, runs the picture pipeline for the pack's pictures, then verifies by itself
   deploy/content/import-content-pack.sh verify      # read-only; see §4 for what the answer means
   ```
   Equivalent without the wrapper: `docker run … <image> --content-pack-import --expected-database <db> --pack /pack --media-base-url <origin> [--actor-email <email>] (--dry-run | --apply) [--groups …] [--restore-deleted]`.
5. **After a deploy or redeploy** run `verify` (it needs no Staff and writes nothing) and the checks of §6. Running `apply` again is safe (§4), but it is not needed.

Exit codes: `0` ok; `1` failure or a problem (damaged pack, missing file, missing actor, a missing dependency, a copy that failed, a variant file that is wrong); `2` usage; `3` `--expected-database` is not the database the process is connected to; `4` conflict.

### Scoped imports (`--groups`)
A group writes **only its own tables**. What a group's rows point at is still *resolved* in the target, whatever the groups: the target's own Property / RoomType / RatePlan / Amenity / Language (found by slug or code) is used in place of the pack's, and the pack's rows (and the Blog's `propertyIntro` ids) are re-pointed at it. So `--groups promotions` or `--groups blog` after a catalog that was matched to the target's own ids gives correct foreign keys and writes no catalog row. If the target has no such property or room type and the catalog is not among the groups, the run **stops before writing anything** and names it. The picture pipeline runs only when `blog` is among the groups, and only for the pack's pictures; no other picture of the database is read, changed or deleted.

## 4. How a run treats what is already there, and what `verify` says

| Situation in the target | Result |
|---|---|
| the row does not exist and no import ever placed it | inserted |
| the same key exists | **kept as it is**: `matches` when it equals the pack's, `kept-target` (listed with the columns that differ) when the staff changed it — the staff's version always wins; `verify` never overwrites a difference to make the result look like the source |
| the Property, a RoomType or RatePlan (by property + code), an Amenity (code) or a Language (code) exists under **another id** | the target's own row is used and everything of the pack that referred to the pack's id is re-pointed (`mapped`; its content is compared like any other row) |
| the target has a night's rate (property, room type, rate plan, date) under another id | the target's own rate is kept, price included; only the nights it lacks are added |
| the target has an offer with the same slug under another id | the target's own offer is kept with its own cover and room types; the pack's copy, links and cover (file not copied) are left out |
| a website-configuration row (hero, menu items, social, currency, language, text) | it takes the pack's value **only when the target's row is still the migration default** (version 1, no author, not a manual text) **and the pack's row was edited in the source**; otherwise the target's stays. A hero (menu) whose row the target never saved has its default slides (items) replaced by the source's configured ones; **a hero or menu the staff saved (version above 1 or an author, which every Admin save sets) is theirs as a whole: no child of the pack is added to it** — not a slide they replaced, not a menu item they removed, not an emptied menu — whether or not an import ever ran. No picture row is ever deleted. A built-in text is never overwritten by an older one. The language texts of the source's switched-off languages travel and stay switched off |
| a row an earlier import placed and that is **absent now** | **not put back**: the staff deleted it (`deleted-since`). `--restore-deleted` puts such rows back; that is the only way |
| anything else collides (a post slug, a category slug owned by another category, a room number…) | **CONFLICT**: all are listed, the transaction is rolled back, no picture is copied, exit 4 |
| a picture file exists with other bytes | CONFLICT (never overwritten) |
| a picture an earlier import placed and the staff deleted (the service removes its row and every file) | the row is not put back **and its file is not copied back either**; `dry-run`, `apply` and `verify` print `picture kept deleted … <key>` / `deleted since the import (not put back): BlogMedia <id> (<key>)` and do not count the file as missing; `--restore-deleted` restores the row and the file, the pipeline rebuilds the variants |

`verify` reports, per table and in a closing line, how many rows **match** the pack, how many **keep the target's own version**, how many were **deleted since the import**, how many are **missing** (the pack has them, the target has not and no import placed them: exit 1, rows named), whether a Blog body points at a property the target lacks, and — for every picture variant — that its file exists with the size and sha256 the database recorded (a deleted or changed file: exit 1, file named). Nothing is called "identical to the source" because a row was reused.

**Working beside the staff.** When the `website` group is written, the importer takes the same site-wide advisory lock every Admin website writer takes (`WebsiteTransaction.InLockAsync`: hero, menus, social, currencies, languages, translations, language packs) **before it reads any configuration state** and keeps it until commit or rollback. A Staff save that started first is waited for and the importer then sees it (the hero or menu is edited, so it is kept); a Staff save that starts during the import waits for it. The lock is taken after the importer's own lock, so the order is the same everywhere (no deadlock); it waits at most 60 seconds, then the run stops with nothing written. A configuration row is also updated only if it still has the version the importer read. The lock is taken in `dry-run` too (the same transaction, rolled back); `verify` takes none (it reads one snapshot). The catalog, offers and Blog have their own writers and are not under this lock.

**Resuming.** A run that fails or finds a conflict writes nothing, ledger included: the same command starts again from scratch. A run that fails *after* the commit (only the picture variants can) leaves the rows and files in place and says so; the same command, run again, finds them present and repeats only that step. Several runs at once are refused (an advisory lock).

The ledger answers one question: was this row ever placed by an import? It is written in the transaction of the rows and read by nothing else. Dropping it makes every missing row look "never imported": the next `apply` would put deleted rows back.

## 5. Recovery

* **Any failure or conflict leaves the database as it was**: read the message, fix the cause (a conflict row, a full disk, a missing `WebsiteMedia__RootPath`), run again.
* A crash between the file copy and the commit leaves up to 43 picture files in the media directory that nothing refers to. They are harmless: the next `apply` finds them identical. `--blog-media-maintain --apply` would treat the `blog/` ones as orphans only after its 60-minute grace — do not run it between a failed and a repeated import.
* **Go back** with the backup of step 1 (`pg_restore`) and the media backup. There is no "undo import" command by design.
* A variant file that `verify` reports as missing or changed is restored from the media backup; the pictures' originals are in the pack (`deploy/content/bha-site-content/files/blog/`).

## 6. Checks after the import and after every redeploy

1. `verify` exits 0 and its closing line is as expected.
2. API: `/api/v1/properties` lists the Riverside property (and `the-bha-hotel` if the pack carries it); `/api/v1/properties/<id>/room-types` returns 3 for the Riverside; an availability search inside the rate window returns offers with the source's prices; `/api/v1/website/config` lists the languages; `/api/v1/website/promotions` the offers; `/api/v1/website/blog/home-section` the featured destinations.
3. Customer (no rebuild is needed: every page of the Customer project is rendered per request): `/` shows the hero, the offers, the featured destinations, the Riverside block and the news; `/riverside` shows the three room types and each opens; `/offers` and each `/offers/<slug>`; `/blog`, a category, a post in Vietnamese and one in English; `/sitemap.xml`.
4. Pictures: a Blog picture (`/api/v1/website/blog/media/<id>/<generation>/<file>`) answers 200; the catalog photographs answer 200 at `<BHA_MEDIA_BASE_URL>/media/the-bha-riverside/<name>.webp` (they are deployed with the Customer project; the pack only records their address).
5. Admin (Staff): Blog posts (23), categories (5), picture library (40), Promotions (4) and the catalog ("Cơ sở & loại phòng") open; edit one post's draft and save. The catalog screens need the site-wide website permission (`--staff-website-access --email <email> --enabled true`); Blog and Promotions need their own (`--staff-blog-access`, a Property role) — the import grants none of them.
6. Restart or recreate the API container and repeat 1–2: the data and the pictures are still there.

## 7. Things to know before relying on it

* **Rates end on 2026-12-25.** The pack's `DailyRoomRates` cover 60 nights from 2026-10-27 for the Riverside (a database that already has rates keeps its own and gains the nights it lacks). **A search for dates after the last night with a price returns no rooms**, import or not: Admin has no rate management and the values are the source's, not extended or invented. Extending the window is an Owner decision and separate work. The offers carry no validity dates, so they do not expire.
* **Placeholders travel as they are:** the Riverside address is "Địa chỉ đang được cập nhật", the city "Đang cập nhật", the rate plan and room numbers are the seeder's. Edit them in Admin after the import; later imports keep the edit.
* **Pictures are illustrations from Wikimedia Commons** (CC BY, CC BY-SA, CC0 or public domain). Each post ends with its "Nguồn ảnh" line (a licence condition) and the library records author, source page and licence; keep both when replacing pictures. The Blog's author text and the facts in the posts were written as samples; review them before relying on them as published content.
* A hero the target never edited that takes the source's slides leaves the default slides' per-language texts (`content.heroSlide.<id>.*`) behind as unused translations. They are harmless.
* **Not covered:** the Customer Web and Admin Web builds, DNS, TLS and the Vercel projects (see `CUST-WEB-SHOWCASE-001-deploy.md`; its AWS parts are retired). `deploy/showcase/migrations/idempotent.sql` belongs to that retired flow and was already behind the migrations before this work item; it is not regenerated here.

## 8. Updating the pack

The pack is generated from a database that holds the reference content; it is committed so that CI imports it into a fresh database on every run.

```bash
dotnet TheBha.Api.dll --content-pack-export --expected-database <source db> --out <new empty dir> \
  [--property-slug <slug>[,<slug>]] --source-media-origin <origin in that db's Media.Url> --public-dir Front_End/Customer_Web/public
```

**Scoped export.** `--property-slug` limits the properties, and with them the catalog and the offers; the Blog is not scoped, so the export is **refused** when any Blog revision (every revision) has a `propertyIntro` block for a property it leaves out (or for one that does not exist): the message names the property and the revisions, no pack is left behind. Use it only for a source whose Blog does not name the left-out property; the committed content does, so it is exported in full. **Legacy pictures** (uploaded before the image pipeline: no recorded hash, generation 0) export normally: the pack carries the file's own sha256, a missing original or a recorded hash that is not the file's fails the export with the file named, and the import's picture pipeline gives them their variants.

The export only reads, in **one read-only REPEATABLE READ snapshot**, so staff changes while it runs can not leave a child without its parent. The picture files are read after the snapshot and must match its size and sha256: a file that changed meanwhile fails the export and **no pack is left behind**. It is deterministic (an unchanged source gives byte-identical files). It refuses a local address in any text, a `Media.Url` served by the API from catalog storage (those files are not carried), a missing static photograph and any unclassified table. A configuration row edited by SQL without raising its version is not recognised as edited and is not carried over a default; edits made in Admin always raise it.
