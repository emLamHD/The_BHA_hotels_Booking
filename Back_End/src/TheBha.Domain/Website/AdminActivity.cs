namespace TheBha.Domain.Website;

/// <summary>Who caused an <see cref="AdminActivity"/>. Only <see cref="Staff"/> carries a Staff id; a guest or a job is <see cref="Public"/>/<see cref="System"/> and counts for every Staff member.</summary>
public enum AdminActorKind { Staff, Public, System }

/// <summary>
/// ADR 0011 §A: one physical event of an Admin menu (append-only; never updated). It has no foreign key to any content table, so deleting a post, a subscription or a bar cannot remove its
/// activity. <see cref="Sequence"/> is NOT an identity column: it is taken from <see cref="MenuActivityStream"/> (one counter per menu) inside the business transaction, like
/// <see cref="NewsletterVerificationActivity"/>. <see cref="CorrelationId"/> only links the rows of one valid Blog save-then-publish chain.
/// </summary>
public sealed class AdminActivity
{
    public string MenuKey { get; set; } = string.Empty;
    public long Sequence { get; set; }
    public Guid Id { get; set; }
    public Guid? PropertyId { get; set; }
    public AdminActorKind ActorKind { get; set; }
    public Guid? ActorStaffId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string EntityKind { get; set; } = string.Empty;
    public string EntityKey { get; set; } = string.Empty;
    public string TitleSnapshot { get; set; } = string.Empty;
    public int ItemCount { get; set; } = 1;
    public Guid? CorrelationId { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
}

/// <summary>ADR 0011 §A: a Staff member's "seen" cursor of a Property-scoped menu (<c>promotions</c>), one per Property. <see cref="StaffMenuSeen"/> cannot hold it: its key has no Property.</summary>
public sealed class StaffMenuPropertySeen
{
    public Guid StaffAccountId { get; set; }
    public string MenuKey { get; set; } = string.Empty;
    public Guid PropertyId { get; set; }
    public long LastSeenSequence { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

/// <summary>ADR 0011 §A: a Staff member's "seen" cursor of one Calendar object (the object, not a segment id: moves and splits create new segments).</summary>
public sealed class StaffEntitySeen
{
    public Guid StaffAccountId { get; set; }
    public Guid PropertyId { get; set; }
    public string EntityKind { get; set; } = string.Empty;
    public string EntityKey { get; set; } = string.Empty;
    public long LastSeenSequence { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

/// <summary>ADR 0011 §C/§F: the menus that have an activity stream. <see cref="Newsletter"/> already has its counter row (migration 25); every other key is seeded at 0 by migration 26.</summary>
public static class AdminMenuKeys
{
    public const string BlogPosts = "blog-posts";
    public const string BlogCategories = "blog-categories";
    public const string BlogMedia = "blog-media";
    public const string BlogSettings = "blog-settings";
    public const string WebsiteHero = "website-hero";
    public const string WebsiteMenus = "website-menus";
    public const string WebsiteLanguages = "website-languages";
    public const string WebsiteTranslations = "website-translations";
    public const string WebsiteCurrencies = "website-currencies";
    public const string WebsiteSocial = "website-social";
    public const string NewsletterSender = "newsletter-sender";
    public const string Promotions = "promotions";
    public const string Catalog = "catalog";
    public const string Calendar = "calendar";

    /// <summary>The 14 keys migration 26 seeds (everything but <c>newsletter</c>).</summary>
    public static readonly IReadOnlyList<string> Seeded =
    [
        BlogPosts, BlogCategories, BlogMedia, BlogSettings, WebsiteHero, WebsiteMenus, WebsiteLanguages, WebsiteTranslations,
        WebsiteCurrencies, WebsiteSocial, NewsletterSender, Promotions, Catalog, Calendar
    ];

    /// <summary>Property-scoped menus (ADR 0011 §C): they carry a <c>PropertyId</c>; every other menu is global and must not.</summary>
    public static bool IsPropertyScoped(string menuKey) => menuKey is Promotions or Calendar;
}
