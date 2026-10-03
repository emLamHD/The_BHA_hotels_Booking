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
        CancellationToken cancellationToken)
    {
        var role = await (
                from membership in database.StaffPropertyMemberships.AsNoTracking()
                join staff in database.StaffAccounts.AsNoTracking()
                    on membership.StaffAccountId equals staff.Id
                where membership.StaffAccountId == staffId &&
                      membership.PropertyId == propertyId &&
                      staff.IsActive
                select membership.Role)
            .SingleOrDefaultAsync(cancellationToken);
        return StaffPermissions.RoleGrants(role, permission);
    }
}
