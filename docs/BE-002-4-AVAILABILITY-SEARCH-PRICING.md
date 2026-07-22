# BE-002.4 Availability search and stay pricing

The public customer endpoint is:

```http
GET /api/v1/properties/{propertyId}/availability?checkIn=2026-07-23&checkOut=2026-07-25&adults=2&children=0&rooms=1
```

`checkIn` and `checkOut` use ISO `YYYY-MM-DD` hotel dates. The range is
half-open (`checkIn <= StayDate < checkOut`), so checkout is not priced and
does not consume inventory. The request requires at least one adult, permits
zero or more children, and requires at least one room. A stay is limited to 30
nights and a request to 10 rooms. Check-in may be the Property's current local
date but cannot be earlier. The current date is derived from `TimeProvider` and
the IANA/Windows-compatible `Property.TimeZone`, rather than from the UTC date.

Malformed or missing identifiers, dates, or query parameters and business-rule
violations return HTTP 400 Problem Details. A missing or inactive Property
returns HTTP 404. A valid active Property with no qualifying offers returns HTTP
200 with an empty JSON array.

## Offer rules

Each offer uses a single active RoomType and active RatePlan for every requested
room. Occupancy is eligible when:

```text
Adults + Children <= RoomType.MaxOccupancy * Rooms
```

Children count as people. There is no mixed-RoomType allocation, child discount,
occupancy pricing, or extra-person surcharge.

An offer requires exactly one `DailyRoomRate` for every stay date. Missing nights
remove only that RoomType/RatePlan offer; there is no fallback or zero/default
price. Nightly prices are ordered by stay date, currency comes exclusively from
the RatePlan, and decimal totals are:

```text
TotalAmount = sum(NightlyRates.Amount) * Rooms
```

Inventory is a query-time calculation:

```text
BaseInventory = count(PhysicalRoom where OperationalStatus == Active)
NightInventory = IsStopSell ? 0 : min(BaseInventory, SellableLimit ?? BaseInventory)
AvailableRooms = min(NightInventory for every stay date)
```

Inactive and OutOfService rooms do not contribute. Dates without a control use
base inventory. A stop-sell on any night removes all offers for that RoomType for
the stay. An offer is returned when `AvailableRooms >= Rooms`; `AvailableRooms`
is the minimum before requested rooms are subtracted.

Offers include customer-facing RoomType media, the RatePlan and currency,
nightly price breakdown, total price, and available inventory. They never expose
PhysicalRoom IDs, room numbers, floors, operational state, controls, or EF
entities. Results are stably ordered by RoomType code, RatePlan code, then IDs.

## Read strategy and snapshot semantics

Infrastructure performs seven bounded, `AsNoTracking` PostgreSQL queries: active
Property, active RoomTypes, RoomType media, active RatePlans, rates in the date
range, grouped Active PhysicalRoom counts, and controls in the date range. The
query count does not grow with the number of RoomType/RatePlan/day candidates;
application code combines projected read models in memory. Every query and the
HTTP endpoint propagate `CancellationToken`.

The response is only an availability snapshot. It does not reserve rooms and
does not subtract reservations, holds, booked quantity, or committed inventory.
It provides no overbooking concurrency protection, payment, conversion, tax,
discount, or surcharge. Availability may change immediately after the response;
BE-003 will introduce committed inventory and concurrency protection.

## Example response

```json
[
  {
    "propertyId": "10000000-0000-0000-0000-000000000001",
    "roomTypeId": "20000000-0000-0000-0000-000000000001",
    "roomTypeCode": "DLX-KING",
    "roomTypeName": "Deluxe King",
    "ratePlanId": "50000000-0000-0000-0000-000000000001",
    "ratePlanCode": "STANDARD",
    "ratePlanName": "Standard Rate",
    "currencyCode": "VND",
    "checkIn": "2026-07-23",
    "checkOut": "2026-07-25",
    "nights": 2,
    "requestedRooms": 1,
    "availableRooms": 2,
    "nightlyRates": [
      { "stayDate": "2026-07-23", "amount": 1500000.00 },
      { "stayDate": "2026-07-24", "amount": 1500000.00 }
    ],
    "totalAmount": 3000000.00
  }
]
```

The existing development seed is sufficient: it creates one active Property,
two active RoomTypes and their Active PhysicalRooms, the active `STANDARD` VND
RatePlan, 14 rolling nights of rates, one demo sellable limit, and one demo
stop-sell. Its Property-timezone window is driven by `TimeProvider`; repeated
runs are idempotent and preserve customized rates and controls. Demo values are
not production prices or inventory policy.

Run verification explicitly:

```powershell
dotnet restore Back_End/TheBha.Booking.sln
dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore
dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build
dotnet ef migrations has-pending-model-changes --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```

BE-002.4 adds no schema migration, write/admin endpoint, authentication,
frontend, reservation/hold behavior, or BE-003 implementation.
