using System.Diagnostics;
using TheBha.Api.Seeding;
using TheBha.Infrastructure.ContentPack;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C3: one regression test per finding of the third Codex review. F1 runs on real PostgreSQL, including the
/// deferred "exactly one default" trigger that only fires at commit; F2 runs the operator script against a stub <c>docker</c>; F3 runs the
/// command's own result handling.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC3Tests(PostgreSqlWebApplicationFactory factory)
{
    private Task<Target> NewTargetAsync() => ContentPackTestSupport.NewTargetAsync(factory);

    private static async Task<Guid> ActorAsync(Target t) => Guid.Parse((await t.TextAsync($"""SELECT "Id" FROM "StaffAccounts" WHERE "NormalizedEmail" = upper('{Actor}')"""))!);

    private static string NewDirectory(string prefix) => Path.Combine(Path.GetTempPath(), prefix + Guid.NewGuid().ToString("N"));

    private static async Task<string> ExportAsync(Target source)
    {
        var output = NewDirectory("bha-c3-");
        var export = await source.RunAsync(ContentPackCommand.Export, "--expected-database", source.Database, "--out", output, "--source-media-origin", BaseUrl);
        Assert.True(export.Exit == 0, export.Output);
        return output;
    }

    // ---- F1: the default currency / language is one decision, the same in dry-run, apply and verify ----

    private static string EditedCurrency(Guid actor, int rate, bool isDefault) =>
        $"""UPDATE "WebsiteCurrencies" SET "IsActive" = true, "IsDefault" = {isDefault}, "VndPerUnit" = {rate}, "RateUpdatedAtUtc" = now(), "RateUpdatedByStaffId" = '{actor}', "Version" = 2, "UpdatedByStaffId" = '{actor}' WHERE "Code" = 'USD';""";

    /// <summary>The source's staff made USD the default (VND is let go of in the same transaction, as Admin does).</summary>
    private static async Task MakeUsdDefaultAsync(Target source) =>
        await source.ExecuteAsync($"""UPDATE "WebsiteCurrencies" SET "IsDefault" = false, "Version" = 2, "UpdatedByStaffId" = '{await ActorAsync(source)}' WHERE "Code" = 'VND'; """ + EditedCurrency(await ActorAsync(source), 25500, true));

    private static async Task MakeEnglishDefaultAsync(Target source)
    {
        var actor = await ActorAsync(source);
        await source.ExecuteAsync($"""
            UPDATE "WebsiteLanguages" SET "IsDefault" = false, "Version" = 2, "UpdatedByStaffId" = '{actor}' WHERE "NormalizedCode" = 'vi';
            UPDATE "WebsiteLanguages" SET "IsActive" = true, "IsDefault" = true, "Version" = 2, "UpdatedByStaffId" = '{actor}' WHERE "NormalizedCode" = 'en';
            """);
    }

    private static Task<string?> DefaultAsync(Target t, string table, string column) => t.TextAsync($"""SELECT string_agg("{column}", ',') FROM "{table}" WHERE "IsDefault" """);

    [Fact]
    public async Task F1_currency_the_targets_staff_edited_row_stands_so_the_targets_default_stays_in_dry_run_apply_and_verify()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await MakeUsdDefaultAsync(source);
        // The target's staff changed USD's rate and kept it switched on, not default; VND is still the migration's default.
        await target.ExecuteAsync(EditedCurrency(await ActorAsync(target), 26000, false));
        var pack = await ExportAsync(source);
        try
        {
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.Contains("WebsiteCurrencies: the pack's default is USD; the target keeps VND as its default", dry.Output);
            Assert.Equal("VND", await DefaultAsync(target, "WebsiteCurrencies", "Code"));

            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal("VND", await DefaultAsync(target, "WebsiteCurrencies", "Code"));
            Assert.Equal("26000", await target.TextAsync("""SELECT "VndPerUnit"::int FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """));
            // The pack's own version of VND (no longer the default) was not written over the target's default either.
            Assert.Equal("true", await target.TextAsync("""SELECT "IsDefault"::text FROM "WebsiteCurrencies" WHERE "Code" = 'VND' """));

            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            Assert.Contains("the target keeps VND as its default", verify.Output);
            Assert.Contains(" keep the target's own version", verify.Output);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_currency_an_untouched_target_takes_the_packs_default_and_ends_with_exactly_one()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await MakeUsdDefaultAsync(source);
        var pack = await ExportAsync(source);
        try
        {
            var before = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.NotEqual(0, before.Exit);

            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.DoesNotContain("keeps VND", dry.Output);
            Assert.Equal("VND", await DefaultAsync(target, "WebsiteCurrencies", "Code"));

            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal("USD", await DefaultAsync(target, "WebsiteCurrencies", "Code"));
            Assert.Equal("25500", await target.TextAsync("""SELECT "VndPerUnit"::int FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """));

            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "website"))).Exit);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal("USD", await DefaultAsync(target, "WebsiteCurrencies", "Code"));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_language_the_targets_staff_edited_row_stands_so_the_targets_default_stays()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await MakeEnglishDefaultAsync(source);
        await target.ExecuteAsync($"""UPDATE "WebsiteLanguages" SET "IsActive" = true, "Version" = 2, "UpdatedByStaffId" = '{await ActorAsync(target)}' WHERE "NormalizedCode" = 'en' """);
        var pack = await ExportAsync(source);
        try
        {
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.Contains("WebsiteLanguages: the pack's default is en; the target keeps vi as its default", dry.Output);

            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal("vi", await DefaultAsync(target, "WebsiteLanguages", "NormalizedCode"));

            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            Assert.Contains("the target keeps vi as its default", verify.Output);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_language_an_untouched_target_takes_the_packs_default_and_ends_with_exactly_one()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await MakeEnglishDefaultAsync(source);
        var pack = await ExportAsync(source);
        try
        {
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"))).Exit);
            Assert.Equal("vi", await DefaultAsync(target, "WebsiteLanguages", "NormalizedCode"));
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal("en", await DefaultAsync(target, "WebsiteLanguages", "NormalizedCode"));
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "website"))).Exit);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_a_dry_run_reports_what_the_commit_would_refuse_instead_of_passing_and_failing_later()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await source.ExecuteAsync("""INSERT INTO "WebsiteMenuItems" ("Id","ParentId","Placement","SortOrder","Label","Href","OpenInNewTab","IsEnabled") VALUES (gen_random_uuid(), NULL, 'secondary', 900, 'Ưu đãi mùa hè', '/offers', false, true)""");
        // A rule of the target's own that only fires at commit.
        await target.ExecuteAsync("""
            CREATE FUNCTION c3_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'c3 refusal' USING ERRCODE = 'XBHA9'; END $$;
            CREATE CONSTRAINT TRIGGER c3_refuse_menu AFTER INSERT ON "WebsiteMenuItems" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c3_refuse();
            """);
        var pack = await ExportAsync(source);
        try
        {
            var before = await target.CountAsync("""SELECT count(*) FROM "WebsiteMenuItems" """);
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.NotEqual(0, dry.Exit);
            Assert.Contains("the database would refuse the commit (XBHA9", dry.Output);
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.NotEqual(0, apply.Exit);
            Assert.Equal(before, await target.CountAsync("""SELECT count(*) FROM "WebsiteMenuItems" """));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- F2: only BHA_RESTORE_DELETED=1 turns the restore on ----

    private static async Task<(int Exit, string Docker, string Stderr)> RunScriptAsync(string? restoreDeleted)
    {
        var directory = Path.Combine(PackDir(), "..");
        var stubs = Directory.CreateDirectory(NewDirectory("bha-stub-")).FullName;
        var record = Path.Combine(stubs, "docker-args");
        var stub = Path.Combine(stubs, "docker");
        await File.WriteAllTextAsync(stub, $"#!/usr/bin/env bash\nprintf '%s\\n' \"$@\" > '{record}'\n");
        File.SetUnixFileMode(stub, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        try
        {
            var start = new ProcessStartInfo("bash", [Path.Combine(directory, "import-content-pack.sh"), "apply"]) { RedirectStandardError = true, RedirectStandardOutput = true };
            start.Environment["PATH"] = stubs + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            foreach (var (name, value) in new Dictionary<string, string>
            {
                ["BHA_API_IMAGE"] = "image", ["BHA_DB_NAME"] = "db", ["BHA_MEDIA_BASE_URL"] = BaseUrl, ["BHA_MEDIA_MOUNT"] = "media", ["BHA_KEYS_MOUNT"] = "keys", ["ConnectionStrings__TheBhaDatabase"] = "unused",
            }) start.Environment[name] = value;
            start.Environment.Remove("BHA_RESTORE_DELETED");
            if (restoreDeleted is not null) start.Environment["BHA_RESTORE_DELETED"] = restoreDeleted;
            using var process = Process.Start(start)!;
            var stderr = await process.StandardError.ReadToEndAsync();
            await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();
            return (process.ExitCode, File.Exists(record) ? await File.ReadAllTextAsync(record) : string.Empty, stderr);
        }
        finally { Directory.Delete(stubs, recursive: true); }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    public async Task F2_restore_stays_off_when_the_variable_is_unset_empty_or_zero(string? value)
    {
        var (exit, docker, stderr) = await RunScriptAsync(value);
        Assert.True(exit == 0, stderr);
        Assert.Contains("--content-pack-import", docker);
        Assert.DoesNotContain("--restore-deleted", docker);
    }

    [Fact]
    public async Task F2_restore_is_on_only_for_one()
    {
        var (exit, docker, stderr) = await RunScriptAsync("1");
        Assert.True(exit == 0, stderr);
        Assert.Contains("--restore-deleted", docker);
    }

    [Theory]
    [InlineData("true")]
    [InlineData("yes")]
    [InlineData("2")]
    [InlineData(" 1")]
    public async Task F2_any_other_value_is_refused_before_docker_runs(string value)
    {
        var (exit, docker, stderr) = await RunScriptAsync(value);
        Assert.Equal(2, exit);
        Assert.Contains("BHA_RESTORE_DELETED must be 1", stderr);
        Assert.Equal(string.Empty, docker);
    }

    // ---- F3: a failed check after the apply is a failed command ----

    [Fact]
    public void F3_a_check_that_found_only_conflicts_fails_the_command_and_says_what_was_committed()
    {
        var applied = new ContentPackReport { Applied = true };
        var check = new ContentPackReport();
        check.Conflicts.Add("BlogPosts x: the slug already belongs to another post.");
        ContentPackCommand.MergeVerification(applied, check);

        Assert.Equal(["BlogPosts x: the slug already belongs to another post."], applied.Conflicts);
        Assert.Empty(applied.Problems);
        Assert.Contains(applied.Lines, l => l.Contains("VERIFICATION FAILED") && l.Contains("ARE committed"));
        Assert.DoesNotContain(applied.Lines, l => l.Contains("VERIFIED —"));
        Assert.NotEqual(0, ContentPackCommand.ExitCode(applied));
    }

    [Fact]
    public void F3_a_check_that_found_only_a_problem_still_fails_and_a_clean_check_succeeds()
    {
        var withProblem = new ContentPackReport { Applied = true };
        var failed = new ContentPackReport();
        failed.Problems.Add("variant is missing");
        ContentPackCommand.MergeVerification(withProblem, failed);
        Assert.NotEqual(0, ContentPackCommand.ExitCode(withProblem));

        var clean = new ContentPackReport { Applied = true };
        ContentPackCommand.MergeVerification(clean, new ContentPackReport());
        Assert.Contains(clean.Lines, l => l.Contains("VERIFIED —"));
        Assert.Equal(0, ContentPackCommand.ExitCode(clean));
    }
}
