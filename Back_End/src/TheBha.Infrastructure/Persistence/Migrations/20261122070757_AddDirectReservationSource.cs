using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDirectReservationSource : Migration
    {
        /// <summary>
        /// BHA-CHECKOUT-001-PR01. Additive for old data and old writers: every existing Reservation gets Source = 'Hold' (also the default, so a writer
        /// built before this migration keeps inserting valid rows); every existing promotion snapshot keeps all its data and gets Id = its HoldId (the
        /// default gen_random_uuid() covers an old writer that omits Id). Nothing is rewritten except the new Id column.
        /// </summary>
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "SourceHoldId",
                table: "Reservations",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "Reservations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Hold");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservations_Source",
                table: "Reservations",
                sql: "(\"Source\" = 'Hold' AND \"SourceHoldId\" IS NOT NULL) OR (\"Source\" = 'Direct' AND \"SourceHoldId\" IS NULL)");

            // Re-key BookingPromotionApplications from HoldId to a surrogate Id without losing a row.
            migrationBuilder.AddColumn<Guid>(
                name: "Id",
                table: "BookingPromotionApplications",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("UPDATE \"BookingPromotionApplications\" SET \"Id\" = \"HoldId\";");

            migrationBuilder.AlterColumn<Guid>(
                name: "Id",
                table: "BookingPromotionApplications",
                type: "uuid",
                nullable: false,
                defaultValueSql: "gen_random_uuid()",
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.DropPrimaryKey(
                name: "PK_BookingPromotionApplications",
                table: "BookingPromotionApplications");

            migrationBuilder.AddPrimaryKey(
                name: "PK_BookingPromotionApplications",
                table: "BookingPromotionApplications",
                column: "Id");

            migrationBuilder.AlterColumn<Guid>(
                name: "HoldId",
                table: "BookingPromotionApplications",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.CreateIndex(
                name: "IX_BookingPromotionApplications_HoldId",
                table: "BookingPromotionApplications",
                column: "HoldId",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_BookingPromotionApplications_Source",
                table: "BookingPromotionApplications",
                sql: "\"HoldId\" IS NOT NULL OR \"ReservationId\" IS NOT NULL");
        }

        /// <summary>
        /// Refuses (before touching anything) while a Direct Reservation or a Hold-less promotion snapshot exists: the previous schema has no place for them.
        /// A Hold-only database downgrades with all its data; BookingPromotionApplications keeps HoldId as the key (the surrogate Id is dropped).
        /// </summary>
        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    row_count bigint;
                BEGIN
                    SELECT COUNT(*) INTO row_count FROM "Reservations" WHERE "Source" = 'Direct';
                    IF row_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade AddDirectReservationSource: % Direct Reservation row(s) have no source Hold and the previous schema requires one. Remove or archive this data before downgrading.', row_count;
                    END IF;

                    SELECT COUNT(*) INTO row_count FROM "BookingPromotionApplications" WHERE "HoldId" IS NULL;
                    IF row_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade AddDirectReservationSource: % BookingPromotionApplications row(s) have no HoldId and the previous schema keys on it. Remove or archive this data before downgrading.', row_count;
                    END IF;
                END $$;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_BookingPromotionApplications_Source",
                table: "BookingPromotionApplications");

            migrationBuilder.DropIndex(
                name: "IX_BookingPromotionApplications_HoldId",
                table: "BookingPromotionApplications");

            migrationBuilder.DropPrimaryKey(
                name: "PK_BookingPromotionApplications",
                table: "BookingPromotionApplications");

            migrationBuilder.DropColumn(
                name: "Id",
                table: "BookingPromotionApplications");

            migrationBuilder.AlterColumn<Guid>(
                name: "HoldId",
                table: "BookingPromotionApplications",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_BookingPromotionApplications",
                table: "BookingPromotionApplications",
                column: "HoldId");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservations_Source",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "Reservations");

            migrationBuilder.AlterColumn<Guid>(
                name: "SourceHoldId",
                table: "Reservations",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
