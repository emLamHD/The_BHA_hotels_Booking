using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationFolio : Migration
    {
        // BHA-CHECKOUT-001-PR02. One function, two triggers. UPDATE and DELETE are refused outright (append-only, also outside EF). An INSERT must belong to a VND Reservation and a reference must have
        // the kind its entry needs; a missing Reservation or reference is left to the foreign keys, so those keep reporting 23503. TRUNCATE is not row-level and is not blocked (test reset and an
        // operator with table ownership can still empty the table): the guarantee is "no row is changed or removed by a statement that targets rows".
        private const string CreateGuardFunctionSql =
            """
            CREATE FUNCTION thebha_folio_entries_guard() RETURNS trigger AS $$
            DECLARE
                reservation_currency text;
                reference_kind text;
                required_kind text;
            BEGIN
                IF TG_OP <> 'INSERT' THEN
                    RAISE EXCEPTION 'thebha_folio_append_only: FolioEntries is append-only, % is not allowed; post a new entry instead', TG_OP
                        USING ERRCODE = 'XBHA5';
                END IF;

                SELECT r."CurrencyCode" INTO reservation_currency
                FROM "Reservations" r
                WHERE r."Id" = NEW."ReservationId" AND r."PropertyId" = NEW."PropertyId";
                IF FOUND AND reservation_currency <> 'VND' THEN
                    RAISE EXCEPTION 'thebha_folio_currency: Reservation % is in %, only a VND Reservation has a folio', NEW."ReservationId", reservation_currency
                        USING ERRCODE = 'XBHA6';
                END IF;

                IF NEW."ReferenceEntryId" IS NOT NULL THEN
                    required_kind := CASE WHEN NEW."Kind" = 'RoomChargeReversal' THEN 'RoomCharge' ELSE 'Payment' END;
                    SELECT e."Kind" INTO reference_kind
                    FROM "FolioEntries" e
                    WHERE e."Id" = NEW."ReferenceEntryId" AND e."ReservationId" = NEW."ReservationId";
                    IF FOUND AND reference_kind <> required_kind THEN
                        RAISE EXCEPTION 'thebha_folio_reference_kind: % cannot reference an entry of kind %', NEW."Kind", reference_kind
                            USING ERRCODE = 'XBHA7';
                    END IF;
                END IF;

                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FolioEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    CurrencyCode = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    PostingKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ReferenceEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorKind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    ActorStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RecordedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FolioEntries", x => x.Id);
                    table.UniqueConstraint("AK_FolioEntries_ReservationId_Id", x => new { x.ReservationId, x.Id });
                    table.CheckConstraint("CK_FolioEntries_Actor", "\"ActorKind\" IN ('System', 'Staff', 'Public', 'Gateway') AND (\"ActorKind\" = 'Staff') = (\"ActorStaffId\" IS NOT NULL)");
                    table.CheckConstraint("CK_FolioEntries_Amount", "\"Amount\" > 0");
                    table.CheckConstraint("CK_FolioEntries_Currency", "\"CurrencyCode\" = 'VND'");
                    table.CheckConstraint("CK_FolioEntries_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReservationId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"ReferenceEntryId\" IS DISTINCT FROM \"Id\"");
                    table.CheckConstraint("CK_FolioEntries_Kind", "\"Kind\" IN ('RoomCharge', 'RoomChargeReversal', 'Payment', 'Refund', 'GatewayFee')");
                    table.CheckConstraint("CK_FolioEntries_PostingKey", "btrim(\"PostingKey\") <> ''");
                    table.CheckConstraint("CK_FolioEntries_Reason", "(\"Reason\" IS NULL OR btrim(\"Reason\") <> '') AND (\"Kind\" NOT IN ('RoomChargeReversal', 'Refund') OR \"Reason\" IS NOT NULL)");
                    table.CheckConstraint("CK_FolioEntries_Reference", "(\"Kind\" IN ('RoomChargeReversal', 'Refund', 'GatewayFee')) = (\"ReferenceEntryId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_FolioEntries_FolioEntries_ReservationId_ReferenceEntryId",
                        columns: x => new { x.ReservationId, x.ReferenceEntryId },
                        principalTable: "FolioEntries",
                        principalColumns: new[] { "ReservationId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FolioEntries_Reservations_PropertyId_ReservationId",
                        columns: x => new { x.PropertyId, x.ReservationId },
                        principalTable: "Reservations",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FolioEntries_StaffAccounts_ActorStaffId",
                        column: x => x.ActorStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FolioEntries_ActorStaffId",
                table: "FolioEntries",
                column: "ActorStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_FolioEntries_PropertyId_ReservationId",
                table: "FolioEntries",
                columns: new[] { "PropertyId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_FolioEntries_ReservationId_PostingKey",
                table: "FolioEntries",
                columns: new[] { "ReservationId", "PostingKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FolioEntries_ReservationId_ReferenceEntryId",
                table: "FolioEntries",
                columns: new[] { "ReservationId", "ReferenceEntryId" });

            migrationBuilder.Sql(CreateGuardFunctionSql);
            migrationBuilder.Sql(
                """
                CREATE TRIGGER trg_folio_entries_append_only
                    BEFORE UPDATE OR DELETE ON "FolioEntries"
                    FOR EACH ROW EXECUTE FUNCTION thebha_folio_entries_guard();
                """);
            migrationBuilder.Sql(
                """
                CREATE TRIGGER trg_folio_entries_insert_guard
                    BEFORE INSERT ON "FolioEntries"
                    FOR EACH ROW EXECUTE FUNCTION thebha_folio_entries_guard();
                """);
        }

        /// <summary>
        /// Refuses, before anything is dropped, while the ledger holds a row: money records have no place in the previous schema and a downgrade must never delete them. The table is locked first
        /// (ACCESS EXCLUSIVE ... NOWAIT, in this migration's transaction and held to its end), because the count only sees committed rows and the DROP would otherwise wait for a writer that is still open and
        /// then delete what it commits: Down fails at once (55P03) while any writer or reader is active, and a Down that gets the lock reads the final state. Nothing else is touched.
        /// </summary>
        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("LOCK TABLE \"FolioEntries\" IN ACCESS EXCLUSIVE MODE NOWAIT;");

            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    row_count bigint;
                BEGIN
                    SELECT COUNT(*) INTO row_count FROM "FolioEntries";
                    IF row_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade AddReservationFolio: % FolioEntries row(s) exist and the previous schema has no place for them. Remove or archive this data before downgrading.', row_count;
                    END IF;
                END $$;
                """);

            migrationBuilder.DropTable(
                name: "FolioEntries");

            migrationBuilder.Sql("DROP FUNCTION thebha_folio_entries_guard();");
        }
    }
}
