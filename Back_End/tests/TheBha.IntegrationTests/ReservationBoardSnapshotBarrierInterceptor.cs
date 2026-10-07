using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.1 correction C4, test-only: a deterministic barrier that pauses
/// the Admin Reservation Board projection immediately after one specific,
/// tagged query completes, so a test can commit a competing transaction on
/// another connection at exactly that point and then let the projection
/// continue. This replaces any timing guess (<c>Task.Delay</c>, sleeps,
/// retry-until-observed loops) with an exact, reproducible interleaving.
///
/// <para>
/// Only the first matching command is paused — later requests in the same test
/// (for example the post-cancellation re-read) run unimpeded. Registered as an
/// <see cref="IInterceptor"/> singleton on a test-scoped
/// <c>WithWebHostBuilder</c> factory only; it never exists in production DI.
/// </para>
/// </summary>
internal sealed class ReservationBoardSnapshotBarrierInterceptor(string queryTag) : DbCommandInterceptor
{
    private readonly TaskCompletionSource _reached = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _tripped;

    /// <summary>Completes once the tagged query has executed and the projection is paused.</summary>
    public Task Reached => _reached.Task;

    /// <summary>Lets the paused projection continue.</summary>
    public void Release() => _released.TrySetResult();

    public override async ValueTask<DbDataReader> ReaderExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        if (command.CommandText.Contains(queryTag, StringComparison.Ordinal) &&
            Interlocked.Exchange(ref _tripped, 1) == 0)
        {
            _reached.TrySetResult();
            await _released.Task.WaitAsync(cancellationToken);
        }

        return result;
    }
}
