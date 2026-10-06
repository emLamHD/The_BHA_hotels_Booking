using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Demo;

/// <summary>An argument or option the seeder refuses before it reads or writes anything.</summary>
public sealed class RiversideSeedValidationException(string message) : Exception(message);

/// <summary>What one run is asked to seed: where the photographs are served from and which nights.</summary>
public sealed record RiversideSeedOptions
{
    public const int MaxDays = 366;

    /// <summary>HTTPS origin that serves <see cref="RiversideDemoCatalog.MediaPathPrefix"/>; no trailing slash.</summary>
    public required string MediaOrigin { get; init; }

    public required DateOnly From { get; init; }
    public required int Days { get; init; }

    public DateOnly ToExclusive => From.AddDays(Days);

    public static bool TryCreate(string? mediaBaseUrl, DateOnly from, int days, out RiversideSeedOptions? options, out string? error)
    {
        options = null;
        if (days < 1 || days > MaxDays)
        {
            error = $"days must be between 1 and {MaxDays}.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(mediaBaseUrl) ||
            !Uri.TryCreate(mediaBaseUrl.Trim(), UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            (uri.AbsolutePath != "/" && !string.IsNullOrEmpty(uri.AbsolutePath)))
        {
            error = "media base URL must be an https origin (scheme and host, optional port) with no path, query, user or fragment.";
            return false;
        }

        options = new RiversideSeedOptions { MediaOrigin = uri.GetLeftPart(UriPartial.Authority), From = from, Days = days };
        error = null;
        return true;
    }
}

public sealed record SeedTableCount(string Table, int Existing, int ToInsert);

/// <summary>
/// The outcome of a run: what exists, what would be (or was) inserted, what was left alone on
/// purpose (<see cref="Warnings"/>) and what stops the run (<see cref="Conflicts"/>).
/// Contains counts and the media origin only — no connection detail, no secret.
/// </summary>
public sealed record RiversideSeedPlan(
    DateOnly From,
    DateOnly ToExclusive,
    string MediaOrigin,
    bool PropertyExists,
    IReadOnlyList<SeedTableCount> Tables,
    IReadOnlyList<string> Warnings,
    IReadOnlyList<string> Conflicts,
    bool Applied)
{
    public bool HasConflicts => Conflicts.Count > 0;
    public int TotalInserts => Tables.Sum(table => table.ToInsert);
}

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: seeds the Riverside demo catalog — one Property, three
/// RoomTypes stocked by 3 / 2 / 6 PhysicalRooms, one VND rate plan, flat nightly rates for a
/// window of nights, two Owner-stated amenities and the photograph associations.
///
/// <para>
/// Insert-only. Every row is looked up by its natural key (Property slug, RoomType code,
/// room number, rate-plan code, rate tuple, amenity code, media URL, link keys) and is created
/// only when absent: nothing is updated, deleted, reactivated or re-priced, so whatever an
/// operator changed afterwards survives any rerun. A second cover is never added. A rerun with
/// the same options inserts nothing; a longer window inserts only the missing nights.
/// </para>
///
/// <para>
/// A conflict the seeder will not paper over — a slug or id already taken, a demo room number
/// that belongs to another RoomType, a rate plan in another currency — stops the run before
/// any write, so duplicates are never created to force 3 / 2 / 6. Drift that is only the
/// operator's choice (an inactive room, an extra room, an existing cover) is reported as a
/// warning and left alone. Apply runs in one transaction and verifies its result before commit.
/// </para>
///
/// <para>
/// This class does not decide which database it may touch; <c>RiversideDemoSeedCommand</c>
/// does, before it is called. Availability is never written: it is computed by the API from
/// stock, holds, reservations and blocks.
/// </para>
/// </summary>
public sealed class RiversideDemoSeeder(TheBhaDbContext dbContext, TimeProvider timeProvider)
{
    /// <summary>Serializes two operators applying at once (transaction-scoped advisory lock key).</summary>
    private const long ApplyLockKey = 7_311_002_001;

    public Task<RiversideSeedPlan> PlanAsync(RiversideSeedOptions options, CancellationToken cancellationToken) =>
        RunAsync(options, apply: false, cancellationToken);

