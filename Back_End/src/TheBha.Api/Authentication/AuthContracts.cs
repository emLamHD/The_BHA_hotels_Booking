using System.ComponentModel.DataAnnotations;

namespace TheBha.Api.Authentication;

public sealed record RegisterCustomerRequest(
    [Required, EmailAddress, MaxLength(256)] string Email,
    [Required, MaxLength(128)] string Password);

public sealed record LoginCustomerRequest(
    [Required, EmailAddress, MaxLength(256)] string Email,
    [Required, MaxLength(128)] string Password);

public sealed record CustomerSessionResponse(Guid CustomerAccountId, string Email);

public sealed record CsrfTokenResponse(string Token, string HeaderName);
