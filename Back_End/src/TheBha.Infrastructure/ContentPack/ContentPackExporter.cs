using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>
/// BHA-CONTENT-PERSIST-001: writes a content pack from the database the website is served from. It only reads: the source is never
/// changed. The pack is deterministic (rows sorted by key, keys in jsonb order), so exporting an unchanged source twice gives identical files.
/// </summary>
public static class ContentPackExporter
{
    public static async Task<ContentPackReport> ExportAsync(string connectionString, ContentPackExportOptions options, CancellationToken ct)
    {
        var report = new ContentPackReport();
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(ct);
        var actual = await ContentPackCatalog.CurrentDatabaseAsync(connection, ct);
        report.Lines.Add($"export: source database {actual}");
        if (!string.Equals(actual, options.ExpectedDatabase, StringComparison.Ordinal))
        {
            report.TargetRefused = true;
            report.Problems.Add($"REFUSED: --expected-database is '{options.ExpectedDatabase}' but the connection is '{actual}'.");
            return report;
        }

        // Every table is either in the pack or has a stated reason not to be: a table nobody classified fails the export.
        var known = ContentPackSpec.Included.Select(t => t.Table).Concat(ContentPackSpec.Excluded.Keys).Concat(ContentPackSpec.Transactional).Concat(ContentPackSpec.MigrationSeeded).ToHashSet(StringComparer.Ordinal);
        var unclassified = (await ContentPackCatalog.PublicTablesAsync(connection, ct)).Where(t => !known.Contains(t)).ToList();
        if (unclassified.Count > 0)
        {
            report.Problems.Add("unclassified tables (add each to ContentPackSpec as included, excluded with a reason, transactional or migration-seeded): " + string.Join(", ", unclassified));
            return report;
        }

        var properties = new List<ContentPackProperty>();
        await using (var command = new NpgsqlCommand("SELECT \"Id\", \"Slug\" FROM \"Properties\" WHERE \"Slug\" = ANY(@s) ORDER BY \"Slug\"", connection))
        {
            command.Parameters.AddWithValue("s", options.PropertySlugs.ToArray());
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) properties.Add(new ContentPackProperty(reader.GetString(1), reader.GetGuid(0)));
        }
        var missing = options.PropertySlugs.Except(properties.Select(p => p.Slug), StringComparer.Ordinal).ToList();
        if (missing.Count > 0)
        {
            report.Problems.Add("no such property slug in the source: " + string.Join(", ", missing));
            return report;
        }

        var pids = properties.Select(p => p.Id).ToArray();
        var staff = await ContentPackCatalog.StaffColumnsAsync(connection, ct);
        var rowsDir = Path.Combine(options.Out, "rows");
        var filesDir = Path.Combine(options.Out, "files");
        if (Directory.Exists(options.Out) && Directory.EnumerateFileSystemEntries(options.Out).Any())
        {
            report.Problems.Add($"--out '{options.Out}' is not empty; export to a new directory.");
            return report;
        }
        Directory.CreateDirectory(rowsDir);

        var tables = new List<ContentPackTable>();
        var files = new List<ContentPackFile>();
        var external = new SortedSet<string>(StringComparer.Ordinal);
        var blogMedia = new List<(string Key, string Sha)>();
        var promoKeys = new List<string>();

