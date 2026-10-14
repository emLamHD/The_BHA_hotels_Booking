# CUST-WEB-001-CP08a-C2 — Trang chủ cổng đặt phòng, menu template, nút sáng/tối, Riverside tại `/riverside`

- **Work item / correction:** `CUST-WEB-001-CP08a` / `CUST-WEB-001-CP08a-C2-BOOKING-HOME-TEMPLATE-NAV` (`OWNER_PRODUCT_REVISION`). Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY` (Owner gọi). Model Sonnet 5.5. Cùng PR #114 (Draft), cùng branch `feature/cust-web-001-cp08a-riverside-homepage-release`; ba commit CP08a (`e377996`, `9095557`, `01b04fc`) giữ nguyên, không viết lại lịch sử.
- **Nguồn yêu cầu:** Owner xem bản preview CP08a (2026-10-14) và yêu cầu: trang chủ như cổng đặt phòng kiểu Booking, khôi phục menu/ngôn ngữ/tiền tệ của template Chisfis (`TEMPLATE_REFERENCE b6e28a6`, chỉ đọc), nút sáng/tối bắt buộc, trang Riverside giữ nguyên ở `/riverside`, hero slideshow ảnh Đà Nẵng, ưu đãi mẫu, điểm đến, tin tức, newsletter UI, “Tài khoản của tôi” có returnTo.
- **BASELINE** `c989fc355d26d5c3e061e4dcdadaffa583b68bc9`; **CORRECTION_START_HEAD** `01b04fcfc530f35e99517e9db36f0ef1d03ffd99`.
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions, CI và hai trạng thái Vercel:** ghi ở PR body và terminal handoff (không ghi hash tự tham chiếu ở đây). Phần code/test/media của C2 là các commit `386d21d`, `16acde7`, `34a24a7`; commit docs sau đó không đổi `Front_End/`.
- **Cây frontend đã chạy acceptance:** `Front_End/Customer_Web` = `5acb2f5676f3ff99d8238ff9f20fab8e1c2141a0` (HEAD `34a24a71e4ff7135856421a31cafbf5681218a69`). `git status --porcelain Front_End/Customer_Web` rỗng trước và sau `npm run build`; commit docs giữ nguyên hash cây này (kiểm tra ở handoff).
- **Backend / schema / CD / Admin:** không đổi (`git diff origin/develop...HEAD -- Back_End Front_End/Admin_Web deploy .github` rỗng; không migration, không biến môi trường mới).
- **Advisor:** 2 lần, read-only. (1) Trước khi viết code: kiểm tra `darkMode: "class"`/hook theme dùng chung, mọi link `/#…` cần retarget, credit ảnh phải ghi “đã chỉnh sửa”, bỏ số liệu các nguồn mâu thuẫn, bẫy carousel (clipping popover, `inert`, H1), `notFound()` với catch-all. (2) Trước lượt acceptance cuối: dọn các mục PASS cứng/`|| true` trong kịch bản, ánh xạ file ↔ allowlist, xác nhận không có CSP chặn script nội tuyến, thứ tự `npm ci` → build từ cây sạch → chạy liền các suite.

```
IMPLEMENTATION_CP08a_C2: PASS
HOME_COMPOSITION: BOOKING_PORTAL
TEMPLATE_NAV_LANGUAGE_CURRENCY: RESTORED_UI_ONLY
LIGHT_DARK_TOGGLE: RESTORED_TEMPLATE — DESKTOP_MOBILE — PERSISTED
RIVERSIDE_PAGE: PRESERVED_AT_/riverside
HERO_DANANG: FULL_WIDTH_3_PLUS_LICENSED_IMAGES
OFFERS: MOCK_DATA_ONLY — NO_REAL_PRICE_OVERRIDE
DESTINATIONS_BLOG_NEWS: ROUTE_LINKED_STATIC_CONTENT
MY_ACCOUNT: VERIFIED_SESSION_GUARD_WITH_ACCOUNT_RETURN
NEWSLETTER: UI_PREVIEW_VALIDATED_NOT_PERSISTED
BOOKING_IDENTITY_GUARD: PRESERVED
OWNER_VISUAL_ACCEPTANCE_C2: PENDING
REVIEW_C2: NOT_RUN_OWNER_ONLY
LIVE_DEPLOY_VERIFICATION: NOT_RUN
COMMERCIAL_READINESS: NOT_CERTIFIED
```

