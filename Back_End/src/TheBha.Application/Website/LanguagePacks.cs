using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TheBha.Domain.Website;

namespace TheBha.Application.Website;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: one managed message the product needs a text for. The definition is
/// language-neutral — a key, the namespace (scope) it belongs to and the variables its texts must use — and never
/// carries any language's text: those live in the language packs. <c>Context</c> is an optional English note for translators.
/// </summary>
public sealed record MessageDefinition(string Key, string Scope, IReadOnlyList<string> Placeholders, string? Context);

/// <summary>The scopes a message can have. <c>content</c> keys are not in the catalog: they are derived from the stored content and the static content ids.</summary>
public static class MessageScopes
{
    public const string Shared = "shared";
    public const string Customer = "customer";
    public const string Admin = "admin";
    public const string Content = "content";

    public static readonly IReadOnlyList<string> Ui = [Shared, Customer, Admin];

    public static bool IsPublic(string scope) => scope is Shared or Customer or Admin or Content;
}

/// <summary>A language pack as data (schema <c>bha.language-pack/1</c>). Never code: nothing in it is executed.</summary>
public sealed record LanguagePack(
    string Locale,
    string DisplayName,
    string NativeName,
    string Direction,
    string FormatLocale,
    string? DefaultCurrency,
    string PackId,
    string PackVersion,
    string ReferenceLocale,
    IReadOnlyDictionary<string, string> Messages,
    IReadOnlyDictionary<string, string> Content,
    IReadOnlyDictionary<string, string> Sources)
{
    public const string SchemaId = "bha.language-pack/1";

    /// <summary>Every text of the pack, UI and content, by full key.</summary>
    public IEnumerable<KeyValuePair<string, string>> All => Messages.Concat(Content);
}

public sealed record PackIssue(string? Key, string Code, string Message);

public sealed record ParsedPack(LanguagePack? Pack, IReadOnlyList<PackIssue> Issues)
{
    public bool IsValid => Pack is not null && Issues.Count == 0;
}

public static class PackLimits
{
    public const int MaxBytes = 6 * 1024 * 1024;
    public const int MaxKeys = 30_000;
}

/// <summary>The hash a translation remembers of the reference text it was made from, so a later change of that text shows it as outdated.</summary>
public static class SourceText
{
    public static string Hash(string? text)
    {
        var normalised = (text ?? string.Empty).Normalize(NormalizationForm.FormC).Trim();
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalised)))[..WebsiteFieldLimits.SourceHash].ToLowerInvariant();
    }
}

/// <summary>The key of a content text: <c>content.&lt;entity&gt;.&lt;id&gt;.&lt;field&gt;</c> — the id is the entity's own stable id, never a list position.</summary>
public static class ContentKey
{
    public const string Prefix = "content.";

    public static string For(string entity, string id, string field) => $"{Prefix}{entity}.{id}.{field}";

    public static bool TryParse(string key, out string entity, out string id, out string field)
    {
        entity = id = field = string.Empty;
        if (!key.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var parts = key[Prefix.Length..].Split('.', 3);
        if (parts.Length != 3 || parts.Any(part => part.Length == 0))
        {
            return false;
        }

        (entity, id, field) = (parts[0], parts[1], parts[2]);
        return true;
    }
}

/// <summary>
/// The embedded message catalog and the embedded built-in language packs (Vietnamese, English, French today: adding
/// one is adding a file). Loaded once. The Admin "library" lists these; installing one is the same pipeline as
/// uploading a file.
/// </summary>
public static class LocalizationAssets
{
    private const string Prefix = "bha-localization/";

    private static readonly Lazy<IReadOnlyList<MessageDefinition>> CatalogLazy = new(LoadCatalog);
    private static readonly Lazy<IReadOnlyList<LanguagePack>> PacksLazy = new(LoadPacks);

    public static IReadOnlyList<MessageDefinition> Catalog => CatalogLazy.Value;

    public static IReadOnlyDictionary<string, MessageDefinition> CatalogByKey { get; } =
        new Lazy<IReadOnlyDictionary<string, MessageDefinition>>(
            () => Catalog.ToDictionary(definition => definition.Key, StringComparer.Ordinal)).Value;

    /// <summary>A short hash of the catalog (keys, scopes, placeholders): a pack remembers the revision it was made for.</summary>
    public static string CatalogRevision { get; } = ComputeRevision();

    public static IReadOnlyList<LanguagePack> BuiltInPacks => PacksLazy.Value;

