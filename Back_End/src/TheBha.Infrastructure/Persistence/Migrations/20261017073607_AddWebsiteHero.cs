using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebsiteHero : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WebsiteHero",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    FontKey = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AutoplayEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    IntervalSeconds = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Description = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    PrimaryActionLabel = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    SecondaryActionLabel = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteHero", x => x.Id);
                    table.CheckConstraint("CK_WebsiteHero_Font", "\"FontKey\" IN ('default', 'be-vietnam-pro', 'system-sans', 'system-serif')");
                    table.CheckConstraint("CK_WebsiteHero_Interval", "\"IntervalSeconds\" BETWEEN 3 AND 60");
                    table.CheckConstraint("CK_WebsiteHero_Singleton", "\"Id\" = 1");
                    table.CheckConstraint("CK_WebsiteHero_Texts", "btrim(\"Title\") <> '' AND char_length(\"Title\") <= 120 AND btrim(\"Description\") <> '' AND char_length(\"Description\") <= 300 AND btrim(\"PrimaryActionLabel\") <> '' AND char_length(\"PrimaryActionLabel\") <= 40 AND btrim(\"SecondaryActionLabel\") <> '' AND char_length(\"SecondaryActionLabel\") <= 40");
                    table.CheckConstraint("CK_WebsiteHero_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_WebsiteHero_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WebsiteHeroMedia",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ByteSize = table.Column<long>(type: "bigint", nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteHeroMedia", x => x.Id);
                    table.CheckConstraint("CK_WebsiteHeroMedia_ContentType", "\"ContentType\" IN ('image/jpeg', 'image/png', 'image/webp')");
                    table.CheckConstraint("CK_WebsiteHeroMedia_Kind", "\"Kind\" IN ('seed', 'upload')");
                    table.CheckConstraint("CK_WebsiteHeroMedia_Size", "\"ByteSize\" BETWEEN 1 AND 10485760 AND \"Width\" BETWEEN 1 AND 8000 AND \"Height\" BETWEEN 1 AND 8000");
                    table.CheckConstraint("CK_WebsiteHeroMedia_StorageKey", "\"StorageKey\" ~ '^(seed|hero)/[A-Za-z0-9][A-Za-z0-9._-]*$' AND \"StorageKey\" !~ '\\.\\.'");
                    table.ForeignKey(
                        name: "FK_WebsiteHeroMedia_StaffAccounts_CreatedByStaffId",
                        column: x => x.CreatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WebsiteHeroSlides",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MediaId = table.Column<Guid>(type: "uuid", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    FocalPosition = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Alt = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Caption = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteHeroSlides", x => x.Id);
                    table.CheckConstraint("CK_WebsiteHeroSlides_Alt", "btrim(\"Alt\") <> '' AND char_length(\"Alt\") <= 200");
                    table.CheckConstraint("CK_WebsiteHeroSlides_Caption", "btrim(\"Caption\") <> '' AND char_length(\"Caption\") <= 120");
                    table.CheckConstraint("CK_WebsiteHeroSlides_Focal", "\"FocalPosition\" ~ '^[0-9]{1,3}% [0-9]{1,3}%$'");
                    table.CheckConstraint("CK_WebsiteHeroSlides_SortOrder", "\"SortOrder\" BETWEEN 0 AND 9");
                    table.ForeignKey(
                        name: "FK_WebsiteHeroSlides_WebsiteHeroMedia_MediaId",
                        column: x => x.MediaId,
                        principalTable: "WebsiteHeroMedia",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteHero_UpdatedByStaffId",
                table: "WebsiteHero",
                column: "UpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteHeroMedia_CreatedAt",
                table: "WebsiteHeroMedia",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteHeroMedia_CreatedByStaffId",
                table: "WebsiteHeroMedia",
                column: "CreatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "UX_WebsiteHeroMedia_StorageKey",
                table: "WebsiteHeroMedia",
                column: "StorageKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteHeroSlides_Media",
                table: "WebsiteHeroSlides",
                column: "MediaId");

            migrationBuilder.CreateIndex(
                name: "UX_WebsiteHeroSlides_Sort",
                table: "WebsiteHeroSlides",
                column: "SortOrder",
                unique: true);

            // Seed: the hero the Customer had in code before this migration. Runs once (the migration history), never at startup.
            migrationBuilder.Sql(WebsiteHeroSeed.Sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DELETE FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.heroSlideshow.%' OR "Key" LIKE 'content.heroSlide.%'""");

            migrationBuilder.DropTable(
                name: "WebsiteHero");

            migrationBuilder.DropTable(
                name: "WebsiteHeroSlides");

            migrationBuilder.DropTable(
                name: "WebsiteHeroMedia");
        }
    }
}
