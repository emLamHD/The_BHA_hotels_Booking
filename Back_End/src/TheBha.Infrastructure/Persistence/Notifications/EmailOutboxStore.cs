using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Notifications;
using TheBha.Domain.Common;
using TheBha.Domain.Notifications;

namespace TheBha.Infrastructure.Persistence.Notifications;

/// <summary>
/// BHA-CHECKOUT-001-PR03: the enqueue half. A raw <c>INSERT … ON CONFLICT DO NOTHING</c> on the caller's CURRENT transaction (no transaction is an error): it never commits or rolls back, and an event id that already
/// exists is answered by comparing content, not by a unique violation that would abort the caller's PostgreSQL transaction. Nothing is added to the change tracker.
/// </summary>
internal sealed class EmailOutboxStore(TheBhaDbContext dbContext, TimeProvider timeProvider) : IEmailOutbox
{
    public async Task<EmailOutboxEnqueueStatus> EnqueueAsync(EmailOutboxEventRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var now = timeProvider.GetUtcNow();
        var candidate = new EmailOutboxEvent(request.EventId, request.EventType, request.SchemaVersion, request.PropertyId, request.PayloadJson, now); // validates the scalar fields
        if (Encoding.UTF8.GetByteCount(candidate.PayloadJson) > EmailOutboxLimits.PayloadBytes) throw new DomainException("The event payload is too large.");
        try
        {
            using var parsed = JsonDocument.Parse(candidate.PayloadJson);
            if (parsed.RootElement.ValueKind != JsonValueKind.Object) throw new DomainException("The event payload must be a JSON object.");
        }
        catch (JsonException)
        {
            throw new DomainException("The event payload must be valid JSON.");
        }

        if (dbContext.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("The e-mail outbox joins the caller's transaction: open one on this DbContext first (it is never committed from here).");
        }

        var written = await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "EmailOutboxEvents" ("Id", "EventType", "SchemaVersion", "PropertyId", "Payload", "Status", "FanoutAttempts", "NextAttemptAtUtc", "CreatedAtUtc")
            VALUES ({candidate.Id}, {candidate.EventType}, {candidate.SchemaVersion}, {candidate.PropertyId}, {candidate.PayloadJson}::jsonb, 'Pending', 0, {now}, {now})
            ON CONFLICT ("Id") DO NOTHING
            """,
            cancellationToken);
        if (written == 1) return EmailOutboxEnqueueStatus.Enqueued;

        var same = await dbContext.Database.SqlQuery<int>(
            $"""
            SELECT count(*)::int AS "Value" FROM "EmailOutboxEvents"
            WHERE "Id" = {candidate.Id} AND "EventType" = {candidate.EventType} AND "SchemaVersion" = {candidate.SchemaVersion} AND "PropertyId" = {candidate.PropertyId} AND "Payload" = {candidate.PayloadJson}::jsonb
            """).SingleAsync(cancellationToken);
        return same == 1 ? EmailOutboxEnqueueStatus.Duplicate : EmailOutboxEnqueueStatus.Conflict;
    }
}

internal sealed class EmailOutboxFailureReader(TheBhaDbContext dbContext) : IEmailOutboxFailures
{
    private static readonly string[] DeliveryFailures = [EmailOutboxDelivery.StatusFailed, EmailOutboxDelivery.StatusNeedsReconciliation];

    public async Task<IReadOnlyList<EmailOutboxFailure>> ListAsync(Guid propertyId, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 200);
        var deliveries = await dbContext.EmailOutboxDeliveries.AsNoTracking()
            .Where(row => row.PropertyId == propertyId && DeliveryFailures.Contains(row.Status))
            .OrderByDescending(row => row.CreatedAtUtc).ThenBy(row => row.Id).Take(limit)
            .Select(row => new EmailOutboxFailure("delivery", row.Id, row.EventId, row.Purpose, row.Status, row.Attempts, row.LastOutcome, row.CreatedAtUtc, row.LastAttemptAtUtc, row.ProviderMessageId))
            .ToListAsync(cancellationToken);
        var events = await dbContext.EmailOutboxEvents.AsNoTracking()
            .Where(row => row.PropertyId == propertyId && row.Status == EmailOutboxEvent.StatusFailed)
            .OrderByDescending(row => row.CreatedAtUtc).ThenBy(row => row.Id).Take(limit)
            .Select(row => new EmailOutboxFailure("event", row.Id, row.Id, row.EventType, row.Status, row.FanoutAttempts, row.LastOutcome, row.CreatedAtUtc, null, null))
            .ToListAsync(cancellationToken);
        return deliveries.Concat(events).OrderByDescending(row => row.CreatedAtUtc).ThenBy(row => row.Id).Take(limit).ToList();
    }
}
