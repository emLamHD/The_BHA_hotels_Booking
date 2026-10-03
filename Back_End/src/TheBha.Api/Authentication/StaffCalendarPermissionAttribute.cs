using Microsoft.AspNetCore.Mvc.Filters;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP04: marks an Admin Calendar action as converted to Staff authorization and
/// is itself the filter that enforces it, so the metadata cannot be present without the check.
/// In <see cref="AdminCalendarAccessMode.LocalGate"/> it runs <see cref="LocalGateFilter"/> (the
/// route's existing local gate, unchanged); in <see cref="AdminCalendarAccessMode.Staff"/> it
/// requires a Staff session with <see cref="Permission"/> at the route's Property
/// (<see cref="StaffCalendarAccessFilter"/>). <see cref="StaffCalendarModeGuard"/> keeps every
/// Admin route without this attribute closed in Staff mode.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class StaffCalendarPermissionAttribute(StaffPermission permission, Type localGateFilter)
    : Attribute, IFilterFactory
{
    public StaffPermission Permission { get; } = permission;

    /// <summary>A resource filter registered in DI: the local gate this route keeps in LocalGate mode.</summary>
    public Type LocalGateFilter { get; } = localGateFilter;

    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider)
    {
        var access = serviceProvider.GetRequiredService<AdminCalendarAccess>();
        return access.Mode == AdminCalendarAccessMode.Staff
            ? new StaffCalendarAccessFilter(
                Permission,
                serviceProvider.GetRequiredService<IStaffAccessEvaluator>())
            : (IResourceFilter)serviceProvider.GetRequiredService(LocalGateFilter);
    }
}
