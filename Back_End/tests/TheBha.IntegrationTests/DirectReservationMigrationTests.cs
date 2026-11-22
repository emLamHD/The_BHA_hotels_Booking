using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Persistence;
using Xunit.Abstractions;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR01 rehearsal (S1 §1.6, T-01/T-02): the real migration chain builds the pre-PR01 schema, a synthetic fixture is written to it with
/// raw SQL (the current model cannot write that shape), the checks C1-C7 are captured before and after "AddDirectReservationSource", and its Down is
/// proven on both outcomes. Owns one disposable database per test. Output carries counts and hashes only, never a token hash or a guest field.
/// </summary>
public sealed class DirectReservationMigrationTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string PreMigration = "20261121162308_AddNewsletterActivityCutover";
    private const string PrMigration = "20261122070757_AddDirectReservationSource";

    private static readonly Guid PropertyId = Guid.Parse("a1000000-0000-0000-0000-0000000000a1");
    private static readonly Guid RoomTypeId = Guid.Parse("a1000000-0000-0000-0000-0000000000a2");
    private static readonly Guid RatePlanId = Guid.Parse("a1000000-0000-0000-0000-0000000000a3");
    private static readonly Guid CustomerId = Guid.Parse("a1000000-0000-0000-0000-0000000000a4");
    private static readonly Guid PromotionId = Guid.Parse("a1000000-0000-0000-0000-0000000000a5");

    // Fixture ids: holds 0x10.., items 0x20.., reservations 0x30..
    private static readonly Guid ActiveGuestHold = Id(0x10);
    private static readonly Guid ActiveCustomerPromoHold = Id(0x11);
    private static readonly Guid ConfirmedGuestHold = Id(0x12);
    private static readonly Guid ConfirmedCustomerPromoHold = Id(0x13);
    private static readonly Guid CancelledReservationHold = Id(0x14);
    private static readonly Guid CancelledHold = Id(0x15);
    private static readonly Guid ConfirmedGuestReservation = Id(0x32);
    private static readonly Guid ConfirmedCustomerPromoReservation = Id(0x33);
    private static readonly Guid CancelledReservation = Id(0x34);

    private static readonly string[] CheckedTables =
        ["Reservations", "ReservationUnits", "ReservationUnitNights", "BookingPromotionApplications", "InventoryHolds", "InventoryHoldItems", "InventoryHoldItemNights"];

    private readonly string _administrativeConnectionString = AdministrativeConnectionString();
    private string _connectionString = string.Empty;
    private string _databaseName = string.Empty;

    public async Task InitializeAsync()
    {
        _databaseName = $"thebha_pr01_{Guid.NewGuid():N}";
        _connectionString = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")!)
        {
            Database = _databaseName,
            Pooling = false
        }.ConnectionString;
        await ExecuteOnAsync(_administrativeConnectionString, $"CREATE DATABASE \"{_databaseName}\"");
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await ExecuteOnAsync(_administrativeConnectionString, $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)");
    }

    [Fact]
    public async Task Rehearsal_legacy_fixture_survives_the_migration_with_equal_checksums_and_every_row_a_Hold_row()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        output.WriteLine($"PostgreSQL {await ScalarAsync<string>("SHOW server_version")}; schema = real migration chain up to {PreMigration}");
        await SeedLegacyFixtureAsync();

        var baselineColumns = await BaselineColumnsAsync();
        var before = await CaptureAsync(baselineColumns, includeSource: false);
        Assert.Equal(6, before.Hash["InventoryHolds"].Count);
        Assert.Equal(3, before.Hash["Reservations"].Count);
        Assert.Equal(2, before.Hash["BookingPromotionApplications"].Count);

        await Migrator(context).MigrateAsync(PrMigration);
        var after = await CaptureAsync(baselineColumns, includeSource: true);

        output.WriteLine("C1 (rows / md5 of per-row to_jsonb of the pre-migration columns, ordered by key), before == after:");
        foreach (var table in CheckedTables)
        {
            output.WriteLine($"  {table}: {before.Hash[table].Count} rows, before={before.Hash[table].Checksum} after={after.Hash[table].Checksum}");
            Assert.Equal(before.Hash[table], after.Hash[table]);
        }

        output.WriteLine($"C1 summary: reservations={before.Reservations} total={before.TotalAmount} (after: {after.Reservations} / {after.TotalAmount})");
        Assert.Equal((before.Reservations, before.TotalAmount), (after.Reservations, after.TotalAmount));
        output.WriteLine($"C2 orphan holds: before={before.OrphanHolds} after(migration, no Direct yet)={after.OrphanHolds}");
        Assert.Equal(0, before.OrphanHolds);
        Assert.Equal(0, after.OrphanHolds);
        output.WriteLine($"C3 total != nights: before={before.TotalMismatch} after={after.TotalMismatch}");
        Assert.Equal(0, before.TotalMismatch);
        Assert.Equal(0, after.TotalMismatch);
        output.WriteLine($"C4 reservations with units without source item (report): before={before.UnitsWithoutSource} after={after.UnitsWithoutSource}");
        Assert.Equal(before.UnitsWithoutSource, after.UnitsWithoutSource);
        output.WriteLine($"C5 VND fractional (report): before={before.VndFractional} after={after.VndFractional}; non-VND: before={before.NonVnd} after={after.NonVnd}");
        Assert.Equal((before.VndFractional, before.NonVnd), (after.VndFractional, after.NonVnd));
        output.WriteLine($"C6 Source != SourceHoldId (after only): {after.SourceMismatch}");
        Assert.Equal(0, after.SourceMismatch);
        output.WriteLine($"C7 confirmed holds whose promotion is not linked (report): before={before.UnlinkedConfirmedPromotions} after={after.UnlinkedConfirmedPromotions}");
        Assert.Equal(before.UnlinkedConfirmedPromotions, after.UnlinkedConfirmedPromotions);

        Assert.Equal(3, await ScalarAsync<long>("""SELECT count(*) FROM "Reservations" WHERE "Source" = 'Hold'"""));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "BookingPromotionApplications" WHERE "Id" <> "HoldId" """));
        // Preserved FK / delete behavior / uniqueness: the shapes the model relies on are still in the catalog.
        var catalog = await CatalogAsync();
        Assert.Contains("IX_BookingPromotionApplications_ReservationId", catalog);
        Assert.Contains("IX_BookingPromotionApplications_HoldId", catalog);
        Assert.Contains("FK_BookingPromotionApplications_InventoryHolds_HoldId|FOREIGN KEY (\"HoldId\") REFERENCES \"InventoryHolds\"(\"Id\") ON DELETE CASCADE", catalog);
        Assert.Contains("FK_BookingPromotionApplications_Reservations_ReservationId|FOREIGN KEY (\"ReservationId\") REFERENCES \"Reservations\"(\"Id\") ON DELETE RESTRICT", catalog);

        // C2 once a Direct row exists: only Hold-sourced rows can be orphans.
        await using (var seed = CreateContext())
        {
            seed.Reservations.Add(Reservation.CreateDirect(
                Id(0x40), "BHA-DIRECT-0001", PropertyId, null, "Direct Guest", "direct@example.com", "+84 900 000 777",
                new DateOnly(2026, 12, 20), new DateOnly(2026, 12, 21), 1, 0, "VND", DateTimeOffset.Parse("2026-11-22T00:00:00Z"), new string('e', 64),
                [new ReservationUnitPlan(null, RoomTypeId, [new NightlyCommitmentSnapshot(new DateOnly(2026, 12, 20), RatePlanId, 100m)])]));
            await seed.SaveChangesAsync();
        }

        var orphansWithDirect = await ScalarAsync<long>(OrphanHoldsSql(sourceAware: true));
        output.WriteLine($"C2 after a Direct row (Source='Hold' rows only): {orphansWithDirect}; Direct rows = {await ScalarAsync<long>("""SELECT count(*) FROM "Reservations" WHERE "Source" = 'Direct'""")}");
        Assert.Equal(0, orphansWithDirect);
        Assert.Equal(0, await ScalarAsync<long>(SourceMismatchSql));
    }

    [Fact]
    public async Task A_writer_built_before_the_migration_still_writes_and_updates_both_tables()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        await SeedLegacyFixtureAsync();
        await Migrator(context).MigrateAsync(PrMigration);

        // A new Hold (pre-PR01 column lists, so no Source and no Id) confirmed by the pre-PR01 statements.
        var holdId = Id(0x50);
        var itemId = Id(0x51);
        var reservationId = Id(0x52);
        await ExecuteAsync(HoldSql(holdId, itemId, "Active", null, 90m, 100m, 0x50));
        await ExecuteAsync(
            $"""
             INSERT INTO "BookingPromotionApplications"
                 ("HoldId","ReservationId","PromotionId","PromotionVersion","Slug","Title","Kind","Value","CurrencyCode","ListTotalAmount","DiscountTotalAmount")
             VALUES ('{holdId}', NULL, '{PromotionId}', 1, 'old-writer', 'Old writer', 'Percent', 10, NULL, 200, 20);
             UPDATE "InventoryHolds" SET "Status" = 'Confirmed' WHERE "Id" = '{holdId}';
             """);
        await ExecuteAsync(ReservationSql(reservationId, holdId, itemId, "Confirmed", null, 90m, 100m, includeSource: false));

        var updated = await ExecuteAsync($"""UPDATE "BookingPromotionApplications" SET "ReservationId" = '{reservationId}' WHERE "HoldId" = '{holdId}'""");

        Assert.Equal(1, updated);
        Assert.Equal("Hold", await ScalarAsync<string>($"""SELECT "Source" FROM "Reservations" WHERE "Id" = '{reservationId}'"""));
        Assert.NotEqual(Guid.Empty, await ScalarAsync<Guid>($"""SELECT "Id" FROM "BookingPromotionApplications" WHERE "HoldId" = '{holdId}'"""));
        Assert.Equal(reservationId, await ScalarAsync<Guid>($"""SELECT "ReservationId" FROM "BookingPromotionApplications" WHERE "HoldId" = '{holdId}'"""));
    }

    [Fact]
    public async Task Down_refuses_while_a_Direct_reservation_exists_and_changes_nothing()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        await SeedLegacyFixtureAsync();
        await Migrator(context).MigrateAsync(PrMigration);
        await SeedDirectWithPromotionAsync();
        var snapshot = await FullSnapshotAsync();

        var error = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));

        Assert.Contains("Direct Reservation row(s)", error.MessageText);
        Assert.Equal(snapshot, await FullSnapshotAsync());
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        output.WriteLine($"Down with a Direct row: refused ({error.SqlState}), catalog + data identical.");
    }

    [Fact]
    public async Task Down_refuses_a_promotion_without_a_hold_even_on_a_Hold_reservation_and_changes_nothing()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        await SeedLegacyFixtureAsync();
        await Migrator(context).MigrateAsync(PrMigration);
        // The database allows this shape (CK only asks for one id); the second guard is reachable on its own.
        await ExecuteAsync(
            $"""
             INSERT INTO "BookingPromotionApplications"
                 ("ReservationId","PromotionId","PromotionVersion","Slug","Title","Kind","Value","CurrencyCode","ListTotalAmount","DiscountTotalAmount")
             VALUES ('{ConfirmedGuestReservation}', '{PromotionId}', 1, 'no-hold', 'No hold', 'Percent', 10, NULL, 200, 20)
             """);
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "Reservations" WHERE "Source" = 'Direct'"""));
        var snapshot = await FullSnapshotAsync();

        var error = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));

        Assert.Contains("BookingPromotionApplications row(s) have no HoldId", error.MessageText);
        Assert.Equal(snapshot, await FullSnapshotAsync());
        output.WriteLine($"Down with a Hold-less promotion: refused ({error.SqlState}), catalog + data identical.");
    }

    [Fact]
    public async Task Down_on_a_Hold_only_database_restores_the_previous_schema_and_every_legacy_value()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        await SeedLegacyFixtureAsync();
        var baselineColumns = await BaselineColumnsAsync();
        var schemaBefore = await CatalogAsync();
        var before = await CaptureAsync(baselineColumns, includeSource: false);

        await Migrator(context).MigrateAsync(PrMigration);
        await Migrator(context).MigrateAsync(PreMigration);

        Assert.Equal(schemaBefore, await CatalogAsync());
        var after = await CaptureAsync(baselineColumns, includeSource: false);
        foreach (var table in CheckedTables)
        {
            Assert.Equal(before.Hash[table], after.Hash[table]);
        }

        Assert.Equal("NO", await ScalarAsync<string>("""SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Reservations' AND column_name = 'SourceHoldId'"""));
        Assert.Equal("NO", await ScalarAsync<string>("""SELECT is_nullable FROM information_schema.columns WHERE table_name = 'BookingPromotionApplications' AND column_name = 'HoldId'"""));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM information_schema.columns WHERE (table_name, column_name) IN (('Reservations','Source'),('BookingPromotionApplications','Id'))"""));
        output.WriteLine("Down on a Hold-only database: catalog and C1 checksums equal the pre-migration ones.");

        // The chain can go forward again from there.
        await Migrator(context).MigrateAsync(PrMigration);
        Assert.Equal(3, await ScalarAsync<long>("""SELECT count(*) FROM "Reservations" WHERE "Source" = 'Hold'"""));
    }

    private async Task SeedDirectWithPromotionAsync()
    {
        await using var seed = CreateContext();
        seed.Reservations.Add(Reservation.CreateDirect(
            Id(0x41), "BHA-DIRECT-0002", PropertyId, null, "Direct Guest", "direct@example.com", "+84 900 000 777",
            new DateOnly(2026, 12, 20), new DateOnly(2026, 12, 21), 1, 0, "VND", DateTimeOffset.Parse("2026-11-22T00:00:00Z"), new string('e', 64),
            [new ReservationUnitPlan(null, RoomTypeId, [new NightlyCommitmentSnapshot(new DateOnly(2026, 12, 20), RatePlanId, 90m, 100m)])],
            new AppliedPromotionSnapshot(PromotionId, 1, "direct-promo", "Direct promo", TheBha.Domain.Promotions.PromotionDiscountKind.Percent, 10m, null)));
        await seed.SaveChangesAsync();
    }

    // ---- fixture -------------------------------------------------------------------------------------------------

    private async Task SeedLegacyFixtureAsync()
    {
        var sql = new System.Text.StringBuilder();
        sql.Append(
            $"""
             INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
             VALUES ('{PropertyId}','Rehearsal Property','rehearsal-property',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');
             INSERT INTO "RoomTypes" ("Id","PropertyId","Code","Name","Slug","Description","BaseOccupancy","MaxOccupancy","IsActive","CreatedAt","UpdatedAt")
             VALUES ('{RoomTypeId}','{PropertyId}','DLX','Deluxe','deluxe-rehearsal',NULL,2,4,true,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');
             INSERT INTO "RatePlans" ("Id","PropertyId","Code","Name","Description","CurrencyCode","IsActive","CreatedAt","UpdatedAt")
             VALUES ('{RatePlanId}','{PropertyId}','STD','Standard',NULL,'VND',true,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');
             INSERT INTO "AspNetUsers" ("Id","Email","NormalizedEmail","UserName","NormalizedUserName","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount","SecurityStamp","ConcurrencyStamp")
             VALUES ('{CustomerId}','customer@example.com','CUSTOMER@EXAMPLE.COM','customer@example.com','CUSTOMER@EXAMPLE.COM',true,false,false,false,0,'stamp','stamp');
             INSERT INTO "Promotions" ("Id","PropertyId","Slug","Status","Kind","Value","AllRoomTypes","MinNights","Title","Summary","BodyParagraphs","ShowOnHomepage","SortOrder","CreatedAtUtc","UpdatedAtUtc","CreatedByStaffId","UpdatedByStaffId","CreateOperationId","CreateFingerprint")
             VALUES ('{PromotionId}','{PropertyId}','rehearsal-promo','Published','Percent',10,true,1,'Rehearsal promo','Summary',ARRAY['x']::text[],false,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','{Id(0x60)}','{Id(0x60)}','{Id(0x61)}',repeat('a',64));

             """);
        // (hold, status, owner, unit, list, reservation status or null, promotion)
        sql.Append(HoldSql(ActiveGuestHold, Id(0x20), "Active", null, 100m, 100m, 0x10));
        sql.Append(HoldSql(ActiveCustomerPromoHold, Id(0x21), "Active", CustomerId, 90m, 100m, 0x11));
        sql.Append(HoldSql(ConfirmedGuestHold, Id(0x22), "Confirmed", null, 100m, 100m, 0x12));
        sql.Append(HoldSql(ConfirmedCustomerPromoHold, Id(0x23), "Confirmed", CustomerId, 90m, 100m, 0x13));
        sql.Append(HoldSql(CancelledReservationHold, Id(0x24), "Confirmed", null, 100.25m, 100.25m, 0x14));
        sql.Append(HoldSql(CancelledHold, Id(0x25), "Cancelled", null, 100m, 100m, 0x15));
        sql.Append(ReservationSql(ConfirmedGuestReservation, ConfirmedGuestHold, Id(0x22), "Confirmed", null, 100m, 100m, includeSource: false));
        sql.Append(ReservationSql(ConfirmedCustomerPromoReservation, ConfirmedCustomerPromoHold, Id(0x23), "Confirmed", CustomerId, 90m, 100m, includeSource: false));
        // The legacy shape the persistence fixtures already use: a Cancelled reservation whose unit has no source item, with fractional VND nights.
        sql.Append(ReservationSql(CancelledReservation, CancelledReservationHold, null, "Cancelled", null, 100.25m, 100.25m, includeSource: false));
        sql.Append(
            $"""
             INSERT INTO "BookingPromotionApplications"
                 ("HoldId","ReservationId","PromotionId","PromotionVersion","Slug","Title","Kind","Value","CurrencyCode","ListTotalAmount","DiscountTotalAmount")
             VALUES
                 ('{ActiveCustomerPromoHold}', NULL, '{PromotionId}', 1, 'rehearsal-promo', 'Rehearsal promo', 'Percent', 10, NULL, 200, 20),
                 ('{ConfirmedCustomerPromoHold}', '{ConfirmedCustomerPromoReservation}', '{PromotionId}', 1, 'rehearsal-promo', 'Rehearsal promo', 'Percent', 10, NULL, 200, 20);
             """);

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand(sql.ToString(), connection, transaction))
        {
            await command.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
    }

    private static string HoldSql(Guid holdId, Guid itemId, string status, Guid? customerId, decimal unit, decimal list, int seed)
    {
        var owner = customerId is null ? "NULL" : $"'{customerId}'";
        var guest = customerId is null ? $"repeat('{seed % 10}',64)" : "NULL";
        return
            $"""
             INSERT INTO "InventoryHolds"
                 ("Id","PropertyId","CustomerAccountId","FullName","Email","Phone","CheckIn","CheckOut","Adults","Children","CurrencyCode","TotalAmount","Status",
                  "CreatedAtUtc","ExpiresAtUtc","IdempotencyKeyHash","RequestFingerprint","GuestAccessTokenHash")
             VALUES ('{holdId}','{PropertyId}',{owner},'Rehearsal Guest {seed}','guest{seed}@example.com','+84 900 000 {seed:000}','2026-12-10','2026-12-12',2,0,'VND',{unit * 2},'{status}',
                     '2026-11-20T09:00:00Z','2026-11-20T09:15:00Z',md5('i{seed}') || md5('j{seed}'),md5('k{seed}') || md5('l{seed}'),{guest});
             INSERT INTO "InventoryHoldItems" ("Id","InventoryHoldId","PropertyId","RoomTypeId") VALUES ('{itemId}','{holdId}','{PropertyId}','{RoomTypeId}');
             INSERT INTO "InventoryHoldItemNights" ("InventoryHoldItemId","StayDate","PropertyId","RatePlanId","UnitAmount","ListUnitAmount") VALUES
                 ('{itemId}','2026-12-10','{PropertyId}','{RatePlanId}',{unit},{list}),
                 ('{itemId}','2026-12-11','{PropertyId}','{RatePlanId}',{unit},{list});

             """;
    }

    private static string ReservationSql(Guid reservationId, Guid holdId, Guid? sourceItemId, string status, Guid? customerId, decimal unit, decimal list, bool includeSource)
    {
        var owner = customerId is null ? "NULL" : $"'{customerId}'";
        var guest = customerId is null ? $"repeat('{(reservationId.ToByteArray()[0] % 10)}',64)" : "NULL";
        var cancelled = status == "Cancelled";
        var unitId = Guid.NewGuid();
        var source = sourceItemId is null ? "NULL" : $"'{sourceItemId}'";
        return
            $"""
             INSERT INTO "Reservations"
                 ("Id","ConfirmationNumber","SourceHoldId","PropertyId","CustomerAccountId","FullName","Email","Phone","CheckIn","CheckOut","Adults","Children","CurrencyCode","TotalAmount",
                  "Status","ConfirmedAtUtc","CancelledAtUtc","CancellationReason","GuestAccessTokenHash"{(includeSource ? ",\"Source\"" : "")})
             VALUES ('{reservationId}','BHA-{reservationId.ToString("N")[^10..].ToUpperInvariant()}','{holdId}','{PropertyId}',{owner},'Rehearsal Guest','guest@example.com','+84 900 000 000','2026-12-10','2026-12-12',2,0,'VND',{unit * 2},
                     '{status}','2026-11-20T09:05:00Z',{(cancelled ? "'2026-11-21T01:00:00Z'" : "NULL")},{(cancelled ? "'Rehearsal cancellation'" : "NULL")},{guest}{(includeSource ? ",'Hold'" : "")});
             INSERT INTO "ReservationUnits" ("Id","ReservationId","PropertyId","RoomTypeId","SourceInventoryHoldItemId","CommitmentStatus")
             VALUES ('{unitId}','{reservationId}','{PropertyId}','{RoomTypeId}',{source},'{(cancelled ? "Cancelled" : "Committed")}');
             INSERT INTO "ReservationUnitNights" ("ReservationUnitId","StayDate","PropertyId","RatePlanId","UnitAmount","ListUnitAmount") VALUES
                 ('{unitId}','2026-12-10','{PropertyId}','{RatePlanId}',{unit},{list}),
                 ('{unitId}','2026-12-11','{PropertyId}','{RatePlanId}',{unit},{list});

             """;
    }

    // ---- C1-C7 ---------------------------------------------------------------------------------------------------

    private const string SourceMismatchSql = """SELECT count(*) FROM "Reservations" WHERE ("Source" = 'Hold') <> ("SourceHoldId" IS NOT NULL)""";

    private static string OrphanHoldsSql(bool sourceAware) =>
        $"""
         SELECT count(*) FROM "Reservations" r
         LEFT JOIN "InventoryHolds" h ON h."Id" = r."SourceHoldId" AND h."PropertyId" = r."PropertyId"
         WHERE h."Id" IS NULL{(sourceAware ? " AND r.\"Source\" = 'Hold'" : "")}
         """;

    private async Task<Dictionary<string, string[]>> BaselineColumnsAsync()
    {
        var columns = new Dictionary<string, string[]>();
        foreach (var table in CheckedTables)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = @t ORDER BY ordinal_position", connection);
            command.Parameters.AddWithValue("t", table);
            await using var reader = await command.ExecuteReaderAsync();
            var names = new List<string>();
            while (await reader.ReadAsync())
            {
                names.Add(reader.GetString(0));
            }

            columns[table] = [.. names];
        }

        return columns;
    }

    private static readonly Dictionary<string, string> OrderKeys = new()
    {
        ["Reservations"] = "t.\"Id\"",
        ["ReservationUnits"] = "t.\"Id\"",
        ["ReservationUnitNights"] = "t.\"ReservationUnitId\", t.\"StayDate\"",
        ["BookingPromotionApplications"] = "t.\"HoldId\"",
        ["InventoryHolds"] = "t.\"Id\"",
        ["InventoryHoldItems"] = "t.\"Id\"",
        ["InventoryHoldItemNights"] = "t.\"InventoryHoldItemId\", t.\"StayDate\""
    };

    private async Task<Capture> CaptureAsync(Dictionary<string, string[]> baselineColumns, bool includeSource)
    {
        _ = includeSource; // the projection is always the pre-migration columns, so a new column cannot change a checksum
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await ExecuteAsync(connection, "SET TIME ZONE 'UTC'");
        var hash = new Dictionary<string, TableHash>();
        foreach (var table in CheckedTables)
        {
            var projection = string.Join(", ", baselineColumns[table].Select(column => $"\"{column}\""));
            var (count, checksum) = await RowAsync(
                connection,
                $"SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY {OrderKeys[table]}), '')) FROM (SELECT {projection} FROM \"{table}\") t");
            hash[table] = new TableHash(count, checksum);
        }

        var (reservations, total) = await RowAsync(connection, """SELECT count(*), coalesce(sum("TotalAmount"), 0)::text FROM "Reservations" """);
        return new Capture(
            hash,
            reservations,
            total,
            await ScalarAsync<long>(connection, OrphanHoldsSql(sourceAware: false)),
            await ScalarAsync<long>(connection,
                """
                SELECT count(*) FROM (SELECT r."Id" FROM "Reservations" r
                JOIN "ReservationUnits" u ON u."ReservationId" = r."Id"
                JOIN "ReservationUnitNights" n ON n."ReservationUnitId" = u."Id"
                GROUP BY r."Id", r."TotalAmount" HAVING sum(n."UnitAmount") <> r."TotalAmount") x
                """),
            await ScalarAsync<long>(connection,
                """SELECT count(*) FROM (SELECT r."Id" FROM "Reservations" r JOIN "ReservationUnits" u ON u."ReservationId" = r."Id" WHERE u."SourceInventoryHoldItemId" IS NULL GROUP BY r."Id") x"""),
            await ScalarAsync<long>(connection, """SELECT count(*) FROM "Reservations" WHERE "CurrencyCode" = 'VND' AND "TotalAmount" <> trunc("TotalAmount")"""),
            await ScalarAsync<long>(connection, """SELECT count(*) FROM "Reservations" WHERE "CurrencyCode" <> 'VND'"""),
            await HasColumnAsync(connection, "Reservations", "Source") ? await ScalarAsync<long>(connection, SourceMismatchSql) : -1,
            await ScalarAsync<long>(connection,
                """
                SELECT count(*) FROM "BookingPromotionApplications" p JOIN "InventoryHolds" h ON h."Id" = p."HoldId"
                WHERE h."Status" = 'Confirmed' AND p."ReservationId" IS NULL
                """));
    }

    private static async Task<bool> HasColumnAsync(NpgsqlConnection connection, string table, string column) =>
        await ScalarAsync<long>(connection, $"SELECT count(*) FROM information_schema.columns WHERE table_name = '{table}' AND column_name = '{column}'") == 1;

    /// <summary>Every column definition, constraint, index, and the data checksums of the touched tables: equal strings mean an unchanged schema and unchanged data.</summary>
    private async Task<string> FullSnapshotAsync()
    {
        var catalog = await CatalogAsync();
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        var data = new List<string>();
        foreach (var table in new[] { "Reservations", "BookingPromotionApplications" })
        {
            var (count, checksum) = await RowAsync(connection, $"SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t::text), '')) FROM \"{table}\" t");
            data.Add($"{table}:{count}:{checksum}");
        }

        return catalog + "\n" + string.Join("\n", data);
    }

    private async Task<string> CatalogAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        var lines = new List<string>();
        var tables = "('Reservations','BookingPromotionApplications')";
        foreach (var sql in new[]
                 {
                     $"SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '') || '|' || coalesce(character_maximum_length::text, '') FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN {tables}",
                     $"SELECT 'con|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid) FROM pg_constraint WHERE contype <> 'n' AND conrelid::regclass::text IN ('\"Reservations\"','\"BookingPromotionApplications\"')",
                     $"SELECT 'idx|' || tablename || '|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN {tables}"
                 })
        {
            await using var command = new NpgsqlCommand(sql, connection);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                lines.Add(reader.GetString(0));
            }
        }

        lines.Sort(StringComparer.Ordinal);
        return string.Join("\n", lines);
    }

    // ---- plumbing ------------------------------------------------------------------------------------------------

    private sealed record TableHash(long Count, string Checksum);

    private sealed record Capture(
        Dictionary<string, TableHash> Hash,
        long Reservations,
        string TotalAmount,
        long OrphanHolds,
        long TotalMismatch,
        long UnitsWithoutSource,
        long VndFractional,
        long NonVnd,
        long SourceMismatch,
        long UnlinkedConfirmedPromotions);

    private static Guid Id(int n) => Guid.Parse($"a1000000-0000-0000-0000-{n:x12}");

    private static string AdministrativeConnectionString()
    {
        var configured = Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase");
        if (string.IsNullOrWhiteSpace(configured))
        {
            throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server.");
        }

        return new NpgsqlConnectionStringBuilder(configured) { Database = "postgres", Pooling = false }.ConnectionString;
    }

    private TheBhaDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<TheBhaDbContext>()
            .UseNpgsql(_connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
            .Options);

    private static IMigrator Migrator(TheBhaDbContext context) => context.GetInfrastructure().GetRequiredService<IMigrator>();

    private static async Task ExecuteOnAsync(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await ExecuteAsync(connection, sql);
    }

    private async Task<int> ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        return await ExecuteAsync(connection, sql);
    }

    private static async Task<int> ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteNonQueryAsync();
    }

    private async Task<T> ScalarAsync<T>(string sql)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        return await ScalarAsync<T>(connection, sql);
    }

    private static async Task<T> ScalarAsync<T>(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)(await command.ExecuteScalarAsync())!;
    }

    private static async Task<(long Count, string Value)> RowAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return (reader.GetInt64(0), reader.GetString(1));
    }
}
