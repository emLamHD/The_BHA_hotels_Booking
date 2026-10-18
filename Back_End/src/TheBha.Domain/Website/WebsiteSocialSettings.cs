namespace TheBha.Domain.Website;

/// <summary>The site-wide floating contact actions and back-to-top switch.</summary>
public sealed class WebsiteSocialSettings
{
    private WebsiteSocialSettings() { }

    public WebsiteSocialSettings(DateTimeOffset nowUtc)
    {
        Id = 1;
        Version = 1;
        UpdatedAtUtc = nowUtc;
        PhoneEnabled = true;
        PhoneNumber = "0899474888";
        PhoneHref = "tel:+84899474888";
        BackToTopEnabled = true;
    }

    public int Id { get; private set; }
    public int Version { get; private set; }
    public bool PhoneEnabled { get; private set; }
    public string PhoneNumber { get; private set; } = string.Empty;
    public string PhoneHref { get; private set; } = string.Empty;
    public bool MessengerEnabled { get; private set; }
    public string? MessengerUrl { get; private set; }
    public bool ZaloEnabled { get; private set; }
    public string? ZaloNumber { get; private set; }
    public string? ZaloUrl { get; private set; }
    public bool BackToTopEnabled { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }

    public void Save(DateTimeOffset nowUtc, Guid actorStaffId, bool phoneEnabled, string phoneNumber, string phoneHref,
        bool messengerEnabled, string? messengerUrl, bool zaloEnabled, string? zaloNumber, string? zaloUrl, bool backToTopEnabled)
    {
        PhoneEnabled = phoneEnabled;
        PhoneNumber = phoneNumber;
        PhoneHref = phoneHref;
        MessengerEnabled = messengerEnabled;
        MessengerUrl = messengerUrl;
        ZaloEnabled = zaloEnabled;
        ZaloNumber = zaloNumber;
        ZaloUrl = zaloUrl;
        BackToTopEnabled = backToTopEnabled;
        Version++;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }
}
