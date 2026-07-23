using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using TheBha.Application.Customers;
using TheBha.Application.Properties;
using TheBha.Domain.Bookings;

namespace TheBha.Application.Bookings;

public static class BookingHoldCreationLimits
{
    public const int IdempotencyKeyUtf8Bytes = 256;
    public const int GuestTokenEntropyBytes = 32;
}

public sealed record CreateBookingHoldRequest(
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string? FullName,
    string? Email,
    string? Phone);

public sealed record BookingHoldNightDto(
    DateOnly StayDate,
    int Rooms,
    decimal UnitAmount,
    decimal NightTotal);

public sealed record BookingHoldDto(
    Guid HoldId,
    BookingHoldStatus Status,
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string CurrencyCode,
    decimal TotalAmount,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    IReadOnlyList<BookingHoldNightDto> Nights,
    string? GuestAccessToken);

public enum BookingHoldCreationStatus
{
    Created,
    Replayed,
    Invalid,
    Unauthorized,
    NotFound,
    Conflict
}

public sealed record BookingHoldCreationResult(
    BookingHoldCreationStatus Status,
    BookingHoldDto? Hold,
    string? Error)
{
    public static BookingHoldCreationResult Created(BookingHoldDto hold) =>
        new(BookingHoldCreationStatus.Created, hold, null);

    public static BookingHoldCreationResult Replayed(BookingHoldDto hold) =>
        new(BookingHoldCreationStatus.Replayed, hold, null);

    public static BookingHoldCreationResult Invalid(string error) =>
        new(BookingHoldCreationStatus.Invalid, null, error);

    public static BookingHoldCreationResult Unauthorized(string error) =>
        new(BookingHoldCreationStatus.Unauthorized, null, error);

    public static BookingHoldCreationResult NotFound(string error) =>
        new(BookingHoldCreationStatus.NotFound, null, error);

    public static BookingHoldCreationResult Conflict(string error) =>
        new(BookingHoldCreationStatus.Conflict, null, error);
}

public sealed record PreparedBookingHoldRequest(
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    string FullName,
    string Email,
    string Phone,
    Guid? CustomerAccountId,
    string IdempotencyKeyHash,
    string RequestFingerprint);

public interface IBookingHoldCreationStore
{
    Task<BookingHoldCreationResult> CreateAsync(
        PreparedBookingHoldRequest request,
        CancellationToken cancellationToken);
}

public interface IGuestAccessTokenGenerator
{
    string Generate();
}

public interface IBookingHoldCreation
{
    Task<BookingHoldCreationResult> CreateAsync(
        string? idempotencyKey,
        CreateBookingHoldRequest request,
        CancellationToken cancellationToken);
}

public sealed class CryptographicGuestAccessTokenGenerator : IGuestAccessTokenGenerator
{
    public string Generate()
    {
        Span<byte> entropy = stackalloc byte[BookingHoldCreationLimits.GuestTokenEntropyBytes];
        RandomNumberGenerator.Fill(entropy);
        return Convert.ToBase64String(entropy)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}

public sealed class BookingHoldCreation(
    ICurrentCustomer currentCustomer,
    IBookingHoldCreationStore store) : IBookingHoldCreation
{
    public async Task<BookingHoldCreationResult> CreateAsync(
        string? idempotencyKey,
        CreateBookingHoldRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var keyError = BookingHoldRequestSecurity.ValidateIdempotencyKey(idempotencyKey);
        if (keyError is not null)
        {
            return BookingHoldCreationResult.Invalid(keyError);
        }

        var requestError = BookingHoldRequestSecurity.TryNormalizeRequest(
            request,
            out var normalized);
        if (requestError is not null)
        {
            return BookingHoldCreationResult.Invalid(requestError);
        }

        Guid? customerAccountId = null;
        if (currentCustomer.IsAuthenticated)
        {
            if (currentCustomer.CustomerAccountId is not { } resolvedId ||
                resolvedId == Guid.Empty)
            {
                return BookingHoldCreationResult.Unauthorized(
                    "A valid customer session is required.");
            }

            customerAccountId = resolvedId;
        }

        var keyHash = BookingHoldRequestSecurity.Sha256Hex(idempotencyKey!);
        var fingerprint = BookingHoldRequestSecurity.CreateFingerprint(
            normalized,
            customerAccountId);

        return await store.CreateAsync(
            new PreparedBookingHoldRequest(
                normalized.PropertyId,
                normalized.RoomTypeId,
                normalized.RatePlanId,
                normalized.CheckIn,
                normalized.CheckOut,
                normalized.Adults,
                normalized.Children,
                normalized.Rooms,
                normalized.FullName!,
                normalized.Email!,
                normalized.Phone!,
                customerAccountId,
                keyHash,
                fingerprint),
            cancellationToken);
    }
}

public static partial class BookingHoldRequestSecurity
{
    private const string FingerprintVersion = "thebha-booking-hold-request:v1";
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static string? ValidateIdempotencyKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "Idempotency-Key is required.";
        }

