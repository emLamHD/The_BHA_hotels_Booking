using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP01: the database itself refuses what the application must never do — a second draft, a pointer to another translation's revision,
/// a reused address, a deleted picture or category that is still referenced — whatever code writes. Rows are made through the API, then the
/// violation is attempted in raw SQL against real PostgreSQL.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogSchemaTests(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    /// <summary>A delete that a <c>RESTRICT</c> reference forbids: PostgreSQL reports it as 23503 or, in some versions, 23001.</summary>
    private static void AssertRestricted(string sqlState) =>
        Assert.True(sqlState is PostgresErrorCodes.ForeignKeyViolation or PostgresErrorCodes.RestrictViolation, sqlState);

    private async Task<string> RefusedAsync(string sql)
    {
        var exception = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(sql));
        return exception.SqlState;
    }

    private static string CopyRevision(Guid source, int number, string state) =>
        $"""
        INSERT INTO "BlogPostRevisions" ("Id","TranslationId","Number","State","Origin","Title","Slug","Summary","BodyJson","CoverAlt","AuthorName","MetaTitle","MetaDescription","CreatedAtUtc","UpdatedAtUtc","CreatedByStaffId","UpdatedByStaffId")
        SELECT gen_random_uuid(),"TranslationId",{number},'{state}',"Origin","Title","Slug","Summary","BodyJson","CoverAlt","AuthorName","MetaTitle","MetaDescription",now(),now(),"CreatedByStaffId","UpdatedByStaffId"
        FROM "BlogPostRevisions" WHERE "Id" = '{source}'
        """;

    [Fact]
    public async Task The_database_enforces_the_publication_invariants()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (first, _) = await PublishedAsync(host, media, "mot");
        var second = PostId(await CreatePostAsync(host, Draft(media, "hai")));
        var firstTranslation = await ScalarAsync<Guid>($"""SELECT "Id" FROM "BlogPostTranslations" WHERE "PostId" = '{first}' """);
        var secondTranslation = await ScalarAsync<Guid>($"""SELECT "Id" FROM "BlogPostTranslations" WHERE "PostId" = '{second}' """);
        var secondDraft = await ScalarAsync<Guid>($"""SELECT "DraftRevisionId" FROM "BlogPostTranslations" WHERE "Id" = '{secondTranslation}' """);
        var firstRevision = await ScalarAsync<Guid>($"""SELECT "PublishedRevisionId" FROM "BlogPostTranslations" WHERE "Id" = '{firstTranslation}' """);

        // A translation can only point at its own revisions.
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, await RefusedAsync($"""UPDATE "BlogPostTranslations" SET "DraftRevisionId" = '{secondDraft}' WHERE "Id" = '{firstTranslation}' """));
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, await RefusedAsync($"""UPDATE "BlogPostTranslations" SET "PublishedRevisionId" = '{secondDraft}' WHERE "Id" = '{firstTranslation}' """));
        // Never two drafts for one translation; and a revision number is unique within its translation.
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync(CopyRevision(secondDraft, number: 99, state: "Draft")));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync(CopyRevision(secondDraft, number: 1, state: "Frozen")));
        await ExecuteAsync(CopyRevision(secondDraft, number: 99, state: "Frozen")); // the same copy is fine when it is not a second draft

        // An address belongs to one page for ever; a translation has one live and one draft address.
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync($"""INSERT INTO "BlogPostSlugs" ("Locale","Slug","State","TranslationId") VALUES ('vi','mot','Redirect','{secondTranslation}')"""));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync($"""INSERT INTO "BlogPostSlugs" ("Locale","Slug","State","TranslationId") VALUES ('vi','mot-nua','Current','{firstTranslation}')"""));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync($"""INSERT INTO "BlogPostSlugs" ("Locale","Slug","State","TranslationId") VALUES ('vi','hai-nua','Draft','{secondTranslation}')"""));
        // One translation per post and language.
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync($"""INSERT INTO "BlogPostTranslations" ("Id","PostId","Locale","Status","Version","CreatedAtUtc","UpdatedAtUtc","UpdatedByStaffId") SELECT gen_random_uuid(),"PostId","Locale",'Draft',1,now(),now(),"UpdatedByStaffId" FROM "BlogPostTranslations" WHERE "Id" = '{firstTranslation}'"""));
        // A published translation names its revision; versions start at 1.
        Assert.Equal(PostgresErrorCodes.CheckViolation, await RefusedAsync($"""UPDATE "BlogPostTranslations" SET "PublishedRevisionId" = NULL WHERE "Id" = '{firstTranslation}'"""));
        Assert.Equal(PostgresErrorCodes.CheckViolation, await RefusedAsync($"""UPDATE "BlogPostTranslations" SET "Version" = 0 WHERE "Id" = '{secondTranslation}'"""));
        // A frozen revision carries the primary-category rule: one primary at most.
        var secondCategory = (await CreateCategoryAsync(host, "khac")).GetProperty("id").GetGuid();
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync($"""INSERT INTO "BlogRevisionCategories" ("RevisionId","CategoryId","IsPrimary") VALUES ('{secondDraft}','{secondCategory}',true)"""));
    }

    [Fact]
    public async Task A_picture_or_category_that_a_revision_refers_to_cannot_be_deleted_and_the_other_checks_hold()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var unused = await UploadAsync(host, host.Cookie(Editor));
        await PublishedAsync(host, media, "tham-chieu");

        AssertRestricted(await RefusedAsync($"""DELETE FROM "BlogMedia" WHERE "Id" = '{media}'"""));
        AssertRestricted(await RefusedAsync($"""DELETE FROM "BlogCategories" WHERE "Id" = '{FeaturedCategory}'"""));
        AssertRestricted(await RefusedAsync("""DELETE FROM "BlogPosts" """));
        AssertRestricted(await RefusedAsync("""DELETE FROM "BlogPostRevisions" """));
        await ExecuteAsync($"""DELETE FROM "BlogMedia" WHERE "Id" = '{unused}'"""); // not referenced: allowed

        Assert.Equal(PostgresErrorCodes.CheckViolation, await RefusedAsync("""INSERT INTO "BlogSettings" ("Id","Version","UpdatedAtUtc") VALUES (2,1,now())"""));
        Assert.Equal(PostgresErrorCodes.CheckViolation, await RefusedAsync($"""UPDATE "BlogMedia" SET "StorageKey" = 'blog/../../etc/passwd' WHERE "Id" = '{media}'"""));
        Assert.Equal(PostgresErrorCodes.CheckViolation, await RefusedAsync($"""UPDATE "BlogMedia" SET "Width" = 0 WHERE "Id" = '{media}'"""));
        Assert.Equal(PostgresErrorCodes.CheckViolation, await RefusedAsync($"""UPDATE "BlogCategories" SET "Version" = 0 WHERE "Id" = '{FeaturedCategory}'"""));
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, await RefusedAsync($"""UPDATE "BlogSettings" SET "HomeSectionCategoryId" = '{Guid.NewGuid()}' """));
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, await RefusedAsync($"""INSERT INTO "BlogCategoryPins" ("CategoryId","PostId","Position","PinnedByStaffId","PinnedAtUtc") VALUES ('{FeaturedCategory}','{Guid.NewGuid()}',0,'{await StaffIdAsync(Editor)}',now())"""));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await RefusedAsync($"""INSERT INTO "BlogCategories" ("Id","SystemKey","SortOrder","Version","CreatedAtUtc","UpdatedAtUtc") VALUES ('{Guid.NewGuid()}','featured-destinations',1,1,now(),now())"""));
    }
}