        foreach (var (table, where) in ContentPackSpec.Included)
        {
            var key = await ContentPackCatalog.PrimaryKeyAsync(connection, table, ct);
            var order = string.Join(", ", key.Select(c => "t." + ContentPackSpec.Quote(c)));
            var rows = new List<string>();
            await using (var command = new NpgsqlCommand($"SELECT to_jsonb(t)::text FROM {ContentPackSpec.Quote(table)} t WHERE {where} ORDER BY {order}", connection))
            {
                command.Parameters.AddWithValue("pids", pids);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var row = JsonNode.Parse(reader.GetString(0))!.AsObject();
                    if (staff.TryGetValue(table, out var actors))
                        foreach (var column in actors.Keys) row[column] = row[column] is null ? null : ContentPackSpec.ActorToken;
                    if (table == "BlogMedia")
                    {
                        // The importer gives the picture its variants through the pipeline (generation 0 = "needs them").
                        row["Generation"] = 0;
                        blogMedia.Add((row["StorageKey"]!.GetValue<string>(), row["OriginalSha256"]!.GetValue<string>()));
                    }
                    if (table == "PromotionMedia") promoKeys.Add(row["StorageKey"]!.GetValue<string>());
                    if (table == "Media" && row["Url"]?.GetValue<string>() is { } url)
                    {
                        if (options.SourceMediaOrigin is { Length: > 0 } origin && url.StartsWith(origin + "/", StringComparison.Ordinal)) url = ContentPackSpec.OriginToken + url[origin.Length..];
                        row["Url"] = url;
                        if (url.StartsWith(ContentPackSpec.OriginToken, StringComparison.Ordinal)) external.Add(url[ContentPackSpec.OriginToken.Length..]);
                    }
                    foreach (var text in ContentPackCatalog.Strings(row))
                        if (text.Contains("localhost", StringComparison.OrdinalIgnoreCase) || text.Contains("127.0.0.1", StringComparison.Ordinal))
                            report.Problems.Add($"{table} {ContentPackCatalog.KeyText(row, key)}: contains a local address ('{(text.Length > 80 ? text[..80] : text)}'); pass --source-media-origin or fix the content.");
                    rows.Add(row.ToJsonString(ContentPackSpec.Json));
                }
            }
            var bytes = Encoding.UTF8.GetBytes(rows.Count == 0 ? string.Empty : string.Join("\n", rows) + "\n");
            await File.WriteAllBytesAsync(Path.Combine(rowsDir, table + ".jsonl"), bytes, ct);
            tables.Add(new ContentPackTable(table, rows.Count, ContentPackCatalog.Sha256(bytes)));
            report.Lines.Add($"export: {table,-26} {rows.Count,5} rows");
        }

        // Picture files: Blog originals (their variants are not shipped) and promotion covers.
        foreach (var (key, sha) in blogMedia.OrderBy(m => m.Key, StringComparer.Ordinal))
            await AddFileAsync(key, "blog-original", sha);
        foreach (var key in promoKeys.OrderBy(k => k, StringComparer.Ordinal))
            await AddFileAsync(key, "promo-cover", null);

        async Task AddFileAsync(string key, string kind, string? expectedSha)
        {
            if (options.MediaRoot is null) { report.Problems.Add("WebsiteMedia:RootPath is not set: the picture files cannot be read."); return; }
            var path = ContentPackCatalog.ResolveKey(options.MediaRoot, key);
            if (path is null || !File.Exists(path)) { report.Problems.Add($"{key}: the picture file is missing from {options.MediaRoot}."); return; }
            var bytes = await File.ReadAllBytesAsync(path, ct);
            var sha = ContentPackCatalog.Sha256(bytes);
            if (expectedSha is not null && !string.Equals(sha, expectedSha, StringComparison.OrdinalIgnoreCase)) { report.Problems.Add($"{key}: the file does not match the database's recorded sha256."); return; }
            var target = Path.Combine(filesDir, key);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await File.WriteAllBytesAsync(target, bytes, ct);
            files.Add(new ContentPackFile(key, kind, bytes.LongLength, sha));
        }

        if (options.PublicDir is not null)
            foreach (var path in external)
                if (!File.Exists(Path.Combine(options.PublicDir, path.TrimStart('/')))) report.Problems.Add($"{path}: the static picture the catalog points at is not in --public-dir.");

        var active = new List<string>();
        await using (var command = new NpgsqlCommand("SELECT \"NormalizedCode\" FROM \"WebsiteLanguages\" WHERE \"IsActive\" ORDER BY \"SortOrder\", \"NormalizedCode\"", connection))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) active.Add(reader.GetString(0));

        var excluded = new List<ContentPackNote>();
        foreach (var (name, reason) in ContentPackSpec.Excluded.OrderBy(e => e.Key, StringComparer.Ordinal)) excluded.Add(new ContentPackNote(name, await ContentPackCatalog.CountAsync(connection, name, ct), reason));
        var notExported = new List<ContentPackNote>();
        foreach (var name in ContentPackSpec.Transactional.Order(StringComparer.Ordinal)) notExported.Add(new ContentPackNote(name, await ContentPackCatalog.CountAsync(connection, name, ct), "booking or operation data, never content"));
        foreach (var name in ContentPackSpec.MigrationSeeded.Order(StringComparer.Ordinal))
        {
            // Website configuration is not carried (every migrated database has it); say so when the source has edits a pack would not bring.
            var edited = await ContentPackCatalog.EditedConfigurationAsync(connection, name, ct);
            var reason = "seeded by migrations on every database; only the active languages travel" + (edited > 0 ? $"; {edited} row(s) were edited in the source and are NOT carried" : string.Empty);
            if (edited > 0) report.Lines.Add($"export: WARNING {name}: {edited} row(s) differ from the migration defaults and are not part of the pack");
            notExported.Add(new ContentPackNote(name, await ContentPackCatalog.CountAsync(connection, name, ct), reason));
        }
        var others = new List<string>();
        await using (var command = new NpgsqlCommand("SELECT \"Slug\" FROM \"Properties\" WHERE NOT (\"Id\" = ANY(@pids)) ORDER BY 1", connection))
        {
            command.Parameters.AddWithValue("pids", pids);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) others.Add(reader.GetString(0));
        }
        foreach (var slug in others) excluded.Add(new ContentPackNote("property:" + slug, 1, "not named with --property-slug (an Owner decision: its catalog rows are not in the pack)"));

        var manifest = new ContentPackManifest(ContentPackSpec.FormatVersion, properties, tables, files.OrderBy(f => f.Key, StringComparer.Ordinal).ToList(), external.ToList(), active, excluded, notExported);
        await File.WriteAllTextAsync(Path.Combine(options.Out, "manifest.json"), JsonSerializer.Serialize(manifest, new JsonSerializerOptions(ContentPackSpec.Json) { WriteIndented = true }) + "\n", ct);
        report.Lines.Add($"export: {tables.Sum(t => t.Rows)} rows in {tables.Count} tables, {files.Count} picture files ({files.Sum(f => f.Bytes):N0} bytes), {external.Count} static pictures, active languages: {string.Join(",", active)}");
        return report;
    }
}
