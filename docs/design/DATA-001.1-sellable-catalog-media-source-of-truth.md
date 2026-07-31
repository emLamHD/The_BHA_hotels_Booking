# DATA-001.1 — Sellable Catalog and Media Source-of-Truth Design

Status: Draft — Current-state inventory and ownership/mapping design completed; dataset/media execution contract and decision gate pending.

## 1. Scope and evidence method

This checkpoint (Checkpoint 1 of `DATA-001.1`) records a code-backed
current-state inventory only. It does not design a target source-of-truth,
does not propose a schema/API/seed target, and does not decide the next
work unit.

Evidence method:

- Every claim below traces to repository-relative file paths and
  symbol/type/function names in the actual source, EF Core configurations,
  migrations, and frontend components on branch
  `feature/data-001-1-catalog-media-design` at base SHA
  `e5d8b218ba6326a22b56b8a7999d0ffd66ef148e`.
- Backend evidence was read directly from `TheBha.Domain`,
  `TheBha.Application`, `TheBha.Infrastructure` (EF configurations, query/
  store implementations, `DevelopmentDataSeeder`, migrations), and
  `TheBha.Api` (controllers, `Program.cs`).
- Frontend evidence was read directly from the `/home-2` route's import/
  render tree in `Front_End/Customer_Web/src`, following every component,
  service, and type file it actually imports.
- No development seed, migration, or build/test command was executed as
  part of gathering this evidence; all statements come from reading
  executable source, not from running it.
- README/doc text is used only to corroborate, never as the deciding
  source, when executable code answers a question definitively. No
  contradiction between a `docs/*.md` claim and the actual code/schema was
  found during this checkpoint's investigation.
- "Not found" statements record the exact search performed. "Not
  implemented" statements were checked across Domain, EF configuration,
  every migration file, Application, and Api layers before being made.
  "Unknown" is used only where code cannot answer a business or
  licensing/ownership question.

## 2. Current-state inventory

### 2.0 Catalog traceability (summary)

| Concept | Domain model | Persistence | API contract/endpoint | Development seed | Frontend consumer | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Property | `Property` (Id, Name, Slug, Description, Address, City, Country, TimeZone, CheckInTime, CheckOutTime, IsActive) | Table `Properties`, unique index on `Slug` | `PropertyDto` via `GET /api/v1/properties`, `GET /api/v1/properties/{id}` | 1 row, slug `the-bha-hotel` | `PropertyLiveCard` (name, location, description, times, amenities) | `Property.cs`; `PropertyConfiguration.cs`; `PropertyCatalogDtos.cs`; `PropertiesController.cs`; `DevelopmentDataSeeder.cs`; `PropertyLiveCard.tsx` |
| RoomType | `RoomType` (Id, PropertyId, Code, Name, Slug, Description, BaseOccupancy, MaxOccupancy, IsActive) | Table `RoomTypes`, unique on `(PropertyId,Code)`/`(PropertyId,Slug)`, check constraints on occupancy | `RoomTypeDto` via `GET /api/v1/properties/{id}/room-types`, `GET /api/v1/room-types/{id}` | 2 rows: `DLX-KING`, `FAMILY` | `RoomTypeLiveCard` (name, description, occupancy, amenities) | `RoomType.cs`; `RoomTypeConfiguration.cs`; `PropertyCatalogDtos.cs`; `PropertiesController.cs`/`RoomTypesController.cs`; `DevelopmentDataSeeder.cs`; `RoomTypeLiveCard.tsx` |
| RatePlan | `RatePlan` (Id, PropertyId, Code, Name, Description, CurrencyCode, IsActive) | Table `RatePlans`, unique on `(PropertyId,Code)`, currency regex check | **Not** in `PropertyDto`/`RoomTypeDto`; flattened (no Description) into `AvailabilityOfferDto` only, via availability search | 1 row: `STANDARD`/`VND` | Read only through an Availability offer (`ratePlanName`, `currencyCode`) in `AvailabilityOfferCard` | `RatePlan.cs`; `RatePlanConfiguration.cs`; `AvailabilitySearch.cs`; `DevelopmentDataSeeder.cs`; `AvailabilityOfferCard.tsx` |
| DailyRoomRate | `DailyRoomRate` (Id, PropertyId, RoomTypeId, RatePlanId, StayDate, Amount) | Table `DailyRoomRates`, unique on 4-tuple, `Amount>0` check | Not directly exposed; consumed server-side by `AvailabilitySearch` and surfaced as `NightlyRateDto[]`/`TotalAmount` on an offer | 14 nights × 2 RoomTypes, flat nightly amount | `AvailabilityOfferCard` nightly-rate list and total | `DailyRoomRate.cs`; `DailyRoomRateConfiguration.cs`; `AvailabilityDataSource.cs`; `DevelopmentDataSeeder.cs`; `AvailabilityOfferCard.tsx` |
| DailyInventoryControl | `DailyInventoryControl` (Id, PropertyId, RoomTypeId, StayDate, SellableLimit?, IsStopSell) | Table `DailyInventoryControls`, unique on `(PropertyId,RoomTypeId,StayDate)`, "at least one effect" check | Not directly exposed; consumed server-side by `AvailabilitySearch` to compute `AvailableRooms` | 2 rows (one capped, one stop-sell) | Indirectly reflected in an offer's `availableRooms`, or the RoomType/date simply not offered | `DailyInventoryControl.cs`; `DailyInventoryControlConfiguration.cs`; `AvailabilitySearch.cs`; `DevelopmentDataSeeder.cs` |
| Media / Amenity | `Media` (Url validated as absolute http/https), `Amenity` (Code/Name/Category); joined via `PropertyMedia`/`RoomTypeMedia`/`PropertyAmenity`/`RoomTypeAmenity` | Tables `Media`, `Amenities`, and 4 join tables; unique partial index enforces ≤1 cover per Property/RoomType | Nested `MediaDto[]`/`AmenityDto[]` inside `PropertyDto`/`RoomTypeDto`/`AvailabilityOfferDto` | 4 Media rows (all `images.example.com`), 4 Amenity rows | `selectCoverImage`/`isUsableMediaUrl` filter media; `Badge` renders amenities | `Media.cs`, `Amenity.cs`, join entities; `MediaConfiguration.cs` etc.; `propertyPresentation.ts`; `PropertyLiveCard.tsx`/`RoomTypeLiveCard.tsx` |

Full evidence and detail for each row is in §2.1–§2.6 below.

### 2.1 Property

- **Domain**: `TheBha.Domain.Properties.Property`
  (`Back_End/src/TheBha.Domain/Properties/Property.cs`). Fields: `Id`,
  `Name` (≤200), `Slug` (≤200, lower-invariant, unique per DB index),
  `Description` (optional, ≤4000), `Address` (≤500), `City` (≤120),
  `Country` (≤120), `TimeZone` (≤100, IANA id consumed by
  `TimeZoneInfo.FindSystemTimeZoneById`), `CheckInTime`/`CheckOutTime`
  (`TimeOnly`), `IsActive`, `CreatedAt`/`UpdatedAt`. Validation is via
  `DomainGuard.Required`/`Optional`/`RequiredId`
  (`Back_End/src/TheBha.Domain/Common/DomainGuard.cs`, referenced but not
  re-read in this checkpoint since Property/RoomType/RatePlan all reuse it
  identically). Only mutator: `Deactivate(DateTimeOffset)`.
- **Persistence**: `PropertyConfiguration`
  (`Back_End/src/TheBha.Infrastructure/Persistence/Configurations/PropertyConfiguration.cs`)
  maps to table `Properties`, unique index on `Slug`, `CheckInTime`/
  `CheckOutTime` as `time without time zone`, timestamps as
  `timestamp with time zone`. No amenity/media columns on `Property`
  itself — those are separate join tables (see below).
- **API contract**: `PropertyDto` record
  (`Back_End/src/TheBha.Application/Properties/PropertyCatalogDtos.cs`) —
  `Id, Name, Slug, Description, Address, City, Country, TimeZone,
  CheckInTime, CheckOutTime, Amenities (AmenityDto[]), Media (MediaDto[])`.
- **Endpoints**: `PropertiesController`
  (`Back_End/src/TheBha.Api/Controllers/PropertiesController.cs`) —
  `GET /api/v1/properties` (active properties, ordered by Name then Id),
  `GET /api/v1/properties/{propertyId}` (404 Problem Details if inactive/
  missing).
- **Media/amenity association**: `PropertyMedia`
  (`Back_End/src/TheBha.Domain/Properties/PropertyMedia.cs`,
  join on `PropertyId`+`MediaId`, `SortOrder`, `IsCover`, unique partial
  index enforcing at most one cover per Property — `PropertyMediaConfiguration.cs`)
  and `PropertyAmenity`
  (`Back_End/src/TheBha.Domain/Properties/PropertyAmenity.cs`, plain join,
  no ordering/cover concept). `PropertyCatalogQueries`
  (`Back_End/src/TheBha.Infrastructure/Persistence/PropertyCatalogQueries.cs`)
  projects both into the DTO, filtering amenities to `Amenity.IsActive`
  and ordering media by `SortOrder` then `MediaId`.
- **Development seed**: one Property, slug `the-bha-hotel`, id
  `10000000-0000-0000-0000-000000000001`, name "The BHA Hotel", address "1
  BHA Avenue", city "Ho Chi Minh City", country "Vietnam", time zone
  `Asia/Ho_Chi_Minh`, check-in 14:00 / check-out 12:00
  (`Back_End/src/TheBha.Infrastructure/Persistence/DevelopmentDataSeeder.cs`,
  `SeedAsync`). Description: "A welcoming city hotel operated
  independently by The BHA Hotels." — this reads as descriptive marketing
  copy written for the seed, not a value with any external evidence of
  being a real operating fact (see Owner-confirmation candidates).
- **Frontend consumption**: `PropertyLiveCard`
  (`Front_End/Customer_Web/src/components/PropertyLiveCard.tsx`) renders
  `name`, `formatLocation(data)` (city/country via
  `Front_End/Customer_Web/src/lib/api/propertyPresentation.ts`),
  `description`, `formatTime(checkInTime/checkOutTime)`, and `amenities`
  as `Badge`s. `slug`, `id`, `address`, `timeZone` are fetched into the
  `PropertyDto` type
  (`Front_End/Customer_Web/src/lib/api/propertyTypes.ts`) but **not**
  rendered by `PropertyLiveCard` — confirmed by reading the whole
  component; no other `/home-2` component reads `PropertyDto.address` or
  `.slug`.

### 2.2 RoomType

- **Domain**: `TheBha.Domain.Properties.RoomType`
  (`Back_End/src/TheBha.Domain/Properties/RoomType.cs`). Fields: `Id`,
  `PropertyId`, `Code` (≤50, upper-invariant), `Name` (≤200), `Slug`
  (≤200, lower-invariant), `Description` (optional, ≤4000),
  `BaseOccupancy`, `MaxOccupancy`, `IsActive`, `CreatedAt`/`UpdatedAt`.
  Invariants enforced in the constructor: `BaseOccupancy > 0` and
  `MaxOccupancy >= BaseOccupancy`, both throwing `DomainException`
  otherwise.
- **Property association**: `PropertyId` foreign key; EF also defines a
  composite alternate key `(PropertyId, Id)`
  (`RoomTypeConfiguration.cs`) used by `DailyRoomRate`,
  `DailyInventoryControl`, and `PhysicalRoom` to enforce that a RoomType
  row referenced by date-scoped data belongs to the same Property being
  queried.
- **Occupancy/capacity fields**: `BaseOccupancy`, `MaxOccupancy` (both
  `int`) — no separate bed count, bedroom count, or square-meter field
  anywhere in `RoomType` or its EF configuration.
- **Persistence**: `RoomTypeConfiguration.cs` — table `RoomTypes`, check
  constraints `CK_RoomTypes_BaseOccupancy` (`>0`) and
  `CK_RoomTypes_MaxOccupancy` (`>=BaseOccupancy`) mirrored at the database
  level, unique indexes on `(PropertyId, Code)` and `(PropertyId, Slug)`.
