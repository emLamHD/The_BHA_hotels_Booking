using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using TheBha.Infrastructure.Identity;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP01: the Staff Identity store and memberships, on real PostgreSQL.
/// There is no Staff endpoint yet; these tests use the registered UserManager directly.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StaffIdentityPersistenceTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly string Password = $"A!a1{Guid.NewGuid():N}";
    private static readonly Guid PropertyId = Guid.Parse("90000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task Staff_is_created_with_a_checked_password_and_the_customer_policy()
    {
        await factory.ResetDatabaseAsync();
        using var scope = factory.Services.CreateScope();
        var staff = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();

        var account = await CreateStaffAsync(staff, "Desk@Example.com");

        Assert.True(account.IsActive);
        Assert.True(account.LockoutEnabled);
        Assert.True(await staff.CheckPasswordAsync(account, Password));
        Assert.False(await staff.CheckPasswordAsync(account, Password + "x"));
        var weak = await staff.CreateAsync(NewStaff("weak@example.com"), "short");
        Assert.Contains(weak.Errors, error => error.Code == "PasswordTooShort");
        Assert.Equal(account.Id, (await staff.FindByEmailAsync("DESK@example.COM"))!.Id);
    }

    [Fact]
    public async Task Normalized_staff_email_is_unique_in_identity_and_in_postgresql()
    {
        await factory.ResetDatabaseAsync();
        using var scope = factory.Services.CreateScope();
        var staff = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
        await CreateStaffAsync(staff, "Desk@Example.com");

        var duplicate = NewStaff("desk@EXAMPLE.com");
        duplicate.UserName = "another-user-name";
        var result = await staff.CreateAsync(duplicate, Password);
        Assert.Contains(result.Errors, error => error.Code == "DuplicateEmail");

        var error = await ExecuteAsync(
            $"""
            INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
            VALUES ('{Guid.NewGuid()}',true,now(),'x','X','x','DESK@EXAMPLE.COM',false,false,false,true,0)
            """);
        Assert.Equal(("23505", "UX_StaffAccounts_NormalizedEmail"), error);
    }

    [Fact]
    public async Task The_same_email_as_customer_and_staff_are_independent_principals()
    {
        await factory.ResetDatabaseAsync();
        using var scope = factory.Services.CreateScope();
        var staff = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
        var customers = scope.ServiceProvider.GetRequiredService<UserManager<CustomerAccount>>();
        var customer = new CustomerAccount { Email = "same@example.com", UserName = "same@example.com" };
        Assert.True((await customers.CreateAsync(customer, Password + "C")).Succeeded);

        var account = await CreateStaffAsync(staff, "same@example.com");

        Assert.NotEqual(customer.Id, account.Id);
        Assert.Equal(account.Id, (await staff.FindByEmailAsync("same@example.com"))!.Id);
        Assert.Equal(customer.Id, (await customers.FindByEmailAsync("same@example.com"))!.Id);
        Assert.False(await staff.CheckPasswordAsync(account, Password + "C"));
        Assert.False(await customers.CheckPasswordAsync(customer, Password));
        // AspNetUserClaims is keyed to customers: a Staff claim must fail closed.
        await Assert.ThrowsAsync<DbUpdateException>(() => staff.AddClaimAsync(account, new Claim("probe", "probe")));
    }

    [Fact]
    public async Task Staff_lockout_and_security_stamp_follow_identity()
    {
        await factory.ResetDatabaseAsync();
        using var scope = factory.Services.CreateScope();
        var staff = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
        var account = await CreateStaffAsync(staff, "lock@example.com");
        var stamp = account.SecurityStamp;

        var before = DateTimeOffset.UtcNow;
        for (var attempt = 0; attempt < 5; attempt++)
        {
            Assert.False(await staff.IsLockedOutAsync(account));
            await staff.AccessFailedAsync(account);
        }

        Assert.True(await staff.IsLockedOutAsync(account));
        Assert.InRange(
            account.LockoutEnd!.Value,
            before.AddMinutes(15),
            DateTimeOffset.UtcNow.AddMinutes(15));

        Assert.True((await staff.ChangePasswordAsync(account, Password, Password + "2")).Succeeded);
        Assert.NotEqual(stamp, account.SecurityStamp);
        Assert.NotEqual(stamp, (await staff.FindByIdAsync(account.Id.ToString()))!.SecurityStamp);
    }

    [Fact]
    public async Task Memberships_enforce_key_role_and_restricting_foreign_keys()
    {
        await factory.ResetDatabaseAsync();
        using var scope = factory.Services.CreateScope();
        var staff = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
        var staffId = (await CreateStaffAsync(staff, "member@example.com")).Id;
        Assert.Null(await ExecuteAsync(
            $"""
            INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
            VALUES ('{PropertyId}','Staff Property','staff-property',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,now(),now())
            """));
        string Insert(Guid staffAccountId, Guid propertyId, string role) =>
            $"""
            INSERT INTO "StaffPropertyMemberships" ("StaffAccountId","PropertyId","Role","CreatedAtUtc")
            VALUES ('{staffAccountId}','{propertyId}','{role}',now())
            """;

        Assert.Null(await ExecuteAsync(Insert(staffId, PropertyId, StaffRole.FrontDesk)));
        Assert.Equal(("23505", "PK_StaffPropertyMemberships"), await ExecuteAsync(Insert(staffId, PropertyId, StaffRole.Manager)));
        Assert.Equal(("23514", "CK_StaffPropertyMemberships_Role"), await ExecuteAsync(Insert(staffId, PropertyId, "Owner")));
        Assert.Equal(
            ("23503", "FK_StaffPropertyMemberships_Properties_PropertyId"),
            await ExecuteAsync(Insert(staffId, Guid.NewGuid(), StaffRole.Manager)));
        Assert.Equal(
            ("23503", "FK_StaffPropertyMemberships_Properties_PropertyId"),
            await ExecuteAsync($"DELETE FROM \"Properties\" WHERE \"Id\" = '{PropertyId}'"));
        Assert.Equal(
            ("23503", "FK_StaffPropertyMemberships_StaffAccounts_StaffAccountId"),
            await ExecuteAsync($"DELETE FROM \"StaffAccounts\" WHERE \"Id\" = '{staffId}'"));
        Assert.Equal(
            ("23514", "CK_StaffAccounts_DisabledAtUtc"),
            await ExecuteAsync($"UPDATE \"StaffAccounts\" SET \"IsActive\" = false WHERE \"Id\" = '{staffId}'"));
    }

    [Fact]
    public void Customer_identity_registration_is_unchanged()
    {
        using var scope = factory.Services.CreateScope();
        var services = scope.ServiceProvider;
        var options = services.GetRequiredService<IOptions<IdentityOptions>>().Value;
        var schemes = services.GetRequiredService<IOptions<AuthenticationOptions>>().Value;

        Assert.Equal((12, 5, TimeSpan.FromMinutes(15), true), (
            options.Password.RequiredLength,
            options.Lockout.MaxFailedAccessAttempts,
            options.Lockout.DefaultLockoutTimeSpan,
            options.User.RequireUniqueEmail));
        Assert.Empty(options.Tokens.ProviderMap);
        Assert.Equal(IdentityConstants.ApplicationScheme, schemes.DefaultAuthenticateScheme);
        Assert.Equal(IdentityConstants.ApplicationScheme, schemes.DefaultSignInScheme);
        Assert.NotNull(services.GetRequiredService<SignInManager<CustomerAccount>>());
        Assert.Null(services.GetService<SignInManager<StaffAccount>>());
    }

    private static StaffAccount NewStaff(string email) =>
        new() { Email = email, UserName = email, CreatedAtUtc = DateTimeOffset.UtcNow };

    private static async Task<StaffAccount> CreateStaffAsync(UserManager<StaffAccount> staff, string email)
    {
        var account = NewStaff(email);
        var result = await staff.CreateAsync(account, Password);
        Assert.True(result.Succeeded, string.Join(", ", result.Errors.Select(error => error.Code)));
        return account;
    }

    private async Task<(string SqlState, string? Constraint)?> ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        try
        {
            await command.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException exception)
        {
            return (exception.SqlState, exception.ConstraintName);
        }
    }
}
