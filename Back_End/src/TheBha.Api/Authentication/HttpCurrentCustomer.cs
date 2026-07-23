using System.Security.Claims;
using TheBha.Application.Customers;

namespace TheBha.Api.Authentication;

public sealed class HttpCurrentCustomer(IHttpContextAccessor httpContextAccessor)
    : ICurrentCustomer
{
    private ClaimsPrincipal? Principal => httpContextAccessor.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

    public Guid? CustomerAccountId =>
        Guid.TryParse(Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? id
            : null;

    public string? Email => Principal?.FindFirstValue(ClaimTypes.Email);
}
