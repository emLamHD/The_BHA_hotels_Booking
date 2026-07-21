using TheBha.Domain.Common;

namespace TheBha.Domain.Properties;

public sealed class Media
{
    private Media()
    {
    }

    public Media(Guid id, string url, string? altText, MediaType mediaType, DateTimeOffset createdAt)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new DomainException("Media URL must be an absolute HTTP or HTTPS URL.");
        }

        if (!Enum.IsDefined(mediaType))
        {
            throw new DomainException("Media type is invalid.");
        }

        Id = DomainGuard.RequiredId(id, nameof(id));
        Url = DomainGuard.Required(url, nameof(url), 2000);
        AltText = DomainGuard.Optional(altText, nameof(altText), 500);
        MediaType = mediaType;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }
    public string Url { get; private set; } = string.Empty;
    public string? AltText { get; private set; }
    public MediaType MediaType { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
}
