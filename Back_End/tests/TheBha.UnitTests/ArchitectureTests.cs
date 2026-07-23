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

    [Theory]
    [InlineData("TheBha.Domain")]
    [InlineData("TheBha.Application")]
    public void Domain_and_application_do_not_reference_transport_or_identity(
        string assemblyName)
    {
        var assembly = Assembly.Load(assemblyName);
        var forbiddenReferences = assembly
            .GetReferencedAssemblies()
            .Where(reference =>
                reference.Name?.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal) == true ||
                reference.Name?.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal) == true ||
                reference.Name?.StartsWith("Npgsql", StringComparison.Ordinal) == true ||
                reference.Name?.Contains("Identity", StringComparison.Ordinal) == true)
            .Select(reference => reference.Name)
            .ToArray();

        Assert.Empty(forbiddenReferences);
    }

    [Fact]
    public void Application_contains_no_reservation_workflow()
    {
        var applicationAssembly = Assembly.Load("TheBha.Application");
        var reservationWorkflowTypes = applicationAssembly
            .GetTypes()
            .Where(type => type.Name.Contains("Reservation", StringComparison.Ordinal))
            .Select(type => type.FullName)
            .ToArray();

        Assert.Empty(reservationWorkflowTypes);
    }
}
