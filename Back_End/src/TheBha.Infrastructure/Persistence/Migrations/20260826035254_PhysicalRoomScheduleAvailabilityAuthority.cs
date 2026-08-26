using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// Physical Room Schedule &amp; Availability Authority (PMS-BE-001.2, ADR 0006):
    /// introduces RoomBlock/RoomOccupancySegment/RoomOccupancySegmentAudit, the two
    /// PostgreSQL exclusion invariants (§11 items 1-2), and two deferrable constraint
    /// triggers enforcing the booked-night coverage invariant (Decision item 9) and the
    /// unit-commitment consistency invariant (Decision item 3's third rule, extended to
    /// the Reservation-level rule in blueprint §7 rule 28). Same-Property reference
    /// consistency (Decision item 3's first rule) is enforced by ordinary property-scoped
    /// composite foreign keys, not a trigger. Adds the required (PropertyId, Id) alternate
    /// key to PhysicalRooms without touching its existing Property/RoomType relationship.
    /// </summary>
    public partial class PhysicalRoomScheduleAvailabilityAuthority : Migration
    {
        private const string CreateBookedNightCoverageFunctionSql =
            """
            CREATE FUNCTION thebha_check_booked_night_coverage() RETURNS trigger AS $$
            DECLARE
                affected_unit_id uuid;
                bad_date date;
            BEGIN
                IF TG_TABLE_NAME = 'RoomOccupancySegments' THEN
                    affected_unit_id := COALESCE(NEW."ReservationUnitId", OLD."ReservationUnitId");
                ELSIF TG_TABLE_NAME = 'ReservationUnitNights' THEN
                    -- ReservationUnitNight.ReservationUnitId is immutable commercial
                    -- evidence (it participates in the row's primary key together with
                    -- StayDate): no approved operation transfers a booked night between
                    -- ReservationUnits. Reject the transfer outright rather than
                    -- re-validating coverage for only one of the two affected Units.
                    IF TG_OP = 'UPDATE' AND OLD."ReservationUnitId" IS DISTINCT FROM NEW."ReservationUnitId" THEN
                        RAISE EXCEPTION
                            'thebha_booked_night_coverage_violation: ReservationUnitNight (%, %) cannot change ReservationUnitId from % to % — ownership is immutable',
                            OLD."ReservationUnitId", OLD."StayDate", OLD."ReservationUnitId", NEW."ReservationUnitId"
                            USING ERRCODE = 'XBHA1';
                    END IF;
                    affected_unit_id := COALESCE(NEW."ReservationUnitId", OLD."ReservationUnitId");
                END IF;

                IF affected_unit_id IS NULL THEN
                    RETURN NULL;
                END IF;

                SELECT d::date INTO bad_date
                FROM "RoomOccupancySegments" s
                CROSS JOIN LATERAL generate_series(
                    s."StartDate"::timestamp,
                    (s."EndDate" - 1)::timestamp,
                    interval '1 day'
                ) AS d
                WHERE s."ReservationUnitId" = affected_unit_id
                    AND s."Type" = 'ReservationAssignment'
                    AND s."Status" = 'Effective'
                    AND NOT EXISTS (
                        SELECT 1 FROM "ReservationUnitNights" n
                        WHERE n."ReservationUnitId" = affected_unit_id
                            AND n."StayDate" = d::date
                    )
                LIMIT 1;

                IF bad_date IS NOT NULL THEN
                    RAISE EXCEPTION
                        'thebha_booked_night_coverage_violation: ReservationUnit % has an Effective assignment segment covering % with no ReservationUnitNight row',
                        affected_unit_id, bad_date
                        USING ERRCODE = 'XBHA1';
                END IF;

                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
            """;

        private const string CreateUnitCommitmentConsistencyFunctionSql =
            """
            CREATE FUNCTION thebha_check_unit_commitment_consistency() RETURNS trigger AS $$
            DECLARE
                affected_unit_id uuid;
                affected_reservation_id uuid;
                violating_segment_id uuid;
                violating_unit_id uuid;
            BEGIN
                IF TG_TABLE_NAME = 'RoomOccupancySegments' THEN
                    affected_unit_id := COALESCE(NEW."ReservationUnitId", OLD."ReservationUnitId");
                    IF affected_unit_id IS NOT NULL THEN
                        SELECT "ReservationId" INTO affected_reservation_id
                        FROM "ReservationUnits" WHERE "Id" = affected_unit_id;
                    END IF;
                ELSIF TG_TABLE_NAME = 'ReservationUnits' THEN
                    affected_unit_id := COALESCE(NEW."Id", OLD."Id");
                    affected_reservation_id := COALESCE(NEW."ReservationId", OLD."ReservationId");
                ELSIF TG_TABLE_NAME = 'Reservations' THEN
                    affected_reservation_id := COALESCE(NEW."Id", OLD."Id");
                END IF;

                IF affected_unit_id IS NOT NULL THEN
                    SELECT s."Id" INTO violating_segment_id
                    FROM "RoomOccupancySegments" s
                    JOIN "ReservationUnits" u ON u."Id" = s."ReservationUnitId"
                    WHERE s."ReservationUnitId" = affected_unit_id
                        AND s."Type" = 'ReservationAssignment'
                        AND s."Status" = 'Effective'
                        AND u."CommitmentStatus" <> 'Committed'
                    LIMIT 1;

                    IF violating_segment_id IS NOT NULL THEN
                        RAISE EXCEPTION
                            'thebha_unit_commitment_consistency_violation: RoomOccupancySegment % is Effective but references a non-Committed ReservationUnit %',
                            violating_segment_id, affected_unit_id
                            USING ERRCODE = 'XBHA2';
                    END IF;
                END IF;

                IF affected_reservation_id IS NOT NULL THEN
                    SELECT u."Id" INTO violating_unit_id
                    FROM "ReservationUnits" u
                    JOIN "Reservations" r ON r."Id" = u."ReservationId"
                    WHERE u."ReservationId" = affected_reservation_id
                        AND r."Status" = 'Cancelled'
                        AND u."CommitmentStatus" = 'Committed'
                    LIMIT 1;

                    IF violating_unit_id IS NOT NULL THEN
                        RAISE EXCEPTION
                            'thebha_unit_commitment_consistency_violation: Reservation % is Cancelled but ReservationUnit % remains Committed',
                            affected_reservation_id, violating_unit_id
                            USING ERRCODE = 'XBHA2';
                    END IF;
                END IF;

                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_PhysicalRooms_PropertyId_Id",
                table: "PhysicalRooms",
                columns: new[] { "PropertyId", "Id" });

            migrationBuilder.CreateTable(
                name: "RoomBlocks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedByActorReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoomBlocks", x => x.Id);
                    table.UniqueConstraint("AK_RoomBlocks_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_RoomBlocks_CreatedByActorReference", "btrim(\"CreatedByActorReference\") <> ''");
                    table.CheckConstraint("CK_RoomBlocks_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_RoomBlocks_Reason", "btrim(\"Reason\") <> ''");
                    table.ForeignKey(
                        name: "FK_RoomBlocks_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RoomOccupancySegments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    PhysicalRoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ReservationUnitId = table.Column<Guid>(type: "uuid", nullable: true),
                    RoomBlockId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoomOccupancySegments", x => x.Id);
                    table.UniqueConstraint("AK_RoomOccupancySegments_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_RoomOccupancySegments_DateRange", "\"StartDate\" < \"EndDate\"");
                    table.CheckConstraint("CK_RoomOccupancySegments_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PhysicalRoomId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND (\"ReservationUnitId\" IS NULL OR \"ReservationUnitId\" <> '00000000-0000-0000-0000-000000000000'::uuid) AND (\"RoomBlockId\" IS NULL OR \"RoomBlockId\" <> '00000000-0000-0000-0000-000000000000'::uuid)");
                    table.CheckConstraint("CK_RoomOccupancySegments_Status", "\"Status\" IN ('Effective', 'Cancelled')");
                    table.CheckConstraint("CK_RoomOccupancySegments_Type", "\"Type\" IN ('ReservationAssignment', 'OperationalBlock')");
                    table.CheckConstraint("CK_RoomOccupancySegments_TypeReference", "(\"Type\" = 'ReservationAssignment' AND \"ReservationUnitId\" IS NOT NULL AND \"RoomBlockId\" IS NULL) OR (\"Type\" = 'OperationalBlock' AND \"RoomBlockId\" IS NOT NULL AND \"ReservationUnitId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_RoomOccupancySegments_PhysicalRooms_PropertyId_PhysicalRoom~",
                        columns: x => new { x.PropertyId, x.PhysicalRoomId },
                        principalTable: "PhysicalRooms",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RoomOccupancySegments_ReservationUnits_PropertyId_Reservati~",
                        columns: x => new { x.PropertyId, x.ReservationUnitId },
                        principalTable: "ReservationUnits",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RoomOccupancySegments_RoomBlocks_PropertyId_RoomBlockId",
                        columns: x => new { x.PropertyId, x.RoomBlockId },
                        principalTable: "RoomBlocks",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RoomOccupancySegmentAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    SegmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    MutationGroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ActorReference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    AuthorizationEvidence = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoomOccupancySegmentAudits", x => x.Id);
                    table.UniqueConstraint("AK_RoomOccupancySegmentAudits_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_RoomOccupancySegmentAudits_ActorReference", "btrim(\"ActorReference\") <> ''");
                    table.CheckConstraint("CK_RoomOccupancySegmentAudits_EventType", "\"EventType\" IN ('Created', 'Cancelled')");
                    table.CheckConstraint("CK_RoomOccupancySegmentAudits_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"SegmentId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"MutationGroupId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.ForeignKey(
                        name: "FK_RoomOccupancySegmentAudits_RoomOccupancySegments_PropertyId~",
                        columns: x => new { x.PropertyId, x.SegmentId },
                        principalTable: "RoomOccupancySegments",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RoomBlocks_PropertyId_CreatedAtUtc",
                table: "RoomBlocks",
                columns: new[] { "PropertyId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegmentAudits_MutationGroupId",
                table: "RoomOccupancySegmentAudits",
                column: "MutationGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegmentAudits_PropertyId_OccurredAtUtc",
                table: "RoomOccupancySegmentAudits",
                columns: new[] { "PropertyId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegmentAudits_PropertyId_SegmentId",
                table: "RoomOccupancySegmentAudits",
                columns: new[] { "PropertyId", "SegmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegmentAudits_SegmentId",
                table: "RoomOccupancySegmentAudits",
                column: "SegmentId");

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegments_PropertyId_PhysicalRoomId_Status",
                table: "RoomOccupancySegments",
                columns: new[] { "PropertyId", "PhysicalRoomId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegments_PropertyId_ReservationUnitId_Status",
                table: "RoomOccupancySegments",
                columns: new[] { "PropertyId", "ReservationUnitId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegments_PropertyId_RoomBlockId_Status",
                table: "RoomOccupancySegments",
                columns: new[] { "PropertyId", "RoomBlockId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_RoomOccupancySegments_PropertyId_Type_Status",
                table: "RoomOccupancySegments",
                columns: new[] { "PropertyId", "Type", "Status" });

            // ---- Exclusion invariants (blueprint §11, ADR 0006 Decision item 6) --------
            // Required only for these two approved EXCLUDE constraints' composite
            // range/equality GiST index (ADR 0006 §"Future EF/Npgsql implementation
            // boundary").
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS btree_gist;");

            migrationBuilder.Sql(
                """
                ALTER TABLE "RoomOccupancySegments"
                    ADD CONSTRAINT "EX_RoomOccupancySegments_EffectiveRoomOverlap"
                    EXCLUDE USING gist (
                        "PropertyId" WITH =,
                        "PhysicalRoomId" WITH =,
                        daterange("StartDate", "EndDate", '[)') WITH &&
                    )
                    WHERE ("Status" = 'Effective')
                    DEFERRABLE INITIALLY DEFERRED;
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE "RoomOccupancySegments"
                    ADD CONSTRAINT "EX_RoomOccupancySegments_EffectiveUnitOverlap"
                    EXCLUDE USING gist (
                        "PropertyId" WITH =,
                        "ReservationUnitId" WITH =,
                        daterange("StartDate", "EndDate", '[)') WITH &&
                    )
                    WHERE ("Status" = 'Effective' AND "Type" = 'ReservationAssignment')
                    DEFERRABLE INITIALLY DEFERRED;
                """);

            // ---- Booked-night coverage (ADR 0006 Decision item 9) -----------------------
            // A deferrable constraint trigger, since PostgreSQL has no ordinary CHECK
            // capable of expressing this cross-table rule; evaluated at commit time so it
            // observes both a segment write and any concurrent ReservationUnitNight change.
            migrationBuilder.Sql(CreateBookedNightCoverageFunctionSql);

            migrationBuilder.Sql(
                """
                CREATE CONSTRAINT TRIGGER trg_room_occupancy_segments_booked_night_coverage
                    AFTER INSERT OR UPDATE ON "RoomOccupancySegments"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW
                    EXECUTE FUNCTION thebha_check_booked_night_coverage();
                """);

            migrationBuilder.Sql(
                """
                CREATE CONSTRAINT TRIGGER trg_reservation_unit_nights_booked_night_coverage
                    AFTER INSERT OR UPDATE OR DELETE ON "ReservationUnitNights"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW
                    EXECUTE FUNCTION thebha_check_booked_night_coverage();
                """);

            // ---- Unit-commitment consistency (ADR 0006 Decision item 3's third rule,
            // blueprint §7 rule 28) -------------------------------------------------------
            migrationBuilder.Sql(CreateUnitCommitmentConsistencyFunctionSql);

            migrationBuilder.Sql(
                """
                CREATE CONSTRAINT TRIGGER trg_room_occupancy_segments_unit_commitment
                    AFTER INSERT OR UPDATE ON "RoomOccupancySegments"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW
                    EXECUTE FUNCTION thebha_check_unit_commitment_consistency();
                """);

            migrationBuilder.Sql(
                """
                CREATE CONSTRAINT TRIGGER trg_reservation_units_commitment_status
                    AFTER UPDATE ON "ReservationUnits"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW
                    WHEN (OLD."CommitmentStatus" IS DISTINCT FROM NEW."CommitmentStatus")
                    EXECUTE FUNCTION thebha_check_unit_commitment_consistency();
                """);

            migrationBuilder.Sql(
                """
                CREATE CONSTRAINT TRIGGER trg_reservations_status
                    AFTER UPDATE ON "Reservations"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW
                    WHEN (OLD."Status" IS DISTINCT FROM NEW."Status")
                    EXECUTE FUNCTION thebha_check_unit_commitment_consistency();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Migration 7's schema has no representation whatsoever for RoomBlock/
            // RoomOccupancySegment/RoomOccupancySegmentAudit data (these are new
            // concepts, not a reshaped legacy table) — fail atomically rather than
            // silently dropping non-empty history.
            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    row_count bigint;
                BEGIN
                    SELECT COUNT(*) INTO row_count FROM "RoomOccupancySegments";
                    IF row_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade PhysicalRoomScheduleAvailabilityAuthority: % RoomOccupancySegments row(s) exist and migration 7''s schema has no representation for them. Remove or archive this data before downgrading.', row_count;
                    END IF;

                    SELECT COUNT(*) INTO row_count FROM "RoomBlocks";
                    IF row_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade PhysicalRoomScheduleAvailabilityAuthority: % RoomBlocks row(s) exist and migration 7''s schema has no representation for them. Remove or archive this data before downgrading.', row_count;
                    END IF;

                    SELECT COUNT(*) INTO row_count FROM "RoomOccupancySegmentAudits";
                    IF row_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade PhysicalRoomScheduleAvailabilityAuthority: % RoomOccupancySegmentAudits row(s) exist and migration 7''s schema has no representation for them. Remove or archive this data before downgrading.', row_count;
                    END IF;
                END $$;
                """);

            // Drop the constraint triggers attached to tables that are not themselves
            // being dropped by this migration (dropping RoomOccupancySegments below
            // removes its own two constraint triggers and both EXCLUDE constraints
            // automatically). The two functions cannot be dropped until every trigger
            // referencing them — including RoomOccupancySegments' own two — is gone, so
            // function drops are deferred until after all four tables are dropped below.
            migrationBuilder.Sql(
                "DROP TRIGGER trg_reservation_unit_nights_booked_night_coverage ON \"ReservationUnitNights\";");
            migrationBuilder.Sql(
                "DROP TRIGGER trg_reservation_units_commitment_status ON \"ReservationUnits\";");
            migrationBuilder.Sql(
                "DROP TRIGGER trg_reservations_status ON \"Reservations\";");

            migrationBuilder.DropTable(
                name: "RoomOccupancySegmentAudits");

            migrationBuilder.DropTable(
                name: "RoomOccupancySegments");

            migrationBuilder.DropTable(
                name: "RoomBlocks");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_PhysicalRooms_PropertyId_Id",
                table: "PhysicalRooms");

            migrationBuilder.Sql("DROP FUNCTION thebha_check_booked_night_coverage();");
            migrationBuilder.Sql("DROP FUNCTION thebha_check_unit_commitment_consistency();");

            // btree_gist is intentionally never dropped here — it may be a pre-existing/
            // shared extension, and this migration must not remove it merely because it
            // is itself downgraded.
        }
    }
}
