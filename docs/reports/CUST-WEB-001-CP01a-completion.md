# CUST-WEB-001-CP01a — Nền Customer session (client auth, provider chỉ đọc, CSRF generation)

- **Work item / phase:** `CUST-WEB-001-CP01a` / `CUSTOMER_SESSION_FOUNDATION`. Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`. Model: Sonnet 5.5. Skill: không dùng `diagnosing-bugs` (xem “Race CSRF” — RED/GREEN do test, không có lỗi chưa rõ nguyên nhân); không dùng Graphify/GitNexus.
- **Branch:** `feature/cust-web-001-cp01a-session-foundation` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `3be18c3384af9f10bea783f5efc0463b5181f48a` (merge PR #107, CP00).
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions và CI của FINAL_HEAD:** ghi ở PR body và terminal handoff, không ghi ở file này.
- Hợp đồng gốc: `docs/design/CUST-WEB-001-product-contract.md` (vẫn `PROPOSAL`; `DP-01`…`DP-11` vẫn `OPEN`, CP01a không phụ thuộc chúng).

```
IMPLEMENTATION_CP01a: PASS — kèm một check bắt buộc (`npx tsc --noEmit -p .`) FAIL giống hệt baseline, xem “Checks”
CUSTOMER_SESSION_READER: IMPLEMENTED
AUTH_UI: NOT_IMPLEMENTED — CP02_PLUS
BOOKING_IDENTITY_GUARD: NOT_IMPLEMENTED — CP01b
CUSTOMER_PRODUCT_DECISIONS: OPEN — UNCHANGED_BY_THIS_MEP
CUSTOMER_WEBSITE: NOT_COMPLETE
REVIEW_CP01a: NOT_RUN — OWNER_ONLY
CP01b_PLUS: NOT_STARTED
LIVE_DEPLOY: NOT_RUN
BACKEND_CD: OUT_OF_SCOPE
```

## Thay đổi (chỉ trong allowlist; Customer path tính từ `Front_End/Customer_Web`)

| File | Nội dung |
|---|---|
| `src/lib/api/authService.ts` (mới) | `getCustomerSession` (`GET /api/v1/auth/me`), `registerCustomer` (`POST …/register`, body chỉ `email`,`password`, `201`, **không** session), `loginCustomer` (`POST …/login`, `200`), `logoutCustomer` (`POST …/logout` qua `submitCsrfProtectedRequest`, `204`). Validate shape (`customerAccountId` GUID khác rỗng/khác Guid.Empty, `email` không rỗng) ⇒ sai thì `AuthContractError` (thông điệp chung, không chứa response/mật khẩu). Login/logout luôn `invalidateCsrfToken()` ở `finally`. Không retry, không trim mật khẩu, không storage |
| `src/lib/customerSession.ts` (mới) | Controller không React: `loading/anonymous/authenticated/unknown`; chỉ read mới nhất được publish; `start/stop/refresh` |
| `src/app/CustomerSessionProvider.tsx` (mới) | Adapter mỏng (`useSyncExternalStore`), `useCustomerSession` (`state`, `refreshSession`); không expose login/register/logout |
| `src/app/layout.tsx` | Chỉ bọc `CustomerSessionProvider` **ngoài** `BookingHoldProvider → StaySearchProvider` (phần còn lại chỉ thụt lề) |
| `src/lib/api/csrf.ts` | Generation: `invalidateCsrfToken()` bỏ cả token cache lẫn acquisition đang chờ; acquisition cũ không được cache hoặc xoá acquisition mới; caller chờ acquisition cũ lấy token generation hiện tại trước POST đầu tiên. Tên public, exact-refusal match, một retry, body/header/signal và `Idempotency-Key` giữ nguyên |
| tests mới/sửa | `authService.test.ts`, `customerSession.test.ts`, `csrf.test.ts` (thêm) |
| docs | contract (narrow), `PROJECT_BIBLE.md`, `SNAPSHOT.md`, report này |

Không sửa: backend, booking machine/provider/service, `httpClient`/`errors`/`env`, header/nav/account/auth UI, package/lock/config/workflow.

## AC1–AC6

| AC | Kết luận | Evidence |
|---|---|---|
| AC1 client | Đạt | `authService.test.ts` (38 test, mock `httpClient`, csrf thật): đúng path/method/body/`signal`; register không CSRF/login/me; password nguyên văn (có khoảng trắng); login/logout chỉ gửi 1 lần với 401/429/lỗi mạng; logout gửi `X-CSRF-TOKEN`, retry đúng một lần cho refusal chính xác; 401 không báo “đã xoá cookie”; payload sai không thành identity; status khác (`200` register, `204` login, `200` logout) bị từ chối. **Đây là test transport, không phải bằng chứng UI** |
| AC2 reader | Đạt | `customerSession.test.ts` (20 test, promise trì hoãn): 200⇒authenticated, 401⇒anonymous, 403/5xx/mạng/config/malformed⇒unknown (customer `null`), cancellation không publish; refresh xoá identity trước; **`me(A)` giữ lại, `refresh(B)`→401, A→200 ⇒ vẫn anonymous**; A fail muộn không đè B; refresh abort A; stop/unmount không publish và không unhandled rejection; StrictMode `start→stop→start`; hai instance độc lập |
| AC3 CSRF | Đạt | `csrf.test.ts`: 24 test (17 sẵn có giữ nguyên + 7 mới: sharing trong cùng generation, acquisition cũ / invalidate / request mới, resolve muộn, reject muộn, header hiện tại thắng, một retry, 0 retry mạng/HTTP thường). Xem “Race CSRF” |
| AC4 wiring | Đạt | Live: root thật gọi `me`, không POST tự động (mục Live); SSR markup ngoài `<script>` của `/`, `/paydone`, `/login`, `/listing-stay-detail` **giống hệt** baseline (chỉ khác một thẻ `<script>` chunk) |
| AC5 live | Đạt (phần bắt buộc) | Mục “Live” |
| AC6 allowlist/PR/CI | Allowlist đạt (xem diff); PR/CI ở handoff |

### Race CSRF — RED/GREEN
- Viết 4 test race trước (acquisition cũ đang chờ → invalidate → request mới / late resolve / late reject) và chạy trên `csrf.ts` **baseline**: **RED 4/4**, hai test đối chứng (cache bị bỏ sau invalidate; invalidate không tự gọi/resend) pass. Sau khi sửa: **GREEN 24/24**. Đây là tái hiện bằng test (acquisition cũ được dùng chung cho request sau invalidate; token cũ có thể bị cache), không chỉ đọc source.
- Kiểm đột biến (bỏ lần lượt: quyền sở hữu read mới nhất, invalidate sau login, kiểm generation khi cache): mỗi lần 2–3 test fail; đã khôi phục.

## Live (build bàn giao + API `3be18c3` + PostgreSQL 18.3, task-owned)

- **Stack:** container `cust-cp01a-pg18` (`postgres:18.3`, `18.3 (Debian 18.3-1.pgdg13+1)`, DB `thebha_cp01a_demo`, cổng 127.0.0.1:55432); migrate `dotnet ef database update`; seed `--seed-riverside-demo … --apply` trên DB disposable; API `dotnet …/TheBha.Api.dll --urls https://localhost:7545` (Development, CORS `https://localhost:3400`, cert mkcert tin cậy); Customer `next build` với `NEXT_PUBLIC_API_BASE_URL=https://localhost:7545` + `next start :3401` sau terminator TLS `https://localhost:3400` (script ngoài repo). Chrome (extension) desktop 1920×871; mobile = Chrome headless CDP 390×844, touch, `mobile:true` (extension không đổi được viewport). TLS verification bật; không dùng DB/booking/tài khoản thật. Tài khoản synthetic `cp01a-a-…@example.test`, `cp01a-b-…@example.test`, mật khẩu ngẫu nhiên đã dùng và bỏ (không commit).
- **Home / room / receipt (desktop + mobile):** mỗi lần tải trang: `GET /api/v1/properties`, `GET /api/v1/auth/me`, `GET …/room-types` (+ availability khi có query); **không POST nào do trang phát ra** (register/login/logout = 0). Ẩn danh: `me` → **401**. Mobile 390: `scrollWidth` 390 (không tràn ngang), `me` 401 ở cả 3 route.
- **Register ≠ session (API harness):** `register` → **201**, không `Set-Cookie`, `me` vẫn **401**; đăng ký lại 409; mật khẩu yếu 400; sai mật khẩu 401.
- **Login → reader thật (harness, không phải UI):** đăng nhập A bằng `fetch` trong trang (200), tải lại: `me` → **200** ở home, room, receipt. Sau `logout` (CSRF lấy khi đang đăng nhập) → **204**, `me` → **401**. Thiếu/sai CSRF → 400; logout ẩn danh → 401.
- **Token CSRF gắn danh tính (quan sát API thật):** token lấy khi ẩn danh bị **400 Invalid antiforgery token** ở `logout` sau khi đăng nhập; token mới lấy sau đăng nhập → 204. Token lấy khi đã đăng nhập bị **400** ở POST ẩn danh sau khi đăng xuất; token mới → `401 Invalid booking access credential` (qua được CSRF). Xác nhận giả thuyết CP00 (trước đó `UNVERIFIED`). Test helper tách riêng.
- **Hai tài khoản:** A và B đăng nhập ở hai cookie jar độc lập, `me` trả hai `customerAccountId`/email khác nhau. Thứ tự đọc muộn/lỗi (A/B) chứng minh bằng controller test xác định, **không** quan sát runtime (không thêm consumer debug).
- **Booking regression (UI thật, ẩn danh, build bàn giao):** room page với `?checkIn=2026-10-20&checkOut=2026-10-22` → quote 2 đêm ₫2.000.000 → “Hold this room” → form liên hệ synthetic → hold `POST /booking-holds` **201** → `/paydone` “Đã giữ chỗ” → “Xác nhận đặt phòng” → `POST …/confirm` **201**. DB: `InventoryHolds` = 1, `Reservations` = 1, hold `Confirmed`, **guest-owned** (`CustomerAccountId` null), `SourceHoldId` khớp; không hold/reservation thứ hai.
- **H01 (quan sát, không sửa):** cookie `.TheBha.Customer` giả ⇒ `POST /booking-holds` **401 “Invalid customer session”** và `POST /auth/logout` **401**, **không có `Set-Cookie`** xoá cookie. Cookie hết hạn thật chưa tái hiện. H03 chưa kiểm. Cả hai vẫn là blocker phát hành đã ghi ở contract.
- **Giả lập vs thật:** tất cả request trên là API/DB thật. Test vitest dùng mock httpClient/promise trì hoãn (nêu rõ ở từng dòng). Ghi chú công cụ: extension hiển thị `503` cho lần `logout` do harness trong trang gửi, trong khi `fetch` trong trang nhận `204` và `me` sau đó `401`; coi là nhãn của công cụ, không phải kết quả server.
- **Dọn:** chỉ tài nguyên task tạo: container `cust-cp01a-pg18`, tiến trình API/`next start`/TLS front, thư mục scratch (xem handoff). Không đụng `the-bha-postgres-1` hay tiến trình khác.

