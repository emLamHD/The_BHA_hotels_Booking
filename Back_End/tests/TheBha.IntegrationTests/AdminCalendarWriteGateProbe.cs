using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Controllers;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-CAL-001.2-CP01: the write-gate composition under test, expressed as the
/// smallest possible action.
///
/// <para>
/// It lives in the <em>test</em> assembly and is reachable only through a test
/// <c>WebApplicationFactory</c> that explicitly adds this assembly as an MVC
/// application part. <c>TheBha.Api</c> contains no such controller, no probe
/// endpoint and no <c>IsDevelopment()</c>-guarded route that could turn into
/// one: CP01's whole point is that the gate exists and is proven while the
/// application's production route surface gains nothing. A test asserts that
/// the ordinary host does not serve this route and that the OpenAPI document
/// does not describe it.
/// </para>
///
/// <para>
/// The three attributes below are the composition a real Admin Calendar write
/// action will carry, and each is load-bearing:
/// </para>
/// <list type="bullet">
///   <item><description>
///     <c>[ServiceFilter(typeof(AdminCalendarWriteGateFilter))]</c> — the gate
///     itself, at resource-filter stage, so it runs before model binding.
///   </description></item>
///   <item><description>
///     <c>[EnableCors("admin-calendar-write")]</c> — the uncredentialed,
///     POST-only browser policy for the configured Admin origins.
///   </description></item>
///   <item><description>
///     <c>[IgnoreAntiforgeryToken]</c> — scoped here only. The application
///     registers <c>AutoValidateAntiforgeryTokenAttribute</c> globally for the
///     Customer cookie surface, and that runs as an <em>authorization</em>
///     filter, i.e. before any resource filter. Without this scoped opt-out an
///     Admin POST would be rejected for a missing CSRF token before the gate
///     ran at all, and the Admin client has no cookie session to derive one
///     from. The global Customer protection is untouched.
///   </description></item>
/// </list>
/// </summary>
[ApiController]
[Route("api/admin/v1/test-only/write-gate-probe")]
[EnableCors("admin-calendar-write")]
[IgnoreAntiforgeryToken]
[ServiceFilter(typeof(AdminCalendarWriteGateFilter))]
public sealed class AdminCalendarWriteGateProbeController(WriteGateProbeSpy spy) : ControllerBase
{
    [HttpPost]
    public IActionResult Probe([FromBody] WriteGateProbeRequest request)
    {
        spy.Record(request.Marker);
        return NoContent();
    }
}

/// <summary>
/// The same composition with <c>[IgnoreAntiforgeryToken]</c> removed, so the
/// claim that the opt-out is load-bearing is asserted rather than assumed. The
/// global <c>AutoValidateAntiforgeryTokenAttribute</c> runs at authorization
/// stage, before any resource filter, so this route answers an otherwise
/// perfect Admin request with the antiforgery 400 and the gate never runs.
/// Without this control a future edit could delete the opt-out and leave a
/// suite that still passes for the wrong reason.
/// </summary>
[ApiController]
[Route("api/admin/v1/test-only/write-gate-antiforgery-control")]
[EnableCors("admin-calendar-write")]
[ServiceFilter(typeof(AdminCalendarWriteGateFilter))]
public sealed class AdminCalendarWriteGateAntiforgeryControlController(WriteGateProbeSpy spy) : ControllerBase
{
    [HttpPost]
    public IActionResult Probe([FromBody] WriteGateProbeRequest request)
    {
        spy.Record(request.Marker);
        return NoContent();
    }
}

/// <summary>
/// One required field, so "the gate opened and model binding then ran" is
/// observable as a 400 that the gate itself never produces.
/// </summary>
public sealed class WriteGateProbeRequest
{
    [Required]
    public string? Marker { get; init; }
}

/// <summary>
/// Counts action invocations. Any non-zero count on a request that should have
/// been refused means the gate leaked — the action, and therefore whatever
/// mutation a real write endpoint would perform, was reached.
/// </summary>
public sealed class WriteGateProbeSpy
{
    private int _invocations;
    private readonly List<string?> _markers = [];

    public int Invocations => Volatile.Read(ref _invocations);

    public IReadOnlyList<string?> Markers
    {
        get
        {
            lock (_markers)
            {
                return _markers.ToArray();
            }
        }
    }

    public void Record(string? marker)
    {
        Interlocked.Increment(ref _invocations);
        lock (_markers)
        {
            _markers.Add(marker);
        }
    }
}
