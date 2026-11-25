using System.Globalization;

namespace TheBha.Application.Notifications;

/// <summary>
/// BHA-CHECKOUT-001-PR07: the switch and the static origin of the booking-confirmation e-mails, bound from <c>Booking:ConfirmationEmail</c>. Off by default. The handler is registered only when the feature is on, the
/// origin is a valid https origin AND the provider is configured (<see cref="IsActive"/>): otherwise <c>ReservationConfirmed</c> events have no handler, so they stay Pending, spend no attempt and issue no link.
/// </summary>
public sealed class BookingConfirmationEmailOptions
{
    public const string SectionName = "Booking:ConfirmationEmail";

    public bool Enabled { get; set; }

    /// <summary>The Customer_Web https origin (no path) the guest link points at. Configured, never read from a request.</summary>
    public string? CustomerWebOrigin { get; set; }

    /// <summary>The normalised origin, or null when none is configured. Throws when one is configured but is not an https origin with no path, so a typo fails loudly at start-up.</summary>
    public string? NormalizedOrigin()
    {
        if (string.IsNullOrWhiteSpace(CustomerWebOrigin)) return null;
        var value = CustomerWebOrigin.Trim();
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException("Booking:ConfirmationEmail:CustomerWebOrigin must be an https origin with no path, query or fragment.");
        }

        return value.TrimEnd('/');
    }

    public bool IsActive(EmailOutboxOptions outbox) => Enabled && NormalizedOrigin() is not null && outbox.Resend.IsConfigured;
}

/// <summary>Purposes and template keys of the booking mails. A purpose names a group of recipients, so the pre-send guard can be chosen by it.</summary>
public static class BookingEmailPurposes
{
    /// <summary>The guest of a Direct reservation without an account: the mail carries the one-use management link.</summary>
    public const string GuestWithLink = "booking-confirmation.guest";

    /// <summary>The owner account of a Direct reservation: no link.</summary>
    public const string Account = "booking-confirmation.account";

    /// <summary>One delivery per Property recipient.</summary>
    public const string Staff = "booking-confirmation.staff";

    public const string GuestTemplate = "booking-confirmation-guest";
    public const string AccountTemplate = "booking-confirmation-account";
    public const string StaffTemplate = "booking-confirmation-staff";

    public static string GuestKey(Guid reservationId) => $"guest:{reservationId:N}";
}

/// <summary>The guest's management page, the contract PR09 implements: <c>{origin}/reservations/{id:D}/manage#{secret}</c>. The secret is only ever in the fragment.</summary>
public static class ReservationManagementUrl
{
    public static string Build(string origin, Guid reservationId, string secret) => $"{origin}/reservations/{reservationId:D}/manage#{secret}";
}

/// <summary>An event the handler refuses (payload or reservation not as the contract says). The dispatcher counts it like any handler failure and stores <see cref="Code"/> (a fixed safe word) as the event's outcome.</summary>
public sealed class EmailOutboxEventRejectedException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

/// <summary>What the dispatcher tells a guard about the delivery it is about to send. <see cref="Recipient"/> is the frozen, decrypted address.</summary>
public sealed record EmailPreSendContext(Guid DeliveryId, Guid EventId, Guid PropertyId, string Purpose, string RecipientKey, string Recipient, DateTimeOffset CreatedAtUtc, DateTimeOffset NowUtc, TimeSpan CallTimeout);

/// <summary><paramref name="Code"/> is a fixed safe word stored as the delivery's outcome; never an address, a name or a secret.</summary>
public sealed record EmailPreSendVerdict(bool Allow, string Code)
{
    public static EmailPreSendVerdict Send { get; } = new(true, "ok");

    public static EmailPreSendVerdict Stop(string code) => new(false, code);
}

/// <summary>
/// A last check, right before the provider is called (retries included), for the deliveries of one purpose. A stop is final: the delivery is closed as Failed when nothing could have been sent, or NeedsReconciliation
/// when an earlier attempt may have reached the provider. It runs with no transaction open and must not write.
/// </summary>
public interface IEmailDeliveryPreSendGuard
{
    string Purpose { get; }

