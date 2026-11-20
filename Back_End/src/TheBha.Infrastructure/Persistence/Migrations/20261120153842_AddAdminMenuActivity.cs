using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminMenuActivity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AdminActivities",
                columns: table => new
                {
                    MenuKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorKind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    ActorStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    Action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    EntityKind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    EntityKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    TitleSnapshot = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ItemCount = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    CorrelationId = table.Column<Guid>(type: "uuid", nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdminActivities", x => new { x.MenuKey, x.Sequence });
                    table.CheckConstraint("CK_AdminActivities_ActorKind", "\"ActorKind\" IN ('Staff', 'Public', 'System')");
                    table.CheckConstraint("CK_AdminActivities_ActorStaff", "(\"ActorKind\" = 'Staff') = (\"ActorStaffId\" IS NOT NULL)");
                    table.CheckConstraint("CK_AdminActivities_ItemCount", "\"ItemCount\" >= 1");
                    table.CheckConstraint("CK_AdminActivities_Sequence", "\"Sequence\" >= 1");
                    table.ForeignKey(
                        name: "FK_AdminActivities_MenuActivityStreams_MenuKey",
                        column: x => x.MenuKey,
                        principalTable: "MenuActivityStreams",
                        principalColumn: "MenuKey",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AdminActivities_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AdminActivities_StaffAccounts_ActorStaffId",
                        column: x => x.ActorStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StaffEntitySeen",
                columns: table => new
                {
                    StaffAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityKind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    EntityKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    LastSeenSequence = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffEntitySeen", x => new { x.StaffAccountId, x.PropertyId, x.EntityKind, x.EntityKey });
                    table.CheckConstraint("CK_StaffEntitySeen_LastSeenSequence", "\"LastSeenSequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_StaffEntitySeen_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffEntitySeen_StaffAccounts_StaffAccountId",
                        column: x => x.StaffAccountId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StaffMenuPropertySeen",
                columns: table => new
                {
                    StaffAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastSeenSequence = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffMenuPropertySeen", x => new { x.StaffAccountId, x.MenuKey, x.PropertyId });
                    table.CheckConstraint("CK_StaffMenuPropertySeen_LastSeenSequence", "\"LastSeenSequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_StaffMenuPropertySeen_MenuActivityStreams_MenuKey",
                        column: x => x.MenuKey,
                        principalTable: "MenuActivityStreams",
                        principalColumn: "MenuKey",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffMenuPropertySeen_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffMenuPropertySeen_StaffAccounts_StaffAccountId",
                        column: x => x.StaffAccountId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "MenuActivityStreams",
                columns: new[] { "MenuKey", "LastSequence" },
                values: new object[,]
                {
                    { "blog-categories", 0L },
                    { "blog-media", 0L },
                    { "blog-posts", 0L },
                    { "blog-settings", 0L },
                    { "calendar", 0L },
                    { "catalog", 0L },
                    { "newsletter-sender", 0L },
                    { "promotions", 0L },
                    { "website-currencies", 0L },
                    { "website-hero", 0L },
                    { "website-languages", 0L },
                    { "website-menus", 0L },
                    { "website-social", 0L },
                    { "website-translations", 0L }
                });

            migrationBuilder.CreateIndex(
                name: "IX_AdminActivities_ActorStaffId",
                table: "AdminActivities",
                column: "ActorStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_AdminActivities_MenuKey_EntityKind_EntityKey_Sequence",
                table: "AdminActivities",
                columns: new[] { "MenuKey", "EntityKind", "EntityKey", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_AdminActivities_MenuKey_PropertyId_Sequence",
                table: "AdminActivities",
                columns: new[] { "MenuKey", "PropertyId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_AdminActivities_PropertyId",
                table: "AdminActivities",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "UX_AdminActivities_Correlation",
                table: "AdminActivities",
                columns: new[] { "MenuKey", "CorrelationId", "Action" },
                unique: true,
                filter: "\"CorrelationId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UX_AdminActivities_Id",
                table: "AdminActivities",
                column: "Id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StaffEntitySeen_PropertyId",
                table: "StaffEntitySeen",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffMenuPropertySeen_MenuKey",
                table: "StaffMenuPropertySeen",
                column: "MenuKey");

            migrationBuilder.CreateIndex(
                name: "IX_StaffMenuPropertySeen_PropertyId",
                table: "StaffMenuPropertySeen",
                column: "PropertyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuses, before anything is dropped, while the new part holds state that Up would not recreate: an activity row, a cursor in either new table, a StaffMenuSeen cursor of
            // one of the 14 new menus, or a counter of those menus that has moved. The legacy Newsletter rows, counter and cursors belong to migration 25 and are never part of this guard
            // or of this Down. The keys are written out on purpose: a frozen migration must not read application constants.
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"AdminActivities\") OR EXISTS (SELECT 1 FROM \"StaffMenuPropertySeen\") OR EXISTS (SELECT 1 FROM \"StaffEntitySeen\") " +
                "OR EXISTS (SELECT 1 FROM \"StaffMenuSeen\" WHERE \"MenuKey\" IN ('blog-posts','blog-categories','blog-media','blog-settings','website-hero','website-menus','website-languages'," +
                "'website-translations','website-currencies','website-social','newsletter-sender','promotions','catalog','calendar')) " +
                "OR EXISTS (SELECT 1 FROM \"MenuActivityStreams\" WHERE \"LastSequence\" <> 0 AND \"MenuKey\" IN ('blog-posts','blog-categories','blog-media','blog-settings','website-hero'," +
                "'website-menus','website-languages','website-translations','website-currencies','website-social','newsletter-sender','promotions','catalog','calendar')) " +
                "THEN RAISE EXCEPTION 'Down refused: admin menu activity data exists.'; END IF; END $$;");

            migrationBuilder.DropTable(
                name: "AdminActivities");

            migrationBuilder.DropTable(
                name: "StaffEntitySeen");

            migrationBuilder.DropTable(
                name: "StaffMenuPropertySeen");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "blog-categories");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "blog-media");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "blog-posts");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "blog-settings");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "calendar");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "catalog");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "newsletter-sender");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "promotions");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "website-currencies");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "website-hero");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "website-languages");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "website-menus");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "website-social");

            migrationBuilder.DeleteData(
                table: "MenuActivityStreams",
                keyColumn: "MenuKey",
                keyValue: "website-translations");
        }
    }
}