- **Amenities/media**: `RoomTypeAmenity`
  (`Back_End/src/TheBha.Domain/Properties/RoomTypeAmenity.cs`) and
  `RoomTypeMedia`
  (`Back_End/src/TheBha.Domain/Properties/RoomTypeMedia.cs`, same
  SortOrder/IsCover/unique-cover-per-RoomType shape as PropertyMedia).
- **API contract/endpoint**: `RoomTypeDto`
  (`PropertyCatalogDtos.cs`) — `Id, PropertyId, Code, Name, Slug,
  Description, BaseOccupancy, MaxOccupancy, Amenities, Media`.
  `PropertiesController.GetRoomTypes` — `GET
  /api/v1/properties/{propertyId}/room-types` (404 if the parent Property
  is missing/inactive). `RoomTypesController.GetRoomType`
  (`Back_End/src/TheBha.Api/Controllers/RoomTypesController.cs`) — `GET
  /api/v1/room-types/{roomTypeId}` (404 if the RoomType or its parent
  Property is missing/inactive — verified via the `dbContext.Properties.Any(...)`
  subquery in `PropertyCatalogQueries.GetRoomTypeAsync`).
- **Seed coverage**: two RoomTypes under the seeded Property — `DLX-KING`
  "Deluxe King" (base 2 / max 2, description "A comfortable king room for
  couples and solo travellers.") and `FAMILY` "Family Suite" (base 2 / max
  4, description "A spacious suite for families.")
  (`DevelopmentDataSeeder.EnsureRoomTypesAsync`).
- **Frontend consumption**: `RoomTypeLiveCard`
  (`Front_End/Customer_Web/src/components/RoomTypeLiveCard.tsx`) renders
  `name`, `description`, `formatDesignedForOccupancy(baseOccupancy)` /
  `formatMaxOccupancy(maxOccupancy)`
  (`Front_End/Customer_Web/src/lib/api/roomTypePresentation.ts` — plain
  "Designed for N guest(s)" / "Up to N guest(s)" strings, no bed/bedroom
  reinterpretation per that file's own doc comment), and `amenities` as
  `Badge`s. `code`, `slug`, `propertyId` are in `RoomTypeDto` but not
  rendered.

### 2.3 RatePlan

- **Domain**: `TheBha.Domain.Properties.RatePlan`
  (`Back_End/src/TheBha.Domain/Properties/RatePlan.cs`, `sealed partial`
  class). Fields: `Id`, `PropertyId`, `Code` (≤50, upper-invariant),
  `Name` (≤200), `Description` (optional, ≤4000), `CurrencyCode` (exactly
  3 upper-case letters, enforced by `[GeneratedRegex("^[A-Z]{3}$")]`),
  `IsActive`, `CreatedAt`/`UpdatedAt`. Mutators: `Activate`/`Deactivate`,
  both timestamp-monotonicity-checked.
- **Relationships**: `PropertyId` foreign key with composite alternate key
  `(PropertyId, Id)` used the same way as RoomType's, by `DailyRoomRate`.
  No RoomType, occupancy, or per-guest pricing-rule field exists on
  `RatePlan` itself — pricing varies by (`RoomTypeId`, `RatePlanId`,
  `StayDate`) exclusively through the separate `DailyRoomRate` entity (see
  §2.4). No occupancy-based or per-person pricing rule was found anywhere
  in `RatePlan`, `DailyRoomRate`, or `AvailabilitySearch` — pricing is a
  flat nightly amount per RoomType/RatePlan/date, independent of the
  `Adults`/`Children`/`Rooms` values in the search request (those values
  only gate `MaxOccupancy` eligibility and requested-room-count inventory
  checks; they never multiply into `NightlyRateDto.Amount`).
- **EF mapping**: `RatePlanConfiguration.cs` — table `RatePlans`, check
  constraints for non-blank `Code`/`Name`, currency-code regex mirrored at
  the DB level (`CK_RatePlans_CurrencyCode`), unique index on
  `(PropertyId, Code)`.
- **API exposure**: **RatePlan is not directly exposed by
  `IPropertyCatalogQueries`** — neither `PropertyDto` nor `RoomTypeDto`
  contains a RatePlan field or nested RatePlan collection
  (`PropertyCatalogDtos.cs`, confirmed by reading the full file). RatePlan
  is exposed only indirectly, as flattened fields
  (`RatePlanId, RatePlanCode, RatePlanName, CurrencyCode` — no
  `Description`) inside `AvailabilityOfferDto`
  (`Back_End/src/TheBha.Application/Properties/AvailabilitySearch.cs`),
  itself only reachable through
  `GET /api/v1/properties/{propertyId}/availability`. There is no
  `RatePlansController` and no route returns a RatePlan collection on its
  own. `RatePlan` also appears in `TheBha.Api/Bookings/BookingHoldApiContracts.cs`
  and `BookingHoldsController.cs` (Hold-creation input/validation), which
  is the pre-existing BE-003 booking surface, not a catalog-browsing
  surface, and is out of this checkpoint's design scope.
- **Seed coverage**: one RatePlan, code `STANDARD`, name "Standard Rate",
  currency `VND`, no description, id
  `60000000-0000-0000-0000-000000000001`
  (`DevelopmentDataSeeder.EnsureRatePlanAsync`).
- **Not exposed to frontend catalog browsing**: per the above, RatePlan
  `Description`, `IsActive`, `CreatedAt`/`UpdatedAt` are not exposed to the
  frontend in any form; RatePlan `Code`/`Name`/`CurrencyCode` reach the
  frontend only as part of an Availability offer, never as a standalone
  "rate plans for this Property" list. This document does not classify
  RatePlan as editorial content or as a public catalog concept — that is
  purely how the current code exposes (or does not expose) it.

### 2.4 Daily rates and inventory controls

| Capability | Status | Evidence |
| --- | --- | --- |
| Daily price/rate records | **Implemented** | `DailyRoomRate` (`Back_End/src/TheBha.Domain/Properties/DailyRoomRate.cs`) — one row per `(PropertyId, RoomTypeId, RatePlanId, StayDate)`, `Amount` (`decimal`, must be `>0`), unique index on that 4-tuple (`DailyRoomRateConfiguration.cs`). |
| Inventory/allotment | **Implemented, but derived, not stored as a count** | No stored "N rooms of this type" field. `AvailabilitySearch.SearchAsync` (`Back_End/src/TheBha.Application/Properties/AvailabilitySearch.cs`) computes `baseInventory` at request time as `COUNT(PhysicalRooms WHERE RoomTypeId=x AND OperationalStatus=Active)` via `AvailabilityDataSource.LoadAsync`'s `activeCounts` grouping (`Back_End/src/TheBha.Infrastructure/Persistence/AvailabilityDataSource.cs`). |
| Stop-sell / closed state | **Implemented** | `DailyInventoryControl.IsStopSell` (`Back_End/src/TheBha.Domain/Properties/DailyInventoryControl.cs`); when true, `AvailabilitySearch` forces `controlledInventory = 0` for that RoomType/date regardless of `SellableLimit`. |
| Sellable limit (cap below physical count) | **Implemented** | `DailyInventoryControl.SellableLimit` (nullable `int`, `>=0` when present); `AvailabilitySearch` takes `Math.Min(baseInventory, control.SellableLimit ?? baseInventory)`. |
| Minimum stay | **Not found** | Searched `Back_End/src/TheBha.Domain/Properties/DailyInventoryControl.cs`, `DailyRoomRate.cs`, `RatePlan.cs`, `RoomType.cs`, `Back_End/src/TheBha.Infrastructure/Persistence/Configurations/DailyInventoryControlConfiguration.cs`, `Back_End/src/TheBha.Application/Properties/AvailabilitySearch.cs`, and every file under `Back_End/src/TheBha.Infrastructure/Persistence/Migrations/` for `MinStay`/`MaxStay`/similar. No field, column, check constraint, or validation rule exists. |
| Maximum stay | **Not found** | Same search as above; the only stay-length limit found anywhere is `AvailabilitySearchLimits.MaxStayNights = 30`, which is a request-shape guard in `AvailabilitySearch.ValidateBasic` (`Back_End/src/TheBha.Application/Properties/AvailabilitySearch.cs`), not a per-RoomType/RatePlan/date minimum/maximum-stay business rule. |
| Arrival/departure controls (closed-to-arrival / closed-to-departure) | **Not found** | Same search scope as minimum/maximum stay above (Domain, EF configuration, all six migrations, Application). No `ClosedToArrival`/`ClosedToDeparture`/`CTA`/`CTD`-equivalent field exists. |
| Room-count/availability calculation | **Implemented** | `AvailabilitySearch.SearchAsync`: per requested night, `available = max(0, controlledInventory - committedDemand)`, then the whole stay's `availableRooms = min` across nights; an offer is only produced when `availableRooms >= request.Rooms`. Committed demand = active, non-expired `BookingHold` nights + `Confirmed` `Reservation` nights for that RoomType/date (`AvailabilityDataSource.LoadAsync`, `holdDemand`/`reservationDemand`/`demand`). |
| Date/timezone rules | **Implemented** | `Property.TimeZone` (IANA id) is resolved via `TimeZoneInfo.FindSystemTimeZoneById` and used to compute the Property's "local today"; `AvailabilitySearch` rejects `CheckIn < localToday`. Stay dates are half-open `[CheckIn, CheckOut)`, matched exactly against contiguous `DailyRoomRate` rows (`nightlyData.Count != nights` or a date-sequence mismatch silently excludes that RoomType/RatePlan combination from the offer list, rather than erroring). |
| Concurrency rules | **Not evaluated in this checkpoint** | Booking Hold/Reservation advisory-lock and atomic-pricing concurrency behavior is documented in `docs/BE-003-3-ATOMIC-BOOKING-HOLD.md` and `docs/BE-003-5-CANCELLATION-LIFECYCLE-HARDENING.md` from prior, already-merged work units; it is a Hold-creation-time concern, not a catalog/media browsing concern, so it was not re-traced here. `AvailabilitySearch` itself (browse-time) reads without an explicit lock — it is a point-in-time snapshot read, consistent with it being non-authoritative for the final Hold price/availability (the Hold path re-reads and re-locks, per those prior docs). |

- **Write-side rate/inventory management exists in code but has no API
  surface.** `IDailyRoomRatePricing`/`DailyRoomRatePricing`
  (`Back_End/src/TheBha.Application/Properties/DailyRoomRatePricing.cs`) and
  `IDailyInventoryControlCommands`/`DailyInventoryControlCommands`
  (`Back_End/src/TheBha.Application/Properties/DailyInventoryControls.cs`),
  together with their Infrastructure store implementations
  (`DailyRoomRateStore.cs`, `DailyInventoryControlStore.cs`) and
  `IDailyRoomRateQueries`/`DailyRoomRateQueries.cs`, are registered in DI
  (`Back_End/src/TheBha.Infrastructure/Persistence/InfrastructureServiceCollectionExtensions.cs`,
  lines registering `IDailyRoomRateStore`, `IDailyRoomRatePricing`,
  `IDailyRoomRateQueries`, `IDailyInventoryControlStore`,
  `IDailyInventoryControlCommands`) and covered by unit tests
  (`Back_End/tests/TheBha.UnitTests/DailyRoomRatePricingTests.cs`,
  `DailyInventoryControlCommandTests.cs`), but a repository-wide search
  found **no controller, no other Application service, and no
  `BookingHold*` file** that calls `IDailyRoomRatePricing`,
  `IDailyInventoryControlCommands`, or `IDailyRoomRateQueries`. The only
  way `DailyRoomRate`/`DailyInventoryControl` rows are created today is
  `DevelopmentDataSeeder`. This is a code-confirmed gap, not an inference
  from a migration or test name.

### 2.5 Availability and offer contract

| Concern | Server implementation | API field/behavior | Frontend contract/rendering | Evidence |
| --- | --- | --- | --- | --- |
| Route | `PropertiesController.GetAvailability` | `GET /api/v1/properties/{propertyId}/availability` | `searchAvailability(propertyId, query)` builds the same path | `Back_End/src/TheBha.Api/Controllers/PropertiesController.cs`; `Front_End/Customer_Web/src/lib/api/availabilityService.ts` |
| Query inputs | `checkIn, checkOut, adults, children, rooms` — all `[FromQuery, BindRequired]` | Same 5 params | `AvailabilityQuery` interface, sent via Axios `params` | `PropertiesController.cs`; `Front_End/Customer_Web/src/lib/api/availabilityTypes.ts`, `availabilityService.ts` |
| Validation limits | `MaxStayNights=30`, `MaxRequestedRooms=10`, `adults>0`, `children>=0`, `rooms in [1,10]`, `checkIn<checkOut`, `checkIn>=Property-local-today` | 400 Problem Details with `result.Error` on any violation; 404 if Property missing/inactive | `MAX_STAY_NIGHTS=30`, `MAX_REQUESTED_ROOMS=10` duplicated client-side in `availabilityValidation.ts` for pre-submit UX only; the past-date rule is explicitly **not** duplicated client-side (comment in `validateAvailabilityDraft`: "the backend remains the sole authority for that") | `Back_End/src/TheBha.Application/Properties/AvailabilitySearch.cs` (`AvailabilitySearchLimits`, `ValidateBasic`); `Front_End/Customer_Web/src/lib/api/availabilityValidation.ts` |
| Application/query service | `AvailabilitySearch.SearchAsync` orchestrates; `AvailabilityDataSource.LoadAsync` is the sole data source | n/a | `runAvailabilityFormSubmit` → `runIfAvailabilitySearchAllowed` (Hold-flow coordinator gate) → `searchAvailability` | `AvailabilitySearch.cs`; `AvailabilityDataSource.cs`; `Front_End/Customer_Web/src/app/(home)/SectionAvailabilitySearch.tsx` |
| Server-side availability/pricing authority | Single source: PostgreSQL, read without transaction/lock at browse time (see §2.4 concurrency row) | n/a | Frontend never computes or overrides a price/availability figure; `formatCurrencyAmount` only formats the server's `amount`+`currencyCode`, never recomputes | `AvailabilityDataSource.cs`; `Front_End/Customer_Web/src/lib/api/availabilityPresentation.ts` |
| Offer response fields | `AvailabilityOfferDto`: `PropertyId, RoomTypeId, RoomTypeCode, RoomTypeName, RoomTypeDescription, Media, RatePlanId, RatePlanCode, RatePlanName, CurrencyCode, CheckIn, CheckOut, Nights, RequestedRooms, AvailableRooms, NightlyRates, TotalAmount` | Same, JSON-serialized | `AvailabilityOfferDto` TS interface — **field-for-field match**, including nullability conventions | `Back_End/src/TheBha.Application/Properties/AvailabilitySearch.cs`; `Front_End/Customer_Web/src/lib/api/availabilityTypes.ts` |
| Nightly breakdown | `NightlyRateDto(StayDate, Amount)` list, one per stay date | Rendered as an array | `NightlyRateDto` TS interface; `AvailabilityOfferCard` renders each `{stayDate, amount}` row | Same files as above; `Front_End/Customer_Web/src/components/AvailabilityOfferCard.tsx` |
| Currency and total | `CurrencyCode` (3-letter, from RatePlan), `TotalAmount = sum(nightly) * requestedRooms` | Same | `formatCurrencyAmount(amount, currencyCode)` — `Intl.NumberFormat`, never invents a currency when `currencyCode` is null, never converts | `AvailabilitySearch.cs` line producing `TotalAmount`; `Front_End/Customer_Web/src/lib/api/availabilityPresentation.ts` |
| Property/RoomType/RatePlan identifiers | `PropertyId, RoomTypeId, RatePlanId` (GUIDs) on every offer | Same | Used as the React list `key` (`${roomTypeId}:${ratePlanId}`) and passed into `selectOffer(...)` for the Hold flow | `AvailabilityOfferDto`; `Front_End/Customer_Web/src/app/(home)/SectionAvailabilitySearch.tsx` |
| Empty/error behavior | `AvailabilitySearchStatus`: `Success` (200 + offers, possibly `[]`), `Invalid` (400 Problem Details), `NotFound` (404 Problem Details, Property missing/inactive) | Same three outcomes surfaced as HTTP status + Problem Details | Frontend `SearchStatus`: `initial | loading | success | empty | error` — `empty` is a **client-derived** state (`data.length === 0` after a 200 response), distinct from the server's 400/404 outcomes which both map to the frontend's `error` state via `describeError` | `AvailabilitySearch.cs`; `PropertiesController.GetAvailability`; `Front_End/Customer_Web/src/app/(home)/SectionAvailabilitySearch.tsx` |

No backend/frontend contract mismatch was found in this trace — every
field in `AvailabilityOfferDto` (Application) has a corresponding, 
correctly-typed field in the frontend `AvailabilityOfferDto` TS interface,
and the two numeric validation limits (`MaxStayNights`/`MaxRequestedRooms`)
are equal on both sides. This checkpoint is therefore not `BLOCKED` on a
contract mismatch.

### 2.6 Existing development seed

- **Entry point**: `Back_End/src/TheBha.Api/Program.cs`, lines 187–199 —
  gated on `args.Contains("--seed-development")`. Not invoked by any other
  code path; the normal `dotnet run` (no args) never reaches this branch.
- **Environment guard**: `if (!app.Environment.IsDevelopment()) throw new
  InvalidOperationException(...)` — the seed throws and refuses to run
  unless `ASPNETCORE_ENVIRONMENT=Development`.
- **How it's invoked**: `dotnet run --project
  Back_End/src/TheBha.Api/TheBha.Api.csproj -- --seed-development` (per
  `docs/DATABASE.md`); the process seeds then `return`s immediately — it
  does not go on to start listening for requests.
- **Idempotency**: every entity insertion in `DevelopmentDataSeeder`
  (`Back_End/src/TheBha.Infrastructure/Persistence/DevelopmentDataSeeder.cs`)
  is guarded by a `SingleOrDefaultAsync`/`AnyAsync` natural-key check
  before `Add` — Property by `Slug`, RoomType by `(PropertyId, Code)`,
  RatePlan by `(PropertyId, Code)`, DailyRoomRate/DailyInventoryControl by
  their full natural-key tuple, PhysicalRoom by `RoomNumber`, Amenity by
  `Code`, Media by `Url`, and every join table by its composite key. A
  second run inserts nothing new; it does **not** update any existing row
  (no code path calls `UpdateAmount`, `Deactivate`, `SetActive`, etc. from
  the seeder) — so re-running the seed after a code change to a
  definition's literal values (e.g. changing the seed's hardcoded
  description text) will **not** retroactively update an already-seeded
  row.
- **Property/RoomType/RatePlan/rate/inventory data created**: one Property
  (`the-bha-hotel`), two RoomTypes (`DLX-KING`, `FAMILY`), one RatePlan
  (`STANDARD`/`VND`), `DailyRateSeedDays = 14` nights of `DailyRoomRate`
  per RoomType starting at the Property's local "today" (`DLX-KING` =
  1,500,000 VND/night, `FAMILY` = 2,200,000 VND/night — flat, no weekend/
  seasonal variation), three `PhysicalRoom`s (`101`/`102` → DLX-KING,
  `201` → FAMILY, all `OperationalStatus.Active`), and two
  `DailyInventoryControl` rows (`DLX-KING` at local-today+1 with
  `SellableLimit=1`, `IsStopSell=false`; `FAMILY` at local-today+2 with
  `SellableLimit=null`, `IsStopSell=true`).
- **Media/amenity/content seeded**: four `Amenity` rows (`WIFI`, `POOL`,
  `BREAKFAST`, `AIRCON`); Property gets `WIFI`/`POOL`/`BREAKFAST`;
  `DLX-KING` gets `WIFI`/`AIRCON`; `FAMILY` gets
  `WIFI`/`AIRCON`/`BREAKFAST`. Four `Media` rows, **all four with URLs on
  the `images.example.com` host**: `PROPERTY-COVER`
  (`https://images.example.com/the-bha/property-cover.jpg`, cover, sort 0),
  `PROPERTY-LOBBY` (`.../lobby.jpg`, not cover, sort 10),
  `DELUXE-COVER` (`.../deluxe-king.jpg`, RoomType cover), `FAMILY-COVER`
  (`.../family-suite.jpg`, RoomType cover). `example.com` is an RFC 2606
  reserved documentation domain — these URLs are guaranteed to never
  resolve to a real image; this is not a live/broken/unverified image, it
  is a placeholder URL by construction. The frontend's own
  `isReservedExampleHost` check
  (`Front_End/Customer_Web/src/lib/api/propertyPresentation.ts`) exists
  specifically because of this.
- **Synthetic vs. unverified-but-plausible data**: the four seeded Media
  URLs are unambiguously synthetic placeholders (reserved-example-host, by
  construction non-functional). The Property name ("The BHA Hotel"),
  address, city, country, time zone, room names/descriptions, amenity
  list, and prices are plausible-looking but have **no evidence in code**
  of being confirmed real operating facts — they were written directly as
  C# literals in the seeder with no citation, source comment, or
  configuration-driven origin.
- **Create-vs-update semantics**: seed only creates rows that don't already
  exist by natural key; it never overwrites values on a row that is
  already present, so no code-demonstrated risk exists today of the seed
  clobbering a hand-edited/customized row's values. (There is nothing to
  lose today because dev data is exclusively seed-originated per §2.4's
  finding that no other write path exists — but that is a statement about
  the current absence of a competing writer, not a statement about future
  risk once a management API/UI is added.)

