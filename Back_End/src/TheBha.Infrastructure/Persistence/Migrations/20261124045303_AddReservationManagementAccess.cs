using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationManagementAccess : Migration
    {
        // BHA-CHECKOUT-001-PR06. Additive: three new tables (single-use management links, the sessions they were exchanged for, and the guest's estimated arrival). Nothing existing is read, backfilled or changed;
        // the tables are empty on deploy and no link is invented for a Reservation of the past.
        // Down: the three tables are locked first (ACCESS EXCLUSIVE ... NOWAIT, held to the end of the migration's transaction) so the counts see the final state and an open writer makes Down fail at once (55P03).
        // It then REFUSES while any row exists in any of them: a link or session is a guest's only way back into a reservation, and an estimated arrival is something the guest told us; dropping either would silently
        // destroy it. Stop issuing links and clear the rows deliberately before downgrading.
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReservationArrivalEstimates",
                columns: table => new
                {
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ArrivalDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ArrivalTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    TimeZoneId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationArrivalEstimates", x => x.ReservationId);
                    table.CheckConstraint("CK_ReservationArrivalEstimates_Ids", "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_ReservationArrivalEstimates_TimeZone", "btrim(\"TimeZoneId\") <> ''");
                    table.ForeignKey(
                        name: "FK_ReservationArrivalEstimates_Reservations_PropertyId_Reserva~",
                        columns: x => new { x.PropertyId, x.ReservationId },
                        principalTable: "Reservations",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReservationManagementLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConsumedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationManagementLinks", x => x.Id);
                    table.CheckConstraint("CK_ReservationManagementLinks_Hash", "\"TokenHash\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_ReservationManagementLinks_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_ReservationManagementLinks_Times", "\"ExpiresAtUtc\" > \"CreatedAtUtc\" AND (\"ConsumedAtUtc\" IS NULL OR \"ConsumedAtUtc\" >= \"CreatedAtUtc\")");
                    table.ForeignKey(
                        name: "FK_ReservationManagementLinks_Reservations_PropertyId_Reservat~",
                        columns: x => new { x.PropertyId, x.ReservationId },
                        principalTable: "Reservations",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReservationManagementSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    LinkId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationManagementSessions", x => x.Id);
                    table.CheckConstraint("CK_ReservationManagementSessions_Hash", "\"SessionHash\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_ReservationManagementSessions_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"LinkId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_ReservationManagementSessions_Times", "\"ExpiresAtUtc\" > \"CreatedAtUtc\"");
                    table.ForeignKey(
                        name: "FK_ReservationManagementSessions_ReservationManagementLinks_Li~",
                        column: x => x.LinkId,
                        principalTable: "ReservationManagementLinks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReservationManagementSessions_Reservations_PropertyId_Reser~",
                        columns: x => new { x.PropertyId, x.ReservationId },
                        principalTable: "Reservations",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationArrivalEstimates_PropertyId_ReservationId",
                table: "ReservationArrivalEstimates",
                columns: new[] { "PropertyId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationManagementLinks_PropertyId_ReservationId",
                table: "ReservationManagementLinks",
                columns: new[] { "PropertyId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationManagementLinks_TokenHash",
                table: "ReservationManagementLinks",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationManagementSessions_LinkId",
                table: "ReservationManagementSessions",
                column: "LinkId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationManagementSessions_PropertyId_ReservationId",
                table: "ReservationManagementSessions",
                columns: new[] { "PropertyId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationManagementSessions_SessionHash",
                table: "ReservationManagementSessions",
                column: "SessionHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("LOCK TABLE \"ReservationManagementLinks\", \"ReservationManagementSessions\", \"ReservationArrivalEstimates\" IN ACCESS EXCLUSIVE MODE NOWAIT;");

            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    link_count bigint;
                    session_count bigint;
                    estimate_count bigint;
                BEGIN
                    SELECT COUNT(*) INTO link_count FROM "ReservationManagementLinks";
                    SELECT COUNT(*) INTO session_count FROM "ReservationManagementSessions";
                    SELECT COUNT(*) INTO estimate_count FROM "ReservationArrivalEstimates";
                    IF link_count + session_count + estimate_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade AddReservationManagementAccess: % link(s), % session(s) and % estimated arrival(s) exist; dropping them would destroy a guest''s access and what they told us. Stop issuing links and clear them deliberately before downgrading.', link_count, session_count, estimate_count;
                    END IF;
                END $$;
                """);

            migrationBuilder.DropTable(
                name: "ReservationArrivalEstimates");

            migrationBuilder.DropTable(
                name: "ReservationManagementSessions");

            migrationBuilder.DropTable(
                name: "ReservationManagementLinks");
        }
    }
}
