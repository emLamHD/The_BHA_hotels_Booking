using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
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
    public async Task<IReadOnlyList<CatalogPhysicalRoom>?> ListPhysicalRoomsAsync(Guid propertyId, Guid roomTypeId, CancellationToken ct)
    {
        if (!await db.RoomTypes.AsNoTracking().AnyAsync(x => x.Id == roomTypeId && x.PropertyId == propertyId, ct)) return null;
        return await db.PhysicalRooms.AsNoTracking().Where(x => x.PropertyId == propertyId && x.RoomTypeId == roomTypeId)
            .OrderBy(x => x.RoomNumber).Select(x => new CatalogPhysicalRoom(x.Id, x.PropertyId, x.RoomTypeId, x.RoomNumber, x.Floor, x.OperationalStatus.ToString())).ToListAsync(ct);
    }

    public async Task<WebsiteMutationResult<CatalogPropertyChoice>> CreatePropertyAsync(CreateCatalogProperty input, Guid operationId, Guid actor, CancellationToken ct)
    {
        var name = input.Name?.Trim() ?? ""; var slug = NormalizeSlug(input.Slug);
        if (name.Length is 0 or > 200) return WebsiteMutationResult<CatalogPropertyChoice>.Invalid("name", "Tên cơ sở là bắt buộc và tối đa 200 ký tự.");
        if (!ValidSlug(slug)) return WebsiteMutationResult<CatalogPropertyChoice>.Invalid("slug", "Slug chỉ gồm chữ thường không dấu, số và dấu gạch nối.");
        if (string.IsNullOrWhiteSpace(input.Address) || input.Address.Trim().Length > 500) return WebsiteMutationResult<CatalogPropertyChoice>.Invalid("address", "Địa chỉ là bắt buộc và tối đa 500 ký tự.");
        if (string.IsNullOrWhiteSpace(input.City) || input.City.Trim().Length > 120) return WebsiteMutationResult<CatalogPropertyChoice>.Invalid("city", "Thành phố là bắt buộc và tối đa 120 ký tự.");
        if (string.IsNullOrWhiteSpace(input.Country) || input.Country.Trim().Length > 120) return WebsiteMutationResult<CatalogPropertyChoice>.Invalid("country", "Quốc gia là bắt buộc và tối đa 120 ký tự.");
        if (string.IsNullOrWhiteSpace(input.TimeZone) || input.TimeZone.Length > 100 || !TimeZoneExists(input.TimeZone)) return WebsiteMutationResult<CatalogPropertyChoice>.Invalid("timeZone", "Hãy chọn múi giờ hợp lệ.");
        var clean = input with { Name = name, Slug = slug, Description = input.Description?.Trim() };
        if (clean.Description?.Length > 4000) return WebsiteMutationResult<CatalogPropertyChoice>.Invalid("description", "Mô tả tối đa 4000 ký tự.");
        var fingerprint = Fingerprint(clean);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockCreateAsync(actor, operationId, ct);
        var prior = await ExistingOperationAsync(actor, operationId, ct);
        if (prior is not null)
        {
            if (prior.EntityType != "property" || prior.RequestFingerprint != fingerprint) return WebsiteMutationResult<CatalogPropertyChoice>.Conflict("idempotency-key-reused", "Khóa yêu cầu này đã được dùng cho nội dung khác.");
            var found = await db.Properties.AsNoTracking().Where(x => x.Id == prior.EntityId).Select(x => new CatalogPropertyChoice(x.Id, x.Name, x.Slug)).SingleOrDefaultAsync(ct);
            if (found is null) return WebsiteMutationResult<CatalogPropertyChoice>.Conflict("create-outcome-unknown", "Yêu cầu tạo đã ghi nhận nhưng không đọc được cơ sở. Hãy đọc lại trước khi tiếp tục.");
            await tx.CommitAsync(ct); return WebsiteMutationResult<CatalogPropertyChoice>.Success(found);
        }
        var now = clock.GetUtcNow(); var id = Guid.NewGuid();
        var property = new Property(id, clean.Name, clean.Slug, clean.Description, clean.Address.Trim(), clean.City.Trim(), clean.Country.Trim(), clean.TimeZone.Trim(), clean.CheckInTime, clean.CheckOutTime, clean.IsActive, now);
        db.Properties.Add(property);
        db.AdminCatalogCreateOperations.Add(new(operationId, actor, "property", id, id, fingerprint, now));
        db.CatalogContentAudits.Add(new(id, null, actor, now, "create-property", "{}", JsonSerializer.Serialize(clean)));
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return WebsiteMutationResult<CatalogPropertyChoice>.Success(new(id, property.Name, property.Slug)); }
        catch (DbUpdateException e) when (UniqueViolation(e)) { return WebsiteMutationResult<CatalogPropertyChoice>.Conflict("already-exists", "Tên định danh hoặc slug đã được sử dụng.", "slug"); }
    }

    public async Task<WebsiteMutationResult<CatalogProductSummary>> CreateRoomTypeAsync(Guid propertyId, CreateCatalogRoomType input, Guid operationId, Guid actor, CancellationToken ct)
    {
        var code = input.Code?.Trim().ToUpperInvariant() ?? ""; var name = input.Name?.Trim() ?? ""; var slug = NormalizeSlug(input.Slug);
        if (code.Length is 0 or > 50 || !Regex.IsMatch(code, "^[A-Z0-9][A-Z0-9_-]*$")) return WebsiteMutationResult<CatalogProductSummary>.Invalid("code", "Mã loại phòng gồm chữ Latin, số, gạch ngang hoặc gạch dưới; tối đa 50 ký tự.");
        if (name.Length is 0 or > 200) return WebsiteMutationResult<CatalogProductSummary>.Invalid("name", "Tên loại phòng là bắt buộc và tối đa 200 ký tự.");
        if (!ValidSlug(slug)) return WebsiteMutationResult<CatalogProductSummary>.Invalid("slug", "Slug chỉ gồm chữ thường không dấu, số và dấu gạch nối.");
        if (input.BaseOccupancy <= 0 || input.MaxOccupancy < input.BaseOccupancy) return WebsiteMutationResult<CatalogProductSummary>.Invalid("occupancy", "Sức chứa tiêu chuẩn phải lớn hơn 0 và tối đa không nhỏ hơn tiêu chuẩn.");
        if (input.AreaSquareMeters is <= 0 or > 10000 || input.Bedrooms is < 0 or > 100 || input.BedDescription?.Length > 500) return WebsiteMutationResult<CatalogProductSummary>.Invalid("details", "Diện tích, phòng ngủ hoặc mô tả giường không hợp lệ.");
        if (input.Description?.Length > 4000) return WebsiteMutationResult<CatalogProductSummary>.Invalid("description", "Mô tả tối đa 4000 ký tự.");
        var clean = input with { Code = code, Name = name, Slug = slug, Description = input.Description?.Trim(), BedDescription = input.BedDescription?.Trim() };
        var fingerprint = Fingerprint(new { propertyId, request = clean });
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockCreateAsync(actor, operationId, ct);
        var prior = await ExistingOperationAsync(actor, operationId, ct);
        if (prior is not null)
        {
            if (prior.EntityType != "room-type" || prior.RequestFingerprint != fingerprint) return WebsiteMutationResult<CatalogProductSummary>.Conflict("idempotency-key-reused", "Khóa yêu cầu này đã được dùng cho nội dung khác.");
            var result = (await ListProductsAsync(propertyId, ct)).SingleOrDefault(x => x.RoomTypeId == prior.EntityId);
            if (result is null) return WebsiteMutationResult<CatalogProductSummary>.Conflict("create-outcome-unknown", "Yêu cầu tạo đã ghi nhận nhưng không đọc được loại phòng.");
            await tx.CommitAsync(ct); return WebsiteMutationResult<CatalogProductSummary>.Success(result);
        }
        if (!await db.Properties.AnyAsync(x => x.Id == propertyId, ct)) return WebsiteMutationResult<CatalogProductSummary>.NotFound("Cơ sở không tồn tại.");
        var now = clock.GetUtcNow(); var room = new RoomType(Guid.NewGuid(), propertyId, code, name, slug, clean.Description, clean.BaseOccupancy, clean.MaxOccupancy, clean.IsActive, now, clean.AreaSquareMeters, clean.Bedrooms, clean.BedDescription);
        db.RoomTypes.Add(room); db.CatalogContentAudits.Add(new(propertyId, room.Id, actor, now, "create-room-type", "{}", JsonSerializer.Serialize(clean)));
        db.AdminCatalogCreateOperations.Add(new(operationId, actor, "room-type", room.Id, propertyId, fingerprint, now));
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return WebsiteMutationResult<CatalogProductSummary>.Success(new(propertyId, room.Id, room.Code, room.Name, room.Description, room.BaseOccupancy, room.MaxOccupancy, 0, 0, null, null, room.IsActive)); }
        catch (DbUpdateException e) when (UniqueViolation(e)) { return WebsiteMutationResult<CatalogProductSummary>.Conflict("already-exists", "Mã hoặc slug loại phòng đã tồn tại trong cơ sở này.", "code"); }
    }

    public async Task<WebsiteMutationResult<CatalogPhysicalRoom>> CreatePhysicalRoomAsync(Guid propertyId, Guid roomTypeId, CreateCatalogPhysicalRoom input, Guid operationId, Guid actor, CancellationToken ct)
    {
        var number = input.RoomNumber?.Trim() ?? "";
        if (number.Length is 0 or > 50) return WebsiteMutationResult<CatalogPhysicalRoom>.Invalid("roomNumber", "Số phòng là bắt buộc và tối đa 50 ký tự.");
        if (!Enum.TryParse<OperationalStatus>(input.OperationalStatus, true, out var status) || !Enum.IsDefined(status)) return WebsiteMutationResult<CatalogPhysicalRoom>.Invalid("operationalStatus", "Trạng thái phải là Active, Inactive hoặc OutOfService.");
        var clean = input with { RoomNumber = number, OperationalStatus = status.ToString() };
        var fingerprint = Fingerprint(new { propertyId, roomTypeId, request = clean });
        await using var tx = await db.Database.BeginTransactionAsync(ct); await LockCreateAsync(actor, operationId, ct);
        var prior = await ExistingOperationAsync(actor, operationId, ct);
        if (prior is not null)
        {
            if (prior.EntityType != "physical-room" || prior.RequestFingerprint != fingerprint) return WebsiteMutationResult<CatalogPhysicalRoom>.Conflict("idempotency-key-reused", "Khóa yêu cầu này đã được dùng cho nội dung khác.");
            var result = await db.PhysicalRooms.AsNoTracking().Where(x => x.Id == prior.EntityId && x.PropertyId == propertyId && x.RoomTypeId == roomTypeId)
                .Select(x => new CatalogPhysicalRoom(x.Id, x.PropertyId, x.RoomTypeId, x.RoomNumber, x.Floor, x.OperationalStatus.ToString())).SingleOrDefaultAsync(ct);
            if (result is null) return WebsiteMutationResult<CatalogPhysicalRoom>.Conflict("create-outcome-unknown", "Yêu cầu tạo đã ghi nhận nhưng không đọc được phòng.");
            await tx.CommitAsync(ct); return WebsiteMutationResult<CatalogPhysicalRoom>.Success(result);
        }
        var roomType = await db.RoomTypes.SingleOrDefaultAsync(x => x.Id == roomTypeId && x.PropertyId == propertyId, ct);
        if (roomType is null) return WebsiteMutationResult<CatalogPhysicalRoom>.NotFound("Loại phòng không thuộc cơ sở đã chọn.");
        var now = clock.GetUtcNow(); var room = new PhysicalRoom(Guid.NewGuid(), propertyId, roomType, number, input.Floor, status, now);
        db.PhysicalRooms.Add(room); db.CatalogContentAudits.Add(new(propertyId, roomTypeId, actor, now, "create-physical-room", "{}", JsonSerializer.Serialize(new { id = room.Id, room.RoomNumber, room.Floor, operationalStatus = status.ToString() })));
        db.AdminCatalogCreateOperations.Add(new(operationId, actor, "physical-room", room.Id, propertyId, fingerprint, now));
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return WebsiteMutationResult<CatalogPhysicalRoom>.Success(new(room.Id, propertyId, roomTypeId, room.RoomNumber, room.Floor, status.ToString())); }
        catch (DbUpdateException e) when (UniqueViolation(e)) { return WebsiteMutationResult<CatalogPhysicalRoom>.Conflict("already-exists", "Số phòng này đã được dùng trong cơ sở.", "roomNumber"); }
    }

    private async Task LockCreateAsync(Guid actor, Guid operationId, CancellationToken ct) =>
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({actor.ToString() + ":" + operationId.ToString()}, 0))", ct);
    private Task<AdminCatalogCreateOperation?> ExistingOperationAsync(Guid actor, Guid operationId, CancellationToken ct) =>
        db.AdminCatalogCreateOperations.AsNoTracking().SingleOrDefaultAsync(x => x.ActorStaffId == actor && x.OperationId == operationId, ct);
    private static string Fingerprint<T>(T value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value)))).ToLowerInvariant();
    private static string NormalizeSlug(string? value) => (value ?? "").Trim().ToLowerInvariant();
    private static bool ValidSlug(string value) => value.Length is > 0 and <= 200 && Regex.IsMatch(value, "^[a-z0-9]+(?:-[a-z0-9]+)*$");
    private static bool TimeZoneExists(string value) { try { _ = TimeZoneInfo.FindSystemTimeZoneById(value); return true; } catch (TimeZoneNotFoundException) { return false; } catch (InvalidTimeZoneException) { return false; } }
    private static bool UniqueViolation(DbUpdateException e) => e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
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
