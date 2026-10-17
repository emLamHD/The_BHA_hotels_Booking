using TheBha.Domain.Website;

namespace TheBha.Application.Website;

/// <summary>
/// CUST-WEB-HEADER-001-CP04: the site-wide header navigation, edited in the Admin and read by the Customer at
/// run time. Application owns what is asked and answered and the rules that need no database (the link rules, the
/// tree rules); the transaction, the labels and the revision live behind <see cref="IWebsiteMenus"/> in Infrastructure.
/// </summary>
public static class MenuErrorCodes
{
    public const string UrlInvalid = "menu-url-invalid";
    public const string LabelInvalid = "menu-label-invalid";
    public const string LabelRequired = "menu-label-required";
    public const string Duplicate = "menu-duplicate-item";
    public const string ParentMissing = "menu-parent-missing";
    public const string Cycle = "menu-cycle";
    public const string TooDeep = "menu-too-deep";
    public const string TooMany = "menu-too-many";
    public const string PlacementInvalid = "menu-placement-invalid";
    public const string DeleteHasChildren = "menu-delete-has-children";
    public const string UnknownLocale = "menu-unknown-locale";
}

/// <summary>One item as the editor sends it. The order of the list is the order of siblings; <c>Labels</c> maps a language code to the label (the content source language is required).</summary>
public sealed record MenuItemInput(
    Guid Id,
    Guid? ParentId,
    string? Placement,
    bool IsEnabled,
    string? Href,
    bool OpenInNewTab,
    IReadOnlyDictionary<string, string?>? Labels);

/// <summary><c>ExpectedRevision</c> is the revision the editor loaded: the tree's version plus every label's version.</summary>
public sealed record SaveMenuCommand(string ExpectedRevision, IReadOnlyList<MenuItemInput> Items, Guid ActorStaffId);

public sealed record MenuLocaleDto(string Code, string DisplayName, string NativeName, bool IsDefault, bool IsActive, bool IsContentSource);

/// <summary>An item for the editor, in tree order. <c>Labels</c> has one entry per language (null = no text yet; the public site then falls back to the default language).</summary>
public sealed record MenuItemDto(
    Guid Id,
    Guid? ParentId,
    string? Placement,
    bool IsEnabled,
    string Href,
    bool OpenInNewTab,
    IReadOnlyDictionary<string, string?> Labels);

public sealed record MenuAdminDto(
    string Revision,
    int Version,
    DateTimeOffset UpdatedAtUtc,
    Guid? UpdatedByStaffId,
    IReadOnlyList<MenuLocaleDto> Locales,
    IReadOnlyList<MenuItemDto> Items);

public sealed record PublicMenuItemDto(Guid Id, string Label, string Href, bool NewTab, IReadOnlyList<PublicMenuItemDto> Children);

/// <summary>
/// What a visitor sees: only enabled items (a disabled parent hides its branch), with the label already resolved for
/// <c>Locale</c>. An empty list is a real answer (the operator removed every entry), never an error. <c>GeneratedAtUtc</c>
/// orders answers: a client keeps the newest one it has seen, whatever order they arrive in.
/// </summary>
public sealed record PublicMenuDto(
    string Revision,
    string Locale,
    DateTimeOffset GeneratedAtUtc,
    IReadOnlyList<PublicMenuItemDto> Primary,
    IReadOnlyList<PublicMenuItemDto> Secondary);

public interface IWebsiteMenus
{
    Task<MenuAdminDto> GetAdminAsync(CancellationToken cancellationToken);

    /// <summary>Applies the whole tree, the links and the labels in one transaction, or nothing. Stale revision = Conflict.</summary>
    Task<WebsiteMutationResult<MenuAdminDto>> SaveAsync(SaveMenuCommand command, CancellationToken cancellationToken);

    Task<PublicMenuDto> GetPublicAsync(string? locale, CancellationToken cancellationToken);
}

public sealed record MenuProblem(string Code, string Field, string Message);

/// <summary>The rules for a link and a label, server side: the Admin shows the same messages but never decides.</summary>
public static class MenuText
{
    /// <summary>
    /// Null when <paramref name="href"/> is acceptable: an internal path (<c>/riverside</c>, <c>/blog?category=x#top</c>), a
    /// fragment (<c>#</c>, <c>#faq</c>) or an absolute <c>https://</c> URL. Everything else — <c>javascript:</c>, <c>data:</c>, any other
    /// scheme, a protocol-relative <c>//host</c>, a backslash, a control character, or an encoded form of those — is refused. The URL is
    /// only read, never fetched.
    /// </summary>
    public static string? ValidateHref(string? href)
    {
        if (string.IsNullOrEmpty(href))
        {
            return "Enter a link.";
        }

        if (href.Length > MenuLimits.MaxHref)
        {
            return $"The link is longer than {MenuLimits.MaxHref} characters.";
        }

        if (href.Any(character => char.IsControl(character) || char.IsWhiteSpace(character) || character == '\\'))
        {
            return "The link cannot contain spaces, control characters or a backslash.";
        }

        // A browser decodes before it navigates, so what the link means is what it decodes to (twice, for a double encoding).
        var decoded = href;
        for (var round = 0; round < 3; round++)
        {
            string next;
            try
            {
                next = Uri.UnescapeDataString(decoded);
            }
            catch (UriFormatException)
            {
                return "The link is not a valid address.";
            }

            if (next == decoded)
            {
                break;
            }

            decoded = next;
            if (decoded.Any(character => char.IsControl(character) || character == '\\'))
            {
                return "The link cannot contain an encoded control character or backslash.";
            }
        }

        if (href[0] == '#')
        {
            return href.IndexOf('#', 1) >= 0 ? "A link can have only one # fragment." : null;
        }

        if (href[0] == '/')
        {
            if (href.StartsWith("//", StringComparison.Ordinal) || decoded.StartsWith("//", StringComparison.Ordinal))
            {
                return "A link cannot start with // (it would leave this site).";
            }

            var probe = new Uri("https://menu.invalid");
            return Uri.TryCreate(probe, href, out var resolved) && resolved.Host == probe.Host && resolved.Scheme == probe.Scheme
                ? null
                : "The path is not a valid address.";
        }

        if (href.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return Uri.TryCreate(href, UriKind.Absolute, out var absolute) &&
                   absolute.Scheme == Uri.UriSchemeHttps && !string.IsNullOrEmpty(absolute.Host) && string.IsNullOrEmpty(absolute.UserInfo)
                ? null
                : "The https address is not valid.";
        }

        return "Use a path starting with /, a # fragment or an https:// address.";
    }

