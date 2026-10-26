# Runbook — carrying the website's content to another database (BHA-CONTENT-PERSIST-001)

What the website shows — the Riverside catalog (property, room types, rooms, rates, photographs), the offers (Ưu đãi) and the Blog (categories, posts, pictures, pins) — lives in the database and the media directory, not in the code. This page is how an operator puts that content into a database that does not have it, **without retyping it in Admin and without replacing anything the staff already changed**.

The content is the repository's `deploy/content/bha-site-content/` (a **content pack**). The command is part of the API image: `--content-pack-import` (and `--content-pack-verify`, `--content-pack-export`). It runs in any environment, exits when done, and is never a startup step. Hosting after the AWS retirement is not fixed in the repository; every value this runbook needs from the hosting is a placeholder in §2.

## 1. What is in the pack, and what is not

| Group (`--groups`) | Tables | Pictures |
|---|---|---|
| `catalog` | Properties, Amenities, RatePlans, RoomTypes, PropertyAmenities, RoomTypeAmenities, PhysicalRooms, Media, PropertyMedia, RoomTypeMedia, DailyRoomRates, DailyInventoryControls | the Riverside photographs are static files of the Customer project (`Front_End/Customer_Web/public/media/the-bha-riverside/`); only their addresses travel (`Media.Url`, rewritten to `--media-base-url`) |
| `promotions` | PromotionMedia, Promotions, PromotionRoomTypes | 3 cover files (`promo/`) are copied into the media directory |
| `blog` | BlogCategories (+ translations, slugs), BlogMedia, BlogPosts, BlogPostTranslations, BlogPostSlugs, BlogPostRevisions, BlogRevisionCategories, BlogRevisionMedia, BlogCategoryPins, BlogSettings | 40 originals (`blog/`, 24.8 MB) are copied; their variants (thumb/card/article, WebP + JPEG) are **made by the picture pipeline** at the end of `--apply`, not shipped |

The pack's `manifest.json` lists every table with its row count and sha256, every picture file with its sha256, the static pictures the catalog points at, the active languages, and — with the reason — everything that is **not** in the pack: Staff accounts and memberships, Blog and promotion audit history, the Blog variants, identity tables, the schema history; the booking tables (reservations, holds, blocks, occupancy; all empty in the source) and the website configuration that every migrated database already has (hero, menus, social, currencies, translations, languages; only the *active languages* travel). The exporter refuses a database with a table nobody classified, so a future table cannot be left out silently.

Not in the pack by Owner decision (open): the development fixture property `the-bha-hotel` ("The BHA Hotel", 1 BHA Avenue, Ho Chi Minh City, `images.example.com` pictures, two inventory controls). No Customer page reaches it (the stay search resolves the property by the slug `the-bha-riverside`), it is not website content, and it is listed under `excluded` in the manifest. To include it, export again with `--property-slug the-bha-riverside,the-bha-hotel`.

## 2. Values to fill in (nothing here is known to the repository)

| Name | What | Example |
|---|---|---|
| `BHA_API_IMAGE` | the API image that serves the site | `<registry>/thebha-api:<tag>` |
| `BHA_DB_NAME` | the database's name; must equal `current_database()` | `thebha` |
| `ConnectionStrings__TheBhaDatabase` | connection string of the role that owns the tables (a private env file, `chmod 600`, named by `BHA_ENV_FILE`) | — |
| `BHA_MEDIA_BASE_URL` | the public Customer origin (https, no path); the catalog photographs load from `<origin>/media/the-bha-riverside/…` | `https://thebhariverside.com` |
| `BHA_MEDIA_MOUNT` | **the same durable volume or directory the API container mounts as `WebsiteMedia__RootPath`** (the image has `/var/media`; there is no default, see `BHA-BLOG-001-blog-media.md`) | `bha-media` |
| `BHA_KEYS_MOUNT` | the Data Protection key ring volume | `bha-keys` |
| `BHA_ACTOR_EMAIL` | an existing, active Staff account with Blog edit **and** publish; it is recorded as the author of every imported post, revision, picture and pin (the schema requires an author) | the Owner's own account |

