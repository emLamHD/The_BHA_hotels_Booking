# The BHA Hotels Booking

The BHA Hotels Booking is organized as a monorepo for the customer experience, a future administration experience, and the booking API.

## Repository layout

```text
.
|-- Back_End/
|   |-- TheBha.Booking.sln
|   |-- src/
|   |   |-- TheBha.Api/
|   |   |-- TheBha.Application/
|   |   |-- TheBha.Domain/
|   |   `-- TheBha.Infrastructure/
|   `-- tests/
|       |-- TheBha.UnitTests/
|       `-- TheBha.IntegrationTests/
|-- Front_End/
|   |-- Admin_Web/
|   `-- Customer_Web/
`-- docs/
    `-- ARCHITECTURE.md
```

## Applications

- `Front_End/Customer_Web` contains the existing Next.js customer template. Its source, dependency lockfile, theme attribution, and license-related notices are preserved in place. See its README for the original author attribution.
- `Front_End/Admin_Web` is reserved for the future administration application.
- `Back_End` contains an ASP.NET Core 8 Web API organized around Clean Architecture boundaries.

## Local development

Required toolchains:

- Node.js `22.23.1` with npm `10.x` for `Front_End/Customer_Web`.
- .NET SDK `8.0.423`; `global.json` permits roll-forward only within .NET 8.

Customer web:

```powershell
cd Front_End/Customer_Web
npm ci
npm run dev
```

Backend:

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
dotnet user-secrets set --project Back_End/src/TheBha.Api/TheBha.Api.csproj "ConnectionStrings:TheBhaDatabase" "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<your-local-password>"
cd Back_End
dotnet restore TheBha.Booking.sln
dotnet run --project src/TheBha.Api/TheBha.Api.csproj
```

With the API running in the Development environment:

- Health: `GET /health`
- Database readiness: `GET /health/ready`
- Swagger UI: `/swagger`
- OpenAPI document: `/swagger/v1/swagger.json`

See [docs/DATABASE.md](docs/DATABASE.md) for the complete PostgreSQL, User
Secrets, integration-test, and outage-recovery workflow.

## Local production simulation

Customer web:

```powershell
cd Front_End/Customer_Web
npm ci
npm run build
npm start
```

Backend API in the Development environment so that the Swagger quality gate is available:

```powershell
dotnet restore Back_End/TheBha.Booking.sln
dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run --project Back_End/src/TheBha.Api/TheBha.Api.csproj --configuration Release --no-build
```

## Current delivery scope

Local development and local production simulation are the current runtime targets. GitHub Actions CI is the automated quality gate and validates the reproducible frontend install/build plus the backend restore/build/test sequence.

Vercel deployment, public hosting, custom domains, hosting secrets, and continuous deployment are intentionally deferred. Vercel Preview is not a quality gate for the current foundation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for dependency rules and current architectural scope, and [docs/ADR/0002-use-postgresql.md](docs/ADR/0002-use-postgresql.md) for the persistence decision.
