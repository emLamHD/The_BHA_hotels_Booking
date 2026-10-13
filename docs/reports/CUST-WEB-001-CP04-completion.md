# CUST-WEB-001-CP04 — Trang tài khoản Customer chỉ đọc, theo phiên thật

- **Work item / phase:** `CUST-WEB-001-CP04` / `CUSTOMER_ACCOUNT_READ_UI`. Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`. Model: Sonnet 5.5. Skills: không dùng `diagnosing-bugs` (nguyên nhân của mọi lỗi gặp phải đã rõ trong phiên); không dùng Graphify (`ALLOWED_IF_RELEVANT`, source/tests đủ).
- **Advisor:** dùng **1/2 lần**, trước khi chốt decision table (`customerAccountUi`). Tác động: xác nhận bảng 16 ô; yêu cầu hàm tổng (switch đầy đủ, chỉ `ready` mang email), test toàn bảng + hai bài compose với controller/coordinator thật, `FooterNav` dùng `href` của entry cho cả `isActive`, assert “0 `GET me` khi điều hướng client-side tới `/account`”, và các lưu ý harness (cổng đảo 3401/3400, cert mkcert riêng, PFX, PG qua `--env-file`, nâng rate limit, ngày đặt phòng trong cửa sổ seed, kiểm trust TLS tường minh, không `cat` env). Lần thứ hai **không dùng**: lỗi browser duy nhất chưa rõ ban đầu (xem “Phát hiện”) được tôi chẩn đoán trực tiếp.
- **Branch:** `feature/cust-web-001-cp04-customer-account-read` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `127850780ac6b2fbd96febe8aa45d8679c9d500d` (merge PR #111; `origin/develop` = baseline lúc preflight, 0 PR mở, nhánh CP03 vắng). Merge CI run `38411914919`: `completed/success` trên đúng baseline, Frontend/Backend/Admin đều `success` (đối chiếu lại trước khi implement).
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions/numstat và CI của FINAL_HEAD:** ghi ở PR body và terminal handoff, không ghi ở file này.
- **Owner:** kích hoạt **lõi** `/account` chỉ đọc và disposition ba route chưa hỗ trợ. Không duyệt toàn bộ DP-05 hay `DP-01`…`DP-11` (vẫn `OPEN`); cookie ASP.NET Core Identity giữ nguyên. Lịch sử/tra cứu/hủy reservation, chỉnh sửa hồ sơ, mật khẩu, billing, savelists, email xác nhận, thanh toán **không** nằm trong CP04.
- **Chính sách PR (Owner):** không có giới hạn/mục tiêu số dòng; report chỉ ghi số GitHub và `numstat`.

```
IMPLEMENTATION_CP04: PASS
CUSTOMER_ACCOUNT_READ_UI: IMPLEMENTED
ACCOUNT_DATA_AUTHORITY: PROVIDER_ME_ONLY
ACCOUNT_PROFILE_EDIT_PASSWORD_BILLING_SAVELISTS: NOT_SUPPORTED
UNSUPPORTED_ACCOUNT_ROUTES: EXPLICIT_UNAVAILABLE
CUSTOMER_RESERVATION_HISTORY: NOT_IMPLEMENTED
BOOKING_IDENTITY_GUARD: PRESERVED
ACCOUNT_READ_CORE: OWNER_ACTIVATED_CP04
REMAINING_PRODUCT_DECISIONS: OPEN
CUSTOMER_WEBSITE: NOT_COMPLETE
REVIEW_CP04: NOT_RUN — OWNER_ONLY
CP05_PLUS: NOT_STARTED
BACKEND_CD / LIVE_DEPLOY: OUT_OF_SCOPE / NOT_RUN
```

## Mapping điểm vào (đã xác minh trước khi code)

`app/layout.tsx` → `SiteHeader` (mặc định “Header 2”) → `Header navType="MainNav1" | "MainNav2"` hoặc `Header3`; **cả ba** (`MainNav1.tsx`, `MainNav2.tsx`, `Header3.tsx`) dùng `AvatarDropdown`, mỗi cái có thêm một instance `md:hidden` cho màn nhỏ — nên mục đăng nhập/tài khoản trên trang phòng mobile (nơi `FooterNav` bị ẩn) cũng đi qua `AvatarDropdown`. Mục app bar mobile là `FooterNav` (component riêng, ẩn ở `/listing-stay-detail`); `Footer.tsx` render nó lần thứ hai (có sẵn, ngoài scope). `data/navigation.ts` có link “Account page” → `/account` ở menu Templates (template, không đổi). **Coverage: không có entry nào `NOT_COVERED`** — mọi entry đều qua `AvatarDropdown` hoặc `FooterNav`, cả hai nằm trong allowlist.

## Source authority tại baseline (đọc trực tiếp)

`GET /api/v1/auth/me` → `200 {customerAccountId, email}` hoặc `401`; không có API sửa hồ sơ/đặt lại mật khẩu/liệt kê lịch sử. `CustomerSessionState` = `loading | anonymous | authenticated(customer) | unknown`; identity phase = `idle | transport | recovering | recovery-unresolved`; `refreshSession` chỉ `GET me`; ordinary refresh xoá identity trong lúc đọc (`state` thành `loading`). `routePolicy`/`middleware` không đổi.

## Thiết kế (chỉ trong allowlist; path Customer tính từ `Front_End/Customer_Web`)

| File | Nội dung |
|---|---|
| `src/lib/customerAccountUi.ts` (mới) + `.test.ts` (26 test) | `describeAccountView(state, identityPhase)` — **hàm tổng** (switch đầy đủ theo phase rồi status): `ready{email}` **chỉ** khi `authenticated`+`idle` (email nguyên văn từ `me`); `redirect-login` **chỉ** khi `anonymous`+`idle`; `checking` (`loading`+`idle`); `pending` (`transport`/`recovering`, kể cả khi còn snapshot `authenticated` cũ); `unresolved` (`unknown`+`idle` hoặc `recovery-unresolved`). Test: cả 16 ô status×phase; “chỉ authenticated+idle có email”; “redirect chỉ anonymous+idle”; compose với `createCustomerSessionController` + `createCustomerIdentityCoordinator` **thật** (promise trì hoãn): lần đọc đầu, refresh A→(loading)→B với đọc cũ trả muộn không cấp lại A, đọc thất bại = `unresolved` (không redirect), logout guarded `pending`→redirect khi `401` xác minh, logout mà `me` lỗi giữ `unresolved` rồi re-check, logout bị guard chặn không đổi gì và không đọc `me` thêm; entry và trang thống nhất |
| `src/lib/customerAuthUi.ts` + `.test.ts` (44 → 45 test) | Chỉ `describeAuthEntry`: `/account` khi `authenticated` + email + `idle`; `/login` cho anonymous/unknown/loading/mọi pending (snapshot cũ khi pending cũng `/login`); thêm hằng `ACCOUNT_PAGE`. Test cũ “luôn `/login`” đổi đúng yêu cầu mới; không đổi presentation/owner/validation |
| `src/app/(account-pages)/account/page.tsx`, `AccountSessionPanel.tsx` (mới) | Server page có metadata “Tài khoản — The BHA”; panel client dùng provider gốc, **không** server-fetch, **không** `GET me` riêng, **không** `refreshSession` khi mount; view suy ra lại ở mỗi render (không giữ bản sao email); `router.replace("/login")` trong effect theo `view.kind`. Chỉ `ready` hiện email + câu “Hiện chỉ xem email tài khoản; chỉnh sửa hồ sơ và lịch sử đặt phòng chưa được hỗ trợ.” + “Về trang chủ”; `CustomerSessionNotice` (role/aria-live của CP02) cho checking/busy/unresolved; không nút đăng xuất thứ hai, không avatar/tên/ID nội bộ |
| `(account-pages)/layout.tsx` (không đổi), `(components)/Nav.tsx` | Giữ shell/spacing; Nav chỉ còn mục “Tài khoản” (bỏ bốn tab) |
| `account-password|billing|savelists/page.tsx`, `(components)/AccountUnavailable.tsx` (mới, server) | Thay toàn bộ form/payout/DEMO_* bằng “Chức năng này chưa được hỗ trợ” + tên chức năng + link “Về trang tài khoản” (`/account`) và “Về trang chủ”; không đọc `me`, không API, không tuyên bố 404/“sắp ra mắt” |
| `(Header)/AvatarDropdown.tsx` | Mục “Tài khoản” → `/account` cho Customer đã xác minh (`email` + `idle`), cạnh Dark theme; anonymous giữ “Đăng nhập”/“Tạo tài khoản”. **Sửa regression do redirect mới:** `<Popover key={pathname}>` để menu đóng khi route đổi (xem “Phát hiện”); owner logout nằm ngoài Popover nên không đổi |
| `components/FooterNav.tsx` | Mục auth dùng `authEntry.href` cho cả `href` lẫn `isActive` (đổi helper thôi chưa đủ vì link tĩnh) |
| `app/login/LoginForm.tsx`, `app/signup/SignupForm.tsx` | Panel đã đăng nhập: “Xem tài khoản”/“Đến trang tài khoản” → `/account`; copy “Hiện chỉ xem được email tài khoản; chỉnh sửa hồ sơ và lịch sử đặt phòng chưa được hỗ trợ.” Không đổi lifecycle, outcome hay form |
| `TemplateDemoNotice.tsx` | Đăng ký/đăng nhập/đăng xuất và trang xem email là thật; chưa có thanh toán, chỉnh sửa hồ sơ, lịch sử |
| Docs | Report này; cập nhật hẹp contract, `SNAPSHOT.md`, `PROJECT_BIBLE.md` (CP03+C1 merged, CP04 Draft) |

**Giới hạn UX chủ đích (follow-up):** `/account` khi ẩn danh → `/login` → đăng nhập xong về `/` (không `returnTo`/query); người dùng vào lại `/account` bằng mục “Tài khoản”.

## RED/GREEN

`customerAccountUi` là seam mới nên không có “RED trên baseline” theo nghĩa hồi quy; test được viết cùng seam và bắt được một khác biệt thật ngay lần chạy đầu: bài “entry và trang thống nhất” **fail** khi `describeAuthEntry` còn trả `/account` cho `authenticated` + phase pending (trang nói `pending`) → sửa entry chỉ trả `/account` khi `idle`, thêm test riêng. Kết quả sau sửa: 71/71 (`customerAccountUi` + `customerAuthUi`).

## Checks (Front_End/Customer_Web, trên cây bàn giao; CI FINAL_HEAD ở PR body)

Toolchain: Node `v22.23.2`, npm `10.9.8`.

| Lệnh | Kết quả |
|---|---|
| `npm ci` | thành công (lockfile không đổi) |
| `npx vitest run src/lib/customerAccountUi.test.ts src/lib/customerAuthUi.test.ts` | 2 files, 71 passed |
| `npm run lint` | No ESLint warnings or errors |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm test` | 38 files, 922 passed (baseline 37 / 895 + 27 mới) |
| `npm run build` | Compiled successfully |
| `git diff --check`, allowlist, secret/PII scan | sạch (chỉ email synthetic `@example.test` trong test; không mật khẩu/token trong repo; không đụng Admin/backend/lockfile/config) |