## 1. Trước → sau (đã xem ảnh chụp thật của production build, desktop 1440×900 và mobile 390×844, sáng và tối)

| | Trước (CP08a, `/`) | Sau (C2) |
|---|---|---|
| `/` | Trang giới thiệu Riverside (hero + loại phòng + lý do + ảnh + 3 bước + FAQ) | Cổng đặt phòng: slideshow Đà Nẵng full width, form tìm phòng thật, ưu đãi mẫu, điểm đến, đoạn dẫn tới Riverside, tin tức, newsletter. **Không** render landing Riverside. |
| `/riverside` | không có | Đúng composition CP08a (SectionHero + HomeFeaturedRooms + Intro + Gallery + BookingGuide + LocationFaq), metadata Riverside; `#gioi-thieu`, `#rooms`, `#booking-guide`, `#faq` giữ nguyên |
| Header | 4 anchor “Loại phòng / Tìm phòng / Hướng dẫn đặt phòng / Thông tin cần biết”, không có menu template | Header 2 của Chisfis, một hàng gọn ở mọi độ rộng: Riverside, Ưu đãi, Blog (menu danh mục), Dịch vụ (Stays/Real estate/Cars/Experiences/Flights, có nhãn “Mẫu”), Giao diện mẫu (mega-menu), Ngôn ngữ/Tiền tệ, nút sáng/tối, avatar. Dưới `lg`: ô tìm kiếm gọn + nút sáng/tối + avatar trong hàng; drawer (menu của app bar dưới `md`, của header ở `md`–`lg`) có cây menu, nút sáng/tối, Ngôn ngữ/Tiền tệ, cuộn được, đóng bằng Esc/click ngoài. |
| Sáng/tối | nút trong avatar nhãn “Enable dark mode” sai khi đã tối | Nút `SwitchDarkMode` (đặt tên theo hành động: “Bật chế độ tối” / “Bật chế độ sáng”) trong header ở mọi độ rộng, kể cả trang phòng; công tắc `role=switch` trong menu tài khoản; đồng bộ qua một state toàn cục; lưu `localStorage.theme`; snippet hằng ở `SiteHeader` đặt class `dark` trước first paint |
| Tài khoản | Menu tài khoản riêng | Menu hồ sơ của template cho mọi người: icon trung tính, tiêu đề “Tài khoản” (email khi đã đăng nhập), “Tài khoản của tôi” luôn tới `/account`, “Đặt phòng của tôi”/“Danh sách yêu thích” ghi “Chưa hỗ trợ”, “Đăng xuất” chỉ khi đã đăng nhập |
| Blog | `Lorem Ipsum`, tác giả/bình luận giả | Registry duy nhất: 6 cẩm nang điểm đến + 3 bản tóm tắt tin có nguồn; `/blog`, `/blog?category=…`, `/blog/<slug>` |
| Footer | link `/#…` | link `/riverside#…`, trang chủ, ưu đãi, blog, điểm đến, “Nguồn ảnh” |

## 2. Route, dữ liệu, nguồn

