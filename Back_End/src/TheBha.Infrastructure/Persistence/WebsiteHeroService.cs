using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// CUST-WEB-HERO-001-CP01: the home page hero. One Save replaces the slides and sets the font, timing and texts in a single
/// transaction under the same site-wide lock every website write takes, so a reader sees the old hero or the new one and never a mix.
/// The revision an editor holds is the hero's version plus the version of every text row, so a text changed on the Translations
/// screen in the meantime is a stale save too (409), not a silent overwrite. A text is a stored-content text exactly like a menu label:
/// the content source language's is the row's own column, every other language's is a translation row keyed by a stable id
/// (<c>content.heroSlideshow.main.&lt;field&gt;</c>, <c>content.heroSlide.&lt;slideId&gt;.&lt;field&gt;</c>), so packs, coverage and the Translations
/// editor carry it. The file system is outside the transaction: an upload is written completely before its row exists, a Save
/// refuses a picture whose row or file is missing, and nothing here ever deletes a recorded picture.
/// </summary>
internal sealed class WebsiteHeroService(TheBhaDbContext database, TimeProvider timeProvider, IHeroMediaStorage storage) : IWebsiteHero
{
    private const string Shared = "heroSlideshow";
    private const string SharedId = "main";
    private const string SlideEntity = "heroSlide";
    private static readonly string[] SharedFields = ["title", "description", "primaryAction", "secondaryAction"];
    private static readonly string[] SlideFields = ["alt", "caption"];
    private static readonly string[] KeyPrefixes = [ContentKey.Prefix + Shared + ".", ContentKey.Prefix + SlideEntity + "."];

