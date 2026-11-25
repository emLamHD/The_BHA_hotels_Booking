using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TheBha.Application.Notifications;
using TheBha.Domain.Notifications;

namespace TheBha.Infrastructure.Persistence.Notifications;

/// <summary>
/// BHA-CHECKOUT-001-PR03. Two stages, both claimed and written in short transactions, never across a provider call.
/// <para>
/// FAN-OUT: one event whose (type, version) has a registered handler is taken with <c>FOR UPDATE SKIP LOCKED</c>; the handler's deliveries are inserted (<c>ON CONFLICT DO NOTHING</c> on the unique key) and the event is
/// marked Completed in that same transaction, so a rollback leaves the event Pending and a replay adds nothing. An event nobody handles is never selected and costs nothing. A handler that throws is rolled back and counted
/// (bounded); a database failure rolls back and changes nothing.
/// </para>
/// <para>
/// SEND: a delivery is taken in a short transaction under a lease and a claim token, which is committed BEFORE the provider is called. Every later write presents the token, so a worker that lost its lease can neither finish nor
/// retry a delivery another worker now holds. The first attempt pins the account fingerprint and the sender and records its time in one fenced write BEFORE the call. A retry sends the same stored message under the same key;
/// if the account is not the pinned one, or the provider's key window has run out, nothing is sent and the delivery needs reconciliation. An outcome that may have reached the provider (timeout, lost answer, 5xx) is
/// <c>Unknown</c>: retried under the same key, and if attempts run out it is NeedsReconciliation, never "failed", because it may have been sent.
/// </para>
/// </summary>
internal sealed class EmailOutboxDispatcher : IEmailOutboxDispatcher
{
    private readonly TheBhaDbContext _database;
    private readonly TimeProvider _clock;
    private readonly EmailOutboxOptions _options;
    private readonly IReadOnlyList<IEmailOutboxEventHandler> _handlers;
    private readonly EmailTemplateRenderer _renderer;
    private readonly EmailOutboxProtector _protector;
    private readonly IEmailTransport _transport;
    private readonly IReadOnlyList<IEmailDeliveryPreSendGuard> _guards;
    private readonly ILogger<EmailOutboxDispatcher> _logger;

