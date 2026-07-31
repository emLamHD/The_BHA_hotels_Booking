# DATA-001.1 — Sellable Catalog and Media Source-of-Truth Design

Status: Draft — Current-state inventory completed; target design not yet approved.

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
