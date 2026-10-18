namespace TheBha.Application.Properties;

public static class CatalogValidation
{
    public static (string Field, string Message)? Validate(SaveCatalogContent x, bool room)
    {
        if (x.ExpectedVersion < 1) return ("expectedVersion", "A positive version is required.");
        if (string.IsNullOrWhiteSpace(x.Name) || x.Name.Length > 200) return ("name", "Name is required, at most 200 characters.");
        if (x.Description?.Length > 4000) return ("description", "At most 4000 characters.");
        if (x.Address?.Length > 500 || x.City?.Length > 120 || x.Country?.Length > 120) return ("address", "Address/city/country exceeds 500/120/120 characters.");
        if (x.AreaSquareMeters is <= 0 or > 10000 || (x.AreaSquareMeters.HasValue && decimal.Round(x.AreaSquareMeters.Value, 2) != x.AreaSquareMeters)) return ("areaSquareMeters", "Area must be positive, at most 10000, with at most two decimal places.");
        if (x.Bedrooms is < 0 or > 100 || x.BedDescription?.Length > 500) return ("bedrooms", "Bedrooms must be 0–100; bed information at most 500 characters.");
        if (!room && (x.AreaSquareMeters.HasValue || x.Bedrooms.HasValue || x.BedDescription is not null)) return ("bedrooms", "Room attributes belong to a RoomType.");
        if (x.Gallery is null || x.Gallery.Count > CatalogLimits.MaxGallery || x.Gallery.Any(i => i is null || i.MediaId == Guid.Empty || i.AltText?.Length > 500) || x.Gallery.Select(i => i.MediaId).Distinct().Count() != x.Gallery.Count)
            return ("gallery", "At most 50 distinct pictures, alt text at most 500 characters.");
        if (x.Gallery.Count(i => i.IsCover) != (x.Gallery.Count == 0 ? 0 : 1)) return ("gallery", "A non-empty gallery must have exactly one cover.");
        if (x.AmenityIds is null || x.AmenityIds.Count > 200 || x.AmenityIds.Distinct().Count() != x.AmenityIds.Count) return ("amenityIds", "At most 200 distinct amenities.");
        return null;
    }
}
