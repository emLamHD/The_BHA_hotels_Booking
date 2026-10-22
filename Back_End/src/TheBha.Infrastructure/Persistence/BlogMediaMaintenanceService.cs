using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-BLOG-001-CP02: the operator's picture maintenance. It does two things, each safe to run again: it gives a picture uploaded before CP02 (generation 0) its variants, and it
/// finds the files in <c>blog/</c> that nothing refers to — left by a crash between writing files and saving the row, or by a delete whose file removal failed. Without
/// <c>apply</c> nothing is written or deleted, but every picture is still decoded, so a dry run shows what a real run would refuse. A picture is never changed except by adding
/// its variants; its original file, id, key, descriptive fields and <see cref="BlogMedia.Version"/> stay. The operator, not a Staff session, runs it, so it appends no audit row
/// (the audit needs a Staff id); its report is the record.
/// </summary>
internal sealed class BlogMediaMaintenanceService(
    TheBhaDbContext db, IHeroMediaStorage storage, IBlogImagePipeline pipeline, TimeProvider clock, ILogger<BlogMediaMaintenanceService> logger) : IBlogMediaMaintenance
{
    public async Task<BlogMediaMaintenanceReport> RunAsync(bool apply, TimeSpan grace, CancellationToken cancellationToken)
    {
        var problems = new List<string>();
        var (legacy, processed) = await BackfillAsync(apply, problems, cancellationToken);
        var (orphans, removed, stale) = await SweepAsync(apply, grace, problems, cancellationToken);
        return new BlogMediaMaintenanceReport(legacy, processed, orphans, removed, stale, problems);
    }

    private async Task<(int Legacy, int Processed)> BackfillAsync(bool apply, List<string> problems, CancellationToken cancellationToken)
    {
        var ids = await db.BlogMedia.AsNoTracking().Where(row => row.Generation == 0)
            .OrderBy(row => row.CreatedAtUtc).ThenBy(row => row.Id).Select(row => row.Id).ToListAsync(cancellationToken);
        var processed = 0;
        foreach (var id in ids)
        {
            db.ChangeTracker.Clear();
            var row = await db.BlogMedia.SingleOrDefaultAsync(media => media.Id == id, cancellationToken);
            if (row is null || row.Generation != 0)
            {
                continue;
            }

            var written = new List<string>();
            try
            {
                var bytes = await ReadOriginalAsync(row.StorageKey, cancellationToken);
                if (bytes is null)
                {
                    problems.Add($"{id}: the original file {row.StorageKey} is missing or too large; restore it from the backup, then run again.");
                    continue;
                }

                var check = HeroImageInspector.Inspect(bytes.Value.Span);
                if (check.Info is not { } info)
                {
                    problems.Add($"{id}: the original is not a usable picture ({check.Code}).");
                    continue;
                }

                var (image, problem) = await pipeline.ProcessAsync(bytes.Value, info, cancellationToken);
                if (image is null)
                {
                    problems.Add($"{id}: the original could not be processed ({problem!.Code}).");
                    continue;
                }

                if (!apply)
                {
                    continue;
                }

                var variants = new List<BlogMediaVariant>(image.Variants.Count);
                foreach (var variant in image.Variants)
                {
                    var key = $"blog/{Guid.NewGuid():N}.{variant.Format}";
                    await storage.WriteAsync(key, variant.Bytes, cancellationToken);
                    written.Add(key);
                    variants.Add(new BlogMediaVariant(
                        Guid.NewGuid(), id, variant.Preset, variant.Format, key, variant.Width, variant.Height, variant.Bytes.Length, Convert.ToHexString(SHA256.HashData(variant.Bytes)).ToLowerInvariant()));
                }

                // Added explicitly: a new child with its key already set, put into the collection of a tracked parent, would otherwise be taken for an existing row (an UPDATE of nothing).
                db.BlogMediaVariants.AddRange(variants);
                row.CompleteProcessing(image.Width, image.Height, Convert.ToHexString(SHA256.HashData(bytes.Value.Span)).ToLowerInvariant(), variants);
                try
                {
                    await db.SaveChangesAsync(CancellationToken.None);
                    processed++;
                    written.Clear();
                }
                catch (DbUpdateConcurrencyException)
                {
                    // Edited or deleted while it was being processed: nothing was saved; the new files go and the picture is picked up by the next run.
                    problems.Add($"{id}: it changed while being processed; run again.");
                }
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(exception, "Blog picture {Id} could not be processed.", id);
                problems.Add($"{id}: processing failed ({exception.GetType().Name}); nothing was changed for it.");
            }
            finally
            {
                foreach (var key in written)
                {
                    await storage.DeleteAsync(key, CancellationToken.None);
                }
            }
        }

        db.ChangeTracker.Clear();
        return (ids.Count, processed);
    }

    private async Task<ReadOnlyMemory<byte>?> ReadOriginalAsync(string key, CancellationToken cancellationToken)
    {
        await using var stream = await storage.OpenReadAsync(key, cancellationToken);
        if (stream is null)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > HeroLimits.MaxUploadBytes)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    private async Task<(int Orphans, int Removed, int Stale)> SweepAsync(bool apply, TimeSpan grace, List<string> problems, CancellationToken cancellationToken)
    {
        var known = (await db.BlogMedia.AsNoTracking().Select(row => row.StorageKey).ToListAsync(cancellationToken))
            .Concat(await db.BlogMediaVariants.AsNoTracking().Select(variant => variant.StorageKey).ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);
        int orphans = 0, removed = 0, stale = 0;
        var now = clock.GetUtcNow();
        await foreach (var file in storage.ListAsync("blog/", cancellationToken))
        {
            // A file younger than the grace period may belong to an upload that has written its files and not yet saved its row.
            if (now - file.LastWriteUtc < grace || (!file.IsTemporary && known.Contains(file.Key)))
            {
                continue;
            }

            if (file.IsTemporary)
            {
                stale++;
            }
            else
            {
                orphans++;
            }

            if (!apply)
            {
                continue;
            }

            await storage.DeleteAsync(file.Key, cancellationToken);
            if (await storage.ExistsAsync(file.Key, cancellationToken))
            {
                problems.Add($"{file.Key}: could not be removed.");
            }
            else if (!file.IsTemporary)
            {
                removed++;
            }
        }

        return (orphans, removed, stale);
    }
}
