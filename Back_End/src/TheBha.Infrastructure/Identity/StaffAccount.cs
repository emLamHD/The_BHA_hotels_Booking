using Microsoft.AspNetCore.Identity;

namespace TheBha.Infrastructure.Identity;

/// <summary>
/// An Admin staff member. A separate Identity user type from
/// <see cref="CustomerAccount"/>, stored in its own table, so a customer can
/// never become a staff principal. It uses no claims, logins or tokens (those
/// Identity tables are keyed to customers). A row is disabled, never deleted.
/// </summary>
public sealed class StaffAccount : IdentityUser<Guid>
{
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? DisabledAtUtc { get; set; }

    /// <summary>
    /// CUST-WEB-HEADER-001-CP02: the one site-wide (not per Property) permission, <c>WebsiteSettingsManage</c>.
    /// False for every account, old and new; only the operator CLI changes it, and the API reads it from the
    /// database on every request. It is independent of any membership or role.
    /// </summary>
    public bool CanManageWebsite { get; set; }

    /// <summary>BHA-BLOG-001 (ADR 0010): site-wide right to write Blog drafts. Independent of <see cref="CanPublishBlog"/>; set only by the operator CLI.</summary>
    public bool CanEditBlog { get; set; }

    /// <summary>BHA-BLOG-001 (ADR 0010): site-wide right to publish, unpublish, archive and structure the Blog (categories, pins, settings).</summary>
    public bool CanPublishBlog { get; set; }
}
