using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-BLOG-001-CP02: the picture library. A picture is taken in files-first: every file (the private original and the variants, each under a fresh key)
/// is written, then the row and its variants are inserted in one transaction. So a row that exists always has all its files, and a crash leaves at most files
/// no row refers to (the operator maintenance command finds them). A file is deleted after a failure only when the row is known not to have been committed.
/// </summary>
internal sealed partial class AdminBlogService
{
    // ---- taking pictures in ----

    private static readonly BlogProblem CouldNotStore = new(
        BlogErrorCodes.MediaProcessingFailed, "file", "The picture could not be stored. Check the library, then upload it again if it is not there.");

    /// <summary>A picture whose files are all written and whose row is not inserted yet (BHA-ADMIN-BADGE-001-PR06).</summary>
    private sealed record Pending(Guid Id, BlogMedia Row, List<string> Files);

    private sealed record Taken(BlogMediaDto? Media, BlogProblem? Problem);

    public async Task<WebsiteMutationResult<BlogMediaDto>> UploadMediaAsync(BlogMediaUpload upload, Guid actorStaffId, CancellationToken cancellationToken)
    {
        var (picture, problem) = await PrepareAsync(upload, actorStaffId, cancellationToken);
        if (picture is null)
        {
            return Fail<BlogMediaDto>(problem!);
        }

        var taken = (await CommitPicturesAsync([picture], actorStaffId, single: true))[0];
        return taken.Problem is null ? WebsiteMutationResult<BlogMediaDto>.Success(taken.Media!) : Fail<BlogMediaDto>(taken.Problem);
    }

