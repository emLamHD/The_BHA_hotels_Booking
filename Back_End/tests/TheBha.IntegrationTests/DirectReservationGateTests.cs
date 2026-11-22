using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using TheBha.Application.Bookings;

namespace TheBha.IntegrationTests;

/// <summary>BHA-CHECKOUT-001-PR05 D-06: the two switches (defaults, per Property, stop-sell untouched) and what each does and does not stop.</summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class DirectReservationGateTests(PostgreSqlWebApplicationFactory factory) : DirectReservationTestSupport(factory)
{
    [Fact]
    public async Task By_default_Direct_is_off_for_every_property_but_holds_still_work()
    {
        await SeedAsync();
        using var host = Host(enableDirect: false); // no Booking setting at all
        using var client = host.CreateClient();

        var direct = await PostAsync(client, "default-off", Body(), NewToken());

        Assert.Equal(HttpStatusCode.Conflict, direct.StatusCode);
        Assert.Equal("checkout.direct-unavailable", Code(await JsonAsync(direct)));
        Assert.Equal(NothingWritten, await FootprintAsync());
        Assert.Equal(HttpStatusCode.Created, (await PostHoldAsync(client, "hold-still-works", HoldBody())).StatusCode);
    }

    [Fact]
    public async Task The_allow_list_is_per_property_a_listed_other_property_does_not_enable_this_one()
    {
        await SeedAsync();
        using var other = Host(enableDirect: false, settings: ("Booking:DirectCheckout:PropertyIds:0", Guid.NewGuid().ToString()));
        using var otherClient = other.CreateClient();
        var refused = await PostAsync(otherClient, "other-listed", Body(), NewToken());
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("checkout.direct-unavailable", Code(await JsonAsync(refused)));

        using var both = Host(settings: ("Booking:DirectCheckout:PropertyIds:1", Guid.NewGuid().ToString())); // this Property and another
        using var bothClient = both.CreateClient();
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(bothClient, "both-listed", Body(), NewToken())).StatusCode);
    }

    [Fact]
    public async Task A_stop_sell_stops_a_Direct_booking_and_a_Hold_alike_and_no_switch_overrides_it()
    {
        await SeedAsync();
        await StopSellAsync(DeluxeId, CheckIn);
        using var host = Host(); // Direct on, intake accepting
        using var client = host.CreateClient();

        var direct = await PostAsync(client, "stop-direct", Body(), NewToken());
        var hold = await PostHoldAsync(client, "stop-hold", HoldBody());

        Assert.Equal(HttpStatusCode.Conflict, direct.StatusCode);
        Assert.Equal("reservation.rooms-unavailable", Code(await JsonAsync(direct)));
        Assert.Equal(HttpStatusCode.Conflict, hold.StatusCode);
        Assert.Equal("hold.rooms-unavailable", Code(await JsonAsync(hold)));
        Assert.Equal(NothingWritten, await FootprintAsync());
    }

    [Fact]
    public async Task Stopping_intake_refuses_new_holds_and_new_direct_bookings_but_not_replays_reads_cancellations_or_confirming_an_active_hold()
    {
        await SeedAsync();
        var directToken = NewToken();
        Guid reservationId, holdId;
        string holdToken;
        using (var open = Host())
        using (var client = open.CreateClient())
        {
            var direct = await PostAsync(client, "before-direct", Body(startOffset: 3), directToken);
            Assert.Equal(HttpStatusCode.Created, direct.StatusCode);
            reservationId = (await JsonAsync(direct)).GetProperty("reservationId").GetGuid();
            var hold = await JsonAsync(await PostHoldAsync(client, "before-hold", HoldBody(startOffset: 6)));
            holdId = hold.GetProperty("holdId").GetGuid();
            holdToken = hold.GetProperty("guestAccessToken").GetString()!;
        }

        using var closed = Host(settings: ("Booking:AcceptingNewReservations", "false"));
        using var late = closed.CreateClient();

        var newHold = await PostHoldAsync(late, "after-hold", HoldBody(startOffset: 9));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, newHold.StatusCode);
        Assert.Equal("booking.closed", Code(await JsonAsync(newHold)));
        var newDirect = await PostAsync(late, "after-direct", Body(startOffset: 9), NewToken());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, newDirect.StatusCode);
        Assert.Equal("booking.closed", Code(await JsonAsync(newDirect)));

        Assert.Equal(HttpStatusCode.OK, (await PostHoldAsync(late, "before-hold", HoldBody(startOffset: 6))).StatusCode); // replay of a Hold that committed
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(late, "before-direct", Body(startOffset: 3), directToken)).StatusCode); // replay of a Direct reservation that committed
        using var read = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/reservations/{reservationId}");
        read.Headers.Add("X-Booking-Access-Token", directToken);
        Assert.Equal(HttpStatusCode.OK, (await late.SendAsync(read)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await ConfirmAsync(late, holdId, holdToken)).StatusCode); // OI-5: an Active Hold still confirms
        var csrf = (await (await late.GetAsync("/api/v1/auth/csrf")).Content.ReadFromJsonAsync<Csrf>())!;
        using var cancel = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/reservations/{reservationId}/cancel") { Content = JsonContent.Create(new { reason = "Changed plans" }) };
        cancel.Headers.Add("X-Booking-Access-Token", directToken);
        cancel.Headers.Add(csrf.HeaderName, csrf.Token);
        Assert.Equal(HttpStatusCode.OK, (await late.SendAsync(cancel)).StatusCode);
        Assert.Equal(2, await CountAsync("Reservations"));
        Assert.Equal(1, await CountAsync("ReservationCreationRequests"));
    }

    [Theory]
    [InlineData("Booking:DirectCheckout:PropertyIds:0", "not-a-guid")]
    [InlineData("Booking:DirectCheckout:PropertyIds:0", "00000000-0000-0000-0000-000000000000")]
    [InlineData("Booking:AcceptingNewReservations", "maybe")]
    [InlineData("Booking:DirectCheckout:RateLimiting:PermitLimit", "0")]
    [InlineData("Booking:DirectCheckout:RateLimiting:WindowSeconds", "-1")]
    public void A_setting_that_cannot_work_stops_the_host_before_it_listens(string key, string value)
    {
        using var host = factory.WithWebHostBuilder(builder => builder.UseSetting(key, value));

        Assert.ThrowsAny<Exception>(() => host.CreateClient());
    }

    [Fact]
    public void The_same_property_listed_twice_stops_the_host()
    {
        var id = PropertyId.ToString();
        using var host = factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Booking:DirectCheckout:PropertyIds:0", id);
            builder.UseSetting("Booking:DirectCheckout:PropertyIds:1", id.ToUpperInvariant());
        });

        var failure = Assert.ThrowsAny<Exception>(() => host.CreateClient());
        Assert.Contains("twice", failure.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Without_any_setting_the_host_starts_with_intake_open_and_Direct_off()
    {
        using var host = factory.WithWebHostBuilder(_ => { });

        var intake = host.Services.GetService(typeof(BookingIntake)) as BookingIntake;

        Assert.NotNull(intake);
        Assert.True(intake.AcceptingNewReservations);
        Assert.Empty(intake.DirectPropertyIds);
    }
}
