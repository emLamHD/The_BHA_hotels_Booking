using System.Collections.Concurrent;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using TheBha.Api.Authentication;
using TheBha.Application.Website;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Realtime;

/// <summary>
/// BHA-NEWSLETTER-LIVE-001: the Hub is only a pipe from the server to the Admin Newsletter screen. It has no method a client can call, and what it sends is
/// <see cref="NewsletterVerifiedSignal"/> and nothing else. Authorization happens twice: the endpoint policy at connect (see <see cref="StaffNewsletterLiveAccess"/>),
/// and <see cref="NewsletterLiveBroadcaster"/> again for every connection at every send, because SignalR does not re-authorize a connection that is already open.
/// </summary>
public sealed class NewsletterLiveHub(NewsletterLiveConnections connections) : Hub
{
    public const string VerifiedMethod = "newsletterVerified";

    /// <summary>
    /// Sent to the new connection once it is registered and can receive a signal. SignalR completes the client's handshake BEFORE <see cref="OnConnectedAsync"/> runs, so a
    /// client that reads the list as soon as it is "connected" could do so a moment before it is registered and miss a verification committed in between. The client reads
    /// the list after this message instead.
    /// </summary>
    public const string ReadyMethod = "newsletterLiveReady";

    public override async Task OnConnectedAsync()
    {
        // The principal and the ticket of THIS connection: the Staff id, the security stamp and the moment the session ends are kept so every later send can be judged against them.
        AuthenticateResult? result = null;
        if (Context.GetHttpContext() is { } http)
        {
            try
            {
                result = await http.AuthenticateAsync(StaffAuthentication.Scheme);
            }
            catch (Exception)
            {
                result = null;
            }
        }

        if (result is not { Succeeded: true, Principal: { } principal } ||
            StaffAuthentication.GetStaffId(principal) is not { } staffId ||
            principal.FindAll(StaffAuthentication.SecurityStampClaimType).ToArray() is not [{ Value: { Length: > 0 } stamp }] ||
            result.Properties?.ExpiresUtc is not { } expires)
        {
            Context.Abort();
            return;
        }

        connections.Add(Context.ConnectionId, new NewsletterLiveConnection(Context, staffId, stamp, expires));
        await Clients.Caller.SendAsync(ReadyMethod);
        await base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        connections.Remove(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}

public sealed record NewsletterLiveConnection(HubCallerContext Context, Guid StaffId, string SecurityStamp, DateTimeOffset ExpiresUtc);

/// <summary>The open Hub connections of this API instance. In memory on purpose: one instance is the supported operating shape (no backplane).</summary>
public sealed class NewsletterLiveConnections
{
    private readonly ConcurrentDictionary<string, NewsletterLiveConnection> _connections = new(StringComparer.Ordinal);

    public int Count => _connections.Count;
    public void Add(string connectionId, NewsletterLiveConnection connection) => _connections[connectionId] = connection;
    public void Remove(string connectionId) => _connections.TryRemove(connectionId, out _);
    public IReadOnlyList<KeyValuePair<string, NewsletterLiveConnection>> Snapshot() => [.. _connections];
}

/// <summary>
/// Sends the signal to the connections that are still entitled to it, and closes the ones that are not: session ended, account missing or disabled, security stamp
/// changed (sign-out elsewhere, password reset) or the website permission revoked. All read from the database now, in a scope of its own (never the scope of the
/// request that verified the address). No replay, no other instance: a screen that missed a signal reads the list again.
/// </summary>
public sealed class NewsletterLiveBroadcaster(
    IHubContext<NewsletterLiveHub> hub,
    NewsletterLiveConnections connections,
    IServiceScopeFactory scopes,
    TimeProvider time) : INewsletterLiveSignal
{
    /// <summary>How long a verification request waits for the signal at most: the verification is already committed.</summary>
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(3);

    public async Task PublishVerifiedAsync(NewsletterVerifiedSignal signal, CancellationToken cancellationToken)
    {
        if (connections.Count == 0) return;
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(Budget);
        var entitled = await SweepAsync(bounded.Token);
        if (entitled.Count > 0)
        {
            await hub.Clients.Clients(entitled).SendAsync(NewsletterLiveHub.VerifiedMethod, signal, bounded.Token);
        }
    }

    /// <summary>
    /// Re-judges every open connection, aborts the ones that are no longer entitled and returns the ids of the rest. A database failure throws without touching any
    /// connection: a failed check is not a revocation.
    /// </summary>
    public async Task<IReadOnlyList<string>> SweepAsync(CancellationToken cancellationToken)
    {
        var open = connections.Snapshot();
        if (open.Count == 0) return [];
        var staffIds = open.Select(pair => pair.Value.StaffId).Distinct().ToArray();
        await using var scope = scopes.CreateAsyncScope();
        var database = scope.ServiceProvider.GetRequiredService<TheBhaDbContext>();
        var current = await database.StaffAccounts.AsNoTracking()
            .Where(account => staffIds.Contains(account.Id) && account.IsActive && account.CanManageWebsite)
            .Select(account => new { account.Id, account.SecurityStamp })
            .ToListAsync(cancellationToken);
        var now = time.GetUtcNow();

        var entitled = new List<string>(open.Count);
        foreach (var (id, connection) in open)
        {
            var allowed = now < connection.ExpiresUtc &&
                current.Any(account => account.Id == connection.StaffId && string.Equals(account.SecurityStamp, connection.SecurityStamp, StringComparison.Ordinal));
            if (allowed)
            {
                entitled.Add(id);
            }
            else
            {
                connections.Remove(id);
                connection.Context.Abort();
            }
        }

        return entitled;
    }
}

/// <summary>Closes the connections whose session has ended or whose permission was revoked even when nothing is being sent.</summary>
public sealed class NewsletterLiveSweeper(NewsletterLiveBroadcaster broadcaster, ILogger<NewsletterLiveSweeper> log) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await broadcaster.SweepAsync(stoppingToken);
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    log.LogWarning(exception, "Newsletter live: the periodic check of open connections failed; it is retried.");
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    }
}