    /// <summary>
    /// Phase A of a batch, per picture and without any transaction: read, inspect and process every file, write the files, and keep the rows for phase B. One that is refused or fails does not
    /// undo the others. A caller that goes away stops the batch; the pictures already prepared are still taken in (they are complete, with all their files), then the cancellation is rethrown.
    /// Phase B (<see cref="CommitPicturesAsync"/>) is ONE short transaction: the counter row of <c>blog-media</c> is taken only there, never while a file is being processed.
    /// </summary>
    public async Task<BlogMediaBatchDto> UploadMediaBatchAsync(IReadOnlyList<BlogMediaUpload> uploads, Guid actorStaffId, CancellationToken cancellationToken)
    {
        var items = new BlogMediaBatchItemDto?[uploads.Count];
        var prepared = new List<(int Index, Pending Picture)>(uploads.Count);
        var cancelled = false;
        for (var index = 0; index < uploads.Count && !cancelled; index++)
        {
            var upload = uploads[index];
            var name = PlainName(upload.FileName, BlogMediaLimits.FileName);
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                var (picture, problem) = await PrepareAsync(upload, actorStaffId, cancellationToken);
                if (picture is null)
                {
                    items[index] = new BlogMediaBatchItemDto(index, name, upload.ClientId, null, problem);
                }
                else
                {
                    prepared.Add((index, picture));
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                cancelled = true;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Blog picture {Index} of a batch could not be stored.", index);
                items[index] = new BlogMediaBatchItemDto(index, name, upload.ClientId, null, CouldNotStore);
            }
        }

        if (prepared.Count > 0)
        {
            var taken = await CommitPicturesAsync([.. prepared.Select(entry => entry.Picture)], actorStaffId, single: false);
            for (var position = 0; position < prepared.Count; position++)
            {
                var index = prepared[position].Index;
                items[index] = new BlogMediaBatchItemDto(index, PlainName(uploads[index].FileName, BlogMediaLimits.FileName), taken[position].Media?.Id ?? uploads[index].ClientId, taken[position].Media, taken[position].Problem);
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        var done = items.Select(item => item!).ToList();
        var succeeded = done.Count(item => item.Media is not null);
        return new BlogMediaBatchDto(done, succeeded, done.Count - succeeded);
    }

    /// <summary>Everything up to and including the files: the pre-checks, the pipeline and every file write. No database write. A failure after the first file removes the files written so far (no row exists).</summary>
    private async Task<(Pending? Picture, BlogProblem? Problem)> PrepareAsync(BlogMediaUpload upload, Guid actorStaffId, CancellationToken cancellationToken)
    {
        if (!storage.IsConfigured)
        {
            return (null, new BlogProblem(
                BlogErrorCodes.StorageNotConfigured, "file", "Picture storage is not configured on this server (WebsiteMedia:RootPath), so pictures cannot be uploaded."));
        }

        var id = upload.ClientId ?? Guid.NewGuid();
        var written = new List<string>();
        try
        {
            // A repeat of an id is refused, not replayed: a client that lost the answer reads the picture back instead of uploading it twice.
            if (upload.ClientId is not null && await db.BlogMedia.AsNoTracking().AnyAsync(row => row.Id == id, cancellationToken))
            {
                return (null, new BlogProblem(BlogErrorCodes.DuplicateId, "id", "This id is already used."));
            }

            var (bytes, tooLarge) = await ReadBoundedAsync(upload.Open, cancellationToken);
            if (tooLarge)
            {
                return (null, new BlogProblem(HeroErrorCodes.ImageTooLarge, "file", "The picture is larger than 10 MB."));
            }

            var check = HeroImageInspector.Inspect(bytes.Span);
            if (check.Info is not { } info)
            {
                return (null, new BlogProblem(check.Code!, "file", check.Message!));
            }

            if (info.Width < BlogLimits.MinCoverWidth || info.Height < BlogLimits.MinCoverHeight)
            {
                return (null, new BlogProblem(
                    HeroErrorCodes.ImageDimensions, "file", $"The picture is {info.Width}×{info.Height}; a Blog picture is at least {BlogLimits.MinCoverWidth}×{BlogLimits.MinCoverHeight}."));
            }

            var (image, problem) = await pipeline.ProcessAsync(bytes, info, cancellationToken);
            if (image is null)
            {
                return (null, problem);
            }

            var originalKey = NewKey(info.Extension);
            await storage.WriteAsync(originalKey, bytes, cancellationToken);
            written.Add(originalKey);

            var variants = new List<BlogMediaVariant>(image.Variants.Count);
            foreach (var variant in image.Variants)
            {
                var key = NewKey(variant.Format);
                await storage.WriteAsync(key, variant.Bytes, cancellationToken);
                written.Add(key);
                variants.Add(new BlogMediaVariant(Guid.NewGuid(), id, variant.Preset, variant.Format, key, variant.Width, variant.Height, variant.Bytes.Length, Sha256Hex(variant.Bytes)));
            }

            var fileName = PlainName(Path.GetFileName((upload.FileName ?? string.Empty).Replace('\\', '/')), BlogMediaLimits.FileName);
            var displayName = PlainName(Path.GetFileNameWithoutExtension(fileName), BlogMediaLimits.DisplayName);
            var row = new BlogMedia(
                id, originalKey, info.ContentType, bytes.Length, image.Width, image.Height, displayName.Length > 0 ? displayName : "Picture", fileName,
                Sha256Hex(bytes.Span), actorStaffId, clock.GetUtcNow(), variants);
            // A caller that went away before the commit takes this picture nothing in (the catch below removes its files: no row will refer to them).
            cancellationToken.ThrowIfCancellationRequested();
            return (new Pending(id, row, written), null);
        }
        catch
        {
            // Nothing is in the database yet, so no row can refer to these files.
            await DeleteFilesAsync(written);
            throw;
        }
    }

    /// <summary>
    /// Phase B: ONE READ COMMITTED transaction for the prepared pictures. Each is inserted with its audit row inside its own savepoint, so one the database refuses (or a raced id) is rolled back
    /// alone, its files removed (that rollback is certain) and the others kept. When at least one picture went in, ONE activity is recorded (<c>ItemCount</c> = the pictures that went in) as the
    /// last statement before COMMIT, so the pictures, their audits and the event commit or vanish together. The caller's token is deliberately not used: a caller that went away must not lose
    /// pictures that are complete. A failure BEFORE the commit was sent rolls everything back for certain (every file goes); only a failure of the COMMIT itself leaves the outcome unknown,
    /// and then only a picture the database says is absent loses its files. A <paramref name="single"/> upload rethrows; a batch answers a per-picture failure instead.
    /// </summary>
    private async Task<IReadOnlyList<Taken>> CommitPicturesAsync(IReadOnlyList<Pending> pictures, Guid actorStaffId, bool single)
    {
        var results = new Taken?[pictures.Count];
        var commitSent = false;
        var inserted = 0;
        try
        {
            await using (var transaction = await db.Database.BeginTransactionAsync(CancellationToken.None))
            {
                for (var index = 0; index < pictures.Count; index++)
                {
                    var picture = pictures[index];
                    var savepoint = $"blog_picture_{index}";
                    await transaction.CreateSavepointAsync(savepoint, CancellationToken.None);
                    try
                    {
                        db.BlogMedia.Add(picture.Row);
                        Audit(actorStaffId, "media.upload", detail: new { id = picture.Id, picture.Row.Width, picture.Row.Height, variants = picture.Row.Variants.Count });
                        if (await SaveAsync(CancellationToken.None) is { } refused)
                        {
                            await transaction.RollbackToSavepointAsync(savepoint, CancellationToken.None);
                            await DeleteFilesAsync(picture.Files);
                            results[index] = new Taken(null, refused);
                        }
                        else
                        {
                            results[index] = new Taken(ToMediaDto(picture.Row, new BlogMediaUsageSummaryDto(0, 0, 0)), null);
                            inserted++;
                        }
                    }
                    catch (Exception exception) when (!single)
                    {
                        await transaction.RollbackToSavepointAsync(savepoint, CancellationToken.None);
                        await DeleteFilesAsync(picture.Files);
                        logger.LogWarning(exception, "Blog picture {Id} of a batch could not be stored.", picture.Id);
                        results[index] = new Taken(null, CouldNotStore);
                    }
                    catch
                    {
                        // A single picture: the answer is the failure itself. The rollback of its own savepoint is certain, so its files go; the outer handler leaves them alone.
                        await transaction.RollbackToSavepointAsync(savepoint, CancellationToken.None);
                        await DeleteFilesAsync(picture.Files);
                        results[index] = new Taken(null, CouldNotStore);
                        throw;
                    }
                    finally
                    {
                        // One failed picture must not leave its pending rows in the tracker for the next one to save.
                        db.ChangeTracker.Clear();
                    }
                }

                if (inserted > 0)
                {
                    var only = pictures[Array.FindIndex(results, taken => taken?.Media is not null)];
                    await RecordAsync(
                        AdminMenuKeys.BlogMedia, actorStaffId, "Uploaded", single ? MediaKind : MediaBatchKind, (single ? only.Id : Guid.NewGuid()).ToString("D"),
                        single ? only.Row.DisplayName : string.Empty, CancellationToken.None, itemCount: inserted);
                    commitSent = true;
                    await transaction.CommitAsync(CancellationToken.None);
                }
            }
        }
        catch (Exception exception)
        {
            // Before the commit was sent the rollback is certain, so no file is referenced: every picture not already cleaned goes. After it, only a picture the database says is absent.
            for (var index = 0; index < pictures.Count; index++)
            {
                if (results[index] is { Problem: not null })
                {
                    continue;
                }

                if (!commitSent || await RowExistsAsync(pictures[index].Id) == false)
                {
                    await DeleteFilesAsync(pictures[index].Files);
                }
            }

            db.ChangeTracker.Clear();
            if (single)
            {
                throw;
            }

            logger.LogError(exception, "A batch of {Count} Blog pictures could not be committed (commit sent: {CommitSent}).", pictures.Count, commitSent);
            return [.. results.Select(taken => taken is { Problem: not null } ? taken : new Taken(null, CouldNotStore))];
        }

        if (inserted > 0)
        {
            await HintAsync(AdminMenuKeys.BlogMedia);
        }

        return [.. results.Select(taken => taken!)];
    }

    private static string NewKey(string extension) => $"blog/{Guid.NewGuid():N}.{extension}";

    private static string Sha256Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static async Task<(ReadOnlyMemory<byte> Bytes, bool TooLarge)> ReadBoundedAsync(Func<Stream> open, CancellationToken cancellationToken)
    {
        await using var content = open();
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await content.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > HeroLimits.MaxUploadBytes)
            {
                return (default, true);
            }

            buffer.Write(chunk, 0, read);
        }

        return (buffer.ToArray(), false);
    }

