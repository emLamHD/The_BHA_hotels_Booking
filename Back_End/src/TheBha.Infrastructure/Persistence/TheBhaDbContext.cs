using Microsoft.EntityFrameworkCore;

namespace TheBha.Infrastructure.Persistence;

public sealed class TheBhaDbContext(DbContextOptions<TheBhaDbContext> options)
    : DbContext(options);
