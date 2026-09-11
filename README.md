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
- `Front_End/Admin_Web` contains the imported TailAdmin Next.js template baseline for the future administration application. It is template-only and not yet integrated with backend/PMS business behavior. See its README for upstream attribution and license.
- `Back_End` contains an ASP.NET Core 8 Web API organized around Clean Architecture boundaries.

## Local development

Required toolchains:

- Node.js `22.23.1` with npm `10.x` for `Front_End/Customer_Web`.
- .NET SDK `8.0.423`; `global.json` permits roll-forward only within .NET 8.

Customer web:

```powershell
cd Front_End/Customer_Web
Copy-Item -LiteralPath .env.local.example -Destination .env.local
npm ci
npm run dev
```

`NEXT_PUBLIC_API_BASE_URL` (set in `.env.local`, default
`http://localhost:5145`) configures the shared Axios API client in
`src/lib/api`. Run `npm test` for the frontend's Vitest suite (Node
environment, no browser dependencies). See
[docs/FE-001-1-AXIOS-PROPERTY-UI.md](docs/FE-001-1-AXIOS-PROPERTY-UI.md) for
the Axios foundation, the live Property UI at `/home-2`, and manual UI
verification steps.

Backend:

```powershell
if (Test-Path -LiteralPath .env) {
    throw "STOP: .env already exists and was not overwritten."
}

Copy-Item -LiteralPath .env.example -Destination .env
docker compose up -d postgres
dotnet user-secrets set --project Back_End/src/TheBha.Api/TheBha.Api.csproj "ConnectionStrings:TheBhaDatabase" "Host=localhost;Port=5432;Database=thebha;Username=thebha;Password=<your-local-password>"
cd Back_End
dotnet restore TheBha.Booking.sln
dotnet ef database update --project src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project src/TheBha.Api/TheBha.Api.csproj
dotnet run --project src/TheBha.Api/TheBha.Api.csproj
```

With the API running in the Development environment:

- Health: `GET /health`
- Database readiness: `GET /health/ready`
- Swagger UI: `/swagger`
- OpenAPI document: `/swagger/v1/swagger.json`

See [docs/DATABASE.md](docs/DATABASE.md) for the complete PostgreSQL, User
Secrets, integration-test, and outage-recovery workflow.

The customer property catalog is exposed at `/api/v1/properties` and
`/api/v1/room-types/{roomTypeId}`. See
[docs/BE-001-PROPERTY-INVENTORY.md](docs/BE-001-PROPERTY-INVENTORY.md) for the
domain, schema, API contracts, migration, and explicit development-seed workflow.
See [docs/BE-002-1-RATE-PLAN-FOUNDATION.md](docs/BE-002-1-RATE-PLAN-FOUNDATION.md)
for the Property rate-plan foundation.
See [docs/BE-003-1-CUSTOMER-BOOKING-IDENTITY.md](docs/BE-003-1-CUSTOMER-BOOKING-IDENTITY.md)
for the customer Identity Core, cookie-session, antiforgery, CORS, rate-limit,
and Data Protection contract.
See [docs/BE-003-2-HOLD-RESERVATION-DOMAIN-FOUNDATION.md](docs/BE-003-2-HOLD-RESERVATION-DOMAIN-FOUNDATION.md)
for the persistence-ready Hold and Reservation aggregates and schema foundation.
See [docs/BE-003-3-ATOMIC-BOOKING-HOLD.md](docs/BE-003-3-ATOMIC-BOOKING-HOLD.md)
for atomic server-priced Hold creation, idempotent replay, and the
PostgreSQL advisory-lock and committed-demand contract.
See [docs/BE-003-4-HOLD-CONFIRMATION-RESERVATION-READ.md](docs/BE-003-4-HOLD-CONFIRMATION-RESERVATION-READ.md)
for the Hold confirmation, idempotent replay, and ownership-protected
Reservation read contract.
See [docs/BE-003-5-CANCELLATION-LIFECYCLE-HARDENING.md](docs/BE-003-5-CANCELLATION-LIFECYCLE-HARDENING.md)
for the Hold read, Hold cancellation, and Reservation cancellation contract
that closes the BE-003 reservation lifecycle.

### Admin Calendar local gates

The Admin Calendar surface has no authentication or RBAC yet, so both of its
opt-ins are **same-machine development only**, default to `false` everywhere
(including Development), and are fatal at startup in Production:

| Environment variable | Opens |
|---|---|
| `AdminCalendar__EnableUnauthenticatedRead` | the Reservation Board read endpoint |
| `AdminCalendar__EnableUnauthenticatedWrite` | the Admin Calendar write boundary |

They are independent — turning one on never turns the other on — and neither
is set by any checked-in `appsettings` file. The read opt-in is set by the
`https` launch profile; the write opt-in is set only by an explicit local
environment variable, and only for as long as you need it:

```powershell
$env:AdminCalendar__EnableUnauthenticatedWrite = "true"
dotnet run --project Back_End/src/TheBha.Api/TheBha.Api.csproj --launch-profile https
```

```bash
AdminCalendar__EnableUnauthenticatedWrite=true \
  dotnet run --project Back_End/src/TheBha.Api/TheBha.Api.csproj --launch-profile https
```

Turn it back off by removing the variable (`Remove-Item Env:\AdminCalendar__EnableUnauthenticatedWrite`)
and restarting the API. Both directions need a restart: the write gate reads
this flag once, at startup, and never re-reads configuration per request, so
changing it in a running process has no effect at all.

Even with the flag on, a request reaches the write boundary only when it is
HTTPS, on a Development host, loopback at both ends of the connection, free of
any `Forwarded`/`X-Forwarded-*` header, and carries exactly one `Origin` header
matching a configured `Cors:AdminOrigins` entry (`https://localhost:3001` in
`appsettings.Development.json`) with `Content-Type: application/json` — with no
parameters, or with `charset=utf-8` and nothing else. Any other encoding,
including ones .NET recognizes such as `us-ascii` or UTF-16, is refused: the
JSON the Admin client sends is UTF-8, and the gate accepts exactly what the
action behind it can read. Anything else is refused before the request body is
read.

Run the API directly over HTTPS on `localhost` — never behind a LAN listener, a
tunnel, or a public reverse proxy. The forwarded-header refusal is not a proxy
detector: a proxy that strips every trace of itself is indistinguishable from a
direct client, so keeping the local API un-proxied is a condition of running it,
not something the code can enforce.

`PMS-CAL-001.2-CP01` adds this gate only. Enabling the write flag exposes **no**
assignment, move, or block API — no such endpoint exists yet.

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
