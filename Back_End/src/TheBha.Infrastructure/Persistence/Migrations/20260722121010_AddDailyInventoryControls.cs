using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDailyInventoryControls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DailyInventoryControls",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    StayDate = table.Column<DateOnly>(type: "date", nullable: false),
                    SellableLimit = table.Column<int>(type: "integer", nullable: true),
                    IsStopSell = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyInventoryControls", x => x.Id);
                    table.CheckConstraint("CK_DailyInventoryControls_Effect", "\"SellableLimit\" IS NOT NULL OR \"IsStopSell\" = TRUE");
                    table.CheckConstraint("CK_DailyInventoryControls_SellableLimit", "\"SellableLimit\" IS NULL OR \"SellableLimit\" >= 0");
                    table.CheckConstraint("CK_DailyInventoryControls_Timestamps", "\"UpdatedAt\" >= \"CreatedAt\"");
                    table.ForeignKey(
                        name: "FK_DailyInventoryControls_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyInventoryControls_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyInventoryControls_PropertyId_RoomTypeId_StayDate",
                table: "DailyInventoryControls",
                columns: new[] { "PropertyId", "RoomTypeId", "StayDate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DailyInventoryControls_PropertyId_StayDate",
                table: "DailyInventoryControls",
                columns: new[] { "PropertyId", "StayDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyInventoryControls");
        }
    }
}
