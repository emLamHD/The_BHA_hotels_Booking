# Running the full stack locally (API + Admin_Web + Customer_Web)

Operator guide for a Linux development machine. It records the failures met on
2026-11-18 while bringing the stack up, why each happened, and the setup that
avoids them. Nothing here changes code, schema or contracts.

## 1. Ports and processes

| Part | URL | Command (from repo root) |
|---|---|---|
| PostgreSQL 17 | `localhost:5432` | container `the-bha-postgres-1`, DB `thebha_dev` |
| API | `https://localhost:7145` | see §3 |
| Admin_Web | `https://localhost:3001` | `cd Front_End/Admin_Web && npm run dev:https` |
| Customer_Web | `https://localhost:3000` | see §4 |

The API allows browser origins `https://localhost:3000` (Customer) and
`https://localhost:3001` (Admin) only (`appsettings.Development.json`). Do not
move the front ends to other ports.

## 2. One-time prerequisites

1. **mkcert CA installed** and these files present:
   - `Front_End/Admin_Web/certificates/localhost.pem` and `localhost-key.pem`
   - `Front_End/Customer_Web/.certs/localhost.pem` and `localhost-key.pem`
   - CA file: `~/.local/share/mkcert/rootCA.pem`
2. **API connection string and media folder** in user-secrets of
   `Back_End/src/TheBha.Api` (`dotnet user-secrets list`):
   - `ConnectionStrings:TheBhaDatabase` → `thebha_dev`
   - `WebsiteMedia:RootPath` → an absolute folder that holds **every** file the
     DB references (see incident C).
3. `Front_End/*/.env.local` with `NEXT_PUBLIC_API_BASE_URL=https://localhost:7145`.

## 3. Start the API

```bash
C=$PWD/Front_End/Admin_Web/certificates
Kestrel__Certificates__Default__Path=$C/localhost.pem \
Kestrel__Certificates__Default__KeyPath=$C/localhost-key.pem \
  dotnet run --project Back_End/src/TheBha.Api/TheBha.Api.csproj --launch-profile https
```

- Use the `https` launch profile: it sets `ASPNETCORE_ENVIRONMENT=Development`,
  which is what loads user-secrets. Without it the API has no connection string
  and no media folder.
- The mkcert leaf is needed because Chrome rejects the ASP.NET dev certificate
  (`ERR_CERT_INVALID`; found in PMS-CAL-001.5-CP01).
- `--no-build` is fine only when `bin/` is newer than your last code change.

**Apply pending migrations before the first start on a new branch** (incident A):

```bash
dotnet ef database update \
  --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj \
  --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj
```

## 4. Start Customer_Web — with the mkcert CA

```bash
cd Front_End/Customer_Web
NODE_EXTRA_CA_CERTS=$HOME/.local/share/mkcert/rootCA.pem npm run dev
```

`NODE_EXTRA_CA_CERTS` is **mandatory** (incident B). The browser trusts the
mkcert CA, but Node (the Next server that calls the API) does not unless told.

## 5. Staff account for Admin_Web

`AdminCalendar:AccessMode` is `Staff`, so Admin needs a Staff account. There is
no HTTP route for this; use the CLI. The password is read from
`BHA_STAFF_PASSWORD`, never from an argument.

```bash
export ASPNETCORE_ENVIRONMENT=Development
export BHA_STAFF_PASSWORD='<password>'   # needs a non-alphanumeric character (incident D)
API=Back_End/src/TheBha.Api/TheBha.Api.csproj
P=<property-guid>                          # select "Id","Name" from "Properties"
dotnet run --no-build --project $API --no-launch-profile -- --staff-create --email <email> --property-id $P --role Manager
dotnet run --no-build --project $API --no-launch-profile -- --staff-grant  --email <email> --property-id <other-property-guid> --role Manager
dotnet run --no-build --project $API --no-launch-profile -- --staff-website-access --email <email> --enabled true
dotnet run --no-build --project $API --no-launch-profile -- --staff-blog-access --email <email> --edit true --publish true
unset BHA_STAFF_PASSWORD
```

