using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Api.Seeding;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>Shared by the content-pack tests: the committed pack, a copy of it, and a throw-away target database with its own media directory and operator command.</summary>
internal static class ContentPackTestSupport
{
    public const string BaseUrl = "https://bha.example.org";
    public const string Actor = "actor@bha.test";
    public const string RiversideId = "a1000000-0000-0000-0000-000000000001";

    public static string PackDir()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "deploy", "content", "bha-site-content"))) directory = directory.Parent;
        return Path.Combine(directory!.FullName, "deploy", "content", "bha-site-content");
    }

    public static string CopyPack()
    {
        var target = Path.Combine(Path.GetTempPath(), "bha-pack-" + Guid.NewGuid().ToString("N"));
        foreach (var file in Directory.EnumerateFiles(PackDir(), "*", SearchOption.AllDirectories))
        {
            var destination = Path.Combine(target, Path.GetRelativePath(PackDir(), file));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination);
        }
        return target;
    }

    public static JsonObject PackRow(string table, Func<string, bool> pick) => JsonNode.Parse(File.ReadLines(Path.Combine(PackDir(), "rows", table + ".jsonl")).First(pick))!.AsObject();

    public sealed class Target : IAsyncDisposable
    {
        public required string Database { get; init; }
        public required string ConnectionString { get; init; }
        /// <summary>The media directory (without a trailing separator).</summary>
        public required string Media { get; init; }
        public required WebApplicationFactory<Program> Host { get; init; }
        public required string AdminConnection { get; init; }

        public string[] Import(string pack, params string[] more) =>
            [ContentPackCommand.Import, "--expected-database", Database, "--pack", pack, "--media-base-url", BaseUrl, "--actor-email", Actor, .. more];

        public string[] Verify(string pack, params string[] more) =>
            [ContentPackCommand.Verify, "--expected-database", Database, "--pack", pack, "--media-base-url", BaseUrl, .. more];

        public async Task<(int Exit, string Output)> RunAsync(params string[] args)
        {
            var writer = new StringWriter();
            var exit = await ContentPackCommand.RunAsync(args, Host.Services, "Development", writer, CancellationToken.None);
            return (exit, writer.ToString());
        }

        public async Task<long> CountAsync(string sql)
        {
            await using var connection = new NpgsqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand(sql, connection);
            return Convert.ToInt64(await command.ExecuteScalarAsync());
        }

        public async Task<string?> TextAsync(string sql)
        {
            await using var connection = new NpgsqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand(sql, connection);
            return (await command.ExecuteScalarAsync())?.ToString();
        }

        public async Task ExecuteAsync(string sql)
        {
            await using var connection = new NpgsqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync();
        }

        /// <summary>Inserts a row given as JSON (columns missing from it take their defaults).</summary>
        public async Task InsertRowAsync(string table, JsonObject row)
        {
            await using var connection = new NpgsqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var insert = new NpgsqlCommand($"INSERT INTO \"{table}\" SELECT * FROM jsonb_populate_record(NULL::\"{table}\", @j)", connection);
            insert.Parameters.Add(new NpgsqlParameter("j", NpgsqlTypes.NpgsqlDbType.Jsonb) { Value = row.ToJsonString() });
            await insert.ExecuteNonQueryAsync();
        }

        public int MediaFiles() => Directory.Exists(Media) ? Directory.EnumerateFiles(Media, "*", SearchOption.AllDirectories).Count() : 0;

        public async ValueTask DisposeAsync()
        {
            Host.Dispose();
            NpgsqlConnection.ClearAllPools();
            await using var connection = new NpgsqlConnection(AdminConnection);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{Database}\" WITH (FORCE)", connection);
            await command.ExecuteNonQueryAsync();
            if (Directory.Exists(Media)) Directory.Delete(Media, recursive: true);
        }
    }

    /// <param name="mediaRootSuffix">appended to the configured media root (for example "/"), to prove both spellings of a root behave the same.</param>
    public static async Task<Target> NewTargetAsync(PostgreSqlWebApplicationFactory factory, bool withActor = true, string mediaRootSuffix = "")
    {
        var database = $"thebha_cp_{Guid.NewGuid():N}"[..40];
        var admin = new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using (var connection = new NpgsqlConnection(admin))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", connection);
            await command.ExecuteNonQueryAsync();
        }
        var connectionString = new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = database, Pooling = false }.ConnectionString;
        var media = Path.Combine(Path.GetTempPath(), "bha-cp-media-" + Guid.NewGuid().ToString("N"));
        var host = factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:TheBhaDatabase", connectionString);
            builder.UseSetting("WebsiteMedia:RootPath", media + mediaRootSuffix);
        });
        await using (var scope = host.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<TheBhaDbContext>().Database.MigrateAsync();
        var target = new Target { Database = database, ConnectionString = connectionString, Media = media, Host = host, AdminConnection = admin };
        if (withActor)
            await target.ExecuteAsync($"""
                INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount","CanManageWebsite","CanEditBlog","CanPublishBlog")
                VALUES ('{Guid.NewGuid()}', true, now(), '{Actor}', upper('{Actor}'), '{Actor}', upper('{Actor}'), true, false, false, false, 0, false, true, true)
                """);
        return target;
    }
}
