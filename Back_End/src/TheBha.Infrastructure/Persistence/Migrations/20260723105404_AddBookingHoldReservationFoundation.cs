using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingHoldReservationFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookingHolds",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RatePlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    FullName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CheckIn = table.Column<DateOnly>(type: "date", nullable: false),
                    CheckOut = table.Column<DateOnly>(type: "date", nullable: false),
                    Adults = table.Column<int>(type: "integer", nullable: false),
                    Children = table.Column<int>(type: "integer", nullable: false),
                    Rooms = table.Column<int>(type: "integer", nullable: false),
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
                    Rooms = table.Column<int>(type: "integer", nullable: false),
                    UnitAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    NightTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
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
                name: "Reservations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfirmationNumber = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SourceHoldId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RatePlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    FullName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CheckIn = table.Column<DateOnly>(type: "date", nullable: false),
                    CheckOut = table.Column<DateOnly>(type: "date", nullable: false),
                    Adults = table.Column<int>(type: "integer", nullable: false),
                    Children = table.Column<int>(type: "integer", nullable: false),
                    Rooms = table.Column<int>(type: "integer", nullable: false),
                    CurrencyCode = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ConfirmedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CancelledAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CancellationReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    GuestAccessTokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Reservations", x => x.Id);
                    table.CheckConstraint("CK_Reservations_Cancellation", "(\"Status\" = 'Confirmed' AND \"CancelledAtUtc\" IS NULL AND \"CancellationReason\" IS NULL) OR (\"Status\" = 'Cancelled' AND \"CancelledAtUtc\" IS NOT NULL AND \"CancelledAtUtc\" >= \"ConfirmedAtUtc\" AND \"CancellationReason\" IS NOT NULL AND btrim(\"CancellationReason\") <> '')");
                    table.CheckConstraint("CK_Reservations_ConfirmationNumber", "\"ConfirmationNumber\" ~ '^[A-Z0-9-]+$'");
                    table.CheckConstraint("CK_Reservations_Contact", "btrim(\"FullName\") <> '' AND btrim(\"Email\") <> '' AND btrim(\"Phone\") <> ''");
                    table.CheckConstraint("CK_Reservations_Currency", "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
                    table.CheckConstraint("CK_Reservations_Hash", "\"GuestAccessTokenHash\" IS NULL OR \"GuestAccessTokenHash\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_Reservations_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"SourceHoldId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RoomTypeId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"RatePlanId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND (\"CustomerAccountId\" IS NULL OR \"CustomerAccountId\" <> '00000000-0000-0000-0000-000000000000'::uuid)");
                    table.CheckConstraint("CK_Reservations_Occupancy", "\"Adults\" >= 1 AND \"Children\" >= 0 AND \"Rooms\" >= 1");
                    table.CheckConstraint("CK_Reservations_Ownership", "(\"CustomerAccountId\" IS NOT NULL AND \"GuestAccessTokenHash\" IS NULL) OR (\"CustomerAccountId\" IS NULL AND \"GuestAccessTokenHash\" IS NOT NULL)");
                    table.CheckConstraint("CK_Reservations_Status", "\"Status\" IN ('Confirmed', 'Cancelled')");
                    table.CheckConstraint("CK_Reservations_Stay", "\"CheckIn\" < \"CheckOut\"");
                    table.CheckConstraint("CK_Reservations_TotalAmount", "\"TotalAmount\" > 0");
                    table.ForeignKey(
                        name: "FK_Reservations_AspNetUsers_CustomerAccountId",
                        column: x => x.CustomerAccountId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Reservations_BookingHolds_SourceHoldId",
                        column: x => x.SourceHoldId,
                        principalTable: "BookingHolds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Reservations_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Reservations_RatePlans_PropertyId_RatePlanId",
                        columns: x => new { x.PropertyId, x.RatePlanId },
                        principalTable: "RatePlans",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Reservations_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReservationNights",
                columns: table => new
                {
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    StayDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Rooms = table.Column<int>(type: "integer", nullable: false),
                    UnitAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    NightTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
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

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_ConfirmationNumber",
                table: "Reservations",
                column: "ConfirmationNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_CustomerAccountId",
                table: "Reservations",
                column: "CustomerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_PropertyId_RatePlanId",
                table: "Reservations",
                columns: new[] { "PropertyId", "RatePlanId" });

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_PropertyId_RoomTypeId_Status",
                table: "Reservations",
                columns: new[] { "PropertyId", "RoomTypeId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_SourceHoldId",
                table: "Reservations",
                column: "SourceHoldId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookingHoldNights");

            migrationBuilder.DropTable(
                name: "ReservationNights");

            migrationBuilder.DropTable(
                name: "Reservations");

            migrationBuilder.DropTable(
                name: "BookingHolds");
        }
    }
}
