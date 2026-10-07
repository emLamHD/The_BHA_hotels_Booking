using TheBha.Application.Bookings;

namespace TheBha.UnitTests;

public sealed class ReservationIdGeneratorTests
{
    [Fact]
    public void Cryptographic_generator_never_returns_empty_across_ten_thousand_calls()
    {
        var generator = new CryptographicReservationIdGenerator();

        var ids = Enumerable.Range(0, 10_000)
            .Select(_ => generator.Generate())
            .ToArray();

        Assert.DoesNotContain(Guid.Empty, ids);
        Assert.Equal(ids.Length, ids.Distinct().Count());
    }

    [Fact]
    public void Retries_on_an_all_zero_source_result_and_uses_the_retried_bytes()
    {
        var allZero = new byte[16];
        var validSecond = Enumerable.Range(1, 16).Select(value => (byte)value).ToArray();
        var calls = 0;
        byte[] Source()
        {
            calls++;
            return calls == 1 ? allZero : validSecond;
        }

        var generator = new CryptographicReservationIdGenerator(Source);

        var result = generator.Generate();

        Assert.Equal(2, calls);
        Assert.NotEqual(Guid.Empty, result);
        var resultBytes = new byte[16];
        Assert.True(result.TryWriteBytes(resultBytes));
        Assert.Equal(validSecond, resultBytes);
    }

    [Fact]
    public void Retries_repeatedly_until_a_non_zero_result_is_produced()
    {
        var allZero = new byte[16];
        var validThird = Enumerable.Range(1, 16).Select(value => (byte)(value * 2)).ToArray();
        var calls = 0;
        byte[] Source()
        {
            calls++;
            return calls < 3 ? allZero : validThird;
        }

        var generator = new CryptographicReservationIdGenerator(Source);

        var result = generator.Generate();

        Assert.Equal(3, calls);
        Assert.NotEqual(Guid.Empty, result);
    }

    [Fact]
    public void Rejects_a_source_that_does_not_produce_exactly_sixteen_bytes()
    {
        var generator = new CryptographicReservationIdGenerator(() => new byte[8]);

        Assert.Throws<InvalidOperationException>(() => generator.Generate());
    }

    [Fact]
    public void Preserves_all_sixteen_source_bytes_without_version_or_variant_normalization()
    {
        var bytes = Enumerable.Range(0, 16).Select(value => (byte)(value * 7 + 3)).ToArray();
        var generator = new CryptographicReservationIdGenerator(() => (byte[])bytes.Clone());

        var result = generator.Generate();

        var resultBytes = new byte[16];
        Assert.True(result.TryWriteBytes(resultBytes));
        Assert.Equal(bytes, resultBytes);
    }
}
