using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Activity;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR08 (ADR 0011 §A, §D): who and where an Admin website write records its activity. <paramref name="ActorStaffId"/> is the verified Staff session's id, taken from the
/// command; the service never invents one.
/// </summary>
internal sealed record WebsiteActivityScope(IAdminActivityRecorder Recorder, IAdminActivityHint Hint, string MenuKey, Guid ActorStaffId);

/// <summary>
/// The one event a write wants appended, set by the work of <see cref="WebsiteTransaction.InLockAsync{T}"/> ONLY on the branch that really changed data. Left unset (a no-op, a refusal) nothing is
/// recorded and nothing is hinted. The transaction appends it as its last statement before COMMIT, so the work cannot take the counter early or record on a path that rolls back.
/// </summary>
internal sealed class ActivityNote
{
    internal (string Action, string Kind, string Key, string? Title)? Event { get; private set; }

    /// <summary>The caller composes <paramref name="title"/> from a short allow-list (a code or a short generic name): never a translation text, a contact detail, an e-mail, a token or a URL.</summary>
    public void Set(string action, string kind, string key, string? title) => Event = (action, kind, key, title);
}

internal static class WebsiteActivity
{
    /// <summary>Called only after COMMIT, on no open transaction. Not given the caller's token: the change is already durable, and a cancelled caller must not skip the hint (delivery is bounded and best effort).</summary>
    public static Task HintAsync(IAdminActivityHint hint, string menuKey) => hint.PublishAsync(menuKey, null, CancellationToken.None);

    public static Task RecordAsync(WebsiteActivityScope scope, string action, string kind, string key, string? title, CancellationToken cancellationToken, int itemCount = 1) =>
        scope.Recorder.RecordAsync(new AdminActivityEntry(scope.MenuKey, null, AdminActorKind.Staff, scope.ActorStaffId, action, kind, key, title, itemCount), cancellationToken);

    /// <summary>
    /// Runs <paramref name="read"/> inside one REPEATABLE READ snapshot whose FIRST statement reads the menu's counter, so the rows it returns and the watermark are the same committed state: every
    /// event up to the watermark is reflected in the rows and none after it is claimed. Only an Admin GET entry point calls it: it opens a transaction, so it must never run inside another one.
    /// </summary>
    public static async Task<T> InSnapshotAsync<T>(TheBhaDbContext database, string menuKey, Func<string, Task<T>> read, CancellationToken cancellationToken)
    {
        await using var snapshot = await database.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        var watermark = (await database.MenuActivityStreams.AsNoTracking().Where(stream => stream.MenuKey == menuKey).Select(stream => stream.LastSequence).SingleAsync(cancellationToken))
            .ToString(CultureInfo.InvariantCulture);
        return await read(watermark);
    }
}
