using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Website;
using TheBha.Domain.Promotions;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BOOKING-PROMOTIONS-001 D11: the public promotions are exactly the ones Active, placed on the homepage, inside their display window and
/// with their booking window not over — the same rule for the list, the detail and the picture, never a draft, and never kept by a cache.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class PublicPromotionsApiTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset FixedUtc = DateTimeOffset.Parse("2026-07-22T18:30:00Z");   // 01:30 on 2026-07-23 in Asia/Ho_Chi_Minh
    private static readonly DateOnly LocalToday = new(2026, 7, 23);
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid DeluxeRoomTypeId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid Staff = Guid.Parse("90000000-0000-0000-0000-0000000000a1");
    private const string Base = "/api/v1/website/promotions";

    private sealed record Seeded(Promotion Promotion, Guid? MediaId);

    private async Task ResetAsync()
    {
        factory.Clock.UtcNow = FixedUtc;
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        await new DevelopmentDataSeeder(context, new FixedClock(FixedUtc)).SeedAsync(CancellationToken.None);
    }

    private async Task<Seeded> AddAsync(
        string slug,
        PromotionStatus status = PromotionStatus.Active,
        bool show = true,
        DateOnly? displayFrom = null,
        DateOnly? displayTo = null,
        DateOnly? bookingTo = null,
        int sortOrder = 0,
        bool withCover = true,
        bool allRoomTypes = true)
    {
        Guid? mediaId = null;
        if (withCover)
        {
            mediaId = Guid.NewGuid();
            var key = $"promo/{mediaId:N}.png";
            await factory.Services.GetRequiredService<IHeroMediaStorage>()
                .WriteAsync(key, File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "promotion", "cover.png")), CancellationToken.None);
            await using var media = factory.CreateDbContext();
            media.PromotionMedia.Add(new PromotionMedia(mediaId.Value, PropertyId, key, "image/png", 2315, 800, 600, FixedUtc, Staff));
            await media.SaveChangesAsync();
        }

        var details = new PromotionDetails(
            slug, "Ưu đãi " + slug, "Tóm tắt " + slug, ["Đoạn một.", "Đoạn hai."], mediaId, mediaId is null ? null : "Ảnh " + slug, PromotionDiscountKind.Percent, 12.5m, null,
            allRoomTypes, allRoomTypes ? [] : [DeluxeRoomTypeId], null, bookingTo, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), 2, show && withCover, sortOrder, displayFrom, displayTo);
        var promotion = new Promotion(Guid.NewGuid(), PropertyId, details with { ShowOnHomepage = show && withCover }, Staff, Guid.NewGuid(), new string('b', 64), FixedUtc);
        if (status != PromotionStatus.Draft) promotion.SetStatus(PromotionStatus.Active, Staff, FixedUtc);
        if (status == PromotionStatus.Disabled) promotion.SetStatus(PromotionStatus.Disabled, Staff, FixedUtc);
        await using var context = factory.CreateDbContext();
        context.Promotions.Add(promotion);
        await context.SaveChangesAsync();
        return new Seeded(promotion, mediaId);
    }

    private static async Task<JsonElement> ListAsync(HttpClient client, string locale = "vi") =>
        await client.GetFromJsonAsync<JsonElement>($"{Base}?locale={locale}");

    private static string[] Slugs(JsonElement list) => list.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("slug").GetString()!).ToArray();

    [Fact]
    public async Task Only_promotions_that_are_public_today_are_listed_in_order_and_everything_else_is_a_plain_404()
    {
        await ResetAsync();
        await AddAsync("hien-thi-2", sortOrder: 20);
        await AddAsync("hien-thi-1", sortOrder: 10);
        var hiddenSlugs = new[]
        {
            (await AddAsync("nhap", PromotionStatus.Draft)).Promotion.Slug,
            (await AddAsync("da-tat", PromotionStatus.Disabled)).Promotion.Slug,
            (await AddAsync("an-the", show: false)).Promotion.Slug,
            (await AddAsync("chua-den-han", displayFrom: LocalToday.AddDays(1))).Promotion.Slug,
            (await AddAsync("het-han-hien-thi", displayTo: LocalToday.AddDays(-1))).Promotion.Slug,
            (await AddAsync("het-han-dat", bookingTo: LocalToday.AddDays(-1))).Promotion.Slug
        };
        using var client = factory.CreateClient();

        var list = await ListAsync(client);

        Assert.Equal(["hien-thi-1", "hien-thi-2"], Slugs(list));
        foreach (var slug in hiddenSlugs)
        {
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Base}/{slug}")).StatusCode);
        }

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"{Base}/hien-thi-1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Base}/khong-co-that")).StatusCode);
    }

    [Fact]
    public async Task The_window_ends_are_inclusive_in_the_property_local_date()
    {
        await ResetAsync();
        await AddAsync("hom-nay-bat-dau", displayFrom: LocalToday);
        await AddAsync("hom-nay-ket-thuc", displayTo: LocalToday);
        await AddAsync("dat-den-hom-nay", bookingTo: LocalToday);
        using var client = factory.CreateClient();

        Assert.Equal(["dat-den-hom-nay", "hom-nay-bat-dau", "hom-nay-ket-thuc"], Slugs(await ListAsync(client)).Order().ToArray());
    }

    [Fact]
    public async Task Nothing_administrative_or_draft_leaves_the_public_api()
    {
        await ResetAsync();
        var seeded = await AddAsync("cong-khai");
        await AddAsync("ban-nhap-bi-mat", PromotionStatus.Draft);
        using var client = factory.CreateClient();

        var listText = await (await client.GetAsync(Base)).Content.ReadAsStringAsync();
        var detailText = await (await client.GetAsync($"{Base}/cong-khai")).Content.ReadAsStringAsync();

        foreach (var text in new[] { listText, detailText })
        {
            Assert.DoesNotContain("ban-nhap-bi-mat", text);
            foreach (var forbidden in new[] { "createdByStaffId", "updatedByStaffId", "createOperationId", "createFingerprint", "version", "status", "showOnHomepage", "sortOrder", "pricingEnabled", "staff", "audit" })
            {
                Assert.DoesNotContain(forbidden, text, StringComparison.OrdinalIgnoreCase);
            }
        }

        var detail = JsonDocument.Parse(detailText).RootElement;
        Assert.Equal(seeded.Promotion.Id, detail.GetProperty("promotion").GetProperty("id").GetGuid());
        Assert.Equal("The BHA Hotel", detail.GetProperty("property").GetProperty("name").GetString());
        Assert.Equal(2, detail.GetProperty("body").GetArrayLength());
        Assert.True(detail.GetProperty("allRoomTypes").GetBoolean());
        Assert.True(detail.GetProperty("roomTypes").GetArrayLength() >= 2);   // every active room type of the Property
    }

    [Fact]
    public async Task A_promotion_for_some_room_types_lists_only_those()
    {
        await ResetAsync();
        await AddAsync("chi-deluxe", allRoomTypes: false);
        using var client = factory.CreateClient();

        var detail = await client.GetFromJsonAsync<JsonElement>($"{Base}/chi-deluxe");

        var rooms = detail.GetProperty("roomTypes").EnumerateArray().ToArray();
        Assert.Single(rooms);
        Assert.Equal(DeluxeRoomTypeId, rooms[0].GetProperty("id").GetGuid());
        Assert.False(detail.GetProperty("allRoomTypes").GetBoolean());
        var terms = detail.GetProperty("promotion").GetProperty("terms");
        Assert.Equal(("Percent", 12.5m, 2), (terms.GetProperty("kind").GetString(), terms.GetProperty("value").GetDecimal(), terms.GetProperty("minNights").GetInt32()));
        Assert.Equal("2026-09-01", terms.GetProperty("stayFrom").GetString());
    }

    [Fact]
    public async Task The_visitors_language_is_used_and_falls_back_to_the_source_text_where_there_is_no_translation()
    {
        await ResetAsync();
        var seeded = await AddAsync("da-ngon-ngu");
        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlRawAsync("""UPDATE "WebsiteLanguages" SET "IsActive" = true WHERE "NormalizedCode" = 'en'""");
            var english = await context.WebsiteLanguages.SingleAsync(x => x.NormalizedCode == "en");
            context.WebsiteTranslations.Add(new TheBha.Domain.Website.WebsiteTranslation(
                english.Id, $"content.promotion.{seeded.Promotion.Id:D}.title", "Early bird", true, null, FixedUtc, null));
            await context.SaveChangesAsync();
        }

        using var client = factory.CreateClient();
        var en = (await ListAsync(client, "en")).GetProperty("items")[0];
        var vi = (await ListAsync(client, "vi")).GetProperty("items")[0];

        Assert.Equal("Early bird", en.GetProperty("title").GetString());
        Assert.Equal("Tóm tắt da-ngon-ngu", en.GetProperty("summary").GetString());   // no English summary: the source text, never a key
        Assert.Equal("Ưu đãi da-ngon-ngu", vi.GetProperty("title").GetString());
    }

    [Fact]
    public async Task The_answer_is_revalidated_and_a_card_is_gone_when_its_date_passes_without_any_save()
    {
        await ResetAsync();
        await AddAsync("het-hom-nay", displayTo: LocalToday);
        using var client = factory.CreateClient();
        var first = await client.GetAsync(Base);
        var etag = first.Headers.ETag!.ToString();   // weak: W/"…"
        Assert.Equal("no-cache", first.Headers.CacheControl!.ToString());
        Assert.Equal(["het-hom-nay"], Slugs(await first.Content.ReadFromJsonAsync<JsonElement>()));

        using var unchanged = new HttpRequestMessage(HttpMethod.Get, Base);
        unchanged.Headers.TryAddWithoutValidation("If-None-Match", etag);
        Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(unchanged)).StatusCode);

        // The next local day: nobody edited anything, yet the card is no longer public and the old ETag no longer matches.
        factory.Clock.UtcNow = FixedUtc.AddDays(1);
        using var stale = new HttpRequestMessage(HttpMethod.Get, Base);
        stale.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var next = await client.SendAsync(stale);

        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
        Assert.Empty(Slugs(await next.Content.ReadFromJsonAsync<JsonElement>()));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Base}/het-hom-nay")).StatusCode);
    }

    [Fact]
    public async Task A_cover_is_served_only_while_a_public_promotion_uses_it()
    {
        await ResetAsync();
        var seeded = await AddAsync("co-anh");
        var draft = await AddAsync("anh-nhap", PromotionStatus.Draft);
        using var client = factory.CreateClient();

        var ok = await client.GetAsync($"{Base}/media/{seeded.MediaId}");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("image/png", ok.Content.Headers.ContentType?.MediaType);
        Assert.Contains("max-age=300", ok.Headers.CacheControl!.ToString());
        Assert.Equal("nosniff", ok.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Base}/media/{draft.MediaId}")).StatusCode);

        var detail = await client.GetFromJsonAsync<JsonElement>($"{Base}/co-anh");
        Assert.Equal($"/api/v1/website/promotions/media/{seeded.MediaId}", detail.GetProperty("promotion").GetProperty("coverImageUrl").GetString());

        await using (var context = factory.CreateDbContext())
        {
            var promotion = await context.Promotions.Include(x => x.RoomTypes).SingleAsync(x => x.Id == seeded.Promotion.Id);
            promotion.Edit(promotion.ToDetails() with { ShowOnHomepage = false }, Staff, FixedUtc);
            await context.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Base}/media/{seeded.MediaId}")).StatusCode);
    }

    [Fact]
    public async Task Hiding_the_card_does_not_stop_the_promotion_from_pricing()
    {
        await ResetAsync();
        var seeded = await AddAsync("van-giam-gia", allRoomTypes: false);
        await using (var context = factory.CreateDbContext())
        {
            var promotion = await context.Promotions.Include(x => x.RoomTypes).SingleAsync(x => x.Id == seeded.Promotion.Id);
            promotion.Edit(promotion.ToDetails() with { ShowOnHomepage = false, StayFrom = null, StayTo = null, CoverMediaId = null, CoverAltText = null }, Staff, FixedUtc);
            await context.SaveChangesAsync();
        }

        using var client = factory.CreateClient();
        Assert.Empty(Slugs(await ListAsync(client)));   // the card is gone

        var quote = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/properties/{PropertyId}/availability?checkIn={LocalToday.AddDays(3):yyyy-MM-dd}&checkOut={LocalToday.AddDays(5):yyyy-MM-dd}&adults=1&children=0&rooms=1");
        var deluxe = quote.EnumerateArray().Single(x => x.GetProperty("roomTypeCode").GetString() == "DLX-KING");

        Assert.Equal("van-giam-gia", deluxe.GetProperty("appliedPromotion").GetProperty("slug").GetString());   // the price is unchanged by hiding the card
        Assert.Equal(2 * 1_500_000m * 0.875m, deluxe.GetProperty("totalAmount").GetDecimal());
    }

    private sealed class FixedClock(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }
}
