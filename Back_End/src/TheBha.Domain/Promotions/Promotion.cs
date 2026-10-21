using TheBha.Domain.Common;

namespace TheBha.Domain.Promotions;

/// <summary>
/// One entity for both jobs of a booking promotion: the automatic pricing rule the backend applies and the marketing content
/// (title, summary, details, cover, homepage placement) the website shows. <see cref="Status"/> is the pricing switch;
/// <see cref="ShowOnHomepage"/> only places the card, and never changes a price. The dates are the Property's local dates.
/// </summary>
public sealed class Promotion
{
    private Promotion()
    {
    }

    public Promotion(
        Guid id,
        Guid propertyId,
        PromotionDetails details,
        Guid actorStaffId,
        Guid createOperationId,
        string createFingerprint,
        DateTimeOffset nowUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        CreatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        CreateOperationId = DomainGuard.RequiredId(createOperationId, nameof(createOperationId));
        CreateFingerprint = DomainGuard.Required(createFingerprint, nameof(createFingerprint), 64);
        Status = PromotionStatus.Draft;
        Version = 1;
        CreatedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
        Apply(details);
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public string Slug { get; private set; } = string.Empty;
    public PromotionStatus Status { get; private set; }
    public PromotionDiscountKind Kind { get; private set; }
    public decimal Value { get; private set; }
    public string? CurrencyCode { get; private set; }
    public bool AllRoomTypes { get; private set; }
    public DateOnly? BookingFrom { get; private set; }
    public DateOnly? BookingTo { get; private set; }
    public DateOnly? StayFrom { get; private set; }
    public DateOnly? StayTo { get; private set; }
    public int MinNights { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string Summary { get; private set; } = string.Empty;
    public string[] BodyParagraphs { get; private set; } = [];
    public Guid? CoverMediaId { get; private set; }
    public string? CoverAltText { get; private set; }
    public bool ShowOnHomepage { get; private set; }
    public int SortOrder { get; private set; }
    public DateOnly? DisplayFrom { get; private set; }
    public DateOnly? DisplayTo { get; private set; }

    /// <summary>Optimistic concurrency token: every edit and every status change advances it.</summary>
    public int Version { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid CreatedByStaffId { get; private set; }
    public Guid UpdatedByStaffId { get; private set; }
    public Guid CreateOperationId { get; private set; }
    public string CreateFingerprint { get; private set; } = string.Empty;
    public List<PromotionRoomType> RoomTypes { get; private set; } = [];

    public PromotionDetails ToDetails() => new(
        Slug, Title, Summary, BodyParagraphs, CoverMediaId, CoverAltText, Kind, Value, CurrencyCode, AllRoomTypes,
        RoomTypes.Select(x => x.RoomTypeId).OrderBy(x => x).ToList(), BookingFrom, BookingTo, StayFrom, StayTo, MinNights,
        ShowOnHomepage, SortOrder, DisplayFrom, DisplayTo);

    public void Edit(PromotionDetails details, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        Apply(details);
        Touch(actorStaffId, nowUtc);
    }

    /// <summary>Draft → Active, Active ⇄ Disabled. A promotion never goes back to Draft; it is never deleted.</summary>
    public void SetStatus(PromotionStatus status, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        var allowed = (Status, status) switch
        {
            (PromotionStatus.Draft, PromotionStatus.Active) => true,
            (PromotionStatus.Active, PromotionStatus.Disabled) => true,
            (PromotionStatus.Disabled, PromotionStatus.Active) => true,
            _ => false
        };
        if (!allowed)
        {
            throw new DomainException($"A {Status} promotion cannot become {status}.");
        }

        Status = status;
        Touch(actorStaffId, nowUtc);
    }

    private void Touch(Guid actorStaffId, DateTimeOffset nowUtc)
    {
        UpdatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        UpdatedAtUtc = nowUtc;
        Version++;
    }

    private void Apply(PromotionDetails d)
    {
        if (PromotionRules.Validate(d) is { } error)
        {
            throw new DomainException($"{error.Field}: {error.Message}");
        }

        Slug = d.Slug;
        Title = d.Title.Trim();
        Summary = d.Summary.Trim();
        BodyParagraphs = d.BodyParagraphs.Select(x => x.Trim()).ToArray();
        CoverMediaId = d.CoverMediaId;
        CoverAltText = d.CoverMediaId is null ? null : d.CoverAltText!.Trim();
        Kind = d.Kind;
        Value = d.Value;
        CurrencyCode = d.CurrencyCode;
        AllRoomTypes = d.AllRoomTypes;
        BookingFrom = d.BookingFrom;
        BookingTo = d.BookingTo;
        StayFrom = d.StayFrom;
        StayTo = d.StayTo;
        MinNights = d.MinNights;
        ShowOnHomepage = d.ShowOnHomepage;
        SortOrder = d.SortOrder;
        DisplayFrom = d.DisplayFrom;
        DisplayTo = d.DisplayTo;

        var wanted = d.AllRoomTypes ? [] : d.RoomTypeIds.ToHashSet();
        RoomTypes.RemoveAll(x => !wanted.Contains(x.RoomTypeId));
        foreach (var roomTypeId in wanted.Where(id => RoomTypes.All(x => x.RoomTypeId != id)))
        {
            RoomTypes.Add(new PromotionRoomType(Id, PropertyId, roomTypeId));
        }
    }
}

public sealed class PromotionRoomType
{
    private PromotionRoomType()
    {
    }

    public PromotionRoomType(Guid promotionId, Guid propertyId, Guid roomTypeId)
    {
        PromotionId = promotionId;
        PropertyId = propertyId;
        RoomTypeId = roomTypeId;
    }

    public Guid PromotionId { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid RoomTypeId { get; private set; }
}

/// <summary>A cover picture, owned by a Property so a Manager only reaches their own. A new file always has a new id (immutable URL).</summary>
public sealed class PromotionMedia
{
    private PromotionMedia()
    {
    }

    public PromotionMedia(Guid id, Guid propertyId, string storageKey, string contentType, long byteSize, int width, int height, DateTimeOffset createdAtUtc, Guid createdByStaffId)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        StorageKey = DomainGuard.Required(storageKey, nameof(storageKey), 100);
        ContentType = DomainGuard.Required(contentType, nameof(contentType), 40);
        ByteSize = byteSize > 0 ? byteSize : throw new DomainException("byteSize is out of range.");
        Width = width > 0 ? width : throw new DomainException("width is out of range.");
        Height = height > 0 ? height : throw new DomainException("height is out of range.");
        CreatedAtUtc = createdAtUtc;
        CreatedByStaffId = DomainGuard.RequiredId(createdByStaffId, nameof(createdByStaffId));
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public string StorageKey { get; private set; } = string.Empty;
    public string ContentType { get; private set; } = string.Empty;
    public long ByteSize { get; private set; }
    public int Width { get; private set; }
    public int Height { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public Guid CreatedByStaffId { get; private set; }
}

/// <summary>Append-only record of an Admin write, in the same transaction as the write.</summary>
public sealed class PromotionAudit
{
    private PromotionAudit()
    {
    }

    public PromotionAudit(Guid promotionId, Guid propertyId, Guid actorStaffId, DateTimeOffset atUtc, string action, string? before, string? after)
    {
        Id = Guid.NewGuid();
        PromotionId = promotionId;
        PropertyId = propertyId;
        ActorStaffId = actorStaffId;
        AtUtc = atUtc;
        Action = DomainGuard.Required(action, nameof(action), 50);
        Before = before;
        After = after;
    }

    public Guid Id { get; private set; }
    public Guid PromotionId { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid ActorStaffId { get; private set; }
    public DateTimeOffset AtUtc { get; private set; }
    public string Action { get; private set; } = string.Empty;
    public string? Before { get; private set; }
    public string? After { get; private set; }
}
