using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNewsletterManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Source",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_VerifiedAt",
                table: "NewsletterSubscriptions");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ForVerifiedAtUtc",
                table: "NewsletterVerificationRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Purpose",
                table: "NewsletterVerificationRequests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Verification");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "RevokedAtUtc",
                table: "NewsletterVerificationRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ArchivedAtUtc",
                table: "NewsletterSubscriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CreatedByStaffId",
                table: "NewsletterSubscriptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Language",
                table: "NewsletterSubscriptions",
                type: "character varying(2)",
                maxLength: 2,
                nullable: false,
                defaultValue: "vi");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UnsubscribedAtUtc",
                table: "NewsletterSubscriptions",
                type: "timestamp with time zone",
                nullable: true);

            // The language of an address is the language of the LATEST confirmation mail it was sent (newest CreatedAtUtc; the larger request Id when two share the instant),
            // so an English or French subscriber's Welcome is written in their language. Addresses with no mail keep the column default, Vietnamese.
            migrationBuilder.Sql(
                """
                UPDATE "NewsletterSubscriptions" AS s SET "Language" = r."Language"
                FROM (SELECT DISTINCT ON ("SubscriptionId") "SubscriptionId", "Language"
                      FROM "NewsletterVerificationRequests"
                      ORDER BY "SubscriptionId", "CreatedAtUtc" DESC, "Id" DESC) AS r
                WHERE r."SubscriptionId" = s."Id";
                """);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "NewsletterSubscriptions",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "NewsletterSubscriptionAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SubscriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ActorStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Detail = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterSubscriptionAudits", x => x.Id);
                    table.CheckConstraint("CK_NewsletterSubscriptionAudits_Action", "\"Action\" IN ('created', 'edited', 'invited', 'unsubscribed', 'archived', 'restored', 'deleted')");
                    table.ForeignKey(
                        name: "FK_NewsletterSubscriptionAudits_StaffAccounts_ActorStaffId",
                        column: x => x.ActorStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "UX_NewsletterVerificationRequests_WelcomePerVerification",
                table: "NewsletterVerificationRequests",
                columns: new[] { "SubscriptionId", "ForVerifiedAtUtc" },
                unique: true,
                filter: "\"Purpose\" = 'Welcome'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterVerificationRequests_ForVerifiedAt",
                table: "NewsletterVerificationRequests",
                sql: "(\"Purpose\" = 'Welcome') = (\"ForVerifiedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterVerificationRequests_Purpose",
                table: "NewsletterVerificationRequests",
                sql: "\"Purpose\" IN ('Verification', 'Welcome')");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterSubscriptions_CreatedByStaffId",
                table: "NewsletterSubscriptions",
                column: "CreatedByStaffId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_CreatedBy",
                table: "NewsletterSubscriptions",
                sql: "(\"Source\" = 'admin') = (\"CreatedByStaffId\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Language",
                table: "NewsletterSubscriptions",
                sql: "\"Language\" IN ('vi', 'en', 'fr')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Source",
                table: "NewsletterSubscriptions",
                sql: "\"Source\" IN ('homepage', 'admin')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions",
                sql: "\"Status\" IN ('PendingVerification', 'Verified', 'Unsubscribed')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_UnsubscribedAt",
                table: "NewsletterSubscriptions",
                sql: "(\"Status\" = 'Unsubscribed') = (\"UnsubscribedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_VerifiedAt",
                table: "NewsletterSubscriptions",
                sql: "(\"Status\" = 'Verified' AND \"VerifiedAtUtc\" IS NOT NULL) OR (\"Status\" = 'PendingVerification' AND \"VerifiedAtUtc\" IS NULL) OR \"Status\" = 'Unsubscribed'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Version",
                table: "NewsletterSubscriptions",
                sql: "\"Version\" >= 1");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterSubscriptionAudits_ActorStaffId",
                table: "NewsletterSubscriptionAudits",
                column: "ActorStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterSubscriptionAudits_SubscriptionId_OccurredAtUtc",
                table: "NewsletterSubscriptionAudits",
                columns: new[] { "SubscriptionId", "OccurredAtUtc" });

            migrationBuilder.AddForeignKey(
                name: "FK_NewsletterSubscriptions_StaffAccounts_CreatedByStaffId",
                table: "NewsletterSubscriptions",
                column: "CreatedByStaffId",
                principalTable: "StaffAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuses while anything the new columns or tables hold would be lost: an address Staff added, an unsubscribed or archived one, an edited one,
            // a Welcome in the queue, an audit row (the old constraints would reject these rows anyway), or a language that Up would not derive again: Up gives an
            // address the language of its latest confirmation mail (or vi without one), so only a different one (a visitor who chose it with no mail sent) is data.
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"NewsletterSubscriptions\" s WHERE s.\"Source\" <> 'homepage' OR s.\"Status\" = 'Unsubscribed' OR s.\"ArchivedAtUtc\" IS NOT NULL OR s.\"Version\" > 1 " +
                "OR s.\"Language\" <> COALESCE((SELECT r.\"Language\" FROM \"NewsletterVerificationRequests\" r WHERE r.\"SubscriptionId\" = s.\"Id\" ORDER BY r.\"CreatedAtUtc\" DESC, r.\"Id\" DESC LIMIT 1), 'vi')) " +
                "OR EXISTS (SELECT 1 FROM \"NewsletterVerificationRequests\" WHERE \"Purpose\" <> 'Verification' OR \"RevokedAtUtc\" IS NOT NULL) " +
                "OR EXISTS (SELECT 1 FROM \"NewsletterSubscriptionAudits\") " +
                "THEN RAISE EXCEPTION 'Down refused: newsletter management data exists.'; END IF; END $$;");

            migrationBuilder.DropForeignKey(
                name: "FK_NewsletterSubscriptions_StaffAccounts_CreatedByStaffId",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropTable(
                name: "NewsletterSubscriptionAudits");

            migrationBuilder.DropIndex(
                name: "UX_NewsletterVerificationRequests_WelcomePerVerification",
                table: "NewsletterVerificationRequests");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterVerificationRequests_ForVerifiedAt",
                table: "NewsletterVerificationRequests");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterVerificationRequests_Purpose",
                table: "NewsletterVerificationRequests");

            migrationBuilder.DropIndex(
                name: "IX_NewsletterSubscriptions_CreatedByStaffId",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_CreatedBy",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Language",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Source",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_UnsubscribedAt",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_VerifiedAt",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Version",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropColumn(
                name: "ForVerifiedAtUtc",
                table: "NewsletterVerificationRequests");

            migrationBuilder.DropColumn(
                name: "Purpose",
                table: "NewsletterVerificationRequests");

            migrationBuilder.DropColumn(
                name: "RevokedAtUtc",
                table: "NewsletterVerificationRequests");

            migrationBuilder.DropColumn(
                name: "ArchivedAtUtc",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropColumn(
                name: "CreatedByStaffId",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropColumn(
                name: "Language",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropColumn(
                name: "UnsubscribedAtUtc",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "NewsletterSubscriptions");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Source",
                table: "NewsletterSubscriptions",
                sql: "\"Source\" IN ('homepage')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions",
                sql: "\"Status\" IN ('PendingVerification', 'Verified')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_VerifiedAt",
                table: "NewsletterSubscriptions",
                sql: "(\"Status\" = 'Verified') = (\"VerifiedAtUtc\" IS NOT NULL)");
        }
    }
}
