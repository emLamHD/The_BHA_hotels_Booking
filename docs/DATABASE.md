# Database development guide

The backend persistence layer uses PostgreSQL 17, EF Core 8, and Npgsql. BE-001
adds the first business migration for Property, RoomType, PhysicalRoom, Amenity,
and Media metadata.

## Prerequisites

- .NET SDK 8, as pinned by `global.json`
- Docker Engine with Docker Compose
- PowerShell 7 or Windows PowerShell

Run all commands below from the repository root.

## Start PostgreSQL with Docker Compose

Create a local environment file and replace the example password before starting
the service. `.env` is ignored by Git and must not be committed.

```powershell
if (Test-Path -LiteralPath .env) {
    throw "STOP: .env already exists and was not overwritten."
}

Copy-Item -LiteralPath .env.example -Destination .env
notepad .env
docker compose config
docker compose up -d postgres
docker compose ps
```

The `postgres` service is ready when `docker compose ps` reports `healthy`.
Database files are stored in the named `the-bha_postgresql-data` volume. Stop the
service without deleting that volume:

```powershell
docker compose stop postgres
```

Do not use `docker compose down --volumes` unless data deletion is intentional.

## Configure the API with .NET User Secrets

Use the same database name, user, password, and port configured in your local
`.env` file. The project already has a User Secrets identifier.

```powershell
dotnet user-secrets set `
  --project Back_End/src/TheBha.Api/TheBha.Api.csproj `
  "ConnectionStrings:TheBhaDatabase" `
  "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<your-local-password>"
```

List only the configured secret keys when troubleshooting. Avoid copying secret
values into issue reports or logs.

Alternatively, configure the connection string for the current PowerShell
session with the ASP.NET Core environment-variable form:

```powershell
$env:ConnectionStrings__TheBhaDatabase = `
  "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<your-local-password>"
```

## Restore, build, test, and run

Integration tests require a real running PostgreSQL instance. Set their explicit
connection string before running the solution tests:

```powershell
$env:ConnectionStrings__TheBhaDatabase = `
  "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<your-local-password>"

