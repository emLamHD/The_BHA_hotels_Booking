using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNewsletterSubscriptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NewsletterSubscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    Source = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ReceivedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterSubscriptions", x => x.Id);
                    table.CheckConstraint("CK_NewsletterSubscriptions_Email", "\"Email\" = lower(btrim(\"Email\")) AND char_length(\"Email\") BETWEEN 3 AND 254 AND \"Email\" LIKE '_%@_%'");
                    table.CheckConstraint("CK_NewsletterSubscriptions_Source", "\"Source\" IN ('homepage')");
                    table.CheckConstraint("CK_NewsletterSubscriptions_Status", "\"Status\" IN ('PendingVerification')");
                });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterSubscriptions_ReceivedAtUtc_Id",
                table: "NewsletterSubscriptions",
                columns: new[] { "ReceivedAtUtc", "Id" },
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "UX_NewsletterSubscriptions_Email",
                table: "NewsletterSubscriptions",
                column: "Email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NewsletterSubscriptions");
        }
    }
}
