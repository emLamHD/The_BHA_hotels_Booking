using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api.Seeding;
using TheBha.Domain.Promotions;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence.Demo;

namespace TheBha.IntegrationTests;

/// <summary>BHA-BOOKING-PROMOTIONS-001: the demo promotions — only for the three real Riverside room types, never twice, never over an Admin's edit, never outside Development.</summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class PromotionDemoSeederTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-21T00:00:00Z");

    private async Task<Guid> SeedRiversideAsync(params string[] roomCodes)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = new Property(Guid.NewGuid(), "The BHA Riverside", "the-bha-riverside", null, "1 Street", "Da Nang", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        context.Add(property);
        foreach (var code in roomCodes) context.Add(new RoomType(Guid.NewGuid(), property.Id, code, code, code.ToLowerInvariant(), null, 2, 4, true, Now));
        await context.SaveChangesAsync();
        return property.Id;
    }

    private static string CoverDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "bha-promo-covers-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var png = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "promotion", "cover.png"));
        foreach (var file in new[] { "one-bedroom-living.webp", "open-view-living.webp", "two-bedroom-bedroom-1.webp" }) File.WriteAllBytes(Path.Combine(directory, file), png);
        return directory;
    }

    private PromotionDemoSeeder Seeder(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<PromotionDemoSeeder>();

    [Fact]
    public async Task A_dry_run_writes_nothing_and_an_apply_seeds_four_promotions_for_the_real_room_types()
    {
        await SeedRiversideAsync("RIV-1BR", "RIV-1BR-OPEN", "RIV-2BR");
        var covers = CoverDirectory();
        using var scope = factory.Services.CreateScope();

        var dry = await Seeder(scope).PlanAsync(null, covers, CancellationToken.None);
        Assert.Equal(4, dry.Inserted);
        Assert.False(dry.Applied);
        await using (var check = factory.CreateDbContext()) Assert.Equal(0, await check.Promotions.CountAsync());

        var applied = await Seeder(scope).ApplyAsync(null, covers, CancellationToken.None);

        Assert.True(applied.Applied);
        Assert.Empty(applied.Conflicts);
        await using var context = factory.CreateDbContext();
        var promotions = await context.Promotions.Include(x => x.RoomTypes).OrderBy(x => x.SortOrder).ToListAsync();
        Assert.Equal(["dat-som-giam-15", "o-dai-giam-200k", "gia-dinh-giam-10", "ban-nhap-chua-mo"], promotions.Select(x => x.Slug));
        Assert.Equal([PromotionStatus.Active, PromotionStatus.Active, PromotionStatus.Active, PromotionStatus.Draft], promotions.Select(x => x.Status));
        Assert.Equal([true, true, false, false], promotions.Select(x => x.ShowOnHomepage));
        Assert.True(promotions[0].AllRoomTypes);
        Assert.Equal(2, promotions[1].RoomTypes.Count);                      // RIV-1BR-OPEN and RIV-2BR
        Assert.Single(promotions[2].RoomTypes);                              // RIV-2BR only
        Assert.Equal("VND", promotions[1].CurrencyCode);
        Assert.Equal(3, await context.PromotionMedia.CountAsync());          // a cover each for the three with a picture; the draft has none
        Assert.Equal(4, await context.PromotionAudits.CountAsync());
    }

    [Fact]
    public async Task Running_it_again_adds_nothing_and_never_overwrites_an_admins_edit()
    {
        await SeedRiversideAsync("RIV-1BR", "RIV-1BR-OPEN", "RIV-2BR");
        var covers = CoverDirectory();
        using var scope = factory.Services.CreateScope();
        await Seeder(scope).ApplyAsync(null, covers, CancellationToken.None);
        await using (var edit = factory.CreateDbContext())
        {
            var promotion = await edit.Promotions.Include(x => x.RoomTypes).SingleAsync(x => x.Slug == "dat-som-giam-15");
            promotion.Edit(promotion.ToDetails() with { Value = 30m, Title = "Do Admin sửa" }, Guid.NewGuid(), Now);
            await edit.SaveChangesAsync();
        }

        var again = await Seeder(scope).ApplyAsync(null, covers, CancellationToken.None);

        Assert.Equal(0, again.Inserted);
        Assert.All(again.Lines, line => Assert.Equal("exists", line.Action));
        await using var context = factory.CreateDbContext();
        Assert.Equal(4, await context.Promotions.CountAsync());
        Assert.Equal(3, await context.PromotionMedia.CountAsync());
        var edited = await context.Promotions.SingleAsync(x => x.Slug == "dat-som-giam-15");
        Assert.Equal((30m, "Do Admin sửa"), (edited.Value, edited.Title));
    }

    [Fact]
    public async Task Without_the_three_real_room_types_it_stops_and_writes_nothing()
    {
        await SeedRiversideAsync("RIV-1BR");
        using var scope = factory.Services.CreateScope();

        var result = await Seeder(scope).ApplyAsync(null, CoverDirectory(), CancellationToken.None);

        Assert.False(result.Applied);
        Assert.Contains(result.Conflicts, c => c.Contains("RIV-2BR"));
        await using var context = factory.CreateDbContext();
        Assert.Equal(0, await context.Promotions.CountAsync());
    }

    [Fact]
    public async Task Without_covers_it_still_seeds_the_rules_but_puts_nothing_on_the_homepage()
    {
        await SeedRiversideAsync("RIV-1BR", "RIV-1BR-OPEN", "RIV-2BR");
        using var scope = factory.Services.CreateScope();

        var result = await Seeder(scope).ApplyAsync(null, null, CancellationToken.None);

        Assert.Equal(4, result.Inserted);
        await using var context = factory.CreateDbContext();
        Assert.All(await context.Promotions.ToListAsync(), p => { Assert.False(p.ShowOnHomepage); Assert.Null(p.CoverMediaId); });
        Assert.Equal(0, await context.PromotionMedia.CountAsync());
    }

    [Theory]
    [InlineData("Production", "thebha_showcase_demo", "thebha_showcase_demo")]
    [InlineData("Staging", "thebha_showcase_demo", "thebha_showcase_demo")]
    [InlineData("Development", "thebha_prod", "thebha_prod")]                    // not a demo database
    [InlineData("Development", "thebha_showcase_demo", "another_database")]      // not the database this process is connected to
    public void The_command_uses_the_same_target_rules_as_the_Riverside_seed(string environment, string expected, string actual)
    {
        Assert.NotNull(RiversideDemoSeedCommand.RefuseTarget(environment, expected, actual));
        Assert.Null(RiversideDemoSeedCommand.RefuseTarget("Development", "thebha_showcase_demo", "thebha_showcase_demo"));
        Assert.True(PromotionDemoSeedCommand.IsCommand(["--seed-promotion-demo"]));
    }

    [Fact]
    public async Task The_command_prints_the_target_and_never_a_connection_secret_and_refuses_outside_Development()
    {
        await factory.ResetDatabaseAsync();
        using var output = new StringWriter();

        var code = await PromotionDemoSeedCommand.RunAsync(["--seed-promotion-demo", "--expected-database", "thebha_showcase_demo", "--dry-run"], factory.Services, "Production", output, CancellationToken.None);

        Assert.Equal(RiversideDemoSeedCommand.TargetRefused, code);
        Assert.DoesNotContain("Password", output.ToString(), StringComparison.OrdinalIgnoreCase);
        await using var context = factory.CreateDbContext();
        Assert.Equal(0, await context.Promotions.CountAsync());
    }
}
