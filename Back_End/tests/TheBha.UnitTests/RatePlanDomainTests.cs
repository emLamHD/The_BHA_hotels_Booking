using TheBha.Domain.Common;
using TheBha.Domain.Properties;

namespace TheBha.UnitTests;

public sealed class RatePlanDomainTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");

    [Fact]
    public void Creates_valid_rate_plan_with_normalized_values()
    {
        var ratePlan = CreateRatePlan("  standard  ", "  Standard Rate  ", "  vnd  ");

        Assert.Equal("STANDARD", ratePlan.Code);
        Assert.Equal("Standard Rate", ratePlan.Name);
        Assert.Equal("VND", ratePlan.CurrencyCode);
        Assert.Equal(Now, ratePlan.CreatedAt);
        Assert.Equal(Now, ratePlan.UpdatedAt);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_code(string code) =>
        Assert.Throws<DomainException>(() => CreateRatePlan(code, "Standard Rate", "VND"));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_blank_name(string name) =>
        Assert.Throws<DomainException>(() => CreateRatePlan("STANDARD", name, "VND"));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("VN")]
    [InlineData("VND1")]
    [InlineData("V1D")]
    public void Rejects_invalid_currency_code(string currencyCode) =>
        Assert.Throws<DomainException>(() => CreateRatePlan("STANDARD", "Standard Rate", currencyCode));

    [Fact]
    public void Rejects_empty_identity_values()
    {
        Assert.Throws<DomainException>(() => new RatePlan(
            Guid.Empty, Guid.NewGuid(), "STANDARD", "Standard Rate", null, "VND", true, Now));
        Assert.Throws<DomainException>(() => new RatePlan(
            Guid.NewGuid(), Guid.Empty, "STANDARD", "Standard Rate", null, "VND", true, Now));
    }

    [Fact]
    public void Lifecycle_requires_non_decreasing_timestamp()
    {
        var ratePlan = CreateRatePlan("STANDARD", "Standard Rate", "VND");
        var later = Now.AddMinutes(1);

        ratePlan.Deactivate(later);

        Assert.False(ratePlan.IsActive);
        Assert.Equal(later, ratePlan.UpdatedAt);
        Assert.Throws<DomainException>(() => ratePlan.Activate(Now));
    }

    private static RatePlan CreateRatePlan(string code, string name, string currencyCode) => new(
        Guid.NewGuid(),
        Guid.NewGuid(),
        code,
        name,
        null,
        currencyCode,
        true,
        Now);
}
