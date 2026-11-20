using TheBha.Domain.Website;

namespace TheBha.Application.Activity;

/// <summary>The action names the recorder's correlation rule (ADR 0011 §D) depends on; every other action is free text of the calling service (at most 40 characters).</summary>
public static class AdminActivityActions
{
    public const string Created = "Created";
    public const string DraftSaved = "DraftSaved";
    public const string Published = "Published";
}

/// <summary>
/// One event for <see cref="IAdminActivityRecorder"/>. <see cref="ActorStaffId"/> must come from the verified Staff session (never from a request field) and is set exactly when
/// <see cref="ActorKind"/> is <see cref="AdminActorKind.Staff"/>. <see cref="PropertyId"/> is set exactly for the Property-scoped menus (<c>promotions</c>, <c>calendar</c>).
/// <see cref="TitleSnapshot"/> is chosen by the caller from the menu's allow-list (never a guest name, e-mail, phone, note, reservation code or secret); the recorder only trims it, removes
/// control characters and caps it at 200. <see cref="CorrelationId"/> is only a request to link the rows of one Blog save-then-publish chain; the recorder decides whether it is kept.
/// </summary>
public sealed record AdminActivityEntry(
    string MenuKey,
    Guid? PropertyId,
    AdminActorKind ActorKind,
    Guid? ActorStaffId,
    string Action,
    string EntityKind,
    string EntityKey,
    string? TitleSnapshot,
    int ItemCount = 1,
    Guid? CorrelationId = null);

/// <summary>
/// Appends one event to a menu's activity stream (ADR 0011 §A, §D). The contract:
/// <list type="bullet">
/// <item>It runs on the caller's <c>DbContext</c> and INSIDE the caller's transaction, and throws <see cref="InvalidOperationException"/> when there is none (an autocommit insert would lose the atomicity).</item>
/// <item>Call it by name as the LAST statement before COMMIT, after the business writes and the audit row: it takes the menu's counter row, which stays locked until COMMIT (the last lock of the transaction). A rollback leaves neither the number nor the row.</item>
/// <item>A menu with no counter row throws <see cref="InvalidOperationException"/>; the caller lets its transaction roll back (something that cannot be counted must not commit).</item>
/// <item>The transaction must be READ COMMITTED (the default); under REPEATABLE READ a concurrent counter update surfaces as PostgreSQL 40001.</item>
/// <item>A wrong <paramref name="entry"/> (an actor that does not match its kind, a missing or unexpected Property, a key that is empty or too long) throws <see cref="ArgumentException"/>.</item>
/// </list>
/// </summary>
public interface IAdminActivityRecorder
{
    Task RecordAsync(AdminActivityEntry entry, CancellationToken cancellationToken);
}
