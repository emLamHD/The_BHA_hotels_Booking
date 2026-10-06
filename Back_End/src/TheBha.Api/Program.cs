using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.OpenApi.Models;
using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using TheBha.Api;
using TheBha.Api.Authentication;
using TheBha.Api.Bookings;
using TheBha.Api.Controllers;
using TheBha.Api.Seeding;
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

var staffLoginRateLimit = builder.Configuration
    .GetSection(StaffLoginRateLimitOptions.SectionName)
    .Get<StaffLoginRateLimitOptions>() ?? new StaffLoginRateLimitOptions();
if (staffLoginRateLimit.PermitLimit <= 0 || staffLoginRateLimit.WindowSeconds <= 0)
{
    throw new InvalidOperationException("Staff login rate-limit values must be positive.");
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

if (cors.AdminOrigins.Any(origin =>
        string.IsNullOrWhiteSpace(origin) ||
        origin.Contains('*', StringComparison.Ordinal) ||
        !origin.StartsWith("https://", StringComparison.Ordinal)))
{
    throw new InvalidOperationException(
        "Cors:AdminOrigins must contain explicit HTTPS origins and cannot contain wildcards.");
}

// Startup guard: refuses to boot a misconfigured Production host at all. It
// binds one configuration snapshot, so it cannot see a value a reloadable
// source supplies later — AdminReservationBoardReadGateFilter (correction C5)
// is what actually keeps every non-Development host closed at request time.
// Both are kept: this one fails loudly and early, that one fails closed.
var adminCalendarOptions = builder.Configuration
    .GetSection(AdminCalendarOptions.SectionName)
    .Get<AdminCalendarOptions>() ?? new AdminCalendarOptions();
if (builder.Environment.IsProduction() && adminCalendarOptions.EnableUnauthenticatedRead)
{
    throw new InvalidOperationException(
        "AdminCalendar:EnableUnauthenticatedRead must never be true in Production — the " +
        "Admin Reservation Board read endpoint has no authentication/RBAC yet (PMS-CAL-001.1).");
}

// PMS-CAL-001.2-CP01: the write opt-in is guarded separately from the read
// one, with its own message, because they are independent capabilities — a
// host may legitimately have one on and the other off, and a startup failure
// should name the flag that is actually wrong. Unlike the read flag, the
// snapshot bound here is also the value the write gate uses at request time
// (correction C1, finding 1), so for the write boundary there is no later
// value for a reloadable source to supply.
if (builder.Environment.IsProduction() && adminCalendarOptions.EnableUnauthenticatedWrite)
{
    throw new InvalidOperationException(
        "AdminCalendar:EnableUnauthenticatedWrite must never be true in Production — the " +
        "Admin Calendar write boundary has no authentication/RBAC yet (PMS-CAL-001.2).");
}

// PMS-ADMIN-AUTH-001-CP04 (D7): the access mode is validated and frozen here, before anything
// is registered. CP07: a missing key is Staff; an empty or unknown value stops the host. The
// Production guards above still apply to the local flags in either mode.
var adminCalendarAccess = AdminCalendarAccess.FromConfiguration(builder.Configuration);
var staffCalendarMode = adminCalendarAccess.Mode == AdminCalendarAccessMode.Staff;

// PMS-ADMIN-AUTH-001-CP07: LocalGate is an explicit Development-only opt-in. Production, Staging
// and any other environment refuse to start with it, so the anonymous local gates can never be
// a fallback (or a rollback) outside a developer's machine.
if (!staffCalendarMode && !builder.Environment.IsDevelopment())
{
    throw new InvalidOperationException(
        $"{AdminCalendarAccess.ModeKey}=LocalGate is a Development-only opt-in; this host's environment is " +
        $"'{builder.Environment.EnvironmentName}'. Remove the setting to use Staff (the default).");
}
builder.Services.AddSingleton(adminCalendarAccess);
builder.Services.AddScoped<IStaffAccessEvaluator, StaffAccessEvaluator>();

builder.Services.Configure<AdminCalendarOptions>(
    builder.Configuration.GetSection(AdminCalendarOptions.SectionName));
builder.Services.AddScoped<AdminReservationBoardReadGateFilter>();

// PMS-CAL-001.2-CP01: registered as a scoped filter an Admin Calendar write
// action opts into with [ServiceFilter], never added to MvcOptions.Filters.
// CP02 is the one action that applies it — AdminReservationAssignmentsController
// .Create. Every remaining Admin mutation is still unexposed.
//
// Correction C1, finding 1: the filter receives the write opt-in as a value
// frozen from the configuration snapshot above, not IOptions<T> resolved per
// request. IOptions<T> binds lazily on first access, so a Development host
// started with the opt-in off could have it bound to true by a reloadable
// source before the first Admin request — and Development is precisely where
// this gate is meant to operate, so environment-first ordering does not cover
// it. Frozen here, only a restart can change it. The Admin origins are passed
// the same way, and for the same reason: neither can be widened past the
// validation performed above without restarting.
//
// Services.Configure<AdminCalendarOptions> above stays: the read gate still
// resolves IOptions<AdminCalendarOptions>, and that gate is out of scope here.
builder.Services.AddScoped(serviceProvider => new AdminCalendarWriteGateFilter(
    serviceProvider.GetRequiredService<IHostEnvironment>(),
    adminCalendarOptions.EnableUnauthenticatedWrite,
    cors.AdminOrigins));

// PMS-ADMIN-AUTH-001-CP03: the Staff session boundary takes the same startup-frozen,
// startup-validated Admin origins as the local write gate.
builder.Services.AddScoped(_ => new StaffRequestBoundaryFilter(cors.AdminOrigins));

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
    {
        options.Filters.Add(new AutoValidateAntiforgeryTokenAttribute());
        options.Filters.Add(new AntiforgeryProblemDetailsResultFilter());
    })
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
    options.AddSecurityDefinition(
        "StaffCookie",
        new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.ApiKey,
            In = ParameterLocation.Cookie,
            Name = StaffAuthentication.CookieName,
            Description = "Secure HttpOnly SameSite=Strict staff session cookie (path /api/admin); not a bearer token."
        });
    options.OperationFilter<AuthOperationFilter>();
    options.OperationFilter<StaffAuthOperationFilter>();
    options.OperationFilter<BookingHoldOperationFilter>();
    options.OperationFilter<ReservationLifecycleOperationFilter>();
    options.OperationFilter<AdminReservationAssignmentOpenApiOperationFilter>();
    options.OperationFilter<AdminOperationalBlockOpenApiOperationFilter>();
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
// PMS-ADMIN-AUTH-001: a separate Staff user store; it inherits the IdentityOptions above.
builder.Services
    .AddIdentityCore<StaffAccount>()
    .AddEntityFrameworkStores<TheBhaDbContext>();
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
    })
    // PMS-ADMIN-AUTH-001-CP03 (D3): not a default scheme; Staff routes name it explicitly.
    .AddStaffCookie(builder.Environment.IsDevelopment());
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
{
    options.AddPolicy("customer-web", policy =>
    {
        if (cors.AllowedOrigins.Length > 0)
        {
            policy.WithOrigins(cors.AllowedOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
    });
    // PMS-CAL-001.1: separate, uncredentialed policy for the unauthenticated
    // Admin Reservation Board read endpoint — never merged with the
    // customer-web policy's credentialed-cookie access.
    options.AddPolicy("admin-calendar", policy =>
    {
        if (cors.AdminOrigins.Length > 0)
        {
            policy.WithOrigins(cors.AdminOrigins)
                .AllowAnyHeader()
                .WithMethods("GET");
        }
    });
    // PMS-CAL-001.2-CP01: the browser half of the local Admin Calendar write
    // boundary, kept separate from the read policy above so neither one can
    // widen the other. Explicit Admin origins, POST only, and only the
    // Content-Type header the gate requires. Deliberately uncredentialed: the
    // Admin client will call it with `credentials: "omit"`, and adding
    // AllowCredentials() here would let a browser attach the Customer session
    // cookie to an Admin write. A policy only tells a browser what it may
    // attempt — AdminCalendarWriteGateFilter is what actually decides, and it
    // re-checks Origin at the server, where curl and server-to-server clients
    // are also subject to it. Nothing opts into this policy in CP01.
    options.AddPolicy("admin-calendar-write", policy =>
    {
        if (cors.AdminOrigins.Length > 0)
        {
            policy.WithOrigins(cors.AdminOrigins)
                .WithHeaders("Content-Type")
                .WithMethods("POST");
        }
    });
    // PMS-CAL-001.1 (correction C1): GET /api/v1/properties is public
    // catalog data read by both Customer_Web (via its shared, credentialed
    // httpClient, which sends withCredentials:true on every request — so
    // this policy must keep AllowCredentials() for the configured Customer
    // origins, or the browser rejects the response) and, for the
    // Reservation Board's Property selector, Admin_Web. It is an explicit
    // union of the two configured origin lists, GET-only, and credentialed
    // — scoped to just this one action, so it never widens the global
    // customer-web policy or grants the Admin origin access to any other
    // Customer-facing route.
    var propertiesReadOrigins = cors.AllowedOrigins
        .Concat(cors.AdminOrigins)
        .Distinct(StringComparer.Ordinal)
        .ToArray();
    options.AddPolicy("properties-catalog-read", policy =>
    {
        if (propertiesReadOrigins.Length > 0)
        {
            policy.WithOrigins(propertiesReadOrigins)
                .AllowAnyHeader()
                .WithMethods("GET")
                .AllowCredentials();
        }
    });
    // PMS-ADMIN-AUTH-001-CP03: the only credentialed Admin policy, used by the Staff session
    // routes alone. Explicit HTTPS Admin origins, GET/POST and Content-Type; the two
    // uncredentialed admin-calendar policies above are unchanged. StaffRequestBoundaryFilter
    // still checks Origin at the server.
    options.AddPolicy(StaffAuthentication.CorsPolicy, policy =>
    {
        if (cors.AdminOrigins.Length > 0)
        {
            policy.WithOrigins(cors.AdminOrigins)
                .WithHeaders("Content-Type")
                .WithMethods("GET", "POST")
                .AllowCredentials();
        }
    });
    // PMS-ADMIN-AUTH-001-CP04: in Staff mode only, the Staff-authorized Calendar reads (the board)
    // are called with the Staff cookie, so they get a credentialed, GET-only policy for the
    // explicit HTTPS Admin origins. It is attached to those endpoints in place of admin-calendar
    // (MapControllers below); the two admin-calendar policies are not changed. CORS still
    // authorizes nothing: StaffCalendarAccessFilter does.
    if (staffCalendarMode)
    {
        options.AddPolicy(StaffCalendarModeGuard.ReadCorsPolicy, policy =>
        {
            if (cors.AdminOrigins.Length > 0)
            {
                policy.WithOrigins(cors.AdminOrigins)
                    .WithMethods("GET")
                    .AllowCredentials();
            }
        });
        // PMS-ADMIN-AUTH-001-CP05: the converted Calendar writes, called with the Staff cookie:
        // credentialed, POST only, Content-Type only, explicit HTTPS Admin origins. In place of
        // admin-calendar-write in Staff mode; Origin and JSON are still checked at the server.
        options.AddPolicy(StaffCalendarModeGuard.WriteCorsPolicy, policy =>
        {
            if (cors.AdminOrigins.Length > 0)
            {
                policy.WithOrigins(cors.AdminOrigins)
                    .WithHeaders("Content-Type")
                    .WithMethods("POST")
                    .AllowCredentials();
            }
        });
    }
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, cancellationToken) =>
    {
        if (StaffAuthentication.IsSessionPath(context.HttpContext.Request.Path))
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
        }

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
    options.AddPolicy(StaffAuthentication.LoginRateLimitPolicy, context =>
        CreateAuthenticationLimiter(
            context,
            staffLoginRateLimit.PermitLimit,
            staffLoginRateLimit.WindowSeconds));
});

