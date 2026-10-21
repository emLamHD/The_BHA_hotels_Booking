using TheBha.Domain.Website;

namespace TheBha.Application.Website;

/// <summary>
/// CUST-WEB-HERO-001-CP01: the home page hero slideshow, edited in the Admin and read by the Customer at run time. Application owns
/// what is asked and answered, the rules that need no database (text, slide list, image bytes) and the narrow storage contract;
/// the transaction, the texts and the revision live behind <see cref="IWebsiteHero"/> in Infrastructure, the file system behind
/// <see cref="IHeroMediaStorage"/>.
/// </summary>
public static class HeroErrorCodes
{
    public const string FontInvalid = "hero-font-invalid";
    public const string IntervalInvalid = "hero-interval-invalid";
    public const string SlideCount = "hero-slides-count";
    public const string DuplicateSlide = "hero-duplicate-slide";
    public const string MediaMissing = "hero-media-missing";
    public const string FocalInvalid = "hero-focal-invalid";
    public const string TextInvalid = "hero-text-invalid";
    public const string TextRequired = "hero-text-required";
    public const string UnknownLocale = "hero-unknown-locale";
    public const string ImageEmpty = "hero-image-empty";
    public const string ImageTooLarge = "hero-image-too-large";
    public const string ImageUnsupported = "hero-image-unsupported";
    public const string ImageCorrupt = "hero-image-corrupt";
    public const string ImageDimensions = "hero-image-dimensions";
    public const string StorageNotConfigured = "hero-storage-not-configured";
    public const string UploadUnreadable = "hero-upload-unreadable";
}

public sealed record HeroTextsDto(
    IReadOnlyDictionary<string, string?>? Title,
    IReadOnlyDictionary<string, string?>? Description,
    IReadOnlyDictionary<string, string?>? PrimaryAction,
    IReadOnlyDictionary<string, string?>? SecondaryAction);

/// <summary>One slide as the editor sends it. The order of the list is the order of the slideshow; <c>Alt</c> and <c>Caption</c> map a language code to its text.</summary>
public sealed record HeroSlideInput(
    Guid Id,
    Guid MediaId,
    string? FocalPosition,
    IReadOnlyDictionary<string, string?>? Alt,
    IReadOnlyDictionary<string, string?>? Caption);

/// <summary><c>ExpectedRevision</c> is the revision the editor loaded: the hero's version plus every text row's version.</summary>
public sealed record SaveHeroCommand(
    string ExpectedRevision,
    string? FontKey,
    bool AutoplayEnabled,
    int IntervalSeconds,
    HeroTextsDto? Texts,
    IReadOnlyList<HeroSlideInput> Slides,
    Guid ActorStaffId);

public sealed record HeroSlideDto(
    Guid Id,
    Guid MediaId,
    string FocalPosition,
    IReadOnlyDictionary<string, string?> Alt,
    IReadOnlyDictionary<string, string?> Caption);

/// <summary>A picture the Admin can use: its Staff-only serving path (relative to the API, under <c>/api/admin/v1</c> so a proxied Admin carries it with its session), its size and, for a built-in photograph, the file whose credit the Customer shows.</summary>
public sealed record HeroMediaDto(
    Guid Id,
    string Kind,
    string Url,
    string? SeedFile,
    string ContentType,
    long ByteSize,
    int Width,
    int Height,
    DateTimeOffset CreatedAtUtc);

public sealed record HeroAdminDto(
    string Revision,
    int Version,
    DateTimeOffset UpdatedAtUtc,
    Guid? UpdatedByStaffId,
    IReadOnlyList<MenuLocaleDto> Locales,
    string FontKey,
    bool AutoplayEnabled,
    int IntervalSeconds,
    HeroTextsDto Texts,
    IReadOnlyList<HeroSlideDto> Slides,
    IReadOnlyList<HeroMediaDto> Media);

/// <summary><c>ImageUrl</c> is a path on the API; <c>SeedFile</c> is set for a built-in photograph (the Customer looks its credit up by it) and null for an upload, which never inherits another picture's credit.</summary>
public sealed record PublicHeroSlideDto(Guid Id, string ImageUrl, string? SeedFile, string FocalPosition, string Alt, string Caption);

