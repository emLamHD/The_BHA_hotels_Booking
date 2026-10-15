using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRuntimeLanguagePacks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_WebsiteTranslations_Key",
                table: "WebsiteTranslations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WebsiteTranslations_Value",
                table: "WebsiteTranslations");

            migrationBuilder.AlterColumn<string>(
                name: "Value",
                table: "WebsiteTranslations",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000);

            migrationBuilder.AddColumn<bool>(
                name: "IsManual",
                table: "WebsiteTranslations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "SourceHash",
                table: "WebsiteTranslations",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DefaultCurrencyCode",
                table: "WebsiteLanguages",
                type: "character(3)",
                fixedLength: true,
                maxLength: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Direction",
                table: "WebsiteLanguages",
                type: "character varying(3)",
                maxLength: 3,
                nullable: false,
                defaultValue: "ltr");

            migrationBuilder.AddColumn<string>(
                name: "FormatLocale",
                table: "WebsiteLanguages",
                type: "character varying(35)",
                maxLength: 35,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PackId",
                table: "WebsiteLanguages",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PackVersion",
                table: "WebsiteLanguages",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            // ---- data: the languages get their format locale and default currency; the 24 managed texts of migration 10
            // move into the namespaced key scheme (customer.*, shared.*); the demo note about a language selector that
            // did nothing is retired. Texts are not seeded here: a language arrives as a pack, through the Admin.
            migrationBuilder.Sql("UPDATE \"WebsiteLanguages\" SET \"FormatLocale\" = \"Code\";");
            migrationBuilder.Sql("UPDATE \"WebsiteLanguages\" SET \"FormatLocale\" = 'vi-VN', \"DefaultCurrencyCode\" = 'VND' WHERE \"NormalizedCode\" = 'vi';");
            migrationBuilder.Sql("UPDATE \"WebsiteLanguages\" SET \"FormatLocale\" = 'en-US', \"DefaultCurrencyCode\" = 'USD' WHERE \"NormalizedCode\" = 'en';");
            migrationBuilder.Sql("DELETE FROM \"WebsiteTranslations\" WHERE \"Key\" = 'header.note.languageCurrencyDemo';");
            migrationBuilder.Sql("UPDATE \"WebsiteTranslations\" SET \"Key\" = 'customer.' || \"Key\" WHERE \"Key\" LIKE 'header.%';");
            migrationBuilder.Sql("UPDATE \"WebsiteTranslations\" SET \"Key\" = 'shared.' || \"Key\" WHERE \"Key\" LIKE 'common.%';");
            // The updates above queue the deferred "exactly one default" trigger on WebsiteLanguages; run it now, or the CREATE INDEX below cannot run in this transaction.
            migrationBuilder.Sql("SET CONSTRAINTS ALL IMMEDIATE;");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WebsiteTranslations_Key",
                table: "WebsiteTranslations",
                sql: "\"Key\" ~ '^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9][a-zA-Z0-9_-]*)+$'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WebsiteTranslations_Value",
                table: "WebsiteTranslations",
                sql: "btrim(\"Value\") <> '' AND char_length(\"Value\") <= 4000");

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteLanguages_DefaultCurrencyCode",
                table: "WebsiteLanguages",
                column: "DefaultCurrencyCode");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WebsiteLanguages_Direction",
                table: "WebsiteLanguages",
                sql: "\"Direction\" IN ('ltr', 'rtl')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WebsiteLanguages_FormatLocale",
                table: "WebsiteLanguages",
                sql: "btrim(\"FormatLocale\") <> ''");

            migrationBuilder.AddForeignKey(
                name: "FK_WebsiteLanguages_WebsiteCurrencies_DefaultCurrencyCode",
                table: "WebsiteLanguages",
                column: "DefaultCurrencyCode",
                principalTable: "WebsiteCurrencies",
                principalColumn: "Code",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuses, before touching anything, while any language was installed from a pack or any text was edited or added
            // beyond what migration 10 seeded: those are administered data this rollback cannot restore.
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM "WebsiteLanguages" WHERE "PackId" IS NOT NULL OR "NormalizedCode" NOT IN ('vi', 'en'))
                       OR EXISTS (SELECT 1 FROM "WebsiteTranslations" WHERE "IsManual" OR "Key" LIKE 'content.%' OR char_length("Value") > 1000 OR "Version" <> 1)
                       OR (SELECT count(*) FROM "WebsiteTranslations") > 48 THEN
                        RAISE EXCEPTION 'Refusing to drop installed language packs or administered translations.';
                    END IF;
                END
                $$;
                """);
            migrationBuilder.Sql("UPDATE \"WebsiteTranslations\" SET \"Key\" = substr(\"Key\", 10) WHERE \"Key\" LIKE 'customer.header.%';");
            migrationBuilder.Sql("UPDATE \"WebsiteTranslations\" SET \"Key\" = substr(\"Key\", 8) WHERE \"Key\" LIKE 'shared.common.%';");
            migrationBuilder.Sql("DELETE FROM \"WebsiteTranslations\" WHERE \"Key\" LIKE 'customer.%' OR \"Key\" LIKE 'shared.%' OR \"Key\" LIKE 'admin.%';");

            migrationBuilder.DropForeignKey(
                name: "FK_WebsiteLanguages_WebsiteCurrencies_DefaultCurrencyCode",
                table: "WebsiteLanguages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WebsiteTranslations_Key",
                table: "WebsiteTranslations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WebsiteTranslations_Value",
                table: "WebsiteTranslations");

            migrationBuilder.DropIndex(
                name: "IX_WebsiteLanguages_DefaultCurrencyCode",
                table: "WebsiteLanguages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WebsiteLanguages_Direction",
                table: "WebsiteLanguages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WebsiteLanguages_FormatLocale",
                table: "WebsiteLanguages");

            migrationBuilder.DropColumn(
                name: "IsManual",
                table: "WebsiteTranslations");

            migrationBuilder.DropColumn(
                name: "SourceHash",
                table: "WebsiteTranslations");

            migrationBuilder.DropColumn(
                name: "DefaultCurrencyCode",
                table: "WebsiteLanguages");

            migrationBuilder.DropColumn(
                name: "Direction",
                table: "WebsiteLanguages");

            migrationBuilder.DropColumn(
                name: "FormatLocale",
                table: "WebsiteLanguages");

            migrationBuilder.DropColumn(
                name: "PackId",
                table: "WebsiteLanguages");

            migrationBuilder.DropColumn(
                name: "PackVersion",
                table: "WebsiteLanguages");

            migrationBuilder.AlterColumn<string>(
                name: "Value",
                table: "WebsiteTranslations",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(4000)",
                oldMaxLength: 4000);

            migrationBuilder.AddCheckConstraint(
                name: "CK_WebsiteTranslations_Key",
                table: "WebsiteTranslations",
                sql: "\"Key\" ~ '^[a-z][a-zA-Z0-9]*(\\.[a-z][a-zA-Z0-9]*)+$'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WebsiteTranslations_Value",
                table: "WebsiteTranslations",
                sql: "btrim(\"Value\") <> '' AND char_length(\"Value\") <= 1000");
        }
    }
}
