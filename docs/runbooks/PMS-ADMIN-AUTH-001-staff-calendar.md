# Runbook — Staff access to the Admin Calendar (PMS-ADMIN-AUTH-001)

Operating the Reservation Board (`/calendar`) and its five writes with Staff
sign-in. Design: `docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md`; decisions:
ADR 0007. This runbook describes configuration and operator steps only; it does
not deploy anything.

## 1. Modes

| | API `AdminCalendar:AccessMode` | Admin Web `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` |
|---|---|---|
| **Staff (default)** | not set, or `Staff` — in every environment | not set, or `Staff` |
| LocalGate (local development only) | `LocalGate`, Development only; any other environment **refuses to start** | `LocalGate`; **refused in a production build** |
| anything else (empty, `{}`, `[]`, another spelling) | refuses to start | configuration error, nothing is sent |

- The API reads the mode **once at startup**: change it, then restart the API.
  The Admin Web value is inlined **at build time**: change it, then rebuild
  (`npm run build`) or restart `next dev`. Both sides must name the same mode.
- In Staff mode the LocalGate opt-ins (`AdminCalendar:EnableUnauthenticatedRead`,
  `EnableUnauthenticatedWrite`) are not consulted. In Production either one set
  to `true` stops the host, in any mode. Never set them outside a developer's
  machine.
- **LocalGate is not a rollback.** It has no authentication or RBAC and cannot
  start outside Development. To take the Calendar out of service, stop serving
  it (stop the Admin Web, or block `/api/admin/` at the edge) or redeploy the
  last verified Staff build; never turn on the anonymous flags.

## 2. Hosting requirements (Staff)

- **HTTPS on both origins.** The API and the Admin Web are served over HTTPS
  with certificates the browsers trust. Never ask users to accept a certificate
  warning, and never disable TLS verification.
- **Same site.** The Staff cookie `.TheBha.Staff` is `HttpOnly`, `Secure`
  (outside Development), `SameSite=Strict`, path `/api/admin`, 8 hours absolute.
  The browser must send it to the host that set it: either the Admin Web origin
  and the API are the same site (same registrable domain), or the Admin Web
  proxies `/api/admin/v1/*` to the API from its own server so the cookie is
  first-party on the Admin origin (`BHA-ADMIN-PROXY-001`, `API_PROXY_ORIGIN`;
  deployment packet in `docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md` §7b). The
  cookie attributes do not change in either mode.
- **`Cors:AdminOrigins`**: the exact HTTPS origin(s) of the Admin Web, nothing
  else (no wildcard, no `http://`). Staff `POST`s (login, logout, the five
  writes) must carry exactly one `Origin` from this list; with the list empty
  every Staff write — login included — is refused. This is a server-side
  `Origin` check, not CORS response headers, and it applies in proxy mode too: the
  browser's same-origin POST carries the Admin origin.
- **Data Protection keys**: `DataProtection:KeysPath` must point to durable
  storage shared by every API instance (Production refuses to start without
  it). Losing or not sharing the keys signs every Staff out.
- **Proxies**: forwarded headers are trusted only from the configured
  `Hosting:TrustedProxy` network/addresses (`ForwardLimit` 1), never "any proxy"
  — see the deployment runbook §5. Behind a reverse proxy, or when the Admin Web
  proxies `/api/admin/v1/*` from Vercel, the API sees that proxy's address as the
  client, so the rate limiter, which partitions by that address, is shared by all
  users behind it.

## 3. Staff accounts (CLI on the API host)

Staff are managed only by the API's CLI, never over HTTP. Run it with the same
configuration as the API (same `ConnectionStrings__TheBhaDatabase`,
environment and settings — it passes the same startup checks):

```bash
dotnet TheBha.Api.dll --staff-create --email desk@example.com --property-id <property-guid> --role FrontDesk
dotnet TheBha.Api.dll --staff-grant  --email desk@example.com --property-id <property-guid> --role Manager
dotnet TheBha.Api.dll --staff-reset-password --email desk@example.com
dotnet TheBha.Api.dll --staff-disable --email desk@example.com
```

- **Check the target first.** Every run prints `staff: target database host/db`
  before it changes anything. Stop if it is not the database you meant.
- **Passwords** are read from a hidden prompt, or from `BHA_STAFF_PASSWORD` for
  a single non-interactive run (set it for that command only, then unset it).
  Never put a password in an argument, a script or a log.
- **Roles** are exactly `FrontDesk` and `Manager`, per Property.
  - FrontDesk: read the board; assign/move/unassign within the sold room type;
    create/cancel operational blocks.
  - Manager: all of that, plus a confirmed cross-room-type placement with a
    reason.
- `--staff-grant` adds a membership or changes its role (also downward). There
  is no CLI verb to remove a membership; to cut a person's access entirely,
  `--staff-disable` them.
- Changes apply on the **next request** of an existing session: a disabled
  account or a reset password is signed out (401), a changed role or membership
  is refused (403) and the board re-reads `me` and updates. Logout clears the
  cookie but does not rotate the security stamp — disable or reset to end a
  possibly copied session.

## 4. Acceptance checklist after a change

1. `/calendar` without a session goes to `/signin`.
2. Sign in as a FrontDesk Staff member → `me` lists the expected Properties →
   the board of the selected Property loads.
3. One permitted write (e.g. a block on a free room, then cancel it) succeeds.
4. The audit rows of that write name `staff:{StaffAccountId}`
   (`RoomOccupancySegmentAudits.ActorReference`); a Manager cross-room-type
   placement also carries `staff-rbac:Manager:{propertyId}:cross-room-type-confirmed`.
5. Sign out → `/signin`, and `GET /api/admin/v1/me` answers 401.

## 5. Reading what users see

| Signal | Meaning | Action |
|---|---|---|
| `401` / sent to `/signin` | no valid Staff session (expired after 8 h, signed out, disabled, password reset) | sign in again; check the account if it keeps happening |
| `403` / "not permitted" | the server refused this action for the role or Property; the board re-reads `me` and updates | check memberships and role (`--staff-grant`) |
| "Your Staff access could not be checked again … Retry" | after a refusal the board could not re-read `me` (network, CORS, 5xx, unreadable answer); access is closed until Retry | check API reachability, `Cors:AdminOrigins`, certificates; then Retry |
| "Sign-out was not confirmed …" | logout did not reach the API; the session may still be active | retry sign-out; disable the account if it must end now |
| "Unconfirmed request …" / "could not be confirmed" | a write may or may not have been saved; it is **never retried** and its nights stay locked in that tab | check the reloaded board (or the audit) before doing anything again; do not resend blindly |

## 6. Local development

- Staff (default): run the API `https` launch profile and `npm run dev:https`
  with trusted certificates, create a local Staff account with the CLI against
  your development database, and sign in.
- LocalGate (anonymous, same machine only): set
  `AdminCalendar__AccessMode=LocalGate` plus the read and/or write opt-in on the
  API (repository README) and `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE=LocalGate`
  for `next dev`. It works only on a Development, HTTPS, loopback-to-loopback
  host without a proxy.