### 2.7 Frontend `/home-2`

Entry point: `Front_End/Customer_Web/src/app/(home)/home-2/page.tsx`
(`PageHome2`). Rendered sections, in document order, each classified by
active data source:

1. **`SectionHero2`**
   (`Front_End/Customer_Web/src/app/(server-components)/SectionHero2.tsx`)
   — static hero image (`@/images/hero-right-3.png`, bundled template
   asset), static heading "Find Your Best Smart Real Estate" (no `children`
   passed from `PageHome2`, so the default renders — this is leftover
   real-estate-template marketing copy, unrelated to hotel booking, still
   active on `/home-2` today), and `HeroRealEstateSearchForm`
   (`Front_End/Customer_Web/src/app/(client-components)/(HeroSearchForm)/(real-estate-search-form)/HeroRealEstateSearchForm.tsx`)
   — a template real-estate search widget (location/price/property-type
   tabs), not the hotel Availability search. This form is template
   fixture content, not backed by any hotel API call — it renders
   unconditionally and is distinct from the live
   `SectionAvailabilitySearch` further down the page.
2. **Partner-logo grid** — five logos (`logo1`–`logo5`, light/dark
   variants), all local bundled `@/images/logos/{nomal,dark}/*.png`
   template assets, static `alt` text (`"logo1"`…`"logo5"`), no link or
   API behind them.
3. **`SectionHowItWork`**
   (`Front_End/Customer_Web/src/components/SectionHowItWork.tsx`) —
   `PageHome2` passes an explicit 3-item `data` array with local template
   images (`HIW2-1.png`/`-2`/`-3`, light+dark) and static marketing copy
   ("Smart search", "Choose property", "Book you property"); the
   component's own `DEMO_DATA` default is not used here because
   `PageHome2` always supplies `data`.
4. **`SectionGridFeatureProperty`**
   (`Front_End/Customer_Web/src/app/(home)/SectionGridFeatureProperty.tsx`)
   — **live**: calls `getProperties()`
   (`Front_End/Customer_Web/src/lib/api/propertyService.ts`, wraps `GET
   /api/v1/properties`) on mount, tracks `loading | success | error`,
   renders `PropertyLiveCard` per Property on success, "No properties are
   available right now." on an empty success, and an error panel with a
   `Retry` button on failure. Nested inside it (only reachable when the
   Property fetch succeeded and returned ≥1 Property):
   - **`SectionGridRoomTypes`**
     (`Front_End/Customer_Web/src/app/(home)/SectionGridRoomTypes.tsx`) —
     live, one independent `getRoomTypes(propertyId)` call per Property
     already loaded (does not re-fetch Properties), same
     loading/success/empty/error states, `RoomTypeLiveCard` per RoomType.
   - **`SectionAvailabilitySearch`**
     (`Front_End/Customer_Web/src/app/(home)/SectionAvailabilitySearch.tsx`)
     — live, the hotel-domain Property/date/guest/room search form
     described in full in §2.5, backed by `searchAvailability(...)`
     (`GET /api/v1/properties/{propertyId}/availability`); renders
     `AvailabilityOfferCard` per offer with an "Hold this room" CTA.
