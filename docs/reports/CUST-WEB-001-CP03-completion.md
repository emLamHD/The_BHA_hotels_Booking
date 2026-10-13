# CUST-WEB-001-CP03 — UI đăng ký Customer trên template Chisfis

- **Work item / phase:** `CUST-WEB-001-CP03` / `CUSTOMER_SIGNUP_UI`. Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`. Model: Sonnet 5.5. Skills: không dùng `diagnosing-bugs` (không có lỗi sản phẩm chưa rõ nguyên nhân) và không dùng Graphify (`ALLOWED_IF_RELEVANT`, đọc source đủ).
- **Branch:** `feature/cust-web-001-cp03-customer-signup-ui` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `cdf41cf74dc1b6a1d870b073109603dcb9448dea` (merge PR #110; `origin/develop` = baseline lúc preflight, 0 PR mở, nhánh CP03 chưa tồn tại). Merge CI run `38397014120`: `completed/success` trên đúng baseline, Frontend/Backend/Admin đều `success` (đối chiếu lại trước khi implement).
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions/numstat và CI của FINAL_HEAD:** ghi ở PR body và terminal handoff, không ghi ở file này.
- **Owner:** kích hoạt **lõi** đăng ký (CP03). Không duyệt toàn bộ DP-05 hay `DP-01`…`DP-11` (vẫn `OPEN`); Owner đã bỏ hướng chuyển JWT — vẫn là cookie ASP.NET Core Identity. `/account`, lịch sử, quên mật khẩu, social login, email xác nhận, thanh toán **không** nằm trong CP03.
- **Chính sách PR (Owner 2026-10-13):** không có giới hạn/mục tiêu số dòng; report chỉ ghi số GitHub và `numstat`.

```
IMPLEMENTATION_CP03: PASS
CUSTOMER_SIGNUP_UI: IMPLEMENTED
REGISTER_CREATES_SESSION: NO
CUSTOMER_LOGIN_LOGOUT_UI: IMPLEMENTED_CP02
BOOKING_IDENTITY_GUARD: PRESERVED
SIGNUP_CORE_UI: OWNER_ACTIVATED_CP03
CUSTOMER_ACCOUNT_SELF_SERVICE: NOT_IMPLEMENTED — CP04_PLUS
REMAINING_PRODUCT_DECISIONS: OPEN
CUSTOMER_WEBSITE: NOT_COMPLETE
REVIEW_CP03: NOT_RUN — OWNER_ONLY
CP04_PLUS: NOT_STARTED
BACKEND_CD / LIVE_DEPLOY: OUT_OF_SCOPE / NOT_RUN
```

## Nguồn sự thật tại baseline (đọc trực tiếp)

`POST /api/v1/auth/register`: `AllowAnonymous`, `IgnoreAntiforgeryToken`, rate policy `auth-register` (mặc định 5/60 s), tạo `CustomerAccount` với `Email.Trim()` (giữ nguyên chữ hoa/thường người dùng gõ; trùng được xác định theo `NormalizedEmail`), trả `201` **không** đăng nhập, `409` khi trùng email/username, `400` khi sai model hoặc không đạt policy mật khẩu. `RegisterCustomerRequest`: chỉ email/password, `Required`; email `EmailAddress` ≤ 256; password ≤ 128. Identity: `RequiredLength = 12` và bắt buộc chữ số/chữ thường/chữ hoa/ký tự không phải chữ-số. Backend không đổi trong CP03 (`git diff cdf41cf -- Back_End` rỗng).

## Thiết kế (chỉ trong allowlist; path Customer tính từ `Front_End/Customer_Web`)

| File | Nội dung |
|---|---|
| `src/lib/customerSignupUi.ts` (mới) + `.test.ts` (57 test) | Seam React-free mà UI import trực tiếp. `validateSignupInput`: email trim; mật khẩu và nhập lại **nguyên văn** (không trim/normalise/cắt), chặn rỗng/email sai/email > 256/mật khẩu < 12 hoặc > 128 (độ dài UTF-16, như .NET)/nhập lại không khớp; **không** tự đặt regex cho chữ hoa/thường/số/ký tự đặc biệt (server quyết, 400 được xử lý) — chỉ hiển thị yêu cầu. `signupOutcomeOf`: `400`→`invalid`, `409`→`exists`, `429`→`rate-limited`, mọi thứ khác (mạng, 408, 5xx, status lạ, 2xx sai hình) → `uncertain`. `presentSignupOutcome`: câu chữ cố định, không echo server/credential, không đếm ngược, không nói `uncertain` là đã/chưa tạo, thông báo thành công không nói “chưa đăng nhập” nếu provider đang báo đã đăng nhập. `createSignupOwner(register)`: chiếm đồng bộ trước `await` (hai event cùng tick = một request), một owner = một attempt, không giao kết quả sau `dispose`; **không abort** (abort không chứng minh server chưa tạo tài khoản) |
| `src/app/signup/page.tsx`, `SignupForm.tsx` (mới) | `/signup` thật: label/id/name, `autoComplete=username/new-password/new-password`, `noValidate method="post"`, lỗi có `role=alert` + `aria-invalid` + `aria-describedby`, focus ô sai đầu tiên, gợi ý yêu cầu mật khẩu gắn `aria-describedby`. Input **không điều khiển**: mật khẩu không vào state/URL/storage/log, xoá khi attempt kết thúc; email dài **không** bị `maxLength` cắt (thông báo thay vì cắt âm thầm). Server render và lần render đầu **không có form** (`loading`) nên Enter trước hydrate không thể GET credential lên URL. Anonymous/unknown thường: form; authenticated: email từ `me` + link tới panel `/login`, không form; identity `transport/recovering/recovery-unresolved`: notice của provider (nút “Kiểm tra lại” chỉ `GET me`), submit disabled và `onSubmit` thoát sớm. Thành công: panel “Tạo tài khoản thành công. Bạn chưa đăng nhập.” + CTA “Đăng nhập” → `/login` (không query/cookie/storage). Bỏ social, “OR”, forgot-password và mọi checkbox/Terms |
| `src/app/login/LoginForm.tsx` | Chỉ câu cuối: “Chưa có tài khoản? Tạo tài khoản” → `/signup` thay cho “chưa có trong bản demo”. Không đổi lifecycle login |
| `(Header)/AvatarDropdown.tsx` | Chỉ thêm mục “Tạo tài khoản” (→ `/signup`) cạnh “Đăng nhập” khi ẩn danh/idle; dùng chung ở cả ba header. Không đụng logout/menu |
| `TemplateDemoNotice.tsx` | Đăng ký/đăng nhập/đăng xuất là thật; chưa có thanh toán trực tuyến hay quản lý tài khoản |
| Docs | Report này; cập nhật hẹp contract, `SNAPSHOT.md`, `PROJECT_BIBLE.md` (CP02 merged PR #110, CP03 Draft) |

**`register` không phải đổi danh tính:** không qua `guardedLogin`/identity coordinator, không đọc `me`, không login, không CSRF, không invalidate cache, không reset draft/hold/contact/receipt, không khoá booking. UI không import transport nào khác ngoài `registerCustomer` (qua owner); phiên chỉ lấy từ provider.

## Acceptance

| | Kết quả |
|---|---|
| Form + validation + a11y + không lưu mật khẩu | Đạt (seam test + live: 0 POST khi sai, focus đúng, URL/storage/cookie/console/network URL không có mật khẩu) |
| Một submit = một `registerCustomer`; owner theo mount; không giao muộn | Đạt (test owner + live: ba `requestSubmit()` cùng tick = 1 POST; rời trang trước khi trả lời ⇒ không message/redirect muộn) |
| 201 hợp lệ = “tạo, chưa đăng nhập”; không session | Đạt (không cookie `.TheBha.Customer`, `GET me` thật vẫn 401, header không authenticated) |
| 400/409/429 an toàn; lost/malformed = uncertain; không tự gửi lại | Đạt |
| Session/recovery theo provider; booking guard giữ nguyên | Đạt (xem Live) |
| Allowlist, test/lint/tsc/build/live/CI/report | Xem “Checks”; CI FINAL_HEAD ở PR body |

## Checks (Front_End/Customer_Web, trên cây bàn giao; CI FINAL_HEAD ở PR body)

Toolchain: Node `v22.23.2`, npm `10.9.8`.

| Lệnh | Kết quả |
|---|---|
| `npm ci` | exit 0 (lockfile không đổi) |
| `npx vitest run src/lib/customerSignupUi.test.ts` | 57 passed |
| `npm run lint` | No ESLint warnings or errors |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm test` | 37 files, 888 passed (baseline 36 files / 831 + 57 mới) |
| `npm run build` | Compiled successfully (`/signup` 5.97 kB, `/login` 4.97 kB, `/paydone` 9.9 kB) |
| `git diff --check`, allowlist, secret/PII scan | sạch (chỉ email synthetic `@example.test` trong test; không mật khẩu/token trong repo) |

