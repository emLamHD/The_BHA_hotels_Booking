using Microsoft.AspNetCore.Identity;

namespace TheBha.Infrastructure.Identity;

/// <summary>
/// An Admin staff member. A separate Identity user type from
/// <see cref="CustomerAccount"/>, stored in its own table, so a customer can
/// never become a staff principal. It uses no claims, logins or tokens (those
/// Identity tables are keyed to customers). A row is disabled, never deleted.
/// </summary>
public sealed class StaffAccount : IdentityUser<Guid>
{
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? DisabledAtUtc { get; set; }
}
