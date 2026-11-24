using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using TheBha.Application.Bookings;
using TheBha.Application.Properties;
using TheBha.Application.Scheduling;
using TheBha.Application.Website;

namespace TheBha.Infrastructure.Persistence;

public static class InfrastructureServiceCollectionExtensions
{
    public const string DatabaseConnectionStringName = "TheBhaDatabase";
    public const string DatabaseReadinessTag = "database-ready";

    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration.GetConnectionString(DatabaseConnectionStringName);

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Connection string 'ConnectionStrings:TheBhaDatabase' is not configured.");
        }

        services.AddDbContext<TheBhaDbContext>(options =>
            options.UseNpgsql(
                connectionString,
                npgsqlOptions => npgsqlOptions.MigrationsAssembly("TheBha.Infrastructure")));

        services.AddScoped<IPropertyCatalogQueries, PropertyCatalogQueries>();
        services.AddScoped<IAdminCatalog, AdminCatalogService>();
        services.AddScoped<TheBha.Application.Promotions.IAdminPromotions, AdminPromotionService>();
        services.AddScoped<TheBha.Application.Promotions.IWebsitePromotions, WebsitePromotionService>();
        services.AddScoped<TheBha.Application.Blog.IAdminBlog, AdminBlogService>();
        services.AddScoped<TheBha.Application.Blog.IWebsiteBlog, WebsiteBlogService>();
        // BHA-BLOG-001-CP02: one pipeline per process, so the limit on pictures decoded at once holds across requests.
        services.AddSingleton<TheBha.Application.Blog.IBlogImagePipeline, TheBha.Infrastructure.BlogImages.SkiaBlogImagePipeline>();
        services.AddScoped<TheBha.Application.Blog.IBlogMediaMaintenance, BlogMediaMaintenanceService>();
        services.AddSingleton<ICatalogMediaStorage>(new TheBha.Infrastructure.CatalogMedia.LocalCatalogMediaStorage(configuration["WebsiteMedia:RootPath"]));
        services.AddSingleton<ICatalogImageDecoder, TheBha.Infrastructure.CatalogMedia.CatalogImageDecoder>();
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<IDailyRoomRateStore, DailyRoomRateStore>();
        services.AddScoped<IDailyRoomRatePricing, DailyRoomRatePricing>();
        services.AddScoped<IDailyRoomRateQueries, DailyRoomRateQueries>();
        services.AddScoped<IDailyInventoryControlStore, DailyInventoryControlStore>();
        services.AddScoped<IDailyInventoryControlCommands, DailyInventoryControlCommands>();
        services.AddScoped<IDailyInventoryQueries, DailyInventoryQueries>();
        services.AddScoped<IAvailabilityDataSource, AvailabilityDataSource>();
        services.AddScoped<IAvailabilitySearch, AvailabilitySearch>();
        // BHA-CHECKOUT-001-PR05: the intake switches, validated here so a bad value stops the host before it listens. Direct is off for every Property and new reservations are accepted unless configured otherwise.
        services.AddSingleton((configuration.GetSection(BookingIntakeOptions.SectionName).Get<BookingIntakeOptions>() ?? new BookingIntakeOptions()).Build());
        services.AddScoped<IBookingHoldCreationStore, BookingHoldCreationStore>();
        services.AddScoped<IBookingHoldCreation, BookingHoldCreation>();
        services.AddScoped<IDirectReservationCreationStore, DirectReservationCreationStore>();
        services.AddScoped<IDirectReservationCreation, DirectReservationCreation>();
        services.AddScoped<IBookingHoldConfirmationStore, BookingHoldConfirmationStore>();
        services.AddScoped<IBookingHoldConfirmation, BookingHoldConfirmation>();
        services.AddSingleton<IReservationIdGenerator, CryptographicReservationIdGenerator>();
        services.AddScoped<IReservationReadStore, ReservationReadStore>();
        services.AddScoped<IReservationRead, ReservationRead>();
        services.AddScoped<IBookingHoldReadStore, BookingHoldReadStore>();
        services.AddScoped<IBookingHoldRead, BookingHoldRead>();
        services.AddScoped<IBookingHoldCancellationStore, BookingHoldCancellationStore>();
        services.AddScoped<IBookingHoldCancellation, BookingHoldCancellation>();
        services.AddScoped<IReservationCancellationStore, ReservationCancellationStore>();
        services.AddScoped<IReservationCancellation, ReservationCancellation>();
        services.AddSingleton<IGuestAccessTokenGenerator, CryptographicGuestAccessTokenGenerator>();
        services.AddScoped<IFolioPosting, FolioPostingStore>();
        services.AddScoped<IFolioReader, FolioReader>();
        services.AddScoped<IReservationManagementLinkIssuer, ReservationManagementLinkIssuer>();
        services.AddScoped<IReservationManagementExchangeStore, ReservationManagementExchangeStore>();
        services.AddScoped<IReservationManagementExchange, ReservationManagementExchange>();
        services.AddScoped<IReservationManagementStore, ReservationManagementStore>();
        services.AddScoped<IReservationManagement, ReservationManagement>();
        services.AddScoped<IAssignmentMutationStore, AssignmentMutationStore>();
        services.AddScoped<IOperationalBlockMutationStore, OperationalBlockMutationStore>();
        services.AddScoped<IReservationBoardDataSource, ReservationBoardDataLoader>();
        services.AddScoped<IReservationBoardQuery, ReservationBoardQuery>();
        services.AddScoped<TheBha.Application.Activity.IAdminActivityRecorder, TheBha.Infrastructure.Persistence.Activity.AdminActivityRecorder>();
        services.AddScoped<IWebsiteSettingsStore, WebsiteSettingsStore>();
        services.AddScoped<IWebsitePublicReader, WebsitePublicReader>();
        services.AddScoped<IContentCatalog, ContentCatalog>();
        services.AddScoped<IWebsiteLanguagePacks, WebsiteLanguagePackService>();
        services.AddScoped<IWebsiteDisplayPricing, WebsiteDisplayPricing>();
        services.AddScoped<IWebsiteMenus, WebsiteMenuService>();
        // CUST-WEB-HERO-001-CP01: where uploaded hero pictures live is the host's choice (WebsiteMedia:RootPath); unset = uploads unavailable, nothing else changes.
        services.AddSingleton<IHeroMediaStorage>(new TheBha.Infrastructure.HeroMedia.LocalHeroMediaStorage(configuration["WebsiteMedia:RootPath"]));
        services.AddScoped<IWebsiteHero, WebsiteHeroService>();
        services.AddScoped<IWebsiteSocialSettings, WebsiteSocialSettingsService>();
        services.AddScoped<INewsletterSubscriptions, NewsletterSubscriptionService>();
        // BHA-NEWSLETTER-003: Staff add, edit, invite, unsubscribe, archive and delete.
        services.AddScoped<INewsletterSubscriptionAdmin, NewsletterSubscriptionAdminService>();
        services.AddScoped<IMenuUnseen, MenuUnseenService>();
        // BHA-ADMIN-BADGE-001-PR14: the Newsletter cutover, run only by its operator command.
        services.AddScoped<INewsletterActivityCutover, TheBha.Infrastructure.Persistence.Newsletter.NewsletterActivityCutover>();
        // BHA-ADMIN-BADGE-001-PR03: one class reads the shared per-menu unseen state and judges who may read a menu; the host supplies AdminMenuRoles from its permission map.
        services.AddScoped<TheBha.Infrastructure.Persistence.Activity.AdminMenuUnseenService>();
        services.AddScoped<TheBha.Application.Activity.IAdminMenuUnseen>(sp => sp.GetRequiredService<TheBha.Infrastructure.Persistence.Activity.AdminMenuUnseenService>());
        services.AddScoped<TheBha.Application.Activity.IAdminMenuAccess>(sp => sp.GetRequiredService<TheBha.Infrastructure.Persistence.Activity.AdminMenuUnseenService>());
        // BHA-NEWSLETTER-002: Gmail sender, confirmation e-mails (outbox) and the worker that sends them. NewsletterOptions is registered by the host.
        services.AddSingleton<TheBha.Infrastructure.Persistence.Newsletter.NewsletterSecretProtector>();
        services.AddHttpClient<IGoogleMailGateway, TheBha.Infrastructure.Persistence.Newsletter.GoogleMailGateway>(
                TheBha.Infrastructure.Persistence.Newsletter.GoogleMailGateway.HttpClientName, client => client.Timeout = TimeSpan.FromSeconds(20))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
        services.AddScoped<INewsletterSender, TheBha.Infrastructure.Persistence.Newsletter.NewsletterSenderService>();
        services.AddScoped<INewsletterVerificationDispatcher, TheBha.Infrastructure.Persistence.Newsletter.NewsletterVerificationDispatcher>();
        services.AddHostedService<TheBha.Infrastructure.Persistence.Newsletter.NewsletterVerificationWorker>();
        // BHA-CHECKOUT-001-PR03: the transactional e-mail outbox. Everything is off by default (Email:Outbox:DispatchEnabled / WorkerEnabled) and no handler or template is registered here: the booking mails belong to PR07.
        var emailOutbox = configuration.GetSection(TheBha.Application.Notifications.EmailOutboxOptions.SectionName).Get<TheBha.Application.Notifications.EmailOutboxOptions>() ?? new TheBha.Application.Notifications.EmailOutboxOptions();
        emailOutbox.Validate();
        services.AddSingleton(emailOutbox);
        services.AddSingleton<TheBha.Infrastructure.Persistence.Notifications.EmailOutboxProtector>();
        services.AddSingleton<TheBha.Application.Notifications.EmailTemplateRenderer>();
        services.AddHttpClient<TheBha.Application.Notifications.IEmailTransport, TheBha.Infrastructure.Persistence.Notifications.ResendEmailTransport>(
                TheBha.Infrastructure.Persistence.Notifications.ResendEmailTransport.HttpClientName, (provider, client) => client.Timeout = TimeSpan.FromSeconds(provider.GetRequiredService<TheBha.Application.Notifications.EmailOutboxOptions>().HttpTimeoutSeconds))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
        services.AddScoped<TheBha.Application.Notifications.IEmailOutbox, TheBha.Infrastructure.Persistence.Notifications.EmailOutboxStore>();
        services.AddScoped<TheBha.Application.Notifications.IEmailOutboxFailures, TheBha.Infrastructure.Persistence.Notifications.EmailOutboxFailureReader>();
        services.AddScoped<TheBha.Application.Notifications.IEmailOutboxDispatcher, TheBha.Infrastructure.Persistence.Notifications.EmailOutboxDispatcher>();
        services.AddHostedService<TheBha.Infrastructure.Persistence.Notifications.EmailOutboxWorker>();
        // BHA-CHECKOUT-001-PR04: who receives booking notifications. The chain Managers are declared by the operator (BookingNotifications:ChainManagers, empty by default) and validated here, at start-up.
        var bookingNotifications = configuration.GetSection(TheBha.Application.Notifications.BookingNotificationOptions.SectionName).Get<TheBha.Application.Notifications.BookingNotificationOptions>() ?? new TheBha.Application.Notifications.BookingNotificationOptions();
        services.AddSingleton(new TheBha.Infrastructure.Persistence.Notifications.BookingNotificationChain(bookingNotifications.Validate()));
        services.AddScoped<TheBha.Application.Notifications.IBookingNotificationRecipients, TheBha.Infrastructure.Persistence.Notifications.BookingNotificationRecipientResolver>();
        services.AddScoped<TheBha.Application.Notifications.IAdminBookingNotifications, TheBha.Infrastructure.Persistence.Notifications.AdminBookingNotificationService>();
        services.AddScoped<DevelopmentDataSeeder>();
        services.AddScoped<TheBha.Infrastructure.Persistence.Demo.RiversideDemoSeeder>();
        services.AddScoped<TheBha.Infrastructure.Persistence.Demo.PromotionDemoSeeder>();

        services
            .AddHealthChecks()
            .AddDbContextCheck<TheBhaDbContext>(
                name: "postgresql",
                failureStatus: HealthStatus.Unhealthy,
                tags: [DatabaseReadinessTag]);

        return services;
    }
}
