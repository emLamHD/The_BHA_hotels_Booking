# BE-002.3 Daily room inventory controls

`DailyInventoryControl` applies one optional sellable limit and/or stop-sell flag
to a Property-owned RoomType for one `DateOnly` stay date. A nullable limit is
unrestricted; a present limit must be non-negative, including zero. A row with
neither a limit nor stop-sell is invalid and callers delete the row to return to
physical inventory defaults.

Migration `AddDailyInventoryControls` maps stay dates to PostgreSQL `date`, adds
the composite `(PropertyId, RoomTypeId)` ownership foreign key, unique index
`(PropertyId, RoomTypeId, StayDate)`, and checks for non-negative limits, a
meaningful effect, and ordered timestamps. A secondary `(PropertyId, StayDate)`
index supports future internal Property/date-range access; the unique index
already supports the primary Property/RoomType/date-range path. Deletes restrict.

Internal application commands create/update a control with `TimeProvider` or
delete it idempotently. No EF entity is returned. The reusable internal query
returns a half-open `CheckIn <= StayDate < CheckOut` breakdown and the minimum
inventory across the stay.

The formula is:

```text
BaseInventory = count(PhysicalRoom where OperationalStatus == Active)
EffectiveInventory = IsStopSell ? 0 : min(BaseInventory, SellableLimit ?? BaseInventory)
StayInventory = min(EffectiveInventory for every stay date)
```

Inactive and OutOfService rooms are excluded. Dates without controls use base
inventory. Stop-sell wins when a limit is also present. Results are computed
without persistence, ordered by StayDate, and expose no room IDs or room numbers.

The Development seed uses the existing `TimeProvider` and Property timezone. It
adds one demo limit below physical inventory and one demo stop-sell inside the
rolling 14-night window. Repeated runs do not duplicate or overwrite customized
controls. These are development/demo controls only.

Apply and test explicitly:

```powershell
dotnet ef database update --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
dotnet test Back_End/TheBha.Booking.sln --configuration Release
```

This work does not subtract reservations, holds, booked or committed quantity;
does not prevent overbooking; persists no `IsAvailable`; exposes no public
availability/admin API; changes no frontend; and is not BE-002.4 or BE-003.