| Route | Nội dung | Dữ liệu |
|---|---|---|
| `/` | `HomeHeroCarousel` (4 ảnh), `HomeOfferSection`, `HomeDestinationSection`, `HomeRiversideTeaser` (giữ anchor `#rooms` cho link cũ `/#rooms`), `HomeNewsSection`, `HomeNewsletter` | `data/heroSlides.ts`, `data/homepageOffers.ts`, `data/travelPosts.ts` |
| `/riverside` | composition CP08a | catalog thật qua `StaySearchProvider` |
| `/offers`, `/offers?offer=<slug>` | cùng dữ liệu mẫu; highlight đúng một slug đã biết, giá trị lạ/rỗng/lặp không highlight | `data/homepageOffers.ts` |
| `/blog`, `/blog?category=` | không có / rỗng ⇒ tất cả; đúng một danh mục có bài ⇒ lọc; **mọi giá trị khác** (lạ, lặp, khác chữ hoa/thường) ⇒ 404 | `lib/homepageContent.resolveBlogFilter` |
| `/blog/<slug>` | đúng một segment trùng slug; `dynamicParams=false` ⇒ 404 thật cho slug lạ, nhiều segment, `/blog/single` | `generateStaticParams` từ registry |
| `/media-credits` | tác giả (đúng như Commons ghi), giấy phép + liên kết, trang Commons, “đã cắt khung, thu nhỏ, chuyển WebP”, nơi dùng | `data/heroSlides.ts` ↔ `scripts/homepage-media/manifest.json` |
| `/account` | verified anonymous + idle ⇒ `/login?returnTo=/account` (replace) | `lib/authReturnTarget.ts` |

**Mock / thật / newsletter — ranh giới.**
- *Ưu đãi* là dữ liệu mẫu (giá tự đặt, không phải đơn giá seed, không có engine giảm giá); badge “Ưu đãi minh hoạ”, câu “chưa gắn với hệ thống đặt phòng” ngay trên thẻ; % tính từ chính hai giá của thẻ (`discountPercent`). Không có tồn kho/rating/đếm ngược. Nút “Xem phòng và giá thực tế” đi tới `/listing-stay`; giá thật chỉ do API trả theo ngày. Suite H chứng minh: chọn Ngôn ngữ/Tiền tệ → request availability không có tham số tiền tệ/ngôn ngữ, trang vẫn ₫, mọi số tiền trên trang kết quả nằm trong response API, không số tiền mẫu nào ở trang hay body request, body hold không có trường giá/giảm giá, `InventoryHolds.CurrencyCode = VND` và `TotalAmount` đúng tổng API đã báo.
- *Ngôn ngữ/Tiền tệ* chỉ là UI: nút (không phải `href="##"`), chọn chỉ đổi dấu tích và nói “chưa áp dụng”; không lưu, không điều hướng, `html lang` giữ `vi`.
- *Newsletter* `UI_PREVIEW_VALIDATED_NOT_PERSISTED`: `validateNewsletterEmail` (module thật, có test) ; input không có `name`, form không có action; hợp lệ ⇒ đúng câu “Bản demo chưa tiếp nhận đăng ký. Email chưa được lưu.”, ô nhập được xoá; không request, không storage, không cookie, địa chỉ không xuất hiện trong URL/log/body.

## 3. Nội dung bài viết: nguồn đã đọc ngày 14/10/2026

Mọi sự kiện trong `data/travelPosts.ts` được diễn đạt lại, có nguồn cạnh bài; số liệu các nguồn mâu thuẫn (chiều dài Mỹ Khê, diện tích/số voọc Sơn Trà, số đội DIFF) **không** được đưa vào. Không dùng đơn vị hành chính cũ, không tin/sự kiện/đối tác của BHA, không tác giả/bình luận/bộ đếm. Tin: DIFF 2026 khép lại (30/5–11/7/2026; Báo điện tử Chính phủ 12/7; 2,72 triệu lượt khách lưu trú theo Sở VHTTDL qua Báo Văn hoá, **chưa đối chiếu độc lập**, ảnh minh hoạ ghi rõ là ảnh tư liệu, chụp trước DIFF 2026); du lịch Đà Nẵng 9 tháng 2026 (VietnamPlus 5/10/2026, thống kê TTXVN); lịch sự kiện cuối năm 2026 ở Đà Nẵng/Hội An (**dự kiến**; Báo Văn hoá 5/9/2026 + danh mục Danang FantastiCity đăng 1/12/2025; một danh mục khác từng ghi Lễ hội Đèn lồng vào 21–25/1 — bài ghi rõ). Cẩm nang: Mỹ Khê, Sơn Trà, Ngũ Hành Sơn, Cầu Rồng–sông Hàn, Hội An (UNESCO 1999, tiêu chí ii và v), Huế (UNESCO 1993).

