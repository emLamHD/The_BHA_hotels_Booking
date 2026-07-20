# Database development guide

The backend persistence foundation uses PostgreSQL 17, EF Core 8, and Npgsql.
There is deliberately no business schema, migration, or seed data yet.

## Prerequisites

- .NET SDK 8, as pinned by `global.json`
- Docker Engine with Docker Compose
- PowerShell 7 or Windows PowerShell

Run all commands below from the repository root.

## Start PostgreSQL with Docker Compose

Create a local environment file and replace the example password before starting
the service. `.env` is ignored by Git and must not be committed.

```powershell
Copy-Item .env.example .env
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

Future migrations belong to `TheBha.Infrastructure`. The API does not create the
database schema with `EnsureCreated()` and does not automatically apply
migrations during startup. No migration should be added until a real business
schema has been approved.
