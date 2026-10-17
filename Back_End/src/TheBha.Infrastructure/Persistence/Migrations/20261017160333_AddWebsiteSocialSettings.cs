using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebsiteSocialSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WebsiteSocialSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    PhoneEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    PhoneNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PhoneHref = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    MessengerEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    MessengerUrl = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: true),
                    ZaloEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    ZaloNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ZaloUrl = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    BackToTopEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteSocialSettings", x => x.Id);
                    table.CheckConstraint("CK_WebsiteSocialSettings_Singleton", "\"Id\" = 1");
                    table.CheckConstraint("CK_WebsiteSocialSettings_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_WebsiteSocialSettings_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteSocialSettings_UpdatedByStaffId",
                table: "WebsiteSocialSettings",
                column: "UpdatedByStaffId");

            migrationBuilder.Sql(WebsiteSocialSeed.Sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WebsiteSocialSettings");
        }
    }
}
