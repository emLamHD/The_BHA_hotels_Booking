using Microsoft.EntityFrameworkCore;
using TheBha.Application.Activity;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

internal sealed class WebsiteSocialSettingsService(TheBhaDbContext database, TimeProvider timeProvider, IAdminActivityRecorder recorder, IAdminActivityHint hint) : IWebsiteSocialSettings
{
    // BHA-ADMIN-BADGE-001-PR08 (ADR 0011): every committed Save is ONE event of the website-social stream; the read answers its watermark from its own snapshot.
    private const string Menu = AdminMenuKeys.WebsiteSocial;

    public Task<WebsiteSocialAdminDto> GetAdminAsync(CancellationToken cancellationToken) =>
        WebsiteActivity.InSnapshotAsync(database, Menu, async watermark =>
            Admin(await database.WebsiteSocialSettings.AsNoTracking().SingleAsync(cancellationToken)) with { ViewWatermark = watermark }, cancellationToken);

    public async Task<WebsiteSocialPublicDto> GetPublicAsync(CancellationToken cancellationToken)
    {
        var row = await database.WebsiteSocialSettings.AsNoTracking().SingleAsync(cancellationToken);
        return new(row.Version, timeProvider.GetUtcNow(), row.PhoneEnabled, row.PhoneEnabled ? row.PhoneNumber : null,
            row.PhoneEnabled ? row.PhoneHref : null, row.MessengerEnabled, row.MessengerEnabled ? row.MessengerUrl : null,
            row.ZaloEnabled, row.ZaloEnabled ? row.ZaloUrl : null, row.BackToTopEnabled);
    }

    public Task<WebsiteMutationResult<WebsiteSocialAdminDto>> SaveAsync(SaveWebsiteSocialCommand command, CancellationToken cancellationToken) =>
        WebsiteTransaction.InLockAsync(database, timeProvider, new WebsiteActivityScope(recorder, hint, Menu, command.ActorStaffId), async (now, activity) =>
        {
            var row = await database.WebsiteSocialSettings.SingleAsync(cancellationToken);
            if (row.Version != command.ExpectedRevision)
                return WebsiteMutationResult<WebsiteSocialAdminDto>.Conflict(WebsiteErrorCodes.StaleVersion, "Social media settings changed since you opened them. Reload; your draft stays on screen.");
            if (WebsiteSocialRules.Validate(command, out var values) is { } problem)
                return WebsiteMutationResult<WebsiteSocialAdminDto>.Invalid(problem.Field, problem.Message) with { Code = problem.Code };
            row.Save(now, command.ActorStaffId, command.PhoneEnabled, values!.PhoneNumber, values.PhoneHref,
                command.MessengerEnabled, values.MessengerUrl, command.ZaloEnabled, values.ZaloNumber, values.ZaloUrl, command.BackToTopEnabled);
            await database.SaveChangesAsync(cancellationToken);
            // One object, one generic title: the phone number and the links never go into the history.
            activity.Set("Saved", "social", "social-media", "Social media");
            return WebsiteMutationResult<WebsiteSocialAdminDto>.Success(Admin(row));
        }, cancellationToken);

    private static WebsiteSocialAdminDto Admin(TheBha.Domain.Website.WebsiteSocialSettings row) =>
        new(row.Version, row.UpdatedAtUtc, row.UpdatedByStaffId, row.PhoneEnabled, row.PhoneNumber, row.PhoneHref,
            row.MessengerEnabled, row.MessengerUrl, row.ZaloEnabled, row.ZaloNumber, row.ZaloUrl, row.BackToTopEnabled);
}