        if (value.Any(char.IsControl))
        {
            return "Idempotency-Key cannot contain control characters.";
        }

        int byteCount;
        try
        {
            byteCount = StrictUtf8.GetByteCount(value);
        }
        catch (EncoderFallbackException)
        {
            return "Idempotency-Key must contain valid UTF-8 text.";
        }

        return byteCount > BookingHoldCreationLimits.IdempotencyKeyUtf8Bytes
            ? $"Idempotency-Key cannot exceed {BookingHoldCreationLimits.IdempotencyKeyUtf8Bytes} UTF-8 bytes."
            : null;
    }

    public static string? TryNormalizeRequest(
        CreateBookingHoldRequest request,
        out CreateBookingHoldRequest normalized)
    {
        normalized = request;
        if (request.PropertyId == Guid.Empty) return "propertyId is required.";
        if (request.RoomTypeId == Guid.Empty) return "roomTypeId is required.";
        if (request.RatePlanId == Guid.Empty) return "ratePlanId is required.";
        if (request.CheckIn >= request.CheckOut) return "checkIn must be earlier than checkOut.";
        if (request.CheckOut.DayNumber - request.CheckIn.DayNumber >
            AvailabilitySearchLimits.MaxStayNights)
        {
            return $"Stay cannot exceed {AvailabilitySearchLimits.MaxStayNights} nights.";
        }

        if (request.Adults < 1) return "adults must be at least one.";
        if (request.Children < 0) return "children cannot be negative.";
        if (request.Rooms < 1) return "rooms must be at least one.";
        if (request.Rooms > AvailabilitySearchLimits.MaxRequestedRooms)
        {
            return $"rooms cannot exceed {AvailabilitySearchLimits.MaxRequestedRooms}.";
        }

        var fullName = request.FullName?.Trim();
        var email = request.Email?.Trim();
        var phone = request.Phone?.Trim();
        if (string.IsNullOrWhiteSpace(fullName) ||
            fullName.Length > BookingFieldLimits.FullName)
        {
            return $"fullName is required and cannot exceed {BookingFieldLimits.FullName} characters.";
        }

        if (string.IsNullOrWhiteSpace(email) ||
            email.Length > BookingFieldLimits.Email ||
            !EmailPattern().IsMatch(email))
        {
            return "email must be a valid contact email.";
        }

        if (string.IsNullOrWhiteSpace(phone) ||
            phone.Length > BookingFieldLimits.Phone ||
            !PhonePattern().IsMatch(phone) ||
            !phone.Any(char.IsAsciiDigit))
        {
            return "phone must be a valid contact phone.";
        }

        normalized = request with
        {
            FullName = fullName,
            Email = email,
            Phone = phone
        };
        return null;
    }

    public static string CreateFingerprint(
        CreateBookingHoldRequest normalizedRequest,
        Guid? customerAccountId)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Append(hash, FingerprintVersion);
        Append(hash, normalizedRequest.PropertyId.ToString("D"));
        Append(hash, normalizedRequest.RoomTypeId.ToString("D"));
        Append(hash, normalizedRequest.RatePlanId.ToString("D"));
        Append(
            hash,
            normalizedRequest.CheckIn.ToString(
                "yyyy-MM-dd",
                System.Globalization.CultureInfo.InvariantCulture));
        Append(
            hash,
            normalizedRequest.CheckOut.ToString(
                "yyyy-MM-dd",
                System.Globalization.CultureInfo.InvariantCulture));
        Append(hash, normalizedRequest.Adults.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Append(hash, normalizedRequest.Children.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Append(hash, normalizedRequest.Rooms.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Append(hash, normalizedRequest.FullName!);
        Append(hash, normalizedRequest.Email!);
        Append(hash, normalizedRequest.Phone!);
        Append(
            hash,
            customerAccountId is { } id
                ? $"customer:{id:D}"
                : "guest");
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    public static string Sha256Hex(string value)
    {
        var bytes = StrictUtf8.GetBytes(value);
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static void Append(IncrementalHash hash, string value)
    {
        var bytes = StrictUtf8.GetBytes(value);
        Span<byte> length = stackalloc byte[sizeof(int)];
        BinaryPrimitives.WriteInt32BigEndian(length, bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }

    [GeneratedRegex(
        "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
        RegexOptions.CultureInvariant)]
    private static partial Regex EmailPattern();

    [GeneratedRegex(
        "^[0-9+(). -]{7,32}$",
        RegexOptions.CultureInvariant)]
    private static partial Regex PhonePattern();
}
