using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-NEWSLETTER-002: a stand-in for Google's token, userinfo, Gmail send and revoke endpoints, installed as the PRIMARY handler of the
/// gateway's own HttpClient, so the real request building and answer parsing run; only the network is replaced. It records every call.
/// </summary>
public sealed class NewsletterGoogleStub : HttpMessageHandler
{
    public sealed record Call(string Method, string Path, string Body, string? Authorization);

    public ConcurrentQueue<Call> Calls { get; } = new();

    // What Google "knows"; a test changes these between steps.
    public string Email = "sender@gmail.test";
    public bool EmailVerified = true;
    public string Scope = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send";
    public bool IssueRefreshToken = true;
    public string RefreshToken = "refresh-token-AAAA";
    public int ExchangeStatus = 200;
    public string ExchangeError = "invalid_grant";
    public int RefreshStatus = 200;
    public string RefreshError = "invalid_grant";
    public int SendStatus = 200;
    public string SendReason = "";
    public bool SendThrows;
    public TimeSpan SendDelay = TimeSpan.Zero;

    public IReadOnlyList<Call> Sends => Calls.Where(call => call.Path.EndsWith("/messages/send", StringComparison.Ordinal)).ToList();
    public IReadOnlyList<Call> Of(string suffix) => Calls.Where(call => call.Path.EndsWith(suffix, StringComparison.Ordinal)).ToList();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        var path = request.RequestUri!.AbsolutePath;
        Calls.Enqueue(new Call(request.Method.Method, path, body, request.Headers.Authorization?.ToString()));
        if (path.EndsWith("/token", StringComparison.Ordinal))
        {
            var form = System.Web.HttpUtility.ParseQueryString(body);
            return form["grant_type"] == "authorization_code"
                ? ExchangeStatus == 200
                    ? Json(200, new Dictionary<string, object?>
                    {
                        ["access_token"] = "access-token-1", ["expires_in"] = 3599, ["scope"] = Scope, ["token_type"] = "Bearer",
                        ["refresh_token"] = IssueRefreshToken ? RefreshToken : null
                    })
                    : Json(ExchangeStatus, new { error = ExchangeError })
                : RefreshStatus == 200 ? Json(200, new { access_token = "access-token-2", expires_in = 3599, token_type = "Bearer" }) : Json(RefreshStatus, new { error = RefreshError });
        }

        if (path.EndsWith("/userinfo", StringComparison.Ordinal)) return Json(200, new { email = Email, email_verified = EmailVerified });
        if (path.EndsWith("/revoke", StringComparison.Ordinal)) return Json(200, new { });
        if (path.EndsWith("/messages/send", StringComparison.Ordinal))
        {
            if (SendDelay > TimeSpan.Zero) await Task.Delay(SendDelay, cancellationToken);
            if (SendThrows) throw new HttpRequestException("network down");
            return SendStatus == 200
                ? Json(200, new { id = "gmail-id", threadId = "t" })
                : Json(SendStatus, new { error = new { code = SendStatus, errors = new[] { new { reason = SendReason } } } });
        }

        return Json(404, new { });
    }

    private static HttpResponseMessage Json(int status, object value) =>
        new((HttpStatusCode)status) { Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json") };

    /// <summary>The decoded form of one Gmail <c>raw</c> payload: its headers, and the text/plain part.</summary>
    public sealed record Message(Dictionary<string, string> Headers, string Text, string Html, string Link, string Token);

    public static Message Decode(Call send)
    {
        var raw = JsonDocument.Parse(send.Body).RootElement.GetProperty("raw").GetString()!;
        var padded = raw.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
        var mime = Encoding.UTF8.GetString(Convert.FromBase64String(padded));
        var split = mime.Split("\r\n\r\n", 2);
        var headers = split[0].Split("\r\n").Where(line => line.Contains(": ")).ToDictionary(line => line[..line.IndexOf(':')], line => line[(line.IndexOf(':') + 2)..], StringComparer.OrdinalIgnoreCase);
        string Part(string type)
        {
            var at = split[1].IndexOf("Content-Type: " + type, StringComparison.Ordinal);
            var body = split[1][(split[1].IndexOf("\r\n\r\n", at, StringComparison.Ordinal) + 4)..];
            var end = body.IndexOf("--bha-", StringComparison.Ordinal);
            return Encoding.UTF8.GetString(Convert.FromBase64String(body[..end].Replace("\r\n", string.Empty)));
        }

        var text = Part("text/plain");
        var link = text.Split("\r\n").Single(line => line.StartsWith("https://", StringComparison.Ordinal));
        return new Message(headers, text, Part("text/html"), link, link[(link.IndexOf("#t=", StringComparison.Ordinal) + 3)..]);
    }

    public static string Sha256Hex(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    public static string S256(string verifier) => Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
