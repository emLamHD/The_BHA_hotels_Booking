using SkiaSharp;
using TheBha.Application.Properties;

namespace TheBha.Infrastructure.CatalogMedia;

internal sealed class CatalogImageDecoder : ICatalogImageDecoder
{
    public CatalogImageInfo? Inspect(ReadOnlyMemory<byte> bytes)
    {
        if (bytes.Length == 0 || bytes.Length > CatalogLimits.MaxUploadBytes) return null;
        using var data = SKData.CreateCopy(bytes.Span);
        using var codec = SKCodec.Create(data);
        if (codec is null || codec.EncodedFormat is not (SKEncodedImageFormat.Jpeg or SKEncodedImageFormat.Png or SKEncodedImageFormat.Webp)) return null;
        var info = codec.Info;
        if (info.Width is < 1 or > 8000 || info.Height is < 1 or > 8000 || (long)info.Width * info.Height > 32_000_000 || codec.FrameCount > 1) return null;
        using var pixels = new SKBitmap(info.Width, info.Height, SKColorType.Rgba8888, SKAlphaType.Premul);
        var decodeResult = codec.GetPixels(pixels.Info, pixels.GetPixels());
        if (decodeResult != SKCodecResult.Success) return null;
        return codec.EncodedFormat switch
        {
            SKEncodedImageFormat.Jpeg => new("image/jpeg", "jpg"),
            SKEncodedImageFormat.Png => new("image/png", "png"),
            _ => new("image/webp", "webp")
        };
    }
}
