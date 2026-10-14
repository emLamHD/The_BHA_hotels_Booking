# CUST-WEB-001-CP05a — Kết quả tìm phòng thật, tham số trên URL

- **Work item / phase:** `CUST-WEB-001-CP05a` / `LIVE_STAY_RESULTS_URL_PARAMS`. Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`. Model: Sonnet 5.5. Skills: không dùng `diagnosing-bugs` (mọi lỗi gặp phải đã rõ nguyên nhân ngay trong phiên); không dùng Graphify (`ALLOWED_IF_RELEVANT`, source/test đủ).
- **Advisor:** **không dùng (0 lần).** Bản Master Execution Prompt cuối cùng của Owner không còn mục ADVISOR, nên không có consult nào; bảng quyết định URL (bên dưới) do implementer chốt và được kiểm bằng test + browser.
- **Branch:** `feature/cust-web-001-cp05a-live-stay-results` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `b6706f621a99dd9ce0c242e5a1ffae59849c0b7b` (merge PR #112; `HEAD` = `origin/develop` lúc preflight, 0/0 ahead-behind, cây sạch, 0 PR mở). Preflight đối chiếu độc lập: PR #112 `MERGED`, head `61de238f…`, merge commit đúng baseline; CI run `38423874866` là `push`, `completed/success` trên đúng baseline, Frontend/Backend/Admin đều `success`. Hai worktree Orca (`/home/admin1/orca/workspaces/...`) đã có từ trước phiên này; không do phiên này tạo và không được dùng.
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions/numstat và CI của FINAL_HEAD:** ghi ở PR body và terminal handoff, không ghi ở file này (tránh tự tham chiếu hash).
- **Owner:** kích hoạt **lõi** CP05a. Không duyệt `DP-01`…`DP-11` (vẫn `OPEN`). Cookie auth/account/booking, Backend, Admin, Calendar, CD: read-only.
- **Chính sách PR (Owner):** không có giới hạn/mục tiêu số dòng; report chỉ ghi số liệu GitHub.

```
IMPLEMENTATION_CP05a: PASS
STAY_RESULTS: REAL_RIVERSIDE
SEARCH_QUERY_AUTHORITY: URL
LISTING_MAP_ROUTE: ALIAS_TO_RESULTS — MAP_NOT_IMPLEMENTED
HOME_GLOBAL_HEADER_SEARCH: UNCHANGED_BASELINE — FOLLOW_UP
HOUSE_VILLA_BOOKABLE: NO_NEW_ACTIVATION
BOOKING_IDENTITY_GUARD: PRESERVED
REMAINING_PRODUCT_DECISIONS: OPEN
CUSTOMER_WEBSITE: NOT_COMPLETE
REVIEW_CP05a: NOT_RUN — OWNER_ONLY
CP05b_PLUS: NOT_STARTED
BACKEND_CD / LIVE_DEPLOY: OUT_OF_SCOPE / NOT_RUN
```

(`PASS` ở đây chỉ nói về việc code/test/browser/docs của checkpoint đạt; điều kiện `CI_GATE` của FINAL_HEAD được báo ở PR/terminal.)

## Hợp đồng URL đã chốt (một module React-free, tests gọi đúng module UI dùng)

`src/lib/stayListingQuery.ts` là parser/serializer duy nhất của trang, form và alias. Chỉ đọc sáu key: `brand` và `checkIn`, `checkOut`, `adults`, `children`, `rooms`; key khác không được đọc, không echo, không truyền sang href.

| URL | Kết quả | Request |
|---|---|---|
| Không có key nào trong năm trường tìm kiếm, không brand | browse Riverside (có chủ đích): thẻ “Chọn ngày để xem giá” | catalog; **không** availability |
| `brand=riverside\|house\|villa` đúng một lần | brand đó (không brand ⇒ Riverside) | Riverside: catalog; House/Villa: **không có** |
| brand lặp, rỗng, lạ, sai hoa/thường | `invalid` (không rơi về Riverside) | không |
| Có **bất kỳ** trong năm trường | phải đủ năm, mỗi key đúng một lần; thiếu/lặp/rỗng/sai định dạng/ngoài khoảng ⇒ `invalid` với lý do cụ thể, không tự điền, không chọn giá trị đầu/cuối | không |
| Đủ năm, hợp lệ | `search` | catalog rồi **một** GET availability (Riverside) |

Hợp lệ = ngày thật `YYYY-MM-DD` (loại `2026-02-31`, `2026-02-29` năm thường), `checkOut > checkIn`, tối đa 30 đêm, đếm là số nguyên thập phân chặt (loại thập phân, mũ, hex, `NaN`, `Infinity`, dấu, khoảng trắng, số 0 đứng đầu, vượt safe-integer), `adults ≥ 1`, `children ≥ 0`, `rooms 1–10`; `validateAvailabilityDraft` vẫn là cổng cuối. Ngày quá khứ vẫn hợp lệ về cấu trúc: quy tắc ngày theo múi giờ Property là của server (không dùng “hôm nay của trình duyệt”). Serialize luôn theo thứ tự `[brand nếu khác Riverside] checkIn checkOut adults children rooms`. Alias `/listing-stay-map` luôn trỏ `/listing-stay`, giữ **mọi giá trị** của key đã biết (kể cả key lặp/rỗng để đích báo `invalid`), bỏ key lạ, không đọc giá trị làm địa chỉ.

## Thiết kế (chỉ trong allowlist; path Customer tính từ `Front_End/Customer_Web`)

| File | Nội dung |
|---|---|
| `src/lib/stayListingQuery.ts` (+ `.test.ts`, 29 test) | Parser/serializer/key/alias/mô tả lỗi ở trên |
| `src/lib/stayListingSearch.ts` (+ `.test.ts`, 34 test) | `createListingController` (vòng đời request, React-free, dependency inject) và `buildListingCards`. Mỗi state mang `key` của URL; kết quả chỉ được publish nếu generation còn hiện hành (abort **không** được tin là đã dừng). Catalog: tìm Riverside **theo slug**, room type phải thuộc property; trạng thái `loading/error/missing/empty/ready`; catalog thành công được tái dùng trong trang, giá luôn đọc lại. `retry()` đọc lại đúng query hiện tại một lần (kích hoạt trùng khi đang tải bị bỏ). Lỗi → câu cố định tiếng Việt, không bao giờ biến lỗi mạng/400/401/5xx thành “hết phòng”. `dispose()` abort mọi thứ và không publish gì sau đó (tái dùng được khi mount lại) |
| `src/app/(stay-listings)/useListingStaySearch.ts` | Glue: một controller cho mỗi trang, áp URL khi key đổi, dispose khi rời trang. Không dùng `StaySearchProvider` của trang chủ |
| `src/app/(stay-listings)/ListingStaySearchForm.tsx` | Form của trang: `LocationInput`, `StayDatesRangeInput`, `GuestsInput` của template (đã controlled sẵn) với draft riêng, remount theo key URL; một đường submit; thiếu ngày ⇒ lỗi `role=alert` có focus và 0 request; “Xoá bộ lọc”; bố cục xếp dọc trên mobile; Esc đóng cả popover Location bằng adapter ở form (control dùng chung không sửa) |
| `src/app/(stay-listings)/ListingStayResults.tsx` | Hiển thị theo state: chỉ khi `state.key` = key URL hiện tại (khung đầu sau đổi URL là “Đang tải…”, không bao giờ là thẻ/giá/tóm tắt của query cũ); đếm “loại phòng”; thông báo booking đang làm dở/vừa hoàn tất, chỉ đọc (`inProgressBookingTarget`) |
| `src/app/(stay-listings)/SectionGridFilterCard.tsx`, `listing-stay/page.tsx` | Thành phần live thay `DEMO_STAY_LISTINGS`/`TabFilters`/`Pagination`; `Suspense` cho `useSearchParams`; submit trùng query áp dụng ⇒ `retry()`, không điều hướng |
| `src/app/(stay-listings)/listing-stay-map/page.tsx` | Alias redirect; `dynamic = "force-dynamic"` (xem lỗi 1) |
| `src/app/(stay-listings)/layout.tsx` | Bỏ hero Tokyo/“112 properties”, slider danh mục (số liệu giả, link vào kết quả thật) và khối tác giả; trang tự mang tiêu đề/form/kết quả |
| `src/components/RoomTypeStayCard.tsx` | Hai cờ trình bày tuỳ chọn `showRating`/`showWishlist` (mặc định bật ⇒ trang chủ không đổi) |
| `src/components/TemplateDemoNotice.tsx` | Dòng thông báo nói kết quả tìm Riverside là thật, bản đồ chưa có |

Không đổi `routePolicy`, middleware, API proxy, services, `roomQuote`, `roomDetailsRoute`, provider, config, package/lockfile, Backend/Admin/infra/governance. `SectionGridHasMap.tsx` và `TabFilters.tsx` còn nguyên nhưng **không** được route nào render.

## Lỗi thật do browser acceptance tìm ra (đã sửa trong phạm vi)

1. **Alias mất query.** Build ban đầu đánh `/listing-stay-map` là `○ Static`: Next prerender redirect một lần lúc build (HTML `meta refresh → /listing-stay`, `x-nextjs-cache: HIT`), mọi truy vấn bị rơi. Sửa: `export const dynamic = "force-dynamic"` (route nay là `λ`, `307` có `Location` giữ key).
2. **“Xoá bộ lọc” và các nút trong Notice không bấm được**: các vệt mờ `BgGlassmorphism` (`absolute`, `z-0`) phủ lên phần tử không có `position`. Sửa: wrapper của section có `relative`.
3. **Esc không đóng popover Location** (control dùng chung chỉ đóng khi click ngoài). Sửa bằng adapter ở form (click `body` khi Esc), không động vào control.
4. **Mobile:** nhãn “Search” sát mép nút trong bố cục xếp dọc ⇒ padding qua class trên form listing.

## Môi trường và công cụ (thật / mô phỏng / test)

- **Build được kiểm = cây bàn giao.** `npm run build` với `NEXT_PUBLIC_API_BASE_URL=https://localhost:7546`, `API_PROXY_ORIGIN` rỗng, trên đúng working tree sau đó được commit (file nguồn Customer mới nhất sửa lúc 09:25:38, `BUILD_ID` 09:26:29; không sửa gì sau build). Commit sau live chỉ là docs.
- **Trình duyệt:** Google Chrome `153.0.8010.52` hệ thống, điều khiển bằng Playwright `1.64.0` cài **chỉ ở scratch** (`npm install --save-exact`, không tải Chromium, không `--with-deps`, không đổi package/lockfile repo). Desktop 1440×900, mobile 390×844 (touch).
- **TLS:** binary `mkcert` **không có** trên máy; CA `mkcert development CA` hiện có ở `~/.local/share/mkcert` (được Chrome tin cậy qua `~/.pki/nssdb`, trust `C,,`); leaf `CN=localhost`, SAN `localhost/127.0.0.1/::1`, `CA:FALSE`, 14 ngày, ký bằng `openssl` bằng chính CA đó và để trong harness (khoá mode 0600, PFX cho Kestrel, mật khẩu qua file 0600; không in private key). `openssl verify` OK; `isSecureContext = true`; Node dùng `NODE_EXTRA_CA_CERTS`. Không `ignoreHTTPSErrors`/cờ bỏ qua chứng chỉ/`rejectUnauthorized:false`. Không đổi truststore hệ thống.
- **API/DB (thật):** PostgreSQL `18.3` container riêng của task, loopback `55418`, DB `cust_cp05a_demo`; `idempotent.sql` áp sau khi kiểm `pg_isready`, `current_database`, version, container; lịch sử migration = 9 (tới `StaffIdentityFoundation`) khớp baseline. `dotnet publish` Release từ Backend **không đổi** (diff Backend/`deploy` so với baseline rỗng). Seed `--seed-riverside-demo` (dry-run rồi apply): 60 đêm `2026-10-15..2026-12-13`, 3 loại phòng, 1 rate plan, 11 phòng vật lý, 262 dòng. API chạy `Production` (không LocalGate) với PFX task, CORS chỉ `https://localhost:3401`, `health/ready` 200. Next `start` `127.0.0.1:3400` sau TLS front `3401`; proxy lỗi `7546 → 7545` xác minh TLS upstream.
- **Mô phỏng (đánh dấu rõ, log proxy ghi `simulated`):** catalog `[]` (thiếu Riverside), room-types `[]`, catalog 500, availability 500/401/400-body, mất kết nối (Playwright `route.abort`), availability chậm 2,5 s/5 s (race), lỗi ảnh (route abort ảnh). **Không** có kết quả mô phỏng nào được tính là “API+DB rỗng thật”.
- **Thật, không mô phỏng:** catalog/room-types/offer từ API+DB task; **rỗng thật** (`200 []` cho khoảng ngoài cửa sổ seed và cho 10 phòng, đã đối chiếu trực tiếp với API); **400 thật** (ngày trước ngày địa phương Property: “checkIn cannot be earlier than the Property local date.”) — UI hiện “Hệ thống không nhận tìm kiếm này…”, không hiện chi tiết server; đặt phòng thật hold → confirm.
- **Chỉ fixture (không giả live):** đa rate plan và giá đêm không đều. Seed chỉ có 1 rate plan và đêm đều; kịch bản “Saver 800k+1,1M vs Flexible 2×1,2M” chạy qua `quoteForRoomType` thật trong `stayListingSearch.test.ts` (chọn tổng thấp nhất, `uniformNightlyAmount = null`, hiện tổng, không trung bình).

