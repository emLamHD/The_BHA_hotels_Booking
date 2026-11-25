using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TheBha.Application.Bookings;
using TheBha.Application.Notifications;
using TheBha.Domain.Bookings;
using TheBha.Domain.Notifications;

namespace TheBha.Infrastructure.Persistence.Notifications;

/// <summary>
/// BHA-CHECKOUT-001-PR07: fans one <c>ReservationConfirmed</c> v1 event out into the booking mails. It runs INSIDE the dispatcher's fan-out transaction on that scope's own <c>TheBhaDbContext</c>:
/// it reads (never tracked), takes the reservation's transition lock (so a cancellation and this fan-out never interleave), issues the guest link in that same transaction and returns drafts; the dispatcher renders them,
/// protects them and inserts the deliveries together with the event's completion. Anything that throws rolls the link back with the rest.
/// <list type="bullet">
/// <item>Cancelled when read → no mail (the event completes with no delivery). Not Direct, not Confirmed, unknown in this Property, or a payload that is not exactly <c>{"reservationId":"&lt;guid&gt;"}</c> → rejected with a safe code.</item>
/// <item>One delivery to the contact address stored on the reservation (a guest gets a management link, an owner account does not) and one per Property recipient (<see cref="IBookingNotificationRecipients"/>). A missing or invalid
/// guest address never blocks the Staff mail; an empty Staff list never blocks the guest mail.</item>
/// </list>
/// </summary>
internal sealed class BookingConfirmationEmailHandler(
    TheBhaDbContext db,
    IBookingNotificationRecipients recipients,
    IReservationManagementLinkIssuer linkIssuer,
    BookingConfirmationEmailOptions options,
    ILogger<BookingConfirmationEmailHandler> logger) : IEmailOutboxEventHandler
{
    // No stored locale exists on a reservation or a customer, so every mail is Vietnamese (the template default). When a source is added, resolve it here.
    private const string Locale = "vi";

    public string EventType => BookingEmailEvents.ReservationConfirmed;

    public int SchemaVersion => BookingEmailEvents.ReservationConfirmedSchemaVersion;

    public async Task<IReadOnlyList<EmailDeliveryDraft>> HandleAsync(EmailOutboxEventContext context, CancellationToken cancellationToken)
    {
        var reservationId = ReadReservationId(context.Payload);
        await AdvisoryLockCoordinator.AcquireKeyAsync(db, BookingAdvisoryLockKeys.ForReservationTransition(reservationId), cancellationToken);

        var reservation = await db.Reservations.AsNoTracking()
            .Where(item => item.Id == reservationId && item.PropertyId == context.PropertyId)
            .Select(item => new
            {
                item.Source, item.Status, item.CustomerAccountId, item.ConfirmationNumber, item.FullName, item.Email, item.CheckIn, item.CheckOut, item.Adults, item.Children,
                item.CurrencyCode, item.TotalAmount, Rooms = item.Units.Count()
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new EmailOutboxEventRejectedException("reservation-not-found");
        if (reservation.Source != ReservationSource.Direct) throw new EmailOutboxEventRejectedException("reservation-not-direct");
        if (reservation.Status == ReservationStatus.Cancelled) return [];
        if (reservation.Status != ReservationStatus.Confirmed) throw new EmailOutboxEventRejectedException("reservation-not-confirmed");

        var property = await db.Properties.AsNoTracking().Where(item => item.Id == context.PropertyId)
            .Select(item => new { item.Name, item.Address, item.City, item.CheckInTime })
            .SingleAsync(cancellationToken);
        var drafts = new List<EmailDeliveryDraft>();

        var common = new Dictionary<string, string>
        {
            ["confirmationNumber"] = reservation.ConfirmationNumber,
            ["propertyName"] = property.Name,
            ["guestName"] = reservation.FullName,
            ["checkIn"] = BookingEmailFormat.Date(reservation.CheckIn),
            ["checkOut"] = BookingEmailFormat.Date(reservation.CheckOut),
            ["rooms"] = reservation.Rooms.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["adults"] = reservation.Adults.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["children"] = reservation.Children.ToString(System.Globalization.CultureInfo.InvariantCulture)
        };

        if (!EmailText.IsAddress(reservation.Email))
        {
            // Ids only: never the address the guest typed.
            logger.LogWarning("Booking e-mail for event {EventId}: the guest address is missing or invalid (guest-address-invalid); only the Property recipients are queued.", context.EventId);
        }
        else
        {
            var guest = new Dictionary<string, string>(common)
            {
                ["propertyAddress"] = string.Join(", ", new[] { property.Address, property.City }.Where(part => !string.IsNullOrWhiteSpace(part))),
                ["checkInTime"] = BookingEmailFormat.Time(property.CheckInTime),
                ["totalAmount"] = BookingEmailFormat.Money(reservation.TotalAmount, reservation.CurrencyCode, Locale)
            };
            if (reservation.CustomerAccountId is null)
            {
                // Inside this fan-out transaction, beside the delivery that will carry the secret: they commit or roll back together.
                var issued = await linkIssuer.IssueAsync(context.PropertyId, reservationId, ReservationManagementRules.DefaultLinkTtl, cancellationToken);
                if (issued.Status != ReservationManagementLinkIssueStatus.Issued || issued.Secret is null) throw new EmailOutboxEventRejectedException("link-not-eligible");
                guest["manageNotice"] = $"Quản lý đặt phòng (cập nhật giờ đến dự kiến): {ReservationManagementUrl.Build(options.NormalizedOrigin()!, reservationId, issued.Secret)} - "
                                        + $"liên kết chỉ dùng một lần, có hiệu lực {(int)ReservationManagementRules.DefaultLinkTtl.TotalHours} giờ. Vui lòng không chia sẻ liên kết này.";
                drafts.Add(new EmailDeliveryDraft(BookingEmailPurposes.GuestWithLink, BookingEmailPurposes.GuestKey(reservationId), reservation.Email, Locale, BookingEmailPurposes.GuestTemplate, guest));
            }
            else
            {
                guest["manageNotice"] = "Bạn có thể xem đặt phòng này trong tài khoản của mình.";
                drafts.Add(new EmailDeliveryDraft(BookingEmailPurposes.Account, BookingEmailPurposes.GuestKey(reservationId), reservation.Email, Locale, BookingEmailPurposes.AccountTemplate, guest));
            }
        }

        var staff = (await recipients.ResolveAsync(context.PropertyId, cancellationToken)).Recipients;
        var room = EmailOutboxLimits.DeliveriesPerEvent - drafts.Count;
        if (staff.Count > room)
        {
            // Resolver order is deterministic (local before chain, address, Staff id): the tail is dropped, never the guest mail.
            logger.LogWarning("Booking e-mail for event {EventId}: {Count} Property recipients exceed the {Room} deliveries one event may carry (recipients-truncated).", context.EventId, staff.Count, room);
        }

        foreach (var recipient in staff.Take(room))
        {
            drafts.Add(new EmailDeliveryDraft(BookingEmailPurposes.Staff, recipient.Key, recipient.Email, Locale, BookingEmailPurposes.StaffTemplate, common));
        }

        return drafts;
    }

    private static Guid ReadReservationId(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) throw new EmailOutboxEventRejectedException("payload-invalid");
        var properties = payload.EnumerateObject().ToList();
        if (properties.Count != 1 || properties[0].Name != "reservationId" || properties[0].Value.ValueKind != JsonValueKind.String
            || !Guid.TryParseExact(properties[0].Value.GetString(), "D", out var id) || id == Guid.Empty)
        {
            throw new EmailOutboxEventRejectedException("payload-invalid");
        }

        return id;
    }
}

/// <summary>Right before the provider is called, a Property recipient must still be one: disabled, opted out, membership lost or the address changed after fan-out stops the delivery.</summary>
internal sealed class StaffRecipientStillEligibleGuard(IBookingNotificationRecipients recipients) : IEmailDeliveryPreSendGuard
{
    public string Purpose => BookingEmailPurposes.Staff;

    public async Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken) =>
        await recipients.IsStillRecipientAsync(context.PropertyId, context.Recipient, cancellationToken) ? EmailPreSendVerdict.Send : EmailPreSendVerdict.Stop("recipient-revoked");
}

/// <summary>
/// A guest mail whose link would not live through the provider call is not sent. The link was issued after this delivery's fan-out instant (<c>CreatedAtUtc</c>) with the default lifetime, so
/// <c>CreatedAtUtc + lifetime</c> is a bound the real expiry never undercuts: no lookup of the link, and the secret never has to be read back from the stored mail.
/// </summary>
internal sealed class GuestLinkStillValidGuard : IEmailDeliveryPreSendGuard
{
    public string Purpose => BookingEmailPurposes.GuestWithLink;

    public Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken) =>
        Task.FromResult(context.NowUtc + context.CallTimeout >= context.CreatedAtUtc + ReservationManagementRules.DefaultLinkTtl ? EmailPreSendVerdict.Stop("link-expired") : EmailPreSendVerdict.Send);
}
