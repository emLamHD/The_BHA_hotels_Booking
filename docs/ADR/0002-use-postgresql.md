# ADR 0002: Use PostgreSQL for backend persistence

- Status: Accepted
- Date: 2026-07-21

## Context

The ASP.NET Core API needs a relational persistence foundation that behaves the
same way in local development and continuous integration. The foundation must
support future domain modelling without inventing hotel or booking schema before
those business decisions are made.

Readiness must reflect whether the API can reach its database, while liveness
must continue to report whether the API process itself can serve requests.

## Decision

PostgreSQL 17 is the backend database. Local development uses the official
`postgres:17-alpine` image through Docker Compose with a named volume and a
`pg_isready` health check. Configuration is supplied through environment
variables; local `.env` files are ignored by Git.

The backend uses the stable EF Core 8-compatible Npgsql provider. The
`TheBhaDbContext` and dependency-registration extension live in
`TheBha.Infrastructure/Persistence`, and future migrations will be stored in the
`TheBha.Infrastructure` assembly.

The API reads `ConnectionStrings:TheBhaDatabase` from .NET User Secrets or an
environment variable. It neither calls `EnsureCreated()` nor applies migrations
at startup.

`GET /health` remains a database-independent liveness endpoint. The separate
`GET /health/ready` endpoint runs an EF Core database connectivity check and
returns an unhealthy status when PostgreSQL cannot be reached.

## Consequences

- Local and CI integration tests exercise PostgreSQL rather than an in-memory or
  SQLite substitute.
- API startup requires a configured connection string, but establishing a
  database connection remains deferred until a database-dependent operation or
  readiness check runs.
- Database outages do not make the liveness endpoint unhealthy; they do make the
  readiness endpoint unhealthy.
- Database credentials remain outside committed application configuration.
- Business entities, `DbSet` properties, migrations, seed data, and schema
  ownership decisions remain deferred.
