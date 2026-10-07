using System.Net.Http.Json;
using System.Text.Json;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// Regression coverage for the generated OpenAPI document's booking-header contract.
/// These tests read the actual /swagger/v1/swagger.json output rather than the private
/// IOperationFilter implementations, so a regression that reintroduces a stray or
/// duplicated header is caught even if the filter internals change shape.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BookingOpenApiHeaderContractTests(PostgreSqlWebApplicationFactory factory)
{
    private const string CreateHoldPath = "/api/v1/booking-holds";
    private const string ReadHoldPath = "/api/v1/booking-holds/{holdId}";
    private const string ConfirmHoldPath = "/api/v1/booking-holds/{holdId}/confirm";
    private const string CancelHoldPath = "/api/v1/booking-holds/{holdId}/cancel";
    private const string ReadReservationPath = "/api/v1/reservations/{reservationId}";
    private const string CancelReservationPath = "/api/v1/reservations/{reservationId}/cancel";

    [Fact]
    public async Task Create_hold_declares_exactly_one_idempotency_key_header()
    {
        var operation = await GetOperationAsync(CreateHoldPath, "post");

        Assert.Equal(1, CountHeaders(operation, "Idempotency-Key"));
    }

    [Fact]
    public async Task Create_hold_declares_exactly_one_csrf_header()
    {
        var operation = await GetOperationAsync(CreateHoldPath, "post");

        Assert.Equal(1, CountHeaders(operation, "X-CSRF-TOKEN"));
    }

    [Theory]
    [InlineData(ConfirmHoldPath)]
    [InlineData(CancelHoldPath)]
    [InlineData(CancelReservationPath)]
    public async Task Non_create_unsafe_booking_mutations_declare_zero_idempotency_key_headers(
        string path)
    {
        var operation = await GetOperationAsync(path, "post");

        Assert.Equal(0, CountHeaders(operation, "Idempotency-Key"));
    }

    [Theory]
    [InlineData(CreateHoldPath)]
    [InlineData(ConfirmHoldPath)]
    [InlineData(CancelHoldPath)]
    [InlineData(CancelReservationPath)]
    public async Task Every_current_unsafe_booking_mutation_declares_exactly_one_csrf_header(
        string path)
    {
        var operation = await GetOperationAsync(path, "post");

        Assert.Equal(1, CountHeaders(operation, "X-CSRF-TOKEN"));
    }

    [Theory]
    [InlineData(ReadHoldPath)]
    [InlineData(ReadReservationPath)]
    public async Task Safe_reads_declare_neither_idempotency_key_nor_csrf_header(string path)
    {
        var operation = await GetOperationAsync(path, "get");

        Assert.Equal(0, CountHeaders(operation, "Idempotency-Key"));
        Assert.Equal(0, CountHeaders(operation, "X-CSRF-TOKEN"));
    }

    [Theory]
    [InlineData(ConfirmHoldPath, "post")]
    [InlineData(ReadHoldPath, "get")]
    [InlineData(CancelHoldPath, "post")]
    [InlineData(ReadReservationPath, "get")]
    [InlineData(CancelReservationPath, "post")]
    public async Task Every_guest_booking_access_token_operation_declares_exactly_one_header(
        string path,
        string httpMethod)
    {
        var operation = await GetOperationAsync(path, httpMethod);

        Assert.Equal(1, CountHeaders(operation, "X-Booking-Access-Token"));
    }

    [Fact]
    public async Task Create_hold_declares_zero_guest_access_token_headers()
    {
        // Create Hold's action has no [FromHeader] guest-token parameter, so Swashbuckle
        // never auto-generates one and the shared lifecycle filter never runs for it.
        var operation = await GetOperationAsync(CreateHoldPath, "post");

        Assert.Equal(0, CountHeaders(operation, "X-Booking-Access-Token"));
    }

    [Fact]
    public async Task Guest_access_token_header_schema_and_optionality_are_preserved()
    {
        var operation = await GetOperationAsync(ConfirmHoldPath, "post");

        var header = operation.GetProperty("parameters").EnumerateArray()
            .Single(parameter =>
                string.Equals(
                    parameter.GetProperty("name").GetString(),
                    "X-Booking-Access-Token",
                    StringComparison.OrdinalIgnoreCase));
        Assert.Equal("string", header.GetProperty("schema").GetProperty("type").GetString());
        Assert.False(
            header.TryGetProperty("required", out var requiredProperty) &&
            requiredProperty.GetBoolean());
        Assert.Contains(
            "one-time guest access token",
            header.GetProperty("description").GetString(),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Create_hold_idempotency_key_header_remains_required_with_its_description()
    {
        var operation = await GetOperationAsync(CreateHoldPath, "post");

        var header = operation.GetProperty("parameters").EnumerateArray()
            .Single(parameter =>
                string.Equals(
                    parameter.GetProperty("name").GetString(),
                    "Idempotency-Key",
                    StringComparison.OrdinalIgnoreCase));
        Assert.True(header.GetProperty("required").GetBoolean());
        Assert.Contains(
            "256 UTF-8 bytes",
            header.GetProperty("description").GetString(),
            StringComparison.Ordinal);
    }

    private async Task<JsonElement> GetOperationAsync(string path, string httpMethod)
    {
        using var client = factory.CreateClient();
        var swagger = await client.GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
        return swagger.GetProperty("paths").GetProperty(path).GetProperty(httpMethod);
    }

    /// <summary>
    /// Counts header parameters by name, case-insensitively, so an accidental case-only
    /// duplicate (e.g. a second "x-csrf-token") is still detected as a second occurrence
    /// rather than silently passing a case-sensitive uniqueness check.
    /// </summary>
    private static int CountHeaders(JsonElement operation, string headerName)
    {
        if (!operation.TryGetProperty("parameters", out var parameters))
        {
            return 0;
        }

        return parameters.EnumerateArray()
            .Count(parameter =>
                parameter.GetProperty("in").GetString() == "header" &&
                string.Equals(
                    parameter.GetProperty("name").GetString(),
                    headerName,
                    StringComparison.OrdinalIgnoreCase));
    }
}
