using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBlogMediaLibrary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Credit",
                table: "BlogMedia",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "BlogMedia",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "DisplayName",
                table: "BlogMedia",
                type: "character varying(150)",
                maxLength: 150,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "FocalX",
                table: "BlogMedia",
                type: "double precision",
                nullable: false,
                defaultValue: 0.5);

            migrationBuilder.AddColumn<double>(
                name: "FocalY",
                table: "BlogMedia",
                type: "double precision",
                nullable: false,
                defaultValue: 0.5);

            migrationBuilder.AddColumn<int>(
                name: "Generation",
                table: "BlogMedia",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Licence",
                table: "BlogMedia",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OriginalFileName",
                table: "BlogMedia",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OriginalSha256",
                table: "BlogMedia",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceUrl",
                table: "BlogMedia",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UpdatedAtUtc",
                table: "BlogMedia",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<Guid>(
                name: "UpdatedByStaffId",
                table: "BlogMedia",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "BlogMedia",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            // A picture CP01 already holds: a readable name (the original file name was never kept) and an update time. It stays generation 0 (original only)
            // until the operator backfill gives it variants; its id, key and addresses do not change.
            migrationBuilder.Sql(
                "UPDATE \"BlogMedia\" SET \"DisplayName\" = 'Picture ' || left(\"Id\"::text, 8), \"UpdatedAtUtc\" = \"CreatedAtUtc\";");

            migrationBuilder.CreateTable(
                name: "BlogMediaVariants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MediaId = table.Column<Guid>(type: "uuid", nullable: false),
                    Preset = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Format = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    ByteSize = table.Column<long>(type: "bigint", nullable: false),
                    Sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogMediaVariants", x => x.Id);
                    table.CheckConstraint("CK_BlogMediaVariants_Key", "\"StorageKey\" ~ '^blog/[0-9a-f]{32}\\.(jpg|png|webp)$'");
                    table.CheckConstraint("CK_BlogMediaVariants_Kind", "\"Preset\" IN ('thumb','card','article') AND \"Format\" IN ('webp','jpg','png')");
                    table.CheckConstraint("CK_BlogMediaVariants_Size", "\"ByteSize\" > 0 AND \"Width\" > 0 AND \"Height\" > 0");
                    table.ForeignKey(
                        name: "FK_BlogMediaVariants_BlogMedia_MediaId",
                        column: x => x.MediaId,
                        principalTable: "BlogMedia",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BlogMedia_CreatedAtUtc",
                table: "BlogMedia",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_BlogMedia_UpdatedByStaffId",
                table: "BlogMedia",
                column: "UpdatedByStaffId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_BlogMedia_Focal",
                table: "BlogMedia",
                sql: "\"FocalX\" BETWEEN 0 AND 1 AND \"FocalY\" BETWEEN 0 AND 1");

            migrationBuilder.AddCheckConstraint(
                name: "CK_BlogMedia_Version",
                table: "BlogMedia",
                sql: "\"Version\" >= 1 AND \"Generation\" >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_BlogMediaVariants_MediaId_Preset_Format",
                table: "BlogMediaVariants",
                columns: new[] { "MediaId", "Preset", "Format" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BlogMediaVariants_StorageKey",
                table: "BlogMediaVariants",
                column: "StorageKey",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_BlogMedia_StaffAccounts_UpdatedByStaffId",
                table: "BlogMedia",
                column: "UpdatedByStaffId",
                principalTable: "StaffAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuses while a picture has variants, was processed or had its description edited, so a rollback cannot drop any of that silently.
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"BlogMediaVariants\") OR EXISTS (SELECT 1 FROM \"BlogMedia\" WHERE \"Generation\" > 0 OR \"Version\" > 1) " +
                "THEN RAISE EXCEPTION 'Down refused: processed or edited Blog pictures exist.'; END IF; END $$;");

            migrationBuilder.DropForeignKey(
                name: "FK_BlogMedia_StaffAccounts_UpdatedByStaffId",
                table: "BlogMedia");

            migrationBuilder.DropTable(
                name: "BlogMediaVariants");

            migrationBuilder.DropIndex(
                name: "IX_BlogMedia_CreatedAtUtc",
                table: "BlogMedia");

            migrationBuilder.DropIndex(
                name: "IX_BlogMedia_UpdatedByStaffId",
                table: "BlogMedia");

            migrationBuilder.DropCheckConstraint(
                name: "CK_BlogMedia_Focal",
                table: "BlogMedia");

            migrationBuilder.DropCheckConstraint(
                name: "CK_BlogMedia_Version",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "Credit",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "DisplayName",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "FocalX",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "FocalY",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "Generation",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "Licence",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "OriginalFileName",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "OriginalSha256",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "SourceUrl",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "UpdatedAtUtc",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "UpdatedByStaffId",
                table: "BlogMedia");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "BlogMedia");
        }
    }
}