5. **`SectionOurFeatures`**
   (`Front_End/Customer_Web/src/components/SectionOurFeatures.tsx`) —
   fully static: local template image (`@/images/our-features-2.png`,
   passed as `rightImg`), hardcoded "Happening cities" heading and three
   Lorem-ipsum-adjacent literal marketing bullets (e.g. "Reach millions
   with Chisfis" — the original template's brand name, still present).
6. **`SectionDowloadApp`**
   (`Front_End/Customer_Web/src/app/(home)/SectionDowloadApp.tsx`) —
   fully static: six local template images
   (`appSvg1/2`, `appRightImg(Tree)`, `dowloadAppBG`, `btn-ios`/
   `btn-android`), literal `Lorem ipsum dolor sit amet...` body text, and
   two `href="##"` dead links for the app-store buttons.
7. **`SectionSliderNewCategories`** (first call, `categories={DEMO_CATS_2}`
   from `page.tsx`) — fixture data defined inline in `page.tsx` (7 items),
   each with a **remote** `images.pexels.com` stock-photo URL and an
   `href` of `/listing-real-estate` (an unrelated template route, not a
   hotel/Property/RoomType route). Component itself
   (`Front_End/Customer_Web/src/components/SectionSliderNewCategories.tsx`)
   makes no API call; it only renders whatever `categories` prop it's
   given (or its own `DEMO_CATS` default when none is given — see item 9).
8. **`SectionGridAuthorBox`**
   (`Front_End/Customer_Web/src/components/SectionGridAuthorBox.tsx`,
   `boxCard="box2"`) — static: defaults to `DEMO_AUTHORS.filter((_, i) =>
   i < 10)` from `Front_End/Customer_Web/src/data/authors.ts` (not read in
   full this checkpoint, but confirmed as the fixture import — template
   "host"/review data, a real-estate/rental-marketplace concept with no
   analog in the current hotel Domain model), heading "Top 10 author of
   the month" / "Rating based on customer reviews", and a dead
   `ButtonPrimary` "Become a host" with no `onClick`.
9. **`SectionSliderNewCategories`** (second call, no `categories` prop) —
   falls back to the component's own module-level `DEMO_CATS` (8 items,
   also remote `images.pexels.com` URLs, `href` of `/listing-stay-map`,
   another unrelated template route).
10. **`SectionSubscribe2`**
    (`Front_End/Customer_Web/src/components/SectionSubscribe2.tsx`) —
    fully static: local template image (`@/images/SVG-subcribe2.png`),
    "Join our newsletter 🎉" heading, static bullet copy, and a `<form>`
    with no `onSubmit` handler (submitting it does nothing observable in
    code).

**Property/RoomType/availability data flow**: exactly as described in
item 4 above — `SectionGridFeatureProperty` is the single root fetch
(`getProperties`); `SectionGridRoomTypes` and `SectionAvailabilitySearch`
both receive the already-fetched `properties` array as a prop and never
independently re-fetch `GET /api/v1/properties`.

**Hold CTA / current-hold UI boundary**: `AvailabilityOfferCard`'s "Hold
this room" button calls `onHold` → `SectionAvailabilitySearch.handleSelectOffer`
→ `selectOffer(...)` on the `useBookingHoldFlow()` context
(`Front_End/Customer_Web/src/app/BookingHoldProvider.tsx`, mounted once at
the app-root layout so Hold state survives client-side navigation but not
a hard reload/tab close — documented in that file's own comment as an
explicit FE-001.4 limitation). `BookingHoldPanel`
(`Front_End/Customer_Web/src/components/BookingHoldPanel.tsx`) is rendered
conditionally inside `SectionAvailabilitySearch` whenever `holdPhase !==
"idle"`. The Hold submission/confirmation flow itself (BE-003.3–BE-003.5,
FE-001.4) is prior, already-merged work and was not re-traced in this
checkpoint beyond identifying this render boundary, since Hold/Reservation
behavior is out of `DATA-001.1`'s catalog/media scope.

**Loading/empty/error/fallback paths tied to catalog/media**: `Section
GridFeatureProperty`, `SectionGridRoomTypes`, and `SectionAvailabilitySearch`
each independently implement `loading`/`error`(+Retry)/`empty` states, all
described in §2.5's Availability row and above. Image-level fallback is
per-card, not per-section: each of `PropertyLiveCard`, `RoomTypeLiveCard`,
`AvailabilityOfferCard` independently calls `selectCoverImage(media)` and
falls back to a single shared local bundled asset,
`@/images/placeholder-large-h.png`
(`Front_End/Customer_Web/src/images/placeholder-large-h.png`, confirmed
present on disk), whenever `selectCoverImage` returns `undefined` (no
usable media) or a rendered `<img>` fires `onError` (e.g. a genuine host
returning 404 at runtime).

**Static marketing/editorial text**: itemized per section above (items
1, 3, 5, 6, 8, 9, 10). None of it originates from the Property/RoomType
Domain model or API; all of it is literal JSX/TS string content or
imported fixture data.

**Contact/location/facility claims**: no `/home-2` section renders a
phone number, email address, or physical contact claim (`SectionHero2`,
`SectionSubscribe2`, and `SectionDowloadApp` were read in full — none
contains one). The only location claim rendered from real data is
`PropertyLiveCard`'s `formatLocation` (city, country) sourced from the
live `PropertyDto`. Facility/amenity claims rendered from real data are
the `Badge`s on `PropertyLiveCard`/`RoomTypeLiveCard`, sourced from
`PropertyDto.amenities`/`RoomTypeDto.amenities`.

**Logic filtering/rejecting unusable media URLs**: `isUsableMediaUrl` and
`selectCoverImage`
(`Front_End/Customer_Web/src/lib/api/propertyPresentation.ts`) — a URL is
usable only if it parses as an absolute `http:`/`https:` URL and its
hostname is not `example.com`/`example.net`/`example.org` (or a subdomain
of one), per RFC 2606. This function is shared by `PropertyLiveCard`,
`RoomTypeLiveCard`, and `AvailabilityOfferCard` (the latter via
`AvailabilityOfferDto.media`, which is populated in `AvailabilityDataSource`
from the same `RoomTypeMedia` join used for `RoomTypeDto.media`). Given
the seed's four Media rows are all on the `images.example.com` host (see
§2.6), **every seeded image is filtered out today**, and all three live
card types currently render the local `placeholder-large-h.png` fallback
in a freshly seeded database — this is a directly observable consequence
of code, not a guess.

**Assets/fixtures present in the repo but not in `/home-2`'s active render
tree**: the large majority of `Front_End/Customer_Web/src/images` (145
files total; see §2.9) and `Front_End/Customer_Web/src/data`
fixtures beyond `DEMO_CATS_2`/`DEMO_CATS`/`DEMO_AUTHORS` are template
assets for other routes (`/listing-*`, `/checkout`, `/author`, `/blog`,
etc.) not reachable from `/home-2`'s own render tree; this document does
not enumerate them individually per the "no full asset-by-file inventory"
instruction.

### 2.8 Active `/home-2` content and media (summary)

| UI element/section | Current source | Active data/content | Media source/fallback | Observed status | Evidence |
| --- | --- | --- | --- | --- | --- |
| Hero (`SectionHero2`) | `PageHome2` + `SectionHero2.tsx` | Static heading "Find Your Best Smart Real Estate"; `HeroRealEstateSearchForm` (real-estate template widget) | Local bundled `hero-right-3.png` | Template artifact — active, unrelated to hotel domain | `SectionHero2.tsx`; `HeroRealEstateSearchForm.tsx` |
| Partner-logo grid | `page.tsx` inline | Static, no text content beyond `alt="logo1"`…`"logo5"` | Local bundled `logos/{nomal,dark}/1..5.png` | Template artifact — active | `page.tsx` lines 10–23, 110–132 |
| How-it-works (`SectionHowItWork`) | `page.tsx` passes explicit `data` prop | Static 3-step marketing copy ("Smart search", "Choose property", "Book you property") | Local bundled `HIW2-1/2/3.png` (+dark variants) | Template artifact — active | `page.tsx` lines 134–158; `SectionHowItWork.tsx` |
| Property grid (`SectionGridFeatureProperty` → `PropertyLiveCard`) | Live `GET /api/v1/properties` | Real `PropertyDto` fields (name, location, description, times, amenities) | `selectCoverImage(media)` → local `placeholder-large-h.png` fallback (all current seed media filtered out — see §2.9 media row below) | **Active, API-backed** | `SectionGridFeatureProperty.tsx`; `PropertyLiveCard.tsx` |
| Room type grid (`SectionGridRoomTypes` → `RoomTypeLiveCard`) | Live `GET /api/v1/properties/{id}/room-types` | Real `RoomTypeDto` fields (name, description, occupancy, amenities) | Same fallback mechanism as Property grid | **Active, API-backed** | `SectionGridRoomTypes.tsx`; `RoomTypeLiveCard.tsx` |
| Availability search (`SectionAvailabilitySearch` → `AvailabilityOfferCard`) | Live `GET /api/v1/properties/{id}/availability` | Real `AvailabilityOfferDto` fields (room/rate names, nightly rates, total, availability count) | Same fallback mechanism | **Active, API-backed** | `SectionAvailabilitySearch.tsx`; `AvailabilityOfferCard.tsx` |
| Our features (`SectionOurFeatures`) | `page.tsx` passes `rightImg`; component's own literal copy | Static "Happening cities" heading + 3 literal bullets (retains "Chisfis" brand name) | Local bundled `our-features-2.png` | Template artifact — active | `SectionOurFeatures.tsx` |
| Download app (`SectionDowloadApp`) | Component-internal, no props from `page.tsx` | Static "Mobile Apps" heading, literal Lorem-ipsum body, two dead `href="##"` store buttons | Local bundled `appSvg1/2`, `appRightImg(Tree)`, `dowloadAppBG`, `btn-ios`/`btn-android` | Template artifact — active, non-functional CTAs | `SectionDowloadApp.tsx` |
| Category slider #1 (`SectionSliderNewCategories`, `card4`) | `page.tsx` inline `DEMO_CATS_2` (7 items) | Static category names/counts, `href` → `/listing-real-estate` (unrelated route) | Remote `images.pexels.com` hotlinks | Template artifact — active, real-estate-domain fixture | `page.tsx` lines 38–102, 169–175 |
| Author/host grid (`SectionGridAuthorBox`, `box2`) | Component default `DEMO_AUTHORS` (first 10) | Static "Top 10 author of the month" / reviews; dead "Become a host" button | Fixture-defined images inside `src/data/authors.ts` (not traced further — outside catalog/media scope) | Template artifact — active, marketplace-domain concept absent from hotel Domain model | `SectionGridAuthorBox.tsx`; `src/data/authors.ts` |
| Category slider #2 (`SectionSliderNewCategories`, `card5`) | Component's own default `DEMO_CATS` (8 items, no prop passed) | Static category names/counts, `href` → `/listing-stay-map` (unrelated route) | Remote `images.pexels.com` hotlinks | Template artifact — active | `SectionSliderNewCategories.tsx` lines 27–100, 182–187 |
| Newsletter (`SectionSubscribe2`) | Component-internal | Static "Join our newsletter" heading/copy; `<form>` with no `onSubmit` | Local bundled `SVG-subcribe2.png` | Template artifact — active, non-functional form | `SectionSubscribe2.tsx` |
| Shared image fallback | `propertyPresentation.ts` (`selectCoverImage`/`isUsableMediaUrl`), used by all three live cards | N/A | Local bundled `placeholder-large-h.png` | **Active** — currently the only image ever shown for live catalog data, since all seeded Media is on the filtered `images.example.com` host | `propertyPresentation.ts`; `PropertyLiveCard.tsx`, `RoomTypeLiveCard.tsx`, `AvailabilityOfferCard.tsx` |