/// <summary>BHA-BLOG-001-CP01: the migration on a clean database, its seed, and a rollback that refuses to drop Blog content. Own database per test.</summary>
public sealed class BlogMigrationTests : IAsyncLifetime
{
    private const string Before = "20261021083007_AddBookingPromotions";

    private readonly NpgsqlConnectionStringBuilder _builder = new(
        Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")
        ?? throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server."))
    {
        Database = $"thebha_blogmigration_{Guid.NewGuid():N}",
        Pooling = false
    };

    public Task InitializeAsync() => AdministerAsync($"CREATE DATABASE \"{_builder.Database}\"");

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await AdministerAsync($"DROP DATABASE IF EXISTS \"{_builder.Database}\" WITH (FORCE)");
    }

    [Fact]
    public async Task A_clean_database_gets_the_blog_tables_the_seed_and_no_content()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();

        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
        Assert.Equal(1L, await CountAsync("BlogCategories"));
        // One text for each of vi/en/fr that the fresh database already has (Vietnamese at least).
        Assert.Equal(await CountWhereAsync("""SELECT COUNT(*) FROM "WebsiteLanguages" WHERE "NormalizedCode" IN ('vi','en','fr') """), await CountAsync("BlogCategoryTranslations"));
        Assert.Equal(1L, await CountWhereAsync("""SELECT COUNT(*) FROM "BlogCategoryTranslations" WHERE "Locale" = 'vi' """));
        Assert.Equal("Điểm đến nổi bật", await TextAsync("""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "Locale" = 'vi' """));
        Assert.Equal("diem-den-noi-bat", await TextAsync("""SELECT "Slug" FROM "BlogCategorySlugs" WHERE "IsCurrent" AND "Locale" = 'vi' """));
        Assert.Equal(BlogSeed.FeaturedDestinationsCategoryId.ToString(), await TextAsync("""SELECT "HomeSectionCategoryId"::text FROM "BlogSettings" """));
        foreach (var table in new[] { "BlogPosts", "BlogPostTranslations", "BlogPostRevisions", "BlogMedia", "BlogAudits", "BlogCategoryPins", "BlogPostSlugs" })
        {
            Assert.Equal(0L, await CountAsync(table));
        }

