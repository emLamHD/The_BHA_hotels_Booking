using System.Text.RegularExpressions;
using TheBha.Application.Notifications;

namespace TheBha.UnitTests;

/// <summary>BHA-CHECKOUT-001-PR07 (M-06): the booking templates and display rules without a database: VI/EN/FR, locale fallback, escaping, formats, and the settings.</summary>
public sealed partial class BookingConfirmationEmailUnitTests
{
    private static EmailTemplateRenderer Renderer() => new([new BookingGuestEmailTemplate(), new BookingAccountEmailTemplate(), new BookingStaffEmailTemplate()]);

    [GeneratedRegex(@"\{\{[A-Za-z]+\}\}")]
    private static partial Regex Placeholder();

    private static Dictionary<string, string> Model(string notice = "notice") => new()
    {
        ["confirmationNumber"] = "BHA-123", ["propertyName"] = "Riverside <b>&\"", ["propertyAddress"] = "1 <i>Dock</i>", ["guestName"] = "A <script>x</script>",
        ["checkIn"] = "26/07/2026", ["checkOut"] = "27/07/2026", ["checkInTime"] = "14:00", ["rooms"] = "2", ["adults"] = "2", ["children"] = "0",
        ["totalAmount"] = "1.500.000 VND", ["manageNotice"] = notice
    };

    [Theory]
    [InlineData(BookingEmailPurposes.GuestTemplate)]
    [InlineData(BookingEmailPurposes.AccountTemplate)]
    [InlineData(BookingEmailPurposes.StaffTemplate)]
    public void Each_template_renders_in_every_locale_with_every_placeholder_filled_and_html_escaped(string key)
    {
        var renderer = Renderer();
        foreach (var locale in new[] { "vi", "en", "fr" })
        {
            var mail = renderer.Render(key, locale, Model());
            Assert.Equal(locale, mail.ResolvedLocale);
            Assert.DoesNotMatch(Placeholder(), mail.Subject + mail.Text + mail.Html);
            Assert.Contains("BHA-123", mail.Subject);
            Assert.Contains("Riverside <b>&\"", mail.Text);
            Assert.Contains("Riverside &lt;b&gt;&amp;&quot;", mail.Html);
            Assert.DoesNotContain("<script>", mail.Html);
            Assert.DoesNotContain("A <script>", mail.Subject); // the guest's name is in the body only
        }
    }

    [Theory]
    [InlineData("vi", "Thanh toán khi nhận phòng")]
    [InlineData("en", "Pay at the property on arrival")]
    [InlineData("fr", "Paiement à l'établissement à l'arrivée")]
    public void The_guest_mail_carries_the_pay_at_property_label_in_its_locale(string locale, string label)
    {
        var mail = Renderer().Render(BookingEmailPurposes.GuestTemplate, locale, Model());
        Assert.Contains(label, mail.Text);
        Assert.Contains("14:00", mail.Text);
        Assert.Contains("1.500.000 VND", mail.Text);
    }

    [Theory]
    [InlineData(null, "vi")]
    [InlineData("", "vi")]
    [InlineData("de", "vi")]
    [InlineData("en-GB", "en")]
    [InlineData("fr_CA", "fr")]
    public void A_missing_or_unknown_locale_falls_back_to_vietnamese(string? requested, string expected) =>
        Assert.Equal(expected, Renderer().Render(BookingEmailPurposes.StaffTemplate, requested, Model()).ResolvedLocale);

    [Fact]
    public void A_line_break_in_a_value_never_reaches_the_subject()
    {
        var model = Model();
        model["propertyName"] = "Riverside\r\nBcc: x@y.z";
        var mail = Renderer().Render(BookingEmailPurposes.StaffTemplate, "vi", model);
        Assert.DoesNotContain("\n", mail.Subject);
        Assert.DoesNotContain("\r", mail.Subject);
    }

    [Fact]
    public void The_staff_mail_has_no_link_phone_or_address_placeholder_of_the_guest()
    {
        foreach (var locale in new[] { "vi", "en", "fr" })
        {
            var text = ((IEmailTemplate)new BookingStaffEmailTemplate()).Locales[locale];
            Assert.DoesNotContain("manageNotice", text.Subject + text.Text + text.Html);
            Assert.DoesNotContain("email", (text.Subject + text.Text + text.Html).ToLowerInvariant().Replace("e-mail", string.Empty));
        }
    }

