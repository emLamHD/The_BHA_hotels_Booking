namespace TheBha.IntegrationTests;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class PostgreSqlCollection : ICollectionFixture<PostgreSqlWebApplicationFactory>
{
    public const string Name = "PostgreSQL integration";
}
