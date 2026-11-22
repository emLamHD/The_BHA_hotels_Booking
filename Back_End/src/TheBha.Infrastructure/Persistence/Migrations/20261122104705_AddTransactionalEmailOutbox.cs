using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTransactionalEmailOutbox : Migration
    {
        // BHA-CHECKOUT-001-PR03. Only two new tables with their indexes and constraints, and one row trigger. Nothing existing is read, backfilled or changed. The trigger is what makes "the same message on every
        // attempt" a database guarantee, not only a habit of the dispatcher: once a delivery exists its identity columns never change, the protected recipient and message may only be erased (after the provider accepted
        // the mail), the account and sender pinned at the first attempt never change, and an Accepted or Failed delivery never leaves that state.
        private const string CreateFrozenFunctionSql =
            """
            CREATE FUNCTION thebha_email_outbox_deliveries_frozen() RETURNS trigger AS $$
            BEGIN
                IF NEW."Id" <> OLD."Id" OR NEW."EventId" <> OLD."EventId" OR NEW."PropertyId" <> OLD."PropertyId" OR NEW."Purpose" <> OLD."Purpose"
                   OR NEW."RecipientKey" <> OLD."RecipientKey" OR NEW."TemplateKey" <> OLD."TemplateKey" OR NEW."Locale" <> OLD."Locale" OR NEW."CreatedAtUtc" <> OLD."CreatedAtUtc" THEN
                    RAISE EXCEPTION 'thebha_email_outbox_frozen: the identity of a delivery never changes' USING ERRCODE = 'XBHA8';
                END IF;

                IF (OLD."ProtectedRecipient" IS NOT NULL AND NEW."ProtectedRecipient" IS NOT NULL AND NEW."ProtectedRecipient" <> OLD."ProtectedRecipient")
                   OR (OLD."ProtectedMessage" IS NOT NULL AND NEW."ProtectedMessage" IS NOT NULL AND NEW."ProtectedMessage" <> OLD."ProtectedMessage")
                   OR (OLD."ProtectedRecipient" IS NULL AND NEW."ProtectedRecipient" IS NOT NULL) OR (OLD."ProtectedMessage" IS NULL AND NEW."ProtectedMessage" IS NOT NULL) THEN
                    RAISE EXCEPTION 'thebha_email_outbox_frozen: the recipient and the message of a delivery are fixed once written; they can only be erased' USING ERRCODE = 'XBHA8';
                END IF;

                IF OLD."FirstAttemptAtUtc" IS NOT NULL AND (NEW."FirstAttemptAtUtc" IS DISTINCT FROM OLD."FirstAttemptAtUtc" OR NEW."PinnedFingerprint" IS DISTINCT FROM OLD."PinnedFingerprint"
                   OR NEW."PinnedFrom" IS DISTINCT FROM OLD."PinnedFrom") THEN
                    RAISE EXCEPTION 'thebha_email_outbox_frozen: the first attempt, the account and the sender are pinned once' USING ERRCODE = 'XBHA8';
                END IF;

                IF OLD."Status" IN ('Accepted', 'Failed') AND NEW."Status" <> OLD."Status" THEN
                    RAISE EXCEPTION 'thebha_email_outbox_frozen: a % delivery is final', OLD."Status" USING ERRCODE = 'XBHA8';
                END IF;

                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailOutboxEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SchemaVersion = table.Column<int>(type: "integer", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FanoutAttempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastOutcome = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailOutboxEvents", x => x.Id);
                    table.UniqueConstraint("AK_EmailOutboxEvents_PropertyId_Id", x => new { x.PropertyId, x.Id });
                    table.CheckConstraint("CK_EmailOutboxEvents_Attempts", "\"FanoutAttempts\" >= 0");
                    table.CheckConstraint("CK_EmailOutboxEvents_Completed", "(\"Status\" = 'Completed') = (\"CompletedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_EmailOutboxEvents_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_EmailOutboxEvents_Payload", "jsonb_typeof(\"Payload\") = 'object' AND octet_length(\"Payload\"::text) <= 4096");
                    table.CheckConstraint("CK_EmailOutboxEvents_Status", "\"Status\" IN ('Pending', 'Completed', 'Failed')");
                    table.CheckConstraint("CK_EmailOutboxEvents_Type", "btrim(\"EventType\") <> ''");
                    table.CheckConstraint("CK_EmailOutboxEvents_Version", "\"SchemaVersion\" > 0");
                    table.ForeignKey(
                        name: "FK_EmailOutboxEvents_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "EmailOutboxDeliveries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Purpose = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    RecipientKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TemplateKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Locale = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ProtectedRecipient = table.Column<string>(type: "text", nullable: true),
                    ProtectedMessage = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LeaseUntilUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ClaimId = table.Column<Guid>(type: "uuid", nullable: true),
                    FirstAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PinnedFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    PinnedFrom = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    UncertainSend = table.Column<bool>(type: "boolean", nullable: false),
                    ProviderMessageId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    AcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastOutcome = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailOutboxDeliveries", x => x.Id);
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Accepted", "(\"Status\" = 'Accepted') = (\"AcceptedAtUtc\" IS NOT NULL) AND (\"Status\" <> 'Accepted' OR \"ProviderMessageId\" IS NOT NULL)");
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Attempts", "\"Attempts\" >= 0");
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Claim", "(\"Status\" = 'Sending') = (\"ClaimId\" IS NOT NULL) AND (\"ClaimId\" IS NULL) = (\"LeaseUntilUtc\" IS NULL)");
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Ids", "\"Id\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"EventId\" <> '00000000-0000-0000-0000-000000000000'::uuid AND \"PropertyId\" <> '00000000-0000-0000-0000-000000000000'::uuid");
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Payload", "(\"Status\" NOT IN ('Pending', 'Sending') OR (\"ProtectedRecipient\" IS NOT NULL AND \"ProtectedMessage\" IS NOT NULL)) AND (\"Status\" <> 'Accepted' OR (\"ProtectedRecipient\" IS NULL AND \"ProtectedMessage\" IS NULL))");
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Pin", "(\"FirstAttemptAtUtc\" IS NULL) = (\"PinnedFingerprint\" IS NULL) AND (\"PinnedFingerprint\" IS NULL) = (\"PinnedFrom\" IS NULL)");
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Status", "\"Status\" IN ('Pending', 'Sending', 'Accepted', 'Failed', 'NeedsReconciliation')");
                    table.CheckConstraint("CK_EmailOutboxDeliveries_Text", "btrim(\"Purpose\") <> '' AND btrim(\"RecipientKey\") <> '' AND btrim(\"TemplateKey\") <> '' AND btrim(\"Locale\") <> ''");
                    table.ForeignKey(
                        name: "FK_EmailOutboxDeliveries_EmailOutboxEvents_PropertyId_EventId",
                        columns: x => new { x.PropertyId, x.EventId },
                        principalTable: "EmailOutboxEvents",
                        principalColumns: new[] { "PropertyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailOutboxDeliveries_EventId_Purpose_RecipientKey",
                table: "EmailOutboxDeliveries",
                columns: new[] { "EventId", "Purpose", "RecipientKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmailOutboxDeliveries_Failures",
                table: "EmailOutboxDeliveries",
                columns: new[] { "PropertyId", "CreatedAtUtc" },
                filter: "\"Status\" IN ('Failed', 'NeedsReconciliation')");

            migrationBuilder.CreateIndex(
                name: "IX_EmailOutboxDeliveries_Lease",
                table: "EmailOutboxDeliveries",
                column: "LeaseUntilUtc",
                filter: "\"Status\" = 'Sending'");

            migrationBuilder.CreateIndex(
                name: "IX_EmailOutboxDeliveries_Pending",
                table: "EmailOutboxDeliveries",
                columns: new[] { "NextAttemptAtUtc", "Id" },
                filter: "\"Status\" = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_EmailOutboxDeliveries_PropertyId_EventId",
                table: "EmailOutboxDeliveries",
                columns: new[] { "PropertyId", "EventId" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailOutboxEvents_Due",
                table: "EmailOutboxEvents",
                columns: new[] { "NextAttemptAtUtc", "CreatedAtUtc", "Id" },
                filter: "\"Status\" = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_EmailOutboxEvents_Failed",
                table: "EmailOutboxEvents",
                columns: new[] { "PropertyId", "CreatedAtUtc" },
                filter: "\"Status\" = 'Failed'");

            migrationBuilder.Sql(CreateFrozenFunctionSql);
            migrationBuilder.Sql(
                """
                CREATE TRIGGER trg_email_outbox_deliveries_frozen
                    BEFORE UPDATE ON "EmailOutboxDeliveries"
                    FOR EACH ROW EXECUTE FUNCTION thebha_email_outbox_deliveries_frozen();
                """);
        }

        /// <summary>
        /// Refuses, before anything is dropped, while either table holds a row: a queued mail is a customer notification that the previous schema has no place for, and a downgrade must never delete it. Both tables are
        /// locked first (ACCESS EXCLUSIVE ... NOWAIT, held to the end of the migration's transaction) so the count sees the final state and an open writer makes Down fail at once (55P03).
        /// </summary>
        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("LOCK TABLE \"EmailOutboxEvents\", \"EmailOutboxDeliveries\" IN ACCESS EXCLUSIVE MODE NOWAIT;");

            migrationBuilder.Sql(
                """
                DO $$
                DECLARE
                    event_count bigint;
                    delivery_count bigint;
                BEGIN
                    SELECT COUNT(*) INTO event_count FROM "EmailOutboxEvents";
                    SELECT COUNT(*) INTO delivery_count FROM "EmailOutboxDeliveries";
                    IF event_count > 0 OR delivery_count > 0 THEN
                        RAISE EXCEPTION 'Cannot downgrade AddTransactionalEmailOutbox: % event(s) and % delivery row(s) exist and the previous schema has no place for them. Drain or archive the queue before downgrading.', event_count, delivery_count;
                    END IF;
                END $$;
                """);

            migrationBuilder.DropTable(
                name: "EmailOutboxDeliveries");

            migrationBuilder.DropTable(
                name: "EmailOutboxEvents");

            migrationBuilder.Sql("DROP FUNCTION thebha_email_outbox_deliveries_frozen();");
        }
    }
}
