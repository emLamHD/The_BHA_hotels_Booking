using TheBha.Domain.Common;

namespace TheBha.Domain.Blog;

/// <summary>
/// A category (chuyên mục). Its identity is the id, never a name: the home section links to a category by id and a rename changes
/// nothing. <see cref="SystemKey"/> only lets the seed find "Điểm đến nổi bật" again. <see cref="Version"/> guards edits and the pin list.
/// </summary>
public sealed class BlogCategory
{
    private BlogCategory()
    {
    }

    public BlogCategory(Guid id, string? systemKey, int sortOrder, Guid? actorStaffId, DateTimeOffset nowUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        SystemKey = systemKey;
        SortOrder = sortOrder;
        Version = 1;
        CreatedAtUtc = UpdatedAtUtc = nowUtc;
        CreatedByStaffId = UpdatedByStaffId = actorStaffId;
    }

    public Guid Id { get; private set; }
    public string? SystemKey { get; private set; }
    public int SortOrder { get; private set; }
    public int Version { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? CreatedByStaffId { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }
    public List<BlogCategoryTranslation> Translations { get; private set; } = [];

    public void Edit(int sortOrder, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        SortOrder = sortOrder;
        Touch(actorStaffId, nowUtc);
    }

    public void Touch(Guid actorStaffId, DateTimeOffset nowUtc)
    {
        UpdatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        UpdatedAtUtc = nowUtc;
        Version++;
    }
}

public sealed class BlogCategoryTranslation
{
    private BlogCategoryTranslation()
    {
    }

    public BlogCategoryTranslation(Guid categoryId, string locale, string name, string slug, string? description)
    {
        CategoryId = categoryId;
        Locale = locale;
        Apply(name, slug, description);
    }

    public Guid CategoryId { get; private set; }
    public string Locale { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public string? Description { get; private set; }

    public void Apply(string name, string slug, string? description)
    {
        Name = name;
        Slug = slug;
        Description = string.IsNullOrWhiteSpace(description) ? null : description;
    }
}

/// <summary>A category address, current or old. The pair <c>(Locale, Slug)</c> belongs to one category for ever, so an old address can only ever redirect to it.</summary>
public sealed class BlogCategorySlug
{
    private BlogCategorySlug()
    {
    }

    public BlogCategorySlug(string locale, string slug, Guid categoryId, bool isCurrent)
    {
        Locale = locale;
        Slug = slug;
        CategoryId = categoryId;
        IsCurrent = isCurrent;
    }

    public string Locale { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public Guid CategoryId { get; private set; }
    public bool IsCurrent { get; set; }
}

/// <summary>Pin and order belong to the post–category relation, not to the post: the position of a post in one category.</summary>
public sealed class BlogCategoryPin
{
    private BlogCategoryPin()
    {
    }

    public BlogCategoryPin(Guid categoryId, Guid postId, int position, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        CategoryId = categoryId;
        PostId = postId;
        Position = position;
        PinnedByStaffId = actorStaffId;
        PinnedAtUtc = nowUtc;
    }

    public Guid CategoryId { get; private set; }
    public Guid PostId { get; private set; }
    public int Position { get; set; }
    public Guid PinnedByStaffId { get; private set; }
    public DateTimeOffset PinnedAtUtc { get; private set; }
}

/// <summary>The identity of an article. All of its content is in its translations.</summary>
public sealed class BlogPost
{
    private BlogPost()
    {
    }

    public BlogPost(Guid id, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        CreatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        CreatedAtUtc = nowUtc;
    }

    public Guid Id { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public Guid CreatedByStaffId { get; private set; }
    public List<BlogPostTranslation> Translations { get; private set; } = [];
}

/// <summary>
/// One language of one article, with its own publication state. <see cref="Version"/> is the concurrency token of every write on it, so two
/// writers on the same version cannot both succeed. The two revision pointers move only here, inside one transaction with the revision.
/// </summary>
public sealed class BlogPostTranslation
{
    private BlogPostTranslation()
    {
    }

    public BlogPostTranslation(Guid id, Guid postId, string locale, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PostId = DomainGuard.RequiredId(postId, nameof(postId));
        Locale = locale;
        Status = BlogTranslationStatus.Draft;
        Version = 1;
        CreatedAtUtc = UpdatedAtUtc = nowUtc;
        UpdatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
    }

    public Guid Id { get; private set; }
    public Guid PostId { get; private set; }
    public string Locale { get; private set; } = string.Empty;
    public BlogTranslationStatus Status { get; private set; }
    public int Version { get; private set; }
    public Guid? DraftRevisionId { get; private set; }
    public Guid? PublishedRevisionId { get; private set; }

