using TheBha.Domain.Properties;

namespace TheBha.Application.Scheduling;

/// <summary>
/// PMS-CAL-001.1: the read-only Admin Reservation Board projection. Composed
/// entirely from existing commercial (<c>ReservationUnit</c>/<c>ReservationUnitNight</c>,
/// ADR 0005) and physical (<c>RoomOccupancySegment</c>/<c>RoomBlock</c>, ADR 0006)
/// authority — this is a projection, never a competing write authority
/// (ADR 0005 Decision item 6).
/// </summary>
public static class ReservationBoardLimits
{
    public const int MinNights = 1;
    public const int MaxNights = 31;
}

/// <summary>
/// Describes a complete, Committed <c>ReservationUnit</c>'s Effective-assignment
/// coverage of its own full booked-night set — never only the requested window
/// (Master Execution Prompt contract detail 10).
/// </summary>
public enum StayCoverageStatus
{
    FullyAssigned,
    PartiallyAssigned,
    FullyUnassigned
}

public sealed record ReservationBoardPropertyDto(
    Guid Id,
    string Name,
    string TimeZone,
    DateOnly LocalToday,
    TimeOnly CheckInTime,
    TimeOnly CheckOutTime);

public sealed record ReservationBoardRoomTypeDto(
    Guid Id,
    string Code,
    string Name,
    bool IsActive);

public sealed record ReservationBoardPhysicalRoomDto(
    Guid Id,
    Guid RoomTypeId,
    string RoomNumber,
    int Floor,
    OperationalStatus OperationalStatus);

/// <summary>
/// One Effective <c>ReservationAssignment</c> segment, returned with its
/// authoritative, un-clipped dates (contract detail 8) — the frontend clips
/// for visible rendering, never the server.
/// </summary>
public sealed record ReservationBoardAssignmentDto(
    Guid SegmentId,
    uint SegmentVersion,
    Guid PhysicalRoomId,
    Guid ActualRoomTypeId,
    DateOnly StartDate,
    DateOnly EndDate);

/// <summary>
/// A maximal contiguous uncovered booked-night span for a Unit, clipped to the
/// requested <c>[from, to)</c> range (contract detail 9).
/// </summary>
public sealed record ReservationBoardUnassignedRangeDto(
    DateOnly StartDate,
    DateOnly EndDate);

public sealed record ReservationBoardStayDto(
    Guid ReservationId,
    Guid ReservationUnitId,
    string ConfirmationNumber,
    string GuestDisplayName,
    Guid SoldRoomTypeId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    StayCoverageStatus CoverageStatus,
    IReadOnlyList<ReservationBoardAssignmentDto> Assignments,
    IReadOnlyList<ReservationBoardUnassignedRangeDto> UnassignedRanges);

public sealed record ReservationBoardOperationalBlockDto(
    Guid RoomBlockId,
    Guid SegmentId,
    uint SegmentVersion,
    Guid PhysicalRoomId,
    DateOnly StartDate,
    DateOnly EndDate,
    string Reason);

public sealed record ReservationBoardDto(
    ReservationBoardPropertyDto Property,
    DateOnly From,
    DateOnly To,
    IReadOnlyList<ReservationBoardRoomTypeDto> RoomTypes,
    IReadOnlyList<ReservationBoardPhysicalRoomDto> PhysicalRooms,
    IReadOnlyList<ReservationBoardStayDto> Stays,
    IReadOnlyList<ReservationBoardOperationalBlockDto> OperationalBlocks);

public enum ReservationBoardStatus
{
    Success,
    Invalid,
    NotFound
}

public sealed record ReservationBoardResult(
    ReservationBoardStatus Status,
    ReservationBoardDto? Board,
    string? Error)
{
    public static ReservationBoardResult Success(ReservationBoardDto board) =>
        new(ReservationBoardStatus.Success, board, null);

    public static ReservationBoardResult Invalid(string error) =>
        new(ReservationBoardStatus.Invalid, null, error);

    public static ReservationBoardResult NotFound() =>
        new(ReservationBoardStatus.NotFound, null, null);
}

// --- Raw data shape loaded by Infrastructure (no coverage/business logic) ---

public sealed record ReservationBoardPropertyData(
    Guid Id,
    string Name,
    string TimeZone,
    TimeOnly CheckInTime,
    TimeOnly CheckOutTime);

public sealed record ReservationBoardRoomTypeData(Guid Id, string Code, string Name, bool IsActive);

public sealed record ReservationBoardPhysicalRoomData(
    Guid Id,
    Guid RoomTypeId,
    string RoomNumber,
    int Floor);

