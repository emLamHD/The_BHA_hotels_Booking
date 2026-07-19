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

Customer web:

```powershell
cd Front_End/Customer_Web
npm ci
npm run dev
```

Backend:

```powershell
cd Back_End
dotnet restore TheBha.Booking.sln
dotnet run --project src/TheBha.Api/TheBha.Api.csproj
```

With the API running in the Development environment:

- Health: `GET /health`
- Swagger UI: `/swagger`
- OpenAPI document: `/swagger/v1/swagger.json`

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for dependency rules and current architectural scope.
