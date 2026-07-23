using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.OpenApi.Models;
using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using TheBha.Api.Authentication;
using TheBha.Api.Bookings;
using TheBha.Application.Customers;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

var rateLimits = builder.Configuration
    .GetSection(AuthRateLimitOptions.SectionName)
    .Get<AuthRateLimitOptions>() ?? new AuthRateLimitOptions();
if (rateLimits.RegisterPermitLimit <= 0 ||
    rateLimits.LoginPermitLimit <= 0 ||
    rateLimits.WindowSeconds <= 0)
{
    throw new InvalidOperationException("Authentication rate-limit values must be positive.");
}

var cookieSession = builder.Configuration
    .GetSection(CookieSessionOptions.SectionName)
    .Get<CookieSessionOptions>() ?? new CookieSessionOptions();
if (!Enum.TryParse<SameSiteMode>(cookieSession.SameSite, true, out var cookieSameSite) ||
    cookieSameSite is not (SameSiteMode.Strict or SameSiteMode.Lax or SameSiteMode.None))
{
    throw new InvalidOperationException(
        "Authentication:Cookie:SameSite must be Strict, Lax, or None.");
}

var cors = builder.Configuration
    .GetSection(CorsOptions.SectionName)
    .Get<CorsOptions>() ?? new CorsOptions();
if (cors.AllowedOrigins.Any(origin =>
        string.IsNullOrWhiteSpace(origin) || origin.Contains('*', StringComparison.Ordinal)))
{
    throw new InvalidOperationException(
        "Cors:AllowedOrigins must contain explicit origins and cannot contain wildcards.");
}

var dataProtectionKeysPath = builder.Configuration["DataProtection:KeysPath"];
if (builder.Environment.IsProduction() && string.IsNullOrWhiteSpace(dataProtectionKeysPath))
{
    throw new InvalidOperationException(
        "DataProtection:KeysPath must point to durable shared storage in Production.");
}

var dataProtection = builder.Services
    .AddDataProtection()
    .SetApplicationName("TheBha.Booking");
if (!string.IsNullOrWhiteSpace(dataProtectionKeysPath))
{
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath));
}

builder.Services
    .AddControllersWithViews(options =>
        options.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()))
    .AddJsonOptions(options =>
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition(
        "CustomerCookie",
        new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.ApiKey,
            In = ParameterLocation.Cookie,
            Name = ".TheBha.Customer",
            Description = "Secure HttpOnly customer session cookie; not a bearer token."
        });
    options.OperationFilter<AuthOperationFilter>();
    options.OperationFilter<BookingHoldOperationFilter>();
});
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services
    .AddIdentityCore<CustomerAccount>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.ClaimsIdentity.UserNameClaimType = ClaimTypes.Email;
    })
    .AddEntityFrameworkStores<TheBhaDbContext>()
    .AddSignInManager();
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = IdentityConstants.ApplicationScheme;
        options.DefaultChallengeScheme = IdentityConstants.ApplicationScheme;
        options.DefaultSignInScheme = IdentityConstants.ApplicationScheme;
    })
    .AddCookie(IdentityConstants.ApplicationScheme, options =>
    {
        options.Cookie.Name = ".TheBha.Customer";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.Cookie.SameSite = cookieSameSite;
        options.Cookie.Path = "/";
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.Events = new CookieAuthenticationEvents
        {
            OnRedirectToLogin = context => WriteAuthenticationProblemAsync(
                context.HttpContext,
                StatusCodes.Status401Unauthorized,
                "Authentication required",
                "A valid customer session is required."),
            OnRedirectToAccessDenied = context => WriteAuthenticationProblemAsync(
                context.HttpContext,
                StatusCodes.Status403Forbidden,
                "Access denied",
                "The customer session is not authorized for this operation.")
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentCustomer, HttpCurrentCustomer>();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = ".TheBha.Antiforgery";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
    options.Cookie.SameSite = cookieSameSite;
    options.Cookie.Path = "/";
});
builder.Services.AddCors(options =>
    options.AddPolicy("customer-web", policy =>
    {
        if (cors.AllowedOrigins.Length > 0)
        {
            policy.WithOrigins(cors.AllowedOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
    }));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, cancellationToken) =>
    {
        await Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "Too many requests",
                detail: "Please wait before attempting this authentication operation again.")
            .ExecuteAsync(context.HttpContext);
    };
    options.AddPolicy("auth-register", context =>
        CreateAuthenticationLimiter(
            context,
            rateLimits.RegisterPermitLimit,
            rateLimits.WindowSeconds));
    options.AddPolicy("auth-login", context =>
        CreateAuthenticationLimiter(
            context,
            rateLimits.LoginPermitLimit,
            rateLimits.WindowSeconds));
});

var app = builder.Build();

if (args.Contains("--seed-development", StringComparer.Ordinal))
{
    if (!app.Environment.IsDevelopment())
    {
        throw new InvalidOperationException(
            "Development seed can run only when ASPNETCORE_ENVIRONMENT is Development.");
    }

    await using var scope = app.Services.CreateAsyncScope();
    var seeder = scope.ServiceProvider.GetRequiredService<DevelopmentDataSeeder>();
    await seeder.SeedAsync(app.Lifetime.ApplicationStopping);
    return;
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseExceptionHandler();
app.Use(async (httpContext, next) =>
{
    await next();
    var antiforgeryValidation =
        httpContext.Features.Get<Microsoft.AspNetCore.Antiforgery.IAntiforgeryValidationFeature>();
    if (antiforgeryValidation?.IsValid == false &&
        httpContext.Response.StatusCode == StatusCodes.Status400BadRequest &&
        !httpContext.Response.HasStarted)
    {
        httpContext.Response.Clear();
        await Results.Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid antiforgery token",
                detail: "A valid antiforgery token is required for this operation.")
            .ExecuteAsync(httpContext);
    }
});
app.UseCors("customer-web");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks(
    "/health/ready",
    new HealthCheckOptions
    {
        Predicate = registration =>
            registration.Tags.Contains(
                InfrastructureServiceCollectionExtensions.DatabaseReadinessTag)
    });

app.Run();

static RateLimitPartition<string> CreateAuthenticationLimiter(
    HttpContext context,
    int permitLimit,
    int windowSeconds)
{
    var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    return RateLimitPartition.GetFixedWindowLimiter(
        partitionKey,
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permitLimit,
            Window = TimeSpan.FromSeconds(windowSeconds),
            QueueLimit = 0,
            AutoReplenishment = true
        });
}

static Task WriteAuthenticationProblemAsync(
    HttpContext httpContext,
    int status,
    string title,
    string detail)
{
    return Results.Problem(statusCode: status, title: title, detail: detail)
        .ExecuteAsync(httpContext);
}

public partial class Program;
