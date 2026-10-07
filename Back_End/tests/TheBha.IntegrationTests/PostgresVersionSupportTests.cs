using Npgsql;

namespace TheBha.IntegrationTests;

public sealed class PostgresVersionSupportTests
{
    [Fact]
    public void Restricted_parent_delete_code_is_pinned_per_verified_major_and_unverified_majors_fail()
    {
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, PostgresVersionSupport.RestrictedParentDelete(17));
        Assert.Equal(PostgresErrorCodes.RestrictViolation, PostgresVersionSupport.RestrictedParentDelete(18));
        Assert.Equal("23503", PostgresErrorCodes.ForeignKeyViolation);
        Assert.Equal("23001", PostgresErrorCodes.RestrictViolation);
        Assert.Throws<InvalidOperationException>(() => PostgresVersionSupport.RestrictedParentDelete(16));
        Assert.Throws<InvalidOperationException>(() => PostgresVersionSupport.RestrictedParentDelete(19));
    }
}