    Task<EmailPreSendVerdict> CheckAsync(EmailPreSendContext context, CancellationToken cancellationToken);
}

/// <summary>Display rules of the booking mails. Hand-written, not culture data, so the text is the same on every host.</summary>
public static class BookingEmailFormat
{
    public static string Date(DateOnly date) => date.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    public static string Time(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);

    /// <summary>VND has no minor unit; any other currency is shown to two decimals. The group separator follows the locale.</summary>
    public static string Money(decimal amount, string currencyCode, string locale)
    {
        var separator = locale switch { "en" => ",", "fr" => " ", _ => "." };
        var number = currencyCode == "VND"
            ? decimal.Round(amount, 0, MidpointRounding.AwayFromZero).ToString("#,##0", CultureInfo.InvariantCulture)
            : amount.ToString("#,##0.00", CultureInfo.InvariantCulture);
        return $"{(separator == "," ? number : number.Replace(",", separator))} {currencyCode}";
    }
}

/// <summary>The three booking templates. Each text is real (VI default, EN, FR); the subject carries only the confirmation number and the Property's name, never a guest's name, address, phone or link.</summary>
public abstract class BookingEmailTemplate(string key, EmailTemplateText vi, EmailTemplateText en, EmailTemplateText fr) : IEmailTemplate
{
    public string Key => key;

    public string DefaultLocale => "vi";

    public IReadOnlyDictionary<string, EmailTemplateText> Locales { get; } = new Dictionary<string, EmailTemplateText> { ["vi"] = vi, ["en"] = en, ["fr"] = fr };

    protected static EmailTemplateText Make(string subject, string[] lines)
    {
        var text = string.Join("\n", lines);
        var html = "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222\">"
                   + string.Concat(lines.Select(line => line.Length == 0 ? string.Empty : $"<p style=\"margin:0 0 8px\">{line}</p>"))
                   + "</div>";
        return new EmailTemplateText(subject, text, html);
    }
}

public sealed class BookingGuestEmailTemplate() : BookingEmailTemplate(
    BookingEmailPurposes.GuestTemplate,
    Make("Xác nhận đặt phòng {{confirmationNumber}} - {{propertyName}}", [
        "Xin chào {{guestName}},", "Đặt phòng của bạn đã được xác nhận.", "",
        "Mã xác nhận: {{confirmationNumber}}", "Cơ sở: {{propertyName}}", "Địa chỉ: {{propertyAddress}}",
        "Nhận phòng: {{checkIn}} (từ {{checkInTime}})", "Trả phòng: {{checkOut}}", "Số phòng: {{rooms}} · Người lớn: {{adults}} · Trẻ em: {{children}}",
        "Tiền phòng đã xác nhận: {{totalAmount}}", "Thanh toán khi nhận phòng", "", "{{manageNotice}}"]),
    Make("Booking confirmation {{confirmationNumber}} - {{propertyName}}", [
        "Hello {{guestName}},", "Your booking is confirmed.", "",
        "Confirmation number: {{confirmationNumber}}", "Property: {{propertyName}}", "Address: {{propertyAddress}}",
        "Check-in: {{checkIn}} (from {{checkInTime}})", "Check-out: {{checkOut}}", "Rooms: {{rooms}} · Adults: {{adults}} · Children: {{children}}",
        "Confirmed room total: {{totalAmount}}", "Pay at the property on arrival", "", "{{manageNotice}}"]),
    Make("Confirmation de réservation {{confirmationNumber}} - {{propertyName}}", [
        "Bonjour {{guestName}},", "Votre réservation est confirmée.", "",
        "Numéro de confirmation : {{confirmationNumber}}", "Établissement : {{propertyName}}", "Adresse : {{propertyAddress}}",
        "Arrivée : {{checkIn}} (à partir de {{checkInTime}})", "Départ : {{checkOut}}", "Chambres : {{rooms}} · Adultes : {{adults}} · Enfants : {{children}}",
        "Total des chambres confirmé : {{totalAmount}}", "Paiement à l'établissement à l'arrivée", "", "{{manageNotice}}"]));