## 4. Media và giấy phép (9 ảnh gốc → 12 tệp WebP, 1,8 MB)

Lấy từ Wikimedia Commons bằng `scripts/homepage-media/build_media.py` (chỉ các tệp trong danh sách; dừng nếu giấy phép không thuộc CC0/CC BY 2.0/4.0/CC BY-SA 2.0/4.0; ghi tác giả, giấy phép, URL giấy phép, URL trang gốc, kích thước và SHA-1 bản gốc, SHA-256 bản Commons render 2400 px, crop, ngày lấy vào `manifest.json`). CC0: Quangpraha, NGO TUNG thanhtungo, lumoplank, Mustang Joe. CC BY 2.0: “. Ray in Manila” (Mỹ Khê). CC BY 4.0: Alexkom000 (Hội An). CC BY-SA 4.0: Dominic Nelson (Ngũ Hành Sơn), Christophe95 (Huế), Vivu Vietnam (pháo hoa). Caption hero và bài viết hiện tác giả + giấy phép + “Nguồn ảnh”; CC BY-SA được nêu là chia sẻ tiếp cùng giấy phép. Ảnh Riverside gốc và manifest của nó không đụng. `heroSlides.test.ts` so khớp credit ↔ manifest ↔ tệp trên đĩa (mọi `.webp` phải có entry). Ảnh chỉ là cảnh Đà Nẵng; không câu nào nói đó là view của phòng. Hero: slide đầu là tệp nhẹ nhất (93 KB) và là ảnh duy nhất `fetchpriority=high`; ba ảnh sau `loading=lazy`.

## 5. “Tài khoản của tôi” và returnTo

`/account` dùng cổng phiên đã xác minh: chỉ `anonymous` đã xác minh + `idle` mới `router.replace("/login?returnTo=/account")`; `loading`/`unknown`/pending/recovery giữ nguyên trang với thông báo, không lộ email. `LoginForm` đọc `window.location.search` một lần lúc submit; chỉ khi `guardedLogin` thành công **và** `me` xác minh (`loginSucceeded`) mới điều hướng, tới `/account` chỉ với đúng một giá trị `returnTo=/account` (hoặc `%2Faccount`); mọi giá trị khác (rỗng, lặp, `//`, `https://`, `%252F`, `javascript:`, `/checkout`, `/account/`, `/Account`…) ⇒ `/`; đăng nhập trực tiếp ⇒ `/`. Không đổi coordinator/session/provider/CSRF/khoá booking; không xoá hold/receipt.

## 6. Acceptance trình duyệt (một lượt sạch, cây `5acb2f56…`)

Chrome 153.0.8010.52 + Playwright 1.64.0 (hệ thống), Node 22.23.2; production build; API Production + PostgreSQL 18.3 dùng một lần (DB `cust_cp08a_c2_demo`, seed `--from 2026-10-15 --days 60`); TLS bằng leaf ký bởi CA mkcert hiện có (không cờ bỏ qua chứng chỉ). `F_SHIFT=9`: đặt phòng thật ở 1–3/12, 5–7/12, 10–12/12 và 9–11/12 (suite H), trong cửa sổ seed (đêm cuối 13/12/2026); suite C/A/B/D/E chỉ tìm kiếm hoặc mô phỏng, không đặt phòng. Số entry (mỗi entry là một khẳng định riêng; **không** cộng vào 272 của C0 hay 75 của C1): **507 = 485 PASS + 18 FINDING (kế thừa, có nhãn) + 2 NOT_RUN + 2 INFO (quan sát, không tính)**; 0 FAIL.

