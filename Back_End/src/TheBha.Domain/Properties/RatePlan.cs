using System.Text.RegularExpressions;
using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed partial class RatePlan
{
    private RatePlan()
    {
    }

    public RatePlan(
        Guid id,
        Guid propertyId,
        string code,
        string name,
        string? description,
        string currencyCode,
        bool isActive,
        DateTimeOffset createdAt)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        Code = DomainGuard.Required(code, nameof(code), 50).ToUpperInvariant();
        Name = DomainGuard.Required(name, nameof(name), 200);
        Description = DomainGuard.Optional(description, nameof(description), 4000);
        CurrencyCode = NormalizeCurrencyCode(currencyCode);
        IsActive = isActive;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public string CurrencyCode { get; private set; } = string.Empty;
    public bool IsActive { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public void Activate(DateTimeOffset updatedAt) => SetActive(true, updatedAt);

    public void Deactivate(DateTimeOffset updatedAt) => SetActive(false, updatedAt);

    private static string NormalizeCurrencyCode(string currencyCode)
    {
        var normalized = DomainGuard.Required(currencyCode, nameof(currencyCode), 3).ToUpperInvariant();
        if (!CurrencyCodePattern().IsMatch(normalized))
        {
            throw new DomainException("currencyCode must be exactly three alphabetic characters.");
        }

        return normalized;
    }

    private void SetActive(bool isActive, DateTimeOffset updatedAt)
    {
        if (updatedAt < CreatedAt || updatedAt < UpdatedAt)
        {
            throw new DomainException("updatedAt cannot be earlier than the current timestamp.");
        }

        IsActive = isActive;
        UpdatedAt = updatedAt;
    }

    [GeneratedRegex("^[A-Z]{3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CurrencyCodePattern();
}
