# BHA-BLOG-001 — CP02 completion report

- **IMPLEMENTATION:** PASS for CP02 and its correction CP02-C1. **REVIEW:** the original review of `d9d1b41` was **RUN** by the Owner (two P2 findings, below); the review of the correction is **NOT_RUN** — the Owner invokes Codex again.
- **Work item:** `BHA-BLOG-001-CP02` — picture library and image pipeline (backend). CP03 (Admin screens), CP04 (Customer) and CP05 (SEO) are **not** started.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner only).
- **Branch:** `feature/bha-blog-001-cp02-media-library-pipeline` (did not exist before; created in the single checkout).
- **BASE_SHA = START_HEAD:** `57eb0b93805bff59d8382a57d302d4276c65c831` = `origin/develop` after `git fetch --prune origin`; tree clean; `REQUIRED_ANCESTOR` `89fa4d9f…` is an ancestor. Two old Orca linked worktrees exist on disk (`dry-run-orca-*`); only noted, not used or touched (`RULES.md` §5).
- **Draft PR:** https://github.com/emLamHD/The_BHA_hotels_Booking/pull/127 (Draft, base `develop`).
- **FINAL_HEAD / CI:** given in the hand-off message (this file is part of the head it would describe).
- **UI_LIVE:** `NOT_APPLICABLE` (no frontend file changed). This does not replace the HTTP/file/runtime evidence below.
- **Skills / tools:** Graphify (`GRAPHIFY_POLICY: ALLOWED_IF_RELEVANT`): a graph exists at `graphify-out/` and was **not queried**; source and tests were read directly. `diagnosing-bugs` (`ALLOWED_IF_TRIGGERED`): **not invoked** — the one failure with an unknown cause (the backfill, below) had a direct, repeatable red→green loop (the failing test itself), so the heavy skill was not needed. Advisor consulted before locking the plan and before reporting.

## Governance notes

- Nothing merged, marked ready, deployed, rebased or force-pushed; no production migration; no secret changed; no Codex command run by the implementer. No worktree added.
- Out-of-scope files touched, with the reason: five existing test files that pin "the latest migration is 18" (now 19) or a global list (`AdminCalendarAssignmentApiTests` write-path allowlist, which says a new route "must be added here on purpose"); the CP01 public-media test (expected the raw original, now expects the processed article size by design). `LocalHeroMediaStorage`/`IHeroMediaStorage` gained a listing member (default interface member; Hero/Promotion behaviour unchanged).
- Not touched on purpose: `deploy/showcase/scripts/backend-deploy.sh` and the CD workflow (the production runtime shape allows exactly two bind mounts; extending it is CI/CD scope).

## What was built

| Area | Result |
|---|---|
| Asset vs use | `BlogMedia` holds name, file name, description (default caption), credit, source (https), licence, focal x/y, size, hash, `Generation`, `Version`. Alt/caption stay in the revision per locale; editing an asset changes no revision, no `Version` of a translation and no public `contentHash` (tested). |
| Upload | One picture (CP01 route, additive fields, optional client `id`) and `POST media/bulk` (≤ 10 / ≤ 50 MB; per-file `index`, `fileName`, `id`, `media` or `error`). |
| Pipeline | SkiaSharp 4.153.1 (MIT, already shipped): real decode, sRGB, EXIF 1–8 applied by drawing into each preset, `thumb`/`card`/`article` (320/640/1280, never enlarged), WebP + JPEG (PNG only for real transparency), no metadata. AVIF **not** produced. |
| Persistence | Files first (fresh random keys), then row + variants in one transaction; cleanup only when the row is known absent. |
| Library | List/search/paging with a total order, `used`/`unused` filter; detail; usage (cover/og/body × draft/live/history, also unpublished/archived posts); `save` (BlogEdit, 409 on stale); `delete` (BlogPublish, 409 `blog.media-in-use`, race-safe). |
| Serving | Admin routes `no-store`; public plain address = processed article-size fallback (legacy: original); variants at `media/{id}/{generation}/{preset}.{format}`; publication gate on every request (also conditional); `public, max-age=300`, no stale-*; original has no public address. |
| Operations | Migration 19; `--blog-media-maintain` (backfill + orphan sweep, named-database guard, dry run); Dockerfile `/var/media`; showcase compose volume; runbook. |

