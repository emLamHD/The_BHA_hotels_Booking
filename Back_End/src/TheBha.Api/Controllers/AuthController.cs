using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TheBha.Api.Authentication;
using TheBha.Application.Customers;
using TheBha.Infrastructure.Identity;

namespace TheBha.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(
    UserManager<CustomerAccount> userManager,
    SignInManager<CustomerAccount> signInManager,
    ICurrentCustomer currentCustomer,
    IAntiforgery antiforgery) : ControllerBase
{
    [HttpGet("csrf")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(CsrfTokenResponse), StatusCodes.Status200OK)]
    public ActionResult<CsrfTokenResponse> GetCsrfToken()
    {
        var tokens = antiforgery.GetAndStoreTokens(HttpContext);
        return Ok(new CsrfTokenResponse(
            tokens.RequestToken!,
            tokens.HeaderName!));
    }

    [HttpPost("register")]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    [EnableRateLimiting("auth-register")]
    [ProducesResponseType(typeof(CustomerSessionResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<CustomerSessionResponse>> Register(
        RegisterCustomerRequest request)
    {
        var account = new CustomerAccount
        {
            Id = Guid.NewGuid(),
            Email = request.Email.Trim(),
            UserName = request.Email.Trim()
        };

        var result = await userManager.CreateAsync(account, request.Password);
        if (!result.Succeeded)
        {
            var duplicate = result.Errors.Any(error =>
                error.Code is nameof(IdentityErrorDescriber.DuplicateEmail) or
                    nameof(IdentityErrorDescriber.DuplicateUserName));
            return Problem(
                statusCode: duplicate
                    ? StatusCodes.Status409Conflict
                    : StatusCodes.Status400BadRequest,
                title: duplicate ? "Customer account already exists" : "Invalid registration",
                detail: duplicate
                    ? "A customer account cannot be created with the supplied email."
                    : "The registration request does not satisfy the account requirements.");
        }

        return StatusCode(
            StatusCodes.Status201Created,
            new CustomerSessionResponse(account.Id, account.Email));
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    [EnableRateLimiting("auth-login")]
    [ProducesResponseType(typeof(CustomerSessionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<CustomerSessionResponse>> Login(
        LoginCustomerRequest request)
    {
        var result = await signInManager.PasswordSignInAsync(
            request.Email.Trim(),
            request.Password,
            isPersistent: false,
            lockoutOnFailure: true);
        if (!result.Succeeded)
        {
            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Authentication failed",
                detail: "The supplied credentials are invalid.");
        }

        var account = await userManager.FindByEmailAsync(request.Email.Trim());
        if (account is null)
        {
            await signInManager.SignOutAsync();
            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Authentication failed",
                detail: "The supplied credentials are invalid.");
        }

        return Ok(new CustomerSessionResponse(account.Id, account.Email!));
    }

    [HttpPost("logout")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Logout()
    {
        await signInManager.SignOutAsync();
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize]
    [ProducesResponseType(typeof(CustomerSessionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    public ActionResult<CustomerSessionResponse> Me()
    {
        if (currentCustomer.CustomerAccountId is not { } customerId ||
            string.IsNullOrWhiteSpace(currentCustomer.Email))
        {
            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Authentication required",
                detail: "A valid customer session is required.");
        }

        return Ok(new CustomerSessionResponse(customerId, currentCustomer.Email));
    }
}
