using TheBha.Application.Website;

namespace TheBha.UnitTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP04: the link, label and tree rules behind the header navigation. Pure: the same functions the Admin
/// save runs under the lock. The link cases are the ones a browser would otherwise act on: another scheme, another host through
/// <c>//</c> or a backslash, and every encoded form of those.
/// </summary>
public sealed class WebsiteMenuRulesTests
{
    [Theory]
    [InlineData("/")]
    [InlineData("/riverside")]
    [InlineData("/blog?category=tin-du-lich")]
    [InlineData("/blog?category=a&page=2#top")]
    [InlineData("/listing-stay-detail?propertyId=a1&roomTypeId=b2")]
    [InlineData("/add-listing/1")]
    [InlineData("#")]
    [InlineData("#faq")]
    [InlineData("https://example.com")]
    [InlineData("https://example.com/path?q=1#x")]
    [InlineData("HTTPS://Example.com/Path")]
    [InlineData("/%E1%BB%A9ng-d%E1%BB%A5ng")]
    public void An_internal_path_a_fragment_or_an_https_address_is_a_link(string href) => Assert.Null(MenuText.ValidateHref(href));

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("javascript:alert(1)")]
    [InlineData("JaVaScRiPt:alert(1)")]
    [InlineData("data:text/html,<script>alert(1)</script>")]
    [InlineData("vbscript:x")]
    [InlineData("mailto:a@b.c")]
    [InlineData("tel:+84123")]
    [InlineData("http://example.com")]
    [InlineData("ftp://example.com")]
    [InlineData("//evil.example")]
    [InlineData("///evil.example")]
    [InlineData("/\\evil.example")]
    [InlineData("\\\\evil.example")]
    [InlineData("/%2F%2Fevil.example")]
    [InlineData("/%252F%252Fevil.example")]
    [InlineData("/%5Cevil.example")]
    [InlineData("/%255Cevil.example")]
    [InlineData("/ok%0Aevil")]
    [InlineData("/ok%00")]
    [InlineData("/a b")]
    [InlineData("/a\tb")]
    [InlineData("/a\nb")]
    [InlineData("/\u0007")]
    [InlineData(" /leading")]
    [InlineData("/trailing ")]
    [InlineData("relative/path")]
    [InlineData("faq")]
    [InlineData("https:/evil.example")]
    [InlineData("https://")]
    [InlineData("https://user:pass@example.com")]
    [InlineData("https://user@example.com")]
    [InlineData("#a#b")]
    public void Anything_that_could_leave_the_site_or_run_code_is_refused(string href) => Assert.NotNull(MenuText.ValidateHref(href));

    [Fact]
    public void A_link_has_a_length_limit()
    {
        Assert.Null(MenuText.ValidateHref("/" + new string('a', 2047)));
        Assert.NotNull(MenuText.ValidateHref("/" + new string('a', 2048)));
    }

    [Theory]
    [InlineData("Ưu đãi", true)]
    [InlineData("Q&A", true)]
    [InlineData("  Blog  ", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("<b>Blog</b>", false)]
    [InlineData("a > b", false)]
    [InlineData("tab\there", false)]
    public void A_label_is_plain_text_of_one_to_eighty_characters(string label, bool valid) =>
        Assert.Equal(valid, MenuText.ValidateLabel(label) is null);

    [Fact]
    public void A_label_over_the_limit_is_refused() => Assert.NotNull(MenuText.ValidateLabel(new string('x', 81)));

    private static readonly IReadOnlySet<string> Locales = new HashSet<string> { "vi", "en" };
    private static readonly string[] Required = ["vi"];

    private static MenuItemInput Item(Guid id, Guid? parent = null, string? placement = null, string href = "/x", string? vi = "x", params (string, string?)[] more)
    {
        var labels = new Dictionary<string, string?> { ["vi"] = vi };
        foreach (var (code, text) in more)
        {
            labels[code] = text;
        }

        return new MenuItemInput(id, parent, parent is null ? placement ?? "primary" : null, true, href, false, labels);
    }

    private static MenuProblem? Check(MenuItemInput[] items, params Guid[] known) =>
        MenuTree.Validate(items, known.ToHashSet(), Locales, Required);

    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid(), C = Guid.NewGuid(), D = Guid.NewGuid(), E = Guid.NewGuid();

    [Fact]
    public void A_tree_of_four_levels_is_valid_and_an_empty_one_too()
    {
        Assert.Null(Check([Item(A), Item(B, A), Item(C, B), Item(D, C)]));
        Assert.Null(Check([]));
        Assert.Null(Check([Item(A, placement: "secondary"), Item(B, placement: "primary")]));
    }

    [Fact]
    public void A_fifth_level_is_too_deep() =>
        Assert.Equal(MenuErrorCodes.TooDeep, Check([Item(A), Item(B, A), Item(C, B), Item(D, C), Item(E, D)])!.Code);

    [Fact]
    public void An_entry_inside_itself_or_inside_its_own_descendant_is_a_cycle()
    {
        Assert.Equal(MenuErrorCodes.Cycle, Check([Item(A, A)])!.Code);
        Assert.Equal(MenuErrorCodes.Cycle, Check([Item(A, B), Item(B, A)])!.Code);
        Assert.Equal(MenuErrorCodes.Cycle, Check([Item(A, C), Item(B, A), Item(C, B)])!.Code);
    }

    [Fact]
    public void An_entry_may_appear_only_once()
    {
        Assert.Equal(MenuErrorCodes.Duplicate, Check([Item(A), Item(A)])!.Code);
        Assert.Equal(MenuErrorCodes.Duplicate, Check([Item(Guid.Empty)])!.Code);
    }

    [Fact]
    public void A_parent_that_never_existed_is_missing_and_one_that_was_deleted_with_children_left_says_so()
    {
        Assert.Equal(MenuErrorCodes.ParentMissing, Check([Item(B, A)])!.Code);
        var problem = Check([Item(B, A)], A)!;
        Assert.Equal(MenuErrorCodes.DeleteHasChildren, problem.Code);
        Assert.Equal("items[0].parentId", problem.Field);
        Assert.Null(Check([Item(B)], A));                 // deleted together with its children: fine
    }

    [Fact]
    public void A_root_needs_a_placement_and_a_child_has_none()
    {
        Assert.Equal(MenuErrorCodes.PlacementInvalid, Check([new MenuItemInput(A, null, null, true, "/x", false, new Dictionary<string, string?> { ["vi"] = "x" })])!.Code);
        Assert.Equal(MenuErrorCodes.PlacementInvalid, Check([new MenuItemInput(A, null, "left", true, "/x", false, new Dictionary<string, string?> { ["vi"] = "x" })])!.Code);
        Assert.Equal(MenuErrorCodes.PlacementInvalid, Check([Item(A), new MenuItemInput(B, A, "primary", true, "/x", false, new Dictionary<string, string?> { ["vi"] = "x" })])!.Code);
    }

    [Fact]
    public void A_bad_link_or_label_names_the_field()
    {
        var link = Check([Item(A), Item(B, A, href: "javascript:alert(1)")])!;
        Assert.Equal((MenuErrorCodes.UrlInvalid, "items[1].href"), (link.Code, link.Field));
        var label = Check([Item(A, vi: "<img src=x>")])!;
        Assert.Equal((MenuErrorCodes.LabelInvalid, "items[0].labels.vi"), (label.Code, label.Field));
        var missing = Check([Item(A, vi: "")])!;
        Assert.Equal((MenuErrorCodes.LabelRequired, "items[0].labels.vi"), (missing.Code, missing.Field));
        var unknown = Check([Item(A, more: ("zz", "x"))])!;
        Assert.Equal(MenuErrorCodes.UnknownLocale, unknown.Code);
        Assert.Null(Check([Item(A, more: ("en", null))]));       // another language may be left empty (the public site falls back)
    }

    [Fact]
    public void There_is_a_limit_on_the_number_of_entries() =>
        Assert.Equal(MenuErrorCodes.TooMany, Check([.. Enumerable.Range(0, 201).Select(_ => Item(Guid.NewGuid()))])!.Code);
}
