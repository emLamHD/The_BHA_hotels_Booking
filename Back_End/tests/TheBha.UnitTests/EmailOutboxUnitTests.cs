using TheBha.Application.Notifications;
using TheBha.Domain.Common;
using TheBha.Domain.Notifications;

namespace TheBha.UnitTests;

/// <summary>BHA-CHECKOUT-001-PR03 (E-05, E-06): the pure parts of the outbox, without a database or a network: the render contract, the retry clock and the settings.</summary>
public sealed class EmailOutboxUnitTests
{
    private sealed class Synthetic(string key, string defaultLocale, params string[] locales) : IEmailTemplate
    {
        public string Key => key;
        public string DefaultLocale => defaultLocale;
        public IReadOnlyDictionary<string, EmailTemplateText> Locales { get; } = locales.ToDictionary(
            locale => locale, locale => new EmailTemplateText($"[{locale}] Hello {{{{name}}}}", $"{locale}: hi {{{{name}}}}", $"<p>{locale}: hi {{{{name}}}}</p>"));
    }

    private static EmailTemplateRenderer Renderer() => new([new Synthetic("synthetic.greeting", "en", "vi", "en", "fr")]);

    private static readonly Dictionary<string, string> Model = new() { ["name"] = "An <b>& Co" };

    [Theory]
    [InlineData("vi", "vi")]
    [InlineData("en", "en")]
    [InlineData("fr", "fr")]
    [InlineData("FR", "fr")]
    [InlineData("fr-CA", "fr")]
    [InlineData("vi_VN", "vi")]
    [InlineData("de", "en")]
    [InlineData("", "en")]
    [InlineData(null, "en")]
    public void The_locale_is_the_exact_one_else_the_language_else_the_default(string? requested, string expected)
    {
        Assert.Equal(expected, Renderer().Render("synthetic.greeting", requested, Model).ResolvedLocale);
    }

    [Fact]
    public void A_render_is_deterministic_encodes_html_and_keeps_the_subject_on_one_line()
    {
        var first = Renderer().Render("synthetic.greeting", "fr", Model);
        var second = Renderer().Render("synthetic.greeting", "fr", Model);
        Assert.Equal(first, second);
        Assert.Contains("An &lt;b&gt;&amp; Co", first.Html);
        Assert.Contains("An <b>& Co", first.Text);
        var subject = Renderer().Render("synthetic.greeting", "fr", new Dictionary<string, string> { ["name"] = "A\r\nB" }).Subject;
        Assert.DoesNotContain('\r', subject);
        Assert.DoesNotContain('\n', subject);
    }

    [Fact]
    public void An_unknown_template_a_missing_value_or_a_template_without_its_default_locale_is_an_error_never_a_hole()
    {
        var renderer = Renderer();
        Assert.Throws<EmailTemplateException>(() => renderer.Render("nope", "en", Model));
        Assert.Throws<EmailTemplateException>(() => renderer.Render("synthetic.greeting", "en", new Dictionary<string, string>()));
        Assert.Throws<InvalidOperationException>(() => new EmailTemplateRenderer([new Synthetic("bad", "de", "en")]));
        Assert.Throws<InvalidOperationException>(() => new EmailTemplateRenderer([new Synthetic("dup", "en", "en"), new Synthetic("dup", "en", "en")]));
    }

    [Fact]
    public void Retry_delay_doubles_from_the_base_up_to_the_cap_and_is_never_zero()
    {
        var options = new EmailOutboxOptions { RetryBaseSeconds = 30, RetryMaxSeconds = 1800 };
        var delays = Enumerable.Range(1, 9).Select(attempt => EmailRetryPolicy.Delay(attempt, null, options).TotalSeconds).ToArray();
        Assert.Equal([30d, 60, 120, 240, 480, 960, 1800, 1800, 1800], delays);
        Assert.All(delays, delay => Assert.True(delay > 0));
        Assert.Equal(1800, EmailRetryPolicy.Delay(int.MaxValue, null, options).TotalSeconds); // no overflow
    }

