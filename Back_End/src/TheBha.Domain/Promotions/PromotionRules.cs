using System.Text.RegularExpressions;
using TheBha.Domain.Website;

namespace TheBha.Domain.Promotions;

public enum PromotionStatus { Draft, Active, Disabled }

public enum PromotionDiscountKind { Percent, FixedAmount }

public static class PromotionLimits
{
    public const int Slug = 120;
    public const int Title = 200;
    public const int Summary = 300;
    public const int AltText = 300;
    public const int BodyParagraphs = 8;
    public const int BodyParagraphLength = 1000;
    public const int MaxMinNights = 30;
    public const int MaxSortOrder = 9999;
    public const int CoverMinWidth = 600;
    public const int CoverMinHeight = 400;
    public const decimal MaxFixedAmount = 9_999_999_999m;
}

/// <summary>The editable part of a promotion: the pricing rule and the marketing content together (one entity, nothing entered twice).</summary>
public sealed record PromotionDetails(
    string Slug,
    string Title,
    string Summary,
    IReadOnlyList<string> BodyParagraphs,
    Guid? CoverMediaId,
    string? CoverAltText,
    PromotionDiscountKind Kind,
    decimal Value,
    string? CurrencyCode,
    bool AllRoomTypes,
    IReadOnlyList<Guid> RoomTypeIds,
    DateOnly? BookingFrom,
    DateOnly? BookingTo,
    DateOnly? StayFrom,
    DateOnly? StayTo,
    int MinNights,
    bool ShowOnHomepage,
    int SortOrder,
    DateOnly? DisplayFrom,
    DateOnly? DisplayTo);

public sealed record PromotionRuleError(string Field, string Message);

/// <summary>
/// Money rules of a promotion. The rounding is fixed here on purpose: <c>WebsiteCurrencies.MinorUnits</c> is display
/// configuration an Admin can edit, and editing it must never change a booking price.
/// </summary>
public static class PromotionMoney
{
    public const string WholeUnitCurrency = "VND";

    public static int Decimals(string currencyCode) =>
        string.Equals(currencyCode, WholeUnitCurrency, StringComparison.Ordinal) ? 0 : 2;

    /// <summary>The smallest amount a night may cost after a discount: 1 đồng, or 0.01 for a two-decimal currency.</summary>
    public static decimal MinimumUnit(string currencyCode) => Decimals(currencyCode) == 0 ? 1m : 0.01m;

    /// <summary>Half away from zero, to the currency's whole unit (VND) or two decimals.</summary>
    public static decimal Round(decimal amount, string currencyCode) =>
        Math.Round(amount, Decimals(currencyCode), MidpointRounding.AwayFromZero);
}

public static partial class PromotionRules
{
    /// <summary>The first broken rule, or <c>null</c>. The same rules run in the Admin form's server check and in the entity.</summary>
    public static PromotionRuleError? Validate(PromotionDetails d)
    {
        ArgumentNullException.ThrowIfNull(d);
        if (string.IsNullOrWhiteSpace(d.Slug) || d.Slug.Length > PromotionLimits.Slug || !SlugPattern().IsMatch(d.Slug))
            return new("slug", "The slug is lowercase letters and digits separated by single hyphens.");
        if (Text(d.Title, PromotionLimits.Title) is { } titleError) return new("title", titleError);
        if (Text(d.Summary, PromotionLimits.Summary) is { } summaryError) return new("summary", summaryError);
        if (d.BodyParagraphs.Count > PromotionLimits.BodyParagraphs)
            return new("body", $"The details have at most {PromotionLimits.BodyParagraphs} paragraphs.");
        for (var i = 0; i < d.BodyParagraphs.Count; i++)
        {
            if (Text(d.BodyParagraphs[i], PromotionLimits.BodyParagraphLength) is { } bodyError) return new($"body{i + 1}", bodyError);
        }

        if (d.CoverMediaId is not null && Text(d.CoverAltText, PromotionLimits.AltText) is { } altError) return new("coverAltText", altError);
        if (d.CoverMediaId is null && !string.IsNullOrWhiteSpace(d.CoverAltText)) return new("coverAltText", "The alt text belongs to a cover image.");
        if (d.ShowOnHomepage && d.CoverMediaId is null) return new("showOnHomepage", "A promotion shown on the homepage needs a cover image.");

        switch (d.Kind)
        {
            case PromotionDiscountKind.Percent:
                if (d.Value <= 0 || d.Value >= 100) return new("value", "A percentage is greater than 0 and less than 100: a free booking is not supported.");
                if (decimal.Round(d.Value, 2) != d.Value) return new("value", "A percentage has at most two decimal places.");
                if (d.CurrencyCode is not null) return new("currencyCode", "A percentage has no currency.");
                break;
            case PromotionDiscountKind.FixedAmount:
                if (d.CurrencyCode is null || !CurrencyPattern().IsMatch(d.CurrencyCode)) return new("currencyCode", "A fixed amount needs a three-letter currency code.");
                if (d.Value <= 0 || d.Value > PromotionLimits.MaxFixedAmount) return new("value", "A fixed amount is greater than zero.");
                if (decimal.Round(d.Value, PromotionMoney.Decimals(d.CurrencyCode)) != d.Value)
                    return new("value", PromotionMoney.Decimals(d.CurrencyCode) == 0 ? "A VND amount is a whole number." : "An amount has at most two decimal places.");
                break;
            default:
                return new("kind", "Unknown discount kind.");
        }

        if (!d.AllRoomTypes && d.RoomTypeIds.Count == 0) return new("roomTypeIds", "Choose at least one room type, or all room types.");
        if (d.AllRoomTypes && d.RoomTypeIds.Count > 0) return new("roomTypeIds", "All room types and a chosen list cannot both be set.");
        if (d.RoomTypeIds.Count != d.RoomTypeIds.Distinct().Count() || d.RoomTypeIds.Any(id => id == Guid.Empty)) return new("roomTypeIds", "Room types must be distinct.");
        if (Window(d.BookingFrom, d.BookingTo) is { } bookingError) return new("bookingTo", bookingError);
        if (Window(d.StayFrom, d.StayTo) is { } stayError) return new("stayTo", stayError);
        if (Window(d.DisplayFrom, d.DisplayTo) is { } displayError) return new("displayTo", displayError);
        if (d.MinNights is < 1 or > PromotionLimits.MaxMinNights) return new("minNights", $"Minimum nights is between 1 and {PromotionLimits.MaxMinNights}.");
        if (d.SortOrder is < 0 or > PromotionLimits.MaxSortOrder) return new("sortOrder", $"The display order is between 0 and {PromotionLimits.MaxSortOrder}.");
        return null;
    }

    /// <summary>Plain single-line text, the same rule a translation follows (no markup, no control characters).</summary>
    public static string? Text(string? value, int maximum)
    {
        if (string.IsNullOrWhiteSpace(value)) return "This text is required.";
        if (value.Trim().Length > maximum) return $"This text cannot exceed {maximum} characters.";
        return TranslationText.Validate(value.Trim(), []);
    }

    private static string? Window(DateOnly? from, DateOnly? to) =>
        from is not null && to is not null && to < from ? "The end date cannot be earlier than the start date." : null;

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex SlugPattern();

    [GeneratedRegex("^[A-Z]{3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CurrencyPattern();
}