Full detail and per-section evidence for the above is in §2.7.

### 2.9 Active content, media, and fallback assets (directory-level)

| Directory/module | Observed role | Active or dormant (re: `/home-2`) | Representative references | How used |
| --- | --- | --- | --- | --- |
| `Front_End/Customer_Web/src/images/` (145 files total) | Bundled template image library shipped with the purchased Next.js theme (per README §"Front-end provenance") | **Mixed** — a small named subset is actively imported by `/home-2` and its component tree (hero, logos, HIW, our-features, download-app, subscribe, and the shared `placeholder-large-h.png` fallback); the remainder (avatars, cars, carUtilities, clientSay*, real-estate/listing imagery, etc.) is not imported by any file in `/home-2`'s import graph | `hero-right-3.png`, `HIW2-1.png`…`HIW2-3-dark.png`, `our-features-2.png`, `appSvg1.png`, `dowloadAppBG.png`, `SVG-subcribe2.png`, `placeholder-large-h.png`, `logos/{nomal,dark}/1..5.png` | Imported as Next.js `StaticImageData` via `next/image`; bundled at build time, not runtime-configurable |
| `Front_End/Customer_Web/public/` (3 files: `next.svg`, `thirteen.svg`, `vercel.svg`) | Next.js/Vercel default static assets | **Dormant** for `/home-2` — none of the three is referenced anywhere in `/home-2`'s import tree | n/a | Framework scaffolding leftovers, not theme content |
| `Front_End/Customer_Web/src/data/` (fixture modules, e.g. `authors.ts`) | Template demo-data fixtures for the theme's non-hotel routes/sections (categories, authors/hosts, etc.) | **Partially active** — `DEMO_AUTHORS` (via `SectionGridAuthorBox`'s default) and the inline `DEMO_CATS_2` in `page.tsx` plus `SectionSliderNewCategories`'s own `DEMO_CATS` are active on `/home-2`; other fixture modules in this directory were not traced since they are outside `/home-2`'s reachable import graph | `Front_End/Customer_Web/src/data/authors.ts` (`DEMO_AUTHORS`) | Imported directly as static arrays, rendered without any API call |
| Remote `images.pexels.com` URLs (inline literals in `page.tsx` and `SectionSliderNewCategories.tsx`) | Third-party stock-photo hotlinks bundled with the original template's demo content | **Active** on `/home-2` (both `SectionSliderNewCategories` instances) | See §2.7 items 7 and 9 | Rendered directly as `<img>`/`next/image` `src` for the two category-slider sections; no backend or local-asset involvement |
| `images.example.com` seed Media URLs | RFC 2606 reserved placeholder host, backend `DevelopmentDataSeeder`-authored | **Present in the database when seeded, but never rendered as-is** — filtered out by `isUsableMediaUrl` before reaching any `<img>`/`Image` tag | See §2.6 | Falls through to `placeholder-large-h.png` on every live card today |

## 3. Observed gaps and unknowns

| Item | Code-backed status | Missing evidence | Owner input candidate | Future design relevance |
| --- | --- | --- | --- | --- |
| RatePlan as a browsable catalog concept | Not exposed by any catalog endpoint; only reachable via an Availability offer or Hold creation (§2.3) | Whether RatePlan should ever be independently browsable/listable is a business-scope question the code cannot answer | Yes — whether Rate Plans are customer-facing catalog entries or purely a pricing-mechanism detail | Directly relevant to any future `RatePlansController`/catalog design |
| No write API for `DailyRoomRate`/`DailyInventoryControl` | `IDailyRoomRatePricing`/`IDailyInventoryControlCommands` exist, are DI-registered and unit-tested, but are called by no controller or other Application code (§2.4) | Whether this is an intentionally deferred admin surface or an oversight | Yes — confirm whether a management API is planned before DATA-001.2 designs a seed/data contract around it | High — determines whether future non-seed data entry is even possible today |
| Seed images are all reserved-example-host placeholders | 100% of seeded Media rows use `images.example.com` (§2.6); frontend explicitly filters them out (§2.7) | Whether any real, licensed hotel imagery exists anywhere (outside this repository) to seed instead | Yes — real image source(s), licensing/usage rights | High — directly blocks a real "current state has usable photos" claim |
| Property/RoomType descriptive text origin | All seed description/marketing strings are C# literals in `DevelopmentDataSeeder` with no citation of an external source | Whether "The BHA Hotel", its address, or room descriptions reflect a real property or are illustrative placeholders | Yes | Affects whether DATA-001.2 treats seed text as replaceable placeholder or as draft real content |
| `SectionHero2`'s real-estate search form and heading on `/home-2` | Confirmed active, unrelated-domain template content (real estate, not hotel) still rendering on the hotel booking home page (§2.7 item 1) | Not a code question — this is a product/scope question | Yes — whether this is known/accepted debt or should be flagged for near-term replacement | Relevant to any `/home-2` content-replacement design, though `SectionHero2` itself is outside strict "catalog and media" scope |
| Template/demo sections unrelated to hotel domain (`SectionGridAuthorBox` "authors"/"hosts", both `SectionSliderNewCategories` category sliders, `SectionDowloadApp`, `SectionOurFeatures`, `SectionSubscribe2`) | Confirmed static, confirmed unrelated to Property/RoomType/Booking domain, confirmed still active on `/home-2` (§2.7 items 2,3,5,6,7,8,9,10) | Not a code question | Yes — whether/when these are removed, replaced, or intentionally kept as filler is a product decision | Relevant scope-boundary input for any future `/home-2` redesign, though most of these sections are outside "catalog and media" specifically |
| Flat (non-occupancy-based) pricing model | `DailyRoomRate.Amount` is a single value per RoomType/RatePlan/date, independent of `Adults`/`Children` in the request (§2.3) | Whether occupancy-based pricing is a deliberately deferred business rule or simply not yet built | Likely already covered by `docs/ARCHITECTURE.md`'s "Deliberately deferred decisions" (pricing not explicitly named there as of this checkpoint) — worth Owner confirmation that no per-occupancy pricing rule is expected soon | Would affect any future rate/inventory-management design |
| Minimum/maximum stay and arrival/departure controls | Confirmed absent from Domain, EF configuration, all 6 migrations, and Application (§2.4) | Whether these are planned, deliberately deferred, or out of scope entirely | Yes | Relevant if a future inventory-control design assumes their eventual existence |

## 4. Owner-confirmation candidates

The following require an explicit Owner/Control-Tower decision or fact
confirmation before any target design can safely treat them as settled;
each corresponds to a row in §3 above and is restated here as a direct
question:

1. Is "The BHA Hotel" (name, address, city, country, time zone, check-in/
   check-out times) a real property's real facts, or illustrative
   placeholder content authored for local development only?
2. Is there any real, licensed hotel/room photography available anywhere
   (outside this repository) that should replace the `images.example.com`
   placeholder Media URLs, or should real imagery be sourced later?
3. Is the absence of a write API for `DailyRoomRate`/`DailyInventoryControl`
   an intentional, already-decided deferral, or does one need to be
   designed as part of (or before) `DATA-001.2`?
4. Is RatePlan intended to remain an internal pricing-mechanism detail
   (never independently browsable), or should it become a first-class
   catalog concept with its own endpoint?
5. Is flat, non-occupancy-based nightly pricing the intended pricing model
   for the near term, or is occupancy-based/per-person pricing expected
   soon?
6. Are minimum/maximum stay and arrival/departure inventory controls
   planned for a near-term work item, or explicitly out of scope for now?
7. Is the real-estate-domain hero content and search form on `/home-2`
   (§2.7 item 1) known, accepted technical debt, or should it be flagged
   for prioritized replacement/removal?
8. Are the non-hotel-domain template sections on `/home-2` (author/host
   cards, both category sliders, download-app, subscribe, our-features —
   §2.7 items 2, 3, 5, 6, 7, 8, 9, 10) intended to be replaced, removed, or
   deliberately retained as filler content for now?

## 5. Checkpoint boundary

This document currently contains only the five sections authorized for
Checkpoint 1: `Scope and evidence method`, `Current-state inventory`,
`Observed gaps and unknowns`, `Owner-confirmation candidates`, and this
`Checkpoint boundary` section.

Explicitly not present in this checkpoint, per the execution prompt's
prohibitions:

- No target source-of-truth matrix.
- No target schema or API design.
- No template-to-target content/media mapping.
- No development dataset policy.
- No media target architecture or storage/CDN/CMS provider choice.
- No `DATA-001.2` seed contract.
- No decision gate or `READY_FOR_DATA-001.2` /
  `DEFER_DATA-001.2_AND_START_FE-002.1`-style recommendation.