    /// <summary>Plain text for a name taken from a file: no control characters, no angle brackets, trimmed and cut to <paramref name="max"/>.</summary>
    private static string PlainName(string? value, int max)
    {
        var cleaned = new string((value ?? string.Empty).Where(character => !char.IsControl(character) && character is not ('<' or '>')).ToArray()).Trim();
        return cleaned.Length > max ? cleaned[..max].TrimEnd() : cleaned;
    }

    /// <summary><c>null</c> when it cannot be told (the database is not answering): the caller then keeps the files.</summary>
    private async Task<bool?> RowExistsAsync(Guid id)
    {
        try
        {
            db.ChangeTracker.Clear();
            return await db.BlogMedia.AsNoTracking().AnyAsync(row => row.Id == id, CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not tell whether Blog picture {Id} was saved; its files are kept.", id);
            return null;
        }
    }

    private async Task DeleteFilesAsync(IEnumerable<string> keys)
    {
        foreach (var key in keys)
        {
            try
            {
                await storage.DeleteAsync(key, CancellationToken.None);
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Blog picture file {Key} could not be deleted; the maintenance command removes it later.", key);
            }
        }
    }

    // ---- library ----

    private static string LikeEscape(string text) => text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal);

    public Task<BlogMediaListDto> ListMediaAsync(BlogMediaListQuery query, CancellationToken cancellationToken) =>
        InSnapshotAsync(AdminMenuKeys.BlogMedia, watermark => ListMediaAsync(query, watermark, cancellationToken), cancellationToken);

