using System.Text.RegularExpressions;
using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

internal static partial class BookingGuard
{
    public static void ValidateHeader(
        Guid id,
        Guid propertyId,
        Guid roomTypeId,
        Guid ratePlanId,
        DateOnly checkIn,
        DateOnly checkOut,
        int adults,
        int children,
        int rooms,
        decimal totalAmount)
    {
        DomainGuard.RequiredId(id, nameof(id));
        DomainGuard.RequiredId(propertyId, nameof(propertyId));
        DomainGuard.RequiredId(roomTypeId, nameof(roomTypeId));
        DomainGuard.RequiredId(ratePlanId, nameof(ratePlanId));

        if (checkIn >= checkOut)
        {
            throw new DomainException("checkIn must be earlier than checkOut.");
        }

        if (adults < 1)
        {
            throw new DomainException("adults must be at least one.");
        }

        if (children < 0)
        {
            throw new DomainException("children cannot be negative.");
        }

        if (rooms < 1)
        {
            throw new DomainException("rooms must be at least one.");
        }

        ValidateMoney(totalAmount, nameof(totalAmount));
    }

    public static (string FullName, string Email, string Phone) NormalizeContact(
        string fullName,
        string email,
        string phone)
    {
        var normalizedFullName = DomainGuard.Required(
            fullName,
            nameof(fullName),
            BookingFieldLimits.FullName);
        var normalizedEmail = DomainGuard.Required(
            email,
            nameof(email),
            BookingFieldLimits.Email);
        var normalizedPhone = DomainGuard.Required(
            phone,
            nameof(phone),
            BookingFieldLimits.Phone);

        if (!EmailPattern().IsMatch(normalizedEmail))
        {
            throw new DomainException("email must be a valid contact email.");
        }

        if (!PhonePattern().IsMatch(normalizedPhone) ||
            !normalizedPhone.Any(char.IsAsciiDigit))
        {
            throw new DomainException("phone must be a valid contact phone.");
        }

        return (normalizedFullName, normalizedEmail, normalizedPhone);
    }

    public static string NormalizeCurrency(string currencyCode)
    {
        var normalized = DomainGuard.Required(currencyCode, nameof(currencyCode), 3)
            .ToUpperInvariant();
        if (!CurrencyPattern().IsMatch(normalized))
        {
            throw new DomainException(
                "currencyCode must be exactly three alphabetic characters.");
        }

        return normalized;
    }

    public static string NormalizeHash(string value, string parameterName)
    {
        var normalized = DomainGuard.Required(
            value,
            parameterName,
            BookingFieldLimits.Sha256Hash);
        if (!Sha256HashPattern().IsMatch(normalized))
        {
            throw new DomainException(
                $"{parameterName} must be a {BookingFieldLimits.Sha256Hash}-character lowercase hexadecimal SHA-256 hash.");
        }

        return normalized;
    }

    public static string? ValidateOwnership(
        Guid? customerAccountId,
        string? guestAccessTokenHash)
    {
        if (customerAccountId is { } accountId)
        {
            DomainGuard.RequiredId(accountId, nameof(customerAccountId));
            if (guestAccessTokenHash is not null)
            {
                throw new DomainException(
                    "Authenticated ownership cannot include a guest access-token hash.");
            }

            return null;
        }

        if (guestAccessTokenHash is null)
        {
            throw new DomainException(
                "Guest ownership requires a guest access-token hash.");
        }

        return NormalizeHash(guestAccessTokenHash, nameof(guestAccessTokenHash));
    }

    public static DateTimeOffset RequireUtc(
        DateTimeOffset value,
        string parameterName)
    {
        if (value.Offset != TimeSpan.Zero)
        {
            throw new DomainException($"{parameterName} must be UTC.");
        }

        return value;
    }

