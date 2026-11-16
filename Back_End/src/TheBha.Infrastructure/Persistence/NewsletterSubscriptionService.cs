using Microsoft.EntityFrameworkCore;
using TheBha.Application.Website;
using TheBha.Domain.Website;

namespace TheBha.Infrastructure.Persistence;

internal sealed class NewsletterSubscriptionService(TheBhaDbContext database, TimeProvider timeProvider) : INewsletterSubscriptions
{
    // One statement, decided by the unique index: concurrent requests for one address insert once and the others do nothing.
    public async Task SubscribeAsync(string normalizedEmail, string source, CancellationToken cancellationToken) =>
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id", "Email", "Source", "Status", "ReceivedAtUtc")
            VALUES ({Guid.NewGuid()}, {normalizedEmail}, {source}, {NewsletterSubscription.StatusPendingVerification}, {timeProvider.GetUtcNow()})
            ON CONFLICT ("Email") DO NOTHING
            """,
            cancellationToken);

    public async Task<NewsletterSubscriptionPageDto> ListAsync(string? search, int page, int pageSize, CancellationToken cancellationToken)
    {
        var query = database.NewsletterSubscriptions.AsNoTracking();
        var term = search?.Trim();
        if (!string.IsNullOrEmpty(term))
        {
            // The term is data, not a pattern: % _ and \ are escaped.
            var pattern = "%" + term.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal) + "%";
            query = query.Where(row => EF.Functions.ILike(row.Email, pattern, "\\"));
        }

        var total = await query.CountAsync(cancellationToken);
        // The offset is 64-bit: page 2147483647 of 100 would overflow an int and become a negative OFFSET. Past the end is an empty page.
        if ((long)(page - 1) * pageSize >= total)
        {
            return new NewsletterSubscriptionPageDto([], page, pageSize, total);
        }

        var rows = await query.OrderByDescending(row => row.ReceivedAtUtc).ThenByDescending(row => row.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(row => new NewsletterSubscriptionDto(row.Id, row.Email, row.ReceivedAtUtc, row.Source, row.Status))
            .ToListAsync(cancellationToken);
        return new NewsletterSubscriptionPageDto(rows, page, pageSize, total);
    }
}
