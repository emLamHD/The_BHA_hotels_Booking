using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api.Authentication;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP02: the Staff operator CLI against real PostgreSQL. Each run also
/// asserts that the captured output never contains a password.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StaffBootstrapCommandTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly string Password = $"A!a1{Guid.NewGuid():N}";
    private static readonly string NewPassword = $"B!b2{Guid.NewGuid():N}";
    private static readonly Guid PropertyA = Guid.Parse("91000000-0000-0000-0000-00000000000a");
    private static readonly Guid PropertyB = Guid.Parse("91000000-0000-0000-0000-00000000000b");
    private const string Email = "desk@example.com";

    [Fact]
    public async Task Create_adds_staff_and_membership_and_refuses_bad_input_without_changes()
    {
        await ResetAsync();

        Assert.Equal(1, (await RunAsync(Create(Guid.NewGuid()), Password)).Exit);
        Assert.Equal(1, (await RunAsync(Create(PropertyA), "weak")).Exit);
        Assert.Equal(2, (await RunAsync(Create(PropertyA), "")).Exit);
        Assert.Equal((0, 0), await CountsAsync());

        var (exit, output) = await RunAsync(Create(PropertyA, "Desk@Example.COM"), Password);
        Assert.Equal(0, exit);
        Assert.Contains("target database", output);
        var staff = await FindAsync();
        Assert.Contains(staff.Id.ToString(), output);
        Assert.Equal(StaffRole.Manager, (await MembershipsAsync()).Single().Role);
        Assert.True(await CheckPasswordAsync(Password));

        Assert.Equal(1, (await RunAsync(Create(PropertyA), NewPassword)).Exit);
        Assert.Equal((1, 1), await CountsAsync());
        Assert.True(await CheckPasswordAsync(Password));
    }

    [Fact]
    public async Task Create_rolls_back_the_staff_row_when_the_membership_insert_fails()
    {
        await ResetAsync();
        await using var context = factory.CreateDbContext();
        await context.Database.ExecuteSqlRawAsync(
            """
            CREATE SEQUENCE staff_cli_probe_staff_inserts;
            CREATE SEQUENCE staff_cli_probe_membership_attempts;
            CREATE FUNCTION staff_cli_probe_count() RETURNS trigger LANGUAGE plpgsql AS
                $$ BEGIN PERFORM nextval('staff_cli_probe_staff_inserts'); RETURN NEW; END $$;
            CREATE FUNCTION staff_cli_probe_fail() RETURNS trigger LANGUAGE plpgsql AS
                $$ BEGIN PERFORM nextval('staff_cli_probe_membership_attempts'); RAISE EXCEPTION 'probe: membership insert refused'; END $$;
            CREATE TRIGGER staff_cli_probe_count AFTER INSERT ON "StaffAccounts"
                FOR EACH ROW EXECUTE FUNCTION staff_cli_probe_count();
            CREATE TRIGGER staff_cli_probe_fail BEFORE INSERT ON "StaffPropertyMemberships"
                FOR EACH ROW EXECUTE FUNCTION staff_cli_probe_fail();
            """);
        try
        {
            var (exit, output) = await RunAsync(Create(PropertyA), Password);

            Assert.Equal(1, exit);
            Assert.Contains("DbUpdateException", output);
            // Sequences are not transactional: one Staff row was inserted, then the membership insert failed.
            Assert.Equal(1, await context.Database.SqlQueryRaw<long>(
                "SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS \"Value\" FROM staff_cli_probe_staff_inserts").SingleAsync());
            Assert.Equal(1, await context.Database.SqlQueryRaw<long>(
                "SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS \"Value\" FROM staff_cli_probe_membership_attempts").SingleAsync());
            Assert.Equal((0, 0), await CountsAsync());
        }
        finally
        {
            await context.Database.ExecuteSqlRawAsync(
                """
                DROP TRIGGER IF EXISTS staff_cli_probe_count ON "StaffAccounts";
                DROP TRIGGER IF EXISTS staff_cli_probe_fail ON "StaffPropertyMemberships";
                DROP FUNCTION IF EXISTS staff_cli_probe_count();
                DROP FUNCTION IF EXISTS staff_cli_probe_fail();
                DROP SEQUENCE IF EXISTS staff_cli_probe_staff_inserts;
                DROP SEQUENCE IF EXISTS staff_cli_probe_membership_attempts;
                """);
        }
    }

    [Fact]
    public async Task Staff_and_customer_with_the_same_email_stay_independent()
    {
        await ResetAsync();
        using var scope = factory.Services.CreateScope();
        var customers = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
        var customer = new CustomerAccount { Email = Email, UserName = Email };
        Assert.True((await customers.CreateAsync(customer, Password)).Succeeded);
        var stamp = customer.SecurityStamp;

        Assert.Equal(0, (await RunAsync(Create(PropertyA), NewPassword)).Exit);

        var reloaded = (await customers.FindByEmailAsync(Email))!;
        Assert.Equal((customer.Id, stamp), (reloaded.Id, reloaded.SecurityStamp));
        Assert.True(await customers.CheckPasswordAsync(reloaded, Password));
        Assert.NotEqual(customer.Id, (await FindAsync()).Id);
    }

    [Fact]
    public async Task Grant_is_idempotent_changes_role_and_leaves_other_properties_and_disable_alone()
    {
        await ResetAsync();
        await RunAsync(Create(PropertyA), Password);
        await RunAsync(["--staff-disable", "--email", Email], null);

        Assert.Equal(0, (await RunAsync(Grant(PropertyB, StaffRole.FrontDesk), null)).Exit);
        var (exit, output) = await RunAsync(Grant(PropertyB, StaffRole.FrontDesk), null);
        Assert.Equal(0, exit);
        Assert.Contains("unchanged", output);
        Assert.Equal(0, (await RunAsync(Grant(PropertyB, StaffRole.Manager), null)).Exit);
        Assert.Equal(1, (await RunAsync(Grant(Guid.NewGuid(), StaffRole.Manager), null)).Exit);

        var roles = (await MembershipsAsync()).ToDictionary(membership => membership.PropertyId, membership => membership.Role);
        Assert.Equal(StaffRole.Manager, roles[PropertyA]);
        Assert.Equal(StaffRole.Manager, roles[PropertyB]);
        Assert.Equal(2, roles.Count);
        Assert.False((await FindAsync()).IsActive);
    }

    [Fact]
    public async Task Disable_is_atomic_idempotent_and_keeps_staff_memberships_and_first_timestamp()
    {
        await ResetAsync();
        await RunAsync(Create(PropertyA), Password);
        var stamp = (await FindAsync()).SecurityStamp;
        var disabledAt = new DateTimeOffset(2026, 10, 2, 8, 0, 0, TimeSpan.Zero);
        factory.Clock.UtcNow = disabledAt;

        Assert.Equal(0, (await RunAsync(["--staff-disable", "--email", Email], null)).Exit);
        var disabled = await FindAsync();
        Assert.False(disabled.IsActive);
        Assert.Equal(disabledAt, disabled.DisabledAtUtc);
        Assert.NotEqual(stamp, disabled.SecurityStamp);

        factory.Clock.UtcNow = disabledAt.AddHours(1);
        var (exit, output) = await RunAsync(["--staff-disable", "--email", Email], null);
        Assert.Equal(0, exit);
        Assert.Contains("unchanged", output);
        var again = await FindAsync();
        Assert.Equal((disabled.DisabledAtUtc, disabled.SecurityStamp), (again.DisabledAtUtc, again.SecurityStamp));
        Assert.Equal((1, 1), await CountsAsync());
    }

    [Fact]
    public async Task Reset_password_replaces_it_or_keeps_the_old_one_and_never_unlocks_or_enables()
    {
        await ResetAsync();
        await RunAsync(Create(PropertyA), Password);
        await RunAsync(["--staff-disable", "--email", Email], null);
        using (var scope = factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
            var account = (await users.FindByEmailAsync(Email))!;
            for (var attempt = 0; attempt < 5; attempt++)
            {
                await users.AccessFailedAsync(account);
            }
        }

        var locked = await FindAsync();
        Assert.NotNull(locked.LockoutEnd);

        Assert.Equal(1, (await RunAsync(["--staff-reset-password", "--email", Email], "weak")).Exit);
        Assert.True(await CheckPasswordAsync(Password));
        Assert.Equal(locked.SecurityStamp, (await FindAsync()).SecurityStamp);

        Assert.Equal(0, (await RunAsync(["--staff-reset-password", "--email", Email], NewPassword)).Exit);
        Assert.True(await CheckPasswordAsync(NewPassword));
        Assert.False(await CheckPasswordAsync(Password));
        var reset = await FindAsync();
        Assert.NotEqual(locked.SecurityStamp, reset.SecurityStamp);
        Assert.Equal((false, locked.LockoutEnd, locked.AccessFailedCount), (reset.IsActive, reset.LockoutEnd, reset.AccessFailedCount));
    }

    [Theory]
    [InlineData]
    [InlineData("--staff-create")]
    [InlineData("--staff-create", "--email", Email, "--property-id", "91000000-0000-0000-0000-00000000000a", "--role", "Manager", "--password", "Secret-Arg-1!")]
    [InlineData("--staff-create", "--email", Email, "--property-id", "not-a-guid", "--role", "Manager")]
    [InlineData("--staff-create", "--email", "Secret-Arg-1!", "--property-id", "91000000-0000-0000-0000-00000000000a", "--role", "Manager")]
    [InlineData("--staff-create", "--email", Email, "--property-id", "91000000-0000-0000-0000-00000000000a", "--role", "Owner")]
    [InlineData("--staff-grant", "--email", Email, "--email", Email, "--property-id", "91000000-0000-0000-0000-00000000000a", "--role", "Manager")]
    [InlineData("--staff-disable", "--staff-reset-password", "--email", Email)]
    [InlineData("--staff-disable", "--email")]
    [InlineData("--staff-disable", "--email", Email, "--seed-development")]
    [InlineData("--staff-delete", "--email", Email)]
    public async Task Invalid_arguments_are_refused_before_any_change(params string[] args)
    {
        await ResetAsync();

        var (exit, output) = await RunAsync(args, Password);

        Assert.Equal(2, exit);
        Assert.DoesNotContain("Secret-Arg-1!", output);
        Assert.DoesNotContain("target database", output);
        Assert.Equal((0, 0), await CountsAsync());
    }

    private static string[] Create(Guid propertyId, string email = Email) =>
        ["--staff-create", "--email", email, "--property-id", propertyId.ToString(), "--role", StaffRole.Manager];

    private static string[] Grant(Guid propertyId, string role) =>
        ["--staff-grant", "--email", Email, "--property-id", propertyId.ToString(), "--role", role];

    private async Task<(int Exit, string Output)> RunAsync(string[] args, string? password)
    {
        using var output = new StringWriter();
        var exit = await StaffBootstrapCommand.RunAsync(args, factory.Services, output, () => password, CancellationToken.None);
        var text = output.ToString();
        Assert.DoesNotContain(Password, text);
        Assert.DoesNotContain(NewPassword, text);
        return (exit, text);
    }

    private async Task ResetAsync()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        foreach (var id in new[] { PropertyA, PropertyB })
        {
            await context.Database.ExecuteSqlAsync(
                $"""
                INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
                VALUES ({id},'Staff CLI Property',{id.ToString()},NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,now(),now())
                """);
        }
    }

    private async Task<StaffAccount> FindAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.StaffAccounts.AsNoTracking().SingleAsync();
    }

    private async Task<List<StaffPropertyMembership>> MembershipsAsync()
    {
        await using var context = factory.CreateDbContext();
        return await context.StaffPropertyMemberships.AsNoTracking().ToListAsync();
    }

    private async Task<(int Staff, int Memberships)> CountsAsync()
    {
        await using var context = factory.CreateDbContext();
        return (await context.StaffAccounts.CountAsync(), await context.StaffPropertyMemberships.CountAsync());
    }

    private async Task<bool> CheckPasswordAsync(string password)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
        return await users.CheckPasswordAsync((await users.FindByEmailAsync(Email))!, password);
    }
}
