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
///
/// <para>
/// PMS-ADMIN-AUTH-001-CP05: applied per action, never per controller, so an action added later
/// is neither opened in Staff mode (the guard closes it) nor left ungated in LocalGate without a
/// deliberate decision — a test pins that every write action of the two Calendar controllers
/// carries it.
/// </para>
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
                serviceProvider.GetRequiredService<IStaffAccessEvaluator>(),
                serviceProvider.GetRequiredService<StaffRequestBoundaryFilter>())
            : (IResourceFilter)serviceProvider.GetRequiredService(LocalGateFilter);
    }
}
