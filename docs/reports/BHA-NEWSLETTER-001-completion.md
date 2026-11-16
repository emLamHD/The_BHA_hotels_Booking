# BHA-NEWSLETTER-001 — completion report (Newsletter V1)

- **IMPLEMENTATION:** PASS for V1 as scoped. **REVIEW:** NOT_RUN — the Owner invokes Codex.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX` (the prompt wrote `CODEX`, read as `CODEX_READ_ONLY`; `CODEX_REVIEW_COMMAND` was supplied by the Owner in the session: `/codex:review --wait --base origin/develop`).
- **Branch / base:** `feature/bha-newsletter-001` from `origin/develop` `23aea13` (already contains PR #131); tree clean at start; no worktree.
- **Draft PR:** https://github.com/emLamHD/The_BHA_hotels_Booking/pull/132 (Draft, base `develop`).
- **Governance note:** the prompt omitted `FEATURE_BRANCH`, baseline, skill policy, stop conditions and the review command; the Owner chose the branch/baseline and the command when asked. `GRAPHIFY_POLICY` was not declared, so Graphify was not used.

## What it does

| Layer | Change |
|---|---|
| Customer_Web | `HomeNewsletter` sends the address to the API. States: sending (button disabled, one request), invalid address (no request), refused / failed / too many (address kept, retry), received (`Đã ghi nhận yêu cầu đăng ký.`, field cleared only on 202). The purpose of the e-mail is the visible text next to the button (`customer.newsletter.disclosure`, vi/en/fr). `src/lib/newsletterApi.ts` is the client; no retry, no credentials, the result carries message keys, never the address. |
| API | `POST /api/v1/website/newsletter-subscriptions` — anonymous, `website-public` CORS (uncredentialed), `IgnoreAntiforgeryToken` (no cookie to borrow; documented on the controller), rate limit policy `newsletter-subscribe` (`Website:Newsletter:RateLimiting`, default 5 / 60 s per client address, partitioned like the login limiter), HTTPS redirect from the host. Invalid address → `400 newsletter-email-invalid`. Valid → `202 {"status":"received"}` for a new and a known address alike. |
| PostgreSQL | `NewsletterSubscriptions(Id, Email, Source, Status, ReceivedAtUtc)`; `Email` is the normalized (trim + lower case) address with a unique index; checks keep it normalized and `Source = homepage`, `Status = PendingVerification`; the write is `INSERT … ON CONFLICT ("Email") DO NOTHING`. Migration `20261116043442_AddNewsletterSubscriptions` (migration 21); `Down()` refuses while rows exist. |
| Admin API | `GET /api/admin/v1/website/newsletter-subscriptions?search&page&pageSize` behind `StaffWebsitePermission(WebsiteSettingsManage)` (401 anonymous, 403 without the flag, never cached). Newest first (ties by id), literal case-insensitive search (`%`, `_`, `\` escaped), paging (`pageSize` ≤ 100); the offset is 64-bit and a page past the end is empty. |
| Admin_Web | Sidebar **Website → Đăng ký nhận tin**, page `/website/newsletter` behind `WebsiteAccessGate`: e-mail, received time, source, **Chưa xác minh email**; loading, empty (with and without a search) and error-with-retry states; search and paging are server requests. |
| Content pack | The table is `Excluded` in `ContentPackSpec` and in the committed `manifest.json` (visitors' addresses are personal data, not site content); without this every export fails as "unclassified tables". |

## Decisions that are mine (say if you want them changed)

- **Permission:** the list uses the existing site-wide `WebsiteSettingsManage`; no new flag and no schema change on `StaffAccounts`. A reader of the list therefore also manages the website settings.
- **Stored address:** one column holding the normalized address; the exact casing typed is not kept.
- **Rate limit:** 5 requests per minute per client address. A shared address (a hotel network) shares that budget; change `Website:Newsletter:RateLimiting` if needed.
- **CSRF:** the route ignores the antiforgery filter on purpose (see above); a forged request can only add an address, bounded by the rate limit.

## Verification (all run in this session)

| Check | Result |
|---|---|
| Backend `dotnet test` (Release, whole solution), on `da20a06` | unit 676 passed; integration **1399 passed, 0 failed** |
| After the last fix (`972df74`), re-run of `WebsiteNewsletterApiTests`, `WebsiteSettingsAuthorizationTests`, all `*MigrationTests`, `ContentPackTests` | 73 passed |
| New integration tests (`WebsiteNewsletterApiTests`, 27 cases) | normalization and stored columns; repeat in other case/spaces = one row, same body, first time kept; 24 concurrent requests = one row; 13 invalid addresses, missing/null/over-long/malformed body = 400 and no row; rate limit 429 and no write; CORS approved/unapproved origins and no credentials; DB refuses duplicate, non-normalized and unknown-status rows; Staff list order, paging, search, `%`/`_` literal, page past the end and `page=2147483647`, bad query = 400; a public request shows in the Staff list |
| Permission matrix | `WebsiteSettingsAuthorizationTests` now includes the list URL: anonymous 401, Customer session 401, FrontDesk/Manager without the flag 403, flag holder 200; LocalGate mode 404 |
| Customer_Web | `vitest` 1631 passed (new `newsletterApi.test.ts`, updated `newsletterUi`/`HomePage`/`HomeLayoutPolish` tests); `tsc`, `next lint`, `next build` pass |
| Admin_Web | `vitest` 2466 passed (new `NewsletterSubscriptionsPanel.test.tsx`: loading, order, empty, error + retry, paging, parser); `tsc`, `eslint`, `next build` pass |
| Down guard | on a scratch database: with a row `database update <previous>` fails and the row stays; when empty it succeeds and the migration re-applies |
| **Browser, HTTPS (Chrome, real API + PostgreSQL), 24 / 24** | home form: purpose text; invalid address sends nothing; an aborted send shows the retry message and keeps the address, nothing stored; the retry shows `Đã ghi nhận yêu cầu đăng ký.` and empties the field; DB row `test.demo@example.com|homepage|PendingVerification`; the same address with other case/spaces = same message, one row, first time kept; three concurrent browser requests = same `202` body, one row; the rate limit reaches the form (`gửi hơi nhanh`), address kept, nothing stored. Admin: anonymous API 401 and page redirected to sign-in; a FrontDesk without the flag sees no list and gets 403 from the API; the flag holder finds the e-mail after a reload and a search with **Chưa xác minh email**; search narrows server-side; page 1 holds 20 rows, newest first (matches the DB), page 2 the rest; `page=2147483647` is not a 500; no unexpected console errors |
| HTTPS | live API: plain `http://…:5145` POST answers `307 → https://…:7145/…` and writes nothing. There is no automated plain-HTTP integration test: the in-process test host has no HTTPS port, so the redirect cannot be exercised there |

