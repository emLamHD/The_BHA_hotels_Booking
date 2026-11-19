namespace TheBha.Domain.Website;

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: one real move of a subscription from <c>PendingVerification</c> to <c>Verified</c>, written in the same transaction as the move and its Welcome (a
/// rollback leaves nothing). It holds no e-mail address, no token and nothing about Gmail: the number it was given, the subscription's id and when. Deleting the
/// subscription deletes its activity (the row only counts verifications that still exist).
/// <para><see cref="Sequence"/> is NOT an identity column: it is taken from <see cref="MenuActivityStream"/> inside the verification's transaction, and that row stays locked until the
/// commit, so numbers commit in the order they were given. That is what makes "everything up to N is committed" true for a reader that sees N (a plain identity would let 7 commit before 6).</para>
/// </summary>
public sealed class NewsletterVerificationActivity
{
    public long Sequence { get; set; }
    public Guid SubscriptionId { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
}

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: the counter of one menu's activity stream; <see cref="LastSequence"/> is the last number given (0 = nothing yet). The only writer takes the next number with
/// one <c>UPDATE … RETURNING</c> and keeps this row locked until its transaction ends: that is the single serialisation point of the stream, and it is last in every lock order
/// (subscription, its mails, then this row), so a reader or an acknowledgement, which never lock a subscription, cannot be part of a cycle with it.
/// </summary>
public sealed class MenuActivityStream
{
    public const string Newsletter = "newsletter";

    public string MenuKey { get; set; } = string.Empty;
    public long LastSequence { get; set; }
}

/// <summary>
/// BHA-NEWSLETTER-BADGE-001: how far one Staff member has seen one menu (<see cref="LastSeenSequence"/> = the watermark of the last list they loaded successfully). A Staff
/// member with no row counts from 0. Only moved up, atomically (<c>GREATEST</c>), so an older acknowledgement arriving late never pulls it back.
/// </summary>
public sealed class StaffMenuSeen
{
    public Guid StaffAccountId { get; set; }
    public string MenuKey { get; set; } = string.Empty;
    public long LastSeenSequence { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
