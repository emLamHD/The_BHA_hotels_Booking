using System.Globalization;
using TheBha.Domain.Common;

namespace TheBha.Domain.Website;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: the one place a VND amount becomes a reference amount in another currency. Exact
/// <see cref="decimal"/> arithmetic (never a floating point number), one rounding rule — to the currency's minor
/// units, a midpoint away from zero — applied to each line; a total is the sum of the rounded lines, so the
/// numbers a visitor sees always add up. A display amount never touches a stored price: it is derived on every read.
/// </summary>
public static class DisplayAmount
{
    public const decimal MaximumVnd = 999_999_999_999_999m;

    /// <summary>VND per one unit of the target currency; <paramref name="vndPerUnit"/> must be greater than zero.</summary>
    public static decimal Convert(decimal unitVnd, decimal vndPerUnit, int minorUnits)
    {
        if (vndPerUnit <= 0m)
        {
            throw new DomainException("vndPerUnit must be greater than zero.");
        }

        return decimal.Round(unitVnd / vndPerUnit, minorUnits, MidpointRounding.AwayFromZero);
    }

    /// <summary>Fixed digits for a converted amount (<c>40.00</c>, <c>1000000</c> for 0 minor units).</summary>
    public static string Format(decimal amount, int minorUnits) =>
        amount.ToString("F" + minorUnits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);

    /// <summary>The base currency is shown as stored: no conversion, no rounding, trailing zeros trimmed.</summary>
    public static string FormatBase(decimal vnd) =>
        decimal.Round(vnd, 2, MidpointRounding.AwayFromZero).ToString("0.##", CultureInfo.InvariantCulture);

    public static bool TryParseVnd(string? text, out decimal value)
    {
        value = 0m;
        if (string.IsNullOrEmpty(text) || text.Length > 22)
        {
            return false;
        }

        if (!decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value) ||
            value < 0m || value > MaximumVnd)
        {
            return false;
        }

        var point = text.IndexOf('.');
        return point < 0 || text.Length - point - 1 <= 2;
    }
}