## Checks (từ `Front_End/Customer_Web`)

| Lệnh | Kết quả |
|---|---|
| `npm ci` | OK (theo lockfile) |
| `npx vitest run src/lib/api/__tests__/authService.test.ts src/lib/api/__tests__/csrf.test.ts` | 62 passed |
| `npx vitest run src/lib/customerSession.test.ts` | 20 passed |
| `npm run lint` | “No ESLint warnings or errors” |
| `npx tsc --noEmit -p .` | **FAIL exit 2**: 2 lỗi `TS2322` ở `src/lib/api/__tests__/apiProxyConfig.test.ts(76,19)` và `src/lib/routePolicy.test.ts(131,21)` — hai file **không đụng tới**; chạy cùng lệnh trên bản `git archive 3be18c3` cho đúng hai lỗi đó ⇒ **lỗi baseline có sẵn**, không có lỗi mới từ CP01a. Không sửa (ngoài scope); cần OC quyết định |
| `npm test` | 34 files, 637 passed |
| `npm run build` | Compiled successfully |
| Regression booking có sẵn | `bookingHoldService`/`bookingHoldFlowController`/`bookingHoldFlow` tests nằm trong 637 và pass |
| `git diff --check`, secret/PII scan, allowlist | ghi ở PR body/handoff |

