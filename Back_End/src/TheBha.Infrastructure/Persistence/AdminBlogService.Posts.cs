using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;

namespace TheBha.Infrastructure.Persistence;

internal sealed partial class AdminBlogService
{
    // ---- reads ----

    public async Task<WebsiteMutationResult<BlogPostListDto>> ListPostsAsync(BlogPostListQuery query, CancellationToken cancellationToken)
    {
        var translations = db.BlogPostTranslations.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(query.Locale))
        {
            var (locale, problem) = await LocaleAsync(query.Locale, "locale", cancellationToken);
            if (locale is null)
            {
                return Fail<BlogPostListDto>(problem!);
            }

            translations = translations.Where(t => t.Locale == locale);
        }

        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            if (!Enum.TryParse<BlogTranslationStatus>(query.Status, ignoreCase: true, out var status) || !Enum.IsDefined(status))
            {
                return WebsiteMutationResult<BlogPostListDto>.Invalid("status", "Status is Draft, Published, Unpublished or Archived.");
            }

            translations = translations.Where(t => t.Status == status);
        }

        if (query.CategoryId is { } categoryId)
        {
            translations = translations.Where(t => db.BlogRevisionCategories.Any(rc =>
                rc.CategoryId == categoryId && (rc.RevisionId == t.DraftRevisionId || rc.RevisionId == t.PublishedRevisionId)));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim().ToLowerInvariant();
            translations = translations.Where(t => db.BlogPostRevisions.Any(r =>
                (r.Id == t.DraftRevisionId || r.Id == t.PublishedRevisionId) && (r.Title.ToLower().Contains(term) || r.Slug.Contains(term))));
        }

        var postIds = translations.Select(t => t.PostId).Distinct();
        var total = await postIds.CountAsync(cancellationToken);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var page = Math.Max(query.Page, 1);

        // (page - 1) * pageSize wraps in 32 bits for a large page and PostgreSQL refuses a negative OFFSET: worked out in 64 bits, and a page that starts at or
        // past the end is an empty page with the real total - no query for rows, no clamping to another page, no swallowed error.
        var offset = (long)(page - 1) * pageSize;
        if (offset >= total)
        {
            return WebsiteMutationResult<BlogPostListDto>.Success(new BlogPostListDto([], page, pageSize, total));
        }

        var ids = await db.BlogPosts.AsNoTracking()
            .Where(post => postIds.Contains(post.Id))
            .OrderByDescending(post => db.BlogPostTranslations.Where(t => t.PostId == post.Id).Max(t => t.UpdatedAtUtc))
            .ThenBy(post => post.Id)
            .Skip((int)offset).Take(pageSize)
            .Select(post => post.Id)
            .ToListAsync(cancellationToken);

        var rows = await db.BlogPostTranslations.AsNoTracking().Where(t => ids.Contains(t.PostId)).ToListAsync(cancellationToken);
        var revisionIds = rows.SelectMany(t => new[] { t.DraftRevisionId, t.PublishedRevisionId }).Where(id => id is not null).Select(id => id!.Value).ToList();
        var revisions = await db.BlogPostRevisions.AsNoTracking().Where(r => revisionIds.Contains(r.Id))
            .Select(r => new { r.Id, r.Title, r.Slug, r.CoverMediaId }).ToDictionaryAsync(r => r.Id, cancellationToken);
        var emails = await StaffEmailsAsync(rows.Select(t => (Guid?)t.UpdatedByStaffId), cancellationToken);

        var items = ids.Select(id =>
        {
            var own = rows.Where(t => t.PostId == id).OrderBy(t => t.Locale, StringComparer.Ordinal).ToList();
            return new BlogPostRowDto(
                id,
                own.Max(t => t.UpdatedAtUtc),
                own.Select(t =>
                {
                    // The saved draft, else the published revision. A translation with neither (the schema allows it, no API route commits it) is still a row: its
                    // status, version and date, with no text and no cover - never dropped from the page or the total, never another revision chosen for it.
                    var shownId = t.DraftRevisionId ?? t.PublishedRevisionId;
                    var shown = shownId is { } revisionId ? revisions[revisionId] : null;
                    return new BlogTranslationRowDto(
                        t.Locale, t.Status.ToString(), t.Version, shown?.Title ?? string.Empty, shown?.Slug ?? string.Empty, t.DraftRevisionId is not null, t.UpdatedAtUtc,
                        Staff(emails, t.UpdatedByStaffId), shown?.CoverMediaId);
                }).ToList());
        }).ToList();
        return WebsiteMutationResult<BlogPostListDto>.Success(new BlogPostListDto(items, page, pageSize, total));
    }

    public async Task<WebsiteMutationResult<BlogPostAdminDto>> GetPostAsync(Guid postId, CancellationToken cancellationToken)
    {
        var dto = await LoadPostDtoAsync(postId, cancellationToken);
        return dto is null
            ? Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The article does not exist."))
            : WebsiteMutationResult<BlogPostAdminDto>.Success(dto);
    }

    private async Task<BlogPostAdminDto?> LoadPostDtoAsync(Guid postId, CancellationToken cancellationToken)
    {
        var post = await db.BlogPosts.AsNoTracking().SingleOrDefaultAsync(p => p.Id == postId, cancellationToken);
        if (post is null)
        {
            return null;
        }

        var translations = await db.BlogPostTranslations.AsNoTracking().Where(t => t.PostId == postId).OrderBy(t => t.Locale).ToListAsync(cancellationToken);
        var revisionIds = translations.SelectMany(t => new[] { t.DraftRevisionId, t.PublishedRevisionId }).Where(id => id is not null).Select(id => id!.Value).ToList();
        var revisions = await db.BlogPostRevisions.AsNoTracking().Include(r => r.Categories).Where(r => revisionIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, cancellationToken);
        var emails = await StaffEmailsAsync(
            translations.Select(t => (Guid?)t.UpdatedByStaffId)
                .Concat(revisions.Values.SelectMany(r => new Guid?[] { r.CreatedByStaffId, r.UpdatedByStaffId, r.PublishedByStaffId })),
            cancellationToken);

        return new BlogPostAdminDto(
            post.Id,
            post.CreatedAtUtc,
            translations.Select(t => new BlogTranslationAdminDto(
                t.Id, t.Locale, t.Status.ToString(), t.Version, t.DraftRevisionId is not null, t.FirstPublishedAtUtc, t.UpdatedAtUtc, Staff(emails, t.UpdatedByStaffId),
                t.DraftRevisionId is { } d ? ToDto(revisions[d], emails) : null,
                t.PublishedRevisionId is { } p ? ToDto(revisions[p], emails) : null)).ToList());
    }

    private static BlogRevisionDto ToDto(BlogPostRevision r, Dictionary<Guid, string?> emails) => new(
        r.Id, r.Number, r.State.ToString(), r.Origin.ToString(), r.RestoredFromRevisionId, r.Title, r.Slug, r.Summary,
        JsonDocument.Parse(r.BodyJson).RootElement.Clone(), r.CoverMediaId, r.CoverAlt, r.AuthorName, r.MetaTitle, r.MetaDescription, r.OgImageMediaId,
        r.Categories.Select(c => c.CategoryId).OrderBy(id => id).ToList(), r.Categories.FirstOrDefault(c => c.IsPrimary)?.CategoryId,
        r.CreatedAtUtc, Staff(emails, r.CreatedByStaffId), r.UpdatedAtUtc, Staff(emails, r.UpdatedByStaffId), r.PublishedAtUtc, Staff(emails, r.PublishedByStaffId));

    public async Task<WebsiteMutationResult<IReadOnlyList<BlogRevisionSummaryDto>>> ListRevisionsAsync(Guid postId, string locale, CancellationToken cancellationToken)
    {
        var (normalized, problem) = await LocaleAsync(locale, "locale", cancellationToken);
        if (normalized is null)
        {
            return Fail<IReadOnlyList<BlogRevisionSummaryDto>>(problem!);
        }

        var translation = await db.BlogPostTranslations.AsNoTracking().SingleOrDefaultAsync(t => t.PostId == postId && t.Locale == normalized, cancellationToken);
        if (translation is null)
        {
            return Fail<IReadOnlyList<BlogRevisionSummaryDto>>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The article has no such translation."));
        }

        var revisions = await db.BlogPostRevisions.AsNoTracking().Where(r => r.TranslationId == translation.Id).OrderByDescending(r => r.Number).ToListAsync(cancellationToken);
        var emails = await StaffEmailsAsync(revisions.SelectMany(r => new Guid?[] { r.CreatedByStaffId, r.PublishedByStaffId }), cancellationToken);
        IReadOnlyList<BlogRevisionSummaryDto> list = revisions.Select(r => new BlogRevisionSummaryDto(
            r.Id, r.Number, r.State.ToString(), r.Origin.ToString(), r.Title, r.Slug, r.CreatedAtUtc, Staff(emails, r.CreatedByStaffId),
            r.PublishedAtUtc, Staff(emails, r.PublishedByStaffId), r.Id == translation.DraftRevisionId, r.Id == translation.PublishedRevisionId)).ToList();
        return WebsiteMutationResult<IReadOnlyList<BlogRevisionSummaryDto>>.Success(list);
    }

    public async Task<WebsiteMutationResult<BlogRevisionDto>> GetRevisionAsync(Guid postId, string locale, Guid revisionId, CancellationToken cancellationToken)
    {
        var (normalized, problem) = await LocaleAsync(locale, "locale", cancellationToken);
        if (normalized is null)
        {
            return Fail<BlogRevisionDto>(problem!);
        }

        var revision = await db.BlogPostRevisions.AsNoTracking().Include(r => r.Categories)
            .SingleOrDefaultAsync(r => r.Id == revisionId && db.BlogPostTranslations.Any(t => t.Id == r.TranslationId && t.PostId == postId && t.Locale == normalized), cancellationToken);
        if (revision is null)
        {
            return Fail<BlogRevisionDto>(new BlogProblem(BlogErrorCodes.NotFound, "revisionId", "The revision does not exist."));
        }

        var emails = await StaffEmailsAsync(new Guid?[] { revision.CreatedByStaffId, revision.UpdatedByStaffId, revision.PublishedByStaffId }, cancellationToken);
        return WebsiteMutationResult<BlogRevisionDto>.Success(ToDto(revision, emails));
    }

    // ---- writes ----

    private async Task<WebsiteMutationResult<BlogPostAdminDto>> ReloadAsync(Guid postId, CancellationToken cancellationToken) =>
        WebsiteMutationResult<BlogPostAdminDto>.Success((await LoadPostDtoAsync(postId, cancellationToken))!);

    private static object SlugDetail(BlogRevisionContent content) => new { slug = content.Slug, categories = content.CategoryIds };

    public async Task<WebsiteMutationResult<BlogPostAdminDto>> CreatePostAsync(CreateBlogPostCommand command, CancellationToken cancellationToken)
    {
        var (locale, localeProblem) = await LocaleAsync(command.Locale, "locale", cancellationToken);
        if (locale is null)
        {
            return Fail<BlogPostAdminDto>(localeProblem!);
        }

        if (BlogText.Normalize(command.Draft.Title).Length == 0)
        {
            return Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.TitleRequired, "title", "Enter a title to start an article."));
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (await db.BlogPosts.AsNoTracking().AnyAsync(post => post.Id == command.PostId, cancellationToken))
        {
            return Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.DuplicateId, "id", "An article with this id already exists."));
        }

        var (content, _, problem) = await BuildContentAsync(command.Draft, cancellationToken);
        if (content is null)
        {
            return Fail<BlogPostAdminDto>(problem!);
        }

        var now = clock.GetUtcNow();
        var post = new BlogPost(command.PostId, command.ActorStaffId, now);
        var translation = new BlogPostTranslation(Guid.NewGuid(), post.Id, locale, command.ActorStaffId, now);
        var revision = new BlogPostRevision(Guid.NewGuid(), translation.Id, 1, BlogRevisionOrigin.Edit, null, content, command.ActorStaffId, now);
        db.Add(post);
        db.Add(translation);
        db.Add(revision);
        if (await ReserveDraftSlugAsync(translation.Id, locale, content.Slug, cancellationToken) is { } slug)
        {
            return Fail<BlogPostAdminDto>(slug);
        }

        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogPostAdminDto>(saved);
        }

        translation.AttachFirstDraft(revision.Id);
        Audit(command.ActorStaffId, "post.create", post.Id, translation.Id, null, locale, revision.Id, translation.Version, SlugDetail(content));
        if (await SaveAsync(cancellationToken) is { } pointed)
        {
            return Fail<BlogPostAdminDto>(pointed);
        }

        await transaction.CommitAsync(cancellationToken);
        return await ReloadAsync(post.Id, cancellationToken);
    }

    public async Task<WebsiteMutationResult<BlogPostAdminDto>> SaveDraftAsync(SaveBlogDraftCommand command, CancellationToken cancellationToken)
    {
        var (locale, localeProblem) = await LocaleAsync(command.Locale, "locale", cancellationToken);
        if (locale is null)
        {
            return Fail<BlogPostAdminDto>(localeProblem!);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (!await db.BlogPosts.AsNoTracking().AnyAsync(post => post.Id == command.PostId, cancellationToken))
        {
            return Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.NotFound, "id", "The article does not exist."));
        }

        var translation = await LockTranslationAsync(command.PostId, locale, cancellationToken);
        var (content, _, problem) = await BuildContentAsync(command.Draft, cancellationToken);
        if (content is null)
        {
            return Fail<BlogPostAdminDto>(problem!);
        }

        var now = clock.GetUtcNow();
        if (translation is null)
        {
            if (command.ExpectedVersion != 0)
            {
                return Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.NotFound, "locale", "The article has no translation in this language yet; save with expectedVersion 0 to create it."));
            }

            if (content.Title.Length == 0)
            {
                return Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.TitleRequired, "title", "Enter a title to start a translation."));
            }

            translation = new BlogPostTranslation(Guid.NewGuid(), command.PostId, locale, command.ActorStaffId, now);
            var first = new BlogPostRevision(Guid.NewGuid(), translation.Id, 1, BlogRevisionOrigin.Edit, null, content, command.ActorStaffId, now);
            db.Add(translation);
            db.Add(first);
            if (await ReserveDraftSlugAsync(translation.Id, locale, content.Slug, cancellationToken) is { } firstSlug)
            {
                return Fail<BlogPostAdminDto>(firstSlug);
            }

            if (await SaveAsync(cancellationToken) is { } firstSaved)
            {
                return Fail<BlogPostAdminDto>(firstSaved);
            }

            translation.AttachFirstDraft(first.Id);
            Audit(command.ActorStaffId, "draft.create", command.PostId, translation.Id, null, locale, first.Id, translation.Version, SlugDetail(content));
            if (await SaveAsync(cancellationToken) is { } pointed)
            {
                return Fail<BlogPostAdminDto>(pointed);
            }

            await transaction.CommitAsync(cancellationToken);
            return await ReloadAsync(command.PostId, cancellationToken);
        }

        if (command.ExpectedVersion != translation.Version)
        {
            return Fail<BlogPostAdminDto>(Stale);
        }

        if (translation.CheckEditable() is { } archived)
        {
            return Fail<BlogPostAdminDto>(archived);
        }

        if (await ReserveDraftSlugAsync(translation.Id, locale, content.Slug, cancellationToken) is { } slug)
        {
            return Fail<BlogPostAdminDto>(slug);
        }

        BlogPostRevision revision;
        if (translation.DraftRevisionId is { } draftId)
        {
            revision = await db.BlogPostRevisions.Include(r => r.Categories).Include(r => r.Media).SingleAsync(r => r.Id == draftId, cancellationToken);
            revision.Replace(content, command.ActorStaffId, now);
        }
        else
        {
            var number = await db.BlogPostRevisions.Where(r => r.TranslationId == translation.Id).MaxAsync(r => r.Number, cancellationToken) + 1;
            revision = new BlogPostRevision(Guid.NewGuid(), translation.Id, number, BlogRevisionOrigin.Edit, null, content, command.ActorStaffId, now);
            db.Add(revision);
            if (await SaveAsync(cancellationToken) is { } created)
            {
                return Fail<BlogPostAdminDto>(created);
            }
        }

        translation.DraftWritten(revision.Id, command.ActorStaffId, now);
        Audit(command.ActorStaffId, "draft.save", command.PostId, translation.Id, null, locale, revision.Id, translation.Version, SlugDetail(content));
        if (await SaveAsync(cancellationToken) is { } saved2)
        {
            return Fail<BlogPostAdminDto>(saved2);
        }

        await transaction.CommitAsync(cancellationToken);
        return await ReloadAsync(command.PostId, cancellationToken);
    }

    private async Task<(BlogPostTranslation? Translation, string? Locale, BlogProblem? Problem)> LoadForTransitionAsync(
        Guid postId, string locale, int expectedVersion, CancellationToken cancellationToken)
    {
        var (normalized, problem) = await LocaleAsync(locale, "locale", cancellationToken);
        if (normalized is null)
        {
            return (null, null, problem);
        }

        var translation = await LockTranslationAsync(postId, normalized, cancellationToken);
        if (translation is null)
        {
            return (null, null, new BlogProblem(BlogErrorCodes.NotFound, "locale", "The article has no such translation."));
        }

        return expectedVersion != translation.Version ? (null, null, Stale) : (translation, normalized, null);
    }

    public async Task<WebsiteMutationResult<BlogPostAdminDto>> PublishAsync(BlogTransitionCommand command, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var (translation, locale, problem) = await LoadForTransitionAsync(command.PostId, command.Locale, command.ExpectedVersion, cancellationToken);
        if (translation is null)
        {
            return Fail<BlogPostAdminDto>(problem!);
        }

        var now = clock.GetUtcNow();
        if (translation.CheckEditable() is { } archived)
        {
            return Fail<BlogPostAdminDto>(archived);
        }

        if (translation.DraftRevisionId is not { } draftId)
        {
            if (translation.Republish(command.ActorStaffId, now) is { } republish)
            {
                return Fail<BlogPostAdminDto>(translation.Status == BlogTranslationStatus.Published
                    ? new BlogProblem(BlogErrorCodes.NothingToPublish, "status", "There are no unpublished changes to publish.")
                    : republish);
            }

            Audit(command.ActorStaffId, "post.republish", command.PostId, translation.Id, null, locale, translation.PublishedRevisionId, translation.Version);
        }
        else
        {
            var draft = await db.BlogPostRevisions.Include(r => r.Categories).Include(r => r.Media).SingleAsync(r => r.Id == draftId, cancellationToken);
            if (await CheckPublishableAsync(draft.ToContent(), locale!, cancellationToken) is { } notReady)
            {
                return Fail<BlogPostAdminDto>(notReady);
            }

            await PromoteSlugAsync(translation.Id, locale!, draft.Slug, cancellationToken);
            if (translation.Publish(draft, command.ActorStaffId, now) is { } invalid)
            {
                return Fail<BlogPostAdminDto>(invalid);
            }

            Audit(command.ActorStaffId, "post.publish", command.PostId, translation.Id, null, locale, draft.Id, translation.Version, SlugDetail(draft.ToContent()));
        }

        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogPostAdminDto>(saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return await ReloadAsync(command.PostId, cancellationToken);
    }

    private async Task<WebsiteMutationResult<BlogPostAdminDto>> TransitionAsync(
        BlogTransitionCommand command, string action, Func<BlogPostTranslation, DateTimeOffset, BlogProblem?> change, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var (translation, locale, problem) = await LoadForTransitionAsync(command.PostId, command.Locale, command.ExpectedVersion, cancellationToken);
        if (translation is null)
        {
            return Fail<BlogPostAdminDto>(problem!);
        }

        if (change(translation, clock.GetUtcNow()) is { } refused)
        {
            return Fail<BlogPostAdminDto>(refused);
        }

        Audit(command.ActorStaffId, action, command.PostId, translation.Id, null, locale, null, translation.Version);
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogPostAdminDto>(saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return await ReloadAsync(command.PostId, cancellationToken);
    }

    public Task<WebsiteMutationResult<BlogPostAdminDto>> UnpublishAsync(BlogTransitionCommand command, CancellationToken cancellationToken) =>
        TransitionAsync(command, "post.unpublish", (t, now) => t.Unpublish(command.ActorStaffId, now), cancellationToken);

    public Task<WebsiteMutationResult<BlogPostAdminDto>> ArchiveAsync(BlogTransitionCommand command, CancellationToken cancellationToken) =>
        TransitionAsync(command, "post.archive", (t, now) => t.Archive(command.ActorStaffId, now), cancellationToken);

    public Task<WebsiteMutationResult<BlogPostAdminDto>> UnarchiveAsync(BlogTransitionCommand command, CancellationToken cancellationToken) =>
        TransitionAsync(command, "post.unarchive", (t, now) => t.Unarchive(command.ActorStaffId, now), cancellationToken);

    public async Task<WebsiteMutationResult<BlogPostAdminDto>> RestoreAsync(RestoreBlogRevisionCommand command, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var (translation, locale, problem) = await LoadForTransitionAsync(command.PostId, command.Locale, command.ExpectedVersion, cancellationToken);
        if (translation is null)
        {
            return Fail<BlogPostAdminDto>(problem!);
        }

        if (translation.CheckEditable() is { } archived)
        {
            return Fail<BlogPostAdminDto>(archived);
        }

        var source = await db.BlogPostRevisions.AsNoTracking().Include(r => r.Categories).Include(r => r.Media)
            .SingleOrDefaultAsync(r => r.Id == command.RevisionId && r.TranslationId == translation.Id, cancellationToken);
        if (source is null)
        {
            return Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.NotFound, "revisionId", "The revision does not exist."));
        }

        var now = clock.GetUtcNow();
        if (translation.DraftRevisionId is { } oldDraftId && oldDraftId != source.Id)
        {
            // The draft being replaced is kept as a frozen revision: nothing an editor wrote is lost.
            var oldDraft = await db.BlogPostRevisions.SingleAsync(r => r.Id == oldDraftId, cancellationToken);
            oldDraft.Freeze(published: false, command.ActorStaffId, now);
            translation.ClearDraft();
            if (await SaveAsync(cancellationToken) is { } frozen)
            {
                return Fail<BlogPostAdminDto>(frozen);
            }
        }
        else if (translation.DraftRevisionId == source.Id)
        {
            return Fail<BlogPostAdminDto>(new BlogProblem(BlogErrorCodes.InvalidState, "revisionId", "This revision is already the current draft."));
        }

        var content = source.ToContent();
        // The slug may have been given to another page since; then the restored draft starts without one rather than failing.
        var takenByOther = content.Slug.Length > 0 && await db.BlogPostSlugs.AsNoTracking()
            .AnyAsync(claim => claim.Locale == locale && claim.Slug == content.Slug && claim.TranslationId != translation.Id, cancellationToken);
        if (takenByOther)
        {
            content = content with { Slug = string.Empty };
        }

        var number = await db.BlogPostRevisions.Where(r => r.TranslationId == translation.Id).MaxAsync(r => r.Number, cancellationToken) + 1;
        var restored = new BlogPostRevision(Guid.NewGuid(), translation.Id, number, BlogRevisionOrigin.Restore, source.Id, content, command.ActorStaffId, now);
        db.Add(restored);
        if (await ReserveDraftSlugAsync(translation.Id, locale!, content.Slug, cancellationToken) is { } slug)
        {
            return Fail<BlogPostAdminDto>(slug);
        }

        if (await SaveAsync(cancellationToken) is { } created)
        {
            return Fail<BlogPostAdminDto>(created);
        }

        translation.DraftWritten(restored.Id, command.ActorStaffId, now);
        Audit(command.ActorStaffId, "revision.restore", command.PostId, translation.Id, null, locale, restored.Id, translation.Version, new { from = source.Id, source.Number });
        if (await SaveAsync(cancellationToken) is { } saved)
        {
            return Fail<BlogPostAdminDto>(saved);
        }

        await transaction.CommitAsync(cancellationToken);
        return await ReloadAsync(command.PostId, cancellationToken);
    }
}
