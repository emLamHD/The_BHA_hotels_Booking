using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Properties;
using TheBha.Application.Website;
using TheBha.Domain.Properties;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Persistence.Demo;

namespace TheBha.Infrastructure.Persistence;

internal sealed class AdminCatalogService(TheBhaDbContext db, ICatalogMediaStorage storage, ICatalogImageDecoder decoder, TimeProvider clock) : IAdminCatalog
{
    public async Task<IReadOnlyList<CatalogPropertyChoice>> ListAsync(CancellationToken ct) =>
        await db.Properties.AsNoTracking().OrderBy(x => x.Name).Select(x => new CatalogPropertyChoice(x.Id, x.Name, x.Slug)).ToListAsync(ct);

    public async Task<IReadOnlyList<CatalogProductSummary>> ListProductsAsync(Guid propertyId, CancellationToken ct)
    {
        var products = await db.RoomTypes.AsNoTracking().Where(x => x.PropertyId == propertyId).OrderBy(x => x.Code)
            .Select(x => new
            {
                x.PropertyId, RoomTypeId = x.Id, x.Code, x.Name, x.Description, x.BaseOccupancy, x.MaxOccupancy, x.IsActive,
                PhysicalRoomCount = db.PhysicalRooms.Count(room => room.PropertyId == propertyId && room.RoomTypeId == x.Id),
                GalleryCount = db.RoomTypeMedia.Count(link => link.RoomTypeId == x.Id),
            }).ToListAsync(ct);
        if (products.Count == 0) return [];

        var ids = products.Select(x => x.RoomTypeId).ToArray();
        var covers = await db.RoomTypeMedia.AsNoTracking().Where(link => ids.Contains(link.RoomTypeId) && link.IsCover)
            .Select(link => new { link.RoomTypeId, link.MediaId, AltText = link.AltTextOverride ?? link.Media.AltText })
            .ToDictionaryAsync(x => x.RoomTypeId, ct);
        return products.Select(x =>
        {
            covers.TryGetValue(x.RoomTypeId, out var cover);
            return new CatalogProductSummary(
                x.PropertyId, x.RoomTypeId, x.Code, x.Name, x.Description, x.BaseOccupancy, x.MaxOccupancy,
                x.PhysicalRoomCount, x.GalleryCount, cover?.MediaId, cover?.AltText, x.IsActive);
        }).ToList();
    }

    public async Task<CatalogEditorDto?> GetAsync(Guid propertyId, Guid? roomTypeId, CancellationToken ct)
    {
        var p = await db.Properties.AsNoTracking().SingleOrDefaultAsync(x => x.Id == propertyId, ct);
        if (p is null) return null;
        var r = roomTypeId is null ? null : await db.RoomTypes.AsNoTracking().SingleOrDefaultAsync(x => x.PropertyId == propertyId && x.Id == roomTypeId, ct);
        if (roomTypeId is not null && r is null) return null;
        var gallery = roomTypeId is null
            ? await db.PropertyMedia.AsNoTracking().Where(x => x.PropertyId == propertyId).OrderBy(x => x.SortOrder).ThenBy(x => x.MediaId)
                .Select(x => new CatalogGalleryItem(x.MediaId, x.Media.Url, x.AltTextOverride ?? x.Media.AltText, x.IsCover)).ToListAsync(ct)
            : await db.RoomTypeMedia.AsNoTracking().Where(x => x.RoomTypeId == roomTypeId).OrderBy(x => x.SortOrder).ThenBy(x => x.MediaId)
                .Select(x => new CatalogGalleryItem(x.MediaId, x.Media.Url, x.AltTextOverride ?? x.Media.AltText, x.IsCover)).ToListAsync(ct);
        var prefix = ContentKey.For(r is null ? "property" : "roomType", (roomTypeId ?? propertyId).ToString(), "");
        return new CatalogEditorDto(propertyId, roomTypeId, r?.ContentVersion ?? p.ContentVersion, ContentSource.Locale,
            r?.Name ?? p.Name, r is null ? p.Description : r.Description, r?.Slug ?? p.Slug, r?.Code,
            p.Address, p.City, p.Country, r?.AreaSquareMeters, r?.Bedrooms, r?.BedDescription,
            r?.BaseOccupancy, r?.MaxOccupancy,
            await db.PhysicalRooms.CountAsync(x => x.PropertyId == propertyId && (roomTypeId == null || x.RoomTypeId == roomTypeId), ct),
            r?.IsActive ?? p.IsActive, p.TimeZone, p.CheckInTime, p.CheckOutTime,
            r?.UpdatedAt ?? p.UpdatedAt, r is null ? p.ContentUpdatedByStaffId : r.ContentUpdatedByStaffId,
            await db.RoomTypes.AsNoTracking().Where(x => x.PropertyId == propertyId).OrderBy(x => x.Code).Select(x => new CatalogRoomChoice(x.Id, x.Code, x.Name)).ToListAsync(ct),
            gallery,
            roomTypeId is null ? await db.PropertyAmenities.Where(x => x.PropertyId == propertyId).Select(x => x.AmenityId).ToListAsync(ct)
                : await db.RoomTypeAmenities.Where(x => x.RoomTypeId == roomTypeId).Select(x => x.AmenityId).ToListAsync(ct),
            await db.Amenities.AsNoTracking().Where(x => x.IsActive).OrderBy(x => x.Category).ThenBy(x => x.Name).Select(x => new AmenityDto(x.Id, x.Code, x.Name, x.Category)).ToListAsync(ct),
            await db.WebsiteTranslations.AsNoTracking().Where(x => x.Key.StartsWith(prefix)).Select(x => x.Key).Distinct().ToListAsync(ct));
    }

