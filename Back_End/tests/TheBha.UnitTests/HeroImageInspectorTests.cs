using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.UnitTests;

/// <summary>
/// CUST-WEB-HERO-001-CP01: the server decides from the bytes whether an upload is a picture. Real JPEG / PNG / WebP files (made by
/// Pillow, see Fixtures/hero) must be accepted with their true size; damaged, mislabelled, animated, too small, too large and
/// non-picture content must be refused with a machine-readable code.
/// </summary>
public sealed class HeroImageInspectorTests
{
    private static byte[] Fixture(string name) => File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "hero", name));

    [Theory]
    [InlineData("valid.jpg", "image/jpeg", "jpg")]
    [InlineData("valid-progressive.jpg", "image/jpeg", "jpg")]
    [InlineData("valid.png", "image/png", "png")]
    [InlineData("valid-palette.png", "image/png", "png")]
    [InlineData("valid-lossy.webp", "image/webp", "webp")]
    [InlineData("valid-lossless.webp", "image/webp", "webp")]
    [InlineData("valid-alpha.webp", "image/webp", "webp")]
    public void A_real_picture_is_accepted_with_its_type_and_size(string file, string contentType, string extension)
    {
        var check = HeroImageInspector.Inspect(Fixture(file));

        Assert.Null(check.Code);
        Assert.Equal(new HeroImageInfo(contentType, extension, 640, 320), check.Info);
    }

    [Theory]
    [InlineData("valid.jpg")]
    [InlineData("valid.png")]
    [InlineData("valid-lossy.webp")]
    [InlineData("valid-lossless.webp")]
    public void A_picture_cut_short_anywhere_is_damaged(string file)
    {
        var whole = Fixture(file);
        foreach (var length in new[] { 4, 11, 20, whole.Length / 3, whole.Length / 2, whole.Length - 8, whole.Length - 1 })
        {
            var check = HeroImageInspector.Inspect(whole.AsSpan(0, length));

            Assert.Null(check.Info);
            Assert.True(check.Code is HeroErrorCodes.ImageCorrupt or HeroErrorCodes.ImageUnsupported, $"{file} cut to {length}: {check.Code}");
        }
    }

    [Fact]
    public void A_png_with_a_flipped_byte_fails_its_checksum_and_one_with_trailing_data_is_refused()
    {
        var png = Fixture("valid.png");
        var flipped = (byte[])png.Clone();
        flipped[png.Length / 2] ^= 0xFF;

        Assert.Equal(HeroErrorCodes.ImageCorrupt, HeroImageInspector.Inspect(flipped).Code);
        Assert.Equal(HeroErrorCodes.ImageCorrupt, HeroImageInspector.Inspect([.. png, .. "<script>alert(1)</script>"u8.ToArray()]).Code);
    }

    [Fact]
    public void A_webp_whose_riff_size_does_not_match_the_file_is_refused()
    {
        var webp = Fixture("valid-lossy.webp");

        Assert.Equal(HeroErrorCodes.ImageCorrupt, HeroImageInspector.Inspect([.. webp, 0, 0, 0, 0]).Code);
    }

    [Fact]
    public void Magic_bytes_followed_by_garbage_are_not_a_picture()
    {
        var garbage = new byte[2048];
        new Random(7).NextBytes(garbage);
        foreach (var magic in new[] { new byte[] { 0xFF, 0xD8, 0xFF }, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], "RIFF\0\0\0\0WEBP"u8.ToArray() })
        {
            var check = HeroImageInspector.Inspect([.. magic, .. garbage]);

            Assert.Null(check.Info);
            Assert.Equal(HeroErrorCodes.ImageCorrupt, check.Code);
        }
    }

    [Theory]
    [InlineData("picture.gif")]
    [InlineData("animated.webp")]
    [InlineData("animated.apng.png")]
    public void Gif_and_animated_pictures_are_not_supported(string file)
    {
        Assert.Equal(HeroErrorCodes.ImageUnsupported, HeroImageInspector.Inspect(Fixture(file)).Code);
    }

    [Fact]
    public void Markup_and_empty_content_are_refused_whatever_the_file_is_called()
    {
        Assert.Equal(HeroErrorCodes.ImageEmpty, HeroImageInspector.Inspect([]).Code);
        Assert.Equal(HeroErrorCodes.ImageUnsupported, HeroImageInspector.Inspect("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"u8).Code);
        Assert.Equal(HeroErrorCodes.ImageUnsupported, HeroImageInspector.Inspect("<!doctype html><html></html>"u8).Code);
        Assert.Equal(HeroErrorCodes.ImageUnsupported, HeroImageInspector.Inspect("GIF89a"u8).Code);
    }

    [Theory]
    [InlineData("too-small.png")]
    [InlineData("too-wide.png")]
    [InlineData("too-many-pixels.png")]
    public void A_picture_outside_the_size_limits_is_refused_with_its_dimensions(string file)
    {
        var check = HeroImageInspector.Inspect(Fixture(file));

        Assert.Null(check.Info);
        Assert.Equal(HeroErrorCodes.ImageDimensions, check.Code);
    }

    [Fact]
    public void More_than_ten_megabytes_is_refused_before_it_is_read()
    {
        var check = HeroImageInspector.Inspect(new byte[HeroLimits.MaxUploadBytes + 1]);

        Assert.Equal(HeroErrorCodes.ImageTooLarge, check.Code);
    }

    [Fact]
    public void A_jpeg_may_carry_extra_data_after_its_end_marker_but_one_without_an_end_marker_may_not()
    {
        var jpeg = Fixture("valid.jpg");

        Assert.Null(HeroImageInspector.Inspect([.. jpeg, 1, 2, 3]).Code);
        Assert.Equal(HeroErrorCodes.ImageCorrupt, HeroImageInspector.Inspect(jpeg.AsSpan(0, jpeg.Length - 2)).Code);
    }
}
