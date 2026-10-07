namespace TheBha.Application.Properties;

public sealed record DailyRoomRateRangeQuery(Guid PropertyId, Guid RoomTypeId, Guid RatePlanId, DateOnly CheckIn, DateOnly CheckOut)
{
    public void Validate()
    {
        if (PropertyId == Guid.Empty || RoomTypeId == Guid.Empty || RatePlanId == Guid.Empty) throw new ArgumentException("Rate identifiers are required.");
        if (CheckIn >= CheckOut) throw new ArgumentException("checkIn must be earlier than checkOut.");
    }
}

public interface IDailyRoomRateQueries
{
    Task<IReadOnlyList<DailyRoomRateDto>> GetRangeAsync(DailyRoomRateRangeQuery query, CancellationToken cancellationToken);
}
