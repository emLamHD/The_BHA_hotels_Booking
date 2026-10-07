using TheBha.Application.Bookings;

namespace TheBha.UnitTests;

public sealed class BookingAccessTokenValidatorTests
{
    [Fact]
    public void Accepts_a_genuinely_generated_guest_token_and_matches_the_existing_hasher()
    {
        var token = new CryptographicGuestAccessTokenGenerator().Generate();

        var accepted = BookingAccessTokenValidator.TryHash(token, out var hash);

        Assert.True(accepted);
        Assert.Equal(BookingHoldRequestSecurity.Sha256Hex(token), hash);
        Assert.Matches("^[0-9a-f]{64}$", hash);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_missing_or_blank_tokens(string? token)
    {
        Assert.False(BookingAccessTokenValidator.TryHash(token, out var hash));
        Assert.Equal(string.Empty, hash);
    }

    [Fact]
    public void Rejects_padded_base64_representation()
    {
        var token = new CryptographicGuestAccessTokenGenerator().Generate();
        var padded = token.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight((padded.Length + 3) / 4 * 4, '=');

        Assert.False(BookingAccessTokenValidator.TryHash(padded, out _));
    }

    [Theory]
    [InlineData("not-valid-base64url-!!!")]
    [InlineData("has spaces in it")]
    [InlineData("contains=padding=chars=====")]
    [InlineData("contains+plus/slash+chars//")]
    public void Rejects_non_base64url_characters(string token)
    {
        Assert.False(BookingAccessTokenValidator.TryHash(token, out _));
    }

    [Fact]
    public void Rejects_wrong_decoded_length()
    {
        var shortToken = new CryptographicGuestAccessTokenGenerator().Generate()[..20];
        var oversizedBytes = new byte[64];
        var oversizedToken = Convert.ToBase64String(oversizedBytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

        Assert.False(BookingAccessTokenValidator.TryHash(shortToken, out _));
        Assert.False(BookingAccessTokenValidator.TryHash(oversizedToken, out _));
    }

    [Fact]
    public void Rejects_invalid_length_remainder()
    {
        Assert.False(BookingAccessTokenValidator.TryHash("A", out _));
        Assert.False(BookingAccessTokenValidator.TryHash("ABCDE", out _));
    }
}
