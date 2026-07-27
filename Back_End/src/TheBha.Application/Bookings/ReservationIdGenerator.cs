using System.Security.Cryptography;

namespace TheBha.Application.Bookings;

public interface IReservationIdGenerator
{
    Guid Generate();
}

public sealed class CryptographicReservationIdGenerator(
    Func<byte[]>? randomBytesSource = null) : IReservationIdGenerator
{
    private const int IdBytes = 16;
    private readonly Func<byte[]> _randomBytesSource = randomBytesSource ?? DefaultFill;

    public Guid Generate()
    {
        Guid candidate;
        do
        {
            var bytes = _randomBytesSource();
            if (bytes.Length != IdBytes)
            {
                throw new InvalidOperationException(
                    $"Reservation ID source must produce exactly {IdBytes} bytes.");
            }

            candidate = new Guid(bytes);
        } while (candidate == Guid.Empty);

        return candidate;
    }

    private static byte[] DefaultFill()
    {
        var bytes = new byte[IdBytes];
        RandomNumberGenerator.Fill(bytes);
        return bytes;
    }
}