## Browser (build Customer của commit `ac5eae4`; commit sau đó chỉ docs — `git diff ac5eae4 HEAD -- Front_End/Customer_Web` rỗng)

- **Trình duyệt:** Google Chrome `153.0.8010.52` qua CDP thô (Node + WebSocket, mỗi lệnh timeout 20 s); **không** cài Playwright, không dependency nào thêm vào repo. Desktop 1440×900 và mobile 390×844 cảm ứng.
- **TLS:** mkcert `v1.4.4` (`~/.cache/mkcert`, CA `~/.local/share/mkcert/rootCA.pem`, không đọc/in khoá CA); cert task `localhost/127.0.0.1/::1` tạo trong thư mục harness và `openssl verify -CAfile` = OK; Chrome báo `securityState: secure`, `TLS 1.3` cho tài liệu `https://localhost:3401`; Node (proxy/harness) dùng `NODE_EXTRA_CA_CERTS`; **không** `--ignore-certificate-errors`/`--disable-web-security`/`NODE_TLS_REJECT_UNAUTHORIZED=0`/`rejectUnauthorized:false`.
- **Backend/DB:** PostgreSQL `18.3 (Debian 18.3-1.pgdg13+1)` trong container task (`cust-cp04-pg18-<pid>`, id `48502cd1b387`), DB `cust_cp04_demo` (`current_database()` và `server_version` đã kiểm), mật khẩu ngẫu nhiên trong env file mode 0600, không volume; `deploy/showcase/migrations/idempotent.sql` áp vào DB đó (9 migration = 9 file trong `Migrations`, cuối `20261001141847_AddStaffIdentityFoundation`); `git diff 1278507 -- Back_End deploy` rỗng nên publish `Release` dùng đúng source baseline; seed Riverside từ `2026-10-14`, 60 ngày (`--dry-run` 262 dòng, rồi `--apply`); API chạy **Production** (`DataProtection__KeysPath` task, PFX task, loopback HTTPS, không LocalGate); `/health/ready` 200, catalog đọc được. Rate limit login/register nâng lên 500 bằng env task (số lần đăng nhập/đăng ký trong ma trận vượt mặc định 10/5 mỗi phút); không đổi repo.
- **Runtime:** Chrome → TLS front `:3401` → `next start` `127.0.0.1:3400` (`NEXT_PUBLIC_API_BASE_URL=https://localhost:7546`, `API_PROXY_ORIGIN` rỗng); API qua fault proxy ngoài repo `:7546` → API `:7545` (upstream TLS verify bật; mặc định pass-through, giữ CORS/Set-Cookie/body/status; `Connection: close`). Mọi thao tác bằng UI thật; không probe/instrumentation sản phẩm. Tài khoản A/B/“email dài” tạo bằng `register` của API **chỉ để dựng dữ liệu**; tài khoản của kịch bản đăng ký/đăng nhập (T8) do UI tạo.

