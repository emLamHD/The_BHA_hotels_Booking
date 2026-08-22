# Architecture

## Overview

The repository separates deployable applications under `Front_End` and `Back_End`. `Admin_Web` (`Front_End/Admin_Web`) is the imported TailAdmin 2.3.0 template on Next.js 16.1.6, React/React DOM 19.2.1, and TypeScript 5.9.3 (PR #30), on top of which `ADMIN-002.1` (PR #32) added an interactive PMS Reservation Board frontend prototype and a front-desk reservation-creation workspace on the `/calendar` page.

CURRENT frontend (PR #32): a room/date timeline with multi-property demo switching, assigned/unassigned reservations, operational blocks, reservation hover/detail views, drag-and-drop room moves, date shifting, negotiated pricing, a reservation-creation workspace, and a front-desk lifecycle/folio/notes/activity workspace — all driven by a centralized reducer (`reservationRuntime.ts`) over deterministic local mock state (`mockData.ts`, a fixed demo-clock anchor). None of this reads or writes real data: there is no backend call, no persistence, and every reload resets to the same mock baseline.

CURRENT backend: unchanged from BE-003 — the single-RoomType-per-booking `BookingHold`/`Reservation` model (§ below), exactly six PostgreSQL migrations, no PMS migration, no Admin authentication/RBAC, no OTA integration. The Admin frontend prototype is not connected to it.

TARGET architecture (unimplemented): Customer Web and Admin Web as separate clients of one shared ASP.NET Core backend and one shared PostgreSQL database, with the full multi-RoomType/physical-allocation PMS design, Admin authentication/RBAC, and OTA behavior. See [`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`](design/PMS-DATA-001-core-database-blueprint-v2.md), [ADR 0005](ADR/0005-separate-commercial-commitment-from-physical-allocation.md), and [ADR 0006](ADR/0006-schedule-physical-rooms-with-occupancy-segments.md) for the full target PMS design; this document does not duplicate it, and the CURRENT frontend prototype described above is not authoritative persistence or concurrency evidence for that TARGET design.

The backend targets .NET 8 and uses Clean Architecture project boundaries. The
Domain contains catalog, pricing/inventory-control, and transactional
Hold/Reservation structures. BE-003.3 adds the first booking workflow:
Application-level Hold request normalization and hashing, an API creation
endpoint, and Infrastructure-owned atomic PostgreSQL persistence.

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

`TheBha.Api` uses ASP.NET Core controllers with nullable reference types and implicit usings enabled. Swagger/OpenAPI is available in the Development environment. `GET /health` provides a lightweight process-health endpoint, while `GET /health/ready` checks PostgreSQL connectivity through EF Core. Versioned customer catalog controllers depend on Application query contracts and return DTOs rather than EF entities. BE-003.1 composes customer cookie authentication, antiforgery, credentialed CORS, and authentication rate limits in this API layer. `POST /api/v1/booking-holds` permits guest or cookie-authenticated callers while retaining the global antiforgery policy and returns only customer-safe Application DTOs. BE-003.5 completes the ownership-protected booking lifecycle with `GET /api/v1/booking-holds/{holdId}`, `POST /api/v1/booking-holds/{holdId}/cancel`, and `POST /api/v1/reservations/{reservationId}/cancel`; the two cancellation endpoints remain under the global antiforgery policy, while the GET endpoints do not require it.

## Persistence foundation

`TheBha.Infrastructure/Persistence` owns `TheBhaDbContext`, entity configurations,
read-query implementations, ASP.NET Core Identity Core and transactional booking
persistence, the explicit development seeder, and EF Core migrations. The API
supplies `ConnectionStrings:TheBhaDatabase` through external
configuration. PostgreSQL is the sole source of catalog and booking data.
Atomic Hold creation uses explicit transactions and parameterized
`pg_advisory_xact_lock` calls in Infrastructure; Application and Domain contain
no PostgreSQL dependency. BE-003.5 extends this same transaction/advisory-lock
contract to Hold cancellation and Reservation cancellation, reusing the
existing Hold-transition and per-night inventory lock keys in the same
lifecycle-then-inventory order. The API does not
apply migrations or seed data during normal startup.

PostgreSQL 17 runs locally through Docker Compose with a named volume and is also used by the backend integration-test job in GitHub Actions. The API does not call `EnsureCreated()` or apply migrations during startup.

## Deliberately deferred decisions

MediatR, AutoMapper, FluentValidation, customer verification
and recovery, MFA, administration authentication, payment integrations,
housekeeping, and maintenance workflows remain deliberately deferred. Hold
read, Hold confirmation, Reservation read, Hold cancellation, and Reservation
cancellation are delivered (BE-003.3–BE-003.5); a persisted `Expired` Hold
status and background expiry cleanup remain deliberately deferred, since
logical expiry is already correct without them.

## Current operational scope

The current targets are local development and local production simulation. GitHub Actions CI is the automated quality gate for frontend installation/build and backend restore/build/test.

Vercel, public hosting, custom domains, hosting secrets, and continuous deployment are deliberately deferred. This foundation does not define or run a deployment workflow.

## Front-end provenance

The customer web theme was relocated without changing its source or dependencies. Original theme attribution remains in `Front_End/Customer_Web/README.md` and must be preserved when the application evolves.
