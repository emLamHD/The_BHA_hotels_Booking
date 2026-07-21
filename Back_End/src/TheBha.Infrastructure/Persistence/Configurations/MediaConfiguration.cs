using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence.Configurations;

internal sealed class MediaConfiguration : IEntityTypeConfiguration<Media>
{
    public void Configure(EntityTypeBuilder<Media> builder)
    {
        builder.ToTable("Media");
        builder.HasKey(media => media.Id);
        builder.Property(media => media.Url).HasMaxLength(2000).IsRequired();
        builder.Property(media => media.AltText).HasMaxLength(500);
        builder.Property(media => media.MediaType).HasConversion<string>().HasMaxLength(30);
        builder.Property(media => media.CreatedAt).HasColumnType("timestamp with time zone");
    }
}
