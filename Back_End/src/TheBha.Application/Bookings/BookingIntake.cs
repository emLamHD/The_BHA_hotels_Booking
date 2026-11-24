namespace TheBha.Application.Bookings;

/// <summary>
/// BHA-CHECKOUT-001-PR05: the two application settings that decide whether a NEW reservation is taken, bound from <c>Booking</c>. Plain configuration, frozen at start-up (no screen, no database flag):
/// <c>Booking:AcceptingNewReservations</c> (default true) stops every new Hold and every new Direct reservation; <c>Booking:DirectCheckout:PropertyIds</c> (default empty = off) lists the Properties that may be
/// booked directly. Neither switch affects reading, cancelling, a replay of something already committed, or confirming a Hold that is already Active, and neither overrides a stop-sell.
/// </summary>
public sealed class BookingIntakeOptions
{
    public const string SectionName = "Booking";

    public bool AcceptingNewReservations { get; set; } = true;

    public DirectCheckoutOptions DirectCheckout { get; set; } = new();

    public sealed class DirectCheckoutOptions
    {
        public string[] PropertyIds { get; set; } = [];
    }

    /// <summary>Throws <see cref="InvalidOperationException"/> naming the setting when a value cannot work, so a bad value stops the host before it listens.</summary>
    public BookingIntake Build()
    {
        var ids = new HashSet<Guid>();
        foreach (var raw in DirectCheckout.PropertyIds ?? [])
        {
            if (!Guid.TryParse(raw?.Trim(), out var id) || id == Guid.Empty)
            {
                throw new InvalidOperationException("Booking:DirectCheckout:PropertyIds must contain only non-empty Property ids (GUIDs).");
            }

            if (!ids.Add(id))
            {
                throw new InvalidOperationException("Booking:DirectCheckout:PropertyIds lists the same Property twice.");
            }
        }

        return new BookingIntake(AcceptingNewReservations, ids);
    }
}

/// <summary>The validated, immutable form of <see cref="BookingIntakeOptions"/>.</summary>
public sealed class BookingIntake(bool acceptingNewReservations, IReadOnlySet<Guid> directPropertyIds)
{
    /// <summary>The default every environment starts from: accepting, with Direct off everywhere.</summary>
    public static BookingIntake Default { get; } = new(true, new HashSet<Guid>());

    public bool AcceptingNewReservations { get; } = acceptingNewReservations;

    public IReadOnlySet<Guid> DirectPropertyIds { get; } = directPropertyIds;

    public bool AllowsDirect(Guid propertyId) => DirectPropertyIds.Contains(propertyId);
}
