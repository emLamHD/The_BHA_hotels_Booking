using TheBha.Application.Customers;

namespace TheBha.Application.Bookings;

/// <summary>
/// Shared caller-credential resolution for the ownership-protected lifecycle operations
/// (Hold read, Hold cancellation, Reservation cancellation). Resolution uses OR semantics:
/// an authenticated customer session and/or a guest access token may be presented, and either
/// is sufficient to attempt the operation. Ownership against the specific resource is decided
/// later by the Infrastructure store, never here.
/// </summary>
internal static class BookingCredentialResolver
{
    public static bool TryResolve(
        ICurrentCustomer currentCustomer,
        string? guestAccessToken,
        out Guid? customerAccountId,
        out string? guestAccessTokenHash,
        out string? error)
    {
        customerAccountId = null;
        guestAccessTokenHash = null;
        error = null;

        if (currentCustomer.IsAuthenticated)
        {
            if (currentCustomer.CustomerAccountId is not { } resolvedId || resolvedId == Guid.Empty)
            {
                error = "A valid customer session is required.";
                return false;
            }

            customerAccountId = resolvedId;
        }

        if (!string.IsNullOrEmpty(guestAccessToken))
        {
            if (!BookingAccessTokenValidator.TryHash(guestAccessToken, out var hash))
            {
                error = "The supplied booking access token is malformed.";
                return false;
            }

            guestAccessTokenHash = hash;
        }

        if (customerAccountId is null && guestAccessTokenHash is null)
        {
            error = "A customer session or booking access token is required.";
            return false;
        }

        return true;
    }
}