## Browser acceptance (production build, Chrome 153) — 220 check, 4 bộ, tất cả đạt trên cây bàn giao

| Kịch bản | Bằng chứng chính |
|---|---|
| Browse (desktop+mobile) | 3 thẻ = 3 room type thật (tên từ API), ảnh thật, mỗi thẻ “Chọn ngày để xem giá” không số; không Tokyo/112/233 stays/TabFilters/Pagination, không rating/tim; 1 lần đọc catalog, 0 availability, 0 method ghi |
| Form | Thiếu ngày: lỗi `role=alert` có focus, 0 request, URL không đổi (cả mobile); sửa draft chưa Search không đổi URL/request; Search hợp lệ: URL đủ năm key đúng thứ tự, đúng **một** GET availability với năm giá trị; thẻ = đúng các room type API trả |
| Reload/chia sẻ/Back-Forward | Context mới + URL A chạy không cần home state; A→B (form), Back→A (form dựng lại “Nov 10 – Nov 12 / 4 Guests”, +1 GET, không quote cũ), Forward→B, reload B; sửa form chưa submit không đổi URL/tóm tắt/giá/request; submit lại cùng query = đúng +1 GET, URL và `history.length` không đổi |
| URL lỗi trực tiếp (10 loại) | lặp, thiếu, `2026-02-31`, brand lạ/lặp, rooms 11, đảo ngày, 35 đêm, rỗng, `2.5`: báo “Liên kết tìm phòng chưa hợp lệ” + lý do, 0 thẻ, **0** request catalog/availability, URL giữ nguyên |
| Alias | 4 URL: về `/listing-stay` đúng query (kể cả key lặp → báo lỗi ở đích, House), không loop, không request Google Maps; curl: `307`, `location` giữ key, bỏ `utm`, không echo `//evil.example` |
| House/Villa | “Chưa hỗ trợ đặt phòng trực tuyến” + tên brand, có hoặc không có ngày, 0 request catalog/room-types/availability; link về Riverside chạy; chọn House trong form → `?brand=house&checkIn=…` |
| Rỗng vs lỗi | Rỗng thật (2 ca) → “Không có phòng phù hợp…”, form còn; 400 thật; mô phỏng: thiếu property/không room type (copy riêng), catalog 500 (retry đọc lại catalog rồi **một** availability), availability 500/mạng (retry = đúng 1 GET cùng URL, rồi có kết quả), 401, 400-body: câu cố định, không lộ `SIMULATED/10.0.0.5/token`, không “hết phòng” |
| Race/unmount | A trễ 5 s → B: B hiện đúng; sau khi hết 5 s vẫn là B (summary/thẻ/URL); A → Xoá bộ lọc / House / rời trang `/login`: 5,8 s sau không đổi, không điều hướng, không `pageerror`. Bằng chứng deferred (promise xác định) ở unit test, kèm kiểm mutation một lần (bỏ guard generation ⇒ 2 test fail) |
| Quote authority | So UI với JSON offer thật cho cùng query (A, B, cuối tuần mobile): tên, tiền (`₫`, `/đêm`), đếm, link; giá thẻ = số tiền nightly của server (đêm đều) |
| Thẻ → đặt phòng | Link trang phòng = `propertyId`+`roomTypeId`+năm tham số đúng; trang phòng tự re-quote (+1 GET); hold → biên nhận → confirm; **đúng 1 hold + 1 reservation cho mỗi lần chạy** (DB), số `ConfirmationNumber` và tổng tiền trên UI = DB/server; 2 request ghi trong cả lần chạy |
| Guard/hồi quy | Hold đang sống, đi home → hero → alias → `/listing-stay`: thông báo “Bạn đang có một đặt phòng đang thực hiện.” với link về đúng phòng của booking (không kèm search, không tuyên bố khoá); search A, đổi B, Back, Xoá bộ lọc, House, thông báo vẫn còn, **0** request ghi, DB không đổi; link dẫn lại, hold chưa bị thay, confirm đúng một lần; sau đó “Bạn vừa hoàn tất một đặt phòng.” + “Xem xác nhận”. Home Featured 3 thẻ (cờ mặc định giữ rating/tim), search trang chủ vẫn ở `/#rooms` (baseline), đăng ký → đăng nhập → `/account` hiện email chạy như baseline |
| A11y/layout | 5 trạng thái mobile không tràn ngang; Tab đi qua Location/ngày/guests/Search; Enter trên Search = đúng 1 request (một đường submit); Esc đóng 3 popover; loading là `role=status`, lỗi là `role=alert`; lỗi ảnh (mô phỏng) → “Ảnh đang được cập nhật” trên cả 3 thẻ; không console product error |

