using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Api.Seeding;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Demo;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: the operator CLI's guards and exit codes. The database is a
/// throwaway one whose name contains "showcase_demo", created and dropped here, so the rules
/// are exercised against a real <c>current_database()</c>; the shared test database is never
/// used and no Owner database is reachable.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class RiversideDemoSeedCommandTests(PostgreSqlWebApplicationFactory factory) : IAsyncLifetime
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-06T03:00:00Z");
    private string _databaseName = "";
    private string _connectionString = "";
    private ServiceProvider _services = null!;

    public async Task InitializeAsync()
    {
        factory.Clock.UtcNow = Now;
        var admin = new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = "postgres", Pooling = false };
        _databaseName = $"thebha_showcase_demo_test_{Guid.NewGuid():N}"[..48];
        await using (var connection = new NpgsqlConnection(admin.ConnectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{_databaseName}\"";
            await command.ExecuteNonQueryAsync();
        }

        _connectionString = new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = _databaseName, Pooling = false }.ConnectionString;
        var services = new ServiceCollection();
        services.AddSingleton<TimeProvider>(factory.Clock);
        services.AddDbContext<TheBhaDbContext>(options =>
            options.UseNpgsql(_connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure")));
        services.AddScoped<RiversideDemoSeeder>();
        _services = services.BuildServiceProvider();
        await using var scope = _services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<TheBhaDbContext>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await _services.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        var admin = new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = "postgres", Pooling = false };
        await using var connection = new NpgsqlConnection(admin.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    private string[] Args(params string[] extra) =>
        ["--seed-riverside-demo", "--expected-database", _databaseName, "--media-base-url", "https://demo.example.test:3000", "--from", "2026-10-07", .. extra];

    private async Task<(int Exit, string Output)> RunAsync(string[] args, string environment = "Development", IServiceProvider? services = null)
    {
        using var output = new StringWriter();
        var exit = await RiversideDemoSeedCommand.RunAsync(args, services ?? _services, environment, output, CancellationToken.None);
        var text = output.ToString();
        var password = new NpgsqlConnectionStringBuilder(factory.ConnectionString).Password!;
        Assert.DoesNotContain(password, text); // a run never echoes a credential
        Assert.DoesNotContain("Password", text, StringComparison.OrdinalIgnoreCase);
        return (exit, text);
    }

    private async Task<int> RowsAsync()
    {
        await using var scope = _services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        return await context.Properties.CountAsync() + await context.RoomTypes.CountAsync() + await context.PhysicalRooms.CountAsync() +
               await context.DailyRoomRates.CountAsync() + await context.Media.CountAsync();
    }

    [Theory]
    [InlineData("Development", "thebha_customer_showcase_demo", "thebha_customer_showcase_demo", null)]
    [InlineData("Development", "THEBHA_DEMO", "THEBHA_DEMO", null)]
    [InlineData("Production", "thebha_customer_showcase_demo", "thebha_customer_showcase_demo", "Development")]
    [InlineData("Staging", "thebha_customer_showcase_demo", "thebha_customer_showcase_demo", "Development")]
    [InlineData("", "thebha_customer_showcase_demo", "thebha_customer_showcase_demo", "Development")]
    [InlineData("development", "thebha_customer_showcase_demo", "thebha_customer_showcase_demo", "Development")] // exact, case-sensitive
    [InlineData("Development", "thebha", "thebha", "demo or showcase")]
    [InlineData("Development", "the-bha-db", "the-bha-db", "demo or showcase")]
    [InlineData("Development", "production", "production", "demo or showcase")]
    [InlineData("Development", "", "thebha_demo", "demo or showcase")]
    [InlineData("Development", "thebha_customer_showcase_demo", "thebha_customer_showcase_demo_2", "does not match")]
    [InlineData("Development", "thebha_demo", "THEBHA_DEMO", "does not match")] // names are compared exactly
    public void The_target_rules(string environment, string expected, string actual, string? refusalContains)
    {
        var refusal = RiversideDemoSeedCommand.RefuseTarget(environment, expected, actual);
        if (refusalContains is null)
        {
            Assert.Null(refusal);
        }
        else
        {
            Assert.NotNull(refusal);
            Assert.Contains(refusalContains, refusal);
        }
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("Test")]
    public async Task Any_environment_but_Development_is_refused_before_the_database_is_touched(string environment)
    {
        // An empty provider: if the command reached for a DbContext it would throw instead of returning 3.
        var (exit, output) = await RunAsync(Args("--apply"), environment, new ServiceCollection().BuildServiceProvider());
        Assert.Equal(RiversideDemoSeedCommand.TargetRefused, exit);
        Assert.Contains("only with ASPNETCORE_ENVIRONMENT=Development", output);
    }

    [Theory]
    [MemberData(nameof(BadArguments))]
    public async Task Bad_arguments_are_a_usage_error_and_write_nothing(string[] args, string reason)
    {
        var (exit, output) = await RunAsync(args);
        Assert.Equal(RiversideDemoSeedCommand.UsageError, exit);
        Assert.Contains("riverside-seed:", output);
        Assert.Contains(reason, output);
        Assert.Equal(0, await RowsAsync());
    }

    private static object[] Case(IEnumerable<string> args, string reason) => [args.ToArray(), reason];

    public static IEnumerable<object[]> BadArguments()
    {
        const string verb = "--seed-riverside-demo";
        string[] good = [verb, "--expected-database", "x_demo", "--media-base-url", "https://a.test", "--from", "2026-10-07"];
        yield return Case(good.Where((_, index) => index is not (1 or 2)).Append("--dry-run"), "--expected-database is required");
        yield return Case(good.Where((_, index) => index is not (3 or 4)).Append("--dry-run"), "--media-base-url is required");
        yield return Case(good.Where((_, index) => index is not (5 or 6)).Append("--dry-run"), "--from is required");
        yield return Case(good, "exactly one of --dry-run and --apply");
        yield return Case(good.Concat(["--dry-run", "--apply"]), "exactly one of --dry-run and --apply");
        yield return Case(good.Concat(["--dry-run", "--days", "abc"]), "--days must be a whole number");
        yield return Case(good.Concat(["--dry-run", "--days", "0"]), "days must be between");
        yield return Case(good.Concat(["--dry-run", "--days", "367"]), "days must be between");
        yield return Case(good.Concat(["--dry-run", "--days", "-3"]), "--days must be a whole number");
        yield return Case(good.Select(item => item == "2026-10-07" ? "07/10/2026" : item).Append("--dry-run"), "YYYY-MM-DD");
        yield return Case(good.Select(item => item == "2026-10-07" ? "2026-13-40" : item).Append("--dry-run"), "YYYY-MM-DD");
        yield return Case(good.Select(item => item == "https://a.test" ? "http://a.test" : item).Append("--dry-run"), "https origin");
        yield return Case(good.Select(item => item == "https://a.test" ? "https://a.test/media" : item).Append("--dry-run"), "https origin");
        yield return Case(good.Concat(["--dry-run", "--days"]), "--days needs a value");
        yield return Case(good.Concat(["--dry-run", "--from", "2026-10-08"]), "--from was given twice");
        yield return Case(good.Concat(["--dry-run", "--seed-development"]), "cannot be combined");
        yield return Case(good.Concat(["--dry-run", "--staff-create"]), "cannot be combined");
    }

    [Fact]
    public async Task A_database_whose_name_is_not_demo_or_showcase_is_refused_even_when_named_correctly()
    {
        // The throwaway database is "thebha_showcase_demo_test_..."; name another one without those words.
        var admin = new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = "postgres", Pooling = false };
        var plain = $"thebha_live_{Guid.NewGuid():N}"[..30];
        await using (var connection = new NpgsqlConnection(admin.ConnectionString))
        {
            await connection.OpenAsync();
            await using var create = connection.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{plain}\"";
            await create.ExecuteNonQueryAsync();
        }

        try
        {
            var services = new ServiceCollection();
            services.AddSingleton<TimeProvider>(factory.Clock);
            services.AddDbContext<TheBhaDbContext>(options => options.UseNpgsql(
                new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = plain, Pooling = false }.ConnectionString,
                npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure")));
            services.AddScoped<RiversideDemoSeeder>();
            await using var provider = services.BuildServiceProvider();

            var (exit, output) = await RunAsync(["--seed-riverside-demo", "--expected-database", plain, "--media-base-url", "https://a.test", "--from", "2026-10-07", "--apply"], services: provider);

            Assert.Equal(RiversideDemoSeedCommand.TargetRefused, exit);
            Assert.Contains("demo or showcase", output);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var connection = new NpgsqlConnection(admin.ConnectionString);
            await connection.OpenAsync();
            await using var drop = connection.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{plain}\" WITH (FORCE)";
            await drop.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task A_wrong_expected_database_is_refused_and_writes_nothing()
    {
        var args = Args("--apply").ToArray();
        args[2] = "thebha_showcase_demo_somewhere_else";
        var (exit, output) = await RunAsync(args);
        Assert.Equal(RiversideDemoSeedCommand.TargetRefused, exit);
        Assert.Contains("does not match", output);
        Assert.Equal(0, await RowsAsync());
    }

    [Fact]
    public async Task Dry_run_prints_the_plan_and_writes_nothing_then_apply_and_rerun_behave()
    {
        var (dryExit, dry) = await RunAsync(Args("--dry-run"));
        Assert.Equal(0, dryExit);
        Assert.Contains("DRY RUN", dry);
        Assert.Contains("insert    11", dry); // PhysicalRooms
        Assert.Contains($"target 127.0.0.1:{new NpgsqlConnectionStringBuilder(factory.ConnectionString).Port}/{_databaseName}", dry.Replace("localhost", "127.0.0.1"));
        Assert.Equal(0, await RowsAsync());

        var (applyExit, applied) = await RunAsync(Args("--apply", "--days", "30"));
        Assert.Equal(0, applyExit);
        var media = TheBha.Infrastructure.Persistence.Demo.RiversideDemoCatalog.Media.Count;
        // 1 property, 2 amenities, 3 types, 1 plan, 11 rooms, 90 rates, every picture + its link, 2 amenity links
        Assert.Contains($"APPLIED — {1 + 2 + 3 + 1 + 11 + 90 + media + media + 2} rows inserted", applied);
        var rows = await RowsAsync();
        Assert.Equal(1 + 3 + 11 + 90 + media, rows); // the tables RowsAsync counts

        var (rerunExit, rerun) = await RunAsync(Args("--apply", "--days", "30"));
        Assert.Equal(0, rerunExit);
        Assert.Contains("APPLIED — 0 rows inserted", rerun);
        Assert.Equal(rows, await RowsAsync());
    }

    [Fact]
    public async Task A_conflict_exits_4_and_writes_nothing()
    {
        await using (var scope = _services.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
            var propertyId = Guid.NewGuid();
            var other = new TheBha.Domain.Properties.RoomType(Guid.NewGuid(), propertyId, "OTHER", "Other", "other", null, 2, 2, true, Now);
            context.Properties.Add(new TheBha.Domain.Properties.Property(propertyId, "The BHA Riverside", "the-bha-riverside", null, "a", "c", "Vietnam",
                "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now));
            await context.SaveChangesAsync();
            context.RoomTypes.Add(other);
            await context.SaveChangesAsync();
            context.PhysicalRooms.Add(new TheBha.Domain.Properties.PhysicalRoom(Guid.NewGuid(), propertyId, other, "DEMO-2BR-01", 1, TheBha.Domain.Properties.OperationalStatus.Active, Now));
            await context.SaveChangesAsync();
        }

        var before = await RowsAsync();
        var (exit, output) = await RunAsync(Args("--apply"));

        Assert.Equal(RiversideDemoSeedCommand.Conflict, exit);
        Assert.Contains("CONFLICT: room DEMO-2BR-01 belongs to another room type", output);
        Assert.Contains("nothing was written", output);
        Assert.Equal(before, await RowsAsync());
    }

    [Fact]
    public async Task A_database_failure_exits_1_reports_the_kind_only_and_rolls_back()
    {
        await using (var scope = _services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<TheBhaDbContext>().Database.ExecuteSqlRawAsync(
                """
                CREATE FUNCTION riverside_cli_probe() RETURNS trigger LANGUAGE plpgsql AS
                    $$ BEGIN RAISE EXCEPTION 'probe: secret-row-value-123'; END $$;
                CREATE TRIGGER riverside_cli_probe BEFORE INSERT ON "DailyRoomRates"
                    FOR EACH ROW EXECUTE FUNCTION riverside_cli_probe();
                """);
        }

        var (exit, output) = await RunAsync(Args("--apply"));

        Assert.Equal(RiversideDemoSeedCommand.Failure, exit);
        Assert.Contains("rolled back and nothing was changed", output);
        Assert.DoesNotContain("secret-row-value-123", output); // the database message is never printed
        Assert.Equal(0, await RowsAsync());
    }

    [Fact]
    public async Task A_past_start_date_is_a_usage_error()
    {
        var args = Args("--apply").ToArray();
        args[^2] = "2026-10-05"; // the --from value (the property's local today is 2026-10-06)
        var (exit, output) = await RunAsync(args);
        Assert.Equal(RiversideDemoSeedCommand.UsageError, exit);
        Assert.Contains("before the property's local today", output);
        Assert.Equal(0, await RowsAsync());
    }
}
