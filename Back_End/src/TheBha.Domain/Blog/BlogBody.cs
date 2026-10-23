using System.Text;
using System.Text.Json;

namespace TheBha.Domain.Blog;

/// <summary>What a valid body holds, for the checks that need the database (media, properties) and for publishing.</summary>
public sealed record BlogBodyInfo(
    string CanonicalJson,
    IReadOnlySet<Guid> MediaIds,
    IReadOnlySet<Guid> PropertyIds,
    int BlockCount,
    int TextLength,
    bool HasImageWithoutAlt);

/// <summary>
/// BHA-BLOG-001-CP01: the versioned body format <c>{"schemaVersion":1,"blocks":[…]}</c> (design §3). The body is data, never
/// markup: this validator accepts only the block and inline shapes it knows, refuses every unknown field or type, and writes the
/// canonical JSON it stores — so what is stored is exactly what was checked, and nothing an editor sent is copied through.
/// </summary>
public static class BlogBody
{
    public const int SchemaVersion = 1;
    public const int MaxBytes = 200_000;
    public const int MaxBlocks = 400;
    public const int MaxText = 5000;
    public const int MaxListItems = 100;
    public const int MaxInlines = 100;
    public const int MinGallery = 2;
    public const int MaxGallery = 12;

    /// <summary>An empty body (a new draft): no blocks.</summary>
    public const string Empty = "{\"schemaVersion\":1,\"blocks\":[]}";

    public static (BlogBodyInfo? Info, BlogProblem? Problem) Validate(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Validate(Empty);
        }

