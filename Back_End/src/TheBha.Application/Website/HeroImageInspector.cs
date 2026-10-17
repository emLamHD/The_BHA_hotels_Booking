using System.Buffers.Binary;
using System.IO.Compression;
using TheBha.Domain.Website;

namespace TheBha.Application.Website;

public sealed record HeroImageInfo(string ContentType, string Extension, int Width, int Height);

public sealed record HeroImageCheck(HeroImageInfo? Info, string? Code, string? Message)
{
    public static HeroImageCheck Ok(HeroImageInfo info) => new(info, null, null);

    public static HeroImageCheck Fail(string code, string message) => new(null, code, message);
}

/// <summary>
/// CUST-WEB-HERO-001-CP01: decides from the bytes alone — never the file name or the client's media type — whether an upload is a
/// picture the site can show: JPEG, PNG or still WebP, structurally complete, within the size and pixel limits. No dependency: the
/// parser reads the container (JPEG markers up to the end-of-image marker, PNG chunks with their CRC and a bounded inflate of the
/// pixel data, the WebP RIFF frame and its VP8/VP8L/VP8X header). It does not decode JPEG or WebP pixels, so a file whose container
/// is sound but whose compressed data is damaged is still accepted; a truncated, mislabelled, animated or oversized file is not.
/// What follows a JPEG's end-of-image marker (camera extensions) is not inspected; the file is served with a fixed content type
/// and <c>nosniff</c>, so it cannot be run as anything but a picture.
/// </summary>
public static class HeroImageInspector
{
    public static HeroImageCheck Inspect(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0)
        {
            return HeroImageCheck.Fail(HeroErrorCodes.ImageEmpty, "The file is empty.");
        }

        if (data.Length > HeroLimits.MaxUploadBytes)
        {
            return HeroImageCheck.Fail(HeroErrorCodes.ImageTooLarge, "The picture is larger than 10 MB.");
        }

