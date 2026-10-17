using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HEADER-001-CP04: the header navigation. One Save replaces the whole tree, its links and its labels in a
/// single transaction under the same site-wide lock every website write takes, so a reader sees the old menu or the new
/// one and never a mix. The revision an editor holds is the tree's version plus the version of every label row, so a
/// label changed on the Translations screen in the meantime is a stale save too (409), not a silent overwrite.
/// A label is a stored-content text: the content source language's text is the menu row's own column, every other
/// language's is a translation row keyed by the item's id, so packs, coverage and the Translations editor carry it.
/// </summary>
internal sealed class WebsiteMenuService(TheBhaDbContext database, TimeProvider timeProvider) : IWebsiteMenus
{
    private const string Entity = "menuItem";
    private const string Field = "label";
    private static readonly string KeyPrefix = ContentKey.Prefix + Entity + ".";

    public async Task<MenuAdminDto> GetAdminAsync(CancellationToken cancellationToken)
    {
        var state = await database.WebsiteMenuState.AsNoTracking().SingleAsync(cancellationToken);
        var items = await database.WebsiteMenuItems.AsNoTracking().ToListAsync(cancellationToken);
        var languages = await database.WebsiteLanguages.AsNoTracking()
            .OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)
            .ToListAsync(cancellationToken);
        var rows = await LabelRowsAsync(null, cancellationToken);
        return BuildAdmin(state, items, languages, rows);
    }

    public async Task<WebsiteMutationResult<MenuAdminDto>> SaveAsync(SaveMenuCommand command, CancellationToken cancellationToken)
    {
        if (command.Items is null || string.IsNullOrWhiteSpace(command.ExpectedRevision))
        {
            return WebsiteMutationResult<MenuAdminDto>.Invalid("expectedRevision", "expectedRevision is the revision the editor loaded.");
        }

        return await WebsiteTransaction.InLockAsync(database, timeProvider, async now =>
        {
            var state = await database.WebsiteMenuState.SingleAsync(cancellationToken);
            var existingItems = await database.WebsiteMenuItems.AsNoTracking().ToListAsync(cancellationToken);
            var languages = await database.WebsiteLanguages.AsNoTracking().ToListAsync(cancellationToken);
            var rows = await database.WebsiteTranslations
                .Where(row => row.Key.StartsWith(KeyPrefix))
                .ToListAsync(cancellationToken);

            if (Revision(state.Version, rows) != command.ExpectedRevision)
            {
                return WebsiteMutationResult<MenuAdminDto>.Conflict(
                    WebsiteErrorCodes.StaleVersion, "The menu was changed by someone else since you opened it. Reload to see their version; your draft stays on screen.");
            }

            var defaultLanguage = languages.Single(language => language.IsDefault);
            var codes = languages.Select(language => language.NormalizedCode).ToHashSet(StringComparer.Ordinal);
            var required = new[] { ContentSource.Locale, defaultLanguage.NormalizedCode }.Distinct(StringComparer.Ordinal).ToList();
            if (MenuTree.Validate(command.Items, existingItems.Select(item => item.Id).ToHashSet(), codes, required) is { } problem)
            {
                return new WebsiteMutationResult<MenuAdminDto>(WebsiteMutationStatus.Invalid, null, problem.Code, problem.Field, problem.Message);
            }

            var items = BuildItems(command.Items);
            var plan = PlanLabels(command.Items, languages, defaultLanguage, rows, now, command.ActorStaffId);
            if (!HasChanged(existingItems, items) && plan.Add.Count == 0 && plan.Change.Count == 0 && plan.Remove.Count == 0)
            {
                // Nothing differs: no new version, so open tabs are not woken for nothing.
                return WebsiteMutationResult<MenuAdminDto>.Success(BuildAdmin(state, existingItems, [.. languages.OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)], rows));
            }

            // The tree is replaced as a whole. One DELETE statement: the self-referencing foreign key is checked at its end.
            await database.WebsiteMenuItems.ExecuteDeleteAsync(cancellationToken);
            database.WebsiteMenuItems.AddRange(items);
            var removedIds = existingItems.Select(item => item.Id).Except(items.Select(item => item.Id)).Select(id => KeyOf(id)).ToHashSet(StringComparer.Ordinal);
            database.WebsiteTranslations.RemoveRange(rows.Where(row => removedIds.Contains(row.Key) || plan.Remove.Contains((row.LanguageId, row.Key))));
            database.WebsiteTranslations.AddRange(plan.Add);
            foreach (var change in plan.Change)
            {
                rows.Single(row => row.LanguageId == change.LanguageId && row.Key == change.Key).Change(change.Value, true, change.SourceHash, now, command.ActorStaffId);
            }

            state.Saved(now, command.ActorStaffId);
            await database.SaveChangesAsync(cancellationToken);

            var saved = await database.WebsiteTranslations.AsNoTracking().Where(row => row.Key.StartsWith(KeyPrefix)).ToListAsync(cancellationToken);
            return WebsiteMutationResult<MenuAdminDto>.Success(
                BuildAdmin(state, items, [.. languages.OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)], saved));
        }, cancellationToken);
    }

    public async Task<PublicMenuDto> GetPublicAsync(string? locale, CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking().Where(language => language.IsActive).ToListAsync(cancellationToken);
        var defaultLanguage = languages.SingleOrDefault(language => language.IsDefault)
            ?? throw new InvalidOperationException("The website settings have no active default language.");
        var (_, resolved) = WebsitePublicReader.Resolve(languages, defaultLanguage, locale);

        var generatedAt = timeProvider.GetUtcNow();
        var state = await database.WebsiteMenuState.AsNoTracking().SingleAsync(cancellationToken);
        var items = await database.WebsiteMenuItems.AsNoTracking().ToListAsync(cancellationToken);
        var ids = new[] { defaultLanguage.Id, resolved.Id };
        var rows = await database.WebsiteTranslations.AsNoTracking()
            .Where(row => row.Key.StartsWith(KeyPrefix) && ids.Contains(row.LanguageId))
            .ToListAsync(cancellationToken);

        string LabelOf(WebsiteMenuItem item)
        {
            var key = KeyOf(item.Id);
            return rows.FirstOrDefault(row => row.LanguageId == resolved.Id && row.Key == key)?.Value
                   ?? rows.FirstOrDefault(row => row.LanguageId == defaultLanguage.Id && row.Key == key)?.Value
                   ?? item.Label;
        }

        var children = items.Where(item => item.ParentId is not null).ToLookup(item => item.ParentId!.Value);
        PublicMenuItemDto Build(WebsiteMenuItem item) =>
            new(item.Id, LabelOf(item), item.Href, item.OpenInNewTab,
                [.. children[item.Id].Where(child => child.IsEnabled).OrderBy(child => child.SortOrder).Select(Build)]);
        IReadOnlyList<PublicMenuItemDto> Placed(string placement) =>
            [.. items.Where(item => item.ParentId is null && item.Placement == placement && item.IsEnabled).OrderBy(item => item.SortOrder).Select(Build)];

        // Every part of the answer is a function of these: the tree's version, the two languages and the label rows.
        var revision = SourceText.Hash(Revision(state.Version, rows) + "|" + resolved.Code + "|" + defaultLanguage.Code);
        return new PublicMenuDto(revision, resolved.Code, generatedAt, Placed(MenuPlacement.Primary), Placed(MenuPlacement.Secondary));
    }

    // ---------------------------------------------------------------- helpers

    private static string KeyOf(Guid id) => ContentKey.For(Entity, id.ToString(), Field);

    private static string Revision(int version, IEnumerable<WebsiteTranslation> rows) =>
        SourceText.Hash(version + "|" + string.Join(',', rows
            .OrderBy(row => row.Key, StringComparer.Ordinal).ThenBy(row => row.LanguageId)
            .Select(row => $"{row.LanguageId:N}:{row.Key}:{row.Version}")));

    private async Task<List<WebsiteTranslation>> LabelRowsAsync(IReadOnlyCollection<Guid>? languageIds, CancellationToken cancellationToken) =>
        await database.WebsiteTranslations.AsNoTracking()
            .Where(row => row.Key.StartsWith(KeyPrefix) && (languageIds == null || languageIds.Contains(row.LanguageId)))
            .ToListAsync(cancellationToken);

    private static MenuAdminDto BuildAdmin(
        WebsiteMenuState state, IReadOnlyList<WebsiteMenuItem> items, IReadOnlyList<WebsiteLanguage> languages, IReadOnlyList<WebsiteTranslation> rows)
    {
        var rowOf = rows.ToDictionary(row => (row.LanguageId, row.Key));
        var children = items.Where(item => item.ParentId is not null).ToLookup(item => item.ParentId!.Value);
        var ordered = new List<WebsiteMenuItem>(items.Count);
        void Walk(WebsiteMenuItem item)
        {
            ordered.Add(item);
            foreach (var child in children[item.Id].OrderBy(child => child.SortOrder))
            {
                Walk(child);
            }
        }

        foreach (var placement in new[] { MenuPlacement.Primary, MenuPlacement.Secondary })
        {
            foreach (var root in items.Where(item => item.ParentId is null && item.Placement == placement).OrderBy(item => item.SortOrder))
            {
                Walk(root);
            }
        }

        var dtos = ordered.Select(item =>
        {
            var key = KeyOf(item.Id);
            var labels = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var language in languages)
            {
                var own = rowOf.GetValueOrDefault((language.Id, key))?.Value;
                // The content source language's text is the column unless a stored text overrides it (as the public side reads it).
                labels[language.NormalizedCode] = own ?? (language.NormalizedCode == ContentSource.Locale ? item.Label : null);
            }

            return new MenuItemDto(item.Id, item.ParentId, item.Placement, item.IsEnabled, item.Href, item.OpenInNewTab, labels);
        }).ToList();

        return new MenuAdminDto(
            Revision(state.Version, rows),
            state.Version,
            state.UpdatedAtUtc,
            state.UpdatedByStaffId,
            [.. languages.Select(language => new MenuLocaleDto(
                language.NormalizedCode, language.DisplayName, language.NativeName, language.IsDefault, language.IsActive, language.NormalizedCode == ContentSource.Locale))],
            dtos);
    }

    /// <summary>The items as entities, sibling order = order of appearance within the same parent (roots: within the same placement).</summary>
    private static List<WebsiteMenuItem> BuildItems(IReadOnlyList<MenuItemInput> inputs)
    {
        var next = new Dictionary<(Guid?, string?), int>();
        var result = new List<WebsiteMenuItem>(inputs.Count);
        foreach (var input in inputs)
        {
            var group = (input.ParentId, input.ParentId is null ? input.Placement : null);
            var order = next.GetValueOrDefault(group);
            next[group] = order + 1;
            var vi = LabelFor(input.Labels, ContentSource.Locale)!.Trim();
            result.Add(new WebsiteMenuItem(input.Id, input.ParentId, input.Placement, order, vi, input.Href!, input.OpenInNewTab, input.IsEnabled));
        }

        return result;
    }

    private static string? LabelFor(IReadOnlyDictionary<string, string?>? labels, string code) =>
        labels?.FirstOrDefault(pair => string.Equals(pair.Key, code, StringComparison.OrdinalIgnoreCase)).Value;

    private static bool HasChanged(IReadOnlyList<WebsiteMenuItem> before, IReadOnlyList<WebsiteMenuItem> after)
    {
        if (before.Count != after.Count)
        {
            return true;
        }

        var old = before.ToDictionary(item => item.Id);
        return after.Any(item =>
            !old.TryGetValue(item.Id, out var was) || was.ParentId != item.ParentId || was.Placement != item.Placement || was.SortOrder != item.SortOrder ||
            was.Label != item.Label || was.Href != item.Href || was.OpenInNewTab != item.OpenInNewTab || was.IsEnabled != item.IsEnabled);
    }

    private sealed record LabelPlan(
        List<WebsiteTranslation> Add,
        List<(Guid LanguageId, string Key, string Value, string? SourceHash)> Change,
        HashSet<(Guid LanguageId, string Key)> Remove);

    /// <summary>
    /// Which translation rows the save adds, changes or removes. A language the editor did not send is left alone; one it sent
    /// empty loses its row. The content source language never keeps a row (its text is the column). A row is written as
    /// hand-edited and stamped with the default language's text it was written against, so a later change of that text shows as outdated.
    /// </summary>
    private static LabelPlan PlanLabels(
        IReadOnlyList<MenuItemInput> inputs, IReadOnlyList<WebsiteLanguage> languages, WebsiteLanguage defaultLanguage,
        IReadOnlyList<WebsiteTranslation> rows, DateTimeOffset now, Guid actorStaffId)
    {
        var rowOf = rows.ToDictionary(row => (row.LanguageId, row.Key));
        var plan = new LabelPlan([], [], []);
        for (var index = 0; index < inputs.Count; index++)
        {
            var key = KeyOf(inputs[index].Id);
            var labels = inputs[index].Labels ?? new Dictionary<string, string?>();
            var reference = LabelFor(labels, defaultLanguage.NormalizedCode)!.Trim();
            foreach (var language in languages)
            {
                rowOf.TryGetValue((language.Id, key), out var row);
                if (language.NormalizedCode == ContentSource.Locale)
                {
                    if (row is not null)
                    {
                        plan.Remove.Add((language.Id, key));
                    }

                    continue;
                }

                if (!labels.Keys.Any(code => string.Equals(code, language.NormalizedCode, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                var text = LabelFor(labels, language.NormalizedCode)?.Trim();
                if (string.IsNullOrEmpty(text))
                {
                    if (row is not null)
                    {
                        plan.Remove.Add((language.Id, key));
                    }

                    continue;
                }

                var hash = language.Id == defaultLanguage.Id ? null : SourceText.Hash(reference);
                if (row is null)
                {
                    plan.Add.Add(new WebsiteTranslation(language.Id, key, text, true, hash, now, actorStaffId));
                }
                else if (row.Value != text)
                {
                    plan.Change.Add((language.Id, key, text, hash));
                }
            }
        }

        return plan;
    }
}
