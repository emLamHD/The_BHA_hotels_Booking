using TheBha.Application.Website;

namespace TheBha.UnitTests;

public sealed class WebsiteSocialRulesTests
{
    private static SaveWebsiteSocialCommand Command(string? phone = "0899474888", bool phoneOn = true, string? messenger = null,
        bool messengerOn = false, string? zalo = null, bool zaloOn = false) =>
        new(1, phoneOn, phone, messengerOn, messenger, zaloOn, zalo, true, Guid.NewGuid());

    [Theory]
    [InlineData("0899474888")]
    [InlineData("+84 899 474 888")]
    public void Normalizes_vietnam_phone_and_zalo(string number)
    {
        var problem = WebsiteSocialRules.Validate(Command(number, zalo: number, zaloOn: true), out var value);
        Assert.Null(problem);
        Assert.Equal("0899474888", value!.PhoneNumber);
        Assert.Equal("tel:+84899474888", value.PhoneHref);
        Assert.Equal("https://zalo.me/0899474888", value.ZaloUrl);
    }

    [Theory]
    [InlineData("https://m.me/thebha")]
    [InlineData("https://www.messenger.com/t/123456")]
    [InlineData("https://messenger.com/t/the.bha")]
    public void Accepts_supported_messenger_chat_links(string link)
    {
        Assert.Null(WebsiteSocialRules.Validate(Command(messenger: link, messengerOn: true), out var value));
        Assert.Equal(link, value!.MessengerUrl);
    }

    [Theory]
    [InlineData("http://m.me/thebha")]
    [InlineData("https://m.me.evil/thebha")]
    [InlineData("https://m.me/")]
    [InlineData("https://www.messenger.com/home")]
    [InlineData("https://user:pass@m.me/thebha")]
    [InlineData("https://m.me/thebha?next=x")]
    [InlineData("javascript:alert(1)")]
    [InlineData("//m.me/thebha")]
    [InlineData("https://m.me\\@evil.test/thebha")]
    public void Rejects_unsafe_or_non_chat_messenger_links(string link)
    {
        Assert.Equal("messengerUrl", WebsiteSocialRules.Validate(Command(messenger: link, messengerOn: true), out _)!.Field);
    }

    [Fact]
    public void Disabled_channels_may_be_empty()
    {
        Assert.Null(WebsiteSocialRules.Validate(Command(phone: "", phoneOn: false), out var value));
        Assert.Equal(string.Empty, value!.PhoneHref);
    }

    [Fact]
    public void Enabled_channel_requires_destination()
    {
        Assert.Equal("messengerUrl", WebsiteSocialRules.Validate(Command(messengerOn: true), out _)!.Field);
        Assert.Equal("zaloNumber", WebsiteSocialRules.Validate(Command(zaloOn: true), out _)!.Field);
    }

    [Theory]
    [InlineData("012345678")]
    [InlineData("01234567890")]
    [InlineData("*09899474888")]
    [InlineData("tel:+84899474888")]
    public void Rejects_non_vietnamese_or_scheme_phone_input(string number)
    {
        Assert.Equal("phoneNumber", WebsiteSocialRules.Validate(Command(phone: number), out _)!.Field);
    }
}
