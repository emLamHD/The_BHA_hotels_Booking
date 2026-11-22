using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Notifications;
using TheBha.Domain.Common;
using TheBha.Domain.Notifications;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;
using static TheBha.IntegrationTests.OutboxTest;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR03, E-01 (the enqueue lives and dies with the caller's transaction) and E-02 (fan-out: handlers, replay, uniqueness), on real PostgreSQL. Nothing here sends: the provider is the stub or is not configured at all.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class EmailOutboxEnqueueTests(PostgreSqlWebApplicationFactory factory)
{
    private const string EventsSql = """SELECT count(*) FROM "EmailOutboxEvents" """;

    [Fact]
    public async Task E01_an_uncommitted_enqueue_is_invisible_to_the_worker_and_a_rollback_removes_the_event_and_the_demo_row_together()
    {
        await FreshAsync(factory);
        var handler = new SyntheticHandler();
        using var host = Host(factory, new ResendStub(), handlers: handler);
        var demoPropertyId = Guid.NewGuid();

        // Rolled back: the caller's own row (a Property, standing in for a reservation) and the event vanish together.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var database = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
            await using var transaction = await database.Database.BeginTransactionAsync();
            database.Properties.Add(Demo(demoPropertyId));
            await database.SaveChangesAsync();
            Assert.Equal(EmailOutboxEnqueueStatus.Enqueued, await scope.ServiceProvider.GetRequiredService<IEmailOutbox>().EnqueueAsync(Request(demoPropertyId), CancellationToken.None));
            Assert.Equal(1, await database.EmailOutboxEvents.CountAsync());

            // The worker, on its own connection, sees nothing of it, and does nothing.
            Assert.Equal(0, await ScalarAsync<long>(factory, EventsSql));
            Assert.Equal(new EmailOutboxBatchResult(0, 0), await RunAsync(host.Services));
            Assert.Equal(0, handler.Calls);
            await transaction.RollbackAsync();
        }

        Assert.Equal(0, await ScalarAsync<long>(factory, EventsSql));
        Assert.Equal(0, await ScalarAsync<long>(factory, $"""SELECT count(*) FROM "Properties" WHERE "Id" = '{demoPropertyId}' """));
        Assert.Equal(new EmailOutboxBatchResult(0, 0), await RunAsync(host.Services));

        // Committed: the row and the event appear together, and only now the worker handles it.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var database = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
            await using var transaction = await database.Database.BeginTransactionAsync();
            database.Properties.Add(Demo(demoPropertyId));
            await database.SaveChangesAsync();
            await scope.ServiceProvider.GetRequiredService<IEmailOutbox>().EnqueueAsync(Request(demoPropertyId), CancellationToken.None);
            await transaction.CommitAsync();
        }

        Assert.Equal(1, await ScalarAsync<long>(factory, EventsSql));
        Assert.Equal(1, (await RunAsync(host.Services)).EventsFannedOut);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task E01_enqueue_needs_the_callers_transaction_and_never_commits_or_leaves_a_tracked_entity()
    {
        await FreshAsync(factory);
        using var host = Host(factory, new ResendStub());
        await using var scope = host.Services.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var outbox = scope.ServiceProvider.GetRequiredService<IEmailOutbox>();
        var propertyId = (await database.Properties.AsNoTracking().FirstAsync()).Id;

        await Assert.ThrowsAsync<InvalidOperationException>(() => outbox.EnqueueAsync(Request(propertyId), CancellationToken.None));
        Assert.Equal(0, await ScalarAsync<long>(factory, EventsSql));

        await using var transaction = await database.Database.BeginTransactionAsync();
        await outbox.EnqueueAsync(Request(propertyId), CancellationToken.None);
        Assert.Empty(database.ChangeTracker.Entries<EmailOutboxEvent>()); // nothing for the caller's SaveChanges to flush or to fail on
        await database.SaveChangesAsync();
        Assert.Equal(0, await ScalarAsync<long>(factory, EventsSql)); // SaveChanges inside the caller's transaction is still not a commit
        await transaction.CommitAsync();
        Assert.Equal(1, await ScalarAsync<long>(factory, EventsSql));
    }

    [Fact]
    public async Task E01_enqueue_is_idempotent_by_event_id_and_a_different_content_under_the_same_id_is_a_conflict_that_changes_nothing()
    {
        var seed = await FreshAsync(factory);
        using var host = Host(factory, new ResendStub());
        var id = Guid.NewGuid();
        Assert.Equal(EmailOutboxEnqueueStatus.Enqueued, await EnqueueAsync(host.Services, seed.PropertyId, id, payload: """{"reservationId":"1","n":2}"""));
        // Same content, different key order and spacing: jsonb says it is the same.
        Assert.Equal(EmailOutboxEnqueueStatus.Duplicate, await EnqueueAsync(host.Services, seed.PropertyId, id, payload: """{ "n": 2, "reservationId": "1" }"""));
        Assert.Equal(EmailOutboxEnqueueStatus.Conflict, await EnqueueAsync(host.Services, seed.PropertyId, id, payload: """{"reservationId":"2","n":2}"""));
        Assert.Equal(EmailOutboxEnqueueStatus.Conflict, await EnqueueAsync(host.Services, seed.OtherPropertyId, id, payload: """{"reservationId":"1","n":2}"""));
        Assert.Equal(EmailOutboxEnqueueStatus.Conflict, await EnqueueAsync(host.Services, seed.PropertyId, id, type: "other.type", payload: """{"reservationId":"1","n":2}"""));
        Assert.Equal(1, await ScalarAsync<long>(factory, EventsSql));
        Assert.Equal("""{"n": 2, "reservationId": "1"}""", await ScalarAsync<string>(factory, """SELECT "Payload"::text FROM "EmailOutboxEvents" """));
    }

    [Fact]
    public async Task E01_two_open_transactions_with_one_event_id_serialize_and_the_second_sees_a_duplicate_without_failing_its_transaction()
    {
        var seed = await FreshAsync(factory);
        using var host = Host(factory, new ResendStub());
        var id = Guid.NewGuid();
        await using var firstScope = host.Services.CreateAsyncScope();
        var firstDatabase = firstScope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        await using var first = await firstDatabase.Database.BeginTransactionAsync();
        await firstScope.ServiceProvider.GetRequiredService<IEmailOutbox>().EnqueueAsync(Request(seed.PropertyId, id), CancellationToken.None);

        var second = Task.Run(async () =>
        {
            await using var scope = host.Services.CreateAsyncScope();
            var database = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
            await using var transaction = await database.Database.BeginTransactionAsync();
            var status = await scope.ServiceProvider.GetRequiredService<IEmailOutbox>().EnqueueAsync(Request(seed.PropertyId, id), CancellationToken.None);
            await database.Database.ExecuteSqlRawAsync("SELECT 1"); // the transaction is still usable (no 25P02)
            await transaction.CommitAsync();
            return status;
        });
        await Task.Delay(400);
        Assert.False(second.IsCompleted); // it waits for the first transaction's fate
        await first.CommitAsync();
        Assert.Equal(EmailOutboxEnqueueStatus.Duplicate, await second);
        Assert.Equal(1, await ScalarAsync<long>(factory, EventsSql));
    }

    [Theory]
    [InlineData("""[1,2]""")]
    [InlineData("""not json""")]
    [InlineData("")]
    public async Task E01_a_payload_that_is_not_a_json_object_is_refused_before_anything_is_written(string payload)
    {
        var seed = await FreshAsync(factory);
        using var host = Host(factory, new ResendStub());
        await Assert.ThrowsAsync<DomainException>(() => EnqueueAsync(host.Services, seed.PropertyId, payload: payload));
        await Assert.ThrowsAsync<DomainException>(() => EnqueueAsync(host.Services, seed.PropertyId, payload: """{"x":"%s"}""".Replace("%s", new string('x', 5000))));
        Assert.Equal(0, await ScalarAsync<long>(factory, EventsSql));
    }

    [Fact]
    public async Task E02_an_event_nobody_handles_is_not_claimed_costs_no_attempt_and_is_handled_once_a_handler_exists()
    {
        var seed = await FreshAsync(factory);
        var other = new SyntheticHandler("test.other");
        var versionTwo = new SyntheticHandler("test.synthetic", 2);
        using (var withoutHandler = Host(factory, new ResendStub(), handlers: [other, versionTwo]))
        {
            await EnqueueAsync(withoutHandler.Services, seed.PropertyId);
            for (var pass = 0; pass < 3; pass++) Assert.Equal(new EmailOutboxBatchResult(0, 0), await RunAsync(withoutHandler.Services));
        }

        Assert.Equal((0, 0), (other.Calls, versionTwo.Calls));
        await using (var context = factory.CreateDbContext())
        {
            var pending = await context.EmailOutboxEvents.AsNoTracking().SingleAsync();
            Assert.Equal((EmailOutboxEvent.StatusPending, 0, null), (pending.Status, pending.FanoutAttempts, pending.LastOutcome));
            Assert.Equal(pending.CreatedAtUtc, pending.NextAttemptAtUtc);
        }

        var handler = new SyntheticHandler();
        using var withHandler = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: handler);
        Assert.Equal(new EmailOutboxBatchResult(1, 0), await RunAsync(withHandler.Services));
        Assert.Equal(1, handler.Calls);
        await using var after = factory.CreateDbContext();
        Assert.Equal(EmailOutboxEvent.StatusCompleted, (await after.EmailOutboxEvents.AsNoTracking().SingleAsync()).Status);
        Assert.Single(await after.EmailOutboxDeliveries.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task E02_a_fanout_that_fails_after_its_inserts_rolls_everything_back_and_the_retry_creates_each_delivery_exactly_once()
    {
        var seed = await FreshAsync(factory);
        var handler = new SyntheticHandler { Recipients = ["a@example.test", "b@example.test"] };
        using var host = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: handler);
        await EnqueueAsync(host.Services, seed.PropertyId);

        // The completion of the event is the last write of the fan-out: make PostgreSQL refuse it, after both deliveries were inserted in the same transaction.
        await ExecuteAsync(factory,
            """
            CREATE FUNCTION test_refuse_completion() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test: completion refused'; END; $$ LANGUAGE plpgsql;
            CREATE TRIGGER trg_test_refuse BEFORE UPDATE ON "EmailOutboxEvents" FOR EACH ROW WHEN (NEW."Status" = 'Completed') EXECUTE FUNCTION test_refuse_completion();
            """);
        await Assert.ThrowsAnyAsync<DbException>(() => RunAsync(host.Services));
        Assert.Equal(1, handler.Calls); // the handler ran once and returned two drafts
        Assert.Equal(0, await ScalarAsync<long>(factory, """SELECT count(*) FROM "EmailOutboxDeliveries" """));
        await using (var context = factory.CreateDbContext())
        {
            var pending = await context.EmailOutboxEvents.AsNoTracking().SingleAsync();
            Assert.Equal((EmailOutboxEvent.StatusPending, 0), (pending.Status, pending.FanoutAttempts)); // an infrastructure failure is not the handler's fault: no attempt is counted
        }

        await ExecuteAsync(factory, """DROP TRIGGER trg_test_refuse ON "EmailOutboxEvents"; DROP FUNCTION test_refuse_completion();""");
        Assert.Equal(1, (await RunAsync(host.Services)).EventsFannedOut);
        Assert.Equal(2, await ScalarAsync<long>(factory, """SELECT count(*) FROM "EmailOutboxDeliveries" """));
        Assert.Equal(EmailOutboxEvent.StatusCompleted, await ScalarAsync<string>(factory, """SELECT "Status" FROM "EmailOutboxEvents" """));
    }

    [Fact]
    public async Task E02_a_key_ring_that_cannot_protect_leaves_the_event_pending_uncounted_and_a_working_host_then_completes_it()
    {
        var seed = await FreshAsync(factory);
        var keysPath = Path.GetTempFileName(); // a FILE where the key ring needs a directory: no key can ever be created
        try
        {
            var handler = new SyntheticHandler();
            using (var broken = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null, ["DataProtection:KeysPath"] = keysPath }, handlers: handler))
            {
                await EnqueueAsync(broken.Services, seed.PropertyId);
                var fault = await Assert.ThrowsAnyAsync<Exception>(() => RunAsync(broken.Services)); // a host fault, not a handler fault
                Assert.Contains("EmailOutboxProtector.Protect", fault.ToString()); // it really is the key ring that failed
            }

            await using (var context = factory.CreateDbContext())
            {
                var pending = await context.EmailOutboxEvents.AsNoTracking().SingleAsync();
                Assert.Equal((EmailOutboxEvent.StatusPending, 0, null), (pending.Status, pending.FanoutAttempts, pending.LastOutcome)); // nothing counted, nothing delayed
                Assert.Equal(pending.CreatedAtUtc, pending.NextAttemptAtUtc);
            }

            Assert.Equal(0, await ScalarAsync<long>(factory, """SELECT count(*) FROM "EmailOutboxDeliveries" """));
            var working = new SyntheticHandler();
            using var ok = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: working);
            Assert.Equal(1, (await RunAsync(ok.Services)).EventsFannedOut);
            Assert.Equal(1, await ScalarAsync<long>(factory, """SELECT count(*) FROM "EmailOutboxDeliveries" """));
        }
        finally
        {
            File.Delete(keysPath);
        }
    }

    [Fact]
    public async Task E02_replaying_a_completed_event_adds_no_delivery_and_the_delivery_id_is_stable()
    {
        var seed = await FreshAsync(factory);
        var handler = new SyntheticHandler { Recipients = ["a@example.test", "b@example.test"] };
        using var host = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: handler);
        var eventId = Guid.NewGuid();
        await EnqueueAsync(host.Services, seed.PropertyId, eventId);
        await RunAsync(host.Services);
        var first = (await DeliveriesAsync(factory)).Select(d => d.Id).Order().ToList();

        // Somebody puts the event back (an operator, a bug, a restore): the same fan-out must name the same deliveries and add none.
        await ExecuteAsync(factory, """UPDATE "EmailOutboxEvents" SET "Status" = 'Pending', "CompletedAtUtc" = NULL""");
        Assert.Equal(1, (await RunAsync(host.Services)).EventsFannedOut);
        Assert.Equal(2, handler.Calls);
        Assert.Equal(first, (await DeliveriesAsync(factory)).Select(d => d.Id).Order().ToList());
        Assert.Equal(first.Count, first.Distinct().Count());
        Assert.Equal(EmailOutboxSql(eventId, "notice", "to:a@example.test"), (await DeliveriesAsync(factory)).Single(d => d.RecipientKey == "to:a@example.test").Id);
    }

    [Fact]
    public async Task E02_one_delivery_per_event_purpose_and_recipient_while_another_recipient_or_event_is_independent()
    {
        var seed = await FreshAsync(factory);
        var handler = new SyntheticHandler { Recipients = ["a@example.test", "b@example.test"] };
        using var host = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: handler);
        await EnqueueAsync(host.Services, seed.PropertyId);
        await EnqueueAsync(host.Services, seed.PropertyId);
        await RunAsync(host.Services);
        var rows = await DeliveriesAsync(factory);
        Assert.Equal(4, rows.Count); // two events x two recipients, same purpose
        Assert.Equal(2, rows.Select(r => r.EventId).Distinct().Count());
        Assert.Equal(4, rows.Select(r => r.Id).Distinct().Count());

        // The database refuses a second row for the same (event, purpose, recipient), whatever the application did.
        var existing = rows[0];
        var duplicate = await FolioTestSupport.RawAsync(factory.ConnectionString,
            $"""
            INSERT INTO "EmailOutboxDeliveries" ("Id","EventId","PropertyId","Purpose","RecipientKey","TemplateKey","Locale","ProtectedRecipient","ProtectedMessage","Status","Attempts","NextAttemptAtUtc","UncertainSend","CreatedAtUtc")
            VALUES ('{Guid.NewGuid()}','{existing.EventId}','{existing.PropertyId}','{existing.Purpose}','{existing.RecipientKey}','t','en','x','y','Pending',0,now(),false,now())
            """);
        Assert.Equal(("23505", "IX_EmailOutboxDeliveries_EventId_Purpose_RecipientKey"), duplicate);
    }

    [Fact]
    public async Task E02_a_handler_that_throws_or_returns_a_bad_draft_is_counted_rolled_back_delayed_and_ends_as_failed_without_blocking_other_events()
    {
        var seed = await FreshAsync(factory);
        var handler = new SyntheticHandler("test.broken") { Behavior = _ => throw new InvalidOperationException("handler bug") };
        var good = new SyntheticHandler();
        using var host = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null, ["Email:Outbox:FanoutMaxAttempts"] = "3" }, handlers: [handler, good]);
        var broken = Guid.NewGuid();
        await EnqueueAsync(host.Services, seed.PropertyId, broken, "test.broken");
        await EnqueueAsync(host.Services, seed.PropertyId);

        Assert.Equal(2, (await RunAsync(host.Services)).EventsFannedOut); // the broken one is counted, the good one is not blocked
        Assert.Equal(1, good.Calls);
        await using (var context = factory.CreateDbContext())
        {
            var row = await context.EmailOutboxEvents.AsNoTracking().SingleAsync(e => e.Id == broken);
            Assert.Equal((EmailOutboxEvent.StatusPending, 1, "handler-error"), (row.Status, row.FanoutAttempts, row.LastOutcome));
            Assert.Equal(T0.AddSeconds(30), row.NextAttemptAtUtc);
        }

        Assert.Equal(0, (await RunAsync(host.Services)).EventsFannedOut); // not due yet: no hot loop
        factory.Clock.UtcNow = T0.AddMinutes(10);
        await RunAsync(host.Services);
        factory.Clock.UtcNow = T0.AddMinutes(20);
        await RunAsync(host.Services);
        await using var after = factory.CreateDbContext();
        var failed = await after.EmailOutboxEvents.AsNoTracking().SingleAsync(e => e.Id == broken);
        Assert.Equal((EmailOutboxEvent.StatusFailed, 3), (failed.Status, failed.FanoutAttempts));
        Assert.Equal(3, handler.Calls);
        Assert.Equal(0, (await RunAsync(host.Services)).EventsFannedOut); // Failed is final
        Assert.Equal(1, await after.EmailOutboxDeliveries.CountAsync()); // only the good event's delivery exists
    }

    [Theory]
    [InlineData("not-an-address")]
    [InlineData("a@example.test\r\nBcc: x@example.test")]
    public async Task E02_a_draft_with_an_invalid_address_never_becomes_a_delivery(string address)
    {
        var seed = await FreshAsync(factory);
        var handler = new SyntheticHandler { Recipients = ["ok@example.test", address] };
        using var host = Host(factory, new ResendStub(), settings: new() { ["Email:Outbox:Resend:ApiKey"] = null }, handlers: handler);
        await EnqueueAsync(host.Services, seed.PropertyId);
        await RunAsync(host.Services);
        Assert.Equal(0, await ScalarAsync<long>(factory, """SELECT count(*) FROM "EmailOutboxDeliveries" """)); // the good draft was not kept either: one event, one transaction
        Assert.Equal(1, await ScalarAsync<int>(factory, """SELECT "FanoutAttempts" FROM "EmailOutboxEvents" """));
    }

    private static Guid EmailOutboxSql(Guid eventId, string purpose, string key) =>
        new(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"bha-email-delivery|{eventId:N}|{purpose}|{key}"))[..16]);

    private static EmailOutboxEventRequest Request(Guid propertyId, Guid? id = null) => new(id ?? Guid.NewGuid(), "test.synthetic", 1, propertyId, """{"reservationId":"00000000-0000-0000-0000-0000000000aa"}""");

    private static Property Demo(Guid id) =>
        new(id, "Demo Hotel", $"demo-{id:N}", null, "1 Demo Street", "Da Nang", "Vietnam", "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, T0);
}
