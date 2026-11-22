using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TheBha.Application.Notifications;

namespace TheBha.Infrastructure.Persistence.Notifications;

/// <summary>
/// The first provider adapter (Resend's <c>POST /emails</c>); a technical choice of PR03, not a production lock. One recipient per request and the same <c>Idempotency-Key</c> on every retry of a delivery, so the provider
/// answers a repeat with the first result instead of sending again (it keeps a key for 24 hours; the dispatcher stops trusting it earlier). The body is built only from the frozen delivery, in one fixed field order.
/// Nothing the provider returns is logged: the answer's JSON is read only for the error <c>name</c> and the message <c>id</c>.
/// </summary>
public sealed class ResendEmailTransport(HttpClient client, EmailOutboxOptions options) : IEmailTransport
{
    public const string HttpClientName = "EmailOutboxResend";
    private const int MaxAnswerBytes = 8192;

    public EmailTransportIdentity? Identity
    {
        get
        {
            var resend = options.Resend;
            if (!resend.IsConfigured) return null;
            var baseUrl = resend.BaseUrl.TrimEnd('/');
            // The fingerprint names the account without containing the key: the same key at the same endpoint is the same account.
            var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"resend|{baseUrl}|{resend.ApiKey!.Trim()}"))).ToLowerInvariant();
            return new EmailTransportIdentity(fingerprint, FromHeader(resend));
        }
    }

    private static string FromHeader(ResendOptions resend)
    {
        var address = EmailText.Header(resend.FromAddress!);
        var name = string.Concat((resend.FromName ?? string.Empty).Where(c => !char.IsControl(c) && c is not ('"' or '\\' or '<' or '>'))).Trim();
        return name.Length == 0 ? address : $"\"{name}\" <{address}>";
    }

    public async Task<EmailSendResult> SendAsync(EmailSendRequest request, CancellationToken cancellationToken)
    {
        using var message = new HttpRequestMessage(HttpMethod.Post, options.Resend.BaseUrl.TrimEnd('/') + "/emails");
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Resend.ApiKey!.Trim());
        message.Headers.TryAddWithoutValidation("Idempotency-Key", request.IdempotencyKey);
        message.Content = new StringContent(
            JsonSerializer.Serialize(new { from = request.From, to = new[] { request.To }, subject = request.Subject, html = request.Html, text = request.Text }), Encoding.UTF8, "application/json");
        try
        {
            using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            string? body = null;
            try
            {
                // At most MaxAnswerBytes are read: a larger answer is cut and then simply unparseable.
                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                var buffer = new byte[MaxAnswerBytes];
                var read = 0;
                while (read < buffer.Length && await stream.ReadAsync(buffer.AsMemory(read), cancellationToken) is var n and > 0) read += n;
                body = Encoding.UTF8.GetString(buffer, 0, read);
            }
            catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                // The answer's body is unreadable or too large: the status line alone decides below.
            }

            return Classify(response.StatusCode, body, RetryAfter(response.Headers));
        }
        catch (Exception exception) when (exception is HttpRequestException or IOException or OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            // HttpClient.Timeout surfaces as a cancellation that is NOT the caller's: the provider may have received the message and its answer was lost.
            return new EmailSendResult(EmailSendOutcome.Unknown, "no-response");
        }
    }

    internal static EmailSendResult Classify(HttpStatusCode status, string? body, TimeSpan? retryAfter)
    {
        var code = (int)status;
        if (code is >= 200 and < 300)
        {
            var id = Read(body, "id");
            return id is { Length: > 0 and <= 128 } ? new EmailSendResult(EmailSendOutcome.Accepted, "accepted", id) : new EmailSendResult(EmailSendOutcome.Unknown, "accepted-no-id");
        }

        return code switch
        {
            429 => new EmailSendResult(EmailSendOutcome.RateLimited, "rate-limited", RetryAfter: retryAfter),
            401 or 403 or 404 or 405 => new EmailSendResult(EmailSendOutcome.AuthRejected, "provider-refused-access"),
            409 => Read(body, "name") switch
            {
                "invalid_idempotent_request" => new EmailSendResult(EmailSendOutcome.KeyConflict, "key-conflict"),
                "concurrent_idempotent_requests" => new EmailSendResult(EmailSendOutcome.Unknown, "concurrent", RetryAfter: retryAfter),
                _ => new EmailSendResult(EmailSendOutcome.Unknown, "conflict")
            },
            400 or 422 => new EmailSendResult(EmailSendOutcome.Permanent, "rejected"),
            >= 400 and < 500 and not 408 => new EmailSendResult(EmailSendOutcome.Permanent, "rejected"),
            _ => new EmailSendResult(EmailSendOutcome.Unknown, "server-error")
        };
    }

    private static string? Read(string? body, string field)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static TimeSpan? RetryAfter(HttpResponseHeaders headers)
    {
        if (headers.RetryAfter is not { } header) return null;
        if (header.Delta is { } delta) return delta;
        return header.Date is { } date ? date - DateTimeOffset.UtcNow : null;
    }
}