## Decisions, limits, evidence-backed choices

1. **Files first, no `Processing` row** (advisor): nothing before CP02 filtered on a status, so a half-made row would have been attachable and servable; a crash leaves only orphan files.
2. **Focal point and credit are not in the public JSON.** Editors write them under `BlogEdit`; exposing them live would publish an edit without `BlogPublish` (ADR 0010). **Open for OC:** snapshot into the revision at publish, or a publisher-approved live read (design §9.1, §9.13).
3. **Route named `media/bulk`**, not `batch`: an existing Calendar contract test refuses any API path containing "batch"; its guard was left alone.
4. **AVIF is not available**: `SKImage.Encode(Avif)` returned `null` in the shipped Skia build (probe printed `avif=null`); key regex and DB constraints do not allow `.avif`; a test fails if this ever changes.
5. **Legacy pictures** keep id/key/references/addresses and are served as their original until `--blog-media-maintain --apply` runs (they can carry EXIF/GPS, as in CP01). CP01 was merged on 2026-10-21 with an empty Blog, so the backfill is a required deploy step only where pictures exist.
6. **Memory budget:** a decode holds width × height × 4 bytes (≤ 160 MB at 40 MP); 2 decodes at once per process → ≤ 320 MB plus presets. Multipart is spooled to disk by ASP.NET above 64 KB; the 50 MB total is refused before any picture is processed.
7. **Retry/cancel:** no idempotent upload and no exactly-once claim. The client may send an `id` per picture and read `media/{id}/detail` after a failure; a repeat id is 409. A cancelled bulk stops between pictures, finished pictures stay whole, the one in flight leaves nothing.
8. **Production (AWS) has no media mount** in its supported container shape (`BHA-BACKEND-CD-001`: exactly two bind mounts). Uploads there answer `409 …-storage-not-configured` until that shape is extended. **Durability was verified locally and in a container, not in production.**
9. **Public cache window** unchanged and honest: a picture can linger ≤ 300 s in a valid cache after unpublish; origin refuses at once; nothing purges a user's cache.
10. The decode runs in the API process (native codecs). The container parser runs first and the sizes bound the work; process isolation was not done.

## Checks run (real PostgreSQL 17.10 started from `~/pgsql17` in the scratchpad, port 54329; the project's own `the-bha-postgres-1` container was not touched)

