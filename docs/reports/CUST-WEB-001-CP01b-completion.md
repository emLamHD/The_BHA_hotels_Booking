# CUST-WEB-001-CP01b — Guard đổi danh tính Customer ↔ vòng đời booking

- **Work item / phase:** `CUST-WEB-001-CP01b` / `BOOKING_IDENTITY_CHANGE_GUARD`. Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`. Model: Sonnet 5.5. Skill: không dùng `diagnosing-bugs` (không có lỗi chưa rõ nguyên nhân); không dùng Graphify/GitNexus.
- **Branch:** `feature/cust-web-001-cp01b-booking-identity-guard` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `c81f06f68cb16b6a2e5e74976c20c0654789e353` (merge PR #108, CI run `38352160727` success trên đúng commit).
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions/numstat và CI của FINAL_HEAD:** ghi ở PR body và terminal handoff, không ghi ở file này.
- Hợp đồng gốc: `docs/design/CUST-WEB-001-product-contract.md` (vẫn `PROPOSAL`; `DP-01`…`DP-11` vẫn `OPEN`, CP01b không phụ thuộc chúng).
- **Quyết định Owner 2026-10-13 về kích thước PR:** bỏ mọi giới hạn và mục tiêu số dòng PR; mỗi PR vẫn một concern review được. Report này chỉ ghi số GitHub/`numstat` (ở PR body), không ước lượng logic và không xin ngoại lệ; số dòng không phải gate. Đã ghi vào contract §0 và SNAPSHOT; governance chưa đồng bộ (work item riêng).

```
IMPLEMENTATION_CP01b: PASS
BOOKING_IDENTITY_GUARD: IMPLEMENTED
AUTH_UI: NOT_IMPLEMENTED — CP02_PLUS
CUSTOMER_PRODUCT_DECISIONS: OPEN — UNCHANGED_BY_THIS_MEP
CUSTOMER_WEBSITE: NOT_COMPLETE
REVIEW_CP01b: NOT_RUN — OWNER_ONLY
CP02_PLUS: NOT_STARTED
BACKEND_CD / LIVE_DEPLOY: OUT_OF_SCOPE / NOT_RUN
```

## Thiết kế (chỉ trong allowlist; Customer path tính từ `Front_End/Customer_Web`)

| File | Nội dung |
|---|---|
| `src/lib/customerIdentityChange.ts` (mới) | Coordinator một-instance, không module state. Phase `idle → transport → recovering → (recovery-unresolved) → idle`. `login`/`logout` **claim khoá đồng bộ trước mọi await**: kiểm booking (qua guard đã bind) → xoá identity công khai và supersede mọi lần đọc `me` cũ → reset draft → mới gọi auth request. Giữ khoá xuyên auth request **và** lần đọc `me` kiểm chứng; chỉ `me` 200/401 của operation hiện hành mới nhả khoá, `me` lỗi ⇒ `recovery-unresolved` (vẫn khoá). `requestRefresh`: idle ⇒ đọc thường; đang auth/recovery ⇒ gộp, không đọc sớm, không supersede; sau recovery lỗi ⇒ chỉ đọc lại `me` (không gửi lại login/logout, không giữ mật khẩu). `bindBooking` trả hàm unbind theo **registration** nên cleanup trễ/trùng (StrictMode) không gỡ binding mới; chưa bind ⇒ fail closed. `deactivate` abort tín hiệu và loại bỏ mọi completion trễ |
| `src/lib/customerSession.ts` | Thêm `read()` (cùng lần đọc `refresh` nhưng resolve `authenticated/anonymous/unknown/superseded`) và `beginIdentityChange()` (abort đọc đang chạy, tăng read id, xoá identity). Hành vi cũ giữ nguyên |
| `src/app/CustomerSessionProvider.tsx` | Tạo controller + coordinator cho mỗi instance; context: `state`, `identityChange`, `refreshSession` (đi qua coordinator), `guardedLogin`, `guardedLogout`; context riêng cho booking (`isIdentityChangeLocked`, `bindBooking`) |
| `src/app/BookingHoldProvider.tsx` | Lấy binding từ cùng coordinator của root, truyền `isIdentityChangeLocked` cho controller, đăng ký `identityGuard` trong effect (cleanup chỉ gỡ đúng registration của mình); `identityGuard` **không** có trong API công khai của flow |
| `src/lib/api/bookingHoldFlowController.ts` | **Mirror đồng bộ `live`**: mọi dispatch áp cùng reducer thuần lên `live` trong cùng tick, nên quyết định không phụ thuộc React snapshot (và việc nhả `inFlight` trong `finally`). `identityGuard.identityChangeBlockReason()` / `scrubForIdentityChange()`; `finishBooking(expectedReservationId)`. Mọi lệnh mutation/draft (`submit`, `retryExact`, `confirmHold`, `retryConfirmationExact`, `selectOffer`, `updateContact`, search-reset) bị từ chối trước khi sinh key/validate/dispatch/network khi coordinator đang khoá |
| `src/lib/api/bookingHoldFlow.ts` | Hai action mới `identity-change-scrub` (chỉ idle/selected/known-error) và `booking-finished` (chỉ đúng receipt); `operationId` giữ monotonic |

Ma trận guard (đúng MEP §B): `idle/selected/known-error` ⇒ cho phép nếu không có booking in-flight/khoá; `submitting, uncertain, active-session, confirming, confirm-known-error, confirm-uncertain` ⇒ **blocked** (`booking-in-progress`, không auth POST/`me`/CSRF, booking không đổi); `reservation-result` ⇒ blocked (`receipt-not-finished`) tới `finishBooking` đúng receipt. Guarantee chỉ cho app commands trong cùng provider/tab: không chặn cookie hết hạn, gọi API trực tiếp, tab/thiết bị khác; không cross-tab mutex. `loginCustomer`/`logoutCustomer` vẫn là transport mức thấp cho test; UI về sau phải dùng `guardedLogin`/`guardedLogout`.

Không sửa: `authService`, `csrf.ts`, `httpClient`, `bookingHoldService`, UI/layout/header/paydone, backend, package/config. H01 (cookie hỏng) và H03 (replay mất token) vẫn là dependency riêng, không đụng.

## AC1–AC6

| AC | Kết luận | Evidence |
|---|---|---|
| AC1 phase khoá | Đạt | `customerIdentityChange.test.ts` (integration, controller thật + coordinator thật + stale harness): với từng phase `submitting, uncertain, active-session, confirming, confirm-uncertain, confirm-known-error, reservation-result` cả login và logout bị từ chối; 0 auth request, 0 đọc `me`, 0 invalidation CSRF, identity không bị xoá, 0 key/POST booking, hold/token/attempt không đổi. Live: xem “Live” |
| AC2 serialize | Đạt | `submit()` rồi login cùng tick ⇒ login refused, đúng 1 POST; login rồi `submit()/selectOffer/updateContact/retryExact` cùng tick ⇒ 0 POST, 0 key, draft đã reset; login+login / login+logout cùng tick ⇒ đúng 1 auth request. Guard thật được wire: test dựng đúng như provider (`isIdentityChangeLocked` + `bindBooking`), và có test “không binding ⇒ `booking-unbound`”. Test controller dùng harness **giữ `getState()` cũ tới `commit()`** (có assert snapshot còn cũ) cho: trước dispatch đầu, sau khi response đã settle nhưng chưa render (hold/confirm → vẫn khoá đúng), và finish |
| AC3 khoá xuyên recovery | Đạt | Unit + integration: khoá giữ qua auth request và lần đọc `me`; `me` lỗi ⇒ `recovery-unresolved` vẫn chặn booking; `requestRefresh` chỉ đọc lại và `me` 401 nhả khoá, login không bị lặp; refresh khi auth/recovery pending được gộp (không đọc sớm, không supersede); `me` cũ của A đến muộn khi đổi sang B không publish A; old settlement không mở khoá operation mới (deactivate → activate → operation mới) |
| AC4 scrub/finish | Đạt | Đổi danh tính ở idle/selected/known-error xoá offer/contact/attempt/lỗi ngay trong cùng tick (không còn PII); `finishBooking` đúng ID ⇒ scrub receipt/PII/session/token/attempt về idle, `operationId` giữ nguyên, 0 HTTP; sai ID, non-terminal, uncertain/active, đang khoá ⇒ từ chối không đổi gì; stale `submit` cùng tick sau finish không dùng lại dữ liệu cũ; A → finish → B không còn receipt/contact của A |
| AC5 lifecycle | Đạt | Hai instance độc lập; StrictMode `stop→start` + bind→unbind→bind; cleanup trễ của registration cũ không gỡ binding mới; `deactivate` không publish/không khởi động lại từ completion trễ; không auto POST/polling/redirect; register không đổi session; booking ẩn danh baseline không bị chặn bởi reader `loading` (test riêng); toàn bộ test idempotency/CSRF/booking cũ giữ nguyên |
| AC6 checks/CI | Checks đạt; CI ở handoff | Bảng dưới |

Kiểm đột biến (khôi phục sau mỗi lần): bỏ mirror `live` ⇒ 15 test fail; `submit` bỏ qua khoá identity ⇒ 2 fail; nhả khoá trước lần đọc `me` ⇒ 4 fail; refresh không gộp ⇒ 1 fail.

## Checks (từ `Front_End/Customer_Web`, Node v22.23.2 / npm 10.9.8)

| Lệnh | Kết quả |
|---|---|
| `npm ci` | OK |
| Vitest targeted (`customerSession`, `bookingHoldFlow`, `bookingHoldFlowController`, `customerIdentityChange`) | 196 passed |
| `npm run lint` | No ESLint warnings or errors |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm test` | 35 files, 760 passed |
| `npm run build` | Compiled successfully |
| `git diff --check`, allowlist, secret/PII scan, CI FINAL_HEAD | ở PR body/handoff |

