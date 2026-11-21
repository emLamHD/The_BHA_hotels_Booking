namespace TheBha.Api.Controllers;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR06 (ADR 0011 §B, §D): the two Admin headers of the Blog and the narrow CORS policies that carry them. Each policy is the shared Staff policy of its method (same
/// Admin origins, same single method, credentials) plus exactly one header, and is attached only to the actions that carry the marker below, so no other Admin route is widened.
/// </summary>
public static class AdminBlogHeaders
{
    /// <summary>Request header of the three actions that can start or finish one Save-then-Publish chain. Optional; a missing, malformed or repeated value means "no correlation".</summary>
    public const string CorrelationId = "X-Admin-Correlation-Id";

    /// <summary>Response header of the one Blog read whose body is a bare JSON array (the categories): the stream number of the same snapshot as the rows.</summary>
    public const string ViewWatermark = "X-Admin-View-Watermark";

    public const string CorrelationCorsPolicy = "admin-staff-blog-correlation";
    public const string WatermarkCorsPolicy = "admin-staff-blog-watermark";

    /// <summary>Exactly one value, a canonical UUID and not the all-zero one; anything else is no correlation (the write itself never depends on it).</summary>
    public static Guid? ReadCorrelationId(IHeaderDictionary headers) =>
        headers.TryGetValue(CorrelationId, out var values) && values.Count == 1 && Guid.TryParseExact(values[0], "D", out var id) && id != Guid.Empty ? id : null;
}

/// <summary>Marks a Blog POST that reads <c>X-Admin-Correlation-Id</c> (create post, save draft, publish); its CORS policy allows that request header.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class AdminBlogCorrelationHeaderAttribute : Attribute;

/// <summary>Marks an Admin GET whose body is a bare JSON array (the Blog categories; from PR-8 the Languages, language-pack library and Currencies reads) and that answers <c>X-Admin-View-Watermark</c>; its CORS policy exposes that response header to the Admin origin.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class AdminBlogViewWatermarkHeaderAttribute : Attribute;
