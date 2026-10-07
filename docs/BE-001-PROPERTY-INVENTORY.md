# BE-001 Property and room inventory foundation

## Scope

BE-001 establishes the multi-property catalog and physical inventory foundation.
PostgreSQL is the only source of truth. Physical rooms are internal persistence
records and are not part of the customer API contract.

Availability by date, pricing, rate plans, reservations, guest profiles,
authentication, Admin CRUD, housekeeping, maintenance intervals, uploads, and
object storage are outside BE-001.

## Domain model

- `Property` owns identity, public hotel metadata, local operating times, active
  state, and timestamps. `Slug` is globally unique.
- `RoomType` belongs to one Property. `Code` and `Slug` are unique per Property.
  Base occupancy is positive and maximum occupancy cannot be lower than base
  occupancy.
- `PhysicalRoom` belongs to a Property and RoomType and carries room number,
  floor, and `Active`, `Inactive`, or `OutOfService` operational status. Room
  number is unique per Property. Operational status is not date-based
  availability.
- `Amenity` has a globally unique code and is associated relationally with
  Properties and RoomTypes.
- `Media` stores URL, alt text, type, and creation time. Property/RoomType media
  associations store `SortOrder` and `IsCover`; API ordering is `SortOrder` then
  media ID.

## Database relationships and safeguards

```text
Property 1 --- * RoomType 1 --- * PhysicalRoom
    |                |
    *                *
PropertyAmenity   RoomTypeAmenity --- Amenity
    |
PropertyMedia    RoomTypeMedia ---- Media
```

`RoomTypes` has alternate key `(PropertyId, Id)`. `PhysicalRooms` uses composite
foreign key `(PropertyId, RoomTypeId)` to that key, in addition to its Property
foreign key. This makes a cross-property room assignment impossible in the
database; the `PhysicalRoom` constructor protects the same invariant in the
domain.

Composite primary keys prevent duplicate amenity/media associations. PostgreSQL
check constraints protect occupancy, operational-status values, and non-negative
media sort order. Filtered unique indexes allow at most one cover media item per
Property or RoomType.

## Customer read API

| Endpoint | Response |
| --- | --- |
| `GET /api/v1/properties` | Active properties with amenities and ordered media |
| `GET /api/v1/properties/{propertyId}` | One active property or Problem Details 404 |
| `GET /api/v1/properties/{propertyId}/room-types` | Active room types for an active property, or 404 when the parent is not public |
| `GET /api/v1/room-types/{roomTypeId}` | One active room type whose parent is active, or 404 |

Property DTOs contain public identity, descriptive/address data, time zone,
check-in/check-out times, amenities, and media. RoomType DTOs contain public
identity, Property ID, descriptive data, occupancy, amenities, and media. Neither
shape contains PhysicalRoom, room number, floor, operational status, or physical
inventory collections.

Malformed GUID route values return RFC 7807 validation Problem Details with HTTP
400. Missing or inactive resources return RFC 7807 Problem Details with HTTP 404.
Swagger documents all four endpoints in Development.

## Local migration, seed, and tests

Configure the placeholder environment variable with a local-only credential:

```powershell
$env:ConnectionStrings__TheBhaDatabase = `
  "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<local-password>"
```

Apply the migration:

```powershell
dotnet ef database update `
  --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj `
  --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```

Run the explicit idempotent seed after migration:

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run --project Back_End/src/TheBha.Api/TheBha.Api.csproj -- --seed-development
```

Run the PostgreSQL-backed verification suite:

```powershell
dotnet restore Back_End/TheBha.Booking.sln
dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
```

The integration fixture derives an isolated temporary database from
`ConnectionStrings__TheBhaDatabase`, migrates it from clean state, and removes it
after the run. See `docs/DATABASE.md` for Docker Compose setup and readiness checks.
