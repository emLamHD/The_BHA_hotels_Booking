using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNewsletterUnseenBadge : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MenuActivityStreams",
                columns: table => new
                {
                    MenuKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    LastSequence = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuActivityStreams", x => x.MenuKey);
                    table.CheckConstraint("CK_MenuActivityStreams_LastSequence", "\"LastSequence\" >= 0");
                });

            migrationBuilder.CreateTable(
                name: "NewsletterVerificationActivities",
                columns: table => new
                {
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    SubscriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterVerificationActivities", x => x.Sequence);
                    table.CheckConstraint("CK_NewsletterVerificationActivities_Sequence", "\"Sequence\" >= 1");
                    table.ForeignKey(
                        name: "FK_NewsletterVerificationActivities_NewsletterSubscriptions_Su~",
                        column: x => x.SubscriptionId,
                        principalTable: "NewsletterSubscriptions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StaffMenuSeen",
                columns: table => new
                {
                    StaffAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    LastSeenSequence = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffMenuSeen", x => new { x.StaffAccountId, x.MenuKey });
                    table.CheckConstraint("CK_StaffMenuSeen_LastSeenSequence", "\"LastSeenSequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_StaffMenuSeen_MenuActivityStreams_MenuKey",
                        column: x => x.MenuKey,
                        principalTable: "MenuActivityStreams",
                        principalColumn: "MenuKey",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffMenuSeen_StaffAccounts_StaffAccountId",
                        column: x => x.StaffAccountId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "MenuActivityStreams",
                columns: new[] { "MenuKey", "LastSequence" },
                values: new object[] { "newsletter", 0L });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterVerificationActivities_SubscriptionId",
                table: "NewsletterVerificationActivities",
                column: "SubscriptionId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffMenuSeen_MenuKey",
                table: "StaffMenuSeen",
                column: "MenuKey");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuses while the stream holds state that Up would not recreate: a verification already counted (an activity row), a Staff member's "seen" cursor, or a counter that has
            // moved. Dropping them would hand every Staff member a different badge the next time this migration is applied. Up starts from nothing, so an untouched stream may go.
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"NewsletterVerificationActivities\") OR EXISTS (SELECT 1 FROM \"StaffMenuSeen\") " +
                "OR EXISTS (SELECT 1 FROM \"MenuActivityStreams\" WHERE \"LastSequence\" <> 0) " +
                "THEN RAISE EXCEPTION 'Down refused: newsletter unseen-badge data exists.'; END IF; END $$;");

            migrationBuilder.DropTable(
                name: "NewsletterVerificationActivities");

            migrationBuilder.DropTable(
                name: "StaffMenuSeen");

            migrationBuilder.DropTable(
                name: "MenuActivityStreams");
        }
    }
}
