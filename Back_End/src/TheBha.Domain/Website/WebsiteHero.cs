using TheBha.Domain.Common;

namespace TheBha.Domain.Website;

/// <summary>The limits of the home page hero slideshow; the database repeats the ones a row can state alone.</summary>
public static class HeroLimits
{
    public const int MinSlides = 1;
    public const int MaxSlides = 10;
    public const int MinIntervalSeconds = 3;
    public const int MaxIntervalSeconds = 60;
    public const int DefaultIntervalSeconds = 6;
    public const int MaxTitle = 120;
    public const int MaxDescription = 300;
    public const int MaxAction = 40;
    public const int MaxAlt = 200;
    public const int MaxCaption = 120;
    public const int MaxFocal = 16;

    /// <summary>10 MB per file.</summary>
    public const int MaxUploadBytes = 10 * 1024 * 1024;

    public const int MaxSide = 8000;
    public const long MaxPixels = 40_000_000;
    public const int MinWidth = 320;
    public const int MinHeight = 160;
    public const int MaxStorageKey = 80;
}

/// <summary>
/// The font families an Admin can give the hero's title and description. A closed list of tokens (never a CSS value or a URL):
/// the Customer maps each token to a family it already ships (the theme default, Be Vietnam Pro, two system stacks).
/// </summary>
public static class HeroFonts
{
    public const string Default = "default";
    public const string BeVietnamPro = "be-vietnam-pro";
    public const string SystemSans = "system-sans";
    public const string SystemSerif = "system-serif";

    public static readonly IReadOnlyList<string> All = [Default, BeVietnamPro, SystemSans, SystemSerif];

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}

public static class HeroMediaKind
{
    /// <summary>One of the four photographs the site started with (embedded in the API, credited on the Customer's credits page).</summary>
    public const string Seed = "seed";

    /// <summary>A file an Admin uploaded; its bytes are in the configured media root.</summary>
    public const string Upload = "upload";

    public static bool IsValid(string? value) => value is Seed or Upload;
}

/// <summary>
/// CUST-WEB-HERO-001-CP01: one banner picture. The row exists only once its file is completely written (an upload writes the file
/// first), is never edited and never deleted by the application, so a saved slide can always find its picture. The id is
/// server-generated and part of the public URL, so a new file always has a new URL.
/// </summary>
public sealed class WebsiteHeroMedia
{
    private WebsiteHeroMedia()
    {
    }

    public WebsiteHeroMedia(
        Guid id, string kind, string storageKey, string contentType, long byteSize, int width, int height, DateTimeOffset createdAtUtc, Guid? createdByStaffId)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        Kind = HeroMediaKind.IsValid(kind) ? kind : throw new DomainException("kind is not a hero media kind.");
        StorageKey = DomainGuard.Required(storageKey, nameof(storageKey), HeroLimits.MaxStorageKey);
        ContentType = DomainGuard.Required(contentType, nameof(contentType), 40);
        ByteSize = byteSize is > 0 and <= HeroLimits.MaxUploadBytes ? byteSize : throw new DomainException("byteSize is out of range.");
        Width = width is > 0 and <= HeroLimits.MaxSide ? width : throw new DomainException("width is out of range.");
        Height = height is > 0 and <= HeroLimits.MaxSide ? height : throw new DomainException("height is out of range.");
        CreatedAtUtc = createdAtUtc;
        CreatedByStaffId = createdByStaffId;
    }

    public Guid Id { get; private set; }
    public string Kind { get; private set; } = string.Empty;

    /// <summary>Relative to the storage: <c>seed/&lt;file&gt;</c> or <c>hero/&lt;id&gt;.&lt;ext&gt;</c>. Never an absolute path.</summary>
    public string StorageKey { get; private set; } = string.Empty;

    public string ContentType { get; private set; } = string.Empty;
    public long ByteSize { get; private set; }
    public int Width { get; private set; }
    public int Height { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public Guid? CreatedByStaffId { get; private set; }
}

/// <summary>
/// One slide of the slideshow: a picture, its place in the order, and the picture's own description. <see cref="Alt"/> and
/// <see cref="Caption"/> are the content source language's (Vietnamese) text; the other languages' are translation rows keyed by
/// the slide's id, so reordering or replacing the picture never loses them.
/// </summary>
public sealed class WebsiteHeroSlide
{
    private WebsiteHeroSlide()
    {
    }

