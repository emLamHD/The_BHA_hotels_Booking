# CUST-WEB-001 — Customer Web: hợp đồng sản phẩm và release

- **Work item:** `CUST-WEB-001-CP00` (`CP00_AUDIT_PRODUCT_CONTRACT`), implementer `CLAUDE`, reviewer `CODEX_READ_ONLY`.
- **Baseline:** `develop` = `2ad2bc967735931a9390112d796c3cdd870ed1df` (merge PR #106), ngày audit `2026-10-13`.
- **Trạng thái tài liệu:** `PROPOSAL`. Đây là đầu ra audit để OC viết Master Execution Prompt cho các PR triển khai. **Không** phải hợp đồng đã được Owner duyệt. Mọi quyết định ở §5 là `OPEN` cho đến khi Owner chốt (có ghi evidence).
- **Phạm vi:** Customer frontend (`Front_End/Customer_Web/`) dựa trên template Chisfis hiện hữu và các API `Back_End/` mà nó gọi. Không mở rộng Calendar/Admin, lifecycle/folio, Backend CD, hosting, payment, CMS, OTA.
- **Template:** giữ composition, component, typography, spacing và interaction của Chisfis. Không thay bằng landing page mới.

## 0. Quyết định Owner về kích thước PR (nguyên văn, hiệu lực cho mọi PR và correction của initiative)

Quyết định Owner mới nhất, 2026-10-13:

> “Keep each PR to one reviewable concern: aim for under ~400 lines of hand-written logic, excluding generated files, lockfiles, snapshots and pure markup/styles. Put renames, moves and formatting in a separate PR marked "no behavior change".”

Áp dụng trong initiative này:

- Một PR một concern review được; test/docs trực tiếp phục vụ concern đó đi kèm.
- Mục tiêu dưới ~400 dòng logic viết tay (additions + deletions). Logic test viết tay tính vào logic. JSX có xử lý/state/condition/event/permission/request vẫn là logic. Generated file, lockfile, snapshot và markup/style thuần không tính vào mục tiêu nhưng vẫn nằm trong diff và vẫn phải review.
- Đây là mục tiêu, không phải hard cap, và không có mức tối thiểu. Report của mỗi PR ghi tổng additions/deletions từ GitHub, `git diff --numstat`, và ước lượng logic kèm cách phân loại.
- Đổi tên, di chuyển file, formatting thuần: PR riêng, title/body ghi “no behavior change”.
- Quyết định này thay tiêu chí 100–400 dòng toàn PR ở `docs/governance/WORKFLOW.md` §6 và `AGENTS.md` §13. Hai file đó **vẫn còn wording cũ** tại baseline; CP00 giữ governance read-only và đề xuất đồng bộ bằng một work item riêng (xem §9), không gộp vào concern này.

**Cập nhật quyết định Owner, 2026-10-13 (Master Execution Prompt `CUST-WEB-001-CP01b`):** Owner bỏ mọi giới hạn và mục tiêu số dòng PR trước đây; áp dụng ngay cho `CP01b` và các checkpoint/correction tiếp theo của `CUST-WEB-001`, thay các tiêu chí kích thước ở trên, trong MEP cũ và trong governance (governance vẫn read-only trong CP01b; đề xuất đồng bộ ở §9 giữ nguyên). Mỗi PR vẫn có đúng một concern review được, cùng test/docs trực tiếp phục vụ concern đó; chia theo dependency, hành vi và khả năng review, không chia để đạt một số dòng. Report ghi additions/deletions từ GitHub và `git diff --numstat`; số dòng không phải gate PASS/BLOCKED. Đổi tên/di chuyển/format thuần vẫn tách PR “no behavior change”. Các ước lượng “logic dự kiến” ở §6 là thông tin lập kế hoạch lịch sử, không còn là mục tiêu.

## 1. Phương pháp và quy ước evidence

- Mọi dòng ở §2–§4 được đọc từ source tại `2ad2bc9`. Nhãn bằng chứng: **`SOURCE_ONLY`** (đọc code/test, chưa chạy) hoặc **`RUNTIME_VERIFIED_AT_SHA`** (có chạy trên build của đúng SHA đó).
- **CP00 không chạy trình duyệt, build hay test**, nên **không dòng nào là `RUNTIME_VERIFIED_AT_SHA` tại `2ad2bc9`**. Evidence trình duyệt trong `docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md` (§10, §12, §13) gắn với các SHA cũ hơn (`1b7e581`, `2d4dc8d` và các head C3/C4); không tính là evidence của baseline này.
- Trạng thái: `REAL_INTEGRATED` (gọi backend thật, dữ liệu do server sở hữu), `TEMPLATE_ONLY` (dữ liệu/hành vi mẫu của template), `MIXED` (một phần thật, một phần mẫu), `MISSING` (chưa có), `UNVERIFIED` (source chưa đủ để kết luận).
- Một page render được **không** là DONE. DONE theo journey ở §3 cần evidence của build bàn giao.
- Quy ước tham chiếu: đường dẫn tương đối `Front_End/Customer_Web/` nếu bắt đầu bằng `src/`, `scripts/`, hoặc là tên file; `Back_End/...` ghi đủ. `file:line` là dòng tại baseline.

## 2. A — Inventory hiện tại (`SOURCE_ONLY @ 2ad2bc9`)

### 2.1 Shell dùng chung (mọi trang)

| ID | Thành phần | Tiếp cận (desktop / mobile) | Hành vi | Data authority | API / ownership | Trạng thái | Evidence |
|---|---|---|---|---|---|---|---|
| S01 | Root layout | mọi trang | `lang="vi"`; bọc `BookingHoldProvider` → `StaySearchProvider`; `HoldReceiptRedirector`, `TemplateDemoNotice`, `SiteHeader`, `FooterNav`, `Footer`. Metadata chỉ ở root và `/paydone`: không canonical, robots, sitemap, OG | n/a | n/a | MIXED | `src/app/layout.tsx`; `grep metadata` chỉ `app/layout.tsx`, `app/paydone/page.tsx`; không có `robots`/`sitemap` trong `src/app` và `public/` |
| S02 | `TemplateDemoNotice` | mọi trang | Dải chữ nói phòng/giá/đặt phòng Riverside là thật, phần còn lại là mẫu | tĩnh | n/a | TEMPLATE_ONLY (cố ý, của quyết định demo C3) | `src/components/TemplateDemoNotice.tsx` |
| S03 | Header mặc định `Header 2` / `MainNav2` | desktop ≥lg: logo, `DropdownTravelers` (Stays / Real Estate / Cars / Experiences → `/listing-*`), `TemplatesDropdown` (toàn bộ `NAVIGATION_DEMO_2`), `LangDropdown`, “List your property” → `/add-listing`, `NotifyDropdown`, `AvatarDropdown`. Mobile <lg: ô tìm kiếm mobile + `NotifyDropdown` + `AvatarDropdown` + `MenuBar` | Điều hướng đa dịch vụ của template | tĩnh | không | TEMPLATE_ONLY | `src/app/(client-components)/(Header)/MainNav2.tsx`, `DropdownTravelers.tsx`, `TemplatesDropdown.tsx`, `src/data/navigation.ts` (`NAVIGATION_DEMO_2`) |
| S04 | `SiteHeader` bảng “Customize” (Header Styles, Home Demos → `/`, `/home-2`, `/home-3`) | **chỉ desktop** (`hidden lg:block`, nút cog cố định bên phải) | Đổi kiểu header, nhảy sang home demo | tĩnh | không | TEMPLATE_ONLY | `SiteHeader.tsx` (`renderControlSelections`, `renderRadioHomePages`) |
| S05 | `AvatarDropdown` (desktop + mobile) | cả hai | Hiển thị **“Eden Smith / Los Angeles, CA”**, “My Account” → `/account`, “My bookings” → `/author`, “Wishlist” → `/account-savelists`, “Help” và “Log out” đều là `href="/#"`; luôn như đã đăng nhập, không gọi API | demo | không | TEMPLATE_ONLY | `AvatarDropdown.tsx` |
| S06 | `NotifyDropdown`, `LangDropdown`, `CurrencyDropdown` | desktop + mobile (Notify); desktop (Lang) | Mục thông báo/ngôn ngữ/tiền tệ mẫu, `href="##"`; không đổi ngôn ngữ hay quy đổi | demo | không | TEMPLATE_ONLY | `NotifyDropdown.tsx`, `LangDropdown.tsx` (`href: "##"`) |
| S07 | `MenuBar` → `NavMobile` | mobile | Menu `NAVIGATION_DEMO` đa dịch vụ; nút **“Get Template”** → `themeforest.net` | tĩnh | không | TEMPLATE_ONLY | `src/shared/Navigation/NavMobile.tsx:133`, `src/data/navigation.ts` |
| S08 | `FooterNav` (thanh dưới mobile) | mobile | Explore `/`, Wishlists `/account-savelists`, **“Log in” → `/account`** (không phải `/login`), Menu | tĩnh | không | TEMPLATE_ONLY | `src/components/FooterNav.tsx` |
| S09 | `Footer` | cả hai | 5 cột nội dung SaaS mẫu (“Installation”, “Release Notes”, “Design systems”…), mọi link `#`; không có liên hệ/chính sách The BHA | tĩnh | không | TEMPLATE_ONLY | `src/components/Footer.tsx` |
| S10 | `SocialsList` | `/contact`, footer | Facebook/Twitter/Youtube/Instagram, `href="#"` | tĩnh | không | TEMPLATE_ONLY | `src/shared/SocialsList.tsx` |
| S11 | `Logo` | cả hai | `alt="The BHA Riverside"` | asset | n/a | UNVERIFIED (quyền dùng) | `src/shared/Logo.tsx` |

### 2.2 Route

| ID | Route | Tiếp cận | Hành vi / CTA / form | Data authority | API / ownership | Trạng thái | Evidence |
|---|---|---|---|---|---|---|---|
| P01 | `/` | trực tiếp | Home Chisfis: hero + form tìm (xem F01–F02), `SectionSliderNewCategories` (thành phố mẫu “New Yourk”, “Paris”…, `count: 188288`, ảnh Pexels), `SectionOurFeatures`, **`HomeFeaturedRooms` (thật)**, `SectionHowItWork`, slider “Suggestions…”, `SectionSubscribe2` (form không submit), `SectionGridAuthorBox`, `SectionGridCategoryBox`, `SectionBecomeAnAuthor`, `SectionVideos`, `SectionClientSay`. Hero CTA “Start your search” → `/listing-stay-map` (template) | MIXED | catalog/availability từ API ở phần Featured; còn lại tĩnh | MIXED | `src/app/page.tsx`, `src/app/(server-components)/SectionHero.tsx` |
| P02 | `/listing-stay`, `/listing-stay-map` | `DropdownTravelers`, `TemplatesDropdown`, `NavMobile`, hero CTA | Grid `StayCard2` từ `DEMO_STAY_LISTINGS` (8–12 thẻ, giá `$`, rating mẫu), `TabFilters`, `Pagination` tĩnh; mỗi thẻ link `/listing-stay-detail` **không kèm id** → trang báo “Chưa chọn phòng” | `src/data/listings.ts`, `data/jsons/__stayListing.json` | không | TEMPLATE_ONLY | `src/app/(stay-listings)/SectionGridFilterCard.tsx`, `SectionGridHasMap.tsx`, `__stayListing.json` (`"href": "/listing-stay-detail"`) |
| P03 | `/listing-stay-detail?propertyId=&roomTypeId=` | thẻ Featured, link “Loại phòng khác”, link chia sẻ | Phòng thật: gallery, mô tả, tiện ích, giờ nhận/trả, panel đặt phòng (F03–F06). Sao đánh giá là **mẫu** (`title="Đánh giá mẫu…"`). Trạng thái: missing/invalid id, loading, error + “Thử lại”, unknown-property, unknown-room-type | server (catalog) | `GET /api/v1/properties`, `GET /api/v1/properties/{id}/room-types` (xem §4) | REAL_INTEGRATED (+ rating mẫu) | `src/app/(listing-detail)/listing-stay-detail/RoomDetailsRoot.tsx`, `RoomDetailsContent.tsx`, `src/lib/roomDetailsRoute.ts` |
| P04 | `/paydone` (+ `/pay-done`, `/showcase` redirect) | tự động sau hold; “Xem xác nhận” | Biên nhận đọc **chỉ từ state trong bộ nhớ tab**: “Đã giữ chỗ” → “Xác nhận đặt phòng” → “Đặt phòng đã xác nhận”; nút gửi lại xác nhận; khi reload/mở thẳng → thông báo “Chưa có đặt phòng để hiển thị” | server (hold/reservation trả về) | `POST /booking-holds/{id}/confirm` | REAL_INTEGRATED, không bền qua reload | `src/app/paydone/PayDoneReceipt.tsx`, `src/components/HoldReceiptRedirector.tsx`, `src/lib/routePolicy.ts` (`TEMPLATE_RECEIPT_ALIAS`) |
| P05 | `/checkout` | `TemplatesDropdown`, `NavMobile` (“Checkout”) | Form thẻ/Paypal mẫu (“$19 x 3 day”, “Pay with”, “Card number”), nút **“Confirm and pay”** → `/pay-done` → chuyển tới `/paydone` (biên nhận thật hoặc thông báo rỗng). UI gợi ý có thanh toán | tĩnh | không | TEMPLATE_ONLY (gây hiểu lầm) | `src/app/checkout/PageMain.tsx` |
| P06 | `/login` | `TemplatesDropdown`, `NavMobile` | `<form action="#" method="post">`, input không `name`, nút “Continue”; “Continue with Facebook/Twitter/Google” `href="#"`; “Forgot password” → `/login` | không | không gọi `Back_End` | TEMPLATE_ONLY | `src/app/login/page.tsx` |
| P07 | `/signup` | như trên | Form giống P06 (`action="#"`); social `#` | không | không | TEMPLATE_ONLY | `src/app/signup/page.tsx` |
| P08 | `/account` | AvatarDropdown, FooterNav | Form hồ sơ với giá trị mẫu (“Eden Tuan”, `example@email.com`, “New york, USA”), nút “Update info” | demo | không | TEMPLATE_ONLY | `src/app/(account-pages)/account/page.tsx` |
| P09 | `/account-password`, `/account-billing`, `/account-savelists` | tab của `(account-pages)/layout` | Đổi mật khẩu, “Add payout mothod”, danh sách lưu = `DEMO_*_LISTINGS`; không submit | demo | không | TEMPLATE_ONLY | các `page.tsx` cùng thư mục |
| P10 | `/contact` | `NavMobile`, `TemplatesDropdown` | **Địa chỉ/email/điện thoại mẫu** (“Photo booth tattooed prism…”, `nc.example@example.com`, `000-123-456-7890`), form `action="#"`, `SocialsList` | tĩnh | không | TEMPLATE_ONLY | `src/app/contact/page.tsx` |
| P11 | `/about` | như trên | Nội dung mẫu (“We’re impartial and independent…”), `SectionFounder`, `SectionStatistic`, `SectionClientSay`, `SectionSubscribe2` | tĩnh | không | TEMPLATE_ONLY | `src/app/about/page.tsx` |
| P12 | `/subscription`, `/author`, `/blog`, `/blog/[...slug]`, `/add-listing/[[...stepIndex]]` | `NavMobile`, `TemplatesDropdown`, AvatarDropdown (“My bookings” → `/author`) | Trang mẫu; “Submit” và form add-listing không gửi đi đâu; `/author` liệt kê `DEMO_*` | demo | không | TEMPLATE_ONLY | `src/app/subscription/page.tsx`, `author/page.tsx`, `blog/**`, `add-listing/**` |
| P13 | `/home-2`, `/home-3`, `/listing-experiences*`, `/listing-car*`, `/listing-real-estate*`, `/listing-flights`, `/listing-*-detail` | menu, bảng Customize (desktop) | Home/danh sách/chi tiết các dịch vụ khác của template | demo | không | TEMPLATE_ONLY | `src/app/(home)/home-2|home-3`, `(experience-listings)`, `(car-listings)`, `(real-estate-listings)`, `(flight-listings)`, `(listing-detail)` |
| P14 | `/api/hello`, `/api/hello/auth/[...nextauth].ts` | không có link; chỉ gõ URL | Stub của template (`Hello, Next.js!`; NextAuth GitHub/Google). **Không tiếp cận được ở cả hai chế độ proxy**: không có proxy → middleware trả 404; có proxy → `rewrites().beforeFiles` chuyển tới API, API trả 404 | n/a | n/a | TEMPLATE_ONLY (mã chết, vô hại) | `src/app/api/hello/**`, `src/middleware.ts`, `next.config.js` |
| P15 | `/showcase-unavailable` | đích rewrite của path bị chặn | Trang 404 | n/a | n/a | REAL_INTEGRATED (chức năng 404) | `src/app/showcase-unavailable/page.tsx`, `src/lib/routePolicy.ts` (`UNAVAILABLE_PAGE`) |

### 2.3 Thành phần luồng đặt phòng

| ID | Thành phần | Tiếp cận | Hành vi | Data authority | API / ownership | Trạng thái | Evidence |
|---|---|---|---|---|---|---|---|
| F01 | Form tìm kiếm hero (desktop) | `/` chỉ khi ≥lg (`hidden lg:block`) | Tab Stays/Experiences/Cars/Flights; chỉ tab Stays nối `StaySearchProvider` (địa điểm = 3 nhãn thương hiệu, ngày, khách); các tab khác là mẫu | draft ở client | availability (khi submit) | MIXED | `HeroSearchForm.tsx`, `(stay-search-form)/StaySearchForm.tsx` |
| F02 | Form tìm kiếm mobile | header mobile mọi trang | Cùng draft dùng chung, gọi `stay.submit()` | draft ở client | availability | REAL_INTEGRATED | `(HeroSearchForm2Mobile)/HeroSearchForm2Mobile.tsx` |
| F03 | `StaySearchProvider` | root | Đọc catalog Riverside **một lần** (`ensureCatalog`), tìm availability chỉ cho **The BHA Riverside** (slug `the-bha-riverside`); House/Villa không gọi API; kết quả chỉ nằm trong **state bộ nhớ**, **không nằm trên URL** của trang `/` | server | `GET /properties`, `/properties/{id}/room-types`, `/properties/{id}/availability` | REAL_INTEGRATED, Riverside-only | `src/components/StaySearchProvider.tsx`, `src/lib/featuredBrands.ts` |
| F04 | `HomeFeaturedRooms` | `/` (`#rooms`) | 3 tab thương hiệu tĩnh; Riverside = `RoomTypeStayCard` với trạng thái giá: `quoted` / `none` (“Chọn ngày để xem giá”) / `unavailable` (“Hết phòng cho ngày đã chọn”) / `loading`; House & Villa hiển thị **“Sắp ra mắt — chưa hỗ trợ đặt phòng trực tuyến.”**; banner “đặt phòng đang thực hiện” | server | như F03 | REAL_INTEGRATED | `src/app/(home)/HomeFeaturedRooms.tsx`, `src/components/RoomTypeStayCard.tsx`, `src/lib/roomQuote.ts` |
| F05 | `SectionAvailabilitySearch` + `BookingHoldPanel` | panel của P03 | Tìm availability khóa theo RoomType; chọn offer; form liên hệ (`fullName`, `email`, `phone`; focus vào ô lỗi đầu tiên); tạo hold; xác nhận. Còn **chuỗi tiếng Anh** (“No offers … matched”, “Showing offers for”) | server | `GET availability`, `POST /booking-holds` | REAL_INTEGRATED, ngôn ngữ MIXED | `src/app/(home)/SectionAvailabilitySearch.tsx:561,570`, `src/components/BookingHoldPanel.tsx` |
| F06 | `BookingHoldProvider` + controller + reducer | root | Một state máy duy nhất: `idle → selected → submitting → active-session → confirming → reservation-result` cộng `known-error`, `uncertain`, `confirm-known-error`, `confirm-uncertain`. **Chỉ trong bộ nhớ**; reload/đóng tab là mất. Lỗi mạng/không phân loại ⇒ `uncertain` (gửi lại **đúng** request cũ); lỗi HTTP ⇒ `known-error`. Thông báo lỗi còn tiếng Anh (“Something went wrong while creating your Hold.”) | client memory | `POST /booking-holds` (có `Idempotency-Key`), `POST /booking-holds/{id}/confirm` (không có) | REAL_INTEGRATED | `src/app/BookingHoldProvider.tsx`, `src/lib/api/bookingHoldFlow.ts`, `bookingHoldFlowController.ts` (`describeError`), `bookingHoldService.ts` |
| F07 | `LikeSaveBtns` | P03 | Nút tim/lưu ghi **`localStorage`** theo `roomType.id`; chia sẻ link (không chứa PII) | thiết bị | không | MIXED (cục bộ; `/account-savelists` hiển thị dữ liệu mẫu khác) | `src/components/LikeSaveBtns.tsx` |
| F08 | `StartRating sample` | thẻ phòng, P03, P04 | Sao đánh giá mẫu có `title` ghi “mẫu” | tĩnh | không | TEMPLATE_ONLY | `src/components/StartRating.tsx`, `RoomDetailsContent.tsx`, `PayDoneReceipt.tsx` |

### 2.4 Cắt ngang

| ID | Hạng mục | Hiện trạng | Evidence |
|---|---|---|---|
| X01 | Chính sách route | `decideRoute`: `/` live; `/showcase` → `/`; `/pay-done` → `/paydone`; media `/media/the-bha-riverside/<kebab>.webp` pass; **mọi trang khác pass** (template mở); `/api/*` `unavailable` **trừ khi** build có `API_PROXY_ORIGIN` (cờ `BHA_API_PROXY_ENABLED` được nướng lúc build). Tiền tố proxy khớp phân biệt hoa/thường nên `/API/x` vẫn bị chặn. Comment đầu `routePolicy.ts` (“`/api/*` is never a capability”) và `middleware.ts` (“`/api/*` is rewritten to the unavailable page”) là **bản mô tả cũ**, chỉ đúng khi không có proxy | `src/lib/routePolicy.ts`, `src/middleware.ts`, `next.config.js`, `src/lib/routePolicy.test.ts` (`describe("with the API proxy enabled…")`), `src/lib/api/__tests__/apiProxyConfig.test.ts` |
| X02 | API client | `axios`, `withCredentials: true`, base `NEXT_PUBLIC_API_BASE_URL` (bắt buộc `https://`, không credentials/query). Có service cho properties, room-types, availability, csrf, booking-holds (create, confirm). **Không có** client cho `auth/*` và `reservations/*`, không gọi `GET /booking-holds/{id}` hay các `cancel` | `src/lib/api/*.ts`; `grep "auth/"` chỉ thấy `csrf.ts`; không có file service cho reservations **Cập nhật CP01a (2026-10-13):** đã có `src/lib/api/authService.ts` (`getCustomerSession`, `registerCustomer`, `loginCustomer`, `logoutCustomer`) và `src/app/CustomerSessionProvider.tsx` mount ở root, chỉ đọc `me`; **chưa có UI nào gọi** register/login/logout, header/account vẫn là template. |
| X03 | CSRF helper | Lấy token lazy, cache trong bộ nhớ; retry **một lần** chỉ khi khớp chính xác `400 / "Invalid antiforgery token" / "A valid antiforgery token is required for this operation."`. `invalidateCsrfToken()` **chỉ được gọi trong retry** (`csrf.ts:99`); chưa có ai gọi khi login/logout | `src/lib/api/csrf.ts:66,99` **Cập nhật CP01a:** `invalidateCsrfToken()` nay tăng một generation, bỏ cả token cache lẫn acquisition đang chờ; acquisition cũ không được cache, không xoá acquisition mới, và caller đang chờ nó lấy token của generation hiện tại trước POST đầu tiên. `authService` gọi nó sau login/logout (kể cả mất phản hồi); provider gọi khi `refreshSession`. |
| X04 | Lưu trữ phía trình duyệt | `localStorage`: `LikeSaveBtns` (khóa theo roomType), `useThemeMode`. Không lưu hold, token khách, PII hay contact | `grep localStorage|sessionStorage` chỉ `LikeSaveBtns.tsx`, `useThemeMode.ts` |
| X05 | Ngôn ngữ | `<html lang="vi">`; copy luồng đặt phòng chủ yếu tiếng Việt; template (menu, hero, footer, account…) và vài chuỗi luồng đặt phòng còn tiếng Anh; không có i18n | `layout.tsx`; `SectionAvailabilitySearch.tsx:561,570`; `bookingHoldFlowController.ts` (`describeError`) |
| X06 | Tiền tệ | Hiển thị theo `currencyCode` của server (`formatCurrencyAmount`); `CurrencyDropdown`/`LangDropdown` là mẫu, không quy đổi | `src/lib/api/availabilityPresentation.ts`, `LangDropdown.tsx` |
| X07 | Media | 31 ảnh Riverside tĩnh trong `public/media/the-bha-riverside/`; `manifest.json`: 86 gốc, 31 publish, 55 loại; `MEDIA_PROVENANCE: UNVERIFIED`, `validation: NOT_RUN`, publish theo quyết định Owner 2026-10-07. Ảnh/asset còn lại là của template (Pexels/Unsplash/muscache, `hero-right.png`…) | `scripts/riverside-media/manifest.json`, `src/app/page.tsx` (`DEMO_CATS*`), `next.config.js` (`images.remotePatterns`) |
| X08 | Bản quyền template | README gốc chỉ có credit tác giả, **không có license text**; không có `LICENSE` trong `Front_End/Customer_Web/` hay root (chỉ `Front_End/Admin_Web/LICENSE`, thuộc Admin template). Ghi nhận cũ trong `docs/design/DATA-001.1-sellable-catalog-media-source-of-truth.md` (mục “Correction (Tech Lead rights-evidence review…)”) vẫn đúng ở baseline | `Front_End/Customer_Web/README.md`, DATA-001.1 |
| X09 | Test hiện có | `vitest` (31 file theo CP02-C3 report; CP00 không chạy lại). Bao phủ logic search/route/hold-flow/csrf/proxy; **không có test cho các trang template, auth hay reservations** vì chưa có | `src/**/*.test.ts`, `src/lib/api/__tests__/` |
| X10 | Dependency không dùng | `next-auth` được khai báo, chỉ dùng bởi stub `app/api/hello/auth/[...nextauth].ts`; Customer session thật là cookie của `Back_End`, **không** dùng NextAuth | `package.json`, `src/app/api/hello/auth/[...nextauth].ts` |

## 3. B — Sitemap đích và journey

### 3.1 Sitemap đề xuất (hotel/stay) — `PROPOSAL`, chờ DP-01

| Nhóm | Route đích | Nguồn |
|---|---|---|
| Khám phá | `/` (Chisfis home, nội dung The BHA); `/listing-stay` (kết quả thật, URL mang tham số tìm kiếm); trang thương hiệu/chỗ nghỉ | catalog API |
| Chọn phòng | `/listing-stay-detail?propertyId=&roomTypeId=` (giữ nguyên identity hiện tại) | catalog + availability API |
| Đặt phòng | panel đặt phòng → `/paydone` (biên nhận) | booking API |
| Tài khoản | `/signup`, `/login`, `/account` (chỉ đọc), tuỳ DP-05: “Đặt phòng của tôi” | auth API |
| Thương hiệu / hỗ trợ | `/about`, `/contact`, FAQ, chính sách đặt/hủy, quyền riêng tư, điều khoản | nội dung do Owner cấp |
| Loại khỏi điều hướng thương mại | `/home-2`, `/home-3`, `/listing-car*`, `/listing-experiences*`, `/listing-real-estate*`, `/listing-flights`, `/author`, `/blog*`, `/subscription`, `/add-listing*`, `/checkout`, `/account-billing`, bảng Customize, “Get Template”, `NotifyDropdown`, `Lang/CurrencyDropdown` | DP-01, DP-02 |

Quyết định đang hiệu lực mà đề xuất này sẽ thay: `docs/project/PROJECT_BIBLE.md` §14.1 (Template, C3, Owner 2026-10-07) giữ **toàn bộ** template (Cars, Flights, Experiences, Real Estates…) để demo, `/api/*` đóng. Thay đổi chỉ có hiệu lực khi Owner duyệt DP-01.

### 3.2 Ánh xạ section Chisfis → nội dung The BHA đã xác minh

Nguyên tắc: giữ component; thay dữ liệu bằng dữ liệu thật hoặc bỏ section khi chưa có nguồn thật. Không tạo rating, review, lời chứng thực, thống kê hay tên người.

| Section (home) | Hiện tại | Đề xuất | Nguồn hợp lệ / input còn thiếu |
|---|---|---|---|
| `SectionHero` | “Hotel, car & experiences”, ảnh `hero-right.png`, CTA `/listing-stay-map` | Tiêu đề/mô tả The BHA; CTA cuộn tới `#rooms`/tìm kiếm; ảnh Riverside | OWNER_INPUT: tagline, mô tả; ảnh dùng được (X07, DP-09) |
| `SectionSliderNewCategories` (`DEMO_CATS`) | Thành phố mẫu | Thẻ thương hiệu/chỗ nghỉ (Riverside thật; House/Villa theo DP-03) hoặc bỏ | property từ API |
| `SectionOurFeatures` | Chữ mẫu | Tiện ích thật của Property (API: hồ bơi sân thượng, sân thượng) | `RiversideDemoCatalog.PropertyAmenities` (`Back_End/src/TheBha.Infrastructure/Persistence/Demo/RiversideDemoCatalog.cs`, Owner-stated); phần còn lại OWNER_INPUT |
| `HomeFeaturedRooms` | Thật | Giữ | API |
| `SectionHowItWork` | Chữ mẫu | Mô tả đúng luồng thật: chọn ngày → giữ chỗ (15 phút) → xác nhận; **chưa thanh toán trực tuyến** | `InventoryHold.Lifetime = 15 phút` (`Back_End/src/TheBha.Domain/Bookings/InventoryHold.cs:15`); chính sách thanh toán = OWNER_INPUT |
| Slider “Suggestions for discovery” (`DEMO_CATS_2`) | Mẫu | Bỏ, hoặc gợi ý khu vực khi Owner cấp | OWNER_INPUT |
| `SectionSubscribe2` (form), `/about`, `/subscription` | Không submit | Bỏ khi chưa có API (C06) | NEEDS_BACKEND |
| `SectionGridAuthorBox`, `SectionBecomeAnAuthor`, “List your property” | Host/tác giả mẫu | Bỏ | DP-01 |
| `SectionGridCategoryBox`, slider “Explore by types of stays”, `SectionVideos` | Mẫu | Bỏ, hoặc thay bằng nội dung Owner cấp | OWNER_INPUT |
| `SectionClientSay`, `SectionFounder`, `SectionStatistic` | Lời chứng thực/thống kê mẫu | Bỏ cho đến khi có nguồn thật | DP-04 |
| `Footer`, `FooterNav`, `AvatarDropdown` | Mẫu SaaS / demo identity | Footer The BHA (liên hệ, chính sách); menu thật theo CP02 | DP-04, DP-05 |

### 3.3 Journey

Mỗi journey: **Entry · URL identity · Data authority · Next action · Trạng thái bắt buộc · Mobile/bàn phím/focus · DONE evidence**. “DONE evidence” luôn nghĩa là bằng chứng trên build bàn giao của checkpoint đó (§8), không phải source.

| ID | Journey | Entry · URL identity · Data authority · Next action | Trạng thái bắt buộc | Mobile / bàn phím / focus | DONE evidence |
|---|---|---|---|---|---|
| J01 | Khám phá chỗ nghỉ | Home / trang thương hiệu. Identity: slug hoặc `propertyId`. Authority: `GET /properties`. Next: chọn ngày/khách hoặc mở phòng | loading, empty (không có property), error + thử lại, “Sắp ra mắt” cho property chưa bookable, 404 cho property không tồn tại | Ô tìm kiếm mobile ở header; tab thương hiệu điều khiển được bằng bàn phím; focus không bị mất khi nội dung tải xong | Trình duyệt desktop+mobile; request thật; trạng thái lỗi bằng cách ngắt API |
| J02 | Ngày / khách / số phòng | Form tìm kiếm. Identity: `checkIn,checkOut,adults,children,rooms` **trên URL** (đích: hiện chỉ trong bộ nhớ ở `/`). Authority: server validate. Next: xem offer | thiếu ngày, khoảng không hợp lệ, vượt sức chứa (400 từ server), server không có phòng | Popover lịch/khách đóng được bằng `Esc`; nút tìm kiếm có tên truy cập; lỗi đọc qua `aria-live`/`role=alert` | Test validate + trình duyệt |
| J03 | Quote khả dụng và giá | Thẻ phòng / panel P03. Authority: `GET availability` (giá theo đêm, tổng, `currencyCode`, `availableRooms` do server). Next: chọn offer | chưa có ngày → “Chọn ngày để xem giá”; hết phòng; lỗi mạng; offer đổi giữa hai lần xem (server thắng) | Thẻ là link bàn phím được; giá đọc được bởi screen reader | So khớp UI với JSON thật; không giá mẫu |
| J04 | Chi tiết phòng / chỗ nghỉ | P03. Identity: `propertyId`+`roomTypeId` (GUID, đã validate). Authority: catalog | id thiếu/sai, property lạ, roomType không thuộc property, ảnh lỗi (bỏ ảnh, không thay ảnh khác), mô tả trống (“đang được cập nhật”), không hiển thị trường API không có | Gallery modal có `modal=PHOTO_TOUR_SCROLLABLE` trên URL; đóng bằng `Esc`; thanh đặt phòng mobile không che control đang focus | Trình duyệt; thử id sai |
| J05 | Thông tin liên hệ khách | Panel đặt phòng. Authority: người dùng nhập; server validate | lỗi từng ô (`fullName`, `email`, `phone`), focus vào ô lỗi đầu tiên (đã có), PII bị xóa khỏi state sau khi tạo hold thành công (đã có) | `autoComplete` đúng (đã có) | Test hiện có + trình duyệt |
| J06 | Tạo hold | `POST /booking-holds` + `Idempotency-Key` sinh một lần cho mỗi attempt. Authority: server (giá, expiry 15 phút, snapshot). Next: tới `/paydone` | `known-error` (409/400/404/401), `uncertain` (mất phản hồi → **gửi lại đúng request cũ**, không tạo hold thứ hai), nút không bấm đôi | Redirect tới biên nhận một lần | Test controller + fault injection thật (§7 H05) |
| J07 | Xác nhận hold | `POST /booking-holds/{id}/confirm` (không `Idempotency-Key`; server idempotent theo hold nguồn). Credential: session Customer **hoặc** `X-Booking-Access-Token` | hold hết hạn/không xác nhận được (409), 401/404, `confirm-uncertain` → gửi lại xác nhận cùng hold (server trả `Replayed`) | Nút xác nhận có trạng thái busy + thông báo `aria-live` | Trình duyệt + so khớp DB |
| J08 | Biên nhận | `/paydone`. Authority: `ReservationDto`/`BookingHoldDto` trả về. “Confirmed ≠ paid”: luôn ghi “Chưa có thanh toán trực tuyến” (đã có) | reload/mở thẳng → hướng dẫn (đã có); đích: bền hơn theo DP-06/DP-08 | Tiêu đề trang đúng, focus tới tiêu đề khi trạng thái đổi | Trình duyệt, reload, tab thứ hai |
| J09 | Đăng ký | `/signup` → `POST /auth/register`. **Đáp ứng 201 KHÔNG tạo session** (DTO tên `CustomerSessionResponse` nhưng không đăng nhập). Next đề xuất: chuyển tới `/login` với thông báo thành công, email điền sẵn, **không** giữ mật khẩu; (tuỳ chọn, cần Owner thích) gọi `login` ngay bằng thông tin vừa nhập. Session chỉ coi là có sau `login` 200 và `GET /auth/me` 200 | 400 (không đạt quy tắc mật khẩu: ≥12 ký tự, hoa, thường, chữ số, ký tự đặc biệt, ≤128), 409 (email đã tồn tại), 429 | Nhãn ô, `aria-invalid`, lỗi gắn `aria-describedby`, `autoComplete="new-password"` | Trình duyệt + DB (`CustomerAccounts` +1) |
| J10 | Đăng nhập / đăng xuất / session | `/login` → `POST /auth/login` → `GET /auth/me`; đăng xuất `POST /auth/logout` (**cần CSRF**). Header phản ánh đúng tài khoản. Cookie `.TheBha.Customer` HttpOnly, session cookie, hết hạn trượt 8 giờ | 401 (chung, không phân biệt sai email/khoá tài khoản sau 5 lần/15 phút), 429, hết hạn ⇒ về anonymous, **khoá đổi danh tính khi hold đang chạy** (§6 CP01), stale cookie (H01) | Form có thể dùng bằng bàn phím; sau đăng nhập focus tới điểm hợp lý; menu tài khoản đóng bằng `Esc` | Trình duyệt thật, hai tài khoản, đổi giữa chừng |
| J11 | Theo dõi / tự phục vụ đặt phòng | `GET /reservations/{id}`, `POST /reservations/{id}/cancel` với credential (session hoặc token). **Không có API liệt kê** (C03). Identity: `reservationId` trên URL **không phải bí mật** — quyền do server kiểm | 401 (credential sai/thiếu), 404 (không thuộc người gọi hoặc không tồn tại), 409 (không hủy được: từ ngày check-in theo giờ Property trở đi; đã hủy ⇒ `Replayed`), lỗi mạng | Hộp xác nhận hủy có focus trap và `Esc` | API + DB + trình duyệt; không gọi “toàn bộ lịch sử” khi chỉ có ID nhớ trong trình duyệt |
| J12 | Thương hiệu / liên hệ / FAQ / chính sách | `/about`, `/contact`, trang chính sách. Nguồn: nội dung do Owner cấp (không đến từ API) | Không bịa chính sách hoàn/hủy, rating, liên hệ; thiếu input ⇒ không hiển thị mục đó | Link footer là link thật | Rà link + nội dung do Owner xác nhận |

## 4. C — Ma trận API / dependency

### 4.1 Route map `Back_End` mà Customer dùng hoặc có thể dùng (`SOURCE_ONLY @ 2ad2bc9`)

Route map toàn bộ lấy từ `Back_End/src/TheBha.Api/Controllers/*.cs`; `Program.cs` chỉ `MapControllers()` và `MapHealthChecks` (không có minimal API `Map(Get|Post)`).

| ID | Method path | Request → response / status | Credential · ownership | Origin / CSRF | Loại | Retry / idempotency / recovery | Frontend hiện gọi? | Source / test |
|---|---|---|---|---|---|---|---|---|
| A01 | `GET /api/v1/auth/csrf` | → `200 {token, headerName}` (`headerName = X-CSRF-TOKEN`) | ẩn danh | CORS `customer-web` | read (đặt cookie `.TheBha.Antiforgery`) | an toàn | có (`csrf.ts`) | `AuthController.GetCsrfToken`; `Program.cs:263-272` |
| A02 | `POST /api/v1/auth/register` | `{email, password}` (≤256/≤128) → **`201 {customerAccountId, email}`** · 400 · 409 · 429 | ẩn danh. **Không tạo cookie session** | `[IgnoreAntiforgeryToken]`; rate limit `auth-register` (mặc định 5/60 s) | mutation | không có key; lặp lại ⇒ 409; 429 thì chờ | **không** | `AuthController.Register`; `CustomerAuthenticationTests.Complete_customer_cookie_session_flow…` (register 201 rồi login riêng), `Registration_uses_identity_validation_without_requiring_csrf`, `Registration_and_login_rate_limits_are_deterministic` |
| A03 | `POST /api/v1/auth/login` | `{email, password}` → `200 {customerAccountId, email}` + `Set-Cookie .TheBha.Customer` (HttpOnly, SameSite theo cấu hình, mặc định Lax, không `Domain`) · 401 chung · 429 | ẩn danh; **không kiểm cookie cũ** ⇒ đăng nhập lại ghi đè cookie cũ/hỏng | `[IgnoreAntiforgeryToken]`; rate limit `auth-login` (mặc định 10/60 s); khoá 5 lần sai/15 phút | mutation | không idempotency; không tự gửi lại | **không** | `AuthController.Login`; `Program.cs:211-217,233-243`; cùng test trên |
| A04 | `POST /api/v1/auth/logout` | → `204` · 400 (CSRF) · 401 | `[Authorize]` | **cần CSRF** (filter toàn cục `AutoValidateAntiforgeryToken`, `Program.cs:172`) | mutation | an toàn lặp lại khi đã đăng nhập; **với cookie hỏng ⇒ 401, không xoá được cookie** (H01) | **không** | `AuthController.Logout`; test `missingCsrf`/`invalidCsrf`/`logout` |
| A05 | `GET /api/v1/auth/me` | → `200 {customerAccountId, email}` · 401 | cookie Customer | CORS | read | an toàn | **không** | `AuthController.Me` |
| A06 | `GET /api/v1/properties` | → `200 PropertyDto[]` (`id,name,slug,description,address,city,country,timeZone,checkInTime,checkOutTime,amenities,media`) | công khai | CORS `properties-catalog-read` | read | an toàn | có | `PropertiesController.GetProperties`; `propertyTypes.ts` |
| A07 | `GET /api/v1/properties/{id}` | → 200 · 404 | công khai | CORS | read | an toàn | không (dùng danh sách) | `PropertiesController` |
| A08 | `GET /api/v1/properties/{id}/room-types` | → `RoomTypeDto[]` · 404 | công khai | CORS | read | an toàn | có | `PropertiesController`, `roomTypeService.ts` |
| A09 | `GET /api/v1/room-types/{id}` | → 200 · 404 | công khai | CORS | read | an toàn | không | `RoomTypesController` |
| A10 | `GET /api/v1/properties/{id}/availability?checkIn&checkOut&adults&children&rooms` | → `AvailabilityOfferDto[]` · 400 · 404 | công khai | CORS | read | an toàn, abort được | có | `PropertiesController.GetAvailability`; `availabilityService.ts` |
| A11 | `POST /api/v1/booking-holds` | header `Idempotency-Key` bắt buộc (≤ giới hạn byte, không ký tự điều khiển) + body 11 trường → `201 BookingHoldDto` (token khách **chỉ ở bản 201 đầu**) · `200` replay (**`guestAccessToken = null`**) · 400 · 401 · 404 · 409 | khách (sinh `guestAccessToken`) hoặc session (hold thuộc `CustomerAccountId`, **không** có token) | CSRF bắt buộc; không kiểm Origin phía server cho route Customer (chỉ CORS + SameSite + CSRF) | mutation | Cùng key + cùng body ⇒ replay; cùng key khác body ⇒ **409**. Fingerprint **bao gồm `customerAccountId`**: gửi lại sau khi đăng nhập/đăng xuất ⇒ 409 | có | `BookingHoldsController.Create`; `BookingHoldCreation.cs:165-178` (`CreateFingerprint(normalized, customerAccountId)`); `BookingHoldCreationStore.cs:250-256,308-310,377-379` |
| A12 | `POST /api/v1/booking-holds/{id}/confirm` | không body; header `X-Booking-Access-Token` (nếu khách) → `201 ReservationDto` · `200` replay · 401 · 404 · 409 | chủ sở hữu = `CustomerAccountId` khớp **hoặc** hash token khớp (OR); không chủ ⇒ **404** | CSRF bắt buộc | mutation | **Không `Idempotency-Key`** nhưng idempotent theo `SourceHoldId`: confirm lần hai trả `200 Replayed` cùng reservation ⇒ gửi lại **đúng** confirm là an toàn | có | `BookingHoldsController.Confirm`; `BookingHoldConfirmationStore.cs:33-41,142-150`; `BookingHoldConfirmation.cs:84-115` (không session và không token ⇒ `Unauthorized`; `BookingCredentialResolver.cs` dùng cho đọc/hủy, không phải confirm) |
| A13 | `GET /api/v1/booking-holds/{id}` | token hoặc session → `200` · 401 · 404 | như A12 | CORS | read | an toàn | **không** | `BookingHoldsController.Get` |
| A14 | `POST /api/v1/booking-holds/{id}/cancel` | token hoặc session → `200` (replay `200`) · 401 · 404 · 409 | như A12 | CSRF | mutation | idempotent | **không** (nút “bỏ giữ chỗ” chưa có) | `BookingHoldsController.Cancel` |
| A15 | `GET /api/v1/reservations/{id}` | token hoặc session → `200 ReservationDto` · 401 · 404 | chủ sở hữu | CORS | read | an toàn | **không** | `ReservationsController.Get`; `ReservationRead.cs` |
| A16 | `POST /api/v1/reservations/{id}/cancel` | body `{reason}`; token hoặc session → `200` (replay `200`) · 400 · 401 · 404 · 409 | chủ sở hữu | CSRF | mutation | idempotent; **chỉ hủy được khi ngày Property-local < ngày check-in**; đã hủy giữ nguyên `cancelledAtUtc`/lý do | **không** | `ReservationsController.Cancel`; `Reservation.Cancel` (`Back_End/src/TheBha.Domain/Bookings/Reservation.cs`) |
| A17 | **Danh sách đặt phòng của khách đã đăng nhập** | — | — | — | — | — | — | **Không tồn tại** (đã kiểm toàn bộ route map). `GET /reservations/{id}` đọc **một** reservation theo id; ID ghi nhớ trong trình duyệt **không** phải lịch sử đầy đủ |

### 4.2 Hợp đồng dùng chung

- **Cookie / CORS / proxy.** Cookie `.TheBha.Customer`: HttpOnly, `Secure` luôn bật ngoài Development, `SameSite` theo `Authentication:Cookie:SameSite` (mặc định `Lax`), `Path=/`, trượt 8 giờ, cookie phiên (`isPersistent:false`). CORS `customer-web`: origin liệt kê tường minh, không wildcard, credentialed. Với Customer đặt trên `*.vercel.app` còn API ở host khác, cookie là cross-site; `API_PROXY_ORIGIN` làm `/api/*` đi qua cùng origin (rewrite, giữ tiền tố `/api`); cần đặt cả `API_PROXY_ORIGIN` và `NEXT_PUBLIC_API_BASE_URL` rồi build lại. Evidence: `Back_End/src/TheBha.Api/Program.cs:41-48,233-243,263-290`, `Front_End/Customer_Web/README.md` (mục “Same-origin API proxy”), `next.config.js`.
- **Origin.** Kiểm Origin phía server nằm ở các route **Admin/Staff** (`AdminRequestBoundary`, `StaffRequestBoundaryFilter`, `AdminCalendarWriteGateFilter`). Các controller Customer (`AuthController`, `BookingHoldsController`, `ReservationsController`) **không** kiểm Origin: biên bảo vệ là CORS + SameSite + CSRF token. Không suy ra mọi mutation auth dùng cùng hợp đồng CSRF: **`register` và `login` bỏ qua CSRF; `logout`, `booking-holds`, `confirm`, `cancel` yêu cầu CSRF** (`AutoValidateAntiforgeryToken`, `Program.cs:172`).
- **Customer ≠ Staff.** Cookie Staff là `.TheBha.Staff` (path `/api/admin`), không lẫn với `.TheBha.Customer`; Customer_Web không được gọi `/api/admin/*`.
- **Session sai / stale.** Mọi controller booking (Create/Confirm/Get/Cancel của hold và reservation) trả **401 “Invalid customer session”** nếu request mang cookie `.TheBha.Customer` nhưng không xác thực được — **kể cả khi người dùng chỉ muốn đặt với tư cách khách** (`BookingHoldsController.cs`, `ReservationsController.cs`).
- **CSRF gắn danh tính.** Token chống giả mạo của ASP.NET gắn với danh tính hiện tại (hành vi framework, **chưa có test của repo** xác nhận). Dấu hiệu nhất quán trong source: test `Complete_customer_cookie_session_flow…` lấy token mới **sau** login, trước logout; `invalidateCsrfToken()` đã được thiết kế “for a future login/logout transition” (`csrf.ts:65`). Hệ quả: sau đổi danh tính, token cache cũ có thể bị từ chối bằng đúng `400 Invalid antiforgery token`; helper hiện thử lại **một** lần, nhưng không chủ động làm mới khi login/logout (`UNVERIFIED` ở runtime). **Đã quan sát ở runtime (CP01a, API `3be18c3`, PostgreSQL 18.3, task-owned):** token lấy khi ẩn danh bị `400 Invalid antiforgery token` ở `logout` sau khi đăng nhập, token lấy khi đã đăng nhập bị `400` ở một POST ẩn danh sau khi đăng xuất, còn token mới lấy ngay sau đổi danh tính được chấp nhận (`204` / `401` nghiệp vụ). Báo cáo: `docs/reports/CUST-WEB-001-CP01a-completion.md`.

### 4.3 Phân loại capability

`AVAILABLE` = API có sẵn (UI có thể chưa có). `NEEDS_BACKEND` = cần work item backend riêng. `OWNER_INPUT` = thiếu quyết định/dữ kiện của Owner. `PROPOSED_DEFERRED` = đề xuất hoãn; **chỉ thành approved khi Owner chốt**.

| ID | Capability | Phân loại | Ghi chú / hệ quả cho journey |
|---|---|---|---|
| C01 | Đăng ký, đăng nhập, đăng xuất, `me` | AVAILABLE (UI MISSING) | A02–A05 |
| C02 | Đặt phòng khách (hold → confirm → biên nhận) | AVAILABLE (đã tích hợp) | A11–A12 |
| C03 | Danh sách đặt phòng của tài khoản | **NEEDS_BACKEND** | BE-DEP-2. Nếu Owner chọn có tài khoản mà không có API này, mục “Đặt phòng của tôi” phải bỏ — không dựa ID nhớ trong trình duyệt |
| C04 | Đọc / hủy một reservation theo credential | AVAILABLE (UI MISSING) | A15–A16; cần chính sách hủy/hoàn hiển thị (OWNER_INPUT) |
| C05 | Bỏ giữ chỗ (hold cancel) | AVAILABLE (UI MISSING) | A14 |
| C06 | Newsletter / form liên hệ có gửi đi | NEEDS_BACKEND + OWNER_INPUT | Không có endpoint, không có bộ gửi email. Đề xuất: bỏ form; liên hệ bằng thông tin tĩnh (xem DP-04) — `PROPOSED_DEFERRED` |
| C07 | Sửa hồ sơ, đổi mật khẩu | NEEDS_BACKEND | `CustomerAccount` chỉ có email/mật khẩu; không có endpoint. Đề xuất: `/account` chỉ đọc — `PROPOSED_DEFERRED` |
| C08 | Quên mật khẩu / xác thực email | NEEDS_BACKEND + OWNER_INPUT | Cần bộ gửi email (chưa có `IEmailSender` hay tương đương) |
| C09 | Danh sách yêu thích gắn tài khoản | NEEDS_BACKEND | Hiện chỉ `localStorage` theo thiết bị (F07). Đề xuất bỏ hoặc ghi rõ “lưu trên thiết bị này” — `PROPOSED_DEFERRED` |
| C10 | Tra cứu đặt phòng của khách (không tài khoản) | NEEDS_BACKEND | Xem DP-06. Hiện khách chỉ có biên nhận trong bộ nhớ tab |
| C11 | Thanh toán / hoàn tiền | PROPOSED_DEFERRED | `PROJECT_BIBLE.md` §2 DEFERRED. UI luôn ghi “Chưa có thanh toán trực tuyến” |
| C12 | Email xác nhận | NEEDS_BACKEND + OWNER_INPUT | Chưa có cơ chế gửi; UI không được nói đã gửi email |
| C13 | Giá/currency/inventory/expiry/cutoff hủy | AVAILABLE (server sở hữu) | Frontend không tính lại |

### 4.4 Dependency backend đề xuất (work item riêng, chưa được kích hoạt)

| ID | Dependency | Endpoint / thay đổi | Ownership | Acceptance tối thiểu | Chặn |
|---|---|---|---|---|---|
| BE-DEP-1 | Thoát khỏi stale `.TheBha.Customer` | Hướng khả dĩ (Owner/OC chọn): coi cookie không xác thực là ẩn danh cho route booking; hoặc phản hồi 401 xoá cookie; hoặc cho `logout` ẩn danh xoá cookie | Customer | Test PostgreSQL: cookie hết hạn/giải mã lỗi ⇒ khách đặt được, hoặc cookie bị xoá sau một request; không nới CSRF/Origin | CP06 phần phục hồi; phát hành |
| BE-DEP-2 | Danh sách đặt phòng của tài khoản | ví dụ `GET /api/v1/customers/me/reservations` (tên **đề xuất**) với phân trang, thứ tự ổn định | `CustomerAccountId` | Chỉ trả reservation của chính người gọi; 401 khi chưa đăng nhập; không lộ của người khác | CP07 (history) |
| BE-DEP-3 | Tra cứu khách (nếu DP-06 = B) | cặp mã đặt phòng + email → credential đọc/hủy | khách | Chống dò, rate limit, không lộ PII khi sai | CP07 (guest) |
| BE-DEP-4 | Dữ kiện Property (địa chỉ, mô tả, tiện nghi thật) | cập nhật dữ liệu catalog | Owner/ops | `GET /properties` trả dữ kiện thật; hiện là “Địa chỉ đang được cập nhật” | CP08 |
| BE-DEP-5 | Email giao dịch (nếu DP-07 chọn có) | bộ gửi + mẫu | — | Thành công chỉ hiển thị khi gửi thật | phát hành (tuỳ DP) |

Không thuộc phạm vi CP00 và không thuộc initiative này nếu Owner chưa kích hoạt: sửa auth/CSRF, schema, migration, Backend CD.

## 5. D — Gói quyết định Owner

Cột: **Quyết định → Khuyến nghị → Đánh đổi → Input còn thiếu → CP phụ thuộc → Trạng thái**. Tất cả `OPEN` tại baseline; không dòng nào là `APPROVED`. Không hỏi lại các dữ kiện đã xác minh: quyền publish demo đã cấp (2026-10-07), tên miền `thebhariverside.com` đã cung cấp (`PROJECT_BIBLE.md` §14.1), hai Property đã duyệt (§1).

| ID | Quyết định | Khuyến nghị | Đánh đổi | Input còn thiếu | CP phụ thuộc | Trạng thái |
|---|---|---|---|---|---|---|
| DP-01 | Sitemap hotel/stay: có bỏ menu đa dịch vụ khỏi điều hướng thương mại không (quyết định cũ: giữ Cars/Flights/Experiences/Real Estates để demo, §14.1 C3)? | **Bỏ** khỏi nav và đặt các route đó vào `unavailable`/redirect sau khi Owner duyệt; giữ thiết kế template | Mất “demo đầy đủ template”; được site trung thực | — | CP08 (nav), sau CP05 | OPEN |
| DP-02 | Ngôn ngữ mặc định và phạm vi English; tiền tệ | Mặc định **tiếng Việt**; English là phạm vi do Owner chốt; tiền tệ chỉ hiển thị theo `currencyCode` của server (VND), **không** quy đổi, bỏ `CurrencyDropdown` | i18n tốn công nếu cần English | Owner: có English hay không; ai dịch/duyệt | CP06 (chuỗi lỗi), CP08 | OPEN |
| DP-03 | House / Villa bookable | Giữ trạng thái “Sắp ra mắt” nếu thiếu dữ kiện. Bookable cần: Property + RoomType + RatePlan + giá/đêm + tồn + tiện nghi + ảnh có quyền + địa chỉ thật + Owner ghi nhận “mở bán”. `PROJECT_BIBLE.md` §1 chỉ duyệt **House** và **Riverside**; **Villa** chỉ là nhãn trên frontend (`featuredBrands.ts`) | Giữ nhãn Villa khi chưa tồn tại gây kỳ vọng sai | Owner: Villa có thật không; dữ liệu House | CP05, CP08 | OPEN |
| DP-04 | Thương hiệu / liên hệ / FAQ / chính sách / ảnh / quyền | Dùng lại dữ kiện đã có; **không bịa**. Thiếu: số điện thoại/email/Zalo/giờ hỗ trợ, địa chỉ Riverside thật trong catalog (BIBLE §1 có địa chỉ; API đang trả “Địa chỉ đang được cập nhật”), giờ nhận/trả thật (hiện 14:00/12:00 là mặc định demo), chính sách đặt/hủy/hoàn (server: chỉ hủy trước ngày check-in theo giờ Property), nội quy, FAQ, chính sách quyền riêng tư & điều khoản (Owner/pháp lý), pháp nhân kinh doanh, bảng giá thật (giá trong `RiversideDemoCatalog.cs` là giá phẳng của bản demo: 1.000.000/1.100.000/1.600.000 VND/đêm), link mạng xã hội thật, ảnh có quyền dùng | Bỏ mục nào thiếu input thay vì để placeholder | Danh sách trước | CP08, CP09 | OPEN |
| DP-05 | Phạm vi tài khoản khi ra mắt | Nếu có tài khoản: đăng ký/đăng nhập/đăng xuất + `/account` chỉ đọc (email); “Đặt phòng của tôi” **chỉ khi** có BE-DEP-2. Sửa hồ sơ/đổi mật khẩu/quên mật khẩu/lưu: `PROPOSED_DEFERRED`, **không hiển thị** UI không hoạt động. Mỗi hành động không hỗ trợ cần disposition do Owner duyệt | Tài khoản không có danh sách đặt phòng ít giá trị | Owner: tài khoản có ra mắt không; có cần BE-DEP-2 không | CP01–CP04, CP07 | OPEN |
| DP-06 | Khách không tài khoản quay lại xem/hủy đặt phòng thế nào | Hiện: biên nhận chỉ trong bộ nhớ tab; không email. Lựa chọn: (A) chỉ ghi mã + liên hệ khách sạn (chấp nhận được cho soft launch có Owner xác nhận), (B) API tra cứu (mã + email) — **khuyến nghị cho thương mại**, (C) bắt buộc đăng nhập để đặt. | A: khách mất đường tự phục vụ; B: backend + rà bảo mật; C: giảm chuyển đổi | Owner chọn A/B/C | CP06, CP07 | OPEN |
| DP-07 | Thanh toán và email | Thanh toán `PROPOSED_DEFERRED`; chỉ hiển thị thành công khi có cơ chế thật; không nói “đã gửi email” khi chưa có | Không có thanh toán/email ⇒ quy trình vận hành thủ công | Owner: thu tiền thế nào (tại quầy/chuyển khoản), có cần email giao dịch không | CP06, CP08, phát hành | OPEN |
| DP-08 | Bền vững năng lực khách qua reload | Giữ **memory-only** cho hold 15 phút (đã là hợp đồng hiện tại, ghi rõ trong UI). Sau khi xác nhận, dựa vào tài khoản hoặc tra cứu (DP-06), **không** lưu token trong storage trừ khi Owner chấp nhận rủi ro XSS | Reload giữa chừng mất hold (hết hạn sau 15 phút) | Owner chấp nhận | CP06 | OPEN |
| DP-09 | Quyền sử dụng template, ảnh, logo cho phát hành thương mại | Tách một việc xác minh: license mua template Chisfis (hóa đơn/giấy phép), nguồn gốc 31 ảnh Riverside (đang `UNVERIFIED`), logo, ảnh hero/placeholder; thay hoặc bỏ asset không có quyền | Chậm phát hành nếu thiếu | Owner cung cấp chứng từ | phát hành | OPEN |
| DP-10 | Rating / review / lời chứng thực | **Bỏ** `StartRating sample`, `SectionClientSay`, thống kê mẫu cho đến khi có nguồn thật | Trang bớt “sinh động” | — | CP08 | OPEN |
| DP-11 | Cho phép backend work item cho BE-DEP-1 (stale cookie) | **Có**, trước phát hành thương mại | Chạm auth backend (ngoài quyền mặc định, §7 `AGENTS.md`) | Owner kích hoạt | CP06, phát hành | OPEN |

OPEN không chặn acceptance của đề xuất tài liệu này; từng checkpoint triển khai chờ đúng quyết định nó phụ thuộc.

## 6. E — Chuỗi PR review được (đề xuất, không kích hoạt)

Không PR nào được mở đồng loạt. Ước lượng logic = dòng viết tay (additions+deletions, gồm test), là **khoảng ước tính** để implementer đo lại. Mọi PR dùng Node 22/npm 10 và lockfile hiện có; kiểm chuẩn từ `Front_End/Customer_Web`: `npm ci`, test nhắm trước, `npm run lint`, `npx tsc --noEmit -p .`, `npm test`, `npm run build`, rồi trình duyệt thật desktop+mobile (HTTPS tin cậy, TLS bật, API + PostgreSQL 18.3 riêng của task, không dùng dữ liệu Owner), CI Backend/Frontend/Admin trên FINAL_HEAD.

| PR | Concern | Paths / symbols | Prerequisite | Logic dự kiến | User-visible / dependency kiểm chứng được |
|---|---|---|---|---|---|
| **CP01a** | Client auth + provider `me` chỉ đọc + làm mới CSRF (không màn hình) | thêm `src/lib/api/authService.ts` (register/login `apiUnsafeRequest`, logout `submitCsrfProtectedRequest`, me), `CustomerSessionProvider` (tải `me` khi mount: `loading/anonymous/authenticated/unknown`), hàm đổi danh tính luôn gọi `invalidateCsrfToken()` rồi tải lại `me`. Chưa có UI nào gọi login/logout nên không thể rò danh tính | — | 200–300 | Test tự động; không đổi UI nhìn thấy được |
| **CP01b** | **Khoá đổi danh tính** khi luồng hold đang chạy | `bookingHoldFlowController.ts` / `bookingHoldFlow.ts`: login/logout bị chặn ở các phase khoá (`submitting, uncertain, active-session, confirming, confirm-known-error, confirm-uncertain`); quy tắc cho `reservation-result` (xoá PII/biên nhận có xác nhận hoặc nút “Hoàn tất”) | CP01a | 200–300 | Negative control: ở từng phase khoá, đổi danh tính không gửi request nào và state hold không đổi |
| CP02 | Đăng nhập thật + header/tài khoản | `/login` form thật (lỗi 401/429, `autoComplete`), `AvatarDropdown` thật (Đăng nhập/Đăng ký khi ẩn danh; email + Đăng xuất khi đã đăng nhập; bỏ “Eden Smith”), `FooterNav` “Log in” → `/login`, thanh “đặt phòng đang thực hiện” khi bị khoá | CP01a **và** CP01b; DP-05 (mục menu) | 250–400 | Đăng nhập → `me` → đúng header → đăng xuất, bằng trình duyệt thật + DB |
| CP03 | Đăng ký | `/signup` → `register`; 201 **không** coi là đã đăng nhập; chuyển `/login` kèm thông báo; 400/409/429 | CP01a, CP01b, CP02 | 150–300 | Tạo tài khoản; `CustomerAccounts` +1; chưa có `.TheBha.Customer` sau 201 |
| CP04 | `/account` chỉ đọc | Hiển thị email từ `me`; bỏ form hồ sơ/mật khẩu/billing/savelists mẫu và tab `(account-pages)` tương ứng; guard chưa đăng nhập → `/login` | CP02; DP-05 | 150–300 | Không còn identity mẫu |
| CP05a | Kết quả tìm kiếm thật | `/listing-stay` (+ map) thay `DEMO_STAY_LISTINGS` bằng thẻ `RoomTypeStayCard`; tham số tìm kiếm **trên URL**; states loading/empty/error | không phụ thuộc CP01 | 250–350 | Link chia sẻ được; reload giữ tìm kiếm |
| CP05b | Trang thương hiệu/chỗ nghỉ + metadata | trang chỗ nghỉ theo slug/`propertyId`; trạng thái “Sắp ra mắt” cho property chưa bookable | CP05a; DP-03 | 150–300 | Trang chỗ nghỉ mở được từ liên kết; property chưa bookable hiển thị “Sắp ra mắt” |
| CP06 | Phục hồi luồng đặt phòng | Việt hoá chuỗi lỗi (`describeError`, `SectionAvailabilitySearch.tsx:561,570`); nhận diện 401 “Invalid customer session” và hướng dẫn phục hồi; nút bỏ giữ chỗ (A14); thông điệp reload/hết hạn; hold đã hết hạn | CP01; DP-02, DP-08, DP-11 | 250–400 | Fault injection mất phản hồi: không tạo hold/reservation thứ hai |
| CP07a | Đọc/hủy một reservation theo credential | A15–A16; xác nhận hủy, hiển thị cutoff của server (409) | CP06 | 250–350 | Hủy trước ngày check-in OK; sau cutoff ⇒ 409 hiển thị đúng |
| CP07b | Danh sách hoặc tra cứu | (nếu DP-05) danh sách theo BE-DEP-2; (nếu DP-06 = B) tra cứu theo BE-DEP-3 | CP07a; BE-DEP-2/3 | 200–350 mỗi nhánh | Chỉ chủ sở hữu thấy đặt phòng của mình; người khác 401/404 |
| CP08 | Nội dung / điều hướng / media | Tách: 08a điều hướng + route policy + loại section mẫu (DP-01, DP-10); 08b home theo §3.2; 08c about/contact/FAQ/chính sách (DP-04); 08d footer/ảnh/logo (DP-09) | DP-01, 03, 04, 09, 10 | mỗi PR 200–400 (phần lớn markup/copy nên không tính logic) | Không còn placeholder, link chết, “Get Template”, ảnh không quyền |
| CP09 | SEO & metadata | `robots`, `sitemap`, canonical, metadata theo route, OG | CP05, CP08 | 150–300 | Kiểm HTML thật |
| CP10 | Release acceptance & handoff | Chạy ma trận §7–§8 trên build bàn giao; báo cáo; không thêm tính năng | tất cả | 0–100 (sửa nhỏ) | Báo cáo evidence, danh sách blocker |

**Checkpoint triển khai đầu tiên đề xuất: `CUST-WEB-001-CP01a` (client auth + provider `me` chỉ đọc + làm mới CSRF), ngay sau đó `CP01b` (khoá đổi danh tính trong luồng hold); CP02 chỉ bắt đầu khi cả hai đã merge.** Lý do tách: login/logout hiện chưa tồn tại nên CP01a không thể rò danh tính (chưa UI nào gọi), còn CP01b mới là phần chạm `bookingHoldFlow*`; mỗi nửa nằm trong mục tiêu ~400 dòng logic. Rủi ro đã thấy trong source cần được kiểm bằng test: (1) fingerprint hold chứa `customerAccountId` ⇒ gửi lại sau đổi danh tính là 409; (2) hold tạo khi đã đăng nhập không có token khách ⇒ đăng xuất trước khi xác nhận làm mất credential duy nhất; (3) token CSRF gắn danh tính; (4) hold `Active` ở bộ nhớ khi ai đó đăng nhập/xuất ⇒ phải khoá. Negative control bắt buộc (CP01b): gọi đổi danh tính ở từng phase bị khoá và khẳng định không có request nào được gửi và state hold không đổi. Không sửa backend, không đổi auth/CSRF/Origin, không có màn hình. CP01a/CP01b chưa được kích hoạt.

**Trạng thái CP01a (2026-10-13, evidence ở `docs/reports/CUST-WEB-001-CP01a-completion.md`):** `authService.ts`, `customerSession.ts` (controller không React), `CustomerSessionProvider.tsx` (mount ở root, ngoài `BookingHoldProvider`) và sửa generation trong `csrf.ts` đã được triển khai ở một Draft PR; chưa có màn hình đăng nhập/đăng ký/đăng xuất/tài khoản và **khi đó chưa có khoá đổi danh tính**. **CP01b (2026-10-13, Draft PR; evidence `docs/reports/CUST-WEB-001-CP01b-completion.md`):** có guarded `guardedLogin`/`guardedLogout` (coordinator một-instance, khoá đồng bộ xuyên auth request và lần đọc `me` kiểm chứng), guard hai chiều với booking controller (mirror đồng bộ, không dựa React snapshot), reset draft khi đổi danh tính và `finishBooking(expectedReservationId)`; **chưa có UI** (CP02+), H04 được chặn ở tầng ứng dụng một-tab (không chặn cookie hết hạn, gọi API trực tiếp, tab/thiết bị khác). **CP02 (2026-10-13, Owner kích hoạt lõi đăng nhập/đăng xuất/header; Draft PR; evidence `docs/reports/CUST-WEB-001-CP02-completion.md`):** `/login` thật, mục tài khoản theo `me` ở cả ba header, mobile (kể cả trang phòng nơi `FooterNav` bị ẩn) và `FooterNav`, UI trạng thái guard/recovery và nút “Đóng biên nhận” (`finishBooking`) — tất cả chỉ qua `guardedLogin`/`guardedLogout`/`refreshSession`/`finishBooking`. Đăng ký (CP03), `/account` và lịch sử (CP04+), quên mật khẩu, social login **chưa có**; Owner chỉ kích hoạt phần lõi này, không duyệt toàn DP-05 hay `DP-01`…`DP-11` (vẫn `OPEN`). Correction `CP01b-C1`: `refused` chỉ cho `400/401/429` của login/logout, còn 5xx/408/status lạ/lỗi mạng là `lost` (server có thể đã đổi session; `me` vẫn quyết định danh tính). Correction `CP01a-C1`: token CSRF được kiểm generation ngay lúc dispatch (cả lần gửi đầu và lần retry exact-refusal) và hai hook test baseline gây `tsc` lỗi đã sửa; chi tiết ở report. Các quyết định `DP-01`…`DP-11` vẫn `OPEN`; CP00 đã merge (PR #107) không duyệt chúng.

## 7. Hazard: stale-cookie, mất capability, đổi danh tính, mất phản hồi

Tất cả `SOURCE_ONLY`; "khoảng trống" = chưa có tái hiện hay evidence. Không sửa hay nới auth/CSRF trong CP00.

| ID | Tình huống | Hệ quả (theo source) | Khoảng trống / cách tái hiện |
|---|---|---|---|
| H01 | **Cookie `.TheBha.Customer` còn nhưng không xác thực** (hết 8 giờ trượt, giải mã lỗi sau khi Data Protection key đổi) | Mọi API hold/reservation trả **401 “Invalid customer session”**, kể cả khi người dùng muốn đặt làm khách. `logout` là `[Authorize]` ⇒ 401, **không xoá cookie**; cookie HttpOnly nên JS không xoá được. Người có tài khoản tự phục hồi được vì `login` **không** kiểm cookie cũ và ghi đè nó; khách thì không (trừ khi đóng trình duyệt vì cookie phiên) | Chưa có test repo cho H01. Chưa xác nhận handler có xoá cookie hết hạn hay không ⇒ **không khẳng định**; tái hiện: đặt cookie cũ rồi `POST /booking-holds`. Đã ghi `OPEN` ở `CUST-WEB-SHOWCASE-001-CP02-completion.md` §12.5/§13.6. Dependency BE-DEP-1 (DP-11) **Tái hiện một phần ở CP01a:** cookie `.TheBha.Customer` giả ⇒ `POST /booking-holds` `401 “Invalid customer session”` và `POST /auth/logout` `401`, **không** có `Set-Cookie` nào xoá cookie. Chưa tái hiện cookie hết hạn thật. |
| H02 | Mất `guestAccessToken` khi reload | Hold `Active` (15 phút) vẫn tồn tại ở server nhưng không ai xác nhận được; reservation đã xác nhận không đọc/hủy được (không có token, không có tra cứu) | Có chủ đích (F06). Cần DP-06/DP-08. Kiểm bằng reload ở phase `active-session` |
| H03 | **Replay `POST /booking-holds` không trả token** (`Map(existing, null)`) | Khách mà phản hồi đầu **mất** (`uncertain`) rồi gửi lại đúng request ⇒ nhận `200` với `guestAccessToken = null`; nếu chưa từng giữ token (`mergeHoldSession` chỉ giữ token của cùng hold đã có), session có `guestAccessToken: null` ⇒ confirm không gửi header ⇒ 401 ⇒ **không bao giờ xác nhận được hold đó** tới khi hết hạn | Test chỉ khẳng định quy tắc giữ token khi đã có (`bookingHoldFlow.test.ts` “replay-null”). Chưa có test/UX cho trường hợp **chưa từng có token**. Tái hiện: ngắt mạng sau khi server đã tạo hold (fault injection phần giả lập, server thật) |
| H04 | Đổi danh tính giữa lúc `submitting/uncertain/active-session/confirm*` | (a) gửi lại create sau đổi danh tính ⇒ **409** (fingerprint chứa `customerAccountId`); (b) đăng xuất sau khi hold tạo lúc đã đăng nhập ⇒ mất credential duy nhất; (c) đăng nhập sau khi tạo hold khách: confirm bằng token vẫn hợp lệ nhưng hold thuộc khách, không thuộc tài khoản; (d) CSRF cũ có thể bị từ chối một lần | Chưa có UI đổi danh tính nên chưa xảy ra; ràng buộc cho CP01 (§6) |
| H05 | Mất phản hồi `create` / `confirm` | `create`: `uncertain` ⇒ gửi lại **chính xác** body + `Idempotency-Key` cũ (replay, không hold thứ hai). `confirm`: `confirm-uncertain` ⇒ gửi lại cùng hold; server idempotent theo `SourceHoldId` ⇒ `200 Replayed`. Lỗi HTTP bất kỳ (kể cả 401/404/409) vào `known-error` và `confirm-known-error` cho phép “Thử xác nhận lại” cùng credential | Có test controller/flow; fault injection bằng trình duyệt chỉ có ở CP02 report (SHA cũ) ⇒ phải làm lại ở build bàn giao |
| H06 | Restart DB / mất key Data Protection | Report CP02 ghi `OPEN`: request đầu 500 sau restart DB, key XML không mã hoá. `Program.cs` yêu cầu `DataProtection:KeysPath` ở Production (`Program.cs:154-158`). Mất key ⇒ cookie Customer và antiforgery không giải mã được ⇒ H01 và CSRF 400 | Không tái hiện ở CP00; thuộc Backend CD/ops, ngoài initiative; phát hành cần Owner xác nhận key bền vững |
| H07 | Hold hết hạn trước khi xác nhận | `InventoryHold.Confirm` ném “The Hold has expired and cannot be confirmed.” (`Back_End/src/TheBha.Domain/Bookings/InventoryHold.cs:150-153`); store trả **409** “The Hold cannot be confirmed: …” (`BookingHoldConfirmationStore.cs`). Hold không còn `Active` cũng 409 | UI hiện hiển thị `detail` của server (tiếng Anh); copy cần việt hoá (CP06) |
| H08 | Cache CSRF cũ sau login/logout | Xem §4.2: token gắn danh tính (đã quan sát). CP01a: login/logout làm mất hiệu lực cache và acquisition đang chờ; chưa có UI đổi danh tính | Helper tests và quan sát API ở CP01a; test trình duyệt qua UI chờ CP02 |

## 8. F — Định nghĩa release

**Website COMPLETE** chỉ khi **tất cả** điều kiện sau đúng trên **build bàn giao**, không dùng evidence của SHA cũ:

1. Mọi journey bắt buộc của hợp đồng đã duyệt (J01–J12 trừ phần Owner đã duyệt hoãn bằng văn bản) có current-build evidence; không giảm journey để tuyên bố xong.
2. Mọi `OWNER_INPUT` và `NEEDS_BACKEND` mà journey bắt buộc dựa vào đã được giải quyết; capability không hỗ trợ được xử lý đúng disposition Owner duyệt (ẩn UI, không giả chức năng).
3. Phát hành không còn mục tạm của template: danh tính mẫu, `Get Template`, link `#`, form `action="#"`, rating/review mẫu, liên hệ mẫu, `/checkout` gợi ý thanh toán, “Eden Smith”.

**Evidence bắt buộc (mỗi mục ghi SHA, môi trường, lệnh/ảnh chụp):**

| Gate | Nội dung |
|---|---|
| G1 | discover → quote → hold → confirm → receipt, đối chiếu UI với JSON và hàng DB (`InventoryHolds`, `Reservations`) |
| G2 | auth/ownership/tự phục vụ: đăng ký, đăng nhập, đăng xuất, `me`; chủ sở hữu đọc/hủy; người khác bị 401/404 |
| G3 | Từ chối và phục hồi: hết hạn hold, 401, 403, 404, 409, reload, mất phản hồi `create`/`confirm`, stale cookie (H01), mất token (H03) |
| G4 | Desktop và mobile thật, điều hướng bàn phím, thứ tự focus, focus khi lỗi, trạng thái `aria-live`/`role=alert`, popover/modal đóng bằng `Esc` |
| G5 | Link, ảnh, nội dung, chính sách, bản quyền (DP-09) — không link chết, không placeholder |
| G6 | PII: không PII/credential trong URL, log, storage; xoá PII sau hold; kiểm request/console |
| G7 | SEO: canonical, `robots`, `sitemap`, title/description theo route, trang bị loại không index |
| G8 | Hiệu năng **đo được** trên build production, điều kiện ghi rõ (thiết bị, mạng, số lần đo). **Ngưỡng đề xuất, chưa phải cam kết**: không tệ hơn baseline đo ở CP release; Owner chốt mục tiêu sau khi có số đo. Không bịa điểm Lighthouse |
| G9 | Customer checks chuẩn (§6 đầu) xanh trên FINAL_HEAD; CI Backend/Frontend/Admin xanh trên **đúng** FINAL_HEAD |
| G10 | Hồi quy Admin/Calendar không đổi (CI Admin) |

**Không được suy diễn:** đặt phòng xác nhận **không** có nghĩa đã thanh toán; toast UI không chứng minh dữ liệu đã lưu (phải đọc lại từ server); deployment/CI xanh không thay application acceptance; application acceptance **khác** deployment/CD handoff. Ngoài phạm vi: hosting, payment, CMS, OTA, Backend CD. Backend image run `38274194088` xanh tại baseline **không** chứng minh CD hay live deployment. Trạng thái Vercel tại baseline: “the-bha-hotels-booking” success, “the-bha-hotels-booking-p5rj” **failure** — chưa điều tra trong CP00; cần xử lý riêng trước phát hành.

## 9. Đề xuất đồng bộ governance (work item riêng)

`docs/governance/WORKFLOW.md` §6 (“Kích thước PR”) và `AGENTS.md` §13 vẫn nêu mục tiêu 100–400 dòng toàn PR. Đề xuất một work item docs-only riêng để thay bằng quyết định Owner 2026-10-13 (§0). CP00 không sửa các file này.

## 10. Drift còn lại được ghi nhận (không sửa trong CP00)

- `docs/project/PROJECT_BIBLE.md` đoạn `PMS-CAL-004-CP01` (“PR chờ review/merge của Owner”) lỗi thời: PR #106 đã merge `2026-10-12` (`2ad2bc9`). Nằm ngoài phần Customer của allowlist.
- `docs/project/SNAPSHOT.md` §9 (rủi ro): đoạn “thiết kế `PMS-CAL-002-CP00`… D1–D6 còn OPEN” lỗi thời (PR #81, #97–#102 đã merge). Ngoài phạm vi Customer.
- Comment đầu `src/lib/routePolicy.ts` và `src/middleware.ts` mô tả “`/api/*` đóng/404” theo bản trước `BHA-WEB-PROXY-001`; đúng chỉ khi không cấu hình proxy (X01). Source là read-only trong CP00.
