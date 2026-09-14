using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace TheBha.Api.Controllers;

/// <summary>
/// PMS-CAL-001.2-CP02-C4: publishes, for every Admin Calendar write operation
/// on <see cref="AdminReservationAssignmentsController"/>, only the media type
/// <see cref="AdminCalendarWriteGateFilter"/> accepts. ApiExplorer otherwise
/// describes the body with everything the JSON formatter can read —
/// <c>text/json</c> and <c>application/*+json</c> included — both of which the
/// gate answers with 415, so a generated client would send what the endpoint
/// refuses. Narrowing the document is the only way to say so without
/// <c>[Consumes]</c>, which is also an action constraint and would let MVC
/// answer at action selection, ahead of the gate. This runs at document
/// generation, never on a request: the gate stays the sole runtime authority on
/// media type and charset.
///
/// <para>
/// PMS-CAL-001.2-CP04B: the same narrowing applies to <c>Move</c> and
/// <c>Unassign</c> — every action this filter matches shares the identical
/// gate, so every one of them needs the identical correction.
/// </para>
/// </summary>
public sealed class AdminReservationAssignmentOpenApiOperationFilter : IOperationFilter
{
    private static readonly HashSet<string> WriteActionNames = new(StringComparer.Ordinal)
    {
        nameof(AdminReservationAssignmentsController.Create),
        nameof(AdminReservationAssignmentsController.Move),
        nameof(AdminReservationAssignmentsController.Unassign),
    };

    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(AdminReservationAssignmentsController) ||
            !WriteActionNames.Contains(context.MethodInfo.Name))
        {
            return;
        }

        // The generated entry is reused, never rebuilt: its schema is the request
        // DTO's, and a hand-made copy would be free to drift from it. If it is
        // absent, the content map is left without it and the exact-contract test
        // fails — the right outcome for a document that stopped describing this.
        if (operation.RequestBody?.Content is not { } content ||
            !content.TryGetValue("application/json", out var json))
        {
            return;
        }

        content.Clear();
        content["application/json"] = json;
    }
}
