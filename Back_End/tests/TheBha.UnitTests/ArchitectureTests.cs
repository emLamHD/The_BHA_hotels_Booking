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

    [Fact]
    public void Application_references_only_domain()
    {
        var applicationAssembly = Assembly.Load("TheBha.Application");

        var internalReferences = applicationAssembly
            .GetReferencedAssemblies()
            .Where(reference => reference.Name?.StartsWith("TheBha.", StringComparison.Ordinal) == true)
            .Select(reference => reference.Name)
            .ToArray();

        Assert.Equal(["TheBha.Domain"], internalReferences);
    }

}
