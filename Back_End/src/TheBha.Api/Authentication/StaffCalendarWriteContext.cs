namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP05 (D8): what <see cref="StaffCalendarAccessFilter"/> established for this
/// request in Staff mode — the Staff id from the <c>TheBha.Staff</c> principal it authenticated, the
/// route's Property, and the role it read from the database to grant the request. Kept in the
/// request's features only; never taken from the body, query, headers or a role claim.
/// </summary>
public sealed record StaffCalendarWriteContext(Guid StaffId, Guid PropertyId, string Role)
{
    /// <summary>The audit actor: the canonical Staff GUID, no email or other PII.</summary>
    public string ActorReference => $"staff:{StaffId:D}";

    /// <summary>The cross-RoomType authorization evidence, from the verified role and Property.</summary>
    public string CrossRoomTypeEvidence => $"staff-rbac:{Role}:{PropertyId:D}:cross-room-type-confirmed";

    /// <summary>Whether the role that authorized this request also grants <paramref name="permission"/>.</summary>
    public bool Grants(StaffPermission permission) => StaffPermissions.RoleGrants(Role, permission);

    /// <summary>
    /// The context for <paramref name="propertyId"/>, or <c>null</c> when there is none or it was
    /// established for another Property — callers in Staff mode must then refuse, never fall back
    /// to a local actor.
    /// </summary>
    public static StaffCalendarWriteContext? For(HttpContext httpContext, Guid propertyId) =>
        httpContext.Features.Get<StaffCalendarWriteContext>() is { } context && context.PropertyId == propertyId
            ? context
            : null;
}
