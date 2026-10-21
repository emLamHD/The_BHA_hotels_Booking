using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminCatalogContent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "AreaSquareMeters",
                table: "RoomTypes",
                type: "numeric(8,2)",
                precision: 8,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BedDescription",
                table: "RoomTypes",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Bedrooms",
                table: "RoomTypes",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ContentUpdatedByStaffId",
                table: "RoomTypes",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ContentVersion",
                table: "RoomTypes",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "AltTextOverride",
                table: "RoomTypeMedia",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AltTextOverride",
                table: "PropertyMedia",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ContentUpdatedByStaffId",
                table: "Properties",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ContentVersion",
                table: "Properties",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "CatalogContentAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    AtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Before = table.Column<string>(type: "jsonb", nullable: false),
                    After = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogContentAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CatalogContentAudits_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CatalogContentAudits_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CatalogUploads",
                columns: table => new
                {
                    MediaId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomTypeId = table.Column<Guid>(type: "uuid", nullable: true),
                    StorageKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogUploads", x => x.MediaId);
                    table.ForeignKey(
                        name: "FK_CatalogUploads_Media_MediaId",
                        column: x => x.MediaId,
                        principalTable: "Media",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CatalogUploads_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CatalogUploads_RoomTypes_PropertyId_RoomTypeId",
                        columns: x => new { x.PropertyId, x.RoomTypeId },
                        principalTable: "RoomTypes",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogContentAudits_PropertyId_AtUtc",
                table: "CatalogContentAudits",
                columns: new[] { "PropertyId", "AtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogContentAudits_PropertyId_RoomTypeId",
                table: "CatalogContentAudits",
                columns: new[] { "PropertyId", "RoomTypeId" });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogUploads_PropertyId_RoomTypeId",
                table: "CatalogUploads",
                columns: new[] { "PropertyId", "RoomTypeId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CatalogContentAudits");

            migrationBuilder.DropTable(
                name: "CatalogUploads");

            migrationBuilder.DropColumn(
                name: "AreaSquareMeters",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "BedDescription",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "Bedrooms",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "ContentUpdatedByStaffId",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "ContentVersion",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "AltTextOverride",
                table: "RoomTypeMedia");

            migrationBuilder.DropColumn(
                name: "AltTextOverride",
                table: "PropertyMedia");

            migrationBuilder.DropColumn(
                name: "ContentUpdatedByStaffId",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "ContentVersion",
                table: "Properties");
        }
    }
}