| Suite | Nội dung | Kết quả |
|---|---|---|
| A | nút sáng/tối: click/bàn phím/đồng bộ header–drawer–menu, bền qua reload/điều hướng, 320/390/768, trang phòng mobile, giữ draft + vị trí slider, 0 request, class `dark` có sẵn tại DOMContentLoaded | 34 PASS |
| B | menu: 6 độ rộng (một hàng, không tràn ngang, không 4 anchor/Customize/Get Template), menu Dịch vụ/Giao diện mẫu/Blog (hover, bàn phím, Esc), Ngôn ngữ/Tiền tệ (không điều hướng/request/lưu), drawer (cây, cuộn khi màn thấp, Esc, click ngoài ở 768), 11 route × sáng/tối × 1440/390 (palette, đúng một H1, không tràn, ảnh giải mã, không lỗi console/hydration) | 193 PASS, 12 FINDING, 1 NOT_RUN |
| C | `/riverside` (card = catalog thật, anchor cross-page/cùng trang/lặp/trực tiếp, link phòng), hero (4 ảnh, full width, 480–640 / 340–460, ưu tiên/lazy, nút/chấm/phím/swipe, autoplay 6 s + hover/focus/pause/tab ẩn/reduced-motion, timer sạch, 0 request/điều hướng), tìm kiếm từ hero `/`, hero `/riverside`, header mobile, header trang phòng (mỗi lần 1 điều hướng + 1 availability), popover lịch không bị cắt, ưu đãi (toán %, slider, `?offer=`, 0 mutation), điểm đến (6 thẻ → 6 slug, bộ lọc, reload, Back/Forward, URL chia sẻ, 404), tin/blog (nguồn, liên quan, 404), newsletter | 100 PASS, 1 FINDING |
| D | menu tài khoản, Tài khoản của tôi → login → quay lại, returnTo (11 biến thể độc hại + 2 control), unknown/loading, giữ focus sau logout, mobile | 39 PASS |
| E | pending/recovery trên avatar mới, desktop + mobile (logout giữ trước API; phản hồi bị cắt sau commit): đúng 1 POST logout, đọc `me`, nút Hold khoá, Esc đóng menu | 30 PASS, 2 INFO |
| F | hồi quy đặt phòng thật: khách desktop, khách mobile, đã đăng nhập: trang chủ → kết quả → phòng → hold → (tham quan `/riverside`, `/offers`, `/blog`, `/` bằng điều hướng mềm) → xác nhận; DB +1 hold +1 reservation `Confirmed`, đúng một request confirm, tài khoản gắn khi và chỉ khi đã đăng nhập; logout bị từ chối khi đang có booking | 32 PASS, 1 NOT_RUN |
| G | tên truy cập, thứ tự Tab, dấu focus, tương phản tính toán (trừ chữ trắng trên ảnh có scrim), không lỗi hydration | 51 PASS, 5 FINDING |
| H | Ngôn ngữ/Tiền tệ + ưu đãi mẫu không chạm quote/hold/reservation | 6 PASS |

### Thật và mô phỏng
Thật: Chrome, các trang, API, PostgreSQL, cookie, CORS, đăng ký/đăng nhập/đăng xuất, hold, xác nhận, truy vấn DB. Mô phỏng (proxy ngoài repo, log ghi `simulated`): giữ logout trước API (6 s), phản hồi logout bị cắt sau khi API đã commit, `me` trả 500 / chậm, và `document.hidden` bị ghi đè để mô phỏng tab ẩn. Giới hạn tốc độ auth của harness API được nâng (`LoginPermitLimit=500`, `RegisterPermitLimit=200` thay vì 10/5 mỗi 60 s) vì D4 đăng nhập hơn 10 lần trong 60 s; API và proxy được khởi động lại giữa phiên (khoá DataProtection giữ nguyên). Đây là cấu hình harness, không phải repo.

