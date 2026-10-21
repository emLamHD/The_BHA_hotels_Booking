using SkiaSharp;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02: pictures made in the test, so nothing binary is committed. A stored picture is blue with a red marker at its stored top-left and a green one at its
/// stored bottom-right: after an EXIF orientation the red marker shows which corner the picture was turned to.
/// </summary>
internal static class BlogImageFixtures
{
    public static SKBitmap Marked(int width, int height, bool transparentRightHalf = false)
    {
        var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, transparentRightHalf ? SKAlphaType.Premul : SKAlphaType.Opaque));
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(new SKColor(0, 0, 255));
        var marker = Math.Min(width, height) / 4;
        using var red = new SKPaint { Color = new SKColor(255, 0, 0) };
        using var green = new SKPaint { Color = new SKColor(0, 255, 0) };
        canvas.DrawRect(0, 0, marker, marker, red);
        canvas.DrawRect(width - marker, height - marker, marker, marker, green);
        if (transparentRightHalf)
        {
            using var clear = new SKPaint { BlendMode = SKBlendMode.Clear };
            canvas.DrawRect(width / 2f, 0, width - width / 2f, height, clear);
        }

        return bitmap;
    }

    public static byte[] Jpeg(int width, int height, int quality = 92)
    {
        using var bitmap = Marked(width, height);
        using var data = bitmap.Encode(SKEncodedImageFormat.Jpeg, quality);
        return data.ToArray();
    }

    public static byte[] Png(int width, int height, bool transparentRightHalf = false)
    {
        using var bitmap = Marked(width, height, transparentRightHalf);
        using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    public static byte[] Webp(int width, int height)
    {
        using var bitmap = Marked(width, height);
        using var data = bitmap.Encode(SKEncodedImageFormat.Webp, 90);
        return data.ToArray();
    }

    /// <summary>The JPEG with an EXIF segment right after the start-of-image marker: an Orientation tag and, when asked for, a GPS block (latitude/longitude references and a latitude).</summary>
    public static byte[] WithExif(byte[] jpeg, int orientation, bool gps)
    {
        using var tiff = new MemoryStream();
        using (var writer = new BinaryWriter(tiff))
        {
            writer.Write("II"u8.ToArray());
            writer.Write((ushort)42);
            writer.Write(8u);
            writer.Write((ushort)(gps ? 2 : 1));
            writer.Write((ushort)0x0112);
            writer.Write((ushort)3);
            writer.Write(1u);
            writer.Write((ushort)orientation);
            writer.Write((ushort)0);
            if (gps)
            {
                writer.Write((ushort)0x8825);
                writer.Write((ushort)4);
                writer.Write(1u);
                writer.Write(38u);
            }

            writer.Write(0u);
            if (gps)
            {
                writer.Write((ushort)3);
                writer.Write((ushort)1);
                writer.Write((ushort)2);
                writer.Write(2u);
                writer.Write("N\0\0\0"u8.ToArray());
                writer.Write((ushort)2);
                writer.Write((ushort)5);
                writer.Write(3u);
                writer.Write(80u);
                writer.Write((ushort)3);
                writer.Write((ushort)2);
                writer.Write(2u);
                writer.Write("E\0\0\0"u8.ToArray());
                writer.Write(0u);
                foreach (var (numerator, denominator) in new[] { (16u, 1u), (3u, 1u), (0u, 1u) })
                {
                    writer.Write(numerator);
                    writer.Write(denominator);
                }
            }
        }

        var payload = new byte[] { (byte)'E', (byte)'x', (byte)'i', (byte)'f', 0, 0 }.Concat(tiff.ToArray()).ToArray();
        var length = (ushort)(payload.Length + 2);
        return [0xFF, 0xD8, 0xFF, 0xE1, (byte)(length >> 8), (byte)(length & 0xFF), .. payload, .. jpeg.AsSpan(2).ToArray()];
    }

    /// <summary>A WebP whose RIFF frame and VP8 header are sound (so the container check accepts it) and whose bitstream is noise (so a real decode refuses it).</summary>
    public static byte[] WebpWithBrokenBitstream(int width, int height)
    {
        var payload = new byte[200];
        Array.Fill(payload, (byte)0xAB);
        var tag = (100u << 5) | (1u << 4);
        payload[0] = (byte)(tag & 0xFF);
        payload[1] = (byte)((tag >> 8) & 0xFF);
        payload[2] = (byte)((tag >> 16) & 0xFF);
        payload[3] = 0x9D;
        payload[4] = 0x01;
        payload[5] = 0x2A;
        payload[6] = (byte)(width & 0xFF);
        payload[7] = (byte)(width >> 8);
        payload[8] = (byte)(height & 0xFF);
        payload[9] = (byte)(height >> 8);
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream))
        {
            writer.Write("RIFF"u8.ToArray());
            writer.Write((uint)(4 + 8 + payload.Length));
            writer.Write("WEBP"u8.ToArray());
            writer.Write("VP8 "u8.ToArray());
            writer.Write((uint)payload.Length);
            writer.Write(payload);
        }

        return stream.ToArray();
    }

    public static byte[] Noise(int length)
    {
        var bytes = new byte[length];
        new Random(7).NextBytes(bytes);
        return bytes;
    }

    /// <summary>The colour at the centre of the corner block of a decoded picture of the given variant bytes.</summary>
    public static SKColor Corner(SKBitmap picture, bool right, bool bottom)
    {
        var block = Math.Max(2, Math.Min(picture.Width, picture.Height) / 4);
        var x = right ? picture.Width - 1 - block / 2 : block / 2;
        var y = bottom ? picture.Height - 1 - block / 2 : block / 2;
        return picture.GetPixel(x, y);
    }

    public static bool IsRed(SKColor c) => c.Red > 190 && c.Green < 90 && c.Blue < 90;

    public static bool IsBlue(SKColor c) => c.Blue > 190 && c.Red < 90 && c.Green < 90;

    public static bool Contains(byte[] bytes, string ascii) => bytes.AsSpan().IndexOf(System.Text.Encoding.ASCII.GetBytes(ascii)) >= 0;
}