dotnet restore Back_End/TheBha.Booking.sln
dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
```

Integration tests create a uniquely named database on the configured PostgreSQL
server, apply all migrations, run the tests, and drop that database. The configured
test user therefore needs permission to create databases. Tests never use EF
InMemory or SQLite.

## Apply the business migration

Install an EF Core CLI compatible with EF Core 8, then apply migrations explicitly:

```powershell
dotnet ef database update `
  --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj `
  --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```

The current migration chain is:

1. `20260721175848_InitialPropertyRoomInventory`
2. `20260722102552_AddRatePlanFoundation`
3. `20260722112304_AddDailyRoomRates`
4. `20260722121010_AddDailyInventoryControls`
5. `20260723085814_CustomerBookingIdentity`
6. `20260723105404_AddBookingHoldReservationFoundation`
7. `20260823084717_CommercialCommitmentV2Foundation`
8. `20260826035254_PhysicalRoomScheduleAvailabilityAuthority`
9. `20261001141847_AddStaffIdentityFoundation`
10. `20261015050047_AddWebsiteLocalizationSettings`
11. `20261015095908_AddRuntimeLanguagePacks`
12. `20261016014037_AddWebsiteMenus`
13. `20261017084454_AddWebsiteHero`

`PMS-BE-001.1` (migration 7) replaces the single-RoomType `BookingHold`/
`BookingHoldNight` and `Reservation`/`ReservationNight` commercial authority
with the normalized `InventoryHold → InventoryHoldItem →
InventoryHoldItemNight` and `Reservation → ReservationUnit →
ReservationUnitNight` authority (ADR 0005): every persisted Item/Unit
represents exactly one room, and every nightly row carries its own
`RatePlanId` and accepted money. The public `/api/v1` contract is unchanged
— a request still carries one `RoomTypeId`, one `RatePlanId`, and
`rooms = Q`; the Hold-creation transaction normalizes it atomically into `Q`
independent Items, and `BookingHoldDto`/`ReservationDto` are projected from
the normalized rows. Multi-RoomType public requests, `RoomOccupancySegment`
physical allocation, and OTA remain TARGET/unimplemented — see
`docs/design/PMS-DATA-001-core-database-blueprint-v2.md` and
`docs/ADR/0005-separate-commercial-commitment-from-physical-allocation.md`.
The migration performs a single-transaction expand → transform → contract
cutover: legacy `BookingHolds`/`BookingHoldNights`/`ReservationNights` data
is deterministically backfilled into the normalized tables (Item/Unit ids
derived from `(source aggregate id, 1-based room ordinal)`), fail-fast
validated (counts, totals, source Item→Unit mapping, Property consistency),
and only then are the legacy tables/columns dropped — no dual-write and no
dormant table exist after this migration. `Down()` is a guarded reverse
transform: it only succeeds while every Hold/Reservation's Items/Units share
one RoomType and one RatePlan per stay date (the only shape this work item's
single-RoomType-per-request creation path ever produces), and fails before
dropping any normalized data otherwise.

BE-003.3 adds no migration. Atomic Hold creation reuses the sixth migration's
unique idempotency-hash safeguard and booking demand indexes. It acquires
parameterized, transaction-scoped PostgreSQL advisory locks for idempotency and
for each Property/RoomType/stay-date inventory identity before re-reading price,
inventory controls, and committed demand. The complete lock-key algorithm is
recorded in `docs/BE-003-3-ATOMIC-BOOKING-HOLD.md`.

BE-003.5 (Hold read/cancellation and Reservation cancellation) also adds no
migration. It reuses the sixth migration's `Cancelled` status values,
`CancelledAtUtc`/`CancellationReason` columns, and cancellation consistency
check constraint, and extends the existing Hold-transition and per-night
inventory advisory-lock keys to the two cancellation workflows in the same
lifecycle-then-inventory lock order already used by confirmation. See
`docs/BE-003-5-CANCELLATION-LIFECYCLE-HARDENING.md` for the complete
contract.

`PMS-BE-001.2` (migration 8, `PhysicalRoomScheduleAvailabilityAuthority`)
adds the `RoomOccupancySegments`, `RoomBlocks`, and
`RoomOccupancySegmentAudits` tables (ADR 0006): exactly two PostgreSQL
exclusion constraints (`EX_RoomOccupancySegments_EffectiveRoomOverlap`,
`EX_RoomOccupancySegments_EffectiveUnitOverlap`) backed by the `btree_gist`
extension, and two `DEFERRABLE INITIALLY DEFERRED` constraint triggers
enforcing booked-night coverage (`SQLSTATE XBHA1`) and unit-commitment
consistency (`SQLSTATE XBHA2`). `Up()` also adds a `PhysicalRooms`
alternate key on `(PropertyId, Id)` so `RoomOccupancySegments` can enforce
same-Property consistency through composite foreign keys rather than
application-level checks alone. `Down()` is guarded: it only succeeds while
`RoomOccupancySegments`/`RoomBlocks`/`RoomOccupancySegmentAudits` are all
empty, and fails atomically otherwise, before dropping any data. No
Organization table, no HTTP/Admin endpoint, and no Admin
authentication/RBAC model are introduced by this migration. See
`docs/reports/PMS-BE-001.2-completion.md` for the complete contract and
test evidence.

`PMS-ADMIN-AUTH-001-CP01` (migration 9, `AddStaffIdentityFoundation`) adds
`StaffAccounts` (a separate Identity user table: unique normalized email and
user name, `IsActive`/`DisabledAtUtc` consistency check) and
`StaffPropertyMemberships` (primary key `(StaffAccountId, PropertyId)`,
`Role` checked to `FrontDesk`/`Manager`, `Restrict` foreign keys to both
parents) — ADR 0007. Customer tables are unchanged. `Down()` is guarded: it
fails atomically while either new table has rows. No Staff sign-in, endpoint
or bootstrap command exists yet, and the seed creates no Staff.

`CUST-WEB-HEADER-001-CP02` (migration 10, `AddWebsiteLocalizationSettings`)
adds `WebsiteLanguages`, `WebsiteTranslations`, `WebsiteCurrencies` and the
column `StaffAccounts.CanManageWebsite boolean NOT NULL DEFAULT false`
(ADR 0008). Existing rows are untouched: the new column defaults to `false`,
so no Staff account gains the permission. The migration freezes its own seed
(language `vi` active and default; `en` present but off with 25 managed keys;
currency VND base/default/on with rate 1; USD and EUR off with no rate; 50
translation rows) and installs CHECK constraints, partial unique indexes and
two `DEFERRABLE INITIALLY DEFERRED` constraint triggers (`SQLSTATE XBHA3`,
`XBHA4`) that keep exactly one default language and one default currency.
`VndPerUnit` is `numeric(20,8)`: VND per one unit of the currency. `Down()` is
guarded: it fails atomically if any account holds the permission, any language
other than `vi`/`en` or currency other than VND/USD/EUR exists, or any
language, currency or translation row has a version above 1 or belongs to a
non-seed language. It does **not** detect the deletion of a seed row that was
never edited (for example clearing one seed `en` translation or deleting USD
leaves every remaining row at version 1), so a rollback after such a deletion
silently drops the remaining seed. Design: `docs/design/CUST-WEB-HEADER-001-CP02-website-localization-settings.md`.

`CUST-WEB-HEADER-001-CP02-C2/R1` (migration 11, `AddRuntimeLanguagePacks`)
turns the language data into **runtime language packs**: `WebsiteLanguages`
gains `PackId`, `PackVersion`, `Direction` (`ltr`/`rtl`), `FormatLocale` (the
BCP 47 tag used by `Intl` for dates and numbers) and `DefaultCurrencyCode`
(the display currency a visitor gets with that language until they choose
another); `WebsiteTranslations` gains `SourceHash` (hash of the reference text
a translation was made from, so an edited source marks it stale) and
`IsManual` (an Admin edit that a later pack import keeps unless the operator
chooses "overwrite"). `Value` becomes `varchar(4000)` and the two CHECK
constraints on `Key`/`Value` of migration 10 are dropped (the server validates
keys against the pack catalog and messages as ICU syntax). Existing keys are
renamed into the catalog's naming and the 50 seed translation rows of migration
10 are removed: the seed languages `vi`/`en` stay, and the texts come back when
the built-in packs are installed from the Admin. No currency or booking row is
changed, and **no booking amount is ever stored in another currency**:
reservations stay in VND. `Down()` raises an exception while installed packs or
administered translations exist. The migration adds no rates; rates are
entered by the operator in the Admin (see `docs/runbooks/CUST-WEB-HEADER-001-languages-and-rates.md`). Apply it
with the normal `dotnet ef database update` command; apply order is 10 → 11.
Design: `docs/design/CUST-WEB-HEADER-001-CP02-website-localization-settings.md` §9.

`CUST-WEB-HEADER-001-CP04` (migration 12, `AddWebsiteMenus`) adds the site-wide
header navigation: `WebsiteMenuItems` (`Id`, `ParentId` self-FK `RESTRICT`,
`Placement` `primary`/`secondary` for a root and `NULL` for a child, `SortOrder`,
`Label` = the Vietnamese text, `Href`, `OpenInNewTab`, `IsEnabled`) and the
one-row `WebsiteMenu` (`Version`, `UpdatedAtUtc`, `UpdatedByStaffId`) that
versions the whole tree. CHECKs: a root has a placement and a child has none, no
row is its own parent, label 1–80 characters, link 1–2048 characters without
whitespace, control character or backslash. Cycle and depth (≤ 4) rules need the
whole tree and are enforced by the Save under the website advisory lock. The
other languages' labels are not columns: they are `WebsiteTranslations` rows keyed
`content.menuItem.<id>.label`, so packs, coverage and the Translations screen carry
them by the entry's stable id. The migration seeds, once, the menu the header showed
before (plus FAQ after Blog: 54 entries with fixed ids) and, for the languages that
exist when it runs, their `en`/`fr` labels (108 rows); nothing re-seeds at startup
and a re-run never overwrites an edit. `Down()` removes the menu tables and the
label rows. No booking, customer, staff, language, currency or rate row is changed
(counts before/after are in the CP04 report). Apply with the normal
`dotnet ef database update`; order 11 → 12. Design:
`docs/design/CUST-WEB-HEADER-001-CP04-dynamic-menus-faq.md`.

`CUST-WEB-HERO-001-CP01` (migration 13, `AddWebsiteHero`) adds the home page hero:
`WebsiteHeroMedia` (`Id` server-generated, `Kind` `seed`/`upload`, `StorageKey`
relative — `seed/<file>` or `hero/<id>.<ext>`, never a disk path — `ContentType`
`image/jpeg|png|webp`, `ByteSize` ≤ 10 MB, `Width`/`Height` ≤ 8000, who/when),
`WebsiteHeroSlides` (`Id`, `MediaId` FK `RESTRICT`, unique `SortOrder` 0–9,
`FocalPosition` `"40% 50%"`, the Vietnamese `Alt` ≤ 200 and `Caption` ≤ 60) and the
one-row `WebsiteHero` (`Version`, `FontKey` one of four tokens, `AutoplayEnabled`,
`IntervalSeconds` 3–60, the Vietnamese title ≤ 80, description ≤ 160 and two button
labels ≤ 24, `UpdatedAtUtc/By`) that versions the whole hero. Other languages' texts
are `WebsiteTranslations` rows keyed `content.heroSlideshow.main.<field>` and
`content.heroSlide.<slideId>.{alt|caption}`. The file bytes are not in the database:
uploads are files under `WebsiteMedia:RootPath` (see
`docs/runbooks/CUST-WEB-HERO-001-hero-media.md`); a recorded picture is never deleted
by the application. The migration seeds, once, the four built-in photographs (fixed
ids; their files are embedded in `TheBha.Infrastructure`), the current texts and order
(autoplay on, 6 s, default font) and, for the languages that exist when it runs, their
`en`/`fr` texts (12 rows each); nothing re-seeds at startup and a re-run never
overwrites an edit. `Down()` removes the three tables and the hero's text rows (files
on disk stay). No booking, customer, staff, menu, language, currency or rate row is
changed (per-table counts before/after on a populated 12 → 13 migration are in the
report). Apply with the normal `dotnet ef database update`; order 12 → 13. Design:
`docs/design/CUST-WEB-HERO-001-CP01-admin-hero-slideshow.md`.

Run the update command before the development seed. The API never calls
`EnsureCreated()` and never applies a migration during startup.

Migration 14 (`AddWebsiteSocialSettings`) adds the singleton
`WebsiteSocialSettings` table for the floating Customer contact actions. Its one-time
seed enables Phone (`0899474888`, normalized `tel:+84899474888`) and Back to top;
Messenger and Zalo start disabled with no destination. The row carries a revision,
updated timestamp and optional Staff audit actor. Admin saves replace the settings
atomically; normal startup never inserts or overwrites the row.

## Run the explicit development seed

After applying migrations, run the seed only in Development:

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run `
  --project Back_End/src/TheBha.Api/TheBha.Api.csproj `
  -- `
  --seed-development