    private async Task<BlogMediaListDto> ListMediaAsync(BlogMediaListQuery query, string watermark, CancellationToken cancellationToken)
    {
        var size = query.PageSize <= 0 ? BlogMediaLimits.DefaultPageSize : Math.Min(query.PageSize, BlogLimits.MaxPageSize);
        var page = Math.Max(1, query.Page);
        var rows = db.BlogMedia.AsNoTracking();
        if (BlogText.Normalize(query.Q) is { Length: > 0 } text)
        {
            var pattern = $"%{LikeEscape(text)}%";
            rows = rows.Where(row =>
                EF.Functions.ILike(row.DisplayName, pattern, "\\") || EF.Functions.ILike(row.OriginalFileName, pattern, "\\") ||
                EF.Functions.ILike(row.Credit, pattern, "\\") || EF.Functions.ILike(row.Description, pattern, "\\"));
        }

        rows = query.Usage switch
        {
            "used" => rows.Where(row => db.BlogRevisionMedia.Any(use => use.MediaId == row.Id)),
            "unused" => rows.Where(row => !db.BlogRevisionMedia.Any(use => use.MediaId == row.Id)),
            _ => rows
        };

        var total = await rows.CountAsync(cancellationToken);

        // The offset is worked out in 64 bits. A page past the last one is an empty page, answered without asking the database for it; only an offset below the
        // (int) total can reach Skip, so the cast cannot lose anything.
        var offset = (long)(page - 1) * size;
        var pageRows = offset >= total
            ? []
            : await rows.OrderByDescending(row => row.CreatedAtUtc).ThenBy(row => row.Id)
                .Skip((int)offset).Take(size).Include(row => row.Variants).ToListAsync(cancellationToken);
        var usage = await UsageSummariesAsync(pageRows.Select(row => row.Id).ToList(), cancellationToken);
        return new BlogMediaListDto([.. pageRows.Select(row => ToMediaDto(row, usage.GetValueOrDefault(row.Id) ?? new BlogMediaUsageSummaryDto(0, 0, 0)))], page, size, total, watermark);
    }

