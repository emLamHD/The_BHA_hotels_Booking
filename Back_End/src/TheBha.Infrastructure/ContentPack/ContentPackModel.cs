using System.Text.Json.Serialization;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>The pack's table of contents. Everything the importer trusts is checked against it before the database is touched.</summary>
public sealed record ContentPackManifest(
    int Format,
    IReadOnlyList<ContentPackProperty> Properties,
    IReadOnlyList<ContentPackTable> Tables,
    IReadOnlyList<ContentPackFile> Files,
    IReadOnlyList<string> ExternalMedia,
    IReadOnlyList<ContentPackNote> Excluded,
    IReadOnlyList<ContentPackNote> NotExported);

public sealed record ContentPackProperty(string Slug, Guid Id);

public sealed record ContentPackTable(string Name, int Rows, string Sha256);

/// <summary><c>Kind</c> is <c>blog-original</c> (an uploaded Blog picture's original), <c>promo-cover</c> or <c>hero-upload</c>.</summary>
public sealed record ContentPackFile(string Key, string Kind, long Bytes, string Sha256);

public sealed record ContentPackNote(string Name, int Rows, string Reason);

/// <param name="PropertySlugs">empty = every property of the source.</param>
/// <param name="AfterTableRead">test seam: called after each table has been read inside the export's snapshot (never set by the command).</param>
public sealed record ContentPackExportOptions(string Out, string ExpectedDatabase, IReadOnlyList<string> PropertySlugs, string? MediaRoot, string? SourceMediaOrigin, string? PublicDir, Func<string, CancellationToken, Task>? AfterTableRead = null);

public enum ContentPackMode { DryRun, Apply, Verify }

/// <summary><c>Groups</c> (default all of website, catalog, promotions, blog) limits what is written (references to what is outside the groups are still resolved, never written);
/// <c>AfterLocksAcquired</c> is a test seam called once the importer holds its locks and before it reads any configuration state (never set by the command);
/// <c>RestoreDeleted</c> puts back rows an earlier import placed and the staff deleted since (the ledger says which); a fresh database imports catalog and promotions first, creates its Staff, then imports the rest.
/// <c>ActorEmail</c> names an existing Staff account on the target; it becomes the author of every imported row that the schema requires an actor for (not needed to verify).</summary>
public sealed record ContentPackImportOptions(string Pack, string ExpectedDatabase, string? MediaRoot, string MediaBaseUrl, string? ActorEmail, ContentPackMode Mode, bool AllowLocalMediaOrigin, IReadOnlyList<string>? Groups = null, bool RestoreDeleted = false, Func<CancellationToken, Task>? AfterLocksAcquired = null);

/// <summary>What one run found. Nothing is "ok" unless <see cref="Problems"/> and <see cref="Conflicts"/> are empty.</summary>
public sealed class ContentPackReport
{
    public List<string> Lines { get; } = [];
    /// <summary>Things worth knowing that are not failures (for example an inactive language the pack's posts need).</summary>
    public List<string> Notes { get; } = [];
    /// <summary>The pictures of the pack's Blog (their ids on the target), for the picture pipeline step.</summary>
    public List<Guid> BlogMediaIds { get; } = [];
    public List<string> Conflicts { get; } = [];
    public List<string> Problems { get; } = [];
    public Dictionary<string, TableOutcome> Tables { get; } = new(StringComparer.Ordinal);
    public int FilesCopied { get; set; }
    public int FilesPresent { get; set; }
    public bool Applied { get; set; }
    /// <summary>The operator's <c>--expected-database</c> is not the database this process is connected to.</summary>
    public bool TargetRefused { get; set; }
    public bool Ok => Conflicts.Count == 0 && Problems.Count == 0;
}

public sealed class TableOutcome
{
    public int Inserted { get; set; }
    /// <summary>The target has the row and it equals the pack's.</summary>
    public int Matches { get; set; }
    /// <summary>The target has the row and it differs from the pack's: the target's (the staff's) version is kept.</summary>
    public int KeptDifferent { get; set; }
    /// <summary>The target has the same thing under another id (found by slug or code): the target's row is used and the pack's references are re-pointed. Also counted in Matches or KeptDifferent.</summary>
    public int Mapped { get; set; }
    /// <summary>A configuration row that was still the migration default and now carries the pack's value.</summary>
    public int Updated { get; set; }
    /// <summary>An earlier import placed the row and it has been deleted since: not put back (unless asked).</summary>
    public int DeletedSinceImport { get; set; }
    /// <summary>Verify only: the pack has the row and the target does not, and no import ever placed it.</summary>
    public int Missing { get; set; }
}
