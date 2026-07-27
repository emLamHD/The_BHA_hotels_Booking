namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// Shared OR-ownership predicate for the booking lifecycle stores: a caller owns a resource
/// if its authenticated customer id matches, or its guest access-token hash matches. Never
/// email, phone, confirmation number, or source Hold id.
/// </summary>
internal static class BookingOwnership
{
    public static bool IsOwner(
        Guid? resourceCustomerAccountId,
        string? resourceGuestAccessTokenHash,
        Guid? customerAccountId,
        string? guestAccessTokenHash) =>
        (customerAccountId is not null &&
         resourceCustomerAccountId == customerAccountId) ||
        (guestAccessTokenHash is not null &&
         resourceGuestAccessTokenHash == guestAccessTokenHash);
}
