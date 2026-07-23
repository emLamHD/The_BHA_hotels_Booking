# Architecture

## Overview

The repository separates deployable applications under `Front_End` and `Back_End`. The customer-facing Next.js application remains independent from the ASP.NET Core API, while `Admin_Web` is intentionally only a placeholder.

The backend targets .NET 8 and uses Clean Architecture project boundaries. The
Domain contains catalog, pricing/inventory-control, and BE-003.2 transactional
Hold/Reservation structures. Booking workflows remain outside the delivered
Application and API layers.

## Backend dependency direction

```text
TheBha.Api ------------> TheBha.Application
    |                            |
    `--> TheBha.Infrastructure --+--> TheBha.Domain

TheBha.UnitTests ------> TheBha.Application + TheBha.Domain
TheBha.IntegrationTests -> TheBha.Api
```

Project reference rules:

- `TheBha.Domain` has no internal project references.
- `TheBha.Application` references only `TheBha.Domain`.
- `TheBha.Infrastructure` references `TheBha.Application` and `TheBha.Domain`.
- `TheBha.Api` references `TheBha.Application` and `TheBha.Infrastructure`.
- `TheBha.UnitTests` references `TheBha.Domain` and `TheBha.Application`.
- `TheBha.IntegrationTests` references `TheBha.Api`.

## API foundation

`TheBha.Api` uses ASP.NET Core controllers with nullable reference types and implicit usings enabled. Swagger/OpenAPI is available in the Development environment. `GET /health` provides a lightweight process-health endpoint, while `GET /health/ready` checks PostgreSQL connectivity through EF Core. Versioned customer catalog controllers depend on Application query contracts and return DTOs rather than EF entities. BE-003.1 composes customer cookie authentication, antiforgery, credentialed CORS, and authentication rate limits in this API layer.

## Persistence foundation

`TheBha.Infrastructure/Persistence` owns `TheBhaDbContext`, entity configurations,
read-query implementations, ASP.NET Core Identity Core and transactional booking
persistence, the explicit development seeder, and EF Core migrations. The API
supplies `ConnectionStrings:TheBhaDatabase` through external
configuration. PostgreSQL is the sole source of catalog data. The API does not
apply migrations or seed data during normal startup.

PostgreSQL 17 runs locally through Docker Compose with a named volume and is also used by the backend integration-test job in GitHub Actions. The API does not call `EnsureCreated()` or apply migrations during startup.

## Deliberately deferred decisions

MediatR, AutoMapper, FluentValidation, Hold/Reservation Application and API
workflows, guest-token transport, committed-demand changes, customer verification
and recovery, MFA, administration authentication, payment integrations,
housekeeping, and maintenance workflows
remain deliberately deferred.

## Current operational scope

The current targets are local development and local production simulation. GitHub Actions CI is the automated quality gate for frontend installation/build and backend restore/build/test.

Vercel, public hosting, custom domains, hosting secrets, and continuous deployment are deliberately deferred. This foundation does not define or run a deployment workflow.

## Front-end provenance

The customer web theme was relocated without changing its source or dependencies. Original theme attribution remains in `Front_End/Customer_Web/README.md` and must be preserved when the application evolves.
