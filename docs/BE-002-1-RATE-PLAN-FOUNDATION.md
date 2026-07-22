# BE-002.1 Property rate plan foundation

## Scope

`RatePlan` is a Property-owned definition that identifies a future bookable
commercial rate, such as a standard or flexible rate. This foundation stores no
daily price, inventory control, availability calculation, cancellation policy,
meal, tax, or refund behaviour.

## Domain model

Each RatePlan has an ID, Property ID, code, name, optional description, ISO-like
three-letter alphabetic currency code, active state, and creation/update
timestamps. Codes are trimmed and uppercased; names are trimmed; currency codes
are trimmed and uppercased. Empty IDs, Property IDs, codes, names, and currency
codes are rejected. `UpdatedAt` cannot move earlier than `CreatedAt` or a prior
lifecycle update.

RatePlan belongs to an existing Property. Code is unique within a Property and
may be reused by a different Property.

## Database safeguards

Migration `20260722102552_AddRatePlanFoundation` creates `RatePlans` with:

- a foreign key to `Properties(Id)`;
- alternate key `(PropertyId, Id)` for future property-scoped relationships;
- unique index `(PropertyId, Code)`;
- NOT NULL and length constraints for required values;
- PostgreSQL checks for non-blank code/name, uppercase three-letter currency,
  and `UpdatedAt >= CreatedAt`.

Apply migrations explicitly; the API neither calls `EnsureCreated()` nor applies
migrations during startup:

```powershell
dotnet ef database update `
  --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj `
  --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```

## Development seed and API scope

The existing explicit Development seed adds exactly one active RatePlan for The
BHA Hotel: `STANDARD`, `Standard Rate`, currency `VND`. It uses the existing
property/code natural-key check, so repeated seed runs do not create duplicates.

There is no RatePlan public or admin API, no write API, no daily pricing, and no
availability API in this work item.
