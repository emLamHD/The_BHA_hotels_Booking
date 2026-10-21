using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Authentication;
using TheBha.Application.Promotions;
using TheBha.Application.Website;
using TheBha.Domain.Promotions;
using TheBha.Domain.Website;

namespace TheBha.Api.Controllers;

/// <summary>
/// BHA-BOOKING-PROMOTIONS-001 / ADR 0009: the Admin side of booking promotions, per Property. Every action carries
/// <see cref="StaffCalendarPermissionAttribute"/> with <see cref="StaffPermission.PromotionManage"/>: a Staff session that is a Manager of
/// the route's Property, checked on the server on every request (and the route does not exist in LocalGate mode). The actor comes from
/// that check, never from the request.
/// </summary>
[ApiController]
[IgnoreAntiforgeryToken]
[Route("api/admin/v1/properties/{propertyId:guid}/promotions")]
public sealed class AdminPromotionsController(IAdminPromotions promotions) : ControllerBase
{
    public const string CreateCorsPolicy = "admin-staff-promotion-create";
    private const int UploadLimit = HeroLimits.MaxUploadBytes + 1024 * 1024;

    [HttpGet]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult<IReadOnlyList<PromotionSummaryDto>>> List(
        Guid propertyId, [FromQuery] string? status, [FromQuery] string? q, [FromQuery] bool? homepage, [FromQuery] bool? publicNow, CancellationToken cancellationToken)
    {
        PromotionStatus? parsed = null;
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<PromotionStatus>(status, true, out var value)) return Fail(400, "Invalid promotion request", WebsiteErrorCodes.Validation, "status", "Unknown status.");
            parsed = value;
        }

        var list = await promotions.ListAsync(propertyId, new PromotionListQuery(parsed, q, homepage, publicNow), cancellationToken);
        return list is null ? Fail(404, "Property not found", null, null, "The property does not exist.") : Ok(list);
    }

    [HttpGet("room-types")]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> RoomTypes(Guid propertyId, CancellationToken cancellationToken)
    {
        var list = await promotions.RoomTypesAsync(propertyId, cancellationToken);
        return list is null ? Fail(404, "Property not found", null, null, "The property does not exist.") : Ok(list);
    }

    [HttpGet("{promotionId:guid}")]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> Get(Guid propertyId, Guid promotionId, CancellationToken cancellationToken) =>
        Respond(await promotions.GetAsync(propertyId, promotionId, cancellationToken));

    [HttpPost]
    [EnableCors(CreateCorsPolicy)]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> Create(
        Guid propertyId,
        [FromBody] PromotionBodyRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? operationId,
        CancellationToken cancellationToken)
    {
        if (operationId is null || operationId == Guid.Empty)
        {
            return Fail(400, "Invalid promotion request", PromotionErrorCodes.IdempotencyKeyRequired, "Idempotency-Key", "Idempotency-Key must be a GUID.");
        }

        if (request.ToInput() is not { } input) return Fail(400, "Invalid promotion request", WebsiteErrorCodes.Validation, "kind", "Unknown discount kind.");
        return Respond(await promotions.CreateAsync(propertyId, input, operationId.Value, Actor(propertyId), cancellationToken));
    }

    [HttpPost("{promotionId:guid}/save")]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> Save(Guid propertyId, Guid promotionId, [FromBody] SavePromotionRequest request, CancellationToken cancellationToken)
    {
        if (request.Promotion.ToInput() is not { } input) return Fail(400, "Invalid promotion request", WebsiteErrorCodes.Validation, "kind", "Unknown discount kind.");
        return Respond(await promotions.SaveAsync(propertyId, promotionId, request.ExpectedVersion, input, Actor(propertyId), cancellationToken));
    }

    [HttpPost("{promotionId:guid}/status")]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> SetStatus(Guid propertyId, Guid promotionId, [FromBody] SetPromotionStatusRequest request, CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<PromotionStatus>(request.Status, true, out var status) || status == PromotionStatus.Draft)
        {
            return Fail(400, "Invalid promotion request", WebsiteErrorCodes.Validation, "status", "The status is Active or Disabled.");
        }

        return Respond(await promotions.SetStatusAsync(propertyId, promotionId, request.ExpectedVersion, status, Actor(propertyId), cancellationToken));
    }

    /// <summary>One picture as a <c>multipart/form-data</c> part named <c>file</c>. The bytes decide the type; the name and the client's media type are ignored.</summary>
    [HttpPost("media")]
    [AllowStaffMultipartUpload]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit, ValueCountLimit = 4)]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> UploadMedia(Guid propertyId, IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return Fail(400, "Invalid promotion request", HeroErrorCodes.ImageEmpty, "file", "Choose a picture to upload.");
        }

        await using var content = file.OpenReadStream();
        return Respond(await promotions.UploadMediaAsync(propertyId, content, Actor(propertyId), cancellationToken));
    }

    /// <summary>The admin preview of a cover: the Manager's own Property only, never cached beyond the browser.</summary>
    [HttpGet("media/{mediaId:guid}")]
    [StaffCalendarPermission(StaffPermission.PromotionManage, typeof(WebsiteClosedInLocalGateFilter))]
    public async Task<ActionResult> Media(Guid propertyId, Guid mediaId, CancellationToken cancellationToken)
    {
        var file = await promotions.OpenMediaAsync(propertyId, mediaId, cancellationToken);
        if (file is null) return NotFound();
        Response.Headers.CacheControl = "private, max-age=3600";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(file.Content, file.ContentType);
    }

    private Guid Actor(Guid propertyId) =>
        StaffCalendarWriteContext.For(HttpContext, propertyId)?.StaffId
        ?? throw new InvalidOperationException("A promotion action ran without its Staff authorization filter.");

    private ActionResult Respond<T>(WebsiteMutationResult<T> result) =>
        result.Status switch
        {
            WebsiteMutationStatus.Succeeded => Ok(result.Value),
            WebsiteMutationStatus.Invalid => Fail(400, "Invalid promotion", result.Code, result.Field, result.Message),
            WebsiteMutationStatus.NotFound => Fail(404, "Promotion not found", result.Code, result.Field, result.Message),
            _ => Fail(409, "Promotion conflict", result.Code, result.Field, result.Message)
        };

    private ObjectResult Fail(int status, string title, string? code, string? field, string? detail)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Detail = detail };
        if (code is not null) problem.Extensions["code"] = code;
        if (field is not null) problem.Extensions["field"] = field;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

