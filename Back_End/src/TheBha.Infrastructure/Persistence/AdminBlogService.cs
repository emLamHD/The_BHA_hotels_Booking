using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using TheBha.Application.Activity;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-BLOG-001-CP01: the Admin side of the Blog. Every write is one transaction that also appends the audit row; every write on a
/// translation, category, pin list or the settings carries the version it was made from (a stale one is refused, and EF enforces the same
/// token, so two writers on one version cannot both win). The Staff actor is the verified session's, passed in; permission is decided
/// before this runs.
/// <para>
/// BHA-ADMIN-BADGE-001-PR06 (ADR 0011 §A, §D): every Admin write also appends ONE activity event to its menu's stream (<c>blog-posts</c>, <c>blog-categories</c>, <c>blog-media</c>,
/// <c>blog-settings</c>), by name, as the last statement before COMMIT — after the business writes, the <see cref="BlogAudit"/> row and every business lock — so a failure of the recorder
/// rolls the write, its audit and the counter back together. The hint goes out only after COMMIT. A list the Admin screens load answers its watermark from the same REPEATABLE READ
/// snapshot as its rows.
/// </para>
/// </summary>
internal sealed partial class AdminBlogService(
    TheBhaDbContext db, IHeroMediaStorage storage, IBlogImagePipeline pipeline, TimeProvider clock, IAdminActivityRecorder recorder, IAdminActivityHint hint,
    ILogger<AdminBlogService> logger) : IAdminBlog
{
    /// <summary>One kind for every action on a translation (create, save, publish, …) and the translation id as key: the recorder links a Save-then-Publish chain only on the same kind and key.</summary>
    private const string TranslationKind = "post-translation";

    private const string CategoryKind = "category", MediaKind = "media", MediaBatchKind = "media-batch", SettingsKind = "settings", SettingsKey = "blog-settings";

    private static readonly BlogProblem Stale = new(BlogErrorCodes.StaleVersion, "expectedVersion", "It was changed by someone else. Reload and try again.");

    // ---- activity and snapshot plumbing (BHA-ADMIN-BADGE-001-PR06) ----

    /// <summary>Appends the event on this context's open transaction. The actor is always the verified session's Staff id passed in the command.</summary>
    private Task RecordAsync(
        string menu, Guid actor, string action, string kind, string key, string? title, CancellationToken cancellationToken, int itemCount = 1, Guid? correlationId = null) =>
        recorder.RecordAsync(new AdminActivityEntry(menu, null, AdminActorKind.Staff, actor, action, kind, key, title, itemCount, correlationId), cancellationToken);

    /// <summary>Called only after COMMIT. Not given the caller's token: the change is already durable, and a cancelled caller must not skip the hint (delivery is bounded and best effort).</summary>
    private Task HintAsync(string menu) => hint.PublishAsync(menu, null, CancellationToken.None);

    /// <summary>The title of the revision the Admin list shows for a translation (the draft, else the published one): the safe snapshot of an operation that carries no new text.</summary>
    private async Task<string> ShownTitleAsync(BlogPostTranslation translation, CancellationToken cancellationToken) =>
        (translation.DraftRevisionId ?? translation.PublishedRevisionId) is { } revisionId
            ? await db.BlogPostRevisions.AsNoTracking().Where(r => r.Id == revisionId).Select(r => r.Title).SingleOrDefaultAsync(cancellationToken) ?? string.Empty
            : string.Empty;

    /// <summary>
    /// A category's name for an activity snapshot: the website's default language when the category has a text in it, else the first language in code order. Read before a delete
    /// removes the texts.
    /// </summary>
    private async Task<string> CategoryTitleAsync(Guid categoryId, CancellationToken cancellationToken)
    {
        var names = await db.BlogCategoryTranslations.AsNoTracking().Where(t => t.CategoryId == categoryId).Select(t => new { t.Locale, t.Name }).ToListAsync(cancellationToken);
        if (names.Count == 0)
        {
            return string.Empty;
        }

        var defaultCode = await db.WebsiteLanguages.AsNoTracking().Where(language => language.IsDefault).Select(language => language.NormalizedCode).FirstOrDefaultAsync(cancellationToken);
        return (names.FirstOrDefault(n => n.Locale == defaultCode) ?? names.OrderBy(n => n.Locale, StringComparer.Ordinal).First()).Name;
    }

    /// <summary>
    /// Runs <paramref name="read"/> inside one REPEATABLE READ snapshot whose FIRST statement reads the stream's counter, so the rows <paramref name="read"/> returns and the watermark
    /// are the same committed state: every event up to the watermark is reflected in the rows and none after it is claimed. Only the public GET entry points call it (a write's answer is read
    /// after its own commit and carries no watermark).
    /// </summary>
    private async Task<T> InSnapshotAsync<T>(string menuKey, Func<string, Task<T>> read, CancellationToken cancellationToken)
    {
        await using var snapshot = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        var watermark = (await db.MenuActivityStreams.AsNoTracking().Where(stream => stream.MenuKey == menuKey).Select(stream => stream.LastSequence).SingleAsync(cancellationToken))
            .ToString(CultureInfo.InvariantCulture);
        return await read(watermark);
    }

    // ---- shared plumbing ----

    private static WebsiteMutationResult<T> Fail<T>(BlogProblem problem) => BlogResults.From<T>(problem);

    /// <summary>The normalized code of a language the website has (active or not: a draft may be written before a language goes live).</summary>
    private async Task<(string? Locale, BlogProblem? Problem)> LocaleAsync(string? locale, string field, CancellationToken cancellationToken)
    {
        if (!LanguageTag.TryNormalize(locale, out _, out var normalized) ||
            !await db.WebsiteLanguages.AsNoTracking().AnyAsync(language => language.NormalizedCode == normalized, cancellationToken))
        {
            return (null, new BlogProblem(BlogErrorCodes.LocaleUnsupported, field, "The website has no such language."));
        }

        return (normalized, null);
    }

    /// <summary>Saves, turning the database's refusals into the business answer they mean.</summary>
    private async Task<BlogProblem?> SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return Stale;
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException pg)
        {
            var constraint = pg.ConstraintName ?? string.Empty;
            return pg.SqlState switch
            {
                PostgresErrorCodes.UniqueViolation when constraint.Contains("Slug", StringComparison.Ordinal) =>
                    new BlogProblem(BlogErrorCodes.SlugTaken, "slug", "Another page already uses this slug."),
                PostgresErrorCodes.UniqueViolation when constraint is "PK_BlogPosts" or "PK_BlogCategories" or "PK_BlogMedia" =>
                    new BlogProblem(BlogErrorCodes.DuplicateId, "id", "This id is already used."),
                PostgresErrorCodes.UniqueViolation => Stale,
                // A deadlock or serialization failure rolled this transaction back whole; nothing changed, and the writer must look again.
                PostgresErrorCodes.DeadlockDetected or PostgresErrorCodes.SerializationFailure => Stale,
                PostgresErrorCodes.ForeignKeyViolation when constraint.Contains("BlogMedia", StringComparison.Ordinal) =>
                    new BlogProblem(BlogErrorCodes.MediaMissing, "media", "A picture is not available."),
                PostgresErrorCodes.ForeignKeyViolation when constraint.Contains("BlogCategories", StringComparison.Ordinal) =>
                    new BlogProblem(BlogErrorCodes.CategoryMissing, "categoryIds", "A category does not exist any more."),
                _ => throw exception
            };
        }
    }

    /// <summary>
    /// Reads the translation of <c>(post, locale)</c> and locks its row until the transaction ends. Every write on a translation starts here, so
    /// concurrent writers queue on the row and each sees the committed result of the one before it — whoever is second finds a newer version
    /// and is refused cleanly — and no two transactions ever take the translation and its revision in opposite orders (no deadlock).
    /// </summary>
    private async Task<BlogPostTranslation?> LockTranslationAsync(Guid postId, string locale, CancellationToken cancellationToken) =>
        (await db.BlogPostTranslations
            .FromSqlInterpolated($"SELECT * FROM \"BlogPostTranslations\" WHERE \"PostId\" = {postId} AND \"Locale\" = {locale} FOR UPDATE")
            .ToListAsync(cancellationToken)).SingleOrDefault();

    private void Audit(
        Guid actor, string action, Guid? postId = null, Guid? translationId = null, Guid? categoryId = null, string? locale = null,
        Guid? revisionId = null, int? versionAfter = null, object? detail = null) =>
        db.BlogAudits.Add(new BlogAudit(
            Guid.NewGuid(), clock.GetUtcNow(), actor, action, postId, translationId, categoryId, locale, revisionId, versionAfter,
            detail is null ? null : JsonSerializer.Serialize(detail)));

    private async Task<Dictionary<Guid, string?>> StaffEmailsAsync(IEnumerable<Guid?> ids, CancellationToken cancellationToken)
    {
        var wanted = ids.Where(id => id is not null).Select(id => id!.Value).Distinct().ToList();
        return wanted.Count == 0
            ? []
            : await db.StaffAccounts.AsNoTracking().Where(account => wanted.Contains(account.Id)).ToDictionaryAsync(account => account.Id, account => (string?)account.Email, cancellationToken);
    }

    private static BlogStaffDto? Staff(Dictionary<Guid, string?> emails, Guid? id) =>
        id is { } value ? new BlogStaffDto(value, emails.GetValueOrDefault(value)) : null;

    // ---- draft content validation (shared by create, save and publish) ----

    /// <summary>
    /// Validates a draft: shapes, lengths, links, ids that must exist. Incomplete is fine, malformed or dangling is not. Returns the content to store
    /// (strings trimmed, body in canonical form) plus what the body says it needs.
    /// </summary>
    private async Task<(BlogRevisionContent? Content, BlogBodyInfo? Body, BlogProblem? Problem)> BuildContentAsync(BlogDraftInput input, CancellationToken cancellationToken)
    {
        BlogProblem? problem =
            BlogText.Check(input.Title, BlogLimits.Title, "title") ??
            BlogText.Check(input.Summary, BlogLimits.Summary, "summary") ??
            BlogText.Check(input.CoverAlt, BlogLimits.AltText, "coverAlt") ??
            BlogText.Check(input.AuthorName, BlogLimits.Author, "authorName") ??
            BlogText.Check(input.MetaTitle, BlogLimits.MetaTitle, "metaTitle") ??
            BlogText.Check(input.MetaDescription, BlogLimits.MetaDescription, "metaDescription");
        var slug = BlogText.Normalize(input.Slug);
        if (problem is null && slug.Length > 0)
        {
            problem = BlogSlug.Check(slug, "slug");
        }

        if (problem is not null)
        {
            return (null, null, problem);
        }

        var (body, bodyProblem) = BlogBody.Validate(input.BodyJson);
        if (bodyProblem is not null || body is null)
        {
            return (null, null, bodyProblem);
        }

        var categoryIds = input.CategoryIds.Distinct().ToList();
        if (categoryIds.Count > BlogLimits.MaxCategoriesPerRevision)
        {
            return (null, null, new BlogProblem(BlogErrorCodes.Validation, "categoryIds", $"An article has at most {BlogLimits.MaxCategoriesPerRevision} categories."));
        }

        if (categoryIds.Count > 0 && await db.BlogCategories.AsNoTracking().CountAsync(category => categoryIds.Contains(category.Id), cancellationToken) != categoryIds.Count)
        {
            return (null, null, new BlogProblem(BlogErrorCodes.CategoryMissing, "categoryIds", "A category does not exist."));
        }

        if (input.PrimaryCategoryId is { } primary && !categoryIds.Contains(primary))
        {
            return (null, null, new BlogProblem(BlogErrorCodes.Validation, "primaryCategoryId", "The main category must be one of the article's categories."));
        }

        var primaryId = input.PrimaryCategoryId ?? (categoryIds.Count == 1 ? categoryIds[0] : null);

        var media = body.MediaIds.ToHashSet();
        if (input.CoverMediaId is { } cover)
        {
            media.Add(cover);
        }

        if (input.OgImageMediaId is { } og)
        {
            media.Add(og);
        }

        if (media.Count > 0 && await db.BlogMedia.AsNoTracking().CountAsync(row => media.Contains(row.Id), cancellationToken) != media.Count)
        {
            return (null, null, new BlogProblem(BlogErrorCodes.MediaMissing, "media", "A picture used by this article is not available. Upload it again."));
        }

        if (body.PropertyIds.Count > 0 &&
            await db.Properties.AsNoTracking().CountAsync(property => body.PropertyIds.Contains(property.Id), cancellationToken) != body.PropertyIds.Count)
        {
            return (null, null, new BlogProblem(BlogErrorCodes.PropertyMissing, "body", "A property introduced in the article does not exist."));
        }

        var content = new BlogRevisionContent(
            BlogText.Normalize(input.Title), slug, BlogText.Normalize(input.Summary), body.CanonicalJson, input.CoverMediaId,
            BlogText.Normalize(input.CoverAlt), BlogText.Normalize(input.AuthorName), BlogText.Normalize(input.MetaTitle),
            BlogText.Normalize(input.MetaDescription), input.OgImageMediaId, categoryIds, primaryId, media);
        return (content, body, null);
    }

    /// <summary>Everything publishing needs on top of a well-formed draft. The first failure.</summary>
    private async Task<BlogProblem?> CheckPublishableAsync(BlogRevisionContent content, string locale, CancellationToken cancellationToken)
    {
        if (content.Title.Length == 0)
        {
            return new BlogProblem(BlogErrorCodes.TitleRequired, "title", "Enter a title before publishing.");
        }

        if (BlogSlug.Check(content.Slug, "slug") is { } slug)
        {
            return slug;
        }

        if (content.Summary.Length == 0)
        {
            return new BlogProblem(BlogErrorCodes.SummaryRequired, "summary", "Enter a short description before publishing.");
        }

        var (body, bodyProblem) = BlogBody.Validate(content.BodyJson);
        if (body is null)
        {
            return bodyProblem;
        }

        if (body.BlockCount == 0 || body.TextLength == 0)
        {
            return new BlogProblem(BlogErrorCodes.BodyEmpty, "body", "Write some content before publishing.");
        }

        if (body.HasImageWithoutAlt)
        {
            return new BlogProblem(BlogErrorCodes.ImageAltRequired, "body", "Every picture in the article needs an alternative text before publishing.");
        }

        if (content.CategoryIds.Count == 0)
        {
            return new BlogProblem(BlogErrorCodes.CategoryRequired, "categoryIds", "Choose at least one category before publishing.");
        }

        if (content.PrimaryCategoryId is null)
        {
            return new BlogProblem(BlogErrorCodes.CategoryPrimaryRequired, "primaryCategoryId", "Choose the main category before publishing.");
        }

        if (await db.BlogCategoryTranslations.AsNoTracking().CountAsync(
                translation => translation.Locale == locale && content.CategoryIds.Contains(translation.CategoryId), cancellationToken) != content.CategoryIds.Count)
        {
            return new BlogProblem(BlogErrorCodes.CategoryLocaleMissing, "categoryIds", "A chosen category has no text in this language. Add it to the category first.");
        }

        if (content.CoverMediaId is null)
        {
            return new BlogProblem(BlogErrorCodes.CoverRequired, "coverMediaId", "Choose a cover picture before publishing.");
        }

        return content.CoverAlt.Length == 0
            ? new BlogProblem(BlogErrorCodes.CoverAltRequired, "coverAlt", "Describe the cover picture before publishing.")
            : null;
    }

    // ---- post slug claims ----

    /// <summary>
    /// Keeps the draft's address reserved. A slug the translation already owns (live or old) needs no new claim; a free one is reserved as
    /// <see cref="BlogSlugState.Draft"/>; one that belongs to another page is refused. Uses set-based statements so the one-draft/one-current
    /// indexes are never violated mid-save.
    /// </summary>
    private async Task<BlogProblem?> ReserveDraftSlugAsync(Guid translationId, string locale, string slug, CancellationToken cancellationToken)
    {
        var claims = await db.BlogPostSlugs.AsNoTracking().Where(claim => claim.TranslationId == translationId).ToListAsync(cancellationToken);
        var draft = claims.FirstOrDefault(claim => claim.State == BlogSlugState.Draft);
        if (slug.Length == 0 || claims.Any(claim => claim.Slug == slug && claim.State != BlogSlugState.Draft))
        {
            await DropDraftClaimAsync(draft, locale, cancellationToken);
            return null;
        }

        if (draft?.Slug == slug)
        {
            return null;
        }

        if (await db.BlogPostSlugs.AsNoTracking().AnyAsync(claim => claim.Locale == locale && claim.Slug == slug, cancellationToken))
        {
            return new BlogProblem(BlogErrorCodes.SlugTaken, "slug", "Another article already uses this slug (or used it before). Choose another one.");
        }

        await DropDraftClaimAsync(draft, locale, cancellationToken);
        db.BlogPostSlugs.Add(new BlogPostSlug(locale, slug, translationId, BlogSlugState.Draft));
        return null;
    }

    private async Task DropDraftClaimAsync(BlogPostSlug? draft, string locale, CancellationToken cancellationToken)
    {
        if (draft is not null)
        {
            await db.BlogPostSlugs.Where(claim => claim.Locale == locale && claim.Slug == draft.Slug).ExecuteDeleteAsync(cancellationToken);
        }
    }

    /// <summary>At publish: the draft's slug becomes the live one; the former live slug becomes a redirect that this translation owns for ever.</summary>
    private async Task PromoteSlugAsync(Guid translationId, string locale, string slug, CancellationToken cancellationToken)
    {
        var claims = await db.BlogPostSlugs.AsNoTracking().Where(claim => claim.TranslationId == translationId).ToListAsync(cancellationToken);
        var current = claims.FirstOrDefault(claim => claim.State == BlogSlugState.Current);
        if (current?.Slug == slug)
        {
            return;
        }

        if (current is not null)
        {
            await db.BlogPostSlugs.Where(claim => claim.Locale == locale && claim.Slug == current.Slug)
                .ExecuteUpdateAsync(set => set.SetProperty(claim => claim.State, BlogSlugState.Redirect), cancellationToken);
        }

        if (claims.Any(claim => claim.Slug == slug))
        {
            await db.BlogPostSlugs.Where(claim => claim.Locale == locale && claim.Slug == slug)
                .ExecuteUpdateAsync(set => set.SetProperty(claim => claim.State, BlogSlugState.Current), cancellationToken);
        }
        else
        {
            db.BlogPostSlugs.Add(new BlogPostSlug(locale, slug, translationId, BlogSlugState.Current));
        }
    }
}
