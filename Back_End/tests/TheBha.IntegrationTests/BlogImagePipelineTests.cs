using Microsoft.Extensions.DependencyInjection;
using SkiaSharp;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02 acceptance 3: what the pipeline writes is decoded again and measured — format by its own bytes, size, no upscale, orientation, transparency, and
/// no metadata (GPS) — against the real SkiaSharp codecs the API ships. Pictures are made in the test.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogImagePipelineTests(PostgreSqlWebApplicationFactory factory)
{
    private IBlogImagePipeline Pipeline => factory.Services.GetRequiredService<IBlogImagePipeline>();

    private async Task<(BlogProcessedImage? Image, BlogProblem? Problem)> RunAsync(byte[] bytes)
    {
        var check = HeroImageInspector.Inspect(bytes);
        Assert.NotNull(check.Info);
        return await Pipeline.ProcessAsync(bytes, check.Info!, CancellationToken.None);
    }

    private async Task<BlogProcessedImage> ProcessedAsync(byte[] bytes)
    {
        var (image, problem) = await RunAsync(bytes);
        Assert.Null(problem);
        return image!;
    }

    private static string Kind(byte[] bytes) =>
        bytes.Length > 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8) ? "webp"
        : bytes[0] == 0xFF && bytes[1] == 0xD8 ? "jpg"
        : bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }) ? "png"
        : "unknown";

    public static TheoryData<int, bool, bool> Orientations => new()
    {
        // EXIF orientation, then where the stored top-left (the red marker) is shown: right?, bottom?
        { 1, false, false }, { 2, true, false }, { 3, true, true }, { 4, false, true },
        { 5, false, false }, { 6, true, false }, { 7, true, true }, { 8, false, true }
    };

    [Theory]
    [MemberData(nameof(Orientations))]
    public async Task Every_exif_orientation_is_applied_to_every_variant(int orientation, bool right, bool bottom)
    {
        var image = await ProcessedAsync(BlogImageFixtures.WithExif(BlogImageFixtures.Jpeg(640, 320), orientation, gps: false));

        var turned = orientation >= 5;
        Assert.Equal(turned ? (320, 640) : (640, 320), (image.Width, image.Height));
        Assert.Equal(6, image.Variants.Count);
        foreach (var variant in image.Variants)
        {
            using var picture = SKBitmap.Decode(variant.Bytes);
            Assert.Equal((variant.Width, variant.Height), (picture.Width, picture.Height));
            Assert.Equal(turned, picture.Height > picture.Width);
            Assert.True(BlogImageFixtures.IsRed(BlogImageFixtures.Corner(picture, right, bottom)), $"{variant.Preset}.{variant.Format}: the red marker is not in the expected corner");
            Assert.True(BlogImageFixtures.IsBlue(BlogImageFixtures.Corner(picture, !right, bottom)), $"{variant.Preset}.{variant.Format}: the other side is not the background");
        }
    }

    [Fact]
    public async Task Variants_keep_the_ratio_are_never_enlarged_and_are_what_their_format_says()
    {
        var large = await ProcessedAsync(BlogImageFixtures.Jpeg(1500, 1000));
        Assert.Equal([("thumb", "webp"), ("thumb", "jpg"), ("card", "webp"), ("card", "jpg"), ("article", "webp"), ("article", "jpg")], large.Variants.Select(v => (v.Preset, v.Format)));
        Assert.Equal([320, 320, 640, 640, 1280, 1280], large.Variants.Select(v => v.Width));
        Assert.All(large.Variants, v => Assert.InRange(v.Height, Math.Round(v.Width * 2d / 3) - 1, Math.Round(v.Width * 2d / 3) + 1));

        // A picture narrower than a preset keeps its own width: the "article" size of a 700 px picture is 700 px, not 1280.
        var small = await ProcessedAsync(BlogImageFixtures.Jpeg(700, 400));
        Assert.Equal([320, 320, 640, 640, 700, 700], small.Variants.Select(v => v.Width));
        Assert.True(small.Variants.All(v => v.Width <= 700 && v.Height <= 400));

        foreach (var variant in large.Variants.Concat(small.Variants))
        {
            Assert.Equal(variant.Format, Kind(variant.Bytes));
            using var decoded = SKBitmap.Decode(variant.Bytes);
            Assert.Equal((variant.Width, variant.Height), (decoded.Width, decoded.Height));
        }
    }

    [Fact]
    public async Task A_picture_with_real_transparency_keeps_it_and_gets_a_png_fallback()
    {
        var image = await ProcessedAsync(BlogImageFixtures.Png(800, 500, transparentRightHalf: true));
        Assert.Equal(["webp", "png", "webp", "png", "webp", "png"], image.Variants.Select(v => v.Format));
        foreach (var variant in image.Variants)
        {
            using var decoded = SKBitmap.Decode(variant.Bytes);
            Assert.True(decoded.GetPixel(decoded.Width * 3 / 4, decoded.Height / 2).Alpha < 25, $"{variant.Preset}.{variant.Format}: the transparent half lost its transparency");
            Assert.Equal(255, decoded.GetPixel(decoded.Width / 4, decoded.Height / 2).Alpha);
        }
    }

    [Fact]
    public async Task A_png_with_an_alpha_channel_but_no_transparent_pixel_gets_a_jpeg_fallback()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(800, 500, SKColorType.Rgba8888, SKAlphaType.Premul));
        new SKCanvas(bitmap).Clear(new SKColor(0, 0, 255));
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        var image = await ProcessedAsync(encoded.ToArray());
        Assert.Equal(["webp", "jpg", "webp", "jpg", "webp", "jpg"], image.Variants.Select(v => v.Format));
    }

    [Fact]
    public async Task No_variant_carries_exif_or_gps()
    {
        var source = BlogImageFixtures.WithExif(BlogImageFixtures.Jpeg(1200, 800), orientation: 1, gps: true);
        Assert.True(BlogImageFixtures.Contains(source, "Exif"), "the fixture must carry the metadata the variants are meant to lose");

        foreach (var variant in (await ProcessedAsync(source)).Variants)
        {
            Assert.False(BlogImageFixtures.Contains(variant.Bytes, "Exif"), $"{variant.Preset}.{variant.Format} has an Exif block");
            Assert.False(BlogImageFixtures.Contains(variant.Bytes, "EXIF"), $"{variant.Preset}.{variant.Format} has an EXIF chunk");
            Assert.False(variant.Format == "jpg" && ContainsMarker(variant.Bytes, 0xE1), $"{variant.Preset}.{variant.Format} has an APP1 segment");
        }
    }

    private static bool ContainsMarker(byte[] jpeg, byte marker)
    {
        for (var i = 2; i + 3 < jpeg.Length;)
        {
            if (jpeg[i] != 0xFF)
            {
                return false;
            }

            if (jpeg[i + 1] == marker)
            {
                return true;
            }

            if (jpeg[i + 1] == 0xDA)
            {
                return false;
            }

            i += 2 + ((jpeg[i + 2] << 8) | jpeg[i + 3]);
        }

        return false;
    }

    [Fact]
    public void AVIF_is_not_offered_and_the_bundled_encoder_really_cannot_write_it()
    {
        var capabilities = Pipeline.Capabilities;
        Assert.False(capabilities.Avif);
        Assert.Equal(["webp", "jpg", "png"], capabilities.Formats);

        // The evidence behind that answer: asking Skia for AVIF produces nothing, so no "avif" file could ever be real.
        using var bitmap = BlogImageFixtures.Marked(64, 64);
        using var avif = bitmap.Encode(SKEncodedImageFormat.Avif, 60);
        Assert.Null(avif); // if this ever returns bytes, decide to offer AVIF on purpose (design CP02, capabilities), then change this test
    }

    [Fact]
    public async Task A_file_whose_container_is_sound_but_whose_pixels_cannot_be_decoded_is_refused()
    {
        var broken = BlogImageFixtures.WebpWithBrokenBitstream(800, 600);
        Assert.NotNull(HeroImageInspector.Inspect(broken).Info); // the container check alone would let it in

        var (image, problem) = await RunAsync(broken);
        Assert.Null(image);
        Assert.Equal(HeroErrorCodes.ImageCorrupt, problem!.Code);
    }

    [Fact]
    public async Task A_file_that_is_not_the_kind_the_container_check_found_is_refused()
    {
        var png = BlogImageFixtures.Png(800, 500);
        var (image, problem) = await Pipeline.ProcessAsync(png, new HeroImageInfo("image/jpeg", "jpg", 800, 500), CancellationToken.None);
        Assert.Null(image);
        Assert.Equal(HeroErrorCodes.ImageCorrupt, problem!.Code);
    }
}
