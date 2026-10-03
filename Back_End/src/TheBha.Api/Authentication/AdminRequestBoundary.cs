using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP03: the two request predicates every Admin browser write
/// shares — exact <c>Origin</c> and JSON content type. Extracted unchanged from
/// <see cref="TheBha.Api.Controllers.AdminCalendarWriteGateFilter"/> so the local
/// Calendar write gate and <see cref="StaffRequestBoundaryFilter"/> apply one rule.
/// Each caller decides the order and the response; these only answer yes or no.
/// </summary>
public static class AdminRequestBoundary
{
    public const string JsonMediaType = "application/json";
    public const string SupportedCharset = "utf-8";

    /// <summary>
    /// Requires exactly one <c>Origin</c> header value that is ordinal-equal to
    /// a configured Admin origin. Exact equality is what defeats a
    /// prefix/suffix lookalike (<c>https://localhost:3001.evil.example</c>,
    /// <c>https://evil.example/?https://localhost:3001</c>); a missing, empty,
    /// literal <c>null</c> or multi-valued header never matches one. The
    /// allowed entries are re-checked for an HTTPS scheme here so this rule
    /// does not depend on a validation that lives in another file.
    /// </summary>
    public static bool IsAllowedOrigin(StringValues origin, IReadOnlyList<string> allowedOrigins)
    {
        if (origin.Count != 1)
        {
            return false;
        }

        var value = origin[0];
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        foreach (var allowed in allowedOrigins)
        {
            if (allowed.StartsWith("https://", StringComparison.Ordinal) &&
                string.Equals(allowed, value, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Accepts <c>application/json</c>, either with no parameters or with
    /// exactly one <c>charset</c> equal to <c>utf-8</c>. Everything else is
    /// rejected: a missing or unparsable header, a different media type, a
    /// <c>+json</c> suffix type, any other parameter, a duplicate or empty
    /// charset, and every other encoding.
    ///
    /// <para>
    /// PMS-CAL-001.2-CP01 correction C1, finding 3: MVC's System.Text.Json input
    /// formatter accepts only its configured UTF-8/UTF-16 encodings, so a wider
    /// charset rule would promise a contract the action cannot read. Stated as a
    /// literal rather than read from the formatter, and checked by the callers'
    /// resource filters rather than with <c>[Consumes]</c>, which would answer
    /// at action selection, ahead of every boundary condition.
    /// </para>
    /// </summary>
    public static bool IsJsonContentType(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out var mediaType) ||
            !mediaType.MediaType.Equals(JsonMediaType, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var charsetSeen = false;
        foreach (var parameter in mediaType.Parameters)
        {
            if (charsetSeen ||
                !parameter.Name.Equals("charset", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            charsetSeen = true;
            if (!HeaderUtilities.RemoveQuotes(parameter.Value)
                    .Equals(SupportedCharset, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        return true;
    }
}
