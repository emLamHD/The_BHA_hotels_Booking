using System.Text.RegularExpressions;
using TheBha.Application.Website;
using TheBha.Domain.Common;
using TheBha.Domain.Website;

namespace TheBha.UnitTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the pure rules behind the website settings — language tags, currency codes, the
/// exchange-rate text, translation text with placeholders, and the invariants of the managed key catalog.
/// </summary>
public sealed class WebsiteRulesTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-15T00:00:00Z");

    [Theory]
    [InlineData("vi", "vi", "vi")]
    [InlineData("EN", "en", "en")]
    [InlineData("en-us", "en-US", "en-us")]
    [InlineData("EN-US", "en-US", "en-us")]
    [InlineData("zh-hans", "zh-Hans", "zh-hans")]
    [InlineData("ZH-HANT-tw", "zh-Hant-TW", "zh-hant-tw")]
    [InlineData("es-419", "es-419", "es-419")]
    [InlineData("  fil  ", "fil", "fil")]
    public void A_language_tag_is_canonicalised_and_case_folded(string input, string canonical, string normalized)
    {
        Assert.True(LanguageTag.TryNormalize(input, out var actualCanonical, out var actualNormalized));
        Assert.Equal(canonical, actualCanonical);
        Assert.Equal(normalized, actualNormalized);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("e")]
    [InlineData("english")]
    [InlineData("en_US")]
    [InlineData("en-USA")]
    [InlineData("en-")]
    [InlineData("-en")]
    [InlineData("en-US-x")]
    [InlineData("en us")]
    [InlineData("123")]
    [InlineData("en-Latn-US-extra")]
    [InlineData("vi;DROP")]
    public void A_malformed_language_tag_is_refused(string? input) =>
        Assert.False(LanguageTag.TryNormalize(input, out _, out _));

    [Theory]
    [InlineData("usd", "USD")]
    [InlineData(" vnd ", "VND")]
    [InlineData("EUR", "EUR")]
    [InlineData("jpy", "JPY")]
    public void A_currency_code_is_upper_cased_and_must_be_an_iso_4217_code(string input, string expected)
    {
        Assert.True(Iso4217.TryNormalize(input, out var code));
        Assert.Equal(expected, code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("US")]
    [InlineData("USDX")]
    [InlineData("ABC")]
    [InlineData("XAU")]
    [InlineData("12A")]
    public void An_unknown_currency_code_is_refused(string input) =>
        Assert.False(Iso4217.TryNormalize(input, out _));

    [Theory]
    [InlineData("25000.5", "25000.5")]
    [InlineData("1", "1")]
    [InlineData("0.5", "0.5")]
    [InlineData("0.00000001", "0.00000001")]
    [InlineData("26105.12345678", "26105.12345678")]
    [InlineData("999999999999.99999999", "999999999999.99999999")]
    [InlineData("1.10", "1.1")]
    public void A_rate_is_parsed_exactly_and_written_back_in_its_shortest_form(string text, string formatted)
    {
        Assert.True(ExchangeRate.TryParse(text, out var rate));
        Assert.Equal(formatted, ExchangeRate.Format(rate));
        Assert.Equal(decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture), rate);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("0")]
    [InlineData("0.0")]
    [InlineData("0.00000000")]
    [InlineData("-1")]
    [InlineData("+1")]
    [InlineData("1e3")]
    [InlineData("1E3")]
    [InlineData("1,000")]
    [InlineData("1 000")]
    [InlineData(" 1")]
    [InlineData("1 ")]
    [InlineData("1,5")]
    [InlineData(".5")]
    [InlineData("5.")]
    [InlineData("00.5")]
    [InlineData("007")]
    [InlineData("NaN")]
    [InlineData("Infinity")]
    [InlineData("abc")]
    [InlineData("1.123456789")]
    [InlineData("1000000000000")]
    [InlineData("1000000000000.5")]
    public void A_rate_that_is_not_a_plain_positive_decimal_within_precision_is_refused(string? text) =>
        Assert.False(ExchangeRate.TryParse(text, out _));

    [Fact]
    public void A_rate_keeps_every_digit_a_double_would_lose()
    {
        Assert.True(ExchangeRate.TryParse("123456789012.12345678", out var rate));
        Assert.Equal(123456789012.12345678m, rate);
        Assert.Equal("123456789012.12345678", ExchangeRate.Format(rate));
        Assert.NotEqual("123456789012.12345678", ((double)rate).ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData("Đã có lỗi khi tải {what}.", "what", null)]
    [InlineData("Loading {what} failed", "what", null)]
    [InlineData("Đóng", "", null)]
    [InlineData("Plain: {not closed", "", "not a placeholder")]
    [InlineData("{what} and {other}", "what", "does not declare")]
    [InlineData("Lost it", "what", "must keep")]
    [InlineData("<b>Đóng</b>", "", "plain text")]
    [InlineData("a > b", "", "plain text")]
    [InlineData("two\nlines", "", "control")]
    [InlineData("", "", "empty")]
    [InlineData("   ", "", "empty")]
    [InlineData("{}", "", "not a placeholder")]
    [InlineData("{1bad}", "", "not a placeholder")]
    public void Translation_text_must_be_plain_and_keep_exactly_its_placeholders(string value, string declared, string? errorContains)
    {
        var placeholders = declared.Length == 0 ? Array.Empty<string>() : declared.Split(',');
        var error = TranslationText.Validate(value, placeholders);
        if (errorContains is null)
        {
            Assert.Null(error);
        }
        else
        {
            Assert.NotNull(error);
            Assert.Contains(errorContains, error, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Translation_text_has_a_length_limit() =>
        Assert.NotNull(TranslationText.Validate(new string('x', WebsiteFieldLimits.TranslationValue + 1), []));

    [Fact]
    public void Input_validation_names_the_field_that_is_wrong()
    {
        Assert.Equal("code", WebsiteInputValidation.Language("english", "English", "English", 1)!.Value.Field);
        Assert.Equal("displayName", WebsiteInputValidation.Language("en", " ", "English", 1)!.Value.Field);
        Assert.Equal("nativeName", WebsiteInputValidation.Language("en", "English", "<b>", 1)!.Value.Field);
        Assert.Equal("sortOrder", WebsiteInputValidation.Language("en", "English", "English", -1)!.Value.Field);
        Assert.Null(WebsiteInputValidation.Language("en-US", "English (US)", "English", 20));

        Assert.Equal("code", WebsiteInputValidation.Currency("ABC", "Name", "$", 2, 1)!.Value.Field);
        Assert.Equal("symbol", WebsiteInputValidation.Currency("USD", "Dollar", "", 2, 1)!.Value.Field);
        Assert.Equal("minorUnits", WebsiteInputValidation.Currency("USD", "Dollar", "$", 5, 1)!.Value.Field);
        Assert.Equal("minorUnits", WebsiteInputValidation.Currency("USD", "Dollar", "$", -1, 1)!.Value.Field);
        Assert.Null(WebsiteInputValidation.Currency("USD", "Dollar", "$", 2, 1));

        Assert.Equal("vndPerUnit", WebsiteInputValidation.Rate("0")!.Value.Field);
        Assert.Equal("expectedVersion", WebsiteInputValidation.Version(0)!.Value.Field);
        Assert.Null(WebsiteInputValidation.Version(1));
    }

    [Fact]
    public void A_language_normalises_its_code_and_every_change_raises_its_version()
    {
        var staff = Guid.NewGuid();
        var language = new WebsiteLanguage(Guid.NewGuid(), "EN-us", " English ", "English", 20, false, Now, staff);

        Assert.Equal("en-US", language.Code);
        Assert.Equal("en-us", language.NormalizedCode);
        Assert.Equal("English", language.DisplayName);
        Assert.False(language.IsDefault);
        Assert.Equal(1, language.Version);

        language.Edit("English (US)", "English", 25, true, Now.AddMinutes(1), staff);
        language.MarkDefault(true, Now.AddMinutes(2), staff);
        Assert.Equal(3, language.Version);
        Assert.True(language.IsDefault);
        Assert.Equal(Now.AddMinutes(2), language.UpdatedAtUtc);
        Assert.Equal(Now, language.CreatedAtUtc);
        Assert.Throws<DomainException>(() => new WebsiteLanguage(Guid.NewGuid(), "english", "x", "x", 1, true, Now, staff));
        Assert.Throws<DomainException>(() => new WebsiteLanguage(Guid.NewGuid(), "en", "x", "x", 10_001, true, Now, staff));
    }

    [Fact]
    public void A_new_currency_is_off_has_no_rate_and_its_rate_must_be_positive()
    {
        var staff = Guid.NewGuid();
        var currency = new WebsiteCurrency("usd", "US dollar", "$", 2, 20, Now, staff);

        Assert.Equal("USD", currency.Code);
        Assert.False(currency.IsActive);
        Assert.False(currency.IsDefault);
        Assert.False(currency.IsBase);
        Assert.False(currency.HasRate);
        Assert.Null(currency.VndPerUnit);
        Assert.Null(currency.RateUpdatedAtUtc);

        Assert.Throws<DomainException>(() => currency.SetRate(0m, Now, staff));
        Assert.Throws<DomainException>(() => currency.SetRate(-1m, Now, staff));
        currency.SetRate(25000.5m, Now.AddHours(1), staff);
        Assert.True(currency.HasRate);
        Assert.Equal(Now.AddHours(1), currency.RateUpdatedAtUtc);
        Assert.Equal(staff, currency.RateUpdatedByStaffId);
        Assert.Equal(WebsiteFieldLimits.ManualRateSource, currency.RateSource);
        Assert.Equal(2, currency.Version);

        Assert.Throws<DomainException>(() => new WebsiteCurrency("ABC", "x", "x", 2, 1, Now, staff));
        Assert.Throws<DomainException>(() => new WebsiteCurrency("USD", "x", "$", 5, 1, Now, staff));
    }

    [Fact]
    public void The_managed_key_catalog_is_consistent()
    {
        var keyPattern = new Regex(@"^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$");
        var catalog = WebsiteTranslationCatalog.All;

        Assert.Equal(catalog.Count, catalog.Select(definition => definition.Key).Distinct(StringComparer.Ordinal).Count());
        Assert.NotEmpty(catalog);
        foreach (var definition in catalog)
        {
            Assert.Matches(keyPattern, definition.Key);
            Assert.Contains(definition.Group, WebsiteTranslationCatalog.Groups);
            Assert.False(string.IsNullOrWhiteSpace(definition.Source), definition.Key);
            // Both seeded texts obey the same rules an operator's edit has to obey.
            Assert.Null(TranslationText.Validate(definition.Vietnamese, definition.Placeholders));
            Assert.Null(TranslationText.Validate(definition.English, definition.Placeholders));
        }

        Assert.Contains(catalog, definition => definition.Placeholders.Count > 0);
        Assert.Equal(catalog.Count, WebsiteTranslationCatalog.ByKey.Count);
    }
}