        var parsed = data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8
            ? Jpeg(data)
            : data.Length >= 8 && data[..8].SequenceEqual(PngSignature)
                ? Png(data)
                : data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8)
                    ? WebP(data)
                    : Unsupported();
        if (parsed.Info is not { } info)
        {
            return parsed;
        }

        if (info.Width < HeroLimits.MinWidth || info.Height < HeroLimits.MinHeight)
        {
            return HeroImageCheck.Fail(HeroErrorCodes.ImageDimensions, $"The picture is {info.Width}×{info.Height}; the smallest accepted is {HeroLimits.MinWidth}×{HeroLimits.MinHeight}.");
        }

        if (info.Width > HeroLimits.MaxSide || info.Height > HeroLimits.MaxSide || (long)info.Width * info.Height > HeroLimits.MaxPixels)
        {
            return HeroImageCheck.Fail(
                HeroErrorCodes.ImageDimensions,
                $"The picture is {info.Width}×{info.Height}; at most {HeroLimits.MaxSide} on a side and {HeroLimits.MaxPixels / 1_000_000} megapixels are accepted.");
        }

        return parsed;
    }

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private static HeroImageCheck Unsupported() =>
        HeroImageCheck.Fail(HeroErrorCodes.ImageUnsupported, "Only JPEG, PNG and WebP pictures are accepted.");

    private static HeroImageCheck Corrupt(string what) =>
        HeroImageCheck.Fail(HeroErrorCodes.ImageCorrupt, $"The picture is damaged or incomplete ({what}).");

    // ------------------------------------------------------------------ JPEG

    private static HeroImageCheck Jpeg(ReadOnlySpan<byte> data)
    {
        int width = 0, height = 0;
        var sawFrame = false;
        var position = 2;
        while (true)
        {
            // A marker is 0xFF then a code; extra 0xFF bytes before it are fill.
            while (position < data.Length && data[position] == 0xFF && position + 1 < data.Length && data[position + 1] == 0xFF)
            {
                position++;
            }

            if (position + 1 >= data.Length || data[position] != 0xFF)
            {
                return Corrupt("no end of image");
            }

            var marker = data[position + 1];
            position += 2;
            if (marker == 0xD9)
            {
                return sawFrame ? HeroImageCheck.Ok(new HeroImageInfo("image/jpeg", "jpg", width, height)) : Corrupt("no frame");
            }

            if (marker is 0x00 or 0x01 or 0xD8 || marker is >= 0xD0 and <= 0xD7)
            {
                if (marker is 0x00 or 0xD8)
                {
                    return Corrupt("unexpected marker");
                }

                continue;
            }

            if (position + 2 > data.Length)
            {
                return Corrupt("cut short");
            }

            var length = BinaryPrimitives.ReadUInt16BigEndian(data[position..]);
            if (length < 2 || position + length > data.Length)
            {
                return Corrupt("cut short");
            }

            var segment = data.Slice(position + 2, length - 2);
            if (marker is 0xC0 or 0xC1 or 0xC2)
            {
                if (sawFrame || segment.Length < 6 || segment[5] == 0)
                {
                    return Corrupt("bad frame header");
                }

                height = BinaryPrimitives.ReadUInt16BigEndian(segment[1..]);
                width = BinaryPrimitives.ReadUInt16BigEndian(segment[3..]);
                if (width == 0 || height == 0)
                {
                    return Corrupt("zero size");
                }

                sawFrame = true;
            }
            else if (marker is >= 0xC3 and <= 0xCF && marker is not (0xC4 or 0xC8 or 0xCC))
            {
                return Unsupported();
            }
            else if (marker == 0xDA)
            {
                if (!sawFrame)
                {
                    return Corrupt("scan before frame");
                }

                // Entropy-coded data: 0xFF 0x00 is a stuffed byte, 0xFF 0xD0–D7 a restart, 0xFF 0xFF fill; any other marker ends the scan.
                position += length;
                while (position + 1 < data.Length)
                {
                    if (data[position] != 0xFF)
                    {
                        position++;
                        continue;
                    }

                    var next = data[position + 1];
                    if (next == 0x00 || next is >= 0xD0 and <= 0xD7)
                    {
                        position += 2;
                    }
                    else if (next == 0xFF)
                    {
                        position++;
                    }
                    else
                    {
                        break;
                    }
                }

                continue;
            }

            position += length;
        }
    }

    // ------------------------------------------------------------------ PNG

    private static HeroImageCheck Png(ReadOnlySpan<byte> data)
    {
        var position = 8;
        int width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
        var sawHeader = false;
        var sawPalette = false;
        var sawEnd = false;
        using var pixels = new MemoryStream();
        var firstChunk = true;
        while (position + 12 <= data.Length)
        {
            var length = BinaryPrimitives.ReadUInt32BigEndian(data[position..]);
            if (length > int.MaxValue || position + 12L + length > data.Length)
            {
                return Corrupt("chunk cut short");
            }

            var type = data.Slice(position + 4, 4);
            var body = data.Slice(position + 8, (int)length);
            var stored = BinaryPrimitives.ReadUInt32BigEndian(data[(position + 8 + (int)length)..]);
            if (Crc32(data.Slice(position + 4, 4 + (int)length)) != stored)
            {
                return Corrupt("checksum");
            }

            if (firstChunk != type.SequenceEqual("IHDR"u8) && (firstChunk || type.SequenceEqual("IHDR"u8)))
            {
                return Corrupt("header order");
            }

            firstChunk = false;
            if (type.SequenceEqual("IHDR"u8))
            {
                if (length != 13)
                {
                    return Corrupt("header");
                }

                width = (int)Math.Min(BinaryPrimitives.ReadUInt32BigEndian(body), int.MaxValue);
                height = (int)Math.Min(BinaryPrimitives.ReadUInt32BigEndian(body[4..]), int.MaxValue);
                bitDepth = body[8];
                colorType = body[9];
                interlace = body[12];
                if (width <= 0 || height <= 0 || body[10] != 0 || body[11] != 0 || interlace > 1 || !ValidDepth(colorType, bitDepth))
                {
                    return Corrupt("header");
                }

                sawHeader = true;
            }
            else if (type.SequenceEqual("acTL"u8))
            {
                return Unsupported();
            }
            else if (type.SequenceEqual("PLTE"u8))
            {
                sawPalette = true;
            }
            else if (type.SequenceEqual("IDAT"u8))
            {
                if (sawEnd || (colorType == 3 && !sawPalette))
                {
                    return Corrupt("pixel data order");
                }

                pixels.Write(body);
            }
            else if (type.SequenceEqual("IEND"u8))
            {
                if (length != 0 || position + 12 != data.Length)
                {
                    return Corrupt("data after the end");
                }

                sawEnd = true;
            }

            position += 12 + (int)length;
        }

        if (!sawHeader || !sawEnd || pixels.Length == 0)
        {
            return Corrupt("incomplete");
        }

        if ((long)width * height > HeroLimits.MaxPixels || width > HeroLimits.MaxSide || height > HeroLimits.MaxSide)
        {
            return new HeroImageCheck(new HeroImageInfo("image/png", "png", width, height), null, null);
        }

        // The pixel data must inflate, and (not interlaced) to exactly the rows the header promises.
        var channels = colorType switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, _ => 4 };
        var rowBytes = ((long)width * channels * bitDepth + 7) / 8 + 1;
        var expected = interlace == 0 ? rowBytes * height : -1L;
        var limit = interlace == 0 ? expected : (long)width * height * 8 + height * 7L + 16;
        pixels.Position = 0;
        long produced = 0;
        try
        {
            using var inflate = new ZLibStream(pixels, CompressionMode.Decompress);
            var buffer = new byte[64 * 1024];
            int read;
            while ((read = inflate.Read(buffer)) > 0)
            {
                produced += read;
                if (produced > limit)
                {
                    return Corrupt("pixel data too long");
                }
            }
        }
        catch (InvalidDataException)
        {
            return Corrupt("pixel data");
        }

        if (interlace == 0 ? produced != expected : produced < height)
        {
            return Corrupt("pixel data too short");
        }

        return HeroImageCheck.Ok(new HeroImageInfo("image/png", "png", width, height));
    }

    private static bool ValidDepth(int colorType, int bitDepth) => colorType switch
    {
        0 => bitDepth is 1 or 2 or 4 or 8 or 16,
        2 or 4 or 6 => bitDepth is 8 or 16,
        3 => bitDepth is 1 or 2 or 4 or 8,
        _ => false,
    };

    private static readonly uint[] CrcTable = BuildCrcTable();

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++)
            {
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            }

            table[n] = c;
        }

        return table;
    }

    private static uint Crc32(ReadOnlySpan<byte> bytes)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var value in bytes)
        {
            crc = CrcTable[(crc ^ value) & 0xFF] ^ (crc >> 8);
        }

        return crc ^ 0xFFFFFFFFu;
    }

    // ------------------------------------------------------------------ WebP

    private static HeroImageCheck WebP(ReadOnlySpan<byte> data)
    {
        if (BinaryPrimitives.ReadUInt32LittleEndian(data[4..]) != data.Length - 8L)
        {
            return Corrupt("size does not match");
        }

        int width = 0, height = 0;
        var sawFrame = false;
        var position = 12;
        var first = true;
        while (position < data.Length)
        {
            if (position + 8 > data.Length)
            {
                return Corrupt("chunk cut short");
            }

            var type = data.Slice(position, 4);
            var length = BinaryPrimitives.ReadUInt32LittleEndian(data[(position + 4)..]);
            if (position + 8L + length > data.Length)
            {
                return Corrupt("chunk cut short");
            }

            var body = data.Slice(position + 8, (int)length);
            if (type.SequenceEqual("VP8X"u8))
            {
                if (!first || length < 10)
                {
                    return Corrupt("header");
                }

                if ((body[0] & 0x02) != 0)
                {
                    return Unsupported();
                }

                width = 1 + (body[4] | (body[5] << 8) | (body[6] << 16));
                height = 1 + (body[7] | (body[8] << 8) | (body[9] << 16));
            }
            else if (type.SequenceEqual("VP8 "u8))
            {
                if (length < 10 || (body[0] & 1) != 0 || body[3] != 0x9D || body[4] != 0x01 || body[5] != 0x2A)
                {
                    return Corrupt("lossy header");
                }

                var w = BinaryPrimitives.ReadUInt16LittleEndian(body[6..]) & 0x3FFF;
                var h = BinaryPrimitives.ReadUInt16LittleEndian(body[8..]) & 0x3FFF;
                if (w == 0 || h == 0 || (width != 0 && (w != width || h != height)))
                {
                    return Corrupt("size");
                }

                (width, height, sawFrame) = (w, h, true);
            }
            else if (type.SequenceEqual("VP8L"u8))
            {
                if (length < 5 || body[0] != 0x2F)
                {
                    return Corrupt("lossless header");
                }

                var bits = BinaryPrimitives.ReadUInt32LittleEndian(body[1..]);
                var w = (int)(bits & 0x3FFF) + 1;
                var h = (int)((bits >> 14) & 0x3FFF) + 1;
                if (width != 0 && (w != width || h != height))
                {
                    return Corrupt("size");
                }

                (width, height, sawFrame) = (w, h, true);
            }
            else if (first)
            {
                return Corrupt("first chunk");
            }

            first = false;
            position += 8 + (int)length + (int)(length & 1);
        }

        return sawFrame && position == data.Length
            ? HeroImageCheck.Ok(new HeroImageInfo("image/webp", "webp", width, height))
            : Corrupt("incomplete");
    }
}