## Live (Customer build + API từ `c81f06f` + PostgreSQL 18.3 `18.3 (Debian 18.3-1.pgdg13+1)` task-owned, HTTPS tin cậy, TLS verification bật; Chrome extension desktop + Chrome headless CDP 390×844 mobile; tài khoản A/B synthetic, không dữ liệu thật)

- **Đường đi của probe (không phải form/route/debug trong repo):** guard chưa có UI, nên dựng bản **có instrumentation trong thư mục scratch ngoài repo** (copy của working tree + một component ngoài repo gán `window.__probe = { session: useCustomerSession(), booking: useBookingHoldFlow() }`). Probe gọi đúng `guardedLogin`/`guardedLogout`/`finishBooking` của provider thật (coordinator thật → `authService` thật → API thật); **không** dùng `fetch` auth trực tiếp. Bản instrumented đã xoá; **bản cuối (cây repo, không instrumentation)** được build lại và kiểm: 0 chuỗi `__probe`/`ProbeInstrumentation` trong `.next`. Evidence instrumentation chỉ là evidence của guard foundation; evidence của UI/booking thường nằm ở bản cuối.
- **Idle:** `guardedLogin(A)` ⇒ OPTIONS + `POST login 200` + `GET me 200`, `session: authenticated`, email A; `guardedLogout` ⇒ `GET csrf` + `POST logout 204` + `GET me 401`, `anonymous`.
- **Active hold (UI thật tạo hold ẩn danh):** `guardedLogin(B)` và `guardedLogout` ⇒ `blocked: booking-in-progress`; **0 request `auth/*`** (kể cả csrf/me); `phase` vẫn `active-session`, `holdId` và token giữ nguyên; sau đó **xác nhận bằng UI vẫn thành công** (`confirm 201`).
- **Receipt:** login/logout ⇒ `blocked: receipt-not-finished`, receipt vẫn còn (không tự xoá); `finishBooking` với ID sai ⇒ `false`, đúng ID ⇒ `true` và **không có request nào tới API**; state về `idle`, không receipt/PII; rồi `guardedLogin(B)` ⇒ `POST login 200` + `GET me 200`, session B, booking không còn dữ liệu của A.
- **Draft:** chọn offer + điền contact (probe gọi API công khai của flow, như UI), rồi `guardedLogout` ⇒ settled `anonymous`, booking `idle`, `offer: null`, không còn email/contact của draft.
- **Bản cuối, đường thường:** root ẩn danh ⇒ `GET properties`, `GET auth/me 401`, `GET room-types` (+ availability), **không auth POST**; UI quote → hold → confirm → receipt thành công; DB: `InventoryHolds` = 2, `Reservations` = 2 (một từ lần chạy instrumented, một từ lần chạy cuối), đều guest-owned, `Confirmed`, `SourceHoldId` khớp, không bản trùng. Mobile 390×844 (touch): home/room/receipt `scrollWidth` = 390, `me 401`, 0 mutation tự động.
- **Mô phỏng vs thật:** pending/recovery của auth (request chậm, `me` lỗi rồi retry, refresh gộp, `me` cũ của A đến muộn) chứng minh bằng test xác định (promise trì hoãn) — **không** quan sát live (không thêm độ trễ vào API). Trạng thái React (booking/session) quan sát qua probe của bản instrumented; network/DB là bằng chứng thật độc lập.
- **Dọn:** container `cust-cp01b-pg18`, tiến trình API/`next start`/TLS front (theo PID đã ghi), jest-worker mồ côi, thư mục scratch instrumented và Chrome profile — chỉ tài nguyên task tạo.