| Check | Command | Result |
|---|---|---|
| Baseline before edits | Blog + Hero tests | 119 unit / 71 integration, 0 failed |
| Build | `dotnet build Back_End/TheBha.Booking.sln --configuration Release` | 0 errors (pre-existing warnings only) |
| **Full backend suite** (on `1db805f`, the last commit with code or test changes; later commits are documentation and one XML comment) | `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` | **673 unit + 1276 integration, 0 failed** (8 min). A first full run on the same work had 4 failures, all mine and fixed before this run: two Calendar OpenAPI contract tests (route name, write-path allowlist), a pinned migration count, and a test password that collided with a word in an output line |
| New tests | `BlogMediaDomainTests` 22 · `BlogImagePipelineTests` 15 · `BlogMediaLibraryApiTests` 16 · `BlogMediaUsageApiTests` 6 · `BlogMediaServingApiTests` 5 · `BlogMediaFailureTests` 6 · `BlogMediaMaintenanceTests` 4 · `BlogMediaMigrationTests` 3 | all pass |
| Whitespace | `git diff --check origin/develop...HEAD` | clean |
| Compose | `docker compose -f deploy/showcase/compose.yaml config` with placeholder variables | valid; shows `WebsiteMedia__RootPath` and the `showcase-api-media` volume |
| Deploy script tests | `python3 -m unittest` for `test_verify_key_persistence`, `test_backend_release_packet`, `test_backend_release` | 87 / 87 |
| Migration artifacts | `deploy/showcase/migrations/idempotent.sql` was committed once (PR #83) and no later migration, CP01's included, updated it; the CD migration manifest is generated at release time from a clean checkout | nothing to regenerate |
| Licence | `~/.nuget/packages/skiasharp/4.153.1/*.nuspec` | `license type="expression"` MIT |
| Image | `docker build -t thebha-api:cp02 Back_End` | built (user `app`) |
| Frontend | not changed | `NOT_RUN` |

Mutation checks (a deliberate break must turn a test red; then the code was restored — the orientation one from a backup copy of the two files, the other two with `git checkout` — and rebuilt): orientation 6 matrix → the orientation-6 case red; publication gate forced open → 3 gate tests red; "always delete files after a failure" → the lost-acknowledgement test red.

A real defect found by these tests and fixed: the backfill added variants (Guid keys already set) to the collection of a tracked parent, which EF took for existing rows (`DbUpdateConcurrencyException`, `PROBLEM: it changed while being processed`). Red → cause → `db.BlogMediaVariants.AddRange` → green. Uploads were not affected (they `Add` the root).

### Acceptance → evidence

| # | Evidence | Where |
|---|---|---|
| 1 | Migration from a clean DB and from a CP01 schema with pictures, an article and references; model has no pending changes; `Down()` refuses processed/edited/variant data and allows untouched CP01 pictures | `BlogMediaMigrationTests` + the pinned migration lists |
| 2 | Bulk with valid + cut + fake + 10 MB+1 + undecodable-WebP + transparent PNG: per-index results, client ids echoed, 2 complete pictures (14 files, no `.tmp`), no row for the failed ones; limits (11 files, ids mismatch, none, 54 MB) refused with nothing created | `BlogMediaLibraryApiTests` |
| 3 | Output decoded again: MIME by magic bytes, sizes, ratio, no upscale, all 8 orientations with the marker corner, alpha kept, no `Exif`/APP1/GPS (also over HTTP), AVIF probe | `BlogImagePipelineTests`, `BlogMediaServingApiTests` |
| 4 | Metadata/focal saved against a version; stale → 409; two writers at once → one winner; revision alt/caption, translation version and public `contentHash` unchanged; audit with the real Staff id | `BlogMediaLibraryApiTests` |
| 5 | Pages of 3 over 7 pictures: every picture once, same order again; case-insensitive search, `%`/`_` literal, credit search, used/unused; the failed upload is never listed | `BlogMediaLibraryApiTests` |
| 6 | Usage for cover/og/body/gallery across draft, live, history, unpublished, archived; delete refused in each; an old revision restored with its pictures and previews still served; unused picture deleted with variants and files | `BlogMediaUsageApiTests` |
| 7 | Delete vs save in **both orders with real PostgreSQL locks** (→ 400 `blog.media-missing` / 409 `blog.media-in-use`) plus 12 concurrent rounds: never a 5xx, never a dangling use, files match rows | `BlogMediaUsageApiTests` |
| 8 | 404 before publish / after unpublish / archived for the plain address and all six variants, with and without `If-None-Match`/`If-Modified-Since`; bad generation/preset/format/traversal → 404; draft-only and history-only pictures never public; no other route serves them; public JSON names no path/key/hash/Staff/focal/credit | `BlogMediaServingApiTests` |
| 9 | Exactly `public, max-age=300`, no `stale`/`immutable`; no `ETag`/`Last-Modified` on pictures; JSON `no-cache` + ETag, 304 when unchanged, 404 after unpublish with the same validator | `BlogMediaServingApiTests` |
| 10 | Storage fails mid-picture (siblings kept, nothing of it left); DB refusal after files written (all files removed); **lost acknowledgement after commit (no file deleted, picture complete and servable)**; codec failure; cancellation mid-picture; failed file removal → orphans found and removed by the command | `BlogMediaFailureTests` |
| 11 | New host on the same DB and media directory: original and every variant byte-identical (hash = recorded hash); **container**: API started twice from the image on the same DB + `/var/media` volume (`health/ready` 200 each), 7/7 files match the DB hashes before and after recreate | `What_is_recorded_survives_a_restart…`; Docker run (below) |
| 12 | Anonymous 401; Desk/Site/Manager 403 on every route; Editor cannot delete; Publisher cannot save; wrong Origin 403; LocalGate 404; admin answers `no-store` | `BlogMediaLibraryApiTests` |
| 13 | Hero/Promotion tests and the whole suite green; shared storage change is a default interface member | full suite |
| 14 | Build + full backend suite on real PostgreSQL | above |
| 15 | Image built; maintenance command run **inside the container**: wrong DB → exit 3, dry run wrote nothing, apply produced 6 variants (WebP + JPEG) for a CP01-style PNG on the volume (written by user `app`) | Docker run (below) |

### Container run (the evidence for 11 and 15)

Scratch PostgreSQL 17.10, database `thebha_cp02_docker` (dropped afterwards), image `thebha-api:cp02` built from `Back_End/Dockerfile`, `--network host`, volumes `bha-cp02-media` (`/var/media`) and `bha-cp02-keys` (removed afterwards). A CP01-style PNG (2315 bytes) was copied into the fresh volume by the image's own user `app`, a row inserted with `Generation 0`. `--blog-media-maintain`: wrong database → `REFUSED`, exit 3; `--dry-run` → "pictures before CP02: 1; processed: 0", no variant rows; `--apply` → "processed: 1", `Generation 1`, six variants (`thumb` 320×240, `card` 640×480, `article` 800×600; WebP 708/1118/1436 bytes, JPEG 1211/2561/3611), shown size 800×600 (the decode corrected the row's placeholder), `OriginalSha256` = the file's hash. Then two server containers one after the other from the same image, DB and volume: `/health/ready` 200 both times, the volume held 7 files, and `sha256sum` of all 7 equalled the hashes recorded in the database before and after; a fresh dry run reported nothing to do and nothing unreferenced.