        if (Encoding.UTF8.GetByteCount(json) > MaxBytes)
        {
            return Fail("The body is larger than 200 KB.");
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 12 });
        }
        catch (JsonException)
        {
            return Fail("The body is not valid JSON.");
        }

        using (document)
        {
            var walker = new Walker();
            var problem = walker.Run(document.RootElement);
            return problem is null ? (walker.Info(), null) : (null, new BlogProblem(BlogErrorCodes.BodyInvalid, "body", problem));
        }
    }

    private static (BlogBodyInfo?, BlogProblem?) Fail(string message) => (null, new BlogProblem(BlogErrorCodes.BodyInvalid, "body", message));

    private sealed class Walker
    {
        private readonly MemoryStream _output = new();
        private readonly Utf8JsonWriter _writer;
        private readonly HashSet<Guid> _media = [];
        private readonly HashSet<Guid> _properties = [];
        private int _blocks;
        private int _text;
        private bool _imageWithoutAlt;

        // SkipValidation: on a refusal the half-written output is discarded, and unwinding must not throw on unmatched ends.
        public Walker() => _writer = new Utf8JsonWriter(_output, new JsonWriterOptions { SkipValidation = true });

        public BlogBodyInfo Info()
        {
            _writer.Flush();
            return new BlogBodyInfo(Encoding.UTF8.GetString(_output.ToArray()), _media, _properties, _blocks, _text, _imageWithoutAlt);
        }

        public string? Run(JsonElement root)
        {
            if (root.ValueKind != JsonValueKind.Object || !Fields(root, out var fields, "schemaVersion", "blocks"))
            {
                return "The body is an object with schemaVersion and blocks.";
            }

            if (!fields.TryGetValue("schemaVersion", out var version) || version.ValueKind != JsonValueKind.Number ||
                !version.TryGetInt32(out var number) || number != SchemaVersion)
            {
                return $"schemaVersion must be {SchemaVersion}.";
            }

            if (!fields.TryGetValue("blocks", out var blocks) || blocks.ValueKind != JsonValueKind.Array)
            {
                return "blocks must be a list.";
            }

            if (blocks.GetArrayLength() > MaxBlocks)
            {
                return $"A body has at most {MaxBlocks} blocks.";
            }

            _writer.WriteStartObject();
            _writer.WriteNumber("schemaVersion", SchemaVersion);
            _writer.WriteStartArray("blocks");
            var index = 0;
            foreach (var block in blocks.EnumerateArray())
            {
                var problem = Block(block, $"blocks[{index++}]");
                if (problem is not null)
                {
                    return problem;
                }
            }

            _writer.WriteEndArray();
            _writer.WriteEndObject();
            return null;
        }

        private string? Block(JsonElement block, string path)
        {
            if (block.ValueKind != JsonValueKind.Object || !block.TryGetProperty("type", out var typeElement) || typeElement.ValueKind != JsonValueKind.String)
            {
                return $"{path}: a block is an object with a type.";
            }

            _blocks++;
            var type = typeElement.GetString();
            _writer.WriteStartObject();
            _writer.WriteString("type", type);
            var problem = type switch
            {
                "heading" => Heading(block, path),
                "paragraph" => Paragraph(block, path),
                "list" => List(block, path),
                "quote" => Quote(block, path),
                "image" => Image(block, path),
                "gallery" => Gallery(block, path),
                "toc" => Fields(block, out _, "type") ? null : $"{path}: a toc has no fields.",
                "propertyIntro" => PropertyIntro(block, path),
                _ => $"{path}: the block type '{type}' is not allowed."
            };
            _writer.WriteEndObject();
            return problem;
        }

        private string? Heading(JsonElement block, string path)
        {
            if (!Fields(block, out var f, "type", "level", "text") || !f.TryGetValue("level", out var level) ||
                level.ValueKind != JsonValueKind.Number || !level.TryGetInt32(out var number) || number is < 2 or > 4)
            {
                return $"{path}: a heading has a level from 2 to 4 (the page's H1 belongs to the template) and a text.";
            }

            _writer.WriteNumber("level", number);
            return PlainField(f, "text", 300, path, required: true, write: true, body: true);
        }

        private string? Paragraph(JsonElement block, string path)
        {
            if (!Fields(block, out var f, "type", "inlines"))
            {
                return $"{path}: a paragraph has inlines.";
            }

            return Inlines(f, "inlines", path, required: true);
        }

        private string? List(JsonElement block, string path)
        {
            if (!Fields(block, out var f, "type", "ordered", "items") || !f.TryGetValue("ordered", out var ordered) ||
                ordered.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
                !f.TryGetValue("items", out var items) || items.ValueKind != JsonValueKind.Array ||
                items.GetArrayLength() is < 1 or > MaxListItems)
            {
                return $"{path}: a list has ordered and 1 to {MaxListItems} items.";
            }

            _writer.WriteBoolean("ordered", ordered.GetBoolean());
            _writer.WriteStartArray("items");
            var index = 0;
            foreach (var item in items.EnumerateArray())
            {
                _writer.WriteStartArray();
                var problem = InlineList(item, $"{path}.items[{index++}]");
                _writer.WriteEndArray();
                if (problem is not null)
                {
                    return problem;
                }
            }

            _writer.WriteEndArray();
            return null;
        }

        private string? Quote(JsonElement block, string path)
        {
            if (!Fields(block, out var f, "type", "inlines", "cite"))
            {
                return $"{path}: a quote has inlines and an optional cite.";
            }

            var problem = Inlines(f, "inlines", path, required: true);
            return problem ?? (f.ContainsKey("cite") ? PlainField(f, "cite", 200, path, required: false, write: true) : null);
        }

        private string? Image(JsonElement block, string path)
        {
            if (!Fields(block, out var f, "type", "mediaId", "alt", "caption"))
            {
                return $"{path}: an image has mediaId, alt and an optional caption.";
            }

            return MediaItem(f, path);
        }

        private string? MediaItem(Dictionary<string, JsonElement> f, string path)
        {
            if (!f.TryGetValue("mediaId", out var media) || media.ValueKind != JsonValueKind.String || !Guid.TryParse(media.GetString(), out var id) || id == Guid.Empty)
            {
                return $"{path}: mediaId must be an id.";
            }

            _media.Add(id);
            _writer.WriteString("mediaId", id);
            var alt = f.TryGetValue("alt", out var altElement) && altElement.ValueKind == JsonValueKind.String ? altElement.GetString()!.Trim() : string.Empty;
            if (f.TryGetValue("alt", out var altValue) && altValue.ValueKind != JsonValueKind.String)
            {
                return $"{path}: alt must be a text.";
            }

            if (alt.Length == 0)
            {
                _imageWithoutAlt = true;
            }

            var problem = PlainField(f, "alt", BlogLimits.AltText, path, required: false, write: true, forceWrite: true);
            return problem ?? (f.ContainsKey("caption") ? PlainField(f, "caption", BlogLimits.Caption, path, required: false, write: true) : null);
        }

        private string? Gallery(JsonElement block, string path)
        {
            if (!Fields(block, out var f, "type", "items") || !f.TryGetValue("items", out var items) || items.ValueKind != JsonValueKind.Array ||
                items.GetArrayLength() is < MinGallery or > MaxGallery)
            {
                return $"{path}: a gallery has {MinGallery} to {MaxGallery} items.";
            }

            _writer.WriteStartArray("items");
            var index = 0;
            foreach (var item in items.EnumerateArray())
            {
                var itemPath = $"{path}.items[{index++}]";
                if (item.ValueKind != JsonValueKind.Object || !Fields(item, out var fields, "mediaId", "alt", "caption"))
                {
                    return $"{itemPath}: a gallery item has mediaId, alt and an optional caption.";
                }

                _writer.WriteStartObject();
                var problem = MediaItem(fields, itemPath);
                _writer.WriteEndObject();
                if (problem is not null)
                {
                    return problem;
                }
            }

            _writer.WriteEndArray();
            return null;
        }

        private string? PropertyIntro(JsonElement block, string path)
        {
            if (!Fields(block, out var f, "type", "propertyId") || !f.TryGetValue("propertyId", out var property) ||
                property.ValueKind != JsonValueKind.String || !Guid.TryParse(property.GetString(), out var id) || id == Guid.Empty)
            {
                return $"{path}: a propertyIntro has a propertyId.";
            }

            _properties.Add(id);
            _writer.WriteString("propertyId", id);
            return null;
        }

        private string? Inlines(Dictionary<string, JsonElement> f, string name, string path, bool required)
        {
            if (!f.TryGetValue(name, out var element))
            {
                return required ? $"{path}: {name} is required." : null;
            }

            _writer.WriteStartArray(name);
            var problem = InlineList(element, $"{path}.{name}");
            _writer.WriteEndArray();
            return problem;
        }

        private string? InlineList(JsonElement list, string path)
        {
            if (list.ValueKind != JsonValueKind.Array || list.GetArrayLength() is < 1 or > MaxInlines)
            {
                return $"{path}: 1 to {MaxInlines} inline parts.";
            }

            var index = 0;
            foreach (var inline in list.EnumerateArray())
            {
                var inlinePath = $"{path}[{index++}]";
                if (inline.ValueKind != JsonValueKind.Object || !Fields(inline, out var f, "text", "bold", "italic", "href"))
                {
                    return $"{inlinePath}: an inline part has text and optional bold, italic and href.";
                }

                _writer.WriteStartObject();
                var problem = PlainField(f, "text", MaxText, inlinePath, required: true, write: true, body: true, keepSpaces: true);
                if (problem is not null)
                {
                    return problem;
                }

                foreach (var flag in new[] { "bold", "italic" })
                {
                    if (!f.TryGetValue(flag, out var value))
                    {
                        continue;
                    }

                    if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    {
                        return $"{inlinePath}: {flag} is true or false.";
                    }

                    if (value.GetBoolean())
                    {
                        _writer.WriteBoolean(flag, true);
                    }
                }

                if (f.TryGetValue("href", out var href))
                {
                    if (href.ValueKind != JsonValueKind.String || !BlogLink.IsSafe(href.GetString()))
                    {
                        return $"{inlinePath}: a link is an internal path (/…) or an https address.";
                    }

                    _writer.WriteString("href", href.GetString());
                }

                _writer.WriteEndObject();
            }

            return null;
        }

        /// <summary>Reads <paramref name="name"/> from <paramref name="f"/> as plain text, counts it and (optionally) writes it.</summary>
        /// <param name="keepSpaces">
        /// A run of an inline list: the spaces at its ends belong to the text, because they are the spaces between the words of the neighbouring runs
        /// ("Đây là <b>đậm</b> chữ" is three runs). Such a run only has to be non-empty; every other text is trimmed.
        /// </param>
        private string? PlainField(
            Dictionary<string, JsonElement> f, string name, int max, string path, bool required, bool write, bool forceWrite = false, bool body = false, bool keepSpaces = false)
        {
            if (!f.TryGetValue(name, out var element))
            {
                if (forceWrite)
                {
                    _writer.WriteString(name, string.Empty);
                }

                return required ? $"{path}: {name} is required." : null;
            }

            if (element.ValueKind != JsonValueKind.String)
            {
                return $"{path}: {name} must be a text.";
            }

            var text = keepSpaces ? element.GetString()! : element.GetString()!.Trim();
            var problem = BlogText.Check(text, max, name, required, keepSpaces);
            if (problem is not null)
            {
                return $"{path}: {problem.Message}";
            }

            if (body)
            {
                _text += text.Trim().Length;
            }

            if (write && (text.Length > 0 || forceWrite))
            {
                _writer.WriteString(name, text);
            }

            return null;
        }

        /// <summary>The object's properties, each at most once, all of them among <paramref name="allowed"/>.</summary>
        private static bool Fields(JsonElement element, out Dictionary<string, JsonElement> fields, params string[] allowed)
        {
            fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !fields.TryAdd(property.Name, property.Value))
                {
                    return false;
                }
            }

            return true;
        }
    }
}