DB task sau toàn bộ phiên: 4 hold, 3 reservation (ba lần chạy luồng đặt phòng hoàn chỉnh = +1 hold +1 reservation mỗi lần; **một hold mồ côi** từ một lần chạy thăm dò bị dừng sau bước hold). DB bị xoá cùng container.

Quan sát baseline (không do CP05a): console có `GET /api/v1/auth/me → 401` ở mọi trang ẩn danh; prefetch RSC của link header `/add-listing` (và đôi khi `/listing-stay-map`) bị `ERR_ABORTED` — tái hiện ở `/`, `/login`, `/about` (4–8 trên 8 lần tải), nên đã loại khỏi bộ lọc “console product error”; build có cảnh báo `/listing-stay-detail deopted into client-side rendering` (đã có sẵn).

## Checks (chạy trong phiên này, từ `Front_End/Customer_Web`, Node 22.23.2 / npm 10.9.8)

| Lệnh | Kết quả |
|---|---|
| `npm ci` | exit 0 |
| `npx vitest run src/lib/stayListingQuery.test.ts src/lib/stayListingSearch.test.ts` | 2 file, **63** test pass |
| `npm run lint` | `✔ No ESLint warnings or errors` |
| `npx tsc --noEmit -p .` | exit 0, không output |
| `npm test` | 40 file, **985** test pass |
| `npm run build` | exit 0; `/listing-stay` `○`, `/listing-stay-map` `λ` |
| `git diff --check`; scan allowlist/secret/PII | sạch; mọi path trong allowlist; chỉ có chuỗi giả trong test dùng làm “sentinel rò rỉ” (`SqlException at 10.0.0.5`, `token abc123`) |

