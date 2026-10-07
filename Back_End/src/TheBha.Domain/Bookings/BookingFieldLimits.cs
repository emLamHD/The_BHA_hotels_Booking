namespace TheBha.Domain.Bookings;

public static class BookingFieldLimits
{
    public const int FullName = 200;
    public const int Email = 256;
    public const int Phone = 32;
    public const int Sha256Hash = 64;
    public const int ConfirmationNumber = 32;
    public const int CancellationReason = 500;
}
