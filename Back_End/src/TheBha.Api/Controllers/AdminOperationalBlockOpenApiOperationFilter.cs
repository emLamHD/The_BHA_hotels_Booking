using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace TheBha.Api.Controllers;

/// <summary>
/// PMS-CAL-001.3-CP01/CP02: publishes, for the Admin Calendar operational-block
/// write operations (create and cancel), only the media type
/// <see cref="AdminCalendarWriteGateFilter"/> accepts — the same correction
/// <see cref="AdminReservationAssignmentOpenApiOperationFilter"/> applies to the
/// assignment routes, for the same reason and behind the same gate. ApiExplorer
/// otherwise describes the body with everything the JSON formatter can read
/// (<c>text/json</c> and <c>application/*+json</c> included), both of which the
/// gate answers with 415, so a generated client would send what the endpoint
/// refuses. Narrowing the document is the only way to say so without
/// <c>[Consumes]</c>, which is also an action constraint and would let MVC
/// answer at action selection, ahead of the gate.
///
/// <para>
/// Kept as its own filter rather than folded into the assignment one: this
/// codebase registers one operation filter per controller family, and a filter
/// named for assignments that silently also governed blocks would be the
/// misleading option. It runs at document generation, never on a request — the
/// gate stays the sole runtime authority on media type and charset.
/// </para>
/// </summary>
public sealed class AdminOperationalBlockOpenApiOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(AdminOperationalBlocksController) ||
            context.MethodInfo.Name is not (nameof(AdminOperationalBlocksController.Create)
                or nameof(AdminOperationalBlocksController.Cancel)))
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
