using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TheBha.Application.Notifications;
using TheBha.Domain.Notifications;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;
using TheBha.Infrastructure.Persistence.Notifications;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR07 (M-01..M-07): the booking-confirmation mails, from a real Direct reservation through the real dispatcher to the Resend stub, on real PostgreSQL. Synthetic data only; the provider is the stub,
/// the clock is fixed, the key ring is the host's own.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed partial class BookingConfirmationEmailTests(PostgreSqlWebApplicationFactory factory) : ReservationManagementTestSupport(factory)
{
    private const string GuestAddress = "guest@example.com";
    private const string FrontDesk = "front@riverside.example";
    private static readonly Guid OtherPropertyId = Guid.Parse("10000000-0000-0000-0000-0000000000f2");

    [GeneratedRegex(@"https://localhost:3000/reservations/([0-9a-f-]{36})/manage#([A-Za-z0-9_-]{43})")]
    private static partial Regex LinkShape();

    private WebApplicationFactory<Program> Stack(ResendStub stub, CapturingLoggerProvider? logs = null, params (string Key, string Value)[] settings) =>
        ManageHost(
            builder =>
            {
                builder.ConfigureServices(services => services.AddHttpClient(ResendEmailTransport.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => stub));
                if (logs is not null) builder.ConfigureLogging(logging => { logging.SetMinimumLevel(LogLevel.Trace); logging.AddProvider(logs); });
            },
            [
                ("Email:Outbox:DispatchEnabled", "true"),
                ("Email:Outbox:Resend:ApiKey", OutboxTest.ApiKey),
                ("Email:Outbox:Resend:FromAddress", OutboxTest.FromAddress),
                ("Booking:ConfirmationEmail:Enabled", "true"),
                ("Booking:ConfirmationEmail:CustomerWebOrigin", CustomerOrigin),
                .. settings
            ]);

    private async Task<Guid> BookAsync(WebApplicationFactory<Program> host, string key, string email = GuestAddress, string name = "Guest Name", int startOffset = 3)
    {
        using var client = Https(host);
        var response = await PostAsync(client, key, Body(email: email, name: name, startOffset: startOffset), NewToken());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await JsonAsync(response)).GetProperty("reservationId").GetGuid();
    }

    private Task<long> Count(string sql) => ScalarAsync<long>(sql);

    private Task<long> Links() => Count("""SELECT count(*) AS "Value" FROM "ReservationManagementLinks" """);

    private Task<long> Deliveries() => Count("""SELECT count(*) AS "Value" FROM "EmailOutboxDeliveries" """);

    private Task SetFallbackAsync(string email, Guid? property = null) =>
        ExecuteAsync($"""INSERT INTO "BookingNotificationFallbacks" ("PropertyId","Email","Version","UpdatedAtUtc") VALUES ('{property ?? PropertyId}','{email}',1,now())""");

    private async Task<Guid> AddStaffAsync(string login, string role, string? notificationEmail, bool enabled = true, Guid? property = null, Guid? id = null)
    {
        var staffId = id ?? Guid.NewGuid();
        await using var context = Factory.CreateDbContext();
        context.StaffAccounts.Add(new StaffAccount
        {
            Id = staffId, Email = login, UserName = login, NormalizedEmail = login.ToUpperInvariant(), NormalizedUserName = login.ToUpperInvariant(),
            SecurityStamp = Guid.NewGuid().ToString(), ConcurrencyStamp = Guid.NewGuid().ToString(), CreatedAtUtc = FixedUtc
        });
        context.StaffPropertyMemberships.Add(new StaffPropertyMembership { StaffAccountId = staffId, PropertyId = property ?? PropertyId, Role = role, CreatedAtUtc = FixedUtc });
        await context.SaveChangesAsync();
        if (notificationEmail is not null || !enabled)
        {
            var email = notificationEmail is null ? "NULL" : $"'{notificationEmail}'";
            await ExecuteAsync($"""INSERT INTO "StaffBookingNotificationPreferences" ("PropertyId","StaffAccountId","NotificationEmail","IsEnabled","Version","CreatedAtUtc","UpdatedAtUtc") VALUES ('{property ?? PropertyId}','{staffId}',{email},{(enabled ? "true" : "false")},1,now(),now())""");
        }

        return staffId;
    }

    private async Task AddOtherPropertyAsync()
    {
        await ExecuteAsync($"""INSERT INTO "Properties" ("Id","Name","Slug","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt","ContentVersion") VALUES ('{OtherPropertyId}','Other Hotel','other-hotel-pr07','2 Street','Hue','Vietnam','Asia/Ho_Chi_Minh','14:00','12:00',true,now(),now(),1)""");
    }

    private static string Text(ResendStub.Call call) => call.Json.GetProperty("text").GetString()!;

    private static string Html(ResendStub.Call call) => call.Json.GetProperty("html").GetString()!;

    private static string Subject(ResendStub.Call call) => call.Json.GetProperty("subject").GetString()!;

    private static Task RunAsync(WebApplicationFactory<Program> host) => OutboxTest.RunAsync(host.Services);

    private async Task<EmailOutboxDelivery[]> DeliveryRowsAsync() => (await OutboxTest.DeliveriesAsync(Factory)).ToArray();

    // ------------------------------------------------------------------ M-01

    [Fact]
    public async Task M01_a_guest_booking_reaches_the_stub_with_the_property_data_one_link_and_only_the_properties_staff()
    {
        await SeedAsync();
        await AddOtherPropertyAsync();
        await SetFallbackAsync(FrontDesk);
        await AddStaffAsync("other.login@example.com", StaffRole.Manager, "other-manager@other.example", property: OtherPropertyId);
        var stub = new ResendStub();
        using var host = Stack(stub);
        var reservationId = await BookAsync(host, "m01-guest");

        var result = await OutboxTest.RunAsync(host.Services);

        Assert.Equal(new EmailOutboxBatchResult(1, 2), result);
        var calls = stub.CallList;
        Assert.Equal([FrontDesk, GuestAddress], calls.Select(call => call.To).Order().ToArray());
        var guest = calls.Single(call => call.To == GuestAddress);
        var staff = calls.Single(call => call.To == FrontDesk);
        var confirmation = await ScalarAsync<string>("""SELECT "ConfirmationNumber" AS "Value" FROM "Reservations" """);
        Assert.Contains(confirmation, Subject(guest));
        Assert.Contains("The BHA Hotel", Subject(guest));
        foreach (var piece in new[] { confirmation, "The BHA Hotel", "1 BHA Avenue, Ho Chi Minh City", "14:00", "26/07/2026", "27/07/2026", "1.500.000 VND", "Thanh toán khi nhận phòng" })
        {
            Assert.Contains(piece, Text(guest));
        }

        var link = LinkShape().Match(Text(guest));
        Assert.True(link.Success);
        Assert.Equal(reservationId, Guid.Parse(link.Groups[1].Value));
        Assert.Equal(1, await Links());
        Assert.Equal(1, LinkShape().Matches(Html(guest)).Count);

        // The Property mail: who, where, when, how many rooms, how they pay. No link, no guest address or phone.
        foreach (var piece in new[] { confirmation, "The BHA Hotel", "26/07/2026", "27/07/2026", "Số phòng: 1", "Thanh toán tại cơ sở", "Guest Name" })
        {
            Assert.Contains(piece, Text(staff));
        }

        Assert.DoesNotContain("/manage", Text(staff) + Html(staff));
        Assert.DoesNotContain(link.Groups[2].Value, Text(staff) + Html(staff) + Subject(staff));
        Assert.DoesNotContain(GuestAddress, Text(staff) + Html(staff) + Subject(staff));
        Assert.DoesNotContain("4567", Text(staff) + Html(staff));
        foreach (var subject in new[] { Subject(guest), Subject(staff) })
        {
            Assert.DoesNotContain("Guest Name", subject);
            Assert.DoesNotContain(GuestAddress, subject);
            Assert.DoesNotContain("manage", subject);
        }

        // Other Property's Staff never receive it.
        Assert.DoesNotContain(calls, call => call.To.Contains("other.example"));
        var rows = await DeliveryRowsAsync();
        Assert.All(rows, row => Assert.Equal(EmailOutboxDelivery.StatusAccepted, row.Status));
        Assert.Equal([BookingEmailPurposes.GuestWithLink, BookingEmailPurposes.Staff], rows.Select(row => row.Purpose).Order().ToArray());
        Assert.Equal("Completed", await ScalarAsync<string>("""SELECT "Status" AS "Value" FROM "EmailOutboxEvents" """));
    }

    [Fact]
    public async Task M01_an_account_booking_gets_its_own_confirmation_and_no_guest_link()
    {
        await SeedAsync();
        var stub = new ResendStub();
        using var host = Stack(stub);
        using var client = host.CreateClient();
        await CreateCustomerAsync(host, client, "account-owner@example.com");
        var response = await PostAsync(client, "m01-account", Body());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        await RunAsync(host);

        var call = Assert.Single(stub.CallList);
        Assert.Equal(GuestAddress, call.To);
        Assert.DoesNotContain("/manage", Text(call) + Html(call));
        Assert.Contains("tài khoản", Text(call));
        Assert.Equal(0, await Links());
        Assert.Equal(BookingEmailPurposes.Account, (await DeliveryRowsAsync()).Single().Purpose);
    }

    [Fact]
    public async Task M01_a_cancelled_booking_a_hold_and_a_bad_event_make_no_confirmation()
    {
        await SeedAsync();
        await SetFallbackAsync(FrontDesk);
        var stub = new ResendStub();
        using var host = Stack(stub);
        Guid cancelled;
        using (var guest = Https(host))
        {
            var token = NewToken();
            cancelled = (await JsonAsync(await PostAsync(guest, "m01-cancelled", Body(), token))).GetProperty("reservationId").GetGuid();
            var csrf = (await (await guest.GetAsync("/api/v1/auth/csrf")).Content.ReadFromJsonAsync<Csrf>())!;
            using var cancel = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/reservations/{cancelled}/cancel") { Content = JsonContent.Create(new { reason = "changed plans" }) };
            cancel.Headers.Add("X-Booking-Access-Token", token);
            cancel.Headers.Add(csrf.HeaderName, csrf.Token);
            Assert.Equal(HttpStatusCode.OK, (await guest.SendAsync(cancel)).StatusCode); // cancelled before the dispatcher ever reads the event
        }

        // A Hold-sourced reservation writes no event of its own (unchanged behaviour); a hand-queued one for it is refused.
        using var client = Https(host);
        var hold = await JsonAsync(await PostHoldAsync(client, "m01-hold", HoldBody(startOffset: 8)));
        var confirm = await ConfirmAsync(client, hold.GetProperty("holdId").GetGuid(), hold.GetProperty("guestAccessToken").GetString()!);
        Assert.Equal(HttpStatusCode.Created, confirm.StatusCode);
        Assert.Equal(1, await Count("""SELECT count(*) AS "Value" FROM "EmailOutboxEvents" """));
        var holdReservation = (await JsonAsync(confirm)).GetProperty("reservationId").GetGuid();
        await OutboxTest.EnqueueAsync(host.Services, PropertyId, type: "ReservationConfirmed", payload: $$"""{"reservationId":"{{holdReservation}}"}""");
        await OutboxTest.EnqueueAsync(host.Services, PropertyId, type: "ReservationConfirmed", payload: """{"reservationId":"not-a-guid"}""");
        await OutboxTest.EnqueueAsync(host.Services, PropertyId, type: "ReservationConfirmed", payload: $$"""{"reservationId":"{{cancelled}}","extra":"x"}""");
        await OutboxTest.EnqueueAsync(host.Services, PropertyId, type: "ReservationConfirmed", payload: """{"reservationId":"00000000-0000-0000-0000-0000000000aa"}""");

        await RunAsync(host);

        Assert.Empty(stub.CallList);
        Assert.Equal(0, await Deliveries());
        Assert.Equal(0, await Links());
        // The cancelled one completed with nothing; the others are counted failures with a fixed safe code.
        var outcomes = await ScalarAsync<string>("""SELECT string_agg("Status" || ':' || "FanoutAttempts" || ':' || coalesce("LastOutcome",''), ',' ORDER BY "LastOutcome") AS "Value" FROM "EmailOutboxEvents" """);
        Assert.Equal("Completed:0:fanned-out,Pending:1:payload-invalid,Pending:1:payload-invalid,Pending:1:reservation-not-direct,Pending:1:reservation-not-found", outcomes);
    }

    // ------------------------------------------------------------------ M-02

    [Fact]
    public async Task M02_recipients_follow_the_resolver_local_chain_opt_out_duplicates_fallback_and_an_empty_list()
    {
        await SeedAsync();
        var chain = Guid.NewGuid();
        var stub = new ResendStub();
        using var host = Stack(stub, null,
            ("BookingNotifications:ChainManagers:0:StaffId", chain.ToString()), ("BookingNotifications:ChainManagers:0:Email", "chain.boss@chain.example"));
        await AddStaffAsync("desk.a@login.example", StaffRole.FrontDesk, "desk@hotel.example");
        await AddStaffAsync("desk.b@login.example", StaffRole.FrontDesk, "DESK@hotel.example"); // same address: collapses
        await AddStaffAsync("optout@login.example", StaffRole.FrontDesk, "optout@hotel.example", enabled: false);
        await AddStaffAsync("chain@login.example", StaffRole.Manager, null, id: chain);
        await AddStaffAsync("nopref@login.example", StaffRole.FrontDesk, null); // no address: not a recipient, login address never used
        await SetFallbackAsync(FrontDesk); // only used when the list is empty
        await BookAsync(host, "m02-a");

        await RunAsync(host);

        var staffTo = stub.CallList.Where(call => call.To != GuestAddress).Select(call => call.To.ToLowerInvariant()).Order().ToArray();
        Assert.Equal(["chain.boss@chain.example", "desk@hotel.example"], staffTo);
        Assert.DoesNotContain(stub.CallList, call => call.To.Contains("login.example") || call.To.Contains("optout@") || call.To == FrontDesk);
        Assert.Single(stub.CallList, call => call.To == GuestAddress);
    }

    [Fact]
    public async Task M02_the_fallback_is_used_only_when_nobody_else_is_eligible_and_an_empty_set_still_mails_the_guest()
    {
        await SeedAsync();
        var stub = new ResendStub();
        using var host = Stack(stub);
        await BookAsync(host, "m02-empty");
        await RunAsync(host);
        Assert.Equal([GuestAddress], stub.CallList.Select(call => call.To).ToArray()); // nobody configured: the guest mail only

        await SetFallbackAsync(FrontDesk);
        await BookAsync(host, "m02-fallback", startOffset: 5);
        await RunAsync(host);
        Assert.Equal(2, stub.CallList.Count(call => call.To == GuestAddress));
        Assert.Single(stub.CallList, call => call.To == FrontDesk);
    }

    [Fact]
    public async Task M02_a_missing_or_invalid_guest_address_still_mails_the_staff_with_a_filtered_diagnostic_and_no_link()
    {
        await SeedAsync();
        await SetFallbackAsync(FrontDesk);
        var logs = new CapturingLoggerProvider();
        var stub = new ResendStub();
        using var host = Stack(stub, logs);
        var id = await BookAsync(host, "m02-bad-address");
        await ExecuteAsync($"""UPDATE "Reservations" SET "Email"='not an address' WHERE "Id"='{id}'""");

        await RunAsync(host);

        Assert.Equal([FrontDesk], stub.CallList.Select(call => call.To).ToArray());
        Assert.Equal(0, await Links());
        var diagnostics = string.Join('\n', logs.Lines);
        Assert.Contains("guest-address-invalid", diagnostics);
        Assert.DoesNotContain("not an address", diagnostics);
    }

    [Theory]
    [InlineData("membership")]
    [InlineData("opt-out")]
    [InlineData("address")]
    public async Task M02_a_staff_address_that_stops_being_a_recipient_after_fan_out_is_never_sent_to(string change)
    {
        await SeedAsync();
        var staff = await AddStaffAsync("desk@login.example", StaffRole.FrontDesk, "desk@hotel.example");
        var stub = new ResendStub { Script = call => Task.FromResult<ResendStub.Act>(call.To == "desk@hotel.example" ? new ResendStub.Act.Respond(429) : new ResendStub.Act.Normal()) };
        using var host = Stack(stub);
        await BookAsync(host, "m02-" + change);
        await RunAsync(host); // the guest mail goes; the Staff mail is rate limited: certainly not sent, waiting
        Assert.Single(stub.CallList, call => call.To == "desk@hotel.example");

        await ExecuteAsync(change switch
        {
            "membership" => $"""DELETE FROM "StaffPropertyMemberships" WHERE "StaffAccountId"='{staff}'""",
            "opt-out" => $"""UPDATE "StaffBookingNotificationPreferences" SET "IsEnabled"=false WHERE "StaffAccountId"='{staff}'""",
            _ => $"""UPDATE "StaffBookingNotificationPreferences" SET "NotificationEmail"='moved@hotel.example' WHERE "StaffAccountId"='{staff}'"""
        });
        Factory.Clock.UtcNow = FixedUtc.AddMinutes(10);
        await RunAsync(host);

        Assert.Single(stub.CallList, call => call.To == "desk@hotel.example"); // no second request, and none to a new address
        Assert.DoesNotContain(stub.CallList, call => call.To == "moved@hotel.example");
        var delivery = (await DeliveryRowsAsync()).Single(row => row.Purpose == BookingEmailPurposes.Staff);
        Assert.Equal((EmailOutboxDelivery.StatusFailed, "recipient-revoked"), (delivery.Status, delivery.LastOutcome)); // certainly not sent
    }

    private async Task AddManyStaffAsync(int count)
    {
        await using var context = Factory.CreateDbContext();
        for (var i = 0; i < count; i++)
        {
            var id = Guid.NewGuid();
            var login = $"bulk{i}@login.example";
            context.StaffAccounts.Add(new StaffAccount
            {
                Id = id, Email = login, UserName = login, NormalizedEmail = login.ToUpperInvariant(), NormalizedUserName = login.ToUpperInvariant(),
                SecurityStamp = Guid.NewGuid().ToString(), ConcurrencyStamp = Guid.NewGuid().ToString(), CreatedAtUtc = FixedUtc
            });
            context.StaffPropertyMemberships.Add(new StaffPropertyMembership { StaffAccountId = id, PropertyId = PropertyId, Role = StaffRole.FrontDesk, CreatedAtUtc = FixedUtc });
        }

        await context.SaveChangesAsync();
        await ExecuteAsync($"""INSERT INTO "StaffBookingNotificationPreferences" ("PropertyId","StaffAccountId","NotificationEmail","IsEnabled","Version","CreatedAtUtc","UpdatedAtUtc") SELECT '{PropertyId}', s."Id", split_part(s."Email",'@',1) || '@hotel.example', true, 1, now(), now() FROM "StaffAccounts" s WHERE s."Email" LIKE 'bulk%@login.example'""");
    }

    [Fact]
    public async Task M01_every_property_recipient_gets_a_delivery_even_beyond_nineteen()
    {
        await SeedAsync();
        await AddManyStaffAsync(25);
        var stub = new ResendStub();
        using var host = Stack(stub, null, ("Email:Outbox:BatchSize", "100"));
        await BookAsync(host, "m01-many");

        await RunAsync(host);

        var staffTo = stub.CallList.Where(call => call.To != GuestAddress).Select(call => call.To).ToList();
        Assert.Equal(25, staffTo.Count);
        Assert.Equal(25, staffTo.Distinct().Count());
        Assert.Single(stub.CallList, call => call.To == GuestAddress);
        Assert.Equal(26, await Deliveries());
        Assert.Equal(1, await Links());
        Assert.All(await DeliveryRowsAsync(), row => Assert.Equal(EmailOutboxDelivery.StatusAccepted, row.Status));
    }

    [Fact]
    public async Task M01_a_fan_out_that_cannot_hold_every_recipient_is_refused_whole_and_rolls_back_the_link()
    {
        await SeedAsync();
        await AddManyStaffAsync(EmailOutboxLimits.DeliveriesPerEvent); // with the guest that is one delivery too many
        var stub = new ResendStub();
        using var host = Stack(stub);
        await BookAsync(host, "m01-too-many");

        await RunAsync(host);

        Assert.Empty(stub.CallList); // nobody is mailed a partial list
        Assert.Equal(0, await Deliveries());
        Assert.Equal(0, await Links());
        Assert.Equal("Pending:1:recipients-exceed-limit", await ScalarAsync<string>("""SELECT "Status" || ':' || "FanoutAttempts" || ':' || "LastOutcome" AS "Value" FROM "EmailOutboxEvents" """));
    }

    [Fact]
    public async Task M06_the_confirmed_amount_is_shown_exactly_even_with_decimals()
    {
        await SeedAsync();
        var stub = new ResendStub();
        using var host = Stack(stub);
        var id = await BookAsync(host, "m06-amount");
        // A confirmed total that is not a whole number of dong (the column is numeric(18,2); the nights keep their own snapshot).
        await ExecuteAsync($"""ALTER TABLE "Reservations" DISABLE TRIGGER USER; UPDATE "Reservations" SET "TotalAmount" = 1500000.50 WHERE "Id" = '{id}'; ALTER TABLE "Reservations" ENABLE TRIGGER USER;""");

        await RunAsync(host);

        var call = Assert.Single(stub.CallList);
        Assert.Contains("1.500.000,50 VND", Text(call));
        Assert.DoesNotContain("1.500.001", Text(call));
        Assert.DoesNotContain("1.500.000 VND", Text(call));
    }

    private static async Task CancelAsync(HttpClient client, Guid reservationId, string? guestToken)
    {
        var csrf = (await (await client.GetAsync("/api/v1/auth/csrf")).Content.ReadFromJsonAsync<Csrf>())!;
        using var cancel = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/reservations/{reservationId}/cancel") { Content = JsonContent.Create(new { reason = "changed plans" }) };
        if (guestToken is not null) cancel.Headers.Add("X-Booking-Access-Token", guestToken);
        cancel.Headers.Add(csrf.HeaderName, csrf.Token);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(cancel)).StatusCode);
    }

    // A reservation cancelled AFTER fan-out and BEFORE the provider is called must not be mailed as confirmed. The provider's answer to the first attempt decides what "not sent" can mean:
    // 429 = certainly not processed (Failed), 500 = unknown, the mail may have gone (NeedsReconciliation). Either way nothing more is sent.
    [Theory]
    [InlineData(429, EmailOutboxDelivery.StatusFailed)]
    [InlineData(500, EmailOutboxDelivery.StatusNeedsReconciliation)]
    public async Task M04_a_guest_reservation_cancelled_after_fan_out_is_not_mailed_again_and_a_possibly_sent_one_needs_reconciliation(int providerStatus, string expectedStatus)
    {
        await SeedAsync();
        await SetFallbackAsync(FrontDesk);
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(providerStatus)) };
        using var host = Stack(stub);
        using var client = Https(host);
        var token = NewToken();
        var id = (await JsonAsync(await PostAsync(client, "m04-cancel-" + providerStatus, Body(), token))).GetProperty("reservationId").GetGuid();
        await RunAsync(host);
        Assert.Equal(2, stub.CallList.Count); // the guest mail and the Property mail were each tried once

        await CancelAsync(client, id, token);
        Factory.Clock.UtcNow = FixedUtc.AddMinutes(10);
        await RunAsync(host);

        Assert.Equal(2, stub.CallList.Count); // nothing more went to the provider
        var rows = await DeliveryRowsAsync();
        Assert.Equal(2, rows.Length);
        Assert.All(rows, row => Assert.Equal((expectedStatus, "reservation-cancelled"), (row.Status, row.LastOutcome)));
        Assert.Equal([BookingEmailPurposes.GuestWithLink, BookingEmailPurposes.Staff], rows.Select(row => row.Purpose).Order().ToArray());
    }

    [Fact]
    public async Task M04_an_account_reservation_cancelled_after_fan_out_is_not_mailed_again()
    {
        await SeedAsync();
        await SetFallbackAsync(FrontDesk);
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(429)) };
        using var host = Stack(stub);
        using var client = host.CreateClient();
        await CreateCustomerAsync(host, client, "account-owner@example.com");
        var id = (await JsonAsync(await PostAsync(client, "m04-cancel-account", Body()))).GetProperty("reservationId").GetGuid();
        await RunAsync(host);
        Assert.Equal(2, stub.CallList.Count);

        await CancelAsync(client, id, null);
        Factory.Clock.UtcNow = FixedUtc.AddMinutes(10);
        await RunAsync(host);

        Assert.Equal(2, stub.CallList.Count);
        var rows = await DeliveryRowsAsync();
        Assert.All(rows, row => Assert.Equal((EmailOutboxDelivery.StatusFailed, "reservation-cancelled"), (row.Status, row.LastOutcome)));
        Assert.Equal([BookingEmailPurposes.Account, BookingEmailPurposes.Staff], rows.Select(row => row.Purpose).Order().ToArray());
    }

    // A delivery that was never attempted (a backlog) for a reservation cancelled meanwhile: no earlier attempt can have reached the provider, so it is a plain Failed, for every purpose.
    [Theory]
    [InlineData(BookingEmailPurposes.GuestWithLink, BookingEmailPurposes.GuestTemplate)]
    [InlineData(BookingEmailPurposes.Account, BookingEmailPurposes.AccountTemplate)]
    [InlineData(BookingEmailPurposes.Staff, BookingEmailPurposes.StaffTemplate)]
    public async Task M04_a_queued_delivery_of_a_cancelled_reservation_is_never_sent_for_any_purpose(string purpose, string template)
    {
        await SeedAsync();
        var stub = new ResendStub();
        using var host = Stack(stub);
        using var client = Https(host);
        var token = NewToken();
        var id = (await JsonAsync(await PostAsync(client, "m04-queued-" + purpose, Body(), token))).GetProperty("reservationId").GetGuid();
        await CancelAsync(client, id, token); // cancelled before the dispatcher has done anything
        var eventId = Guid.NewGuid();
        var protector = host.Services.GetRequiredService<EmailOutboxProtector>();
        await ExecuteAsync($"""INSERT INTO "EmailOutboxEvents" ("Id","EventType","SchemaVersion","PropertyId","Payload","Status","FanoutAttempts","NextAttemptAtUtc","CreatedAtUtc","CompletedAtUtc") VALUES ('{eventId}','ReservationConfirmed',1,'{PropertyId}',jsonb_build_object('reservationId','{id}'),'Completed',0,now(),now(),now())""");
        var recipient = protector.Protect("queued@example.com");
        var message = protector.Protect("{\"subject\":\"s\",\"text\":\"t\",\"html\":\"h\"}");
        await using (var context = Factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "EmailOutboxDeliveries" ("Id","EventId","PropertyId","Purpose","RecipientKey","TemplateKey","Locale","ProtectedRecipient","ProtectedMessage","Status","Attempts","NextAttemptAtUtc","UncertainSend","CreatedAtUtc")
                VALUES ({Guid.NewGuid()}, {eventId}, {PropertyId}, {purpose}, 'queued:x', {template}, 'vi', {recipient}, {message}, 'Pending', 0, {FixedUtc}, false, {FixedUtc})
                """);
        }

        await RunAsync(host);

        Assert.Empty(stub.CallList);
        var row = (await DeliveryRowsAsync()).Single(delivery => delivery.EventId == eventId);
        Assert.Equal((EmailOutboxDelivery.StatusFailed, "reservation-cancelled", 1), (row.Status, row.LastOutcome, row.Attempts));
    }

    /// <summary>Makes the guard's reservation read "slow": the first query on the Reservations status moves the shared clock forward.</summary>
    private sealed class SlowReservationRead(PostgreSqlWebApplicationFactory factory, TimeSpan takes) : Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor
    {
        public volatile bool Armed;

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command, Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (Armed && command.CommandText.Contains("\"Reservations\"", StringComparison.Ordinal) && command.CommandText.Contains("\"Status\"", StringComparison.Ordinal))
            {
                Armed = false;
                factory.Clock.UtcNow += takes;
            }

            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    // A guest mail whose link is still alive when the guard starts but would not be by the time the provider is called, because the reservation read was slow: the deadline is rechecked right before the call.
    [Fact]
    public async Task M04_a_slow_reservation_read_cannot_carry_a_guest_mail_past_its_links_life()
    {
        await SeedAsync();
        var slow = new SlowReservationRead(Factory, TimeSpan.FromSeconds(15));
        var stub = new ResendStub();
        using var host = Stack(stub).WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.RemoveAll<DbContextOptions<TheBhaDbContext>>(services);
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.RemoveAll<DbContextOptions>(services);
            services.AddDbContext<TheBhaDbContext>(options => Microsoft.EntityFrameworkCore.NpgsqlDbContextOptionsBuilderExtensions
                .UseNpgsql(options, Factory.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure")).AddInterceptors(slow));
        }));
        var id = await BookAsync(host, "m04-slow-read");
        // Only the queued delivery below takes part: the booking's own event is marked done.
        await ExecuteAsync("""UPDATE "EmailOutboxEvents" SET "Status"='Completed', "CompletedAtUtc"=now()""");
        var eventId = await ScalarAsync<Guid>("""SELECT "Id" AS "Value" FROM "EmailOutboxEvents" """);
        var protector = host.Services.GetRequiredService<EmailOutboxProtector>();
        var recipient = protector.Protect(GuestAddress);
        var message = protector.Protect("{\"subject\":\"s\",\"text\":\"t\",\"html\":\"h\"}");
        await using (var context = Factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "EmailOutboxDeliveries" ("Id","EventId","PropertyId","Purpose","RecipientKey","TemplateKey","Locale","ProtectedRecipient","ProtectedMessage","Status","Attempts","NextAttemptAtUtc","UncertainSend","CreatedAtUtc")
                VALUES ({Guid.NewGuid()}, {eventId}, {PropertyId}, {BookingEmailPurposes.GuestWithLink}, {BookingEmailPurposes.GuestKey(id)}, {BookingEmailPurposes.GuestTemplate}, 'vi', {recipient}, {message}, 'Pending', 0, {FixedUtc}, false, {FixedUtc})
                """);
        }

        // 30 s before the 72 h bound: the early check passes (30 - 20 s call timeout = 10 s to spare); the 15 s read then leaves 15 s, which no longer covers a 20 s call.
        Factory.Clock.UtcNow = FixedUtc.AddHours(72).AddSeconds(-30);
        slow.Armed = true;
        await RunAsync(host);

        Assert.False(slow.Armed); // the slow read really happened inside this run
        Assert.Empty(stub.CallList);
        var row = (await DeliveryRowsAsync()).Single();
        Assert.Equal((EmailOutboxDelivery.StatusFailed, "link-expired", 1), (row.Status, row.LastOutcome, row.Attempts));
    }

    // ------------------------------------------------------------------ M-03

    [Fact]
    public async Task M03_a_replayed_create_and_two_competing_dispatchers_make_one_link_and_one_guest_delivery()
    {
        await SeedAsync();
        var stub = new ResendStub();
        using var host = Stack(stub);
        using var client = Https(host);
        var token = NewToken();
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(client, "m03", Body(), token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(client, "m03", Body(), token)).StatusCode);
        Assert.Equal(1, await Count("""SELECT count(*) AS "Value" FROM "EmailOutboxEvents" """));

        using var second = Stack(stub);
        await Task.WhenAll(RunAsync(host), RunAsync(second));
        await RunAsync(host);

        Assert.Equal(1, await Links());
        Assert.Equal(1, await Deliveries());
        Assert.Equal(1, stub.DistinctSends);
        Assert.Single(stub.CallList);
    }

    [Fact]
    public async Task M03_a_failure_between_issuing_the_link_and_the_commit_rolls_back_both_and_a_retry_succeeds_once()
    {
        await SeedAsync();
        await SetFallbackAsync(FrontDesk);
        var stub = new ResendStub();
        using var host = Stack(stub);
        await BookAsync(host, "m03-rollback");
        await ExecuteAsync("""
            CREATE FUNCTION pr07_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pr07 injected failure'; END $$;
            CREATE TRIGGER pr07_fail_completion BEFORE UPDATE ON "EmailOutboxEvents" FOR EACH ROW WHEN (NEW."Status" = 'Completed') EXECUTE FUNCTION pr07_fail_completion();
            """);

        await Assert.ThrowsAnyAsync<Exception>(() => OutboxTest.RunAsync(host.Services));

        Assert.Equal(0, await Links());
        Assert.Equal(0, await Deliveries());
        Assert.Equal("Pending:0", await ScalarAsync<string>("""SELECT "Status" || ':' || "FanoutAttempts" AS "Value" FROM "EmailOutboxEvents" """));
        Assert.Empty(stub.CallList);

        await ExecuteAsync("""DROP TRIGGER pr07_fail_completion ON "EmailOutboxEvents"; DROP FUNCTION pr07_fail_completion();""");
        await RunAsync(host);

        Assert.Equal(1, await Links());
        Assert.Equal(2, await Deliveries());
        Assert.Equal(2, stub.DistinctSends);
        Assert.Equal("Completed", await ScalarAsync<string>("""SELECT "Status" AS "Value" FROM "EmailOutboxEvents" """));
    }

    // ------------------------------------------------------------------ M-04

    [Fact]
    public async Task M04_a_lost_answer_is_retried_with_the_same_key_and_payload_and_the_guest_gets_one_mail()
    {
        await SeedAsync();
        var stub = new ResendStub { Script = call => Task.FromResult<ResendStub.Act>(call.Number == 1 ? new ResendStub.Act.AcceptThen(_ => throw new HttpRequestException("answer lost")) : new ResendStub.Act.Normal()) };
        using var host = Stack(stub);
        await BookAsync(host, "m04-lost");

        await RunAsync(host);
        var lost = (await DeliveryRowsAsync()).Single();
        Assert.Equal((EmailOutboxDelivery.StatusPending, true), (lost.Status, lost.UncertainSend));

        Factory.Clock.UtcNow = FixedUtc.AddMinutes(1);
        await RunAsync(host);

        Assert.Equal(2, stub.CallList.Count);
        Assert.Equal(stub.CallList[0].IdempotencyKey, stub.CallList[1].IdempotencyKey);
        Assert.Equal(stub.CallList[0].Body, stub.CallList[1].Body);
        Assert.Equal(1, stub.DistinctSends);
        Assert.Equal(EmailOutboxDelivery.StatusAccepted, (await DeliveryRowsAsync()).Single().Status);
        Assert.Equal(1, await Links());
    }

    [Fact]
    public async Task M04_a_staff_address_revoked_after_an_uncertain_attempt_needs_reconciliation_and_nothing_more_is_sent()
    {
        await SeedAsync();
        var staff = await AddStaffAsync("desk@login.example", StaffRole.FrontDesk, "desk@hotel.example");
        var stub = new ResendStub { Script = call => Task.FromResult<ResendStub.Act>(call.To == "desk@hotel.example" ? new ResendStub.Act.Respond(500) : new ResendStub.Act.Normal()) };
        using var host = Stack(stub);
        await BookAsync(host, "m04-uncertain");
        await RunAsync(host);
        Assert.Single(stub.CallList, call => call.To == "desk@hotel.example");

        await ExecuteAsync($"""DELETE FROM "StaffPropertyMemberships" WHERE "StaffAccountId"='{staff}'""");
        Factory.Clock.UtcNow = FixedUtc.AddMinutes(10);
        await RunAsync(host);

        Assert.Single(stub.CallList, call => call.To == "desk@hotel.example");
        var row = (await DeliveryRowsAsync()).Single(delivery => delivery.Purpose == BookingEmailPurposes.Staff);
        Assert.Equal((EmailOutboxDelivery.StatusNeedsReconciliation, "recipient-revoked"), (row.Status, row.LastOutcome));
    }

    [Fact]
    public async Task M04_a_guest_delivery_whose_link_would_be_expired_is_not_sent()
    {
        await SeedAsync();
        var stub = new ResendStub();
        using var host = Stack(stub);
        // A guest delivery that was queued but never attempted (a backlog): inserted as the fan-out would, protected with the host's own key ring.
        var eventId = Guid.NewGuid();
        var protector = host.Services.GetRequiredService<EmailOutboxProtector>();
        await ExecuteAsync($"""INSERT INTO "EmailOutboxEvents" ("Id","EventType","SchemaVersion","PropertyId","Payload","Status","FanoutAttempts","NextAttemptAtUtc","CreatedAtUtc","CompletedAtUtc") VALUES ('{eventId}','ReservationConfirmed',1,'{PropertyId}',jsonb_build_object('a','b'),'Completed',0,now(),now(),now())""");
        var recipient = protector.Protect(GuestAddress);
        var message = protector.Protect("{\"subject\":\"s\",\"text\":\"t\",\"html\":\"h\"}");
        await using (var context = Factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "EmailOutboxDeliveries" ("Id","EventId","PropertyId","Purpose","RecipientKey","TemplateKey","Locale","ProtectedRecipient","ProtectedMessage","Status","Attempts","NextAttemptAtUtc","UncertainSend","CreatedAtUtc")
                VALUES ({Guid.NewGuid()}, {eventId}, {PropertyId}, {BookingEmailPurposes.GuestWithLink}, 'guest:x', {BookingEmailPurposes.GuestTemplate}, 'vi', {recipient}, {message}, 'Pending', 0, {FixedUtc}, false, {FixedUtc})
                """);
        }

        Factory.Clock.UtcNow = FixedUtc.AddHours(73);
        await RunAsync(host);

        Assert.Empty(stub.CallList);
        var row = (await DeliveryRowsAsync()).Single();
        Assert.Equal((EmailOutboxDelivery.StatusFailed, "link-expired"), (row.Status, row.LastOutcome));
    }

    // ------------------------------------------------------------------ M-05

    [Fact]
    public async Task M05_the_secret_is_only_in_the_guest_mail_fragment_never_stored_or_logged_in_clear_and_the_link_opens_only_its_reservation()
    {
        await SeedAsync();
        await SetFallbackAsync(FrontDesk);
        var logs = new CapturingLoggerProvider();
        var stub = new ResendStub { Script = call => Task.FromResult<ResendStub.Act>(call.Number == 1 ? new ResendStub.Act.Respond(500) : new ResendStub.Act.Normal()) }; // the first send is "unknown": the rows keep their protected message
        using var host = Stack(stub, logs);
        var reservationId = await BookAsync(host, "m05-a");
        var other = await BookAsync(host, "m05-b", startOffset: 6);

        await RunAsync(host);
        var kept = await DeliveryRowsAsync();
        Assert.Contains(kept, row => row.ProtectedMessage is not null); // the "unknown" one still holds its protected message

        // Whatever is stored (events, deliveries, links, reservations) holds no clear secret, while a protected message still sits in the table.
        var secretsSoFar = stub.CallList.SelectMany(call => LinkShape().Matches(Text(call)).Select(match => match.Groups[2].Value)).Distinct().ToList();
        Assert.NotEmpty(secretsSoFar);
        var storedNow = await StorageDumpAsync() + await ScalarAsync<string>("""SELECT coalesce(string_agg(to_jsonb(d)::text, '|'), '') AS "Value" FROM "EmailOutboxDeliveries" d""");
        Assert.All(secretsSoFar, secretValue => Assert.DoesNotContain(secretValue, storedNow));

        Factory.Clock.UtcNow = FixedUtc.AddMinutes(10);
        await RunAsync(host);
        var guestMails = stub.CallList.Where(call => call.To == GuestAddress && LinkShape().IsMatch(Text(call))).ToList();
        var mail = guestMails.First(call => LinkShape().Match(Text(call)).Groups[1].Value == reservationId.ToString());
        var link = LinkShape().Match(Text(mail));
        var secret = link.Groups[2].Value;
        var url = link.Value;
        Assert.Equal(new Uri(url).Fragment, "#" + secret);
        Assert.Equal($"/reservations/{reservationId}/manage", new Uri(url).AbsolutePath);
        Assert.Equal(string.Empty, new Uri(url).Query);
        Assert.DoesNotContain(secret, Subject(mail));
        Assert.DoesNotContain(secret, string.Join('\n', stub.CallList.Where(call => call.To != GuestAddress).Select(call => call.Body)));
        Assert.DoesNotContain(secret, await StorageDumpAsync());
        Assert.DoesNotContain(secret, string.Join('\n', logs.Lines));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var failures = await scope.ServiceProvider.GetRequiredService<IEmailOutboxFailures>().ListAsync(PropertyId, 200, CancellationToken.None);
            Assert.DoesNotContain(secret, string.Join('|', failures));
        }

        // The link from the mail works through the PR06 exchange, and opens exactly its reservation.
        using var client = Https(host);
        var wrongReservation = await ExchangeAsync(client, other, secret);
        Assert.Equal(HttpStatusCode.Unauthorized, wrongReservation.StatusCode); // and it does not consume the link
        var exchanged = await ExchangeAsync(client, reservationId, secret);
        Assert.Equal(HttpStatusCode.OK, exchanged.StatusCode);
        var read = await GetManageAsync(client, reservationId, CookieHeader(CookieValue(exchanged)!));
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal(reservationId, (await JsonAsync(read)).GetProperty("reservationId").GetGuid());
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetManageAsync(client, other, CookieHeader(CookieValue(exchanged)!))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync(Https(host), reservationId, secret)).StatusCode); // one use
    }

    // ------------------------------------------------------------------ M-06

    [Fact]
    public async Task M06_the_property_profile_is_read_from_the_data_and_escaped_in_html_only()
    {
        await SeedAsync();
        await ExecuteAsync($"""UPDATE "Properties" SET "Name"='Riverside <b>&"x"', "Address"='9 <i>Dock</i> Rd' WHERE "Id"='{PropertyId}'""");
        await ExecuteAsync($"""UPDATE "Properties" SET "CheckInTime"='15:30' WHERE "Id"='{PropertyId}'""");
        var stub = new ResendStub();
        using var host = Stack(stub);
        await BookAsync(host, "m06", name: "Nguyễn <script>alert(1)</script>");

        await RunAsync(host);

        var call = Assert.Single(stub.CallList);
        Assert.Contains("Riverside <b>&\"x\"", Text(call));
        Assert.Contains("9 <i>Dock</i> Rd, Ho Chi Minh City", Text(call));
        Assert.Contains("15:30", Text(call));
        Assert.Contains("Nguyễn <script>alert(1)</script>", Text(call));
        Assert.DoesNotContain("<script>", Html(call));
        Assert.DoesNotContain("<b>&", Html(call));
        Assert.Contains("&lt;script&gt;", Html(call));
        Assert.Contains("Riverside &lt;b&gt;&amp;&quot;x&quot;", Html(call));
        Assert.DoesNotContain("\n", Subject(call));
    }

    // ------------------------------------------------------------------ M-07

    [Fact]
    public async Task M07_off_by_default_or_without_safe_configuration_the_event_stays_pending_without_attempts_or_links()
    {
        await SeedAsync();
        var stub = new ResendStub();
        var variants = new (string Name, (string Key, string Value)[] Settings)[]
        {
            ("default-off", [("Booking:ConfirmationEmail:Enabled", "false")]),
            ("no-origin", [("Booking:ConfirmationEmail:CustomerWebOrigin", "")]),
            ("no-provider", [("Email:Outbox:Resend:ApiKey", "")])
        };
        var number = 0;
        foreach (var (name, settings) in variants)
        {
            using var host = Stack(stub, null, settings);
            await BookAsync(host, "m07-" + name, startOffset: 3 + 3 * number++);
            await RunAsync(host);
        }

        Assert.Equal(3, await Count("""SELECT count(*) AS "Value" FROM "EmailOutboxEvents" WHERE "Status"='Pending' AND "FanoutAttempts"=0 """));
        Assert.Equal(0, await Deliveries());
        Assert.Equal(0, await Links());
        Assert.Empty(stub.CallList);
    }

    [Fact]
    public async Task M07_a_malformed_customer_origin_stops_the_host_at_start_up()
    {
        await SeedAsync();
        foreach (var origin in new[] { "http://localhost:3000", "https://localhost:3000/shop", "https://localhost:3000/?a=1", "localhost" })
        {
            using var host = Stack(new ResendStub(), null, ("Booking:ConfirmationEmail:CustomerWebOrigin", origin));
            var failure = Assert.ThrowsAny<Exception>(() => host.Services);
            Assert.Contains("CustomerWebOrigin", failure.ToString());
        }
    }

    [Fact]
    public async Task M07_enabled_with_the_stub_each_delivery_is_claimed_once_and_a_send_failure_changes_nothing_else()
    {
        await SeedAsync();
        await SetFallbackAsync(FrontDesk);
        var stub = new ResendStub { Script = _ => Task.FromResult<ResendStub.Act>(new ResendStub.Act.Respond(422, """{"name":"validation_error"}""")) };
        using var host = Stack(stub);
        await BookAsync(host, "m07-fail");
        var before = await BusinessStateAsync();

        await RunAsync(host);

        Assert.Equal(before, await BusinessStateAsync());
        var rows = await DeliveryRowsAsync();
        Assert.All(rows, row => Assert.Equal((EmailOutboxDelivery.StatusFailed, 1), (row.Status, row.Attempts)));
        Assert.Equal(2, stub.CallList.Count);
    }

    private async Task<string> BusinessStateAsync()
    {
        var parts = new List<string>();
        foreach (var table in new[] { "Reservations", "ReservationUnits", "ReservationUnitNights", "FolioEntries", "AdminActivities", "InventoryHolds", "RoomOccupancySegments", "DailyInventoryControls", "ReservationCreationRequests" })
        {
            parts.Add($"{table}={await ScalarAsync<string>($"""SELECT count(*) || ':' || coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text)), '') AS "Value" FROM "{table}" t""")}");
        }

        return string.Join(", ", parts);
    }
}
