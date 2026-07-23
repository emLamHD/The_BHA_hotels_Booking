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

BE-003.3 adds no migration. Atomic Hold creation reuses the sixth migration's
unique idempotency-hash safeguard and booking demand indexes. It acquires
parameterized, transaction-scoped PostgreSQL advisory locks for idempotency and
for each Property/RoomType/stay-date inventory identity before re-reading price,
inventory controls, and committed demand. The complete lock-key algorithm is
recorded in `docs/BE-003-3-ATOMIC-BOOKING-HOLD.md`.

Run the update command before the development seed. The API never calls
`EnsureCreated()` and never applies a migration during startup.

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
