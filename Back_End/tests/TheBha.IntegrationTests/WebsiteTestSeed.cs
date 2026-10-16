using System.Text;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 / -C2: the website settings every integration test starts from, rebuilt here from the embedded
/// built-in packs. A fresh database holds only what the migrations seed (the site is not translated until an operator
/// installs the packs); the tests start instead from "Vietnamese and English installed": Vietnamese active and the
/// default, English present but off, both with a text for every catalog key — so a test that is not about installing
/// a pack never has to. <c>ResetDatabaseAsync</c> truncates <c>StaffAccounts … CASCADE</c>, which also empties the website
/// tables (they reference Staff), so it re-inserts this afterwards. Stored-content texts (a property's name…) are NOT
/// seeded: English is therefore short of exactly those until a test completes it (<see cref="WebsiteTestSupport.CompleteContentAsync"/>).
/// </summary>
public static class WebsiteTestSeed
{
    public static readonly Guid Vietnamese = Guid.Parse("7b0c8a10-0001-4000-8000-000000000001");
    public static readonly Guid English = Guid.Parse("7b0c8a10-0001-4000-8000-000000000002");

    public static string InsertSql()
    {
        var vi = LocalizationAssets.BuiltInPack("vi")!;
        var en = LocalizationAssets.BuiltInPack("en")!;
        var referenceText = vi.All.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        var sql = new StringBuilder();
        sql.AppendLine(
            $"""
            TRUNCATE TABLE "WebsiteTranslations", "WebsiteCurrencies", "WebsiteLanguages" CASCADE;
            INSERT INTO "WebsiteCurrencies" ("Code","Name","Symbol","MinorUnits","SortOrder","IsActive","IsDefault","IsBase","VndPerUnit","RateUpdatedAtUtc","RateUpdatedByStaffId","RateSource","Version","CreatedAtUtc","UpdatedAtUtc","UpdatedByStaffId")
            VALUES ('VND','Vietnamese đồng','₫',0,10,true,true,true,1,now(),NULL,'manual',1,now(),now(),NULL),
                   ('USD','US dollar','$',2,20,false,false,false,NULL,NULL,NULL,'manual',1,now(),now(),NULL),
                   ('EUR','Euro','€',2,30,false,false,false,NULL,NULL,NULL,'manual',1,now(),now(),NULL);
            INSERT INTO "WebsiteLanguages" ("Id","Code","NormalizedCode","DisplayName","NativeName","SortOrder","IsActive","IsDefault","Version","CreatedAtUtc","UpdatedAtUtc","UpdatedByStaffId","DefaultCurrencyCode","Direction","FormatLocale")
            VALUES ('{Vietnamese}','vi','vi','Vietnamese','Tiếng Việt',10,true,true,1,now(),now(),NULL,'VND','ltr','vi-VN'),
                   ('{English}','en','en','English','English',20,false,false,1,now(),now(),NULL,'USD','ltr','en-US');
            """);
        sql.AppendLine("INSERT INTO \"WebsiteTranslations\" (\"LanguageId\",\"Key\",\"Value\",\"Version\",\"UpdatedAtUtc\",\"UpdatedByStaffId\",\"IsManual\",\"SourceHash\") VALUES");
        var rows = new List<string>();
        foreach (var definition in LocalizationAssets.Catalog)
        {
            rows.Add($"('{Vietnamese}',{Quote(definition.Key)},{Quote(referenceText[definition.Key])},1,now(),NULL,false,NULL)");
            var english = en.All.First(pair => pair.Key == definition.Key).Value;
            rows.Add($"('{English}',{Quote(definition.Key)},{Quote(english)},1,now(),NULL,false,'{SourceText.Hash(referenceText[definition.Key])}')");
        }

        sql.AppendLine(string.Join(",\n", rows) + ";");
        return sql.ToString();
    }

    private static string Quote(string value) => "'" + value.Replace("'", "''") + "'";
}