### Lỗi thật do acceptance/rà soát tìm ra và đã sửa (đều ở allowlist)
1. Vuốt ngang trên hero mobile kích hoạt cử chỉ overscroll của Chrome và **quay lại trang trước** → khung hero `touch-pan-y`.
2. `/blog/<slug lạ>` trả trang not-found với **HTTP 200** (bị cache) → `dynamicParams = false` (404 thật).
3. Ô tìm kiếm gọn cao 76 px, tràn header 64 px ở 390 px (lớp `block` huỷ `line-clamp-1` trong component ngoài allowlist) → bọc ở `MainNav2`; báo ở §8.
4. `DropdownTravelers` của template lồng `role="button"` trong `<button>` → bỏ.
5. Hai liên kết (“Các loại phòng”, “Xem phòng còn trống”) tương phản 2,8:1 ở chế độ tối → thêm `dark:text-primary-300`; dòng thuyết minh newsletter 4,32:1 → 4,5:1+.
6. Tải lại khi đã lưu chế độ tối nhấp nháy sáng (template áp class trong effect) → snippet hằng ở `SiteHeader` (§7).

### FINDING kế thừa (không phải hồi quy C2; ngoài allowlist, giữ nhãn)
- 24/23 nút của `GallerySlider` ở card phòng không có tên truy cập (đã là FINDING của C0).
- Trang `not-found` là bản template tiếng Anh (“THE PAGE YOU WERE LOOKING FOR DOESN'T EXIST.” / “Return Home Page”); nhãn tiếng Anh trên trang phòng và modal tìm kiếm mobile (“When's your trip?”, “Previous Month”, “Up to 4 guests”, “Hold this room”…).
- `/login`, `/signup`, `/account-savelists` không có H1 (tiêu đề là H2 trong markup template).
- Chữ xám của form tìm kiếm (“Chỗ nghỉ”, “Nhận phòng - Trả phòng”, “1 phòng”) 2,54:1 (`text-neutral-400` của template).
- C1: FINDING “Esc không đóng menu khi logout đang pending vì focus rơi về `<body>`” **đã được xử lý trong C2**: nút logout bị gỡ khi phiên thành anonymous, nên focus được đặt lại vào nút tài khoản trước khi chạy lệnh; E-A (desktop + mobile) và D5 chứng minh Esc đóng menu và focus ở nút tài khoản. Báo cáo C0/C1 giữ nguyên làm lịch sử.

### NOT_RUN
Nhấp ra ngoài drawer ở 390 px (panel `max-w-md` rộng hơn màn hình, không có vùng ngoài; đã kiểm tra nút đóng và Esc; click ngoài được kiểm tra ở 768 px); đăng xuất sau khi đóng receipt ở suite F (đã có ở CP02/CP04; C2 chỉ yêu cầu từ chối khi đang có booking). Chưa chạy: production/proxy Vercel, cookie/CSRF trên host thật, deploy.

## 7. Quyết định cần Owner/OC biết
- **Snippet chủ đề ở `SiteHeader`:** một chuỗi hằng (cùng khoá `theme` và class `dark` với `utils/useThemeMode`, không nội suy gì) chạy khi trang đang được parse, trước first paint; hook vẫn là chủ sở hữu state/toggle. Cần `dangerouslySetInnerHTML` (chuỗi cố định). Không có CSP trong repo (`next.config.js`, middleware; response không có header CSP). `<html>` có thêm class `dark` mà server không render; không có cảnh báo hydration ở production (suite G).
- **Ngữ nghĩa nút sáng/tối:** nút của header đặt tên theo hành động (“Bật chế độ tối” / “Bật chế độ sáng”) và không dùng `aria-pressed` (nhãn đổi + `aria-pressed` là tổ hợp sai theo APG); ngữ nghĩa `switch` (`aria-checked`, tên cố định “Chế độ tối”) nằm ở menu tài khoản.
- **“Giao diện mẫu” và “Dịch vụ”:** vẫn dẫn tới route template (có nhãn “Mẫu”, ghi chú “chưa có dữ liệu thật”); “List your property” và chuông thông báo của MainNav2 gốc **không** render vì không có tính năng/dữ liệu phía sau. Ngoài ra không còn “Customize”, “Get Template”, NextAuth demo. So sánh với `b6e28a6` là so sánh cấu trúc theo source (cụm phải: Templates, Lang, Notify, Avatar; Travelers bên trái), không phải so ảnh.

