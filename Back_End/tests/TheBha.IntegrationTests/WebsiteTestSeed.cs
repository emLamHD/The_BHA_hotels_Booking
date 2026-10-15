using System.Text;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02: the website settings a freshly migrated database starts with, rebuilt here from the
/// key catalog and the migration's literals. <c>ResetDatabaseAsync</c> truncates <c>StaffAccounts … CASCADE</c>,
/// which also empties the website tables (they reference Staff), so it re-inserts this seed afterwards and every
/// test starts from the same state. <c>WebsiteSettingsMigrationTests</c> compares what the migration really
/// created with this seed, so the two cannot drift apart unnoticed.
/// </summary>
public static class WebsiteTestSeed
{
    public static readonly Guid Vietnamese = Guid.Parse("7b0c8a10-0001-4000-8000-000000000001");
    public static readonly Guid English = Guid.Parse("7b0c8a10-0001-4000-8000-000000000002");

    public static string InsertSql()
    {
        var sql = new StringBuilder();
        sql.AppendLine(
            $"""
            TRUNCATE TABLE "WebsiteTranslations", "WebsiteCurrencies", "WebsiteLanguages";
            INSERT INTO "WebsiteLanguages" ("Id","Code","NormalizedCode","DisplayName","NativeName","SortOrder","IsActive","IsDefault","Version","CreatedAtUtc","UpdatedAtUtc","UpdatedByStaffId")
            VALUES ('{Vietnamese}','vi','vi','Vietnamese','Tiếng Việt',10,true,true,1,now(),now(),NULL),
                   ('{English}','en','en','English','English',20,false,false,1,now(),now(),NULL);
            INSERT INTO "WebsiteCurrencies" ("Code","Name","Symbol","MinorUnits","SortOrder","IsActive","IsDefault","IsBase","VndPerUnit","RateUpdatedAtUtc","RateUpdatedByStaffId","RateSource","Version","CreatedAtUtc","UpdatedAtUtc","UpdatedByStaffId")
            VALUES ('VND','Vietnamese đồng','₫',0,10,true,true,true,1,now(),NULL,'manual',1,now(),now(),NULL),
                   ('USD','US dollar','$',2,20,false,false,false,NULL,NULL,NULL,'manual',1,now(),now(),NULL),
                   ('EUR','Euro','€',2,30,false,false,false,NULL,NULL,NULL,'manual',1,now(),now(),NULL);
            """);
        sql.AppendLine("INSERT INTO \"WebsiteTranslations\" (\"LanguageId\",\"Key\",\"Value\",\"Version\",\"UpdatedAtUtc\",\"UpdatedByStaffId\") VALUES");
        sql.AppendLine(string.Join(
            ",\n",
            WebsiteTranslationCatalog.All.SelectMany(definition => new[]
            {
                $"('{Vietnamese}',{Quote(definition.Key)},{Quote(definition.Vietnamese)},1,now(),NULL)",
                $"('{English}',{Quote(definition.Key)},{Quote(definition.English)},1,now(),NULL)"
            })) + ";");
        return sql.ToString();
    }

    private static string Quote(string value) => "'" + value.Replace("'", "''") + "'";
}
