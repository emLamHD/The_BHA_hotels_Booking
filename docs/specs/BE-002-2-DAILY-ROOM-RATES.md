# BE-002.2 Daily room rate pricing

`DailyRoomRate` stores one positive nightly amount for a Property, RoomType,
RatePlan, and `DateOnly` stay date. `StayDate` maps to PostgreSQL `date` and is
the night stayed, not a UTC timestamp. Amount maps to `numeric(18,2)`; currency
is owned by RatePlan and is not duplicated on DailyRoomRate.

Migration `AddDailyRoomRates` adds composite foreign keys from `(PropertyId,
RoomTypeId)` and `(PropertyId, RatePlanId)` to the existing property-scoped
alternate keys. It also adds the unique nightly key `(PropertyId, RoomTypeId,
RatePlanId, StayDate)`, amount/timestamp checks, and indexes for Property/date,
Property/RoomType/date, and Property/RatePlan/date range reads. Deletes restrict.

The application set operation creates or updates the same rate identity after
checking Property ownership. The internal range query returns application DTOs
for `CheckIn <= StayDate < CheckOut`, ordered by StayDate, using a no-tracking
read. Missing dates are not synthesized and there is no fallback price or total
stay calculation. Neither application contract has an API endpoint.

The Development-only seed uses `TimeProvider`, converts its current instant to
the Property timezone, and creates a 14-night rolling window for the existing
`STANDARD`/`VND` plan and both sample room types. These are demo prices, not
production prices; existing prices are preserved on repeated runs.

Apply explicitly:

```powershell
dotnet ef database update --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```

There is no availability API, inventory control, reservation, hold, or public/admin
write API in this work item.
