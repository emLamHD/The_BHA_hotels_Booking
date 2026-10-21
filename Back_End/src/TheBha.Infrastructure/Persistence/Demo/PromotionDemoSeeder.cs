using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Promotions;

namespace TheBha.Infrastructure.Persistence.Demo;

public sealed record PromotionSeedLine(string Slug, string Action, string Detail);

public sealed record PromotionSeedResult(Guid PropertyId, IReadOnlyList<PromotionSeedLine> Lines, IReadOnlyList<string> Conflicts, bool Applied)
{
    public int Inserted => Lines.Count(line => line.Action == "insert");
}

/// <summary>
/// BHA-BOOKING-PROMOTIONS-001: demo promotions for the Riverside Property and its three real room types (<c>RIV-1BR</c>, <c>RIV-1BR-OPEN</c>,
/// <c>RIV-2BR</c>). Idempotent by slug: a promotion that already exists is never touched (an Admin may have edited it), so a re-run adds nothing.
/// Covers are copied from a directory the operator names, through the same picture storage the Admin uses. This class does not decide which
/// database it may touch; <c>PromotionDemoSeedCommand</c> does, before it is called.
/// </summary>
public sealed class PromotionDemoSeeder(TheBhaDbContext db, IHeroMediaStorage storage, TimeProvider clock)
{
    /// <summary>The actor recorded on demo rows: an id that belongs to no Staff account.</summary>
    public static readonly Guid DemoActor = Guid.Parse("00000000-0000-0000-0000-00000000d3e0");

    private sealed record Demo(string Slug, string Title, string Summary, string[] Body, string? CoverFile, string CoverAlt, PromotionDiscountKind Kind, decimal Value,
        string[] RoomCodes, int MinNights, bool Show, int Sort, bool Active);

    private static readonly Demo[] Demos =
    [
        new("dat-som-giam-15", "Đặt sớm giảm 15%", "Giảm 15% mỗi đêm cho kỳ nghỉ từ 2 đêm tại The BHA Riverside.",
            ["Áp dụng cho mọi loại căn hộ của The BHA Riverside.", "Booking cần tối thiểu 2 đêm. Mức giảm tính trên tiền phòng mỗi đêm."],
            "one-bedroom-living.webp", "Phòng khách căn hộ một phòng ngủ", PromotionDiscountKind.Percent, 15m, [], 2, true, 10, true),
        new("o-dai-giam-200k", "Ở dài giảm 200.000 ₫ mỗi đêm", "Giảm 200.000 ₫ mỗi phòng mỗi đêm khi ở từ 3 đêm.",
            ["Áp dụng cho căn hộ một phòng ngủ view thoáng và căn hộ hai phòng ngủ.", "Booking cần tối thiểu 3 đêm."],
            "open-view-living.webp", "Phòng khách căn hộ view thoáng", PromotionDiscountKind.FixedAmount, 200000m, ["RIV-1BR-OPEN", "RIV-2BR"], 3, true, 20, true),
        new("gia-dinh-giam-10", "Căn hộ hai phòng ngủ giảm 10%", "Giảm 10% cho căn hộ hai phòng ngủ. Đang ẩn khỏi trang chủ nhưng vẫn tính giá.",
            ["Ưu đãi này được đặt ẩn khỏi trang chủ: nó vẫn áp dụng khi tìm phòng."],
            "two-bedroom-bedroom-1.webp", "Phòng ngủ căn hộ hai phòng ngủ", PromotionDiscountKind.Percent, 10m, ["RIV-2BR"], 1, false, 30, true),
        new("ban-nhap-chua-mo", "Ưu đãi nháp chưa mở", "Bản nháp: chưa bật nên không hiện công khai và không tính giá.",
            ["Bản nháp dùng để kiểm tra rằng dữ liệu nháp không lộ ra website."],
            null, "", PromotionDiscountKind.Percent, 5m, [], 1, false, 40, false)
    ];

    public Task<PromotionSeedResult> PlanAsync(Guid? propertyId, string? coverDirectory, CancellationToken cancellationToken) => RunAsync(propertyId, coverDirectory, false, cancellationToken);

    public Task<PromotionSeedResult> ApplyAsync(Guid? propertyId, string? coverDirectory, CancellationToken cancellationToken) => RunAsync(propertyId, coverDirectory, true, cancellationToken);