    public static LanguagePack? BuiltInPack(string locale) =>
        LanguageTag.TryNormalize(locale, out _, out var normalised)
            ? BuiltInPacks.FirstOrDefault(pack => LanguageTag.TryNormalize(pack.Locale, out _, out var other) && other == normalised)
            : null;

    private static string ComputeRevision()
    {
        var text = string.Join('\n', Catalog.Select(definition => $"{definition.Key}|{definition.Scope}|{string.Join(',', definition.Placeholders)}"));
        return SourceText.Hash(text);
    }

    private static IReadOnlyList<MessageDefinition> LoadCatalog()
    {
        using var stream = Open("catalog.json") ?? throw new InvalidOperationException("The embedded message catalog is missing.");
        using var document = JsonDocument.Parse(stream);
        return [.. document.RootElement.GetProperty("messages").EnumerateArray().Select(entry => new MessageDefinition(
            entry.GetProperty("key").GetString()!,
            entry.GetProperty("scope").GetString()!,
            [.. entry.GetProperty("placeholders").EnumerateArray().Select(name => name.GetString()!)],
            entry.TryGetProperty("context", out var context) ? context.GetString() : null))];
    }

    private static IReadOnlyList<LanguagePack> LoadPacks()
    {
        var assembly = typeof(LocalizationAssets).Assembly;
        var packs = new List<LanguagePack>();
        foreach (var name in assembly.GetManifestResourceNames().Where(name => name.StartsWith(Prefix + "packs/", StringComparison.Ordinal)).Order())
        {
            using var stream = assembly.GetManifestResourceStream(name)!;
            using var reader = new StreamReader(stream, Encoding.UTF8);
            var parsed = LanguagePackParser.Parse(reader.ReadToEnd());
            packs.Add(parsed.Pack ?? throw new InvalidOperationException($"The built-in pack {name} is invalid: {string.Join("; ", parsed.Issues.Select(issue => issue.Message))}"));
        }

        return packs;
    }

    private static Stream? Open(string name) => typeof(LocalizationAssets).Assembly.GetManifestResourceStream(Prefix + name);
}

/// <summary>
/// Reads a pack file as data: it checks the shape, the identity and the limits, and reports every problem it can
/// with the key it belongs to. Whether the keys exist and the texts fit their placeholders is checked against the
/// catalog by the import preview, because that needs the stored content.
/// </summary>
public static class LanguagePackParser
{
    public static ParsedPack Parse(string? json)
    {
        var issues = new List<PackIssue>();
        if (string.IsNullOrWhiteSpace(json))
        {
            return Fail("empty", "The file is empty.");
        }

        if (Encoding.UTF8.GetByteCount(json) > PackLimits.MaxBytes)
        {
            return Fail("too-large", $"The file is larger than {PackLimits.MaxBytes / (1024 * 1024)} MB.");
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8, AllowTrailingCommas = false });
        }
        catch (JsonException exception)
        {
            return Fail("not-json", $"The file is not valid JSON ({exception.Message.Split('.')[0]}).");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return Fail("schema", "The file must be a JSON object.");
            }

            if (Text(root, "schema") != LanguagePack.SchemaId)
            {
                return Fail("schema", $"Unsupported schema: expected \"{LanguagePack.SchemaId}\".");
            }

            var locale = Text(root, "locale");
            if (!LanguageTag.TryNormalize(locale, out var canonical, out _))
            {
                issues.Add(new PackIssue(null, "locale", "locale must be a BCP 47 tag such as fr or es-419."));
            }

            var displayName = Text(root, "displayName");
            var nativeName = Text(root, "nativeName");
            if (string.IsNullOrWhiteSpace(displayName) || displayName.Length > WebsiteFieldLimits.LanguageName)
            {
                issues.Add(new PackIssue(null, "displayName", "displayName is required (at most 100 characters)."));
            }

            if (string.IsNullOrWhiteSpace(nativeName) || nativeName.Length > WebsiteFieldLimits.LanguageName)
            {
                issues.Add(new PackIssue(null, "nativeName", "nativeName is required (at most 100 characters)."));
            }

            var direction = Text(root, "direction") ?? "ltr";
            if (direction is not ("ltr" or "rtl"))
            {
                issues.Add(new PackIssue(null, "direction", "direction must be ltr or rtl."));
            }

            var formatLocale = Text(root, "formatLocale");
            if (!string.IsNullOrWhiteSpace(formatLocale) && !LanguageTag.TryNormalize(formatLocale, out formatLocale, out _))
            {
                issues.Add(new PackIssue(null, "formatLocale", "formatLocale must be a BCP 47 tag such as fr-FR."));
            }

