using System.Data;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;
using NpgsqlTypes;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>
/// BHA-CONTENT-PERSIST-001: puts a content pack into a database and its media directory without ever replacing what is there.
///
/// <para>A row that already exists (same key) is kept, whatever it holds: the staff's edits survive a rerun. A row the target
/// has under another id but the same slug or code (Property, RoomType, Amenity) is used in place of the pack's and everything
/// that referred to it is re-pointed. Any other collision (a post, category or promotion slug, a room number) is a CONFLICT:
/// every conflict is listed and nothing is written. All rows go in one transaction under an advisory lock; the picture files are
/// copied (temporary name, then rename; an identical file is skipped, a different one is a conflict) just before the commit, so a
/// failure leaves the database as it was and a rerun finishes the job.</para>
///
/// <para><c>DryRun</c> runs exactly the same transaction and rolls it back; <c>Verify</c> does it read-only and reports anything the pack
/// has that the target does not (a finished import verifies clean).</para>
/// </summary>
public static class ContentPackImporter
{
    private static readonly string[] VolatileSuffixes = ["AtUtc", "At"];
    /// <summary>A slug row is keyed by the slug itself: the same slug owned by another post or category is a collision, not an "already there".</summary>
    private static readonly Dictionary<string, string> SlugOwner = new(StringComparer.Ordinal) { ["BlogPostSlugs"] = "TranslationId", ["BlogCategorySlugs"] = "CategoryId" };
    private static readonly HashSet<string> VolatileColumns = new(StringComparer.Ordinal) { "Version", "Generation" };

