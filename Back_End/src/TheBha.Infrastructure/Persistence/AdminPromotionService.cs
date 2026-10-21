using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Promotions;
using TheBha.Application.Website;
using TheBha.Domain.Promotions;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-BOOKING-PROMOTIONS-001: the Admin side of a promotion. Every write is one transaction that also appends the audit row;
/// a save carries the version it was made from (a stale one is refused, nothing is overwritten); a create carries an operation id so
/// a lost answer can be retried without a duplicate. The authorization (a Manager of this Property) is decided before this runs.
/// </summary>
internal sealed class AdminPromotionService(TheBhaDbContext db, IHeroMediaStorage storage, TimeProvider clock) : IAdminPromotions
{
    private const string KeyPrefix = "promotion";
    private static readonly string[] SingleFields = ["title", "summary", "altText"];
    private static readonly JsonSerializerOptions AuditJson = new() { Converters = { new JsonStringEnumConverter() } };

    public async Task<IReadOnlyList<PromotionSummaryDto>?> ListAsync(Guid propertyId, PromotionListQuery query, CancellationToken cancellationToken)
    {
        var today = await LocalTodayAsync(propertyId, cancellationToken);
        if (today is null) return null;

        var q = db.Promotions.AsNoTracking().Include(x => x.RoomTypes).Where(x => x.PropertyId == propertyId);
        if (query.Status is { } status) q = q.Where(x => x.Status == status);
        if (query.ShowOnHomepage is { } show) q = q.Where(x => x.ShowOnHomepage == show);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim().ToLowerInvariant();
            q = q.Where(x => x.Title.ToLower().Contains(term) || x.Slug.Contains(term));
        }