If the media directory is not durable, the pictures are lost at the next container recreate while the database still points at them. Fix that first.

## 3. Procedure

Every step is repeatable. Nothing is written without `apply`; `dry-run` runs the whole transaction and rolls it back.

1. **Back up** the database (`pg_dump -Fc`) and the media directory, and keep them until §5 passes.
2. **Migrate** the schema as usual (the pack carries no schema). The command refuses a pack whose columns the database does not have.
3. **A database that has no Staff yet** (brand new): the catalog and the offers need no Staff, so import them first, create the Staff with the existing CLI (the Property must exist, hence this order), then import everything:
   ```bash
   export BHA_GROUPS=catalog,promotions; deploy/content/import-content-pack.sh dry-run && deploy/content/import-content-pack.sh apply; unset BHA_GROUPS
   # Staff: docker run … <image> --staff-create --email <email> --property-id a1000000-0000-0000-0000-000000000001 --role Manager
   #        docker run … <image> --staff-blog-access --email <email> --edit true --publish true      (BHA_STAFF_PASSWORD from a secret store)
   ```
4. **Dry run**, read it, **apply**, **verify**:
   ```bash
   deploy/content/import-content-pack.sh dry-run     # per table: inserted / identical / kept-different / mapped; every CONFLICT; exit 0 only when there is none
   deploy/content/import-content-pack.sh apply       # writes, copies the pictures, runs the picture pipeline, then verifies by itself
   deploy/content/import-content-pack.sh verify      # read-only; exit 0 = every row, picture file and variant of the pack is on the target
   ```
   Equivalent without the wrapper: `docker run … <image> --content-pack-import --expected-database <db> --pack /pack --media-base-url <origin> --actor-email <email> (--dry-run | --apply) [--groups …]`.
5. **After a deploy or redeploy** run `verify` (it needs no Staff and writes nothing) and the checks of §5. Do **not** run `apply` automatically on every deploy: see §6.

Exit codes: `0` ok; `1` failure or a problem (damaged pack, missing file, missing actor, a copy that failed); `2` usage; `3` `--expected-database` is not the database the process is connected to; `4` conflict.

### What the command does with what is already there

| Situation in the target | Result |
|---|---|
| the row does not exist | inserted |
| the same key exists | **kept as it is**, reported `identical`, or `kept (target differs from the pack)` when the staff changed it — the staff's version always wins |
| the Property, a RoomType (by property + code) or an Amenity (by code) exists under **another id** | the target's own row is used; every row of the pack that referred to the pack's id (and the `propertyIntro` blocks of the Blog bodies) is re-pointed (`mapped`) |
| anything else collides (a promotion or post slug, a category slug that belongs to another category, a room number…) | **CONFLICT**: all conflicts are listed, the transaction is rolled back, no picture is copied, exit 4. Resolve it in the database or in Admin and run again |
| a picture file exists with other bytes | CONFLICT (never overwritten) |
| the language `en` is still the migration default (inactive, version 1, never edited) | activated, because the pack's English posts need it; a language a staff member changed is left alone and the output says so |

All rows go in one transaction under an advisory lock of their own (`pg_try_advisory_xact_lock`); a second import at the same time stops with a message. The picture files are copied (temporary name, flush, rename) just before the commit; if the copy fails the rows are rolled back, and if the commit fails after the copy a rerun finds the identical files and finishes.

## 4. If it stops half-way, and how to go back

* **Any failure or conflict leaves the database as it was**: read the message, fix the cause (a conflict row, a full disk, a missing `WebsiteMedia__RootPath`), run the same command again.
* A crash between the file copy and the commit leaves up to 43 picture files in the media directory that nothing refers to. They are harmless: the next `apply` finds them identical. `--blog-media-maintain` would treat the `blog/` ones as orphans only after its 60-minute grace — do not run it with `--apply` between a failed and a repeated import.
* **Go back** with the backup of step 1 (`pg_restore`) and the media backup. There is no "undo import" command by design: the importer cannot tell which rows it created once the staff have edited them.

