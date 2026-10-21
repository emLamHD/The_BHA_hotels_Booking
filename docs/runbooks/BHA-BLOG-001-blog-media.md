# Runbook — Blog pictures (BHA-BLOG-001-CP02)

Contract and decisions: `docs/design/BHA-BLOG-001-blog-content-publishing.md` §9. This page is what an operator does.

## Where the files live

`WebsiteMedia:RootPath` (env `WebsiteMedia__RootPath`) — the same directory as the Hero and Promotion pictures; Blog files are `<RootPath>/blog/<32 hex>.<jpg|png|webp>`: the private **original** of each picture and its **variants** (three sizes × WebP + JPEG/PNG), every file under its own random key. Nothing is served from the directory directly; only the API routes read it, and only through the publication gate. The directory must be writable by the API process, outside the source and build output, and **durable** (a volume that survives restart and redeploy).

| Where | How |
|---|---|
| Developer machine | `export WebsiteMedia__RootPath=/home/admin1/bha-data/media` before `dotnet run` (local config, not committed) |
| Tests | each integration-test factory has its own temp directory, removed with it |
| Container image | `/var/media` exists and belongs to the unprivileged `app` user so a fresh named volume mounted there inherits that. **`WebsiteMedia__RootPath` is deliberately not set in the image**: with no volume and no setting, uploads answer `409 …-storage-not-configured` instead of silently writing into a layer the next recreate discards. The operator sets `WebsiteMedia__RootPath=/var/media` and mounts the volume |
| Showcase rehearsal (`deploy/showcase/compose.yaml`) | named volume `showcase-api-media:/var/media` + `WebsiteMedia__RootPath=/var/media`. Never `docker compose down -v` (it deletes the pictures with the database) |
| **Production (AWS)** | **Not configured.** The supported production runtime shape (`BHA-BACKEND-CD-001`) has exactly two bind mounts (keys, CA) and refuses any other container; it has no media directory, so uploads there are unavailable until that shape is extended by a deliberate deployment decision (outside CP02). Do not mount a directory by hand: the deploy script would refuse the container |

## Deploying the version that brings CP02

1. **Migration 19** (`AddBlogMediaLibrary`) — `dotnet ef database update …` as for any migration. It keeps every picture's id, key and references; it adds columns and the variants table; it processes nothing.
2. **Backfill — required if the database already holds Blog pictures** (pictures uploaded before CP02 are served as their original until it runs; the original can carry EXIF/GPS):

   ```bash
   # 1. look first: nothing is written; every picture is still decoded, so problems show now
   dotnet TheBha.Api.dll --blog-media-maintain --expected-database <THE_DATABASE_NAME> --dry-run
   # 2. then
   dotnet TheBha.Api.dll --blog-media-maintain --expected-database <THE_DATABASE_NAME> --apply
   ```
   (in a container: `docker exec <api> dotnet TheBha.Api.dll …` with the same environment as the running API; from source: `dotnet run --project Back_End/src/TheBha.Api -- …`). `--expected-database` must equal the database the process is connected to (exit 3 and nothing changed otherwise). Safe to repeat. Output lines start `blog-media:`.

   | Exit | Meaning |
   |---|---|
   | 0 | done / dry run clean |
   | 1 | failed (a database or file error); anything half done is safe to run again |
   | 2 | usage (neither or both of `--dry-run`/`--apply`, no database, bad `--grace-minutes`) |
   | 3 | the named database is not the connected one |
   | 4 | finished but reported `PROBLEM` lines (for example an original file missing from storage — restore it from the backup, then run again) |

3. Check: `SELECT "Generation", count(*) FROM "BlogMedia" GROUP BY 1;` → no `0` left; `SELECT count(*) FROM "BlogMediaVariants";` → 6 per picture; open an article in the Admin and its thumbnails load.

## Files nothing refers to

A crash between writing files and saving the row, or a delete whose file removal failed, leaves files no row refers to. They are harmless (never served: the gate needs a row) and are found, and with `--apply` removed, by the same command; it lists those **older than `--grace-minutes`** (default 60; an upload in progress has its files before its row, so never lower this on a live system without a reason) and the half-written `*.tmp` files a killed process leaves. Files that are not ours are never touched. Run the dry run first; run it after every restore.

## Backup and restore

Back up the **database and the media directory together**; restore both from the same moment. Check a restore: every file named by `BlogMedia.StorageKey` and `BlogMediaVariants.StorageKey` must exist and match `OriginalSha256` / `Sha256`:

```sql
SELECT "StorageKey", "OriginalSha256" FROM "BlogMedia";
SELECT "StorageKey", "Sha256" FROM "BlogMediaVariants";
```
(`sha256sum <RootPath>/<StorageKey>` against the value). The application never repairs a row whose file is missing; restore the file. `--blog-media-maintain --dry-run` reports a missing original.

## Cache

Public pictures are cached for at most 300 seconds (`Cache-Control: public, max-age=300`); a picture whose article is unpublished can still be served from a browser or shared cache for up to that long after its last validation, and nothing can purge a user's cache. The origin refuses it at once. Public JSON is always revalidated.

## Restart check

After a restart or container recreate with the same database and the same `/var/media` volume, request a published picture's variant URL (listed in the article JSON, `cover.variants[].url`) and compare its bytes with `BlogMediaVariants.Sha256`; the original (Staff route `…/website/blog/media/<id>`) with `BlogMedia.OriginalSha256`.

## Verified where (CP02)

See the completion report `docs/reports/BHA-BLOG-001-CP02-completion.md` for the exact environments: local filesystem + real PostgreSQL (tests), and the container shape (image built from `Back_End/Dockerfile`, volume at `/var/media`, container recreated). Production is **not** verified and not configured.
