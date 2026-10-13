# CUST-WEB-001-CP02 — UI đăng nhập/đăng xuất Customer trên template Chisfis

- **Work item / phase:** `CUST-WEB-001-CP02` / `CUSTOMER_LOGIN_LOGOUT_AND_IDENTITY_UI`. Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`. Model: Sonnet 5.5. Skills: không dùng `diagnosing-bugs` (không có lỗi chưa rõ nguyên nhân sản phẩm; một lần treo của harness CDP được ghi ở “Rủi ro”) và không dùng Graphify (`ALLOWED_IF_RELEVANT`, đọc source đủ).
- **Branch:** `feature/cust-web-001-cp02-customer-auth-ui` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `1964a7b4cebb4595eaab2c7aee5525a1e40fa2d8` (merge PR #109; `origin/develop` = baseline lúc preflight; 0 PR mở).
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions/numstat và CI của FINAL_HEAD:** ghi ở PR body và terminal handoff, không ghi ở file này.
- **Owner:** kích hoạt **lõi** đăng nhập/đăng xuất/header (CP02). Không duyệt toàn bộ DP-05 hay `DP-01`…`DP-11` (vẫn `OPEN`); đăng ký (CP03), `/account` chỉ đọc và lịch sử (CP04+), quên mật khẩu, social login **không** nằm trong CP02.
- **Quyết định Owner 2026-10-13 về kích thước PR:** bỏ giới hạn/mục tiêu số dòng; report chỉ ghi số GitHub/`numstat`.

```
IMPLEMENTATION_CP02: PASS
CUSTOMER_LOGIN_LOGOUT_UI: IMPLEMENTED
BOOKING_IDENTITY_GUARD_UI: WIRED
CUSTOMER_SIGNUP_UI: NOT_IMPLEMENTED — CP03
CUSTOMER_ACCOUNT_SELF_SERVICE: NOT_IMPLEMENTED — CP04_PLUS
AUTH_CORE_UI: OWNER_ACTIVATED_CP02
REMAINING_PRODUCT_DECISIONS: OPEN
CUSTOMER_WEBSITE: NOT_COMPLETE
REVIEW_CP02: NOT_RUN — OWNER_ONLY
CP03_PLUS: NOT_STARTED
BACKEND_CD / LIVE_DEPLOY: OUT_OF_SCOPE / NOT_RUN
```

## Thiết kế (chỉ trong allowlist; Customer path tính từ `Front_End/Customer_Web`)

UI chỉ đi qua `guardedLogin` / `guardedLogout` / `refreshSession` của `CustomerSessionProvider` và `finishBooking` của `BookingHoldProvider`; không import transport thô, không đụng foundation/backend/shared. Mọi quyết định nằm trong seam React-free để test đúng hàm mà UI dùng.

| File | Nội dung |
|---|---|
| `src/lib/customerAuthUi.ts` (mới) + `.test.ts` (44 test) | `validateLoginInput` (email trim, mật khẩu **nguyên văn**, giới hạn API 256/128 bằng thông báo chứ không `maxLength` cho mật khẩu, tránh cắt âm thầm); `presentIdentityCommandResult` (kết quả `blocked/settled/recovery-unresolved/aborted` × transport `succeeded/refused/lost` × session `me`); `isStalePresentation`; `describeSessionNotice` (provider là authority cho busy/recovery); `describeAuthEntry` (một mục auth cho mọi header + app bar); `createAuthSubmissionOwner` (chiếm đồng bộ, một attempt/UI owner, không giao kết quả sau `dispose`); `receiptCloseTarget`/`receiptCloseFailureMessage` |
| `src/app/login/page.tsx`, `LoginForm.tsx` (mới) | `/login` thật: label/id/name, `autoComplete=username/current-password`, `noValidate` + validation riêng (lỗi + focus), input **không điều khiển** (mật khẩu không vào state/URL/storage/log, xoá sau attempt và khi đổi danh tính). Server render và lần render đầu **không có form** (`loading`) nên Enter trước hydrate không thể GET mật khẩu lên URL. Đã đăng nhập: panel với email thật + Đăng xuất. Bỏ social login, “Forgot password”, link `/signup`. Chuyển về `/` chỉ khi **đúng attempt của mount này** `succeeded` **và** `me` authenticated |
| `src/components/CustomerAuthNotice.tsx` (mới) | `CustomerSessionNotice` (checking/busy/unresolved + nút “Kiểm tra lại” chỉ gọi `refreshSession`), `AuthPresentationView`, `useAuthCommand` (owner sống cùng component, không đặt dưới nhánh theo `me.status` vì provider báo `loading` suốt attempt) |
| `(Header)/AvatarDropdown.tsx` | Dùng `me`: icon trung tính khi chưa đăng nhập, chữ cái đầu email khi đã đăng nhập (không ảnh/tên mẫu, không Eden Smith/John Doe); anonymous có “Đăng nhập”→`/login`; authenticated có email + **button** “Đăng xuất” (`guardedLogout`); bỏ My Account/My bookings/Wishlist/Help và logout giả. Owner nằm ở thân component nên đóng menu/Esc không huỷ hay gửi lại request đang chạy. Chấm hiệu trạng thái busy/attention trên nút (cả trên trang phòng) |
| `MainNav1/MainNav2/Header3.tsx` | Mục tài khoản dưới `md` (mỗi header ẩn cụm phải dưới `md`) và thay nút “Sign up” của Header 1; dùng cùng `AvatarDropdown`, không đổi menu Stays/Cars/… |
| `src/components/FooterNav.tsx` | “Log in” → “Đăng nhập”/“Tài khoản” theo `me`, luôn `/login` (không còn `/account`) |
| `src/app/paydone/PayDoneReceipt.tsx` | “Đóng biên nhận” chỉ ở receipt đã xác nhận, mở dialog Headless UI (modal, Esc, focus mặc định vào “Giữ biên nhận”); xác nhận gọi `finishBooking(reservationId đã chụp lúc mở dialog)`; sai ID/identity pending ⇒ thông báo, receipt giữ nguyên; thành công không HTTP, về `/` |
| `TemplateDemoNotice.tsx`, `CustomerSessionProvider.tsx` (chỉ comment) | Notice nói thật: đăng nhập/đăng xuất là tích hợp thật; đăng ký/tài khoản vẫn mẫu |
| Docs | Report này; cập nhật hẹp contract (§CP01), `SNAPSHOT.md`, `PROJECT_BIBLE.md` |

## Acceptance

| | Kết quả |
|---|---|
| AC1 Login guarded, validation, không double-submit, không lưu mật khẩu, redirect muộn; 401/429/lost/unknown | Đạt (seam test + live) |
| AC2 Header/mobile/header khác theo `me`; logout guarded; mục tài khoản với tới được cả trên trang phòng mobile | Đạt: header 1/2/3 ở 1440 và 390; trang phòng 390 (FooterNav ẩn) vẫn có mục tài khoản |
| AC3 Booking đang chạy/biên nhận chưa đóng chặn auth; pending/recovery chặn booking; nút kiểm tra lại chỉ `GET me`; không replay tự động | Đạt (live: 0 request auth khi bị chặn) |
| AC4 Đóng biên nhận: Huỷ/Esc/xác nhận/stale; 0 HTTP; không còn dữ liệu A sau login B | Đạt |
| AC5 Look Chisfis, responsive, bàn phím, ranh giới template, booking không hồi quy | Đạt (không tràn ngang ở 390; Tab/Enter/Esc; guest quote→hold→confirm→receipt vẫn tạo đúng 1 hold + 1 reservation) |
| AC6 Allowlist, test/lint/tsc/build/live/CI/report | Xem “Checks”; CI FINAL_HEAD ở PR body |

## Checks (Front_End/Customer_Web, trên cây đã commit; CI FINAL_HEAD ở PR body)

| Lệnh | Kết quả |
|---|---|
| `npm ci` | OK |
| `npx vitest run src/lib/customerAuthUi.test.ts` | 44 passed |
| `npm run lint` | No ESLint warnings or errors |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm test` | 36 files, 831 passed |
| `npm run build` | Compiled successfully (`/login` 4.91 kB, `/paydone` 9.89 kB) |
| `git diff --check`, allowlist, secret/PII scan | sạch (chỉ email synthetic `@example.test`; không mật khẩu/token trong repo) |

