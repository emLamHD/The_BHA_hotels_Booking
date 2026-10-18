namespace TheBha.Application.Website;

public sealed record SaveWebsiteSocialCommand(
    int ExpectedRevision, bool PhoneEnabled, string? PhoneNumber, bool MessengerEnabled, string? MessengerUrl,
    bool ZaloEnabled, string? ZaloNumber, bool BackToTopEnabled, Guid ActorStaffId);

public sealed record WebsiteSocialAdminDto(
    int Revision, DateTimeOffset UpdatedAtUtc, Guid? UpdatedByStaffId,
    bool PhoneEnabled, string PhoneNumber, string PhoneHref,
    bool MessengerEnabled, string? MessengerUrl,
    bool ZaloEnabled, string? ZaloNumber, string? ZaloUrl,
    bool BackToTopEnabled);

public sealed record WebsiteSocialPublicDto(
    int Revision, DateTimeOffset GeneratedAtUtc,
    bool PhoneEnabled, string? PhoneNumber, string? PhoneHref,
    bool MessengerEnabled, string? MessengerUrl,
    bool ZaloEnabled, string? ZaloUrl,
    bool BackToTopEnabled);

public sealed record WebsiteSocialNormalized(string PhoneNumber, string PhoneHref, string? MessengerUrl, string? ZaloNumber, string? ZaloUrl);
public sealed record WebsiteSocialProblem(string Code, string Field, string Message);

public static class WebsiteSocialRules
{
    public static WebsiteSocialProblem? Validate(SaveWebsiteSocialCommand command, out WebsiteSocialNormalized? normalized)
    {
        normalized = null;
        string? phoneDisplay = null;
        string? phoneCanonical = null;
        if (!string.IsNullOrWhiteSpace(command.PhoneNumber) && !TryVietnamPhone(command.PhoneNumber, out phoneDisplay, out phoneCanonical))
            return new("social-phone-invalid", "phoneNumber", "Enter a Vietnamese phone number beginning with 0 or +84.");
        if (command.PhoneEnabled && phoneCanonical is null)
            return new("social-phone-required", "phoneNumber", "Add a valid phone number before enabling Phone.");

        string? messenger = null;
        if (!string.IsNullOrWhiteSpace(command.MessengerUrl))
        {
            if (!TryMessenger(command.MessengerUrl, out messenger))
                return new("social-messenger-invalid", "messengerUrl", "Use https://m.me/<page-username> or https://www.messenger.com/t/<id>.");
        }
        if (command.MessengerEnabled && messenger is null)
            return new("social-messenger-required", "messengerUrl", "Add a valid Messenger chat link before enabling Messenger.");

        string? zaloDisplay = null;
        string? zaloCanonical = null;
        if (!string.IsNullOrWhiteSpace(command.ZaloNumber) && !TryVietnamPhone(command.ZaloNumber, out zaloDisplay, out zaloCanonical))
            return new("social-zalo-invalid", "zaloNumber", "Enter the Vietnamese number linked to the Zalo account.");
        if (command.ZaloEnabled && zaloCanonical is null)
            return new("social-zalo-required", "zaloNumber", "Add the Zalo account number before enabling Zalo.");

        normalized = new(phoneDisplay ?? string.Empty, phoneCanonical is null ? string.Empty : $"tel:+84{phoneCanonical[1..]}", messenger, zaloDisplay, zaloCanonical is null ? null : $"https://zalo.me/{zaloCanonical}");
        return null;
    }

    private static bool TryVietnamPhone(string? input, out string? display, out string? canonical)
    {
        display = canonical = null;
        var value = input?.Trim();
        if (string.IsNullOrEmpty(value) || value.Any(char.IsControl) || value.Contains('\\')) return false;
        var compact = new string(value.Where(c => c is not (' ' or '.' or '-' or '(' or ')')).ToArray());
        if (compact.StartsWith("+84", StringComparison.Ordinal)) compact = "0" + compact[3..];
        if (compact.Length != 10 || compact[0] != '0' || compact.Skip(1).Any(c => c is < '0' or > '9')) return false;
        display = compact;
        canonical = compact;
        return true;
    }

    private static bool TryMessenger(string input, out string? normalized)
    {
        normalized = null;
        var value = input.Trim();
        if (value.Any(char.IsControl) || value.Contains('\\') || value.StartsWith("//", StringComparison.Ordinal) ||
            !Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || uri.Port != 443) return false;
        var host = uri.IdnHost.ToLowerInvariant();
        var parts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var valid = host == "m.me" ? parts.Length == 1 :
            host is "messenger.com" or "www.messenger.com" && parts.Length == 2 && parts[0] == "t";
        if (!valid || parts.Any(p => p is "." or ".." || p.Length > 100 || p.Any(c => !(char.IsLetterOrDigit(c) || c is '.' or '_' or '-')))) return false;
        normalized = $"https://{host}/{string.Join('/', parts)}";
        return true;
    }
}

public interface IWebsiteSocialSettings
{
    Task<WebsiteSocialAdminDto> GetAdminAsync(CancellationToken cancellationToken);
    Task<WebsiteMutationResult<WebsiteSocialAdminDto>> SaveAsync(SaveWebsiteSocialCommand command, CancellationToken cancellationToken);
    Task<WebsiteSocialPublicDto> GetPublicAsync(CancellationToken cancellationToken);
}
