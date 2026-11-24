using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDirectReservationCreationRequests : Migration
    {
        // BHA-CHECKOUT-001-PR05. Additive: one new table. Nothing existing is read, backfilled or changed, and no Reservation, folio entry or event of the past is touched.
        // Down: the table is locked first (ACCESS EXCLUSIVE ... NOWAIT, held to the end of the migration's transaction) so the count sees the final state and an open writer makes Down fail at once (55P03).
        // It then REFUSES while any row exists: a row is what makes a guest's retry return the Reservation it already made, and dropping it would let a late retry create a second one.
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReservationCreationRequests",
                columns: table => new
                {
                    ScopeHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    KeyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestFingerprint = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationCreationRequests", x => new { x.ScopeHash, x.KeyHash });
                    table.CheckConstraint("CK_ReservationCreationRequests_Hashes", "\"ScopeHash\" ~ '^[0-9a-f]{64}$' AND \"KeyHash\" ~ '^[0-9a-f]{64}$' AND \"RequestFingerprint\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_ReservationCreationRequests_Ids", "\"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.ForeignKey(
                        name: "FK_ReservationCreationRequests_Reservations_PropertyId_Reserva~",
                        columns: x => new { x.PropertyId, x.ReservationId },
                        principalTable: "Reservations",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationCreationRequests_PropertyId_ReservationId",
                table: "ReservationCreationRequests",
                columns: new[] { "PropertyId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationCreationRequests_ReservationId",
                table: "ReservationCreationRequests",
                column: "ReservationId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("LOCK TABLE \"ReservationCreationRequests\" IN ACCESS EXCLUSIVE MODE NOWAIT;");

            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    request_count bigint;
                BEGIN
                    SELECT COUNT(*) INTO request_count FROM "ReservationCreationRequests";
                    IF request_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade AddDirectReservationCreationRequests: % Direct reservation request(s) exist; dropping them would let a late retry create a second reservation. Stop accepting new reservations and clear them deliberately before downgrading.', request_count;
                    END IF;
                END $$;
                """);

            migrationBuilder.DropTable(
                name: "ReservationCreationRequests");
        }
    }
}
