using System.Net;
using System.Text.Json;
using TheBha.Api;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: every problem a public route answers carries a stable, machine-readable <c>code</c>, and its
/// <c>title</c>, <c>detail</c> and status are unchanged. A client picks the message in the visitor's language by the code.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class PublicProblemCodesApiTests(PostgreSqlWebApplicationFactory factory) : WebsiteTestSupport(factory)
{
    [Theory]
    [InlineData(400, "Invalid availability request", "checkIn must be earlier than checkOut.", "validation.dates-order")]
    [InlineData(400, "Invalid booking Hold request", "rooms must be at least one.", "validation.rooms-required")]
    [InlineData(400, "Invalid booking Hold request", "Idempotency-Key cannot exceed 256 UTF-8 bytes.", "validation.idempotency-key-invalid")]
    [InlineData(404, "Property not found", "The requested active property does not exist.", "property.not-found")]
    [InlineData(409, "Booking Hold conflict", "The selected rooms are no longer available for the complete stay.", "hold.rooms-unavailable")]
    [InlineData(409, "Booking Hold conflict", "The current offer cannot be held: something", "hold.offer-not-holdable")]
    [InlineData(409, "Booking Hold cannot be confirmed", "The Hold cannot be confirmed: The Hold has expired and cannot be confirmed.", "hold.expired")]
    [InlineData(409, "Booking Hold cannot be confirmed", "The Hold is not in a confirmable state.", "hold.not-confirmable")]
    [InlineData(401, "Authentication failed", "The supplied credentials are invalid.", "auth.invalid-credentials")]
    [InlineData(429, "Too many requests", "Please wait.", "auth.rate-limited")]
    [InlineData(400, "One or more validation errors occurred.", null, "request.invalid")]
    [InlineData(500, "An error occurred while processing your request.", null, "error.unexpected")]
    [InlineData(409, "Something new", "x", "request.conflict")]
    public void A_public_problem_gets_a_stable_code_from_what_the_api_already_says(int status, string title, string? detail, string code) =>
        Assert.Equal(code, PublicProblemCodes.Resolve(status, title, detail));

    private static async Task<(HttpStatusCode Status, JsonElement Body)> ReadAsync(HttpClient client, string path, HttpMethod? method = null, string? body = null)
    {
        var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
        if (body is not null)
        {
            request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        }

        var response = await client.SendAsync(request);
        return (response.StatusCode, await JsonAsync(response));
    }

    [Fact]
    public async Task Real_error_paths_carry_the_code_and_keep_their_english_title_detail_and_status()
    {
        using var session = await StartAsync();
        var property = await ScalarAsync<Guid>("""SELECT "Id" FROM "Properties" LIMIT 1""");
        var availability = $"/api/v1/properties/{property}/availability";

        var (status, problem) = await ReadAsync(session.Client, $"{availability}?checkIn=2099-01-05&checkOut=2099-01-02&adults=2&children=0&rooms=1");
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Equal("validation.dates-order", problem.GetProperty("code").GetString());
        Assert.Equal("Invalid availability request", problem.GetProperty("title").GetString());
        Assert.Equal("checkIn must be earlier than checkOut.", problem.GetProperty("detail").GetString());

        (status, problem) = await ReadAsync(session.Client, $"{availability}?checkIn=2099-01-02&checkOut=2099-03-30&adults=2&children=0&rooms=1");
        Assert.Equal("validation.stay-too-long", problem.GetProperty("code").GetString());
        (status, problem) = await ReadAsync(session.Client, $"{availability}?checkIn=2099-01-02&checkOut=2099-01-04&adults=0&children=0&rooms=1");
        Assert.Equal("validation.adults-required", problem.GetProperty("code").GetString());
        (status, problem) = await ReadAsync(session.Client, $"{availability}?checkIn=2099-01-02&checkOut=2099-01-04&adults=2&children=0&rooms=11");
        Assert.Equal("validation.rooms-too-many", problem.GetProperty("code").GetString());
        (status, problem) = await ReadAsync(session.Client, "/api/v1/properties/00000000-0000-0000-0000-000000000009/availability?checkIn=2099-01-02&checkOut=2099-01-04&adults=2&children=0&rooms=1");
        Assert.Equal((HttpStatusCode.NotFound, "property.not-found"), (status, problem.GetProperty("code").GetString()));
        (status, problem) = await ReadAsync(session.Client, "/api/v1/room-types/00000000-0000-0000-0000-000000000009");
        Assert.Equal("room-type.not-found", problem.GetProperty("code").GetString());
        (status, problem) = await ReadAsync(session.Client, $"{availability}?checkIn=2099-01-02");
        Assert.Equal((HttpStatusCode.BadRequest, "request.invalid"), (status, problem.GetProperty("code").GetString()));
        (status, problem) = await ReadAsync(session.Client, "/api/v1/auth/me");
        Assert.Equal((HttpStatusCode.Unauthorized, "auth.required"), (status, problem.GetProperty("code").GetString()));
        (status, problem) = await ReadAsync(session.Client, "/api/v1/booking-holds/00000000-0000-0000-0000-000000000009");
        Assert.Equal((HttpStatusCode.Unauthorized, "booking.credential-invalid"), (status, problem.GetProperty("code").GetString()));
    }

    [Fact]
    public async Task Admin_routes_keep_their_own_codes_untouched()
    {
        using var session = await StartAsync();
        var refused = await session.PostAsync("/api/admin/v1/website/languages/zz/update", new { expectedVersion = 1, displayName = "x", nativeName = "x", sortOrder = 1, isActive = false });
        var body = await JsonAsync(refused);
        Assert.Equal(HttpStatusCode.NotFound, refused.StatusCode);
        Assert.False(body.TryGetProperty("code", out var code) && code.GetString()!.StartsWith("request.", StringComparison.Ordinal));
    }
}