var app = builder.Build();

// PMS-ADMIN-AUTH-001-CP02: a Staff verb runs the operator CLI and exits; no listener, no seed.
if (StaffBootstrapCommand.IsStaffCommand(args))
{
    Environment.ExitCode = await StaffBootstrapCommand.RunAsync(
        args, app.Services, Console.Out, StaffBootstrapCommand.ReadPassword, app.Lifetime.ApplicationStopping);
    return;
}

// CUST-WEB-SHOWCASE-001-CP02: the Riverside demo seed is an explicit operator command that exits
// when done. Its own guard decides whether this process may touch this database; it is refused
// outside Development and never runs as a startup step.
if (RiversideDemoSeedCommand.IsCommand(args))
{
    Environment.ExitCode = await RiversideDemoSeedCommand.RunAsync(
        args, app.Services, app.Environment.EnvironmentName, Console.Out, app.Lifetime.ApplicationStopping);
    return;
}

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

// PMS-CAL-001.2-CP02-C5: a cleartext Admin mutation is refused here, ahead of
// the redirect. UseHttpsRedirection answers a dual-listener host's HTTP request
// with a 307 before any MVC filter runs, and 307 preserves method and body — so
// a redirect-following client would have completed the write over HTTPS, and
// one that does not follow would see a redirect instead of the closed
// boundary's answer. AdminCalendarWriteGateFilter is a resource filter and
// cannot run earlier than middleware, so its IsHttps check stays as defence in
// depth for any pipeline that does not pass through here. Scope is deliberately
// narrow: only Admin mutation verbs, matched by path segment so /api/administrator
// is untouched; every other request, Customer routes included, redirects as before.
// PMS-ADMIN-AUTH-001-CP03: the Staff session routes (auth/*, me) are refused here for every
// method, GET me included, so cleartext never sets a Staff cookie or returns an identity.
// PMS-ADMIN-AUTH-001-CP04: in Staff mode every /api/admin request is refused in cleartext, the
// board GET included, before the redirect and before authentication; LocalGate is unchanged.
app.Use(async (context, next) =>
{
    if (!context.Request.IsHttps &&
        (StaffAuthentication.IsSessionPath(context.Request.Path) ||
         (staffCalendarMode &&
          context.Request.Path.StartsWithSegments("/api/admin", StringComparison.OrdinalIgnoreCase)) ||
         (context.Request.Path.StartsWithSegments("/api/admin", StringComparison.OrdinalIgnoreCase) &&
          (HttpMethods.IsPost(context.Request.Method) ||
           HttpMethods.IsPut(context.Request.Method) ||
           HttpMethods.IsPatch(context.Request.Method) ||
           HttpMethods.IsDelete(context.Request.Method)))))
    {
        // The same detail-free 404 body the closed gate produces, via the same
        // ProblemDetails service, and no Location: a caller learns nothing it
        // did not already know, and cannot tell this refusal from that one.
        context.Response.Headers.CacheControl = "no-store";
        await Results.Problem(statusCode: StatusCodes.Status404NotFound).ExecuteAsync(context);
        return;
    }

    await next(context);
});

