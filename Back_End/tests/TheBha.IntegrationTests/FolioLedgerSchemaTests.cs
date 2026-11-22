using Npgsql;
using static TheBha.IntegrationTests.FolioTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR02 (F-06, F-07) on the real schema: every invariant is checked by sending raw SQL straight to PostgreSQL, around the application, so what is proven is the database and not the
/// writer. The application-side rules are in <see cref="FolioPostingTests"/>.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class FolioLedgerSchemaTests(PostgreSqlWebApplicationFactory factory)
{
    private const string CheckViolation = PostgresErrorCodes.CheckViolation;
    private const string ForeignKeyViolation = PostgresErrorCodes.ForeignKeyViolation;

    [Fact]
    public async Task The_database_refuses_a_non_positive_amount_a_foreign_currency_an_unknown_kind_and_a_missing_reason_or_reference()
    {
        var seed = await SeedFreshAsync();
        var charge = await InsertValidAsync(seed, "RoomCharge", "charge:initial");
        var payment = await InsertValidAsync(seed, "Payment", "payment:1");

        Assert.Equal((CheckViolation, "CK_FolioEntries_Amount"), await Raw(Insert(seed, "RoomCharge", "a0", amount: "0")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Amount"), await Raw(Insert(seed, "RoomCharge", "a1", amount: "-5")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Currency"), await Raw(Insert(seed, "RoomCharge", "c0", currency: "USD")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Kind"), await Raw(Insert(seed, "Bonus", "k0")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Reason"), await Raw(Insert(seed, "Refund", "r0", reference: payment)));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Reason"), await Raw(Insert(seed, "RoomChargeReversal", "r1", reference: charge, reason: "   ")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Reference"), await Raw(Insert(seed, "Refund", "r2", reason: "no reference")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Reference"), await Raw(Insert(seed, "GatewayFee", "r3")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Reference"), await Raw(Insert(seed, "Payment", "r4", reference: payment)));
        Assert.Equal((CheckViolation, "CK_FolioEntries_PostingKey"), await Raw(Insert(seed, "RoomCharge", "  ")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Actor"), await Raw(Insert(seed, "RoomCharge", "s0", actorKind: "Staff")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Actor"), await Raw(Insert(seed, "RoomCharge", "s1", actorKind: "System", staff: seed.StaffId)));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Actor"), await Raw(Insert(seed, "RoomCharge", "s2", actorKind: "Robot")));
        Assert.Equal((CheckViolation, "CK_FolioEntries_Ids"), await Raw(Insert(seed, "RoomCharge", "i0", id: Guid.Empty)));
        // A Refund that names its Payment, with a reason, is accepted: the refusals above are about the shape, not about Refunds.
        Assert.Null(await Raw(Insert(seed, "Refund", "r-ok", reference: payment, reason: "guest asked", amount: "1")));
        Assert.Equal(3, await Count(seed));
    }

    [Fact]
    public async Task The_database_refuses_a_foreign_reservation_a_cross_reservation_reference_a_wrong_reference_kind_and_an_unknown_actor()
    {
        var seed = await SeedFreshAsync();
        var charge = await InsertValidAsync(seed, "RoomCharge", "charge:initial");
        var payment = await InsertValidAsync(seed, "Payment", "payment:1");
        var otherPayment = await InsertValidAsync(seed, "Payment", "payment:1", reservation: seed.HoldSourcedId);

        // The Reservation belongs to another Property: the composite FK (PropertyId, ReservationId) refuses it.
        Assert.Equal((ForeignKeyViolation, "FK_FolioEntries_Reservations_PropertyId_ReservationId"), await Raw(Insert(seed, "RoomCharge", "p0", property: seed.OtherPropertyId)));
        Assert.Equal((ForeignKeyViolation, "FK_FolioEntries_Reservations_PropertyId_ReservationId"), await Raw(Insert(seed, "RoomCharge", "p1", reservation: Guid.NewGuid())));
        // A reference may only point inside the same Reservation (self-FK on (ReservationId, ReferenceEntryId)); a missing entry is refused the same way.
        Assert.Equal((ForeignKeyViolation, "FK_FolioEntries_FolioEntries_ReservationId_ReferenceEntryId"), await Raw(Insert(seed, "Refund", "x0", reference: otherPayment, reason: "cross")));
        Assert.Equal((ForeignKeyViolation, "FK_FolioEntries_FolioEntries_ReservationId_ReferenceEntryId"), await Raw(Insert(seed, "Refund", "x1", reference: Guid.NewGuid(), reason: "missing")));
        // The kind a reference needs: Reversal → RoomCharge; Refund and GatewayFee → Payment.
        Assert.Equal(("XBHA7", null), await Raw(Insert(seed, "RoomChargeReversal", "w0", reference: payment, reason: "wrong kind")));
        Assert.Equal(("XBHA7", null), await Raw(Insert(seed, "Refund", "w1", reference: charge, reason: "wrong kind")));
        Assert.Equal(("XBHA7", null), await Raw(Insert(seed, "GatewayFee", "w2", reference: charge)));
        Assert.Null(await Raw(Insert(seed, "GatewayFee", "w-ok", reference: payment)));
        Assert.Null(await Raw(Insert(seed, "RoomChargeReversal", "w-ok2", reference: charge, reason: "waived", amount: "1")));
        // A Staff actor must be a real account; with one it is stored with the id.
        Assert.Equal((ForeignKeyViolation, "FK_FolioEntries_StaffAccounts_ActorStaffId"), await Raw(Insert(seed, "RoomCharge", "f0", actorKind: "Staff", staff: Guid.NewGuid())));
        Assert.Null(await Raw(Insert(seed, "Payment", "staff:ok", actorKind: "Staff", staff: seed.StaffId)));
        // The same key twice in one Reservation is refused by the unique index; in another Reservation it is a different key.
        Assert.Equal((PostgresErrorCodes.UniqueViolation, "IX_FolioEntries_ReservationId_PostingKey"), await Raw(Insert(seed, "RoomCharge", "charge:initial")));
        Assert.Null(await Raw(Insert(seed, "RoomCharge", "charge:initial", reservation: seed.HoldSourcedId)));
    }

    [Fact]
    public async Task A_reservation_in_another_currency_cannot_get_an_entry_even_one_that_says_VND()
    {
        var seed = await SeedFreshAsync();

        Assert.Equal(("XBHA6", null), await Raw(Insert(seed, "RoomCharge", "usd", reservation: seed.UsdDirectId)));
        Assert.Equal(0, await ScalarAsync<long>(factory.ConnectionString, $"""SELECT count(*) FROM "FolioEntries" WHERE "ReservationId" = '{seed.UsdDirectId}'"""));
    }

    [Fact]
    public async Task Update_and_delete_are_refused_by_the_database_itself_and_the_row_is_unchanged()
    {
        var seed = await SeedFreshAsync();
        var charge = await InsertValidAsync(seed, "RoomCharge", "charge:initial");

        Assert.Equal(("XBHA5", null), await Raw($"""UPDATE "FolioEntries" SET "Amount" = 1 WHERE "Id" = '{charge}'"""));
        Assert.Equal(("XBHA5", null), await Raw($"""UPDATE "FolioEntries" SET "Reason" = 'edited' WHERE "Id" = '{charge}'"""));
        Assert.Equal(("XBHA5", null), await Raw($"""DELETE FROM "FolioEntries" WHERE "Id" = '{charge}'"""));
        Assert.Equal(("XBHA5", null), await Raw("""DELETE FROM "FolioEntries" """));
        Assert.Equal(1000L, await ScalarAsync<long>(factory.ConnectionString, $"""SELECT "Amount" FROM "FolioEntries" WHERE "Id" = '{charge}'"""));
        Assert.Equal(1, await Count(seed));

        // A Reservation that has entries cannot be deleted either (Restrict): the entries are never cascaded away.
        var restricted = PostgresVersionSupport.RestrictedParentDelete(await PostgresVersionSupport.ServerMajorAsync(factory.ConnectionString));
        Assert.Equal((restricted, "FK_FolioEntries_Reservations_PropertyId_ReservationId"), await Raw($"""DELETE FROM "Reservations" WHERE "Id" = '{seed.DirectId}'"""));
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    private async Task<FolioSeed> SeedFreshAsync()
    {
        await factory.ResetDatabaseAsync();
        return await SeedAsync(factory.CreateDbContext);
    }

    private Task<(string SqlState, string? Constraint)?> Raw(string sql) => RawAsync(factory.ConnectionString, sql);

    private Task<long> Count(FolioSeed seed) =>
        ScalarAsync<long>(factory.ConnectionString, $"""SELECT count(*) FROM "FolioEntries" WHERE "PropertyId" = '{seed.PropertyId}'""");

    private async Task<Guid> InsertValidAsync(FolioSeed seed, string kind, string key, Guid? reservation = null)
    {
        var id = Guid.NewGuid();
        Assert.Null(await Raw(Insert(seed, kind, key, id: id, reservation: reservation)));
        return id;
    }

    private static string Insert(
        FolioSeed seed,
        string kind,
        string key,
        Guid? id = null,
        Guid? property = null,
        Guid? reservation = null,
        string amount = "1000",
        string currency = "VND",
        Guid? reference = null,
        string actorKind = "System",
        Guid? staff = null,
        string? reason = null) =>
        $"""
         INSERT INTO "FolioEntries" ("Id","PropertyId","ReservationId","Kind","Amount","CurrencyCode","PostingKey","ReferenceEntryId","ActorKind","ActorStaffId","Reason","OccurredAtUtc","RecordedAtUtc")
         VALUES ('{id ?? Guid.NewGuid()}','{property ?? seed.PropertyId}','{reservation ?? seed.DirectId}','{kind}',{amount},'{currency}','{key}',{Nullable(reference)},'{actorKind}',{Nullable(staff)},{(reason is null ? "NULL" : $"'{reason}'")},now(),now())
         """;

    private static string Nullable(Guid? value) => value is null ? "NULL" : $"'{value}'";
}