/// <summary>
/// What a visitor gets: the saved hero only, texts already in <c>Locale</c>. <c>GeneratedAtUtc</c> orders answers so a client keeps
/// the newest it has seen whatever order they arrive in.
/// </summary>
public sealed record PublicHeroDto(
    string Revision,
    string Locale,
    DateTimeOffset GeneratedAtUtc,
    string FontKey,
    bool AutoplayEnabled,
    int IntervalSeconds,
    string Title,
    string Description,
    string PrimaryAction,
    string SecondaryAction,
    IReadOnlyList<PublicHeroSlideDto> Slides);

public sealed record HeroMediaFile(Stream Content, string ContentType, long Length);

public interface IWebsiteHero
{
    Task<HeroAdminDto> GetAdminAsync(CancellationToken cancellationToken);

    /// <summary>Applies slides, order, texts, font and timing in one transaction, or nothing. Stale revision = Conflict.</summary>
    Task<WebsiteMutationResult<HeroAdminDto>> SaveAsync(SaveHeroCommand command, CancellationToken cancellationToken);

    /// <summary>Checks the bytes are a supported picture, writes the file completely, then records it. The picture is not part of the slideshow until a Save names it.</summary>
    Task<WebsiteMutationResult<HeroMediaDto>> UploadAsync(Stream content, Guid actorStaffId, CancellationToken cancellationToken);

    Task<PublicHeroDto> GetPublicAsync(string? locale, CancellationToken cancellationToken);

    /// <summary>The bytes of one recorded picture, or null (unknown id, or its file is not available).</summary>
    Task<HeroMediaFile?> OpenMediaAsync(Guid id, CancellationToken cancellationToken);
}

/// <summary>
/// Where picture files live. A key is relative (<c>hero/&lt;id&gt;.&lt;ext&gt;</c>, <c>seed/&lt;file&gt;</c>); how it maps to a disk is the
/// implementation's, so no path, <c>IFormFile</c> or web type reaches Application. Nothing here removes a picture the slideshow may use.
/// </summary>
public interface IHeroMediaStorage
{
    /// <summary>False when no media root is configured: uploads and uploaded pictures are unavailable, everything else works.</summary>
    bool IsConfigured { get; }

    /// <summary>Writes the whole file under <paramref name="key"/>, visible only once complete. Fails if the key exists.</summary>
    Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken cancellationToken);

    Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken);

    Task<bool> ExistsAsync(string key, CancellationToken cancellationToken);

    /// <summary>Removes a file this request just wrote and no row refers to (the insert after it failed). Never used for a recorded picture.</summary>
    Task DeleteAsync(string key, CancellationToken cancellationToken);

    /// <summary>
    /// BHA-BLOG-001-CP02: the files this storage holds under <paramref name="prefix"/> (<c>blog/</c>), with when each was last written, for the operator command that finds
    /// files no row refers to. Files that are not ours are never listed. A storage that cannot list lists nothing.
    /// </summary>
    IAsyncEnumerable<StoredFile> ListAsync(string prefix, CancellationToken cancellationToken) => NoFiles();

    private static async IAsyncEnumerable<StoredFile> NoFiles()
    {
        await Task.CompletedTask;
        yield break;
    }
}

/// <summary>A file in storage. <c>IsTemporary</c> is a half-written file left by a process that was killed mid-write; it is never a recorded picture.</summary>
public sealed record StoredFile(string Key, DateTimeOffset LastWriteUtc, bool IsTemporary);

public sealed record HeroProblem(string Code, string Field, string Message);

/// <summary>Plain-text rule for the hero's texts: 1 to <c>max</c> characters once trimmed, no markup characters, no control characters.</summary>
public static class HeroText
{
    public static string? Validate(string? text, int max)
    {
        var value = text?.Trim() ?? string.Empty;
        if (value.Length == 0)
        {
            return "Enter a text.";
        }

        if (value.Length > max)
        {
            return $"The text is longer than {max} characters.";
        }

        return value.Any(character => char.IsControl(character) || character is '<' or '>')
            ? "A text is plain text: no < >, no control characters."
            : null;
    }

    /// <summary>"40% 50%": two percentages 0–100.</summary>
    public static bool IsFocal(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > HeroLimits.MaxFocal)
        {
            return false;
        }

        var parts = value.Split(' ');
        return parts.Length == 2 && parts.All(part => part.Length is >= 2 and <= 4 && part[^1] == '%' &&
                                                      int.TryParse(part[..^1], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var percent) &&
                                                      percent is >= 0 and <= 100);
    }
}

