using System.ComponentModel.DataAnnotations;

namespace TheBha.Api.Authentication;

/// <summary>
/// The password has no maximum length: the CP02 CLI accepts any password Identity's policy
/// accepts, and every such password must be able to sign in. It is passed on unchanged.
/// </summary>
public sealed record StaffLoginRequest(
    [Required, EmailAddress, MaxLength(256)] string Email,
    [Required] string Password);

/// <summary>
/// The signed-in Staff member, read from the database on every call. It never carries the
/// password hash, the security stamp or anything the session cookie is built from.
/// <c>Permissions</c> (CUST-WEB-HEADER-001-CP02) are the global permissions the database grants now
/// (<c>WebsiteSettingsManage</c>); a client that does not know the field must treat it as none. Display only:
/// every request is authorized on the server again.
/// </summary>
public sealed record StaffSessionResponse(
    Guid StaffAccountId,
    string Email,
    IReadOnlyList<StaffMembershipResponse> Memberships,
    IReadOnlyList<string> Permissions);

/// <summary>One Property membership; ordered by Property name, then id (ordinal).</summary>
public sealed record StaffMembershipResponse(
    Guid PropertyId,
    string PropertyName,
    string TimeZone,
    string Role);
