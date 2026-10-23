# Runbook — Admin Blog (BHA-BLOG-001-CP03)

Contract: `docs/design/BHA-BLOG-001-blog-content-publishing.md` §10. Pictures: `BHA-BLOG-001-blog-media.md`. This page is what an operator or a developer does.

## Who may use the Blog

Two **global** Staff flags (ADR 0010), set only by the Admin API's own CLI, never by a seed and never by the Admin UI. There is no default administrator: create each account first, then grant.

```bash
# the account (Property role is needed to create it; it grants nothing in the Blog)
BHA_STAFF_PASSWORD='<set it here, not on the command line>' \
  dotnet run --project Back_End/src/TheBha.Api -- --staff-create --email editor@example.com --property-id <PROPERTY_ID> --role FrontDesk

# the Blog rights: both values are always stated
dotnet run --project Back_End/src/TheBha.Api -- --staff-blog-access --email editor@example.com --edit true  --publish false   # writes drafts, cannot publish
dotnet run --project Back_End/src/TheBha.Api -- --staff-blog-access --email lead@example.com   --edit false --publish true    # publishes saved drafts, cannot edit
dotnet run --project Back_End/src/TheBha.Api -- --staff-blog-access --email both@example.com   --edit true  --publish true
```

The rights are read from the database on every request: revoking one closes the Blog pages of a signed-in person on their next action (403). A Blog right does not open any other Website page (`WebsiteSettingsManage` is separate), and a Property Manager has no Blog right.

| Right | In the Admin |
|---|---|
| `BlogEdit` | new post / translation, save draft, restore a revision to a draft, picture details and focal point |
| `BlogPublish` | publish, unpublish, archive / unarchive, categories, pins, settings, delete an unused picture |
| either | read everything, preview, upload pictures |

## Running it locally (API + Admin)

- PostgreSQL 17 (a database of your own; never a shared or production one), `dotnet ef database update …` as in `AGENTS.md` §9, optionally `--seed-development` in `ASPNETCORE_ENVIRONMENT=Development`.
- API over HTTPS with a certificate Chrome trusts (the mkcert leaf Admin already generated), Admin origin allowed, a writable media directory:
  ```bash
  cd Back_End/src/TheBha.Api/bin/Release/net8.0     # the build folder: appsettings*.json must be in the content root, or CORS is empty
  ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=https://localhost:7145 \
  Kestrel__Certificates__Default__Path=<…>/Front_End/Admin_Web/certificates/localhost.pem \
  Kestrel__Certificates__Default__KeyPath=<…>/Front_End/Admin_Web/certificates/localhost-key.pem \
  WebsiteMedia__RootPath=<a writable folder> DataProtection__KeysPath=<a folder> \
  ConnectionStrings__TheBhaDatabase='<your connection string>' dotnet TheBha.Api.dll
  ```
- Admin: `NEXT_PUBLIC_API_BASE_URL=https://localhost:7145 npx next dev --experimental-https -p 3001` (the default in `.env.local`). `Cors:AdminOrigins` already lists `https://localhost:3001` in `appsettings.Development.json`.
- Without `WebsiteMedia__RootPath` an upload answers `409 blog.storage-not-configured` (by design, design §9.12).
- A language other than `vi` must be **active** (Website → Ngôn ngữ) before the Blog offers it; the Blog lists the website's active languages and never creates one.

## Tests

- Backend (real PostgreSQL, no mocks): `dotnet test Back_End/TheBha.Booking.sln --configuration Release` with `ConnectionStrings__TheBhaDatabase` set (≈ 10 min). Blog only: `--filter "FullyQualifiedName~Blog"`.
- Admin: `npm run lint`, `npm test` (vitest, ≈ 2 min), `npm run build` in `Front_End/Admin_Web`.
- Browser acceptance (CP03) was run with Playwright on the system Chrome against the real API and a throwaway database; the scripts are not part of the repository. The report lists what each acceptance item proved and how a lost answer was simulated.
