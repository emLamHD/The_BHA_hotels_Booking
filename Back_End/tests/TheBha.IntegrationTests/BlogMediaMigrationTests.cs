using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02 acceptance 1 (migration 19, <c>AddBlogMediaLibrary</c>): it applies to an empty database and to one that holds CP01 pictures and an article that uses them,
/// keeping every id, key and reference; the new constraints are the database's own; and <c>Down()</c> refuses to drop what the library holds. Each test owns a disposable database.
/// </summary>
public sealed class BlogMediaMigrationTests : IAsyncLifetime
{
    private const string V18 = "20261021120804_AddBlogFoundation";

    private readonly NpgsqlConnectionStringBuilder _builder = new(
        Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")
        ?? throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server."))
    {
        Database = $"thebha_blogmedia_{Guid.NewGuid():N}",
        Pooling = false
    };

    public Task InitializeAsync() => AdministerAsync($"CREATE DATABASE \"{_builder.Database}\"");

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await AdministerAsync($"DROP DATABASE IF EXISTS \"{_builder.Database}\" WITH (FORCE)");
    }

    private static Guid Staff => Guid.Parse("5a000000-0000-4000-8000-000000000001");

    private async Task SeedStaffAsync() => await ExecuteAsync(
        $"""
        INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount","CanManageWebsite","CanEditBlog","CanPublishBlog")
        VALUES ('{Staff}',true,now(),'s@example.com','S@EXAMPLE.COM','s@example.com','S@EXAMPLE.COM',false,false,false,true,0,false,true,true)
        """);

    private static string Key(char c) => $"blog/{new string(c, 32)}.jpg";

    [Fact]
    public async Task A_clean_database_gets_the_library_columns_the_variants_table_and_constraints_the_database_enforces()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();

        Assert.Equal(19, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.False(context.Database.HasPendingModelChanges()); // the migration and the model agree
        Assert.Equal(0L, await CountAsync("BlogMediaVariants"));
        await SeedStaffAsync();
        var media = Guid.NewGuid();
        await ExecuteAsync(
            $"""
            INSERT INTO "BlogMedia" ("Id","StorageKey","ContentType","ByteSize","Width","Height","CreatedByStaffId","CreatedAtUtc","DisplayName","UpdatedAtUtc")
            VALUES ('{media}','{Key('a')}','image/jpeg',10,100,100,'{Staff}',now(),'x',now())
            """);

        // Defaults for a row that says nothing about the new columns: centred, version 1, generation 0.
        Assert.Equal("0.5|0.5|1|0", await TextAsync($"""SELECT "FocalX"::text || '|' || "FocalY"::text || '|' || "Version"::text || '|' || "Generation"::text FROM "BlogMedia" WHERE "Id" = '{media}' """));

        // The database itself refuses a focal point outside the picture, a zero version, a key that is not a stored file, an unknown preset, and a repeated size.
        Assert.Equal("23514", await RefusedAsync($"""UPDATE "BlogMedia" SET "FocalX" = 1.01 WHERE "Id" = '{media}' """));
        Assert.Equal("23514", await RefusedAsync($"""UPDATE "BlogMedia" SET "FocalY" = -0.01 WHERE "Id" = '{media}' """));
        Assert.Equal("23514", await RefusedAsync($"""UPDATE "BlogMedia" SET "Version" = 0 WHERE "Id" = '{media}' """));
        Assert.Equal("23514", await RefusedAsync(Variant(media, "thumb", "webp", "not-a-key")));
        Assert.Equal("23514", await RefusedAsync(Variant(media, "huge", "webp", Key('b'))));
        Assert.Equal("23514", await RefusedAsync(Variant(media, "thumb", "avif", Key('b'))));
        await ExecuteAsync(Variant(media, "thumb", "webp", Key('b')));
        Assert.Equal("23505", await RefusedAsync(Variant(media, "thumb", "webp", Key('c'))));
        Assert.Equal("23505", await RefusedAsync(Variant(media, "card", "webp", Key('b'))));

        // Variants belong to their picture: they go with it, and the picture is the only thing that can hold them.
        Assert.Equal("23503", await RefusedAsync(Variant(Guid.NewGuid(), "card", "webp", Key('d'))));
        await ExecuteAsync($"""DELETE FROM "BlogMedia" WHERE "Id" = '{media}' """);
        Assert.Equal(0L, await CountAsync("BlogMediaVariants"));
    }

