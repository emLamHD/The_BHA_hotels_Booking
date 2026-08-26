namespace TheBha.Domain.Scheduling;

/// <summary>
/// Deterministic <c>ActorReference</c> values for mutations performed by the system
/// itself rather than an authenticated human operator (PMS-BE-001.2 §3) — e.g.
/// Reservation-cancellation assignment cleanup. Admin authentication/RBAC do not
/// exist yet; these constants exist so cleanup mutations never invent a human actor.
/// </summary>
public static class SystemActorReferences
{
    public const string ReservationCancellationCleanup = "system:reservation-cancellation";
}
