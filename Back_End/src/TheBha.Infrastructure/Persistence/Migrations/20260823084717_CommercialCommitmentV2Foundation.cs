using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// Commercial Commitment V2 Foundation (PMS-BE-001.1, ADR 0005): replaces the
    /// single-RoomType BookingHold/BookingHoldNight and Reservation/ReservationNight
    /// commercial authority with the normalized InventoryHold → InventoryHoldItem →
    /// InventoryHoldItemNight and Reservation → ReservationUnit → ReservationUnitNight
    /// authority, where every persisted Item/Unit represents exactly one room.
    ///
    /// This migration performs a controlled expand → transform → contract cutover in
    /// one transaction:
    ///   1. Expand: create the five new normalized tables (InventoryHolds,
    ///      InventoryHoldItems, InventoryHoldItemNights, ReservationUnits,
    ///      ReservationUnitNights) alongside the six existing tables, unmodified.
    ///   2. Transform: deterministically backfill every legacy BookingHold/
    ///      BookingHoldNight and Reservation/ReservationNight row into its normalized
    ///      equivalent — a Hold/Reservation with legacy Rooms = Q expands into exactly
    ///      Q independent Items/Units, each carrying the legacy aggregate's
    ///      RoomTypeId/RatePlanId and the corresponding night's UnitAmount. Item/Unit
    ///      ids are generated deterministically from (source aggregate id, 1-based
    ///      room ordinal) via an MD5-derived UUID, so the same legacy row always
    ///      produces the same normalized ids regardless of statement execution order,
    ///      and a Reservation's Units are paired to their source Hold's Items using
    ///      the identical ordinal — never a separate lookup/reconciliation step.
    ///      Fail-fast validation then re-derives expected Item/Unit/night counts,
    ///      accepted-money totals, source Item→Unit mapping, and Property consistency
    ///      directly from the legacy rows and raises before any contract step runs if
    ///      anything does not match exactly.
    ///   3. Contract: repoint Reservations at InventoryHolds, drop the legacy
    ///      RoomTypeId/RatePlanId/Rooms columns and BookingHoldNights/
    ///      ReservationNights/BookingHolds tables. No dual-write and no dormant
    ///      normalized table exist after this migration commits.
    /// </summary>
    public partial class CommercialCommitmentV2Foundation : Migration
    {
        private const string CreateDeterministicUuidFunctionSql =
            """
            CREATE FUNCTION pg_temp.thebha_v2_uuid(seed text) RETURNS uuid
            LANGUAGE sql IMMUTABLE AS $$
                SELECT (
                    substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) ||
                    '-' || substr(h, 17, 4) || '-' || substr(h, 21, 12)
                )::uuid
                FROM (SELECT md5(seed) AS h) source
            $$;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---- EXPAND -----------------------------------------------------------
            migrationBuilder.Sql(CreateDeterministicUuidFunctionSql);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_Reservations_PropertyId_Id",
                table: "Reservations",
                columns: new[] { "PropertyId", "Id" });

            migrationBuilder.CreateTable(
                name: "InventoryHolds",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    FullName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CheckIn = table.Column<DateOnly>(type: "date", nullable: false),
                    CheckOut = table.Column<DateOnly>(type: "date", nullable: false),
                    Adults = table.Column<int>(type: "integer", nullable: false),
                    Children = table.Column<int>(type: "integer", nullable: false),
                    CurrencyCode = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    IdempotencyKeyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestFingerprint = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    GuestAccessTokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventoryHolds", x => x.Id);
                    table.UniqueConstraint("AK_InventoryHolds_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_InventoryHolds_Contact", "btrim(\"FullName\") <> '' AND btrim(\"Email\") <> '' AND btrim(\"Phone\") <> ''");
                    table.CheckConstraint("CK_InventoryHolds_Currency", "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
                    table.CheckConstraint("CK_InventoryHolds_FixedLifetime", "\"ExpiresAtUtc\" = \"CreatedAtUtc\" + INTERVAL '15 minutes'");
                    table.CheckConstraint("CK_InventoryHolds_Hashes", "\"IdempotencyKeyHash\" ~ '^[0-9a-f]{64}$' AND \"RequestFingerprint\" ~ '^[0-9a-f]{64}$' AND (\"GuestAccessTokenHash\" IS NULL OR \"GuestAccessTokenHash\" ~ '^[0-9a-f]{64}$')");
                    table.CheckConstraint("CK_InventoryHolds_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND (\"CustomerAccountId\" IS NULL OR \"CustomerAccountId\" <> '00000000-0000-0000-0000-000000000000'::uuid)");
                    table.CheckConstraint("CK_InventoryHolds_Occupancy", "\"Adults\" >= 1 AND \"Children\" >= 0");
                    table.CheckConstraint("CK_InventoryHolds_Ownership", "(\"CustomerAccountId\" IS NOT NULL AND \"GuestAccessTokenHash\" IS NULL) OR (\"CustomerAccountId\" IS NULL AND \"GuestAccessTokenHash\" IS NOT NULL)");
                    table.CheckConstraint("CK_InventoryHolds_Status", "\"Status\" IN ('Active', 'Confirmed', 'Cancelled')");
                    table.CheckConstraint("CK_InventoryHolds_Stay", "\"CheckIn\" < \"CheckOut\"");
                    table.CheckConstraint("CK_InventoryHolds_TotalAmount", "\"TotalAmount\" > 0");
                    table.ForeignKey(
                        name: "FK_InventoryHolds_AspNetUsers_CustomerAccountId",
                        column: x => x.CustomerAccountId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InventoryHolds_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InventoryHoldItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InventoryHoldId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventoryHoldItems", x => x.Id);
                    table.UniqueConstraint("AK_InventoryHoldItems_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_InventoryHoldItems_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"InventoryHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.ForeignKey(
                        name: "FK_InventoryHoldItems_InventoryHolds_PropertyId_InventoryHoldId",
                        columns: x => new { x.PropertyId, x.InventoryHoldId },
                        principalTable: "InventoryHolds",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InventoryHoldItems_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InventoryHoldItemNights",
                columns: table => new
                {
                    InventoryHoldItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    StayDate = table.Column<DateOnly>(type: "date", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RatePlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventoryHoldItemNights", x => new { x.InventoryHoldItemId, x.StayDate });
                    table.CheckConstraint("CK_InventoryHoldItemNights_Amount", "\"UnitAmount\" > 0");
                    table.CheckConstraint("CK_InventoryHoldItemNights_Ids", "\"InventoryHoldItemId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.ForeignKey(
                        name: "FK_InventoryHoldItemNights_InventoryHoldItems_PropertyId_Inven~",
                        columns: x => new { x.PropertyId, x.InventoryHoldItemId },
                        principalTable: "InventoryHoldItems",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InventoryHoldItemNights_RatePlans_PropertyId_RatePlanId",
                        columns: x => new { x.PropertyId, x.RatePlanId },
                        principalTable: "RatePlans",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReservationUnits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceInventoryHoldItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    CommitmentStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationUnits", x => x.Id);
                    table.UniqueConstraint("AK_ReservationUnits_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_ReservationUnits_CommitmentStatus", "\"CommitmentStatus\" IN ('Committed', 'Cancelled')");
                    table.CheckConstraint("CK_ReservationUnits_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND (\"SourceInventoryHoldItemId\" IS NULL OR \"SourceInventoryHoldItemId\" <> '00000000-0000-0000-0000-000000000000'::uuid)");
                    table.ForeignKey(
                        name: "FK_ReservationUnits_InventoryHoldItems_PropertyId_SourceInvent~",
                        columns: x => new { x.PropertyId, x.SourceInventoryHoldItemId },
                        principalTable: "InventoryHoldItems",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReservationUnits_Reservations_PropertyId_ReservationId",
                        columns: x => new { x.PropertyId, x.ReservationId },
                        principalTable: "Reservations",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ReservationUnits_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReservationUnitNights",
                columns: table => new
                {
                    ReservationUnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    StayDate = table.Column<DateOnly>(type: "date", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RatePlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationUnitNights", x => new { x.ReservationUnitId, x.StayDate });
                    table.CheckConstraint("CK_ReservationUnitNights_Amount", "\"UnitAmount\" > 0");
                    table.CheckConstraint("CK_ReservationUnitNights_Ids", "\"ReservationUnitId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.ForeignKey(
                        name: "FK_ReservationUnitNights_RatePlans_PropertyId_RatePlanId",
                        columns: x => new { x.PropertyId, x.RatePlanId },
                        principalTable: "RatePlans",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReservationUnitNights_ReservationUnits_PropertyId_Reservati~",
                        columns: x => new { x.PropertyId, x.ReservationUnitId },
                        principalTable: "ReservationUnits",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHoldItemNights_PropertyId_InventoryHoldItemId",
                table: "InventoryHoldItemNights",
                columns: new[] { "PropertyId", "InventoryHoldItemId" });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHoldItemNights_PropertyId_RatePlanId",
                table: "InventoryHoldItemNights",
                columns: new[] { "PropertyId", "RatePlanId" });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHoldItemNights_StayDate_InventoryHoldItemId",
                table: "InventoryHoldItemNights",
                columns: new[] { "StayDate", "InventoryHoldItemId" });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHoldItems_InventoryHoldId",
                table: "InventoryHoldItems",
                column: "InventoryHoldId");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHoldItems_PropertyId_InventoryHoldId",
                table: "InventoryHoldItems",
                columns: new[] { "PropertyId", "InventoryHoldId" });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHoldItems_PropertyId_RoomTypeId",
                table: "InventoryHoldItems",
                columns: new[] { "PropertyId", "RoomTypeId" });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHolds_CustomerAccountId",
                table: "InventoryHolds",
                column: "CustomerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHolds_IdempotencyKeyHash",
                table: "InventoryHolds",
                column: "IdempotencyKeyHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InventoryHolds_Status_ExpiresAtUtc",
                table: "InventoryHolds",
                columns: new[] { "Status", "ExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnitNights_PropertyId_RatePlanId",
                table: "ReservationUnitNights",
                columns: new[] { "PropertyId", "RatePlanId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnitNights_PropertyId_ReservationUnitId",
                table: "ReservationUnitNights",
                columns: new[] { "PropertyId", "ReservationUnitId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnitNights_StayDate_ReservationUnitId",
                table: "ReservationUnitNights",
                columns: new[] { "StayDate", "ReservationUnitId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnits_PropertyId_ReservationId",
                table: "ReservationUnits",
                columns: new[] { "PropertyId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnits_PropertyId_RoomTypeId_CommitmentStatus",
                table: "ReservationUnits",
                columns: new[] { "PropertyId", "RoomTypeId", "CommitmentStatus" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnits_PropertyId_SourceInventoryHoldItemId",
                table: "ReservationUnits",
                columns: new[] { "PropertyId", "SourceInventoryHoldItemId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnits_ReservationId",
                table: "ReservationUnits",
                column: "ReservationId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationUnits_SourceInventoryHoldItemId",
                table: "ReservationUnits",
                column: "SourceInventoryHoldItemId",
                unique: true);

            // ---- TRANSFORM ----------------------------------------------------------
            // Header rows carry over unchanged (identity, ownership, lifecycle,
            // timestamps, idempotency, money total); only RoomTypeId/RatePlanId/Rooms
            // move down to the Item/Unit level.
            migrationBuilder.Sql(
                """
                INSERT INTO "InventoryHolds"
                    ("Id", "PropertyId", "CustomerAccountId", "FullName", "Email", "Phone",
                     "CheckIn", "CheckOut", "Adults", "Children", "CurrencyCode", "TotalAmount",
                     "Status", "CreatedAtUtc", "ExpiresAtUtc", "IdempotencyKeyHash",
                     "RequestFingerprint", "GuestAccessTokenHash")
                SELECT
                    "Id", "PropertyId", "CustomerAccountId", "FullName", "Email", "Phone",
                    "CheckIn", "CheckOut", "Adults", "Children", "CurrencyCode", "TotalAmount",
                    "Status", "CreatedAtUtc", "ExpiresAtUtc", "IdempotencyKeyHash",
                    "RequestFingerprint", "GuestAccessTokenHash"
                FROM "BookingHolds";
                """);

            // Each legacy Hold with Rooms = Q expands into exactly Q independent Items,
            // each with a deterministic, collision-protected id derived from
            // (HoldId, 1-based ordinal) — never a persisted Quantity/Rooms field.
            migrationBuilder.Sql(
                """
                INSERT INTO "InventoryHoldItems" ("Id", "InventoryHoldId", "PropertyId", "RoomTypeId")
                SELECT
                    pg_temp.thebha_v2_uuid('thebha-v2-item:' || bh."Id"::text || ':' || ord::text),
                    bh."Id", bh."PropertyId", bh."RoomTypeId"
                FROM "BookingHolds" bh
                CROSS JOIN LATERAL generate_series(1, bh."Rooms") AS ord;
                """);

            // Every ItemNight under a Hold's Q items copies that night's legacy
            // UnitAmount and the Hold's single selected RatePlanId.
            migrationBuilder.Sql(
                """
                INSERT INTO "InventoryHoldItemNights"
                    ("InventoryHoldItemId", "PropertyId", "StayDate", "RatePlanId", "UnitAmount")
                SELECT ihi."Id", bh."PropertyId", bhn."StayDate", bh."RatePlanId", bhn."UnitAmount"
                FROM "BookingHoldNights" bhn
                JOIN "BookingHolds" bh ON bh."Id" = bhn."BookingHoldId"
                JOIN "InventoryHoldItems" ihi ON ihi."InventoryHoldId" = bh."Id";
                """);

            // Each legacy Reservation with Rooms = Q expands into exactly Q Units,
            // ordinal-paired to its source Hold's Items (same ordinal, same
            // deterministic-id formula) — the existing 1:1 Hold->Reservation
            // discipline extends unchanged to the Item->Unit level. A legacy
            // Confirmed Reservation yields Committed Units; a legacy Cancelled
            // Reservation yields Cancelled Units (both remain immutable evidence).
            migrationBuilder.Sql(
                """
                INSERT INTO "ReservationUnits"
                    ("Id", "ReservationId", "PropertyId", "RoomTypeId", "SourceInventoryHoldItemId",
                     "CommitmentStatus")
                SELECT
                    pg_temp.thebha_v2_uuid('thebha-v2-unit:' || r."Id"::text || ':' || ord::text),
                    r."Id", r."PropertyId", r."RoomTypeId",
                    pg_temp.thebha_v2_uuid('thebha-v2-item:' || r."SourceHoldId"::text || ':' || ord::text),
                    CASE WHEN r."Status" = 'Confirmed' THEN 'Committed' ELSE 'Cancelled' END
                FROM "Reservations" r
                CROSS JOIN LATERAL generate_series(1, r."Rooms") AS ord;
                """);

            migrationBuilder.Sql(
                """
                INSERT INTO "ReservationUnitNights"
                    ("ReservationUnitId", "PropertyId", "StayDate", "RatePlanId", "UnitAmount")
                SELECT ru."Id", r."PropertyId", rn."StayDate", r."RatePlanId", rn."UnitAmount"
                FROM "ReservationNights" rn
                JOIN "Reservations" r ON r."Id" = rn."ReservationId"
                JOIN "ReservationUnits" ru ON ru."ReservationId" = r."Id";
                """);

            // Fail-fast validation: every count, mapping, and total below is re-derived
            // directly from the still-intact legacy rows, independently of the INSERT
            // statements above, and the whole migration transaction rolls back if any
            // check fails — no contract step below ever runs against unverified data.
            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    expected_items bigint;
                    actual_items bigint;
                    expected_item_nights bigint;
                    actual_item_nights bigint;
                    expected_units bigint;
                    actual_units bigint;
                    expected_unit_nights bigint;
                    actual_unit_nights bigint;
                    duplicate_item_ids bigint;
                    duplicate_unit_ids bigint;
                    orphan_units bigint;
                    duplicate_source_items bigint;
                    legacy_hold_total numeric(18,2);
                    normalized_hold_total numeric(18,2);
                    legacy_reservation_total numeric(18,2);
                    normalized_reservation_total numeric(18,2);
                    mismatch_count bigint;
                BEGIN
                    SELECT COALESCE(SUM("Rooms"), 0) INTO expected_items FROM "BookingHolds";
                    SELECT COUNT(*) INTO actual_items FROM "InventoryHoldItems";
                    IF expected_items <> actual_items THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: InventoryHoldItems count % does not match expected % (sum of legacy BookingHolds.Rooms)',
                            actual_items, expected_items;
                    END IF;

                    SELECT COUNT(*) INTO duplicate_item_ids
                    FROM (SELECT "Id" FROM "InventoryHoldItems" GROUP BY "Id" HAVING COUNT(*) > 1) d;
                    IF duplicate_item_ids > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % duplicate InventoryHoldItem ids were generated',
                            duplicate_item_ids;
                    END IF;

                    SELECT COALESCE(SUM(bh."Rooms"), 0) INTO expected_item_nights
                    FROM "BookingHoldNights" bhn JOIN "BookingHolds" bh ON bh."Id" = bhn."BookingHoldId";
                    SELECT COUNT(*) INTO actual_item_nights FROM "InventoryHoldItemNights";
                    IF expected_item_nights <> actual_item_nights THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: InventoryHoldItemNights count % does not match expected % — a missing or duplicate legacy night would surface here',
                            actual_item_nights, expected_item_nights;
                    END IF;

                    SELECT COALESCE(SUM("Rooms"), 0) INTO expected_units FROM "Reservations";
                    SELECT COUNT(*) INTO actual_units FROM "ReservationUnits";
                    IF expected_units <> actual_units THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: ReservationUnits count % does not match expected % (sum of legacy Reservations.Rooms)',
                            actual_units, expected_units;
                    END IF;

                    SELECT COUNT(*) INTO duplicate_unit_ids
                    FROM (SELECT "Id" FROM "ReservationUnits" GROUP BY "Id" HAVING COUNT(*) > 1) d;
                    IF duplicate_unit_ids > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % duplicate ReservationUnit ids were generated',
                            duplicate_unit_ids;
                    END IF;

                    SELECT COALESCE(SUM(r."Rooms"), 0) INTO expected_unit_nights
                    FROM "ReservationNights" rn JOIN "Reservations" r ON r."Id" = rn."ReservationId";
                    SELECT COUNT(*) INTO actual_unit_nights FROM "ReservationUnitNights";
                    IF expected_unit_nights <> actual_unit_nights THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: ReservationUnitNights count % does not match expected %',
                            actual_unit_nights, expected_unit_nights;
                    END IF;

                    SELECT COUNT(*) INTO orphan_units
                    FROM "ReservationUnits" ru
                    LEFT JOIN "InventoryHoldItems" ihi ON ihi."Id" = ru."SourceInventoryHoldItemId"
                    WHERE ihi."Id" IS NULL;
                    IF orphan_units > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % ReservationUnits reference a missing source InventoryHoldItem',
                            orphan_units;
                    END IF;

                    SELECT COUNT(*) INTO duplicate_source_items FROM (
                        SELECT "SourceInventoryHoldItemId" FROM "ReservationUnits"
                        GROUP BY "SourceInventoryHoldItemId" HAVING COUNT(*) > 1
                    ) d;
                    IF duplicate_source_items > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % source InventoryHoldItems are claimed by more than one ReservationUnit (uniqueness rule 9 violated)',
                            duplicate_source_items;
                    END IF;

                    SELECT COALESCE(SUM("TotalAmount"), 0) INTO legacy_hold_total FROM "BookingHolds";
                    SELECT COALESCE(SUM("UnitAmount"), 0) INTO normalized_hold_total FROM "InventoryHoldItemNights";
                    IF legacy_hold_total <> normalized_hold_total THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: normalized Hold accepted-money total % does not match legacy total %',
                            normalized_hold_total, legacy_hold_total;
                    END IF;

                    SELECT COALESCE(SUM("TotalAmount"), 0) INTO legacy_reservation_total FROM "Reservations";
                    SELECT COALESCE(SUM("UnitAmount"), 0) INTO normalized_reservation_total FROM "ReservationUnitNights";
                    IF legacy_reservation_total <> normalized_reservation_total THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: normalized Reservation accepted-money total % does not match legacy total %',
                            normalized_reservation_total, legacy_reservation_total;
                    END IF;

                    SELECT COUNT(*) INTO mismatch_count
                    FROM "InventoryHoldItemNights" ihn
                    JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
                    WHERE ihn."PropertyId" <> ihi."PropertyId";
                    IF mismatch_count > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % InventoryHoldItemNights have a PropertyId inconsistent with their Item',
                            mismatch_count;
                    END IF;

                    SELECT COUNT(*) INTO mismatch_count
                    FROM "ReservationUnitNights" run
                    JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
                    WHERE run."PropertyId" <> ru."PropertyId";
                    IF mismatch_count > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % ReservationUnitNights have a PropertyId inconsistent with their Unit',
                            mismatch_count;
                    END IF;

                    SELECT COUNT(*) INTO mismatch_count
                    FROM "InventoryHoldItems" ihi
                    JOIN "InventoryHolds" ih ON ih."Id" = ihi."InventoryHoldId"
                    WHERE ihi."PropertyId" <> ih."PropertyId";
                    IF mismatch_count > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % InventoryHoldItems have a PropertyId inconsistent with their Hold',
                            mismatch_count;
                    END IF;

                    SELECT COUNT(*) INTO mismatch_count
                    FROM "ReservationUnits" ru
                    JOIN "Reservations" r ON r."Id" = ru."ReservationId"
                    WHERE ru."PropertyId" <> r."PropertyId";
                    IF mismatch_count > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation: % ReservationUnits have a PropertyId inconsistent with their Reservation',
                            mismatch_count;
                    END IF;
                END $$;
                """);

            // ---- CONTRACT -----------------------------------------------------------
            migrationBuilder.DropForeignKey(
                name: "FK_Reservations_BookingHolds_SourceHoldId",
                table: "Reservations");

            migrationBuilder.DropForeignKey(
                name: "FK_Reservations_RatePlans_PropertyId_RatePlanId",
                table: "Reservations");

            migrationBuilder.DropForeignKey(
                name: "FK_Reservations_RoomTypes_PropertyId_RoomTypeId",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_PropertyId_RatePlanId",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_PropertyId_RoomTypeId_Status",
                table: "Reservations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservations_Ids",
                table: "Reservations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservations_Occupancy",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "RatePlanId",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "RoomTypeId",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "Rooms",
                table: "Reservations");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservations_Ids",
                table: "Reservations",
                sql: "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"SourceHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND (\"CustomerAccountId\" IS NULL OR \"CustomerAccountId\" <> '00000000-0000-0000-0000-000000000000'::uuid)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservations_Occupancy",
                table: "Reservations",
                sql: "\"Adults\" >= 1 AND \"Children\" >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_PropertyId_SourceHoldId",
                table: "Reservations",
                columns: new[] { "PropertyId", "SourceHoldId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Reservations_InventoryHolds_PropertyId_SourceHoldId",
                table: "Reservations",
                columns: new[] { "PropertyId", "SourceHoldId" },
                principalTable: "InventoryHolds",
                principalColumns: new[] { "PropertyId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.DropTable(
                name: "BookingHoldNights");

            migrationBuilder.DropTable(
                name: "ReservationNights");

            migrationBuilder.DropTable(
                name: "BookingHolds");
        }

        /// <inheritdoc />
        /// <summary>
        /// Guarded reverse transform: only succeeds while every InventoryHold's Items
        /// share one RoomType, every Reservation's Units share one RoomType, and every
        /// Item/Unit under one Hold/Reservation shares one RatePlanId per stay date —
        /// exactly the shape the legacy single-RoomType schema can represent. This
        /// work item's only creation path (Hold confirmation, one RoomType/RatePlan
        /// per public request) always produces data in that shape, but the guard
        /// fails loudly instead of silently truncating, averaging, or picking an
        /// arbitrary RoomType/RatePlan if that assumption is ever violated.
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    non_uniform_holds bigint;
                    non_uniform_hold_rateplans bigint;
                    non_uniform_reservations bigint;
                    non_uniform_reservation_rateplans bigint;
                BEGIN
                    SELECT COUNT(*) INTO non_uniform_holds FROM (
                        SELECT "InventoryHoldId" FROM "InventoryHoldItems"
                        GROUP BY "InventoryHoldId" HAVING COUNT(DISTINCT "RoomTypeId") > 1
                    ) d;
                    IF non_uniform_holds > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation downgrade: % InventoryHolds span more than one RoomType and cannot be represented by the legacy single-RoomType schema',
                            non_uniform_holds;
                    END IF;

                    SELECT COUNT(*) INTO non_uniform_hold_rateplans FROM (
                        SELECT ihi."InventoryHoldId", ihn."StayDate"
                        FROM "InventoryHoldItemNights" ihn
                        JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
                        GROUP BY ihi."InventoryHoldId", ihn."StayDate"
                        HAVING COUNT(DISTINCT ihn."RatePlanId") > 1
                    ) d;
                    IF non_uniform_hold_rateplans > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation downgrade: % InventoryHold nights span more than one RatePlan on the same stay date and cannot be represented by the legacy schema',
                            non_uniform_hold_rateplans;
                    END IF;

                    SELECT COUNT(*) INTO non_uniform_reservations FROM (
                        SELECT "ReservationId" FROM "ReservationUnits"
                        GROUP BY "ReservationId" HAVING COUNT(DISTINCT "RoomTypeId") > 1
                    ) d;
                    IF non_uniform_reservations > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation downgrade: % Reservations span more than one RoomType and cannot be represented by the legacy single-RoomType schema',
                            non_uniform_reservations;
                    END IF;

                    SELECT COUNT(*) INTO non_uniform_reservation_rateplans FROM (
                        SELECT ru."ReservationId", run."StayDate"
                        FROM "ReservationUnitNights" run
                        JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
                        GROUP BY ru."ReservationId", run."StayDate"
                        HAVING COUNT(DISTINCT run."RatePlanId") > 1
                    ) d;
                    IF non_uniform_reservation_rateplans > 0 THEN
                        RAISE EXCEPTION
                            'CommercialCommitmentV2Foundation downgrade: % Reservation nights span more than one RatePlan on the same stay date and cannot be represented by the legacy schema',
                            non_uniform_reservation_rateplans;
                    END IF;
                END $$;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Reservations_InventoryHolds_PropertyId_SourceHoldId",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_PropertyId_SourceHoldId",
                table: "Reservations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservations_Ids",
                table: "Reservations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservations_Occupancy",
                table: "Reservations");

            migrationBuilder.AddColumn<Guid>(
                name: "RatePlanId",
                table: "Reservations",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "RoomTypeId",
                table: "Reservations",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<int>(
                name: "Rooms",
                table: "Reservations",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "BookingHolds",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Adults = table.Column<int>(type: "integer", nullable: false),
                    CheckIn = table.Column<DateOnly>(type: "date", nullable: false),
                    CheckOut = table.Column<DateOnly>(type: "date", nullable: false),
                    Children = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CurrencyCode = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    CustomerAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FullName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    GuestAccessTokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    IdempotencyKeyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RatePlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestFingerprint = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Rooms = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingHolds", x => x.Id);
                    table.CheckConstraint("CK_BookingHolds_Contact", "btrim(\"FullName\") <> '' AND btrim(\"Email\") <> '' AND btrim(\"Phone\") <> ''");
                    table.CheckConstraint("CK_BookingHolds_Currency", "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
                    table.CheckConstraint("CK_BookingHolds_FixedLifetime", "\"ExpiresAtUtc\" = \"CreatedAtUtc\" + INTERVAL '15 minutes'");
                    table.CheckConstraint("CK_BookingHolds_Hashes", "\"IdempotencyKeyHash\" ~ '^[0-9a-f]{64}$' AND \"RequestFingerprint\" ~ '^[0-9a-f]{64}$' AND (\"GuestAccessTokenHash\" IS NULL OR \"GuestAccessTokenHash\" ~ '^[0-9a-f]{64}$')");
                    table.CheckConstraint("CK_BookingHolds_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND (\"CustomerAccountId\" IS NULL OR \"CustomerAccountId\" <> '00000000-0000-0000-0000-000000000000'::uuid)");
                    table.CheckConstraint("CK_BookingHolds_Occupancy", "\"Adults\" >= 1 AND \"Children\" >= 0 AND \"Rooms\" >= 1");
                    table.CheckConstraint("CK_BookingHolds_Ownership", "(\"CustomerAccountId\" IS NOT NULL AND \"GuestAccessTokenHash\" IS NULL) OR (\"CustomerAccountId\" IS NULL AND \"GuestAccessTokenHash\" IS NOT NULL)");
                    table.CheckConstraint("CK_BookingHolds_Status", "\"Status\" IN ('Active', 'Confirmed', 'Cancelled')");
                    table.CheckConstraint("CK_BookingHolds_Stay", "\"CheckIn\" < \"CheckOut\"");
                    table.CheckConstraint("CK_BookingHolds_TotalAmount", "\"TotalAmount\" > 0");
                    table.ForeignKey(
                        name: "FK_BookingHolds_AspNetUsers_CustomerAccountId",
                        column: x => x.CustomerAccountId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingHolds_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingHolds_RatePlans_PropertyId_RatePlanId",
                        columns: x => new { x.PropertyId, x.RatePlanId },
                        principalTable: "RatePlans",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingHolds_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BookingHoldNights",
                columns: table => new
                {
                    BookingHoldId = table.Column<Guid>(type: "uuid", nullable: false),
                    StayDate = table.Column<DateOnly>(type: "date", nullable: false),
                    NightTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Rooms = table.Column<int>(type: "integer", nullable: false),
                    UnitAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingHoldNights", x => new { x.BookingHoldId, x.StayDate });
                    table.CheckConstraint("CK_BookingHoldNights_Amounts", "\"UnitAmount\" > 0 AND \"NightTotal\" > 0 AND \"NightTotal\" = \"UnitAmount\" * \"Rooms\"");
                    table.CheckConstraint("CK_BookingHoldNights_BookingHoldId", "\"BookingHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_BookingHoldNights_Rooms", "\"Rooms\" >= 1");
                    table.ForeignKey(
                        name: "FK_BookingHoldNights_BookingHolds_BookingHoldId",
                        column: x => x.BookingHoldId,
                        principalTable: "BookingHolds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ReservationNights",
                columns: table => new
                {
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    StayDate = table.Column<DateOnly>(type: "date", nullable: false),
                    NightTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Rooms = table.Column<int>(type: "integer", nullable: false),
                    UnitAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationNights", x => new { x.ReservationId, x.StayDate });
                    table.CheckConstraint("CK_ReservationNights_Amounts", "\"UnitAmount\" > 0 AND \"NightTotal\" > 0 AND \"NightTotal\" = \"UnitAmount\" * \"Rooms\"");
                    table.CheckConstraint("CK_ReservationNights_ReservationId", "\"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_ReservationNights_Rooms", "\"Rooms\" >= 1");
                    table.ForeignKey(
                        name: "FK_ReservationNights_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Backfill legacy header + aggregate RoomTypeId/RatePlanId/Rooms from the
            // still-uniform normalized rows (validated above), then legacy nightly
            // Rooms/NightTotal from the count and money already proven consistent.
            migrationBuilder.Sql(
                """
                INSERT INTO "BookingHolds"
                    ("Id", "PropertyId", "RoomTypeId", "RatePlanId", "CustomerAccountId", "FullName",
                     "Email", "Phone", "CheckIn", "CheckOut", "Adults", "Children", "Rooms",
                     "CurrencyCode", "TotalAmount", "Status", "CreatedAtUtc", "ExpiresAtUtc",
                     "IdempotencyKeyHash", "RequestFingerprint", "GuestAccessTokenHash")
                SELECT
                    ih."Id", ih."PropertyId",
                    (SELECT ihi."RoomTypeId" FROM "InventoryHoldItems" ihi
                        WHERE ihi."InventoryHoldId" = ih."Id" LIMIT 1),
                    (SELECT ihn."RatePlanId" FROM "InventoryHoldItemNights" ihn
                        JOIN "InventoryHoldItems" ihi2 ON ihi2."Id" = ihn."InventoryHoldItemId"
                        WHERE ihi2."InventoryHoldId" = ih."Id" LIMIT 1),
                    ih."CustomerAccountId", ih."FullName", ih."Email", ih."Phone", ih."CheckIn",
                    ih."CheckOut", ih."Adults", ih."Children",
                    (SELECT COUNT(*) FROM "InventoryHoldItems" ihi3 WHERE ihi3."InventoryHoldId" = ih."Id"),
                    ih."CurrencyCode", ih."TotalAmount", ih."Status", ih."CreatedAtUtc", ih."ExpiresAtUtc",
                    ih."IdempotencyKeyHash", ih."RequestFingerprint", ih."GuestAccessTokenHash"
                FROM "InventoryHolds" ih;
                """);

            migrationBuilder.Sql(
                """
                INSERT INTO "BookingHoldNights" ("BookingHoldId", "StayDate", "Rooms", "UnitAmount", "NightTotal")
                SELECT
                    ihi."InventoryHoldId", ihn."StayDate", COUNT(*), ihn."UnitAmount",
                    ihn."UnitAmount" * COUNT(*)
                FROM "InventoryHoldItemNights" ihn
                JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
                GROUP BY ihi."InventoryHoldId", ihn."StayDate", ihn."UnitAmount";
                """);

            migrationBuilder.Sql(
                """
                UPDATE "Reservations" r
                SET
                    "RoomTypeId" = (SELECT ru."RoomTypeId" FROM "ReservationUnits" ru
                        WHERE ru."ReservationId" = r."Id" LIMIT 1),
                    "RatePlanId" = (SELECT run."RatePlanId" FROM "ReservationUnitNights" run
                        JOIN "ReservationUnits" ru2 ON ru2."Id" = run."ReservationUnitId"
                        WHERE ru2."ReservationId" = r."Id" LIMIT 1),
                    "Rooms" = (SELECT COUNT(*) FROM "ReservationUnits" ru3 WHERE ru3."ReservationId" = r."Id");
                """);

            migrationBuilder.Sql(
                """
                INSERT INTO "ReservationNights" ("ReservationId", "StayDate", "Rooms", "UnitAmount", "NightTotal")
                SELECT
                    ru."ReservationId", run."StayDate", COUNT(*), run."UnitAmount",
                    run."UnitAmount" * COUNT(*)
                FROM "ReservationUnitNights" run
                JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
                GROUP BY ru."ReservationId", run."StayDate", run."UnitAmount";
                """);

            migrationBuilder.DropTable(
                name: "InventoryHoldItemNights");

            migrationBuilder.DropTable(
                name: "ReservationUnitNights");

            migrationBuilder.DropTable(
                name: "ReservationUnits");

            migrationBuilder.DropTable(
                name: "InventoryHoldItems");

            migrationBuilder.DropTable(
                name: "InventoryHolds");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Reservations_PropertyId_Id",
                table: "Reservations");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_PropertyId_RatePlanId",
                table: "Reservations",
                columns: new[] { "PropertyId", "RatePlanId" });

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_PropertyId_RoomTypeId_Status",
                table: "Reservations",
                columns: new[] { "PropertyId", "RoomTypeId", "Status" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservations_Ids",
                table: "Reservations",
                sql: "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"SourceHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND (\"CustomerAccountId\" IS NULL OR \"CustomerAccountId\" <> '00000000-0000-0000-0000-000000000000'::uuid)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservations_Occupancy",
                table: "Reservations",
                sql: "\"Adults\" >= 1 AND \"Children\" >= 0 AND \"Rooms\" >= 1");

            migrationBuilder.CreateIndex(
                name: "IX_BookingHoldNights_StayDate_BookingHoldId",
                table: "BookingHoldNights",
                columns: new[] { "StayDate", "BookingHoldId" });

            migrationBuilder.CreateIndex(
                name: "IX_BookingHolds_CustomerAccountId",
                table: "BookingHolds",
                column: "CustomerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingHolds_IdempotencyKeyHash",
                table: "BookingHolds",
                column: "IdempotencyKeyHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingHolds_PropertyId_RatePlanId",
                table: "BookingHolds",
                columns: new[] { "PropertyId", "RatePlanId" });

            migrationBuilder.CreateIndex(
                name: "IX_BookingHolds_PropertyId_RoomTypeId_Status_ExpiresAtUtc",
                table: "BookingHolds",
                columns: new[] { "PropertyId", "RoomTypeId", "Status", "ExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationNights_StayDate_ReservationId",
                table: "ReservationNights",
                columns: new[] { "StayDate", "ReservationId" });

            migrationBuilder.AddForeignKey(
                name: "FK_Reservations_BookingHolds_SourceHoldId",
                table: "Reservations",
                column: "SourceHoldId",
                principalTable: "BookingHolds",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Reservations_RatePlans_PropertyId_RatePlanId",
                table: "Reservations",
                columns: new[] { "PropertyId", "RatePlanId" },
                principalTable: "RatePlans",
                principalColumns: new[] { "PropertyId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Reservations_RoomTypes_PropertyId_RoomTypeId",
                table: "Reservations",
                columns: new[] { "PropertyId", "RoomTypeId" },
                principalTable: "RoomTypes",
                principalColumns: new[] { "PropertyId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }
    }
}
