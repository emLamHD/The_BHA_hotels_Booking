using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>
/// BHA-CONTENT-PERSIST-001: writes a content pack from the database the website is served from. It only reads: the source is never
/// changed. Every query runs in one read-only REPEATABLE READ transaction, so the rows of a pack are one snapshot of the database whatever
/// the staff do while it runs (a post created halfway can not leave a translation without its post). The picture files are read after the
/// snapshot and must match what the snapshot recorded (size and, where the database keeps one, sha256); a file that changed meanwhile fails
/// the export instead of producing a pack that looks valid and can not be imported. The pack is deterministic (rows sorted by key, keys in
/// jsonb order), so exporting an unchanged source twice gives identical files.
/// </summary>
public static class ContentPackExporter
{
    public static async Task<ContentPackReport> ExportAsync(string connectionString, ContentPackExportOptions options, CancellationToken ct)
    {
        var report = new ContentPackReport();
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(ct);
        await using var snapshot = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        await using (var readOnly = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, snapshot)) await readOnly.ExecuteNonQueryAsync(ct);

        var actual = await ContentPackCatalog.CurrentDatabaseAsync(connection, ct);
        report.Lines.Add($"export: source database {actual}");
        if (!string.Equals(actual, options.ExpectedDatabase, StringComparison.Ordinal))
        {
            report.TargetRefused = true;
            report.Problems.Add($"REFUSED: --expected-database is '{options.ExpectedDatabase}' but the connection is '{actual}'.");
            return report;
        }

        // Every table is either in the pack or has a stated reason not to be: a table nobody classified fails the export.
        var known = ContentPackSpec.Included.Select(t => t.Table).Concat(ContentPackSpec.Excluded.Keys).Concat(ContentPackSpec.Transactional).ToHashSet(StringComparer.Ordinal);
        var unclassified = (await ContentPackCatalog.PublicTablesAsync(connection, ct)).Where(t => !known.Contains(t)).ToList();
        if (unclassified.Count > 0)
        {
            report.Problems.Add("unclassified tables (add each to ContentPackSpec as included, excluded with a reason or transactional): " + string.Join(", ", unclassified));
            return report;
        }