    public async Task<WebsiteMutationResult<BlogMediaDto>> GetMediaAsync(Guid mediaId, CancellationToken cancellationToken)
    {
        var row = await db.BlogMedia.AsNoTracking().Include(media => media.Variants).SingleOrDefaultAsync(media => media.Id == mediaId, cancellationToken);
        if (row is null)
        {
            return Fail<BlogMediaDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The picture does not exist."));
        }

        var usage = await UsageSummariesAsync([mediaId], cancellationToken);
        return WebsiteMutationResult<BlogMediaDto>.Success(ToMediaDto(row, usage.GetValueOrDefault(mediaId) ?? new BlogMediaUsageSummaryDto(0, 0, 0)));
    }

    private async Task<Dictionary<Guid, BlogMediaUsageSummaryDto>> UsageSummariesAsync(List<Guid> mediaIds, CancellationToken cancellationToken)
    {
        if (mediaIds.Count == 0)
        {
            return [];
        }

        var uses = await (from use in db.BlogRevisionMedia.AsNoTracking()
                          where mediaIds.Contains(use.MediaId)
                          join revision in db.BlogPostRevisions.AsNoTracking() on use.RevisionId equals revision.Id
                          join translation in db.BlogPostTranslations.AsNoTracking() on revision.TranslationId equals translation.Id
                          select new
                          {
                              use.MediaId,
                              Live = translation.Status == BlogTranslationStatus.Published && translation.PublishedRevisionId == revision.Id,
                              Open = revision.State == BlogRevisionState.Draft
                          }).ToListAsync(cancellationToken);
        return uses.GroupBy(use => use.MediaId).ToDictionary(group => group.Key, group => new BlogMediaUsageSummaryDto(group.Count(), group.Count(use => use.Live), group.Count(use => use.Open)));
    }

    private static BlogMediaDto ToMediaDto(BlogMedia row, BlogMediaUsageSummaryDto usage) => new(
        row.Id, row.ContentType, row.ByteSize, row.Width, row.Height, row.CreatedAtUtc, row.DisplayName, row.OriginalFileName, row.Description, row.Credit,
        row.SourceUrl, row.Licence, row.FocalX, row.FocalY, row.Version, row.IsProcessed ? "current" : "legacy", row.OriginalSha256, row.UpdatedAtUtc,
        [.. row.Variants
            .OrderBy(variant => BlogMediaPresets.All.Select(preset => preset.Name).ToList().IndexOf(variant.Preset))
            .ThenBy(variant => variant.Format == BlogMediaFormats.Webp ? 0 : 1)
            .Select(variant => new BlogMediaVariantDto(variant.Preset, variant.Format, variant.ContentType, variant.Width, variant.Height, variant.ByteSize))],
        usage);

    // ---- description, focal point ----