**Where durability is verified:** local filesystem with real PostgreSQL (integration tests) and a Docker container with a named volume (above). **Not** verified: production/AWS, which has no media mount (decision 8).

## Not done / risks / blockers

- No blocker; every mandatory check ran. Review is the Owner's step.
- Open decisions for OC/Owner: focal/credit in the public answer (decision 2); a media mount in the production runtime shape (decision 8); per-locale alt/caption suggestions (optional in the prompt, not stored).
- Risks: legacy pictures served as original until backfill; ≤ 300 s cache window; synchronous processing of up to 10 large pictures can take tens of seconds; in-process native decode.
- PR size: 47 files; about 3.8k of the added lines are the EF-generated `…AddBlogMediaLibrary.Designer.cs`; the rest is the pipeline, schema, service/API and tests, which cannot be split and stay reviewable.

## Next

CP03 (Admin library screens, picker, focal editor, upload progress, usage panel) is the next step and **has not been started**.

## Review of `d9d1b41` and correction CP02-C1

**Original Codex review (RUN by the Owner).** Command `/codex:review --base origin/develop`; target: branch diff against `origin/develop` (`57eb0b9`); head reviewed: `d9d1b41bd0bf6857685c6bcab52b7ce6f70cd8fe`; result kept as received:

> # Codex Review
>
> Target: branch diff against origin/develop
>
> The new batch endpoint can accept duplicate parsed IDs and partially process a request that should have been rejected up front. The media-list pagination also allows a large page value to overflow the database offset and fail the request.
>
> Full review comments:
>
> - [P2] Compare parsed GUIDs when validating batch IDs — /home/admin1/The_BHA_hotels_Booking/Back_End/src/TheBha.Api/Controllers/AdminBlogController.cs:202-202
>   When two `ids` use different valid textual representations of the same GUID, `raw.Distinct()` treats them as distinct, so the request passes validation even though both uploads target the same media ID. The second upload then fails as a duplicate after the first has already been stored, contradicting the endpoint’s all-inputs-validated-before-processing behavior; compare the parsed GUID values instead.
>
> - [P2] Prevent page-offset overflow — /home/admin1/The_BHA_hotels_Booking/Back_End/src/TheBha.Infrastructure/Persistence/AdminBlogService.Media.cs:214-214
>   For a sufficiently large positive `page`, `(page - 1) * size` overflows `int` and can become negative before it reaches `Skip`, turning a valid query parameter into a server error. Bound the page or calculate and validate the offset using a wider integer type before querying.

