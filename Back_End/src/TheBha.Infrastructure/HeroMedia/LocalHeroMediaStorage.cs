using System.Text.RegularExpressions;
using TheBha.Application.Website;

namespace TheBha.Infrastructure.HeroMedia;

/// <summary>
/// CUST-WEB-HERO-001-CP01: <see cref="IHeroMediaStorage"/> on a directory the host provides (<c>WebsiteMedia:RootPath</c>), outside the
/// source and the build output. A file is written to a temporary name in the same directory, flushed to disk, then renamed to its
/// final name, so a reader (and the database row that comes after) never sees a half-written picture. Keys are validated to the two
/// shapes the application generates, and the resolved path must stay under the root, so no key can reach another path. The
/// <c>seed/</c> keys are the pictures embedded in this assembly. Nothing here deletes a recorded picture.
/// </summary>
internal sealed partial class LocalHeroMediaStorage(string? rootPath) : IHeroMediaStorage
{
    private const string SeedResourcePrefix = "bha-hero-seed/";

    [GeneratedRegex("^hero/[0-9a-f]{32}\\.(jpg|png|webp)$")]
    private static partial Regex UploadKey();

    [GeneratedRegex("^seed/hero-[a-z0-9]+(-[a-z0-9]+)*\\.webp$")]
    private static partial Regex SeedKey();

    public bool IsConfigured => !string.IsNullOrWhiteSpace(rootPath);

    public async Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
    {
        var path = ResolveUpload(key) ?? throw new ArgumentException("Not a hero upload key.", nameof(key));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                await file.WriteAsync(content, cancellationToken);
                await file.FlushAsync(cancellationToken);
                file.Flush(true);
            }

            File.Move(temporary, path, overwrite: false);
        }
        catch
        {
            TryDelete(temporary);
            throw;
        }
    }

    public Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        if (SeedKey().IsMatch(key))
        {
            return Task.FromResult(typeof(LocalHeroMediaStorage).Assembly.GetManifestResourceStream(SeedResourcePrefix + key["seed/".Length..]));
        }

        var path = ResolveUpload(key);
        if (path is null || !File.Exists(path))
        {
            return Task.FromResult<Stream?>(null);
        }

        try
        {
            return Task.FromResult<Stream?>(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan));
        }
        catch (FileNotFoundException)
        {
            return Task.FromResult<Stream?>(null);
        }
    }

    public async Task<bool> ExistsAsync(string key, CancellationToken cancellationToken)
    {
        if (SeedKey().IsMatch(key))
        {
            await using var seed = await OpenReadAsync(key, cancellationToken);
            return seed is not null;
        }

        var path = ResolveUpload(key);
        return path is not null && File.Exists(path);
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        if (ResolveUpload(key) is { } path)
        {
            TryDelete(path);
        }

        return Task.CompletedTask;
    }

    private string? ResolveUpload(string key)
    {
        if (!IsConfigured || !UploadKey().IsMatch(key))
        {
            return null;
        }

        var root = Path.GetFullPath(rootPath!);
        var full = Path.GetFullPath(Path.Combine(root, key));
        return full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal) ? full : null;
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