    public async Task<WebsiteMutationResult<BlogMediaDto>> UpdateMediaAsync(UpdateBlogMediaCommand command, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var row = await db.BlogMedia.Include(media => media.Variants).SingleOrDefaultAsync(media => media.Id == command.MediaId, cancellationToken);
        if (row is null)
        {
            return Fail<BlogMediaDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The picture does not exist."));
        }

        if (command.ExpectedVersion != row.Version)
        {
            return Fail<BlogMediaDto>(Stale);
        }

        string displayName = BlogText.Normalize(command.DisplayName), description = BlogText.Normalize(command.Description), credit = BlogText.Normalize(command.Credit);
        string sourceUrl = BlogText.Normalize(command.SourceUrl), licence = BlogText.Normalize(command.Licence);
        if (BlogMediaRules.CheckMetadata(displayName, description, credit, sourceUrl, licence, command.FocalX, command.FocalY) is { } invalid)
        {
            return Fail<BlogMediaDto>(invalid);
        }

        row.UpdateDescription(displayName, description, credit, sourceUrl, licence, command.FocalX, command.FocalY, command.ActorStaffId, clock.GetUtcNow());
        Audit(command.ActorStaffId, "media.update", versionAfter: row.Version, detail: new { id = row.Id });
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogMediaDto>(saved);
        }

        await RecordAsync(AdminMenuKeys.BlogMedia, command.ActorStaffId, "Updated", MediaKind, row.Id.ToString("D"), row.DisplayName, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await HintAsync(AdminMenuKeys.BlogMedia);

        var usage = await UsageSummariesAsync([row.Id], cancellationToken);
        return WebsiteMutationResult<BlogMediaDto>.Success(ToMediaDto(row, usage.GetValueOrDefault(row.Id) ?? new BlogMediaUsageSummaryDto(0, 0, 0)));
    }

    // ---- usage ----

    public async Task<WebsiteMutationResult<BlogMediaUsageDto>> GetMediaUsageAsync(Guid mediaId, CancellationToken cancellationToken)
    {
        if (!await db.BlogMedia.AsNoTracking().AnyAsync(row => row.Id == mediaId, cancellationToken))
        {
            return Fail<BlogMediaUsageDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The picture does not exist."));
        }

        var uses = from use in db.BlogRevisionMedia.AsNoTracking()
                   where use.MediaId == mediaId
                   join revision in db.BlogPostRevisions.AsNoTracking() on use.RevisionId equals revision.Id
                   join translation in db.BlogPostTranslations.AsNoTracking() on revision.TranslationId equals translation.Id
                   select new { revision, translation };
        var total = await uses.CountAsync(cancellationToken);
        var rows = await uses
            .OrderByDescending(use => use.translation.Status == BlogTranslationStatus.Published && use.translation.PublishedRevisionId == use.revision.Id)
            .ThenByDescending(use => use.revision.State == BlogRevisionState.Draft)
            .ThenByDescending(use => use.revision.Number).ThenBy(use => use.revision.Id)
            .Take(BlogMediaLimits.MaxUsageRows)
            .Select(use => new
            {
                use.translation.PostId,
                use.translation.Locale,
                use.translation.Status,
                use.translation.PublishedRevisionId,
                use.revision.Id,
                use.revision.Number,
                use.revision.State,
                use.revision.Title,
                use.revision.CoverMediaId,
                use.revision.OgImageMediaId,
                use.revision.BodyJson
            }).ToListAsync(cancellationToken);

        // The kind comes from the revision's own columns and a structural read of its body, never from searching the JSON text.
        var items = rows.Select(row =>
        {
            var kinds = new List<string>(3);
            if (row.CoverMediaId == mediaId)
            {
                kinds.Add("cover");
            }

            if (row.OgImageMediaId == mediaId)
            {
                kinds.Add("og");
            }

            if (BlogBody.Validate(row.BodyJson).Info?.MediaIds.Contains(mediaId) == true)
            {
                kinds.Add("body");
            }

            return new BlogMediaUseDto(
                row.PostId, row.Locale, row.Status.ToString(), row.Title, row.Id, row.Number, row.State.ToString(),
                row.Status == BlogTranslationStatus.Published && row.PublishedRevisionId == row.Id, kinds);
        }).ToList();
        return WebsiteMutationResult<BlogMediaUsageDto>.Success(new BlogMediaUsageDto(mediaId, total, total > items.Count, items));
    }

    // ---- delete ----

