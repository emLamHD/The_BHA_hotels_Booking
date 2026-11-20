using System.Collections.Concurrent;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.SignalR;
using TheBha.Api.Authentication;
using TheBha.Application.Activity;
using TheBha.Domain.Website;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Realtime;

/// <summary>What a hint carries, and nothing else: the menu and, for a Property-scoped menu, the Property. No title, count or actor; the screen reads the API again.</summary>
public sealed record AdminActivityHintPayload(string MenuKey, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PropertyId);

/// <summary>A server-to-client pipe with no method a client can call. Authorized at connect (<see cref="StaffAdminActivityLiveAccess"/>) and again, per recipient, at every send.</summary>
public sealed class AdminActivityHub(AdminActivityConnections connections) : Hub
{
    public const string HintMethod = "menuActivity";

    /// <summary>Sent once the connection is registered, so a client reads its numbers after it can hear a hint (the handshake completes before <see cref="OnConnectedAsync"/> runs).</summary>
    public const string ReadyMethod = "menuActivityReady";

    public override async Task OnConnectedAsync()
    {
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

/// <summary>The open connections of this API instance (in memory: no backplane, as the Newsletter Hub).</summary>
public sealed class AdminActivityConnections
{
    private readonly ConcurrentDictionary<string, NewsletterLiveConnection> _connections = new(StringComparer.Ordinal);

    public int Count => _connections.Count;
    public void Add(string connectionId, NewsletterLiveConnection connection) => _connections[connectionId] = connection;
    public void Remove(string connectionId) => _connections.TryRemove(connectionId, out _);
    public IReadOnlyList<KeyValuePair<string, NewsletterLiveConnection>> Snapshot() => [.. _connections];
}

/// <summary>
/// Sends a hint to the connections that may read the menu (and Property) NOW: one database read per send judges every connection's account. A connection whose session is no longer valid
/// (expired, account missing or disabled, security stamp changed) is closed; one that merely lacks this menu or Property is skipped and stays open (it may read other menus).
/// </summary>
public sealed class AdminActivityHintBroadcaster(
    IHubContext<AdminActivityHub> hub,
    AdminActivityConnections connections,
    IServiceScopeFactory scopes,
    TimeProvider time,
    ILogger<AdminActivityHintBroadcaster> log)
{
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(3);

    public async Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken)
    {
        if (!AdminMenus.IsKnown(menuKey) || AdminMenuKeys.IsPropertyScoped(menuKey) != propertyId.HasValue || propertyId == Guid.Empty)
            throw new ArgumentException("A hint names a known menu, with a Property exactly when the menu is Property-scoped.", nameof(menuKey));
        if (connections.Count == 0) return;
        try
        {
            using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            bounded.CancelAfter(Budget);
            var open = connections.Snapshot();
            await using var scope = scopes.CreateAsyncScope();
            var judged = await scope.ServiceProvider.GetRequiredService<IAdminMenuAccess>()
                .JudgeAsync(menuKey, propertyId, [.. open.Select(pair => pair.Value.StaffId).Distinct()], bounded.Token);
            var now = time.GetUtcNow();
            var entitled = new List<string>(open.Count);
            foreach (var (id, connection) in open)
            {
                var recipient = judged.FirstOrDefault(row => row.StaffId == connection.StaffId);
                if (now >= connection.ExpiresUtc || recipient is null || !string.Equals(recipient.SecurityStamp, connection.SecurityStamp, StringComparison.Ordinal))
                {
                    connections.Remove(id);
                    connection.Context.Abort();
                }
                else if (recipient.CanRead)
                {
                    entitled.Add(id);
                }
            }

            if (entitled.Count > 0)
            {
                await hub.Clients.Clients(entitled).SendAsync(AdminActivityHub.HintMethod, new AdminActivityHintPayload(menuKey, propertyId), bounded.Token);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // Best effort: the business change is already committed, and the screens poll.
            log.LogWarning(exception, "Admin activity hint for '{Menu}' was not delivered.", menuKey);
        }
    }
}

/// <summary>
/// The scoped <see cref="IAdminActivityHint"/> a write service calls. It refuses a call made while the caller's transaction is still open (a hint is sent only after COMMIT).
/// </summary>
public sealed class AdminActivityHint(TheBhaDbContext database, AdminActivityHintBroadcaster broadcaster) : IAdminActivityHint
{
    public Task PublishAsync(string menuKey, Guid? propertyId, CancellationToken cancellationToken) =>
        database.Database.CurrentTransaction is not null
            ? throw new InvalidOperationException("An admin activity hint must be sent after the transaction committed; one is still open.")
            : broadcaster.PublishAsync(menuKey, propertyId, cancellationToken);
}