| # | Kịch bản | Kết quả (desktop + mobile) |
|---|---|---|
| T1 | `/account` ẩn danh | SSR không có Eden/profile/email/form/input trong shell; tải trực tiếp: `GET me` thật **401** (đúng một request) → client redirect `/login`, **0** POST auth, không vòng lặp; DOM không còn “Eden/Account infomation” |
| T2 | `me` chậm | Ẩn danh: 3.5 s đầu ở `/account` với notice “Đang kiểm tra phiên đăng nhập…” (`role=status`, `aria-live=polite`), không email, không redirect, không “Đang chuyển”; rồi `401` → `/login`. Đã đăng nhập A: checking không email; rồi `200` → đúng email A. Không thêm timeout sản phẩm |
| T3 | Unknown với cookie A thật | `me` 503 **mô phỏng** (proxy), cookie A có thật: ở lại `/account`, “Chưa kiểm tra được phiên đăng nhập” + **một** nút “Kiểm tra lại”, không email A, không “Bạn chưa đăng nhập”, không redirect. Bỏ rule, bấm: chỉ `GET me 200` → email A, **0** POST auth |
| T4 | Entry đã đăng nhập | Menu header: “Tài khoản” → `/account` + email + “Đăng xuất”; bấm: `/account` đúng email A, **0 `GET me` thêm** khi điều hướng client-side, 0 mutation; reload `/account` vẫn A (1 `GET me`). Desktop: Header 1/2/3 (`MainNav1`/`MainNav2`/`Header3`) đều có mục → `/account`, và cả ba ở 390 px (mục `md:hidden`). Mobile: app bar “Tài khoản” → `/account` và bấm mở được; **trang phòng mobile**: app bar ẩn, menu header vẫn có “Tài khoản” → `/account`. `/login` panel: “Xem tài khoản” → `/account` + copy mới; `/signup` panel: “Đến trang tài khoản” → `/account`, không form |
| T5 | Chỉ đọc | `/account` không `input/textarea/select/file/form/submit`, không “Update info/Eden/Phone/Birthday/Address/Avatar/Password/Billing/payout”; Nav chỉ “Tài khoản”; không nút “Đăng xuất” thứ hai. Ba route chưa hỗ trợ, **cả ẩn danh lẫn đã đăng nhập** (6 lần): ở đúng route, “Chức năng này chưa được hỗ trợ”, link `/account` và `/`, không form/demo/Airbnb/payout/DEMO_*/“sắp ra mắt”/404, **0** mutation |
| T6 | Logout pending/recovery | Logout từ header ở `/account` với transport trễ 4 s (API thật thực thi): suốt thời gian đó ở lại `/account`, **email A biến mất**, notice busy, không redirect sớm; xong: `me` thật 401 → `/login`, đúng **một** `POST logout 204`. Logout thật (204) nhưng `me` 503 (**mô phỏng**): ở lại `/account`, notice chưa kiểm tra được, một “Kiểm tra lại”, không email, không redirect; bấm với `me` khôi phục: chỉ `GET me 401` → `/login`, **không** gửi lại auth |
| T7 | Guard booking | A đăng nhập, **hold thật** qua UI → vào `/account` (client-side, 0 request): đọc được email A; Đăng xuất từ `/account` ⇒ chặn (“đặt phòng chưa hoàn tất”), **0** request auth, vẫn ở `/account` với email; quay lại receipt: **cùng hold id**; xác nhận vẫn chạy (+1 reservation). Receipt còn mở: Đăng xuất từ `/account` ⇒ chặn (“Biên nhận… vẫn đang mở”), 0 auth, receipt không bị tự đóng; “Đóng biên nhận” (CP02) → `/`, 0 HTTP |
| T7b | A→B | Đăng xuất A từ `/account` (1 POST, `me` 401, về `/login`), đăng nhập B bằng UI, `/account` chỉ B; header/trang không còn A; reload vẫn chỉ B |
| T8 | Hồi quy | Đăng ký bằng UI (1×`register 201`, +1 tài khoản, “Bạn chưa đăng nhập”) → đăng nhập → `/account` đúng email → đăng xuất → `/login`, không tài khoản thứ hai. Khách: quote→hold→confirm→receipt: mỗi run +1 hold, +1 reservation, không trùng; đã xác nhận ≠ đã thanh toán |
| T9 | Layout/a11y | Email 195 ký tự: `/account` và menu mở không tràn ngang ở cả hai viewport; Esc đóng menu; focus link “Tài khoản” + Enter mở `/account`; không lỗi/exception console (503 mô phỏng loại trừ); không mật khẩu trong URL/storage/console/URL mạng |