            var currency = Text(root, "defaultCurrency");
            if (!string.IsNullOrWhiteSpace(currency) && !Iso4217.TryNormalize(currency, out currency))
            {
                issues.Add(new PackIssue(null, "defaultCurrency", "defaultCurrency must be a current ISO 4217 code such as EUR."));
            }

            var packId = "pack";
            var packVersion = "1";
            if (root.TryGetProperty("pack", out var info) && info.ValueKind == JsonValueKind.Object)
            {
                packId = Text(info, "id") ?? packId;
                packVersion = Text(info, "version") ?? packVersion;
            }

            if (packId.Length > WebsiteFieldLimits.PackId || packVersion.Length > WebsiteFieldLimits.PackVersion)
            {
                issues.Add(new PackIssue(null, "pack", "pack.id (100) or pack.version (50) is too long."));
            }

            var referenceLocale = Text(root, "referenceLocale") ?? "vi";
            var messages = new SortedDictionary<string, string>(StringComparer.Ordinal);
            if (root.TryGetProperty("messages", out var namespaces) && namespaces.ValueKind == JsonValueKind.Object)
            {
                foreach (var space in namespaces.EnumerateObject())
                {
                    if (!MessageScopes.Ui.Contains(space.Name))
                    {
                        issues.Add(new PackIssue(null, "namespace", $"messages.{space.Name} is not a known namespace (shared, customer, admin)."));
                        continue;
                    }

                    ReadStrings(space.Value, space.Name + ".", messages, issues);
                }
            }
            else
            {
                issues.Add(new PackIssue(null, "messages", "messages is required (an object with the namespaces shared, customer and admin)."));
            }

            var content = new SortedDictionary<string, string>(StringComparer.Ordinal);
            if (root.TryGetProperty("content", out var contentNode))
            {
                ReadStrings(contentNode, ContentKey.Prefix, content, issues);
            }

            var sources = new SortedDictionary<string, string>(StringComparer.Ordinal);
            if (root.TryGetProperty("sources", out var sourcesNode) && sourcesNode.ValueKind == JsonValueKind.Object)
            {
                foreach (var entry in sourcesNode.EnumerateObject().Where(entry => entry.Value.ValueKind == JsonValueKind.String))
                {
                    sources[entry.Name] = entry.Value.GetString()!;
                }
            }

            if (messages.Count + content.Count > PackLimits.MaxKeys)
            {
                issues.Add(new PackIssue(null, "too-many-keys", $"The pack has more than {PackLimits.MaxKeys} texts."));
            }

            if (issues.Count > 0)
            {
                return new ParsedPack(null, issues);
            }

            return new ParsedPack(
                new LanguagePack(
                    canonical, displayName!.Trim(), nativeName!.Trim(), direction,
                    string.IsNullOrWhiteSpace(formatLocale) ? canonical : formatLocale!, string.IsNullOrWhiteSpace(currency) ? null : currency,
                    packId, packVersion, referenceLocale, messages, content, sources),
                issues);
        }

        ParsedPack Fail(string code, string message) => new(null, [new PackIssue(null, code, message)]);
    }

    private static void ReadStrings(JsonElement node, string requiredPrefix, SortedDictionary<string, string> into, List<PackIssue> issues)
    {
        if (node.ValueKind != JsonValueKind.Object)
        {
            issues.Add(new PackIssue(null, "shape", $"{requiredPrefix.TrimEnd('.')} must be an object of key: text."));
            return;
        }

        foreach (var entry in node.EnumerateObject())
        {
            if (entry.Value.ValueKind != JsonValueKind.String)
            {
                issues.Add(new PackIssue(entry.Name, "shape", "Every text must be a string."));
                continue;
            }

            if (!entry.Name.StartsWith(requiredPrefix, StringComparison.Ordinal) || entry.Name.Length > WebsiteFieldLimits.TranslationKey)
            {
                issues.Add(new PackIssue(entry.Name, "key", $"The key must start with \"{requiredPrefix}\" and be at most {WebsiteFieldLimits.TranslationKey} characters."));
                continue;
            }

            if (!into.TryAdd(entry.Name, entry.Value.GetString()!))
            {
                issues.Add(new PackIssue(entry.Name, "duplicate", "The key appears twice."));
            }
        }
    }

    private static string? Text(JsonElement node, string name) =>
        node.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
