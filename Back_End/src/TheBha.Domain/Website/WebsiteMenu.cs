using TheBha.Domain.Common;

namespace TheBha.Domain.Website;

/// <summary>Where a root menu item sits in the public header: the main row on the left, or the secondary group on the right. Only roots carry a placement.</summary>
public static class MenuPlacement
{
    public const string Primary = "primary";
    public const string Secondary = "secondary";

    public static bool IsValid(string? value) => value is Primary or Secondary;
}

/// <summary>The limits of the navigation tree; the database repeats the ones a row can state alone.</summary>
public static class MenuLimits
{
    /// <summary>A root is level 1; the template's sample pages need four levels (root, group, page, sub-page).</summary>
    public const int MaxDepth = 4;
    public const int MaxItems = 200;
    public const int MaxLabel = 80;
    public const int MaxHref = 2048;
}

/// <summary>
/// CUST-WEB-HEADER-001-CP04: one entry of the site-wide header navigation (not per Property). The <see cref="Id"/>
/// is its identity: the label translations are keyed by it (<c>content.menuItem.&lt;id&gt;.label</c>), so a link, a
/// name or a position can change without losing them. <see cref="Label"/> is the text in the content source
/// language (Vietnamese); the other languages' labels are translation rows. Tree rules (no cycle, depth, a
/// parent that exists) are the service's, under the website lock; this type keeps what one row can decide.
/// </summary>
public sealed class WebsiteMenuItem
{
    private WebsiteMenuItem()
    {
    }

    public WebsiteMenuItem(
        Guid id, Guid? parentId, string? placement, int sortOrder, string label, string href, bool openInNewTab, bool isEnabled)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        ParentId = parentId;
        Placement = parentId is null
            ? (MenuPlacement.IsValid(placement) ? placement : throw new DomainException("A root menu item needs a placement."))
            : null;
        SortOrder = sortOrder is >= 0 and <= WebsiteFieldLimits.SortOrderMaximum ? sortOrder : throw new DomainException("sortOrder is out of range.");
        Label = DomainGuard.Required(label, nameof(label), MenuLimits.MaxLabel);
        Href = DomainGuard.Required(href, nameof(href), MenuLimits.MaxHref);
        OpenInNewTab = openInNewTab;
        IsEnabled = isEnabled;
    }

    public Guid Id { get; private set; }
    public Guid? ParentId { get; private set; }

    /// <summary><c>primary</c> or <c>secondary</c> for a root; <c>null</c> for a child (it follows its root).</summary>
    public string? Placement { get; private set; }

    public int SortOrder { get; private set; }
    public string Label { get; private set; } = string.Empty;
    public string Href { get; private set; } = string.Empty;
    public bool OpenInNewTab { get; private set; }
    public bool IsEnabled { get; private set; }
}

/// <summary>
/// The one row that versions the whole tree: every Save of the navigation (tree, links, labels) bumps it, and an
/// editor's <c>expectedRevision</c> includes it, so two editors cannot overwrite each other silently.
/// </summary>
public sealed class WebsiteMenuState
{
    private WebsiteMenuState()
    {
    }

    public WebsiteMenuState(DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        Id = 1;
        Version = 1;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }

    public int Id { get; private set; }
    public int Version { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }

    public void Saved(DateTimeOffset nowUtc, Guid? actorStaffId)
    {
        Version++;
        UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = actorStaffId;
    }
}