    public static IReadOnlyList<BookingNightSnapshot> ValidateNights(
        DateOnly checkIn,
        DateOnly checkOut,
        int rooms,
        decimal totalAmount,
        IEnumerable<BookingNightSnapshot> nights)
    {
        ArgumentNullException.ThrowIfNull(nights);
        var ordered = nights.OrderBy(night => night.StayDate).ToArray();
        var expectedNightCount = checkOut.DayNumber - checkIn.DayNumber;
        if (ordered.Length != expectedNightCount)
        {
            throw new DomainException(
                "Night snapshots must cover every stay date exactly once.");
        }

        if (ordered.Select(night => night.StayDate).Distinct().Count() != ordered.Length)
        {
            throw new DomainException("Night snapshot stay dates must be unique.");
        }

        decimal calculatedTotal = 0;
        for (var index = 0; index < ordered.Length; index++)
        {
            var night = ordered[index];
            var expectedDate = checkIn.AddDays(index);
            if (night.StayDate != expectedDate)
            {
                throw new DomainException(
                    "Night snapshots must be contiguous and exactly cover the stay.");
            }

            if (night.Rooms != rooms)
            {
                throw new DomainException(
                    "Every night snapshot must use the aggregate room quantity.");
            }

            ValidateMoney(night.UnitAmount, nameof(night.UnitAmount));
            ValidateMoney(night.NightTotal, nameof(night.NightTotal));

            decimal expectedNightTotal;
            try
            {
                expectedNightTotal = night.UnitAmount * rooms;
                calculatedTotal += night.NightTotal;
            }
            catch (OverflowException)
            {
                throw new DomainException("Night snapshot amounts exceed supported precision.");
            }

            if (night.NightTotal != expectedNightTotal)
            {
                throw new DomainException(
                    "nightTotal must equal unitAmount multiplied by rooms.");
            }
        }

        if (calculatedTotal != totalAmount)
        {
            throw new DomainException(
                "totalAmount must equal the sum of all nightly totals.");
        }

        return ordered;
    }

    public static string NormalizeConfirmationNumber(string confirmationNumber)
    {
        var normalized = DomainGuard.Required(
                confirmationNumber,
                nameof(confirmationNumber),
                BookingFieldLimits.ConfirmationNumber)
            .ToUpperInvariant();
        if (!ConfirmationNumberPattern().IsMatch(normalized))
        {
            throw new DomainException(
                "confirmationNumber may contain only uppercase letters, digits, and hyphens.");
        }

        return normalized;
    }

    public static string? ValidateCancellation(
        ReservationStatus status,
        DateTimeOffset confirmedAtUtc,
        DateTimeOffset? cancelledAtUtc,
        string? cancellationReason)
    {
        if (!Enum.IsDefined(status))
        {
            throw new DomainException("status is invalid.");
        }

        if (status == ReservationStatus.Confirmed)
        {
            if (cancelledAtUtc is not null || cancellationReason is not null)
            {
                throw new DomainException(
                    "A confirmed reservation cannot contain cancellation data.");
            }

            return null;
        }

        if (cancelledAtUtc is null)
        {
            throw new DomainException(
                "A cancelled reservation requires cancelledAtUtc.");
        }

        RequireUtc(cancelledAtUtc.Value, nameof(cancelledAtUtc));
        if (cancelledAtUtc < confirmedAtUtc)
        {
            throw new DomainException(
                "cancelledAtUtc cannot be earlier than confirmedAtUtc.");
        }

        return DomainGuard.Required(
            cancellationReason!,
            nameof(cancellationReason),
            BookingFieldLimits.CancellationReason);
    }

    private static void ValidateMoney(decimal amount, string parameterName)
    {
        if (amount <= 0)
        {
            throw new DomainException($"{parameterName} must be greater than zero.");
        }

        if (decimal.Round(amount, 2) != amount)
        {
            throw new DomainException(
                $"{parameterName} cannot contain more than two decimal places.");
        }

        if (amount > 9_999_999_999_999_999.99m)
        {
            throw new DomainException(
                $"{parameterName} exceeds numeric(18,2) precision.");
        }
    }

    [GeneratedRegex("^[A-Z]{3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CurrencyPattern();

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256HashPattern();

    [GeneratedRegex(
        "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
        RegexOptions.CultureInvariant)]
    private static partial Regex EmailPattern();

    [GeneratedRegex(
        "^[0-9+(). -]{7,32}$",
        RegexOptions.CultureInvariant)]
    private static partial Regex PhonePattern();

    [GeneratedRegex("^[A-Z0-9-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex ConfirmationNumberPattern();
}
