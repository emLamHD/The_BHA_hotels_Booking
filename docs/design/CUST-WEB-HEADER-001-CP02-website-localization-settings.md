# CUST-WEB-HEADER-001-CP02 — Website languages, UI translations and currencies (Admin + API)

Status: implemented by `CUST-WEB-HEADER-001-CP02`. Decision record for the permission: `docs/ADR/0008-global-website-settings-permission.md`. Customer_Web does **not** consume any of this yet (a later phase).

## 1. Scope and boundary

In: the site-wide data model, the Admin API, the public read API, the Admin_Web screens (Languages, UI translations, Currencies and rates). Out: Customer_Web changes, menu CRUD / CMS, content/page translation, automatic exchange-rate feeds, converting any booking, hold, price or reservation (those stay in VND), Property-level overrides.

## 2. Permission

`WebsiteSettingsManage` = `StaffAccounts.CanManageWebsite` (default `false`), granted/revoked by `--staff-website-access --email <email> --enabled true|false` on the API host (grant refused for a disabled account; the verb changes nothing else). Checked per request against the database; reads and writes alike. A missing/denied permission is `403`, no session `401`, wrong Origin/content type are refused by the existing Staff request boundary. In `LocalGate` mode the routes are `404`. `me` and login return `permissions`.

Example (placeholders only):

```
dotnet TheBha.Api.dll --staff-website-access --email <staff-email> --enabled true
dotnet TheBha.Api.dll --staff-website-access --email <staff-email> --enabled false
```

## 3. Data (migration `20261015050047_AddWebsiteLocalizationSettings`)

| Table | Key points |
|---|---|
| `WebsiteLanguages` | `Code` (BCP 47, case-insensitive unique), `DisplayName`, `NativeName`, `SortOrder`, `IsActive`, `IsDefault`, `Version`, audit columns (FK → `StaffAccounts`). Partial unique index: one default. CHECK: the default is active. |
| `WebsiteTranslations` | `(LanguageId, Key)` unique, `Value` (plain text ≤ 1000), `Version`, audit. Keys are fixed in code (`WebsiteTranslationCatalog`), never created by Admin. |
| `WebsiteCurrencies` | `Code` (ISO 4217, upper), `Name`, `Symbol`, `MinorUnits` 0–4, `SortOrder`, `IsActive`, `IsDefault`, `IsBase`, `VndPerUnit numeric(20,8)` (nullable), `RateUpdatedAtUtc`, `RateSource` (`manual`), `Version`, audit. CHECKs: base is VND with rate 1 and always active; active ⇒ has a rate; default ⇒ active. Partial unique indexes: one base, one default. |

Two `DEFERRABLE INITIALLY DEFERRED` constraint triggers (SQLSTATE `XBHA3`, `XBHA4`) guarantee exactly one default language and exactly one default currency at commit, regardless of the application path.

Frozen seed (in the migration, not in code, so re-running changes nothing): languages `vi` (active, default) and `en` (present but **off**, all 25 managed keys with authored English); currencies VND (base, default, on, rate 1), USD and EUR (off, **no rate**); 50 translation rows. `Down()` refuses while any account holds the permission, a language other than `vi`/`en` or a currency other than VND/USD/EUR exists, or any row has a version > 1 or belongs to a non-seed language. It does not detect the deletion of an unedited seed row (all remaining rows stay at version 1), so it is a guard against dropping edited data, not a proof that nothing changed.

`VndPerUnit` is **VND per one unit** of the currency (so a reference amount in the currency is VND ÷ rate). It is exchanged as a decimal **string** matching `^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$`, `> 0`, never a JSON number; the API returns the canonical form without trailing zeros (`25000.50` is stored `25000.50000000` and returned `25000.5`).

## 4. Rules (all enforced by the server; the UI repeats them only to save a round trip)

