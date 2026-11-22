using TheBha.Domain.Bookings;
using TheBha.Domain.Common;

namespace TheBha.UnitTests;

/// <summary>BHA-CHECKOUT-001-PR02: the folio entry invariants, the decimal → VND conversion (F-08) and the one balance function (F-01..F-04).</summary>
public sealed class FolioDomainTests
{
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid ReservationId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly Guid StaffId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 11, 22, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Charge_payment_refund_reversal_and_fee_are_kept_apart_in_the_balance()
    {
        var charge = Entry(FolioEntryKind.RoomCharge, 3_000_000m);
        var payment = Entry(FolioEntryKind.Payment, 1_000_000m);

        var paid = ReservationBalance.From([charge, payment]);
        Assert.Equal((LedgerState.Recorded, 3_000_000L, 1_000_000L, 2_000_000L, 0L), (paid.State, paid.ReceivableAmount, paid.CollectedAmount, paid.BalanceDueAmount, paid.GatewayFeeAmount));

        // F-01: Refund 200.000 (references the Payment, has a reason): C = 800.000, B = 2.200.000.
        var refunded = ReservationBalance.From([charge, payment, Entry(FolioEntryKind.Refund, 200_000m, payment.Id, "guest asked")]);
        Assert.Equal((3_000_000L, 800_000L, 2_200_000L), (refunded.ReceivableAmount, refunded.CollectedAmount, refunded.BalanceDueAmount));

        // F-02: a gateway fee never moves B or C; it is reported on its own.
        var withFee = ReservationBalance.From([charge, payment, Entry(FolioEntryKind.GatewayFee, 25_000m, payment.Id)]);
        Assert.Equal((2_000_000L, 1_000_000L, 25_000L), (withFee.BalanceDueAmount, withFee.CollectedAmount, withFee.GatewayFeeAmount));

        // A reversal lowers what is owed.
        var reversed = ReservationBalance.From([charge, payment, Entry(FolioEntryKind.RoomChargeReversal, 500_000m, charge.Id, "one night waived")]);
        Assert.Equal((2_500_000L, 1_500_000L), (reversed.ReceivableAmount, reversed.BalanceDueAmount));
    }

    [Fact]
    public void A_payment_above_what_is_owed_gives_a_negative_balance_and_the_overpaid_flag()
    {
        var balance = ReservationBalance.From([Entry(FolioEntryKind.RoomCharge, 1_000_000m), Entry(FolioEntryKind.Payment, 1_500_000m)]);

        Assert.Equal(-500_000L, balance.BalanceDueAmount);
        Assert.True(balance.IsOverpaid);
        Assert.False(ReservationBalance.From([Entry(FolioEntryKind.RoomCharge, 1m)]).IsOverpaid);
    }

    [Fact]
    public void Without_a_room_charge_the_ledger_is_not_recorded_and_offers_no_amount_even_with_other_entries()
    {
        foreach (var entries in new FolioEntry[][] { [], [Entry(FolioEntryKind.Payment, 700_000m)] })
        {
            var balance = ReservationBalance.From(entries);

            Assert.Equal(LedgerState.NotRecorded, balance.State);
            Assert.Null(balance.ReceivableAmount);
            Assert.Null(balance.CollectedAmount);
            Assert.Null(balance.BalanceDueAmount);
            Assert.Null(balance.GatewayFeeAmount);
            Assert.False(balance.IsOverpaid);
        }
    }

    [Fact]
    public void Sums_do_not_wrap_and_a_total_outside_the_64_bit_range_is_refused()
    {
        var huge = (decimal)long.MaxValue;
        var charge = Entry(FolioEntryKind.RoomCharge, huge);
        // Two charges: the receivable alone no longer fits a long. The sum is not wrapped into a wrong, smaller number.
        Assert.Throws<DomainException>(() => ReservationBalance.From([charge, Entry(FolioEntryKind.RoomCharge, huge)]));
        // Charge max, payment max: B = 0 is fine.
        Assert.Equal(0L, ReservationBalance.From([charge, Entry(FolioEntryKind.Payment, huge)]).BalanceDueAmount);
        // Receivable max with a refunded payment: C goes negative and B no longer fits.
        var payment = Entry(FolioEntryKind.Payment, 1m);
        Assert.Throws<DomainException>(() => ReservationBalance.From([charge, payment, Entry(FolioEntryKind.Refund, huge, payment.Id, "r")]));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1000000.5")]
    [InlineData("0.01")]
    [InlineData("9223372036854775808")]
    [InlineData("79228162514264337593543950335")]
    public void A_non_positive_fractional_or_out_of_range_amount_is_rejected_not_rounded(string amount)
    {
        Assert.Throws<DomainException>(() => FolioEntry.ToVnd(decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture)));
    }