    private async Task<PromotionSeedResult> RunAsync(Guid? targetPropertyId, string? coverDirectory, bool apply, CancellationToken cancellationToken)
    {
        var property = await db.Properties.AsNoTracking()
            .Where(x => targetPropertyId != null ? x.Id == targetPropertyId : x.Slug == "the-bha-riverside" || x.Slug == "the-bha-hotel")
            .Select(x => new { x.Id, x.Name }).FirstOrDefaultAsync(cancellationToken);
        var lines = new List<PromotionSeedLine>();
        var conflicts = new List<string>();
        if (property is null)
        {
            conflicts.Add("the Riverside property does not exist; run --seed-riverside-demo first.");
            return new PromotionSeedResult(targetPropertyId ?? Guid.Empty, lines, conflicts, false);
        }

        var rooms = await db.RoomTypes.AsNoTracking().Where(x => x.PropertyId == property.Id && x.IsActive).ToDictionaryAsync(x => x.Code, x => x.Id, cancellationToken);
        foreach (var code in new[] { "RIV-1BR", "RIV-1BR-OPEN", "RIV-2BR" })
        {
            if (!rooms.ContainsKey(code)) conflicts.Add($"room type {code} is missing in {property.Name}; the demo promotions need the three real Riverside room types.");
        }

        if (coverDirectory is not null && !Directory.Exists(coverDirectory)) conflicts.Add("--cover-dir does not exist.");
        if (conflicts.Count > 0) return new PromotionSeedResult(property.Id, lines, conflicts, false);

        var existing = (await db.Promotions.AsNoTracking().Select(x => x.Slug).ToListAsync(cancellationToken)).ToHashSet(StringComparer.Ordinal);
        var now = clock.GetUtcNow();
        await using var transaction = apply ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        foreach (var demo in Demos)
        {
            if (existing.Contains(demo.Slug))
            {
                lines.Add(new PromotionSeedLine(demo.Slug, "exists", "left as it is"));
                continue;
            }

            string? coverPath = null;
            if (demo.CoverFile is not null && coverDirectory is not null)
            {
                coverPath = Path.Combine(coverDirectory, demo.CoverFile);
                if (!File.Exists(coverPath)) { conflicts.Add($"cover {demo.CoverFile} is not in --cover-dir."); continue; }
            }

            lines.Add(new PromotionSeedLine(demo.Slug, "insert", $"{(demo.Active ? "Active" : "Draft")}, {(demo.Show && coverPath is not null ? "on the homepage" : "not on the homepage")}{(coverPath is null ? ", no cover" : ", with cover")}"));
            if (!apply) continue;

            Guid? mediaId = null;
            if (coverPath is not null)
            {
                var bytes = await File.ReadAllBytesAsync(coverPath, cancellationToken);
                var check = HeroImageInspector.Inspect(bytes);
                if (check.Info is not { } info || info.Width < PromotionLimits.CoverMinWidth || info.Height < PromotionLimits.CoverMinHeight)
                {
                    conflicts.Add($"cover {demo.CoverFile} is not a usable picture (at least {PromotionLimits.CoverMinWidth}×{PromotionLimits.CoverMinHeight}).");
                    continue;
                }

                if (!storage.IsConfigured) { conflicts.Add("picture storage is not configured (WebsiteMedia:RootPath)."); continue; }
                mediaId = Guid.NewGuid();
                var key = $"promo/{mediaId:N}.{info.Extension}";
                await storage.WriteAsync(key, bytes, cancellationToken);
                db.PromotionMedia.Add(new PromotionMedia(mediaId.Value, property.Id, key, info.ContentType, bytes.Length, info.Width, info.Height, now, DemoActor));
            }

            var allRooms = demo.RoomCodes.Length == 0;
            var details = new PromotionDetails(
                demo.Slug, demo.Title, demo.Summary, demo.Body, mediaId, mediaId is null ? null : demo.CoverAlt, demo.Kind, demo.Value,
                demo.Kind == PromotionDiscountKind.FixedAmount ? "VND" : null, allRooms, allRooms ? [] : demo.RoomCodes.Select(code => rooms[code]).ToList(),
                null, null, null, null, demo.MinNights, demo.Show && mediaId is not null, demo.Sort, null, null);
            var promotion = new Promotion(Guid.NewGuid(), property.Id, details, DemoActor, Guid.NewGuid(), new string('d', 64), now);
            if (demo.Active) promotion.SetStatus(PromotionStatus.Active, DemoActor, now);
            db.Promotions.Add(promotion);
            db.PromotionAudits.Add(new PromotionAudit(promotion.Id, property.Id, DemoActor, now, "create", null, "{\"seed\":\"promotion-demo\"}"));
            await db.SaveChangesAsync(cancellationToken);
        }

        if (apply)
        {
            if (conflicts.Count > 0)
            {
                await transaction!.RollbackAsync(cancellationToken);
                return new PromotionSeedResult(property.Id, lines, conflicts, false);
            }

            await transaction!.CommitAsync(cancellationToken);
        }

        return new PromotionSeedResult(property.Id, lines, conflicts, apply);
    }
}
