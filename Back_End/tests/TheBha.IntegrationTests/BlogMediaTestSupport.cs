using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

namespace TheBha.IntegrationTests;

/// <summary>BHA-BLOG-001-CP02: requests and file checks for the picture library tests.</summary>
public abstract class BlogMediaTestSupport(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    protected string BlogFilesDirectory => Path.Combine(Factory.MediaRoot, "blog");

    /// <summary>The picture directory is shared by the tests of the collection (the database is reset per test, the files are not): start each media test from none.</summary>
    protected async Task<BlogHost> StartMediaAsync(Action<Microsoft.Extensions.DependencyInjection.IServiceCollection>? configure = null)
    {
        if (Directory.Exists(BlogFilesDirectory))
        {
            Directory.Delete(BlogFilesDirectory, recursive: true);
        }

        return await StartBlogAsync(configure: configure);
    }

    protected string[] BlogFiles() => Directory.Exists(BlogFilesDirectory) ? Directory.GetFiles(BlogFilesDirectory).Order().ToArray() : [];

    protected static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    protected static HttpRequestMessage Multipart(
        string path, string? cookie, IEnumerable<(string Name, string FileName, byte[] Bytes)> files, IEnumerable<(string Name, string Value)>? fields = null)
    {
        var content = new MultipartFormDataContent();
        foreach (var (name, fileName, bytes) in files)
        {
            var part = new ByteArrayContent(bytes);
            part.Headers.ContentType = MediaTypeHeaderValue.Parse("application/octet-stream");
            content.Add(part, name, fileName);
        }

        foreach (var (name, value) in fields ?? [])
        {
            content.Add(new StringContent(value), name);
        }

        var request = new HttpRequestMessage(HttpMethod.Post, Root + path) { Content = content };
        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        request.Headers.TryAddWithoutValidation("Origin", AdminOrigin);
        return request;
    }

    protected Task<HttpResponseMessage> BatchAsync(BlogHost host, string cookie, IEnumerable<(string FileName, byte[] Bytes)> files, IEnumerable<Guid>? ids = null) =>
        SendAsync(host, Multipart("/media/batch", cookie, files.Select(file => ("files", file.FileName, file.Bytes)), ids?.Select(id => ("ids", id.ToString()))));

    protected async Task<JsonElement> UploadPictureAsync(BlogHost host, byte[] bytes, string fileName = "picture.jpg", Guid? id = null, string? cookie = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var request = Multipart("/media", cookie ?? host.Cookie(Editor), [("file", fileName, bytes)], id is null ? null : [("id", id.ToString()!)]);
        return await JsonAsync(await AssertStatusAsync(expected, SendAsync(host, request)));
    }

    protected async Task<JsonElement> MediaDetailAsync(BlogHost host, Guid id) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{id}/detail", host.Cookie(Both)))));

    protected Task<HttpResponseMessage> DeleteMediaAsync(BlogHost host, Guid id, int version, string? cookie = null) =>
        SendAsync(host, AdminPost($"/media/{id}/delete", new { expectedVersion = version }, cookie ?? host.Cookie(Publisher)));

    protected Task<HttpResponseMessage> SaveMediaAsync(BlogHost host, Guid id, int version, object? change = null, string? cookie = null) =>
        SendAsync(host, AdminPost($"/media/{id}/save", change ?? new { expectedVersion = version, displayName = "Biển Mỹ Khê", focalX = 0.5, focalY = 0.5 }, cookie ?? host.Cookie(Editor)));

    /// <summary>Runs the operator command in-process against this host's services, as <c>Production</c>: it is not a Development tool.</summary>
    protected static async Task<(int Exit, string Output)> RunMaintenanceAsync(BlogHost host, string[] args)
    {
        using var output = new StringWriter();
        var exit = await TheBha.Api.Seeding.BlogMediaMaintenanceCommand.RunAsync(args, host.Host.Services, "Production", output, CancellationToken.None);
        return (exit, output.ToString());
    }

    protected static async Task<string> ErrorCodeAsync(HttpResponseMessage response) => (await ProblemOf(response)).Code ?? string.Empty;
}