// PMS-ADMIN-AUTH-001-CP04 (D7): in Staff mode, an Admin endpoint that does not enforce a Staff
// permission (or is not a CP03 session action) is closed here, ahead of CORS and authentication.
if (staffCalendarMode)
{
    app.UseStaffCalendarModeGuard();
}

app.UseHttpsRedirection();
app.UseCors("customer-web");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

var controllers = app.MapControllers();
if (staffCalendarMode)
{
    // Endpoint metadata: the last IEnableCorsAttribute wins, so a Staff-authorized Calendar read
    // (GET only) or write (POST only, CP05) uses its credentialed Staff policy instead of its
    // admin-calendar(-write) attribute in Staff mode. Anything else keeps its own attribute.
    controllers.Add(endpoint =>
    {
        if (!endpoint.Metadata.OfType<StaffCalendarPermissionAttribute>().Any())
        {
            return;
        }

        var policy = endpoint.Metadata.OfType<IHttpMethodMetadata>().LastOrDefault()?.HttpMethods switch
        {
            ["GET"] => StaffCalendarModeGuard.ReadCorsPolicy,
            ["POST"] => StaffCalendarModeGuard.WriteCorsPolicy,
            _ => null
        };
        if (policy is not null)
        {
            endpoint.Metadata.Add(new EnableCorsAttribute(policy));
        }
    });
}
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
