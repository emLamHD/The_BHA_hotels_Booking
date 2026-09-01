namespace TheBha.Api;

/// <summary>
/// PMS-CAL-001.1: gates the unauthenticated Admin Reservation Board read
/// endpoint, since Admin authentication/RBAC is explicitly deferred. Defaults
/// to <c>false</c> everywhere; only the local Development configuration
/// enables it. <c>Program.cs</c> makes it startup-fatal to run Production
/// with this set to <c>true</c> — see the comment there.
/// </summary>
public sealed class AdminCalendarOptions
{
    public const string SectionName = "AdminCalendar";

    public bool EnableUnauthenticatedRead { get; set; }
}
