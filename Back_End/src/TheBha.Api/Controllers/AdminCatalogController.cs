using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Cors;
using TheBha.Api.Authentication;
using TheBha.Application.Properties;
using TheBha.Application.Website;

namespace TheBha.Api.Controllers;

[Route("api/admin/v1/catalog")]
public sealed class AdminCatalogController(IAdminCatalog catalog) : AdminWebsiteControllerBase
{
    public const string CreateCorsPolicy = "admin-staff-catalog-create";

    [HttpGet("properties")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<IActionResult> Properties(CancellationToken ct) => Ok(await catalog.ListAsync(ct));

    [HttpGet("properties/{propertyId:guid}/products")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<IActionResult> Products(Guid propertyId, CancellationToken ct) => Ok(await catalog.ListProductsAsync(propertyId, ct));

    [HttpGet("properties/{propertyId:guid}/room-types/{roomTypeId:guid}/physical-rooms")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<IActionResult> PhysicalRooms(Guid propertyId, Guid roomTypeId, CancellationToken ct)
    {
        var rooms = await catalog.ListPhysicalRoomsAsync(propertyId, roomTypeId, ct);
        return rooms is null ? NotFound() : Ok(rooms);
    }

    [HttpPost("properties")]
    [EnableCors(CreateCorsPolicy)]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> CreateProperty([FromBody] CreateCatalogProperty request, [FromHeader(Name = "Idempotency-Key")] Guid? operationId, CancellationToken ct)
    {
        if (operationId is null || operationId == Guid.Empty) return Fail(400, "Invalid request", "idempotency-key-required", "Idempotency-Key", "A unique request key is required.");
        return Respond(await catalog.CreatePropertyAsync(request, operationId.Value, ActorStaffId, ct), saved => Ok(saved));
    }

    [HttpPost("properties/{propertyId:guid}/room-types")]
    [EnableCors(CreateCorsPolicy)]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> CreateRoomType(Guid propertyId, [FromBody] CreateCatalogRoomType request, [FromHeader(Name = "Idempotency-Key")] Guid? operationId, CancellationToken ct)
    {
        if (operationId is null || operationId == Guid.Empty) return Fail(400, "Invalid request", "idempotency-key-required", "Idempotency-Key", "A unique request key is required.");
        return Respond(await catalog.CreateRoomTypeAsync(propertyId, request, operationId.Value, ActorStaffId, ct), saved => Ok(saved));
    }

    [HttpPost("properties/{propertyId:guid}/room-types/{roomTypeId:guid}/physical-rooms")]
    [EnableCors(CreateCorsPolicy)]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> CreatePhysicalRoom(Guid propertyId, Guid roomTypeId, [FromBody] CreateCatalogPhysicalRoom request, [FromHeader(Name = "Idempotency-Key")] Guid? operationId, CancellationToken ct)
    {
        if (operationId is null || operationId == Guid.Empty) return Fail(400, "Invalid request", "idempotency-key-required", "Idempotency-Key", "A unique request key is required.");
        return Respond(await catalog.CreatePhysicalRoomAsync(propertyId, roomTypeId, request, operationId.Value, ActorStaffId, ct), saved => Ok(saved));
    }

    [HttpGet("properties/{propertyId:guid}")]
    [HttpGet("properties/{propertyId:guid}/room-types/{roomTypeId:guid}")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<IActionResult> Get(Guid propertyId, Guid? roomTypeId, CancellationToken ct)
    {
        var editor = await catalog.GetAsync(propertyId, roomTypeId, ct);
        return editor is null ? NotFound() : Ok(editor);
    }

    [HttpPost("properties/{propertyId:guid}/save")]
    [HttpPost("properties/{propertyId:guid}/room-types/{roomTypeId:guid}/save")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Save(Guid propertyId, Guid? roomTypeId, [FromBody] SaveCatalogContent request, CancellationToken ct) =>
        Respond(await catalog.SaveAsync(propertyId, roomTypeId, request, ActorStaffId, ct), saved => Ok(saved));

    [HttpPost("properties/{propertyId:guid}/amenities")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<ActionResult> Amenity(Guid propertyId, [FromBody] CreateCatalogAmenity request, CancellationToken ct) =>
        Respond(await catalog.AddAmenityAsync(propertyId, request, ActorStaffId, ct), saved => Ok(saved));

    [HttpPost("properties/{propertyId:guid}/media")]
    [HttpPost("properties/{propertyId:guid}/room-types/{roomTypeId:guid}/media")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    [AllowStaffMultipartUpload]
    [RequestSizeLimit(CatalogLimits.MaxUploadBytes + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = CatalogLimits.MaxUploadBytes + 1024 * 1024, ValueCountLimit = 4)]
    public async Task<ActionResult> Upload(Guid propertyId, Guid? roomTypeId, IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0) return Respond(WebsiteMutationResult<CatalogGalleryItem>.Invalid("file", "Choose a picture."), x => Ok(x));
        await using var stream = file.OpenReadStream();
        return Respond(await catalog.UploadAsync(propertyId, roomTypeId, stream, $"{Request.Scheme}://{Request.Host}{Request.PathBase}", ActorStaffId, ct), x => Ok(x));
    }

    [HttpGet("properties/{propertyId:guid}/media/{mediaId:guid}")]
    [HttpGet("properties/{propertyId:guid}/room-types/{roomTypeId:guid}/media/{mediaId:guid}")]
    [StaffWebsitePermission(StaffGlobalPermission.WebsiteSettingsManage)]
    public async Task<IActionResult> Media(Guid propertyId, Guid? roomTypeId, Guid mediaId, CancellationToken ct)
    {
        var file = await catalog.OpenAsync(propertyId, roomTypeId, mediaId, ct);
        if (file is null) return NotFound();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }
}

// Existing Media.Url requires an absolute HTTP(S) URL. Uploaded bytes become public only while linked;
// no Customer route/proxy change is needed, and no administrative data is returned here.
[ApiController]
[Route("api/v1/catalog-media")]
public sealed class CatalogMediaController(IAdminCatalog catalog) : ControllerBase
{
    [HttpGet("{mediaId:guid}")]
    public async Task<IActionResult> Get(Guid mediaId, CancellationToken ct)
    {
        var file = await catalog.OpenPublicAsync(mediaId, ct);
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return file is null ? NotFound() : File(file.Content, file.ContentType);
    }
}
