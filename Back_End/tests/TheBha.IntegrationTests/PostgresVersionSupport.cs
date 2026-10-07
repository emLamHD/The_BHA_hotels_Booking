using Npgsql;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-PG18-001: the PostgreSQL majors this suite is verified on, and the one behavior that differs between them.
/// PostgreSQL 18 reports <c>23001</c> (restrict_violation) when a parent row is deleted while an
/// <c>ON DELETE RESTRICT</c> foreign key still references it; PostgreSQL 17 reports <c>23503</c>
/// (foreign_key_violation). Child-side inserts/updates and <c>NO ACTION</c> keep <c>23503</c> on both, so
/// only the parent-delete assertions use <see cref="RestrictedParentDelete"/>. An unverified major fails
/// loudly instead of being guessed.
/// </summary>
internal static class PostgresVersionSupport
{
    public static readonly int[] SupportedMajors = [17, 18];

    public static async Task<int> ServerMajorAsync(string connectionString)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        return connection.PostgreSqlVersion.Major;
    }

    public static string RestrictedParentDelete(int serverMajor) =>
        serverMajor switch
        {
            17 => PostgresErrorCodes.ForeignKeyViolation,
            18 => PostgresErrorCodes.RestrictViolation,
            _ => throw new InvalidOperationException(
                $"PostgreSQL {serverMajor} is not a verified major for this suite (supported: 17, 18).")
        };
}