    public async Task<WebsiteMutationResult<CatalogEditorDto>> SaveAsync(Guid propertyId, Guid? roomTypeId, SaveCatalogContent input, Guid actor, CancellationToken ct)
    {
        var problem = CatalogValidation.Validate(input, roomTypeId is not null);
        if (problem is not null) return WebsiteMutationResult<CatalogEditorDto>.Invalid(problem.Value.Field, problem.Value.Message);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var before = await GetAsync(propertyId, roomTypeId, ct);
        if (before is null) return WebsiteMutationResult<CatalogEditorDto>.NotFound("Catalog owner not found.");
        if (input.ExpectedVersion != before.Version) return Stale();
        var mediaIds = input.Gallery!.Select(x => x.MediaId).ToHashSet();
        var linked = before.Gallery.Select(x => x.MediaId).ToHashSet();
        var uploads = await db.CatalogUploads.AsNoTracking().Where(x => mediaIds.Contains(x.MediaId)).ToListAsync(ct);
        var own = uploads.Where(x => x.PropertyId == propertyId && x.RoomTypeId == roomTypeId).ToList();
        if (mediaIds.Any(id => !linked.Contains(id) && !own.Any(x => x.MediaId == id)))
            return WebsiteMutationResult<CatalogEditorDto>.Invalid("gallery", "Picture does not belong to this editor.");
        foreach (var upload in uploads)
            if (!await storage.ExistsAsync(upload.StorageKey, ct))
                return WebsiteMutationResult<CatalogEditorDto>.Conflict("catalog-media-missing", "A picture file is missing. Restore storage or remove its link.", "gallery");
        var amenities = input.AmenityIds!.ToHashSet();
        var allowedAmenities = await db.Amenities.Where(x => x.IsActive || before.AmenityIds.Contains(x.Id)).Select(x => x.Id).ToListAsync(ct);
        if (amenities.Except(allowedAmenities).Any()) return WebsiteMutationResult<CatalogEditorDto>.Invalid("amenityIds", "Unknown or inactive amenity.");
        var now = clock.GetUtcNow();
        if (roomTypeId is null)
        {
            var p = await db.Properties.SingleAsync(x => x.Id == propertyId, ct);
            // Set the original token from the read: a racing Save must roll this entire transaction back.
            db.Entry(p).Property(x => x.ContentVersion).OriginalValue = input.ExpectedVersion;
            p.EditContent(input.Name!, input.Description, input.Address ?? "", input.City ?? "", input.Country ?? "", actor, now);
            await db.PropertyMedia.Where(x => x.PropertyId == propertyId).ExecuteDeleteAsync(ct);
            await db.PropertyAmenities.Where(x => x.PropertyId == propertyId).ExecuteDeleteAsync(ct);
            db.PropertyMedia.AddRange(input.Gallery!.Select((x, i) => new PropertyMedia(propertyId, x.MediaId, i, x.IsCover, x.AltText ?? "")));
            db.PropertyAmenities.AddRange(amenities.Select(id => new PropertyAmenity(propertyId, id)));
        }
        else
        {
            var r = await db.RoomTypes.SingleAsync(x => x.Id == roomTypeId && x.PropertyId == propertyId, ct);
            db.Entry(r).Property(x => x.ContentVersion).OriginalValue = input.ExpectedVersion;
            r.EditContent(input.Name!, input.Description, input.AreaSquareMeters, input.Bedrooms, input.BedDescription, actor, now);
            await db.RoomTypeMedia.Where(x => x.RoomTypeId == roomTypeId).ExecuteDeleteAsync(ct);
            await db.RoomTypeAmenities.Where(x => x.RoomTypeId == roomTypeId).ExecuteDeleteAsync(ct);
            db.RoomTypeMedia.AddRange(input.Gallery!.Select((x, i) => new RoomTypeMedia(roomTypeId.Value, x.MediaId, i, x.IsCover, x.AltText ?? "")));
            db.RoomTypeAmenities.AddRange(amenities.Select(id => new RoomTypeAmenity(roomTypeId.Value, id)));
        }
        try
        {
            await db.SaveChangesAsync(ct);
            var after = (await GetAsync(propertyId, roomTypeId, ct))!;
            db.CatalogContentAudits.Add(new CatalogContentAudit(propertyId, roomTypeId, actor, now, "save", JsonSerializer.Serialize(before), JsonSerializer.Serialize(after)));
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return WebsiteMutationResult<CatalogEditorDto>.Success(after);
        }
        catch (DbUpdateConcurrencyException) { return Stale(); }
    }