## 8. Ngoài allowlist (không sửa, hoặc sửa tối thiểu có giải thích)
- **Không sửa:** `src/app/paydone/PayDoneReceipt.tsx:128` còn `href="/#rooms"` (nút “Xem các loại phòng” khi không có hold). Tái hiện: mở `/paydone` khi chưa có hold → bấm nút → `/#rooms`. Hiện rơi vào đoạn Riverside của trang chủ (giữ `id="rooms"`, có link “Các loại phòng” → `/riverside#rooms`), vì vậy không chết. Thay đổi tối thiểu OC có thể duyệt: `href="/riverside#rooms"`. `src/app/(client-components)/(HeroSearchForm2Mobile)/HeroSearchForm2Mobile.tsx`: lớp `block` đứng cùng `line-clamp-1` làm tiêu đề ô tìm kiếm gọn tràn nhiều dòng khi hàng hẹp; C2 chỉ bọc ở `MainNav2`; sửa tối thiểu là bỏ `block` ở hai `<span>`. `GallerySlider`, `not-found`, trang login/signup/savelists: xem FINDING.
- **File mới không được liệt kê trong allowlist (giải thích, kích thước nhỏ, cùng thư mục tính năng):** `(home)/HomeSlider.tsx`, `(home)/OfferCard.tsx`, `(home)/HomeRiversideTeaser.tsx`, `(home)/HomePage.test.ts`, `blog/PostCard.tsx`, `offers/OfferHighlightScroller.tsx` (allowlist nêu `OffersContent.tsx` tuỳ chọn), `(Header)/BlogNavDropdown.tsx`, `lib/heroCarousel.ts` + test (quyết định autoplay thuần để test), `RoomDetailsRoot.test.ts` (đổi kỳ vọng `/#rooms` → `/riverside#rooms` do retarget `ShowcaseNavLink`).
- Các component blog cũ của template (`Card12/13`, `SectionMagazine5`, `SectionLatestPosts`, `Widget*`) còn trong repo nhưng không còn được route nào render.

## 9. Checks (chạy trong phiên này, từ `Front_End/Customer_Web`, cây `5acb2f56…`)
`npm ci` (exit 0) · `npx vitest run` 49 file / 1141 test pass (C2 thêm 7 module và 7 file test mới, cập nhật 2 file test CP08a; test chạy module/trang thật, không sao chép markup) · `npx tsc --noEmit -p .` sạch · `npm run lint` không cảnh báo · `npm run build` exit 0 (production build chạy acceptance) · `git diff --check origin/develop...HEAD`, quét secret/email/credit, kiểm tra allowlist: kết quả ở handoff.

## 10. Handoff cho Owner (preview)
Route cần xem: `/`, `/riverside`, `/offers`, `/blog`, `/blog?category=diem-den-noi-bat`, `/blog/diff-2026-khep-lai`, menu desktop và drawer mobile, nút sáng/tối. Migration: **NONE**, không biến môi trường mới. Chưa làm: lưu/gửi newsletter, giảm giá thật, House/Villa, chuyển đổi ngôn ngữ/tiền tệ. Không đóng gate launch nào; `OWNER_VISUAL_ACCEPTANCE_C2` đang chờ Owner.

## 11. Dọn dẹp
Dừng đúng các tiến trình của task (đọc PID từ `ss -ltnp` sau khi kiểm tra cmdline), xoá container PostgreSQL của task theo tên duy nhất và thư mục harness; container `the-bha-postgres-1` của Owner không bị đụng.
