using Microsoft.EntityFrameworkCore;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Authentication;

/// <summary>PMS-ADMIN-AUTH-001 §4: the fixed Admin Calendar permissions.</summary>
public enum StaffPermission
{
    BoardRead,
    AssignmentWrite,
    BlockWrite,
    AssignmentCrossRoomType
}

/// <summary>
/// CUST-WEB-HEADER-001-CP02: a permission that belongs to the Staff member, not to a Property (ADR 0008). It
/// is not part of <see cref="StaffPermission"/>, so the FrontDesk/Manager Calendar matrix cannot be widened by it.
/// </summary>
public enum StaffGlobalPermission
{
    WebsiteSettingsManage
}

/// <summary>
/// The fixed role → permission map (Owner decision): <c>FrontDesk</c> reads the board and writes
/// assignments and blocks; <c>Manager</c> also places assignments across RoomTypes. Any other role
/// or permission value grants nothing.
/// </summary>
public static class StaffPermissions
{
    public static bool RoleGrants(string? role, StaffPermission permission) => role switch
    {
        StaffRole.FrontDesk => permission is StaffPermission.BoardRead
            or StaffPermission.AssignmentWrite
            or StaffPermission.BlockWrite,
        StaffRole.Manager => permission is StaffPermission.BoardRead
            or StaffPermission.AssignmentWrite
            or StaffPermission.BlockWrite
            or StaffPermission.AssignmentCrossRoomType,
        _ => false
    };

    /// <summary>The names <c>me</c> and login report: the global permissions the database grants this account right now.</summary>
    public static IReadOnlyList<string> GlobalNames(bool canManageWebsite) =>
        canManageWebsite ? [nameof(StaffGlobalPermission.WebsiteSettingsManage)] : [];
}

/// <summary>
/// PMS-ADMIN-AUTH-001-CP04: the one authorization seam. The resource is the route's Property;
/// roles, Property ids and permissions are never taken from the cookie, body or query.
/// </summary>
public interface IStaffAccessEvaluator
{
    Task<bool> HasPermissionAsync(
        Guid staffId,
        Guid propertyId,
        StaffPermission permission,
        CancellationToken cancellationToken);

    /// <summary>
    /// PMS-ADMIN-AUTH-001-CP05: the role this active Staff member holds at this Property right
    /// now, or <c>null</c>. A caller that authorizes with it keeps it for the rest of the request,
    /// so the permission check and anything recorded about it (audit evidence) use one role.
    /// </summary>
    Task<string?> GetRoleAsync(Guid staffId, Guid propertyId, CancellationToken cancellationToken);

    /// <summary>
    /// CUST-WEB-HEADER-001-CP02: whether this Staff member holds the global permission right now: the account
    /// exists, is active, and the flag is set in the database. Read on every call, never cached or taken from the cookie.
    /// </summary>
    Task<bool> HasGlobalPermissionAsync(Guid staffId, StaffGlobalPermission permission, CancellationToken cancellationToken);
}

/// <summary>
/// Reads the current membership of this Staff member at this Property from the database on every
/// call — no cache — and grants only what <see cref="StaffPermissions"/> maps that role to. No
/// membership, a disabled Staff member or another Property's membership grants nothing.
/// </summary>
public sealed class StaffAccessEvaluator(TheBhaDbContext database) : IStaffAccessEvaluator
{
    public async Task<bool> HasPermissionAsync(
        Guid staffId,
        Guid propertyId,
        StaffPermission permission,
        CancellationToken cancellationToken) =>
        StaffPermissions.RoleGrants(await GetRoleAsync(staffId, propertyId, cancellationToken), permission);

    public Task<bool> HasGlobalPermissionAsync(Guid staffId, StaffGlobalPermission permission, CancellationToken cancellationToken) =>
        permission switch
        {
            StaffGlobalPermission.WebsiteSettingsManage => database.StaffAccounts.AsNoTracking()
                .AnyAsync(account => account.Id == staffId && account.IsActive && account.CanManageWebsite, cancellationToken),
            _ => Task.FromResult(false)
        };

    public Task<string?> GetRoleAsync(Guid staffId, Guid propertyId, CancellationToken cancellationToken) =>
        (from membership in database.StaffPropertyMemberships.AsNoTracking()
         join staff in database.StaffAccounts.AsNoTracking()
             on membership.StaffAccountId equals staff.Id
         where membership.StaffAccountId == staffId &&
               membership.PropertyId == propertyId &&
               staff.IsActive
         select membership.Role)
        .SingleOrDefaultAsync(cancellationToken);
}