    /// <summary>
    /// A picture still used by any revision (draft, live or kept in history) is refused. The row is locked <c>FOR UPDATE</c> first: a save, publish or restore that
    /// is adding a use of it holds a key-share lock on the row (the foreign key), so the two are ordered — either the use is committed and this sees it (409), or this
    /// removes the row first and the writer's foreign key refuses (<c>blog.media-missing</c>). The files go after the commit; a failure there only leaves orphans.
    /// </summary>
    public async Task<WebsiteMutationResult<bool>> DeleteMediaAsync(DeleteBlogMediaCommand command, CancellationToken cancellationToken)
    {
        List<string> keys;
        await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            var row = (await db.BlogMedia
                .FromSqlInterpolated($"SELECT * FROM \"BlogMedia\" WHERE \"Id\" = {command.MediaId} FOR UPDATE")
                .ToListAsync(cancellationToken)).SingleOrDefault();
            if (row is null)
            {
                return Fail<bool>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The picture does not exist."));
            }

            if (command.ExpectedVersion != row.Version)
            {
                return Fail<bool>(Stale);
            }

            var uses = await db.BlogRevisionMedia.AsNoTracking().CountAsync(use => use.MediaId == row.Id, cancellationToken);
            if (uses > 0)
            {
                return Fail<bool>(new BlogProblem(BlogErrorCodes.MediaInUse, "id", $"{uses} version(s) of articles (published, drafts or past versions) still use this picture."));
            }

            var variants = await db.BlogMediaVariants.Where(variant => variant.MediaId == row.Id).ToListAsync(cancellationToken);
            keys = [row.StorageKey, .. variants.Select(variant => variant.StorageKey)];
            db.BlogMediaVariants.RemoveRange(variants);
            db.BlogMedia.Remove(row);
            Audit(command.ActorStaffId, "media.delete", versionAfter: row.Version, detail: new { id = row.Id, files = keys.Count });
            if (await SaveAsync(cancellationToken) is { } saved)
            {
                return Fail<bool>(saved.Code == BlogErrorCodes.MediaMissing
                    ? new BlogProblem(BlogErrorCodes.MediaInUse, "id", "An article version still uses this picture.")
                    : saved);
            }

            await RecordAsync(AdminMenuKeys.BlogMedia, command.ActorStaffId, "Deleted", MediaKind, row.Id.ToString("D"), row.DisplayName, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        await HintAsync(AdminMenuKeys.BlogMedia);
        await DeleteFilesAsync(keys);
        return WebsiteMutationResult<bool>.Success(true);
    }

    // ---- bytes, for the Admin only ----

    public async Task<BlogMediaFile?> OpenMediaAsync(Guid mediaId, CancellationToken cancellationToken)
    {
        var row = await db.BlogMedia.AsNoTracking().SingleOrDefaultAsync(media => media.Id == mediaId, cancellationToken);
        if (row is null)
        {
            return null;
        }

        var stream = await storage.OpenReadAsync(row.StorageKey, cancellationToken);
        return stream is null ? null : new BlogMediaFile(stream, row.ContentType);
    }

    public async Task<BlogMediaFile?> OpenMediaPreviewAsync(Guid mediaId, string preset, CancellationToken cancellationToken)
    {
        if (!BlogMediaPresets.IsKnown(preset))
        {
            return null;
        }

        var row = await db.BlogMedia.AsNoTracking().Include(media => media.Variants).SingleOrDefaultAsync(media => media.Id == mediaId, cancellationToken);
        if (row is null)
        {
            return null;
        }

        // A picture from before the pipeline has no variants: its original is the preview, as it was in CP01.
        var variant = row.Variants.FirstOrDefault(v => v.Preset == preset && v.Format == BlogMediaFormats.Webp);
        var stream = await storage.OpenReadAsync(variant?.StorageKey ?? row.StorageKey, cancellationToken);
        return stream is null ? null : new BlogMediaFile(stream, variant?.ContentType ?? row.ContentType);
    }
}
