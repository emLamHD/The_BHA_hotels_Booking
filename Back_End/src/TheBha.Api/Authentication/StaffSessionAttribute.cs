using Microsoft.AspNetCore.Mvc.Filters;

namespace TheBha.Api.Authentication;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR03 (ADR 0011 §B): marks an Admin action that needs a Staff session and NO single permission, because the permission differs per menu and Property and is decided in the
/// service, from the database, on every request. Like the permission attributes it is itself the filter, so the marker cannot exist without the check: in Staff mode HTTPS (else 404), a
/// valid Staff session (else 401), then the Staff request boundary (403 Origin, 415 JSON on a write) with <c>no-store</c>; in LocalGate the route does not exist (404).
/// <see cref="StaffCalendarModeGuard"/> opens a route in Staff mode because of this explicit marker, never a prefix. Applied per action.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class StaffSessionAttribute : Attribute, IFilterFactory
{
    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider) =>
        serviceProvider.GetRequiredService<AdminCalendarAccess>().Mode == AdminCalendarAccessMode.Staff
            ? new StaffWebsiteAccessFilter(
                null,
                serviceProvider.GetRequiredService<IStaffAccessEvaluator>(),
                serviceProvider.GetRequiredService<StaffRequestBoundaryFilter>())
            : new WebsiteClosedInLocalGateFilter();
}