/// <summary>One night of one Committed Unit's complete (unbounded-by-window) booked-night set.</summary>
public sealed record ReservationBoardUnitNightData(Guid ReservationUnitId, DateOnly StayDate);

public sealed record ReservationBoardUnitData(
    Guid ReservationId,
    Guid ReservationUnitId,
    string ConfirmationNumber,
    string GuestDisplayName,
    Guid SoldRoomTypeId);

/// <summary>One Effective ReservationAssignment segment for a candidate Unit, un-clipped.</summary>
public sealed record ReservationBoardAssignmentData(
    Guid SegmentId,
    uint SegmentVersion,
    Guid ReservationUnitId,
    Guid PhysicalRoomId,
    Guid ActualRoomTypeId,
    DateOnly StartDate,
    DateOnly EndDate);

public sealed record ReservationBoardOperationalBlockData(
    Guid SegmentId,
    uint SegmentVersion,
    Guid RoomBlockId,
    Guid PhysicalRoomId,
    DateOnly StartDate,
    DateOnly EndDate,
    string Reason);

/// <summary>
/// Everything the Application layer needs to assemble one
/// <see cref="ReservationBoardDto"/>, already scoped to one Property and the
/// requested window (candidate Units' nights/assignments are loaded in full,
/// never clipped, so full-Unit coverage — contract detail 10 — is exact).
/// </summary>
public sealed record ReservationBoardRawData(
    ReservationBoardPropertyData Property,
    IReadOnlyList<ReservationBoardPhysicalRoomData> PhysicalRooms,
    IReadOnlyList<ReservationBoardRoomTypeData> RoomTypes,
    IReadOnlyList<ReservationBoardUnitData> Units,
    IReadOnlyList<ReservationBoardUnitNightData> UnitNights,
    IReadOnlyList<ReservationBoardAssignmentData> Assignments,
    IReadOnlyList<ReservationBoardOperationalBlockData> OperationalBlocks);

/// <summary>
/// Infrastructure-owned raw loader. Returns <c>null</c> only when the Property
/// itself does not exist or is inactive (contract: 404). Every other shape is
/// scoped to that Property and, for OperationalBlocks, the requested window;
/// candidate Units' nights/assignments are loaded in full — see
/// <see cref="ReservationBoardRawData"/>.
/// </summary>
public interface IReservationBoardDataSource
{
    Task<ReservationBoardRawData?> LoadAsync(
        Guid propertyId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken);
}

public interface IReservationBoardQuery
{
    Task<ReservationBoardResult> GetBoardAsync(
        Guid propertyId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken);
}