/// <summary>The rules for a whole hero Save that need no database. Pure.</summary>
public static class HeroRules
{
    /// <summary>The first problem of <paramref name="command"/>, or null. <paramref name="requiredLocales"/> must have text for every field.</summary>
    public static HeroProblem? Validate(SaveHeroCommand command, IReadOnlySet<string> localeCodes, IReadOnlyList<string> requiredLocales)
    {
        if (!HeroFonts.IsValid(command.FontKey))
        {
            return new HeroProblem(HeroErrorCodes.FontInvalid, "fontKey", "Choose one of the listed fonts.");
        }

        if (command.IntervalSeconds is < HeroLimits.MinIntervalSeconds or > HeroLimits.MaxIntervalSeconds)
        {
            return new HeroProblem(
                HeroErrorCodes.IntervalInvalid, "intervalSeconds",
                $"The time between slides is a whole number of seconds from {HeroLimits.MinIntervalSeconds} to {HeroLimits.MaxIntervalSeconds}.");
        }

        if (command.Slides.Count is < HeroLimits.MinSlides or > HeroLimits.MaxSlides)
        {
            return new HeroProblem(HeroErrorCodes.SlideCount, "slides", $"The slideshow needs {HeroLimits.MinSlides} to {HeroLimits.MaxSlides} slides.");
        }

        var texts = command.Texts ?? new HeroTextsDto(null, null, null, null);
        var shared = new (string Field, IReadOnlyDictionary<string, string?>? Labels, int Max)[]
        {
            ("title", texts.Title, HeroLimits.MaxTitle),
            ("description", texts.Description, HeroLimits.MaxDescription),
            ("primaryAction", texts.PrimaryAction, HeroLimits.MaxAction),
            ("secondaryAction", texts.SecondaryAction, HeroLimits.MaxAction),
        };
        foreach (var (field, labels, max) in shared)
        {
            if (Check($"texts.{field}", labels, max, localeCodes, requiredLocales) is { } problem)
            {
                return problem;
            }
        }

        var seen = new HashSet<Guid>();
        for (var index = 0; index < command.Slides.Count; index++)
        {
            var slide = command.Slides[index];
            var at = $"slides[{index}]";
            if (slide.Id == Guid.Empty || !seen.Add(slide.Id))
            {
                return new HeroProblem(HeroErrorCodes.DuplicateSlide, $"{at}.id", "Each slide must appear once, with its own id.");
            }

            if (slide.MediaId == Guid.Empty)
            {
                return new HeroProblem(HeroErrorCodes.MediaMissing, $"{at}.mediaId", "Choose a picture for this slide.");
            }

            if (!HeroText.IsFocal(slide.FocalPosition))
            {
                return new HeroProblem(HeroErrorCodes.FocalInvalid, $"{at}.focalPosition", "The focal position is two percentages, such as \"50% 50%\".");
            }

            if (Check($"{at}.alt", slide.Alt, HeroLimits.MaxAlt, localeCodes, requiredLocales) is { } alt)
            {
                return alt;
            }

            if (Check($"{at}.caption", slide.Caption, HeroLimits.MaxCaption, localeCodes, requiredLocales) is { } caption)
            {
                return caption;
            }
        }

        return null;
    }

    private static HeroProblem? Check(
        string field, IReadOnlyDictionary<string, string?>? labels, int max, IReadOnlySet<string> localeCodes, IReadOnlyList<string> requiredLocales)
    {
        labels ??= new Dictionary<string, string?>();
        foreach (var (code, text) in labels)
        {
            if (!localeCodes.Contains(code.ToLowerInvariant()))
            {
                return new HeroProblem(HeroErrorCodes.UnknownLocale, $"{field}.{code}", $"The language {code} does not exist.");
            }

            if (!string.IsNullOrWhiteSpace(text) && HeroText.Validate(text, max) is { } problem)
            {
                return new HeroProblem(HeroErrorCodes.TextInvalid, $"{field}.{code}", problem);
            }
        }

        foreach (var code in requiredLocales)
        {
            var present = labels.FirstOrDefault(pair => string.Equals(pair.Key, code, StringComparison.OrdinalIgnoreCase)).Value;
            if (string.IsNullOrWhiteSpace(present))
            {
                return new HeroProblem(HeroErrorCodes.TextRequired, $"{field}.{code}", $"Enter the text in {code}: it is the text the other languages fall back to.");
            }
        }

        return null;
    }
}
