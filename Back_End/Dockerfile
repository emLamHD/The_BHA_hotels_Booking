# CUST-WEB-SHOWCASE-001-CP02: The BHA API image. Build context is Back_End/.
#
#   docker build -t thebha-api:local Back_End
#
# The image carries no secrets and no demo data: the connection string, allowed origins and the
# Data Protection key directory arrive as environment/volume at run time, and the Riverside demo
# seeder is a Development-only operator command that this Production image refuses to run.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Project files first so the restore layer is cached until a dependency changes.
COPY TheBha.Booking.sln ./
COPY src/TheBha.Domain/TheBha.Domain.csproj src/TheBha.Domain/
COPY src/TheBha.Application/TheBha.Application.csproj src/TheBha.Application/
COPY src/TheBha.Infrastructure/TheBha.Infrastructure.csproj src/TheBha.Infrastructure/
COPY src/TheBha.Api/TheBha.Api.csproj src/TheBha.Api/
RUN dotnet restore src/TheBha.Api/TheBha.Api.csproj

COPY src/ src/
RUN dotnet publish src/TheBha.Api/TheBha.Api.csproj \
    --configuration Release --no-restore --output /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# The Data Protection key ring (Staff/Customer cookies, antiforgery) lives here and must be a
# durable volume shared by every instance; DataProtection__KeysPath is set to it below.
# Created and owned by the unprivileged user so a fresh named volume inherits that ownership.
RUN mkdir -p /var/keys && chown app:app /var/keys

COPY --from=build --chown=app:app /app/publish ./

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://+:8080 \
    DataProtection__KeysPath=/var/keys \
    DOTNET_gcServer=0

USER app
EXPOSE 8080
VOLUME ["/var/keys"]
ENTRYPOINT ["dotnet", "TheBha.Api.dll"]