- Roles are `FrontDesk` and `Manager`; `Manager` is the highest. Property roles
  are per Property: grant each new Property again.
- Website and blog permissions are site-wide flags, separate from the role.
- The account lives in the database: it survives restarts and is lost only if
  the DB is reset or the API points at another DB.

## 6. Incidents and fixes

### A. Admin shows "Máy chủ Admin trả lời HTTP 500"
- **Cause:** the DB was behind the code. `thebha_dev` lacked migrations
  `AddNewsletterVerification` and `AddNewsletterClaimFences`, so
  `/website/newsletter/sender` queried a missing table
  (`42P01: relation "NewsletterSenderSettings" does not exist`). The newsletter
  worker logged the same error.
- **Fix:** apply migrations (§3), restart the API.
- **Avoid:** after switching branch or pulling, compare
  `select "MigrationId" from "__EFMigrationsHistory" order by 1 desc limit 1`
  with the newest file in `TheBha.Infrastructure/Persistence/Migrations/`.

### B. Customer home loses blocks; console floods with `[i18n] missing text … (vi)`
- **Cause:** Customer_Web was started without the CA. Every server-side call to
  the API failed (`fetch failed` in the Next log for dictionary, config, menu,
  hero, blog, promotions). The dictionary was empty, so each key was "missing",
  and every API-driven block disappeared. The keys themselves exist: the API
  returns all 1215 `vi` keys.
- **Fix:** restart with `NODE_EXTRA_CA_CERTS` (§4).
- **Diagnose:** the Next terminal shows `could not be read: fetch failed`.
  `curl --cacert ~/.local/share/mkcert/rootCA.pem https://localhost:7145/api/v1/website/config`
  must succeed.

### C. Pictures missing (blog/news images broken)
- **Cause:** images are served from `WebsiteMedia:RootPath`. That folder held
  only 40 of the 280 files the DB references (an earlier partial copy). The API
  answers `404` for a picture whose file is absent.
- **Fix:** copy the missing files without overwriting, from the folder that
  has them:
  `rsync -a --ignore-existing <full-media-folder>/ <WebsiteMedia:RootPath>/`
  No API restart is needed.
- **Diagnose:** list the keys the DB needs and test the files:
  `select "StorageKey" from "BlogMedia" union select "StorageKey" from "BlogMediaVariants"`,
  then check each exists under the root. A picture is also `404` when no
  published article uses it; that is by design, not a fault.
- **Avoid:** a media folder belongs to one database. Never point a DB at a
  folder copied for a different DB.

### D. `--staff-create` rejected: `PasswordRequiresNonAlphanumeric`
- **Cause:** the Staff password policy requires a non-alphanumeric character.
  Nothing was written.
- **Fix:** choose a password with one (for example a trailing `@`). Do not weaken
  the policy for a local convenience.

### E. `401` on `GET /api/v1/auth/me` in the Customer console
- **Not a fault.** Customer_Web asks whether a customer is signed in; an
  anonymous visitor gets `401`. Chrome prints it red. It does not cause missing
  pictures or text. Removing it needs a frontend change.

### F. Shell pitfalls when scripting restarts
- `pgrep -f "<pattern>" | xargs kill` kills your own shell if the pattern is in
  the command line (exit 144). Find the PID from the port instead:
  `ss -ltnp | sed -n 's/.*:7145 .*pid=\([0-9]*\).*/\1/p'`.
- Start servers with `setsid nohup … < /dev/null &` so they outlive the shell.
- Environment variables do not persist across separate shell calls; set them in
  the same command.

## 7. Health check after start

```bash
CA=~/.local/share/mkcert/rootCA.pem
curl --cacert $CA -s -o /dev/null -w "api %{http_code}\n"      https://localhost:7145/swagger/index.html
curl --cacert $CA -s -o /dev/null -w "admin %{http_code}\n"    https://localhost:3001/signin
curl --cacert $CA -s -o /dev/null -w "customer %{http_code}\n" https://localhost:3000/
```

All three must be `200`. Then confirm the Customer terminal shows no
`fetch failed` and no `missing text`, and open `/website/newsletter/sender` in
Admin to confirm the migrations are applied.