    [Fact]
    public void The_largest_domain_amount_and_the_largest_bigint_convert_exactly()
    {
        Assert.Equal(9_999_999_999_999_999L, FolioEntry.ToVnd(9_999_999_999_999_999.00m));
        Assert.Equal(long.MaxValue, FolioEntry.ToVnd(9_223_372_036_854_775_807m));
        Assert.Equal(1_000_000L, FolioEntry.ToVnd(1_000_000.00m));
    }

    [Fact]
    public void The_constructor_enforces_currency_reference_reason_actor_and_key_rules()
    {
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.RoomCharge, 1m, currency: "USD"));
        Assert.Equal("VND", Entry(FolioEntryKind.RoomCharge, 1m, currency: "vnd").CurrencyCode);
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.Refund, 1m, reference: null, reason: "r"));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.GatewayFee, 1m, reference: null));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.Payment, 1m, reference: Guid.NewGuid()));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.RoomChargeReversal, 1m, reference: Guid.NewGuid(), reason: null));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.Refund, 1m, reference: Guid.NewGuid(), reason: "   "));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.RoomCharge, 1m, postingKey: "  "));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.RoomCharge, 1m, postingKey: new string('k', BookingFieldLimits.PostingKey + 1)));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.Refund, 1m, reference: Guid.NewGuid(), reason: new string('r', BookingFieldLimits.FolioReason + 1)));
        Assert.Throws<DomainException>(() => Entry(FolioEntryKind.RoomCharge, 1m, occurredAt: new DateTimeOffset(2026, 11, 22, 17, 0, 0, TimeSpan.FromHours(7))));
        Assert.Throws<DomainException>(() => FolioActor.Staff(Guid.Empty));
        var staff = Entry(FolioEntryKind.Payment, 1m, actor: FolioActor.Staff(StaffId));
        Assert.Equal((FolioActorKind.Staff, (Guid?)StaffId), (staff.ActorKind, staff.ActorStaffId));
        Assert.Null(Entry(FolioEntryKind.RoomCharge, 1m).ActorStaffId);
    }

    [Fact]
    public void Key_and_reason_are_trimmed_and_instants_are_cut_to_the_stored_microsecond()
    {
        var entry = Entry(
            FolioEntryKind.Refund, 5m, Guid.NewGuid(), "  because  ", postingKey: "  staff:abc  ",
            occurredAt: Now.AddTicks(7));

        Assert.Equal(("staff:abc", "because"), (entry.PostingKey, entry.Reason));
        Assert.Equal(Now, entry.OccurredAtUtc);
    }

    [Fact]
    public void The_replay_comparison_covers_the_business_fields_and_ignores_id_and_server_time()
    {
        var reference = Guid.NewGuid();
        var original = Entry(FolioEntryKind.Refund, 100m, reference, "same", recordedAt: Now);

        Assert.True(original.HasSamePostingAs(Entry(FolioEntryKind.Refund, 100m, reference, "same", recordedAt: Now.AddHours(3))));
        Assert.False(original.HasSamePostingAs(Entry(FolioEntryKind.Refund, 101m, reference, "same")));
        Assert.False(original.HasSamePostingAs(Entry(FolioEntryKind.GatewayFee, 100m, reference, "same")));
        Assert.False(original.HasSamePostingAs(Entry(FolioEntryKind.Refund, 100m, Guid.NewGuid(), "same")));
        Assert.False(original.HasSamePostingAs(Entry(FolioEntryKind.Refund, 100m, reference, "other")));
        Assert.False(original.HasSamePostingAs(Entry(FolioEntryKind.Refund, 100m, reference, "same", actor: FolioActor.Staff(StaffId))));
        Assert.False(original.HasSamePostingAs(Entry(FolioEntryKind.Refund, 100m, reference, "same", occurredAt: Now.AddSeconds(1))));
    }

    private static FolioEntry Entry(
        FolioEntryKind kind,
        decimal amount,
        Guid? reference = null,
        string? reason = null,
        string currency = "VND",
        string postingKey = "key",
        FolioActor? actor = null,
        DateTimeOffset? occurredAt = null,
        DateTimeOffset? recordedAt = null) =>
        new(
            Guid.NewGuid(), PropertyId, ReservationId, kind, amount, currency, postingKey,
            reference, actor ?? FolioActor.System, reason, occurredAt ?? Now, recordedAt ?? Now);
}
