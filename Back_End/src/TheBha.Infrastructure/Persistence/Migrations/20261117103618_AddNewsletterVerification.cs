using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNewsletterVerification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastVerificationRequestedAtUtc",
                table: "NewsletterSubscriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "VerifiedAtUtc",
                table: "NewsletterSubscriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NewsletterOAuthStates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StateHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProtectedCodeVerifier = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    ClientId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ProtectedClientSecret = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConsumedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterOAuthStates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "NewsletterSenderSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    ClientId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    ProtectedClientSecret = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    ProtectedRefreshToken = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: true),
                    ConnectedEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    SenderName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ReplyTo = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    SenderGeneration = table.Column<int>(type: "integer", nullable: false),
                    ConnectedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ConnectedByStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterSenderSettings", x => x.Id);
                    table.CheckConstraint("CK_NewsletterSenderSettings_Connected", "\"Status\" = 'NotConnected' AND \"ProtectedRefreshToken\" IS NULL OR \"Status\" <> 'NotConnected' AND \"ProtectedRefreshToken\" IS NOT NULL AND \"ConnectedEmail\" IS NOT NULL AND \"ClientId\" IS NOT NULL AND \"ProtectedClientSecret\" IS NOT NULL");
                    table.CheckConstraint("CK_NewsletterSenderSettings_Singleton", "\"Id\" = 1");
                    table.CheckConstraint("CK_NewsletterSenderSettings_Status", "\"Status\" IN ('NotConnected', 'Connected', 'NeedsReconnect')");
                });

            migrationBuilder.CreateTable(
                name: "NewsletterVerificationRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SubscriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ProtectedToken = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    Language = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LeaseUntilUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UsedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SentAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastOutcome = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    SenderGeneration = table.Column<int>(type: "integer", nullable: true),
                    FromEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    FromName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ReplyTo = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterVerificationRequests", x => x.Id);
                    table.CheckConstraint("CK_NewsletterVerificationRequests_Attempts", "\"Attempts\" >= 0");
                    table.CheckConstraint("CK_NewsletterVerificationRequests_Language", "\"Language\" IN ('vi', 'en', 'fr')");
                    table.CheckConstraint("CK_NewsletterVerificationRequests_Status", "\"Status\" IN ('Pending', 'Sending', 'Sent', 'Failed', 'Cancelled')");
                    table.ForeignKey(
                        name: "FK_NewsletterVerificationRequests_NewsletterSubscriptions_Subs~",
                        column: x => x.SubscriptionId,
                        principalTable: "NewsletterSubscriptions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions",
                sql: "\"Status\" IN ('PendingVerification', 'Verified')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_VerifiedAt",
                table: "NewsletterSubscriptions",
                sql: "(\"Status\" = 'Verified') = (\"VerifiedAtUtc\" IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterOAuthStates_ExpiresAtUtc",
                table: "NewsletterOAuthStates",
                column: "ExpiresAtUtc");

            migrationBuilder.CreateIndex(
                name: "UX_NewsletterOAuthStates_StateHash",
                table: "NewsletterOAuthStates",
                column: "StateHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterVerificationRequests_Status_NextAttemptAtUtc",
                table: "NewsletterVerificationRequests",
                columns: new[] { "Status", "NextAttemptAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterVerificationRequests_SubscriptionId",
                table: "NewsletterVerificationRequests",
                column: "SubscriptionId");

            migrationBuilder.CreateIndex(
                name: "UX_NewsletterVerificationRequests_TokenHash",
                table: "NewsletterVerificationRequests",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuses while anything the new tables or columns hold would be lost: a connected sender (credentials), queued mail, or a verified address.
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"NewsletterSenderSettings\") OR EXISTS (SELECT 1 FROM \"NewsletterVerificationRequests\") " +
                "OR EXISTS (SELECT 1 FROM \"NewsletterSubscriptions\" WHERE \"Status\" = 'Verified') " +
                "THEN RAISE EXCEPTION 'Down refused: newsletter verification data exists.'; END IF; END $$;");

            migrationBuilder.DropTable(
                name: "NewsletterOAuthStates");

            migrationBuilder.DropTable(
                name: "NewsletterSenderSettings");

            migrationBuilder.DropTable(
                name: "NewsletterVerificationRequests");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NewsletterSubscriptions_VerifiedAt",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropColumn(
                name: "LastVerificationRequestedAtUtc",
                table: "NewsletterSubscriptions");

            migrationBuilder.DropColumn(
                name: "VerifiedAtUtc",
                table: "NewsletterSubscriptions");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NewsletterSubscriptions_Status",
                table: "NewsletterSubscriptions",
                sql: "\"Status\" IN ('PendingVerification')");
        }
    }
}
