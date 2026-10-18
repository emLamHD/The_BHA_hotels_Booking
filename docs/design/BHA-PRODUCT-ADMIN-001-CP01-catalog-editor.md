# Riverside property and room catalog editor (CP01)

## API and access

GET /api/admin/v1/catalog/properties lists persisted properties. Detail uses GET /api/admin/v1/catalog/properties/{propertyId} and /room-types/{roomTypeId}. Save posts the editable content, owner-scoped amenities and ordered gallery to the matching /save route with expectedVersion. Upload posts one file to owner /media; POST .../amenities adds a simple amenity. Admin routes require HTTPS Staff session and global WebsiteSettingsManage; Calendar role or property membership grants no permission. Standard boundary checks Origin and JSON or explicitly allowed multipart. Actor comes from the Staff session. LocalGate closes these routes. Private thumbnails use owner-scoped Staff routes with nosniff; the public image route serves uploaded images only while linked.

## Editable and read-only fields

Property: name, description, address, city, country, amenities and gallery. RoomType: name, description, nullable area, nullable bedroom count, nullable bed description, amenities and gallery. Stable IDs/codes/slugs, stock count, occupancy, active flag, time zone and check-in/out are read-only. No owner or physical room creation/deletion, rates, inventory, reservations or assignment state.

The editor writes existing content source columns (vi) and leaves WebsiteTranslations rows intact. Locale overrides remain authoritative in current localization resolution and are managed in the existing translation screen. Do not infer translated content from a new source value. A later Customer Web integration should preserve current per-locale override and default-language fallback behavior.

## Gallery and files

Existing Riverside photos are embedded at build time from the existing Customer Web media files for private Admin preview; database IDs, URLs, manifest links, cover and order are untouched. No Customer file or proxy changes. Uploaded files use WebsiteMedia:RootPath/catalog/<server-guid>.<jpg|png|webp> on persistent storage, with metadata in CatalogUploads. Back up this directory with PostgreSQL and restore the same volume after restart/redeploy. Unlinked media and bytes are retained; there is no physical deletion or garbage collection. Public uploaded-image URL works only while linked; legacy Media.Url remains an absolute HTTP(S) URL.

## Data and pricing

Save edits the shared Property/RoomType catalog, so public catalog readers may immediately reflect changed name, description, amenities, media order or alt. Public data is not isolated from Admin edits. Existing translations may override source columns. Date-based weekday, holiday and special-event pricing remains a later use of DailyRoomRate; CP01 does not change prices or inventory.

## Concurrency and audit

Each owner has a content version used as an EF concurrency token. Save compares expectedVersion, replaces only that owner's association rows in one DB transaction, writes content and append-only actor/owner/time/before/after audit, then returns persisted state. Stale saves are HTTP 409. Non-empty galleries require exactly one cover; removing it promotes the first remaining item. Unlinking never deletes global Media or files. A timeout after a mutation is not retried; read state before saving again.