public sealed class ReservationBoardQuery(
    IReservationBoardDataSource dataSource,
    TimeProvider timeProvider) : IReservationBoardQuery
{
    public async Task<ReservationBoardResult> GetBoardAsync(
        Guid propertyId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        var validationError = Validate(propertyId, from, to);
        if (validationError is not null)
        {
            return ReservationBoardResult.Invalid(validationError);
        }

        var raw = await dataSource.LoadAsync(propertyId, from, to, cancellationToken);
        if (raw is null)
        {
            return ReservationBoardResult.NotFound();
        }

        var utcNow = timeProvider.GetUtcNow();
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(raw.Property.TimeZone);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, timeZone).DateTime);

        var propertyDto = new ReservationBoardPropertyDto(
            raw.Property.Id,
            raw.Property.Name,
            raw.Property.TimeZone,
            localToday,
            raw.Property.CheckInTime,
            raw.Property.CheckOutTime);

        var physicalRooms = raw.PhysicalRooms
            .Select(room => new ReservationBoardPhysicalRoomDto(
                room.Id, room.RoomTypeId, room.RoomNumber, room.Floor, OperationalStatus.Active))
            .OrderBy(room => room.Floor)
            .ThenBy(room => room.RoomNumber, StringComparer.Ordinal)
            .ThenBy(room => room.Id)
            .ToList();

        var roomTypes = raw.RoomTypes
            .Select(roomType => new ReservationBoardRoomTypeDto(
                roomType.Id, roomType.Code, roomType.Name, roomType.IsActive))
            .OrderBy(roomType => roomType.Name, StringComparer.Ordinal)
            .ThenBy(roomType => roomType.Code, StringComparer.Ordinal)
            .ThenBy(roomType => roomType.Id)
            .ToList();

        var nightsByUnit = raw.UnitNights
            .GroupBy(night => night.ReservationUnitId)
            .ToDictionary(group => group.Key, group => group.Select(night => night.StayDate).ToHashSet());

        var assignmentsByUnit = raw.Assignments
            .GroupBy(assignment => assignment.ReservationUnitId)
            .ToDictionary(group => group.Key, group => group.ToList());

        var stays = new List<ReservationBoardStayDto>();
        foreach (var unit in raw.Units)
        {
            var bookedDates = nightsByUnit.GetValueOrDefault(unit.ReservationUnitId) ?? [];
            if (bookedDates.Count == 0)
            {
                continue;
            }

            var unitAssignments = assignmentsByUnit.GetValueOrDefault(unit.ReservationUnitId)
                ?? [];

            var coveredDates = new HashSet<DateOnly>();
            foreach (var assignment in unitAssignments)
            {
                for (var date = assignment.StartDate; date < assignment.EndDate; date = date.AddDays(1))
                {
                    coveredDates.Add(date);
                }
            }

            var coverageStatus = coveredDates.Count == 0
                ? StayCoverageStatus.FullyUnassigned
                : bookedDates.All(coveredDates.Contains)
                    ? StayCoverageStatus.FullyAssigned
                    : StayCoverageStatus.PartiallyAssigned;

            var checkIn = bookedDates.Min();
            var checkOut = bookedDates.Max().AddDays(1);

            var visibleAssignments = unitAssignments
                .Where(assignment => assignment.StartDate < to && assignment.EndDate > from)
                .Select(assignment => new ReservationBoardAssignmentDto(
                    assignment.SegmentId,
                    assignment.SegmentVersion,
                    assignment.PhysicalRoomId,
                    assignment.ActualRoomTypeId,
                    assignment.StartDate,
                    assignment.EndDate))
                .OrderBy(assignment => assignment.StartDate)
                .ThenBy(assignment => assignment.EndDate)
                .ThenBy(assignment => assignment.PhysicalRoomId)
                .ThenBy(assignment => assignment.SegmentId)
                .ToList();

            var uncoveredDates = bookedDates
                .Where(date => !coveredDates.Contains(date))
                .Where(date => date >= from && date < to)
                .OrderBy(date => date)
                .ToList();
            var unassignedRanges = BuildContiguousRanges(uncoveredDates);

            stays.Add(new ReservationBoardStayDto(
                unit.ReservationId,
                unit.ReservationUnitId,
                unit.ConfirmationNumber,
                unit.GuestDisplayName,
                unit.SoldRoomTypeId,
                checkIn,
                checkOut,
                coverageStatus,
                visibleAssignments,
                unassignedRanges));
        }

        stays = stays
            .OrderBy(stay => stay.CheckIn)
            .ThenBy(stay => stay.ConfirmationNumber, StringComparer.Ordinal)
            .ThenBy(stay => stay.ReservationUnitId)
            .ToList();

        var operationalBlocks = raw.OperationalBlocks
            .Select(block => new ReservationBoardOperationalBlockDto(
                block.RoomBlockId,
                block.SegmentId,
                block.SegmentVersion,
                block.PhysicalRoomId,
                block.StartDate,
                block.EndDate,
                block.Reason))
            .OrderBy(block => block.StartDate)
            .ThenBy(block => block.PhysicalRoomId)
            .ThenBy(block => block.RoomBlockId)
            .ThenBy(block => block.SegmentId)
            .ToList();

        var board = new ReservationBoardDto(
            propertyDto, from, to, roomTypes, physicalRooms, stays, operationalBlocks);
        return ReservationBoardResult.Success(board);
    }

    /// <summary>
    /// Groups a sorted, distinct set of uncovered booked dates into maximal
    /// contiguous half-open ranges (contract detail 9/20).
    /// </summary>
    private static List<ReservationBoardUnassignedRangeDto> BuildContiguousRanges(
        IReadOnlyList<DateOnly> sortedDates)
    {
        var ranges = new List<ReservationBoardUnassignedRangeDto>();
        var index = 0;
        while (index < sortedDates.Count)
        {
            var start = sortedDates[index];
            var end = start.AddDays(1);
            var next = index + 1;
            while (next < sortedDates.Count && sortedDates[next] == end)
            {
                end = end.AddDays(1);
                next += 1;
            }

            ranges.Add(new ReservationBoardUnassignedRangeDto(start, end));
            index = next;
        }

        return ranges;
    }

    private static string? Validate(Guid propertyId, DateOnly from, DateOnly to)
    {
        if (propertyId == Guid.Empty)
        {
            return "propertyId is required.";
        }

        if (from >= to)
        {
            return "from must be earlier than to.";
        }

        var nights = to.DayNumber - from.DayNumber;
        if (nights < ReservationBoardLimits.MinNights || nights > ReservationBoardLimits.MaxNights)
        {
            return $"The requested range must be between {ReservationBoardLimits.MinNights} and {ReservationBoardLimits.MaxNights} nights.";
        }

        return null;
    }
}
