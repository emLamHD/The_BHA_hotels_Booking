using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingPromotions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Existing nights carry no promotion: their list rate is what they were charged. Backfill before NOT NULL and the check.
            migrationBuilder.AddColumn<decimal>(
                name: "ListUnitAmount",
                table: "ReservationUnitNights",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.Sql("UPDATE \"ReservationUnitNights\" SET \"ListUnitAmount\" = \"UnitAmount\";");
            // The backfill fires the night tables' deferred constraint triggers; PostgreSQL refuses ALTER TABLE while they are pending.
            migrationBuilder.Sql("SET CONSTRAINTS ALL IMMEDIATE;");

            migrationBuilder.AlterColumn<decimal>(
                name: "ListUnitAmount",
                table: "ReservationUnitNights",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(18,2)",
                oldPrecision: 18,
                oldScale: 2,
                oldNullable: true);

            // Existing nights carry no promotion: their list rate is what they were charged. Backfill before NOT NULL and the check.
            migrationBuilder.AddColumn<decimal>(
                name: "ListUnitAmount",
                table: "InventoryHoldItemNights",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.Sql("UPDATE \"InventoryHoldItemNights\" SET \"ListUnitAmount\" = \"UnitAmount\";");
            // The backfill fires the night tables' deferred constraint triggers; PostgreSQL refuses ALTER TABLE while they are pending.
            migrationBuilder.Sql("SET CONSTRAINTS ALL IMMEDIATE;");

            migrationBuilder.AlterColumn<decimal>(
                name: "ListUnitAmount",
                table: "InventoryHoldItemNights",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(18,2)",
                oldPrecision: 18,
                oldScale: 2,
                oldNullable: true);

            migrationBuilder.CreateTable(
                name: "PromotionMedia",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ByteSize = table.Column<long>(type: "bigint", nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PromotionMedia", x => x.Id);
                    table.CheckConstraint("CK_PromotionMedia_Key", "\"StorageKey\" ~ '^promo/[0-9a-f]{32}\\.(jpg|png|webp)$'");
                    table.CheckConstraint("CK_PromotionMedia_Size", "\"ByteSize\" > 0 AND \"Width\" > 0 AND \"Height\" > 0");
                    table.ForeignKey(
                        name: "FK_PromotionMedia_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Promotions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Value = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyCode = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: true),
                    AllRoomTypes = table.Column<bool>(type: "boolean", nullable: false),
                    BookingFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    BookingTo = table.Column<DateOnly>(type: "date", nullable: true),
                    StayFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    StayTo = table.Column<DateOnly>(type: "date", nullable: true),
                    MinNights = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Summary = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    BodyParagraphs = table.Column<string[]>(type: "text[]", nullable: false),
                    CoverMediaId = table.Column<Guid>(type: "uuid", nullable: true),
                    CoverAltText = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    ShowOnHomepage = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    DisplayFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    DisplayTo = table.Column<DateOnly>(type: "date", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreateOperationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreateFingerprint = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Promotions", x => x.Id);
                    table.UniqueConstraint("AK_Promotions_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_Promotions_BookingWindow", "\"BookingFrom\" IS NULL OR \"BookingTo\" IS NULL OR \"BookingTo\" >= \"BookingFrom\"");
                    table.CheckConstraint("CK_Promotions_DisplayWindow", "\"DisplayFrom\" IS NULL OR \"DisplayTo\" IS NULL OR \"DisplayTo\" >= \"DisplayFrom\"");
                    table.CheckConstraint("CK_Promotions_Fingerprint", "\"CreateFingerprint\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_Promotions_FixedCurrency", "\"Kind\" <> 'FixedAmount' OR \"CurrencyCode\" ~ '^[A-Z]{3}$'");
                    table.CheckConstraint("CK_Promotions_Homepage", "NOT \"ShowOnHomepage\" OR \"CoverMediaId\" IS NOT NULL");
                    table.CheckConstraint("CK_Promotions_MinNights", "\"MinNights\" BETWEEN 1 AND 30");
                    table.CheckConstraint("CK_Promotions_Percent", "\"Kind\" <> 'Percent' OR (\"Value\" < 100 AND \"CurrencyCode\" IS NULL)");
                    table.CheckConstraint("CK_Promotions_SortOrder", "\"SortOrder\" BETWEEN 0 AND 9999");
                    table.CheckConstraint("CK_Promotions_StayWindow", "\"StayFrom\" IS NULL OR \"StayTo\" IS NULL OR \"StayTo\" >= \"StayFrom\"");
                    table.CheckConstraint("CK_Promotions_Value", "\"Value\" > 0");
                    table.CheckConstraint("CK_Promotions_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_Promotions_PromotionMedia_CoverMediaId",
                        column: x => x.CoverMediaId,
                        principalTable: "PromotionMedia",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Promotions_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BookingPromotionApplications",
                columns: table => new
                {
                    HoldId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: true),
                    PromotionId = table.Column<Guid>(type: "uuid", nullable: false),
                    PromotionVersion = table.Column<int>(type: "integer", nullable: false),
                    Slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Value = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyCode = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: true),
                    ListTotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DiscountTotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingPromotionApplications", x => x.HoldId);
                    table.CheckConstraint("CK_BookingPromotionApplications_Amounts", "\"DiscountTotalAmount\" > 0 AND \"ListTotalAmount\" > \"DiscountTotalAmount\"");
                    table.CheckConstraint("CK_BookingPromotionApplications_Value", "\"Value\" > 0 AND \"PromotionVersion\" >= 1");
                    table.ForeignKey(
                        name: "FK_BookingPromotionApplications_InventoryHolds_HoldId",
                        column: x => x.HoldId,
                        principalTable: "InventoryHolds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BookingPromotionApplications_Promotions_PromotionId",
                        column: x => x.PromotionId,
                        principalTable: "Promotions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingPromotionApplications_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PromotionAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PromotionId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    AtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Before = table.Column<string>(type: "jsonb", nullable: true),
                    After = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PromotionAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PromotionAudits_Promotions_PropertyId_PromotionId",
                        columns: x => new { x.PropertyId, x.PromotionId },
                        principalTable: "Promotions",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PromotionRoomTypes",
                columns: table => new
                {
                    PromotionId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PromotionRoomTypes", x => new { x.PromotionId, x.RoomTypeId });
                    table.ForeignKey(
                        name: "FK_PromotionRoomTypes_Promotions_PropertyId_PromotionId",
                        columns: x => new { x.PropertyId, x.PromotionId },
                        principalTable: "Promotions",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PromotionRoomTypes_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_ReservationUnitNights_ListAmount",
                table: "ReservationUnitNights",
                sql: "\"ListUnitAmount\" >= \"UnitAmount\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_InventoryHoldItemNights_ListAmount",
                table: "InventoryHoldItemNights",
                sql: "\"ListUnitAmount\" >= \"UnitAmount\"");

            migrationBuilder.CreateIndex(
                name: "IX_BookingPromotionApplications_PromotionId",
                table: "BookingPromotionApplications",
                column: "PromotionId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingPromotionApplications_ReservationId",
                table: "BookingPromotionApplications",
                column: "ReservationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PromotionAudits_PromotionId_AtUtc",
                table: "PromotionAudits",
                columns: new[] { "PromotionId", "AtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PromotionAudits_PropertyId_PromotionId",
                table: "PromotionAudits",
                columns: new[] { "PropertyId", "PromotionId" });

            migrationBuilder.CreateIndex(
                name: "IX_PromotionMedia_PropertyId_CreatedAtUtc",
                table: "PromotionMedia",
                columns: new[] { "PropertyId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PromotionMedia_StorageKey",
                table: "PromotionMedia",
                column: "StorageKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PromotionRoomTypes_PropertyId_PromotionId",
                table: "PromotionRoomTypes",
                columns: new[] { "PropertyId", "PromotionId" });

            migrationBuilder.CreateIndex(
                name: "IX_PromotionRoomTypes_PropertyId_RoomTypeId",
                table: "PromotionRoomTypes",
                columns: new[] { "PropertyId", "RoomTypeId" });

            migrationBuilder.CreateIndex(
                name: "IX_PromotionRoomTypes_RoomTypeId",
                table: "PromotionRoomTypes",
                column: "RoomTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_Promotions_CoverMediaId",
                table: "Promotions",
                column: "CoverMediaId");

            migrationBuilder.CreateIndex(
                name: "IX_Promotions_PropertyId_Status",
                table: "Promotions",
                columns: new[] { "PropertyId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Promotions_Status_ShowOnHomepage_SortOrder",
                table: "Promotions",
                columns: new[] { "Status", "ShowOnHomepage", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "UX_Promotions_CreateOperation",
                table: "Promotions",
                columns: new[] { "CreatedByStaffId", "CreateOperationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Promotions_Slug",
                table: "Promotions",
                column: "Slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A rollback must not silently destroy promotions or the price snapshots that bookings point to.
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"BookingPromotionApplications\") OR EXISTS (SELECT 1 FROM \"Promotions\") " +
                "THEN RAISE EXCEPTION 'Down refused: promotions or booking promotion snapshots exist.'; END IF; END $$;");

            migrationBuilder.DropTable(
                name: "BookingPromotionApplications");

            migrationBuilder.DropTable(
                name: "PromotionAudits");

            migrationBuilder.DropTable(
                name: "PromotionRoomTypes");

            migrationBuilder.DropTable(
                name: "Promotions");

            migrationBuilder.DropTable(
                name: "PromotionMedia");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ReservationUnitNights_ListAmount",
                table: "ReservationUnitNights");

            migrationBuilder.DropCheckConstraint(
                name: "CK_InventoryHoldItemNights_ListAmount",
                table: "InventoryHoldItemNights");

            migrationBuilder.DropColumn(
                name: "ListUnitAmount",
                table: "ReservationUnitNights");

            migrationBuilder.DropColumn(
                name: "ListUnitAmount",
                table: "InventoryHoldItemNights");
        }
    }
}
