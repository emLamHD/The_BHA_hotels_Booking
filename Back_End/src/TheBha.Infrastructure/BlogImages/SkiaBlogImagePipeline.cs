using SkiaSharp;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.BlogImages;

/// <summary>
/// BHA-BLOG-001-CP02: the Blog image pipeline on SkiaSharp (MIT; its native assets are already shipped with the API). It decodes the picture for real
/// (the container check before it cannot see damaged pixel data), converts to sRGB, applies the EXIF orientation by drawing straight into each preset
/// (no full-size rotated copy) and writes WebP plus a JPEG (or PNG, when the picture really has transparency) per preset. Skia writes no metadata, so a
/// variant carries no EXIF/GPS. At most <see cref="BlogMediaLimits.MaxConcurrentDecodes"/> pictures are decoded at once: a decode holds width × height × 4
/// bytes (160 MB at the 40 MP limit), so the worst case is that many times 160 MB plus the small presets.
/// </summary>
internal sealed class SkiaBlogImagePipeline : IBlogImagePipeline
{
    private const int WebpQuality = 82;
    private const int JpegQuality = 85;

    private readonly SemaphoreSlim slots = new(BlogMediaLimits.MaxConcurrentDecodes);

    public BlogImageCapabilities Capabilities { get; } = new(
        [BlogMediaFormats.Webp, BlogMediaFormats.Jpeg, BlogMediaFormats.Png],
        Avif: false,
        "Lossy WebP for every preset plus a JPEG (PNG when the picture has transparency). The bundled Skia has no AVIF encoder, so AVIF is not produced.");

    public async Task<(BlogProcessedImage? Image, BlogProblem? Problem)> ProcessAsync(ReadOnlyMemory<byte> original, HeroImageInfo expected, CancellationToken cancellationToken)
    {
        await slots.WaitAsync(cancellationToken);
        try
        {
            return Process(original, expected, cancellationToken);
        }
        finally
        {
            slots.Release();
        }
    }

    private static (BlogProcessedImage?, BlogProblem?) Process(ReadOnlyMemory<byte> original, HeroImageInfo expected, CancellationToken cancellationToken)
    {
        using var data = SKData.CreateCopy(original.Span);
        using var codec = SKCodec.Create(data);
        var format = codec?.EncodedFormat switch
        {
            SKEncodedImageFormat.Jpeg => "image/jpeg",
            SKEncodedImageFormat.Png => "image/png",
            SKEncodedImageFormat.Webp => "image/webp",
            _ => null
        };
        if (codec is null || format is null || format != expected.ContentType)
        {
            return (null, Problem(HeroErrorCodes.ImageCorrupt, "The file is not the picture it claims to be."));
        }

        var info = codec.Info;
        if (codec.FrameCount > 1)
        {
            return (null, Problem(HeroErrorCodes.ImageUnsupported, "Animated pictures are not accepted."));
        }

        if (info.Width is < 1 or > HeroLimits.MaxSide || info.Height is < 1 or > HeroLimits.MaxSide || (long)info.Width * info.Height > HeroLimits.MaxPixels)
        {
            return (null, Problem(HeroErrorCodes.ImageDimensions, "The picture is larger than the accepted size."));
        }

        using var srgb = SKColorSpace.CreateSrgb();
        var decodeInfo = new SKImageInfo(info.Width, info.Height, SKColorType.Rgba8888, info.AlphaType == SKAlphaType.Opaque ? SKAlphaType.Opaque : SKAlphaType.Premul, srgb);
        using var source = new SKBitmap(decodeInfo);
        if (codec.GetPixels(decodeInfo, source.GetPixels()) != SKCodecResult.Success)
        {
            return (null, Problem(HeroErrorCodes.ImageCorrupt, "The picture is damaged or incomplete."));
        }

        var hasAlpha = decodeInfo.AlphaType != SKAlphaType.Opaque && HasTransparency(source);
        var origin = codec.EncodedOrigin;
        var (width, height) = Oriented(origin, info.Width, info.Height);

        var variants = new List<BlogProcessedVariant>();
        foreach (var preset in BlogMediaPresets.All)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var targetWidth = Math.Min(preset.MaxWidth, width);
            var targetHeight = Math.Max(1, (int)Math.Round((double)height * targetWidth / width));
            using var target = Render(source, origin, info.Width, info.Height, width, height, targetWidth, targetHeight, hasAlpha, srgb);
            variants.Add(Encode(target, preset.Name, BlogMediaFormats.Webp, SKEncodedImageFormat.Webp, WebpQuality));
            variants.Add(hasAlpha
                ? Encode(target, preset.Name, BlogMediaFormats.Png, SKEncodedImageFormat.Png, 100)
                : Encode(target, preset.Name, BlogMediaFormats.Jpeg, SKEncodedImageFormat.Jpeg, JpegQuality));
        }

