using Microsoft.EntityFrameworkCore;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;

namespace TheBha.Infrastructure.Persistence;

internal sealed partial class AdminBlogService
{
    // ---- settings ----

    public async Task<BlogSettingsDto> GetSettingsAsync(CancellationToken cancellationToken)
    {
        var row = await db.BlogSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        return row is null
            ? new BlogSettingsDto(null, 0, DateTimeOffset.UnixEpoch)
            : new BlogSettingsDto(row.HomeSectionCategoryId, row.Version, row.UpdatedAtUtc);
    }

    public async Task<WebsiteMutationResult<BlogSettingsDto>> SetSettingsAsync(SetBlogSettingsCommand command, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var row = await db.BlogSettings.SingleOrDefaultAsync(cancellationToken);
        if (row is null || command.ExpectedVersion != row.Version)
        {
            return Fail<BlogSettingsDto>(Stale);
        }

        if (command.HomeSectionCategoryId is { } categoryId && !await db.BlogCategories.AsNoTracking().AnyAsync(c => c.Id == categoryId, cancellationToken))
        {
            return Fail<BlogSettingsDto>(new BlogProblem(BlogErrorCodes.CategoryMissing, "homeSectionCategoryId", "The category does not exist."));
        }

        row.SetHomeSection(command.HomeSectionCategoryId, command.ActorStaffId, clock.GetUtcNow());
        Audit(command.ActorStaffId, "settings.save", categoryId: command.HomeSectionCategoryId, versionAfter: row.Version);
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogSettingsDto>(saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return WebsiteMutationResult<BlogSettingsDto>.Success(new BlogSettingsDto(row.HomeSectionCategoryId, row.Version, row.UpdatedAtUtc));
    }

    // ---- categories ----

    public async Task<IReadOnlyList<BlogCategoryAdminDto>> ListCategoriesAsync(CancellationToken cancellationToken)
    {
        var categories = await db.BlogCategories.AsNoTracking().Include(c => c.Translations).OrderBy(c => c.SortOrder).ThenBy(c => c.Id).ToListAsync(cancellationToken);
        return await ToDtosAsync(categories, cancellationToken);
    }

    private async Task<IReadOnlyList<BlogCategoryAdminDto>> ToDtosAsync(List<BlogCategory> categories, CancellationToken cancellationToken)
    {
        var ids = categories.Select(c => c.Id).ToList();
        var revisions = await db.BlogRevisionCategories.AsNoTracking().Where(rc => ids.Contains(rc.CategoryId))
            .GroupBy(rc => rc.CategoryId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, cancellationToken);
        var pins = await db.BlogCategoryPins.AsNoTracking().Where(p => ids.Contains(p.CategoryId))
            .GroupBy(p => p.CategoryId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, cancellationToken);
        var home = (await db.BlogSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken))?.HomeSectionCategoryId;
        return categories.Select(c => new BlogCategoryAdminDto(
            c.Id, c.SystemKey, c.SortOrder, c.Version,
            c.Translations.OrderBy(t => t.Locale, StringComparer.Ordinal).ToDictionary(t => t.Locale, t => new BlogCategoryText(t.Name, t.Slug, t.Description)),
            revisions.GetValueOrDefault(c.Id), pins.GetValueOrDefault(c.Id), c.Id == home)).ToList();
    }

    /// <summary>Checks the texts of every language of a category write; <c>null</c> when all are acceptable.</summary>
    private async Task<(Dictionary<string, BlogCategoryText>? Texts, BlogProblem? Problem)> CheckTextsAsync(
        IReadOnlyDictionary<string, BlogCategoryText> texts, bool mustNotBeEmpty, CancellationToken cancellationToken)
    {
        if (mustNotBeEmpty && texts.Count == 0)
        {
            return (null, new BlogProblem(BlogErrorCodes.Validation, "translations", "A category needs a name in at least one language."));
        }

        var normalized = new Dictionary<string, BlogCategoryText>(StringComparer.Ordinal);
        foreach (var (code, text) in texts)
        {
            var (locale, localeProblem) = await LocaleAsync(code, "translations", cancellationToken);
            if (locale is null)
            {
                return (null, localeProblem);
            }

            var problem = BlogText.Check(text.Name, BlogLimits.CategoryName, $"translations.{locale}.name", required: true) ??
                          BlogText.Check(text.Description, BlogLimits.CategoryDescription, $"translations.{locale}.description") ??
                          BlogSlug.Check(text.Slug, $"translations.{locale}.slug");
            if (problem is not null)
            {
                return (null, problem);
            }

            if (!normalized.TryAdd(locale, new BlogCategoryText(BlogText.Normalize(text.Name), text.Slug, BlogText.Normalize(text.Description) is { Length: > 0 } d ? d : null)))
            {
                return (null, new BlogProblem(BlogErrorCodes.Validation, "translations", "A language appears twice."));
            }
        }

        return (normalized, null);
    }