    public Task<RiversideSeedPlan> ApplyAsync(RiversideSeedOptions options, CancellationToken cancellationToken) =>
        RunAsync(options, apply: true, cancellationToken);

    private async Task RunLockAsync(CancellationToken cancellationToken) =>
        await dbContext.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock({0})", [ApplyLockKey], cancellationToken);

    private async Task<RiversideSeedPlan> RunAsync(RiversideSeedOptions options, bool apply, CancellationToken cancellationToken)
    {
        await using var transaction = apply ? await dbContext.Database.BeginTransactionAsync(cancellationToken) : null;
        if (apply)
        {
            await RunLockAsync(cancellationToken);
        }

        var now = timeProvider.GetUtcNow();
        var warnings = new List<string>();
        var conflicts = new List<string>();
        var counts = new List<SeedTableCount>();

        // ---- Property ------------------------------------------------------------------
        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Slug == RiversideDemoCatalog.PropertySlug, cancellationToken);
        var propertyId = property?.Id ?? RiversideDemoCatalog.PropertyId;
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(property?.TimeZone ?? RiversideDemoCatalog.TimeZoneId);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, timeZone).DateTime);
        if (options.From < localToday)
        {
            throw new RiversideSeedValidationException(
                $"--from {options.From:yyyy-MM-dd} is before the property's local today ({localToday:yyyy-MM-dd}); seed future nights only.");
        }

        var stageProperty = new List<object>();
        if (property is null)
        {
            if (await dbContext.Properties.AnyAsync(item => item.Id == propertyId, cancellationToken))
            {
                conflicts.Add("the Riverside property id is already used by another property.");
            }

            stageProperty.Add(new Property(
                propertyId, RiversideDemoCatalog.PropertyName, RiversideDemoCatalog.PropertySlug,
                RiversideDemoCatalog.PropertyDescription, RiversideDemoCatalog.PendingAddress,
                RiversideDemoCatalog.PendingCity, RiversideDemoCatalog.Country, RiversideDemoCatalog.TimeZoneId,
                new TimeOnly(14, 0), new TimeOnly(12, 0), true, now));
        }
        else if (!property.IsActive)
        {
            warnings.Add("the Riverside property is inactive; left as it is.");
        }

        counts.Add(new("Properties", property is null ? 0 : 1, stageProperty.Count));

        // ---- Amenities (global by code) -------------------------------------------------
        var amenityCodes = RiversideDemoCatalog.PropertyAmenities.Select(item => item.Code).ToArray();
        var existingAmenities = await dbContext.Amenities.AsNoTracking()
            .Where(item => amenityCodes.Contains(item.Code)).ToDictionaryAsync(item => item.Code, cancellationToken);
        var stageCatalog = new List<object>();
        var amenityIds = new Dictionary<string, Guid>();
        foreach (var definition in RiversideDemoCatalog.PropertyAmenities)
        {
            if (existingAmenities.TryGetValue(definition.Code, out var existing))
            {
                amenityIds[definition.Code] = existing.Id;
                continue;
            }

            if (await dbContext.Amenities.AnyAsync(item => item.Id == definition.Id, cancellationToken))
            {
                conflicts.Add($"amenity id for {definition.Code} is already used by another amenity.");
            }

            amenityIds[definition.Code] = definition.Id;
            stageCatalog.Add(new Amenity(definition.Id, definition.Code, definition.Name, definition.Category, true));
        }

        counts.Add(new("Amenities", existingAmenities.Count, stageCatalog.Count));

        // ---- RoomTypes ------------------------------------------------------------------
        var existingTypes = property is null
            ? []
            : await dbContext.RoomTypes.AsNoTracking().Where(item => item.PropertyId == propertyId).ToListAsync(cancellationToken);
        var typeIds = new Dictionary<string, Guid>();
        var typeEntities = new Dictionary<string, RoomType>();
        var newTypes = 0;
        foreach (var definition in RiversideDemoCatalog.RoomTypes)
        {
            var existing = existingTypes.SingleOrDefault(item => item.Code == definition.Code);
            if (existing is not null)
            {
                typeIds[definition.Code] = existing.Id;
                typeEntities[definition.Code] = existing;
                if (!existing.IsActive)
                {
                    warnings.Add($"room type {definition.Code} is inactive; left as it is.");
                }

                continue;
            }

            if (existingTypes.Any(item => item.Slug == definition.Slug))
            {
                conflicts.Add($"slug '{definition.Slug}' is already used by another room type of this property.");
            }

            if (await dbContext.RoomTypes.AnyAsync(item => item.Id == definition.Id, cancellationToken))
            {
                conflicts.Add($"room type id for {definition.Code} is already used by another row.");
            }

            var created = new RoomType(
                definition.Id, propertyId, definition.Code, definition.Name, definition.Slug, definition.Description,
                definition.BaseOccupancy, definition.MaxOccupancy, true, now);
            typeIds[definition.Code] = created.Id;
            typeEntities[definition.Code] = created;
            stageCatalog.Add(created);
            newTypes++;
        }

        counts.Add(new("RoomTypes", RiversideDemoCatalog.RoomTypes.Count - newTypes, newTypes));

        // ---- Rate plan ------------------------------------------------------------------
        var ratePlan = property is null
            ? null
            : await dbContext.RatePlans.AsNoTracking().SingleOrDefaultAsync(
                item => item.PropertyId == propertyId && item.Code == RiversideDemoCatalog.RatePlanCode, cancellationToken);
        var ratePlanId = ratePlan?.Id ?? RiversideDemoCatalog.RatePlanId;
        if (ratePlan is null)
        {
            if (await dbContext.RatePlans.AnyAsync(item => item.Id == ratePlanId, cancellationToken))
            {
                conflicts.Add("the demo rate plan id is already used by another rate plan.");
            }

            stageCatalog.Add(new RatePlan(
                ratePlanId, propertyId, RiversideDemoCatalog.RatePlanCode, "Giá tiêu chuẩn (demo)", null,
                RiversideDemoCatalog.CurrencyCode, true, now));
        }
        else
        {
            if (ratePlan.CurrencyCode != RiversideDemoCatalog.CurrencyCode)
            {
                conflicts.Add($"rate plan {RiversideDemoCatalog.RatePlanCode} is priced in {ratePlan.CurrencyCode}, not {RiversideDemoCatalog.CurrencyCode}.");
            }

            if (!ratePlan.IsActive)
            {
                warnings.Add($"rate plan {RiversideDemoCatalog.RatePlanCode} is inactive; left as it is.");
            }
        }

        counts.Add(new("RatePlans", ratePlan is null ? 0 : 1, ratePlan is null ? 1 : 0));

        // ---- Physical rooms -------------------------------------------------------------
        var existingRooms = property is null
            ? []
            : await dbContext.PhysicalRooms.AsNoTracking().Where(item => item.PropertyId == propertyId).ToListAsync(cancellationToken);
        var stageRooms = new List<object>();
        var roomsExisting = 0;
        for (var typeIndex = 0; typeIndex < RiversideDemoCatalog.RoomTypes.Count; typeIndex++)
        {
            var definition = RiversideDemoCatalog.RoomTypes[typeIndex];
            for (var ordinal = 1; ordinal <= definition.Rooms; ordinal++)
            {
                var number = $"{definition.RoomNumberPrefix}-{ordinal:00}";
                var existing = existingRooms.SingleOrDefault(item => item.RoomNumber == number);
                if (existing is not null)
                {
                    roomsExisting++;
                    if (existing.RoomTypeId != typeIds[definition.Code])
                    {
                        conflicts.Add($"room {number} belongs to another room type, not {definition.Code}.");
                    }
                    else if (existing.OperationalStatus != OperationalStatus.Active)
                    {
                        warnings.Add($"room {number} is {existing.OperationalStatus}; not reactivated.");
                    }

                    continue;
                }

                var roomId = Guid.Parse($"a4000000-0000-0000-{typeIndex + 1:0000}-{ordinal:000000000000}");
                if (await dbContext.PhysicalRooms.AnyAsync(item => item.Id == roomId, cancellationToken))
                {
                    conflicts.Add($"room id for {number} is already used by another room.");
                }

                stageRooms.Add(new PhysicalRoom(
                    roomId, propertyId, typeEntities[definition.Code], number, RiversideDemoCatalog.PlaceholderFloor,
                    OperationalStatus.Active, now));
            }
        }

        counts.Add(new("PhysicalRooms", roomsExisting, stageRooms.Count));

        // ---- Daily rates (the window; missing nights only) -----------------------------
        var existingRates = property is null || ratePlan is null
            ? new HashSet<(Guid, DateOnly)>()
            : (await dbContext.DailyRoomRates.AsNoTracking()
                .Where(item => item.PropertyId == propertyId && item.RatePlanId == ratePlanId &&
                               item.StayDate >= options.From && item.StayDate < options.ToExclusive)
                .Select(item => new { item.RoomTypeId, item.StayDate })
                .ToListAsync(cancellationToken)).Select(item => (item.RoomTypeId, item.StayDate)).ToHashSet();
        var stageRates = new List<object>();
        var ratesExisting = 0;
        foreach (var definition in RiversideDemoCatalog.RoomTypes)
        {
            for (var offset = 0; offset < options.Days; offset++)
            {
                var night = options.From.AddDays(offset);
                if (existingRates.Contains((typeIds[definition.Code], night)))
                {
                    ratesExisting++;
                    continue;
                }

                stageRates.Add(new DailyRoomRate(Guid.NewGuid(), propertyId, typeIds[definition.Code], ratePlanId, night, definition.NightlyRate, now));
            }
        }

        counts.Add(new("DailyRoomRates (window)", ratesExisting, stageRates.Count));

        // ---- Media and links -----------------------------------------------------------
        var urls = RiversideDemoCatalog.Media.Select(item => options.MediaOrigin + RiversideDemoCatalog.MediaPathPrefix + item.FileName).ToArray();
        var existingMedia = (await dbContext.Media.AsNoTracking().Where(item => urls.Contains(item.Url)).ToListAsync(cancellationToken))
            .GroupBy(item => item.Url).ToDictionary(group => group.Key, group => group.OrderBy(item => item.CreatedAt).First());
        var existingPropertyLinks = property is null
            ? []
            : await dbContext.PropertyMedia.AsNoTracking().Where(item => item.PropertyId == propertyId).ToListAsync(cancellationToken);
        var typeIdList = typeIds.Values.ToArray();
        var existingTypeLinks = existingTypes.Count == 0
            ? []
            : await dbContext.RoomTypeMedia.AsNoTracking().Where(item => typeIdList.Contains(item.RoomTypeId)).ToListAsync(cancellationToken);

        var stageMedia = new List<object>();
        var stageLinks = new List<object>();
        var mediaIds = new Dictionary<string, Guid>();
        var coverTaken = new HashSet<string>();
        // What each link will hold after this run's inserts, so a migration can be judged against it.
        var stagedLinkValues = new Dictionary<(Guid OwnerId, Guid MediaId), (int SortOrder, bool IsCover)>();
        for (var index = 0; index < RiversideDemoCatalog.Media.Count; index++)
        {
            var definition = RiversideDemoCatalog.Media[index];
            var url = urls[index];
            Guid mediaId;
            if (existingMedia.TryGetValue(url, out var media))
            {
                mediaId = media.Id;
            }
            else
            {
                if (await dbContext.Media.AnyAsync(item => item.Id == definition.Id, cancellationToken))
                {
                    conflicts.Add($"media id for {definition.FileName} is already used by another media row.");
                }

                mediaId = definition.Id;
                stageMedia.Add(new Media(mediaId, url, definition.AltText, MediaType.Image, now));
            }

            mediaIds[definition.FileName] = mediaId;
            var isProperty = definition.OwnerType == RiversideMediaOwner.Property;
            var ownerKey = isProperty ? "property" : definition.OwnerCode;
            var ownerId = isProperty ? propertyId : typeIds[definition.OwnerCode];
            var linked = isProperty
                ? existingPropertyLinks.Any(link => link.MediaId == mediaId)
                : existingTypeLinks.Any(link => link.RoomTypeId == ownerId && link.MediaId == mediaId);
            if (linked)
            {
                continue;
            }

            var ownerHasCover = coverTaken.Contains(ownerKey) || (isProperty
                ? existingPropertyLinks.Any(link => link.IsCover)
                : existingTypeLinks.Any(link => link.RoomTypeId == ownerId && link.IsCover));
            var asCover = definition.IsCover && !ownerHasCover;
            // A cover that an earlier seed's cover is being replaced by is linked as a regular image first and
            // promoted by its link migration (see RiversideDemoCatalog.LinkMigrations): that is not a warning.
            var promotedByMigration = RiversideDemoCatalog.LinkMigrations.Any(
                migration => migration.FileName == definition.FileName && migration.ToIsCover);
            if (definition.IsCover && !asCover && !promotedByMigration)
            {
                warnings.Add($"{ownerKey} already has a cover image; {definition.FileName} was linked as a regular image.");
            }

            if (asCover)
            {
                coverTaken.Add(ownerKey);
            }

            stagedLinkValues[(ownerId, mediaId)] = (definition.SortOrder, asCover);
            stageLinks.Add(isProperty
                ? new PropertyMedia(propertyId, mediaId, definition.SortOrder, asCover)
                : new RoomTypeMedia(ownerId, mediaId, definition.SortOrder, asCover));
        }

        // ---- Link migrations: judged now (dry-run shows them), written only on apply ---------------
        var pendingMigrations = new List<(RiversideLinkMigration Migration, Guid RoomTypeId, Guid MediaId)>();
        var migrationsApplied = 0;
        foreach (var migration in RiversideDemoCatalog.LinkMigrations)
        {
            if (!typeIds.TryGetValue(migration.RoomTypeCode, out var migrationTypeId) ||
                !mediaIds.TryGetValue(migration.FileName, out var migrationMediaId))
            {
                continue; // the room type or picture does not exist yet; nothing to migrate
            }

            var existingLink = existingTypeLinks.FirstOrDefault(
                link => link.RoomTypeId == migrationTypeId && link.MediaId == migrationMediaId);
            (int SortOrder, bool IsCover)? current = existingLink is not null
                ? (existingLink.SortOrder, existingLink.IsCover)
                : stagedLinkValues.TryGetValue((migrationTypeId, migrationMediaId), out var staged) ? staged : null;
            if (current is null)
            {
                continue;
            }

            if (current == (migration.ToSortOrder, migration.ToIsCover))
            {
                migrationsApplied++;
            }
            else if (current == (migration.FromSortOrder, migration.FromIsCover))
            {
                // A picture may become the cover only if no other picture keeps the cover after this run's own
                // demotions; a cover the operator chose is never taken away from them.
                var operatorCover = migration.ToIsCover && existingTypeLinks.Any(link =>
                    link.RoomTypeId == migrationTypeId && link.MediaId != migrationMediaId && link.IsCover &&
                    !RiversideDemoCatalog.LinkMigrations.Any(other =>
                        other.FromIsCover && !other.ToIsCover && other.RoomTypeCode == migration.RoomTypeCode &&
                        mediaIds.TryGetValue(other.FileName, out var demotedId) && demotedId == link.MediaId));
                if (operatorCover)
                {
                    warnings.Add(
                        $"{migration.RoomTypeCode} has a cover image the Seed did not set; {migration.FileName} was not made the cover.");
                }
                else
                {
                    pendingMigrations.Add((migration, migrationTypeId, migrationMediaId));
                }
            }
            else
            {
                warnings.Add(
                    $"{migration.FileName} of {migration.RoomTypeCode} was edited by an operator (order {current.Value.SortOrder}, cover {current.Value.IsCover}); its order/cover change was left alone.");
            }
        }

        counts.Add(new("Link order/cover migrations", migrationsApplied, pendingMigrations.Count));

        var existingAmenityLinks = 0;
        foreach (var definition in RiversideDemoCatalog.PropertyAmenities)
        {
            var amenityId = amenityIds[definition.Code];
            if (property is null || !await dbContext.PropertyAmenities.AnyAsync(
                    link => link.PropertyId == propertyId && link.AmenityId == amenityId, cancellationToken))
            {
                stageLinks.Add(new PropertyAmenity(propertyId, amenityId));
            }
            else
            {
                existingAmenityLinks++;
            }
        }

        counts.Add(new("Media", existingMedia.Count, stageMedia.Count));
        counts.Add(new("Property/RoomType/Amenity links",
            existingPropertyLinks.Count + existingTypeLinks.Count + existingAmenityLinks, stageLinks.Count));

        var plan = new RiversideSeedPlan(
            options.From, options.ToExclusive, options.MediaOrigin, property is not null,
            counts, warnings, conflicts, Applied: false);
        if (!apply || plan.HasConflicts)
        {
            return plan; // dry-run, or a conflict: nothing was written; the transaction (if any) rolls back
        }

        // ---- Apply: staged saves so dependencies exist first, then verify, then commit ----
        foreach (var stage in new[] { stageProperty, stageCatalog, stageMedia, stageRooms, stageRates, stageLinks })
        {
            if (stage.Count == 0)
            {
                continue;
            }

            dbContext.AddRange(stage);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        // Guarded, per-link updates: each matches the exact old values or changes nothing, demotions first.
        foreach (var (migration, roomTypeId, mediaId) in pendingMigrations.OrderByDescending(item => item.Migration.FromIsCover))
        {
            var changed = await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "RoomTypeMedia" SET "SortOrder" = {migration.ToSortOrder}, "IsCover" = {migration.ToIsCover}
                WHERE "RoomTypeId" = {roomTypeId} AND "MediaId" = {mediaId}
                  AND "SortOrder" = {migration.FromSortOrder} AND "IsCover" = {migration.FromIsCover}
                """,
                cancellationToken);
            if (changed != 1)
            {
                throw new InvalidOperationException(
                    $"link migration for {migration.FileName} of {migration.RoomTypeCode} matched {changed} rows; nothing was committed.");
            }
        }

        await VerifyAsync(propertyId, options, cancellationToken);
        await transaction!.CommitAsync(cancellationToken);
        dbContext.ChangeTracker.Clear();
        return plan with { Applied = true };
    }

    /// <summary>The state the seed promises, read back inside the transaction; a miss rolls everything back.</summary>
    private async Task VerifyAsync(Guid propertyId, RiversideSeedOptions options, CancellationToken cancellationToken)
    {
        foreach (var definition in RiversideDemoCatalog.RoomTypes)
        {
            var type = await dbContext.RoomTypes.AsNoTracking()
                .SingleAsync(item => item.PropertyId == propertyId && item.Code == definition.Code, cancellationToken);
            var numbers = Enumerable.Range(1, definition.Rooms).Select(ordinal => $"{definition.RoomNumberPrefix}-{ordinal:00}").ToArray();
            var rooms = await dbContext.PhysicalRooms.AsNoTracking()
                .CountAsync(item => item.PropertyId == propertyId && item.RoomTypeId == type.Id && numbers.Contains(item.RoomNumber), cancellationToken);
            var nights = await dbContext.DailyRoomRates.AsNoTracking().CountAsync(
                item => item.PropertyId == propertyId && item.RoomTypeId == type.Id &&
                        item.StayDate >= options.From && item.StayDate < options.ToExclusive, cancellationToken);
            var covers = await dbContext.RoomTypeMedia.AsNoTracking().CountAsync(
                item => item.RoomTypeId == type.Id && item.IsCover, cancellationToken);
            if (covers > 1)
            {
                throw new InvalidOperationException($"verification failed for {definition.Code}: {covers} cover images.");
            }

            if (rooms != definition.Rooms || nights < options.Days)
            {
                throw new InvalidOperationException(
                    $"verification failed for {definition.Code}: {rooms}/{definition.Rooms} rooms, {nights}/{options.Days} nights.");
            }
        }
    }
}