**Mutation check trên seam (mỗi lần sửa một chỗ rồi hoàn tác):** owner bỏ kiểm `busy` ⇒ 2 fail; `loginSucceeded` bỏ điều kiện `me` ⇒ 1 fail; 5xx hiển thị “sai mật khẩu” ⇒ 6 fail; trim mật khẩu ⇒ 1 fail; giao kết quả sau `dispose` ⇒ 0 fail (hai guard độc lập: `attempt` bị tăng ở `dispose` và cờ `disposed`; test “không giao sau dispose” vẫn bắt hành vi thật).

## Live (Customer build của commit `9673128`, TLS tin cậy bật; API = backend của baseline (`git diff 1964a7b -- Back_End` rỗng), PostgreSQL `18.3 (Debian 18.3-1.pgdg13+1)` task-owned, dữ liệu demo Riverside; Chrome headless qua CDP: desktop 1440×900 và mobile 390×844 cảm ứng; Chrome extension cho vòng khám phá desktop trước đó)

Không dùng probe/instrumentation provider: mọi thao tác qua form, menu, link, dialog thật; đếm request ở một **fault proxy ngoài repo** (task script, pass-through mặc định, chỉ log method/path/status) nằm giữa trình duyệt và API thật. Tài khoản A/B/“email dài” là synthetic, tạo bằng `register` của backend **chỉ để dựng dữ liệu** (không tính cho UI đăng ký). Số liệu đếm theo proxy.