    private static WebsiteMutationResult<CatalogEditorDto> Stale() => WebsiteMutationResult<CatalogEditorDto>.Conflict("stale-version", "This editor changed in another tab. Read the server before saving again.");

    public async Task<WebsiteMutationResult<CatalogGalleryItem>> UploadAsync(Guid propertyId, Guid? roomTypeId, Stream stream, string publicOrigin, Guid actor, CancellationToken ct)
    {
        if (await GetAsync(propertyId, roomTypeId, ct) is null) return WebsiteMutationResult<CatalogGalleryItem>.NotFound("Catalog owner not found.");
        if (!storage.IsConfigured) return WebsiteMutationResult<CatalogGalleryItem>.Conflict("catalog-storage-not-configured", "WebsiteMedia:RootPath is not configured.");
        using var buffer = new MemoryStream();
        var chunk = new byte[65536];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > CatalogLimits.MaxUploadBytes) return WebsiteMutationResult<CatalogGalleryItem>.Invalid("file", "Picture exceeds 10 MB.");
            buffer.Write(chunk, 0, read);
        }
        var bytes = buffer.ToArray();
        var info = decoder.Inspect(bytes);
        if (info is null) return WebsiteMutationResult<CatalogGalleryItem>.Invalid("file", "Choose a valid still JPEG, PNG or WebP (1–8000 px per side, at most 32 megapixels).");
        var id = Guid.NewGuid();
        var key = $"catalog/{id:N}.{info.Extension}";
        await storage.WriteAsync(key, bytes, ct);
        try
        {
            var url = $"{publicOrigin}/api/v1/catalog-media/{id}";
            db.Media.Add(new Media(id, url, null, MediaType.Image, clock.GetUtcNow()));
            db.CatalogUploads.Add(new CatalogUpload(id, propertyId, roomTypeId, key, info.ContentType));
            db.CatalogContentAudits.Add(new CatalogContentAudit(propertyId, roomTypeId, actor, clock.GetUtcNow(), "upload", "{}", JsonSerializer.Serialize(new { mediaId = id, key })));
            await db.SaveChangesAsync(ct);
            return WebsiteMutationResult<CatalogGalleryItem>.Success(new(id, url, "", false));
        }
        catch
        {
            // A failure after PostgreSQL committed (for example, a lost acknowledgement)
            // is indistinguishable from a failed write at this call site. Only remove the
            // bytes when a fresh database read confirms that no metadata row committed.
            // If the database cannot answer, retain the file rather than breaking a
            // possibly committed Media reference.
            try
            {
                var recorded = await db.CatalogUploads.AsNoTracking().AnyAsync(x => x.MediaId == id, CancellationToken.None);
                if (!recorded) await storage.DeleteUnrecordedAsync(key, CancellationToken.None);
            }
            catch
            {
                // Unknown commit state: leave an unlinked file for later operational cleanup.
            }
            throw;
        }
    }

    public async Task<WebsiteMutationResult<AmenityDto>> AddAmenityAsync(Guid propertyId, CreateCatalogAmenity input, Guid actor, CancellationToken ct)
    {
        if (!await db.Properties.AnyAsync(x => x.Id == propertyId, ct)) return WebsiteMutationResult<AmenityDto>.NotFound("Property not found.");
        if (string.IsNullOrWhiteSpace(input.Code) || input.Code.Length > 50 || !System.Text.RegularExpressions.Regex.IsMatch(input.Code, "^[A-Za-z0-9][A-Za-z0-9_-]*$") ||
            string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 200 || string.IsNullOrWhiteSpace(input.Category) || input.Category.Length > 100)
            return WebsiteMutationResult<AmenityDto>.Invalid("amenity", "Code (letters/digits/-/_), name and category are required (50/200/100 characters).");
        var item = new Amenity(Guid.NewGuid(), input.Code, input.Name, input.Category, true);
        db.Amenities.Add(item);
        db.CatalogContentAudits.Add(new CatalogContentAudit(propertyId, null, actor, clock.GetUtcNow(), "create-amenity", "{}", JsonSerializer.Serialize(item)));
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        { return WebsiteMutationResult<AmenityDto>.Conflict("already-exists", "Amenity code already exists."); }
        return WebsiteMutationResult<AmenityDto>.Success(new(item.Id, item.Code, item.Name, item.Category));
    }

    public async Task<CatalogMediaFile?> OpenAsync(Guid propertyId, Guid? roomTypeId, Guid mediaId, CancellationToken ct)
    {
        if (!await db.Properties.AnyAsync(x => x.Id == propertyId, ct) ||
            (roomTypeId.HasValue && !await db.RoomTypes.AnyAsync(x => x.Id == roomTypeId && x.PropertyId == propertyId, ct))) return null;
        var upload = await db.CatalogUploads.AsNoTracking().SingleOrDefaultAsync(x => x.MediaId == mediaId && x.PropertyId == propertyId && x.RoomTypeId == roomTypeId, ct);
        if (upload is not null)
        {
            var file = await storage.OpenAsync(upload.StorageKey, ct);
            return file is null ? null : new(file, upload.ContentType);
        }
        var linkedUrl = roomTypeId is null
            ? await db.PropertyMedia.AsNoTracking().Where(x => x.PropertyId == propertyId && x.MediaId == mediaId)
                .Select(x => x.Media.Url).SingleOrDefaultAsync(ct)
            : await db.RoomTypeMedia.AsNoTracking().Where(x => x.RoomTypeId == roomTypeId && x.MediaId == mediaId)
                .Select(x => x.Media.Url).SingleOrDefaultAsync(ct);
        if (linkedUrl is null) return null;
        // Only repository-controlled legacy bytes. Never fetch a Media.Url or resolve a client path.
        // Existing catalog Media IDs can differ from the manifest IDs when rows were deduplicated by URL.
        var seed = RiversideDemoCatalog.Media.SingleOrDefault(x => IsSeedMediaUrl(linkedUrl, x.FileName));
        var stream = seed is null ? null : typeof(AdminCatalogService).Assembly.GetManifestResourceStream("bha-catalog-seed/" + seed.FileName);
        return stream is null ? null : new(stream, "image/webp");
    }

    private static bool IsSeedMediaUrl(string url, string fileName) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
        (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) &&
        string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment) &&
        string.Equals(uri.AbsolutePath, RiversideDemoCatalog.MediaPathPrefix + fileName, StringComparison.Ordinal);

    public async Task<CatalogMediaFile?> OpenPublicAsync(Guid mediaId, CancellationToken ct)
    {
        var upload = await db.CatalogUploads.AsNoTracking().SingleOrDefaultAsync(x => x.MediaId == mediaId, ct);
        if (upload is null) return null;
        var linked = upload.RoomTypeId is null ? await db.PropertyMedia.AnyAsync(x => x.PropertyId == upload.PropertyId && x.MediaId == mediaId, ct)
            : await db.RoomTypeMedia.AnyAsync(x => x.RoomTypeId == upload.RoomTypeId && x.MediaId == mediaId, ct);
        if (!linked) return null;
        var stream = await storage.OpenAsync(upload.StorageKey, ct);
        return stream is null ? null : new(stream, upload.ContentType);
    }
}