An earlier acceptance run was 22/23: the one miss was my script expecting a fixed "newest" e-mail while the rate-limit step had added newer ones; the DB confirmed the Admin's first row was the newest, the assertion now compares with the DB, and the whole script was re-run (24/24).

## Things that are not proven or that you should know

- **Harness, not product:** with a connection string whose database name is longer than ~20 characters the integration factory builds a name over PostgreSQL's 63-character limit and four `BlogMedia*` tests fail (`current_database()` is truncated). A short name (`thebha_nl`) passes; CI uses a short name. Not related to this change.
- **Existing databases:** the changed texts (`customer.newsletter.disclosure`, `customer.home.homeNewsletter.subscribeDemoYourEmailIs`) live in the API assembly's built-in packs, and a stored `WebsiteTranslations` row would win over them. `thebha_dev` holds no row for these keys (only 17 `customer.header.*` rows, none of them newsletter) and no migration seeds them, so a redeployed API serves the new text; a text a Staff member edited by hand in Admin would still win, by design. **The API must be rebuilt and redeployed**, and the migration applied, before the form is opened.
- **Not covered:** e-mail provider, verification, unsubscribe, campaigns, CSV, edit/delete (later work items). The form is not opened to real visitors; deploy and merge are the Owner's.
- **Not run:** Codex review; CI on the final commit is reported in the handoff message.

## Demo (local, HTTPS)

1. PostgreSQL with the project schema; apply `dotnet ef database update --project Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj --startup-project Back_End/src/TheBha.Api/TheBha.Api.csproj`.
2. A Staff account with the website permission: `--staff-create --email <email> --property-id <property> --role FrontDesk` (password in `BHA_STAFF_PASSWORD`), then `--staff-website-access --email <email> --enabled true`.
3. API: `dotnet run --launch-profile https` from `Back_End/src/TheBha.Api` (with the mkcert leaf for Chrome, see the Admin certificates). Customer: `NODE_EXTRA_CA_CERTS=~/.local/share/mkcert/rootCA.pem npm run dev` (https://localhost:3000). Admin: `next dev --experimental-https -p 3001` (https://localhost:3001).
4. Open the Customer home page, type a test e-mail in **Nhận ưu đãi từ The BHA**, press **Đăng ký**: `Đã ghi nhận yêu cầu đăng ký.`
5. Sign in to Admin, open **Website → Đăng ký nhận tin**, reload, search the e-mail: the row shows **Chưa xác minh email**.

## PR size

See the PR: it is far above the 100–400-line target because it carries one new migration with its `Designer.cs` and the model-snapshot change, the three-language texts, a backend integration suite (27 cases) and two UI test files; the hand-written product code is a small fraction of it.