    public async Task<HeroAdminDto> GetAdminAsync(CancellationToken cancellationToken)
    {
        var settings = await database.WebsiteHero.AsNoTracking().SingleAsync(cancellationToken);
        var slides = await database.WebsiteHeroSlides.AsNoTracking().OrderBy(slide => slide.SortOrder).ToListAsync(cancellationToken);
        var media = await database.WebsiteHeroMedia.AsNoTracking().OrderByDescending(item => item.CreatedAtUtc).ThenBy(item => item.StorageKey).ToListAsync(cancellationToken);
        var languages = await database.WebsiteLanguages.AsNoTracking()
            .OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)
            .ToListAsync(cancellationToken);
        return BuildAdmin(settings, slides, media, languages, await TextRowsAsync(cancellationToken));
    }

    public async Task<WebsiteMutationResult<HeroAdminDto>> SaveAsync(SaveHeroCommand command, CancellationToken cancellationToken)
    {
        if (command.Slides is null || string.IsNullOrWhiteSpace(command.ExpectedRevision))
        {
            return WebsiteMutationResult<HeroAdminDto>.Invalid("expectedRevision", "expectedRevision is the revision the editor loaded.");
        }

        return await WebsiteTransaction.InLockAsync(database, timeProvider, async now =>
        {
            var settings = await database.WebsiteHero.SingleAsync(cancellationToken);
            var existingSlides = await database.WebsiteHeroSlides.AsNoTracking().ToListAsync(cancellationToken);
            var media = await database.WebsiteHeroMedia.AsNoTracking().ToListAsync(cancellationToken);
            var languages = await database.WebsiteLanguages.AsNoTracking().ToListAsync(cancellationToken);
            var rows = await TextRowsAsync(cancellationToken, track: true);

            if (Revision(settings.Version, rows) != command.ExpectedRevision)
            {
                return WebsiteMutationResult<HeroAdminDto>.Conflict(
                    WebsiteErrorCodes.StaleVersion, "The hero was changed by someone else since you opened it. Reload to see their version; your draft stays on screen.");
            }

            var defaultLanguage = languages.Single(language => language.IsDefault);
            var codes = languages.Select(language => language.NormalizedCode).ToHashSet(StringComparer.Ordinal);
            var required = new[] { ContentSource.Locale, defaultLanguage.NormalizedCode }.Distinct(StringComparer.Ordinal).ToList();
            if (HeroRules.Validate(command, codes, required) is { } problem)
            {
                return Invalid(problem);
            }

            // Every picture must be a recorded one whose file is there now: an unfinished or vanished file is never published.
            var known = media.ToDictionary(item => item.Id);
            for (var index = 0; index < command.Slides.Count; index++)
            {
                var slide = command.Slides[index];
                if (!known.TryGetValue(slide.MediaId, out var picture) || !await storage.ExistsAsync(picture.StorageKey, cancellationToken))
                {
                    return Invalid(new HeroProblem(HeroErrorCodes.MediaMissing, $"slides[{index}].mediaId", "This picture is not available. Upload it again or choose another."));
                }
            }

            var texts = command.Texts!;
            var title = LabelFor(texts.Title, ContentSource.Locale)!.Trim();
            var description = LabelFor(texts.Description, ContentSource.Locale)!.Trim();
            var primary = LabelFor(texts.PrimaryAction, ContentSource.Locale)!.Trim();
            var secondary = LabelFor(texts.SecondaryAction, ContentSource.Locale)!.Trim();
            var slides = BuildSlides(command.Slides);
            var plan = PlanTexts(command, languages, defaultLanguage, rows, now);
            var slideChanged = HasChanged(existingSlides, slides);
            if (!settings.Differs(command.FontKey!, command.AutoplayEnabled, command.IntervalSeconds, title, description, primary, secondary) &&
                !slideChanged && plan.Add.Count == 0 && plan.Change.Count == 0 && plan.Remove.Count == 0)
            {
                // Nothing differs: no new version, so open pages are not woken for nothing.
                return WebsiteMutationResult<HeroAdminDto>.Success(BuildAdmin(settings, existingSlides, media, OrderLanguages(languages), rows));
            }

            await database.WebsiteHeroSlides.ExecuteDeleteAsync(cancellationToken);
            database.WebsiteHeroSlides.AddRange(slides);
            var kept = slides.Select(slide => slide.Id).ToHashSet();
            var removedSlideIds = existingSlides.Select(slide => slide.Id).Where(id => !kept.Contains(id)).Select(id => id.ToString()).ToHashSet(StringComparer.Ordinal);
            database.WebsiteTranslations.RemoveRange(rows.Where(row =>
                plan.Remove.Contains((row.LanguageId, row.Key)) ||
                (ContentKey.TryParse(row.Key, out var entity, out var id, out _) && entity == SlideEntity && removedSlideIds.Contains(id))));
            database.WebsiteTranslations.AddRange(plan.Add);
            foreach (var change in plan.Change)
            {
                rows.Single(row => row.LanguageId == change.LanguageId && row.Key == change.Key).Change(change.Value, true, change.SourceHash, now, command.ActorStaffId);
            }

            settings.Saved(now, command.ActorStaffId, command.FontKey!, command.AutoplayEnabled, command.IntervalSeconds, title, description, primary, secondary);
            await database.SaveChangesAsync(cancellationToken);

            var saved = await TextRowsAsync(cancellationToken);
            return WebsiteMutationResult<HeroAdminDto>.Success(BuildAdmin(settings, slides, media, OrderLanguages(languages), saved));
        }, cancellationToken);
    }

    public async Task<WebsiteMutationResult<HeroMediaDto>> UploadAsync(Stream content, Guid actorStaffId, CancellationToken cancellationToken)
    {
        if (!storage.IsConfigured)
        {
            return WebsiteMutationResult<HeroMediaDto>.Conflict(
                HeroErrorCodes.StorageNotConfigured, "Picture storage is not configured on this server (WebsiteMedia:RootPath), so pictures cannot be uploaded.");
        }

        // Read at most one byte past the limit: the size is enforced on what arrives, not on what the client declared.
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await content.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > HeroLimits.MaxUploadBytes)
            {
                return WebsiteMutationResult<HeroMediaDto>.Invalid("file", "The picture is larger than 10 MB.") with { Code = HeroErrorCodes.ImageTooLarge };
            }

            buffer.Write(chunk, 0, read);
        }

        var bytes = buffer.GetBuffer().AsMemory(0, (int)buffer.Length);
        var check = HeroImageInspector.Inspect(bytes.Span);
        if (check.Info is not { } info)
        {
            return WebsiteMutationResult<HeroMediaDto>.Invalid("file", check.Message!) with { Code = check.Code };
        }

        var id = Guid.NewGuid();
        var key = $"hero/{id:N}.{info.Extension}";
        await storage.WriteAsync(key, bytes, cancellationToken);
        try
        {
            var row = new WebsiteHeroMedia(id, HeroMediaKind.Upload, key, info.ContentType, bytes.Length, info.Width, info.Height, timeProvider.GetUtcNow(), actorStaffId);
            database.WebsiteHeroMedia.Add(row);
            await database.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<HeroMediaDto>.Success(ToMediaDto(row));
        }
        catch
        {
            // The row did not commit, so nothing refers to this file: remove only this just-written file.
            await storage.DeleteAsync(key, CancellationToken.None);
            throw;
        }
    }

    public async Task<PublicHeroDto> GetPublicAsync(string? locale, CancellationToken cancellationToken)
    {
        var languages = await database.WebsiteLanguages.AsNoTracking().Where(language => language.IsActive).ToListAsync(cancellationToken);
        var defaultLanguage = languages.SingleOrDefault(language => language.IsDefault)
            ?? throw new InvalidOperationException("The website settings have no active default language.");
        var (_, resolved) = WebsitePublicReader.Resolve(languages, defaultLanguage, locale);

        var generatedAt = timeProvider.GetUtcNow();
        var settings = await database.WebsiteHero.AsNoTracking().SingleAsync(cancellationToken);
        var slides = await database.WebsiteHeroSlides.AsNoTracking().OrderBy(slide => slide.SortOrder).ToListAsync(cancellationToken);
        var media = await database.WebsiteHeroMedia.AsNoTracking().ToDictionaryAsync(item => item.Id, cancellationToken);
        var ids = new[] { defaultLanguage.Id, resolved.Id };
        var rows = (await TextRowsAsync(cancellationToken)).Where(row => ids.Contains(row.LanguageId)).ToList();

        // The visitor's language, else (for a language other than the source) the default language's text, else the source column.
        string TextOf(string key, string column)
        {
            var own = rows.FirstOrDefault(row => row.LanguageId == resolved.Id && row.Key == key)?.Value;
            if (own is not null || resolved.NormalizedCode == ContentSource.Locale)
            {
                return own ?? column;
            }

            return rows.FirstOrDefault(row => row.LanguageId == defaultLanguage.Id && row.Key == key)?.Value ?? column;
        }

        var revision = SourceText.Hash(Revision(settings.Version, rows) + "|" + resolved.Code + "|" + defaultLanguage.Code);
        return new PublicHeroDto(
            revision, resolved.Code, generatedAt, settings.FontKey, settings.AutoplayEnabled, settings.IntervalSeconds,
            TextOf(SharedKey("title"), settings.Title), TextOf(SharedKey("description"), settings.Description),
            TextOf(SharedKey("primaryAction"), settings.PrimaryActionLabel), TextOf(SharedKey("secondaryAction"), settings.SecondaryActionLabel),
            [.. slides.Select(slide =>
            {
                var picture = media[slide.MediaId];
                return new PublicHeroSlideDto(
                    slide.Id, MediaUrl(picture.Id), SeedFileOf(picture), slide.FocalPosition,
                    TextOf(SlideKey(slide.Id, "alt"), slide.Alt), TextOf(SlideKey(slide.Id, "caption"), slide.Caption));
            })]);
    }

    public async Task<HeroMediaFile?> OpenMediaAsync(Guid id, CancellationToken cancellationToken)
    {
        var row = await database.WebsiteHeroMedia.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (row is null)
        {
            return null;
        }

        var stream = await storage.OpenReadAsync(row.StorageKey, cancellationToken);
        return stream is null ? null : new HeroMediaFile(stream, row.ContentType, row.ByteSize);
    }

    // ---------------------------------------------------------------- helpers

    private static WebsiteMutationResult<HeroAdminDto> Invalid(HeroProblem problem) =>
        new(WebsiteMutationStatus.Invalid, null, problem.Code, problem.Field, problem.Message);

    private static string MediaUrl(Guid id) => $"/api/v1/website/hero/media/{id}";

    private static string? SeedFileOf(WebsiteHeroMedia media) =>
        media.Kind == HeroMediaKind.Seed ? media.StorageKey["seed/".Length..] : null;

    private static string SharedKey(string field) => ContentKey.For(Shared, SharedId, field);

    private static string SlideKey(Guid id, string field) => ContentKey.For(SlideEntity, id.ToString(), field);

    private static HeroMediaDto ToMediaDto(WebsiteHeroMedia media) =>
        new(media.Id, media.Kind, MediaUrl(media.Id), SeedFileOf(media), media.ContentType, media.ByteSize, media.Width, media.Height, media.CreatedAtUtc);

    private static IReadOnlyList<WebsiteLanguage> OrderLanguages(IEnumerable<WebsiteLanguage> languages) =>
        [.. languages.OrderBy(language => language.SortOrder).ThenBy(language => language.NormalizedCode)];

    private static string Revision(int version, IEnumerable<WebsiteTranslation> rows) =>
        SourceText.Hash(version + "|" + string.Join(',', rows
            .OrderBy(row => row.Key, StringComparer.Ordinal).ThenBy(row => row.LanguageId)
            .Select(row => $"{row.LanguageId:N}:{row.Key}:{row.Version}")));

    private async Task<List<WebsiteTranslation>> TextRowsAsync(CancellationToken cancellationToken, bool track = false)
    {
        var first = KeyPrefixes[0];
        var second = KeyPrefixes[1];
        var query = database.WebsiteTranslations.Where(row => row.Key.StartsWith(first) || row.Key.StartsWith(second));
        return await (track ? query : query.AsNoTracking()).ToListAsync(cancellationToken);
    }

    private static HeroAdminDto BuildAdmin(
        WebsiteHeroSettings settings, IReadOnlyList<WebsiteHeroSlide> slides, IReadOnlyList<WebsiteHeroMedia> media,
        IReadOnlyList<WebsiteLanguage> languages, IReadOnlyList<WebsiteTranslation> rows)
    {
        var rowOf = rows.ToDictionary(row => (row.LanguageId, row.Key));

        // The content source language's text is the column unless a stored text overrides it (as the public side reads it).
        Dictionary<string, string?> Labels(string key, string column)
        {
            var labels = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var language in languages)
            {
                var own = rowOf.GetValueOrDefault((language.Id, key))?.Value;
                labels[language.NormalizedCode] = own ?? (language.NormalizedCode == ContentSource.Locale ? column : null);
            }

            return labels;
        }

        var texts = new HeroTextsDto(
            Labels(SharedKey("title"), settings.Title), Labels(SharedKey("description"), settings.Description),
            Labels(SharedKey("primaryAction"), settings.PrimaryActionLabel), Labels(SharedKey("secondaryAction"), settings.SecondaryActionLabel));
        return new HeroAdminDto(
            Revision(settings.Version, rows),
            settings.Version,
            settings.UpdatedAtUtc,
            settings.UpdatedByStaffId,
            [.. languages.Select(language => new MenuLocaleDto(
                language.NormalizedCode, language.DisplayName, language.NativeName, language.IsDefault, language.IsActive, language.NormalizedCode == ContentSource.Locale))],
            settings.FontKey,
            settings.AutoplayEnabled,
            settings.IntervalSeconds,
            texts,
            [.. slides.OrderBy(slide => slide.SortOrder).Select(slide => new HeroSlideDto(
                slide.Id, slide.MediaId, slide.FocalPosition, Labels(SlideKey(slide.Id, "alt"), slide.Alt), Labels(SlideKey(slide.Id, "caption"), slide.Caption)))],
            [.. media.OrderByDescending(item => item.CreatedAtUtc).ThenBy(item => item.StorageKey).Select(ToMediaDto)]);
    }

    private static List<WebsiteHeroSlide> BuildSlides(IReadOnlyList<HeroSlideInput> inputs) =>
        [.. inputs.Select((input, index) => new WebsiteHeroSlide(
            input.Id, input.MediaId, index, input.FocalPosition!, LabelFor(input.Alt, ContentSource.Locale)!.Trim(), LabelFor(input.Caption, ContentSource.Locale)!.Trim()))];

    private static string? LabelFor(IReadOnlyDictionary<string, string?>? labels, string code) =>
        labels?.FirstOrDefault(pair => string.Equals(pair.Key, code, StringComparison.OrdinalIgnoreCase)).Value;

    private static bool HasChanged(IReadOnlyList<WebsiteHeroSlide> before, IReadOnlyList<WebsiteHeroSlide> after)
    {
        if (before.Count != after.Count)
        {
            return true;
        }

        var old = before.ToDictionary(slide => slide.Id);
        return after.Any(slide =>
            !old.TryGetValue(slide.Id, out var was) || was.MediaId != slide.MediaId || was.SortOrder != slide.SortOrder ||
            was.FocalPosition != slide.FocalPosition || was.Alt != slide.Alt || was.Caption != slide.Caption);
    }

    private sealed record TextPlan(
        List<WebsiteTranslation> Add,
        List<(Guid LanguageId, string Key, string Value, string? SourceHash)> Change,
        HashSet<(Guid LanguageId, string Key)> Remove);

    /// <summary>
    /// Which translation rows the save adds, changes or removes — the menu's rule: a language the editor did not send is left alone, one
    /// it sent empty loses its row, the content source language never keeps a row (its text is the column), and a row is written as
    /// hand-edited and stamped with the default language's text it was written against.
    /// </summary>
    private static TextPlan PlanTexts(
        SaveHeroCommand command, IReadOnlyList<WebsiteLanguage> languages, WebsiteLanguage defaultLanguage, IReadOnlyList<WebsiteTranslation> rows, DateTimeOffset now)
    {
        var rowOf = rows.ToDictionary(row => (row.LanguageId, row.Key));
        var plan = new TextPlan([], [], []);
        var texts = command.Texts!;
        var shared = new[] { texts.Title, texts.Description, texts.PrimaryAction, texts.SecondaryAction };
        for (var index = 0; index < SharedFields.Length; index++)
        {
            Plan(SharedKey(SharedFields[index]), shared[index]);
        }

        foreach (var slide in command.Slides)
        {
            Plan(SlideKey(slide.Id, "alt"), slide.Alt);
            Plan(SlideKey(slide.Id, "caption"), slide.Caption);
        }

        return plan;

        void Plan(string key, IReadOnlyDictionary<string, string?>? labels)
        {
            labels ??= new Dictionary<string, string?>();
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
                    plan.Add.Add(new WebsiteTranslation(language.Id, key, text, true, hash, now, command.ActorStaffId));
                }
                else if (row.Value != text)
                {
                    plan.Change.Add((language.Id, key, text, hash));
                }
            }
        }
    }
}
