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
/// --content-pack-export --expected-database NAME --out DIR --property-slug SLUG[,SLUG] [--source-media-origin ORIGIN] [--public-dir DIR]
/// --content-pack-import --expected-database NAME --pack DIR --media-base-url ORIGIN [--actor-email EMAIL] (--dry-run | --apply) [--groups catalog,promotions,blog]
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
        else if (verb == Export && (Value("--out") is null || Value("--property-slug") is null)) usage = "export needs --out and --property-slug.";
        else if (verb != Export && (Value("--pack") is null || Value("--media-base-url") is null)) usage = "--pack and --media-base-url are required.";
        else if (verb == Import && (apply == dry || (Value("--actor-email") is null && (Value("--groups") is null || Value("--groups")!.Contains("blog"))))) usage = "import needs exactly one of --dry-run, --apply, and --actor-email unless --groups leaves out blog.";
        if (usage is not null)
        {
            output.WriteLine($"content-pack: usage: {usage}");
            output.WriteLine("  --content-pack-export --expected-database NAME --out DIR --property-slug SLUG[,SLUG] [--source-media-origin ORIGIN] [--public-dir DIR]");
            output.WriteLine("  --content-pack-import --expected-database NAME --pack DIR --media-base-url ORIGIN --actor-email EMAIL (--dry-run | --apply) [--groups catalog,promotions,blog] [--allow-local-media-origin]");
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
                report = await ContentPackExporter.ExportAsync(connectionString, new ContentPackExportOptions(Value("--out")!, expected!, Value("--property-slug")!.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries), mediaRoot, Value("--source-media-origin"), Value("--public-dir")), cancellationToken);
            }
            else
            {
                var mode = verb == Verify ? ContentPackMode.Verify : apply ? ContentPackMode.Apply : ContentPackMode.DryRun;
                var options = new ContentPackImportOptions(Value("--pack")!, expected!, mediaRoot, Value("--media-base-url")!, Value("--actor-email"), mode, Flag("--allow-local-media-origin"), Value("--groups")?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                report = await ContentPackImporter.ImportAsync(connectionString, options, environmentName, cancellationToken);
                if (mode == ContentPackMode.Apply && report.Applied)
                {
                    // The pictures came in without variants (generation 0); the picture pipeline gives them theirs. A grace of a century keeps this from
                    // touching any file that nothing refers to: only the backfill runs.
                    var backfill = await scope.ServiceProvider.GetRequiredService<IBlogMediaMaintenance>().RunAsync(apply: true, TimeSpan.FromDays(36500), cancellationToken);
                    report.Lines.Add($"content-pack: picture pipeline gave variants to {backfill.LegacyProcessed} of {backfill.LegacyPictures} pictures");
                    report.Problems.AddRange(backfill.Problems);
                    var check = await ContentPackImporter.ImportAsync(connectionString, options with { Mode = ContentPackMode.Verify }, environmentName, cancellationToken);
                    report.Lines.Add(check.Ok ? "content-pack: VERIFIED — every row, picture file and variant of the pack is on the target." : "content-pack: VERIFICATION FAILED");
                    report.Problems.AddRange(check.Problems);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            output.WriteLine($"content-pack: FAILED — {ex.GetType().Name}: {ex.Message}. The database was not changed by this step; fix the cause and run again.");
            return RiversideDemoSeedCommand.Failure;
        }

        foreach (var line in report.Lines) output.WriteLine(line);
        foreach (var conflict in report.Conflicts) output.WriteLine($"content-pack: CONFLICT: {conflict}");
        foreach (var problem in report.Problems) output.WriteLine($"content-pack: PROBLEM: {problem}");
        return report.TargetRefused ? RiversideDemoSeedCommand.TargetRefused : report.Conflicts.Count > 0 ? RiversideDemoSeedCommand.Conflict : report.Problems.Count > 0 ? RiversideDemoSeedCommand.Failure : 0;
    }
}
