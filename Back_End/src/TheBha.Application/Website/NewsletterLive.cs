namespace TheBha.Application.Website;

/// <summary>
/// BHA-NEWSLETTER-LIVE-001: the whole of what a "someone just verified" signal carries. It names no address, token, row or
/// sender: the screen that receives it reads the list again from the API, so the signal only says "look again". <see cref="EventId"/> is new
/// for every transition from pending to verified, so a client can drop a signal it has already handled.
/// </summary>
public sealed record NewsletterVerifiedSignal(Guid EventId, DateTimeOffset OccurredAtUtc);

/// <summary>
/// Told AFTER a verification has been committed that a subscription really moved from <c>PendingVerification</c> to <c>Verified</c>. Delivery is best effort and
/// limited to the connections this API instance holds (no replay, no other instance): a screen that missed a signal finds the row by reading the list again.
/// An implementation must not throw for a delivery problem, and the caller does not let it change the verification it reports.
/// </summary>
public interface INewsletterLiveSignal
{
    Task PublishVerifiedAsync(NewsletterVerifiedSignal signal, CancellationToken cancellationToken);
}

/// <summary>
/// The optional <c>sort</c> of the Staff list. Nothing (or an empty value) keeps the order callers have always had, newest request first.
/// <c>recent-activity</c> puts the address with the newest sign-up or verification first: <c>VerifiedAtUtc ?? ReceivedAtUtc</c>, then the id.
/// </summary>
public static class NewsletterListSort
{
    public const string RecentActivity = "recent-activity";
    public static bool IsKnown(string? value) => string.IsNullOrEmpty(value) || value == RecentActivity;
}