    /// <summary>Set once, the first time this translation goes live; unpublishing and publishing again never moves it.</summary>
    public DateTimeOffset? FirstPublishedAtUtc { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid UpdatedByStaffId { get; private set; }

    public bool IsPublic => Status == BlogTranslationStatus.Published && PublishedRevisionId is not null;

    public static BlogProblem InvalidState(string message) => new(BlogErrorCodes.InvalidState, "status", message);

    public BlogProblem? CheckEditable() =>
        Status == BlogTranslationStatus.Archived
            ? new BlogProblem(BlogErrorCodes.Archived, "status", "An archived translation cannot be changed. Restore it from the archive first.")
            : null;

    /// <summary>The first revision of a brand-new translation: points at it without counting as an edit (the version stays 1).</summary>
    public void AttachFirstDraft(Guid draftRevisionId) => DraftRevisionId = draftRevisionId;

    /// <summary>The draft was just frozen (superseded by a restore): no draft is current until the next one is written.</summary>
    public void ClearDraft() => DraftRevisionId = null;

    /// <summary>A first draft was written, or an existing translation's draft was saved/created.</summary>
    public void DraftWritten(Guid draftRevisionId, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        DraftRevisionId = draftRevisionId;
        Touch(actorStaffId, nowUtc);
    }

    /// <summary>Makes <paramref name="draft"/> the published revision (freezing it) and the translation public.</summary>
    public BlogProblem? Publish(BlogPostRevision draft, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        if (CheckEditable() is { } archived)
        {
            return archived;
        }

        if (draft.Id != DraftRevisionId || draft.State != BlogRevisionState.Draft)
        {
            return InvalidState("Only the current draft can be published.");
        }

        draft.Freeze(published: true, actorStaffId, nowUtc);
        PublishedRevisionId = draft.Id;
        DraftRevisionId = null;
        Status = BlogTranslationStatus.Published;
        FirstPublishedAtUtc ??= nowUtc;
        Touch(actorStaffId, nowUtc);
        return null;
    }

    /// <summary>Publishes the revision that was live before an unpublish, unchanged: its <c>PublishedAtUtc</c> (the modified date) does not move.</summary>
    public BlogProblem? Republish(Guid actorStaffId, DateTimeOffset nowUtc)
    {
        if (Status != BlogTranslationStatus.Unpublished || PublishedRevisionId is null || DraftRevisionId is not null)
        {
            return InvalidState("Only an unpublished translation without a newer draft can be published again as it was.");
        }

        Status = BlogTranslationStatus.Published;
        Touch(actorStaffId, nowUtc);
        return null;
    }

    public BlogProblem? Unpublish(Guid actorStaffId, DateTimeOffset nowUtc)
    {
        if (Status != BlogTranslationStatus.Published)
        {
            return InvalidState("Only a published translation can be unpublished.");
        }

        Status = BlogTranslationStatus.Unpublished;
        Touch(actorStaffId, nowUtc);
        return null;
    }

    public BlogProblem? Archive(Guid actorStaffId, DateTimeOffset nowUtc)
    {
        if (Status == BlogTranslationStatus.Archived)
        {
            return InvalidState("The translation is already archived.");
        }

        Status = BlogTranslationStatus.Archived;
        Touch(actorStaffId, nowUtc);
        return null;
    }

    public BlogProblem? Unarchive(Guid actorStaffId, DateTimeOffset nowUtc)
    {
        if (Status != BlogTranslationStatus.Archived)
        {
            return InvalidState("Only an archived translation can be restored from the archive.");
        }

        Status = PublishedRevisionId is null ? BlogTranslationStatus.Draft : BlogTranslationStatus.Unpublished;
        Touch(actorStaffId, nowUtc);
        return null;
    }

    public void Touch(Guid actorStaffId, DateTimeOffset nowUtc)
    {
        UpdatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        UpdatedAtUtc = nowUtc;
        Version++;
    }
}

/// <summary>Everything a revision holds, as one value, so a save replaces it whole.</summary>
public sealed record BlogRevisionContent(
    string Title,
    string Slug,
    string Summary,
    string BodyJson,
    Guid? CoverMediaId,
    string CoverAlt,
    string AuthorName,
    string MetaTitle,
    string MetaDescription,
    Guid? OgImageMediaId,
    IReadOnlyList<Guid> CategoryIds,
    Guid? PrimaryCategoryId,
    IReadOnlySet<Guid> MediaIds);

/// <summary>
/// A version of the content of one translation. A <see cref="BlogRevisionState.Draft"/> is edited in place; a
/// <see cref="BlogRevisionState.Frozen"/> one never changes again. Title, slug, summary, body, cover, SEO, author, categories and
/// media are one row set, so what is published is always one consistent version.
/// </summary>
public sealed class BlogPostRevision
{
    private BlogPostRevision()
    {
    }

