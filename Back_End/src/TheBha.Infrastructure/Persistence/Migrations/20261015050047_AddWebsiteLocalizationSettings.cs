using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TheBha.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebsiteLocalizationSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CanManageWebsite",
                table: "StaffAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "WebsiteCurrencies",
                columns: table => new
                {
                    Code = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Symbol = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    MinorUnits = table.Column<int>(type: "integer", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    IsBase = table.Column<bool>(type: "boolean", nullable: false),
                    VndPerUnit = table.Column<decimal>(type: "numeric(20,8)", precision: 20, scale: 8, nullable: true),
                    RateUpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RateUpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    RateSource = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteCurrencies", x => x.Code);
                    table.CheckConstraint("CK_WebsiteCurrencies_ActiveNeedsRate", "NOT \"IsActive\" OR \"VndPerUnit\" IS NOT NULL");
                    table.CheckConstraint("CK_WebsiteCurrencies_Base", "(\"IsBase\" = (\"Code\" = 'VND')) AND (NOT \"IsBase\" OR (\"VndPerUnit\" = 1 AND \"MinorUnits\" = 0 AND \"IsActive\"))");
                    table.CheckConstraint("CK_WebsiteCurrencies_Code", "\"Code\" ~ '^[A-Z]{3}$'");
                    table.CheckConstraint("CK_WebsiteCurrencies_DefaultIsActive", "NOT \"IsDefault\" OR \"IsActive\"");
                    table.CheckConstraint("CK_WebsiteCurrencies_MinorUnits", "\"MinorUnits\" BETWEEN 0 AND 4");
                    table.CheckConstraint("CK_WebsiteCurrencies_Names", "btrim(\"Name\") <> '' AND btrim(\"Symbol\") <> ''");
                    table.CheckConstraint("CK_WebsiteCurrencies_Rate", "\"VndPerUnit\" IS NULL OR (\"VndPerUnit\" > 0 AND \"VndPerUnit\" < 1000000000000)");
                    table.CheckConstraint("CK_WebsiteCurrencies_RateSource", "\"RateSource\" = 'manual'");
                    table.CheckConstraint("CK_WebsiteCurrencies_RateStamp", "(\"VndPerUnit\" IS NULL) = (\"RateUpdatedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_WebsiteCurrencies_SortOrder", "\"SortOrder\" BETWEEN 0 AND 10000");
                    table.CheckConstraint("CK_WebsiteCurrencies_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_WebsiteCurrencies_StaffAccounts_RateUpdatedByStaffId",
                        column: x => x.RateUpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WebsiteCurrencies_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WebsiteLanguages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    NormalizedCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NativeName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteLanguages", x => x.Id);
                    table.CheckConstraint("CK_WebsiteLanguages_Code", "\"NormalizedCode\" = lower(\"Code\") AND \"NormalizedCode\" ~ '^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?$'");
                    table.CheckConstraint("CK_WebsiteLanguages_DefaultIsActive", "NOT \"IsDefault\" OR \"IsActive\"");
                    table.CheckConstraint("CK_WebsiteLanguages_Names", "btrim(\"DisplayName\") <> '' AND btrim(\"NativeName\") <> ''");
                    table.CheckConstraint("CK_WebsiteLanguages_SortOrder", "\"SortOrder\" BETWEEN 0 AND 10000");
                    table.CheckConstraint("CK_WebsiteLanguages_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_WebsiteLanguages_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WebsiteTranslations",
                columns: table => new
                {
                    LanguageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Value = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByStaffId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebsiteTranslations", x => new { x.LanguageId, x.Key });
                    table.CheckConstraint("CK_WebsiteTranslations_Key", "\"Key\" ~ '^[a-z][a-zA-Z0-9]*(\\.[a-z][a-zA-Z0-9]*)+$'");
                    table.CheckConstraint("CK_WebsiteTranslations_Value", "btrim(\"Value\") <> '' AND char_length(\"Value\") <= 1000");
                    table.CheckConstraint("CK_WebsiteTranslations_Version", "\"Version\" >= 1");
                    table.ForeignKey(
                        name: "FK_WebsiteTranslations_StaffAccounts_UpdatedByStaffId",
                        column: x => x.UpdatedByStaffId,
                        principalTable: "StaffAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WebsiteTranslations_WebsiteLanguages_LanguageId",
                        column: x => x.LanguageId,
                        principalTable: "WebsiteLanguages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteCurrencies_RateUpdatedByStaffId",
                table: "WebsiteCurrencies",
                column: "RateUpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteCurrencies_UpdatedByStaffId",
                table: "WebsiteCurrencies",
                column: "UpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "UX_WebsiteCurrencies_OneBase",
                table: "WebsiteCurrencies",
                column: "IsBase",
                unique: true,
                filter: "\"IsBase\"");

            migrationBuilder.CreateIndex(
                name: "UX_WebsiteCurrencies_OneDefault",
                table: "WebsiteCurrencies",
                column: "IsDefault",
                unique: true,
                filter: "\"IsDefault\"");

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteLanguages_UpdatedByStaffId",
                table: "WebsiteLanguages",
                column: "UpdatedByStaffId");

            migrationBuilder.CreateIndex(
                name: "UX_WebsiteLanguages_NormalizedCode",
                table: "WebsiteLanguages",
                column: "NormalizedCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_WebsiteLanguages_OneDefault",
                table: "WebsiteLanguages",
                column: "IsDefault",
                unique: true,
                filter: "\"IsDefault\"");

            migrationBuilder.CreateIndex(
                name: "IX_WebsiteTranslations_UpdatedByStaffId",
                table: "WebsiteTranslations",
                column: "UpdatedByStaffId");

            // "Exactly one default" (never zero) is checked at commit by deferred constraint triggers (SQLSTATE
            // XBHA3 / XBHA4); the partial unique indexes above already forbid two. Created before the seed so the
            // seed is held to the same rule.
            migrationBuilder.Sql(
                """
                CREATE FUNCTION "WebsiteSettings_AssertOneDefaultLanguage"() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF (SELECT count(*) FROM "WebsiteLanguages" WHERE "IsDefault") <> 1 THEN
                        RAISE EXCEPTION 'The website must have exactly one default language.' USING ERRCODE = 'XBHA3';
                    END IF;
                    RETURN NULL;
                END $$;

                CREATE CONSTRAINT TRIGGER "TR_WebsiteLanguages_ExactlyOneDefault"
                    AFTER INSERT OR UPDATE OR DELETE ON "WebsiteLanguages"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW EXECUTE FUNCTION "WebsiteSettings_AssertOneDefaultLanguage"();

                CREATE FUNCTION "WebsiteSettings_AssertOneDefaultCurrency"() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF (SELECT count(*) FROM "WebsiteCurrencies" WHERE "IsDefault") <> 1 THEN
                        RAISE EXCEPTION 'The website must have exactly one default currency.' USING ERRCODE = 'XBHA4';
                    END IF;
                    RETURN NULL;
                END $$;

                CREATE CONSTRAINT TRIGGER "TR_WebsiteCurrencies_ExactlyOneDefault"
                    AFTER INSERT OR UPDATE OR DELETE ON "WebsiteCurrencies"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW EXECUTE FUNCTION "WebsiteSettings_AssertOneDefaultCurrency"();
                """);

            // Frozen seed (the values are literals on purpose: a later change to the key catalog must not rewrite
            // what this migration did on a fresh database). Vietnamese is the active default; English is present
            // for the operator to turn on and has every managed key; VND is the base and display default; USD and
            // EUR carry metadata only: off, with no exchange rate. Vietnamese texts are lifted from the Customer_Web
            // UI (see the catalog's Source); the English texts are authored translations.
            migrationBuilder.Sql(
                """
                INSERT INTO "WebsiteLanguages"
                    ("Id", "Code", "NormalizedCode", "DisplayName", "NativeName", "SortOrder", "IsActive", "IsDefault", "Version", "CreatedAtUtc", "UpdatedAtUtc", "UpdatedByStaffId")
                VALUES
                    ('7b0c8a10-0001-4000-8000-000000000001', 'vi', 'vi', 'Vietnamese', 'Tiếng Việt', 10, true, true, 1, now(), now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'en', 'en', 'English', 'English', 20, false, false, 1, now(), now(), NULL);

                INSERT INTO "WebsiteCurrencies"
                    ("Code", "Name", "Symbol", "MinorUnits", "SortOrder", "IsActive", "IsDefault", "IsBase", "VndPerUnit", "RateUpdatedAtUtc", "RateUpdatedByStaffId", "RateSource", "Version", "CreatedAtUtc", "UpdatedAtUtc", "UpdatedByStaffId")
                VALUES
                    ('VND', 'Vietnamese đồng', '₫', 0, 10, true, true, true, 1, now(), NULL, 'manual', 1, now(), now(), NULL),
                    ('USD', 'US dollar', '$', 2, 20, false, false, false, NULL, NULL, NULL, 'manual', 1, now(), now(), NULL),
                    ('EUR', 'Euro', '€', 2, 30, false, false, false, NULL, NULL, NULL, 'manual', 1, now(), now(), NULL);

                INSERT INTO "WebsiteTranslations" ("LanguageId", "Key", "Value", "Version", "UpdatedAtUtc", "UpdatedByStaffId")
                VALUES
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.riverside', 'Riverside', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.offers', 'Ưu đãi', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.blog', 'Blog', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.services', 'Dịch vụ', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.templates', 'Giao diện mẫu', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.languageCurrency', 'Ngôn ngữ và tiền tệ', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.language', 'Ngôn ngữ', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.currency', 'Tiền tệ', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.openMenu', 'Mở menu', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.menu.menu', 'Menu', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.theme.toDark', 'Bật chế độ tối', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.theme.toLight', 'Bật chế độ sáng', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.note.languageCurrencyDemo', 'Bản demo: lựa chọn này chưa được áp dụng. Trang vẫn hiển thị tiếng Việt và giá bằng VND.', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.account.account', 'Tài khoản', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.account.myAccount', 'Tài khoản của tôi', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.account.signIn', 'Đăng nhập', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.account.createAccount', 'Tạo tài khoản', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'header.account.signOut', 'Đăng xuất', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'common.close', 'Đóng', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'common.retry', 'Thử lại', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'common.loading', 'Đang tải…', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'common.clearFilters', 'Xoá bộ lọc', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'common.error.generic', 'Hệ thống đặt phòng đang gặp sự cố. Hãy thử lại sau.', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'common.error.network', 'Không kết nối được tới hệ thống đặt phòng. Kiểm tra kết nối rồi thử lại.', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000001', 'common.error.loadFailed', 'Đã có lỗi khi tải {what}.', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.riverside', 'Riverside', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.offers', 'Offers', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.blog', 'Blog', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.services', 'Services', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.templates', 'Sample templates', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.languageCurrency', 'Language and currency', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.language', 'Language', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.currency', 'Currency', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.openMenu', 'Open menu', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.menu.menu', 'Menu', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.theme.toDark', 'Switch to dark mode', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.theme.toLight', 'Switch to light mode', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.note.languageCurrencyDemo', 'Demo: this choice is not applied yet. The page still shows Vietnamese and prices in VND.', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.account.account', 'Account', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.account.myAccount', 'My account', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.account.signIn', 'Sign in', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.account.createAccount', 'Create account', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'header.account.signOut', 'Sign out', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'common.close', 'Close', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'common.retry', 'Try again', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'common.loading', 'Loading…', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'common.clearFilters', 'Clear filters', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'common.error.generic', 'The booking system is having a problem. Please try again later.', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'common.error.network', 'Could not reach the booking system. Check your connection and try again.', 1, now(), NULL),
                    ('7b0c8a10-0001-4000-8000-000000000002', 'common.error.loadFailed', 'Something went wrong while loading {what}.', 1, now(), NULL);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuse atomically while anything administered (or a granted permission) would be lost; an
            // untouched seed is dropped with the tables.
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM "StaffAccounts" WHERE "CanManageWebsite")
                       OR EXISTS (SELECT 1 FROM "WebsiteLanguages" WHERE "NormalizedCode" NOT IN ('vi', 'en') OR "Version" <> 1)
                       OR EXISTS (SELECT 1 FROM "WebsiteCurrencies" WHERE "Code" NOT IN ('VND', 'USD', 'EUR') OR "Version" <> 1)
                       OR EXISTS (SELECT 1 FROM "WebsiteTranslations" WHERE "Version" <> 1 OR "LanguageId" NOT IN ('7b0c8a10-0001-4000-8000-000000000001', '7b0c8a10-0001-4000-8000-000000000002'))
                    THEN
                        RAISE EXCEPTION 'Refusing to drop administered website settings or a granted website permission.';
                    END IF;
                END $$;
                """);

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS \"WebsiteSettings_AssertOneDefaultLanguage\"() CASCADE;");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS \"WebsiteSettings_AssertOneDefaultCurrency\"() CASCADE;");

            migrationBuilder.DropTable(
                name: "WebsiteCurrencies");

            migrationBuilder.DropTable(
                name: "WebsiteTranslations");

            migrationBuilder.DropTable(
                name: "WebsiteLanguages");

            migrationBuilder.DropColumn(
                name: "CanManageWebsite",
                table: "StaffAccounts");
        }
    }
}