    private static string Variant(Guid media, string preset, string format, string key) =>
        $"""
        INSERT INTO "BlogMediaVariants" ("Id","MediaId","Preset","Format","StorageKey","Width","Height","ByteSize","Sha256")
        VALUES (gen_random_uuid(),'{media}','{preset}','{format}','{key}',10,10,10,'{new string('0', 64)}')
        """;

    [Fact]
    public async Task A_database_at_cp01_with_pictures_and_an_article_that_uses_them_upgrades_keeping_every_id_key_and_reference()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V18);
        Assert.Equal(18, (await context.Database.GetAppliedMigrationsAsync()).Count());
        await SeedStaffAsync();

        // CP01 data: two pictures (one used as cover and in the revision's list, one unused) and the article that uses the first.
        Guid used = Guid.Parse("00000000-0000-4000-8000-0000000000a1"), spare = Guid.Parse("00000000-0000-4000-8000-0000000000b2");
        Guid post = Guid.NewGuid(), translation = Guid.NewGuid(), revision = Guid.NewGuid();
        const string emptyBody = "{\"schemaVersion\":1,\"blocks\":[]}";
        await ExecuteAsync(
            $"""
            INSERT INTO "BlogMedia" ("Id","StorageKey","ContentType","ByteSize","Width","Height","CreatedByStaffId","CreatedAtUtc") VALUES
              ('{used}','{Key('a')}','image/jpeg',1234,1200,800,'{Staff}','2026-10-20T01:02:03Z'),
              ('{spare}','{Key('b')}','image/jpeg',999,800,600,'{Staff}','2026-10-20T04:05:06Z');
            INSERT INTO "BlogPosts" ("Id","CreatedAtUtc","CreatedByStaffId") VALUES ('{post}',now(),'{Staff}');
            INSERT INTO "BlogPostTranslations" ("Id","PostId","Locale","Status","Version","CreatedAtUtc","UpdatedAtUtc","UpdatedByStaffId") VALUES ('{translation}','{post}','vi','Draft',1,now(),now(),'{Staff}');
            INSERT INTO "BlogPostRevisions" ("Id","TranslationId","Number","State","Origin","Title","Slug","Summary","BodyJson","CoverAlt","AuthorName","MetaTitle","MetaDescription","CreatedAtUtc","UpdatedAtUtc","CreatedByStaffId","UpdatedByStaffId","CoverMediaId")
              VALUES ('{revision}','{translation}',1,'Draft','Edit','Bài cũ','bai-cu','Tóm tắt','{emptyBody}','Alt','Tác giả','','',now(),now(),'{Staff}','{Staff}','{used}');
            UPDATE "BlogPostTranslations" SET "DraftRevisionId" = '{revision}' WHERE "Id" = '{translation}';
            INSERT INTO "BlogRevisionMedia" ("RevisionId","MediaId") VALUES ('{revision}','{used}');
            """);

        await migrator.MigrateAsync();

        Assert.Equal(19, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
        Assert.Equal(2L, await CountAsync("BlogMedia"));
        Assert.Equal(0L, await CountAsync("BlogMediaVariants")); // nothing is processed behind the operator's back

        foreach (var (id, key, size) in new[] { (used, Key('a'), 1234), (spare, Key('b'), 999) })
        {
            Assert.Equal($"{key}|{size}|0|1|0.5|0.5|Picture {id.ToString()[..8]}||", await TextAsync(
                $"""SELECT "StorageKey" || '|' || "ByteSize"::text || '|' || "Generation"::text || '|' || "Version"::text || '|' || "FocalX"::text || '|' || "FocalY"::text || '|' || "DisplayName" || '|' || COALESCE("OriginalSha256",'') || '|' || "OriginalFileName" FROM "BlogMedia" WHERE "Id" = '{id}' """));
            Assert.Equal(1L, await CountWhereAsync($"""SELECT COUNT(*) FROM "BlogMedia" WHERE "Id" = '{id}' AND "UpdatedAtUtc" = "CreatedAtUtc" AND "UpdatedByStaffId" IS NULL"""));
        }

        // The article still points at the picture it used, and that picture still cannot be deleted from under it.
        Assert.Equal(1L, await CountWhereAsync($"""SELECT COUNT(*) FROM "BlogRevisionMedia" WHERE "RevisionId" = '{revision}' AND "MediaId" = '{used}' """));
        Assert.Equal(1L, await CountWhereAsync($"""SELECT COUNT(*) FROM "BlogPostRevisions" WHERE "Id" = '{revision}' AND "CoverMediaId" = '{used}' """));
        Assert.Contains(await RefusedAsync($"""DELETE FROM "BlogMedia" WHERE "Id" = '{used}' """), new[] { "23503", "23001" });
        await ExecuteAsync($"""DELETE FROM "BlogMedia" WHERE "Id" = '{spare}' """);

        // And the model reads the upgraded rows.
        var row = await context.Set<TheBha.Domain.Blog.BlogMedia>().Include(m => m.Variants).AsNoTracking().SingleAsync(m => m.Id == used);
        Assert.Equal((0, 1, false, 0), (row.Generation, row.Version, row.IsProcessed, row.Variants.Count));
    }

    [Fact]
    public async Task Rolling_back_is_refused_while_a_picture_has_variants_was_processed_or_was_edited_and_allowed_for_untouched_cp01_pictures()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync();
        await SeedStaffAsync();
        var media = Guid.NewGuid();
        await ExecuteAsync(
            $"""
            INSERT INTO "BlogMedia" ("Id","StorageKey","ContentType","ByteSize","Width","Height","CreatedByStaffId","CreatedAtUtc","DisplayName","UpdatedAtUtc")
            VALUES ('{media}','{Key('a')}','image/jpeg',10,100,100,'{Staff}',now(),'x',now())
            """);

        // A processed picture, an edited one, one with a variant: each refuses (P0001), and nothing is rolled back half-way.
        foreach (var change in new[] { """UPDATE "BlogMedia" SET "Generation" = 1""", """UPDATE "BlogMedia" SET "Version" = 2""" })
        {
            await ExecuteAsync(change);
            Assert.Equal("P0001", (await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V18))).SqlState);
            Assert.Equal(19, (await context.Database.GetAppliedMigrationsAsync()).Count());
            await ExecuteAsync("""UPDATE "BlogMedia" SET "Generation" = 0, "Version" = 1""");
        }

        await ExecuteAsync(Variant(media, "thumb", "webp", Key('b')));
        Assert.Equal("P0001", (await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V18))).SqlState);
        await ExecuteAsync("""DELETE FROM "BlogMediaVariants" """);

        // A CP01 picture that nothing has touched: going back keeps it, and going forward again gives it its values once more.
        await migrator.MigrateAsync(V18);
        Assert.Equal(18, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Equal(1L, await CountAsync("BlogMedia"));
        await migrator.MigrateAsync();
        Assert.Equal(19, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Equal($"Picture {media.ToString()[..8]}", await TextAsync($"""SELECT "DisplayName" FROM "BlogMedia" WHERE "Id" = '{media}' """));
    }

    private TheBhaDbContext CreateContext() => new(new DbContextOptionsBuilder<TheBhaDbContext>()
        .UseNpgsql(_builder.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
        .Options);

    private async Task<string> RefusedAsync(string sql) => (await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(sql))).SqlState;

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