Số kiểm tra tự động trong harness trên build cuối `ac5eae4`: tài khoản (T1–T6, T9) **41 + 38**, booking/guard/A→B/hồi quy (T7–T8) **20 + 20** — tất cả PASS. DB cả phiên: 53 tài khoản synthetic (đã gồm tài khoản dựng bằng API và các lần chạy bị dừng), 53 `NormalizedEmail` khác nhau, 9 hold, 9 reservation, **0** hold nguồn có hơn một reservation. Các con số tuyệt đối gồm cả artifact của các lần chạy harness bị dừng; mọi kiểm tra đếm của kịch bản dùng **delta** theo từng run.

### Phát hiện trong lúc chạy

1. **Regression do CP04 (đã sửa):** sau Đăng xuất từ menu ở `/account` (redirect sang `/login`), popover menu **vẫn mở** và trên mobile phủ ô email — chạm đầu tiên rơi vào mục “Tạo tài khoản” của menu (xác minh bằng `elementFromPoint`: `P:Tạo tài khoản`, `inPanel: true`). Sửa tối thiểu: `<Popover key={pathname}>` đóng panel khi route đổi; owner logout nằm ngoài Popover nên thông báo/kết quả không bị ảnh hưởng. Toàn bộ ma trận chạy lại trên build có sửa.
2. **Lỗi harness (không phải sản phẩm):** (a) sau khi build lại, server `next start` cũ vẫn giữ cổng 3400 (`EADDRINUSE`) và phục vụ chunk không khớp ⇒ nhiều fail giả; đã dừng đúng PID của server task và chạy lại; (b) vài assert sai (xoá log trước khi đếm; regex “Eden” khớp “precedence”; quét cả footer template); (c) kịch bản booking mobile cạn phòng ở các ngày lặp lại và một ngày ngoài cửa sổ seed ⇒ dùng ngày tháng 12 trong cửa sổ seed. Đã sửa script, không đổi app.

