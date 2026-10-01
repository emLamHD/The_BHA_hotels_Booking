using System.Net.Mail;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP02: the operator CLI that creates Staff, grants a Property
/// membership, disables Staff and resets a Staff password. There is no HTTP route for
/// any of this. A password is read from <see cref="PasswordVariable"/> or a hidden
/// prompt, never from an argument, and is never written to the output. Every verb runs
/// in one database transaction, so a failure leaves nothing half-done.
/// </summary>
public static class StaffBootstrapCommand
{
    public const string PasswordVariable = "BHA_STAFF_PASSWORD";

    private const int Success = 0;
    private const int Failure = 1;
    private const int UsageError = 2;

    private static readonly Dictionary<string, string[]> Verbs = new(StringComparer.Ordinal)
    {
        ["--staff-create"] = ["--email", "--property-id", "--role"],
        ["--staff-grant"] = ["--email", "--property-id", "--role"],
        ["--staff-disable"] = ["--email"],
        ["--staff-reset-password"] = ["--email"],
    };

    public static bool IsStaffCommand(string[] args) => args.Any(IsStaffArgument);

    public static async Task<int> RunAsync(
        string[] args,
        IServiceProvider services,
        TextWriter output,
        Func<string?> readPassword,
        CancellationToken cancellationToken)
    {
        var (verb, options, error) = Parse(args);
        if (error is not null)
        {
            output.WriteLine($"staff: {error}");
            return UsageError;
        }

        await using var scope = services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<StaffAccount>>();
        var now = scope.ServiceProvider.GetRequiredService<TimeProvider>().GetUtcNow();
        var target = new NpgsqlConnectionStringBuilder(context.Database.GetConnectionString());
        output.WriteLine($"staff: target database {target.Host}/{target.Database}");

        string? password = null;
        if (verb is "--staff-create" or "--staff-reset-password")
        {
            password = readPassword();
            if (string.IsNullOrEmpty(password))
            {
                output.WriteLine($"staff: a password is required in {PasswordVariable} or at the hidden prompt.");
                return UsageError;
            }
        }

        try
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var (succeeded, message) = verb switch
            {
                "--staff-create" => await CreateAsync(context, users, options, password!, now),
                "--staff-grant" => await GrantAsync(context, users, options, now),
                "--staff-disable" => await DisableAsync(users, options, now),
                _ => await ResetPasswordAsync(users, options, password!),
            };
            if (succeeded)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            output.WriteLine($"staff: {message}");
            return succeeded ? Success : Failure;
        }
        catch (Exception exception) when (exception is DbUpdateException or NpgsqlException or InvalidOperationException)
        {
            // Database messages can quote row values; report the kind of failure only.
            output.WriteLine($"staff: {verb} failed ({exception.GetType().Name}); nothing was changed.");
            return Failure;
        }
    }

    /// <summary>Reads the password from the environment, else from a hidden console prompt.</summary>
    public static string? ReadPassword()
    {
        var fromEnvironment = Environment.GetEnvironmentVariable(PasswordVariable);
        if (!string.IsNullOrEmpty(fromEnvironment) || Console.IsInputRedirected)
        {
            // Redirected input is never read as a password: it is not a protected channel.
            return fromEnvironment;
        }

        Console.Write("Staff password: ");
        var password = new StringBuilder();
        for (var key = Console.ReadKey(intercept: true); key.Key != ConsoleKey.Enter; key = Console.ReadKey(intercept: true))
        {
            if (key.Key == ConsoleKey.Backspace)
            {
                password.Length = Math.Max(0, password.Length - 1);
            }
            else if (!char.IsControl(key.KeyChar))
            {
                password.Append(key.KeyChar);
            }
        }

        Console.WriteLine();
        return password.ToString();
    }

    private static async Task<(bool, string)> CreateAsync(
        TheBhaDbContext context,
        UserManager<StaffAccount> users,
        IReadOnlyDictionary<string, string> options,
        string password,
        DateTimeOffset now)
    {
        if (await users.FindByEmailAsync(options["--email"]) is not null)
        {
            return (false, "a Staff account with this email already exists; nothing was changed.");
        }

        var propertyId = Guid.Parse(options["--property-id"]);
        if (!await context.Properties.AnyAsync(property => property.Id == propertyId))
        {
            return (false, "the Property does not exist; nothing was changed.");
        }

        var account = new StaffAccount
        {
            Email = options["--email"],
            UserName = options["--email"],
            CreatedAtUtc = now,
        };
        var created = await users.CreateAsync(account, password);
        if (!created.Succeeded)
        {
            return (false, $"rejected by Identity ({Codes(created)}); nothing was changed.");
        }

        context.StaffPropertyMemberships.Add(NewMembership(account.Id, propertyId, options["--role"], now));
        await context.SaveChangesAsync();
        return (true, $"created Staff {account.Id} with {options["--role"]} membership.");
    }

    private static async Task<(bool, string)> GrantAsync(
        TheBhaDbContext context,
        UserManager<StaffAccount> users,
        IReadOnlyDictionary<string, string> options,
        DateTimeOffset now)
    {
        var account = await users.FindByEmailAsync(options["--email"]);
        var propertyId = Guid.Parse(options["--property-id"]);
        if (account is null || !await context.Properties.AnyAsync(property => property.Id == propertyId))
        {
            return (false, "the Staff account or the Property does not exist; nothing was changed.");
        }

        var role = options["--role"];
        var membership = await context.StaffPropertyMemberships.SingleOrDefaultAsync(
            existing => existing.StaffAccountId == account.Id && existing.PropertyId == propertyId);
        string outcome;
        if (membership is null)
        {
            context.StaffPropertyMemberships.Add(NewMembership(account.Id, propertyId, role, now));
            outcome = "granted";
        }
        else if (membership.Role == role)
        {
            return (true, $"Staff {account.Id} already has {role}; unchanged.");
        }
        else
        {
            membership.Role = role;
            outcome = "changed to";
        }

        await context.SaveChangesAsync();
        return (true, $"Staff {account.Id} membership {outcome} {role}.");
    }

    private static async Task<(bool, string)> DisableAsync(
        UserManager<StaffAccount> users,
        IReadOnlyDictionary<string, string> options,
        DateTimeOffset now)
    {
        var account = await users.FindByEmailAsync(options["--email"]);
        if (account is null)
        {
            return (false, "the Staff account does not exist; nothing was changed.");
        }

        if (!account.IsActive)
        {
            return (true, $"Staff {account.Id} is already disabled; unchanged.");
        }

        account.IsActive = false;
        account.DisabledAtUtc = now;
        // Saves the disable and rotates the security stamp in one update.
        var updated = await users.UpdateSecurityStampAsync(account);
        return updated.Succeeded
            ? (true, $"disabled Staff {account.Id}.")
            : (false, $"rejected by Identity ({Codes(updated)}); nothing was changed.");
    }

    private static async Task<(bool, string)> ResetPasswordAsync(
        UserManager<StaffAccount> users,
        IReadOnlyDictionary<string, string> options,
        string password)
    {
        var account = await users.FindByEmailAsync(options["--email"]);
        if (account is null)
        {
            return (false, "the Staff account does not exist; nothing was changed.");
        }

        // No token providers are registered for Staff, so the reset is remove + add inside
        // the caller's transaction: a rejected password rolls back and the old one still works.
        // Lockout and the disabled state are deliberately left as they are.
        var removed = await users.RemovePasswordAsync(account);
        var added = removed.Succeeded ? await users.AddPasswordAsync(account, password) : removed;
        return added.Succeeded
            ? (true, $"reset the password of Staff {account.Id}.")
            : (false, $"rejected by Identity ({Codes(added)}); nothing was changed.");
    }

    private static (string Verb, Dictionary<string, string> Options, string? Error) Parse(string[] args)
    {
        var verbs = args.Where(IsStaffArgument).ToArray();
        if (verbs.Length != 1 || !Verbs.TryGetValue(verbs[0], out var allowed))
        {
            return ("", [], $"exactly one of {string.Join(", ", Verbs.Keys)} is required.");
        }

        var options = new Dictionary<string, string>(StringComparer.Ordinal);
        var rest = args.Where(arg => !IsStaffArgument(arg)).ToArray();
        for (var index = 0; index < rest.Length; index += 2)
        {
            var name = rest[index];
            if (!allowed.Contains(name, StringComparer.Ordinal))
            {
                return ("", [], $"{verbs[0]} accepts only {string.Join(", ", allowed)}; an unexpected argument was given.");
            }

            if (index + 1 >= rest.Length || rest[index + 1].StartsWith("--", StringComparison.Ordinal) || !options.TryAdd(name, rest[index + 1]))
            {
                return ("", [], $"{name} needs exactly one value.");
            }
        }

        var missing = allowed.FirstOrDefault(name => !options.ContainsKey(name));
        if (missing is not null)
        {
            return ("", [], $"{missing} is required.");
        }

        if (!MailAddress.TryCreate(options["--email"], out _))
        {
            return ("", [], "--email is not a valid email address.");
        }

        if (options.TryGetValue("--property-id", out var propertyId) && !Guid.TryParse(propertyId, out _))
        {
            return ("", [], "--property-id is not a GUID.");
        }

        if (options.TryGetValue("--role", out var role) && role is not (StaffRole.FrontDesk or StaffRole.Manager))
        {
            return ("", [], $"--role must be {StaffRole.FrontDesk} or {StaffRole.Manager}.");
        }

        return (verbs[0], options, null);
    }

    private static bool IsStaffArgument(string arg) => arg.StartsWith("--staff-", StringComparison.Ordinal);

    private static StaffPropertyMembership NewMembership(Guid staffId, Guid propertyId, string role, DateTimeOffset now) => new()
    {
        StaffAccountId = staffId,
        PropertyId = propertyId,
        Role = role,
        CreatedAtUtc = now,
    };

    private static string Codes(IdentityResult result) =>
        string.Join(", ", result.Errors.Select(error => error.Code));
}