    public async Task<WebsiteMutationResult<BlogCategoryAdminDto>> CreateCategoryAsync(CreateBlogCategoryCommand command, CancellationToken cancellationToken)
    {
        if (command.SortOrder is < 0 or > 9999)
        {
            return WebsiteMutationResult<BlogCategoryAdminDto>.Invalid("sortOrder", "The order is a number from 0 to 9999.");
        }

        var (texts, problem) = await CheckTextsAsync(command.Translations, mustNotBeEmpty: true, cancellationToken);
        if (texts is null)
        {
            return Fail<BlogCategoryAdminDto>(problem!);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await db.BlogCategories.AsNoTracking().AnyAsync(c => c.Id == command.CategoryId, cancellationToken))
        {
            return Fail<BlogCategoryAdminDto>(new BlogProblem(BlogErrorCodes.DuplicateId, "id", "A category with this id already exists."));
        }

        var category = new BlogCategory(command.CategoryId, null, command.SortOrder, command.ActorStaffId, clock.GetUtcNow());
        db.Add(category);
        foreach (var (locale, text) in texts)
        {
            if (await db.BlogCategorySlugs.AsNoTracking().AnyAsync(s => s.Locale == locale && s.Slug == text.Slug, cancellationToken))
            {
                return Fail<BlogCategoryAdminDto>(new BlogProblem(BlogErrorCodes.SlugTaken, $"translations.{locale}.slug", "Another category already uses this slug."));
            }

            db.Add(new BlogCategoryTranslation(category.Id, locale, text.Name, text.Slug, text.Description));
            db.Add(new BlogCategorySlug(locale, text.Slug, category.Id, true));
        }

        Audit(command.ActorStaffId, "category.create", categoryId: category.Id, versionAfter: category.Version, detail: new { locales = texts.Keys });
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogCategoryAdminDto>(saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return WebsiteMutationResult<BlogCategoryAdminDto>.Success(await OneAsync(category.Id, cancellationToken));
    }

    private async Task<BlogCategoryAdminDto> OneAsync(Guid id, CancellationToken cancellationToken) =>
        (await ToDtosAsync([await db.BlogCategories.AsNoTracking().Include(c => c.Translations).SingleAsync(c => c.Id == id, cancellationToken)], cancellationToken))[0];

    public async Task<WebsiteMutationResult<BlogCategoryAdminDto>> UpdateCategoryAsync(UpdateBlogCategoryCommand command, CancellationToken cancellationToken)
    {
        if (command.SortOrder is < 0 or > 9999)
        {
            return WebsiteMutationResult<BlogCategoryAdminDto>.Invalid("sortOrder", "The order is a number from 0 to 9999.");
        }

        var (texts, problem) = await CheckTextsAsync(command.Translations, mustNotBeEmpty: false, cancellationToken);
        if (texts is null)
        {
            return Fail<BlogCategoryAdminDto>(problem!);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var category = await db.BlogCategories.Include(c => c.Translations).SingleOrDefaultAsync(c => c.Id == command.CategoryId, cancellationToken);
        if (category is null)
        {
            return Fail<BlogCategoryAdminDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The category does not exist."));
        }

        if (command.ExpectedVersion != category.Version)
        {
            return Fail<BlogCategoryAdminDto>(Stale);
        }

        foreach (var (locale, text) in texts)
        {
            var existing = category.Translations.SingleOrDefault(t => t.Locale == locale);
            if (existing is null)
            {
                if (await db.BlogCategorySlugs.AsNoTracking().AnyAsync(s => s.Locale == locale && s.Slug == text.Slug, cancellationToken))
                {
                    return Fail<BlogCategoryAdminDto>(new BlogProblem(BlogErrorCodes.SlugTaken, $"translations.{locale}.slug", "Another category already uses this slug."));
                }

                var added = new BlogCategoryTranslation(category.Id, locale, text.Name, text.Slug, text.Description);
                category.Translations.Add(added);
                db.Add(new BlogCategorySlug(locale, text.Slug, category.Id, true));
                continue;
            }

            if (existing.Slug != text.Slug)
            {
                var owner = await db.BlogCategorySlugs.AsNoTracking().SingleOrDefaultAsync(s => s.Locale == locale && s.Slug == text.Slug, cancellationToken);
                if (owner is not null && owner.CategoryId != category.Id)
                {
                    return Fail<BlogCategoryAdminDto>(new BlogProblem(BlogErrorCodes.SlugTaken, $"translations.{locale}.slug", "Another category uses (or used) this slug."));
                }

                // The old live slug becomes a redirect this category owns for ever; set-based so the one-current index is never violated mid-save.
                await db.BlogCategorySlugs.Where(s => s.Locale == locale && s.Slug == existing.Slug)
                    .ExecuteUpdateAsync(set => set.SetProperty(s => s.IsCurrent, false), cancellationToken);
                if (owner is null)
                {
                    db.Add(new BlogCategorySlug(locale, text.Slug, category.Id, true));
                }
                else
                {
                    await db.BlogCategorySlugs.Where(s => s.Locale == locale && s.Slug == text.Slug)
                        .ExecuteUpdateAsync(set => set.SetProperty(s => s.IsCurrent, true), cancellationToken);
                }
            }

            existing.Apply(text.Name, text.Slug, text.Description);
        }

        category.Edit(command.SortOrder, command.ActorStaffId, clock.GetUtcNow());
        Audit(command.ActorStaffId, "category.update", categoryId: category.Id, versionAfter: category.Version, detail: new { locales = texts.Keys });
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogCategoryAdminDto>(saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return WebsiteMutationResult<BlogCategoryAdminDto>.Success(await OneAsync(category.Id, cancellationToken));
    }

    public async Task<WebsiteMutationResult<bool>> DeleteCategoryAsync(DeleteBlogCategoryCommand command, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var category = await db.BlogCategories.SingleOrDefaultAsync(c => c.Id == command.CategoryId, cancellationToken);
        if (category is null)
        {
            return Fail<bool>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The category does not exist."));
        }

        if (command.ExpectedVersion != category.Version)
        {
            return Fail<bool>(Stale);
        }

        var usedByContent = await db.BlogRevisionCategories.AsNoTracking().AnyAsync(rc => rc.CategoryId == category.Id, cancellationToken);
        var pinned = await db.BlogCategoryPins.AsNoTracking().AnyAsync(p => p.CategoryId == category.Id, cancellationToken);
        var section = await db.BlogSettings.AsNoTracking().AnyAsync(s => s.HomeSectionCategoryId == category.Id, cancellationToken);
        if (usedByContent || pinned || section)
        {
            return Fail<bool>(new BlogProblem(
                BlogErrorCodes.CategoryInUse, "id",
                section ? "This category feeds the home section. Choose another category for it first." : "Articles (published, drafts or past versions) still use this category."));
        }

        db.Remove(category);
        Audit(command.ActorStaffId, "category.delete", categoryId: category.Id, versionAfter: category.Version);
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<bool>(saved.Code == BlogErrorCodes.CategoryMissing ? new BlogProblem(BlogErrorCodes.CategoryInUse, "id", "Articles still use this category.") : saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return WebsiteMutationResult<bool>.Success(true);
    }

    // ---- pins ----

    public async Task<WebsiteMutationResult<BlogPinsDto>> GetPinsAsync(Guid categoryId, CancellationToken cancellationToken)
    {
        var category = await db.BlogCategories.AsNoTracking().SingleOrDefaultAsync(c => c.Id == categoryId, cancellationToken);
        return category is null
            ? Fail<BlogPinsDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The category does not exist."))
            : WebsiteMutationResult<BlogPinsDto>.Success(await PinsDtoAsync(category, cancellationToken));
    }

    /// <summary>The published translations (post, locale, title) of this category: what a pin can take effect on.</summary>
    private IQueryable<(Guid PostId, string Locale, string Title)> PublishedIn(Guid categoryId) =>
        from t in db.BlogPostTranslations.AsNoTracking()
        where t.Status == BlogTranslationStatus.Published
        join r in db.BlogPostRevisions.AsNoTracking() on t.PublishedRevisionId equals r.Id
        where db.BlogRevisionCategories.Any(rc => rc.RevisionId == r.Id && rc.CategoryId == categoryId)
        select new ValueTuple<Guid, string, string>(t.PostId, t.Locale, r.Title);

    private async Task<BlogPinsDto> PinsDtoAsync(BlogCategory category, CancellationToken cancellationToken)
    {
        var pins = await db.BlogCategoryPins.AsNoTracking().Where(p => p.CategoryId == category.Id).OrderBy(p => p.Position).ThenBy(p => p.PostId).ToListAsync(cancellationToken);
        var published = (await PublishedIn(category.Id).ToListAsync(cancellationToken)).ToLookup(x => x.PostId);
        return new BlogPinsDto(
            category.Id,
            category.Version,
            pins.Select(p => new BlogPinDto(
                p.PostId, p.Position, published.Contains(p.PostId),
                published[p.PostId].OrderBy(x => x.Locale, StringComparer.Ordinal).ToDictionary(x => x.Locale, x => x.Title))).ToList());
    }

    public async Task<WebsiteMutationResult<BlogPinsDto>> SetPinsAsync(SetBlogPinsCommand command, CancellationToken cancellationToken)
    {
        var postIds = command.PostIds.ToList();
        if (postIds.Count != postIds.Distinct().Count())
        {
            return Fail<BlogPinsDto>(new BlogProblem(BlogErrorCodes.Validation, "postIds", "An article can be pinned once."));
        }

        if (postIds.Count > BlogLimits.MaxPinsPerCategory)
        {
            return Fail<BlogPinsDto>(new BlogProblem(BlogErrorCodes.Validation, "postIds", $"A category pins at most {BlogLimits.MaxPinsPerCategory} articles."));
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var category = await db.BlogCategories.SingleOrDefaultAsync(c => c.Id == command.CategoryId, cancellationToken);
        if (category is null)
        {
            return Fail<BlogPinsDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The category does not exist."));
        }

        if (command.ExpectedVersion != category.Version)
        {
            return Fail<BlogPinsDto>(Stale);
        }

        var eligible = (await PublishedIn(category.Id).Select(x => x.PostId).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        var pinnedNow = await db.BlogCategoryPins.Where(p => p.CategoryId == category.Id).ToListAsync(cancellationToken);
        // A pin that already exists may stay even if its article is unpublished at the moment; a new pin needs a published article in this category.
        if (postIds.FirstOrDefault(id => !eligible.Contains(id) && pinnedNow.All(p => p.PostId != id)) is var bad && bad != Guid.Empty)
        {
            return Fail<BlogPinsDto>(new BlogProblem(BlogErrorCodes.PinNotPublished, "postIds", "Only an article published in this category can be pinned to it."));
        }

        var now = clock.GetUtcNow();
        foreach (var gone in pinnedNow.Where(p => !postIds.Contains(p.PostId)))
        {
            db.Remove(gone);
        }

        for (var position = 0; position < postIds.Count; position++)
        {
            var existing = pinnedNow.SingleOrDefault(p => p.PostId == postIds[position]);
            if (existing is null)
            {
                db.Add(new BlogCategoryPin(category.Id, postIds[position], position, command.ActorStaffId, now));
            }
            else
            {
                existing.Position = position;
            }
        }

        category.Touch(command.ActorStaffId, now);
        Audit(command.ActorStaffId, "category.pins", categoryId: category.Id, versionAfter: category.Version, detail: new { postIds });
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogPinsDto>(saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return WebsiteMutationResult<BlogPinsDto>.Success(await PinsDtoAsync(category, cancellationToken));
    }
}
