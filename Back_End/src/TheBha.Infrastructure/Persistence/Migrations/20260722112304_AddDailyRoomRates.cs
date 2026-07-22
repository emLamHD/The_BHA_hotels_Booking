using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDailyRoomRates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DailyRoomRates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RatePlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    StayDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyRoomRates", x => x.Id);
                    table.CheckConstraint("CK_DailyRoomRates_Amount", "\"Amount\" > 0");
                    table.CheckConstraint("CK_DailyRoomRates_Timestamps", "\"UpdatedAt\" >= \"CreatedAt\"");
                    table.ForeignKey(
                        name: "FK_DailyRoomRates_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyRoomRates_RatePlans_PropertyId_RatePlanId",
                        columns: x => new { x.PropertyId, x.RatePlanId },
                        principalTable: "RatePlans",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyRoomRates_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyRoomRates_PropertyId_RatePlanId_StayDate",
                table: "DailyRoomRates",
                columns: new[] { "PropertyId", "RatePlanId", "StayDate" });

            migrationBuilder.CreateIndex(
                name: "IX_DailyRoomRates_PropertyId_RoomTypeId_RatePlanId_StayDate",
                table: "DailyRoomRates",
                columns: new[] { "PropertyId", "RoomTypeId", "RatePlanId", "StayDate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DailyRoomRates_PropertyId_RoomTypeId_StayDate",
                table: "DailyRoomRates",
                columns: new[] { "PropertyId", "RoomTypeId", "StayDate" });

            migrationBuilder.CreateIndex(
                name: "IX_DailyRoomRates_PropertyId_StayDate",
                table: "DailyRoomRates",
                columns: new[] { "PropertyId", "StayDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyRoomRates");
        }
    }
}
