namespace TheBha.Application.Bookings;

public static class BookingAccessTokenValidator
{
    public static bool TryHash(string? rawToken, out string tokenHash)
    {
        tokenHash = string.Empty;
        if (string.IsNullOrEmpty(rawToken))
        {
            return false;
        }

        foreach (var character in rawToken)
        {
            var isBase64UrlCharacter =
                char.IsAsciiLetterOrDigit(character) || character is '-' or '_';
            if (!isBase64UrlCharacter)
            {
                return false;
            }
        }

        var remainder = rawToken.Length % 4;
        var padded = remainder switch
        {
            0 => rawToken,
            2 => rawToken + "==",
            3 => rawToken + "=",
            _ => null
        };
        if (padded is null)
        {
            return false;
        }

        byte[] decoded;
        try
        {
            decoded = Convert.FromBase64String(
                padded.Replace('-', '+').Replace('_', '/'));
        }
        catch (FormatException)
        {
            return false;
        }

        if (decoded.Length != BookingHoldCreationLimits.GuestTokenEntropyBytes)
        {
            return false;
        }

        tokenHash = BookingHoldRequestSecurity.Sha256Hex(rawToken);
        return true;
    }
}
