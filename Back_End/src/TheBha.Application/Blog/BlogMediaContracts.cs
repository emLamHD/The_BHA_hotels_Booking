using TheBha.Application.Website;
using TheBha.Domain.Blog;

namespace TheBha.Application.Blog;

// BHA-BLOG-001-CP02: the picture library. Everything here is Admin-side except the pipeline and the public variant shape.

/// <summary>One published size of a picture, as the Admin sees it. The bytes are read through the Staff preview route.</summary>
public sealed record BlogMediaVariantDto(string Preset, string Format, string ContentType, int Width, int Height, long ByteSize);

/// <summary>How many revisions use a picture: all of them, the ones live now, and the open drafts. The rest (history) is <c>Revisions − InPublished − InDrafts</c> at most.</summary>
public sealed record BlogMediaUsageSummaryDto(int Revisions, int InPublished, int InDrafts);

/// <summary>
/// A picture in the library. <c>Pipeline</c> is <c>current</c> when the variants below exist and <c>legacy</c> for a picture uploaded before CP02
/// (original only, until the operator backfill runs). <c>Version</c> is the token the descriptive fields are written against.
/// </summary>
public sealed record BlogMediaDto(
    Guid Id,
    string ContentType,
    long ByteSize,
    int Width,
    int Height,
    DateTimeOffset CreatedAtUtc,
    string DisplayName,
    string OriginalFileName,
    string Description,
    string Credit,
    string SourceUrl,
    string Licence,
    double FocalX,
    double FocalY,
    int Version,
    string Pipeline,
    string? OriginalSha256,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<BlogMediaVariantDto> Variants,
    BlogMediaUsageSummaryDto Usage);

public sealed record BlogMediaListQuery(string? Q, string? Usage, int Page, int PageSize);

public sealed record BlogMediaListDto(IReadOnlyList<BlogMediaDto> Items, int Page, int PageSize, int Total);

/// <summary>One use of a picture: the article translation, the revision (draft, live, or kept in history), and where in it (<c>cover</c>, <c>og</c>, <c>body</c>).</summary>
public sealed record BlogMediaUseDto(
    Guid PostId,
    string Locale,
    string PostStatus,
    string Title,
    Guid RevisionId,
    int RevisionNumber,
    string RevisionState,
    bool IsPublished,
    IReadOnlyList<string> Kinds);

public sealed record BlogMediaUsageDto(Guid MediaId, int Total, bool Truncated, IReadOnlyList<BlogMediaUseDto> Items);

/// <summary>A picture to take in. <c>ClientId</c> (optional) becomes the picture's id, so a client that lost the answer can read it back instead of uploading twice.</summary>
public sealed record BlogMediaUpload(Func<Stream> Open, string? FileName, Guid? ClientId);

public sealed record UpdateBlogMediaCommand(
    Guid MediaId,
    int ExpectedVersion,
    string? DisplayName,
    string? Description,
    string? Credit,
    string? SourceUrl,
    string? Licence,
    double FocalX,
    double FocalY,
    Guid ActorStaffId);

public sealed record DeleteBlogMediaCommand(Guid MediaId, int ExpectedVersion, Guid ActorStaffId);

/// <summary>The outcome of one file of a batch: <c>Index</c> is its position in the request, <c>Id</c> the picture it became (or the id the client asked for).</summary>
public sealed record BlogMediaBatchItemDto(int Index, string FileName, Guid? Id, BlogMediaDto? Media, BlogProblem? Error);

public sealed record BlogMediaBatchDto(IReadOnlyList<BlogMediaBatchItemDto> Items, int Succeeded, int Failed);

// ---- the pipeline ----

/// <summary>What the image pipeline can write. AVIF is reported <c>false</c> and never produced: the bundled encoder has none (design §CP02).</summary>
public sealed record BlogImageCapabilities(IReadOnlyList<string> Formats, bool Avif, string Note);

public sealed record BlogProcessedVariant(string Preset, string Format, int Width, int Height, byte[] Bytes);

/// <summary><c>Width</c> × <c>Height</c> is the picture as it is shown (EXIF orientation applied); the variants carry no metadata.</summary>
public sealed record BlogProcessedImage(int Width, int Height, IReadOnlyList<BlogProcessedVariant> Variants);

public interface IBlogImagePipeline
{
    BlogImageCapabilities Capabilities { get; }

    /// <summary>
    /// Decodes <paramref name="original"/> for real (a file the container check accepted can still be undecodable), applies its orientation and writes the variants.
    /// A problem is returned, never thrown, for a file that is not a usable picture.
    /// </summary>
    Task<(BlogProcessedImage? Image, BlogProblem? Problem)> ProcessAsync(ReadOnlyMemory<byte> original, HeroImageInfo expected, CancellationToken cancellationToken);
}

// ---- operator maintenance ----

/// <summary>What the operator command did (or would do). <c>Problems</c> are per picture / file; nothing in it is a secret or a path outside the media root.</summary>
public sealed record BlogMediaMaintenanceReport(
    int LegacyPictures,
    int LegacyProcessed,
    int OrphanFiles,
    int OrphansRemoved,
    int StaleTemporaryFiles,
    IReadOnlyList<string> Problems);

public interface IBlogMediaMaintenance
{
    /// <summary>
    /// Gives every generation-0 picture its variants, and finds the files nothing refers to (left by a crash or a failed delete). Without <paramref name="apply"/> nothing
    /// is written or deleted. A file younger than <paramref name="grace"/> is never an orphan: an upload in progress has its files before its row.
    /// </summary>
    Task<BlogMediaMaintenanceReport> RunAsync(bool apply, TimeSpan grace, CancellationToken cancellationToken);

    /// <summary>
    /// The backfill of <see cref="RunAsync"/> for the listed pictures only (those of them still at generation 0); no other picture row or file is read, changed or deleted,
    /// and no file is swept. Used by the content-pack import, which must not touch pictures that are not its own.
    /// </summary>
    Task<BlogMediaMaintenanceReport> BackfillAsync(IReadOnlyCollection<Guid> mediaIds, CancellationToken cancellationToken);
}
