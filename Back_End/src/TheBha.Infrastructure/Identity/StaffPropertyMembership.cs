namespace TheBha.Infrastructure.Identity;

/// <summary>One role of one staff member at one Property.</summary>
public sealed class StaffPropertyMembership
{
    public Guid StaffAccountId { get; set; }
    public Guid PropertyId { get; set; }
    public string Role { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
}

public static class StaffRole
{
    public const string FrontDesk = "FrontDesk";
    public const string Manager = "Manager";
}
