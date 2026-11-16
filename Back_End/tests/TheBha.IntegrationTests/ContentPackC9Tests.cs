using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Website;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C9, the finding of the ninth Codex review: when the importer keeps the target's default language, that row keeps its own "active" flag too, so the
/// table never meets CK_WebsiteLanguages_DefaultIsActive (default => active). Real PostgreSQL; the source and target are set up through the real settings services.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC9Tests(PostgreSqlWebApplicationFactory factory)
{
    private Task<Target> NewTargetAsync() => ContentPackTestSupport.NewTargetAsync(factory);

    private static Task<string?> LanguagesAsync(Target t) =>
        t.TextAsync("""SELECT string_agg("NormalizedCode" || ':' || "IsDefault" || ':' || "IsActive" || ':v' || "Version", ',' ORDER BY "NormalizedCode") FROM "WebsiteLanguages" """);

    private static Task<string?> RowsAsync(Target t) => t.TextAsync("""SELECT string_agg(to_jsonb(l)::text, ',' ORDER BY "NormalizedCode") FROM "WebsiteLanguages" l""");

    /// <summary>The source's staff make English the default and switch Vietnamese off (the settings store checks version and the default rule itself).</summary>
    private static async Task StaffMakeEnglishDefaultAndSwitchViOffAsync(Target source)
    {
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: true);
        var actor = await ContentPackC3Tests.ActorAsync(source);
        await using var scope = source.Host.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IWebsiteSettingsStore>();
        var vi = (await store.ListLanguagesAsync(CancellationToken.None)).Single(l => l.Code == "vi");
        var off = await store.UpdateLanguageAsync(new UpdateLanguageCommand("vi", vi.Version, vi.DisplayName, vi.NativeName, vi.SortOrder, false, vi.DefaultCurrencyCode, vi.Direction, vi.FormatLocale, actor), CancellationToken.None);
        Assert.True(off.Status == WebsiteMutationStatus.Succeeded, off.Message);
    }

    [Fact]
    public async Task F1_the_targets_default_language_keeps_being_active_when_the_pack_switched_it_off_and_the_staffs_english_edit_is_kept()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await StaffMakeEnglishDefaultAndSwitchViOffAsync(source);
        // The target's staff edited the English row (so the pack's default is not taken); Vietnamese is still the migration's default, active.
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        Assert.Contains("vi:true:true", await LanguagesAsync(target));
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            var before = await RowsAsync(target);
            var vi = await target.TextAsync("""SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi' """);
            var keptLine = $"kept (the target's default stands): WebsiteLanguages {vi} — IsDefault, IsActive";
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.Contains("WebsiteLanguages: the pack's default is en; the target keeps vi as its default (the target's en was edited by its staff)", dry.Output);
            Assert.Contains(keptLine, dry.Output);
            Assert.Equal(before, await RowsAsync(target));

            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal("vi", await target.TextAsync("""SELECT string_agg("NormalizedCode", ',') FROM "WebsiteLanguages" WHERE "IsDefault" AND "IsActive" """));
            Assert.Equal(1, await target.CountAsync("""SELECT count(*) FROM "WebsiteLanguages" WHERE "IsDefault" """));
            // Every row of the target is exactly as the staff left it (the English edit and Vietnamese both).
            Assert.Equal(before, await RowsAsync(target));

            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            Assert.Contains("the target keeps vi as its default", verify.Output);
            Assert.Contains(keptLine, verify.Output);
            Assert.Matches(@"WebsiteLanguages\s+inserted\s+0\s+matches\s+\d+\s+kept-target\s+[1-9]", verify.Output);

            var again = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(again.Exit == 0, again.Output);
            Assert.Equal(before, await RowsAsync(target));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_control_an_untouched_target_takes_english_as_default_and_switches_vietnamese_off_as_the_source_has_it()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await StaffMakeEnglishDefaultAndSwitchViOffAsync(source);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"))).Exit);
            Assert.Contains("vi:true:true", await LanguagesAsync(target));
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            var languages = await LanguagesAsync(target);
            Assert.Contains("en:true:true", languages);
            Assert.Contains("vi:false:false", languages);
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "website"))).Exit);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }
}
