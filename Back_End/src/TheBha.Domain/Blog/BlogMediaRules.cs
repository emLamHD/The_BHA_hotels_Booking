namespace TheBha.Domain.Blog;

/// <summary>BHA-BLOG-001-CP02: the limits of the picture library. The 10 MB / 40 megapixel / 8000 px bounds of one picture stay <c>HeroLimits</c> (shared with CP01).</summary>
public static class BlogMediaLimits
{
    public const int DisplayName = 150;
    public const int FileName = 255;
    public const int Description = 300;
    public const int Credit = 200;
    public const int SourceUrl = 500;
    public const int Licence = 300;
    public const int ClientRef = 64;

    /// <summary>A batch is at most this many pictures and this many bytes in all; a request beyond either is refused before any picture is processed.</summary>
    public const int MaxBatchFiles = 10;

    public const long MaxBatchBytes = 50L * 1024 * 1024;

    /// <summary>Pictures decoded at the same time in this process. A decode holds width × height × 4 bytes (≤ 160 MB at 40 MP), so the worst case is this many times that.</summary>
    public const int MaxConcurrentDecodes = 2;

    public const int DefaultPageSize = 24;
    public const int MaxUsageRows = 100;

    /// <summary>The first generation of the pipeline: original kept private, three presets, WebP plus a JPEG/PNG fallback. A picture uploaded before CP02 is generation 0 (no variants).</summary>
    public const int CurrentGeneration = 1;
}

/// <summary>A published size: the longest edge it may have is <see cref="MaxWidth"/> wide (never upscaled; a smaller picture keeps its own width).</summary>
public sealed record BlogMediaPreset(string Name, int MaxWidth);

public static class BlogMediaPresets
{
    public static readonly IReadOnlyList<BlogMediaPreset> All = [new("thumb", 320), new("card", 640), new("article", 1280)];

    public const string Article = "article";

    public static bool IsKnown(string? name) => All.Any(preset => preset.Name == name);
}

/// <summary>The formats a variant may be stored in. AVIF is deliberately absent: the bundled encoder cannot write it (see the design document).</summary>
public static class BlogMediaFormats
{
    public const string Webp = "webp";
    public const string Jpeg = "jpg";
    public const string Png = "png";

    public static bool IsKnown(string? format) => format is Webp or Jpeg or Png;

    public static string ContentType(string format) => format switch
    {
        Webp => "image/webp",
        Jpeg => "image/jpeg",
        _ => "image/png"
    };

    /// <summary>The format every browser reads: what a picture without WebP support, and the legacy address, are given.</summary>
    public static bool IsFallback(string format) => format is Jpeg or Png;
}

public static class BlogMediaRules
{
    public static BlogProblem? CheckMetadata(string displayName, string description, string credit, string sourceUrl, string licence, double focalX, double focalY)
    {
        if (BlogText.Check(displayName, BlogMediaLimits.DisplayName, "displayName", required: true) is { } name)
        {
            return name;
        }

        if (BlogText.Check(description, BlogMediaLimits.Description, "description") is { } text)
        {
            return text;
        }

        if (BlogText.Check(credit, BlogMediaLimits.Credit, "credit") is { } by)
        {
            return by;
        }

        if (BlogText.Check(licence, BlogMediaLimits.Licence, "licence") is { } rights)
        {
            return rights;
        }

        if (sourceUrl.Length > 0 && (sourceUrl.Length > BlogMediaLimits.SourceUrl || !sourceUrl.StartsWith("https://", StringComparison.Ordinal) || !BlogLink.IsSafe(sourceUrl)))
        {
            return new BlogProblem(BlogErrorCodes.Validation, "sourceUrl", $"The source is an https address of at most {BlogMediaLimits.SourceUrl} characters.");
        }

        return IsFocal(focalX) && IsFocal(focalY)
            ? null
            : new BlogProblem(BlogErrorCodes.Validation, "focalX", "The focal point is a position from 0 (left / top) to 1 (right / bottom) of the picture.");
    }

    /// <summary>A position across the picture: 0 = left or top edge, 1 = right or bottom edge. The client sends it as is; the server stores it rounded to four decimals.</summary>
    public static bool IsFocal(double value) => double.IsFinite(value) && value is >= 0 and <= 1;

    public static double RoundFocal(double value) => Math.Round(value, 4, MidpointRounding.AwayFromZero);
}
