using TheBha.Domain.Blog;

namespace TheBha.UnitTests;

/// <summary>BHA-BLOG-001-CP02: the pure picture-library rules — descriptive fields, focal point, presets, formats and how a picture's own version moves.</summary>
public sealed class BlogMediaDomainTests
{
    private static readonly Guid Staff = Guid.NewGuid();
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-21T00:00:00Z");

    private static BlogMedia Picture() => new(
        Guid.NewGuid(), "blog/" + new string('a', 32) + ".jpg", "image/jpeg", 10, 800, 600, "name", "name.jpg", new string('0', 64), Staff, Now, []);

    [Fact]
    public void A_picture_starts_centred_at_version_one_and_in_the_current_generation()
    {
        var picture = Picture();
        Assert.Equal((0.5, 0.5, 1, BlogMediaLimits.CurrentGeneration, true), (picture.FocalX, picture.FocalY, picture.Version, picture.Generation, picture.IsProcessed));
    }

    [Theory]
    [InlineData(0, 0, true)]
    [InlineData(1, 1, true)]
    [InlineData(0.4999, 0.5001, true)]
    [InlineData(-0.0001, 0.5, false)]
    [InlineData(0.5, 1.0001, false)]
    [InlineData(double.NaN, 0.5, false)]
    [InlineData(0.5, double.PositiveInfinity, false)]
    public void The_focal_point_is_a_position_inside_the_picture(double x, double y, bool valid)
    {
        var problem = BlogMediaRules.CheckMetadata("name", "", "", "", "", x, y);
        Assert.Equal(valid, problem is null);
        Assert.True(valid || problem!.Field == "focalX");
    }

    [Fact]
    public void Updating_the_description_moves_the_version_rounds_the_focal_point_and_records_who()
    {
        var picture = Picture();
        var later = Now.AddMinutes(5);
        var editor = Guid.NewGuid();

        picture.UpdateDescription("Biển", "Mô tả", "Ảnh: Linh", "https://example.com/a", "CC BY 4.0", 0.123456, 0.987654, editor, later);

        Assert.Equal((2, 0.1235, 0.9877, "Biển", editor, later), (picture.Version, picture.FocalX, picture.FocalY, picture.DisplayName, picture.UpdatedByStaffId, picture.UpdatedAtUtc));
    }

    [Fact]
    public void The_backfill_adds_variants_and_the_generation_but_leaves_the_version_alone()
    {
        var picture = Picture();
        picture.UpdateDescription("name", "", "", "", "", 0.2, 0.3, Staff, Now);
        var versionBefore = picture.Version;

        picture.CompleteProcessing(600, 800, new string('f', 64), [new BlogMediaVariant(Guid.NewGuid(), picture.Id, "thumb", "webp", "blog/" + new string('b', 32) + ".webp", 300, 400, 5, new string('1', 64))]);

        Assert.Equal((versionBefore, 600, 800, new string('f', 64), 1), (picture.Version, picture.Width, picture.Height, picture.OriginalSha256, picture.Variants.Count));
        Assert.Equal((0.2, 0.3), (picture.FocalX, picture.FocalY));
    }

    [Theory]
    [InlineData("", "", "", "", "", "displayName")]
    [InlineData("<b>x</b>", "", "", "", "", "displayName")]
    [InlineData("x", "a\nb", "", "", "", "description")]
    [InlineData("x", "", "a<b", "", "", "credit")]
    [InlineData("x", "", "", "", "a>b", "licence")]
    [InlineData("x", "", "", "http://example.com", "", "sourceUrl")]
    [InlineData("x", "", "", "ftp://example.com", "", "sourceUrl")]
    [InlineData("x", "", "", "//example.com", "", "sourceUrl")]
    [InlineData("x", "", "", "https://exa mple.com", "", "sourceUrl")]
    [InlineData("x", "", "", "javascript:alert(1)", "", "sourceUrl")]
    public void A_text_is_plain_and_the_source_is_an_https_address(string name, string description, string credit, string sourceUrl, string licence, string field)
    {
        var problem = BlogMediaRules.CheckMetadata(name, description, credit, sourceUrl, licence, 0.5, 0.5);
        Assert.Equal((BlogErrorCodes.Validation, field), (problem!.Code, problem.Field));
    }

    [Fact]
    public void The_limits_are_enforced_at_their_edge()
    {
        string Of(int length) => new('a', length);
        Assert.Null(BlogMediaRules.CheckMetadata(Of(BlogMediaLimits.DisplayName), Of(BlogMediaLimits.Description), Of(BlogMediaLimits.Credit), "https://e.co/" + Of(BlogMediaLimits.SourceUrl - 13), Of(BlogMediaLimits.Licence), 0.5, 0.5));
        Assert.Equal("displayName", BlogMediaRules.CheckMetadata(Of(BlogMediaLimits.DisplayName + 1), "", "", "", "", 0.5, 0.5)!.Field);
        Assert.Equal("description", BlogMediaRules.CheckMetadata("x", Of(BlogMediaLimits.Description + 1), "", "", "", 0.5, 0.5)!.Field);
        Assert.Equal("credit", BlogMediaRules.CheckMetadata("x", "", Of(BlogMediaLimits.Credit + 1), "", "", 0.5, 0.5)!.Field);
        Assert.Equal("licence", BlogMediaRules.CheckMetadata("x", "", "", "", Of(BlogMediaLimits.Licence + 1), 0.5, 0.5)!.Field);
        Assert.Equal("sourceUrl", BlogMediaRules.CheckMetadata("x", "", "", "https://e.co/" + Of(BlogMediaLimits.SourceUrl - 12), "", 0.5, 0.5)!.Field);
    }

    [Fact]
    public void The_presets_are_three_finite_widths_and_the_formats_are_the_three_the_pipeline_writes()
    {
        Assert.Equal([("thumb", 320), ("card", 640), ("article", 1280)], BlogMediaPresets.All.Select(p => (p.Name, p.MaxWidth)));
        Assert.True(BlogMediaPresets.IsKnown("card"));
        Assert.All(new string?[] { "huge", "CARD", "", null, "card.webp" }, name => Assert.False(BlogMediaPresets.IsKnown(name)));

        Assert.All(new[] { "webp", "jpg", "png" }, format => Assert.True(BlogMediaFormats.IsKnown(format)));
        Assert.All(new string?[] { "avif", "gif", "jpeg", "WEBP", null }, format => Assert.False(BlogMediaFormats.IsKnown(format)));
        Assert.Equal(["image/webp", "image/jpeg", "image/png"], new[] { "webp", "jpg", "png" }.Select(BlogMediaFormats.ContentType));
        Assert.Equal([false, true, true], new[] { "webp", "jpg", "png" }.Select(BlogMediaFormats.IsFallback));
    }
}
