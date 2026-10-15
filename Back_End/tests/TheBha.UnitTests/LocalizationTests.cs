using System.Text.Json;
using TheBha.Application.Website;
using TheBha.Domain.Common;
using TheBha.Domain.Website;

namespace TheBha.UnitTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: the language-neutral catalog, the built-in packs, the message syntax, the pack file reader,
/// the display-amount arithmetic and the public problem codes — everything a language pack depends on, without a database.
/// </summary>
public sealed class LocalizationTests
{
    // ---- the shared ICU vectors (the Customer and Admin formatters run the same file)

    public static IEnumerable<object[]> Vectors()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "icu-vectors.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var vector in document.RootElement.GetProperty("vectors").EnumerateArray())
        {
            yield return
            [
                vector.GetProperty("name").GetString()!,
                vector.GetProperty("message").GetString()!,
                vector.TryGetProperty("invalid", out var invalid) && invalid.GetBoolean(),
                vector.TryGetProperty("variables", out var variables) ? string.Join(",", variables.EnumerateArray().Select(item => item.GetString())) : string.Empty
            ];
        }
    }

    [Theory]
    [MemberData(nameof(Vectors))]
    public void The_message_validator_agrees_with_the_shared_vectors(string name, string message, bool invalid, string variables)
    {
        var analysis = IcuMessage.Analyze(message);
        Assert.True(invalid != analysis.IsValid, $"{name}: {analysis.Error}");
        if (!invalid)
        {
            Assert.Equal(variables, string.Join(",", analysis.Variables));
        }
    }

    [Theory]
    [InlineData("Đóng", new string[0], null)]
    [InlineData("Đã có lỗi khi tải {what}.", new[] { "what" }, null)]
    [InlineData("{count, plural, one {# đêm} other {# đêm}}", new[] { "count" }, null)]
    public void A_text_with_exactly_the_declared_variables_is_accepted(string text, string[] declared, string? expected) =>
        Assert.Equal(expected, TranslationText.Validate(text, declared));

    [Theory]
    [InlineData("Đã có lỗi khi tải.", "what")]                    // lost a variable
    [InlineData("Đã có lỗi khi tải {what} {who}.", "what")]       // added one
    [InlineData("<b>Đóng</b>", "")]                               // markup
    [InlineData("Đóng {", "")]                                    // broken message
    [InlineData("", "")]
    [InlineData("{n, plural, one {#}}", "n")]                     // no `other`
    public void A_text_that_breaks_a_rule_is_refused(string text, string declared) =>
        Assert.NotNull(TranslationText.Validate(text, declared.Length == 0 ? [] : declared.Split(',')));

    // ---- the catalog and the built-in packs

    [Fact]
    public void The_catalog_is_language_neutral_unique_and_well_formed()
    {
        var catalog = LocalizationAssets.Catalog;
        Assert.NotEmpty(catalog);
        Assert.Equal(catalog.Count, catalog.Select(definition => definition.Key).Distinct(StringComparer.Ordinal).Count());
        foreach (var definition in catalog)
        {
            Assert.Matches(@"^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9][a-zA-Z0-9_-]*)+$", definition.Key);
            Assert.StartsWith(definition.Scope + ".", definition.Key, StringComparison.Ordinal);
            Assert.True(definition.Key.Length <= WebsiteFieldLimits.TranslationKey, definition.Key);
        }

        Assert.Contains(catalog, definition => definition.Placeholders.Count > 0);
    }

    [Fact]
    public void Every_built_in_pack_covers_the_whole_catalog_with_valid_texts_that_keep_each_keys_variables()
    {
        Assert.True(LocalizationAssets.BuiltInPacks.Count >= 3);
        Assert.Contains(LocalizationAssets.BuiltInPacks, pack => pack.Locale == "vi");
        Assert.Contains(LocalizationAssets.BuiltInPacks, pack => pack.Locale == "en");
        Assert.Contains(LocalizationAssets.BuiltInPacks, pack => pack.Locale == "fr");
        foreach (var pack in LocalizationAssets.BuiltInPacks)
        {
            var texts = pack.All.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
            var missing = LocalizationAssets.Catalog.Where(definition => !texts.ContainsKey(definition.Key)).Select(definition => definition.Key).ToList();
            Assert.True(missing.Count == 0, $"{pack.Locale} lacks {missing.Count} catalog keys, e.g. {string.Join(", ", missing.Take(5))}");
            foreach (var (key, text) in texts.Where(pair => LocalizationAssets.CatalogByKey.ContainsKey(pair.Key)))
            {
                var error = TranslationText.Validate(text, LocalizationAssets.CatalogByKey[key].Placeholders);
                Assert.True(error is null, $"{pack.Locale} {key}: {error}");
            }

            Assert.All(texts.Keys.Where(key => !LocalizationAssets.CatalogByKey.ContainsKey(key)), key => Assert.StartsWith("content.", key, StringComparison.Ordinal));
        }
    }

    [Fact]
    public void A_built_in_pack_translates_rather_than_copies_the_reference_language()
    {
        var reference = LocalizationAssets.BuiltInPack("vi")!.All.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        foreach (var locale in new[] { "en", "fr" })
        {
            var pack = LocalizationAssets.BuiltInPack(locale)!;
            var identical = pack.All.Where(pair => reference.TryGetValue(pair.Key, out var source) && source == pair.Value && pair.Value.Count(char.IsLetter) > 12).ToList();
            // A handful of proper names and codes may legitimately be the same in two languages; a copy of the reference is not.
            Assert.True(identical.Count <= Math.Max(8, reference.Count / 40), $"{locale} repeats {identical.Count} texts of the reference language, e.g. {identical.FirstOrDefault().Key}");
        }
    }

    [Fact]
    public void The_catalog_revision_changes_with_the_catalog_and_the_built_in_packs_are_listed_by_locale()
    {
        Assert.Matches("^[0-9a-f]{16}$", LocalizationAssets.CatalogRevision);
        Assert.Equal(LocalizationAssets.BuiltInPacks.Count, LocalizationAssets.BuiltInPacks.Select(pack => pack.Locale).Distinct().Count());
    }

    [Theory]
    [InlineData("content.roomType.a3000000-0000-0000-0000-000000000001.name", "roomType", "a3000000-0000-0000-0000-000000000001", "name")]
    [InlineData("content.post.a-slug.section.p1", "post", "a-slug", "section.p1")]
    public void A_content_key_is_entity_id_field_and_never_a_position(string key, string entity, string id, string field)
    {
        Assert.True(ContentKey.TryParse(key, out var parsedEntity, out var parsedId, out var parsedField));
        Assert.Equal((entity, id, field), (parsedEntity, parsedId, parsedField));
        Assert.Equal(key, ContentKey.For(entity, id, field));
    }

    [Theory]
    [InlineData("customer.header.menu.offers")]
    [InlineData("content.roomType")]
    [InlineData("content..x.y")]
    public void Anything_that_is_not_a_content_key_is_not_parsed_as_one(string key) =>
        Assert.False(ContentKey.TryParse(key, out _, out _, out _));

    // ---- the pack file reader

    private static string Pack(string locale = "es", string extra = "", string messages = """{"customer":{"customer.header.menu.offers":"Ofertas"}}""") =>
        $$"""
        { "schema": "bha.language-pack/1", "locale": "{{locale}}", "displayName": "Spanish", "nativeName": "Español", "direction": "ltr",
          "formatLocale": "es-ES", "defaultCurrency": "EUR", "pack": { "id": "x", "version": "1" }, "referenceLocale": "vi",
          "messages": {{messages}}, "content": {} {{extra}} }
        """;

    [Fact]
    public void A_well_formed_pack_is_read_as_data()
    {
        var parsed = LanguagePackParser.Parse(Pack());
        Assert.True(parsed.IsValid, string.Join("; ", parsed.Issues.Select(issue => issue.Message)));
        var pack = parsed.Pack!;
        Assert.Equal(("es", "Español", "ltr", "es-ES", "EUR"), (pack.Locale, pack.NativeName, pack.Direction, pack.FormatLocale, pack.DefaultCurrency));
        Assert.Equal("Ofertas", pack.Messages["customer.header.menu.offers"]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{"schema":"other/1"}""")]
    public void A_file_that_is_not_a_pack_is_refused_with_a_reason(string json)
    {
        var parsed = LanguagePackParser.Parse(json);
        Assert.False(parsed.IsValid);
        Assert.NotEmpty(parsed.Issues);
    }

    [Fact]
    public void Identity_namespace_and_key_mistakes_are_reported_per_item()
    {
        Assert.Contains(LanguagePackParser.Parse(Pack(locale: "not a tag")).Issues, issue => issue.Code == "locale");
        Assert.Contains(LanguagePackParser.Parse(Pack(messages: """{"other":{"other.x":"y"}}""")).Issues, issue => issue.Code == "namespace");
        Assert.Contains(LanguagePackParser.Parse(Pack(messages: """{"customer":{"admin.x":"y"}}""")).Issues, issue => issue.Key == "admin.x" && issue.Code == "key");
        Assert.Contains(LanguagePackParser.Parse(Pack(messages: """{"customer":{"customer.x":5}}""")).Issues, issue => issue.Key == "customer.x" && issue.Code == "shape");
    }

    [Fact]
    public void A_pack_is_data_not_code_so_script_like_content_is_just_text_the_validator_refuses_later()
    {
        // The parser keeps it as a string (it never evaluates anything); the preview refuses '<' and '>' per key.
        var parsed = LanguagePackParser.Parse(Pack(messages: """{"customer":{"customer.x":"<script>alert(1)</script>"}}"""));
        Assert.True(parsed.IsValid);
        Assert.NotNull(TranslationText.Validate(parsed.Pack!.Messages["customer.x"], []));
    }

    [Fact]
    public void A_text_remembers_which_reference_text_it_was_made_from()
    {
        Assert.Equal(SourceText.Hash("Đóng"), SourceText.Hash("  Đóng "));
        Assert.NotEqual(SourceText.Hash("Đóng"), SourceText.Hash("Đóng lại"));
        Assert.Equal(16, SourceText.Hash("x").Length);
    }

    // ---- display amounts

    [Theory]
    [InlineData("1089000", "26060", 2, "41.79")]
    [InlineData("1000000", "26060", 2, "38.37")]
    [InlineData("1000000", "29748.26", 2, "33.62")]
    [InlineData("1000000", "1", 0, "1000000")]
    [InlineData("500", "26060", 2, "0.02")]
    [InlineData("1", "26060", 2, "0.00")]
    public void An_amount_is_converted_in_exact_decimals_and_rounded_to_the_minor_units(string vnd, string rate, int minor, string expected) =>
        Assert.Equal(expected, DisplayAmount.Format(DisplayAmount.Convert(decimal.Parse(vnd), decimal.Parse(rate), minor), minor));

    [Fact]
    public void A_midpoint_rounds_away_from_zero_not_to_even()
    {
        Assert.Equal(0.13m, DisplayAmount.Convert(2.5m, 20m, 2));   // 0.125 -> 0.13
        Assert.Equal(0.14m, DisplayAmount.Convert(2.7m, 20m, 2));   // 0.135 -> 0.14
    }

    [Fact]
    public void A_zero_or_negative_rate_is_refused()
    {
        Assert.Throws<DomainException>(() => DisplayAmount.Convert(1m, 0m, 2));
        Assert.Throws<DomainException>(() => DisplayAmount.Convert(1m, -1m, 2));
    }

    [Theory]
    [InlineData("1000000", true)]
    [InlineData("1000000.5", true)]
    [InlineData("0.99", true)]
    [InlineData("1.234", false)]
    [InlineData("-1", false)]
    [InlineData("1e3", false)]
    [InlineData("", false)]
    [InlineData("abc", false)]
    public void Only_a_plain_non_negative_vnd_amount_with_at_most_two_decimals_is_accepted(string text, bool accepted) =>
        Assert.Equal(accepted, DisplayAmount.TryParseVnd(text, out _));
}
