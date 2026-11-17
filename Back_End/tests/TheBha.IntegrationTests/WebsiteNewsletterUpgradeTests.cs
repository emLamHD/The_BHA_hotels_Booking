using System.Net;
using System.Text.Json;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-NEWSLETTER-001-C3: the Newsletter form must say what it does on a database whose built-in language packs were installed
/// BEFORE the form stored anything. Installing a pack stores every text as a non-manual <c>WebsiteTranslations</c> row, and the
/// public dictionary lays stored rows over the embedded pack, so the old demo disclosure ("not sent or stored") would have kept
/// winning over a corrected embedded text. The form therefore reads its two texts from NEW keys that no old install can hold a
/// row for. This builds that old state (the pre-V1 demo texts as stored, non-manual rows; no rows for the keys V1 added), reads the
/// public dictionary for vi, en and fr WITHOUT installing a pack again, and checks the new texts, the kept stored rows and the
/// precedence of a Staff edit. Real PostgreSQL; every change goes through the real Admin routes except the old install state.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteNewsletterUpgradeTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Dictionary = "/api/v1/website/dictionary?scopes=shared,customer&locale=";
    private const string Languages = "/api/admin/v1/website/languages";
    private const string Currencies = "/api/admin/v1/website/currencies";
    private const string Packs = "/api/admin/v1/website/language-packs";
    private const string Save = "/api/admin/v1/website/translations/save";

    private const string StorageNotice = "customer.newsletter.storageNotice";
    private const string SubscribeLabel = "customer.newsletter.subscribeLabel";
    private const string OldDisclosure = "customer.newsletter.disclosure";
    private const string OldLabel = "customer.home.homeNewsletter.subscribeDemoYourEmailIs";
    private const string OldNotStored = "customer.newsletter.notStored";

    /// <summary>The keys the form reads today.</summary>
    private static readonly string[] FormKeys =
    [
        "customer.newsletter.heading", "customer.newsletter.benefit", "customer.home.homeNewsletter.yourEmail",
        "customer.home.homeNewsletter.subscribe", StorageNotice, SubscribeLabel, "customer.newsletter.sending", "customer.newsletter.received",
        "customer.newsletter.failed", "customer.newsletter.tooMany", "customer.newsletter.required", "customer.newsletter.invalid",
    ];

    /// <summary>The keys Newsletter V1 added: a site installed before it has no stored row for them.</summary>
    private static readonly string[] AddedByV1 =
        [StorageNotice, SubscribeLabel, "customer.newsletter.sending", "customer.newsletter.received", "customer.newsletter.failed", "customer.newsletter.tooMany"];

    /// <summary>What the preview's packs said (develop before Newsletter V1): the texts an old install stored.</summary>
    private static readonly Dictionary<string, (string Disclosure, string Label, string NotStored)> PreV1 = new()
    {
        ["vi"] = ("Bản demo: email chỉ được kiểm tra định dạng, không được gửi đi hay lưu lại.", "Đăng ký (bản demo, email không được lưu)", "Bản demo chưa tiếp nhận đăng ký. Email chưa được lưu."),
        ["en"] = ("Demo: the email is only checked for its format; it is not sent or stored.", "Subscribe (demo: your email is not saved)", "The demo doesn't take subscriptions yet. Your email has not been saved."),
        ["fr"] = ("Démo : l’adresse e-mail est seulement vérifiée sur son format ; elle n’est ni envoyée ni enregistrée.", "S’abonner (démo : votre e-mail n’est pas enregistré)", "La démo n’enregistre pas encore les inscriptions. Votre adresse e-mail n’a pas été conservée."),
    };

    private static readonly Dictionary<string, string> Stores = new() { ["vi"] = "lưu email của bạn", ["en"] = "stores your email", ["fr"] = "enregistre votre adresse" };

    private async Task<JsonElement> EntriesAsync(Session session, string locale)
    {
        var body = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.Client.SendAsync(Get(Dictionary + locale))));
        Assert.Equal(locale, body.GetProperty("resolvedLocale").GetString());   // the language is on, not a fallback
        return body.GetProperty("entries");
    }

    /// <summary>The state an old install left: the pre-V1 demo texts as stored, non-manual rows, and no rows for the keys V1 added.</summary>
    private async Task SimulateInstallBeforeV1Async(string code)
    {
        var language = await ScalarAsync<Guid>($"""SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = '{code}'""");
        var old = PreV1[code];
        foreach (var (key, text) in new[] { (OldDisclosure, old.Disclosure), (OldLabel, old.Label), (OldNotStored, old.NotStored) })
        {
            await ExecuteAsync($"""
                INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","IsManual")
                VALUES ('{language}','{key}','{text.Replace("'", "''")}',1,now(),false)
                ON CONFLICT ("LanguageId","Key") DO UPDATE SET "Value" = EXCLUDED."Value", "IsManual" = false
                """);
        }

        await ExecuteAsync($"""DELETE FROM "WebsiteTranslations" WHERE "LanguageId" = '{language}' AND "Key" IN ({string.Join(",", AddedByV1.Select(key => $"'{key}'"))})""");
    }

    private async Task TurnOnAsync(Session session, string code, string nativeName, int sortOrder, string currency, string rate)
    {
        await CompleteContentAsync(code);
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/{currency}/rate", new { expectedVersion = 1, vndPerUnit = rate }));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Currencies}/{currency}/active", new { expectedVersion = 2, isActive = true }));
        var version = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteLanguages" WHERE "NormalizedCode" = '{code}'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Languages}/{code}/update",
            new { expectedVersion = version, displayName = nativeName, nativeName, sortOrder, isActive = true, defaultCurrencyCode = currency }));
    }

    private async Task InstallBuiltInAsync(Session session, string packId)
    {
        var preview = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Packs}/preview", new { builtInPackId = packId, mode = PackModes.KeepManual, previewToken = (string?)null, enable = false })));
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync($"{Packs}/apply", new { builtInPackId = packId, mode = PackModes.KeepManual, previewToken = preview.GetProperty("previewToken").GetString(), enable = false }));
    }

    [Fact]
    public async Task A_database_whose_packs_were_installed_before_V1_serves_the_new_newsletter_texts_without_installing_a_pack_again()
    {
        using var session = await StartAsync();
        await InstallBuiltInAsync(session, "bha-en");
        await InstallBuiltInAsync(session, "bha-fr");
        await TurnOnAsync(session, "en", "English", 20, "USD", "26060");
        await TurnOnAsync(session, "fr", "Français", 30, "EUR", "29748.26");
        foreach (var code in new[] { "vi", "en", "fr" })
        {
            await SimulateInstallBeforeV1Async(code);
        }

        foreach (var code in new[] { "vi", "en", "fr" })
        {
            var entries = await EntriesAsync(session, code);
            var embedded = LocalizationAssets.BuiltInPack(code)!.All.ToDictionary(pair => pair.Key, pair => pair.Value);

            // Every text the form asks for is there, from the embedded pack, with no row stored for the keys V1 added.
            foreach (var key in FormKeys)
            {
                Assert.True(entries.TryGetProperty(key, out var served), $"{code}: {key} is missing from the dictionary");
                Assert.Equal(embedded[key], served.GetString());
            }

            // The disclosure says the address is stored, and nothing about a demo or "not stored".
            var notice = entries.GetProperty(StorageNotice).GetString()!;
            Assert.Contains(Stores[code], notice);
            Assert.DoesNotContain(PreV1[code].Disclosure, notice);
            Assert.NotEqual(PreV1[code].Label, entries.GetProperty(SubscribeLabel).GetString());

            // The stored (old) rows are kept and still win for their own keys: a preview front end served by this API still reads them.
            Assert.Equal(PreV1[code].Disclosure, entries.GetProperty(OldDisclosure).GetString());
            Assert.Equal(PreV1[code].Label, entries.GetProperty(OldLabel).GetString());
            Assert.Equal(PreV1[code].NotStored, entries.GetProperty(OldNotStored).GetString());
            Assert.Equal(3, await ScalarAsync<int>($"""
                SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId"
                WHERE l."NormalizedCode" = '{code}' AND NOT t."IsManual" AND t."Key" IN ('{OldDisclosure}','{OldLabel}','{OldNotStored}')
                """));
            Assert.Equal(0, await ScalarAsync<int>($"""
                SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId"
                WHERE l."NormalizedCode" = '{code}' AND t."Key" IN ({string.Join(",", AddedByV1.Select(key => $"'{key}'"))})
                """));
        }
    }

    [Fact]
    public async Task A_Staff_edit_of_another_key_still_wins_and_a_Staff_edit_of_a_new_key_wins_over_the_embedded_pack()
    {
        using var session = await StartAsync();
        await SimulateInstallBeforeV1Async("vi");

        // Another key: the existing rule (a stored value beats the embedded pack) is untouched by the new keys.
        const string Offers = "customer.header.menu.offers";
        var offersVersion = await ScalarAsync<int>($"""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = '{Offers}' AND "LanguageId" = '{WebsiteTestSeed.Vietnamese}'""");
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, new { locale = "vi", key = Offers, value = "Khuyến mãi", expectedVersion = offersVersion }));
        // The new key: Staff can still word it themselves; that is the point of keeping the overlay order.
        await AssertStatusAsync(HttpStatusCode.OK, session.PostAsync(Save, new { locale = "vi", key = StorageNotice, value = "Email được lưu để ghi nhận yêu cầu.", expectedVersion = (int?)null }));

        var entries = await EntriesAsync(session, "vi");
        Assert.Equal("Khuyến mãi", entries.GetProperty(Offers).GetString());
        Assert.Equal("Email được lưu để ghi nhận yêu cầu.", entries.GetProperty(StorageNotice).GetString());
        Assert.Equal(LocalizationAssets.BuiltInPack("vi")!.All.ToDictionary(pair => pair.Key, pair => pair.Value)[SubscribeLabel], entries.GetProperty(SubscribeLabel).GetString());
    }

    [Fact]
    public void The_packs_carry_the_new_keys_and_keep_the_preview_keys_for_an_older_front_end()
    {
        var catalog = LocalizationAssets.Catalog.Select(definition => definition.Key).ToHashSet(StringComparer.Ordinal);
        foreach (var key in new[] { StorageNotice, SubscribeLabel, OldDisclosure, OldLabel, OldNotStored })
        {
            Assert.Contains(key, catalog);
        }

        foreach (var code in new[] { "vi", "en", "fr" })
        {
            var pack = LocalizationAssets.BuiltInPack(code)!.All.ToDictionary(pair => pair.Key, pair => pair.Value);
            foreach (var key in new[] { StorageNotice, SubscribeLabel, OldDisclosure, OldLabel, OldNotStored })
            {
                Assert.False(string.IsNullOrWhiteSpace(pack[key]), $"{code}: {key}");
            }

            // The old keys keep the demo wording on purpose (an older front end that is still a demo reads them); the new ones do not.
            Assert.Equal(PreV1[code].Disclosure, pack[OldDisclosure]);
            Assert.Equal(PreV1[code].Label, pack[OldLabel]);
            Assert.Equal(PreV1[code].NotStored, pack[OldNotStored]);
            Assert.Contains(Stores[code], pack[StorageNotice]);
        }
    }
}