Test seam chỉ gọi đúng hàm UI import; có một nhóm chạy owner với `registerCustomer` thật (mock tầng HTTP) để chứng minh: đúng một `POST /api/v1/auth/register` với body nguyên văn, không `GET`, không CSRF/invalidate/login, `201`+identity ⇒ `created`; `200`, `201` không body, id/email rỗng ⇒ `uncertain`. Không chạy mutation sweep.

## Live (Customer build của commit `f94d20d`, cây sạch; TLS tin cậy (mkcert) bật; API = backend của baseline; PostgreSQL `18.3 (Debian 18.3-1.pgdg13+1)` task-owned, seed Riverside `262 rows`; Chrome headless qua CDP: desktop 1440×900 và mobile 390×844 cảm ứng)

Không dùng probe/instrumentation sản phẩm: mọi thao tác qua form, menu, link, dialog thật. Số request đếm ở một **fault proxy ngoài repo** (pass-through mặc định, chỉ log method/path/status, `Connection: close`) giữa trình duyệt và API thật. Tài khoản đăng ký trong kịch bản đều do **UI** tạo; chỉ hai tài khoản “đăng nhập cho kịch bản session” được tạo thẳng bằng API để dựng dữ liệu (không tính cho UI đăng ký). Cookie kiểm theo tên `.TheBha.Customer`; đếm tài khoản theo mốc trước/sau và email synthetic trong `AspNetUsers` (không dump hash/token/PII).