    public EmailOutboxDispatcher(
        TheBhaDbContext database, TimeProvider clock, EmailOutboxOptions options, IEnumerable<IEmailOutboxEventHandler> handlers, EmailTemplateRenderer renderer,
        EmailOutboxProtector protector, IEmailTransport transport, IEnumerable<IEmailDeliveryPreSendGuard> guards, ILogger<EmailOutboxDispatcher> logger)
    {
        _database = database;
        _clock = clock;
        _options = options;
        _handlers = handlers.ToList();
        _renderer = renderer;
        _protector = protector;
        _transport = transport;
        _guards = guards.ToList();
        _logger = logger;
        var duplicate = _handlers.GroupBy(handler => (handler.EventType, handler.SchemaVersion)).FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null) throw new InvalidOperationException($"Two e-mail outbox handlers are registered for '{duplicate.Key.EventType}' v{duplicate.Key.SchemaVersion}.");
    }

    private readonly record struct Held(Guid Id, Guid ClaimId, int Attempts);

    public async Task<EmailOutboxBatchResult> ProcessBatchAsync(CancellationToken cancellationToken)
    {
        // Off: nothing is claimed and no attempt is used.
        if (!_options.DispatchEnabled) return new EmailOutboxBatchResult(0, 0);

        var fannedOut = 0;
        while (fannedOut < _options.BatchSize && !cancellationToken.IsCancellationRequested && await FanOutOneAsync(cancellationToken)) fannedOut++;

        var processed = 0;
        while (processed < _options.BatchSize && !cancellationToken.IsCancellationRequested)
        {
            // Not configured: no delivery is claimed and no attempt is used; the queue waits.
            if (_transport.Identity is not { } identity) break;
            if (!await SendOneAsync(identity, cancellationToken)) break;
            processed++;
        }

        return new EmailOutboxBatchResult(fannedOut, processed);
    }

    // ---------------------------------------------------------------- fan-out

    private async Task<bool> FanOutOneAsync(CancellationToken ct)
    {
        if (_handlers.Count == 0) return false;
        var now = _clock.GetUtcNow();
        _database.ChangeTracker.Clear();
        await using var transaction = await _database.Database.BeginTransactionAsync(ct);
        var due = await EmailOutboxSql.QueryAsync(_database,
            """
            SELECT "Id", "EventType", "SchemaVersion", "PropertyId", "Payload"::text FROM "EmailOutboxEvents"
            WHERE "Status" = 'Pending' AND "NextAttemptAtUtc" <= @now
              AND ("EventType", "SchemaVersion") IN (SELECT t, v FROM unnest(@types, @versions) AS x(t, v))
            ORDER BY "NextAttemptAtUtc", "CreatedAtUtc", "Id" LIMIT 1 FOR UPDATE SKIP LOCKED
            """,
            [("now", now), ("types", _handlers.Select(h => h.EventType).ToArray()), ("versions", _handlers.Select(h => h.SchemaVersion).ToArray())],
            row => (Id: row.GetGuid(0), Type: row.GetString(1), Version: row.GetInt32(2), PropertyId: row.GetGuid(3), Payload: row.GetString(4)), ct);
        if (due.Count == 0) return false;
        var (id, type, version, propertyId, payload) = due[0];

        List<PreparedDelivery>? prepared = null;
        Exception? handlerFailure = null;
        try
        {
            var handler = _handlers.Single(h => h.EventType == type && h.SchemaVersion == version);
            using var document = JsonDocument.Parse(payload);
            var drafts = await handler.HandleAsync(new EmailOutboxEventContext(id, type, version, propertyId, document.RootElement.Clone()), ct);
            prepared = Prepare(id, drafts);
        }
        catch (Exception exception) when (exception is not OperationCanceledException and not DbException and not DbUpdateException and not TimeoutException)
        {
            handlerFailure = exception;
        }

        if (handlerFailure is not null)
        {
            await transaction.RollbackAsync(ct);
            _database.ChangeTracker.Clear();
            // A handler's own refusal names a fixed safe code; anything else is the generic one and only its type is logged.
            var outcome = handlerFailure is EmailOutboxEventRejectedException rejected ? rejected.Code : "handler-error";
            await CountFanoutFailureAsync(id, now, outcome, ct);
            _logger.LogWarning("E-mail outbox event {EventId} could not be fanned out ({Reason}).", id, handlerFailure is EmailOutboxEventRejectedException ? outcome : handlerFailure.GetType().Name);
            return true;
        }

        foreach (var delivery in prepared!)
        {
            // Outside the counted catch above: if the key ring cannot protect, this throws, the transaction is rolled back and the event stays Pending with no attempt counted.
            var protectedRecipient = _protector.Protect(delivery.Recipient);
            var protectedMessage = _protector.Protect(delivery.MessageJson);
            await _database.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "EmailOutboxDeliveries" ("Id", "EventId", "PropertyId", "Purpose", "RecipientKey", "TemplateKey", "Locale", "ProtectedRecipient", "ProtectedMessage", "Status", "Attempts", "NextAttemptAtUtc", "UncertainSend", "CreatedAtUtc")
                VALUES ({delivery.Id}, {id}, {propertyId}, {delivery.Purpose}, {delivery.RecipientKey}, {delivery.TemplateKey}, {delivery.Locale}, {protectedRecipient}, {protectedMessage}, 'Pending', 0, {now}, false, {now})
                ON CONFLICT ("EventId", "Purpose", "RecipientKey") DO NOTHING
                """,
                ct);
        }

        var completed = await _database.EmailOutboxEvents.Where(e => e.Id == id && e.Status == EmailOutboxEvent.StatusPending)
            .ExecuteUpdateAsync(set => set.SetProperty(e => e.Status, EmailOutboxEvent.StatusCompleted).SetProperty(e => e.CompletedAtUtc, (DateTimeOffset?)now).SetProperty(e => e.LastOutcome, "fanned-out"), ct);
        if (completed != 1) throw new InvalidOperationException("An e-mail outbox event changed while its fan-out held it.");
        await transaction.CommitAsync(ct);
        return true;
    }

    /// <summary>A validated, rendered draft. Not yet protected: protecting needs the key ring, and a key-ring fault is the host's problem, never the handler's (it must not be counted against the event).</summary>
    private sealed record PreparedDelivery(Guid Id, string Purpose, string RecipientKey, string TemplateKey, string Locale, string Recipient, string MessageJson);

    private List<PreparedDelivery> Prepare(Guid eventId, IReadOnlyList<EmailDeliveryDraft> drafts)
    {
        if (drafts.Count > EmailOutboxLimits.DeliveriesPerEvent) throw new InvalidOperationException("Too many deliveries for one event.");
        var seen = new HashSet<(string, string)>();
        var result = new List<PreparedDelivery>(drafts.Count);
        foreach (var draft in drafts)
        {
            var purpose = draft.Purpose?.Trim() ?? string.Empty;
            var key = draft.RecipientKey?.Trim() ?? string.Empty;
            if (purpose.Length is 0 or > EmailOutboxLimits.Purpose || key.Length is 0 or > EmailOutboxLimits.RecipientKey || draft.TemplateKey is not { Length: > 0 and <= EmailOutboxLimits.TemplateKey })
            {
                throw new InvalidOperationException("A delivery draft has an invalid purpose, recipient key or template.");
            }

            if (!EmailText.IsAddress(draft.RecipientEmail)) throw new InvalidOperationException("A delivery draft has an invalid recipient address.");
            if (!seen.Add((purpose, key))) throw new InvalidOperationException("Two delivery drafts share one purpose and recipient key.");
            var rendered = _renderer.Render(draft.TemplateKey, draft.Locale, draft.Model);
            var message = JsonSerializer.Serialize(new { subject = rendered.Subject, text = rendered.Text, html = rendered.Html });
            result.Add(new PreparedDelivery(EmailOutboxSql.DeliveryId(eventId, purpose, key), purpose, key, draft.TemplateKey, rendered.ResolvedLocale, draft.RecipientEmail, message));
        }

        return result;
    }

    private async Task CountFanoutFailureAsync(Guid id, DateTimeOffset now, string outcome, CancellationToken ct)
    {
        // The backoff is worked out here, not in SQL: the row is Pending and fenced by the attempt count it was read with.
        var attempts = await _database.EmailOutboxEvents.AsNoTracking().Where(e => e.Id == id && e.Status == EmailOutboxEvent.StatusPending).Select(e => (int?)e.FanoutAttempts).SingleOrDefaultAsync(ct);
        if (attempts is not { } before) return;
        var status = before + 1 >= _options.FanoutMaxAttempts ? EmailOutboxEvent.StatusFailed : EmailOutboxEvent.StatusPending;
        var next = now + EmailRetryPolicy.Delay(before + 1, null, _options);
        await _database.EmailOutboxEvents.Where(e => e.Id == id && e.Status == EmailOutboxEvent.StatusPending && e.FanoutAttempts == before).ExecuteUpdateAsync(
            set => set.SetProperty(e => e.FanoutAttempts, before + 1).SetProperty(e => e.Status, status).SetProperty(e => e.LastOutcome, outcome).SetProperty(e => e.NextAttemptAtUtc, next), ct);
    }

    // ---------------------------------------------------------------- send

    /// <summary>Sends (or settles) one due delivery. False when nothing is due.</summary>
    private async Task<bool> SendOneAsync(EmailTransportIdentity identity, CancellationToken ct)
    {
        _database.ChangeTracker.Clear();
        var held = await ClaimAsync(ct);
        if (held is null) return false;
        var claim = held.Value;

        var row = await _database.EmailOutboxDeliveries.AsNoTracking().SingleAsync(d => d.Id == claim.Id, ct);
        var now = _clock.GetUtcNow();
        var window = TimeSpan.FromMinutes(_options.IdempotencyWindowMinutes);
        var timeout = TimeSpan.FromSeconds(_options.HttpTimeoutSeconds);

        if (claim.Attempts > _options.MaxAttempts)
        {
            await FinishExhaustedAsync(claim, row.UncertainSend, ct);
            return true;
        }

        // A retry: the account must be the one that was pinned, and the provider must still honor the key for the whole call. Otherwise nothing is sent and we do not claim to know whether the mail left.
        if (row.FirstAttemptAtUtc is { } first)
        {
            if (row.PinnedFingerprint != identity.Fingerprint)
            {
                await FinishAsync(claim, EmailOutboxDelivery.StatusNeedsReconciliation, "account-changed", ct);
                return true;
            }

            if (now + timeout > first + window)
            {
                await FinishAsync(claim, EmailOutboxDelivery.StatusNeedsReconciliation, "window-expired", ct);
                return true;
            }
        }

        if (!_protector.TryUnprotect(row.ProtectedRecipient, out var recipient) || !_protector.TryUnprotect(row.ProtectedMessage, out var messageJson))
        {
            // A lost key ring is the host's problem, not the delivery's: the queue keeps it, and the attempt is given back.
            await GiveBackAsync(claim, "payload-unreadable", ct);
            return true;
        }

        // The last check of this purpose's guard, on every attempt, before anything is pinned or sent. A stop is final: Failed when no earlier attempt can have reached the provider, otherwise NeedsReconciliation.
        if (_guards.FirstOrDefault(guard => guard.Purpose == row.Purpose) is { } purposeGuard)
        {
            EmailPreSendVerdict verdict;
            try
            {
                verdict = await purposeGuard.CheckAsync(new EmailPreSendContext(row.Id, row.EventId, row.PropertyId, row.Purpose, row.RecipientKey, recipient, row.CreatedAtUtc, now, timeout), ct);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // The check could not be made (a database fault): nothing is sent, the attempt is given back.
                _logger.LogWarning("E-mail delivery {DeliveryId} could not be checked before sending ({Reason}).", row.Id, exception.GetType().Name);
                await GiveBackAsync(claim, "guard-unavailable", ct);
                return true;
            }

            if (!verdict.Allow)
            {
                await FinishAsync(claim, row.UncertainSend ? EmailOutboxDelivery.StatusNeedsReconciliation : EmailOutboxDelivery.StatusFailed, verdict.Code, ct);
                return true;
            }
        }

        var from = row.PinnedFrom ?? identity.From;
        var pinned = await PinAsync(claim, identity.Fingerprint, from, now, ct);
        if (!pinned) return true; // The claim is no longer ours (the lease ran out): nothing is sent.

        var message = JsonDocument.Parse(messageJson).RootElement;
        // No transaction is open here: the claim was committed before this call and nothing is held while the provider answers.
        var result = await _transport.SendAsync(
            new EmailSendRequest(EmailOutboxSql.IdempotencyKey(claim.Id), from, recipient, message.GetProperty("subject").GetString()!, message.GetProperty("html").GetString()!, message.GetProperty("text").GetString()!), ct);

        switch (result.Outcome)
        {
            case EmailSendOutcome.Accepted:
                await AcceptAsync(claim, result.ProviderMessageId!, ct);
                break;
            case EmailSendOutcome.Permanent:
                await FinishAsync(claim, EmailOutboxDelivery.StatusFailed, result.Code, ct);
                break;
            case EmailSendOutcome.KeyConflict:
                await FinishAsync(claim, EmailOutboxDelivery.StatusNeedsReconciliation, result.Code, ct);
                break;
            case EmailSendOutcome.AuthRejected:
                await GiveBackAsync(claim, result.Code, ct);
                break;
            default:
                await RetryLaterAsync(claim, result, ct);
                break;
        }

        return true;
    }

    private IQueryable<EmailOutboxDelivery> Owned(Held held) =>
        _database.EmailOutboxDeliveries.Where(d => d.Id == held.Id && d.Status == EmailOutboxDelivery.StatusSending && d.ClaimId == held.ClaimId);

    private async Task<Held?> ClaimAsync(CancellationToken ct)
    {
        var now = _clock.GetUtcNow();
        var claimId = Guid.NewGuid();
        await using var transaction = await _database.Database.BeginTransactionAsync(ct);
        var rows = await EmailOutboxSql.QueryAsync(_database,
            """
            UPDATE "EmailOutboxDeliveries" SET "Status" = 'Sending', "Attempts" = "Attempts" + 1, "LeaseUntilUtc" = @lease, "ClaimId" = @claim,
                "UncertainSend" = ("UncertainSend" OR ("Status" = 'Sending' AND "FirstAttemptAtUtc" IS NOT NULL))
            WHERE "Id" = (
                SELECT "Id" FROM "EmailOutboxDeliveries"
                WHERE ("Status" = 'Pending' AND "NextAttemptAtUtc" <= @now) OR ("Status" = 'Sending' AND "LeaseUntilUtc" < @now)
                ORDER BY COALESCE("LeaseUntilUtc", "NextAttemptAtUtc"), "Id" LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING "Id", "Attempts"
            """,
            [("now", now), ("lease", now.AddSeconds(_options.LeaseSeconds)), ("claim", claimId)], row => (row.GetGuid(0), row.GetInt32(1)), ct);
        await transaction.CommitAsync(ct);
        return rows.Count == 0 ? null : new Held(rows[0].Item1, claimId, rows[0].Item2);
    }

    /// <summary>The first-attempt time, the pinned account and the pinned sender, written together, only while the claim is ours and its lease is alive, and before the provider is called.</summary>
    private async Task<bool> PinAsync(Held held, string fingerprint, string from, DateTimeOffset now, CancellationToken ct) =>
        await Owned(held).Where(d => d.LeaseUntilUtc > now).ExecuteUpdateAsync(
            set => set.SetProperty(d => d.FirstAttemptAtUtc, d => d.FirstAttemptAtUtc ?? now).SetProperty(d => d.PinnedFingerprint, d => d.PinnedFingerprint ?? fingerprint)
                .SetProperty(d => d.PinnedFrom, d => d.PinnedFrom ?? from).SetProperty(d => d.LastAttemptAtUtc, (DateTimeOffset?)now), ct) == 1;

    private async Task AcceptAsync(Held held, string providerMessageId, CancellationToken ct)
    {
        var now = _clock.GetUtcNow();
        // The message and the address are no longer needed once the provider holds the mail.
        await Owned(held).ExecuteUpdateAsync(
            set => set.SetProperty(d => d.Status, EmailOutboxDelivery.StatusAccepted).SetProperty(d => d.ProviderMessageId, providerMessageId).SetProperty(d => d.AcceptedAtUtc, (DateTimeOffset?)now)
                .SetProperty(d => d.LastOutcome, "accepted").SetProperty(d => d.ProtectedRecipient, (string?)null).SetProperty(d => d.ProtectedMessage, (string?)null)
                .SetProperty(d => d.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(d => d.ClaimId, (Guid?)null), ct);
    }

    private async Task FinishAsync(Held held, string status, string outcome, CancellationToken ct)
    {
        var finished = await Owned(held).ExecuteUpdateAsync(
            set => set.SetProperty(d => d.Status, status).SetProperty(d => d.LastOutcome, outcome).SetProperty(d => d.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(d => d.ClaimId, (Guid?)null), ct);
        // Only the id and the outcome code: an operator finds the delivery by id (see IEmailOutboxFailures).
        if (finished == 1) _logger.LogWarning("E-mail delivery {DeliveryId} is {Status} ({Outcome}).", held.Id, status, outcome);
    }

    /// <summary>Out of attempts: if any attempt may have reached the provider the delivery needs reconciliation; otherwise it is a plain failure.</summary>
    private Task FinishExhaustedAsync(Held held, bool uncertain, CancellationToken ct) =>
        uncertain ? FinishAsync(held, EmailOutboxDelivery.StatusNeedsReconciliation, "uncertain", ct) : FinishAsync(held, EmailOutboxDelivery.StatusFailed, "gave-up", ct);

    /// <summary>Nothing was processed by the provider and the fault is not the message's: the attempt is returned and the delivery waits the longest backoff.</summary>
    private async Task GiveBackAsync(Held held, string outcome, CancellationToken ct)
    {
        var next = _clock.GetUtcNow().AddSeconds(_options.RetryMaxSeconds);
        await Owned(held).ExecuteUpdateAsync(
            set => set.SetProperty(d => d.Status, EmailOutboxDelivery.StatusPending).SetProperty(d => d.Attempts, d => d.Attempts - 1).SetProperty(d => d.LastOutcome, outcome)
                .SetProperty(d => d.NextAttemptAtUtc, next).SetProperty(d => d.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(d => d.ClaimId, (Guid?)null), ct);
    }

    private async Task RetryLaterAsync(Held held, EmailSendResult result, CancellationToken ct)
    {
        var uncertain = result.Outcome == EmailSendOutcome.Unknown;
        if (held.Attempts >= _options.MaxAttempts)
        {
            var row = await _database.EmailOutboxDeliveries.AsNoTracking().Where(d => d.Id == held.Id).Select(d => d.UncertainSend).SingleAsync(ct);
            await FinishExhaustedAsync(held, row || uncertain, ct);
            return;
        }

        var next = _clock.GetUtcNow() + EmailRetryPolicy.Delay(held.Attempts, result.RetryAfter, _options);
        await Owned(held).ExecuteUpdateAsync(
            set => set.SetProperty(d => d.Status, EmailOutboxDelivery.StatusPending).SetProperty(d => d.LastOutcome, result.Code).SetProperty(d => d.NextAttemptAtUtc, next)
                .SetProperty(d => d.UncertainSend, d => d.UncertainSend || uncertain).SetProperty(d => d.LeaseUntilUtc, (DateTimeOffset?)null).SetProperty(d => d.ClaimId, (Guid?)null), ct);
    }
}

/// <summary>The host's timer for the dispatcher. Off unless <c>Email:Outbox:WorkerEnabled</c> is true (and the dispatcher itself is off unless <c>DispatchEnabled</c> is true): every test host starts with both off.</summary>
internal sealed class EmailOutboxWorker(IServiceScopeFactory scopes, EmailOutboxOptions options, BookingConfirmationEmailOptions booking, ILogger<EmailOutboxWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.WorkerEnabled) return;
        if (!options.DispatchEnabled || !options.Resend.IsConfigured) logger.LogWarning("The e-mail outbox timer is on but dispatch is off or the provider is not configured: queued mail waits.");
        if (booking.Enabled && !booking.IsActive(options)) logger.LogWarning("Booking confirmation e-mails are enabled but need a Customer_Web https origin and a configured provider: booking events stay queued.");
        var delay = TimeSpan.FromSeconds(options.WorkerPollSeconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<IEmailOutboxDispatcher>().ProcessBatchAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // The next tick tries again; leases and claim tokens protect a half-done delivery. Only the exception's type is logged.
                logger.LogWarning("{Reason} in the e-mail outbox worker.", exception.GetType().Name);
            }

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { }
        }
    }
}
