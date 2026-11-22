using TheBha.Application.Notifications;
using TheBha.Domain.Notifications;

namespace TheBha.UnitTests;

/// <summary>BHA-CHECKOUT-001-PR04 (R-02..R-04): the pure recipient policy, address validation and chain settings, without a database.</summary>
public sealed class BookingNotificationRecipientPolicyTests
{
    private static readonly Guid Property = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid A = Guid.Parse("00000000-0000-0000-0000-00000000000a");
    private static readonly Guid B = Guid.Parse("00000000-0000-0000-0000-00000000000b");
    private static readonly Guid C = Guid.Parse("00000000-0000-0000-0000-00000000000c");
    private static readonly IReadOnlyDictionary<Guid, string> NoChain = new Dictionary<Guid, string>();

    private static BookingStaffCandidate Staff(Guid id, bool manager = false, string? email = null, bool? enabled = null) =>
        new(id, manager, enabled is not null || email is not null, email, enabled ?? true);

    private static string[] Emails(BookingNotificationRecipientSet set) => set.Recipients.Select(r => r.Email).ToArray();

    [Theory]
    [InlineData("a@b.example", true, "a@b.example")]
    [InlineData("  A@B.Example  ", true, "a@b.example")]
    [InlineData("first.last+tag@b.example", true, "first.last+tag@b.example")] // dots and plus tags are kept
    [InlineData("a@b.example\r\n", false, "")]       // CR/LF anywhere, trailing too (the shared normaliser would trim it)
    [InlineData("a@b.example\n", false, "")]
    [InlineData("a@b.example\rBcc: x@y.example", false, "")]
    [InlineData("a@b.example,c@d.example", false, "")] // one address only: no list
    [InlineData("a@b.example;c@d.example", false, "")]
    [InlineData("a@b.example c@d.example", false, "")]
    [InlineData("a@b", false, "")]
    [InlineData("", false, "")]
    [InlineData(null, false, "")]
    public void One_valid_address_is_accepted_and_normalised_and_everything_else_is_refused(string? raw, bool ok, string expected)
    {
        Assert.Equal(ok, BookingNotificationEmail.TryNormalize(raw, out var email));
        Assert.Equal(expected, email);
    }

    [Fact]
    public void An_unconfigured_member_is_not_a_recipient_and_nothing_falls_back_to_a_login_address()
    {
        var set = BookingRecipientPolicy.Resolve(Property, [Staff(A), Staff(B, manager: true)], NoChain, null);

        Assert.True(set.IsEmpty);
    }

