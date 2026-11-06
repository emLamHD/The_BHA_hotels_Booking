using System.Data;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Npgsql;
using TheBha.Application.Website;
using NpgsqlTypes;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Infrastructure.ContentPack;

/// <summary>
/// BHA-CONTENT-PERSIST-001: puts a content pack into a database and its media directory without ever replacing what the staff made.
///
/// <list type="bullet">
/// <item>A row that exists (same key) is kept, whatever it holds. Only a website-configuration row that is still the migration's default (version 1, no author)
/// takes the pack's value, and only when the pack's row was itself edited in the source; a translation the target's own version produced is never overwritten.</item>
/// <item>A Property, RoomType, RatePlan, Amenity or Language the target has under another id (found by slug or code) is used in place of the pack's, and everything
/// that referred to the pack's id (and the Blog's <c>propertyIntro</c> ids) is re-pointed. This is resolved for every group, selected or not; a group never writes
/// outside itself, and a reference the target can not satisfy stops the run before anything is written.</item>
/// <item>A night's rate (property, room type, rate plan, date) and an offer (slug) the target already has are the target's own.</item>
/// <item>Every other collision is a CONFLICT: all are listed, the transaction is rolled back, no picture is copied.</item>
/// <item>The <c>ContentPackLedger</c> records what an import placed; a row it placed that has since been deleted is not put back (unless <c>RestoreDeleted</c>),
/// while a row no import ever placed (the first run, or a run that failed and rolled back) is.</item>
/// </list>
///
/// All rows go in one transaction under an advisory lock; the picture files are copied just before the commit. <c>DryRun</c> is the same transaction rolled back;
/// <c>Verify</c> reads only and says, row by row, what matches the pack, what keeps the target's own version, what was deleted since the import and what is missing.
/// </summary>
public static partial class ContentPackImporter
{
    private static readonly string[] VolatileSuffixes = ["AtUtc", "At"];
    private static readonly HashSet<string> VolatileColumns = new(StringComparer.Ordinal) { "Version", "Generation" };

    /// <summary>A slug row is keyed by the slug itself: the same slug owned by another post or category is a collision, not an "already there".</summary>
    private static readonly Dictionary<string, string> SlugOwner = new(StringComparer.Ordinal) { ["BlogPostSlugs"] = "TranslationId", ["BlogCategorySlugs"] = "CategoryId" };

    /// <summary>The tables whose rows other tables point at and whose natural key lets the target's own row stand in for the pack's: table → the foreign-key column.</summary>
    private static readonly Dictionary<string, string> Referenced = new(StringComparer.Ordinal)
    {
        ["Properties"] = "PropertyId", ["RoomTypes"] = "RoomTypeId", ["RatePlans"] = "RatePlanId", ["Amenities"] = "AmenityId", ["WebsiteLanguages"] = "LanguageId",
    };

    /// <summary>The stored-content translation keys (<c>content.&lt;entity&gt;.&lt;id&gt;.&lt;field&gt;</c>, see <c>ContentCatalog</c>) that carry an id the importer re-points: entity → the reference column.</summary>
    private static readonly Dictionary<string, string> ContentKeyEntities = new(StringComparer.Ordinal)
    {
        ["property"] = "PropertyId", ["roomType"] = "RoomTypeId", ["ratePlan"] = "RatePlanId", ["amenity"] = "AmenityId",
    };

    /// <summary>Blog rows the migration seeds (the Featured destinations category with its texts and slugs, and the settings): the source's edit of them travels over an untouched seed, like website configuration.</summary>
    private static readonly HashSet<string> BlogSeedTables = new(StringComparer.Ordinal) { "BlogCategories", "BlogCategoryTranslations", "BlogCategorySlugs", "BlogSettings" };

    private const int ListCap = 25;

    [GeneratedRegex("\"propertyId\"\\s*:\\s*\"([0-9a-fA-F-]{36})\"")]
    private static partial Regex PropertyIntroId();

    public static Task<ContentPackReport> ImportAsync(string connectionString, ContentPackImportOptions options, string environmentName, CancellationToken ct) =>
        new Importer(connectionString, options, environmentName).RunAsync(ct);

    private sealed record LoadedPack(string Directory, ContentPackManifest Manifest, string ManifestSha256, Dictionary<string, List<JsonObject>> Rows);

    private sealed class Importer(string connectionString, ContentPackImportOptions options, string environmentName)
    {
        private readonly ContentPackReport _report = new();
        private LoadedPack _pack = null!;
        private HashSet<string> _groups = null!;
        private string _baseUrl = "";
        private Guid _actor = Guid.Empty;
        private NpgsqlConnection _connection = null!;
        private NpgsqlTransaction? _tx;
        private Dictionary<string, Dictionary<string, bool>> _staff = null!;
        private readonly Dictionary<string, Dictionary<Guid, Guid>> _maps = new(StringComparer.Ordinal)
        {
            ["PropertyId"] = [], ["RoomTypeId"] = [], ["RatePlanId"] = [], ["AmenityId"] = [], ["LanguageId"] = [], ["PromotionId"] = [],
        };
        private readonly Dictionary<string, HashSet<Guid>> _absent = new(StringComparer.Ordinal);
        private readonly HashSet<string> _skipPromoMedia = new(StringComparer.OrdinalIgnoreCase);
        private HashSet<string> _ledger = [];
        private bool _ledgerExists;
        private bool _heroPristine = true, _menuPristine = true, _heroEdited, _menuEdited;
        private readonly List<(string Table, string Key)> _placed = [];
        /// <summary>Languages / currencies whose default stays the target's own (decided once per table by <see cref="DecideDefaultAsync"/>).</summary>
        private readonly HashSet<string> _keepsTargetDefault = [];
        /// <summary>Collections (hero slides, menu items) this run replaced as a whole: their rows are written afresh, so the ledger's "deleted since" never applies to them.</summary>
        private readonly HashSet<string> _replacedTables = new(StringComparer.Ordinal);
        /// <summary>Categories of the target nobody has edited since the migration seeded them (version 1, no author), and categories the source's staff edited — read before any write.</summary>
        private readonly HashSet<Guid> _seedCategoryPristine = [], _packCategoryEdited = [];
        private ContentPackMode Mode => options.Mode;

        private ContentPackReport Fail(string problem) { _report.Problems.Add(problem); return _report; }

        public async Task<ContentPackReport> RunAsync(CancellationToken ct)
        {
            var loaded = await LoadAsync(options.Pack, _report, ct);
            if (loaded is null || _report.Problems.Count > 0) return _report;
            _pack = loaded;
            _groups = (options.Groups ?? ContentPackSpec.Groups).ToHashSet(StringComparer.Ordinal);
            if (_groups.Count == 0 || _groups.Any(g => !ContentPackSpec.Groups.Contains(g))) return Fail("--groups takes any of: " + string.Join(", ", ContentPackSpec.Groups));

            if (!Uri.TryCreate(options.MediaBaseUrl, UriKind.Absolute, out var origin) || origin.AbsolutePath != "/" || !string.IsNullOrEmpty(origin.Query) || (origin.Scheme != "https" && !(options.AllowLocalMediaOrigin && origin.Scheme == "http")))
                return Fail("--media-base-url must be an https origin with no path (for example https://example.com).");
            var local = origin.IsLoopback || origin.Host.EndsWith(".localhost", StringComparison.Ordinal);
            if (local && !(options.AllowLocalMediaOrigin && string.Equals(environmentName, "Development", StringComparison.Ordinal)))
                return Fail("--media-base-url points at this machine; refused outside Development (the pictures would not load for visitors).");
            _baseUrl = origin.GetLeftPart(UriPartial.Authority);

            await using var connection = _connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(ct);
            var actual = await ContentPackCatalog.CurrentDatabaseAsync(connection, ct);
            _report.Lines.Add($"content-pack: target database {actual} (environment {environmentName}), mode {Mode}");
            if (!string.Equals(actual, options.ExpectedDatabase, StringComparison.Ordinal))
            {
                _report.TargetRefused = true;
                return Fail($"REFUSED: --expected-database is '{options.ExpectedDatabase}' but this process is connected to '{actual}'. Nothing was changed.");
            }

            var selected = _pack.Manifest.Tables.Where(t => _groups.Contains(ContentPackSpec.GroupOf(t.Name))).ToList();
            _staff = await ContentPackCatalog.StaffColumnsAsync(connection, ct);

            // Who is recorded as the author: needed only when a selected row carries an author (Blog rows always do).
            var needsActor = selected.Any(t => _pack.Rows[t.Name].Any(r => ContentPackCatalog.Strings(r).Contains(ContentPackSpec.ActorToken)));
            if (Mode != ContentPackMode.Verify && needsActor)
            {
                await using var find = new NpgsqlCommand("SELECT \"Id\", \"IsActive\", \"CanEditBlog\", \"CanPublishBlog\" FROM \"StaffAccounts\" WHERE \"NormalizedEmail\" = upper(@e)", connection);
                find.Parameters.AddWithValue("e", options.ActorEmail ?? string.Empty);
                await using var reader = await find.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct) || !reader.GetBoolean(1) || (_groups.Contains("blog") && (!reader.GetBoolean(2) || !reader.GetBoolean(3))))
                    return Fail("--actor-email must name an existing, active Staff account (with Blog edit and publish access when the Blog is imported) on the target; create one with --staff-create and --staff-blog-access first.");
                _actor = reader.GetGuid(0);
            }