        var all = new List<ContentPackProperty>();
        await using (var command = new NpgsqlCommand("SELECT \"Id\", \"Slug\" FROM \"Properties\" ORDER BY \"Slug\"", connection, snapshot))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) all.Add(new ContentPackProperty(reader.GetString(1), reader.GetGuid(0)));
        var missing = options.PropertySlugs.Except(all.Select(p => p.Slug), StringComparer.Ordinal).ToList();
        if (missing.Count > 0)
        {
            report.Problems.Add("no such property slug in the source: " + string.Join(", ", missing));
            return report;
        }

        // No slug named = every property of the source.
        var properties = options.PropertySlugs.Count == 0 ? all : all.Where(p => options.PropertySlugs.Contains(p.Slug, StringComparer.Ordinal)).ToList();
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
        // What the snapshot says each picture file is: (key, kind, size, sha256 or null).
        var recorded = new List<(string Key, string Kind, long Bytes, string? Sha)>();
        // Blog revisions (every revision, not only the published ones) whose "propertyIntro" blocks name a property this export does not carry: property → revision ids.
        var outside = new Dictionary<Guid, List<string>>();

        foreach (var (table, where) in ContentPackSpec.Included)
        {
            var key = await ContentPackCatalog.PrimaryKeyAsync(connection, table, ct);
            var order = string.Join(", ", key.Select(c => "t." + ContentPackSpec.Quote(c)));
            var rows = new List<string>();
            await using (var command = new NpgsqlCommand($"SELECT to_jsonb(t)::text FROM {ContentPackSpec.Quote(table)} t WHERE {where} ORDER BY {order}", connection, snapshot))
            {
                command.Parameters.AddWithValue("pids", pids);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var row = JsonNode.Parse(reader.GetString(0))!.AsObject();
                    if (staff.TryGetValue(table, out var actors))
                        foreach (var column in actors.Keys) row[column] = row[column] is null ? null : ContentPackSpec.ActorToken;
                    switch (table)
                    {
                        case "BlogMedia":
                            // The importer gives the picture its variants through the pipeline (generation 0 = "needs them").
                            row["Generation"] = 0;
                            // A picture from before the image pipeline has no recorded hash (the column is null); the size is still checked, and the pack carries the file's own sha256.
                            recorded.Add((row["StorageKey"]!.GetValue<string>(), "blog-original", row["ByteSize"]!.GetValue<long>(), row["OriginalSha256"]?.GetValue<string>()));
                            break;
                        case "PromotionMedia":
                            recorded.Add((row["StorageKey"]!.GetValue<string>(), "promo-cover", row["ByteSize"]!.GetValue<long>(), null));
                            break;
                        case "WebsiteHeroMedia" when row["Kind"]?.GetValue<string>() == "upload":
                            recorded.Add((row["StorageKey"]!.GetValue<string>(), "hero-upload", row["ByteSize"]!.GetValue<long>(), null));
                            break;
                        case "Media" when row["Url"]?.GetValue<string>() is { } url:
                            if (options.SourceMediaOrigin is { Length: > 0 } origin && url.StartsWith(origin + "/", StringComparison.Ordinal)) url = ContentPackSpec.OriginToken + url[origin.Length..];
                            row["Url"] = url;
                            if (url.StartsWith(ContentPackSpec.OriginToken, StringComparison.Ordinal)) external.Add(url[ContentPackSpec.OriginToken.Length..]);
                            // A picture the staff uploaded to a catalog gallery is served by this API from its own storage: the pack carries no such file.
                            if (url.Contains("/api/", StringComparison.Ordinal))
                                report.Problems.Add($"Media {row["Id"]}: the address '{url}' is served by the API from catalog storage; the pack does not carry those files.");
                            break;
                    }
                    if (table == "BlogPostRevisions")
                        foreach (var id in ContentPackCatalog.PropertyIntroIds(row.ToJsonString(ContentPackSpec.Json)).Where(id => !pids.Contains(id)))
                            if (!outside.TryAdd(id, [row["Id"]!.GetValue<string>()])) outside[id].Add(row["Id"]!.GetValue<string>());
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
            if (options.AfterTableRead is { } hook) await hook(table, ct);
        }

        foreach (var (property, revisions) in outside)
        {
            var name = all.FirstOrDefault(p => p.Id == property)?.Slug ?? property.ToString();
            report.Problems.Add($"the Blog needs the property '{name}' ({property}), which this export does not carry: {revisions.Count} revisions have a propertyIntro block for it ({string.Join(", ", revisions.Take(5))}{(revisions.Count > 5 ? ", …" : string.Empty)}). " +
                (all.Any(p => p.Id == property) ? "Export every property (leave --property-slug out), or name it too." : "The property does not exist in the source; fix those revisions first."));
        }

        var excluded = new List<ContentPackNote>();
        foreach (var (name, reason) in ContentPackSpec.Excluded.OrderBy(e => e.Key, StringComparer.Ordinal)) excluded.Add(new ContentPackNote(name, await ContentPackCatalog.CountAsync(connection, name, ct), reason));
        var notExported = new List<ContentPackNote>();
        foreach (var name in ContentPackSpec.Transactional.Order(StringComparer.Ordinal)) notExported.Add(new ContentPackNote(name, await ContentPackCatalog.CountAsync(connection, name, ct), "booking or operation data, never content"));
        foreach (var other in all.Where(p => !pids.Contains(p.Id))) excluded.Add(new ContentPackNote("property:" + other.Slug, 1, "not named with --property-slug (an Owner decision: its catalog rows are not in the pack)"));

        // The snapshot is complete; the picture files are read now and must be what it recorded.
        foreach (var (key, kind, bytesRecorded, shaRecorded) in recorded.OrderBy(r => r.Key, StringComparer.Ordinal))
        {
            if (options.MediaRoot is null) { report.Problems.Add("WebsiteMedia:RootPath is not set: the picture files cannot be read."); break; }
            var path = ContentPackCatalog.ResolveKey(options.MediaRoot, key);
            if (path is null || !File.Exists(path)) { report.Problems.Add($"{key}: the picture file is missing from {options.MediaRoot}."); continue; }
            var bytes = await File.ReadAllBytesAsync(path, ct);
            var sha = ContentPackCatalog.Sha256(bytes);
            if (bytes.LongLength != bytesRecorded || (shaRecorded is not null && !string.Equals(sha, shaRecorded, StringComparison.OrdinalIgnoreCase)))
            {
                report.Problems.Add($"{key}: the file does not match what the database recorded for it (size {bytes.LongLength} against {bytesRecorded}{(shaRecorded is null ? string.Empty : ", sha256")}); it changed or is damaged, so no valid pack can be made from this snapshot.");
                continue;
            }
            var target = Path.Combine(filesDir, key);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await File.WriteAllBytesAsync(target, bytes, ct);
            files.Add(new ContentPackFile(key, kind, bytes.LongLength, sha));
        }

        if (options.PublicDir is not null)
            foreach (var path in external)
                if (!File.Exists(Path.Combine(options.PublicDir, path.TrimStart('/')))) report.Problems.Add($"{path}: the static picture the catalog points at is not in --public-dir.");

        if (report.Problems.Count > 0)
        {
            // Nothing is left behind that could be mistaken for a valid pack.
            Directory.Delete(options.Out, recursive: true);
            report.Lines.Add("export: FAILED — no pack was written.");
            return report;
        }

        var manifest = new ContentPackManifest(ContentPackSpec.FormatVersion, properties, tables, files.OrderBy(f => f.Key, StringComparer.Ordinal).ToList(), external.ToList(), excluded, notExported);
        await File.WriteAllTextAsync(Path.Combine(options.Out, "manifest.json"), JsonSerializer.Serialize(manifest, new JsonSerializerOptions(ContentPackSpec.Json) { WriteIndented = true }) + "\n", ct);
        report.Lines.Add($"export: {tables.Sum(t => t.Rows)} rows in {tables.Count} tables, {files.Count} picture files ({files.Sum(f => f.Bytes):N0} bytes), {external.Count} static pictures");
        return report;
    }
}
