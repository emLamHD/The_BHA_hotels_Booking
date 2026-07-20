# Architecture

## Overview

The repository separates deployable applications under `Front_End` and `Back_End`. The customer-facing Next.js application remains independent from the ASP.NET Core API, while `Admin_Web` is intentionally only a placeholder.

The backend targets .NET 8 and starts with Clean Architecture project boundaries. It contains no fabricated hotel, room, booking, or payment domain model.

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

`TheBha.Api` uses ASP.NET Core controllers with nullable reference types and implicit usings enabled. Swagger/OpenAPI is available in the Development environment. `GET /health` provides a lightweight process-health endpoint, while `GET /health/ready` checks PostgreSQL connectivity through EF Core.

## Persistence foundation

`TheBha.Infrastructure/Persistence` owns `TheBhaDbContext` and the dependency-registration extension for EF Core 8 and Npgsql. The API supplies `ConnectionStrings:TheBhaDatabase` through external configuration. Future migrations belong to the `TheBha.Infrastructure` assembly, but no migration or business `DbSet` exists in the current foundation.

PostgreSQL 17 runs locally through Docker Compose with a named volume and is also used by the backend integration-test job in GitHub Actions. The API does not call `EnsureCreated()` or apply migrations during startup.

## Deliberately deferred decisions

Business persistence schema, MediatR, AutoMapper, FluentValidation, payment integrations, and business entities are not part of this foundation. They should be introduced only after the corresponding domain and operational requirements are defined.

## Current operational scope

The current targets are local development and local production simulation. GitHub Actions CI is the automated quality gate for frontend installation/build and backend restore/build/test.

Vercel, public hosting, custom domains, hosting secrets, and continuous deployment are deliberately deferred. This foundation does not define or run a deployment workflow.

## Front-end provenance

The customer web theme was relocated without changing its source or dependencies. Original theme attribution remains in `Front_End/Customer_Web/README.md` and must be preserved when the application evolves.