    [Theory]
    [InlineData(1500000, "VND", "vi", "1.500.000 VND")]
    [InlineData(1500000, "VND", "en", "1,500,000 VND")]
    [InlineData(1500000, "VND", "fr", "1 500 000 VND")]
    [InlineData(999, "VND", "vi", "999 VND")]
    [InlineData(1234.5, "USD", "en", "1,234.50 USD")]
    [InlineData(1500000.50, "VND", "vi", "1.500.000,50 VND")] // a confirmed amount with decimals is shown as it is, never rounded to whole dong
    [InlineData(1500000.50, "VND", "en", "1,500,000.50 VND")]
    [InlineData(1500000.50, "VND", "fr", "1\u202f500\u202f000,50 VND")]
    [InlineData(1500000.49, "VND", "vi", "1.500.000,49 VND")]
    [InlineData(0.5, "VND", "vi", "0,50 VND")]
    [InlineData(2500000.00, "VND", "vi", "2.500.000 VND")] // scale 2 but whole: no decimals. (Never repeat a row under another spelling: 1500000 and 1500000.00 print the same test name, and the CI gate counts names.)
    public void Money_is_written_by_hand_so_every_host_prints_the_same(decimal amount, string currency, string locale, string expected) =>
        Assert.Equal(expected, BookingEmailFormat.Money(amount, currency, locale));

    [Fact]
    public void Dates_and_times_are_fixed_width()
    {
        Assert.Equal("05/01/2027", BookingEmailFormat.Date(new DateOnly(2027, 1, 5)));
        Assert.Equal("09:05", BookingEmailFormat.Time(new TimeOnly(9, 5)));
    }

    [Theory]
    [InlineData("https://riverside.example", "https://riverside.example")]
    [InlineData(" https://riverside.example/ ", "https://riverside.example")]
    [InlineData("https://localhost:3000", "https://localhost:3000")]
    public void A_valid_origin_is_normalised(string configured, string expected) =>
        Assert.Equal(expected, new BookingConfirmationEmailOptions { CustomerWebOrigin = configured }.NormalizedOrigin());

    [Theory]
    [InlineData("http://riverside.example")]
    [InlineData("https://riverside.example/app")]
    [InlineData("https://riverside.example/?x=1")]
    [InlineData("https://riverside.example/#f")]
    [InlineData("https://user@riverside.example")]
    [InlineData("riverside.example")]
    public void A_configured_origin_that_is_not_an_https_origin_is_refused(string configured) =>
        Assert.Throws<InvalidOperationException>(() => new BookingConfirmationEmailOptions { CustomerWebOrigin = configured }.NormalizedOrigin());

    [Fact]
    public void It_is_active_only_with_the_switch_an_origin_and_a_configured_provider()
    {
        var outbox = new EmailOutboxOptions();
        Assert.False(new BookingConfirmationEmailOptions { Enabled = true, CustomerWebOrigin = "https://a.example" }.IsActive(outbox)); // no provider
        outbox.Resend.ApiKey = "k";
        outbox.Resend.FromAddress = "from@a.example";
        Assert.False(new BookingConfirmationEmailOptions { Enabled = false, CustomerWebOrigin = "https://a.example" }.IsActive(outbox));
        Assert.False(new BookingConfirmationEmailOptions { Enabled = true }.IsActive(outbox));
        Assert.True(new BookingConfirmationEmailOptions { Enabled = true, CustomerWebOrigin = "https://a.example" }.IsActive(outbox));
        Assert.False(new BookingConfirmationEmailOptions().IsActive(outbox)); // default
    }

    [Fact]
    public void The_management_url_keeps_the_secret_in_the_fragment_with_a_D_format_id()
    {
        var id = Guid.Parse("0a1b2c3d-0000-4000-8000-000000000001");
        var url = ReservationManagementUrl.Build("https://a.example", id, "SECRET");
        Assert.Equal("https://a.example/reservations/0a1b2c3d-0000-4000-8000-000000000001/manage#SECRET", url);
        var parsed = new Uri(url);
        Assert.Equal(string.Empty, parsed.Query);
        Assert.Equal("#SECRET", parsed.Fragment);
    }
}