| # | Kịch bản | Kết quả (desktop + mobile) |
|---|---|---|
| 1 | Vào từ menu/login | Link “Tạo tài khoản” ở menu ẩn danh và `/login` → `/signup` client-side; `GET me 401`, **0** POST auth; Esc đóng menu; Tab email→mật khẩu→nhập lại; không tràn ngang; SSR `/signup` không có `<form>`/`type="password"`; không social/forgot/Terms/checkbox |
| 2 | Validation | Rỗng/email sai/11 ký tự/nhập lại sai/mật khẩu 134 ký tự (không bị cắt, có thông báo)/email 267 ký tự (không bị cắt): focus ô đầu sai, `aria-invalid` + `aria-describedby`, **0 POST**, không đổi DB; URL/storage/cookie/console sạch |
| 3 | Thành công | Email nhập hoa + khoảng trắng: **một** `POST register 201`, `AspNetUsers` +1, đúng một `NormalizedEmail`; không cookie `.TheBha.Customer`; `GET me` thật sau đó **401**; header vẫn “Đăng nhập”; panel “Tạo tài khoản thành công. Bạn chưa đăng nhập.” + CTA → `/login` (form trống, không điền sẵn). Đăng nhập lại bằng UI (gõ lại mật khẩu): guarded login `POST 200` + `me 200`, header email thật, không tạo tài khoản thứ hai; đăng xuất UI ⇒ `me 401`. (Email hiển thị đúng như đã đăng ký — backend giữ nguyên chữ hoa/thường) |
| 4 | 409 / 400 | **409 thật** khi email đã có: một POST, câu chữ an toàn + link login, không success, DB không đổi. **400 thật** với mật khẩu 12 chữ thường (qua client, server từ chối): nêu yêu cầu mật khẩu, không echo server, không tạo tài khoản. Không tự gửi lại (vẫn 1 POST sau 2.5 s) |
| 5 | **429 thật** | API khởi động lại với `Authentication:RateLimiting:RegisterPermitLimit=3` (khởi động riêng cho từng viewport rồi **trả về 500**; kiểm tra biến môi trường sau khi khôi phục): 3×400 rồi attempt thứ 4 = **429**; câu chữ “đợi một lúc”, không số/đếm ngược, không success, **không tự retry**, không tài khoản mới |
| 6 | Mất sau commit / malformed | Socket đóng **sau khi API đã commit** (drop-after): DB **+1** (thật), đúng 1 POST, UI “Chưa xác nhận được tài khoản đã được tạo hay chưa”, không “thành công”. Chủ động đăng ký lại ⇒ **409 thật** ⇒ vẫn không success/ownership; chủ động đăng nhập bằng đúng credential ⇒ vào được. API thật + 502 mô phỏng gửi cho trình duyệt (DB +1): uncertain. **Mô phỏng**: `201` không body (API không nhận request, không tài khoản) và `503` trước API ⇒ uncertain, 1 POST |
| 7 | Pending / double / unmount | Trả lời chậm 3 s: ba `requestSubmit()` cùng tick + Enter ×2 ⇒ **1 POST**, form read-only/disabled; xong: created, DB +1. Rời sang `/login` trước khi trả lời: không redirect, không message, không mật khẩu ở đâu; tài khoản **vẫn được tạo** (không abort — ghi nhận trung thực); `back` ⇒ `/signup` form mới, mật khẩu rỗng, không success cũ; console không lỗi |
| 8 | Hold/receipt trước register | Hold guest tạo bằng UI → menu → `/signup` → đăng ký ⇒ chỉ có `POST register 201` (không booking/auth khác); quay lại receipt: **cùng hold id**, cùng liên hệ, không request; login bằng UI bị guard chặn (“đặt phòng chưa hoàn tất”), **0** request auth; **xác nhận vẫn chạy** (token khách còn nguyên). Receipt đã xác nhận: đăng ký lần hai không đổi mã đặt phòng; login bị chặn 0 request tới khi “Đóng biên nhận” (0 HTTP); sau đó đăng nhập bằng tài khoản vừa đăng ký chạy được, đăng xuất UI |
| 9 | Session/recovery | `me` 503: notice + “Kiểm tra lại”, form vẫn dùng được; bấm ⇒ chỉ `GET me`. Đã đăng nhập: không form, email thật, link `/login`, 0 POST. Login đang chạy (trễ 6 s): `/signup` hiện notice busy và nút disabled; ép submit ⇒ **0** register POST; xong ⇒ trang theo provider (đã đăng nhập). `me` 503 sau login (`recovery-unresolved`): notice, submit disabled, ép submit 0 POST; “Kiểm tra lại” ⇒ chỉ `GET me` (không register, không login lại), rồi phiên thật |
| 10 | Booking regression | Quote → hold → confirm → receipt bằng UI: mỗi run đúng +1 hold và +1 reservation; cả DB: 5 hold (1 hold mồ côi do script harness bị dừng giữa chừng lần đầu, ghi nhận), 4 reservation, **0** hold nguồn có hơn một reservation; receipt không claim đã thanh toán |

