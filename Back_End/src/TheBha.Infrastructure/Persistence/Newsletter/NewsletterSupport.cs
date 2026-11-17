using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>Data Protection for the newsletter's secrets. A payload that cannot be read (a lost key ring) answers false, never an exception: the Admin then shows "connect again".</summary>
public sealed class NewsletterSecretProtector(IDataProtectionProvider provider)
{
    private readonly IDataProtector _protector = provider.CreateProtector("TheBha.Newsletter.Sender.v1");

    public string Protect(string plain) => _protector.Protect(plain);

    public bool TryUnprotect(string? protectedValue, out string plain)
    {
        plain = string.Empty;
        if (string.IsNullOrEmpty(protectedValue)) return false;
        try
        {
            plain = _protector.Unprotect(protectedValue);
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }
}

internal static class NewsletterTokens
{
    /// <summary>32 random bytes, base64url without padding (43 characters): not guessable, safe in a URL fragment and a JSON body.</summary>
    public static string NewToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Only the shape a token can have (so a body of any size is not hashed or searched).</summary>
    public static bool LooksLikeToken(string? value) =>
        value is { Length: >= 20 and <= NewsletterRules.MaxTokenLength } && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
}

internal static class NewsletterSql
{
    /// <summary>
    /// Runs one <c>UPDATE … RETURNING</c> inside the context's current transaction and returns the ids it gave back. Done with a
    /// plain command because EF wraps raw queries in a sub-select, which <c>UPDATE … RETURNING</c> cannot be.
    /// </summary>
    public static async Task<List<Guid>> ReturningIdsAsync(TheBhaDbContext database, string sql, IReadOnlyList<(string Name, object? Value)> parameters, CancellationToken ct)
    {
        var connection = database.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;
        if (opened) await connection.OpenAsync(ct);
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Transaction = database.Database.CurrentTransaction?.GetDbTransaction();
            foreach (var (name, value) in parameters)
            {
                var parameter = command.CreateParameter();
                parameter.ParameterName = name;
                parameter.Value = value ?? DBNull.Value;
                command.Parameters.Add(parameter);
            }

            var ids = new List<Guid>();
            await using DbDataReader reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) ids.Add(reader.GetGuid(0));
            return ids;
        }
        finally
        {
            if (opened) await connection.CloseAsync();
        }
    }
}

internal static class NewsletterReadiness
{
    public static bool IsHttpsOrigin(string? origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.AbsolutePath == "/" && string.IsNullOrEmpty(uri.Query);

    /// <summary>The site can send confirmation mail: a connected sender and an https origin to build the link from.</summary>
    public static async Task<bool> CanSendAsync(TheBhaDbContext database, NewsletterOptions options, CancellationToken ct) =>
        IsHttpsOrigin(options.CustomerOrigin) &&
        await database.NewsletterSenderSettings.AsNoTracking().AnyAsync(row => row.Status == NewsletterSenderSettings.StatusConnected, ct);
}
