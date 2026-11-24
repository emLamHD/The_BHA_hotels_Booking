using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TheBha.IntegrationTests;

/// <summary>BHA-CHECKOUT-001-PR05 D-01: the published contract (OpenAPI), the browser boundary (CORS preflight for the headers the route needs) and the rate limit, which refuses before anything is written.</summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class DirectReservationContractTests(PostgreSqlWebApplicationFactory factory) : DirectReservationTestSupport(factory)
{
    private const string CustomerOrigin = "https://customer.example";
    private static readonly string[] RequestFields =
        ["propertyId", "roomTypeId", "ratePlanId", "checkIn", "checkOut", "adults", "children", "rooms", "fullName", "email", "phone", "expectedTotalAmount", "expectedCurrencyCode", "paymentMethod"];

    [Fact]
    public async Task The_published_contract_names_the_headers_the_fields_and_every_declared_answer_and_defines_no_money_field_to_set()
    {
        using var host = Host();
        using var client = host.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        var operation = swagger.GetProperty("paths").GetProperty("/api/v1/reservations").GetProperty("post");

        int Count(string name) => operation.GetProperty("parameters").EnumerateArray().Count(parameter =>
            parameter.GetProperty("in").GetString() == "header" && string.Equals(parameter.GetProperty("name").GetString(), name, StringComparison.OrdinalIgnoreCase));
        JsonElement Header(string name) => operation.GetProperty("parameters").EnumerateArray().Single(parameter =>
            parameter.GetProperty("in").GetString() == "header" && string.Equals(parameter.GetProperty("name").GetString(), name, StringComparison.OrdinalIgnoreCase));
        Assert.Equal((1, 1, 1), (Count("Idempotency-Key"), Count("X-Booking-Access-Token"), Count("X-CSRF-TOKEN")));
        Assert.True(Header("Idempotency-Key").GetProperty("required").GetBoolean());
        Assert.True(Header("X-CSRF-TOKEN").GetProperty("required").GetBoolean());
        Assert.False(Header("X-Booking-Access-Token").TryGetProperty("required", out var tokenRequired) && tokenRequired.GetBoolean());
        Assert.Contains("32 random bytes", Header("X-Booking-Access-Token").GetProperty("description").GetString(), StringComparison.Ordinal);

        foreach (var status in new[] { "200", "201", "400", "401", "404", "409", "429", "503" })
        {
            Assert.True(operation.GetProperty("responses").TryGetProperty(status, out var response), $"response {status} is declared");
            Assert.False(string.IsNullOrWhiteSpace(response.GetProperty("description").GetString()));
        }

        Assert.Contains("reservation.price-changed", operation.GetProperty("responses").GetProperty("409").GetProperty("description").GetString(), StringComparison.Ordinal);
        Assert.Contains("booking.closed", operation.GetProperty("responses").GetProperty("503").GetProperty("description").GetString(), StringComparison.Ordinal);
        Assert.Contains("PayAtProperty", operation.GetProperty("description").GetString(), StringComparison.Ordinal);

        var schemaName = operation.GetProperty("requestBody").GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()!.Split('/').Last();
        var fields = swagger.GetProperty("components").GetProperty("schemas").GetProperty(schemaName).GetProperty("properties").EnumerateObject().Select(property => property.Name).Order().ToArray();
        Assert.Equal(RequestFields.Order().ToArray(), fields); // nothing that could set a deposit, a fee or an amount to collect

        var created = operation.GetProperty("responses").GetProperty("201").GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()!.Split('/').Last();
        var answer = swagger.GetProperty("components").GetProperty("schemas").GetProperty(created).GetProperty("properties").EnumerateObject().Select(property => property.Name).ToArray();
        foreach (var added in new[] { "paymentMethod", "ledgerState", "receivableAmount", "collectedAmount", "balanceDueAmount" })
        {
            Assert.Contains(added, answer);
        }

        // The legacy contracts keep their shape: the reservation read answer has none of the Direct-only fields, and the Hold create now declares its 503.
        var read = swagger.GetProperty("paths").GetProperty("/api/v1/reservations/{reservationId}").GetProperty("get").GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()!.Split('/').Last();
        Assert.DoesNotContain("paymentMethod", swagger.GetProperty("components").GetProperty("schemas").GetProperty(read).GetProperty("properties").EnumerateObject().Select(property => property.Name));
        Assert.True(swagger.GetProperty("paths").GetProperty("/api/v1/booking-holds").GetProperty("post").GetProperty("responses").TryGetProperty("503", out _));
    }

    [Fact]
    public async Task A_browser_preflight_from_the_allowed_https_origin_may_send_exactly_the_headers_the_route_needs_and_another_origin_gets_nothing()
    {
        await SeedAsync();
        using var host = Host(settings: ("Cors:AllowedOrigins:0", CustomerOrigin));
        using var client = host.CreateClient();

        HttpRequestMessage Preflight(string origin, string headers)
        {
            var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/reservations");
            request.Headers.Add("Origin", origin);
            request.Headers.Add("Access-Control-Request-Method", "POST");
            request.Headers.Add("Access-Control-Request-Headers", headers);
            return request;
        }

        var allowed = await client.SendAsync(Preflight(CustomerOrigin, "content-type,idempotency-key,x-booking-access-token,x-csrf-token"));

        Assert.Equal(HttpStatusCode.NoContent, allowed.StatusCode);
        Assert.Equal(CustomerOrigin, allowed.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("true", allowed.Headers.GetValues("Access-Control-Allow-Credentials").Single());
        var headers = string.Join(',', allowed.Headers.GetValues("Access-Control-Allow-Headers")).ToLowerInvariant();
        foreach (var needed in new[] { "content-type", "idempotency-key", "x-booking-access-token", "x-csrf-token" })
        {
            Assert.Contains(needed, headers, StringComparison.Ordinal);
        }

        Assert.Contains("POST", allowed.Headers.GetValues("Access-Control-Allow-Methods").Single(), StringComparison.Ordinal);

        var stranger = await client.SendAsync(Preflight("https://evil.example", "content-type,idempotency-key"));
        Assert.False(stranger.Headers.Contains("Access-Control-Allow-Origin"));
        var insecure = await client.SendAsync(Preflight("http://customer.example", "content-type"));
        Assert.False(insecure.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal(NothingWritten, await FootprintAsync()); // a preflight books nothing

        // The real request from the allowed origin carries the credentials answer too.
        using var post = new HttpRequestMessage(HttpMethod.Post, "/api/v1/reservations") { Content = JsonContent.Create(Body()) };
        post.Headers.Add("Origin", CustomerOrigin);
        var csrf = (await (await client.GetAsync("/api/v1/auth/csrf")).Content.ReadFromJsonAsync<Csrf>())!;
        post.Headers.Add(csrf.HeaderName, csrf.Token);
        post.Headers.Add("Idempotency-Key", "cors-key");
        post.Headers.Add("X-Booking-Access-Token", NewToken());
        var response = await client.SendAsync(post);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(CustomerOrigin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task The_rate_limit_refuses_the_request_over_the_limit_before_anything_is_written_and_only_this_route_is_limited()
    {
        await SeedAsync();
        using var host = Host(settings: [("Booking:DirectCheckout:RateLimiting:PermitLimit", "2"), ("Booking:DirectCheckout:RateLimiting:WindowSeconds", "600")]);
        using var client = host.CreateClient();

        var first = await PostAsync(client, "limit-1", Body(startOffset: 3), NewToken());
        var second = await PostAsync(client, "limit-2", Body(startOffset: 5), NewToken());
        var third = await PostAsync(client, "limit-3", Body(startOffset: 7), NewToken());

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created, HttpStatusCode.TooManyRequests], [first.StatusCode, second.StatusCode, third.StatusCode]);
        var problem = await JsonAsync(third);
        Assert.Equal("booking.rate-limited", Code(problem));
        Assert.Equal("Too many requests", problem.GetProperty("title").GetString());
        Assert.DoesNotContain("authentication", problem.GetProperty("detail").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, await CountAsync("Reservations")); // the over-limit request, valid and new, wrote nothing
        Assert.Equal(2, await CountAsync("FolioEntries"));
        Assert.Equal(2, await CountAsync("EmailOutboxEvents"));
        Assert.Equal(2, await CountAsync("ReservationCreationRequests"));

        // Not limited: reading a reservation, the Hold route, and a replay is also a request to this route (it counts), but a preflight does not.
        using var read = new HttpRequestMessage(HttpMethod.Get, first.Headers.Location);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(read)).StatusCode); // answered (no credential), not 429
        using var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/v1/reservations");
        preflight.Headers.Add("Origin", CustomerOrigin);
        preflight.Headers.Add("Access-Control-Request-Method", "POST");
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await client.SendAsync(preflight)).StatusCode);
    }

    [Fact]
    public async Task A_forwarded_client_address_header_cannot_buy_a_fresh_rate_limit_window_when_no_proxy_is_trusted()
    {
        await SeedAsync();
        using var host = Host(settings: [("Booking:DirectCheckout:RateLimiting:PermitLimit", "1"), ("Booking:DirectCheckout:RateLimiting:WindowSeconds", "600")]);
        using var client = host.CreateClient();

        var first = await PostAsync(client, "xff-1", Body(startOffset: 3), NewToken(), tweak: request => request.Headers.Add("X-Forwarded-For", "203.0.113.10"));
        var second = await PostAsync(client, "xff-2", Body(startOffset: 5), NewToken(), tweak: request => request.Headers.Add("X-Forwarded-For", "203.0.113.11"));

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode); // identity is the connection, never a header, an e-mail or a token the client states
        Assert.Equal(1, await CountAsync("Reservations"));
    }
}