    /// <summary>Plain text only: no markup characters, no control characters, 1 to <see cref="MenuLimits.MaxLabel"/> characters once trimmed.</summary>
    public static string? ValidateLabel(string? label)
    {
        var text = label?.Trim() ?? string.Empty;
        if (text.Length == 0)
        {
            return "Enter a label.";
        }

        if (text.Length > MenuLimits.MaxLabel)
        {
            return $"The label is longer than {MenuLimits.MaxLabel} characters.";
        }

        return text.Any(character => char.IsControl(character) || character is '<' or '>')
            ? "A label is plain text: no < >, no control characters."
            : null;
    }
}

/// <summary>The tree rules, applied to the whole list an editor sends. Pure: no database.</summary>
public static class MenuTree
{
    /// <summary>The first problem of <paramref name="items"/>, or null. <paramref name="knownIds"/> are the items that exist now (to tell "deleted but still has children" from "parent never existed").</summary>
    public static MenuProblem? Validate(
        IReadOnlyList<MenuItemInput> items, IReadOnlySet<Guid> knownIds, IReadOnlySet<string> localeCodes, IReadOnlyList<string> requiredLocales)
    {
        if (items.Count > MenuLimits.MaxItems)
        {
            return new MenuProblem(MenuErrorCodes.TooMany, "items", $"A menu can have at most {MenuLimits.MaxItems} entries.");
        }

        var byId = new Dictionary<Guid, MenuItemInput>();
        for (var index = 0; index < items.Count; index++)
        {
            var item = items[index];
            var at = $"items[{index}]";
            if (item.Id == Guid.Empty || !byId.TryAdd(item.Id, item))
            {
                return new MenuProblem(MenuErrorCodes.Duplicate, $"{at}.id", "Each entry must appear once, with its own id.");
            }
        }

        for (var index = 0; index < items.Count; index++)
        {
            var item = items[index];
            var at = $"items[{index}]";
            if (item.ParentId is null ? !MenuPlacement.IsValid(item.Placement) : item.Placement is not null)
            {
                return new MenuProblem(MenuErrorCodes.PlacementInvalid, $"{at}.placement", "A top-level entry needs a placement (primary or secondary); a sub-entry has none.");
            }

            if (MenuText.ValidateHref(item.Href) is { } hrefProblem)
            {
                return new MenuProblem(MenuErrorCodes.UrlInvalid, $"{at}.href", hrefProblem);
            }

            var labels = item.Labels ?? new Dictionary<string, string?>();
            foreach (var (code, text) in labels)
            {
                if (!localeCodes.Contains(code.ToLowerInvariant()))
                {
                    return new MenuProblem(MenuErrorCodes.UnknownLocale, $"{at}.labels.{code}", $"The language {code} does not exist.");
                }

                if (!string.IsNullOrWhiteSpace(text) && MenuText.ValidateLabel(text) is { } labelProblem)
                {
                    return new MenuProblem(MenuErrorCodes.LabelInvalid, $"{at}.labels.{code}", labelProblem);
                }
            }

            foreach (var code in requiredLocales)
            {
                var present = labels.FirstOrDefault(pair => string.Equals(pair.Key, code, StringComparison.OrdinalIgnoreCase)).Value;
                if (string.IsNullOrWhiteSpace(present))
                {
                    return new MenuProblem(MenuErrorCodes.LabelRequired, $"{at}.labels.{code}", $"Enter the label in {code}: it is the text the other languages fall back to.");
                }
            }

            if (item.ParentId is { } parentId && !byId.ContainsKey(parentId))
            {
                return knownIds.Contains(parentId)
                    ? new MenuProblem(MenuErrorCodes.DeleteHasChildren, $"{at}.parentId", "An entry cannot be deleted while it still has sub-entries: move or delete them first.")
                    : new MenuProblem(MenuErrorCodes.ParentMissing, $"{at}.parentId", "The parent entry does not exist.");
            }
        }

        for (var index = 0; index < items.Count; index++)
        {
            var depth = 1;
            var current = items[index];
            var seen = new HashSet<Guid> { current.Id };
            while (current.ParentId is { } parentId)
            {
                if (!seen.Add(parentId))
                {
                    return new MenuProblem(MenuErrorCodes.Cycle, $"items[{index}].parentId", "An entry cannot be placed inside itself or inside one of its own sub-entries.");
                }

                current = byId[parentId];
                depth++;
            }

            if (depth > MenuLimits.MaxDepth)
            {
                return new MenuProblem(MenuErrorCodes.TooDeep, $"items[{index}].parentId", $"A menu can have at most {MenuLimits.MaxDepth} levels.");
            }
        }

        return null;
    }
}