```

The command creates The BHA Hotel, two room types, one `STANDARD`/`VND` rate
plan, three physical rooms, a rolling 14-night demo rate window, two demo
inventory controls, amenities, media metadata, and their associations. It uses
natural-key checks and database uniqueness constraints, so running it a second
time does not create duplicates or overwrite customized rates and controls. It
does not run in production, does not run during normal API startup, and does not
apply migrations.

Run the API after configuring `ConnectionStrings:TheBhaDatabase` through User
Secrets or the environment variable shown above:

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run `
  --project Back_End/src/TheBha.Api/TheBha.Api.csproj `
  --configuration Release `
  --no-build
```

## Check liveness, readiness, and OpenAPI

With the API listening on its default HTTP launch-profile URL:

```powershell
(Invoke-WebRequest http://localhost:5145/health).StatusCode
(Invoke-WebRequest http://localhost:5145/health/ready).StatusCode
(Invoke-WebRequest http://localhost:5145/swagger/v1/swagger.json).StatusCode
```

All three requests return HTTP 200 while PostgreSQL is healthy. To verify outage
behaviour without removing the named volume:

```powershell
docker compose stop postgres
(Invoke-WebRequest http://localhost:5145/health).StatusCode

try {
  (Invoke-WebRequest http://localhost:5145/health/ready).StatusCode
} catch {
  [int]$_.Exception.Response.StatusCode
}

docker compose start postgres
docker compose ps
(Invoke-WebRequest http://localhost:5145/health/ready).StatusCode
```

During the outage, liveness remains HTTP 200 and readiness returns HTTP 503.
After PostgreSQL becomes healthy again, readiness returns HTTP 200.

## Migration policy

Migrations belong to `TheBha.Infrastructure`. The API does not create the database
schema with `EnsureCreated()` and does not automatically apply migrations during
startup. Schema changes require an approved work item and PostgreSQL integration
evidence.