    [Fact]
    public void Retry_After_can_lengthen_a_delay_up_to_its_own_cap_and_never_shorten_it()
    {
        var options = new EmailOutboxOptions { RetryBaseSeconds = 30, RetryMaxSeconds = 1800, RetryAfterMaxSeconds = 3600 };
        Assert.Equal(600, EmailRetryPolicy.Delay(1, TimeSpan.FromSeconds(600), options).TotalSeconds);
        Assert.Equal(3600, EmailRetryPolicy.Delay(1, TimeSpan.FromDays(3), options).TotalSeconds);
        Assert.Equal(60, EmailRetryPolicy.Delay(2, TimeSpan.FromSeconds(1), options).TotalSeconds);
        Assert.Equal(30, EmailRetryPolicy.Delay(1, TimeSpan.FromSeconds(-5), options).TotalSeconds);
    }

    [Fact]
    public void Everything_is_off_by_default_and_the_default_settings_are_valid()
    {
        var options = new EmailOutboxOptions();
        options.Validate();
        Assert.False(options.DispatchEnabled);
        Assert.False(options.WorkerEnabled);
        Assert.False(options.Resend.IsConfigured);
        Assert.Equal("https://api.resend.com", options.Resend.BaseUrl);
        Assert.True(options.IdempotencyWindowMinutes < 24 * 60);
    }

    [Theory]
    [InlineData(nameof(EmailOutboxOptions.LeaseSeconds), 30)] // lease must outlast the 20 s provider call by 15 s
    [InlineData(nameof(EmailOutboxOptions.IdempotencyWindowMinutes), 24 * 60)] // the provider's own 24 h, with no buffer
    [InlineData(nameof(EmailOutboxOptions.IdempotencyWindowMinutes), 0)]
    [InlineData(nameof(EmailOutboxOptions.MaxAttempts), 0)]
    [InlineData(nameof(EmailOutboxOptions.BatchSize), 501)]
    [InlineData(nameof(EmailOutboxOptions.RetryBaseSeconds), 0)]
    public void A_setting_that_cannot_work_stops_the_host(string setting, int value)
    {
        var options = new EmailOutboxOptions();
        typeof(EmailOutboxOptions).GetProperty(setting)!.SetValue(options, value);
        Assert.Throws<InvalidOperationException>(options.Validate);
    }

    [Theory]
    [InlineData("http://api.resend.com")]
    [InlineData("ftp://x")]
    [InlineData("not a url")]
    public void The_provider_address_must_be_https_and_http_only_for_a_loopback_stub(string baseUrl)
    {
        Assert.Throws<InvalidOperationException>(new ResendOptions { BaseUrl = baseUrl }.Validate);
        new ResendOptions { BaseUrl = "http://127.0.0.1:5999" }.Validate();
    }

    [Theory]
    [InlineData("a@b.example", true)]
    [InlineData("a b@c.example", false)]
    [InlineData("a@b.example\r\nBcc: x@y.example", false)]
    [InlineData("a@b", false)]
    [InlineData("", false)]
    public void An_address_is_one_plain_address_so_a_header_cannot_be_injected(string value, bool valid) => Assert.Equal(valid, EmailText.IsAddress(value));

    [Fact]
    public void An_event_is_validated_when_it_is_built()
    {
        var now = DateTimeOffset.UnixEpoch;
        _ = new EmailOutboxEvent(Guid.NewGuid(), "reservation.confirmed", 1, Guid.NewGuid(), "{}", now);
        Assert.Throws<DomainException>(() => new EmailOutboxEvent(Guid.Empty, "t", 1, Guid.NewGuid(), "{}", now));
        Assert.Throws<DomainException>(() => new EmailOutboxEvent(Guid.NewGuid(), " ", 1, Guid.NewGuid(), "{}", now));
        Assert.Throws<DomainException>(() => new EmailOutboxEvent(Guid.NewGuid(), "t", 0, Guid.NewGuid(), "{}", now));
        Assert.Throws<DomainException>(() => new EmailOutboxEvent(Guid.NewGuid(), "t", 1, Guid.Empty, "{}", now));
    }
}