## Kích thước (ước lượng)

Source CP01a: ~285 dòng logic (không tính comment/blank: `authService` 87, `customerSession` 81, provider 36, `csrf.ts` ~60 thêm/21 bỏ). Test: ~577 dòng (`customerSession.test` 205, `authService.test` 233, `csrf.test` +139 thô). **Tổng ~860 > mục tiêu ~400**: do ba module (client, controller, provider) là một concern không tách an toàn trong MEP này và các test race cần scaffold promise trì hoãn; `layout.tsx` chỉ thụt lề (markup). Đây là mục tiêu, không phải hard cap; số GitHub/`numstat` ở PR body.

## Rủi ro / NOT_RUN / blocker

- `tsc` baseline lỗi (trên) — OC quyết định có coi là blocker hay mở việc riêng; CI không chạy `tsc` riêng (chạy `next build`).
- Chưa có UI nào dùng `useCustomerSession`; `refreshSession` chưa có caller; khoá đổi danh tính chưa có (H04 mở, CP01b). Một lệnh `loginCustomer`/`logoutCustomer` gọi trực tiếp sẽ **không** bị chặn khi đang có hold: đừng nối vào UI trước CP01b.
- Safari/WebKit, Vercel/cloud, auth UI: `NOT_RUN`. Backend không đổi, không chạy lại bộ test backend (CI Backend ở handoff).
- Race giữa hai tab/đa thiết bị, cross-tab sync: ngoài phạm vi.

## Handoff

Đã dừng ghi. Review do Owner gọi; FINAL_HEAD, PR, CI: xem terminal handoff và PR body.