## Actual vs simulated

- **Thật:** UI, Chrome, TLS, API baseline (Production), PostgreSQL 18.3, `me` 200/401, cookie `.TheBha.Customer`, đăng ký/đăng nhập/đăng xuất, hold/reservation, mọi tài khoản.
- **Mô phỏng (đã ghi rõ ở bảng):** `me` 503 do proxy trả thẳng (T3, T6), và độ trễ (`delay-after` cho `me` và logout — API vẫn thực thi thật). Không có response giả nào được dùng làm bằng chứng tài khoản/phiên.
- **Không quan sát (`NOT_RUN`):** Safari/WebKit, dark mode bằng mắt, trình đọc màn hình, multi-tab; hành vi nút Back sau redirect `/account`→`/login` chỉ kiểm “không vòng lặp” (số `GET me` và đường dẫn), không đo riêng lịch sử.

## Rủi ro / còn mở

- **Redirect không `returnTo`:** `/account` → `/login` → đăng nhập → `/` (chủ đích). Follow-up UX cho checkpoint sau.
- `FooterNav` vẫn có mục “Wishlists” → `/account-savelists`; nay gặp thông báo “chưa được hỗ trợ” (đúng sự thật), nhưng item vẫn là template — thuộc dọn template (CP08).
- `data/navigation.ts` “Account page” (menu Templates) trỏ `/account`; không đổi.
- Menu header đóng khi route đổi áp dụng cho **mọi** điều hướng có đổi pathname (kể cả Back khi menu đang mở); chỉ kiểm bằng luồng Đăng xuất từ `/account`.
- **Giữ mở, không giải quyết/che trong CP04:** H01 (cookie `.TheBha.Customer` hỏng), H03 (replay hold thiếu token khách), `me` không timeout (`/account` kẹt ở “đang kiểm tra” nếu `me` đầu không bao giờ trả lời), `FooterNav` trùng ở `Footer.tsx`, bfcache với mật khẩu đã gõ nhưng chưa gửi / multi-tab / Safari chưa kiểm, lịch sử đặt phòng/ownership API/quyết định phát hành, mọi mục `OPEN` của `DP-01`…`DP-11`.
- Backend CD/deploy: `NOT_RUN`; không workflow dispatch; image workflow backend không chạy vì diff chỉ frontend/docs.

## Handoff

Đã dừng ghi. Review do Owner gọi (`/codex:review --base origin/develop`); FINAL_HEAD, PR, CI: xem terminal handoff và PR body. Dọn dẹp (chỉ tài nguyên task, theo PID): container `cust-cp04-pg18-<pid>` (id `48502cd1b387`), tiến trình API/proxy/TLS/web (cả cây `npm`/`next`), Chrome headless, thư mục harness `/tmp/cp04-harness.*` (cert, khoá, env, DB keys — đã xoá) và các worker `jest-worker` mồ côi của `next build` do task tạo; cổng `55432/7545/7546/7547/3400/3401` đã trống.