## Rủi ro / NOT_RUN

- Chưa có UI dùng guarded commands; CP02 phải đi qua `guardedLogin`/`guardedLogout`, không import transport thô. Guard chỉ trong một tab/provider instance; hết hạn cookie, gọi API trực tiếp, tab/thiết bị khác không bị chặn.
- `recovery-unresolved` là trạng thái UI cần CP02 hiển thị (thử lại bằng `refreshSession`); hiện không có UI nên chưa quan sát bằng mắt.
- H01 (cookie `.TheBha.Customer` hỏng chặn booking) và H03 (replay hold mất token khách) vẫn mở, ngoài CP01b. Safari/WebKit, deploy: `NOT_RUN`. Backend không đổi.

## Correction `CUST-WEB-001-CP01b-C1` — phân loại transport outcome của auth 5xx

- **Finding (Codex P2, review trên `e921f0f`):** `transportOutcomeOf` coi mọi `ApiHttpError` là `refused`, kể cả 5xx — server có thể đã đổi session rồi mới lỗi, nên `refused` mâu thuẫn với session `me` xác minh. Review C0 (reviewed SHA `e921f0f`, CI run `38355004055` success) và toàn bộ evidence live C0 ở trên **giữ nguyên, không gán sang C1**.
- **Trước:** `error instanceof ApiHttpError ? "refused" : "lost"`. **Sau:** `refused` chỉ khi `ApiHttpError` có status trong allowlist tường minh `400/401/429` (400 validation/antiforgery, 401 xác thực, 429 rate limit — đúng `ProducesResponseType` của `AuthController` login/logout); mọi thứ khác (5xx, 408, status ngoài danh sách, `ApiNetworkError`, malformed success, config) là `lost`. 409 không thêm (chỉ của `register`, không phải đổi danh tính). `AuthTransportOutcome` giữ nguyên `succeeded | refused | lost`, không thêm API.
- **Không đổi:** `refused` là câu trả lời của server cho auth request, không phải bằng chứng session không đổi — `me` vẫn chạy cho cả `succeeded/refused/lost`; transport không bao giờ lấy ngược từ kết quả `me`; khoá chỉ nhả khi `me` 200/401; `me` lỗi ⇒ `recovery-unresolved` (vẫn khoá, refresh chỉ đọc lại `me`); không retry auth POST; `blocked` (guard ứng dụng, trước network) khác `refused`.
- **Test (`customerIdentityChange.test.ts`, qua public `login`/`logout` của coordinator, rig có sẵn):** bảng tham số cho cả login và logout — 400/401/429 ⇒ `refused`; 500/502/503/504, 408, 418, lỗi mạng ⇒ `lost`; 5xx + `me` authenticated ⇒ `lost` + `authenticated`, khoá còn tới khi `me` trả lời, đúng 1 auth request; 5xx + `me` anonymous; 5xx + `me` lỗi ⇒ `recovery-unresolved`/`lost`, giữ khoá, refresh chỉ đọc `me`, không resend. **RED trên `e921f0f`: 22 test fail** (các case 5xx/408/418 ở login và logout, `5xx + me`), các control 400/401/429/mạng pass; **GREEN** sau fix.
- **Checks (Front_End/Customer_Web):** `npm ci` OK; vitest `customerIdentityChange` + `customerSession` 91 passed; `npm run lint` sạch; `tsc --noEmit -p .` exit 0; `npm test` 35 files, 787 passed; `npm run build` OK. `git diff --check`, allowlist, secret/PII scan, CI FINAL_HEAD C1: ở PR body/handoff.
- **Runtime/browser C1:** `NOT_REQUIRED` (chỉ đổi phân loại outcome của foundation chưa có UI; test xác định + checks đầy đủ + CI là verification bắt buộc). Không dựng lại stack. `REVIEW_C1: NOT_RUN — OWNER_ONLY`.

## Handoff

Đã dừng ghi. Review do Owner gọi; FINAL_HEAD, PR, CI: xem terminal handoff và PR body.
