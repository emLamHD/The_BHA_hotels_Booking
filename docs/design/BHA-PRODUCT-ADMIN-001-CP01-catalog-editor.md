# Riverside property and room catalog editor (CP01)

## API and access

GET /api/admin/v1/catalog/properties lists persisted properties. The `/products` workspace first requests `GET /api/admin/v1/catalog/properties/{propertyId}/products`, a small property-scoped summary (counts and cover ID, no gallery) for each RoomType. It opens one editor only after a product is selected; the editor uses GET /api/admin/v1/catalog/properties/{propertyId} and /room-types/{roomTypeId}. Save posts editable content, owner-scoped amenities and ordered gallery to the matching /save route with expectedVersion. Upload posts one file to owner /media; POST .../amenities adds a simple amenity. Admin routes require HTTPS Staff session and global WebsiteSettingsManage; Calendar role or property membership grants no permission. Standard boundary checks Origin and JSON or explicitly allowed multipart. Actor comes from the Staff session. LocalGate closes these routes. Private thumbnails use owner-scoped Staff routes with nosniff; the public image route serves uploaded images only while linked.

The property identity formerly named `The BHA Hotel` with slug `the-bha-hotel` is also the Owner-confirmed Riverside Property. Keep its ID and slug; display it as `The BHA Riverside` and resolve that identity in Admin without creating another Property. Older `DLX-KING`/`FAMILY` types remain in a separate legacy sample section. House/Villa are unconfigured until persisted Property rows exist.

## Editable and read-only fields

Property: name, description, address, city, country, amenities and gallery. RoomType: name, description, nullable area, nullable bedroom count, nullable bed description, amenities and gallery. Stable IDs/codes/slugs, stock count, occupancy, active flag, time zone and check-in/out are read-only. No owner or physical room creation/deletion, rates, inventory, reservations or assignment state.

The editor writes existing content source columns (vi) and leaves WebsiteTranslations rows intact. Locale overrides remain authoritative in current localization resolution and are managed in the existing translation screen. Do not infer translated content from a new source value. A later Customer Web integration should preserve current per-locale override and default-language fallback behavior.

## Gallery and files

Existing Riverside photos are embedded at build time from the existing Customer Web media files for private Admin preview; database IDs, URLs, manifest links, cover and order are untouched. No Customer file or proxy changes. Uploaded files use WebsiteMedia:RootPath/catalog/<server-guid>.<jpg|png|webp> on persistent storage, with metadata in CatalogUploads. Back up this directory with PostgreSQL and restore the same volume after restart/redeploy. Unlinked media and bytes are retained; there is no physical deletion or garbage collection. Public uploaded-image URL works only while linked; legacy Media.Url remains an absolute HTTP(S) URL.

Admin resolves embedded seed bytes through an exact allowlisted Riverside media URL path after verifying the media is linked to the requested owner. It does not fetch `Media.Url`; this continues to work when a pre-existing Media row has a different ID from the manifest.

## Data and pricing

Save edits the shared Property/RoomType catalog, so public catalog readers may immediately reflect changed name, description, amenities, media order or alt. Public data is not isolated from Admin edits. Existing translations may override source columns. Date-based weekday, holiday and special-event pricing remains a later use of DailyRoomRate; CP01 does not change prices or inventory.

## Concurrency and audit

Each owner has a content version used as an EF concurrency token. Save compares expectedVersion, replaces only that owner's association rows in one DB transaction, writes content and append-only actor/owner/time/before/after audit, then returns persisted state. Stale saves are HTTP 409. The Admin draft keeps the version and baseline from the read that created it; unrelated refreshes (including creating an Amenity) do not rebase a dirty draft. Only a successful same-owner readback replaces the draft baseline. During Save and its readback, editor fields, gallery actions, owner switching and discard are locked. Discard clears that owner's local state; Save then switch and Continue editing remain separate choices.

If a Save or upload response is unverified, the old mutation is never retried. A successful same-owner readback clears the unknown state and replaces the draft with persisted values. Failed, superseded or wrong-owner reads leave it unresolved. For an upload whose response was lost, the gallery read can confirm only which files are linked; it cannot identify an unlinked staged file, so the editor says the old upload may exist and requires an intentional new selection. After a database write exception, the service removes staged bytes only when a fresh query confirms the upload metadata did not commit. If database state cannot be read, it retains the bytes to protect a possibly committed Media reference; this may leave an orphan for future operational cleanup.

Non-empty galleries require exactly one cover; removing it promotes the first remaining item. Unlinking never deletes global Media or files. Owner-scoped alt overrides prevent changing shared Media metadata. Draft gallery changes do not reach PostgreSQL until Save.

## Existing local Development property seed

The Riverside seed CLI keeps its default demo/showcase database-name guard. A separate, explicit existing-property opt-in requires `--allow-existing-local-property`, `--property-id`, `--expected-database` equal to `current_database()`, Development environment and a loopback PostgreSQL host. It resolves the exact existing Property ID, checks old/canonical Riverside identity and duplicate Hotel/Riverside slugs, renames only the display name, and adds only missing catalog rows/links. It preserves the existing slug, legacy room types, operational rows and operator-edited content. The seed window is finite and only fills missing daily rates in that window. Staging/Production, remote host, database mismatch and missing/mismatched opt-in flags are refused.

## C3 — Creating catalog parents and physical rooms

Three additive Staff-gated create routes now create a Property, a RoomType under a persisted Property, and a PhysicalRoom under a RoomType. All require `WebsiteSettingsManage`, use the authenticated Staff actor and the existing HTTPS/Origin/CSRF boundary. Parent IDs are resolved on the server; the physical-room route rejects a RoomType that belongs to another Property. Writes and their audit records share a transaction. Database uniqueness remains authoritative for slugs/codes and room numbers. Room numbers are unique per Property even across RoomTypes.

Each create request requires an `Idempotency-Key` UUID. A new `AdminCatalogCreateOperations` table records actor, operation ID, request fingerprint and created entity IDs in the same transaction as the entity and audit. Replaying the same operation and request returns the original entity; reusing its key with a different request conflicts. A PostgreSQL transaction advisory lock serializes simultaneous attempts with the same actor/key. No creation flow generates PhysicalRooms, RatePlans or DailyRoomRates implicitly. New records default inactive unless Staff explicitly selects Active.

The Property workspace contains all three create actions. RoomType cards show server summary counts and legacy Riverside samples remain in their own group. The detail screen lists actual PhysicalRooms for its Property and RoomType, with retry/loading/empty states; creating a room refreshes summaries after API acknowledgement/readback. An unresolved create operation keeps its request/key in Staff-scoped tab session storage and restores the confirmation dialog after a page reload, so retry uses the same server idempotency key. The existing content/gallery editor remains available. C3 does not add update/delete or bulk operational room management.

### C3-C1 correction — create CORS and recovery

The three create POST actions use a dedicated credentialed CORS policy for configured Admin origins. It allows `POST` and only `Content-Type` plus `Idempotency-Key`; the shared Staff login and Calendar/website write policies retain their existing headers. A rejected preflight prevents that browser attempt from sending its POST, but a JavaScript fetch rejection alone cannot distinguish that case from a lost response after commit.

When a create outcome is unknown, the pending record keeps its Staff actor, parent IDs, operation ID and original request payload. `Tiếp tục yêu cầu` resends that exact operation and may complete it if it did not previously commit; it is not a read-only check. A refusal during recovery does not clear the older unknown result. Hủy becomes available after a known refusal before any unknown attempt, while unknown operations remain locked until the same operation is confirmed. Reading the content editor does not resolve an unknown create.
