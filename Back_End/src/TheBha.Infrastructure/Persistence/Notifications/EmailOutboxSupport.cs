using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace TheBha.Infrastructure.Persistence.Notifications;

/// <summary>
/// Data Protection for the outbox's recipients and rendered messages, under its OWN purpose (the newsletter's secrets are a different key chain). A value that cannot be read (a lost key ring) answers false, never an
/// exception, and the delivery then waits. Several processes can send only if they share ONE key ring (<c>DataProtection:KeysPath</c> or the host's shared store): a process with another ring reads nothing.
/// </summary>
public sealed class EmailOutboxProtector(IDataProtectionProvider provider)
{
    private readonly IDataProtector _protector = provider.CreateProtector("TheBha.EmailOutbox.Pii.v1");

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
        catch (Exception exception) when (exception is CryptographicException or IOException or UnauthorizedAccessException)
        {
            // A key ring that cannot be read (lost, replaced, unreachable) is "cannot read", not a crash: the delivery waits.
            return false;
        }
    }
}

internal static class EmailOutboxSql
{
    /// <summary>A delivery's id is a hash of (event, purpose, recipient key): the same fan-out always names the same delivery, so the provider idempotency key derived from it is stable.</summary>
    public static Guid DeliveryId(Guid eventId, string purpose, string recipientKey) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes($"bha-email-delivery|{eventId:N}|{purpose}|{recipientKey}"))[..16]);

    public static string IdempotencyKey(Guid deliveryId) => "bha-email-" + deliveryId.ToString("N");

    /// <summary>
    /// Runs one statement that returns rows (<c>UPDATE … RETURNING</c> or <c>SELECT … FOR UPDATE</c>) inside the context's current transaction, if there is one. A plain command because EF wraps raw queries in a
    /// sub-select, which <c>UPDATE … RETURNING</c> cannot be.
    /// </summary>
    public static async Task<List<T>> QueryAsync<T>(TheBhaDbContext database, string sql, IReadOnlyList<(string Name, object Value)> parameters, Func<DbDataReader, T> read, CancellationToken ct)
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
                parameter.Value = value;
                command.Parameters.Add(parameter);
            }

            var rows = new List<T>();
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(read(reader));
            return rows;
        }
        finally
        {
            if (opened) await connection.CloseAsync();
        }
    }
}