## Self-review

- Request lifecycle độc lập với home: không `StaySearchProvider`, không publish offer sang home, không CSRF/token/mutation; Riverside tìm bằng slug; không bao giờ `properties[0]`.
- Mọi đường lỗi/rỗng được phân biệt và kiểm; không đường nào hiển thị chi tiết server.
- Mutation một lần chứng minh test race bắt được lỗi guard; phần còn lại là test hành vi qua module UI thật (không test markup bằng chuỗi).

## Giới hạn, follow-up, rủi ro, NOT_RUN

- **Search ở header/trang chủ giữ hành vi baseline** (về Featured tại `/#rooms`, không chuyển sang URL) — không gọi “mọi điểm vào đã COMPLETE”; thống nhất các entry ở `CP08`. Form trong trang listing là form áp dụng bộ lọc URL.
- **Bản đồ chưa có** (`PropertyDto` không có toạ độ): follow-up `CP05b`. Trang thương hiệu/chỗ nghỉ, nav template chưa hỗ trợ (`CP08`).
- Còn nguyên phần template ở route này: khối đăng ký nhận tin (không backend) — dòng thông báo demo đã nói các mục khác là mẫu. Slider danh mục và khối tác giả mẫu **đã bỏ** khỏi route; hero/Tokyo/TabFilters/Pagination mẫu đã bỏ.
- `minDate` của lịch là ngày địa phương của trình duyệt chỉ để gợi ý chọn; quyết định ngày quá khứ vẫn là của server (đã thấy 400 thật).
- Chữ trên control dùng chung (“Add dates”, “Guests”, “Search”) là tiếng Anh của template.
- **Chưa kiểm:** Safari, bfcache, nhiều tab, `Vercel` preview/status (báo riêng, không phải deploy readiness), tải thật qua AWS. Vẫn mở: H01 cookie hỏng, H03 replay guest mất token, `me` không timeout, `FooterNav` trùng lặp, lịch sử/ownership/backend/chính sách Owner/quyền media và các launch gate — không sửa trong CP05a.
- Phụ thuộc `.env.local` (gitignored, chứa khoá riêng của Owner — không đọc giá trị): `next build` nạp nó; acceptance dùng biến môi trường tường minh nên không bị lệch.
- **Dọn dẹp:** tiến trình dừng theo PID đã kiểm lệnh (API, `next start` + shell cha, proxy); container task `cp05a-pg-*` xoá theo tên duy nhất của task (stack Owner `the-bha-postgres-1` không đụng); thư mục harness và ảnh chụp ở scratchpad, không phải deliverable và không commit. Không `git worktree add`, không stash/reset/rebase, không push `develop`/`main`.

Dừng ghi sau handoff; Owner gọi review.
