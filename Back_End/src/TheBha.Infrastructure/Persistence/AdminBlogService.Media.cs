using Microsoft.EntityFrameworkCore;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

internal sealed partial class AdminBlogService
{
    public async Task<WebsiteMutationResult<BlogMediaDto>> UploadMediaAsync(Stream content, Guid actorStaffId, CancellationToken cancellationToken)
    {
        if (!storage.IsConfigured)
        {
            return Fail<BlogMediaDto>(new BlogProblem(
                BlogErrorCodes.StorageNotConfigured, "file", "Picture storage is not configured on this server (WebsiteMedia:RootPath), so pictures cannot be uploaded."));
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await content.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > HeroLimits.MaxUploadBytes)
            {
                return WebsiteMutationResult<BlogMediaDto>.Invalid("file", "The picture is larger than 10 MB.") with { Code = HeroErrorCodes.ImageTooLarge };
            }

            buffer.Write(chunk, 0, read);
        }

        var bytes = buffer.GetBuffer().AsMemory(0, (int)buffer.Length);
        var check = HeroImageInspector.Inspect(bytes.Span);
        if (check.Info is not { } info)
        {
            return WebsiteMutationResult<BlogMediaDto>.Invalid("file", check.Message!) with { Code = check.Code };
        }

        if (info.Width < BlogLimits.MinCoverWidth || info.Height < BlogLimits.MinCoverHeight)
        {
            return WebsiteMutationResult<BlogMediaDto>.Invalid(
                "file", $"The picture is {info.Width}×{info.Height}; a Blog picture is at least {BlogLimits.MinCoverWidth}×{BlogLimits.MinCoverHeight}.")
                with { Code = HeroErrorCodes.ImageDimensions };
        }

        var id = Guid.NewGuid();
        var key = $"blog/{id:N}.{info.Extension}";
        await storage.WriteAsync(key, bytes, cancellationToken);
        try
        {
            var row = new BlogMedia(id, key, info.ContentType, bytes.Length, info.Width, info.Height, actorStaffId, clock.GetUtcNow());
            db.BlogMedia.Add(row);
            Audit(actorStaffId, "media.upload", detail: new { id, info.Width, info.Height });
            await db.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<BlogMediaDto>.Success(new BlogMediaDto(row.Id, row.ContentType, row.ByteSize, row.Width, row.Height, row.CreatedAtUtc));
        }
        catch
        {
            await storage.DeleteAsync(key, CancellationToken.None);
            throw;
        }
    }

    public async Task<BlogMediaFile?> OpenMediaAsync(Guid mediaId, CancellationToken cancellationToken)
    {
        var row = await db.BlogMedia.AsNoTracking().SingleOrDefaultAsync(x => x.Id == mediaId, cancellationToken);
        if (row is null)
        {
            return null;
        }

        var stream = await storage.OpenReadAsync(row.StorageKey, cancellationToken);
        return stream is null ? null : new BlogMediaFile(stream, row.ContentType);
    }
}