**OC verdict:** `CORRECTION_REQUIRED`; both findings accepted. The implementer did not touch either before the OC correction prompt (`BHA-BLOG-001-CP02-C1`), as `CLAUDE.md` requires.

**Correction `BHA-BLOG-001-CP02-C1`** (same implementer, same branch, same Draft PR #127; `START_HEAD` `d9d1b41`, `origin/develop` still `57eb0b9`):

| Finding | Root cause (both confirmed by the red tests) | Fix | Regression tests (real PostgreSQL, real multipart / HTTP) |
|---|---|---|---|
| F1 | `raw.Distinct()` compared the *text* of the ids, so `D`/`N`/`B`/`P` forms and letter case of one Guid passed; the first picture was stored and only the second refused | each id parsed once; count, empty/invalid and uniqueness judged on `Guid` values (`HashSet<Guid>`), all before the first picture is taken in; same `400 blog.media-batch-invalid`, field `ids`; any valid Guid format still accepted | the same Guid as D+N, lower+upper, B+D, P+D (4 cases) → 400 and no row, variant, file or upload audit; a repeat at the end after a different valid id → 400 and nothing stored; three different Guids in D / upper N / B → 200 with the right index and id; no `ids` still works |
| F2 | `.Skip((page - 1) * size)` multiplied two `int`s: `int.MaxValue` × 24 wrapped to a negative offset and PostgreSQL answered `OFFSET must not be negative` (500) | offset worked out as `long`; if `offset >= total` an empty page is returned without a query for rows; otherwise the offset is below an `int` total, so the cast is exact; `page`/`pageSize` returned as normalized, not clamped; the service is protected, not only the controller | `page=int.MaxValue` with sizes 24/50/2, the first page over the `int` offset limit for size 50 (42949674) and the last one under it (42949673), two further overflowing cases for size 3 (1431655765, 1431655766), an ordinary page past the end → 200, empty, right total, same `page`/`pageSize`; total filtered by `usage` and by `q`; real pages 1–4 in order with no repeat; `page=0`/`pageSize=0`/`page=-7`/`pageSize=500` normalized as before; the service called directly with `int.MaxValue` page and size |

**Red → green.** On the unfixed source (`git diff HEAD -- Back_End/src` empty, i.e. `d9d1b41`): 7 of the 24 tests of `BlogMediaLibraryApiTests` failed — the four same-Guid cases and the repeat-at-the-end returned **200 and had stored pictures**; the page test got **HTTP 500**; the direct service call threw `Npgsql.PostgresException: 2201X: OFFSET must not be negative`. After the fix: 24 / 24. The positive F1 test passed before and after (it guards the behaviour that must not change).

**Full check after the correction** and **CI** are in the hand-off message of CP02-C1 (they describe the head this file is part of). The container durability and codec fault-injection evidence above is unchanged: nothing in those components changed. The Admin flake noted earlier was outside the diff and is not touched.