## 5. Checks after the import and after every redeploy

1. `verify` exits 0.
2. API: `/api/v1/properties` lists the Riverside property; `/api/v1/properties/<id>/room-types` returns 3; an availability search inside the rate window returns offers with the prices of the source; `/api/v1/website/promotions` returns the offers; `/api/v1/website/blog/home-section` returns the featured-destinations section.
3. Customer (no rebuild is needed: every page of the Customer project is rendered per request): `/` shows the offers, the featured destinations, the Riverside block and the news; `/riverside` shows the three room types and each opens; `/offers` and each `/offers/<slug>`; `/blog`, a category, a post in Vietnamese and one in English; `/sitemap.xml`.
4. Pictures: a Blog picture (`/api/v1/website/blog/media/<id>/<generation>/<file>`) answers 200; the catalog photographs answer 200 at `<BHA_MEDIA_BASE_URL>/media/the-bha-riverside/<name>.webp` (they are deployed with the Customer project; the pack only records their address).
5. Admin (Staff): Blog posts (23), categories (5), picture library (40), Promotions (4) and the catalog ("Cơ sở & loại phòng": the Riverside property and RIV-1BR, RIV-1BR-OPEN, RIV-2BR) open; edit one post's draft and save. The catalog screens need the site-wide website permission (`--staff-website-access --email <email> --enabled true`); Blog and Promotions need their own (`--staff-blog-access`, a Property role) — the import grants none of them.
6. Restart or recreate the API container and repeat 1–2: the data and the pictures are still there (they live in the database and the media volume, not in the container).

## 6. Things to know before relying on it

* **Run `apply` once per database (and again only to fill what is missing).** A row the staff deleted on purpose (a promotion, a pin) is *absent*, so a later `apply` puts it back. After the first import use `verify` and `dry-run` (a non-zero `inserted` in a dry run means "the pack has rows the database does not").
* **Rates end on 2026-12-25** (the pack's `DailyRoomRates` cover 60 nights from 2026-10-27). After that date the availability search returns no rooms, whatever the import does. Admin has no rate management; extending the window is an Owner decision and a separate piece of work. The offers carry no validity dates, so they do not expire.
* **Placeholders travel as they are:** the Riverside address is "Địa chỉ đang được cập nhật", the city "Đang cập nhật", the rate plan and room numbers are the seeder's. Edit them in Admin after the import; later imports keep the edit.
* **Pictures are illustrations from Wikimedia Commons** (CC BY, CC BY-SA, CC0 or public domain). Each post ends with its "Nguồn ảnh" line (a licence condition) and the library records author, source page and licence; keep both when replacing pictures.
* The Blog's author texts ("Ban biên tập The BHA") and the facts in the posts were written as samples; review them before relying on them as published content.
* A post's `propertyIntro` links to the Riverside page only for the Riverside property; the pack uses it, so the target's Riverside is the one linked.
* **Not covered:** the Customer Web and Admin Web builds, DNS, TLS and the Vercel projects (see `CUST-WEB-SHOWCASE-001-deploy.md` for their configuration; its AWS parts are retired).

## 7. Updating the pack

The pack is generated from a database that holds the reference content; it is committed so that CI can import it into a fresh database on every run.

```bash
dotnet TheBha.Api.dll --content-pack-export --expected-database <source db> --out <new empty dir> \
  --property-slug the-bha-riverside --source-media-origin <origin in that db's Media.Url> --public-dir Front_End/Customer_Web/public
```

The export only reads. It is deterministic (an unchanged source gives byte-identical files). It refuses a local address in any text, a picture file that does not match its recorded sha256, a missing static photograph, and any unclassified table.