    public static async Task<ContentPackReport> ImportAsync(string connectionString, ContentPackImportOptions options, string environmentName, CancellationToken ct)
    {
        var report = new ContentPackReport();
        var pack = await LoadAsync(options.Pack, report, ct);
        if (pack is null || report.Problems.Count > 0) return report;
        var groups = (options.Groups ?? ContentPackSpec.Groups).ToHashSet(StringComparer.Ordinal);
        if (groups.Count == 0 || groups.Any(g => !ContentPackSpec.Groups.Contains(g))) { report.Problems.Add("--groups takes any of: " + string.Join(", ", ContentPackSpec.Groups)); return report; }

        if (!Uri.TryCreate(options.MediaBaseUrl, UriKind.Absolute, out var origin) || origin.AbsolutePath != "/" || !string.IsNullOrEmpty(origin.Query) || (origin.Scheme != "https" && !(options.AllowLocalMediaOrigin && origin.Scheme == "http")))
        {
            report.Problems.Add("--media-base-url must be an https origin with no path (for example https://example.com).");
            return report;
        }
        var local = origin.IsLoopback || origin.Host.EndsWith(".localhost", StringComparison.Ordinal);
        if (local && !(options.AllowLocalMediaOrigin && string.Equals(environmentName, "Development", StringComparison.Ordinal)))
        {
            report.Problems.Add("--media-base-url points at this machine; refused outside Development (the pictures would not load for visitors).");
            return report;
        }
        var baseUrl = origin.GetLeftPart(UriPartial.Authority);

        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(ct);
        var actual = await ContentPackCatalog.CurrentDatabaseAsync(connection, ct);
        report.Lines.Add($"content-pack: target database {actual} (environment {environmentName}), mode {options.Mode}");
        if (!string.Equals(actual, options.ExpectedDatabase, StringComparison.Ordinal))
        {
            report.TargetRefused = true;
            report.Problems.Add($"REFUSED: --expected-database is '{options.ExpectedDatabase}' but this process is connected to '{actual}'. Nothing was changed.");
            return report;
        }

        Guid actor = Guid.Empty;
        if (options.Mode != ContentPackMode.Verify && groups.Contains("blog"))
        {
            await using var find = new NpgsqlCommand("SELECT \"Id\", \"IsActive\", \"CanEditBlog\", \"CanPublishBlog\" FROM \"StaffAccounts\" WHERE \"NormalizedEmail\" = upper(@e)", connection);
            find.Parameters.AddWithValue("e", options.ActorEmail ?? string.Empty);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct) || !reader.GetBoolean(1) || !reader.GetBoolean(2) || !reader.GetBoolean(3))
            {
                report.Problems.Add("--actor-email must name an existing, active Staff account with Blog edit and publish access on the target (create one with --staff-create and --staff-blog-access first).");
                return report;
            }
            actor = reader.GetGuid(0);
        }

        // Files first as a plan (reads only): present and identical, missing, or a different file under the same name.
        var toCopy = new List<ContentPackFile>();
        var files = pack.Manifest.Files.Where(f => groups.Contains(f.Kind == "blog-original" ? "blog" : "promotions")).ToList();
        if (files.Count > 0 && options.MediaRoot is null) { report.Problems.Add("WebsiteMedia:RootPath is not set: the pack's picture files have nowhere to go."); return report; }
        foreach (var file in files)
        {
            var path = ContentPackCatalog.ResolveKey(options.MediaRoot!, file.Key)!;
            if (!File.Exists(path)) { toCopy.Add(file); continue; }
            if (ContentPackCatalog.Sha256(await File.ReadAllBytesAsync(path, ct)) == file.Sha256) report.FilesPresent++;
            else report.Conflicts.Add($"file {file.Key}: a different file is already there; it is never overwritten.");
        }
        if (options.Mode == ContentPackMode.Verify) foreach (var file in toCopy) report.Problems.Add($"file {file.Key}: missing from the media directory.");

        await using var tx = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await using (var lockCommand = new NpgsqlCommand("SELECT pg_try_advisory_xact_lock(@k)", connection, tx))
        {
            lockCommand.Parameters.AddWithValue("k", ContentPackSpec.AdvisoryLockKey);
            if (!(bool)(await lockCommand.ExecuteScalarAsync(ct))!) { report.Problems.Add("another content-pack import is running on this database; try again when it has finished."); return report; }
        }

        var staff = await ContentPackCatalog.StaffColumnsAsync(connection, ct);
        var maps = new Dictionary<string, Dictionary<Guid, Guid>>(StringComparer.Ordinal) { ["PropertyId"] = [], ["RoomTypeId"] = [], ["AmenityId"] = [] };
        var pending = new List<(Guid Id, JsonNode? Status, JsonNode? Draft, JsonNode? Published)>();

        foreach (var table in pack.Manifest.Tables.Where(t => groups.Contains(ContentPackSpec.GroupOf(t.Name))))
        {
            var columns = await ColumnsAsync(connection, tx, table.Name, ct);
            var key = await ContentPackCatalog.PrimaryKeyAsync(connection, table.Name, ct);
            var outcome = report.Tables[table.Name] = new TableOutcome();
            foreach (var packRow in pack.Rows[table.Name])
            {
                var text = packRow.ToJsonString(ContentPackSpec.Json);
                if (table.Name == "BlogPostRevisions") foreach (var (from, to) in maps["PropertyId"]) text = text.Replace(from.ToString(), to.ToString(), StringComparison.Ordinal);
                var row = JsonNode.Parse(text)!.AsObject();
                var unknown = row.Select(p => p.Key).Where(c => !columns.Contains(c)).ToList();
                if (unknown.Count > 0) { report.Problems.Add($"{table.Name}: the pack has columns this database does not: {string.Join(", ", unknown)} (export again from the same version)."); break; }

                foreach (var (column, map) in maps)
                    if (row.ContainsKey(column) && row[column] is { } id && Guid.TryParse(id.GetValue<string>(), out var old) && map.TryGetValue(old, out var mapped)) row[column] = mapped.ToString();
                if (staff.TryGetValue(table.Name, out var actors))
                    foreach (var (column, notNull) in actors)
                        if (row.ContainsKey(column) && (row[column] is not null || notNull)) row[column] = actor.ToString();
                if (table.Name == "Media" && row["Url"]?.GetValue<string>() is { } url) row["Url"] = url.Replace(ContentPackSpec.OriginToken, baseUrl, StringComparison.Ordinal);
                if (ContentPackCatalog.Strings(row).Any(s => s.Contains(ContentPackSpec.OriginToken, StringComparison.Ordinal) || s == ContentPackSpec.ActorToken)) { report.Problems.Add($"{table.Name} {ContentPackCatalog.KeyText(row, key)}: a placeholder was left unresolved."); continue; }

                var keyText = ContentPackCatalog.KeyText(row, key);
                var existing = await ReadRowAsync(connection, tx, table.Name, key, row, ct);
                if (existing is not null)
                {
                    if (SlugOwner.TryGetValue(table.Name, out var owner) && !string.Equals(existing[owner]?.ToString(), row[owner]?.ToString(), StringComparison.OrdinalIgnoreCase))
                    {
                        report.Conflicts.Add($"{table.Name} {keyText}: the slug already belongs to another {(owner == "CategoryId" ? "category" : "post")} ({existing[owner]}).");
                        continue;
                    }
                    if (JsonNode.DeepEquals(Project(row, staff, table.Name), Project(existing, staff, table.Name, row))) outcome.Identical++; else { outcome.KeptDifferent++; report.Lines.Add($"  kept (target differs from the pack): {table.Name} {keyText}"); }
                    continue;
                }

                // The same thing under another id is the target's own: use it, and point everything of the pack at it.
                if (await NaturalMatchAsync(connection, tx, table.Name, row, ct) is { } found)
                {
                    maps[table.Name switch { "Properties" => "PropertyId", "RoomTypes" => "RoomTypeId", _ => "AmenityId" }][Guid.Parse(row["Id"]!.GetValue<string>())] = found;
                    outcome.Mapped++;
                    report.Lines.Add($"  mapped to the target's own row: {table.Name} {keyText} -> {found}");
                    continue;
                }

                if (options.Mode == ContentPackMode.Verify) { outcome.Inserted++; report.Problems.Add($"{table.Name} {keyText}: missing from the target."); continue; }
                if (table.Name == "BlogPostTranslations")
                {
                    // A translation and its revisions point at each other: the translation goes in first as a draft with no pointers, and takes them in a second pass.
                    pending.Add((Guid.Parse(row["Id"]!.GetValue<string>()), row["Status"]?.DeepClone(), row["DraftRevisionId"]?.DeepClone(), row["PublishedRevisionId"]?.DeepClone()));
                    row["Status"] = "Draft"; row["DraftRevisionId"] = null; row["PublishedRevisionId"] = null;
                }
                if (await TryInsertAsync(connection, tx, table.Name, row, report, keyText, ct)) outcome.Inserted++;
            }
            if (report.Problems.Count > 0) break;
        }

        if (options.Mode != ContentPackMode.Verify && report.Problems.Count == 0)
        {
            foreach (var (id, status, draft, published) in pending)
            {
                tx.Save("pass2");
                try
                {
                    await using var update = new NpgsqlCommand("UPDATE \"BlogPostTranslations\" SET \"Status\" = @s, \"DraftRevisionId\" = @d, \"PublishedRevisionId\" = @p WHERE \"Id\" = @id", connection, tx);
                    update.Parameters.AddWithValue("s", status!.GetValue<string>());
                    update.Parameters.Add(new NpgsqlParameter("d", NpgsqlDbType.Uuid) { Value = draft is null ? DBNull.Value : Guid.Parse(draft.GetValue<string>()) });
                    update.Parameters.Add(new NpgsqlParameter("p", NpgsqlDbType.Uuid) { Value = published is null ? DBNull.Value : Guid.Parse(published.GetValue<string>()) });
                    update.Parameters.AddWithValue("id", id);
                    await update.ExecuteNonQueryAsync(ct);
                    tx.Release("pass2");
                }
                catch (PostgresException ex) when (ex.SqlState.StartsWith("23", StringComparison.Ordinal))
                {
                    tx.Rollback("pass2");
                    report.Conflicts.Add($"BlogPostTranslations {id}: {ex.SqlState} {ex.ConstraintName ?? ex.MessageText}");
                }
            }

            // The languages the source serves: activated only where the target's row is still its migration default (never over a staff decision).
            foreach (var code in groups.Contains("blog") ? pack.Manifest.ActiveLanguages : [])
            {
                await using var activate = new NpgsqlCommand("UPDATE \"WebsiteLanguages\" SET \"IsActive\" = true, \"Version\" = \"Version\" + 1, \"UpdatedAtUtc\" = now() WHERE \"NormalizedCode\" = @c AND NOT \"IsActive\" AND \"Version\" = 1 AND \"UpdatedByStaffId\" IS NULL", connection, tx);
                activate.Parameters.AddWithValue("c", code);
                if (await activate.ExecuteNonQueryAsync(ct) == 1) { report.Lines.Add($"  language {code}: activated (it was still the migration default)"); continue; }
                await using var state = new NpgsqlCommand("SELECT \"IsActive\" FROM \"WebsiteLanguages\" WHERE \"NormalizedCode\" = @c", connection, tx);
                state.Parameters.AddWithValue("c", code);
                var current = await state.ExecuteScalarAsync(ct);
                if (current is null) report.Problems.Add($"language {code} does not exist on the target: the pack's {code} texts will not show.");
                else if (!(bool)current) report.Lines.Add($"  language {code}: left inactive (a staff member changed it); activate it in Admin to show the {code} texts");
            }
        }
        else if (options.Mode == ContentPackMode.Verify && groups.Contains("blog"))
        {
            await VerifyBlogMediaAsync(connection, tx, pack, report, ct);
        }

        foreach (var (name, o) in report.Tables) report.Lines.Add($"content-pack: {name,-26} inserted {o.Inserted,4}  identical {o.Identical,4}  kept-different {o.KeptDifferent,3}  mapped {o.Mapped,2}");
        if (!report.Ok || options.Mode != ContentPackMode.Apply)
        {
            await tx.RollbackAsync(ct);
            report.Lines.Add(report.Ok ? $"content-pack: {options.Mode.ToString().ToUpperInvariant()} — nothing was written." : "content-pack: NOTHING WAS WRITTEN (see the conflicts and problems above).");
            return report;
        }

        foreach (var file in toCopy)
        {
            var path = ContentPackCatalog.ResolveKey(options.MediaRoot!, file.Key)!;
            try { await ContentPackCatalog.WriteAtomicAsync(path, await File.ReadAllBytesAsync(Path.Combine(pack.Directory, "files", file.Key), ct), ct); report.FilesCopied++; }
            catch (Exception ex)
            {
                // Another run may have written the same picture between the plan and now: an identical file is fine.
                if (ex is IOException && File.Exists(path) && ContentPackCatalog.Sha256(await File.ReadAllBytesAsync(path, ct)) == file.Sha256) { report.FilesPresent++; continue; }
                report.Problems.Add($"file {file.Key}: could not be copied ({ex.GetType().Name}); the database was not changed, run again.");
                await tx.RollbackAsync(ct);
                return report;
            }
        }
        await tx.CommitAsync(ct);
        report.Applied = true;
        report.Lines.Add($"content-pack: APPLIED — files copied {report.FilesCopied}, already there {report.FilesPresent}.");
        return report;
    }

    // ---- pack loading and integrity ----

    private sealed record LoadedPack(string Directory, ContentPackManifest Manifest, Dictionary<string, List<JsonObject>> Rows);

    private static async Task<LoadedPack?> LoadAsync(string directory, ContentPackReport report, CancellationToken ct)
    {
        var manifestPath = Path.Combine(directory, "manifest.json");
        if (!File.Exists(manifestPath)) { report.Problems.Add($"{manifestPath}: not found."); return null; }
        ContentPackManifest? manifest;
        try { manifest = JsonSerializer.Deserialize<ContentPackManifest>(await File.ReadAllTextAsync(manifestPath, ct)); }
        catch (JsonException) { report.Problems.Add("manifest.json is not valid."); return null; }
        if (manifest is null || manifest.Format != ContentPackSpec.FormatVersion) { report.Problems.Add($"unsupported pack format (this build reads format {ContentPackSpec.FormatVersion})."); return null; }
        var allowed = ContentPackSpec.Included.Select(t => t.Table).ToList();
        var ordered = manifest.Tables.OrderBy(t => allowed.IndexOf(t.Name)).ToList();
        if (ordered.Any(t => !allowed.Contains(t.Name)) || ordered.Select(t => t.Name).Distinct().Count() != ordered.Count) { report.Problems.Add("the manifest names a table a pack may not carry."); return null; }
        var rows = new Dictionary<string, List<JsonObject>>(StringComparer.Ordinal);
        foreach (var table in ordered)
        {
            var path = Path.Combine(directory, "rows", table.Name + ".jsonl");
            if (!File.Exists(path)) { report.Problems.Add($"rows/{table.Name}.jsonl: missing."); continue; }
            var bytes = await File.ReadAllBytesAsync(path, ct);
            if (ContentPackCatalog.Sha256(bytes) != table.Sha256) { report.Problems.Add($"rows/{table.Name}.jsonl: does not match the manifest's sha256."); continue; }
            var list = System.Text.Encoding.UTF8.GetString(bytes).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(line => JsonNode.Parse(line)!.AsObject()).ToList();
            if (list.Count != table.Rows) report.Problems.Add($"rows/{table.Name}.jsonl: {list.Count} rows, the manifest says {table.Rows}.");
            rows[table.Name] = list;
        }
        foreach (var file in manifest.Files)
        {
            var path = Path.Combine(directory, "files", file.Key);
            if (!ContentPackCatalog.FileKey().IsMatch(file.Key)) { report.Problems.Add($"files: '{file.Key}' is not a picture key."); continue; }
            if (!File.Exists(path)) { report.Problems.Add($"files/{file.Key}: missing from the pack."); continue; }
            var bytes = await File.ReadAllBytesAsync(path, ct);
            if (bytes.LongLength != file.Bytes || ContentPackCatalog.Sha256(bytes) != file.Sha256) report.Problems.Add($"files/{file.Key}: does not match the manifest.");
        }
        foreach (var (table, kind) in new[] { ("BlogMedia", "blog-original"), ("PromotionMedia", "promo-cover") })
        {
            var wanted = (rows.GetValueOrDefault(table) ?? []).Select(r => r["StorageKey"]!.GetValue<string>()).Order(StringComparer.Ordinal);
            var have = manifest.Files.Where(f => f.Kind == kind).Select(f => f.Key).Order(StringComparer.Ordinal);
            if (!wanted.SequenceEqual(have)) report.Problems.Add($"the pack's {kind} files and its {table} rows do not match.");
        }
        return new LoadedPack(directory, manifest with { Tables = ordered }, rows);
    }

    // ---- row helpers ----

    private static async Task<HashSet<string>> ColumnsAsync(NpgsqlConnection connection, NpgsqlTransaction tx, string table, CancellationToken ct)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        await using var command = new NpgsqlCommand("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = @t", connection, tx);
        command.Parameters.AddWithValue("t", table);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(reader.GetString(0));
        return result;
    }

    private static NpgsqlParameter Json(JsonObject row) => new("j", NpgsqlDbType.Jsonb) { Value = row.ToJsonString(ContentPackSpec.Json) };

    private static async Task<JsonObject?> ReadRowAsync(NpgsqlConnection connection, NpgsqlTransaction tx, string table, IReadOnlyList<string> key, JsonObject row, CancellationToken ct)
    {
        var join = string.Join(" AND ", key.Select(c => $"t.{ContentPackSpec.Quote(c)} = r.{ContentPackSpec.Quote(c)}"));
        await using var command = new NpgsqlCommand($"SELECT to_jsonb(t)::text FROM {ContentPackSpec.Quote(table)} t JOIN jsonb_populate_record(NULL::{ContentPackSpec.Quote(table)}, @j) r ON {join}", connection, tx);
        command.Parameters.Add(Json(row));
        return await command.ExecuteScalarAsync(ct) is string text ? JsonNode.Parse(text)!.AsObject() : null;
    }

    /// <summary>The id of the target's own Property (by slug), RoomType (by property and code) or Amenity (by code) that this row duplicates, if any.</summary>
    private static async Task<Guid?> NaturalMatchAsync(NpgsqlConnection connection, NpgsqlTransaction tx, string table, JsonObject row, CancellationToken ct)
    {
        string? sql = table switch
        {
            "Properties" => "SELECT \"Id\" FROM \"Properties\" WHERE \"Slug\" = @a",
            "RoomTypes" => "SELECT \"Id\" FROM \"RoomTypes\" WHERE \"PropertyId\" = @b::uuid AND \"Code\" = @a",
            "Amenities" => "SELECT \"Id\" FROM \"Amenities\" WHERE \"Code\" = @a",
            _ => null,
        };
        if (sql is null) return null;
        await using var command = new NpgsqlCommand(sql, connection, tx);
        command.Parameters.AddWithValue("a", row[table == "Properties" ? "Slug" : "Code"]!.GetValue<string>());
        command.Parameters.AddWithValue("b", table == "RoomTypes" ? row["PropertyId"]!.GetValue<string>() : string.Empty);
        return await command.ExecuteScalarAsync(ct) is Guid id ? id : null;
    }

    private static async Task<bool> TryInsertAsync(NpgsqlConnection connection, NpgsqlTransaction tx, string table, JsonObject row, ContentPackReport report, string keyText, CancellationToken ct)
    {
        var columns = string.Join(", ", row.Select(p => ContentPackSpec.Quote(p.Key)));
        tx.Save("row");
        try
        {
            await using var command = new NpgsqlCommand($"INSERT INTO {ContentPackSpec.Quote(table)} ({columns}) OVERRIDING SYSTEM VALUE SELECT {columns} FROM jsonb_populate_record(NULL::{ContentPackSpec.Quote(table)}, @j)", connection, tx);
            command.Parameters.Add(Json(row));
            await command.ExecuteNonQueryAsync(ct);
            tx.Release("row");
            return true;
        }
        catch (PostgresException ex) when (ex.SqlState.StartsWith("23", StringComparison.Ordinal))
        {
            tx.Rollback("row");
            report.Conflicts.Add($"{table} {keyText}: {ex.SqlState} {ex.ConstraintName ?? ex.MessageText}{(ex.Detail is null ? string.Empty : " — " + ex.Detail)}");
            return false;
        }
    }

    /// <summary>The columns a staff edit or the clock changes are not "content": two rows are the same when everything else matches (only the columns the pack carries are compared).</summary>
    private static JsonObject Project(JsonObject row, Dictionary<string, Dictionary<string, bool>> staff, string table, JsonObject? only = null)
    {
        var result = new JsonObject();
        foreach (var (name, value) in row.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            if (only is not null && !only.ContainsKey(name)) continue;
            if (VolatileColumns.Contains(name) || VolatileSuffixes.Any(s => name.EndsWith(s, StringComparison.Ordinal)) || (staff.TryGetValue(table, out var actors) && actors.ContainsKey(name))) continue;
            if (table == "Media" && name == "Url") continue;
            result[name] = value?.DeepClone();
        }
        return result;
    }

    private static async Task VerifyBlogMediaAsync(NpgsqlConnection connection, NpgsqlTransaction tx, LoadedPack pack, ContentPackReport report, CancellationToken ct)
    {
        var ids = pack.Rows.GetValueOrDefault("BlogMedia")?.Select(r => Guid.Parse(r["Id"]!.GetValue<string>())).ToArray() ?? [];
        if (ids.Length == 0) return;
        await using var command = new NpgsqlCommand("SELECT m.\"Id\" FROM \"BlogMedia\" m WHERE m.\"Id\" = ANY(@ids) AND (m.\"Generation\" = 0 OR NOT EXISTS (SELECT 1 FROM \"BlogMediaVariants\" v WHERE v.\"MediaId\" = m.\"Id\"))", connection, tx);
        command.Parameters.AddWithValue("ids", ids);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) report.Problems.Add($"BlogMedia {reader.GetGuid(0)}: has no variants yet (run the picture backfill: --blog-media-maintain --apply).");
    }
}