// Request bodies. Unknown properties (an `actorStaffId`, a `role`) are ignored: the actor and the authorization come from the Staff session.

public sealed record PromotionTextsRequest
{
    public string? Title { get; init; }
    public string? Summary { get; init; }
    public string? CoverAltText { get; init; }
    public IReadOnlyList<string>? Body { get; init; }
}

public sealed record PromotionBodyRequest
{
    [JsonRequired] public string Slug { get; init; } = string.Empty;
    [JsonRequired] public string Title { get; init; } = string.Empty;
    [JsonRequired] public string Summary { get; init; } = string.Empty;
    public IReadOnlyList<string>? Body { get; init; }
    public Guid? CoverMediaId { get; init; }
    public string? CoverAltText { get; init; }
    [JsonRequired] public string Kind { get; init; } = string.Empty;
    [JsonRequired] public decimal Value { get; init; }
    public string? CurrencyCode { get; init; }
    [JsonRequired] public bool AllRoomTypes { get; init; }
    public IReadOnlyList<Guid>? RoomTypeIds { get; init; }
    public DateOnly? BookingFrom { get; init; }
    public DateOnly? BookingTo { get; init; }
    public DateOnly? StayFrom { get; init; }
    public DateOnly? StayTo { get; init; }
    [JsonRequired] public int MinNights { get; init; }
    [JsonRequired] public bool ShowOnHomepage { get; init; }
    [JsonRequired] public int SortOrder { get; init; }
    public DateOnly? DisplayFrom { get; init; }
    public DateOnly? DisplayTo { get; init; }
    public Dictionary<string, PromotionTextsRequest>? Translations { get; init; }

    /// <summary><c>null</c> when the discount kind is not one of the two.</summary>
    public PromotionInput? ToInput() =>
        Enum.TryParse<PromotionDiscountKind>(Kind, true, out var kind)
            ? new PromotionInput(
                new PromotionDetails(
                    Slug.Trim(), Title, Summary, Body ?? [], CoverMediaId, CoverAltText, kind, Value, string.IsNullOrWhiteSpace(CurrencyCode) ? null : CurrencyCode.Trim().ToUpperInvariant(),
                    AllRoomTypes, RoomTypeIds ?? [], BookingFrom, BookingTo, StayFrom, StayTo, MinNights, ShowOnHomepage, SortOrder, DisplayFrom, DisplayTo),
                Translations?.ToDictionary(x => x.Key, x => new PromotionTextsDto(x.Value.Title, x.Value.Summary, x.Value.CoverAltText, x.Value.Body)))
            : null;
}

public sealed record SavePromotionRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public PromotionBodyRequest Promotion { get; init; } = new();
}

public sealed record SetPromotionStatusRequest
{
    [JsonRequired] public int ExpectedVersion { get; init; }
    [JsonRequired] public string Status { get; init; } = string.Empty;
}