        var rows = await q.OrderBy(x => x.SortOrder).ThenByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id).Take(500).ToListAsync(cancellationToken);
        var summaries = rows.Select(x => ToSummary(x, x.IsPublicOn(today.Value)));
        if (query.PublicNow is { } publicNow) summaries = summaries.Where(x => x.PublicNow == publicNow);
        return summaries.ToList();
    }

    public async Task<WebsiteMutationResult<PromotionEditorDto>> GetAsync(Guid propertyId, Guid promotionId, CancellationToken cancellationToken)
    {
        var promotion = await LoadAsync(propertyId, promotionId, tracked: false, cancellationToken);
        return promotion is null
            ? WebsiteMutationResult<PromotionEditorDto>.NotFound("The promotion does not exist in this property.")
            : WebsiteMutationResult<PromotionEditorDto>.Success(await ToEditorAsync(promotion, cancellationToken));
    }

    public async Task<IReadOnlyList<PromotionRoomTypeChoice>?> RoomTypesAsync(Guid propertyId, CancellationToken cancellationToken)
    {
        if (!await db.Properties.AsNoTracking().AnyAsync(x => x.Id == propertyId, cancellationToken)) return null;
        return await db.RoomTypes.AsNoTracking().Where(x => x.PropertyId == propertyId).OrderBy(x => x.Code)
            .Select(x => new PromotionRoomTypeChoice(x.Id, x.Code, x.Name, x.IsActive)).ToListAsync(cancellationToken);
    }

    public async Task<WebsiteMutationResult<PromotionEditorDto>> CreateAsync(
        Guid propertyId, PromotionInput input, Guid operationId, Guid actorStaffId, CancellationToken cancellationToken)
    {
        var fingerprint = Fingerprint(propertyId, input);
        var prior = await db.Promotions.AsNoTracking().Include(x => x.RoomTypes)
            .SingleOrDefaultAsync(x => x.CreatedByStaffId == actorStaffId && x.CreateOperationId == operationId, cancellationToken);
        if (prior is not null) return await ReplayAsync(prior, fingerprint, propertyId, cancellationToken);

        var checkedInput = await CheckAsync(propertyId, input, null, cancellationToken);
        if (checkedInput is not null) return checkedInput;

        var now = clock.GetUtcNow();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var promotion = new Promotion(Guid.NewGuid(), propertyId, input.Details, actorStaffId, operationId, fingerprint, now);
            db.Promotions.Add(promotion);
            db.PromotionAudits.Add(new PromotionAudit(promotion.Id, propertyId, actorStaffId, now, "create", null, Snapshot(promotion)));
            var translated = await ApplyTranslationsAsync(promotion.Id, input.Translations, actorStaffId, now, cancellationToken);
            if (translated is not null) return translated;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return WebsiteMutationResult<PromotionEditorDto>.Success(await ToEditorAsync(promotion, cancellationToken));
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } unique)
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            if (unique.ConstraintName == "UX_Promotions_Slug")
            {
                return WebsiteMutationResult<PromotionEditorDto>.Conflict(PromotionErrorCodes.SlugTaken, "Another promotion already uses this slug.", "slug");
            }

            // Two requests with the same operation id raced: the one that lost is a replay of the one that won.
            var winner = await db.Promotions.AsNoTracking().Include(x => x.RoomTypes)
                .SingleOrDefaultAsync(x => x.CreatedByStaffId == actorStaffId && x.CreateOperationId == operationId, cancellationToken);
            return winner is null ? throw exception : await ReplayAsync(winner, fingerprint, propertyId, cancellationToken);
        }
    }

    public async Task<WebsiteMutationResult<PromotionEditorDto>> SaveAsync(
        Guid propertyId, Guid promotionId, int expectedVersion, PromotionInput input, Guid actorStaffId, CancellationToken cancellationToken)
    {
        var promotion = await LoadAsync(propertyId, promotionId, tracked: true, cancellationToken);
        if (promotion is null) return WebsiteMutationResult<PromotionEditorDto>.NotFound("The promotion does not exist in this property.");
        if (promotion.Version != expectedVersion) return Stale();

        var checkedInput = await CheckAsync(propertyId, input, promotion, cancellationToken);
        if (checkedInput is not null) return checkedInput;

        var now = clock.GetUtcNow();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var before = Snapshot(promotion);
            db.Entry(promotion).Property(x => x.Version).OriginalValue = expectedVersion;
            promotion.Edit(input.Details, actorStaffId, now);
            db.PromotionAudits.Add(new PromotionAudit(promotion.Id, propertyId, actorStaffId, now, "save", before, Snapshot(promotion)));
            var translated = await ApplyTranslationsAsync(promotion.Id, input.Translations, actorStaffId, now, cancellationToken);
            if (translated is not null) return translated;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return WebsiteMutationResult<PromotionEditorDto>.Success(await ToEditorAsync(promotion, cancellationToken));
        }
        catch (DbUpdateConcurrencyException)
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            return Stale();
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { ConstraintName: "UX_Promotions_Slug" })
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            return WebsiteMutationResult<PromotionEditorDto>.Conflict(PromotionErrorCodes.SlugTaken, "Another promotion already uses this slug.", "slug");
        }
    }

    public async Task<WebsiteMutationResult<PromotionEditorDto>> SetStatusAsync(
        Guid propertyId, Guid promotionId, int expectedVersion, PromotionStatus status, Guid actorStaffId, CancellationToken cancellationToken)
    {
        var promotion = await LoadAsync(propertyId, promotionId, tracked: true, cancellationToken);
        if (promotion is null) return WebsiteMutationResult<PromotionEditorDto>.NotFound("The promotion does not exist in this property.");
        if (promotion.Version != expectedVersion) return Stale();

        var now = clock.GetUtcNow();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var before = Snapshot(promotion);
            db.Entry(promotion).Property(x => x.Version).OriginalValue = expectedVersion;
            try
            {
                promotion.SetStatus(status, actorStaffId, now);
            }
            catch (TheBha.Domain.Common.DomainException exception)
            {
                return WebsiteMutationResult<PromotionEditorDto>.Invalid("status", exception.Message);
            }

            db.PromotionAudits.Add(new PromotionAudit(promotion.Id, propertyId, actorStaffId, now, "status", before, Snapshot(promotion)));
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return WebsiteMutationResult<PromotionEditorDto>.Success(await ToEditorAsync(promotion, cancellationToken));
        }
        catch (DbUpdateConcurrencyException)
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            return Stale();
        }
    }

    public async Task<WebsiteMutationResult<PromotionMediaDto>> UploadMediaAsync(Guid propertyId, Stream content, Guid actorStaffId, CancellationToken cancellationToken)
    {
        if (!storage.IsConfigured)
        {
            return WebsiteMutationResult<PromotionMediaDto>.Conflict(
                PromotionErrorCodes.StorageNotConfigured, "Picture storage is not configured on this server (WebsiteMedia:RootPath), so pictures cannot be uploaded.");
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await content.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > HeroLimits.MaxUploadBytes)
            {
                return WebsiteMutationResult<PromotionMediaDto>.Invalid("file", "The picture is larger than 10 MB.") with { Code = HeroErrorCodes.ImageTooLarge };
            }

            buffer.Write(chunk, 0, read);
        }

        var bytes = buffer.GetBuffer().AsMemory(0, (int)buffer.Length);
        var check = HeroImageInspector.Inspect(bytes.Span);
        if (check.Info is not { } info)
        {
            return WebsiteMutationResult<PromotionMediaDto>.Invalid("file", check.Message!) with { Code = check.Code };
        }

        if (info.Width < PromotionLimits.CoverMinWidth || info.Height < PromotionLimits.CoverMinHeight)
        {
            return WebsiteMutationResult<PromotionMediaDto>.Invalid(
                "file", $"The picture is {info.Width}×{info.Height}; a promotion cover is at least {PromotionLimits.CoverMinWidth}×{PromotionLimits.CoverMinHeight}.")
                with { Code = PromotionErrorCodes.ImageTooSmall };
        }

        var id = Guid.NewGuid();
        var key = $"promo/{id:N}.{info.Extension}";
        await storage.WriteAsync(key, bytes, cancellationToken);
        try
        {
            var row = new PromotionMedia(id, propertyId, key, info.ContentType, bytes.Length, info.Width, info.Height, clock.GetUtcNow(), actorStaffId);
            db.PromotionMedia.Add(row);
            await db.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<PromotionMediaDto>.Success(new PromotionMediaDto(row.Id, row.ContentType, row.Width, row.Height));
        }
        catch
        {
            await storage.DeleteAsync(key, CancellationToken.None);
            throw;
        }
    }

    public async Task<PromotionMediaFile?> OpenMediaAsync(Guid propertyId, Guid mediaId, CancellationToken cancellationToken)
    {
        var row = await db.PromotionMedia.AsNoTracking().SingleOrDefaultAsync(x => x.Id == mediaId && x.PropertyId == propertyId, cancellationToken);
        if (row is null) return null;
        var stream = await storage.OpenReadAsync(row.StorageKey, cancellationToken);
        return stream is null ? null : new PromotionMediaFile(stream, row.ContentType);
    }

    // ---- validation shared by create and save ----

    private async Task<WebsiteMutationResult<PromotionEditorDto>?> CheckAsync(
        Guid propertyId, PromotionInput input, Promotion? existing, CancellationToken cancellationToken)
    {
        var details = input.Details;
        if (PromotionRules.Validate(details) is { } error) return WebsiteMutationResult<PromotionEditorDto>.Invalid(error.Field, error.Message);

        var today = await LocalTodayAsync(propertyId, cancellationToken);
        if (today is null) return WebsiteMutationResult<PromotionEditorDto>.NotFound("The property does not exist.");

        if (!details.AllRoomTypes)
        {
            var found = await db.RoomTypes.AsNoTracking().CountAsync(x => x.PropertyId == propertyId && details.RoomTypeIds.Contains(x.Id), cancellationToken);
            if (found != details.RoomTypeIds.Count)
            {
                return WebsiteMutationResult<PromotionEditorDto>.Invalid("roomTypeIds", "Every room type must belong to this property.");
            }
        }

        if (details.CoverMediaId is { } coverId &&
            !await db.PromotionMedia.AsNoTracking().AnyAsync(x => x.Id == coverId && x.PropertyId == propertyId, cancellationToken))
        {
            return WebsiteMutationResult<PromotionEditorDto>.Conflict(PromotionErrorCodes.MediaMissing, "The cover picture is not available for this property. Upload it again.", "coverMediaId");
        }

        if (existing is null || details.Slug != existing.Slug)
        {
            if (await db.Promotions.AsNoTracking().AnyAsync(x => x.Slug == details.Slug && (existing == null || x.Id != existing.Id), cancellationToken))
            {
                return WebsiteMutationResult<PromotionEditorDto>.Conflict(PromotionErrorCodes.SlugTaken, "Another promotion already uses this slug.", "slug");
            }
        }

        return await CheckAgainstRatesAsync(propertyId, details, today.Value, cancellationToken);
    }

    /// <summary>
    /// A discount must never take a night below the smallest valid price. Pricing refuses such a quote at run time; this tells the
    /// Admin at save time, against the rates that exist now in the promotion's scope, instead of letting it fail silently later.
    /// </summary>
    private async Task<WebsiteMutationResult<PromotionEditorDto>?> CheckAgainstRatesAsync(
        Guid propertyId, PromotionDetails details, DateOnly today, CancellationToken cancellationToken)
    {
        var from = details.StayFrom is { } stayFrom && stayFrom > today ? stayFrom : today;
        var plans = await db.RatePlans.AsNoTracking().Where(x => x.PropertyId == propertyId && x.IsActive)
            .Select(x => new { x.Id, x.CurrencyCode }).ToListAsync(cancellationToken);
        var rates = db.DailyRoomRates.AsNoTracking().Where(x => x.PropertyId == propertyId && x.StayDate >= from);
        if (details.StayTo is { } stayTo) rates = rates.Where(x => x.StayDate <= stayTo);
        if (!details.AllRoomTypes) rates = rates.Where(x => details.RoomTypeIds.Contains(x.RoomTypeId));
        var lowest = await rates.GroupBy(x => x.RatePlanId).Select(g => new { PlanId = g.Key, Amount = g.Min(x => x.Amount) }).ToListAsync(cancellationToken);
        foreach (var rate in lowest)
        {
            var currency = plans.SingleOrDefault(x => x.Id == rate.PlanId)?.CurrencyCode;
            if (currency is null) continue;
            if (details.Kind == PromotionDiscountKind.FixedAmount && currency != details.CurrencyCode) continue;
            var discount = details.Kind == PromotionDiscountKind.Percent
                ? PromotionMoney.Round(rate.Amount * details.Value / 100m, currency)
                : details.Value;
            if (rate.Amount - discount < PromotionMoney.MinimumUnit(currency))
            {
                return WebsiteMutationResult<PromotionEditorDto>.Invalid(
                    "value",
                    $"The lowest {currency} rate in this promotion's scope is {rate.Amount:0.##}; a discount of {discount:0.##} would leave less than the smallest valid price.");
            }
        }

        return null;
    }

    // ---- translations ----

    private async Task<WebsiteMutationResult<PromotionEditorDto>?> ApplyTranslationsAsync(
        Guid promotionId, IReadOnlyDictionary<string, PromotionTextsDto>? translations, Guid actorStaffId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (translations is null || translations.Count == 0) return null;
        var languages = await db.WebsiteLanguages.AsNoTracking().Where(x => x.IsActive).ToListAsync(cancellationToken);
        var prefix = ContentKey.For(KeyPrefix, promotionId.ToString("D"), string.Empty);
        var rows = await db.WebsiteTranslations.Where(x => x.Key.StartsWith(prefix)).ToListAsync(cancellationToken);

        foreach (var (code, texts) in translations)
        {
            var language = languages.SingleOrDefault(x => string.Equals(x.NormalizedCode, code.Trim(), StringComparison.OrdinalIgnoreCase));
            if (language is null || language.NormalizedCode == ContentSource.Locale)
            {
                return WebsiteMutationResult<PromotionEditorDto>.Invalid("translations", $"'{code}' is not an active language other than {ContentSource.Locale}.");
            }

            var wanted = new Dictionary<string, string?>
            {
                ["title"] = Clean(texts.Title),
                ["summary"] = Clean(texts.Summary),
                ["altText"] = Clean(texts.CoverAltText)
            };
            for (var i = 0; i < PromotionLimits.BodyParagraphs; i++)
            {
                wanted[$"body{i + 1}"] = Clean(texts.Body is not null && i < texts.Body.Count ? texts.Body[i] : null);
            }

            if (texts.Body is { Count: > PromotionLimits.BodyParagraphs })
            {
                return WebsiteMutationResult<PromotionEditorDto>.Invalid("translations", $"The details have at most {PromotionLimits.BodyParagraphs} paragraphs.");
            }

            foreach (var (field, text) in wanted)
            {
                var key = ContentKey.For(KeyPrefix, promotionId.ToString("D"), field);
                var row = rows.SingleOrDefault(x => x.LanguageId == language.Id && x.Key == key);
                if (text is null)
                {
                    if (row is not null) db.WebsiteTranslations.Remove(row);
                    continue;
                }

                var max = field switch { "title" => PromotionLimits.Title, "summary" => PromotionLimits.Summary, "altText" => PromotionLimits.AltText, _ => PromotionLimits.BodyParagraphLength };
                if (PromotionRules.Text(text, max) is { } problem)
                {
                    return WebsiteMutationResult<PromotionEditorDto>.Invalid($"translations.{language.NormalizedCode}.{field}", problem);
                }

                if (row is null) db.WebsiteTranslations.Add(new WebsiteTranslation(language.Id, key, text, true, null, now, actorStaffId));
                else if (row.Value != text) row.Change(text, true, null, now, actorStaffId);
            }
        }

        return null;

        static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    // ---- projection ----

    private async Task<PromotionEditorDto> ToEditorAsync(Promotion p, CancellationToken cancellationToken)
    {
        var today = await LocalTodayAsync(p.PropertyId, cancellationToken) ?? DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var languages = await db.WebsiteLanguages.AsNoTracking().Where(x => x.IsActive).OrderBy(x => x.SortOrder).ThenBy(x => x.Code).ToListAsync(cancellationToken);
        var prefix = ContentKey.For(KeyPrefix, p.Id.ToString("D"), string.Empty);
        var rows = await db.WebsiteTranslations.AsNoTracking().Where(x => x.Key.StartsWith(prefix)).ToListAsync(cancellationToken);
        var translations = new Dictionary<string, PromotionTextsDto>();
        foreach (var language in languages.Where(x => x.NormalizedCode != ContentSource.Locale))
        {
            string? Of(string field) => rows.SingleOrDefault(x => x.LanguageId == language.Id && x.Key == ContentKey.For(KeyPrefix, p.Id.ToString("D"), field))?.Value;
            var body = Enumerable.Range(1, PromotionLimits.BodyParagraphs).Select(i => Of($"body{i}")).TakeWhile(x => x is not null).Select(x => x!).ToList();
            translations[language.NormalizedCode] = new PromotionTextsDto(Of("title"), Of("summary"), Of("altText"), body);
        }

        return new PromotionEditorDto(
            p.Id, p.PropertyId, p.Slug, p.Status.ToString(), p.Kind.ToString(), p.Value, p.CurrencyCode, p.AllRoomTypes,
            p.RoomTypes.Select(x => x.RoomTypeId).OrderBy(x => x).ToList(), p.BookingFrom, p.BookingTo, p.StayFrom, p.StayTo, p.MinNights,
            p.Title, p.Summary, p.BodyParagraphs, p.CoverMediaId, p.CoverAltText, p.ShowOnHomepage, p.SortOrder, p.DisplayFrom, p.DisplayTo,
            p.IsPublicOn(today), translations,
            languages.Select(x => new PromotionLanguageChoice(x.NormalizedCode, x.DisplayName, x.NormalizedCode == ContentSource.Locale)).ToList(),
            p.Version, p.CreatedAtUtc, p.UpdatedAtUtc, p.UpdatedByStaffId);
    }

    private static PromotionSummaryDto ToSummary(Promotion p, bool publicNow) => new(
        p.Id, p.PropertyId, p.Slug, p.Title, p.Summary, p.Status.ToString(), p.Kind.ToString(), p.Value, p.CurrencyCode, p.AllRoomTypes,
        p.RoomTypes.Count, p.ShowOnHomepage, p.SortOrder, p.BookingFrom, p.BookingTo, p.StayFrom, p.StayTo, p.DisplayFrom, p.DisplayTo,
        p.MinNights, publicNow, p.CoverMediaId, p.Version, p.UpdatedAtUtc);

    // ---- helpers ----

    private Task<Promotion?> LoadAsync(Guid propertyId, Guid promotionId, bool tracked, CancellationToken cancellationToken)
    {
        var q = db.Promotions.Include(x => x.RoomTypes).Where(x => x.PropertyId == propertyId && x.Id == promotionId);
        return (tracked ? q : q.AsNoTracking()).SingleOrDefaultAsync(cancellationToken);
    }

    private async Task<DateOnly?> LocalTodayAsync(Guid propertyId, CancellationToken cancellationToken)
    {
        var timeZone = await db.Properties.AsNoTracking().Where(x => x.Id == propertyId).Select(x => x.TimeZone).SingleOrDefaultAsync(cancellationToken);
        return timeZone is null
            ? null
            : DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
    }

    private async Task<WebsiteMutationResult<PromotionEditorDto>> ReplayAsync(Promotion prior, string fingerprint, Guid propertyId, CancellationToken cancellationToken)
    {
        if (prior.PropertyId != propertyId || prior.CreateFingerprint != fingerprint)
        {
            return WebsiteMutationResult<PromotionEditorDto>.Conflict(
                PromotionErrorCodes.IdempotencyKeyReused, "This operation id was already used for a different promotion.");
        }

        return WebsiteMutationResult<PromotionEditorDto>.Success(await ToEditorAsync(prior, cancellationToken));
    }

    private static WebsiteMutationResult<PromotionEditorDto> Stale() =>
        WebsiteMutationResult<PromotionEditorDto>.Conflict(WebsiteErrorCodes.StaleVersion, "This promotion changed in another tab or by someone else. Read the server version before saving again.");

    private static string Snapshot(Promotion p) => JsonSerializer.Serialize(new { p.Status, p.Version, Details = p.ToDetails() }, AuditJson);

    private static string Fingerprint(Guid propertyId, PromotionInput input)
    {
        var json = JsonSerializer.Serialize(new { propertyId, input.Details, Translations = input.Translations?.OrderBy(x => x.Key, StringComparer.Ordinal).ToList() }, AuditJson);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    }
}
