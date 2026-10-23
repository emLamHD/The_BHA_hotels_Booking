using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Blog;
using TheBha.Domain.Blog;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// The parts of the public article shape that the public read and the Staff-only preview must build the same way, so the preview shows what the reader
/// would get: the category references of a revision in one language, and the body with the Properties it may still name.
/// </summary>
internal static class BlogPublicShape
{
    /// <summary>The categories of each revision that have a text in <paramref name="locale"/> (a category without one is not shown), by sort order.</summary>
    public static async Task<Dictionary<Guid, List<PublicBlogCategoryRefDto>>> CategoryRefsAsync(
        TheBhaDbContext db, string locale, List<Guid> revisionIds, CancellationToken cancellationToken)
    {
        var rows = await (from rc in db.BlogRevisionCategories.AsNoTracking()
                          where revisionIds.Contains(rc.RevisionId)
                          join ct in db.BlogCategoryTranslations.AsNoTracking() on new { rc.CategoryId, Locale = locale } equals new { ct.CategoryId, ct.Locale }
                          join c in db.BlogCategories.AsNoTracking() on rc.CategoryId equals c.Id
                          orderby c.SortOrder, c.Id
                          select new { rc.RevisionId, ct.Slug, ct.Name, rc.IsPrimary }).ToListAsync(cancellationToken);
        return rows.GroupBy(r => r.RevisionId).ToDictionary(g => g.Key, g => g.Select(r => new PublicBlogCategoryRefDto(r.Slug, r.Name, r.IsPrimary)).ToList());
    }

    /// <summary>The stored body as a JSON value, minus any <c>propertyIntro</c> whose Property is not active now, plus the Properties it still names.</summary>
    public static async Task<(JsonElement Body, IReadOnlyDictionary<Guid, PublicBlogPropertyRefDto> Properties)> BodyAsync(
        TheBhaDbContext db, string bodyJson, CancellationToken cancellationToken)
    {
        var ids = BlogBody.Validate(bodyJson).Info?.PropertyIds.ToList() ?? [];
        var active = ids.Count == 0
            ? []
            : await db.Properties.AsNoTracking().Where(p => ids.Contains(p.Id) && p.IsActive).ToDictionaryAsync(p => p.Id, p => new PublicBlogPropertyRefDto(p.Slug, p.Name), cancellationToken);
        if (ids.Count == active.Count)
        {
            return (JsonDocument.Parse(bodyJson).RootElement.Clone(), active);
        }

        var root = JsonNode.Parse(bodyJson)!.AsObject();
        var blocks = root["blocks"]!.AsArray();
        foreach (var block in blocks.ToList())
        {
            if (block!["type"]!.GetValue<string>() == "propertyIntro" && !active.ContainsKey(block["propertyId"]!.GetValue<Guid>()))
            {
                blocks.Remove(block);
            }
        }

        return (JsonDocument.Parse(root.ToJsonString()).RootElement.Clone(), active);
    }
}
