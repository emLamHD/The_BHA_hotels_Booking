using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Npgsql;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>Database and file helpers shared by the exporter and the importer.</summary>
public static partial class ContentPackCatalog
{
    /// <summary>The shapes of picture key a pack carries (the same shapes the application itself generates).</summary>
    [GeneratedRegex("^(blog|promo|hero)/[0-9a-f]{32}\\.(jpg|png|webp)$")]
    public static partial Regex FileKey();

    [GeneratedRegex("\"propertyId\"\\s*:\\s*\"([0-9a-fA-F-]{36})\"")]
    private static partial Regex PropertyIntroId();

    /// <summary>The property ids named by the "propertyIntro" blocks of a Blog revision's JSON.</summary>
    public static IEnumerable<Guid> PropertyIntroIds(string revisionJson) => PropertyIntroId().Matches(revisionJson).Select(m => Guid.Parse(m.Groups[1].Value)).Distinct();

    public static string Sha256(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    /// <summary>The picture's path under <paramref name="root"/>; null when the key is not one of the two shapes or would leave the root.</summary>
    public static string? ResolveKey(string root, string key)
    {
        if (!FileKey().IsMatch(key)) return null;
        // The root may or may not end with a separator; the containment test must not care, and "/var/media2" is not inside "/var/media".
        var rootFull = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var full = Path.GetFullPath(Path.Combine(rootFull, key));
        return full.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.Ordinal) ? full : null;
    }

    public static async Task<string> CurrentDatabaseAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("SELECT current_database()", connection);
        return (string)(await command.ExecuteScalarAsync(ct))!;
    }

    public static async Task<IReadOnlyList<string>> PublicTablesAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        var result = new List<string>();
        await using var command = new NpgsqlCommand("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1", connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(reader.GetString(0));
        return result;
    }

    /// <summary>The rows of a table; 0 for a table this database does not have (a source that predates the import ledger, say).</summary>
    public static async Task<int> CountAsync(NpgsqlConnection connection, string table, CancellationToken ct)
    {
        await using (var exists = new NpgsqlCommand("SELECT to_regclass(@t) IS NOT NULL", connection))
        {
            exists.Parameters.AddWithValue("t", "public." + ContentPackSpec.Quote(table));
            if (!(bool)(await exists.ExecuteScalarAsync(ct))!) return 0;
        }
        await using var command = new NpgsqlCommand($"SELECT count(*) FROM {ContentPackSpec.Quote(table)}", connection);
        return (int)(long)(await command.ExecuteScalarAsync(ct))!;
    }

    public static async Task<IReadOnlyList<string>> PrimaryKeyAsync(NpgsqlConnection connection, string table, CancellationToken ct)
    {
        var result = new List<string>();
        await using var command = new NpgsqlCommand(
            "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indisprimary AND i.indrelid = @t::regclass ORDER BY array_position(i.indkey::int2[], a.attnum)", connection);
        command.Parameters.AddWithValue("t", ContentPackSpec.Quote(table));
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(reader.GetString(0));
        return result;
    }

    /// <summary>Columns that refer to a Staff account, by table; the value says whether the column is NOT NULL.</summary>
    public static async Task<Dictionary<string, Dictionary<string, bool>>> StaffColumnsAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        var result = new Dictionary<string, Dictionary<string, bool>>(StringComparer.Ordinal);
        await using var command = new NpgsqlCommand(
            "SELECT c.relname, a.attname, a.attnotnull FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND k.confrelid = '\"StaffAccounts\"'::regclass", connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            if (!result.TryGetValue(reader.GetString(0), out var columns)) result[reader.GetString(0)] = columns = new Dictionary<string, bool>(StringComparer.Ordinal);
            columns[reader.GetString(1)] = reader.GetBoolean(2);
        }
        return result;
    }

    public static string KeyText(JsonObject row, IReadOnlyList<string> key) => string.Join("/", key.Select(column => row[column]?.ToString() ?? "null"));

    /// <summary>Every string in the row, nested ones included.</summary>
    public static IEnumerable<string> Strings(JsonNode? node)
    {
        switch (node)
        {
            case JsonValue value when value.TryGetValue<string>(out var text): yield return text; break;
            case JsonObject obj: foreach (var item in obj) foreach (var s in Strings(item.Value)) yield return s; break;
            case JsonArray array: foreach (var item in array) foreach (var s in Strings(item)) yield return s; break;
        }
    }

    /// <summary>Writes <paramref name="bytes"/> to <paramref name="path"/> through a temporary name in the same directory, flushed, then renamed: a reader never sees half a picture.</summary>
    public static async Task WriteAtomicAsync(string path, byte[] bytes, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                await file.WriteAsync(bytes, ct);
                await file.FlushAsync(ct);
            }
            File.Move(temporary, path, overwrite: false);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
