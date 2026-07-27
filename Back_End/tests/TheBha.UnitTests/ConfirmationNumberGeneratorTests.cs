using System.Globalization;
using TheBha.Application.Bookings;

namespace TheBha.UnitTests;

public sealed class ConfirmationNumberGeneratorTests
{
    [Fact]
    public void Generates_uppercase_bounded_and_pattern_matching_value()
    {
        var confirmationNumber = ConfirmationNumberGenerator.Generate(Guid.NewGuid());

        Assert.True(confirmationNumber.Length <= 32);
        Assert.Equal(confirmationNumber, confirmationNumber.ToUpperInvariant());
        Assert.Matches("^[A-Z0-9-]+$", confirmationNumber);
        Assert.StartsWith("BHA", confirmationNumber, StringComparison.Ordinal);
    }

    [Fact]
    public void Is_stable_for_the_same_reservation_id_and_differs_for_another()
    {
        var id = Guid.NewGuid();

        var first = ConfirmationNumberGenerator.Generate(id);
        var second = ConfirmationNumberGenerator.Generate(id);
        var other = ConfirmationNumberGenerator.Generate(Guid.NewGuid());

        Assert.Equal(first, second);
        Assert.NotEqual(first, other);
    }

    [Fact]
    public void Is_culture_invariant()
    {
        var id = Guid.NewGuid();
        var originalCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("ar-SA");
            var first = ConfirmationNumberGenerator.Generate(id);
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("vi-VN");
            var second = ConfirmationNumberGenerator.Generate(id);
            Assert.Equal(first, second);
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }

    [Fact]
    public void One_thousand_random_ids_produce_no_collisions()
    {
        var confirmationNumbers = Enumerable.Range(0, 1000)
            .Select(_ => ConfirmationNumberGenerator.Generate(Guid.NewGuid()))
            .ToArray();

        Assert.Equal(confirmationNumbers.Length, confirmationNumbers.Distinct().Count());
    }
}
