using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TheBha.Api.Seeding;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Domain.Blog;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02 acceptance 10: a storage, codec, database or connection failure — injected for real, into the real routes — never leaves a picture whose files are missing,
/// never deletes the files of a picture that was committed, never undoes a sibling that succeeded, and leaves at most orphan files that the maintenance command finds and removes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogMediaFailureTests(PostgreSqlWebApplicationFactory factory) : BlogMediaTestSupport(factory)
{
    private sealed class FaultyStorage(IHeroMediaStorage inner) : IHeroMediaStorage
    {
        public int Writes;
        public int FailWriteNumber;
        public bool KeepFilesOnDelete;
        public Action<int>? OnWrite;

        public bool IsConfigured => inner.IsConfigured;

        public async Task WriteAsync(string key, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
        {
            var number = Interlocked.Increment(ref Writes);
            OnWrite?.Invoke(number);
            if (number == FailWriteNumber)
            {
                throw new IOException("Injected storage failure.");
            }

            await inner.WriteAsync(key, content, cancellationToken);
        }

        public Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken) => inner.OpenReadAsync(key, cancellationToken);

        public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken) => inner.ExistsAsync(key, cancellationToken);

        /// <summary>The file stays: a delete that failed on the disk.</summary>
        public Task DeleteAsync(string key, CancellationToken cancellationToken) => KeepFilesOnDelete ? Task.CompletedTask : inner.DeleteAsync(key, cancellationToken);

        public IAsyncEnumerable<StoredFile> ListAsync(string prefix, CancellationToken cancellationToken) => inner.ListAsync(prefix, cancellationToken);
    }

    private sealed class BrokenPipeline : IBlogImagePipeline
    {
        public BlogImageCapabilities Capabilities => new([], false, "broken");

        public Task<(BlogProcessedImage? Image, BlogProblem? Problem)> ProcessAsync(ReadOnlyMemory<byte> original, HeroImageInfo expected, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Injected codec failure.");
    }

    /// <summary>Lets the real commit happen, then loses the answer: the caller sees a failure for a picture that is in the database.</summary>
    private sealed class LostAcknowledgement : SaveChangesInterceptor
    {
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<BlogMedia>().Any())
            {
                throw new IOException("Injected lost acknowledgement after the real PostgreSQL commit.");
            }

            return ValueTask.FromResult(result);
        }
    }

    private static FaultyStorage Fault(IServiceCollection services)
    {
        var inner = (IHeroMediaStorage)services.Single(descriptor => descriptor.ServiceType == typeof(IHeroMediaStorage)).ImplementationInstance!;
        var faulty = new FaultyStorage(inner);
        services.RemoveAll<IHeroMediaStorage>();
        services.AddSingleton<IHeroMediaStorage>(faulty);
        return faulty;
    }

    private Task<int> CountAsync(string table) => ScalarAsync<int>($"""SELECT count(*)::int FROM "{table}" """);

    private static readonly byte[] Good = BlogImageFixtures.Jpeg(1200, 800);

    [Fact]
    public async Task A_storage_failure_in_the_middle_of_a_picture_leaves_neither_row_nor_file_and_spares_the_pictures_before_it()
    {
        FaultyStorage storage = null!;
        using var host = await StartMediaAsync(services => storage = Fault(services));

        // Two pictures: the first takes writes 1–7, the second fails on its 3rd write (the 10th overall).
        storage.FailWriteNumber = 10;
        var batch = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, host.Cookie(Editor), [("one.jpg", Good), ("two.jpg", Good)])));

        var items = batch.GetProperty("items");
        Assert.Equal(JsonValueKind.Object, items[0].GetProperty("media").ValueKind);
        Assert.Equal("blog.media-processing-failed", items[1].GetProperty("error").GetProperty("code").GetString());
        Assert.Equal(1, await CountAsync("BlogMedia"));
        Assert.Equal(6, await CountAsync("BlogMediaVariants"));
        Assert.Equal(7, BlogFiles().Length); // the surviving picture's files and nothing of the one that failed
        var survivor = items[0].GetProperty("media").GetProperty("id").GetGuid();
        await using (var db = Factory.CreateDbContext())
        {
            var row = await db.BlogMedia.Include(m => m.Variants).SingleAsync(m => m.Id == survivor);
            foreach (var key in row.Variants.Select(v => v.StorageKey).Append(row.StorageKey))
            {
                Assert.True(File.Exists(Path.Combine(Factory.MediaRoot, key)), $"{key} is recorded and missing");
            }
        }

        // One picture on its own: the same, and a plain 500 for a request that took nothing in.
        storage.Writes = 0;
        storage.FailWriteNumber = 4;
        await UploadPictureAsync(host, Good, expected: HttpStatusCode.InternalServerError);
        Assert.Equal(1, await CountAsync("BlogMedia"));
        Assert.Equal(7, BlogFiles().Length);

        // And it works again afterwards: nothing was left half-done.
        storage.FailWriteNumber = 0;
        await UploadPictureAsync(host, Good);
        Assert.Equal(2, await CountAsync("BlogMedia"));
        Assert.Equal(14, BlogFiles().Length);
    }

    [Fact]
    public async Task A_database_refusal_after_the_files_are_written_removes_every_one_of_them()
    {
        using var host = await StartMediaAsync();
        await ExecuteAsync(
            """
            CREATE FUNCTION blog_media_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected variant failure'; END $$;
            CREATE TRIGGER blog_media_test_reject BEFORE INSERT ON "BlogMediaVariants" FOR EACH ROW EXECUTE FUNCTION blog_media_test_reject();
            """);
        try
        {
            await UploadPictureAsync(host, Good, expected: HttpStatusCode.InternalServerError);
            var batch = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, host.Cookie(Editor), [("a.jpg", Good), ("b.jpg", Good)])));
            Assert.All(batch.GetProperty("items").EnumerateArray(), item => Assert.Equal("blog.media-processing-failed", item.GetProperty("error").GetProperty("code").GetString()));

            // The transaction rolled back whole (no row without its variants) and the database said so, so the files were taken away.
            Assert.Equal(0, await CountAsync("BlogMedia"));
            Assert.Equal(0, await CountAsync("BlogMediaVariants"));
            Assert.Empty(BlogFiles());
        }
        finally
        {
            await ExecuteAsync("""DROP TRIGGER blog_media_test_reject ON "BlogMediaVariants"; DROP FUNCTION blog_media_test_reject();""");
        }
    }

    [Fact]
    public async Task A_lost_acknowledgement_after_the_commit_must_not_delete_any_file_of_the_picture()
    {
        using var host = await StartMediaAsync(services => services.AddScoped(_ => new TheBhaDbContext(
            new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(Factory.ConnectionString).AddInterceptors(new LostAcknowledgement()).Options)));

        await UploadPictureAsync(host, Good, expected: HttpStatusCode.InternalServerError);

        Assert.Equal(1, await CountAsync("BlogMedia"));
        Assert.Equal(6, await CountAsync("BlogMediaVariants"));
        Assert.Equal(7, BlogFiles().Length);
        var id = await ScalarAsync<Guid>("""SELECT "Id" FROM "BlogMedia" """);
        var detail = await MediaDetailAsync(host, id);
        Assert.Equal("current", detail.GetProperty("pipeline").GetString());

        // The picture the client never heard about is complete: it can be used, published and served in every size.
        var (_, _) = await PublishedAsync(host, id, "mat-xac-nhan");
        var article = await PublicOkAsync(host, "/posts/mat-xac-nhan?locale=vi");
        foreach (var variant in article.GetProperty("cover").GetProperty("variants").EnumerateArray())
        {
            await AssertStatusAsync(HttpStatusCode.OK, host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Get, variant.GetProperty("url").GetString())));
        }
    }

    [Fact]
    public async Task A_codec_failure_is_reported_per_picture_and_changes_nothing()
    {
        using var host = await StartMediaAsync(services =>
        {
            services.RemoveAll<IBlogImagePipeline>();
            services.AddSingleton<IBlogImagePipeline, BrokenPipeline>();
        });

        var batch = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, host.Cookie(Editor), [("a.jpg", Good), ("b.jpg", Good)])));
        Assert.Equal((0, 2), (batch.GetProperty("succeeded").GetInt32(), batch.GetProperty("failed").GetInt32()));
        Assert.All(batch.GetProperty("items").EnumerateArray(), item => Assert.Equal("blog.media-processing-failed", item.GetProperty("error").GetProperty("code").GetString()));
        await UploadPictureAsync(host, Good, expected: HttpStatusCode.InternalServerError);
        Assert.Equal(0, await CountAsync("BlogMedia"));
        Assert.Empty(BlogFiles());
    }

    [Fact]
    public async Task A_cancelled_batch_stops_in_the_middle_of_a_picture_leaving_the_ones_before_it_whole_and_nothing_of_it()
    {
        FaultyStorage storage = null!;
        using var host = await StartMediaAsync(services => storage = Fault(services));
        using var cancel = new CancellationTokenSource();
        storage.OnWrite = number =>
        {
            if (number == 10)
            {
                cancel.Cancel(); // the caller goes away while the second picture's files are being written
            }
        };

        using var scope = host.Host.Services.CreateScope();
        var blog = scope.ServiceProvider.GetRequiredService<IAdminBlog>();
        var uploads = new[] { new BlogMediaUpload(() => new MemoryStream(Good), "one.jpg", null), new BlogMediaUpload(() => new MemoryStream(Good), "two.jpg", null), new BlogMediaUpload(() => new MemoryStream(Good), "three.jpg", null) };
        var editor = await StaffIdAsync(Editor);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => blog.UploadMediaBatchAsync(uploads, editor, cancel.Token));

        Assert.Equal(1, await CountAsync("BlogMedia")); // the picture before it is whole; the one cut off and the one never started are not there
        Assert.Equal(6, await CountAsync("BlogMediaVariants"));
        Assert.Equal(7, BlogFiles().Length);
    }

    [Fact]
    public async Task A_delete_whose_file_removal_fails_leaves_only_orphans_and_the_maintenance_command_removes_them()
    {
        FaultyStorage storage = null!;
        using var host = await StartMediaAsync(services => storage = Fault(services));
        var id = (await UploadPictureAsync(host, Good)).GetProperty("id").GetGuid();
        var keep = (await UploadPictureAsync(host, Good)).GetProperty("id").GetGuid();

        storage.KeepFilesOnDelete = true;
        await AssertStatusAsync(HttpStatusCode.NoContent, DeleteMediaAsync(host, id, 1));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMedia" WHERE "Id" = '{id}' """)); // the row is gone: nothing can refer to the files
        Assert.Equal(14, BlogFiles().Length);
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{id}"));

        storage.KeepFilesOnDelete = false;
        Factory.Clock.UtcNow = DateTimeOffset.UtcNow.AddHours(3);
        var args = new[] { BlogMediaMaintenanceCommand.Verb, "--expected-database", Factory.DatabaseName, "--grace-minutes", "60" };

        var (dryExit, dryOutput) = await RunMaintenanceAsync(host, [.. args, "--dry-run"]);
        Assert.Equal(0, dryExit);
        Assert.Contains("files no picture refers to (older than 60 min): 7; removed: 0", dryOutput);
        Assert.Equal(14, BlogFiles().Length);

        var (applyExit, applyOutput) = await RunMaintenanceAsync(host, [.. args, "--apply"]);
        Assert.Equal(0, applyExit);
        Assert.Contains("removed: 7", applyOutput);
        Assert.Equal(7, BlogFiles().Length);
        Factory.Clock.UtcNow = DateTimeOffset.Parse("2026-10-21T08:00:00Z"); // back inside the Staff session
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{keep}", host.Cookie(Both)))); // the picture that exists is intact
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{keep}/preview/thumb", host.Cookie(Both))));
    }
}
