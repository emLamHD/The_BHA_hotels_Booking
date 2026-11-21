using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNewsletterActivityCutover : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MenuActivityCutovers",
                columns: table => new
                {
                    MenuKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    LegacyMaxSequence = table.Column<long>(type: "bigint", nullable: false),
                    CutoverAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuActivityCutovers", x => x.MenuKey);
                    table.CheckConstraint("CK_MenuActivityCutovers_LegacyMaxSequence", "\"LegacyMaxSequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_MenuActivityCutovers_MenuActivityStreams_MenuKey",
                        column: x => x.MenuKey,
                        principalTable: "MenuActivityStreams",
                        principalColumn: "MenuKey",
                        onDelete: ReferentialAction.Restrict);
                });

            // BHA-ADMIN-BADGE-001-PR14 (ADR 0011 §E): the fence. Inert until the marker row exists; from then on an INSERT into the legacy table fails with SQLSTATE BH014 and rolls the writer's whole
            // transaction back, so a writer that decided "legacy" just before the cutover committed (or a build older than this release, which knows nothing of the marker) cannot keep counting there.
            // The function reads the marker with its own statement (a new snapshot under READ COMMITTED), so it sees a cutover that committed after the writer's transaction began.
            migrationBuilder.Sql(
                "CREATE FUNCTION \"NewsletterVerificationActivities_Fence\"() RETURNS trigger LANGUAGE plpgsql AS $fn$ " +
                "BEGIN IF EXISTS (SELECT 1 FROM \"MenuActivityCutovers\" WHERE \"MenuKey\" = 'newsletter') THEN " +
                "RAISE EXCEPTION 'The Newsletter activity moved to AdminActivities: a legacy insert is refused.' USING ERRCODE = 'BH014'; END IF; RETURN NEW; END $fn$;");
            migrationBuilder.Sql(
                "CREATE TRIGGER \"TR_NewsletterVerificationActivities_Fence\" BEFORE INSERT ON \"NewsletterVerificationActivities\" " +
                "FOR EACH ROW EXECUTE FUNCTION \"NewsletterVerificationActivities_Fence\"();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The locks are taken first, in this migration's transaction and held to its end: NOWAIT makes Down fail at once (55P03) while any writer is active, and a Down that gets them reads the final
            // state. A committed cutover is never reverted by a migration: the marker means the shared table holds the Newsletter's activity, so Down refuses and drops nothing.
            migrationBuilder.Sql("LOCK TABLE \"MenuActivityCutovers\", \"NewsletterVerificationActivities\" IN ACCESS EXCLUSIVE MODE NOWAIT;");
            migrationBuilder.Sql(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM \"MenuActivityCutovers\") THEN RAISE EXCEPTION 'Down refused: the Newsletter cutover is committed.'; END IF; END $$;");
            migrationBuilder.Sql("DROP TRIGGER \"TR_NewsletterVerificationActivities_Fence\" ON \"NewsletterVerificationActivities\";");
            migrationBuilder.Sql("DROP FUNCTION \"NewsletterVerificationActivities_Fence\"();");

            migrationBuilder.DropTable(
                name: "MenuActivityCutovers");
        }
    }
}