/// <summary>The same confirmation for an owner account: its notice points to the account, never to a guest link.</summary>
public sealed class BookingAccountEmailTemplate() : BookingEmailTemplate(
    BookingEmailPurposes.AccountTemplate,
    Make("Xác nhận đặt phòng {{confirmationNumber}} - {{propertyName}}", [
        "Xin chào {{guestName}},", "Đặt phòng của bạn đã được xác nhận.", "",
        "Mã xác nhận: {{confirmationNumber}}", "Cơ sở: {{propertyName}}", "Địa chỉ: {{propertyAddress}}",
        "Nhận phòng: {{checkIn}} (từ {{checkInTime}})", "Trả phòng: {{checkOut}}", "Số phòng: {{rooms}} · Người lớn: {{adults}} · Trẻ em: {{children}}",
        "Tiền phòng đã xác nhận: {{totalAmount}}", "Thanh toán khi nhận phòng", "", "{{manageNotice}}"]),
    Make("Booking confirmation {{confirmationNumber}} - {{propertyName}}", [
        "Hello {{guestName}},", "Your booking is confirmed.", "",
        "Confirmation number: {{confirmationNumber}}", "Property: {{propertyName}}", "Address: {{propertyAddress}}",
        "Check-in: {{checkIn}} (from {{checkInTime}})", "Check-out: {{checkOut}}", "Rooms: {{rooms}} · Adults: {{adults}} · Children: {{children}}",
        "Confirmed room total: {{totalAmount}}", "Pay at the property on arrival", "", "{{manageNotice}}"]),
    Make("Confirmation de réservation {{confirmationNumber}} - {{propertyName}}", [
        "Bonjour {{guestName}},", "Votre réservation est confirmée.", "",
        "Numéro de confirmation : {{confirmationNumber}}", "Établissement : {{propertyName}}", "Adresse : {{propertyAddress}}",
        "Arrivée : {{checkIn}} (à partir de {{checkInTime}})", "Départ : {{checkOut}}", "Chambres : {{rooms}} · Adultes : {{adults}} · Enfants : {{children}}",
        "Total des chambres confirmé : {{totalAmount}}", "Paiement à l'établissement à l'arrivée", "", "{{manageNotice}}"]));

public sealed class BookingStaffEmailTemplate() : BookingEmailTemplate(
    BookingEmailPurposes.StaffTemplate,
    Make("Đặt phòng mới {{confirmationNumber}} - {{propertyName}}", [
        "Có một đặt phòng mới tại {{propertyName}}.", "",
        "Mã xác nhận: {{confirmationNumber}}", "Khách: {{guestName}}", "Ngày ở: {{checkIn}} - {{checkOut}}",
        "Số phòng: {{rooms}} · Người lớn: {{adults}} · Trẻ em: {{children}}", "Phương thức: Thanh toán tại cơ sở"]),
    Make("New booking {{confirmationNumber}} - {{propertyName}}", [
        "A new booking was made at {{propertyName}}.", "",
        "Confirmation number: {{confirmationNumber}}", "Guest: {{guestName}}", "Stay: {{checkIn}} - {{checkOut}}",
        "Rooms: {{rooms}} · Adults: {{adults}} · Children: {{children}}", "Method: Pay at the property"]),
    Make("Nouvelle réservation {{confirmationNumber}} - {{propertyName}}", [
        "Nouvelle réservation à {{propertyName}}.", "",
        "Numéro de confirmation : {{confirmationNumber}}", "Client : {{guestName}}", "Séjour : {{checkIn}} - {{checkOut}}",
        "Chambres : {{rooms}} · Adultes : {{adults}} · Enfants : {{children}}", "Mode : Paiement à l'établissement"]));
