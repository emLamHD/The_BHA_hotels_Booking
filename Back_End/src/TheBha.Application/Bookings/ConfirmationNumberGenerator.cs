using System.Text;

namespace TheBha.Application.Bookings;

public static class ConfirmationNumberGenerator
{
    private const string Prefix = "BHA";
    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string Generate(Guid reservationId)
    {
        Span<byte> bytes = stackalloc byte[16];
        var wrote = reservationId.TryWriteBytes(bytes);
        if (!wrote)
        {
            throw new InvalidOperationException("Guid could not be written to a 16-byte buffer.");
        }

        return Prefix + Base32Encode(bytes);
    }

    private static string Base32Encode(ReadOnlySpan<byte> data)
    {
        var builder = new StringBuilder((data.Length * 8 + 4) / 5);
        var bitBuffer = 0;
        var bitsInBuffer = 0;
        foreach (var value in data)
        {
            bitBuffer = (bitBuffer << 8) | value;
            bitsInBuffer += 8;
            while (bitsInBuffer >= 5)
            {
                bitsInBuffer -= 5;
                var index = (bitBuffer >> bitsInBuffer) & 0x1F;
                builder.Append(Base32Alphabet[index]);
            }
        }

        if (bitsInBuffer > 0)
        {
            var index = (bitBuffer << (5 - bitsInBuffer)) & 0x1F;
            builder.Append(Base32Alphabet[index]);
        }

        return builder.ToString();
    }
}
