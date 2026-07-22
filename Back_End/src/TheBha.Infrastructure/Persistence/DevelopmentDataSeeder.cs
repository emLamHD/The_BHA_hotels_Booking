using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

public sealed class DevelopmentDataSeeder
{
    public const int DailyRateSeedDays = 14;
    private readonly TheBhaDbContext dbContext;
    private readonly TimeProvider timeProvider;

    public DevelopmentDataSeeder(TheBhaDbContext dbContext, TimeProvider? timeProvider = null)
    {
        this.dbContext = dbContext;
        this.timeProvider = timeProvider ?? TimeProvider.System;
    }

    private DateTimeOffset SeedTimestamp => timeProvider.GetUtcNow();

    public async Task SeedAsync(CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var property = await dbContext.Properties
            .SingleOrDefaultAsync(item => item.Slug == "the-bha-hotel", cancellationToken);

        if (property is null)
        {
            property = new Property(
                Guid.Parse("10000000-0000-0000-0000-000000000001"),
                "The BHA Hotel",
                "the-bha-hotel",
                "A welcoming city hotel operated independently by The BHA Hotels.",
                "1 BHA Avenue",
                "Ho Chi Minh City",
                "Vietnam",
                "Asia/Ho_Chi_Minh",
                new TimeOnly(14, 0),
                new TimeOnly(12, 0),
                true,
                SeedTimestamp);
            dbContext.Properties.Add(property);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        var amenities = await EnsureAmenitiesAsync(cancellationToken);
        var roomTypes = await EnsureRoomTypesAsync(property.Id, cancellationToken);
        await EnsureRatePlanAsync(property.Id, cancellationToken);
        var ratePlan = await dbContext.RatePlans.SingleAsync(
            item => item.PropertyId == property.Id && item.Code == "STANDARD", cancellationToken);
        await EnsureDailyRoomRatesAsync(property, roomTypes, ratePlan, cancellationToken);
        await EnsurePhysicalRoomsAsync(property.Id, roomTypes, cancellationToken);
        var media = await EnsureMediaAsync(cancellationToken);
        await EnsureAssociationsAsync(property.Id, roomTypes, amenities, media, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    private async Task EnsureRatePlanAsync(Guid propertyId, CancellationToken cancellationToken)
    {
        var exists = await dbContext.RatePlans.AnyAsync(
            ratePlan => ratePlan.PropertyId == propertyId && ratePlan.Code == "STANDARD",
            cancellationToken);
        if (!exists)
        {
            dbContext.RatePlans.Add(new RatePlan(
                Guid.Parse("60000000-0000-0000-0000-000000000001"),
                propertyId,
                "STANDARD",
                "Standard Rate",
                null,
                "VND",
                true,
                SeedTimestamp));
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task EnsureDailyRoomRatesAsync(Property property, IReadOnlyDictionary<string, RoomType> roomTypes, RatePlan ratePlan, CancellationToken cancellationToken)
    {
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(property.TimeZone);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(timeProvider.GetUtcNow(), timeZone).DateTime);
        var definitions = new[] { ("DLX-KING", 1500000m), ("FAMILY", 2200000m) };
        foreach (var definition in definitions)
        {
            for (var offset = 0; offset < DailyRateSeedDays; offset++)
            {
                var stayDate = localToday.AddDays(offset);
                if (!await dbContext.DailyRoomRates.AnyAsync(item => item.PropertyId == property.Id && item.RoomTypeId == roomTypes[definition.Item1].Id && item.RatePlanId == ratePlan.Id && item.StayDate == stayDate, cancellationToken))
                {
                    dbContext.DailyRoomRates.Add(new DailyRoomRate(Guid.NewGuid(), property.Id, roomTypes[definition.Item1].Id, ratePlan.Id, stayDate, definition.Item2, SeedTimestamp));
                }
            }
        }
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<Dictionary<string, Amenity>> EnsureAmenitiesAsync(
        CancellationToken cancellationToken)
    {
        var definitions = new[]
        {
            new AmenityDefinition("WIFI", "Complimentary Wi-Fi", "Connectivity", "20000000-0000-0000-0000-000000000001"),
            new AmenityDefinition("POOL", "Swimming Pool", "Wellness", "20000000-0000-0000-0000-000000000002"),
            new AmenityDefinition("BREAKFAST", "Breakfast", "Dining", "20000000-0000-0000-0000-000000000003"),
            new AmenityDefinition("AIRCON", "Air Conditioning", "Room", "20000000-0000-0000-0000-000000000004")
        };

        var result = new Dictionary<string, Amenity>(StringComparer.Ordinal);
        foreach (var definition in definitions)
        {
            var amenity = await dbContext.Amenities
                .SingleOrDefaultAsync(item => item.Code == definition.Code, cancellationToken);
            if (amenity is null)
            {
                amenity = new Amenity(
                    Guid.Parse(definition.Id),
                    definition.Code,
                    definition.Name,
                    definition.Category,
                    true);
                dbContext.Amenities.Add(amenity);
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            result.Add(definition.Code, amenity);
        }

        return result;
    }

    private async Task<Dictionary<string, RoomType>> EnsureRoomTypesAsync(
        Guid propertyId,
        CancellationToken cancellationToken)
    {
        var definitions = new[]
        {
            new RoomTypeDefinition(
                "DLX-KING",
                "Deluxe King",
                "deluxe-king",
                "A comfortable king room for couples and solo travellers.",
                2,
                2,
                "30000000-0000-0000-0000-000000000001"),
            new RoomTypeDefinition(
                "FAMILY",
                "Family Suite",
                "family-suite",
                "A spacious suite for families.",
                2,
                4,
                "30000000-0000-0000-0000-000000000002")
        };

        var result = new Dictionary<string, RoomType>(StringComparer.Ordinal);
        foreach (var definition in definitions)
        {
            var roomType = await dbContext.RoomTypes.SingleOrDefaultAsync(
                item => item.PropertyId == propertyId && item.Code == definition.Code,
                cancellationToken);
            if (roomType is null)
            {
                roomType = new RoomType(
                    Guid.Parse(definition.Id),
                    propertyId,
                    definition.Code,
                    definition.Name,
                    definition.Slug,
                    definition.Description,
                    definition.BaseOccupancy,
                    definition.MaxOccupancy,
                    true,
                    SeedTimestamp);
                dbContext.RoomTypes.Add(roomType);
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            result.Add(definition.Code, roomType);
        }

        return result;
    }

    private async Task EnsurePhysicalRoomsAsync(
        Guid propertyId,
        IReadOnlyDictionary<string, RoomType> roomTypes,
        CancellationToken cancellationToken)
    {
        var definitions = new[]
        {
            new PhysicalRoomDefinition("101", 1, "DLX-KING", "40000000-0000-0000-0000-000000000001"),
            new PhysicalRoomDefinition("102", 1, "DLX-KING", "40000000-0000-0000-0000-000000000002"),
            new PhysicalRoomDefinition("201", 2, "FAMILY", "40000000-0000-0000-0000-000000000003")
        };

        foreach (var definition in definitions)
        {
            var exists = await dbContext.PhysicalRooms.AnyAsync(
                room => room.PropertyId == propertyId && room.RoomNumber == definition.RoomNumber,
                cancellationToken);
            if (exists)
            {
                continue;
            }

            dbContext.PhysicalRooms.Add(new PhysicalRoom(
                Guid.Parse(definition.Id),
                propertyId,
                roomTypes[definition.RoomTypeCode],
                definition.RoomNumber,
                definition.Floor,
                OperationalStatus.Active,
                SeedTimestamp));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<Dictionary<string, Media>> EnsureMediaAsync(CancellationToken cancellationToken)
    {
        var definitions = new[]
        {
            new MediaDefinition("PROPERTY-COVER", "https://images.example.com/the-bha/property-cover.jpg", "The BHA Hotel exterior", "50000000-0000-0000-0000-000000000001"),
            new MediaDefinition("PROPERTY-LOBBY", "https://images.example.com/the-bha/lobby.jpg", "The BHA Hotel lobby", "50000000-0000-0000-0000-000000000002"),
            new MediaDefinition("DELUXE-COVER", "https://images.example.com/the-bha/deluxe-king.jpg", "Deluxe King room", "50000000-0000-0000-0000-000000000003"),
            new MediaDefinition("FAMILY-COVER", "https://images.example.com/the-bha/family-suite.jpg", "Family Suite", "50000000-0000-0000-0000-000000000004")
        };

        var result = new Dictionary<string, Media>(StringComparer.Ordinal);
        foreach (var definition in definitions)
        {
            var item = await dbContext.Media
                .SingleOrDefaultAsync(media => media.Url == definition.Url, cancellationToken);
            if (item is null)
            {
                item = new Media(
                    Guid.Parse(definition.Id),
                    definition.Url,
                    definition.AltText,
                    MediaType.Image,
                    SeedTimestamp);
                dbContext.Media.Add(item);
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            result.Add(definition.Key, item);
        }

        return result;
    }

    private async Task EnsureAssociationsAsync(
        Guid propertyId,
        IReadOnlyDictionary<string, RoomType> roomTypes,
        IReadOnlyDictionary<string, Amenity> amenities,
        IReadOnlyDictionary<string, Media> media,
        CancellationToken cancellationToken)
    {
        foreach (var code in new[] { "WIFI", "POOL", "BREAKFAST" })
        {
            if (!await dbContext.PropertyAmenities.AnyAsync(
                    link => link.PropertyId == propertyId && link.AmenityId == amenities[code].Id,
                    cancellationToken))
            {
                dbContext.PropertyAmenities.Add(new PropertyAmenity(propertyId, amenities[code].Id));
            }
        }

        var roomAmenityDefinitions = new[]
        {
            (RoomTypeCode: "DLX-KING", AmenityCode: "WIFI"),
            (RoomTypeCode: "DLX-KING", AmenityCode: "AIRCON"),
            (RoomTypeCode: "FAMILY", AmenityCode: "WIFI"),
            (RoomTypeCode: "FAMILY", AmenityCode: "AIRCON"),
            (RoomTypeCode: "FAMILY", AmenityCode: "BREAKFAST")
        };
        foreach (var definition in roomAmenityDefinitions)
        {
            var roomTypeId = roomTypes[definition.RoomTypeCode].Id;
            var amenityId = amenities[definition.AmenityCode].Id;
            if (!await dbContext.RoomTypeAmenities.AnyAsync(
                    link => link.RoomTypeId == roomTypeId && link.AmenityId == amenityId,
                    cancellationToken))
            {
                dbContext.RoomTypeAmenities.Add(new RoomTypeAmenity(roomTypeId, amenityId));
            }
        }

        await AddPropertyMediaIfMissingAsync(propertyId, media["PROPERTY-COVER"].Id, 0, true, cancellationToken);
        await AddPropertyMediaIfMissingAsync(propertyId, media["PROPERTY-LOBBY"].Id, 10, false, cancellationToken);
        await AddRoomTypeMediaIfMissingAsync(roomTypes["DLX-KING"].Id, media["DELUXE-COVER"].Id, cancellationToken);
        await AddRoomTypeMediaIfMissingAsync(roomTypes["FAMILY"].Id, media["FAMILY-COVER"].Id, cancellationToken);

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task AddPropertyMediaIfMissingAsync(
        Guid propertyId,
        Guid mediaId,
        int sortOrder,
        bool isCover,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.PropertyMedia.AnyAsync(
                link => link.PropertyId == propertyId && link.MediaId == mediaId,
                cancellationToken))
        {
            dbContext.PropertyMedia.Add(new PropertyMedia(propertyId, mediaId, sortOrder, isCover));
        }
    }

    private async Task AddRoomTypeMediaIfMissingAsync(
        Guid roomTypeId,
        Guid mediaId,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.RoomTypeMedia.AnyAsync(
                link => link.RoomTypeId == roomTypeId && link.MediaId == mediaId,
                cancellationToken))
        {
            dbContext.RoomTypeMedia.Add(new RoomTypeMedia(roomTypeId, mediaId, 0, true));
        }
    }

    private sealed record AmenityDefinition(string Code, string Name, string Category, string Id);
    private sealed record RoomTypeDefinition(
        string Code,
        string Name,
        string Slug,
        string Description,
        int BaseOccupancy,
        int MaxOccupancy,
        string Id);
    private sealed record PhysicalRoomDefinition(string RoomNumber, int Floor, string RoomTypeCode, string Id);
    private sealed record MediaDefinition(string Key, string Url, string AltText, string Id);
}
