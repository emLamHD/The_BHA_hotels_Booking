using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Web;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using TheBha.Api;
using TheBha.Api.Realtime;
using TheBha.Application.Activity;
using TheBha.Application.Website;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Newsletter;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR08 (ADR 0011 §A, §C, §D): the seven Website menus (hero, menus, languages and packs, translations, currencies, social, newsletter-sender) append ONE event per committed
/// Admin operation as the last statement before COMMIT, hint only after it, and answer a watermark from the same snapshot as their data. Real PostgreSQL, the real HTTP pipeline and the real
/// login; Google and the picture storage are replaced only at their own edge.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WebsiteActivityApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    private const string Root = "/api/admin/v1/website";
    private const string Unseen = "/api/admin/v1/menu-unseen";
    private const string Watermark = "X-Admin-View-Watermark";
    private const string CustomerOrigin = "https://localhost:3000";
    private static readonly string[] SevenMenus =
        [AdminMenuKeys.WebsiteHero, AdminMenuKeys.WebsiteMenus, AdminMenuKeys.WebsiteLanguages, AdminMenuKeys.WebsiteTranslations, AdminMenuKeys.WebsiteCurrencies, AdminMenuKeys.WebsiteSocial, AdminMenuKeys.NewsletterSender];

    // ---------------------------------------------------------------------------------------------------------- probes

    /// <summary>Records every hint the real publisher is asked for (the real one still runs, so its "no open transaction" guard stays in force) and can fail the recorder on purpose AFTER it took the number.</summary>
    private sealed class Probe
    {
        public readonly ConcurrentQueue<string> Hints = [];
        public volatile bool FailRecorder;

        public void Install(IServiceCollection services)
        {
            var recorder = services.Single(descriptor => descriptor.ServiceType == typeof(IAdminActivityRecorder)).ImplementationType!;
            services.RemoveAll<IAdminActivityRecorder>();
            services.AddScoped<IAdminActivityRecorder>(provider => new FailingRecorder((IAdminActivityRecorder)ActivatorUtilities.CreateInstance(provider, recorder), this));
            services.RemoveAll<IAdminActivityHint>();
            services.AddScoped<IAdminActivityHint>(provider => new HintSpy(ActivatorUtilities.CreateInstance<AdminActivityHint>(provider), Hints));
        }
    }

    private sealed class FailingRecorder(IAdminActivityRecorder inner, Probe probe) : IAdminActivityRecorder
    {
        public async Task RecordAsync(AdminActivityEntry entry, CancellationToken cancellationToken)
        {
            await inner.RecordAsync(entry, cancellationToken);
            if (probe.FailRecorder)
            {
                throw new InvalidOperationException("Injected recorder failure after the counter moved.");
            }
        }
    }

    private sealed class HintSpy(IAdminActivityHint inner, ConcurrentQueue<string> sent) : IAdminActivityHint
    {
        public Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken)
        {
            sent.Enqueue(menuKey);
            return inner.PublishAsync(menuKey, propertyId, cancellationToken);
        }
    }

    /// <summary>Wraps the real storage: records what is deleted and can park a write (a slow disk) so a test can look at the database while the file I/O is in flight.</summary>
    private sealed class SpyStorage(IHeroMediaStorage inner) : IHeroMediaStorage
    {
        public readonly ConcurrentQueue<string> Deleted = [];
        public volatile TaskCompletionSource<bool>? Parked;
        public readonly TaskCompletionSource<bool> Reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsConfigured => inner.IsConfigured;

        public async Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
        {
            if (Parked is { } gate)
            {
                Reached.TrySetResult(true);
                await gate.Task.WaitAsync(cancellationToken);
            }

            await inner.WriteAsync(key, content, cancellationToken);
        }

        public Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken) => inner.OpenReadAsync(key, cancellationToken);
        public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken) => inner.ExistsAsync(key, cancellationToken);

        public Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            Deleted.Enqueue(key);
            return inner.DeleteAsync(key, cancellationToken);
        }
    }

    /// <summary>Throws AFTER PostgreSQL really committed: the caller learns of an error whose outcome it cannot know.</summary>
    private sealed class LostCommitAnswer : DbTransactionInterceptor
    {
        public volatile bool Armed;

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default) =>
            Armed ? throw new InvalidOperationException("Injected: the answer to COMMIT was lost.") : Task.CompletedTask;
    }

    // ---------------------------------------------------------------------------------------------------------- plumbing

    private sealed class Env(Session site, string manager, string desk, NewsletterGoogleStub google, Probe probe) : IDisposable
    {
        public Session Site { get; } = site;
        public string ManagerCookie { get; } = manager;
        public string DeskCookie { get; } = desk;
        public NewsletterGoogleStub Google { get; } = google;
        public Probe Probe { get; } = probe;
        public HttpClient Client => Site.Client;
        public void Dispose() => Site.Dispose();
    }

    /// <summary>Site (the website flag) acts; Manager is a second website Staff who sees; Desk has no website access. The accounts are older than the test clock (decision D2).</summary>
    private async Task<Env> BeginAsync(Probe? probe = null, Action<IServiceCollection>? more = null)
    {
        probe ??= new Probe();
        var google = new NewsletterGoogleStub();
        var host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(AdminCalendarAccess.ModeKey, "Staff");
            builder.UseSetting("StaffAuthentication:LoginRateLimiting:PermitLimit", "10000");
            builder.UseSetting("Authentication:RateLimiting:LoginPermitLimit", "10000");
            builder.UseSetting("Cors:AllowedOrigins:0", CustomerOrigin);
            builder.UseSetting("Cors:AdminOrigins:0", AdminOrigin);
            builder.ConfigureServices(services =>
            {
                services.AddHttpClient(GoogleMailGateway.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => google);
                probe.Install(services);
                more?.Invoke(services);
            });
        });
        await SeedStaffAsync(host);
        await CliAsync(host, ["--staff-website-access", "--email", Manager, "--enabled", "true"]);
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CreatedAtUtc" = '2026-10-01T00:00:00Z' """);
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow;
        var client = CreateHttpsClient(host);
        return new Env(new Session(host, client, await LoginAsync(client, Site)), await LoginAsync(client, Manager), await LoginAsync(client, Desk), google, probe);
    }

    private static void InstallLostCommit(IServiceCollection services, string connectionString, LostCommitAnswer interceptor)
    {
        services.RemoveAll<DbContextOptions<TheBhaDbContext>>();
        services.AddDbContext<TheBhaDbContext>(options => options
            .UseNpgsql(connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
            .AddInterceptors(interceptor));
    }

    private async Task<List<AdminActivity>> RowsAsync(string? menu = null)
    {
        await using var db = Factory.CreateDbContext();
        return (await db.AdminActivities.AsNoTracking().Where(row => menu == null || row.MenuKey == menu).ToListAsync()).OrderBy(row => row.MenuKey, StringComparer.Ordinal).ThenBy(row => row.Sequence).ToList();
    }

    private Task<long> CounterAsync(string menu) => ScalarAsync<long>($"""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = '{menu}' """);

    private async Task<Dictionary<string, long>> CountersAsync() => (await Task.WhenAll(SevenMenus.Select(async menu => (menu, await CounterAsync(menu))))).ToDictionary(pair => pair.menu, pair => pair.Item2);

    private async Task<string> CountersTextAsync() => string.Join(',', (await CountersAsync()).OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => $"{pair.Key}={pair.Value}"));

    private Task<int> VersionAsync(string table, string column, string key) => ScalarAsync<int>($"""SELECT "Version" FROM "{table}" WHERE "{column}" = '{key}' """);

    private string[] HeroFiles() => Directory.Exists(Path.Combine(Factory.MediaRoot, "hero")) ? Directory.GetFiles(Path.Combine(Factory.MediaRoot, "hero")) : [];

    private static async Task<JsonElement> OkAsync(Task<HttpResponseMessage> send) => await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, send));

    private static Task<HttpResponseMessage> GetAs(Env e, string cookie, string path) => e.Client.SendAsync(Get(path, cookie));

    private static Task<HttpResponseMessage> PostAs(Env e, string cookie, string path, object? body) => e.Client.SendAsync(Post(path, body, cookie));

    private static HttpRequestMessage UploadRequest(string cookie, byte[]? bytes = null)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes ?? File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "hero", "valid.png")));
        file.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        content.Add(file, "file", "banner.png");
        var request = new HttpRequestMessage(HttpMethod.Post, $"{Root}/hero/media") { Content = content };
        request.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        request.Headers.Add("Cookie", cookie);
        return request;
    }

    private static JsonObject HeroBody(JsonElement admin) => new()
    {
        ["expectedRevision"] = admin.GetProperty("revision").GetString(),
        ["fontKey"] = admin.GetProperty("fontKey").GetString(),
        ["autoplayEnabled"] = admin.GetProperty("autoplayEnabled").GetBoolean(),
        ["intervalSeconds"] = admin.GetProperty("intervalSeconds").GetInt32(),
        ["texts"] = JsonNode.Parse(admin.GetProperty("texts").GetRawText()),
        ["slides"] = new JsonArray([.. admin.GetProperty("slides").EnumerateArray().Select(slide => (JsonNode?)JsonNode.Parse(slide.GetRawText()))]),
    };

    private static JsonObject MenuBody(JsonElement admin) => new()
    {
        ["expectedRevision"] = admin.GetProperty("revision").GetString(),
        ["items"] = new JsonArray([.. admin.GetProperty("items").EnumerateArray().Select(item => (JsonNode?)JsonNode.Parse(item.GetRawText()))]),
    };

    private static JsonObject SocialBody(JsonElement admin)
    {
        var body = new JsonObject { ["expectedRevision"] = admin.GetProperty("revision").GetInt32() };
        foreach (var name in new[] { "phoneEnabled", "phoneNumber", "messengerEnabled", "messengerUrl", "zaloEnabled", "zaloNumber", "backToTopEnabled" })
        {
            body[name] = JsonNode.Parse(admin.GetProperty(name).GetRawText());
        }

        return body;
    }

    private async Task<(string State, string Url)> BeginConnectAsync(Env e)
    {
        var start = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Site.PostAsync($"{Root}/newsletter-sender/connect", new { clientId = "client-1.apps.googleusercontent.com", clientSecret = "GOCSPX-client-secret-1", switchAccount = false })));
        var url = start.GetProperty("authorizationUrl").GetString()!;
        return (HttpUtility.ParseQueryString(new Uri(url).Query)["state"]!, url);
    }

    /// <summary>True when nobody holds the menu's counter row (a second connection takes it without waiting).</summary>
    private async Task<bool> CounterRowIsFreeAsync(string menu)
    {
        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = new NpgsqlCommand("""SELECT 1 FROM "MenuActivityStreams" WHERE "MenuKey" = @menu FOR UPDATE NOWAIT""", connection, transaction);
        command.Parameters.AddWithValue("menu", menu);
        try
        {
            await command.ExecuteScalarAsync();
            return true;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.LockNotAvailable)
        {
            return false;
        }
    }

    // ---------------------------------------------------------------------------------------------------------- every write, one event

    [Fact]
    public async Task Every_Admin_write_of_the_seven_menus_appends_exactly_one_event_with_a_generic_snapshot_and_one_hint_after_the_commit()
    {
        var probe = new Probe();
        using var e = await BeginAsync(probe);
        var site = await StaffIdAsync(Site);
        var expected = new Dictionary<string, int>();
        var hints = new List<string>();

        async Task<AdminActivity> Expect(string menu, string action, string kind, string key, string title)
        {
            expected[menu] = expected.GetValueOrDefault(menu) + 1;
            hints.Add(menu);
            var rows = await RowsAsync(menu);
            Assert.Equal(expected[menu], rows.Count);
            var row = rows[^1];
            Assert.Equal((action, kind, key, title, 1), (row.Action, row.EntityKind, row.EntityKey, row.TitleSnapshot, row.ItemCount));
            Assert.Equal((AdminActorKind.Staff, site, (Guid?)null, (Guid?)null), (row.ActorKind, row.ActorStaffId ?? Guid.Empty, row.PropertyId, row.CorrelationId));
            Assert.Equal(rows.Count, row.Sequence);
            Assert.Equal(row.Sequence, await CounterAsync(menu));
            Assert.Equal(hints, probe.Hints.ToList()); // one hint per write, in order, never from a refused or no-op one
            return row;
        }

        // ---- website-hero: an upload is one event; one Save of the whole hero is one event; the same Save again changes nothing and records nothing
        var uploaded = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(UploadRequest(e.Site.Cookie))));
        await Expect(AdminMenuKeys.WebsiteHero, "PictureUploaded", "hero-picture", uploaded.GetProperty("id").GetGuid().ToString("D"), "Hero picture");
        var hero = await OkAsync(e.Site.GetAsync($"{Root}/hero"));
        var body = HeroBody(hero);
        body["intervalSeconds"] = hero.GetProperty("intervalSeconds").GetInt32() + 1;
        var savedHero = await OkAsync(e.Site.PostAsync($"{Root}/hero/save", body.ToJsonString()));
        await Expect(AdminMenuKeys.WebsiteHero, "Saved", "hero", "home-hero", "Home hero");
        await OkAsync(e.Site.PostAsync($"{Root}/hero/save", HeroBody(savedHero).ToJsonString()));
        Assert.Equal(2, (await RowsAsync(AdminMenuKeys.WebsiteHero)).Count);

        // ---- website-menus
        var menu = await OkAsync(e.Site.GetAsync($"{Root}/menus"));
        var menuBody = MenuBody(menu);
        var first = (JsonObject)menuBody["items"]![0]!;
        first["openInNewTab"] = !first["openInNewTab"]!.GetValue<bool>();
        var savedMenu = await OkAsync(e.Site.PostAsync($"{Root}/menus/save", menuBody.ToJsonString()));
        await Expect(AdminMenuKeys.WebsiteMenus, "Saved", "menu", "header-menu", "Header menu");
        await OkAsync(e.Site.PostAsync($"{Root}/menus/save", MenuBody(savedMenu).ToJsonString()));
        Assert.Single(await RowsAsync(AdminMenuKeys.WebsiteMenus));

        // ---- website-social: a Save always writes a new version, so every committed Save is an event; the title never carries a number or a link
        var social = await OkAsync(e.Site.GetAsync($"{Root}/social-media"));
        var socialBody = SocialBody(social);
        socialBody["backToTopEnabled"] = !social.GetProperty("backToTopEnabled").GetBoolean();
        await OkAsync(e.Site.PostAsync($"{Root}/social-media/save", socialBody.ToJsonString()));
        await Expect(AdminMenuKeys.WebsiteSocial, "Saved", "social", "social-media", "Social media");

        // ---- website-currencies: rate, switch on, rename, create, make the default, switch off, delete
        async Task<int> CurrencyVersion(string code) => await VersionAsync("WebsiteCurrencies", "Code", code);
        await OkAsync(e.Site.PostAsync($"{Root}/currencies/USD/rate", new { expectedVersion = await CurrencyVersion("USD"), vndPerUnit = "25500" }));
        await Expect(AdminMenuKeys.WebsiteCurrencies, "RateSet", "currency", "usd", "USD");
        await OkAsync(e.Site.PostAsync($"{Root}/currencies/USD/active", new { expectedVersion = await CurrencyVersion("USD"), isActive = true }));
        await Expect(AdminMenuKeys.WebsiteCurrencies, "Enabled", "currency", "usd", "USD");
        await OkAsync(e.Site.PostAsync($"{Root}/currencies/USD/update", new { expectedVersion = await CurrencyVersion("USD"), name = "US dollar", symbol = "US$", minorUnits = 2, sortOrder = 20 }));
        await Expect(AdminMenuKeys.WebsiteCurrencies, "Updated", "currency", "usd", "USD");
        await AssertStatusAsync(HttpStatusCode.Created, e.Site.PostAsync($"{Root}/currencies", new { code = "JPY", name = "Yen", symbol = "¥", minorUnits = 0, sortOrder = 40 }));
        await Expect(AdminMenuKeys.WebsiteCurrencies, "Created", "currency", "jpy", "JPY");
        await OkAsync(e.Site.PostAsync($"{Root}/currencies/JPY/active", new { expectedVersion = await CurrencyVersion("JPY"), isActive = false }));
        await Expect(AdminMenuKeys.WebsiteCurrencies, "Disabled", "currency", "jpy", "JPY");
        await OkAsync(e.Site.PostAsync($"{Root}/currencies/USD/set-default", new { expectedVersion = await CurrencyVersion("USD") }));
        await Expect(AdminMenuKeys.WebsiteCurrencies, "DefaultChanged", "currency", "usd", "USD");
        await OkAsync(e.Site.PostAsync($"{Root}/currencies/USD/set-default", new { expectedVersion = await CurrencyVersion("USD") })); // already the default: no write, no event
        await AssertStatusAsync(HttpStatusCode.NoContent, e.Site.PostAsync($"{Root}/currencies/JPY/delete", new { expectedVersion = await CurrencyVersion("JPY") }));
        await Expect(AdminMenuKeys.WebsiteCurrencies, "Deleted", "currency", "jpy", "JPY");
        Assert.Equal(7, (await RowsAsync(AdminMenuKeys.WebsiteCurrencies)).Count);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "WebsiteCurrencies" WHERE "Code" = 'JPY' """)); // the object is gone, its history stays

        // ---- website-translations: save (the object is the language, the title its code, never the text), clear, save again
        var listed = await OkAsync(e.Site.GetAsync($"{Root}/translations?locale=en&page=1&pageSize=1"));
        var row = listed.GetProperty("rows")[0];
        var key = row.GetProperty("key").GetString()!;
        var value = row.GetProperty("value").GetString()!;
        var saved = await OkAsync(e.Site.PostAsync($"{Root}/translations/save", new { locale = "en", key, value, expectedVersion = row.GetProperty("version").GetInt32() }));
        await Expect(AdminMenuKeys.WebsiteTranslations, "Saved", "translation", "en", "en");
        await OkAsync(e.Site.PostAsync($"{Root}/translations/clear", new { locale = "en", key, expectedVersion = saved.GetProperty("version").GetInt32() }));
        await Expect(AdminMenuKeys.WebsiteTranslations, "Cleared", "translation", "en", "en");
        await OkAsync(e.Site.PostAsync($"{Root}/translations/save", new { locale = "en", key, value, expectedVersion = (int?)null }));
        await Expect(AdminMenuKeys.WebsiteTranslations, "Saved", "translation", "en", "en");

        // ---- website-languages: create, update, delete; a pack's preview writes nothing and its Apply is ONE event; update to active; make the default
        await AssertStatusAsync(HttpStatusCode.Created, e.Site.PostAsync($"{Root}/languages", new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false }));
        await Expect(AdminMenuKeys.WebsiteLanguages, "Created", "language", "fr", "fr");
        await OkAsync(e.Site.PostAsync($"{Root}/languages/fr/update", new { expectedVersion = await VersionAsync("WebsiteLanguages", "NormalizedCode", "fr"), displayName = "Français", nativeName = "Français", sortOrder = 31, isActive = false }));
        await Expect(AdminMenuKeys.WebsiteLanguages, "Updated", "language", "fr", "fr");
        await AssertStatusAsync(HttpStatusCode.NoContent, e.Site.PostAsync($"{Root}/languages/fr/delete", new { expectedVersion = await VersionAsync("WebsiteLanguages", "NormalizedCode", "fr") }));
        await Expect(AdminMenuKeys.WebsiteLanguages, "Deleted", "language", "fr", "fr");

        var library = await OkAsync(e.Site.GetAsync($"{Root}/language-packs/library"));
        var pack = library.EnumerateArray().Single(item => item.GetProperty("locale").GetString() == "en").GetProperty("id").GetString();
        var preview = await OkAsync(e.Site.PostAsync($"{Root}/language-packs/preview", new { builtInPackId = pack, mode = PackModes.KeepManual }));
        Assert.Equal(3, (await RowsAsync(AdminMenuKeys.WebsiteLanguages)).Count); // a preview recorded nothing
        await OkAsync(e.Site.PostAsync($"{Root}/language-packs/apply", new { builtInPackId = pack, mode = PackModes.KeepManual, previewToken = preview.GetProperty("previewToken").GetString(), enable = false }));
        await Expect(AdminMenuKeys.WebsiteLanguages, "PackApplied", "language", "en", "en");
        await OkAsync(e.Site.GetAsync($"{Root}/language-packs/export/en"));
        await AssertStatusAsync(HttpStatusCode.OK, e.Site.GetAsync($"{Root}/language-packs/template"));
        Assert.Equal(4, (await RowsAsync(AdminMenuKeys.WebsiteLanguages)).Count); // export and template recorded nothing

        await CompleteContentAsync("en");
        await OkAsync(e.Site.PostAsync($"{Root}/languages/en/update", new { expectedVersion = await VersionAsync("WebsiteLanguages", "NormalizedCode", "en"), displayName = "English", nativeName = "English", sortOrder = 20, isActive = true }));
        await Expect(AdminMenuKeys.WebsiteLanguages, "Updated", "language", "en", "en");
        await OkAsync(e.Site.PostAsync($"{Root}/languages/en/set-default", new { expectedVersion = await VersionAsync("WebsiteLanguages", "NormalizedCode", "en") }));
        await Expect(AdminMenuKeys.WebsiteLanguages, "DefaultChanged", "language", "en", "en");
        await OkAsync(e.Site.PostAsync($"{Root}/languages/en/set-default", new { expectedVersion = await VersionAsync("WebsiteLanguages", "NormalizedCode", "en") })); // already the default: nothing
        Assert.Equal(6, (await RowsAsync(AdminMenuKeys.WebsiteLanguages)).Count);

        // ---- newsletter-sender: a profile save (the first one creates the row), a connect that lands, a disconnect that changes the connection; a second disconnect changes nothing
        var sender = await OkAsync(e.Site.GetAsync($"{Root}/newsletter-sender"));
        await OkAsync(e.Site.PostAsync($"{Root}/newsletter-sender/profile", new { expectedVersion = sender.GetProperty("version").GetInt32(), senderName = "The BHA", replyTo = "reply-to@example.com" }));
        await Expect(AdminMenuKeys.NewsletterSender, "ProfileSaved", "sender", "newsletter-sender", "Sender settings");
        var (state, _) = await BeginConnectAsync(e);
        Assert.Single(await RowsAsync(AdminMenuKeys.NewsletterSender)); // starting a connection writes nothing
        await OkAsync(e.Site.PostAsync($"{Root}/newsletter-sender/connect/complete", new { state, code = "auth-code-1", error = (string?)null }));
        await Expect(AdminMenuKeys.NewsletterSender, "Connected", "sender", "newsletter-sender", "Gmail sender");
        await OkAsync(e.Site.PostAsync($"{Root}/newsletter-sender/disconnect", new { }));
        await Expect(AdminMenuKeys.NewsletterSender, "Disconnected", "sender", "newsletter-sender", "Gmail sender");
        await OkAsync(e.Site.PostAsync($"{Root}/newsletter-sender/disconnect", new { }));
        Assert.Equal(3, (await RowsAsync(AdminMenuKeys.NewsletterSender)).Count);

        // nothing private reached the history: no address, token, code, client id or secret, no number (a translation row is the language code only, asserted above)
        var everything = string.Join('\n', (await RowsAsync()).Select(r => $"{r.Action}|{r.EntityKind}|{r.EntityKey}|{r.TitleSnapshot}"));
        foreach (var secret in new[] { "@", "sender@gmail.test", "reply-to@example.com", "refresh-token", "auth-code-1", "client-1", "GOCSPX", "25500", "US$" })
        {
            Assert.DoesNotContain(secret, everything);
        }

        // the same total for every stream: events = rows = counter, and one audit per event is not a thing here (website writes have no audit table)
        foreach (var (menuKey, count) in expected)
        {
            Assert.Equal(count, (int)await CounterAsync(menuKey));
        }

        await AssertInvariantsAsync();
    }

    // ---------------------------------------------------------------------------------------------------------- nothing recorded on a refusal

    [Fact]
    public async Task A_refused_stale_invalid_or_no_op_request_records_nothing_and_sends_no_hint()
    {
        var probe = new Probe();
        using var e = await BeginAsync(probe);
        var hero = await OkAsync(e.Site.GetAsync($"{Root}/hero"));
        var menu = await OkAsync(e.Site.GetAsync($"{Root}/menus"));
        var social = await OkAsync(e.Site.GetAsync($"{Root}/social-media"));
        var before = await CountersTextAsync();

        // hero: stale revision 409, invalid font 400, no-op 200, empty and corrupt picture 400
        var stale = HeroBody(hero);
        stale["expectedRevision"] = "stale";
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/hero/save", stale.ToJsonString()));
        var invalid = HeroBody(hero);
        invalid["fontKey"] = "no-such-font";
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/hero/save", invalid.ToJsonString()));
        await AssertStatusAsync(HttpStatusCode.OK, e.Site.PostAsync($"{Root}/hero/save", HeroBody(hero).ToJsonString()));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Client.SendAsync(UploadRequest(e.Site.Cookie, [1, 2, 3, 4])));
        var files = HeroFiles().Length;

        // menus
        var staleMenu = MenuBody(menu);
        staleMenu["expectedRevision"] = "stale";
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/menus/save", staleMenu.ToJsonString()));
        var badLink = MenuBody(menu);
        ((JsonObject)badLink["items"]![0]!)["href"] = "javascript:alert(1)";
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/menus/save", badLink.ToJsonString()));
        await AssertStatusAsync(HttpStatusCode.OK, e.Site.PostAsync($"{Root}/menus/save", MenuBody(menu).ToJsonString()));

        // social: stale 409, invalid phone 400
        var staleSocial = SocialBody(social);
        staleSocial["expectedRevision"] = 99;
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/social-media/save", staleSocial.ToJsonString()));
        var badPhone = SocialBody(social);
        badPhone["phoneEnabled"] = true;
        badPhone["phoneNumber"] = "not a number";
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/social-media/save", badPhone.ToJsonString()));

        // languages: invalid code, duplicate, stale, unknown, delete the default, create "active" (the row is written, then refused: rolled back), set-default of the default
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/languages", new { code = "!!", displayName = "X", nativeName = "X", sortOrder = 1, isActive = false }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/languages", new { code = "vi", displayName = "X", nativeName = "X", sortOrder = 1, isActive = false }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/languages/en/update", new { expectedVersion = 99, displayName = "English", nativeName = "English", sortOrder = 20, isActive = false }));
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Site.PostAsync($"{Root}/languages/zz/update", new { expectedVersion = 1, displayName = "Z", nativeName = "Z", sortOrder = 20, isActive = false }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/languages/vi/delete", new { expectedVersion = 1 }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/languages", new { code = "xx", displayName = "Xx", nativeName = "Xx", sortOrder = 40, isActive = true }));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'xx' """));
        await AssertStatusAsync(HttpStatusCode.OK, e.Site.PostAsync($"{Root}/languages/vi/set-default", new { expectedVersion = 1 }));

        // translations: unknown key, stale, clear on the default language
        await AssertStatusAsync(HttpStatusCode.NotFound, e.Site.PostAsync($"{Root}/translations/save", new { locale = "en", key = "no.such.key", value = "x", expectedVersion = (int?)null }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/translations/clear", new { locale = "vi", key = "customer.header.menu.offers", expectedVersion = 1 }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/translations/save", new { locale = "en", key = "customer.header.menu.offers", value = "Offers", expectedVersion = 99 }));

        // currencies: stale, invalid rate, switch on with no rate, default VND again (no-op), delete the base
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/currencies/USD/update", new { expectedVersion = 99, name = "US dollar", symbol = "$", minorUnits = 2, sortOrder = 20 }));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/currencies/USD/rate", new { expectedVersion = 1, vndPerUnit = "-1" }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/currencies/USD/active", new { expectedVersion = 1, isActive = true }));
        await AssertStatusAsync(HttpStatusCode.OK, e.Site.PostAsync($"{Root}/currencies/VND/set-default", new { expectedVersion = 1 }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/currencies/VND/delete", new { expectedVersion = 1 }));

        // packs: a preview, a stale token, a missing token, the export and the template
        var library = await OkAsync(e.Site.GetAsync($"{Root}/language-packs/library"));
        var pack = library.EnumerateArray().Single(item => item.GetProperty("locale").GetString() == "en").GetProperty("id").GetString();
        await OkAsync(e.Site.PostAsync($"{Root}/language-packs/preview", new { builtInPackId = pack, mode = PackModes.KeepManual }));
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/language-packs/apply", new { builtInPackId = pack, mode = PackModes.KeepManual, previewToken = "stale", enable = false }));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/language-packs/apply", new { builtInPackId = pack, mode = PackModes.KeepManual, enable = false }));
        await OkAsync(e.Site.GetAsync($"{Root}/language-packs/export/en"));
        await AssertStatusAsync(HttpStatusCode.OK, e.Site.GetAsync($"{Root}/language-packs/template"));

        // sender: stale profile 409, invalid name 400, a started connection, an unknown state, a refused one (the user said no), a disconnect with nothing connected
        await AssertStatusAsync(HttpStatusCode.Conflict, e.Site.PostAsync($"{Root}/newsletter-sender/profile", new { expectedVersion = 99, senderName = "x", replyTo = (string?)null }));
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/newsletter-sender/profile", new { expectedVersion = 0, senderName = "bad\nname", replyTo = (string?)null }));
        await BeginConnectAsync(e);
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/newsletter-sender/connect/complete", new { state = new string('a', 43), code = "c", error = (string?)null }));
        var (denied, _) = await BeginConnectAsync(e);
        await AssertStatusAsync(HttpStatusCode.BadRequest, e.Site.PostAsync($"{Root}/newsletter-sender/connect/complete", new { state = denied, code = (string?)null, error = "access_denied" }));
        await AssertStatusAsync(HttpStatusCode.OK, e.Site.PostAsync($"{Root}/newsletter-sender/disconnect", new { }));

        Assert.Equal(before, await CountersTextAsync());
        Assert.Empty(await RowsAsync());
        Assert.Empty(probe.Hints);
        Assert.Equal(files, HeroFiles().Length);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "WebsiteHeroMedia" WHERE "Kind" = 'upload' """));
    }

    // ---------------------------------------------------------------------------------------------------------- one transaction: rollback leaves nothing

    [Fact]
    public async Task A_failing_recorder_rolls_back_the_business_write_the_counter_and_the_hint_and_removes_a_just_written_picture()
    {
        var probe = new Probe();
        using var e = await BeginAsync(probe);
        var hero = await OkAsync(e.Site.GetAsync($"{Root}/hero"));
        var menu = await OkAsync(e.Site.GetAsync($"{Root}/menus"));
        var social = await OkAsync(e.Site.GetAsync($"{Root}/social-media"));
        var library = await OkAsync(e.Site.GetAsync($"{Root}/language-packs/library"));
        var pack = library.EnumerateArray().Single(item => item.GetProperty("locale").GetString() == "en").GetProperty("id").GetString();
        var preview = await OkAsync(e.Site.PostAsync($"{Root}/language-packs/preview", new { builtInPackId = pack, mode = PackModes.KeepManual }));
        var senderVersion = (await OkAsync(e.Site.GetAsync($"{Root}/newsletter-sender"))).GetProperty("version").GetInt32();
        var heroBody = HeroBody(hero);
        heroBody["intervalSeconds"] = hero.GetProperty("intervalSeconds").GetInt32() + 1;
        var menuBody = MenuBody(menu);
        ((JsonObject)menuBody["items"]![0]!)["openInNewTab"] = !((JsonObject)menuBody["items"]![0]!)["openInNewTab"]!.GetValue<bool>();
        var socialBody = SocialBody(social);
        socialBody["backToTopEnabled"] = !social.GetProperty("backToTopEnabled").GetBoolean();
        var fingerprint = async () => (
            await ScalarAsync<string>("""SELECT (SELECT "Version" FROM "WebsiteHero")::text || '/' || (SELECT "Version" FROM "WebsiteMenu")::text || '/' || (SELECT "Version" FROM "WebsiteSocialSettings")::text"""),
            await ScalarAsync<int>("""SELECT count(*)::int FROM "WebsiteLanguages" """),
            await ScalarAsync<int>("""SELECT count(*)::int FROM "WebsiteHeroMedia" """),
            await ScalarAsync<long>("""SELECT sum("Version")::bigint FROM "WebsiteCurrencies" """) + await ScalarAsync<long>("""SELECT sum("Version")::bigint FROM "WebsiteTranslations" """),
            await ScalarAsync<int>("""SELECT count(*)::int FROM "NewsletterSenderSettings" """));
        var before = (await fingerprint(), await CountersTextAsync(), HeroFiles().Length);

        probe.FailRecorder = true;
        var attempts = new (string Name, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("hero save", () => e.Site.PostAsync($"{Root}/hero/save", heroBody.ToJsonString())),
            ("hero upload", () => e.Client.SendAsync(UploadRequest(e.Site.Cookie))),
            ("menus save", () => e.Site.PostAsync($"{Root}/menus/save", menuBody.ToJsonString())),
            ("social save", () => e.Site.PostAsync($"{Root}/social-media/save", socialBody.ToJsonString())),
            ("language create", () => e.Site.PostAsync($"{Root}/languages", new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false })),
            ("translation save", () => e.Site.PostAsync($"{Root}/translations/save", new { locale = "en", key = "customer.header.menu.offers", value = "Offers", expectedVersion = 1 })),
            ("currency rate", () => e.Site.PostAsync($"{Root}/currencies/USD/rate", new { expectedVersion = 1, vndPerUnit = "25500" })),
            ("pack apply", () => e.Site.PostAsync($"{Root}/language-packs/apply", new { builtInPackId = pack, mode = PackModes.KeepManual, previewToken = preview.GetProperty("previewToken").GetString(), enable = false })),
            ("sender profile", () => e.Site.PostAsync($"{Root}/newsletter-sender/profile", new { expectedVersion = senderVersion, senderName = "The BHA", replyTo = (string?)null })),
        };
        foreach (var (name, send) in attempts)
        {
            Assert.True((await send()).StatusCode == HttpStatusCode.InternalServerError, $"{name} must fail whole");
        }

        var (state, _) = await BeginConnectAsync(e);
        Assert.Equal(HttpStatusCode.InternalServerError, (await e.Site.PostAsync($"{Root}/newsletter-sender/connect/complete", new { state, code = "auth-code-1", error = (string?)null })).StatusCode);
        probe.FailRecorder = false;

        Assert.Equal(before, (await fingerprint(), await CountersTextAsync(), HeroFiles().Length)); // business rows, counters and files: exactly as they were
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "NewsletterSenderSettings" WHERE "ConnectedEmail" IS NOT NULL"""));
        Assert.Empty(await RowsAsync());
        Assert.Empty(probe.Hints);

        // and the same operations work once the recorder does
        await OkAsync(e.Site.PostAsync($"{Root}/menus/save", menuBody.ToJsonString()));
        Assert.Equal([AdminMenuKeys.WebsiteMenus], probe.Hints.ToArray());
    }

    /// <summary>The disconnect has its own transaction (an epoch-guarded UPDATE, then the event): a recorder that fails after the counter moved undoes the UPDATE too. Google's revoke is made before it and is outside the rollback.</summary>
    [Fact]
    public async Task A_failing_recorder_rolls_back_a_disconnect_while_Googles_revoke_already_happened()
    {
        var probe = new Probe();
        using var e = await BeginAsync(probe);
        var (state, _) = await BeginConnectAsync(e);
        await OkAsync(e.Site.PostAsync($"{Root}/newsletter-sender/connect/complete", new { state, code = "auth-code-1", error = (string?)null }));
        var sender = () => ScalarAsync<string>("""SELECT "ProtectedRefreshToken" || '|' || "Status" || '|' || "Version" || '|' || "ConnectionEpoch" FROM "NewsletterSenderSettings" """);
        var before = (Sender: await sender(), Counter: await CounterAsync(AdminMenuKeys.NewsletterSender), Actions: (await RowsAsync(AdminMenuKeys.NewsletterSender)).Select(r => r.Action).ToArray(), Hints: probe.Hints.ToArray());
        Assert.Contains("|Connected|", before.Sender, StringComparison.Ordinal); // a non-null token (the concatenation is NULL otherwise) and a connected status
        Assert.Equal(["Connected"], before.Actions);
        Assert.Empty(e.Google.Of("/revoke"));

        probe.FailRecorder = true;
        var answer = await e.Site.PostAsync($"{Root}/newsletter-sender/disconnect", new { });
        probe.FailRecorder = false;

        Assert.Equal(HttpStatusCode.InternalServerError, answer.StatusCode);
        Assert.Single(e.Google.Of("/revoke")); // Google was told before the local transaction, and nothing takes that back
        Assert.Equal(before.Sender, await sender()); // token, status, version and epoch: exactly as before the request
        Assert.Equal(before.Counter, await CounterAsync(AdminMenuKeys.NewsletterSender));
        Assert.Equal(before.Actions, (await RowsAsync(AdminMenuKeys.NewsletterSender)).Select(r => r.Action).ToArray());
        Assert.Equal(before.Hints, probe.Hints.ToArray());
    }

    [Fact]
    public async Task A_picture_whose_commit_answer_is_lost_keeps_its_file_its_row_and_its_event()
    {
        var lost = new LostCommitAnswer();
        var storage = (SpyStorage?)null;
        using var e = await BeginAsync(more: services =>
        {
            InstallLostCommit(services, Factory.ConnectionString, lost);
            var real = services.Single(descriptor => descriptor.ServiceType == typeof(IHeroMediaStorage)).ImplementationInstance!;
            services.RemoveAll<IHeroMediaStorage>();
            storage = new SpyStorage((IHeroMediaStorage)real);
            services.AddSingleton<IHeroMediaStorage>(storage);
        });
        var files = HeroFiles().Length;

        lost.Armed = true;
        var answer = await e.Client.SendAsync(UploadRequest(e.Site.Cookie));
        lost.Armed = false;

        Assert.Equal(HttpStatusCode.InternalServerError, answer.StatusCode);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*)::int FROM "WebsiteHeroMedia" WHERE "Kind" = 'upload' """)); // PostgreSQL did commit …
        Assert.Equal(files + 1, HeroFiles().Length);                                                                          // … so the file it names is kept: whether it landed is unknown to the caller
        Assert.Empty(storage!.Deleted);
        Assert.Equal(1, (await RowsAsync(AdminMenuKeys.WebsiteHero)).Count);
        Assert.Empty(e.Probe.Hints); // the hint follows a COMMIT the caller saw succeed; the 30-second poll makes up for this one
    }

    // ---------------------------------------------------------------------------------------------------------- I/O stays outside the counter lock

    [Fact]
    public async Task A_picture_write_to_disk_and_the_Google_calls_of_a_connection_never_run_while_the_counter_row_is_held()
    {
        var parked = (SpyStorage?)null;
        using var e = await BeginAsync(more: services =>
        {
            var real = services.Single(descriptor => descriptor.ServiceType == typeof(IHeroMediaStorage)).ImplementationInstance!;
            services.RemoveAll<IHeroMediaStorage>();
            parked = new SpyStorage((IHeroMediaStorage)real);
            services.AddSingleton<IHeroMediaStorage>(parked);
        });

        // upload: while the file is being written there is no transaction and no counter row held
        parked!.Parked = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var upload = e.Client.SendAsync(UploadRequest(e.Site.Cookie));
        await parked.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.True(await CounterRowIsFreeAsync(AdminMenuKeys.WebsiteHero));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "WebsiteHeroMedia" WHERE "Kind" = 'upload' """));
        parked.Parked.SetResult(true);
        await AssertStatusAsync(HttpStatusCode.OK, upload);

        // connect: the code exchange and the user-info call happen before the transaction that takes the sender row and the counter
        var (state, _) = await BeginConnectAsync(e);
        var reached = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        e.Google.Hold = async call =>
        {
            if (call.Path.EndsWith("/userinfo", StringComparison.Ordinal))
            {
                reached.TrySetResult(call.Path);
                await release.Task;
            }

            return null;
        };
        var complete = e.Site.PostAsync($"{Root}/newsletter-sender/connect/complete", new { state, code = "auth-code-1", error = (string?)null });
        await reached.Task.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.True(await CounterRowIsFreeAsync(AdminMenuKeys.NewsletterSender));
        release.SetResult(true);
        await AssertStatusAsync(HttpStatusCode.OK, complete);

        // disconnect: the revoke call at Google is made before the local transaction
        var revoking = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var go = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        e.Google.Hold = async call =>
        {
            if (call.Path.EndsWith("/revoke", StringComparison.Ordinal))
            {
                revoking.TrySetResult(call.Path);
                await go.Task;
            }

            return null;
        };
        var disconnect = e.Site.PostAsync($"{Root}/newsletter-sender/disconnect", new { });
        await revoking.Task.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.True(await CounterRowIsFreeAsync(AdminMenuKeys.NewsletterSender));
        go.SetResult(true);
        await AssertStatusAsync(HttpStatusCode.OK, disconnect);
        Assert.Equal(["Connected", "Disconnected"], (await RowsAsync(AdminMenuKeys.NewsletterSender)).Select(r => r.Action).ToArray());
    }

    // ---------------------------------------------------------------------------------------------------------- who sees what, and the watermark of each screen

    [Fact]
    public async Task Another_Staff_sees_each_event_the_actor_does_not_and_acknowledges_the_watermark_the_screen_read_while_Staff_without_website_access_see_nothing()
    {
        using var e = await BeginAsync();
        var actor = await StaffIdAsync(Site);

        // one write per menu by Site
        await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(UploadRequest(e.Site.Cookie)));
        var menu = await OkAsync(e.Site.GetAsync($"{Root}/menus"));
        var menuBody = MenuBody(menu);
        ((JsonObject)menuBody["items"]![0]!)["openInNewTab"] = !((JsonObject)menuBody["items"]![0]!)["openInNewTab"]!.GetValue<bool>();
        await OkAsync(e.Site.PostAsync($"{Root}/menus/save", menuBody.ToJsonString()));
        await AssertStatusAsync(HttpStatusCode.Created, e.Site.PostAsync($"{Root}/languages", new { code = "fr", displayName = "French", nativeName = "Français", sortOrder = 30, isActive = false }));
        await OkAsync(e.Site.PostAsync($"{Root}/translations/save", new { locale = "en", key = "customer.header.menu.offers", value = "Offers", expectedVersion = await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = 'customer.header.menu.offers' AND "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en') """) }));
        await AssertStatusAsync(HttpStatusCode.Created, e.Site.PostAsync($"{Root}/currencies", new { code = "JPY", name = "Yen", symbol = "¥", minorUnits = 0, sortOrder = 40 }));
        var social = await OkAsync(e.Site.GetAsync($"{Root}/social-media"));
        var socialBody = SocialBody(social);
        socialBody["backToTopEnabled"] = !social.GetProperty("backToTopEnabled").GetBoolean();
        await OkAsync(e.Site.PostAsync($"{Root}/social-media/save", socialBody.ToJsonString()));
        await OkAsync(e.Site.PostAsync($"{Root}/newsletter-sender/profile", new { expectedVersion = 0, senderName = "The BHA", replyTo = (string?)null }));
        // a currency deleted straight away: its event stays, with the code as its snapshot
        await AssertStatusAsync(HttpStatusCode.NoContent, e.Site.PostAsync($"{Root}/currencies/JPY/delete", new { expectedVersion = 1 }));

        // the actor counts none of their own; the other website Staff counts each; Desk (no website flag) is told of none and refused every screen
        var own = (await OkAsync(GetAs(e, e.Site.Cookie, Unseen))).GetProperty("menus");
        Assert.All(SevenMenus, menuKey => Assert.Equal(0, own.GetProperty(menuKey).GetProperty("count").GetInt32()));
        var other = (await OkAsync(GetAs(e, e.ManagerCookie, Unseen))).GetProperty("menus");
        Assert.Equal(
            new Dictionary<string, int> { [AdminMenuKeys.WebsiteHero] = 1, [AdminMenuKeys.WebsiteMenus] = 1, [AdminMenuKeys.WebsiteLanguages] = 1, [AdminMenuKeys.WebsiteTranslations] = 1, [AdminMenuKeys.WebsiteCurrencies] = 2, [AdminMenuKeys.WebsiteSocial] = 1, [AdminMenuKeys.NewsletterSender] = 1 },
            SevenMenus.ToDictionary(menuKey => menuKey, menuKey => other.GetProperty(menuKey).GetProperty("count").GetInt32()));
        var deskMenus = (await OkAsync(GetAs(e, e.DeskCookie, Unseen))).GetProperty("menus");
        Assert.All(SevenMenus, menuKey => Assert.False(deskMenus.TryGetProperty(menuKey, out _)));
        foreach (var path in new[] { "/hero", "/menus", "/languages", "/translations?locale=en", "/currencies", "/social-media", "/newsletter-sender", "/language-packs/library" })
        {
            await AssertStatusAsync(HttpStatusCode.Forbidden, GetAs(e, e.DeskCookie, Root + path));
        }

        await AssertStatusAsync(HttpStatusCode.NotFound, GetAs(e, e.DeskCookie, $"{Unseen}/website-hero/changes"));
        var deleted = (await OkAsync(GetAs(e, e.ManagerCookie, $"{Unseen}/website-currencies/changes"))).GetProperty("groups").EnumerateArray().Select(g => (g.GetProperty("action").GetString(), g.GetProperty("titleSnapshot").GetString())).ToList();
        Assert.Contains(("Deleted", "JPY"), deleted);

        // each screen answers the number of its own stream, from the same snapshot as its data: in the body of an object, in X-Admin-View-Watermark for a bare array
        var counters = await CountersAsync();
        var marks = new Dictionary<string, string>();
        async Task<JsonElement> ReadObject(string menuKey, string path)
        {
            var answer = await OkAsync(GetAs(e, e.ManagerCookie, Root + path));
            marks[menuKey] = answer.GetProperty("viewWatermark").GetString()!;
            return answer;
        }

        async Task<JsonElement> ReadArray(string menuKey, string path)
        {
            var response = await AssertStatusAsync(HttpStatusCode.OK, GetAs(e, e.ManagerCookie, Root + path));
            var answer = await JsonAsync(response);
            Assert.Equal(JsonValueKind.Array, answer.ValueKind); // the body an old client reads is unchanged
            marks[menuKey] = Assert.Single(response.Headers.GetValues(Watermark));
            return answer;
        }

        await ReadObject(AdminMenuKeys.WebsiteHero, "/hero");
        await ReadObject(AdminMenuKeys.WebsiteMenus, "/menus");
        await ReadObject(AdminMenuKeys.WebsiteSocial, "/social-media");
        await ReadObject(AdminMenuKeys.NewsletterSender, "/newsletter-sender");
        await ReadObject(AdminMenuKeys.WebsiteTranslations, "/translations?locale=en");
        await ReadArray(AdminMenuKeys.WebsiteLanguages, "/languages");
        await ReadArray(AdminMenuKeys.WebsiteCurrencies, "/currencies");
        Assert.Equal(counters.ToDictionary(pair => pair.Key, pair => pair.Value.ToString()), marks);
        foreach (var mark in marks.Values)
        {
            Assert.Matches("^(0|[1-9][0-9]*)$", mark);
        }

        // the Languages screen also loads the pack library: a bare array with the languages' number
        var libraryResponse = await AssertStatusAsync(HttpStatusCode.OK, GetAs(e, e.ManagerCookie, $"{Root}/language-packs/library"));
        Assert.Equal(marks[AdminMenuKeys.WebsiteLanguages], Assert.Single(libraryResponse.Headers.GetValues(Watermark)));
        Assert.Equal(JsonValueKind.Array, (await JsonAsync(libraryResponse)).ValueKind);

        // the shared "seen" accepts exactly the watermark each screen read, never one above the counter, and the badge empties
        foreach (var menuKey in SevenMenus)
        {
            await AssertStatusAsync(HttpStatusCode.OK, PostAs(e, e.ManagerCookie, $"{Unseen}/{menuKey}/seen", new { viewWatermark = marks[menuKey] }));
        }

        var after = (await OkAsync(GetAs(e, e.ManagerCookie, Unseen))).GetProperty("menus");
        Assert.All(SevenMenus, menuKey => Assert.Equal(0, after.GetProperty(menuKey).GetProperty("count").GetInt32()));
        await AssertStatusAsync(HttpStatusCode.BadRequest, PostAs(e, e.ManagerCookie, $"{Unseen}/website-hero/seen", new { viewWatermark = (counters[AdminMenuKeys.WebsiteHero] + 5).ToString() }));
        Assert.Equal(actor, (await RowsAsync(AdminMenuKeys.WebsiteHero))[0].ActorStaffId);

        // a write's own answer carries none, and neither do the pack's preview, export and template nor the picture bytes
        var saved = await OkAsync(e.Site.PostAsync($"{Root}/social-media/save", SocialBody(await OkAsync(e.Site.GetAsync($"{Root}/social-media"))).ToJsonString()));
        Assert.False(saved.TryGetProperty("viewWatermark", out _));
        var hero = await OkAsync(e.Site.GetAsync($"{Root}/hero"));
        Assert.False((await OkAsync(e.Site.PostAsync($"{Root}/hero/save", HeroBody(hero).ToJsonString()))).TryGetProperty("viewWatermark", out _));
        var exported = await AssertStatusAsync(HttpStatusCode.OK, e.Site.GetAsync($"{Root}/language-packs/export/en"));
        Assert.False(exported.Headers.Contains(Watermark));
    }

    [Fact]
    public async Task The_array_watermark_header_is_exposed_to_the_Admin_origin_on_the_three_array_reads_only()
    {
        using var e = await BeginAsync();
        foreach (var path in new[] { "/languages", "/currencies", "/language-packs/library" })
        {
            var request = Get(Root + path, e.Site.Cookie, AdminOrigin);
            var response = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(request));
            Assert.Contains(Watermark, string.Join(',', response.Headers.GetValues("Access-Control-Expose-Headers")), StringComparison.OrdinalIgnoreCase);
            Assert.Equal(AdminOrigin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        }

        // an object read needs no header, and no other Admin route exposes it
        foreach (var path in new[] { "/hero", "/menus", "/social-media", "/newsletter-sender", "/translations?locale=en" })
        {
            var response = await AssertStatusAsync(HttpStatusCode.OK, e.Client.SendAsync(Get(Root + path, e.Site.Cookie, AdminOrigin)));
            Assert.False(response.Headers.Contains(Watermark));
            Assert.DoesNotContain(Watermark, response.Headers.TryGetValues("Access-Control-Expose-Headers", out var exposed) ? string.Join(',', exposed) : string.Empty, StringComparison.OrdinalIgnoreCase);
        }

        // another origin gets neither the header nor the permission to read it
        var stranger = await e.Client.SendAsync(Get($"{Root}/languages", e.Site.Cookie, "https://evil.example"));
        Assert.False(stranger.Headers.Contains("Access-Control-Allow-Origin"));
    }

    // ---------------------------------------------------------------------------------------------------------- data and watermark come from one snapshot

    private const string CounterRead = "FROM \"MenuActivityStreams\"";

    /// <summary>
    /// A read is paused right after the first statement that contains <paramref name="pauseAfter"/> while another request commits a write, then released; it must still answer the rows and the
    /// watermark of ONE state. Pausing after the COUNTER read catches "rows newer than the watermark"; pausing after a DATA read catches "rows older than the watermark".
    /// </summary>
    private async Task<(HttpResponseMessage Response, long Before, long After)> ReadAcrossAWriteAsync(string menu, string path, string pauseAfter, Func<Env, Task> write)
    {
        var barrier = new ReservationBoardSnapshotBarrierInterceptor(pauseAfter);
        using var e = await BeginAsync(more: services => services.AddScoped(_ => new TheBhaDbContext(
            new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(barrier).Options)));
        var read = GetAs(e, e.Site.Cookie, Root + path);
        await barrier.Reached.WaitAsync(TimeSpan.FromSeconds(30));
        var before = await CounterAsync(menu);
        await write(e);
        var after = await CounterAsync(menu);
        barrier.Release();
        var response = await read;
        Assert.True(after > before, "the write committed while the read was paused");
        return (response, before, after);
    }

    [Theory]
    [InlineData(CounterRead)]                          // paused after the counter: the rows must not be newer than the watermark
    [InlineData("FROM \"WebsiteMenu\"")]          // paused after the rows' first query: the watermark must not be newer than the rows
    public async Task A_menu_read_never_pairs_rows_with_a_watermark_from_another_moment_when_a_write_commits_in_the_middle(string pauseAfter)
    {
        var (response, before, after) = await ReadAcrossAWriteAsync(AdminMenuKeys.WebsiteMenus, "/menus", pauseAfter, async e =>
        {
            // the read is the host's first statement of this text, so this write (a second request) runs unimpeded
            var menu = await OkAsync(e.Site.GetAsync($"{Root}/menus"));
            var body = MenuBody(menu);
            ((JsonObject)body["items"]![0]!)["openInNewTab"] = !((JsonObject)body["items"]![0]!)["openInNewTab"]!.GetValue<bool>();
            await OkAsync(e.Site.PostAsync($"{Root}/menus/save", body.ToJsonString()));
        });
        var body = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, Task.FromResult(response)));

        Assert.Equal(1, body.GetProperty("version").GetInt32());                          // the save committed during the read is not in these rows …
        Assert.Equal(before.ToString(), body.GetProperty("viewWatermark").GetString());   // … and the watermark does not claim it
        Assert.True(long.Parse(body.GetProperty("viewWatermark").GetString()!) < after);
    }

    [Theory]
    [InlineData(CounterRead)]
    [InlineData("FROM \"WebsiteCurrencies\"")]
    public async Task A_currency_read_never_pairs_rows_with_a_watermark_from_another_moment_when_a_write_commits_in_the_middle(string pauseAfter)
    {
        var (response, before, after) = await ReadAcrossAWriteAsync(AdminMenuKeys.WebsiteCurrencies, "/currencies", pauseAfter, async e =>
            await OkAsync(e.Site.PostAsync($"{Root}/currencies/USD/rate", new { expectedVersion = 1, vndPerUnit = "25500" })));
        var ok = await AssertStatusAsync(HttpStatusCode.OK, Task.FromResult(response));
        var rows = await JsonAsync(ok);

        Assert.Equal(JsonValueKind.Null, rows.EnumerateArray().Single(c => c.GetProperty("code").GetString() == "USD").GetProperty("vndPerUnit").ValueKind); // the rate set during the read is not in the rows
        Assert.Equal(before.ToString(), Assert.Single(ok.Headers.GetValues(Watermark)));
        Assert.True(long.Parse(Assert.Single(ok.Headers.GetValues(Watermark))) < after);
    }
}
