using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddStaffBookingNotificationRecipients : Migration
    {
        // BHA-CHECKOUT-001-PR04. Additive: three new tables. Nothing existing is read, backfilled or changed, and no address or recipient is invented: every Property starts with no preference, no fallback and no audit row.
        // Down: the tables are locked first (ACCESS EXCLUSIVE ... NOWAIT, held to the end of the migration's transaction) so the count sees the final state and an open writer makes Down fail at once (55P03). It then
        // REFUSES while any preference, fallback or audit row exists, because the previous schema has no place for who-receives-what and dropping it would silently stop (or change) booking notifications.
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookingNotificationAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingNotificationAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookingNotificationAudits_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingNotificationAudits_StaffAccounts_ActorStaffId",
                        column: x => x.ActorStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BookingNotificationAudits_StaffAccounts_TargetStaffId",
                        column: x => x.TargetStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BookingNotificationFallbacks",
                columns: table => new
                {
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingNotificationFallbacks", x => x.PropertyId);
                    table.CheckConstraint("CK_BookingNotificationFallbacks_Email", "\"Email\" IS NULL OR (btrim(\"Email\") <> '' AND \"Email\" !~ '[[:cntrl:]]')");
                    table.CheckConstraint("CK_BookingNotificationFallbacks_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_BookingNotificationFallbacks_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StaffBookingNotificationPreferences",
                columns: table => new
                {
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    NotificationEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffBookingNotificationPreferences", x => new { x.PropertyId, x.StaffAccountId });
                    table.CheckConstraint("CK_StaffBookingNotificationPreferences_Email", "\"NotificationEmail\" IS NULL OR (btrim(\"NotificationEmail\") <> '' AND \"NotificationEmail\" !~ '[[:cntrl:]]')");
                    table.CheckConstraint("CK_StaffBookingNotificationPreferences_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_StaffBookingNotificationPreferences_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffBookingNotificationPreferences_StaffAccounts_StaffAcco~",
                        column: x => x.StaffAccountId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookingNotificationAudits_ActorStaffId",
                table: "BookingNotificationAudits",
                column: "ActorStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingNotificationAudits_PropertyId_AtUtc",
                table: "BookingNotificationAudits",
                columns: new[] { "PropertyId", "AtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_BookingNotificationAudits_TargetStaffId",
                table: "BookingNotificationAudits",
                column: "TargetStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffBookingNotificationPreferences_StaffAccountId",
                table: "StaffBookingNotificationPreferences",
                column: "StaffAccountId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("LOCK TABLE \"StaffBookingNotificationPreferences\", \"BookingNotificationFallbacks\", \"BookingNotificationAudits\" IN ACCESS EXCLUSIVE MODE NOWAIT;");

            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    preference_count bigint;
                    fallback_count bigint;
                    audit_count bigint;
                BEGIN
                    SELECT COUNT(*) INTO preference_count FROM "StaffBookingNotificationPreferences";
                    SELECT COUNT(*) INTO fallback_count FROM "BookingNotificationFallbacks";
                    SELECT COUNT(*) INTO audit_count FROM "BookingNotificationAudits";
                    IF preference_count > 0 OR fallback_count > 0 OR audit_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade AddStaffBookingNotificationRecipients: % preference(s), % fallback(s) and % audit row(s) exist and the previous schema has no place for them. Export or clear them before downgrading.', preference_count, fallback_count, audit_count;
                    END IF;
                END $$;
                """);

            migrationBuilder.DropTable(
                name: "BookingNotificationAudits");

            migrationBuilder.DropTable(
                name: "BookingNotificationFallbacks");

            migrationBuilder.DropTable(
                name: "StaffBookingNotificationPreferences");
        }
    }
}