Tổng số kiểm tra tự động trong harness trên build cuối: signup 60+60, hold/receipt/booking 19+19, 429 4+4 — tất cả PASS; DB cuối 30 tài khoản synthetic, 0 `NormalizedEmail` trùng. Lần chạy đầu của script signup (build `455351e`) có ba assert sai do **script** (xoá log trước khi đếm, regex quét cả footer template, so email khác hoa/thường) — đã sửa script, không đổi app; một lỗi **sản phẩm** phát hiện ở live (ô email bị `maxLength` cắt âm thầm email dán > 256 ký tự) được sửa ở commit `f94d20d` (bỏ `maxLength`, báo lỗi thay vì cắt) rồi **toàn bộ** ma trận chạy lại trên build đó. Script và ảnh chụp nằm ngoài repo (QA nội bộ).

## Actual vs simulated

- **Thật:** UI, Chrome, TLS, API baseline, PostgreSQL 18.3, `201`/`400`/`409`, **429 do rate limiter thật**, cookie, `me`, mọi tài khoản/hold/reservation, thất lạc response **sau** commit thật (drop-after, fail-after).
- **Mô phỏng (đã ghi rõ ở bảng):** `201` không body và `503` do proxy trả thẳng (API không nhận request, không tài khoản nào được đếm); `me` 503; độ trễ. Không có response giả nào được dùng làm bằng chứng tài khoản/phiên — tài khoản lấy từ DB, phiên lấy từ `me` thật hoặc `me` mô phỏng nêu trên.
- **Không quan sát (`NOT_RUN`):** Safari/WebKit, dark mode bằng mắt, trình đọc màn hình, multi-tab.

