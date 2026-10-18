using System.Text.RegularExpressions;
using TheBha.Application.Properties;

namespace TheBha.Infrastructure.CatalogMedia;

// Catalog namespace; atomic file-before-row writes, no deletion of recorded media.
internal sealed partial class LocalCatalogMediaStorage(string? rootPath) : ICatalogMediaStorage
{

    [GeneratedRegex("^catalog/[0-9a-f]{32}\\.(jpg|png|webp)$")]
    private static partial Regex UploadKey();

    public bool IsConfigured => !string.IsNullOrWhiteSpace(rootPath);

    public async Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
    {
        var path = ResolveUpload(key) ?? throw new ArgumentException("Not a catalog upload key.", nameof(key));
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

    public Task<Stream?> OpenAsync(string key, CancellationToken cancellationToken)
    {
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

    public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken)
    {
        var path = ResolveUpload(key);
        return Task.FromResult(path is not null && File.Exists(path));
    }

    public Task DeleteUnrecordedAsync(string key, CancellationToken cancellationToken)
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