    public BlogPostRevision(
        Guid id, Guid translationId, int number, BlogRevisionOrigin origin, Guid? restoredFromRevisionId,
        BlogRevisionContent content, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        TranslationId = DomainGuard.RequiredId(translationId, nameof(translationId));
        Number = number;
        State = BlogRevisionState.Draft;
        Origin = origin;
        RestoredFromRevisionId = restoredFromRevisionId;
        CreatedAtUtc = UpdatedAtUtc = nowUtc;
        CreatedByStaffId = UpdatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        Apply(content);
    }

    public Guid Id { get; private set; }
    public Guid TranslationId { get; private set; }
    public int Number { get; private set; }
    public BlogRevisionState State { get; private set; }
    public BlogRevisionOrigin Origin { get; private set; }
    public Guid? RestoredFromRevisionId { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public string Summary { get; private set; } = string.Empty;
    public string BodyJson { get; private set; } = BlogBody.Empty;
    public Guid? CoverMediaId { get; private set; }
    public string CoverAlt { get; private set; } = string.Empty;

    /// <summary>A text the editor writes (a name or a byline). Never derived from the Staff account, so no Staff identity reaches the public.</summary>
    public string AuthorName { get; private set; } = string.Empty;

    public string MetaTitle { get; private set; } = string.Empty;
    public string MetaDescription { get; private set; } = string.Empty;
    public Guid? OgImageMediaId { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid CreatedByStaffId { get; private set; }
    public Guid UpdatedByStaffId { get; private set; }

    /// <summary>When this revision went live. <c>null</c> for a draft and for a revision that was superseded without being published.</summary>
    public DateTimeOffset? PublishedAtUtc { get; private set; }

    public Guid? PublishedByStaffId { get; private set; }
    public List<BlogRevisionCategory> Categories { get; private set; } = [];
    public List<BlogRevisionMedia> Media { get; private set; } = [];

    public void Replace(BlogRevisionContent content, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        if (State != BlogRevisionState.Draft)
        {
            throw new DomainException("A frozen revision cannot change.");
        }

        Apply(content);
        UpdatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        UpdatedAtUtc = nowUtc;
    }

    public void Freeze(bool published, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        if (State != BlogRevisionState.Draft)
        {
            throw new DomainException("A frozen revision cannot change.");
        }

        State = BlogRevisionState.Frozen;
        UpdatedByStaffId = actorStaffId;
        UpdatedAtUtc = nowUtc;
        if (published)
        {
            PublishedAtUtc = nowUtc;
            PublishedByStaffId = actorStaffId;
        }
    }

    private void Apply(BlogRevisionContent c)
    {
        Title = c.Title;
        Slug = c.Slug;
        Summary = c.Summary;
        BodyJson = c.BodyJson;
        CoverMediaId = c.CoverMediaId;
        CoverAlt = c.CoverAlt;
        AuthorName = c.AuthorName;
        MetaTitle = c.MetaTitle;
        MetaDescription = c.MetaDescription;
        OgImageMediaId = c.OgImageMediaId;

        // Diff, never clear-and-add: a removed and re-added row with the same key in one save would collide.
        Categories.RemoveAll(existing => !c.CategoryIds.Contains(existing.CategoryId));
        foreach (var id in c.CategoryIds.Where(id => Categories.All(existing => existing.CategoryId != id)))
        {
            Categories.Add(new BlogRevisionCategory(Id, id, false));
        }

        foreach (var category in Categories)
        {
            category.IsPrimary = category.CategoryId == c.PrimaryCategoryId;
        }

        Media.RemoveAll(existing => !c.MediaIds.Contains(existing.MediaId));
        foreach (var id in c.MediaIds.Where(id => Media.All(existing => existing.MediaId != id)))
        {
            Media.Add(new BlogRevisionMedia(Id, id));
        }
    }

    public BlogRevisionContent ToContent() => new(
        Title, Slug, Summary, BodyJson, CoverMediaId, CoverAlt, AuthorName, MetaTitle, MetaDescription, OgImageMediaId,
        Categories.Select(x => x.CategoryId).OrderBy(x => x).ToList(),
        Categories.FirstOrDefault(x => x.IsPrimary)?.CategoryId,
        Media.Select(x => x.MediaId).ToHashSet());
}

public sealed class BlogRevisionCategory
{
    private BlogRevisionCategory()
    {
    }

    public BlogRevisionCategory(Guid revisionId, Guid categoryId, bool isPrimary)
    {
        RevisionId = revisionId;
        CategoryId = categoryId;
        IsPrimary = isPrimary;
    }

    public Guid RevisionId { get; private set; }
    public Guid CategoryId { get; private set; }
    public bool IsPrimary { get; set; }
}

public sealed class BlogRevisionMedia
{
    private BlogRevisionMedia()
    {
    }

    public BlogRevisionMedia(Guid revisionId, Guid mediaId)
    {
        RevisionId = revisionId;
        MediaId = mediaId;
    }

    public Guid RevisionId { get; private set; }
    public Guid MediaId { get; private set; }
}

/// <summary>A post address, reserved or live or old. <c>(Locale, Slug)</c> is unique in the database and never reassigned to another translation.</summary>
public sealed class BlogPostSlug
{
    private BlogPostSlug()
    {
    }

    public BlogPostSlug(string locale, string slug, Guid translationId, BlogSlugState state)
    {
        Locale = locale;
        Slug = slug;
        TranslationId = translationId;
        State = state;
    }

    public string Locale { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public Guid TranslationId { get; private set; }
    public BlogSlugState State { get; set; }
}

/// <summary>A picture the Blog can use. Referenced by revisions through <see cref="BlogRevisionMedia"/>; never deleted while referenced.</summary>
public sealed class BlogMedia
{
    private BlogMedia()
    {
    }

    public BlogMedia(Guid id, string storageKey, string contentType, long byteSize, int width, int height, Guid createdByStaffId, DateTimeOffset nowUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        StorageKey = DomainGuard.Required(storageKey, nameof(storageKey), 100);
        ContentType = DomainGuard.Required(contentType, nameof(contentType), 40);
        ByteSize = byteSize;
        Width = width;
        Height = height;
        CreatedByStaffId = DomainGuard.RequiredId(createdByStaffId, nameof(createdByStaffId));
        CreatedAtUtc = nowUtc;
    }

    public Guid Id { get; private set; }
    public string StorageKey { get; private set; } = string.Empty;
    public string ContentType { get; private set; } = string.Empty;
    public long ByteSize { get; private set; }
    public int Width { get; private set; }
    public int Height { get; private set; }
    public Guid CreatedByStaffId { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
}

/// <summary>The single settings row: which category feeds the home section, by id.</summary>
public sealed class BlogSettings
{
    private BlogSettings()
    {
    }

    public int Id { get; private set; } = 1;
    public Guid? HomeSectionCategoryId { get; private set; }
    public int Version { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public Guid? UpdatedByStaffId { get; private set; }

    public void SetHomeSection(Guid? categoryId, Guid actorStaffId, DateTimeOffset nowUtc)
    {
        HomeSectionCategoryId = categoryId;
        UpdatedByStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        UpdatedAtUtc = nowUtc;
        Version++;
    }
}

/// <summary>One append-only line per mutation, with the verified Staff actor.</summary>
public sealed class BlogAudit
{
    private BlogAudit()
    {
    }

    public BlogAudit(
        Guid id, DateTimeOffset atUtc, Guid actorStaffId, string action, Guid? postId, Guid? translationId, Guid? categoryId,
        string? locale, Guid? revisionId, int? versionAfter, string? detail)
    {
        Id = id;
        AtUtc = atUtc;
        ActorStaffId = actorStaffId;
        Action = action;
        PostId = postId;
        TranslationId = translationId;
        CategoryId = categoryId;
        Locale = locale;
        RevisionId = revisionId;
        VersionAfter = versionAfter;
        Detail = detail;
    }

    public Guid Id { get; private set; }
    public DateTimeOffset AtUtc { get; private set; }
    public Guid ActorStaffId { get; private set; }
    public string Action { get; private set; } = string.Empty;
    public Guid? PostId { get; private set; }
    public Guid? TranslationId { get; private set; }
    public Guid? CategoryId { get; private set; }
    public string? Locale { get; private set; }
    public Guid? RevisionId { get; private set; }
    public int? VersionAfter { get; private set; }

    /// <summary>A small JSON object of facts (slug, categories…), never a body or a secret.</summary>
    public string? Detail { get; private set; }
}