## Rủi ro / còn mở

- **Không idempotent:** register không có idempotency key; sau `uncertain` người dùng tự chọn đăng nhập hoặc đăng ký lại, và `409` sau đó vẫn mơ hồ (có thể do attempt trước). UI không giải quyết được và không bịa — đúng như thiết kế.
- **Không abort khi rời trang:** request đã gửi có thể vẫn tạo tài khoản sau khi người dùng rời `/signup` (đã quan sát). Kết quả bị bỏ, không hiện ở trang khác.
- **Lộ tồn tại email:** backend trả 409 tường minh khi email đã có (enumeration); UI chỉ nói “không thể tạo tài khoản với email này”. Không sửa backend (ngoài scope).
- **Hiển thị email:** backend lưu và `me` trả email đúng chữ hoa/thường lúc đăng ký (trim). Có thể là quyết định sản phẩm sau này (ngoài scope).
- **Regex email phía client** (`^[^\s@]+@[^\s@]+$`) lặp lại với `customerAuthUi.ts` (file đó read-only trong CP03); chặt hơn `EmailAddressAttribute` (từ chối khoảng trắng bên trong), không bao giờ lỏng hơn.
- Template `Footer.tsx` vẫn render `FooterNav` lần hai; `me` không có timeout (`/signup` kẹt ở “đang kiểm tra” nếu `me` đầu không bao giờ trả lời); H01 (cookie `.TheBha.Customer` hỏng), H03 (replay hold thiếu token khách), `/account*` và lịch sử còn template — **không** sửa/che ở CP03.
- Một hold mồ côi trong DB dùng một lần (script harness lần đầu dừng giữa chừng); DB đã xoá cùng stack.
- Backend CD/deploy: `NOT_RUN`; không workflow dispatch; image workflow backend không chạy vì diff chỉ frontend/docs.

## Handoff

Đã dừng ghi. Review do Owner gọi (`/codex:review --base origin/develop`); FINAL_HEAD, PR, CI: xem terminal handoff và PR body. Dọn dẹp: container `cust-cp03-pg18`, tiến trình API/proxy/web/TLS (theo PID) và thư mục scratch Chrome — chỉ tài nguyên task tạo; cổng `55432/7545/7546/7547/3400/3401` đã trống.
