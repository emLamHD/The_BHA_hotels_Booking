using System.Text.RegularExpressions;

namespace TheBha.Domain.Blog;

/// <summary>BHA-BLOG-001: the machine-readable codes of a Blog refusal (the <c>code</c> of the problem the API returns).</summary>
public static class BlogErrorCodes
{
    public const string Validation = "blog.validation";
    public const string StaleVersion = "blog.stale-version";
    public const string NotFound = "blog.not-found";
    public const string DuplicateId = "blog.duplicate-id";
    public const string LocaleUnsupported = "blog.locale-unsupported";
    public const string SlugRequired = "blog.slug-required";
    public const string SlugInvalid = "blog.slug-invalid";
    public const string SlugTaken = "blog.slug-taken";
    public const string CategoryMissing = "blog.category-missing";
    public const string CategoryInUse = "blog.category-in-use";
    public const string CategoryLocaleMissing = "blog.category-locale-missing";
    public const string CategoryPrimaryRequired = "blog.category-primary-required";
    public const string PinNotPublished = "blog.pin-not-published";
    public const string MediaMissing = "blog.media-missing";
    public const string PropertyMissing = "blog.property-missing";
    public const string BodyInvalid = "blog.body-invalid";
    public const string BodyEmpty = "blog.body-empty";
    public const string TitleRequired = "blog.title-required";
    public const string SummaryRequired = "blog.summary-required";
    public const string CoverRequired = "blog.cover-required";
    public const string CoverAltRequired = "blog.cover-alt-required";
    public const string ImageAltRequired = "blog.image-alt-required";
    public const string CategoryRequired = "blog.category-required";
    public const string Archived = "blog.archived";
    public const string InvalidState = "blog.invalid-state";
    public const string NothingToPublish = "blog.nothing-to-publish";
    public const string StorageNotConfigured = "blog.storage-not-configured";
    public const string MediaInUse = "blog.media-in-use";
    public const string MediaBatchInvalid = "blog.media-batch-invalid";
    public const string MediaProcessingFailed = "blog.media-processing-failed";
}

/// <summary>A refusal: the code, the offending field and a sentence for the editor. Never thrown, always returned.</summary>
public sealed record BlogProblem(string Code, string Field, string Message);

public static class BlogLimits
{
    public const int Title = 150;
    public const int Slug = 120;
    public const int MinSlug = 2;
    public const int Summary = 300;
    public const int AltText = 200;
    public const int Caption = 300;
    public const int Author = 120;
    public const int MetaTitle = 70;
    public const int MetaDescription = 170;
    public const int CategoryName = 80;
    public const int CategoryDescription = 300;
    public const int MaxCategoriesPerRevision = 10;
    public const int MaxPinsPerCategory = 50;
    public const int HomeSectionDefault = 6;
    public const int HomeSectionMax = 12;
    public const int MaxPageSize = 50;
    public const int DefaultPageSize = 12;
    public const int MinCoverWidth = 600;
    public const int MinCoverHeight = 400;
}

public enum BlogTranslationStatus
{
    /// <summary>Never published.</summary>
    Draft,

    Published,

    /// <summary>Was published, now hidden; the published revision and its slug are kept.</summary>
    Unpublished,

    Archived
}

public enum BlogRevisionState
{
    /// <summary>The one editable working copy of a translation.</summary>
    Draft,

    /// <summary>Immutable: published once, or a draft superseded by a restore.</summary>
    Frozen
}

public enum BlogRevisionOrigin
{
    Edit,
    Restore
}

public enum BlogSlugState
{
    /// <summary>Reserved by a draft that has never been the live slug.</summary>
    Draft,

    /// <summary>The slug of the published revision.</summary>
    Current,

    /// <summary>A former live slug; the public answers 301 to the current one.</summary>
    Redirect
}

/// <summary>The rules for a URL slug: ASCII, lowercase, hyphen separated, and never a word the Customer routes use.</summary>
public static partial class BlogSlug
{
    private static readonly HashSet<string> Reserved = new(StringComparer.Ordinal)
    {
        "category", "categories", "page", "tag", "tags", "feed", "rss", "search", "preview", "sitemap", "new"
    };

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    private static partial Regex Shape();

    /// <summary><c>null</c> when <paramref name="slug"/> is usable; otherwise why not.</summary>
    public static BlogProblem? Check(string? slug, string field)
    {
        if (string.IsNullOrEmpty(slug))
        {
            return new BlogProblem(BlogErrorCodes.SlugRequired, field, "Enter a slug.");
        }

        if (slug.Length is < BlogLimits.MinSlug or > BlogLimits.Slug || !Shape().IsMatch(slug))
        {
            return new BlogProblem(
                BlogErrorCodes.SlugInvalid, field,
                $"A slug is {BlogLimits.MinSlug} to {BlogLimits.Slug} lowercase letters, digits and single hyphens, without accents.");
        }

        return Reserved.Contains(slug)
            ? new BlogProblem(BlogErrorCodes.SlugInvalid, field, "This word is used by the website's own addresses; choose another slug.")
            : null;
    }
}

/// <summary>Plain text: no control characters and no angle brackets, so no text can ever be read as markup.</summary>
public static class BlogText
{
    public static bool IsPlain(string value) => !value.Any(character => char.IsControl(character) || character is '<' or '>');

    /// <summary>Trims; <c>null</c> for blank. Throws nothing: use <see cref="Check"/> first.</summary>
    public static string Normalize(string? value) => value?.Trim() ?? string.Empty;

    public static BlogProblem? Check(string? value, int max, string field, bool required = false)
    {
        var text = Normalize(value);
        if (text.Length == 0)
        {
            return required ? new BlogProblem(BlogErrorCodes.Validation, field, "Enter a text.") : null;
        }

        if (text.Length > max)
        {
            return new BlogProblem(BlogErrorCodes.Validation, field, $"The text is longer than {max} characters.");
        }

        return IsPlain(text) ? null : new BlogProblem(BlogErrorCodes.Validation, field, "A text is plain text: no < >, no control characters.");
    }
}

/// <summary>Where a link may point: an internal path or an https address. Nothing else, ever.</summary>
public static class BlogLink
{
    public const int MaxLength = 2000;

    public static bool IsSafe(string? href)
    {
        if (string.IsNullOrEmpty(href) || href.Length > MaxLength || href != href.Trim())
        {
            return false;
        }

        // A control character, a space, a quote, an angle bracket or a backslash is never part of a link we store: browsers
        // treat "/\host" like "//host", and "java\tscript:" like "javascript:".
        if (href.Any(character => char.IsControl(character) || char.IsWhiteSpace(character) || character is '\\' or '"' or '\'' or '<' or '>'))
        {
            return false;
        }

        if (href[0] == '/')
        {
            return href.Length == 1 || href[1] != '/';
        }

        return Uri.TryCreate(href, UriKind.Absolute, out var uri) &&
               uri.Scheme == Uri.UriSchemeHttps &&
               uri.Host.Length > 0 &&
               uri.UserInfo.Length == 0 &&
               href.StartsWith("https://", StringComparison.Ordinal);
    }
}
