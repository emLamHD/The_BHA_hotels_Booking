using System.Reflection;

namespace TheBha.UnitTests;

public sealed class ArchitectureTests
{
    [Fact]
    public void Domain_does_not_reference_other_solution_projects()
    {
        var domainAssembly = Assembly.Load("TheBha.Domain");

        var internalReferences = domainAssembly
            .GetReferencedAssemblies()
            .Where(reference => reference.Name?.StartsWith("TheBha.", StringComparison.Ordinal) == true)
            .Select(reference => reference.Name)
            .ToArray();

        Assert.Empty(internalReferences);
    }
}
