using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.UnitTests;

/// <summary>CUST-WEB-HERO-001-CP01: what a hero Save may contain, before any database is involved.</summary>
public sealed class HeroRulesTests
{
    private static readonly IReadOnlySet<string> Codes = new HashSet<string> { "vi", "en", "fr" };
    private static readonly string[] Required = ["vi"];

    private static Dictionary<string, string?> Text(string vi = "Xin chào") => new() { ["vi"] = vi };

    private static HeroSlideInput Slide(Guid? id = null, Guid? media = null, string focal = "50% 50%") =>
        new(id ?? Guid.NewGuid(), media ?? Guid.NewGuid(), focal, Text("Ảnh"), Text("Chú thích"));

    private static SaveHeroCommand Command(
        string font = HeroFonts.Default, int interval = 6, IReadOnlyList<HeroSlideInput>? slides = null, HeroTextsDto? texts = null) =>
        new("r", font, true, interval, texts ?? new HeroTextsDto(Text(), Text(), Text("Tìm phòng"), Text("Xem")), slides ?? [Slide()], Guid.NewGuid());

    [Fact]
    public void A_complete_hero_has_no_problem()
    {
        Assert.Null(HeroRules.Validate(Command(slides: [Slide(), Slide()]), Codes, Required));
    }

    [Theory]
    [InlineData("Comic Sans")]
    [InlineData("url(https://evil.example/font.woff)")]
    [InlineData("")]
    [InlineData("DEFAULT")]
    public void Only_a_listed_font_is_accepted(string font)
    {
        Assert.Equal(HeroErrorCodes.FontInvalid, HeroRules.Validate(Command(font: font), Codes, Required)?.Code);
    }

    [Theory]
    [InlineData(HeroFonts.Default)]
    [InlineData(HeroFonts.BeVietnamPro)]
    [InlineData(HeroFonts.SystemSans)]
    [InlineData(HeroFonts.SystemSerif)]
    public void Every_listed_font_is_accepted(string font)
    {
        Assert.Null(HeroRules.Validate(Command(font: font), Codes, Required));
    }

    [Theory]
    [InlineData(2, false)]
    [InlineData(3, true)]
    [InlineData(6, true)]
    [InlineData(60, true)]
    [InlineData(61, false)]
    [InlineData(0, false)]
    [InlineData(-5, false)]
    public void The_interval_is_three_to_sixty_seconds(int seconds, bool accepted)
    {
        var problem = HeroRules.Validate(Command(interval: seconds), Codes, Required);

        Assert.Equal(accepted, problem is null);
        Assert.True(accepted || problem!.Code == HeroErrorCodes.IntervalInvalid && problem.Field == "intervalSeconds");
    }

    [Fact]
    public void A_slideshow_has_between_one_and_ten_slides()
    {
        Assert.Equal(HeroErrorCodes.SlideCount, HeroRules.Validate(Command(slides: []), Codes, Required)?.Code);
        Assert.Null(HeroRules.Validate(Command(slides: [.. Enumerable.Range(0, 10).Select(_ => Slide())]), Codes, Required));
        Assert.Equal(HeroErrorCodes.SlideCount, HeroRules.Validate(Command(slides: [.. Enumerable.Range(0, 11).Select(_ => Slide())]), Codes, Required)?.Code);
    }

    [Fact]
    public void A_slide_appears_once_and_needs_a_picture_and_a_focal_position()
    {
        var same = Guid.NewGuid();
        Assert.Equal(HeroErrorCodes.DuplicateSlide, HeroRules.Validate(Command(slides: [Slide(same), Slide(same)]), Codes, Required)?.Code);
        Assert.Equal(HeroErrorCodes.MediaMissing, HeroRules.Validate(Command(slides: [Slide() with { MediaId = Guid.Empty }]), Codes, Required)?.Code);
        foreach (var focal in new[] { "", "50%", "50% 50% 50%", "101% 0%", "a% b%", "50% 50%; background:url(x)" })
        {
            Assert.Equal(HeroErrorCodes.FocalInvalid, HeroRules.Validate(Command(slides: [Slide(focal: focal)]), Codes, Required)?.Code);
        }
    }

    [Fact]
    public void A_text_is_plain_required_in_the_source_language_and_within_its_length()
    {
        var withTitle = (string vi) => Command(texts: new HeroTextsDto(Text(vi), Text(), Text("Tìm phòng"), Text("Xem")));

        Assert.Equal(HeroErrorCodes.TextRequired, HeroRules.Validate(withTitle(""), Codes, Required)?.Code);
        Assert.Equal("texts.title.vi", HeroRules.Validate(withTitle("  "), Codes, Required)?.Field);
        Assert.Equal(HeroErrorCodes.TextInvalid, HeroRules.Validate(withTitle("<b>Hi</b>"), Codes, Required)?.Code);
        Assert.Equal(HeroErrorCodes.TextInvalid, HeroRules.Validate(withTitle("two\nlines"), Codes, Required)?.Code);
        Assert.Equal(HeroErrorCodes.TextInvalid, HeroRules.Validate(withTitle(new string('a', HeroLimits.MaxTitle + 1)), Codes, Required)?.Code);
        Assert.Null(HeroRules.Validate(withTitle(new string('a', HeroLimits.MaxTitle)), Codes, Required));
    }

    [Fact]
    public void A_text_in_an_unknown_language_is_refused_and_a_missing_optional_language_is_not()
    {
        var unknown = Command(texts: new HeroTextsDto(
            new Dictionary<string, string?> { ["vi"] = "Xin chào", ["zz"] = "?" }, Text(), Text("Tìm phòng"), Text("Xem")));

        Assert.Equal(HeroErrorCodes.UnknownLocale, HeroRules.Validate(unknown, Codes, Required)?.Code);
        Assert.Null(HeroRules.Validate(Command(), Codes, ["vi"]));
        Assert.Equal(HeroErrorCodes.TextRequired, HeroRules.Validate(Command(), Codes, ["vi", "en"])?.Code);
    }

    [Fact]
    public void Each_slide_needs_its_own_alt_and_caption()
    {
        var noAlt = Slide() with { Alt = new Dictionary<string, string?> { ["vi"] = "" } };
        var noCaption = Slide() with { Caption = null };

        Assert.Equal("slides[0].alt.vi", HeroRules.Validate(Command(slides: [noAlt]), Codes, Required)?.Field);
        Assert.Equal("slides[0].caption.vi", HeroRules.Validate(Command(slides: [noCaption]), Codes, Required)?.Field);
    }
}
