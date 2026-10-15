# CUST-WEB-HEADER-001-CP02 — Website languages, UI translations and currencies (Admin + API)

Status: implemented by `CUST-WEB-HEADER-001-CP02`. Decision record for the permission: `docs/ADR/0008-global-website-settings-permission.md`. Customer_Web consumes it since `C2`/`R1` (§9): the sections above are the C1 baseline, §9 is the current behaviour and wins where they differ.

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
- **Currency codes** are the current ISO 4217 currencies: SIX List One (`Pblshd=2026-09-17`) minus funds, precious metals, the testing code, `XXX` and units of account (`XAD`, `XBA`–`XBD`, `XDR`, `XSU`, `XUA`), kept as an offline list in `Iso4217` (`WebsiteRules.cs`), which records its sources and as-of date. A code on List Three (withdrawn: `ANG`, `BGN`, `ZWL`) is refused on the `code` field and never stored; a rarely used code that List One still lists (`SVC`) is accepted. When SIX publishes a change the list is edited by hand — there is no runtime lookup.
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

## 9. C2/R1 — runtime language packs, Customer_Web integration, money (current behaviour)

Phạm vi R1 (Owner): toàn bộ Customer_Web (mọi trang/thành phần đã có, kể cả trang template được link từ menu) bằng vi/en/fr; Admin quản lý ngôn ngữ, bản dịch, tiền tệ/tỷ giá, ánh xạ ngôn ngữ → tiền tệ mặc định; cài thêm ngôn ngữ bằng gói qua Admin, không sửa mã, không build, không khởi động lại. **Chưa làm (PR sau):** dịch toàn bộ Admin vận hành (Calendar, màn TailAdmin) và bộ chọn ngôn ngữ toàn Admin.

**Gói ngôn ngữ (`bha.language-pack/1`).** JSON: `locale`, `displayName`, `nativeName`, `direction`, `formatLocale`, `defaultCurrency`, `pack{id,version,catalogRevision}`, `referenceLocale`, `messages{shared,customer,admin}` (khóa → câu ICU), `content` (nội dung tĩnh và nội dung thực thể DB: property/roomType/ratePlan/amenity/media), `sources` (hash câu nguồn). Danh mục khóa không phụ thuộc ngôn ngữ nằm ở `Back_End/src/TheBha.Application/Website/Localization/catalog.json` (sinh bằng `node Back_End/tools/i18n/catalog.mjs`, kiểm bằng `--check`, CI-safe); gói dựng sẵn vi/en/fr ở `.../packs/` và được nhúng vào API. Một ngôn ngữ chỉ được **bật** khi đủ mọi khóa bắt buộc (hiện 1436: tin nhắn UI + nội dung tĩnh + nội dung thực thể của DB đang chạy); chưa đủ thì là bản nháp: lưu được, không bao giờ hiện ra công khai.

**API.** Admin (`/api/admin/v1/website/language-packs`): `GET library`, `POST preview` (server kiểm gói, trả số liệu + `previewToken`), `POST apply` (ràng với `previewToken`; xem trước cũ hoặc đã thay đổi bị từ chối), `GET export/{code}`, `GET template`. Công khai (`/api/v1/website`): `config` (ngôn ngữ đang bật kèm `formatLocale`, `direction`, tiền tệ mặc định, tiền tệ + tỷ giá), `dictionary?locale=&scopes=&prefix=` (không cache), `POST display-prices` (quy đổi chính xác bằng `decimal` ở server, một ảnh chụp tỷ giá cho cả yêu cầu, làm tròn **từng dòng** theo số lẻ của tiền tệ, tổng = tổng các dòng đã làm tròn). Mã lỗi ổn định (`pack-invalid`, `pack-incompatible`, `language-incomplete`, `stale-version`, …) cho từng lý do từ chối; Admin dịch mã sang tiếng Việt, Customer dịch `shared.apiError.<code>`.

**Quy tắc ICU.** Parser (không phải regex) cho tập con ICU: `{var}`, `{n, plural, one {..} other {..}}`, `select`; biến của mọi bản dịch phải trùng biến của câu nguồn; số/ngày định dạng bằng `Intl` theo `formatLocale`, nên ngôn ngữ mới không cần mã.

**Tiền.** DB và đặt phòng luôn là VND. Hiển thị: ánh xạ mặc định vi→VND, en→USD, fr→EUR (cột `DefaultCurrencyCode` của ngôn ngữ, sửa được trong Admin), khách có thể chọn riêng tiền tệ; lựa chọn nhớ bằng cookie `bha_locale`/`bha_currency` (1 năm), đổi lựa chọn **không ghi gì** vào API đặt phòng/xác thực. Tiền tệ chưa có tỷ giá không được đưa ra cho khách; số tiền khác VND mà API trả sẵn thì hiển thị đúng như được cho, không đổi. Trang template dùng giá mẫu: 1 “đơn vị template” = 25.000 VND, qua cùng đường quy đổi (không còn ký hiệu `$` cố định).

**Customer_Web.** Layout (server) đọc cookie, kiểm với cấu hình đang chạy, gọi `dictionary` (`cache: no-store`) rồi bọc `I18nProvider`; đổi ngôn ngữ = ghi cookie + `router.refresh()` (không remount các provider đặt phòng/phiên, nên form, hold, token giữ nguyên). Khóa: `shared.*`, `customer.<khu vực>.*`, `customer.tpl.<hash FNV-1a của câu tiếng Anh>` cho chữ mẫu của template (`<Tpl/>`, `tpl()`; câu có giá là một khóa với `{price1}`…), `content.<entity>.<id>.<field>` cho nội dung tĩnh/DB. Thiếu khóa → hiện nguyên văn và ghi `console.warn` một lần (chỉ để lập danh sách còn thiếu); khóa mới trong danh mục làm ngôn ngữ chưa đủ cho tới khi dịch.

**Quy trình dịch (công cụ ngoài ứng dụng, `Back_End/tools/i18n/`).** `mt-pack.mjs` soạn nháp bằng LibreTranslate chạy cục bộ (nguồn khai báo rõ vi|en, không tự đoán ngôn ngữ; vi→en dùng bảng thuật ngữ `glossary.json`; **fr dịch từ bản en**); biến được thay bằng mẫu giả để kiểm không mất; số nhiều theo `Intl.PluralRules` của ngôn ngữ đích; chấm điểm dịch ngược và lập danh sách rà soát (chuỗi ngắn, giá/giữ phòng/hủy/xác nhận/thanh toán/lỗi). Bản dịch máy chỉ là **nháp**: toàn bộ chuỗi quan trọng và ≥100 chuỗi đại diện được người rà và sửa trước khi vào gói phát hành. `make-test-pack.mjs` sinh gói thử có dấu `[ES]` (không phải ngôn ngữ phát hành) cho kiểm thử A5.

**Admin_Web.** `/website/languages` (thẻ ngôn ngữ: độ phủ thật, tiền tệ mặc định, bật/tắt chỉ khi đủ, mặc định, xuất gói, cập nhật từ thư viện, xóa, tạo thủ công), hộp thoại gói (thư viện hoặc tải lên → xem trước từ server → áp dụng; chế độ giữ chỉnh tay/ghi đè; bật ngay nếu đủ), `/website/translations` (so song song nguồn/đích, lọc theo phạm vi/nhóm/trạng thái/tìm kiếm, phân trang, bản nháp giữ khi đổi bộ lọc, cảnh báo khi rời, nhắc biến), `/website/currencies` (tiền tệ + tỷ giá). Toàn bộ chữ của nhóm Website bằng tiếng Việt thống nhất.