            // The transaction and its locks come before any read that decides what to write. The importer's own lock first (nobody else takes it), then the
            // website-settings lock every Admin website writer takes (WebsiteTransaction.InLockAsync) when the website group is written: it is held until commit or
            // rollback, so a Staff save either finished before the importer reads the configuration or waits until the importer is done. One order everywhere: no deadlock.
            await using var tx = _tx = await connection.BeginTransactionAsync(Mode == ContentPackMode.Verify ? IsolationLevel.RepeatableRead : IsolationLevel.ReadCommitted, ct);
            if (Mode == ContentPackMode.Verify) { await using var ro = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, tx); await ro.ExecuteNonQueryAsync(ct); }
            else
            {
                await using (var lockCommand = new NpgsqlCommand("SELECT pg_try_advisory_xact_lock(@k)", connection, tx))
                {
                    lockCommand.Parameters.AddWithValue("k", ContentPackSpec.AdvisoryLockKey);
                    if (!(bool)(await lockCommand.ExecuteScalarAsync(ct))!) return Fail("another content-pack import is running on this database; try again when it has finished.");
                }
                if (_groups.Contains("website"))
                {
                    try
                    {
                        await using (var timeout = new NpgsqlCommand("SET LOCAL lock_timeout = '60s'", connection, tx)) await timeout.ExecuteNonQueryAsync(ct);
                        await using (var website = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@k)", connection, tx))
                        {
                            website.Parameters.AddWithValue("k", BookingAdvisoryLockKeys.ForWebsiteSettings());
                            await website.ExecuteNonQueryAsync(ct);
                        }
                        await using (var reset = new NpgsqlCommand("SET LOCAL lock_timeout = 0", connection, tx)) await reset.ExecuteNonQueryAsync(ct);
                    }
                    catch (PostgresException ex) when (ex.SqlState == "55P03") { return Fail("the website-settings lock was not free within 60 seconds (a Staff save is taking too long); nothing was written, run again."); }
                }
            }
            if (options.AfterLocksAcquired is { } hook) await hook(ct);

            // References are resolved for every group (what the pack's rows should point at in THIS database); only the selected groups are written.
            await ResolveReferencesAsync(ct);
            if (_report.Problems.Count > 0) return _report;
            if (options.Checkpoint is { } checkpoint) await checkpoint("references-resolved", ct);
            await LoadLedgerAsync(ct);
            if (Mode == ContentPackMode.Apply && !_ledgerExists) return Fail("the database has no ContentPackLedger table: apply the migrations (dotnet ef database update) of this version first.");

            // Files first as a plan (reads only): present and identical, missing, or a different file under the same name.
            var skippedCovers = (_pack.Rows.GetValueOrDefault("PromotionMedia") ?? []).Where(r => _skipPromoMedia.Contains(r["Id"]!.GetValue<string>())).Select(r => r["StorageKey"]!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
            var deletedKeys = await DeletedPictureKeysAsync(ct);
            foreach (var key in deletedKeys.Order(StringComparer.Ordinal)) _report.Lines.Add($"  picture kept deleted (an earlier import placed it and the staff deleted it; its file is not copied back): {key}");
            // When the target's hero is a collection the staff edited, the pack's uploaded hero pictures have no slide to serve and are not brought in.
            // A hero upload's file follows its media row: with a pristine hero the pack's rows come in; with a hero the staff saved only the rows the target already has stay (and are checked
            // from run to run, whoever saved the hero), and the pack's other pictures are not brought in.
            var retainedHeroFiles = await RetainedHeroUploadKeysAsync(ct);
            var files = _pack.Manifest.Files.Where(f => _groups.Contains(GroupOfKind(f.Kind)) && !skippedCovers.Contains(f.Key) && !deletedKeys.Contains(f.Key) && !(f.Kind == "hero-upload" && !_heroPristine && !retainedHeroFiles.Contains(f.Key))).ToList();
            if (files.Count > 0 && options.MediaRoot is null) return Fail("WebsiteMedia:RootPath is not set: the pack's picture files have nowhere to go.");
            var toCopy = new List<ContentPackFile>();
            foreach (var file in files)
            {
                var path = ContentPackCatalog.ResolveKey(options.MediaRoot!, file.Key)!;
                if (!File.Exists(path)) { toCopy.Add(file); continue; }
                if (ContentPackCatalog.Sha256(await File.ReadAllBytesAsync(path, ct)) == file.Sha256) _report.FilesPresent++;
                else _report.Conflicts.Add($"file {file.Key}: a different file is already there; it is never overwritten.");
            }
            if (Mode == ContentPackMode.Verify) foreach (var file in toCopy) _report.Problems.Add($"file {file.Key}: missing from the media directory.");

            var pending = new List<(Guid Id, JsonNode? Status, JsonNode? Draft, JsonNode? Published)>();
            foreach (var table in selected)
            {
                await ProcessTableAsync(table.Name, pending, ct);
                if (_report.Problems.Count > 0) break;
            }

            if (Mode != ContentPackMode.Verify && _report.Problems.Count == 0)
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
                        _report.Conflicts.Add($"BlogPostTranslations {id}: {ex.SqlState} {ex.ConstraintName ?? ex.MessageText}");
                    }
                }
            }

            if (_groups.Contains("blog") && _report.Problems.Count == 0)
            {
                await CheckPropertyIntroAsync(ct);
                await NoteInactiveLanguagesAsync(ct);
                if (Mode == ContentPackMode.Verify) await VerifyBlogMediaAsync(ct);
            }

            foreach (var (name, o) in _report.Tables)
                _report.Lines.Add($"content-pack: {name,-24} inserted {o.Inserted,4}  matches {o.Matches,4}  kept-target {o.KeptDifferent,3}  mapped {o.Mapped,2}  updated {o.Updated,2}  deleted-since {o.DeletedSinceImport,2}" + (Mode == ContentPackMode.Verify ? $"  missing {o.Missing,3}" : string.Empty));
            _report.Lines.Add($"content-pack: {_report.Tables.Values.Sum(o => o.Inserted)} inserted · {_report.Tables.Values.Sum(o => o.Matches)} rows match the pack · {_report.Tables.Values.Sum(o => o.KeptDifferent)} keep the target's own version · {_report.Tables.Values.Sum(o => o.Updated)} took the pack's value over a default · {_report.Tables.Values.Sum(o => o.DeletedSinceImport)} deleted since the import (not put back) · {_report.Tables.Values.Sum(o => o.Missing)} missing");

            // Deferred constraints (exactly one default language / currency) are checked at commit, which a dry-run never reaches: check them now so the dry-run answers what the apply would meet.
            if (_report.Ok && Mode != ContentPackMode.Verify)
            {
                try { await using var check = new NpgsqlCommand("SET CONSTRAINTS ALL IMMEDIATE", connection, tx); await check.ExecuteNonQueryAsync(ct); }
                catch (PostgresException ex) { _report.Problems.Add($"the database would refuse the commit ({ex.SqlState} {ex.ConstraintName ?? ex.MessageText}); nothing was written."); }
            }

            if (!_report.Ok || Mode != ContentPackMode.Apply)
            {
                await tx.RollbackAsync(ct);
                _report.Lines.Add(_report.Ok ? $"content-pack: {Mode.ToString().ToUpperInvariant()} — nothing was written." : "content-pack: NOTHING WAS WRITTEN (see the conflicts and problems above).");
                return _report;
            }

            foreach (var file in toCopy)
            {
                var path = ContentPackCatalog.ResolveKey(options.MediaRoot!, file.Key)!;
                try { await ContentPackCatalog.WriteAtomicAsync(path, await File.ReadAllBytesAsync(Path.Combine(_pack.Directory, "files", file.Key), ct), ct); _report.FilesCopied++; }
                catch (Exception ex)
                {
                    // Another run may have written the same picture between the plan and now: an identical file is fine.
                    if (ex is IOException && File.Exists(path) && ContentPackCatalog.Sha256(await File.ReadAllBytesAsync(path, ct)) == file.Sha256) { _report.FilesPresent++; continue; }
                    _report.Problems.Add($"file {file.Key}: could not be copied ({ex.GetType().Name}); the database was not changed, run again.");
                    await tx.RollbackAsync(ct);
                    return _report;
                }
            }

            if (_placed.Count > 0)
            {
                await using var ledger = new NpgsqlCommand("INSERT INTO \"ContentPackLedger\" (\"TableName\", \"RowKey\", \"PackSha256\", \"ImportedAtUtc\") SELECT x.t, x.k, @sha, now() FROM unnest(@tables, @keys) AS x(t, k) ON CONFLICT DO NOTHING", connection, tx);
                ledger.Parameters.AddWithValue("sha", _pack.ManifestSha256);
                ledger.Parameters.AddWithValue("tables", _placed.Select(p => p.Table).ToArray());
                ledger.Parameters.AddWithValue("keys", _placed.Select(p => p.Key).ToArray());
                await ledger.ExecuteNonQueryAsync(ct);
            }
            try { await tx.CommitAsync(ct); }
            catch (PostgresException ex)
            {
                _report.Problems.Add($"the database refused the commit ({ex.SqlState} {ex.ConstraintName ?? ex.MessageText}); nothing was written, run again after fixing the cause.");
                return _report;
            }
            _report.Applied = true;
            _report.Lines.Add($"content-pack: APPLIED — files copied {_report.FilesCopied}, already there {_report.FilesPresent}.");
            return _report;
        }

        // ---- references: what each pack row should point at in this database ----

        private Guid Map(string column, Guid id) => _maps[column].TryGetValue(id, out var mapped) ? mapped : id;

        private async Task<Guid?> GuidAsync(string sql, params (string Name, object Value)[] parameters)
        {
            await using var command = new NpgsqlCommand(sql, _connection, _tx);
            foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
            return await command.ExecuteScalarAsync() is Guid id ? id : null;
        }

        private async Task ResolveReferencesAsync(CancellationToken ct)
        {
            foreach (var table in Referenced.Keys) _absent[table] = [];
            foreach (var row in _pack.Rows.GetValueOrDefault("Properties") ?? [])
            {
                var id = Guid.Parse(row["Id"]!.GetValue<string>());
                if (await GuidAsync("SELECT \"Id\" FROM \"Properties\" WHERE \"Id\" = @i", ("i", id)) is not null) continue;
                if (await GuidAsync("SELECT \"Id\" FROM \"Properties\" WHERE \"Slug\" = @s", ("s", row["Slug"]!.GetValue<string>())) is { } own) _maps["PropertyId"][id] = own; else _absent["Properties"].Add(id);
            }
            foreach (var row in _pack.Rows.GetValueOrDefault("RoomTypes") ?? [])
            {
                var id = Guid.Parse(row["Id"]!.GetValue<string>());
                if (await GuidAsync("SELECT \"Id\" FROM \"RoomTypes\" WHERE \"Id\" = @i", ("i", id)) is not null) continue;
                var property = Map("PropertyId", Guid.Parse(row["PropertyId"]!.GetValue<string>()));
                var byCode = await GuidAsync("SELECT \"Id\" FROM \"RoomTypes\" WHERE \"PropertyId\" = @p AND \"Code\" = @c", ("p", property), ("c", row["Code"]!.GetValue<string>()));
                var bySlug = await GuidAsync("SELECT \"Id\" FROM \"RoomTypes\" WHERE \"PropertyId\" = @p AND \"Slug\" = @c", ("p", property), ("c", row["Slug"]!.GetValue<string>()));
                if (byCode is not null && bySlug is not null && byCode != bySlug) _report.Problems.Add($"RoomTypes {row["Code"]}: ambiguous — the target has one room type with that code and another with that slug; resolve it in Admin and run again.");
                else if ((byCode ?? bySlug) is { } own) _maps["RoomTypeId"][id] = own; else _absent["RoomTypes"].Add(id);
            }
            foreach (var row in _pack.Rows.GetValueOrDefault("RatePlans") ?? [])
            {
                var id = Guid.Parse(row["Id"]!.GetValue<string>());
                if (await GuidAsync("SELECT \"Id\" FROM \"RatePlans\" WHERE \"Id\" = @i", ("i", id)) is not null) continue;
                var property = Map("PropertyId", Guid.Parse(row["PropertyId"]!.GetValue<string>()));
                if (await GuidAsync("SELECT \"Id\" FROM \"RatePlans\" WHERE \"PropertyId\" = @p AND \"Code\" = @c", ("p", property), ("c", row["Code"]!.GetValue<string>())) is { } own) _maps["RatePlanId"][id] = own; else _absent["RatePlans"].Add(id);
            }
            foreach (var row in _pack.Rows.GetValueOrDefault("Amenities") ?? [])
            {
                var id = Guid.Parse(row["Id"]!.GetValue<string>());
                if (await GuidAsync("SELECT \"Id\" FROM \"Amenities\" WHERE \"Id\" = @i", ("i", id)) is not null) continue;
                if (await GuidAsync("SELECT \"Id\" FROM \"Amenities\" WHERE \"Code\" = @c", ("c", row["Code"]!.GetValue<string>())) is { } own) _maps["AmenityId"][id] = own; else _absent["Amenities"].Add(id);
            }
            foreach (var row in _pack.Rows.GetValueOrDefault("WebsiteLanguages") ?? [])
            {
                var id = Guid.Parse(row["Id"]!.GetValue<string>());
                if (await GuidAsync("SELECT \"Id\" FROM \"WebsiteLanguages\" WHERE \"Id\" = @i", ("i", id)) is not null) continue;
                if (await GuidAsync("SELECT \"Id\" FROM \"WebsiteLanguages\" WHERE \"NormalizedCode\" = @c", ("c", row["NormalizedCode"]!.GetValue<string>())) is { } own) _maps["LanguageId"][id] = own; else _absent["WebsiteLanguages"].Add(id);
            }

            // An offer the target already has under the same slug (another id: offers get random ids) is the target's own, with its own cover and room types:
            // the pack's copy of it, of its room-type links and of its cover is left out.
            if (_groups.Contains("promotions") && _pack.Rows.GetValueOrDefault("Promotions") is { Count: > 0 } packPromotions)
            {
                await using var find = new NpgsqlCommand("SELECT \"Slug\", \"Id\" FROM \"Promotions\" WHERE \"Slug\" = ANY(@s)", _connection);
                find.Parameters.AddWithValue("s", packPromotions.Select(r => r["Slug"]!.GetValue<string>()).ToArray());
                await using var reader = await find.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var packRow = packPromotions.First(r => r["Slug"]!.GetValue<string>() == reader.GetString(0));
                    var packId = Guid.Parse(packRow["Id"]!.GetValue<string>());
                    if (packId == reader.GetGuid(1)) continue;
                    _maps["PromotionId"][packId] = reader.GetGuid(1);
                    if (packRow["CoverMediaId"] is { } cover) _skipPromoMedia.Add(cover.GetValue<string>());
                }
            }

            // Where the selected groups point at something the target does not have and this run will not write, stop before anything is written.
            if (!_groups.Contains("catalog"))
            {
                string Slug(Guid id) => _pack.Rows["Properties"].FirstOrDefault(r => r["Id"]!.GetValue<string>() == id.ToString())?["Slug"]?.GetValue<string>() ?? id.ToString();
                void NeedsProperty(string who, Guid id) { if (_absent["Properties"].Contains(id)) _report.Problems.Add($"{who} needs the property '{Slug(id)}' ({id}), which the target does not have; import the catalog group first (or together)."); }
                if (_groups.Contains("promotions"))
                {
                    foreach (var id in (_pack.Rows.GetValueOrDefault("Promotions") ?? []).Concat(_pack.Rows.GetValueOrDefault("PromotionMedia") ?? []).Select(r => Guid.Parse(r["PropertyId"]!.GetValue<string>())).Distinct()) NeedsProperty("the promotions group", id);
                    foreach (var id in (_pack.Rows.GetValueOrDefault("PromotionRoomTypes") ?? []).Select(r => Guid.Parse(r["RoomTypeId"]!.GetValue<string>())).Distinct())
                        if (_absent["RoomTypes"].Contains(id)) _report.Problems.Add($"the promotions group needs the room type {id}, which the target does not have; import the catalog group first (or together).");
                }
                if (_groups.Contains("blog"))
                    foreach (var id in (_pack.Rows.GetValueOrDefault("BlogPostRevisions") ?? []).SelectMany(r => PropertyIntroId().Matches(r.ToJsonString(ContentPackSpec.Json)).Select(m => Guid.Parse(m.Groups[1].Value))).Distinct())
                        NeedsProperty("the Blog group (a propertyIntro block)", id);
            }
            // The state of the target's hero and menu BEFORE this run: their child rows follow the parent (a staff edit always raises the parent's version).
            _heroPristine = await PristineParentAsync("WebsiteHero", ct);
            _menuPristine = await PristineParentAsync("WebsiteMenu", ct);
            _heroEdited = IsEdited("WebsiteHero", (_pack.Rows.GetValueOrDefault("WebsiteHero") ?? []).FirstOrDefault());
            _menuEdited = IsEdited("WebsiteMenu", (_pack.Rows.GetValueOrDefault("WebsiteMenu") ?? []).FirstOrDefault());
            // A category's texts and slugs follow the category: every Admin save of one raises its version and records its author (UpdateCategoryAsync), so a category still at
            // version 1 with no author has the migration's texts and slugs.
            await using (var seed = new NpgsqlCommand("SELECT \"Id\" FROM \"BlogCategories\" WHERE \"Version\" = 1 AND \"UpdatedByStaffId\" IS NULL AND \"CreatedByStaffId\" IS NULL", _connection, _tx))
            await using (var reader = await seed.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) _seedCategoryPristine.Add(reader.GetGuid(0));
            foreach (var category in _pack.Rows.GetValueOrDefault("BlogCategories") ?? [])
                if (IsEdited("BlogCategories", category)) _packCategoryEdited.Add(Guid.Parse(category["Id"]!.GetValue<string>()));
        }

        private async Task<bool> PristineParentAsync(string table, CancellationToken ct)
        {
            await using var command = new NpgsqlCommand($"SELECT \"Version\", \"UpdatedByStaffId\" FROM {ContentPackSpec.Quote(table)} WHERE \"Id\" = 1", _connection, _tx);
            await using var reader = await command.ExecuteReaderAsync(ct);
            return !await reader.ReadAsync(ct) || (reader.GetInt32(0) == 1 && reader.IsDBNull(1));
        }

        private async Task LoadLedgerAsync(CancellationToken ct)
        {
            await using var exists = new NpgsqlCommand("SELECT to_regclass('public.\"ContentPackLedger\"') IS NOT NULL", _connection);
            _ledgerExists = (bool)(await exists.ExecuteScalarAsync(ct))!;
            if (!_ledgerExists) return;
            await using var command = new NpgsqlCommand("SELECT \"TableName\" || '|' || \"RowKey\" FROM \"ContentPackLedger\"", _connection);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) _ledger.Add(reader.GetString(0));
        }

        /// <summary>The storage keys of pack pictures whose row an import placed and that are absent now (the staff deleted them, and the service deletes the files with the row).</summary>
        private async Task<HashSet<string>> DeletedPictureKeysAsync(CancellationToken ct)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            if (options.RestoreDeleted) return keys;
            foreach (var table in new[] { "BlogMedia", "PromotionMedia", "WebsiteHeroMedia" })
            {
                if (!_groups.Contains(ContentPackSpec.GroupOf(table)) || !_pack.Rows.TryGetValue(table, out var rows)) continue;
                var candidates = rows.Where(r => _ledger.Contains($"{table}|{r["Id"]!.GetValue<string>()}") && r["StorageKey"] is not null && (table != "WebsiteHeroMedia" || r["Kind"]?.GetValue<string>() == "upload")).ToList();
                if (candidates.Count == 0) continue;
                var present = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                await using var command = new NpgsqlCommand($"SELECT \"Id\"::text FROM {ContentPackSpec.Quote(table)} WHERE \"Id\" = ANY(@ids)", _connection, _tx);
                command.Parameters.AddWithValue("ids", candidates.Select(r => Guid.Parse(r["Id"]!.GetValue<string>())).ToArray());
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) present.Add(reader.GetString(0));
                foreach (var row in candidates.Where(r => !present.Contains(r["Id"]!.GetValue<string>()))) keys.Add(row["StorageKey"]!.GetValue<string>());
            }
            return keys;
        }

        // ---- one table ----

        private static string GroupOfKind(string kind) => kind switch { "blog-original" => "blog", "promo-cover" => "promotions", _ => "website" };

        /// <summary>A pack row the source's staff produced (as against one a migration or a built-in text produced).</summary>
        private bool IsEdited(string table, JsonObject? row)
        {
            if (row is null) return false;
            if (table is "WebsiteHeroMedia" or "WebsiteHeroSlides") return _heroEdited;
            if (table == "WebsiteMenuItems") return _menuEdited;
            if (table is "BlogCategoryTranslations" or "BlogCategorySlugs") return _packCategoryEdited.Contains(Guid.Parse(row["CategoryId"]!.GetValue<string>()));
            if (row["Version"] is { } version && version.GetValue<int>() > 1) return true;
            if (row["IsManual"]?.GetValue<bool>() == true) return true;
            return _staff.TryGetValue(table, out var actors) && actors.Keys.Any(c => row[c] is not null);
        }

        /// <summary>A target row nobody has edited since the migration made it.</summary>
        private bool IsPristine(string table, JsonObject target)
        {
            if (table is "WebsiteHeroMedia" or "WebsiteHeroSlides") return _heroPristine;
            if (table == "WebsiteMenuItems") return _menuPristine;
            if (table is "BlogCategoryTranslations" or "BlogCategorySlugs") return _seedCategoryPristine.Contains(Guid.Parse(target["CategoryId"]!.GetValue<string>()));
            if (target["Version"]?.GetValue<int>() > 1) return false;
            if (target["IsManual"]?.GetValue<bool>() == true) return false;
            return !_staff.TryGetValue(table, out var actors) || actors.Keys.All(c => target[c] is null);
        }

        private IEnumerable<JsonObject> OrderedRows(string table)
        {
            var rows = _pack.Rows[table];
            // A slug that stops being current goes in before the one that becomes current (one current slug per category and language).
            if (table == "BlogCategorySlugs") return rows.OrderBy(r => r["IsCurrent"]?.GetValue<bool>() == true ? 1 : 0);
            if (table != "WebsiteMenuItems") return rows;
            // A menu item's parent goes in before it.
            var byId = rows.ToDictionary(r => r["Id"]!.GetValue<string>(), StringComparer.Ordinal);
            int Depth(JsonObject r) { var d = 0; var parent = r["ParentId"]?.GetValue<string>(); while (parent is not null && byId.TryGetValue(parent, out var p) && d < 20) { d++; parent = p["ParentId"]?.GetValue<string>(); } return d; }
            return rows.OrderBy(Depth).ThenBy(r => r["SortOrder"]!.GetValue<int>());
        }

        private void Cap(string table, string line)
        {
            var o = _report.Tables[table];
            if (o.KeptDifferent + o.DeletedSinceImport + o.Mapped <= ListCap) _report.Lines.Add(line);
        }

        private async Task ProcessTableAsync(string table, List<(Guid, JsonNode?, JsonNode?, JsonNode?)> pending, CancellationToken ct)
        {
            var columns = await ColumnsAsync(table, ct);
            var key = await ContentPackCatalog.PrimaryKeyAsync(_connection, table, ct);
            var outcome = _report.Tables[table] = new TableOutcome();
            var rows = _pack.Rows[table];
            var unknown = rows.SelectMany(r => r.Select(p => p.Key)).Distinct().Where(c => !columns.Contains(c)).ToList();
            if (unknown.Count > 0) { _report.Problems.Add($"{table}: the pack has columns this database does not: {string.Join(", ", unknown)} (export again from the same version)."); return; }

            // A hero or menu the staff saved (its row has version > 1 or an author: every Admin save sets both) is theirs: a child it does not have is one they removed or
            // replaced, whether or not an import ever ran, so none is added to it. Only a collection still at the migration's state receives the pack's.
            var collectionEdited = table switch { "WebsiteHeroSlides" or "WebsiteHeroMedia" => !_heroPristine, "WebsiteMenuItems" => !_menuPristine, _ => false };
            if (table == "BlogCategories" && Mode != ContentPackMode.Verify) await LockSeedCategoriesAsync(ct);
            if (table is "WebsiteLanguages" or "WebsiteCurrencies") await DecideDefaultAsync(table, key, rows, ct);
            if (Mode != ContentPackMode.Verify) await PrepareConfigTableAsync(table, key, rows, ct);
            if (table == "BlogMedia") _report.BlogMediaIds.AddRange(rows.Select(r => Guid.Parse(r["Id"]!.GetValue<string>())));

            foreach (var packRow in OrderedRows(table))
            {
                var packKey = ContentPackCatalog.KeyText(packRow, key);
                if (table == "PromotionMedia" && _skipPromoMedia.Contains(packRow["Id"]!.GetValue<string>())) { outcome.Mapped++; continue; }
                if (table == "PromotionRoomTypes" && Guid.TryParse(packRow["PromotionId"]!.GetValue<string>(), out var packPromotion) && _maps["PromotionId"].ContainsKey(packPromotion)) { outcome.Mapped++; continue; }
                if (table == "Promotions" && Guid.TryParse(packRow["Id"]!.GetValue<string>(), out var promotionId) && _maps["PromotionId"].TryGetValue(promotionId, out var ownPromotion))
                {
                    outcome.Mapped++;
                    Cap(table, $"  mapped to the target's own row: Promotions {packRow["Slug"]} -> {ownPromotion}");
                    continue;
                }

                var text = packRow.ToJsonString(ContentPackSpec.Json);
                if (table == "BlogPostRevisions") foreach (var (from, to) in _maps["PropertyId"]) text = text.Replace(from.ToString(), to.ToString(), StringComparison.Ordinal);
                var row = JsonNode.Parse(text)!.AsObject();
                foreach (var (column, map) in _maps)
                    if (row.ContainsKey(column) && row[column] is { } id && Guid.TryParse(id.GetValue<string>(), out var old) && map.TryGetValue(old, out var mapped)) row[column] = mapped.ToString();
                // A stored-content text is keyed by the id of the thing it translates: where the target has that thing under another id, the key follows.
                if (table == "WebsiteTranslations" && row["Key"]?.GetValue<string>() is { } contentKey) row["Key"] = RemapContentKey(contentKey);
                var mappedSelf = false;
                if (Referenced.TryGetValue(table, out var selfColumn) && Guid.TryParse(row["Id"]!.GetValue<string>(), out var selfId) && _maps[selfColumn].TryGetValue(selfId, out var ownId))
                {
                    row["Id"] = ownId.ToString(); mappedSelf = true; outcome.Mapped++;
                    Cap(table, $"  mapped to the target's own row: {table} {packKey} -> {ownId}");
                }
                if (_staff.TryGetValue(table, out var actors))
                    foreach (var (column, notNull) in actors)
                        if (row.ContainsKey(column) && (row[column] is not null || notNull)) row[column] = _actor.ToString();
                if (table == "Media" && row["Url"]?.GetValue<string>() is { } url) row["Url"] = url.Replace(ContentPackSpec.OriginToken, _baseUrl, StringComparison.Ordinal);
                if (ContentPackCatalog.Strings(row).Any(s => s.Contains(ContentPackSpec.OriginToken, StringComparison.Ordinal) || s == ContentPackSpec.ActorToken)) { _report.Problems.Add($"{table} {packKey}: a placeholder was left unresolved."); continue; }

                var keyText = ContentPackCatalog.KeyText(row, key);
                var existing = await ReadRowAsync(table, key, row, ct);

                // A night's rate is its (property, room type, rate plan, date): the target's own rate for that night is kept, whatever id it has.
                if (existing is null && table == "DailyRoomRates" && await ReadRowAsync(table, ["PropertyId", "RoomTypeId", "RatePlanId", "StayDate"], row, ct) is { } ownRate)
                {
                    row["Id"] = ownRate["Id"]?.DeepClone();
                    existing = ownRate;
                    mappedSelf = false;
                }

                if (existing is not null)
                {
                    if (SlugOwner.TryGetValue(table, out var owner) && !string.Equals(existing[owner]?.ToString(), row[owner]?.ToString(), StringComparison.OrdinalIgnoreCase))
                    {
                        _report.Conflicts.Add($"{table} {keyText}: the slug already belongs to another {(owner == "CategoryId" ? "category" : "post")} ({existing[owner]}).");
                        continue;
                    }
                    await ExistingRowAsync(table, key, packRow, row, existing, keyText, outcome, mappedSelf, ct);
                    _placed.Add((table, packKey));
                    continue;
                }

                if (_keepsTargetDefault.Contains(table) && row["IsDefault"]?.GetValue<bool>() == true) row["IsDefault"] = false;
                if (collectionEdited || (table == "WebsiteTranslations" && IsProtectedCollectionText(row)))
                {
                    outcome.KeptDifferent++;
                    Cap(table, $"  kept (the target's collection was edited): {table} {keyText} is not added");
                    continue;
                }
                // A category the target's staff edited keeps its own current slug; the pack's current slug for it would be a second one.
                if (table == "BlogCategorySlugs" && row["IsCurrent"]?.GetValue<bool>() == true && Guid.Parse(row["CategoryId"]!.GetValue<string>()) is var slugCategory
                    && !(_seedCategoryPristine.Contains(slugCategory) && _packCategoryEdited.Contains(slugCategory)) && await HasOtherCurrentSlugAsync(row, ct))
                {
                    outcome.KeptDifferent++;
                    Cap(table, $"  kept (the target's category has its own current slug): {table} {keyText} is not added");
                    continue;
                }
                if (!options.RestoreDeleted && !_replacedTables.Contains(table) && _ledger.Contains($"{table}|{packKey}"))
                {
                    outcome.DeletedSinceImport++;
                    Cap(table, $"  deleted since the import (not put back): {table} {packKey}{(packRow["StorageKey"] is { } storage ? $" ({storage.GetValue<string>()})" : string.Empty)}");
                    continue;
                }
                if (Mode == ContentPackMode.Verify)
                {
                    outcome.Missing++;
                    if (outcome.Missing <= ListCap) _report.Problems.Add($"{table} {keyText}: missing from the target (no import ever placed it).");
                    continue;
                }
                if (table == "BlogPostTranslations")
                {
                    // A translation and its revisions point at each other: the translation goes in first as a draft with no pointers, and takes them in a second pass.
                    pending.Add((Guid.Parse(row["Id"]!.GetValue<string>()), row["Status"]?.DeepClone(), row["DraftRevisionId"]?.DeepClone(), row["PublishedRevisionId"]?.DeepClone()));
                    row["Status"] = "Draft"; row["DraftRevisionId"] = null; row["PublishedRevisionId"] = null;
                }
                if (await TryInsertAsync(table, row, keyText, ct)) { outcome.Inserted++; _placed.Add((table, packKey)); }
            }
            if (outcome.Missing > ListCap) _report.Problems.Add($"{table}: {outcome.Missing - ListCap} more rows are missing from the target.");
        }

        private async Task ExistingRowAsync(string table, IReadOnlyList<string> key, JsonObject packRow, JsonObject row, JsonObject existing, string keyText, TableOutcome outcome, bool mappedSelf, CancellationToken ct)
        {
            // The group's default was decided once (DecideDefaultAsync): when the target's stands, no row of the group is written with another one.
            var keptDefault = _keepsTargetDefault.Contains(table) && row["IsDefault"] is { } packDefault && !JsonNode.DeepEquals(packDefault, existing["IsDefault"]);
            if (keptDefault) row["IsDefault"] = existing["IsDefault"]?.DeepClone();
            var packProjection = Project(row, table);
            var targetProjection = Project(existing, table, row);
            var same = JsonNode.DeepEquals(packProjection, targetProjection);
            // A configuration row whose content is the same but whose version says the source's staff saved it (a menu has nothing else) carries that version over a default.
            var versionOnly = !keptDefault && same && (table.StartsWith("Website", StringComparison.Ordinal) || BlogSeedTables.Contains(table)) && row["Version"] is { } packVersion && existing["Version"] is { } targetVersion
                && packVersion.GetValue<int>() != targetVersion.GetValue<int>() && IsEdited(table, packRow) && IsPristine(table, existing);
            if (same && !versionOnly && !keptDefault) { outcome.Matches++; return; }
            var different = versionOnly ? ["Version"] : Differing(packProjection, targetProjection);
            if (keptDefault) different.Insert(0, "IsDefault");
            if (same && !versionOnly) { outcome.KeptDifferent++; Cap(table, $"  kept (the target's default stands): {table} {keyText} — {string.Join(", ", different)}"); return; }

            // Website configuration and the Blog's seed rows: the target's value stands unless it is still the migration's default and the pack's row was edited in the source.
            if ((table.StartsWith("Website", StringComparison.Ordinal) || BlogSeedTables.Contains(table)) && IsEdited(table, packRow) && IsPristine(table, existing))
            {
                if (Mode == ContentPackMode.Verify)
                {
                    outcome.Missing++;
                    if (outcome.Missing <= ListCap) _report.Problems.Add($"{table} {keyText}: the target still has the default; the pack carries the source's configured value ({string.Join(", ", different)}).");
                    return;
                }
                if (await TryUpdateAsync(table, key, row, keyText, existing, ct)) { outcome.Updated++; Cap(table, $"  took the pack's value (the target's row was still the migration default): {table} {keyText} — {string.Join(", ", different)}"); }
                return;
            }
            outcome.KeptDifferent++;
            Cap(table, $"  kept (the target differs from the pack): {table} {keyText} — {string.Join(", ", different)}");
        }

        /// <summary>Before the rows of a configuration table: replace a pristine parent's children, and free the default flag so the carried default can take it.</summary>
        private async Task PrepareConfigTableAsync(string table, IReadOnlyList<string> key, List<JsonObject> rows, CancellationToken ct)
        {
            if (table is "WebsiteHeroSlides" or "WebsiteMenuItems")
            {
                var pristine = table == "WebsiteHeroSlides" ? _heroPristine : _menuPristine;
                var edited = table == "WebsiteHeroSlides" ? _heroEdited : _menuEdited;
                if (!pristine || !edited) return;
                // The target's default slides (items) are replaced as a whole by the source's, as the Admin save does: one DELETE statement (the menu's self-referencing key and the slides' unique
                // order are checked at its end), then the pack's rows are inserted. Rewriting kept rows one by one would collide with the order or the parent of a row not yet moved. Nothing
                // else is deleted (no picture row is).
                await using var delete = new NpgsqlCommand($"DELETE FROM {ContentPackSpec.Quote(table)}", _connection, _tx);
                var removed = await delete.ExecuteNonQueryAsync(ct);
                _replacedTables.Add(table);
                if (removed > 0) _report.Lines.Add($"  {table}: {removed} default row(s) replaced by the source's configured ones");
            }
        }

        /// <summary>The storage keys of the pack's hero uploads whose media row the target already has.</summary>
        private async Task<HashSet<string>> RetainedHeroUploadKeysAsync(CancellationToken ct)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            var packKeys = _pack.Manifest.Files.Where(f => f.Kind == "hero-upload").Select(f => f.Key).ToArray();
            if (packKeys.Length == 0 || _heroPristine) return keys;
            await using var command = new NpgsqlCommand("SELECT \"StorageKey\" FROM \"WebsiteHeroMedia\" WHERE \"StorageKey\" = ANY(@k)", _connection, _tx);
            command.Parameters.AddWithValue("k", packKeys);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) keys.Add(reader.GetString(0));
            return keys;
        }

        /// <summary>
        /// The category-level decision for a seeded category's texts and slugs, taken under a row lock held to commit: the early read of ResolveReferencesAsync is only a candidate list. A Staff save
        /// that landed since is seen here and its category stays the target's; one that starts now waits for the commit and then finds the version changed (a stale save), so nothing the
        /// importer writes to the children can overwrite a text saved after the decision. Categories are locked in id order.
        /// </summary>
        private async Task LockSeedCategoriesAsync(CancellationToken ct)
        {
            var candidates = _packCategoryEdited.Order().ToArray();
            if (candidates.Length == 0) return;
            await using (var command = new NpgsqlCommand("SELECT \"Id\", \"Version\" = 1 AND \"UpdatedByStaffId\" IS NULL AND \"CreatedByStaffId\" IS NULL FROM \"BlogCategories\" WHERE \"Id\" = ANY(@ids) ORDER BY \"Id\" FOR UPDATE", _connection, _tx))
            {
                command.Parameters.AddWithValue("ids", candidates);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                    if (reader.GetBoolean(1)) _seedCategoryPristine.Add(reader.GetGuid(0)); else _seedCategoryPristine.Remove(reader.GetGuid(0));
            }
            if (options.Checkpoint is { } checkpoint) await checkpoint("categories-locked", ct);
        }

        private string RemapContentKey(string key)
        {
            if (!ContentKey.TryParse(key, out var entity, out var id, out var field)) return key;
            return ContentKeyEntities.TryGetValue(entity, out var column) && Guid.TryParse(id, out var guid) && _maps[column].TryGetValue(guid, out var own) ? ContentKey.For(entity, own.ToString(), field) : key;
        }

        /// <summary>A hero or menu text the pack carries (<paramref name="row"/> has its language already re-pointed) for a language the target already has, when the target's staff saved that collection: a text they cleared on purpose is not put back (nor is one of a child they replaced).</summary>
        private bool IsProtectedCollectionText(JsonObject row)
        {
            var edited = ContentKey.TryParse(row["Key"]?.GetValue<string>() ?? string.Empty, out var entity, out _, out _)
                && (entity == "menuItem" ? !_menuPristine : entity is "heroSlideshow" or "heroSlide" ? !_heroPristine : false);
            return edited && row["LanguageId"]?.GetValue<string>() is { } language && Guid.TryParse(language, out var languageId) && !_absent["WebsiteLanguages"].Contains(languageId);
        }

        private async Task<bool> HasOtherCurrentSlugAsync(JsonObject row, CancellationToken ct)
        {
            await using var command = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM \"BlogCategorySlugs\" WHERE \"CategoryId\" = @c AND \"Locale\" = @l AND \"IsCurrent\" AND \"Slug\" <> @s)", _connection, _tx);
            command.Parameters.AddWithValue("c", Guid.Parse(row["CategoryId"]!.GetValue<string>()));
            command.Parameters.AddWithValue("l", row["Locale"]!.GetValue<string>());
            command.Parameters.AddWithValue("s", row["Slug"]!.GetValue<string>());
            return (bool)(await command.ExecuteScalarAsync(ct))!;
        }

        /// <summary>
        /// One decision per language / currency table, the same in dry-run, apply and verify: the pack's default becomes the target's only when the source's staff chose it and nothing the target's staff
        /// made stands in the way (the target's current default and the pack's default row are both still the migration's, and no earlier import's row was deleted since). Otherwise the target keeps its own
        /// valid default and every row of the table is written with it, so the table always ends with exactly one default. Taking it frees the old default's flag before any row is written.
        /// </summary>
        private async Task DecideDefaultAsync(string table, IReadOnlyList<string> key, List<JsonObject> rows, CancellationToken ct)
        {
            var natural = table == "WebsiteLanguages" ? "NormalizedCode" : "Code";
            if (rows.FirstOrDefault(r => r["IsDefault"]?.GetValue<bool>() == true) is not { } packDefault) return;
            var packCode = packDefault[natural]!.GetValue<string>();
            var current = await ReadWhereAsync(table, "t.\"IsDefault\"", null, ct);
            if (current is null || current[natural]!.GetValue<string>() == packCode) return;
            var own = await ReadWhereAsync(table, $"t.{ContentPackSpec.Quote(natural)} = @c", packCode, ct);

            var reasons = new List<string>();
            if (!IsEdited(table, packDefault)) reasons.Add($"the source's staff did not choose {packCode}");
            if (!IsPristine(table, current)) reasons.Add($"the target's default {current[natural]} was set by its staff");
            if (own is not null && !IsPristine(table, own)) reasons.Add($"the target's {packCode} was edited by its staff");
            if (own is null && !options.RestoreDeleted && _ledger.Contains($"{table}|{ContentPackCatalog.KeyText(packDefault, key)}")) reasons.Add($"{packCode} was deleted on the target since an import");
            if (reasons.Count > 0)
            {
                _keepsTargetDefault.Add(table);
                _report.Notes.Add($"{table}: the pack's default is {packCode}; the target keeps {current[natural]} as its default ({string.Join("; ", reasons)}).");
                return;
            }
            if (Mode == ContentPackMode.Verify) return;
            await using var clear = new NpgsqlCommand($"UPDATE {ContentPackSpec.Quote(table)} SET \"IsDefault\" = false WHERE \"IsDefault\"", _connection, _tx);
            await clear.ExecuteNonQueryAsync(ct);
        }

        private async Task<JsonObject?> ReadWhereAsync(string table, string where, string? code, CancellationToken ct)
        {
            await using var command = new NpgsqlCommand($"SELECT to_jsonb(t)::text FROM {ContentPackSpec.Quote(table)} t WHERE {where}", _connection, _tx);
            if (code is not null) command.Parameters.AddWithValue("c", code);
            return await command.ExecuteScalarAsync(ct) is string text ? JsonNode.Parse(text)!.AsObject() : null;
        }

        // ---- checks that need the whole picture ----

        /// <summary>A Blog body must not point at a property the target does not have (the pack's references were re-pointed; this proves nothing dangles).</summary>
        private async Task CheckPropertyIntroAsync(CancellationToken ct)
        {
            var ids = _report.Tables.ContainsKey("BlogPostRevisions") ? _pack.Rows["BlogPostRevisions"].Select(r => Guid.Parse(r["Id"]!.GetValue<string>())).ToArray() : [];
            if (ids.Length == 0) return;
            await using var command = new NpgsqlCommand(
                "SELECT DISTINCT (v #>> '{}')::uuid FROM \"BlogPostRevisions\" r CROSS JOIN LATERAL jsonb_path_query(r.\"BodyJson\", '$.blocks[*] ? (@.type == \"propertyIntro\").propertyId') v " +
                "WHERE r.\"Id\" = ANY(@ids) AND NOT EXISTS (SELECT 1 FROM \"Properties\" p WHERE p.\"Id\" = (v #>> '{}')::uuid)", _connection, _tx);
            command.Parameters.AddWithValue("ids", ids);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) _report.Problems.Add($"a Blog post points at the property {reader.GetGuid(0)}, which the target does not have.");
        }

        private async Task NoteInactiveLanguagesAsync(CancellationToken ct)
        {
            if (!_pack.Rows.TryGetValue("BlogPostTranslations", out var translations)) return;
            foreach (var locale in translations.Select(t => t["Locale"]!.GetValue<string>()).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))
            {
                await using var command = new NpgsqlCommand("SELECT \"IsActive\" FROM \"WebsiteLanguages\" WHERE \"NormalizedCode\" = @c", _connection, _tx);
                command.Parameters.AddWithValue("c", locale);
                var active = await command.ExecuteScalarAsync(ct);
                if (active is null) _report.Notes.Add($"the Blog has posts in '{locale}' and the target has no such language: they stay hidden (import the website group, or add the language in Admin).");
                else if (!(bool)active) _report.Notes.Add($"the Blog has posts in '{locale}' and that language is inactive on the target: they stay hidden until it is activated (import the website group, or activate it in Admin).");
            }
        }

        /// <summary>Every pack picture has its variants, and every variant has its file, with the size and sha256 the database recorded.</summary>
        private async Task VerifyBlogMediaAsync(CancellationToken ct)
        {
            var ids = _pack.Rows.GetValueOrDefault("BlogMedia")?.Select(r => Guid.Parse(r["Id"]!.GetValue<string>())).ToArray() ?? [];
            if (ids.Length == 0) return;
            if (options.MediaRoot is null) { _report.Problems.Add("WebsiteMedia:RootPath is not set: the picture variants cannot be checked."); return; }
            var pictures = new Dictionary<Guid, (int Generation, int Variants)>();
            await using (var command = new NpgsqlCommand("SELECT m.\"Id\", m.\"Generation\", (SELECT count(*) FROM \"BlogMediaVariants\" v WHERE v.\"MediaId\" = m.\"Id\") FROM \"BlogMedia\" m WHERE m.\"Id\" = ANY(@ids)", _connection, _tx))
            {
                command.Parameters.AddWithValue("ids", ids);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) pictures[reader.GetGuid(0)] = (reader.GetInt32(1), (int)reader.GetInt64(2));
            }
            foreach (var (id, (generation, variants)) in pictures.Where(p => p.Value.Generation == 0 || p.Value.Variants == 0))
                _report.Problems.Add($"BlogMedia {id}: has no variants yet (run the same import again, or --blog-media-maintain --apply).");

            var problems = 0;
            var checkedFiles = 0;
            await using (var command = new NpgsqlCommand("SELECT v.\"MediaId\", v.\"StorageKey\", v.\"Sha256\", v.\"ByteSize\" FROM \"BlogMediaVariants\" v WHERE v.\"MediaId\" = ANY(@ids) ORDER BY v.\"StorageKey\"", _connection, _tx))
            {
                command.Parameters.AddWithValue("ids", ids);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var (media, key, sha, size) = (reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetInt64(3));
                    var path = ContentPackCatalog.ResolveKey(options.MediaRoot, key);
                    string? problem = null;
                    if (path is null || !File.Exists(path)) problem = "the file is missing from the media directory";
                    else
                    {
                        var bytes = await File.ReadAllBytesAsync(path, ct);
                        if (bytes.LongLength != size || !string.Equals(ContentPackCatalog.Sha256(bytes), sha, StringComparison.OrdinalIgnoreCase)) problem = "the file does not match the size and sha256 the database recorded (it was changed or damaged)";
                    }
                    checkedFiles++;
                    if (problem is not null && ++problems <= ListCap) _report.Problems.Add($"variant {key} of picture {media}: {problem}.");
                }
            }
            if (problems > ListCap) _report.Problems.Add($"{problems - ListCap} more variant files fail the same check.");
            _report.Lines.Add($"content-pack: {checkedFiles} picture variant files checked against their recorded sha256 ({problems} wrong)");
        }

        // ---- row helpers ----

        private async Task<HashSet<string>> ColumnsAsync(string table, CancellationToken ct)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            await using var command = new NpgsqlCommand("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = @t", _connection, _tx);
            command.Parameters.AddWithValue("t", table);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) result.Add(reader.GetString(0));
            return result;
        }

        private static NpgsqlParameter Json(JsonObject row) => new("j", NpgsqlDbType.Jsonb) { Value = row.ToJsonString(ContentPackSpec.Json) };

        private async Task<JsonObject?> ReadRowAsync(string table, IReadOnlyList<string> key, JsonObject row, CancellationToken ct)
        {
            var join = string.Join(" AND ", key.Select(c => $"t.{ContentPackSpec.Quote(c)} = r.{ContentPackSpec.Quote(c)}"));
            await using var command = new NpgsqlCommand($"SELECT to_jsonb(t)::text FROM {ContentPackSpec.Quote(table)} t JOIN jsonb_populate_record(NULL::{ContentPackSpec.Quote(table)}, @j) r ON {join}", _connection, _tx);
            command.Parameters.Add(Json(row));
            return await command.ExecuteScalarAsync(ct) is string text ? JsonNode.Parse(text)!.AsObject() : null;
        }

        private async Task<bool> TryInsertAsync(string table, JsonObject row, string keyText, CancellationToken ct)
        {
            var columns = string.Join(", ", row.Select(p => ContentPackSpec.Quote(p.Key)));
            _tx!.Save("row");
            try
            {
                await using var command = new NpgsqlCommand($"INSERT INTO {ContentPackSpec.Quote(table)} ({columns}) OVERRIDING SYSTEM VALUE SELECT {columns} FROM jsonb_populate_record(NULL::{ContentPackSpec.Quote(table)}, @j)", _connection, _tx);
                command.Parameters.Add(Json(row));
                await command.ExecuteNonQueryAsync(ct);
                _tx.Release("row");
                return true;
            }
            catch (PostgresException ex) when (ex.SqlState.StartsWith("23", StringComparison.Ordinal))
            {
                _tx.Rollback("row");
                _report.Conflicts.Add($"{table} {keyText}: {ex.SqlState} {ex.ConstraintName ?? ex.MessageText}{(ex.Detail is null ? string.Empty : " — " + ex.Detail)}");
                return false;
            }
        }

        private async Task<bool> TryUpdateAsync(string table, IReadOnlyList<string> key, JsonObject row, string keyText, JsonObject existing, CancellationToken ct)
        {
            // The row was read under the website-settings lock; the version it had is checked again by the statement, so nothing committed since can be overwritten.
            var versioned = existing["Version"] is { } version && row.ContainsKey("Version");
            var set = string.Join(", ", row.Select(p => p.Key).Where(c => !key.Contains(c) && !c.StartsWith("Created", StringComparison.Ordinal)).Select(c => $"{ContentPackSpec.Quote(c)} = r.{ContentPackSpec.Quote(c)}"));
            var join = string.Join(" AND ", key.Select(c => $"t.{ContentPackSpec.Quote(c)} = r.{ContentPackSpec.Quote(c)}"));
            _tx!.Save("row");
            try
            {
                await using var command = new NpgsqlCommand($"UPDATE {ContentPackSpec.Quote(table)} t SET {set} FROM jsonb_populate_record(NULL::{ContentPackSpec.Quote(table)}, @j) r WHERE {join}{(versioned ? " AND t.\"Version\" = @expectedVersion" : string.Empty)}", _connection, _tx);
                command.Parameters.Add(Json(row));
                if (versioned) command.Parameters.AddWithValue("expectedVersion", existing["Version"]!.GetValue<int>());
                if (await command.ExecuteNonQueryAsync(ct) == 0)
                {
                    _tx.Rollback("row");
                    _report.Conflicts.Add($"{table} {keyText}: changed by someone else while the import ran; nothing was written, run again.");
                    return false;
                }
                _tx.Release("row");
                return true;
            }
            catch (PostgresException ex) when (ex.SqlState.StartsWith("23", StringComparison.Ordinal))
            {
                _tx.Rollback("row");
                _report.Conflicts.Add($"{table} {keyText}: {ex.SqlState} {ex.ConstraintName ?? ex.MessageText}");
                return false;
            }
        }

        /// <summary>The columns a staff edit or the clock changes are not "content": two rows are the same when everything else matches (only the columns the pack carries are compared).</summary>
        private JsonObject Project(JsonObject row, string table, JsonObject? only = null)
        {
            var result = new JsonObject();
            foreach (var (name, value) in row.OrderBy(p => p.Key, StringComparer.Ordinal))
            {
                if (only is not null && !only.ContainsKey(name)) continue;
                if (VolatileColumns.Contains(name) || VolatileSuffixes.Any(s => name.EndsWith(s, StringComparison.Ordinal)) || (_staff.TryGetValue(table, out var actors) && actors.ContainsKey(name))) continue;
                result[name] = value?.DeepClone();
            }
            return result;
        }

        private static List<string> Differing(JsonObject pack, JsonObject target) =>
            pack.Select(p => p.Key).Where(k => !JsonNode.DeepEquals(pack[k], target[k])).Take(8).ToList();
    }

    // ---- pack loading and integrity ----

    private static async Task<LoadedPack?> LoadAsync(string directory, ContentPackReport report, CancellationToken ct)
    {
        var manifestPath = Path.Combine(directory, "manifest.json");
        if (!File.Exists(manifestPath)) { report.Problems.Add($"{manifestPath}: not found."); return null; }
        ContentPackManifest? manifest;
        var manifestBytes = await File.ReadAllBytesAsync(manifestPath, ct);
        try { manifest = JsonSerializer.Deserialize<ContentPackManifest>(manifestBytes); }
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
        foreach (var (table, kind) in new[] { ("BlogMedia", "blog-original"), ("PromotionMedia", "promo-cover"), ("WebsiteHeroMedia", "hero-upload") })
        {
            var source = (rows.GetValueOrDefault(table) ?? []).AsEnumerable();
            if (table == "WebsiteHeroMedia") source = source.Where(r => r["Kind"]?.GetValue<string>() == "upload");
            var wanted = source.Select(r => r["StorageKey"]!.GetValue<string>()).Order(StringComparer.Ordinal);
            var have = manifest.Files.Where(f => f.Kind == kind).Select(f => f.Key).Order(StringComparer.Ordinal);
            if (!wanted.SequenceEqual(have)) report.Problems.Add($"the pack's {kind} files and its {table} rows do not match.");
        }
        return new LoadedPack(directory, manifest with { Tables = ordered }, ContentPackCatalog.Sha256(manifestBytes), rows);
    }
}
