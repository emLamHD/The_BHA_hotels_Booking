# CUST-WEB-001-CP08a — Homepage Riverside hoàn chỉnh và bàn giao release candidate

> **Cập nhật C2 (Owner, 2026-10-14):** phần thiết kế trang chủ, header và điều hướng mô tả trong báo cáo này (landing Riverside ở `/`, bốn anchor trên menu, không có menu template) **đã bị thay** bởi `CUST-WEB-001-CP08a-C2` — xem `docs/reports/CUST-WEB-001-CP08a-C2-completion.md`: `/` là cổng đặt phòng, trang Riverside ở `/riverside`, menu/ngôn ngữ/tiền tệ/nút sáng-tối của template được khôi phục ở dạng UI. Bảng acceptance C0 (272) và C1 (75) cùng các FINDING bên dưới giữ nguyên làm lịch sử; FINDING C1 “Esc không đóng menu khi logout pending” được xử lý trong C2 (E-A, D5). Evidence C0/C1 không được tính cho C2.

- **Work item / phase:** `CUST-WEB-001-CP08a` / `HOMEPAGE_RIVERSIDE_RELEASE`. Role pair `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY` (Owner gọi). Model: Sonnet 5.5. Skills: không dùng `diagnosing-bugs` (nguyên nhân mọi lỗi gặp phải đã rõ trong phiên); không dùng Graphify (`NOT_APPLICABLE`).
- **Branch:** `feature/cust-web-001-cp08a-riverside-homepage-release` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `c989fc355d26d5c3e061e4dcdadaffa583b68bc9` (merge PR #113; `develop` = `origin/develop` lúc preflight, cây sạch, 0 PR mở, branch CP05a vắng cả local lẫn remote). Merge CI run `38503158977`: `push`, `completed/success` trên đúng baseline; Frontend/Backend/Admin đều `success` (đối chiếu lại trong phiên). Hai worktree Orca (`/home/admin1/orca/workspaces/...`) có từ trước phiên này, không do phiên này tạo và không được dùng.
- **FINAL_HEAD, commit, PR URL, GitHub additions/deletions/numstat, CI và hai trạng thái Vercel của FINAL_HEAD:** ghi ở PR body và terminal handoff, không ghi ở file này (tránh tự tham chiếu hash).
- **Owner:** kích hoạt lõi “homepage Riverside + điểm vào shared header/footer” (đổi thứ tự roadmap có chủ đích: CP08a trước CP05b/CP06). Không duyệt `DP-01`…`DP-11` (vẫn `OPEN`). Backend, Admin, Calendar, CD, auth/session/CSRF, booking controller, trang biên nhận/phòng, services/DTO, parser/controller CP05a, `routePolicy`/middleware, package/lockfile: read-only.
- **Advisor:** dùng **2 lần**, cả hai read-only. (1) Trước khi viết code, về hướng migration search: tách một quyết định duy nhất đi qua parser CP05a; không dùng `useSearchParams` ở provider gốc (sẽ làm mọi trang tĩnh bị client-render); bẫy hash trong `NavMobile` (`href={{pathname}}` mã hoá `#`); `SectionGridFeaturePlaces`/`HeaderFilter` ngoài allowlist; không đổi `aria-label` của `ButtonSubmit` vì form listing CP05a đang chọn bằng CSS theo nhãn đó; picker chỉ Riverside. Tác động: toàn bộ các điểm đó được áp dụng. (2) Trước khi chốt, rà khoảng trống. Tác động: phát hiện lỗi thật “thông báo lỗi tìm kiếm cũ quay lại và chiếm focus khi về trang chủ” (đã sửa ở hai lớp và thêm test trình duyệt), yêu cầu chạy **một lượt sạch** trên cây đã commit, và yêu cầu liệt kê các màn hình không sửa được trong kịch bản demo, tương thích API so với backend đang chạy thật.

```
IMPLEMENTATION_CP08a: PASS
HOMEPAGE_RIVERSIDE: COMPLETE_IN_SCOPE
HOME_GLOBAL_HEADER_SEARCH: CANONICAL_LISTING_URL
HOME_CATALOG_AUTHORITY: REAL_RIVERSIDE
HOME_PRICES: DATED_RESULTS_ONLY — NO_STALE_HOME_QUOTES
HOME_TEMPLATE_PLACEHOLDERS: REMOVED_FROM_RENDER_PATH   (chỉ cho `/`; xem §7 cho các màn hình khác)
HOUSE_VILLA: DEFERRED_NOT_BOOKABLE
BOOKING_IDENTITY_GUARD: PRESERVED
DEMO_CANDIDATE: VERIFIED_LOCAL
REVIEW_CP08a: NOT_RUN — OWNER_ONLY
LIVE_DEPLOY_VERIFICATION: NOT_RUN
COMMERCIAL_READINESS: NOT_CERTIFIED — OPEN_GATES_LISTED
CUSTOMER_WEBSITE: NOT_COMPLETE
CP05b_CP06_PLUS: NOT_STARTED
```

Bốn trạng thái tách riêng: **implementation** `PASS` (code, test, browser, tài liệu của checkpoint); **demo candidate** `VERIFIED_LOCAL` (trên stack cục bộ, dữ liệu seed — không phải tồn kho thương mại); **deploy verification** `NOT_RUN`; **commercial readiness** `NOT_CERTIFIED` (các cổng mở ở §9). `PASS` không bao hàm CI của FINAL_HEAD; điều kiện đó được báo ở PR/terminal.

## 1. Mapping source → handler → đích (xác minh từ source tại baseline, trước khi viết code)

| Điểm vào | Handler tại baseline | Đích tại baseline | Sau CP08a |
|---|---|---|---|
| Form hero desktop (`SectionHero` → `HeroSearchForm` → `StaySearchForm` live) | `ctx.submit` (provider gốc) | GET availability ngay tại trang chủ, rồi cuộn `/#rooms`; giá giữ trong bộ nhớ | `decideHomeSearch` → một `router.push` tới URL listing chuẩn; trang chủ **không** hỏi giá |
| Modal tìm kiếm mobile `HeroSearchForm2Mobile` (header mọi trang dưới `lg`, kể cả trang phòng) | `stay.submit()` + `closeModal()` vô điều kiện | như trên | cùng `submit`; modal chỉ đóng khi hợp lệ; mở modal chỉ sao chép search hợp lệ của Riverside từ URL listing vào draft |
| `HeroSearchFormSmall` (`Header3`) | handler riêng | — | không còn trong render path (header cố định `Header 2`); không sửa |
| `HeroSearchForm` tab Experiences/Cars/Flights | mẫu | — | không dùng trên `/`; vẫn dùng ở các trang mẫu khác, không sửa |
| Form listing (CP05a) | `apply` → URL | `/listing-stay?…` | giữ nguyên |
| Trang phòng | panel tự re-quote | — | giữ nguyên |
| `PayDoneReceipt` | `ensureCatalog`, `riverside`, `roomTypes` của provider | catalog của provider | API catalog của provider giữ nguyên |

## 2. Hợp đồng tìm kiếm trên trang chủ

- **Một quyết định:** `src/lib/homepageSearch.ts` ghi draft thành sáu key listing, đọc lại bằng `parseStayListingQuery` (parser CP05a, không có bản sao thuật toán), rồi hoặc cho ra URL chuẩn `buildStayListingHref`, hoặc lời nhắn bằng lời của form (không phải của liên kết). Nhãn brand lạ ⇒ lỗi, không bao giờ rơi về Riverside; thiếu ngày ⇒ lỗi (browse là hành động riêng — link tới `/listing-stay` — chứ không phải việc nút Search tự suy).
- **Một navigation mỗi lần Search:** `createHomeSearchDispatcher` chặn yêu cầu thứ hai tới cùng URL trong 1,5 s (nhấp đúp, hoặc click kèm Enter); search thật thứ hai (URL khác, hoặc cùng URL sau cửa sổ đó) vẫn đi. Dispatcher chỉ phụ thuộc vào hàm `navigate`: không có đường nào hỏi server.
- **Provider gốc:** bỏ `runQuote`, `searchRequest`, `pending` effect, `scrollToRooms`, `activeTab`, `search`; giữ draft + catalog (+ `submit`, `problem`). Đường “search chờ catalog rồi tự điều hướng muộn” không còn tồn tại, nên không còn gì để race; vòng đời catalog (abort khi unmount) giữ nguyên. Lỗi catalog dùng câu cố định (`describeListingError`), không còn `problem.detail` của server. Lời nhắn lỗi gắn với trang: bị xoá khi đổi route, và form chỉ lấy focus cho lời nhắn xuất hiện **khi nó đang hiển thị** (lỗi cũ lúc mount thì để yên).
- **Picker:** chỉ “The BHA Riverside” (desktop và mobile). Disposition: House/Villa không có trong picker của trang chủ/header; form listing CP05a (read-only) vẫn liệt kê ba nhãn, và chọn House/Villa ở đó cho ra trang “Chưa hỗ trợ đặt phòng trực tuyến” không gọi API. `decideHomeSearch` vẫn xử lý House/Villa (URL mang `brand`) và được test.
- **Không dùng `useSearchParams` ở provider/header** (trên Next 13.4 sẽ client-render toàn bộ trang tĩnh). Prefill từ URL listing đọc `window.location` lúc mở modal.

## 3. Trước → sau → cách demo → evidence

| Hạng mục | Trước (baseline) | Sau | Cách demo | Evidence |
|---|---|---|---|---|
| Hero | “Hotel, car & experiences”, ảnh minh hoạ chung, tab Experiences/Cars/Flights, CTA tới `/listing-stay-map` | Một H1 “The BHA Riverside”, một câu về căn hộ lưu trú tại Đà Nẵng, ảnh hồ bơi sân thượng (webp 51 KB, `fetchpriority=high`, không preload ảnh nào khác), CTA “Tìm phòng” và “Khám phá loại phòng”, form tìm kiếm thật | Mở `/` ở 1440 và 390 | 1 H1; alt của ảnh = manifest; CTA không bị che; không chữ template (BANNED regex trống); đã xem trực tiếp ảnh chụp trang chủ từ đầu tới chân trang ở 1440 và 390; 320/768 được đo (không tràn, không che) |
| Tìm kiếm | Search ở hero GET availability rồi cuộn; giá nằm trong bộ nhớ | Một đường: URL listing chuẩn, 1 navigation; trang chủ 0 availability; listing 1 availability | Chọn ngày, khách, phòng → Search | click, Enter, nhấp đúp ⇒ 1 history entry, 1 availability; thiếu/ một phần ngày, 36 đêm ⇒ lỗi + focus, 0 request; modal mobile: mở từ pill và từ CTA, Esc/Đóng/Xoá tất cả, focus về nút mở, min/max khách/phòng |
| Loại phòng | 3 tab brand, rating/tim mẫu, giá trong bộ nhớ | Catalog thật theo slug, số thẻ = số API trả (đã kiểm với 1 loại phòng mô phỏng), “Chọn ngày để xem giá”, không giá/rating/tim; link vào phòng chỉ bằng `propertyId`+`roomTypeId` | Cuộn tới “Loại phòng” | tên/ảnh/id khớp API; loading/lỗi/thiếu/rỗng có câu riêng và Thử lại; lỗi không thành “hết phòng” |
| Khác biệt + không gian | slider thành phố mẫu, “Happening cities”, số liệu giả | “Đặt phòng trực tiếp, rõ ràng từng bước” (loại căn hộ, giá theo ngày, giữ chỗ 15 phút), tiện ích đọc từ API (hồ bơi sân thượng, sân thượng), thư viện 6 ảnh của chính chỗ nghỉ | Cuộn qua 2 mục | chip tiện ích = amenity của API; mọi ảnh là entry đã publish trong manifest, đúng alt/kích thước (test); không rating/giải thưởng/giảm giá/“rẻ nhất” (test) |
| Hướng dẫn + thông tin | “How it work” mẫu, newsletter, FAQ không có | 3 bước (tìm = ảnh chụp, giữ = 15 phút, xác nhận = mã), FAQ 6 câu, vị trí 162 Nghiêm Xuân Yêm | Mở vài câu FAQ | giờ nhận/trả lấy từ catalog và gọi là giá trị hiện ghi trong hệ thống; nói rõ chưa thu tiền, chưa gửi email, thông tin giữ chỗ chỉ nằm trong tab |
| Điều hướng / footer | Customize, Home Demos, Get Template, Templates, ngôn ngữ, thông báo, “List your property”, Wishlists, footer SaaS với `#` | Một header: logo, 5 mục thật, pill tìm kiếm (dưới `lg`), tài khoản. Drawer 5 mục; app bar Trang chủ/Tìm phòng/Đăng nhập/Menu (gắn một lần); footer: thương hiệu + địa chỉ + liên kết trong hành trình + tài khoản | Click từng mục | click thật (không dispatch) mọi mục header/drawer/app bar/footer/hero; hash cùng trang và khác trang đúng, cùng hash lặp lại vẫn cuộn, không reload (hold không mất); 0 link `#`/template |
| Auth + tài khoản | CP02–CP04 | không đổi logic | đăng ký → đăng nhập → tài khoản | đăng ký **không** tự đăng nhập; `me` → email thật; đăng xuất guarded đúng 1 request; search/điều hướng khi đã đăng nhập thêm 0 request ghi, 0 `GET me` |
| Đặt phòng | CP05a | không đổi | home → search → kết quả → phòng → giữ → xác nhận | khách (desktop, mobile) và người đã đăng nhập: mỗi lượt đúng +1 hold, +1 reservation `Confirmed`, 2 request ghi; số xác nhận và tổng tiền trên UI = DB; reservation của người đăng nhập mang `CustomerAccountId` |

## 4. Truthfulness: từng điều nói trên trang có nguồn

`src/lib/riversideHomeContent.ts` ghi nguồn của từng thứ. Địa chỉ: `docs/project/PROJECT_BIBLE.md` §1 (hai property Owner đã duyệt), vì địa chỉ trong catalog đang là placeholder; catalog không ghi đè. “15 phút”: `InventoryHold.Lifetime`. Không thanh toán/không email, hold/biên nhận chỉ trong tab: contract DP-07/DP-08 và hành vi hiện tại. Ảnh: entry `published` của `manifest.json` (Owner cho dùng bản demo, provenance `UNVERIFIED`; dòng demo nói rõ ảnh chưa xác minh quyền thương mại). Tiện ích, loại phòng và giờ nhận/trả luôn đọc từ catalog tại thời điểm hiển thị. Bếp, ban công… chỉ xuất hiện như ảnh có alt, không phải tuyên bố tiện nghi.

**Thiếu input (không chặn code, đã bỏ UI không có nguồn):** số điện thoại, email, Zalo, mạng xã hội, giờ hỗ trợ; chính sách nhận/trả phòng, hủy/hoàn, thanh toán/email chính thức; chứng từ license template, quyền thương mại của ảnh và logo; tên miền production.

## 5. Evidence

- **Cây build = cây bàn giao.** Chạy theo đúng thứ tự: commit code → dừng đúng `next start` của task → `npm ci` → `git status --porcelain Front_End/Customer_Web` rỗng, `git rev-parse HEAD:Front_End/Customer_Web` = `8e5235187f33b25047ff8559176943f305bcf3ac` → `npm run build` (`NEXT_PUBLIC_API_BASE_URL=https://localhost:7546`, `API_PROXY_ORIGIN` rỗng) → start → năm bộ acceptance liền nhau, không sửa gì ở giữa; sau build cây vẫn sạch. Commit docs sau live chỉ đổi `docs/`: hash cây frontend được đối chiếu lại ở handoff.
- **Trình duyệt:** Google Chrome `153.0.8010.52` (hệ thống) điều khiển bằng Playwright `1.64.0` cài **chỉ ở scratch** (không tải Chromium, không `--with-deps`, không đổi package/lockfile repo). Desktop 1440×900, mobile 390×844 (touch), 320×640, tablet 768×1024; một pass dark mode. Mở và xem ảnh chụp (internal-only, không commit): trang chủ top-to-bottom ở 1440 và 390, modal 320/390, dark desktop (đầu trang), ảnh lỗi, drawer; dark mobile và 768 được đo (tương phản, tràn, che) nhưng không xem toàn trang bằng mắt.
- **TLS:** binary `mkcert` **không có**; CA `mkcert development CA` có ở `~/.local/share/mkcert` và được Chrome tin cậy (`~/.pki/nssdb`, `C,,`). Leaf `CN=localhost`, SAN `localhost/127.0.0.1/::1`, `CA:FALSE`, 7 ngày, ký bằng `openssl` bằng chính CA đó, để trong harness (khoá mode 0600, PFX cho Kestrel, mật khẩu qua file 0600; không in private key). `openssl verify` OK. Không `ignoreHTTPSErrors`/cờ bỏ qua chứng chỉ/`rejectUnauthorized:false`; không đổi truststore.
- **API/DB (thật):** PostgreSQL `18.3` container riêng của task, loopback `55428`, DB `cust_cp08a_demo`; `idempotent.sql` áp sau khi kiểm `pg_isready`, `current_database`, version, container; lịch sử migration = 9 (tới `StaffIdentityFoundation`) và source có đúng 9 migration. `dotnet publish` Release từ Backend **không đổi** (diff Backend/`deploy` so với baseline rỗng). Seed `--seed-riverside-demo` (dry-run rồi apply): 60 đêm `2026-10-15..2026-12-13`, 3 loại phòng, 1 rate plan, 11 phòng vật lý, 262 dòng. API `Production` (không LocalGate), PFX task, CORS chỉ `https://localhost:3401`, `health/ready` 200. `next start` `127.0.0.1:3400` sau TLS front `3401`; proxy lỗi `7546 → 7545` xác minh TLS upstream.
- **Thật, không mô phỏng:** catalog/room types/offer từ API+DB task; **rỗng thật** (`200 []` cho tháng 3/2027, ngoài cửa sổ seed, đi từ hero trang chủ bằng lịch thật); toàn bộ năm hành trình đặt phòng (đối chiếu DB); đăng ký/đăng nhập/đăng xuất; điều hướng và bố cục.
- **Mô phỏng (đánh dấu trong test, log proxy ghi `simulated`):** property list `[]`, room types `[]`/chỉ một loại, 500/503 ở catalog và availability, 401/400 body, mạng đứt (`page.route` abort), availability chậm 5 s (race A→B), catalog chậm 4 s (không navigation muộn), ảnh lỗi (route abort). **Không** kết quả mô phỏng nào được tính là “API+DB rỗng thật”.
- **Chỉ ở unit/fixture (tại thời điểm C0 — đã được browser run ở C1, xem §12):** pending/recovery của auth (code auth không đổi; test auth hiện có giữ xanh — C0 **không** có browser run cho các trạng thái này); đa rate plan / giá đêm không đều (seed chỉ có 1 rate plan, đêm đều; test CP05a dùng helper thật).

### Bảng acceptance (C0): 272 mục = **271 PASS + 1 FINDING kế thừa**, một lượt sạch (`RUN_SET=2`)

| Bộ | Check | Phạm vi |
|---|---|---|
| 1 | 64 | ấn tượng đầu ở 1440/390/320/768, browse catalog (đối chiếu API), catalog loading/lỗi/thiếu/rỗng/mạng (mô phỏng) + retry, count không hardcode, ảnh lỗi |
| 2 | 52 | hero desktop (click/Enter/nhấp đúp, lỗi + focus, 36 đêm, một phần ngày), modal mobile (từ pill và từ CTA, Esc/Đóng/Xoá tất cả/min-max, focus), header trên listing và trang phòng, lỗi cũ không quay lại, picker chỉ Riverside, URL authority A→B/Back/Forward/reload/link mới, trang chủ không giữ giá |
| 3 | 58 | click thật mọi điều hướng (header, drawer, app bar, footer, hero; cross-page; cùng hash), rỗng thật từ hero, lỗi 500/503/mạng, race (A trễ → B; catalog chậm; rời trang), đăng ký/đăng nhập/tài khoản/đăng xuất, search khi đã đăng nhập không chạm auth |
| 4 | 35 | đặt phòng E2E khách desktop, khách mobile, người đã đăng nhập (mỗi lượt +1 hold +1 reservation `Confirmed`, 2 request ghi); hold/biên nhận sống qua search, điều hướng, FAQ, đăng nhập bị chặn như baseline; xác nhận đúng một lần |
| 5 | 63 | giá so với JSON thật, link thẻ mang đúng năm giá trị, tên truy cập, bàn phím/Esc, vùng live, 320/390/768 không tràn/không che, dark mode + tương phản, console |

Trong bộ 5, 62 là PASS và **1 là FINDING có nhãn** (không phải PASS; 64+52+58+35+62 = 271 PASS): nút mũi tên/chấm của slider ảnh trong thẻ phòng không có tên truy cập (24 nút) — thành phần dùng chung `GallerySlider.tsx`, ngoài allowlist.

### Lỗi thật do browser acceptance và rà soát tìm ra, đã sửa trong phạm vi

1. Lời nhắn lỗi tìm kiếm cũ **quay lại và chiếm focus** khi về trang chủ (provider gốc giữ nó; advisor chỉ ra) — xoá khi đổi route + form chỉ focus cho lời nhắn mới; có test trình duyệt đúng đường mở phòng → logo/Back.
2. Ngày ở ô thu gọn mobile ra “10-11” (định dạng `vi-VN` của ICU), không nhất quán với “10/11” ở nơi khác — định dạng tường minh ở cả form mobile và desktop.
3. Sau khi đóng modal, focus rơi về `body` — trả về nút đã mở (sau khi dialog unmount).
4. Chạm vào chữ “Menu” của app bar không mở menu (baseline mẫu) — đã sửa; **lần sửa đầu của chính tôi** làm menu mở lại khi bấm mục trong drawer (portal nổi bọt theo cây React) và bị acceptance bắt ngay, đã sửa bằng điều kiện “mục tiêu nằm trong DOM của mục”.

Chỉ là lỗi kịch bản (không phải sản phẩm): `networkidle` dính, calendar đang chuyển động khi đo, ngày ngoài cửa sổ seed, tồn kho cạn do tái dùng ngày (mỗi lượt chạy dùng bộ ngày riêng).

DB task sau toàn phiên: 25 hold, 22 reservation (cộng dồn các lượt chạy thăm dò/gỡ lỗi và lượt cuối; các lượt thăm dò dừng giữa chừng để lại hold mồ côi như CP05a). DB bị xoá cùng container.

Quan sát baseline (không do CP08a): console có `GET /api/v1/auth/me → 401` ở mọi trang ẩn danh; `/favicon.ico` 404 do trình duyệt tự gọi; prefetch RSC của một số link bị `ERR_ABORTED` — đã loại khỏi bộ lọc “console product error”; build có cảnh báo `/listing-stay-detail deopted into client-side rendering` (đã có sẵn).

## 6. Checks (chạy trong phiên này, từ `Front_End/Customer_Web`, Node 22.23.2 / npm 10.9.8)

| Lệnh | Kết quả |
|---|---|
| `npm ci` | exit 0 (chạy ngay trước build cuối, server đã dừng) |
| `npx vitest run` ba file mới/được cập nhật (`homepageSearch`, `riversideHomeContent`, `HomeFeaturedRooms`) | 47 test pass |
| `npm run lint` | `✔ No ESLint warnings or errors` |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm test` | 42 file, **1026** test pass (CP05a: 985; test CP05a và auth/booking giữ xanh, không bị sửa) |
| `npm run build` | exit 0; `/` là `○ Static` (10.4 kB), `/listing-stay` `○`, `/listing-stay-map` `λ` |
| `git diff --check origin/develop...HEAD` | sạch |
| Allowlist, scan secret/PII | 27 file, mọi path thuộc allowlist; chỉ có một câu chú thích nhắc “Zalo”, không có số/email/secret |

Test cũ được cập nhật vì nghiệp vụ homepage đổi: `HomeFeaturedRooms.test.ts` (tab brand/“Featured places to stay” → section Riverside và provider không còn đường quote) và `receiptAndDraftCopy.test.ts` (bỏ **chỉ** khối test của `describeDraftProblem`, hàm đã bị thay bằng quyết định chung có test riêng; khối `shouldRedirectToReceipt` giữ nguyên). Không test markup bằng chuỗi để xác nhận câu chữ; browser chứng minh wiring/bố cục/menu.

## 7. Màn hình ngoài allowlist mà kịch bản demo đi qua — chưa sửa (đường dẫn + thay đổi tối thiểu OC cần duyệt)

`HOME_TEMPLATE_PLACEHOLDERS: REMOVED_FROM_RENDER_PATH` đúng cho `/` (và header/footer dùng chung); **không** có nghĩa mọi màn hình đã hoàn tất:

| Màn hình | Hiện trạng | Path | Thay đổi tối thiểu đề xuất |
|---|---|---|---|
| Trang phòng | nhãn tiếng Anh “Hold this room”, “Create 15-minute Hold”, “Confirm reservation”, “Showing offers for…”; sao đánh giá mẫu có nhãn | `src/components/BookingHoldPanel.tsx`, `src/app/(home)/SectionAvailabilitySearch.tsx`, `src/app/(listing-detail)/listing-stay-detail/RoomDetailsContent.tsx` | dịch chuỗi; bỏ `StartRating sample` (DP-10) |
| `/listing-stay` | khối newsletter không có backend (từ layout CP05a) | `src/app/(stay-listings)/layout.tsx` | bỏ `SectionSubscribe2` |
| Modal tìm kiếm mobile | “When's your trip?”, “Who's coming?”, Adults/Children/Rooms, tên tháng/thứ tiếng Anh | `src/app/(client-components)/(HeroSearchForm2Mobile)/GuestsInput.tsx`, `DatesRangeInput.tsx`, `src/components/DatePickerCustomHeaderTwoMonth.tsx` (+ locale của react-datepicker) | dịch nhánh live; thêm `locale="vi"` và tên tháng tiếng Việt |
| Slider ảnh trong thẻ | 24 nút không có tên truy cập | `src/components/GallerySlider.tsx` | `aria-label` cho mũi tên và chấm |
| Form listing (CP05a) | nút Search có nhãn “Search” tiếng Anh (CSS của form chọn theo nhãn này) | `src/app/(stay-listings)/ListingStaySearchForm.tsx` | đổi nhãn và selector cùng lúc |
| Logo ở dark mode | nền trắng của file logo | `src/shared/Logo.tsx`/asset | cần bản logo trong suốt (Owner) |
| `/favicon.ico` | 404 do trình duyệt tự gọi | `src/app` (metadata icon) | thêm `favicon.ico` hoặc `metadata.icons` |
| Route mẫu còn truy cập trực tiếp | `/about`, `/contact`, `/checkout`, `/author`, `/home-2`, `/listing-car…` vẫn phục vụ nội dung mẫu | `src/middleware.ts`, `src/lib/routePolicy.ts` | quyết định DP-01 rồi đặt `unavailable`/redirect |

Checkpoint **không** claim “mọi route thương mại hoàn tất”.

## 8. Kịch bản demo 3–5 phút (UI, dữ liệu demo)

*Chuẩn bị:* build đã deploy hoặc `https://localhost:3401`, dữ liệu là bản seed demo, không phải tồn kho thương mại đã mở bán.

1. **(0:00)** Mở `/` trên laptop. “Đây là The BHA Riverside: một câu về chỗ nghỉ, ảnh Riverside do Owner cung cấp (cho dùng bản demo; nguồn gốc và quyền thương mại chưa xác minh), tìm phòng ngay ở đầu trang.” Chỉ dòng demo trên cùng: giá và đặt phòng là của hệ thống đặt phòng, chưa có thanh toán trực tuyến, ảnh chưa xác minh quyền thương mại.
2. **(0:30)** Cuộn tới *Loại phòng*: các loại căn hộ là dữ liệu từ hệ thống (không phải mẫu); chưa chọn ngày nên chưa có giá. Mở *Đặt phòng trực tiếp, rõ ràng từng bước* và *Khám phá không gian*: hồ bơi sân thượng, sảnh, lối vào.
3. **(1:15)** Lên đầu trang, chọn ngày, 3 người lớn 1 trẻ em, bấm Tìm phòng: URL mang đủ tham số (chia sẻ/tải lại/Back-Forward đều dựng lại kết quả); **so giá giữa các loại phòng**, nói rõ giá là ảnh chụp tại lúc tìm, chưa giữ phòng. Thử ngày thiếu để thấy lời nhắn; thử ngày ngoài lịch để thấy “Không có phòng phù hợp” (rỗng thật, khác với lỗi).
4. **(2:00)** *Chỉ trên điện thoại:* pill tìm kiếm ở đầu, modal, Esc/Đóng giữ nguyên lựa chọn.
5. **(2:30)** Mở một loại phòng → giữ chỗ (họ tên, email, điện thoại) → trang biên nhận “Đã giữ chỗ… chưa phải đặt phòng đã xác nhận và chưa thanh toán” → **Xác nhận** → mã xác nhận. Nêu: giữ chỗ 15 phút; biên nhận chỉ nằm trong tab, hãy ghi lại mã.
6. **(3:30)** Đăng ký, đăng nhập, mở *Tài khoản* (chỉ thấy email); đăng xuất. Nêu: chưa có lịch sử đặt phòng/sửa hồ sơ.
7. **(4:15)** Nói về giới hạn: chưa thanh toán/email, chưa kênh liên hệ, House/Villa chưa mở, **hai nơi demo đi qua còn nhãn tiếng Anh/khối mẫu** (trang phòng và khối newsletter ở trang kết quả; modal mobile; xem §7).

## 9. Handoff release

- **Frontend commit/tree:** cây `Front_End/Customer_Web` = `8e5235187f33b25047ff8559176943f305bcf3ac` (commit code đầu tiên của nhánh); FINAL_HEAD, PR, CI và trạng thái Vercel ở PR body. Commit docs sau cùng không đổi cây này.
- **API baseline tương thích:** đã kiểm bằng `git grep` ở `6ae3fdd` (digest backend đang chạy theo báo cáo `BHA-BACKEND-CD-001-CP04`, Owner nêu, tôi **không** kiểm lại trên AWS): các route frontend gọi đều có — `GET auth/csrf`, `auth/me`, `POST auth/register|login|logout`, `GET properties`, `…/{id}/availability`, `…/{id}/room-types`, `POST booking-holds`, `…/{id}/confirm`. Giữa `6ae3fdd` và baseline không có thay đổi controller/Application hướng khách. Migration: **NONE** (0 file migration khác nhau giữa hai mốc; PR không chạm Backend).
- **Biến môi trường (chỉ tên, không giá trị):** `NEXT_PUBLIC_API_BASE_URL` (bắt buộc, `https://`, nướng lúc build); `API_PROXY_ORIGIN` (tuỳ chọn, build-time: bật proxy same-origin `/api`, như PR #87/#91). Không thêm biến mới.
- **Smoke cục bộ:** `https://localhost:3401/`, `/listing-stay`, `/listing-stay?checkIn=…&checkOut=…&adults=…&children=…&rooms=…`, `/listing-stay-map?…` (307 về listing), `/listing-stay-detail?propertyId=…&roomTypeId=…`, `/paydone`, `/signup`, `/login`, `/account`.
- **Owner kiểm trên Vercel (không thể chứng minh cục bộ):** (1) **chế độ proxy:** toàn bộ acceptance chạy ở direct mode; đăng nhập/đăng ký, cookie, CSRF, CORS ở proxy mode chưa được kiểm; (2) `NEXT_PUBLIC_API_BASE_URL`/`API_PROXY_ORIGIN` đúng môi trường, API đang chạy khớp `6ae3fdd` hoặc mới hơn; (3) ảnh `/media/the-bha-riverside/*` và `/_next/image` tải được; (4) trang chủ tải catalog (3 loại phòng nếu seed giống) và một lượt tìm phòng trên ngày thật của dữ liệu; (5) hai trạng thái Vercel của PR chỉ là build preview, **không** chứng minh production đã deploy hay đúng backend.
- **Rollback frontend:** về bản release trước do Owner chọn (không bịa SHA/tag/domain; chưa kiểm production).
- **Hành vi hồi quy cần Owner nhìn:** search ở header/hero (một navigation), drawer và app bar mobile, hash `/#faq` từ trang khác, hold đang mở khi bấm điều hướng, đăng nhập bị chặn khi đang có booking.
- **Ghi nhận trung thực:** search header trên `/listing-stay` cho đúng query đang áp dụng đẩy cùng URL và không tạo request (form listing xử lý lại bằng nút Search riêng: đọc lại một lần); trạng thái pending/recovery của auth không có browser run ở C0 (đã khép ở C1, §12); header desktop không có ô tìm kiếm riêng ngoài mục “Tìm phòng” và form ở hero/listing.
- **Cổng thương mại còn mở (không đóng bằng CI xanh):** H01 cookie hỏng, H03 replay hold mất token, `me` không timeout, biên nhận/tra cứu bền vững, thanh toán/email, chính sách (nhận/trả, hủy/hoàn), kênh liên hệ, license template/ảnh/logo, `DP-01`…`DP-11`, dữ liệu House/Villa, các route mẫu còn truy cập được, các nhãn tiếng Anh ở §7. Chưa kiểm: Safari, bfcache, nhiều tab, trình duyệt khác Chrome.

## 10. Disposition ghi vào contract (hẹp, không phải duyệt DP)

Homepage, hero và điều hướng công khai tập trung Riverside; menu/tab đa dịch vụ, menu template, CTA giả, newsletter/app/host/video/author/thống kê thành phố mẫu không xuất hiện trong trải nghiệm mới (quyết định demo cũ “khôi phục nguyên template/menu” không còn buộc cho trang chủ và shell). House/Villa hoãn, không bookable, không có trong picker trang chủ/header. Thanh toán, email, hủy/hoàn, thương mại và dữ liệu House/Villa **vẫn mở**.

## 11. Dọn dẹp

Dừng theo PID đã kiểm lệnh (API, `next start` + shell cha, proxy), container task `cp08a-pg-*` xoá theo tên duy nhất của task (stack Owner `the-bha-postgres-1` không đụng), thư mục harness (khoá, PFX, mật khẩu, ảnh chụp, script) xoá sau handoff; không `git worktree add`, stash, reset, rebase; không push `develop`/`main`, không dispatch, không deploy.

## 12. C1 — browser evidence cho auth pending/recovery (`CUST-WEB-001-CP08a-C1-AUTH-BROWSER-EVIDENCE`)

*Lịch sử C0 ở các mục trên giữ nguyên như evidence tại thời điểm đó; C1 bổ sung thay vì sửa.*

- **Lý do (OC, `CORRECTION_REQUIRED` về evidence):** MEP CP08a §9 yêu cầu “guarded logout/pending/recovery không regress” ở browser; C0 chỉ có unit/fixture cho hai trạng thái này trong khi shell/header/footer đã đổi. Không có finding code mới; **C1 không đổi source, test, config, asset**.
- **Định danh:** `CORRECTION_START_HEAD` = `9095557b344f7931e02457fd1188dff840a4b91b` (= PR head = `origin/branch`; base `develop` = `c989fc3`, không drift; 0 PR mở khác). Cây frontend lúc bắt đầu = `EXPECTED_FRONTEND_TREE` = `8e5235187f33b25047ff8559176943f305bcf3ac`. FINAL_HEAD, commit, số liệu GitHub, CI, Vercel: ở PR body/terminal.
- **Build:** dựng lại (không có build cũ đã xác minh tree): `git status --porcelain Front_End/Customer_Web` rỗng và `git rev-parse HEAD:Front_End/Customer_Web` = `8e5235187f33b25047ff8559176943f305bcf3ac` trước và sau `npm run build` (`NEXT_PUBLIC_API_BASE_URL=https://localhost:7546`, `API_PROXY_ORIGIN` rỗng). Không chạy lại 272 mục của C0 hay 1026 unit test: **1026 test là run C0 và CI của SHA cũ, không phải run mới của C1**.
- **Công cụ/runtime:** Google Chrome `153.0.8010.52`, Playwright `1.64.0` (scratch, không đổi package/lockfile), Node 22.23.2/npm 10.9.8. TLS: binary `mkcert` vẫn không có; leaf `CN=localhost` (SAN `localhost/127.0.0.1/::1`, `CA:FALSE`, 3 ngày) ký bằng `openssl` với CA mkcert hiện có (Chrome đã tin cậy), `openssl verify` OK, không cờ bỏ qua TLS, không đổi truststore. PostgreSQL `18.3` container riêng (`:55438`), 9 migration (source có đúng 9; diff Backend/`deploy` so với baseline rỗng), seed 60 đêm, API `Production` (không LocalGate), `health/ready` 200; `next start` sau TLS front; proxy lỗi ngoài repo `7546 → 7545` (xác minh TLS upstream).
- **Nguồn xác thực (authority):** phiên là cookie ASP.NET Core Identity do API cấp; `GET /api/v1/auth/me` của API là câu trả lời duy nhất về danh tính; không inject provider/React, không giả cookie/`me`. Tài khoản synthetic tạo bằng chính các trang `/signup` rồi `/login` (register `201`, login, `GET me` `200`); không có booking trước ca logout (không hold nào được tạo trong C1).

### Chuyển trạng thái theo source (`customerIdentityChange.ts`)

Logout đã được nhận ⇒ khoá `transport` (đồng bộ, trước request) → khi request kết thúc: `recovering` (một `GET me`) → `idle` nếu `me` trả 200/401, hoặc `recovery-unresolved` nếu `me` lỗi, giữ khoá cho tới khi người dùng bấm “Kiểm tra lại” (chỉ `GET me`, không gửi lại logout/login). Một refusal có tài liệu (400/401/429) được coi là `refused`; mất kết nối/5xx là `lost` (chỉ `me` mới biết). Vì vậy: ca A giữ ở `transport`; ca B dùng yêu cầu `lost` + `me` 503 để dừng ở `recovery-unresolved`. Giai đoạn `recovering` ngắn (đang đọc `me`) **không** được giữ riêng để quan sát.

### Vị trí lỗi (mô phỏng ngoài repo, log proxy ghi `simulated`) và phần thật

| Ca | Lỗi mô phỏng | Thật |
|---|---|---|
| A — pending rồi hoàn tất | request `POST auth/logout` bị proxy **giữ 75 s trước khi gọi API**; sau đó chuyển tiếp nguyên vẹn | API thực thi logout (204), `GET me` thật trả 401 |
| B — recovery chưa xác minh rồi khôi phục | `POST auth/logout` được chuyển tới API **một lần và API commit (204)**, nhưng phản hồi bị cắt dở trước khi tới trình duyệt (yêu cầu “lost”; Chrome không tự gửi lại khi phản hồi đã bắt đầu); `GET me` bị proxy trả `503` cho tới lúc gỡ lỗi | `me` sau khi gỡ lỗi do API trả thật |

Ghi chú công cụ: lần thử đầu bằng cách đóng socket **trước** khi trả lời cho thấy Chrome tự gửi lại POST ở tầng mạng (proxy thấy 2 POST) nên không tạo được “lost”; đó là lý do dùng phản hồi bị cắt. Các lần chạy thăm dò và các lần crash giữa chừng không được tính; evidence dưới đây là **một lượt chạy đầy đủ, không sửa gì giữa chừng**, bắt đầu bằng xoá mọi luật lỗi cũ.

### Kết quả (4 kịch bản, 75 mục = **73 PASS + 2 FINDING có nhãn**; không cộng vào 272 của C0)

| Kịch bản | Mục | Kết quả chính |
|---|---|---|
| A desktop 1440×900 | 20 (19 PASS + 1 FINDING) | Pending: menu hiện “Phiên đăng nhập” + “Đang gửi yêu cầu đăng nhập hoặc đăng xuất. Đặt phòng tạm khoá…”, **không còn nút Đăng xuất/Đăng nhập** (không thể bắt đầu lệnh auth thứ hai), nút tài khoản = “Tài khoản — đang kiểm tra phiên” + chấm busy (không phải “Đăng nhập”, không phải email), footer chỉ “Tài khoản” (không “Đăng nhập”/“Tạo tài khoản”). Đóng/mở lại menu và 2 lần đổi route (header “Tìm phòng”→`/listing-stay`, “Loại phòng”→`/#rooms`, cùng document) giữ nguyên; `/login` hiện cùng thông báo, form chỉ-đọc/submit bị vô hiệu. Nút “Hold this room” bị **vô hiệu hoá** (click cưỡng bức không gửi gì): 0 request booking. Đếm: 1 logout, 0 login, 0 `GET me`, 0 booking trong suốt pending. Nhả: đúng 1 `GET me` → 401, UI trở về “Đăng nhập”, footer “Đăng nhập”+“Tạo tài khoản”, menu “Bạn chưa đăng nhập” và không che trang |
| B desktop | 17 | Sau khi logout bị mất phản hồi + `me` 503: menu “Chưa kiểm tra được phiên đăng nhập. Đăng nhập, đăng xuất và đặt phòng tạm khoá…” + “Kiểm tra lại”, nhãn “Tài khoản — chưa kiểm tra được phiên đăng nhập” + chấm cảnh báo (không busy), không giả anonymous hay danh tính mới. Đếm: 1 logout, 1 `GET me` (lần đọc lỗi); chờ thêm 4 s: không tự thử lại. Hold bị vô hiệu hoá (0 booking). 2 lần đổi route + mở lại menu: nhãn, chấm, thông báo và “Kiểm tra lại” còn nguyên, 0 request auth tự động. `/login`: thông báo + “Kiểm tra lại”, email/mật khẩu chỉ-đọc, submit vô hiệu, click cưỡng bức: 0 login. Gỡ lỗi + bấm “Kiểm tra lại” thật: **đúng +1 `GET me`**, không logout/login; `me` trả **200** (xem bên dưới) ⇒ UI trở về “Tài khoản <email>”, menu “Đã đăng nhập” và “Đăng xuất” có lại, thông báo biến mất. Tổng: 1 logout, 0 login, 2 `GET me` |
| A mobile 390×844 | 21 (20 PASS + 1 FINDING) | Như A desktop, thêm app bar: mục tài khoản là “Tài khoản — đang kiểm tra phiên” + chấm busy; 3 lần đổi route (liên kết “← Tất cả phòng” của trang phòng→`/#rooms`, app bar “Tìm phòng”, “Trang chủ”); nhả: app bar “Đăng nhập”, footer “Đăng nhập”+“Tạo tài khoản” |
| B mobile | 17 | Như B desktop; app bar có chấm cảnh báo trong lúc chưa xác minh và trở về “Tài khoản <email>” sau “Kiểm tra lại” (`me` 200); 1 logout, 0 login, 2 `GET me` |

**Về kết quả `me` 200 ở ca B:** phản hồi logout (kèm `Set-Cookie` xoá phiên) không bao giờ tới trình duyệt, nên cookie không đổi và API tiếp tục chấp nhận nó; UI vì vậy trở về đăng nhập theo đúng câu trả lời `me` thật, không theo giả định “đã đăng xuất”. Đây đúng là tình huống mơ hồ mà vòng recovery tồn tại để xử lý. Nhánh “`me` 401 sau khi API đã commit” được chứng minh thật ở ca A (nhả → `me` 401).

**FINDING mới (baseline, không do CP08a, không sửa trong C1):** `AvatarDropdown` (không nằm trong diff của CP08a) — ở trạng thái pending, nút “Đăng xuất” bị gỡ nên focus rơi về `<body>` và phím **Esc không đóng menu tài khoản** (bấm lại nút tài khoản thì đóng). Follow-up: giữ focus ở nút tài khoản khi lệnh auth bắt đầu. Hai ca A (desktop, mobile) ghi cùng quan sát. FINDING kế thừa từ C0 (24 nút `GallerySlider` thiếu tên truy cập) **vẫn mở**.

**Không thay đổi so với C0:** auth/provider/booking logic không đổi (`git diff` 9095557…HEAD chỉ chạm `docs/`); cây frontend vẫn `8e5235187f33b25047ff8559176943f305bcf3ac`; các cổng thương mại, chế độ proxy trên Vercel, deploy production vẫn `NOT_RUN`/mở.

**Giới hạn của C1:** Chrome desktop và mobile giả lập (không Safari/multi-tab/bfcache); trạng thái `recovering` ngắn không được giữ riêng; chỉ một nhánh recovery (lost + `me` 503) được chạy ở trình duyệt (nhánh còn lại đủ bằng ca A); dữ liệu là seed demo; không có kết quả nào của C1 là bằng chứng về production hay chế độ proxy.

**Dọn dẹp:** dừng theo PID đã kiểm lệnh (API, `next start` + shell cha, proxy), container task `cp08a-c1-pg-*` xoá theo tên duy nhất, thư mục harness (khoá, PFX, mật khẩu, ảnh chụp, script) xoá; không `git worktree add`/stash/reset/rebase; không push `develop`/`main`, không dispatch, không deploy. Không còn tài nguyên task sót lại.

```
IMPLEMENTATION_CP08a_C1: PASS
AUTH_PENDING_RECOVERY_BROWSER: VERIFIED_AT_UNCHANGED_FRONTEND_TREE
REVIEW_C1: NOT_RUN_OWNER_ONLY
LIVE_DEPLOY_VERIFICATION: NOT_RUN
COMMERCIAL_READINESS: NOT_CERTIFIED
```

Dừng ghi sau handoff; Owner gọi review.
