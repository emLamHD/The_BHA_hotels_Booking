# BE-003.1 customer booking identity foundation

## Scope

This work adds only the customer account and secure cookie-session foundation.
It does not add booking holds, reservations, availability changes, guest tokens,
payments, customer UI, or administration authentication.

Customer account identifiers are UUID values, matching the existing aggregate
identifier convention and allowing a future booking resource to hold a nullable
`CustomerAccountId`. The Application layer exposes `ICurrentCustomer`; it has no
dependency on `HttpContext` or ASP.NET Core Identity.

## API contract

| Method | Path | Success | Client/security responses |
| --- | --- | --- | --- |
| `GET` | `/api/v1/auth/csrf` | `200` with `{ token, headerName }` | — |
| `POST` | `/api/v1/auth/register` | `201` with `{ customerAccountId, email }` | `400`, `409`, `429` |
| `POST` | `/api/v1/auth/login` | `200` with the minimal customer response and session cookie | `401`, `429` |
| `POST` | `/api/v1/auth/logout` | `204` and an expired session cookie | `400`, `401` |
| `GET` | `/api/v1/auth/me` | `200` with `{ customerAccountId, email }` | `401` |

Duplicate registration uses `409` with a safe response that does not disclose
account details. Invalid login always uses the same generic `401` response.
Authentication challenges are JSON Problem Details responses and never redirects.
Passwords are validated and hashed by ASP.NET Core Identity and never returned or
logged.

Registration and login deliberately opt out of antiforgery validation because
they do not consume authenticated ambient authority. They remain protected by
separate fixed-window rate limits. All unsafe controller actions are otherwise
covered by the global automatic antiforgery filter, including logout.

## Cookie and antiforgery contract

The authentication cookie is named `.TheBha.Customer`. It is HttpOnly, scoped to
`/`, has no Domain attribute, expires after eight hours, and uses the configured
`Authentication:Cookie:SameSite` value (`Lax` by default). Production always
sets `Secure`; Development uses the request transport so the documented local
HTTP workflow remains usable.

`GET /api/v1/auth/csrf` stores the protected antiforgery secret in an HttpOnly
cookie and returns only the request token. JavaScript sends that returned value
in `X-CSRF-TOKEN` on unsafe authenticated requests. A token obtained before login
must be refreshed after login because antiforgery binds it to the current
identity.

The default `Lax` setting matches the current same-site local topology. If a
future customer UI is hosted cross-site, operators must explicitly review CORS,
HTTPS, and set `SameSite=None`; this is a deployment decision, not an automatic
runtime weakening.

## CORS and Data Protection operations

Credentialed CORS origins come only from `Cors:AllowedOrigins`. Wildcards and
blank entries fail startup validation. An empty production list permits no
cross-origin credentialed requests. Development explicitly permits only
`http://localhost:3000`.

Production must set `DataProtection:KeysPath` to durable storage shared by all API
instances and protected with deployment-appropriate filesystem or service
permissions. The API fails production startup when it is absent. Ephemeral or
per-instance keys would invalidate sessions after restarts and can break
antiforgery validation across instances. No key material belongs in source
control.

## Persistence

Migration `CustomerBookingIdentity` adds the ASP.NET Core Identity Core user,
claim, login, and token tables. No role tables or administration behavior are
added. `AspNetUsers.NormalizedEmail` is required and has the unique PostgreSQL
index `UX_CustomerAccounts_NormalizedEmail`.
