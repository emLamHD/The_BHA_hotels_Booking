using System.ComponentModel.DataAnnotations;

namespace TheBha.Api.Authentication;

public sealed record StaffLoginRequest(
    [Required, EmailAddress, MaxLength(256)] string Email,
    [Required, MaxLength(128)] string Password);

/// <summary>
/// The signed-in Staff member, read from the database on every call. It never carries the
/// password hash, the security stamp or anything the session cookie is built from.
/// </summary>
public sealed record StaffSessionResponse(
    Guid StaffAccountId,
    string Email,
    IReadOnlyList<StaffMembershipResponse> Memberships);

/// <summary>One Property membership; ordered by Property name, then id (ordinal).</summary>
public sealed record StaffMembershipResponse(
    Guid PropertyId,
    string PropertyName,
    string TimeZone,
    string Role);