- **Languages**: code is a normalized BCP 47 tag, fixed after creation. A new language is off and has no translations. The default is always active and **complete** (a value for every managed key): making a language the default is refused (`default-language-incomplete`) otherwise; the default cannot be turned off or deleted; a language that is on, is the default or has saved translations cannot be deleted (`language-in-use`).
- **UI translations**: plain text (no `<` `>`, no control characters), ≤ 1000 characters, exactly the placeholders the key declares (`{name}`, no more, no fewer). A non-default language stores overrides only; removing one falls back to the default language's value. The default language can never remove a value.
- **Currencies**: VND is the fixed base (no edit, no rate change, no delete, never off); it may be chosen as the display default again. A new currency is off and has no rate; turning it on or making it the default requires a rate (`rate-required`), the default must be on, the default cannot be turned off or deleted, a currency that is on or the default cannot be deleted (`currency-in-use`).
- **Concurrency**: every mutation carries `expectedVersion`; a mismatch is `409 stale-version`. All writes run in one transaction that first takes one global PostgreSQL advisory lock (`BookingAdvisoryLockKeys.ForWebsiteSettings()`), re-reads, compares versions inside the lock, and (for a default change) clears the old default before setting the new one in ordered saves. A translation create is `expectedVersion: null`.

Error body: RFC 9457 problem details with a stable `code` (`validation`, `stale-version`, `already-exists`, `default-language-required`, `default-language-incomplete`, `language-in-use`, `unknown-key`, `default-currency-required`, `rate-required`, `base-currency-fixed`, `currency-in-use`, `currency-inactive`) and, for field errors, `field`.

## 5. API

Admin (`/api/admin/v1/website`, Staff session + `WebsiteSettingsManage`; reads are `GET`, every mutation is `POST` with JSON, `no-store`):

- `languages`: `GET`, `POST` (create), `POST {code}/update`, `{code}/set-default`, `{code}/delete`.
- `translations`: `GET ?locale=&group=&search=`, `POST save`, `POST clear`.
- `currencies`: `GET`, `POST` (create), `POST {code}/update`, `{code}/rate`, `{code}/active`, `{code}/set-default`, `{code}/delete`.

Public, anonymous, `GET`, `no-store` (`/api/v1/website`): `config` (offered languages = active ones, default locale, base/default currency, active currencies with rate and rate time) and `dictionary?locale=` (`requestedLocale`, `resolvedLocale`, `defaultLocale`, `isFallbackLocale`, `entries`). Resolution: the requested tag if it is an active language, else its primary subtag (`en-US` → `en`) if active, else the default; a missing value in the resolved language falls back to the default language's. An unknown or off locale is a `200` fallback, never an error.

## 6. Admin_Web

Sidebar group **Website** → `/website/languages`, `/website/translations`, `/website/currencies`. Only in `Staff` mode (`LocalGate` shows a panel and sends nothing). No data request is sent until `me` has confirmed a session that holds the permission; without a session the page goes to `/signin?returnTo=<page>`; `returnTo` is an exact allowlist of the three pages (default `/calendar`), never an arbitrary URL. Every write is a confirmed, single-flight request that is never retried: a refusal keeps the form and shows the server's reason; a stale version keeps the draft and offers "Reload the latest values"; a lost answer is *unverified* and blocks resending until the server has been read ("Check server"). A write holds Sign out; a sign-out refuses new writes; a `403` re-reads `me` and closes the page if the permission is gone; a `401` ends the session. Nothing is shown as saved until the server answered and the list was read again.

## 7. Provenance of the 25 managed keys

Vietnamese values are lifted from the current Customer_Web sources (file:line recorded next to each key in `WebsiteTranslationCatalog`). The English values are **authored** for this work item and are not a source of truth. There is no standalone save / cancel / delete / confirm key because Customer_Web has no such standalone label (only compound ones such as "Xác nhận đặt phòng"); inventing one would change product wording, so it is left to the phase that builds that content.

## 8. Boundary to later phases

Phase 3 (not authorized here) would make Customer_Web read `config`/`dictionary`, apply the language/currency choice and add menu/content management. Until then the header's language/currency control stays the demonstration it is today, and a rate is informational.
