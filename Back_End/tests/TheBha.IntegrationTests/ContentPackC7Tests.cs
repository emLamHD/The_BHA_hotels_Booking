using System.Text.Json.Nodes;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C7: an offer the target has under the same slug keeps its own cover and room-type links, and nothing the offers still to be imported need is left out or demanded.
/// Real PostgreSQL, a media directory of its own per database; the source is the committed pack imported into a database and exported again.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC7Tests(PostgreSqlWebApplicationFactory factory)
{
    private const string Shared = "o-dai-giam-200k";   // its cover is shared with the offer below in the source
    private const string Mapped = "gia-dinh-giam-10";   // the offer the target already has under another id

    private Task<Target> NewTargetAsync() => ContentPackTestSupport.NewTargetAsync(factory);

    private static async Task<JsonObject> RowAsync(Target t, string sql) => JsonNode.Parse((await t.TextAsync(sql))!)!.AsObject();

    private async Task<Target> SourceAsync()
    {
        var source = await NewTargetAsync();
        var imported = await source.RunAsync(source.Import(PackDir(), "--apply", "--groups", "catalog,promotions"));
        Assert.True(imported.Exit == 0, imported.Output);
        return source;
    }

    /// <summary>The target's own offer for <paramref name="slug"/>: another id, optionally its own cover, linked to <paramref name="roomType"/> (null = no link).</summary>
    private static async Task<(Guid Id, Guid? Cover)> OwnOfferAsync(Target t, string slug, bool withCover, string? roomTypeCode)
    {
        var offer = PackRow("Promotions", l => l.Contains($"\"{slug}\""));
        Guid? cover = null;
        if (withCover)
        {
            cover = Guid.NewGuid();
            var media = PackRow("PromotionMedia", l => l.Contains(offer["CoverMediaId"]!.GetValue<string>()));
            media["Id"] = cover.ToString(); media["StorageKey"] = $"promo/{cover:N}.webp";
            await t.InsertRowAsync("PromotionMedia", media);
        }
        var id = Guid.NewGuid();
        offer["Id"] = id.ToString(); offer["CoverMediaId"] = cover?.ToString(); offer["CreateOperationId"] = Guid.NewGuid().ToString(); offer["CreateFingerprint"] = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        offer["AllRoomTypes"] = false;
        await t.InsertRowAsync("Promotions", offer);
        if (roomTypeCode is not null)
            await t.ExecuteAsync($"""INSERT INTO "PromotionRoomTypes" ("PromotionId","RoomTypeId","PropertyId") SELECT '{id}', "Id", "PropertyId" FROM "RoomTypes" WHERE "Code" = '{roomTypeCode}'""");
        return (id, cover);
    }

    private static string Count(string table) => $"SELECT count(*) FROM \"{table}\"";

    // ---- F1: a cover shared with an offer that still has to be imported ----

    [Fact]
    public async Task F1_a_cover_shared_with_an_offer_still_to_import_is_imported_with_its_file_while_the_mapped_offer_keeps_its_own_cover()
    {
        await using var source = await SourceAsync();
        var shared = (await source.TextAsync($"""SELECT "CoverMediaId" FROM "Promotions" WHERE "Slug" = '{Shared}'"""))!;
        var sharedKey = (await source.TextAsync($"""SELECT "StorageKey" FROM "PromotionMedia" WHERE "Id" = '{shared}'"""))!;
        await source.ExecuteAsync($"""UPDATE "Promotions" SET "CoverMediaId" = '{shared}' WHERE "Slug" = '{Mapped}'""");
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await using var target = await NewTargetAsync();
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply", "--groups", "catalog"))).Exit);
            var (own, ownCover) = await OwnOfferAsync(target, Mapped, withCover: true, roomTypeCode: "RIV-2BR");
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "PromotionMedia" WHERE "Id" = '{shared}'"""));
            var media = await target.CountAsync(Count("PromotionMedia"));
            var offers = await target.CountAsync(Count("Promotions"));
            var files = target.MediaFiles();

            var dry = await target.RunAsync(target.Import(pack, "--groups", "promotions", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.Equal(media, await target.CountAsync(Count("PromotionMedia")));
            Assert.Equal(offers, await target.CountAsync(Count("Promotions")));
            Assert.Equal(files, target.MediaFiles());

            var apply = await target.RunAsync(target.Import(pack, "--groups", "promotions", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            // The mapped offer is the target's own, with its own cover and links; the offer that shares the source's cover arrived with it, row and file.
            Assert.Equal(ownCover.ToString(), await target.TextAsync($"""SELECT "CoverMediaId" FROM "Promotions" WHERE "Id" = '{own}'"""));
            Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "Promotions" WHERE "Slug" = '{Mapped}'"""));
            Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "PromotionRoomTypes" WHERE "PromotionId" = '{own}'"""));
            Assert.Equal(shared, await target.TextAsync($"""SELECT "CoverMediaId" FROM "Promotions" WHERE "Slug" = '{Shared}'"""));
            Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "PromotionMedia" WHERE "Id" = '{shared}'"""));
            var path = Path.Combine(target.Media, sharedKey);
            Assert.True(File.Exists(path));
            Assert.Equal(File.ReadAllBytes(Path.Combine(pack, "files", sharedKey)), File.ReadAllBytes(path));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "promotions"));
            Assert.True(verify.Exit == 0, verify.Output);
            var counts = (await target.CountAsync(Count("PromotionMedia")), await target.CountAsync(Count("Promotions")), target.MediaFiles());
            var again = await target.RunAsync(target.Import(pack, "--groups", "promotions", "--apply"));
            Assert.True(again.Exit == 0, again.Output);
            Assert.Equal(counts, (await target.CountAsync(Count("PromotionMedia")), await target.CountAsync(Count("Promotions")), target.MediaFiles()));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_a_cover_only_mapped_offers_used_is_not_copied()
    {
        await using var source = await SourceAsync();
        var shared = (await source.TextAsync($"""SELECT "CoverMediaId" FROM "Promotions" WHERE "Slug" = '{Shared}'"""))!;
        var sharedKey = (await source.TextAsync($"""SELECT "StorageKey" FROM "PromotionMedia" WHERE "Id" = '{shared}'"""))!;
        await source.ExecuteAsync($"""UPDATE "Promotions" SET "CoverMediaId" = '{shared}' WHERE "Slug" = '{Mapped}'""");
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await using var target = await NewTargetAsync();
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply", "--groups", "catalog"))).Exit);
            var a = await OwnOfferAsync(target, Shared, withCover: true, roomTypeCode: "RIV-2BR");
            var b = await OwnOfferAsync(target, Mapped, withCover: true, roomTypeCode: "RIV-2BR");
            var apply = await target.RunAsync(target.Import(pack, "--groups", "promotions", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "PromotionMedia" WHERE "Id" = '{shared}'"""));
            Assert.False(File.Exists(Path.Combine(target.Media, sharedKey)));
            Assert.Equal(a.Cover.ToString(), await target.TextAsync($"""SELECT "CoverMediaId" FROM "Promotions" WHERE "Id" = '{a.Id}'"""));
            Assert.Equal(b.Cover.ToString(), await target.TextAsync($"""SELECT "CoverMediaId" FROM "Promotions" WHERE "Id" = '{b.Id}'"""));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "promotions"));
            Assert.True(verify.Exit == 0, verify.Output);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- F2: the links of a mapped offer are not imported, so their room types are not required ----

    /// <summary>The source's mapped offer is also linked to a room type the target does not have (a code and slug the target lacks).</summary>
    private async Task<(Target Source, string Pack, Guid Extra)> SourceWithExtraRoomTypeAsync()
    {
        var source = await SourceAsync();
        var extra = Guid.NewGuid();
        var room = await RowAsync(source, """SELECT to_jsonb(t)::text FROM "RoomTypes" t WHERE "Code" = 'RIV-2BR'""");
        room["Id"] = extra.ToString(); room["Code"] = "RIV-C7"; room["Slug"] = "riv-c7"; room["Name"] = "Extra room type (C7)";
        await source.InsertRowAsync("RoomTypes", room);
        await source.ExecuteAsync($"""INSERT INTO "PromotionRoomTypes" ("PromotionId","RoomTypeId","PropertyId") SELECT "Id", '{extra}', "PropertyId" FROM "Promotions" WHERE "Slug" = '{Mapped}'""");
        return (source, await ContentPackC3Tests.ExportAsync(source), extra);
    }

    [Fact]
    public async Task F2_a_mapped_offers_skipped_link_to_a_room_type_the_target_lacks_does_not_ask_for_the_catalog()
    {
        var (source, pack, extra) = await SourceWithExtraRoomTypeAsync();
        await using var _ = source;
        try
        {
            await using var target = await NewTargetAsync();
            Assert.Equal(0, (await target.RunAsync(target.Import(PackDir(), "--apply", "--groups", "catalog"))).Exit);
            var (own, _) = await OwnOfferAsync(target, Mapped, withCover: false, roomTypeCode: "RIV-1BR");
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "RoomTypes" WHERE "Id" = '{extra}' OR "Code" = 'RIV-C7'"""));
            var rooms = await target.CountAsync(Count("RoomTypes"));
            var ownLinks = await target.TextAsync($"""SELECT string_agg("RoomTypeId"::text, ',' ORDER BY "RoomTypeId") FROM "PromotionRoomTypes" WHERE "PromotionId" = '{own}'""");

            var dry = await target.RunAsync(target.Import(pack, "--groups", "promotions", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            var apply = await target.RunAsync(target.Import(pack, "--groups", "promotions", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal(ownLinks, await target.TextAsync($"""SELECT string_agg("RoomTypeId"::text, ',' ORDER BY "RoomTypeId") FROM "PromotionRoomTypes" WHERE "PromotionId" = '{own}'"""));
            Assert.Equal(rooms, await target.CountAsync(Count("RoomTypes")));
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "RoomTypes" WHERE "Code" = 'RIV-C7'"""));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "promotions"));
            Assert.True(verify.Exit == 0, verify.Output);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F2_a_new_offers_link_to_a_room_type_the_target_really_lacks_is_named_and_nothing_is_written()
    {
        var (source, pack, extra) = await SourceWithExtraRoomTypeAsync();
        await using var _ = source;
        try
        {
            // Here the target has no offer under that slug: the offer is imported with its links, one of which needs the missing room type.
            await using var target = await NewTargetAsync();
            Assert.Equal(0, (await target.RunAsync(target.Import(PackDir(), "--apply", "--groups", "catalog"))).Exit);
            var offers = await target.CountAsync(Count("Promotions"));
            var media = await target.CountAsync(Count("PromotionMedia"));
            var files = target.MediaFiles();
            foreach (var mode in new[] { "--dry-run", "--apply" })
            {
                var run = await target.RunAsync(target.Import(pack, "--groups", "promotions", mode));
                Assert.NotEqual(0, run.Exit);
                Assert.Contains($"needs the room type {extra}", run.Output);
                Assert.Equal(offers, await target.CountAsync(Count("Promotions")));
                Assert.Equal(media, await target.CountAsync(Count("PromotionMedia")));
                Assert.Equal(files, target.MediaFiles());
            }
            Assert.NotEqual(0, (await target.RunAsync(target.Verify(pack, "--groups", "promotions"))).Exit);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }
}
