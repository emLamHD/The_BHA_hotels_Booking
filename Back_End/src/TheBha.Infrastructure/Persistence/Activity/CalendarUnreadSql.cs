namespace TheBha.Infrastructure.Persistence.Activity;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR12 (ADR 0011 §D, decision D2): the ONE definition of "another person's event this Staff member has not read" for a Calendar object. The Property summary, the board's
/// per-object state and the unseen list all splice it, so they cannot disagree. It needs the aliases <c>a</c> (<c>AdminActivities</c>) and <c>e</c> (the Staff member's <c>StaffEntitySeen</c> row
/// of the SAME object, LEFT JOINed: no row = cursor 0); the baseline and the actor come from the caller's own columns or parameters. SQL text is built from constants only.
/// </summary>
internal static class CalendarUnreadSql
{
    public static string Unread(string staffCreatedAtUtc, string staffId) =>
        $"""a."Sequence" > COALESCE(e."LastSeenSequence", 0) AND a."OccurredAtUtc" >= {staffCreatedAtUtc} AND a."ActorStaffId" IS DISTINCT FROM {staffId}""";

    /// <summary>The join that gives a row of <c>AdminActivities</c> (<c>a</c>) the Staff member's cursor row (<c>e</c>) of its own object.</summary>
    public static string JoinSeen(string staffId) =>
        $"""LEFT JOIN "StaffEntitySeen" e ON e."StaffAccountId" = {staffId} AND e."PropertyId" = a."PropertyId" AND e."EntityKind" = a."EntityKind" AND e."EntityKey" = a."EntityKey" """;
}