No architectural conflict or backend/frontend contract mismatch was found
during this inventory (see §2.5's explicit conclusion), so this checkpoint
did not need to stop `BLOCKED` before commit.

---

# Checkpoint 2 — Source-of-truth and template mapping design

Everything from this point on is Checkpoint 2 content: ownership boundaries
and mapping design built on top of the Checkpoint 1 inventory above (§1–§5,
unchanged). Throughout, **`Current`** means "this is what the code does
today, per the verified §1–§5 inventory"; **`Target`** means "this is the
ownership boundary this design proposes, not yet implemented"; **`Future
work`** means "out of scope for `DATA-001.1` entirely, named only so a later
work item does not have to re-derive the boundary." No `Target` or `Future
work` label below should be read as an existing capability.

## 6. Target classification and design principles

### 6.1 Design principles

1. **Single authority per fact.** Every data/content item has exactly one
   system that may originate or mutate it. Every other system either reads
   through that authority's API/contract or does not represent the fact at
   all.
2. **No frontend shadow catalog.** Sellable/operational facts (Property,
   RoomType, RatePlan, pricing, inventory, availability, Hold/Reservation
   identifiers) are never re-declared as React literals, fixture arrays, or
   `.env` values. The frontend's only legitimate representation of these
   facts is the TypeScript wire type it already deserializes an API
   response into (`PropertyDto`, `RoomTypeDto`, `AvailabilityOfferDto`, per
   Checkpoint 1 §2.1/§2.2/§2.5).
3. **No frontend-computed booking arithmetic.** Nightly price, inventory
   count, stop-sell effect, offer totals, and availability decisions are
   never recomputed, re-derived, or overridden client-side; the frontend
   only formats a server-supplied value (already true today per Checkpoint
   1 §2.5 — this principle keeps it true as the design evolves).
4. **Editorial content is a distinct ownership class from operational
   catalog data**, even when both currently render inside the same
   component tree (e.g. `PropertyLiveCard` mixes an operational
   `description` field with, elsewhere on the page, purely editorial copy —
   see §8). Ownership is decided per data item, not per UI section.
5. **A binary is never its own identity.** A media binary's storage
   location/delivery URL is a resolvable detail, not the stable reference
   other systems key on (see §6.4 for the current-model gap this creates).
6. **Provider neutrality.** No object storage, CDN, or CMS vendor is chosen
   by this design; "delivery class" (e.g. "object storage + CDN") is as
   specific as this checkpoint gets.
7. **A field is promoted into the operational model only when it earns
   it** (see §6.2) — never merely because a template already has a text
   string in that position.

### 6.2 Classification model

**(1) Sellable and operational catalog.** Property, RoomType, RatePlan and
currency, capacity/occupancy, catalog-linked amenities, availability/
pricing/inventory controls, and every identifier Hold/Reservation consumes
(`PropertyId`, `RoomTypeId`, `RatePlanId`, plus the Hold/Reservation IDs
themselves).

- **Target authority**: PostgreSQL, exactly as already true today
  (Checkpoint 1 §2.1–§2.4) — `Current`, not a change.
- **Target validation/write boundary**: `TheBha.Domain` invariants +
  `TheBha.Application` command/query services + `TheBha.Api` controllers,
  exactly as already true for Property/RoomType/RatePlan/DailyRoomRate/
  DailyInventoryControl reads and for the existing Hold/Reservation write
  path — `Current` for what's already exposed, `Future work` for the
  DailyRoomRate/DailyInventoryControl **write** capability that Checkpoint
  1 §2.4 found registered in DI but reachable by no controller.
- **Target frontend boundary**: read-only, through the existing/expanded
  API surface; never a parallel fixture or literal copy of this data.

**(2) Server-authoritative transactional calculations.** Daily pricing,
inventory, stop-sell, offer totals and nightly breakdown, the availability
decision itself, and Hold/Reservation identifiers/snapshots.

- These are a strict subset of (1) that additionally can never be
  reconstructed client-side even for display purposes — the frontend may
  format (`formatCurrencyAmount`, per Checkpoint 1 §2.5) but never compute.
  This is already the current behavior; the design principle is to keep it
  that way as new UI is built.

**(3) Marketing/editorial content.** Hero copy, section headings/
subheadings, how-it-works copy, feature/value-proposition explanations, CTA
labels, download-app promotion, subscription copy, editorial category
labels, and decorative/trust/logo sections that are not an operational
fact. For MVP, this class's target home is a version-controlled, typed
frontend editorial-configuration boundary (§9) — no config file is created
in this checkpoint.

**(4) Media binaries.** The bytes themselves — never a React source file,
never a database row. Target: a provider-neutral "delivery class"
(object storage + CDN-shaped delivery), not a chosen vendor. An absolute
provider URL is a resolvable delivery detail, not a stable asset identity
(§6.4). Repository-local/bundled template images are, under this design, a
transitional or development-only asset class — the exact policy for which
images stay, move, or get replaced is Checkpoint 3 scope, not decided here.

### 6.3 Media references and metadata — ownership split

| Metadata | Catalog media (Property/RoomType-linked) | Editorial media (section/campaign-linked) |
| --- | --- | --- |
| Logical role (e.g. "cover", "gallery") | Backend catalog persistence/API boundary — already true today via `PropertyMedia.IsCover`/`RoomTypeMedia.IsCover` (Checkpoint 1 §2.1/§2.2) | MVP: frontend editorial configuration (§9); `Future work`: CMS (§11) |
| Association (which Property/RoomType/section) | Backend, via the existing `PropertyMedia`/`RoomTypeMedia` join tables | Frontend editorial configuration entry references the section it belongs to |
| Ordering | Backend `SortOrder`, already true today | Editorial configuration's own array/list order |
| Alt text | Backend `Media.AltText`, already true today | Editorial configuration entry |
| Stable asset identity/reference | `Target`: a provider-neutral identifier the backend owns and resolves to a delivery URL — **gap against the current model**, see §6.4 | `Target`: an editorial-configuration-owned reference, resolved the same provider-neutral way |
| Delivery URL / URL resolution | Resolved from the stable identity at read time (`Target`); `Current` model instead stores the URL itself as `Media.Url` | Same resolution mechanism, applied to editorial media |

### 6.4 Current `Media.Url` model — limitation and future implementation gap

`Current` (per Checkpoint 1 §2.1, §2.6): `Media.Url` (`Back_End/src/TheBha.Domain/Properties/Media.cs`)
is validated only as "an absolute http/https URL" and *is* the identity —
there is no separate stable key, storage path, or provider-neutral
reference alongside it. This is sufficient for the current
reserved-example-host development seed and for the frontend's own
`isUsableMediaUrl`/`selectCoverImage` filtering (Checkpoint 1 §2.7), which
operate purely on the URL string.

**Future implementation gap** (not raised or resolved in this checkpoint):
if the target design in §6.4/§10 eventually requires a stable,
provider-neutral asset identity that survives a delivery-location or
provider change (e.g. migrating where binaries are hosted without touching
every `PropertyMedia`/`RoomTypeMedia` row), the current `Media` entity has
no field for that — `Media.Url` conflates identity and delivery address.
Closing that gap would mean an EF Core schema change to `Media`, which is
explicitly out of scope for `DATA-001.1` (no migration authorized this
checkpoint) and is named here only so Checkpoint 3 / a future work item
does not have to rediscover it.

### 6.5 Development-only and unknown data — classification

| Class | Definition | Current example(s) |
| --- | --- | --- |
| Confirmed real data | A fact with actual Owner/business confirmation of accuracy | None identified in the current inventory — see Owner-confirmation candidates (§4) |
| Synthetic development data | Constructed for local development, not claimed as real by any evidence in code | The four `images.example.com` seed Media URLs (RFC 2606 reserved, non-functional by construction — Checkpoint 1 §2.6) |
| Unknown / Owner input required | Plausible-looking but with no code-level citation of its real-world accuracy | Seeded Property name/address/city/country/time zone, RoomType names/descriptions, seeded prices (Checkpoint 1 §2.6) |
| Rights-pending media | Any binary whose usage/licensing rights have not been confirmed | Not applicable to the current four seed Media rows (they are non-functional placeholders, not real images pending rights review); would apply to any future real photography before an Owner rights confirmation |
| Dormant template artifact | Bundled with the theme, unrelated to hotel domain, currently still rendering or present but inert | Hero real-estate copy/search form, both category sliders, author/host grid, download-app section, most of `src/images`/`src/data` (Checkpoint 1 §2.7/§2.9) |

This checkpoint only classifies; the seed policy that decides what to keep,
replace, or gate behind an environment flag is Checkpoint 3 scope.

### 6.6 Field-promotion discipline

A UI/content need may be proposed for promotion into the operational
database/API model only when **at least one** of the following holds:

- It affects booking or validation outcomes.
- It is a shared fact multiple clients/channels would need identically
  (not just one page's presentation choice).
- It requires server-authoritative mutation and/or audit history.
- It needs to be queried, filtered, or searched.
- It attaches stably to a specific Property/RoomType/RatePlan record's
  identity/lifecycle.
- It has a lifecycle independent of frontend deployment (i.e., it should be
  able to change without a frontend release, or vice versa).

A UI/content need must **not** be promoted merely because:

- A template happens to already have a text string in that position.
- The content is campaign/aesthetic in nature.
- Only one frontend section currently consumes it.
- It's expected to change alongside a frontend release anyway.
- The asset is purely decorative.

Applying this discipline to the current, verified `/home-2` inventory
(§2, §8): **no UI need in the currently active render tree justifies a new
operational database/API field.** Every field genuinely required for
booking-relevant display already exists and is already exposed
(`PropertyDto`, `RoomTypeDto`, `AvailabilityOfferDto` — Checkpoint 1
§2.1/§2.2/§2.5). The gaps Checkpoint 1 found (minimum/maximum stay,
arrival/departure controls, a write API for rates/inventory controls) are
pre-existing Application-layer capability questions, not something a
`/home-2` UI need is asking to be promoted — they are not re-litigated
here, and this document does not propose a schema/migration for them (that
would itself violate this checkpoint's prohibition on schema/API design).
If a future checkpoint or work item proposes a new field, it must record,
per this discipline: the business reason, the owning aggregate/boundary,
the consumer, why an editorial-configuration entry is insufficient, and an
explicit statement that it is future work, not current capability.

## 7. Source-of-truth matrix

Labels: **C** = Current, **T** = Target (this design), **F** = Future work
(named, not scoped here).

| Data/content class | Examples/current representation | Persistent authority | Validation/write boundary | Frontend read boundary | MVP ownership | Future extension | Prohibited duplicate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Property operational facts | Name, Slug, Description, Address, City, Country, TimeZone, CheckIn/CheckOutTime (Checkpoint 1 §2.1) | PostgreSQL `Properties` table (**C**) | `TheBha.Domain.Properties.Property` invariants + `PropertiesController` (**C**) | `PropertyDto` via `GET /api/v1/properties[/{id}]` only (**C**) | Backend catalog boundary (**C**) | None proposed | Frontend must never hold a parallel Property literal/fixture for this data |
| RoomType operational facts | Code, Name, Slug, Description, Base/MaxOccupancy (Checkpoint 1 §2.2) | PostgreSQL `RoomTypes` table (**C**) | `RoomType` invariants + `PropertiesController`/`RoomTypesController` (**C**) | `RoomTypeDto` via existing endpoints (**C**) | Backend catalog boundary (**C**) | None proposed | Same as above |
| Amenities (catalog-linked) | `Amenity` + `PropertyAmenity`/`RoomTypeAmenity` joins (Checkpoint 1 §2.1/§2.2) | PostgreSQL `Amenities` + join tables (**C**) | Domain + `PropertyCatalogQueries` filtering to `IsActive` (**C**) | Nested `AmenityDto[]` on `PropertyDto`/`RoomTypeDto` (**C**) | Backend catalog boundary (**C**) | None proposed | Frontend must not hard-code an amenity list/icon-label map that duplicates `Amenity.Name`/`Category` as a second source |
| RatePlan | Code, Name, Description, CurrencyCode (Checkpoint 1 §2.3) | PostgreSQL `RatePlans` table (**C**) | `RatePlan` invariants; no dedicated controller (**C**, confirmed absent) | Only flattened, no-Description fields inside an Availability offer (**C**); never a standalone list (**C**, confirmed absent) | Backend (**C**) | A `RatePlansController`/standalone listing is **F**, pending Owner input (§4 item 4) — not designed here | Frontend must not maintain its own RatePlan name/currency list |
| Daily rates | `DailyRoomRate` (Checkpoint 1 §2.4) | PostgreSQL `DailyRoomRates` table (**C**) | Domain invariants; `IDailyRoomRatePricing` exists but is called by no controller (**C**, confirmed unreachable) | Never exposed directly; only via `NightlyRateDto[]`/`TotalAmount` on an Availability offer (**C**) | Backend (**C** for reads, **F** for a reachable write path) | A management API surfacing `IDailyRoomRatePricing` is **F** | Frontend must never compute or store its own nightly price |
| Inventory controls | `DailyInventoryControl` (stop-sell, sellable limit) (Checkpoint 1 §2.4) | PostgreSQL `DailyInventoryControls` table (**C**) | Domain invariants; `IDailyInventoryControlCommands` exists but is called by no controller (**C**, confirmed unreachable) | Never exposed directly; only reflected in `AvailableRooms` on an offer, or the RoomType/date simply absent from results (**C**) | Backend (**C** for reads, **F** for a reachable write path) | A management API surfacing `IDailyInventoryControlCommands` is **F** | Frontend must never compute its own availability count |
| Availability offers | `AvailabilityOfferDto` (Checkpoint 1 §2.5) | Computed at request time from the above tables, PostgreSQL-sourced (**C**) | `AvailabilitySearch.SearchAsync` + `AvailabilityDataSource` (**C**) | `AvailabilityOfferDto` TS contract, field-for-field match confirmed (**C**) | Backend (**C**) | None proposed | Frontend must never persist/cache an offer as if it were a new fact independent of the next search |
| Hold/Reservation transactional data | BE-003 Hold/Reservation aggregates (referenced, not re-verified this checkpoint) | PostgreSQL, per BE-003 docs (**C**, out of this checkpoint's re-verification scope) | `TheBha.Application.Bookings` + `BookingHoldsController`/`ReservationsController` (**C**) | `BookingHoldProvider`/`BookingHoldPanel` read-only display of server state (**C**) | Backend (**C**) | None proposed — out of `DATA-001.1` scope entirely | Frontend must never fabricate a Hold/Reservation status independent of the server response |
| Catalog media association and metadata | `PropertyMedia`/`RoomTypeMedia` (`SortOrder`, `IsCover`), `Media.AltText`/`MediaType` (Checkpoint 1 §2.1/§2.2) | PostgreSQL join tables + `Media` table (**C**) | Domain + EF configuration (unique-cover-per-Property/RoomType constraint) (**C**) | Nested `MediaDto[]` on `PropertyDto`/`RoomTypeDto`/`AvailabilityOfferDto` (**C**) | Backend catalog boundary (**C**) | Stable provider-neutral asset identity alongside `Media.Url` is **F** (§6.4 gap) | Frontend must never re-derive ordering/cover/alt text itself (already true — `selectCoverImage` reads server flags, per Checkpoint 1 §2.7) |
| Media binaries | The seed's four placeholder images; bundled template images used as fallback (Checkpoint 1 §2.6/§2.7) | **T**: object-storage-class delivery, provider unnamed; **C** today: template images bundled in frontend build, seed URLs point at a non-functional reserved host | **F**: an upload/rights-acceptance boundary (Checkpoint 3) | Frontend renders whatever delivery URL it resolves/receives; never stores the binary itself | **T**: binaries are never "owned" by either the API request/response body or React source beyond a reference | Object-storage/CDN delivery class is **F**; no vendor chosen here | Neither backend DB row nor frontend bundle should be the "real" copy of a binary that the other also independently embeds |
| Property/RoomType marketing descriptions | `Property.Description`, `RoomType.Description` (Checkpoint 1 §2.1/§2.2) | PostgreSQL, same tables as the operational facts above (**C** — this is existing, implemented capability, not a proposal) | Same Domain/API boundary as Property/RoomType (**C**) | Rendered directly by `PropertyLiveCard`/`RoomTypeLiveCard` (**C**) | Backend catalog boundary (**C**) | None proposed — already correctly owned; kept in this matrix only because §B requires covering it explicitly | Frontend must not add a second, editorial-config-owned description for the same Property/RoomType |
| Site-wide editorial copy | Hero heading, "Happening cities" bullets, "Mobile Apps" copy, newsletter copy, etc. (Checkpoint 1 §2.7) | **T**: frontend editorial configuration (§9), version-controlled with the frontend | **T**: frontend build/deploy boundary, not the booking API | Frontend reads its own editorial configuration directly (no network round-trip needed) | **T**: frontend | CMS (§11) may take this over later without changing catalog authority | Must never be sourced from or duplicated into the booking database |
| Hero and section content | `SectionHero2` heading + `HeroRealEstateSearchForm` (currently real-estate-domain, dormant re: hotel booking — Checkpoint 1 §2.7 item 1) | Same as "Site-wide editorial copy" row (**T**) | Same (**T**) | Same (**T**) | **T**: frontend editorial configuration, or a Remove/repurpose candidate (§8) — Owner input pending (§4 item 7) | CMS (§11) | Must never become a Property/RoomType field |
| Brand identity assets | No confirmed real BHA-specific brand asset identified in the current inventory; the partner-logo grid (`logo1`–`logo5`) is generic template trust-logo content, not BHA's own brand identity (Checkpoint 1 §2.7 item 2) | **Unknown** — no real BHA brand asset (logo, favicon, etc.) was found anywhere in the current repository | N/A until an Owner supplies a real asset | N/A | **T**, once supplied: frontend-owned versioned brand asset, distinct class from both catalog and generic editorial media | CMS (§11) could host brand assets too | A future real BHA logo must not be modeled as `Media`/catalog media (it is not Property/RoomType-scoped) |
| Trust/customer/partner logos | `logo1`–`logo5` template images, `DEMO_AUTHORS` "author"/host cards (Checkpoint 1 §2.7 items 2, 8) | **T**: editorial media, if kept at all (§10) | **T**: frontend editorial configuration | **T**: frontend | **T**: frontend, or Remove/repurpose candidate (§8) | CMS (§11) | Must never be modeled as catalog media — none of it is Property/RoomType-scoped |
| Contact/location claims | Only `PropertyLiveCard`'s `formatLocation` (city/country) is real; no phone/email/contact claim exists anywhere today (Checkpoint 1 §2.7, confirmed absent) | City/country: PostgreSQL `Properties` table (**C**, already covered by the Property row above). Any future phone/email/contact-detail field is **Unknown** whether it should be Property-scoped operational data (if multi-property/contact-varies-by-property) or global editorial copy (if single, site-wide contact detail) | N/A until this is resolved | N/A | **Unknown** — genuinely underdetermined, not decided by this checkpoint | N/A | If added, must pick exactly one authority — never both a Property field and an editorial-config entry for the same contact fact |
| Download-app claims/assets | `SectionDowloadApp` — fully static, dead `href="##"` store links, no evidence any real BHA mobile app exists (Checkpoint 1 §2.7 item 6) | **T**, if kept: editorial configuration (app-store URLs and promotional copy are not booking-relevant facts) | **T**: frontend | **T**: frontend | **T**: frontend, or Remove/repurpose candidate (§8) — Owner input pending (§4 item 8) | N/A | Must never be modeled as catalog data |
| Newsletter/subscribe copy | `SectionSubscribe2` — static copy, non-functional `<form>` (Checkpoint 1 §2.7 item 10) | **T**, if kept: editorial configuration | **T**: frontend; a real subscription would need a **F** integration (unspecified) to actually deliver signups | **T**: frontend | **T**: frontend, or Remove/repurpose candidate (§8) | A real newsletter integration is **F**, unscoped | Must never be modeled as catalog data |
| Template fixtures | `DEMO_CATS`, `DEMO_CATS_2`, `DEMO_AUTHORS` (Checkpoint 1 §2.7/§2.9) | **C** today: frontend source literals/fixture modules | N/A | N/A | Development-only/dormant-template classification (§6.5); Remove/repurpose candidate (§8) — Owner input pending (§4 item 8) | N/A | Must never be treated as if it were real catalog or editorial content without an explicit Owner decision to keep it |
| Development-only synthetic data | Seed's four `images.example.com` Media rows (Checkpoint 1 §2.6) | PostgreSQL, seed-originated only (**C**) | `DevelopmentDataSeeder`, Development-environment-gated (**C**) | Filtered out by `isUsableMediaUrl` before render (**C**) | Backend seed boundary (**C**); detailed seed policy is Checkpoint 3 | Real media replacing these is **F**, pending Owner input (§4 item 2) | Must never be treated as production-ready by any consumer |
| Unknown / rights-pending data | Seeded Property/RoomType name, address, descriptions, prices (Checkpoint 1 §2.6) | PostgreSQL, seed-originated only (**C**) | Same as above (**C**) | Rendered as-is by live cards today, with no "unverified" indicator in the UI (**C** — a UX gap this design does not propose closing) | Classified `Unknown`, per §6.5, until Owner-confirmed (§4 items 1–2) | N/A | Must never be asserted as confirmed-real in any future document without an actual Owner confirmation on record |

## 8. Template-to-domain/content/media mapping

Covers the entire active `/home-2` render tree already inventoried in
Checkpoint 1 §2.7/§2.8, not only the three live sections.

| `/home-2` section/UI need | Current source | Content class | Existing domain/API field | Missing operational field, if justified | Editorial configuration | Media role/reference | Owner input or disposition | Target rendering rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero heading + `HeroRealEstateSearchForm` | `SectionHero2.tsx` | Marketing/editorial (currently wrong-domain) | None | None justified (§6.6) | Yes — heading text; the search widget itself is a component-replacement question, not a config-value question | Local bundled `hero-right-3.png` → editorial media (§10) if hero is kept in any form | Remove, hide, or repurpose candidate — §4 item 7 | If kept: render from editorial config, never from a Property/RoomType field. Not decided here whether it's kept |
| Partner-logo grid | `page.tsx` inline | Decorative/trust, not an operational fact | None | None justified | Yes, if kept | Local bundled `logo1..5.png` → editorial media, or brand-identity class if ever replaced with a real BHA asset (§10) | Remove, hide, or repurpose candidate — §4 item 8 | Editorial-config-driven list of logos, never hard-coded per §6.1 principle 2 once a config boundary exists |
| How-it-works (3-step) | `page.tsx` `data` prop + `SectionHowItWork.tsx` | Marketing/editorial | None | None justified | Yes | Local bundled `HIW2-*.png` → editorial media | Owner input on whether hotel-specific "how it works" copy should replace the current generic real-estate-flavored steps — not answered here | Editorial config, typed per §9 |
| Live Property card (`PropertyLiveCard`) | `SectionGridFeatureProperty.tsx` | Sellable/operational catalog | `PropertyDto` (name, location, description, times, amenities) — fully backed already | None justified (§6.6) | No — this is API-sourced, not editorial | Catalog media via `MediaDto`, resolved through `selectCoverImage` | None — already correctly sourced | Keep reading exclusively from `GET /api/v1/properties`; never fork a fixture copy |
| Live RoomType cards (`RoomTypeLiveCard`) | `SectionGridRoomTypes.tsx` | Sellable/operational catalog | `RoomTypeDto` — fully backed already | None justified | No | Catalog media via `MediaDto` | None | Same rule as Property card |
| Availability search + offer cards (`AvailabilityOfferCard`) | `SectionAvailabilitySearch.tsx` | Server-authoritative transactional calculation | `AvailabilityOfferDto` — fully backed already, contract-matched (Checkpoint 1 §2.5) | None justified | No | Catalog media via offer's `MediaDto` | None | Frontend must keep formatting-only behavior (`formatCurrencyAmount`); never compute a total/nightly rate itself |
| Hold CTA / current-hold boundary | `AvailabilityOfferCard` "Hold this room" → `BookingHoldProvider`/`BookingHoldPanel` | Server-authoritative transactional (Hold state) | Existing BE-003/FE-001.4 contract, out of this checkpoint's re-verification scope | Not evaluated here | No | N/A | None — out of `DATA-001.1` scope | No change proposed; boundary identified only so this design doesn't collide with it |
| "Our features" / value-proposition | `SectionOurFeatures.tsx` | Marketing/editorial | None | None justified | Yes | Local bundled `our-features-2.png` → editorial media | Remove, hide, or repurpose candidate — §4 item 8 | Editorial config |
| Download-app section | `SectionDowloadApp.tsx` | Marketing/editorial (currently non-functional) | None | None justified | Yes, if kept | Local bundled app-promo images → editorial media | Remove, hide, or repurpose candidate — §4 item 8 (no evidence a real app exists) | Editorial config, or removed entirely per Owner decision |
| Category slider #1 (`DEMO_CATS_2`, real-estate links) | `page.tsx` inline | Development-only synthetic / dormant template artifact | None | None justified | N/A unless repurposed | Remote `images.pexels.com` hotlinks — neither catalog nor an owned editorial asset today | Remove, hide, or repurpose candidate — §4 item 8 | If repurposed toward real hotel categories, would need a fresh editorial-config or catalog decision, not designed here |
| Category slider #2 (default `DEMO_CATS`) | `SectionSliderNewCategories.tsx` default | Development-only synthetic / dormant template artifact | None | None justified | N/A unless repurposed | Remote `images.pexels.com` hotlinks | Remove, hide, or repurpose candidate — §4 item 8 | Same as slider #1 |
| Author/host grid | `SectionGridAuthorBox.tsx` + `DEMO_AUTHORS` | Development-only synthetic / dormant template artifact (marketplace-domain concept absent from hotel Domain model) | None — no "host"/"author" concept exists in the Domain | None justified — this is a domain-mismatch, not a missing field | N/A unless repurposed | Fixture-defined images in `src/data/authors.ts` | Remove, hide, or repurpose candidate — §4 item 8 | Not designed here; likely removal given no hotel-domain analog exists |
| Newsletter/subscribe | `SectionSubscribe2.tsx` | Marketing/editorial (currently non-functional) | None | None justified | Yes, if kept | Local bundled `SVG-subcribe2.png` → editorial media | Remove, hide, or repurpose candidate — §4 item 8 | Editorial config; a functioning subscribe integration is future work, unscoped |
| Loading/empty/error states (Property, RoomType, Availability) | `SectionGridFeatureProperty.tsx`, `SectionGridRoomTypes.tsx`, `SectionAvailabilitySearch.tsx` | Server-authoritative transactional (status derived from API responses) | Already implemented (Checkpoint 1 §2.5/§2.7) | None justified | No — status copy strings ("Loading properties…", etc.) are small enough to be simple UI copy today; if made configurable later, that would be an editorial-config extension, not an operational field | N/A | None | No change proposed |
| Shared placeholder/fallback image (`placeholder-large-h.png`) | `propertyPresentation.ts` `selectCoverImage`, used by all three live cards | Media binary — currently a bundled template asset used as a **development fallback**, not catalog or editorial content itself | N/A | None justified | N/A | Development fallback class (§6.5); under this design, a fallback image is neither catalog media (it's not Property/RoomType-specific) nor typical editorial media (it's a system-level default, not campaign content) — it is its own "system fallback asset" role | None — already correctly used as a last-resort default; whether it stays a bundled template asset or becomes an object-storage-delivered default is Checkpoint 3 scope | Keep as the deterministic fallback whenever `selectCoverImage` returns nothing usable; do not remove without providing an equivalent |

Every row above disposes to exactly one of: existing operational domain/API
field, editorial configuration, catalog media metadata/reference, editorial
media reference, development-only synthetic data, or a Remove/hide/
repurpose candidate awaiting Owner input. No row required the "truly
missing operational field" disposition — consistent with §6.6's conclusion
that the currently active `/home-2` render tree does not justify any new
operational database/API field.

## 9. MVP editorial configuration boundary

Contract-level description only — no TypeScript file, no literal
production content is created in this checkpoint.

- **Ownership**: version-controlled with `Front_End/Customer_Web`, built
  and deployed alongside the frontend. Not the booking API's concern.
- **Shape**: typed, with stable section keys (e.g. a key per `/home-2`
  section identified in §8's mapping table — `hero`, `howItWorks`,
  `ourFeatures`, `downloadApp`, `newsletter`, etc.). "Stable" means a
  section's key does not change across unrelated content edits, so a
  future consumer (including a future CMS, §11) can target a section
  without a frontend code change.
- **What it may contain**: editorial copy, CTA labels, layout/variant
  choices (e.g. which card type a slider uses), and references to
  editorial media (§10) — never the media binary itself.
- **What it must never contain**: rates, inventory, availability, or any
  sellable/operational identifier (`PropertyId`, `RoomTypeId`,
  `RatePlanId`, etc.) as a source of truth. If an editorial section wants
  to reference a real operational fact (e.g. "our flagship Property"), the
  fact itself must still come from the API at render time — the
  configuration may hold at most a pointer (e.g. "feature Property X") or
  an explicitly Owner-confirmed snapshot value that is clearly labeled as
  a snapshot, never a second live copy of the fact. The anti-duplication
  rule is the same as §6.1 principle 1: exactly one authority, and an
  editorial "snapshot" must be visibly marked as a point-in-time copy, not
  presented as equivalent to a live API read.
- **Rights-pending assets**: a rights-pending media reference must never
  appear in this configuration as if it were approved, production-ready
  content — it stays out of the configuration (or behind an explicit
  not-yet-approved marker) until an Owner rights confirmation exists. This
  checkpoint does not design that acceptance procedure (Checkpoint 3).
- **Missing-content behavior**: each section must have an explicit,
  declared behavior for "no approved content yet" — one of: hide the
  section, render a neutral placeholder, or render a visibly
  development-only marker. Which behavior applies to which section is not
  decided in this checkpoint; the requirement is that the behavior be
  explicit and typed, not an accidental blank render.
- **Environment variables are not a CMS.** A `NEXT_PUBLIC_*`-style
  environment value may configure a deployment-level setting (e.g. an API
  base URL, as already done today), but it must never become the
  mechanism for delivering editorial copy or content — that is what the
  typed configuration boundary above (and, later, §11's CMS seam) is for.
- **No transient Hold state.** `BookingHoldProvider`'s in-memory Hold flow
  state (Checkpoint 1 §2.7) is request/session-scoped runtime state, not
  content, and must never be represented inside this editorial
  configuration.

Illustrative shape only (not an implementation, not literal production
content):

```text
EditorialSection<"hero"> = {
  key: "hero";
  heading: string;
  subheading?: string;
  media?: EditorialMediaRef;   // see §10 — never a raw binary
  missingContentBehavior: "hide" | "placeholder" | "devOnlyMarker";
}
```

## 10. Catalog-media and editorial-media ownership

### 10.1 Catalog media

- Attaches stably to a Property or RoomType record (`PropertyMedia`/
  `RoomTypeMedia`, already true today).
- Metadata (`SortOrder`, `IsCover`, `AltText`, `MediaType`) belongs to the
  backend catalog persistence/API boundary — unchanged from Current.
- Frontend receives a resolved presentation reference through the existing
  API (`MediaDto` nested in `PropertyDto`/`RoomTypeDto`/
  `AvailabilityOfferDto`) and must never re-derive ordering, cover choice,
  logical role, or association client-side — already true today
  (`selectCoverImage` reads server-provided flags, per Checkpoint 1 §2.7)
  and this design keeps it a hard rule.
- Missing/unusable media has a deterministic fallback — already true today
  (`placeholder-large-h.png`, per Checkpoint 1 §2.7) via the shared
  "system fallback asset" role identified in §8's last row.

### 10.2 Editorial media

- Attaches to a section, campaign, or layout choice — never to a sellable
  record.
- In the MVP, owned by the frontend editorial configuration (§9): a
  reference inside a typed config entry, not a database row.
- A future CMS (§11) can take over authoring/hosting this class without
  touching Property/RoomType/catalog-media ownership at all — the seam is
  exactly the editorial-configuration boundary itself.

### 10.3 Shared/brand assets — disambiguation rule

An asset is exactly one of the following at any time; this design
prohibits an asset carrying more than one ownership class without a
declared canonical role:

- **Brand identity** — represents BHA Hotels itself (e.g. a real logo,
  favicon). Per §7's matrix, no such asset was confirmed present in the
  current inventory. If/when one exists, it is frontend-owned and
  versioned separately from both catalog media and general editorial
  media, because unlike editorial media it is not tied to a particular
  section/campaign and unlike catalog media it is not tied to a sellable
  Property/RoomType record.
- **Catalog media** — tied to a specific Property/RoomType (§10.1).
- **Editorial media** — tied to a section/campaign, not a sellable record
  (§10.2).
- **Development fallback** — a system-level default shown when catalog
  media is missing/unusable (e.g. `placeholder-large-h.png`), not itself
  campaign content or a sellable-record asset. This is its own class, not
  a subtype of editorial media, because it is selected by absence-of-data
  logic (`selectCoverImage`) rather than by an editorial author's choice.

The current template's partner-logo grid (`logo1`–`logo5`) is, under this
rule, generic dormant editorial/trust-decoration content — **not** BHA
brand identity (no evidence it represents BHA at all) and **not** catalog
media (not Property/RoomType-scoped). Its disposition (kept as editorial,
or removed) is an Owner decision (§4 item 8), not resolved here.

Full storage-key contract, migration path from bundled/template assets to
an object-storage-class delivery, rights-acceptance procedure, and the
final missing-media lifecycle are Checkpoint 3 scope, not this section.

## 11. Future CMS extension path

This section names an extension seam; it does not select a CMS, does not
produce an integration plan, and does not write code.

- A future CMS may become the authoring/management system for editorial
  content (§9) and editorial media metadata (§10.2) — headings, CTA
  copy, layout choices, editorial image/asset references.
- A future CMS must never become an authority for pricing, inventory,
  availability, Hold, or Reservation data. Those remain exclusively
  PostgreSQL-backed and exclusively reachable through
  `TheBha.Api`, per §7's matrix — this is a hard boundary, not a
  preference.
- If a future CMS ever manages Property/RoomType **descriptive** content
  (e.g. it becomes the authoring tool for `Property.Description`) or
  catalog media **metadata**, the booking API remains the delivery/
  validation boundary the customer frontend reads through — the frontend
  must not read catalog facts directly from the CMS. Whatever the CMS
  produces would still have to reach the customer-facing frontend via
  `TheBha.Api` (or a still-undesigned ingestion path into PostgreSQL), not
  via a second, parallel frontend-to-CMS read path.
- The frontend must never assemble a single sellable offer by reading from
  both a CMS and the booking database independently at render time — this
  would recreate exactly the "duplicate source of truth" failure mode this
  entire design exists to prevent (§6.1 principle 1).
- No CMS vendor, hosting model, or integration mechanism is chosen here.

## 12. Remaining design work, Owner-input disposition, and checkpoint boundary

### 12.1 What this checkpoint locked in, independent of Owner answers

The following ownership/mapping decisions are provider-neutral and
fact-neutral, and hold regardless of how any Owner-confirmation candidate
(§4) is eventually answered:

- The single-authority principle and the six-class classification model
  (§6).
- The full source-of-truth matrix (§7) — every row's authority/boundary
  assignment is independent of whether, e.g., "The BHA Hotel" turns out to
  be real or placeholder data; that question affects the *value*, not the
  *ownership boundary*.
- The template mapping's disposition of every `/home-2` section into one
  of the seven fixed categories (§8) — the exact list of which template
  sections get removed vs. kept-as-editorial is not locked (that needs
  Owner input), but *that* a kept section would be editorial-configuration
  content, never a database field, is locked.
- The MVP editorial-configuration contract shape and rules (§9).
- The catalog-media/editorial-media/brand/fallback disambiguation rule
  (§10).
- The CMS extension seam and its hard boundary against ever owning
  pricing/inventory/availability/Hold/Reservation (§11).

### 12.2 Owner-confirmation candidates — disposition impact

Restating the eight items from Checkpoint 1 §4, each tied to the design
row/section it affects. No answer is invented here.

1. **Is "The BHA Hotel" real or placeholder?** Affects: §7's "Unknown /
   rights-pending data" row and the Property row's *value* only, not its
   authority (PostgreSQL/backend remains the authority either way). Until
   answered, this data stays classified `Unknown` per §6.5.
2. **Is there real, licensed hotel photography available?** Affects: §7's
   "Media binaries" and "Development-only synthetic data" rows, and §10.3
   (nothing to disambiguate as brand identity yet). Until answered, all
   current Media rows stay `Synthetic development data` and the
   `placeholder-large-h.png` fallback remains what every live card
   renders (per Checkpoint 1 §2.7).
3. **Is the missing DailyRoomRate/DailyInventoryControl write API an
   intentional deferral?** Affects: §7's Daily rates/Inventory controls
   rows' "Future extension" column. Until answered, this design records
   only that a reachable write path is `Future work`, not whether/when it
   should be built.
4. **Should RatePlan become independently browsable?** Affects: §7's
   RatePlan row's "Future extension" column. Until answered, RatePlan
   stays exposed only indirectly through an Availability offer (§6.2
   class 1, §7).
5. **Is flat, non-occupancy-based pricing the intended near-term model?**
   Affects: the "server-authoritative transactional calculations" class
   (§6.2 class 2) only in that any future occupancy-based pricing would
   still have to remain server-authoritative — the boundary is locked
   either way; only the pricing *formula* is unresolved, and that is not
   this checkpoint's concern.
6. **Are min/max-stay and arrival/departure controls planned?** Affects:
   nothing in this checkpoint's matrix directly (they weren't found in
   Checkpoint 1 and aren't proposed here per §6.6's field-promotion
   conclusion); relevant only to a future inventory-control design.
7. **Is the real-estate-domain hero content known/accepted debt?**
   Affects: §8's Hero row disposition (Remove/hide/repurpose candidate,
   unresolved) and §7's "Hero and section content" row.
8. **Are the non-hotel-domain template sections intended to be
   replaced/removed/kept?** Affects: nearly every "Remove, hide, or
   repurpose candidate" disposition in §8 (partner logos, how-it-works,
   our-features, download-app, both category sliders, author/host grid,
   newsletter) and the corresponding §7 matrix rows. Until answered, all
   of these stay classified as dormant template artifacts (§6.5) — this
   design does not decide to keep or remove any of them.

### 12.3 Conflicts or corrections against Checkpoint 1

None. No factual contradiction was found in the Checkpoint 1 inventory
(§1–§5) while producing this design; §1–§5 are unchanged from the prior
commit.

### 12.4 Not written in this checkpoint

Per the execution prompt's explicit exclusions, none of the following are
present anywhere in this document:

- Detailed development dataset policy.
- A seed manifest/contract.
- A seed environment-safety procedure.
- An asset-rights acceptance procedure.
- A detailed media upload/storage-key/resolution contract.
- A local/template-to-object-storage migration sequence.
- A final missing-media lifecycle.
- A `DATA-001.2` implementation plan.
- A final decision gate, `READY_FOR_DATA-001.2`,
  `DEFER_DATA-001.2_AND_START_FE-002.1`, or any other final
  recommendation.

These remain Checkpoint 3 scope. This checkpoint's deliverable is the
ownership/mapping design (§6–§11) that Checkpoint 3 can build a dataset/
media execution contract on top of without re-deriving source-of-truth
boundaries.
