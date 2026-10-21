using System.Text.Json;
using TheBha.Domain.Blog;

namespace TheBha.UnitTests;

/// <summary>BHA-BLOG-001-CP01: the pure Blog rules — slug, link, plain text, the body format, and the translation state machine.</summary>
public sealed class BlogDomainTests
{
    private static readonly Guid Staff = Guid.NewGuid();
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-21T00:00:00Z");
    private static readonly Guid Media = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Theory]
    [InlineData("diem-den-noi-bat", true)]
    [InlineData("a1", true)]
    [InlineData("Diem-Den", false)]
    [InlineData("điểm-đến", false)]
    [InlineData("a", false)]
    [InlineData("-abc", false)]
    [InlineData("abc-", false)]
    [InlineData("a--b", false)]
    [InlineData("a b", false)]
    [InlineData("a/b", false)]
    [InlineData("category", false)]
    [InlineData("preview", false)]
    [InlineData("", false)]
    public void Slug_accepts_only_ascii_lowercase_hyphenated_words_that_are_not_reserved(string slug, bool ok) =>
        Assert.Equal(ok, BlogSlug.Check(slug, "slug") is null);

    [Fact]
    public void Slug_is_limited_in_length() => Assert.NotNull(BlogSlug.Check(new string('a', BlogLimits.Slug + 1), "slug"));

    [Theory]
    [InlineData("/blog/abc", true)]
    [InlineData("/", true)]
    [InlineData("https://example.com/a?b=1#c", true)]
    [InlineData("//evil.example", false)]
    [InlineData("/\\evil.example", false)]
    [InlineData("\\\\evil.example", false)]
    [InlineData("/ /evil", false)]
    [InlineData("http://example.com", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("java\tscript:alert(1)", false)]
    [InlineData("JaVaScRiPt:alert(1)", false)]
    [InlineData("data:text/html;base64,AAAA", false)]
    [InlineData("mailto:a@b.c", false)]
    [InlineData("https://user:pw@example.com", false)]
    [InlineData("https:///nohost", false)]
    [InlineData(" /blog", false)]
    [InlineData("/blog ", false)]
    [InlineData("/a\"onmouseover=\"x", false)]
    [InlineData("/a<script>", false)]
    [InlineData("", false)]
    public void Link_allows_an_internal_path_or_https_only(string href, bool ok) => Assert.Equal(ok, BlogLink.IsSafe(href));

    [Fact]
    public void Plain_text_refuses_markup_and_control_characters()
    {
        Assert.Null(BlogText.Check("Đà Nẵng & Hội An — 5 đến 3 là sai", 100, "t"));
        Assert.NotNull(BlogText.Check("<b>x</b>", 100, "t"));
        Assert.NotNull(BlogText.Check("a\u0000b", 100, "t"));
        Assert.NotNull(BlogText.Check("a\nb", 100, "t"));
        Assert.NotNull(BlogText.Check(new string('a', 101), 100, "t"));
        Assert.NotNull(BlogText.Check("  ", 100, "t", required: true));
    }

    private static string Doc(params string[] blocks) => "{\"schemaVersion\":1,\"blocks\":[" + string.Join(',', blocks) + "]}";

    private const string Para = "{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"Xin chào\"}]}";

    [Fact]
    public void A_valid_body_is_returned_in_canonical_form_with_what_it_uses()
    {
        var json = Doc(
            "{\"type\":\"heading\",\"level\":2,\"text\":\"Mỹ Khê\"}",
            "{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"a \",\"bold\":true},{\"text\":\"link\",\"href\":\"/blog/x\"}]}",
            "{\"type\":\"list\",\"ordered\":false,\"items\":[[{\"text\":\"one\"}],[{\"text\":\"two\",\"italic\":true}]]}",
            "{\"type\":\"quote\",\"inlines\":[{\"text\":\"q\"}],\"cite\":\"someone\"}",
            $"{{\"type\":\"image\",\"mediaId\":\"{Media}\",\"alt\":\"A beach\",\"caption\":\"Beach\"}}",
            $"{{\"type\":\"gallery\",\"items\":[{{\"mediaId\":\"{Media}\",\"alt\":\"a\"}},{{\"mediaId\":\"{Guid.NewGuid()}\",\"alt\":\"b\"}}]}}",
            "{\"type\":\"toc\"}",
            $"{{\"type\":\"propertyIntro\",\"propertyId\":\"{Guid.Parse("22222222-2222-2222-2222-222222222222")}\"}}");
        var (info, problem) = BlogBody.Validate(json);

        Assert.Null(problem);
        Assert.Equal(8, info!.BlockCount);
        Assert.Equal(2, info.MediaIds.Count);
        Assert.Single(info.PropertyIds);
        Assert.False(info.HasImageWithoutAlt);
        Assert.True(info.TextLength > 0);
        // Idempotent: the canonical form validates to itself.
        Assert.Equal(info.CanonicalJson, BlogBody.Validate(info.CanonicalJson).Info!.CanonicalJson);
    }

    [Fact]
    public void An_empty_or_missing_body_is_the_empty_document()
    {
        foreach (var json in new string?[] { null, "", "  ", BlogBody.Empty })
        {
            var (info, problem) = BlogBody.Validate(json);
            Assert.Null(problem);
            Assert.Equal(0, info!.BlockCount);
        }
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"schemaVersion\":2,\"blocks\":[]}")]
    [InlineData("{\"schemaVersion\":1}")]
    [InlineData("{\"schemaVersion\":1,\"blocks\":{}}")]
    [InlineData("{\"schemaVersion\":1,\"blocks\":[],\"html\":\"<script>\"}")]
    [InlineData("{\"schemaVersion\":1,\"schemaVersion\":1,\"blocks\":[]}")]
    public void A_body_with_the_wrong_envelope_is_refused(string json) => Assert.NotNull(BlogBody.Validate(json).Problem);

    [Theory]
    [InlineData("{\"type\":\"script\",\"src\":\"x\"}")]
    [InlineData("{\"type\":\"html\",\"html\":\"<b>x</b>\"}")]
    [InlineData("{\"type\":\"heading\",\"level\":1,\"text\":\"H1 is the template's\"}")]
    [InlineData("{\"type\":\"heading\",\"level\":5,\"text\":\"x\"}")]
    [InlineData("{\"type\":\"heading\",\"level\":2}")]
    [InlineData("{\"type\":\"heading\",\"level\":2,\"text\":\"<img src=x onerror=alert(1)>\"}")]
    [InlineData("{\"type\":\"paragraph\",\"inlines\":[]}")]
    [InlineData("{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"a\",\"onclick\":\"x\"}]}")]
    [InlineData("{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"a\",\"href\":\"javascript:alert(1)\"}]}")]
    [InlineData("{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"a\",\"href\":\"//evil.example\"}]}")]
    [InlineData("{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"a\",\"bold\":\"yes\"}]}")]
    [InlineData("{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"a\"}],\"style\":\"x\"}")]
    [InlineData("{\"type\":\"list\",\"ordered\":false,\"items\":[]}")]
    [InlineData("{\"type\":\"image\",\"mediaId\":\"not-a-guid\",\"alt\":\"a\"}")]
    [InlineData("{\"type\":\"image\",\"mediaId\":\"00000000-0000-0000-0000-000000000000\",\"alt\":\"a\"}")]
    [InlineData("{\"type\":\"image\",\"mediaId\":\"11111111-1111-1111-1111-111111111111\",\"alt\":\"a\",\"url\":\"https://evil.example/x.png\"}")]
    [InlineData("{\"type\":\"gallery\",\"items\":[{\"mediaId\":\"11111111-1111-1111-1111-111111111111\",\"alt\":\"a\"}]}")]
    [InlineData("{\"type\":\"toc\",\"depth\":3}")]
    [InlineData("{\"type\":\"propertyIntro\",\"propertyId\":\"x\"}")]
    [InlineData("{\"type\":\"quote\",\"inlines\":[{\"text\":\"q\"}],\"cite\":\"<a>\"}")]
    [InlineData("{\"text\":\"no type\"}")]
    [InlineData("\"just a string\"")]
    public void A_block_that_is_not_in_the_format_is_refused(string block) => Assert.NotNull(BlogBody.Validate(Doc(block)).Problem);

    [Fact]
    public void Limits_on_size_and_count_are_enforced()
    {
        Assert.NotNull(BlogBody.Validate(Doc(Enumerable.Repeat(Para, BlogBody.MaxBlocks + 1).ToArray())).Problem);
        Assert.Null(BlogBody.Validate(Doc(Enumerable.Repeat(Para, BlogBody.MaxBlocks).ToArray())).Problem);
        Assert.NotNull(BlogBody.Validate(Doc($"{{\"type\":\"paragraph\",\"inlines\":[{{\"text\":\"{new string('a', BlogBody.MaxText + 1)}\"}}]}}")).Problem);
        Assert.NotNull(BlogBody.Validate(new string(' ', BlogBody.MaxBytes) + Para).Problem);
        Assert.NotNull(BlogBody.Validate(string.Concat(Enumerable.Repeat("[", 40))).Problem);
    }

    [Fact]
    public void An_image_without_alt_text_is_reported_for_publishing_but_allowed_in_a_draft()
    {
        var (info, problem) = BlogBody.Validate(Doc($"{{\"type\":\"image\",\"mediaId\":\"{Media}\",\"alt\":\"\"}}"));
        Assert.Null(problem);
        Assert.True(info!.HasImageWithoutAlt);
        Assert.Equal(0, info.TextLength);
    }

    [Fact]
    public void Script_text_is_never_stored_as_markup()
    {
        // "<" and ">" are refused outright in any text of the body.
        Assert.NotNull(BlogBody.Validate(Doc("{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"<script>alert(1)</script>\"}]}")).Problem);
        // Quotes and ampersands are data, kept as text.
        var (info, _) = BlogBody.Validate(Doc("{\"type\":\"paragraph\",\"inlines\":[{\"text\":\"\\\"a\\\" & 'b'\"}]}"));
        Assert.Equal("\"a\" & 'b'", JsonDocument.Parse(info!.CanonicalJson).RootElement.GetProperty("blocks")[0].GetProperty("inlines")[0].GetProperty("text").GetString());
    }

    // ---- the translation state machine ----

    private static BlogRevisionContent Content(string slug = "bai-viet") =>
        new("Tiêu đề", slug, "Tóm tắt", BlogBody.Empty, null, string.Empty, string.Empty, string.Empty, string.Empty, null, [], null, new HashSet<Guid>());

    private static (BlogPostTranslation Translation, BlogPostRevision Draft) NewDraft()
    {
        var translation = new BlogPostTranslation(Guid.NewGuid(), Guid.NewGuid(), "vi", Staff, Now);
        var draft = new BlogPostRevision(Guid.NewGuid(), translation.Id, 1, BlogRevisionOrigin.Edit, null, Content(), Staff, Now);
        translation.AttachFirstDraft(draft.Id);
        return (translation, draft);
    }

    [Fact]
    public void Publishing_freezes_the_draft_and_makes_it_the_public_revision()
    {
        var (translation, draft) = NewDraft();
        Assert.Equal(1, translation.Version);
        Assert.False(translation.IsPublic);

        var later = Now.AddHours(1);
        Assert.Null(translation.Publish(draft, Staff, later));

        Assert.True(translation.IsPublic);
        Assert.Equal(draft.Id, translation.PublishedRevisionId);
        Assert.Null(translation.DraftRevisionId);
        Assert.Equal(later, translation.FirstPublishedAtUtc);
        Assert.Equal(BlogRevisionState.Frozen, draft.State);
        Assert.Equal(later, draft.PublishedAtUtc);
        Assert.Equal(2, translation.Version);
        Assert.Throws<TheBha.Domain.Common.DomainException>(() => draft.Replace(Content("khac"), Staff, later));
    }

    [Fact]
    public void Unpublish_and_republish_keep_the_dates_of_the_revision()
    {
        var (translation, draft) = NewDraft();
        translation.Publish(draft, Staff, Now.AddHours(1));
        var firstPublished = translation.FirstPublishedAtUtc;
        var modified = draft.PublishedAtUtc;

        Assert.Null(translation.Unpublish(Staff, Now.AddDays(1)));
        Assert.False(translation.IsPublic);
        Assert.Equal(BlogTranslationStatus.Unpublished, translation.Status);
        Assert.Null(translation.Republish(Staff, Now.AddDays(2)));

        Assert.True(translation.IsPublic);
        Assert.Equal(firstPublished, translation.FirstPublishedAtUtc);
        Assert.Equal(modified, draft.PublishedAtUtc);
        Assert.Equal(draft.Id, translation.PublishedRevisionId);
    }

    [Fact]
    public void Transitions_are_refused_from_the_wrong_state()
    {
        var (translation, draft) = NewDraft();
        Assert.Equal(BlogErrorCodes.InvalidState, translation.Unpublish(Staff, Now)!.Code);
        Assert.Equal(BlogErrorCodes.InvalidState, translation.Republish(Staff, Now)!.Code);
        Assert.Equal(BlogErrorCodes.InvalidState, translation.Unarchive(Staff, Now)!.Code);
        Assert.Equal(BlogErrorCodes.InvalidState, translation.Publish(new BlogPostRevision(Guid.NewGuid(), translation.Id, 2, BlogRevisionOrigin.Edit, null, Content(), Staff, Now), Staff, Now)!.Code);

        Assert.Null(translation.Archive(Staff, Now));
        Assert.Equal(BlogErrorCodes.Archived, translation.Publish(draft, Staff, Now)!.Code);
        Assert.Equal(BlogErrorCodes.Archived, translation.CheckEditable()!.Code);
        Assert.Equal(BlogErrorCodes.InvalidState, translation.Archive(Staff, Now)!.Code);
        Assert.Null(translation.Unarchive(Staff, Now));
        Assert.Equal(BlogTranslationStatus.Draft, translation.Status);
    }

    [Fact]
    public void Unarchiving_a_once_published_translation_leaves_it_unpublished_not_live()
    {
        var (translation, draft) = NewDraft();
        translation.Publish(draft, Staff, Now);
        translation.Archive(Staff, Now);
        translation.Unarchive(Staff, Now);

        Assert.Equal(BlogTranslationStatus.Unpublished, translation.Status);
        Assert.False(translation.IsPublic);
    }

    [Fact]
    public void Every_write_advances_the_version_but_a_republish_needs_no_newer_draft()
    {
        var (translation, draft) = NewDraft();
        var version = translation.Version;
        translation.DraftWritten(draft.Id, Staff, Now);
        Assert.Equal(version + 1, translation.Version);

        translation.Publish(draft, Staff, Now);
        translation.Unpublish(Staff, Now);
        var newDraft = new BlogPostRevision(Guid.NewGuid(), translation.Id, 2, BlogRevisionOrigin.Edit, null, Content("moi"), Staff, Now);
        translation.DraftWritten(newDraft.Id, Staff, Now);
        Assert.Equal(BlogErrorCodes.InvalidState, translation.Republish(Staff, Now)!.Code);
    }

    [Fact]
    public void A_draft_edit_changes_categories_without_touching_a_frozen_revision()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var (translation, draft) = NewDraft();
        draft.Replace(Content() with { CategoryIds = [a, b], PrimaryCategoryId = b }, Staff, Now);
        translation.Publish(draft, Staff, Now);
        Assert.Equal([a, b], draft.ToContent().CategoryIds.OrderBy(x => x == b ? 1 : 0));

        var next = new BlogPostRevision(Guid.NewGuid(), translation.Id, 2, BlogRevisionOrigin.Edit, null, Content() with { CategoryIds = [a], PrimaryCategoryId = a }, Staff, Now);
        Assert.Equal([a], next.ToContent().CategoryIds);
        Assert.Equal(b, draft.ToContent().PrimaryCategoryId);
    }
}