    public WebsiteHeroSlide(Guid id, Guid mediaId, int sortOrder, string focalPosition, string alt, string caption)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        MediaId = DomainGuard.RequiredId(mediaId, nameof(mediaId));
        SortOrder = sortOrder is >= 0 and < HeroLimits.MaxSlides ? sortOrder : throw new DomainException("sortOrder is out of range.");
        FocalPosition = DomainGuard.Required(focalPosition, nameof(focalPosition), HeroLimits.MaxFocal);
        Alt = DomainGuard.Required(alt, nameof(alt), HeroLimits.MaxAlt);
        Caption = DomainGuard.Required(caption, nameof(caption), HeroLimits.MaxCaption);
    }

    public Guid Id { get; private set; }
    public Guid MediaId { get; private set; }
    public int SortOrder { get; private set; }

    /// <summary>CSS <c>object-position</c> on narrow screens, <c>"40% 50%"</c>; the editor keeps it, a new picture is centred.</summary>
    public string FocalPosition { get; private set; } = "50% 50%";

    public string Alt { get; private set; } = string.Empty;
    public string Caption { get; private set; } = string.Empty;
}

/// <summary>
/// The one row that versions the whole hero (slides, order, texts, font, timing) and holds the settings shared by every slide.
/// Every Save bumps <see cref="Version"/>, and an editor's expected revision includes it, so two editors cannot overwrite
/// each other silently. The four texts are the content source language's; other languages' are translation rows.
/// </summary>
public sealed class WebsiteHeroSettings
{
    private WebsiteHeroSettings()
    {
    }

    public WebsiteHeroSettings(
        DateTimeOffset nowUtc, Guid? actorStaffId, string fontKey, bool autoplayEnabled, int intervalSeconds,
        string title, string description, string primaryActionLabel, string secondaryActionLabel)
    {
        Id = 1;
        Version = 1;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
        Set(fontKey, autoplayEnabled, intervalSeconds, title, description, primaryActionLabel, secondaryActionLabel);
    }

    public int Id { get; private set; }
    public int Version { get; private set; }
    public string FontKey { get; private set; } = HeroFonts.Default;
    public bool AutoplayEnabled { get; private set; } = true;
    public int IntervalSeconds { get; private set; } = HeroLimits.DefaultIntervalSeconds;
    public string Title { get; private set; } = string.Empty;
    public string Description { get; private set; } = string.Empty;
    public string PrimaryActionLabel { get; private set; } = string.Empty;
    public string SecondaryActionLabel { get; private set; } = string.Empty;
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }

    public bool Differs(string fontKey, bool autoplayEnabled, int intervalSeconds, string title, string description, string primary, string secondary) =>
        FontKey != fontKey || AutoplayEnabled != autoplayEnabled || IntervalSeconds != intervalSeconds ||
        Title != title || Description != description || PrimaryActionLabel != primary || SecondaryActionLabel != secondary;

    public void Saved(
        DateTimeOffset nowUtc, Guid? actorStaffId, string fontKey, bool autoplayEnabled, int intervalSeconds,
        string title, string description, string primaryActionLabel, string secondaryActionLabel)
    {
        Set(fontKey, autoplayEnabled, intervalSeconds, title, description, primaryActionLabel, secondaryActionLabel);
        Version++;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }

    private void Set(string fontKey, bool autoplayEnabled, int intervalSeconds, string title, string description, string primary, string secondary)
    {
        FontKey = HeroFonts.IsValid(fontKey) ? fontKey : throw new DomainException("fontKey is not an allowed font.");
        AutoplayEnabled = autoplayEnabled;
        IntervalSeconds = intervalSeconds is >= HeroLimits.MinIntervalSeconds and <= HeroLimits.MaxIntervalSeconds
            ? intervalSeconds
            : throw new DomainException("intervalSeconds is out of range.");
        Title = DomainGuard.Required(title, nameof(title), HeroLimits.MaxTitle);
        Description = DomainGuard.Required(description, nameof(description), HeroLimits.MaxDescription);
        PrimaryActionLabel = DomainGuard.Required(primary, nameof(primary), HeroLimits.MaxAction);
        SecondaryActionLabel = DomainGuard.Required(secondary, nameof(secondary), HeroLimits.MaxAction);
    }
}
