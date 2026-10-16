using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebsiteMenus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WebsiteMenu",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteMenu", x => x.Id);
                    table.CheckConstraint("CK_WebsiteMenu_Singleton", "\"Id\" = 1");
                    table.CheckConstraint("CK_WebsiteMenu_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_WebsiteMenu_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WebsiteMenuItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Placement = table.Column<string>(type: "character varying(9)", maxLength: 9, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Href = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    OpenInNewTab = table.Column<bool>(type: "boolean", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteMenuItems", x => x.Id);
                    table.CheckConstraint("CK_WebsiteMenuItems_Href", "char_length(\"Href\") BETWEEN 1 AND 2048 AND \"Href\" !~ '[[:cntrl:][:space:]\\\\]'");
                    table.CheckConstraint("CK_WebsiteMenuItems_Label", "btrim(\"Label\") <> '' AND char_length(\"Label\") <= 80");
                    table.CheckConstraint("CK_WebsiteMenuItems_NotOwnParent", "\"ParentId\" IS NULL OR \"ParentId\" <> \"Id\"");
                    table.CheckConstraint("CK_WebsiteMenuItems_Placement", "(\"ParentId\" IS NULL) = (\"Placement\" IS NOT NULL) AND (\"Placement\" IS NULL OR \"Placement\" IN ('primary', 'secondary'))");
                    table.CheckConstraint("CK_WebsiteMenuItems_SortOrder", "\"SortOrder\" BETWEEN 0 AND 10000");
                    table.ForeignKey(
                        name: "FK_WebsiteMenuItems_WebsiteMenuItems_ParentId",
                        column: x => x.ParentId,
                        principalTable: "WebsiteMenuItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteMenu_UpdatedByStaffId",
                table: "WebsiteMenu",
                column: "UpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteMenuItems_Parent_Sort",
                table: "WebsiteMenuItems",
                columns: new[] { "ParentId", "SortOrder" });

            // Seed: the menu the header showed before this migration, plus FAQ after Blog. Runs once (the migration history), never at startup.
            migrationBuilder.Sql(WebsiteMenuSeed.Sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DELETE FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.menuItem.%'""");

            migrationBuilder.DropTable(
                name: "WebsiteMenu");

            migrationBuilder.DropTable(
                name: "WebsiteMenuItems");
        }
    }
}
