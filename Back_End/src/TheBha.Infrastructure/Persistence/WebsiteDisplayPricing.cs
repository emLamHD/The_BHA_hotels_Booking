using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: the display-price projection. It converts VND amounts a client already holds into the
/// chosen currency with exact decimal arithmetic and ONE rate snapshot per request, so every line of a quote uses the
/// same rate. It reads the currency row and nothing else: it cannot create, change or even look at a stored price, a
/// hold or a reservation, and a currency that is off, unknown or without a rate is refused rather than answered
/// with a made-up rate.
/// </summary>
internal sealed class WebsiteDisplayPricing(TheBhaDbContext database) : IWebsiteDisplayPricing
{
    private const int MaximumLines = 500;
    private const int MaximumSums = 200;
    private const int MaximumQuantity = 10_000;

    public async Task<WebsiteMutationResult<DisplayPriceResponse>> QuoteAsync(DisplayPriceRequest request, CancellationToken cancellationToken)
    {
        if (!Iso4217.TryNormalize(request.Currency, out var code))
        {
            return WebsiteMutationResult<DisplayPriceResponse>.Invalid("currency", "currency must be an ISO 4217 code such as USD.");
        }

        var lines = request.Lines ?? [];
        var sums = request.Sums ?? [];
        if (lines.Count is 0 or > MaximumLines || sums.Count > MaximumSums)
        {
            return WebsiteMutationResult<DisplayPriceResponse>.Invalid("lines", $"Send between 1 and {MaximumLines} lines and at most {MaximumSums} sums.");
        }

        var parsed = new List<(DisplayPriceLine Line, decimal Unit)>(lines.Count);
        var refs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line.Ref) || line.Ref.Length > 60 || !refs.Add(line.Ref))
            {
                return WebsiteMutationResult<DisplayPriceResponse>.Invalid("lines", "Every line needs its own ref (at most 60 characters).");
            }

            if (!DisplayAmount.TryParseVnd(line.UnitVnd, out var unit))
            {
                return WebsiteMutationResult<DisplayPriceResponse>.Invalid("lines", $"{line.Ref}: unitVnd must be a decimal string with at most 2 fraction digits.");
            }

            if (line.Quantity is < 1 or > MaximumQuantity)
            {
                return WebsiteMutationResult<DisplayPriceResponse>.Invalid("lines", $"{line.Ref}: quantity must be between 1 and {MaximumQuantity}.");
            }

            parsed.Add((line, unit));
        }

        // One read, one snapshot: the rate every line below is converted with.
        var currency = await database.WebsiteCurrencies.AsNoTracking().SingleOrDefaultAsync(item => item.Code == code, cancellationToken);
        if (currency is not { IsActive: true, VndPerUnit: > 0m })
        {
            return WebsiteMutationResult<DisplayPriceResponse>.Conflict(
                WebsiteErrorCodes.CurrencyInactive, $"{code} is not available: it is off or has no exchange rate.", "currency");
        }

        var rate = currency.VndPerUnit.Value;
        string FormatAmount(decimal amount) => currency.IsBase ? DisplayAmount.FormatBase(amount) : DisplayAmount.Format(amount, currency.MinorUnits);
        decimal Unit(decimal vnd) => currency.IsBase ? decimal.Round(vnd, 2, MidpointRounding.AwayFromZero) : DisplayAmount.Convert(vnd, rate, currency.MinorUnits);

        var results = new List<DisplayPriceLineResult>(parsed.Count);
        var totals = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var (line, vnd) in parsed)
        {
            var unit = Unit(vnd);
            var total = unit * line.Quantity;
            totals[line.Ref] = total;
            results.Add(new DisplayPriceLineResult(line.Ref, FormatAmount(unit), line.Quantity, FormatAmount(total)));
        }

        var sumResults = new List<DisplayPriceSumResult>(sums.Count);
        foreach (var sum in sums)
        {
            if (string.IsNullOrWhiteSpace(sum.Ref) || sum.Of is null || sum.Of.Count == 0 || sum.Of.Any(reference => !totals.ContainsKey(reference)))
            {
                return WebsiteMutationResult<DisplayPriceResponse>.Invalid("sums", "Every sum needs a ref and a list of line refs that were sent.");
            }

            sumResults.Add(new DisplayPriceSumResult(sum.Ref, FormatAmount(sum.Of.Sum(reference => totals[reference]))));
        }

        return WebsiteMutationResult<DisplayPriceResponse>.Success(new DisplayPriceResponse(
            code,
            currency.MinorUnits,
            currency.IsBase,
            new DisplayPriceRate(ExchangeRate.Format(rate), currency.RateUpdatedAtUtc ?? currency.UpdatedAtUtc, currency.Version),
            results,
            sumResults));
    }
}
