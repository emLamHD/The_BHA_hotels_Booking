using TheBha.Domain.Common;
using TheBha.Domain.Properties;

namespace TheBha.UnitTests;

public sealed class PropertyRoomDomainTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");

    [Fact]
    public void Room_type_rejects_non_positive_base_occupancy()
    {
        var exception = Assert.Throws<DomainException>(() => CreateRoomType(Guid.NewGuid(), 0, 2));

        Assert.Contains("greater than zero", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Room_type_rejects_maximum_occupancy_below_base_occupancy()
    {
        var exception = Assert.Throws<DomainException>(() => CreateRoomType(Guid.NewGuid(), 3, 2));

        Assert.Contains("cannot be less", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Physical_room_rejects_room_type_from_another_property()
    {
        var roomType = CreateRoomType(Guid.NewGuid(), 2, 2);

        var exception = Assert.Throws<DomainException>(() => new PhysicalRoom(
            Guid.NewGuid(),
            Guid.NewGuid(),
            roomType,
            "101",
            1,
            OperationalStatus.Active,
            Now));

        Assert.Contains("same property", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Physical_room_accepts_each_supported_operational_status()
    {
        var propertyId = Guid.NewGuid();
        var roomType = CreateRoomType(propertyId, 2, 2);

        foreach (var status in Enum.GetValues<OperationalStatus>())
        {
            var room = new PhysicalRoom(
                Guid.NewGuid(),
                propertyId,
                roomType,
                Guid.NewGuid().ToString("N"),
                1,
                status,
                Now);

            Assert.Equal(status, room.OperationalStatus);
        }
    }

    [Fact]
    public void Physical_room_rejects_unknown_operational_status()
    {
        var propertyId = Guid.NewGuid();
        var roomType = CreateRoomType(propertyId, 2, 2);

        Assert.Throws<DomainException>(() => new PhysicalRoom(
            Guid.NewGuid(),
            propertyId,
            roomType,
            "101",
            1,
            (OperationalStatus)999,
            Now));
    }

    [Fact]
    public void Property_normalizes_slug_and_rejects_missing_required_values()
    {
        var property = new Property(
            Guid.NewGuid(),
            "The BHA Hotel",
            "  THE-BHA-HOTEL  ",
            null,
            "1 BHA Avenue",
            "Ho Chi Minh City",
            "Vietnam",
            "Asia/Ho_Chi_Minh",
            new TimeOnly(14, 0),
            new TimeOnly(12, 0),
            true,
            Now);

        Assert.Equal("the-bha-hotel", property.Slug);
        Assert.Throws<DomainException>(() => new Property(
            Guid.NewGuid(),
            " ",
            "slug",
            null,
            "address",
            "city",
            "country",
            "UTC",
            new TimeOnly(14, 0),
            new TimeOnly(12, 0),
            true,
            Now));
    }

    private static RoomType CreateRoomType(Guid propertyId, int baseOccupancy, int maxOccupancy)
    {
        return new RoomType(
            Guid.NewGuid(),
            propertyId,
            "DLX",
            "Deluxe",
            "deluxe",
            null,
            baseOccupancy,
            maxOccupancy,
            true,
            Now);
    }
}