    [Fact]
    public void A_configured_member_is_a_recipient_with_an_opaque_key_that_holds_no_address()
    {
        var set = BookingRecipientPolicy.Resolve(Property, [Staff(A, email: "Desk@B.Example")], NoChain, null);

        var recipient = Assert.Single(set.Recipients);
        Assert.Equal("desk@b.example", recipient.Email);
        Assert.Equal(BookingRecipientKind.Staff, recipient.Kind);
        Assert.Equal(A, recipient.StaffAccountId);
        Assert.Equal($"staff:{A:N}", recipient.Key);
        Assert.DoesNotContain("desk", recipient.Key, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("@", recipient.Key);
        Assert.InRange(recipient.Key.Length, 1, EmailOutboxLimits.RecipientKey);
    }

    [Fact]
    public void A_disabled_row_is_out_and_a_row_with_no_address_changes_nothing()
    {
        var set = BookingRecipientPolicy.Resolve(Property, [Staff(A, email: "a@b.example", enabled: false), Staff(B, email: "b@b.example"), Staff(C, enabled: true)], NoChain, null);

        Assert.Equal(["b@b.example"], Emails(set));
    }

    [Fact]
    public void A_case_or_whitespace_duplicate_is_one_recipient_but_dot_and_plus_aliases_are_never_merged()
    {
        var set = BookingRecipientPolicy.Resolve(
            Property, [Staff(A, email: "Desk@B.Example"), Staff(B, email: " desk@b.example "), Staff(C, email: "de.sk+x@b.example")], NoChain, null);

        Assert.Equal(["de.sk+x@b.example", "desk@b.example"], Emails(set));
        Assert.Equal(A, set.Recipients.Single(r => r.Email == "desk@b.example").StaffAccountId); // the lower Staff id wins the tie
    }

    [Fact]
    public void The_order_is_local_first_then_chain_each_by_address_then_id_whatever_the_input_order()
    {
        var chain = new Dictionary<Guid, string> { [C] = "a-chain@b.example" };
        var members = new[] { Staff(C, manager: true), Staff(B, email: "z@b.example"), Staff(A, email: "m@b.example") };

        var forward = BookingRecipientPolicy.Resolve(Property, members, chain, null);
        var backward = BookingRecipientPolicy.Resolve(Property, members.Reverse(), chain, null);

        Assert.Equal(["m@b.example", "z@b.example", "a-chain@b.example"], Emails(forward));
        Assert.Equal(Emails(forward), Emails(backward));
        Assert.Equal(forward.Recipients.Select(r => r.Key), backward.Recipients.Select(r => r.Key));
    }

    [Fact]
    public void A_chain_manager_receives_only_where_currently_a_manager_and_a_local_address_beats_the_chain_one()
    {
        var chain = new Dictionary<Guid, string> { [A] = "chain-a@b.example", [B] = "chain-b@b.example", [C] = "chain-c@b.example" };

        var set = BookingRecipientPolicy.Resolve(
            Property, [Staff(A, manager: true), Staff(B, manager: false), Staff(C, manager: true, email: "local-c@b.example")], chain, null);

        // A: Manager here, no row -> chain. B: only FrontDesk here -> nothing from the chain. C: local address wins.
        Assert.Equal(["local-c@b.example", "chain-a@b.example"], Emails(set));
        Assert.Equal([BookingRecipientKind.Staff, BookingRecipientKind.ChainManager], set.Recipients.Select(r => r.Kind));
    }

    [Fact]
    public void A_local_opt_out_blocks_the_chain_address_too_but_a_local_row_with_no_address_does_not()
    {
        var chain = new Dictionary<Guid, string> { [A] = "chain-a@b.example", [B] = "chain-b@b.example" };

        var set = BookingRecipientPolicy.Resolve(Property, [Staff(A, manager: true, enabled: false), Staff(B, manager: true, enabled: true)], chain, null);

        Assert.Equal(["chain-b@b.example"], Emails(set));
    }

    [Fact]
    public void The_chain_address_dedups_against_a_local_one_and_local_wins()
    {
        var chain = new Dictionary<Guid, string> { [A] = "same@b.example" };

        var set = BookingRecipientPolicy.Resolve(Property, [Staff(A, manager: true), Staff(B, email: "SAME@b.example")], chain, null);

        var recipient = Assert.Single(set.Recipients);
        Assert.Equal(BookingRecipientKind.Staff, recipient.Kind);
        Assert.Equal(B, recipient.StaffAccountId);
    }

    [Fact]
    public void The_fallback_is_used_only_when_nobody_else_remains_and_is_not_a_staff_identity()
    {
        var withPeople = BookingRecipientPolicy.Resolve(Property, [Staff(A, email: "a@b.example")], NoChain, "desk@b.example");
        var optedOut = BookingRecipientPolicy.Resolve(Property, [Staff(A, email: "a@b.example", enabled: false)], NoChain, "desk@b.example");
        var nobody = BookingRecipientPolicy.Resolve(Property, [], NoChain, "Desk@B.Example");

        Assert.Equal(["a@b.example"], Emails(withPeople));
        var fallback = Assert.Single(optedOut.Recipients);
        Assert.Equal(Emails(nobody), Emails(optedOut));
        Assert.Equal(("desk@b.example", BookingRecipientKind.Fallback, (Guid?)null, $"fallback:{Property:N}"), (fallback.Email, fallback.Kind, fallback.StaffAccountId, fallback.Key));
        Assert.True(fallback.Key.Length <= EmailOutboxLimits.RecipientKey);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not an address")]
    public void No_fallback_and_nobody_eligible_is_a_recognisable_empty_set(string? fallback)
    {
        var set = BookingRecipientPolicy.Resolve(Property, [Staff(A)], NoChain, fallback);

        Assert.True(set.IsEmpty);
        Assert.Empty(set.Recipients);
    }

    [Fact]
    public void The_key_names_the_person_not_the_address_so_an_address_change_keeps_it()
    {
        var before = BookingRecipientPolicy.Resolve(Property, [Staff(A, email: "old@b.example")], NoChain, null);
        var after = BookingRecipientPolicy.Resolve(Property, [Staff(A, email: "new@b.example")], NoChain, null);

        Assert.Equal(before.Recipients[0].Key, after.Recipients[0].Key);
        Assert.NotEqual(before.Recipients[0].Email, after.Recipients[0].Email);
    }

    [Fact]
    public void Chain_settings_are_normalised_and_an_empty_default_is_valid()
    {
        Assert.Empty(new BookingNotificationOptions().Validate());

        var map = new BookingNotificationOptions { ChainManagers = [new ChainManagerEntry { StaffId = A, Email = " Boss@Chain.Example " }] }.Validate();

        Assert.Equal("boss@chain.example", map[A]);
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-000000000000", "a@b.example")] // no Staff id
    [InlineData("00000000-0000-0000-0000-00000000000a", "")]            // no address
    [InlineData("00000000-0000-0000-0000-00000000000a", "a@b.example,c@d.example")]
    [InlineData("00000000-0000-0000-0000-00000000000a", "a@b.example\r\nBcc: x@y.example")]
    public void A_chain_entry_that_cannot_work_fails_loudly_at_start_up(string staffId, string email)
    {
        var options = new BookingNotificationOptions { ChainManagers = [new ChainManagerEntry { StaffId = Guid.Parse(staffId), Email = email }] };

        Assert.Throws<InvalidOperationException>(() => options.Validate());
    }

    [Fact]
    public void A_staff_id_listed_twice_fails_at_start_up()
    {
        var options = new BookingNotificationOptions
        {
            ChainManagers = [new ChainManagerEntry { StaffId = A, Email = "a@b.example" }, new ChainManagerEntry { StaffId = A, Email = "c@d.example" }]
        };

        Assert.Throws<InvalidOperationException>(() => options.Validate());
    }

    [Fact]
    public void Same_address_compares_case_insensitively_after_trimming_and_nothing_else()
    {
        Assert.True(BookingRecipientPolicy.SameAddress(" A@B.example", "a@b.EXAMPLE "));
        Assert.False(BookingRecipientPolicy.SameAddress("a.b@c.example", "ab@c.example"));
        Assert.False(BookingRecipientPolicy.SameAddress("a+x@c.example", "a@c.example"));
    }
}