| # | Kịch bản | Kết quả (desktop + mobile trừ khi ghi khác) |
|---|---|---|
| 1 | Anonymous home/login/room/paydone | Mục tài khoản có ở cả 4 trang, `GET me 401`, **0** POST login/logout; không tràn ngang; menu mở, Esc đóng và trả focus; SSR `/login` không có `input[type=password]` |
| 2 | Submit rỗng / email sai | Lỗi đúng + focus email, URL không có query/credential, 0 POST. Login A hợp lệ: đúng 1 `POST login` + `GET me 200`, header A, reload vẫn A |
| 3 | Sai mật khẩu | **401 thật** từ API, thông báo chung (không phân biệt tài khoản), 1 POST, ô mật khẩu rỗng, không retry. **429 thật**: API chạy với `Authentication:RateLimiting:LoginPermitLimit=3` (cấu hình tài liệu hoá, khởi động lại riêng cho kịch bản này rồi trả về 500): 3×401 rồi attempt thứ 4 = 429; UI nói thử lại sau, không bịa thời gian chờ, không retry |
| 4 | Logout bằng menu/panel | `GET csrf` + 1 `POST logout 204` + `GET me 401`; email biến mất khỏi header/DOM. (Retry exact-CSRF-refusal: không chạy — tuỳ chọn, đã có test C1/CP01a) |
| 5 | Lỗi sau side effect | **Mô phỏng response, session thật**: proxy chuyển request tới API thật rồi trả 502 *kèm `Set-Cookie` gốc* (login ⇒ `me 200`; logout ⇒ `me 401`) → UI nói “chưa xác nhận kết quả” + session đã kiểm tra lại, không “sai mật khẩu”, không thành công/chuyển trang giả, 1 POST. Socket bị đóng sau khi API commit (mất response và cookie) ⇒ lost + `me 401` (“chưa đăng nhập; hãy thử lại”). 503/429 mô phỏng trả thẳng từ proxy (API không nhận) ⇒ lost / chờ. Proxy gửi `Connection: close` để trình duyệt không tự gửi lại POST bị đóng (lần đầu thiếu điều này cho thấy trình duyệt tự resubmit — artifact của harness, không phải app; đã sửa harness trước khi ghi nhận) |
| 6 | Hold active → đổi danh tính từ header | Guest: `/login` bằng link client-side → submit ⇒ blocked + link “Quay lại đặt phòng”, **0** request auth, ô mật khẩu xoá. Signed-in A: Đăng xuất ⇒ blocked, 0 request auth, hold id không đổi, **xác nhận bằng UI vẫn chạy** |
| 7 | Auth chậm | Login chậm 6 s + `me` chậm 7 s: form busy/read-only, thông báo, chấm nhấp nháy; chuyển trang client-side giữa chừng không huỷ/gửi lại (1 POST); xong vẫn ở `/` (không bị kéo về `/login`), header A; trong recovery menu có thông báo busy và **không** có nút Đăng xuất. Logout chậm 9 s: trang phòng khoá (Tìm phòng disabled, form giữ chỗ bị gỡ do reset draft), **0** `POST booking-holds`. `me` 503 sau login ⇒ “Chưa kiểm tra được phiên đăng nhập” + **một** nút “Kiểm tra lại”, form khoá; bấm ⇒ chỉ `GET me` (200), thông báo biến mất, panel A. `me` đầu tiên 503 (unknown) ⇒ notice + nút, form vẫn dùng được, không hiện như anonymous/tài khoản; kiểm tra lại ⇒ chỉ `GET me 401` |
| 8 | Uncertain | Mất response `POST booking-holds` (sau commit) ⇒ uncertain; logout bị chặn 0 request; “Retry exact request” → có hold. Mất response `confirm` ⇒ `confirm-uncertain`; logout bị chặn 0 request; “Gửi lại xác nhận” → receipt (idempotent). Không cần sửa H03 |
| 9 | Receipt | Login (guest) / logout (A) bị chặn tới khi đóng, link “Mở biên nhận”; dialog modal có mã đặt phòng + cảnh báo; Esc và “Giữ biên nhận” không đổi gì; xác nhận ⇒ về `/`, **0 HTTP**; không còn email/tên liên hệ trong DOM; logout A rồi login B bằng UI; `/paydone` của B là thông báo “Chưa có đặt phòng” |
| 10 | Quote→hold→confirm→receipt | Trước và sau mọi thao tác auth vẫn đạt; DB (cả phiên): 20 hold, 18 reservation, mỗi reservation có hold nguồn, **0** reservation trùng hold; mỗi lần chạy desktop/mobile +4 hold/+4 reservation đúng số biên nhận. Paid/email không được claim |
| 11 | Biên | Header 1/2/3: mục tài khoản ở 1440 và 390 (Customize chỉ có ≥lg nên mobile kiểm bằng cách đổi viewport trong cùng tài liệu); app bar mobile “Đăng nhập”→`/login`; trang phòng 390 không có FooterNav nhưng header có mục; email 195 ký tự không làm tràn panel/menu ở 390; Tab/Enter/Esc; thứ tự Tab email→mật khẩu→nút |