        return (new BlogProcessedImage(width, height, variants), null);
    }

    private static BlogProblem Problem(string code, string message) => new(code, "file", message);

    private static bool HasTransparency(SKBitmap bitmap)
    {
        var pixels = bitmap.GetPixelSpan();
        for (var i = 3; i < pixels.Length; i += 4)
        {
            if (pixels[i] != 255)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>EXIF orientations 5–8 turn the picture on its side: the shown width is the stored height.</summary>
    internal static (int Width, int Height) Oriented(SKEncodedOrigin origin, int width, int height) =>
        origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom ? (height, width) : (width, height);

    /// <summary>The affine map (x' = a·x + b·y + c, y' = d·x + e·y + f) from a stored pixel position to its shown position, for a stored picture of <paramref name="w"/> × <paramref name="h"/>.</summary>
    internal static (float A, float B, float C, float D, float E, float F) OrientationMap(SKEncodedOrigin origin, int w, int h) => origin switch
    {
        SKEncodedOrigin.TopRight => (-1, 0, w, 0, 1, 0),
        SKEncodedOrigin.BottomRight => (-1, 0, w, 0, -1, h),
        SKEncodedOrigin.BottomLeft => (1, 0, 0, 0, -1, h),
        SKEncodedOrigin.LeftTop => (0, 1, 0, 1, 0, 0),
        SKEncodedOrigin.RightTop => (0, -1, h, 1, 0, 0),
        SKEncodedOrigin.RightBottom => (0, -1, h, -1, 0, w),
        SKEncodedOrigin.LeftBottom => (0, 1, 0, -1, 0, w),
        _ => (1, 0, 0, 0, 1, 0)
    };

    private static SKBitmap Render(
        SKBitmap source, SKEncodedOrigin origin, int sourceWidth, int sourceHeight, int shownWidth, int shownHeight, int targetWidth, int targetHeight, bool hasAlpha, SKColorSpace srgb)
    {
        var target = new SKBitmap(new SKImageInfo(targetWidth, targetHeight, SKColorType.Rgba8888, hasAlpha ? SKAlphaType.Premul : SKAlphaType.Opaque, srgb));
        using var canvas = new SKCanvas(target);
        canvas.Clear(hasAlpha ? SKColors.Transparent : SKColors.White);
        var (a, b, c, d, e, f) = OrientationMap(origin, sourceWidth, sourceHeight);
        float kx = (float)targetWidth / shownWidth, ky = (float)targetHeight / shownHeight;
        canvas.SetMatrix(new SKMatrix { ScaleX = a * kx, SkewX = b * kx, TransX = c * kx, SkewY = d * ky, ScaleY = e * ky, TransY = f * ky, Persp2 = 1 });
        using var image = SKImage.FromBitmap(source);
        canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        return target;
    }

    private static BlogProcessedVariant Encode(SKBitmap target, string preset, string format, SKEncodedImageFormat skia, int quality)
    {
        using var encoded = target.Encode(skia, quality) ?? throw new InvalidOperationException($"The {format} encoder produced nothing.");
        return new BlogProcessedVariant(preset, format, target.Width, target.Height, encoded.ToArray());
    }
}