        // Every staff account starts without any Blog permission.
        Assert.Equal(0L, await CountWhereAsync("""SELECT COUNT(*) FROM "StaffAccounts" WHERE "CanEditBlog" OR "CanPublishBlog" """));
        // The tables are what the model says they are: the migration and the model agree.
        Assert.False(context.Database.HasPendingModelChanges());
    }

    [Fact]
    public async Task Rolling_back_is_refused_while_blog_content_or_permissions_exist_and_allowed_when_only_the_seed_remains()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        var staff = Guid.NewGuid();
        await ExecuteAsync(
            $"""
            INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount","CanManageWebsite","CanEditBlog","CanPublishBlog")
            VALUES ('{staff}',true,now(),'s@example.com','S@EXAMPLE.COM','s@example.com','S@EXAMPLE.COM',false,false,false,true,0,false,true,false)
            """);
        Assert.Equal("P0001", (await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(Before))).SqlState);

        await ExecuteAsync($"""UPDATE "StaffAccounts" SET "CanEditBlog" = false WHERE "Id" = '{staff}'""");
        var post = Guid.NewGuid();
        await ExecuteAsync($"""INSERT INTO "BlogPosts" ("Id","CreatedAtUtc","CreatedByStaffId") VALUES ('{post}',now(),'{staff}')""");
        Assert.Equal("P0001", (await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(Before))).SqlState);
        Assert.Equal(1L, await CountAsync("BlogPosts"));

        await ExecuteAsync($"""DELETE FROM "BlogPosts" WHERE "Id" = '{post}'""");
        await ExecuteAsync($"""UPDATE "BlogCategories" SET "Version" = 2""");
        Assert.Equal("P0001", (await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(Before))).SqlState);

        await ExecuteAsync("""UPDATE "BlogCategories" SET "Version" = 1""");
        await migrator.MigrateAsync(Before);
        Assert.Equal(17, (await context.Database.GetAppliedMigrationsAsync()).Count());
        await migrator.MigrateAsync();
        Assert.Equal(1L, await CountAsync("BlogCategories")); // the seed is back, once
    }

    private TheBhaDbContext CreateContext() => new(new DbContextOptionsBuilder<TheBhaDbContext>()
        .UseNpgsql(_builder.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
        .Options);

    private Task<long> CountAsync(string table) => CountWhereAsync($"SELECT COUNT(*) FROM \"{table}\"");

    private async Task<long> CountWhereAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string> TextAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private async Task AdministerAsync(string sql)
    {
        var admin = new NpgsqlConnectionStringBuilder(_builder.ConnectionString) { Database = "postgres", Pooling = false };
        await using var connection = new NpgsqlConnection(admin.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
