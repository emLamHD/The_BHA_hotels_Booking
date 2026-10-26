using Microsoft.EntityFrameworkCore;
using TheBha.Application.Blog;
using TheBha.Infrastructure.ContentPack;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Seeding;

/// <summary>
/// BHA-CONTENT-PERSIST-001: the operator CLI that moves the website's content (Riverside catalog, promotions, Blog) between databases.
/// It runs in any environment, because the content lives where the staff edit it; the protection is the same as the other operator
/// commands: the operator names the database, it must equal <c>current_database()</c>, nothing is written without <c>--apply</c>, and it
/// exits when done (never a startup step). It never replaces a row that exists.
///
/// <code>
/// --content-pack-export --expected-database NAME --out DIR [--property-slug SLUG[,SLUG]] [--source-media-origin ORIGIN] [--public-dir DIR]
/// --content-pack-import --expected-database NAME --pack DIR --media-base-url ORIGIN [--actor-email EMAIL] (--dry-run | --apply) [--groups website,catalog,promotions,blog] [--restore-deleted]
/// --content-pack-verify --expected-database NAME --pack DIR --media-base-url ORIGIN
/// </code>
/// </summary>
public static class ContentPackCommand
{
    public const string Export = "--content-pack-export";
    public const string Import = "--content-pack-import";
    public const string Verify = "--content-pack-verify";

    public static bool IsCommand(string[] args) => args.Contains(Export, StringComparer.Ordinal) || args.Contains(Import, StringComparer.Ordinal) || args.Contains(Verify, StringComparer.Ordinal);

    public static async Task<int> RunAsync(string[] args, IServiceProvider services, string environmentName, TextWriter output, CancellationToken cancellationToken)
    {
        string? Value(string name) => Array.IndexOf(args, name) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        bool Flag(string name) => args.Contains(name, StringComparer.Ordinal);
        var verb = args.First(a => a is Export or Import or Verify);
        var expected = Value("--expected-database");
        var apply = Flag("--apply");
        var dry = Flag("--dry-run");
        string? usage = null;
        if (expected is null) usage = "--expected-database is required.";
        else if (verb == Export && Value("--out") is null) usage = "export needs --out.";
        else if (verb != Export && (Value("--pack") is null || Value("--media-base-url") is null)) usage = "--pack and --media-base-url are required.";
        else if (verb == Import && apply == dry) usage = "import needs exactly one of --dry-run, --apply.";
        if (usage is not null)
        {
            output.WriteLine($"content-pack: usage: {usage}");
            output.WriteLine("  --content-pack-export --expected-database NAME --out DIR [--property-slug SLUG[,SLUG]] [--source-media-origin ORIGIN] [--public-dir DIR]");
            output.WriteLine("  --content-pack-import --expected-database NAME --pack DIR --media-base-url ORIGIN [--actor-email EMAIL] (--dry-run | --apply) [--groups website,catalog,promotions,blog] [--restore-deleted] [--allow-local-media-origin]");
            output.WriteLine("  --content-pack-verify --expected-database NAME --pack DIR --media-base-url ORIGIN");
            return RiversideDemoSeedCommand.UsageError;
        }

        await using var scope = services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var connectionString = context.Database.GetConnectionString()!;
        var mediaRoot = scope.ServiceProvider.GetRequiredService<IConfiguration>()["WebsiteMedia:RootPath"];
        if (string.IsNullOrWhiteSpace(mediaRoot)) mediaRoot = null;

        ContentPackReport report;
        try
        {
            if (verb == Export)
            {
                report = await ContentPackExporter.ExportAsync(connectionString, new ContentPackExportOptions(Value("--out")!, expected!, (Value("--property-slug") ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries), mediaRoot, Value("--source-media-origin"), Value("--public-dir")), cancellationToken);
            }
            else
            {
                var mode = verb == Verify ? ContentPackMode.Verify : apply ? ContentPackMode.Apply : ContentPackMode.DryRun;
                var options = new ContentPackImportOptions(Value("--pack")!, expected!, mediaRoot, Value("--media-base-url")!, Value("--actor-email"), mode, Flag("--allow-local-media-origin"), Value("--groups")?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries), Flag("--restore-deleted"));
                report = await ContentPackImporter.ImportAsync(connectionString, options, environmentName, cancellationToken);
                if (mode == ContentPackMode.Apply && report.Applied)
                {
                    // The rows and the picture files are committed. The pictures of the pack came in without variants (generation 0); the picture pipeline gives them theirs —
                    // theirs only, never any other picture of the database — and only when the Blog was imported. A failure here leaves everything above in place: the same
                    // command, run again, finds the rows present and repeats only this step.
                    var groups = (options.Groups ?? ContentPackSpec.Groups).ToHashSet(StringComparer.Ordinal);
                    if (groups.Contains("blog") && report.BlogMediaIds.Count > 0)
                    {
                        var backfill = await scope.ServiceProvider.GetRequiredService<IBlogMediaMaintenance>().BackfillAsync(report.BlogMediaIds, cancellationToken);
                        report.Lines.Add($"content-pack: picture pipeline gave variants to {backfill.LegacyProcessed} of {backfill.LegacyPictures} of the pack's pictures");
                        foreach (var problem in backfill.Problems) report.Problems.Add($"{problem} The rows and files of this import are committed; run the same command again to finish the variants.");
                    }
                    var check = await ContentPackImporter.ImportAsync(connectionString, options with { Mode = ContentPackMode.Verify }, environmentName, cancellationToken);
                    report.Lines.AddRange(check.Lines.Where(l => l.Contains(" rows match the pack ") || l.Contains("picture variant files checked")).Select(l => l.Replace("content-pack: ", "content-pack: now ")));
                    report.Problems.AddRange(check.Problems.Except(report.Problems));
                    report.Notes.AddRange(check.Notes.Except(report.Notes));
                    report.Lines.Add(check.Ok ? "content-pack: VERIFIED — every row of the pack is on the target (matching it, or keeping the target's own version, listed above), and every picture file and variant is present and intact." : "content-pack: VERIFICATION FAILED");
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            output.WriteLine($"content-pack: FAILED — {ex.GetType().Name}: {ex.Message}. The database was not changed by this step; fix the cause and run again.");
            return RiversideDemoSeedCommand.Failure;
        }

        foreach (var line in report.Lines) output.WriteLine(line);
        foreach (var note in report.Notes) output.WriteLine($"content-pack: NOTE: {note}");
        foreach (var conflict in report.Conflicts) output.WriteLine($"content-pack: CONFLICT: {conflict}");
        foreach (var problem in report.Problems) output.WriteLine($"content-pack: PROBLEM: {problem}");
        return report.TargetRefused ? RiversideDemoSeedCommand.TargetRefused : report.Conflicts.Count > 0 ? RiversideDemoSeedCommand.Conflict : report.Problems.Count > 0 ? RiversideDemoSeedCommand.Failure : 0;
    }
}
