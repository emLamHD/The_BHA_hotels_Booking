using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using TheBha.Application.Website;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>
/// The only code that talks to Google (OAuth 2.0 authorization-code flow, the userinfo endpoint and Gmail's <c>messages.send</c>).
/// Every answer is an outcome; no exception, secret, token or provider text leaves it, and nothing it receives is logged.
/// </summary>
public sealed class GoogleMailGateway(HttpClient http, NewsletterOptions options, ILogger<GoogleMailGateway> logger) : IGoogleMailGateway
{
    public const string HttpClientName = "newsletter-google";

    private GoogleEndpointOptions Endpoints => options.Google;

    public string BuildAuthorizationUrl(string clientId, string redirectUri, string state, string codeChallenge, bool switchAccount)
    {
        // access_type=offline asks for a refresh token (the mail goes out when no Admin is signed in); prompt=consent makes Google
        // return it even when this account was connected before; select_account is what "change account" needs.
        var prompt = switchAccount ? "select_account consent" : "consent";
        var query = new (string, string)[]
        {
            ("client_id", clientId), ("redirect_uri", redirectUri), ("response_type", "code"),
            ("scope", string.Join(' ', NewsletterSenderRules.Scopes)), ("state", state),
            ("code_challenge", codeChallenge), ("code_challenge_method", "S256"),
            ("access_type", "offline"), ("prompt", prompt), ("include_granted_scopes", "false")
        };
        return Endpoints.AuthorizationEndpoint + "?" + string.Join('&', query.Select(pair => pair.Item1 + "=" + Uri.EscapeDataString(pair.Item2)));
    }

    public async Task<GoogleTokens> ExchangeCodeAsync(string clientId, string clientSecret, string code, string codeVerifier, string redirectUri, CancellationToken cancellationToken)
    {
        var (status, json) = await PostFormAsync(Endpoints.TokenEndpoint,
        [
            ("grant_type", "authorization_code"), ("code", code), ("client_id", clientId), ("client_secret", clientSecret),
            ("redirect_uri", redirectUri), ("code_verifier", codeVerifier)
        ], cancellationToken);
        if (json is null || status is null) return new GoogleTokens(null, null, null, GoogleFailure.Transient);
        if (status != HttpStatusCode.OK) return new GoogleTokens(null, null, null, ClassifyTokenFailure(status.Value, json));
        return new GoogleTokens(Text(json, "access_token"), Text(json, "refresh_token"), Text(json, "scope"), GoogleFailure.None);
    }

    public async Task<GoogleAccessToken> RefreshAccessTokenAsync(string clientId, string clientSecret, string refreshToken, CancellationToken cancellationToken)
    {
        var (status, json) = await PostFormAsync(Endpoints.TokenEndpoint,
            [("grant_type", "refresh_token"), ("refresh_token", refreshToken), ("client_id", clientId), ("client_secret", clientSecret)], cancellationToken);
        if (json is null || status is null) return new GoogleAccessToken(null, GoogleFailure.Transient);
        if (status != HttpStatusCode.OK) return new GoogleAccessToken(null, ClassifyTokenFailure(status.Value, json));
        var token = Text(json, "access_token");
        return token is null ? new GoogleAccessToken(null, GoogleFailure.Rejected) : new GoogleAccessToken(token, GoogleFailure.None);
    }

    public async Task<GoogleUserInfo> GetUserInfoAsync(string accessToken, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, Endpoints.UserInfoEndpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode) return new GoogleUserInfo(null, false, ClassifyStatus(response.StatusCode));
            using var json = await ReadJsonAsync(response, cancellationToken);
            if (json is null) return new GoogleUserInfo(null, false, GoogleFailure.Rejected);
            var verified = json.RootElement.TryGetProperty("email_verified", out var flag) &&
                           (flag.ValueKind == JsonValueKind.True || (flag.ValueKind == JsonValueKind.String && flag.GetString() == "true"));
            return new GoogleUserInfo(Text(json, "email"), verified, GoogleFailure.None);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
        {
            if (cancellationToken.IsCancellationRequested) throw;
            return new GoogleUserInfo(null, false, GoogleFailure.Transient);
        }
    }

    public async Task<GoogleSendOutcome> SendAsync(string accessToken, string rawMessageBase64Url, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoints.SendEndpoint)
            {
                Content = new StringContent(JsonSerializer.Serialize(new { raw = rawMessageBase64Url }), Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.SendAsync(request, cancellationToken);
            var code = (int)response.StatusCode;
            if (response.IsSuccessStatusCode) return GoogleSendOutcome.Sent;
            logger.LogWarning("Gmail send answered {Status}.", code);
            if (code == 401) return GoogleSendOutcome.AuthRevoked;
            if (code == 403)
            {
                using var json = await ReadJsonAsync(response, cancellationToken);
                var reason = json is not null && json.RootElement.TryGetProperty("error", out var error) &&
                             error.ValueKind == JsonValueKind.Object && error.TryGetProperty("errors", out var errors) &&
                             errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0 &&
                             errors[0].TryGetProperty("reason", out var r) ? r.GetString() : null;
                // A limit is a reason to try later; anything else on 403 (insufficient permission, revoked, API disabled) is the connection.
                return reason is "rateLimitExceeded" or "userRateLimitExceeded" or "dailyLimitExceeded" ? GoogleSendOutcome.Unknown : GoogleSendOutcome.AuthRevoked;
            }

            return code is 408 or 429 || code >= 500 ? GoogleSendOutcome.Unknown : GoogleSendOutcome.Rejected;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            if (cancellationToken.IsCancellationRequested) throw;
            // Sent, not answered: the mail may have been accepted. The caller treats this as "unknown", not as a failure.
            logger.LogWarning("Gmail send got no answer.");
            return GoogleSendOutcome.Unknown;
        }
    }

    public async Task RevokeAsync(string token, CancellationToken cancellationToken)
    {
        // Best effort: whatever Google answers, the caller deletes its own copy.
        await PostFormAsync(Endpoints.RevokeEndpoint, [("token", token)], cancellationToken);
    }

    private async Task<(HttpStatusCode? Status, JsonDocument? Json)> PostFormAsync(string url, (string, string)[] form, CancellationToken cancellationToken)
    {
        try
        {
            using var content = new FormUrlEncodedContent(form.Select(pair => new KeyValuePair<string, string>(pair.Item1, pair.Item2)));
            using var response = await http.PostAsync(url, content, cancellationToken);
            return (response.StatusCode, await ReadJsonAsync(response, cancellationToken));
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            if (cancellationToken.IsCancellationRequested) throw;
            return (null, null);
        }
    }

    private static async Task<JsonDocument?> ReadJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            return await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static GoogleFailure ClassifyTokenFailure(HttpStatusCode status, JsonDocument json)
    {
        if (status == HttpStatusCode.BadRequest && Text(json, "error") == "invalid_grant") return GoogleFailure.InvalidGrant;
        return ClassifyStatus(status);
    }

    private static GoogleFailure ClassifyStatus(HttpStatusCode status) =>
        (int)status is 408 or 429 or >= 500 ? GoogleFailure.Transient : GoogleFailure.Rejected;

    private static string? Text(JsonDocument json, string name) =>
        json.RootElement.ValueKind == JsonValueKind.Object && json.RootElement.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