Tổng số kiểm tra tự động trong harness trên build cuối: basic 24+24, fault 18+18, booking 33+33, extra 20, 429 5 — tất cả PASS (harness và script nằm ngoài repo, đã xoá cùng stack). Ảnh chụp chỉ để QA nội bộ.

## Actual vs simulated

- **Thật:** UI, Chrome, TLS, API baseline, PostgreSQL 18.3, cookie HttpOnly, CSRF, 401, 429 do rate limiter thật, mọi hold/reservation.
- **Mô phỏng:** 502/503 và socket bị đóng/trễ do fault proxy (ghi rõ trong bảng); `me` 503 do proxy trả trực tiếp. Không có response giả nào được đếm là “bằng chứng session”: session lấy từ `me` thật hoặc từ phản hồi `me` mô phỏng nêu trên.
- **Không quan sát:** Safari/WebKit, dark mode bằng mắt, trình đọc màn hình.

## Rủi ro / NOT_RUN

- Template `Footer.tsx` render `FooterNav` lần thứ hai (có sẵn từ trước, ngoài allowlist) nên app bar xuất hiện hai lần trong DOM; cả hai dùng cùng component đã sửa.
- `me` ban đầu chưa trả lời (không có timeout trong `httpClient`, read-only) giữ `/login` ở trạng thái “Đang kiểm tra phiên đăng nhập…” không có form; lỗi mạng/5xx thì thành `unknown` có form + nút kiểm tra lại. Không thêm timeout vì ngoài scope.
- Một lần chạy mobile booking của harness bị treo ở một lệnh input CDP (không phản hồi), không có lỗi app; harness được thêm timeout 20 s/lệnh và chạy lại **33/33 PASS**.
- H01 (cookie `.TheBha.Customer` hỏng chặn booking) và H03 (replay hold mất token khách) vẫn mở; logout 401+`me` 401 không được diễn giải là cookie đã dọn.
- Bản đầu có hai nút “Kiểm tra lại” trùng nhau khi recovery lỗi (phát hiện ở live, sửa bằng một nút do notice của provider sở hữu) và thông báo của login/logout trước còn sót khi bắt đầu lệnh kia (đã sửa); live cuối chạy trên build đã có cả hai sửa.
- Backend CD/deploy: `NOT_RUN`; không workflow dispatch.

## Handoff

Đã dừng ghi. Review do Owner gọi; FINAL_HEAD, PR, CI: xem terminal handoff và PR body. Dọn dẹp: container `cust-cp02-pg18`, tiến trình API/proxy/web/TLS (theo PID), worker build mồ côi và thư mục scratch Chrome — chỉ tài nguyên task tạo.
