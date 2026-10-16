using System.Globalization;
using System.Text.RegularExpressions;

namespace TheBha.Domain.Website;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the field limits shared by the model, the validators and the database
/// CHECK constraints, so none of the three can drift from the others.
/// </summary>
public static class WebsiteFieldLimits
{
    public const int LanguageCode = 20;
    public const int LanguageName = 100;
    public const int CurrencyName = 100;
    public const int CurrencySymbol = 10;
    public const int TranslationKey = 200;
    public const int TranslationValue = 4000;
    public const int FormatLocale = 35;
    public const int PackId = 100;
    public const int PackVersion = 50;
    public const int SourceHash = 16;
    public const int SortOrderMaximum = 10_000;
    public const int MinorUnitsMaximum = 4;

    /// <summary>The only rate source this phase has: an operator typed it. No provider is called.</summary>
    public const string ManualRateSource = "manual";
}

/// <summary>
/// A BCP 47 tag in the shape this site supports: <c>language[-Script][-REGION]</c> (<c>vi</c>, <c>en-US</c>,
/// <c>zh-Hans</c>, <c>es-419</c>). Checked and canonicalised by the grammar alone, never by
/// <c>CultureInfo</c>: that depends on the ICU data of the host (an invariant-globalization image accepts
/// nothing), so the same tag could be valid in a test and refused in production. The registry is not
/// consulted: <c>zz</c> is well formed.
/// </summary>
public static partial class LanguageTag
{
    [GeneratedRegex("^([A-Za-z]{2,3})(?:-([A-Za-z]{4}))?(?:-([A-Za-z]{2}|[0-9]{3}))?$")]
    private static partial Regex Shape();

    /// <summary>
    /// Canonical casing (language lower, script Title, region UPPER) and the case-folded key the
    /// database makes unique. <c>false</c> when the text is not such a tag.
    /// </summary>
    public static bool TryNormalize(string? value, out string canonical, out string normalized)
    {
        canonical = normalized = string.Empty;
        var match = Shape().Match(value?.Trim() ?? string.Empty);
        if (!match.Success)
        {
            return false;
        }

        var parts = new List<string> { match.Groups[1].Value.ToLowerInvariant() };
        if (match.Groups[2].Success)
        {
            var script = match.Groups[2].Value.ToLowerInvariant();
            parts.Add(char.ToUpperInvariant(script[0]) + script[1..]);
        }

        if (match.Groups[3].Success)
        {
            parts.Add(match.Groups[3].Value.ToUpperInvariant());
        }

        canonical = string.Join('-', parts);
        normalized = canonical.ToLowerInvariant();
        return canonical.Length <= WebsiteFieldLimits.LanguageCode;
    }
}

/// <summary>
/// The current ISO 4217 alphabetic currency codes. A code outside this list is refused, so <c>ABC</c> cannot become
/// a currency, and neither can a withdrawn one. The list is data, not behaviour: when ISO adds or withdraws a
/// currency, it is a one-line change here, read from the two SIX lists below.
///
/// <para>Source (SIX Financial Information, the ISO 4217 maintenance agency), checked 2026-10-15:
/// List One, <c>Pblshd=2026-09-17</c> (current codes):
/// https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml ;
/// List Three, <c>Pblshd=2026-01-01</c> (withdrawn codes):
/// https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-three.xml ;
/// amendment 176 (XCG replaces ANG, effective 2025-03-31) and amendment 177 (ZWG replaces ZWL, effective 2024-06-25):
/// https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/amendments/dl-currency-iso-amendment-176.pdf and
/// https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/amendments/dl-currency-iso-amendment-177.pdf .</para>
///
/// <para>This is List One minus the codes that are not currencies by product policy: funds (BOV, CHE, CHW, CLF, COU,
/// MXV, USN, UYI, UYW), precious metals (XAG, XAU, XPD, XPT), the testing code XTS, "no currency" XXX, and units of
/// account (XBA–XBD, XDR, XSU, XUA, and XAD, the Arab Monetary Fund's Arab Accounting Dinar, the same class as XDR and
/// XUA). A rarely used code that List One still lists (SVC, El Salvador) stays; a code on List Three (ANG, BGN, ZWL)
/// does not.</para>
/// </summary>
public static class Iso4217
{
    private static readonly HashSet<string> Codes = new(StringComparer.Ordinal)
    {
        "AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BHD", "BIF",
        "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC",
        "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS",
        "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD",
        "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL",
        "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD",
        "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD",
        "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP",
        "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VED",
        "VES", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWG"
    };

    public static bool TryNormalize(string? value, out string code)
    {
        code = (value ?? string.Empty).Trim().ToUpperInvariant();
        return Codes.Contains(code);
    }
}

/// <summary>
/// The one exchange-rate convention: <c>VndPerUnit</c> is how many VND one unit of the currency is worth, so
/// an amount in that currency is <c>VND / VndPerUnit</c>. Text only, in and out: a JSON number would pass
/// through a JavaScript <c>Number</c> and lose digits. A decimal point is the only separator; no sign,
/// exponent, thousands separator or whitespace. At most 12 integer and 8 fraction digits (PostgreSQL
/// <c>numeric(20,8)</c>), strictly greater than zero.
/// </summary>
public static partial class ExchangeRate
{
    public const int IntegerDigits = 12;
    public const int FractionDigits = 8;

    [GeneratedRegex("^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,8})?$")]
    private static partial Regex Shape();

    public static bool TryParse(string? text, out decimal value)
    {
        value = 0m;
        if (text is null || !Shape().IsMatch(text))
        {
            return false;
        }

        value = decimal.Parse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
        return value > 0m;
    }

    /// <summary>Shortest exact text (<c>25000.5</c>, <c>1</c>), invariant culture.</summary>
    public static string Format(decimal value) =>
        value.ToString("0.########", CultureInfo.InvariantCulture);
}

/// <summary>
/// A translation value is plain text in the <see cref="IcuMessage"/> subset: no markup, no control characters, not
/// blank, well-formed, and the variables it uses are exactly the ones the key declares — none lost, none added. A
/// key that declares nothing may not use any.
/// </summary>
public static class TranslationText
{
    /// <summary>The error text for the first broken rule, or <c>null</c> when the value is acceptable.</summary>
    public static string? Validate(string? value, IReadOnlyCollection<string> declaredPlaceholders)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "The translation cannot be empty.";
        }

        if (value.Length > WebsiteFieldLimits.TranslationValue)
        {
            return $"The translation cannot exceed {WebsiteFieldLimits.TranslationValue} characters.";
        }

        if (value.Any(char.IsControl))
        {
            return "The translation cannot contain control characters.";
        }

        if (value.Contains('<') || value.Contains('>'))
        {
            return "The translation is plain text: '<' and '>' are not allowed.";
        }

        var analysis = IcuMessage.Analyze(value);
        if (!analysis.IsValid)
        {
            return analysis.Error;
        }

        var missing = declaredPlaceholders.Where(name => !analysis.Variables.Contains(name, StringComparer.Ordinal)).ToArray();
        if (missing.Length > 0)
        {
            return $"The translation must keep the placeholder {string.Join(", ", missing.Select(name => "{" + name + "}"))}.";
        }

        var unexpected = analysis.Variables.Where(name => !declaredPlaceholders.Contains(name, StringComparer.Ordinal)).ToArray();
        return unexpected.Length > 0
            ? $"The translation has the placeholder {string.Join(", ", unexpected.Select(name => "{" + name + "}"))}, which this key does not declare."
            : null;
    }
}
