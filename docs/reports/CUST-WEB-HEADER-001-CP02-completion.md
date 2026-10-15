# CUST-WEB-HEADER-001-CP02 — Ngôn ngữ, bản dịch UI và tiền tệ/tỷ giá (Admin + API)

- **Work item:** `CUST-WEB-HEADER-001-CP02`. `IMPLEMENTER: CLAUDE` (Sonnet 5.5) + `REVIEWER: CODEX_READ_ONLY` (Owner gọi). `EXECUTION_MODE: IMPLEMENT_TEST_DRAFT_PR`. `NEXT_PHASE: NOT_AUTHORIZED`.
- **Branch:** `feature/cust-web-header-001-cp02-site-localization-settings` → Draft PR vào `develop`. `BASELINE_SHA` = `3f4254d4e05dcb310f258131014637d26ddf57d7` (PR #118 đã merged; Owner xác nhận đã dọn nhánh — không xác minh trên máy Owner).
- **Review:** Codex đã chạy một lần (Owner gọi) tại `923336a5b8a11a20a5238b46357f6022459ee229`; một finding P2 → correction `CUST-WEB-HEADER-001-CP02-C1` (§8). **Head sau correction: re-review pending** (Owner gọi lại).
- **Cây đã kiểm chứng (CP02 gốc, tại `923336a`):** `Front_End/Admin_Web` = `55066b813996297bbabf91222dc35f8ac5617aa5`, `Back_End` = `0923cedeeb60f440854a6837850f053a4a2d056c` (cây sạch khi build/chạy các suite; commit docs không đổi hai cây này). SHA commit, URL PR và CI: xem PR body.
- **Skills:** `diagnosing-bugs` ALLOWED_IF_TRIGGERED — không gọi được qua công cụ Skill, làm theo `SKILL.md` thủ công khi gặp lỗi (xem §7). Graphify: không dùng.
- **Phạm vi:** Back_End + Admin_Web + docs. **Không** đổi Customer_Web, menu/CMS, Calendar role map/session policy/local gates, dependency/lockfile, CI/CD.

## 1. Kết quả theo acceptance

| | Nội dung | Kết quả |
|---|---|---|
| A1 | Migration 10 + bootstrap | PASS |
| A2 | Quyền site-wide, thu hồi, 401/403, returnTo | PASS |
| A3 | CRUD ngôn ngữ / bản dịch / tiền tệ trong trình duyệt thật | PASS |
| A4 | Nhất quán, xung đột phiên bản, double-click, mất phản hồi | PASS |
| A5 | API công khai + hồi quy Calendar | PASS |

### A1 — migration và dữ liệu hiện có
- `dotnet ef migrations has-pending-model-changes` → "No changes have been made". Migration 10 `20261015050047_AddWebsiteLocalizationSettings` (EF sinh + trigger/seed viết tay); `Down()` có bảo vệ (giới hạn đã biết: không phát hiện việc xóa một dòng seed chưa từng sửa, vì các dòng còn lại vẫn ở version 1 — xem `DATABASE.md`).
- **Đường dữ liệu thật (DB tạm `thebha_cp02_demo`, PostgreSQL 18.3):** migrate tới migration 9 → seed Riverside demo (172 dòng) → đếm hàng 27 bảng → migrate lên 10 → đếm lại. Diff chỉ gồm 3 bảng mới (`WebsiteCurrencies=3`, `WebsiteLanguages=2`, `WebsiteTranslations=50`) và `__EFMigrationsHistory` 9→10; **mọi bảng cũ giữ nguyên số hàng** (`counts-before.txt`/`counts-after.txt`). Seed: `vi` bật+mặc định, `en` có nhưng tắt, VND base/mặc định/tỷ giá 1, USD/EUR tắt không có tỷ giá; không Staff nào có quyền.
- Test tích hợp `WebsiteSettingsMigrationTests` (migrate từ 9 có dữ liệu Staff, `Down()` bị từ chối khi có tài khoản đã được cấp quyền hoặc có dòng bị sửa/thêm (version > 1, ngôn ngữ/tiền tệ/bản dịch ngoài seed), trigger `XBHA3`/`XBHA4`, so mô hình với snapshot) cùng các test migration cũ được cập nhật số lượng.
- Không apply lên DB nào ngoài container tạm; `the-bha-postgres-1` không đụng tới.

### A2 — quyền
- Test tích hợp: không phiên → 401; Manager/FrontDesk không có quyền → 403 cho mọi route (kể cả đọc); có quyền → 200; Origin sai/không JSON bị biên Staff từ chối; `LocalGate` → 404; thu hồi/disable có hiệu lực ở request kế tiếp; `me`/login trả `permissions`; CLI cấp/thu hồi, từ chối cấp cho tài khoản bị disable, không đổi mật khẩu/security stamp.
- Trình duyệt (production build + API HTTPS + PG tạm): vào `/website/*` khi chưa đăng nhập → `/signin?returnTo=…` và quay lại đúng trang; `returnTo` thù địch (`//evil.example/x`, `https://…`, `/website/../etc`, `javascript:`) luôn rơi về `/calendar`; Manager không quyền thấy lý do và **không gửi request website nào** (đọc nhật ký proxy), gọi API trực tiếp = 403, ẩn danh = 401; thu hồi quyền khi form đang mở → Save → 403 → trang đóng, DB không đổi, cấp lại thì dùng được; xóa cookie khi form mở → 401 → `/signin?returnTo=`.

### A3 — CRUD thật (desktop sáng + tối, mobile sáng + tối; ảnh trong `~/bha-evidence/CUST-WEB-HEADER-001-CP02/shots/`, 42 ảnh)
- **Languages:** thêm `fr` (kiểm tra mã trước khi gửi), sửa, bật/tắt, "Make default" có hộp xác nhận nêu ngôn ngữ đang là mặc định; `fr` thiếu key bị từ chối (`default-language-incomplete`); bật `en` rồi đặt mặc định → DB và `config` công khai đổi, đặt lại `vi`; ngôn ngữ mặc định khóa ô "On"; xóa `en` bị từ chối, xóa `de` mới tạo (có Cancel/Confirm).
- **UI translations:** mở `?locale=fr`; dịch một key → lưu, reload còn nguyên, DB khớp; các key khác "Uses the vi text"; thiếu `{what}` bị chặn trước khi gửi; `<b>` bị chặn; lọc nhóm + tìm kiếm; "Remove text" có xác nhận và key quay về chữ của `vi`; ngôn ngữ mặc định không có nút Remove.
- **Currencies:** VND không có Edit/Delete/Toggle/Rate; USD không bật/đặt mặc định được khi chưa có tỷ giá (lý do của server hiển thị); tỷ giá sai (`0`, `-5`, `1,5`, `1e3`, `abc`, 9 chữ số thập phân, 13 chữ số nguyên) bị chặn trước khi gửi; `25000.50` lưu `numeric(20,8)` = `25000.50000000`, API/UI trả `25000.5` (dạng chuẩn, không phải số JSON); bật USD, đặt mặc định, `config` công khai phản ánh, mặc định không thể tắt/xóa, đặt lại VND; thêm/sửa/xóa JPY.
- Mobile 390px và dark: không cuộn ngang, dialog nằm trong viewport, ghi thành công trên cả ba màn.

### A4 — nhất quán và đồng thời
- Hai trình soạn thảo: người thứ hai nhận `stale-version`, **bản nháp được giữ**, "Reload the latest values" hiện giá trị server và lần lưu kế dùng version mới (tiền tệ, ngôn ngữ, bản dịch; xác nhận xóa trên bản cũ bị từ chối và dòng vẫn còn).
- Double-click Save → đúng **một** `POST` (đếm ở proxy). Mất phản hồi (proxy cắt cụt sau khi API đã commit): trạng thái *unverified*, nút Save khóa, **không gửi lại**, DB thực sự đã áp dụng; "Check server" đọc lại và mở khóa (rate) hoặc báo "already has it" và chặn tạo trùng (create). Lỗi mạng trước server → thông báo, không gửi lại.
- Sign out bị giữ khi một ghi đang chờ (proxy trễ 3 giây), có thể dùng sau khi xong, rồi các trang đòi đăng nhập lại.
- Backend: `WebsiteSettingsConcurrencyTests` (hai người cùng ghi, khóa advisory); kiểm tra đột biến đã làm và khôi phục (bỏ khóa advisory, bỏ kiểm tra "đủ key", bỏ kiểm tra version tiền tệ → test tương ứng đỏ).

### A5 — công khai và hồi quy
- `GET /api/v1/website/config` / `dictionary?locale=`: ngôn ngữ tắt hoặc không biết → `200` fallback về mặc định có cờ `isFallbackLocale`; `en-US` → `en`; thiếu giá trị → chữ của ngôn ngữ mặc định; `no-store`. Test tích hợp + kiểm tra bằng trình duyệt (fr tắt → `vi`; bật → `Offres`).
- Calendar: cả FrontDesk và Manager vào `/calendar` thấy Reservation Board ("Live data. Signed in as … at this Property"), không lỗi trang; toàn bộ test Calendar/Staff hiện có vẫn xanh (các kỳ vọng được cập nhật chỉ ở số migration, trường `permissions` của `me` và registry OpenAPI).

## 2. Lệnh và kết quả (chạy trong phiên này)

| Lệnh | Kết quả |
|---|---|
| `dotnet restore` + `dotnet build Back_End/TheBha.Booking.sln -c Release --no-restore` | 0 warning, 0 error |
| `dotnet test … -c Release --no-build` (PostgreSQL thật, `postgres:18.3`) | unit **327** pass; integration **1001** pass; 0 fail (baseline 244 + 930) |
| `dotnet ef migrations has-pending-model-changes` | không có thay đổi |
| Admin: `npx tsc --noEmit` / `npm run lint` / `npm test` / `npm run build` | sạch / sạch / **56 file, 1832 test** pass / thành công |
| Browser E2E (Chrome 153, Playwright; Admin production build qua TLS 3001, API HTTPS qua proxy lỗi 7145→7146, PG tạm) | e2e1 18/18, e2e2 11/11, e2e3 9/9 bước — chạy liên tiếp trên cây cuối, DB dựng lại |
| `git diff --check` | sạch |
| CI trên HEAD của PR | xem PR body (ghi sau khi chạy) |

Kịch bản và harness (không chứa bí mật, nằm ngoài repo): `~/bha-evidence/CUST-WEB-HEADER-001-CP02/harness/`; kết quả: `e2e*-results.json`.

## 3. Thay đổi chính

- **Backend:** Domain `Website/` (luật mã BCP 47, ISO 4217, tỷ giá, văn bản), Application `Website/` (DTO, lệnh, catalog 25 key có file:line, store/reader), Infrastructure (entity config, `WebsiteSettingsStore` một giao dịch + khóa advisory toàn cục, reader công khai, migration 10), Api (`StaffGlobalPermission`, `StaffWebsiteAccessFilter`, mở route bằng metadata trong `StaffCalendarModeGuard`, 3 controller Admin + `WebsiteController` công khai, OpenAPI, CLI `--staff-website-access`, `permissions` trong `me`/login).
- **Admin_Web:** `lib/api/website.ts` (client có kiểu; tỷ giá là chuỗi; ghi không bao giờ retry), `lib/website/returnTo.ts`, `components/website/*` (gate, hooks, ba panel), ba trang, nhóm Website ở sidebar, `SignInForm` + `signin/page` nhận `returnTo`, `Button` có prop `type` tùy chọn (mặc định không đổi).
- **Docs:** `docs/DATABASE.md`, `docs/design/CUST-WEB-HEADER-001-CP02-website-localization-settings.md`, `docs/ADR/0008-global-website-settings-permission.md` (không sửa ADR 0007), SNAPSHOT, worklog, báo cáo này.

## 4. Sai khác và điểm cần Owner biết

1. **Không có key Save/Cancel/Delete/Confirm.** Customer_Web không có nhãn đứng riêng nào cho chúng (chỉ nhãn ghép như "Xác nhận đặt phòng", "Xoá bộ lọc"); không bịa nguồn. 25 key được seed là những chữ UI thật hiện có (menu, tài khoản, chung). Muốn thêm key mới cần migration seed hai dòng vi/en.
2. **Tiếng Anh là bản tự soạn**, không phải nguồn; `en` được seed ở trạng thái **tắt**.
3. **Tỷ giá lưu `numeric(20,8)`** và trả dạng chuẩn không số 0 thừa (`25000.50` → `25000.5`).
4. **PR lớn** (~7,1k dòng backend, ~4,1k Admin, chưa tính docs): vượt mục tiêu 100–400 dòng (chỉ là mục tiêu, không phải trần); phần lớn là migration (EF Designer + snapshot ≈ 2,4k) và test (≈ 3,9k). Số GitHub additions/deletions: xem PR body.
5. **Sửa ngoài kế hoạch, có giải thích:** `Button` template không có `type` nên nút Hủy trong `<form>` sẽ submit — thêm prop tùy chọn (mặc định không đổi hành vi cho mọi nơi cũ); wrapper bảng thêm `relative` vì cell `sr-only` gây cuộn ngang mobile.
6. **Đọc có Origin lạ + cookie hợp lệ trả 200** khi gọi không qua trình duyệt (Playwright `request`); CORS chỉ chặn việc *đọc* của trình duyệt, cookie `SameSite=Strict` chặn gửi chéo site — cùng hành vi với các đọc Calendar hiện có (đã xác minh trong mã: `StaffRequestBoundaryFilter` bỏ qua `GET`/`HEAD` — "every Staff request other than a read" — và `StaffCalendarAccessFilter` dùng chính filter đó), không phải regression. Mọi `POST` vẫn bị biên Staff kiểm Origin/JSON.
7. ~~Chưa kiểm bằng trình duyệt: sign-out đang chờ~~ — **đã khép ở C1** (§8.3, trình duyệt thật). Không có gì thật được deploy; Customer_Web chưa dùng API công khai.
8. **Không chạy `npm ci`:** lockfile và dependency không đổi (chỉ `node_modules` có sẵn); `npm test/tsc/lint/build` đều chạy trên cây hiện có. Container tạm `the-bha-cp02-pg` (127.0.0.1:55440) và `staff.env` (mode 600, mật khẩu chỉ cho dữ liệu thử) trong thư mục scratchpad **được giữ** cho các vòng sửa sau review; xóa khi Owner đóng work item.
9. **Quy trình:** bước E2E "Manager không quyền" đỏ hai lần liên tiếp với cùng lỗi (đăng nhập bị 429) trước khi tôi chẩn đoán qua nhật ký API; theo CLAUDE.md lẽ ra phải gọi advisor ở lần lặp thứ hai — **không làm**. Lỗi là của harness, không phải của sản phẩm.
10. **Harness:** nâng giới hạn đăng nhập Staff (`StaffAuthentication__LoginRateLimiting__PermitLimit=500`) và dùng thư mục khóa Data Protection tạm cho API chạy `Production`; chỉ trong harness.

## 5. Cách Owner thử

1. Cấp quyền (placeholder): `dotnet TheBha.Api.dll --staff-website-access --email <staff-email> --enabled true` (thu hồi: `--enabled false`). Property role không đủ.
2. Đăng nhập Admin `/signin` bằng tài khoản đó; sidebar **Website** → **Languages** (`/website/languages`), **UI translations** (`/website/translations`), **Currencies and rates** (`/website/currencies`).
3. Thử: thêm một ngôn ngữ; dịch một key rồi xem `GET /api/v1/website/dictionary?locale=<mã>` (bật ngôn ngữ trước); đặt tỷ giá USD `25000.5`, bật, đặt mặc định, rồi đặt lại VND.

## 6. Rủi ro / NOT RUN

- **Codex review:** đã chạy tại `923336a` (một finding, xem §8); head sau C1 **chờ Owner gọi lại**. Chưa deploy; không áp migration lên môi trường nào ngoài DB tạm; Customer_Web chưa đọc cấu hình này (phase sau, chưa được cho phép).
- Vercel/CI: chỉ xác nhận sau khi PR có HEAD cuối (PR body).

## 7. Chẩn đoán (`diagnosing-bugs`, làm tay) và công cụ

- Các lỗi đã chẩn đoán có vòng phản hồi: 598 test đỏ do `ExecuteSqlRaw` hiểu `{what}` là placeholder (đỏ → nhân đôi ngoặc → xanh); nút Hủy submit form (test panel đỏ → thêm `type` → xanh + test hồi quy); dialog xóa biến mất khi dòng bị xóa (test đỏ → giữ bản chụp dòng); cuộn ngang mobile (đo 594/417/547px → `relative` → 390px); 429 đăng nhập trong E2E (nhật ký API → nâng giới hạn harness).
- Mô hình chính Sonnet 5.5; advisor Opus 5.5 được gọi trước khi chốt kế hoạch và trước khi báo xong (trừ lần lặp lỗi nêu ở mục 4.9); Haiku 5.5 chỉ cho tra cứu chỉ-đọc. Không có agent nào ghi vào repo.

## 8. Correction `CUST-WEB-HEADER-001-CP02-C1-CURRENT-ISO-CURRENCIES`

`CORRECTION_START_HEAD` = `923336a5b8a11a20a5238b46357f6022459ee229`. Implementer Claude (Sonnet 5.5); reviewer Codex read-only do Owner gọi.

### 8.1 Finding gốc của Codex (nguyên văn) và disposition của OC
> **[P2] Exclude withdrawn ISO currency codes** — `Back_End/src/TheBha.Domain/Website/WebsiteRules.cs:84-86`: `ZWL` is included even though it was withdrawn and replaced by `ZWG`; the same list includes the withdrawn `SVC`. Because this list is the server's currency validator, an operator can create and activate these codes and the public config will present them as supported currencies, contrary to the documented active-ISO-only rule. Remove withdrawn codes or validate against a maintained current ISO list.

**Disposition OC:** `CORRECTION_REQUIRED`. Phần "danh sách lỗi thời" được chấp nhận; phần "`SVC` đã withdrawn" **bị bác** theo dữ liệu chính thức của SIX (SVC còn trong List One). Đoạn dưới là kết quả OC/implementer đối chiếu, tách khỏi review gốc.

### 8.2 Thay đổi
- **Nguồn (SIX, tải và đối chiếu trong phiên này, 2026-10-15):** List One `Pblshd=2026-09-17` (178 mã khác nhau); List Three `Pblshd=2026-01-01`; amendment 176 (XCG thay ANG, hiệu lực 2025-03-31) và 177 (ZWG thay ZWL, hiệu lực 2024-06-25; ZWL hết hạn 2024-09). Hai amendment đều có hiệu lực trước ngày xuất bản List One nên không có thay đổi nào chưa phản ánh.
- **Danh sách** = List One trừ các mã không phải tiền tệ theo policy sản phẩm hiện có (funds BOV CHE CHW CLF COU MXV USN UYI UYW; kim loại XAG XAU XPD XPT; XTS; XXX; đơn vị tài khoản XBA–XBD, XDR, XSU, XUA). Đối chiếu toàn bộ 157 mã cũ với List One trừ nhóm loại trừ trên cho đúng năm khác biệt: bỏ `ANG`/`BGN`/`ZWL`, thêm `XCG`, và `XAD` (xem dưới) là đơn vị tài khoản được phân loại là loại trừ:
  - **Bỏ:** `ZWL` (List Three, 2024-09), `ANG` (List Three, 2025-03), `BGN` (List Three, 2026-01) — còn 154 mã; cộng `XCG` = **155 mã**.
  - **Thêm:** `XCG` (Caribbean Guilder, 2 chữ số thập phân; List One; amendment 176).
  - **Giữ:** `SVC` (El Salvador Colon) và `ZWG` (Zimbabwe Gold) — vẫn trong List One; không thêm blacklist riêng cho SVC.
- **Phân loại OC chưa nêu — `XAD`:** List One có `XAD` (Arab Accounting Dinar, ARAB MONETARY FUND, 2 chữ số thập phân), không thuộc nhóm "N.A.". Đây là đơn vị tài khoản của một quỹ, cùng nhóm với XDR/XUA đã bị loại theo policy nên **giữ loại trừ** (và có test từ chối); **OC xác nhận lại** nếu muốn khác.
- **Xác minh đích DB trước khi dùng lại container:** `docker inspect` cho `the-bha-cp02-pg`, image `postgres:18.3`, gắn `127.0.0.1:55440`; đích kết nối in ra (không kèm mật khẩu) là `127.0.0.1:55440/thebha_cp02_demo`. `the-bha-postgres-1` không bị chạm.
- **Rà diff riêng của correction (`git diff --name-only 923336a..HEAD`, trước commit này):** `Back_End/src/TheBha.Domain/Website/WebsiteRules.cs`, `Back_End/tests/TheBha.IntegrationTests/WebsiteCurrenciesApiTests.cs`, `Back_End/tests/TheBha.UnitTests/WebsiteRulesTests.cs`, `docs/daily/2026-10/2026-10-15-worklog.md`, `docs/design/CUST-WEB-HEADER-001-CP02-website-localization-settings.md`, `docs/project/SNAPSHOT.md`, `docs/reports/CUST-WEB-HEADER-001-CP02-completion.md` — không có file nào ngoài phạm vi cho phép.
- Chỉ đổi `WebsiteRules.cs` (dữ liệu + comment nguồn/as-of) và test. Không đổi chữ ký, chuẩn hóa trim/uppercase, mã lỗi; không migration/seed; list vẫn offline.
- **Dữ liệu đã lưu:** truy vấn chỉ-đọc DB tạm trước khi sửa: 0 dòng `ZWL/ANG/BGN` (DB hiện có VND, USD, EUR, GBP); không cần cleanup. Lưu ý: `FindCurrencyAsync` cũng dùng `Iso4217.TryNormalize`, nên một dòng withdrawn đã tồn tại ở môi trường nào đó sẽ không còn thao tác được qua API — chưa có môi trường nào như vậy (tính năng chưa deploy).

### 8.3 Kiểm chứng
- **Red (trước sửa, cùng test mới):** unit `dotnet test Back_End/tests/TheBha.UnitTests -c Release --no-build --filter "FullyQualifiedName~WebsiteRulesTests"` → **6 đỏ** (ZWL, zwl, ANG, " bgn ", XCG, " xcg ") / 93 xanh; integration `… TheBha.IntegrationTests … --filter "FullyQualifiedName~WebsiteCurrenciesApiTests"` → **5 đỏ** (400 trên `code` cho ZWL/zwl/ANG/BGN; XCG tạo→rate→bật→public config) / 24 xanh. Test bảo vệ (SVC, ZWG, VND/USD/EUR; XAD/XDR/XTS/XXX/CHE bị từ chối) xanh cả trước lẫn sau.
- **Green (sau sửa):** unit **99/99**; integration **29/29** (log: `~/bha-evidence/CUST-WEB-HEADER-001-CP02/{red,green}-{unit,int}.log`).
- **Build + full suite Release trên PostgreSQL thật:** build 0 warning/0 error; unit **343** pass, integration **1007** pass, 0 fail (không so với số cũ; tăng do test mới).
- **Trình duyệt (Chrome 153, Admin build không đổi qua TLS 3001, API mới qua proxy lỗi, PG tạm; mật khẩu thử sinh trong biến môi trường của shell, không ghi đĩa/không in):** 6/6 bước:
  1. `ZWL`/`ANG`/`BGN`: server trả 400, lỗi hiển thị cạnh ô mã ("code must be an active ISO 4217 currency code such as USD."), không dòng nào được lưu, không có trong public config.
  2. `XCG` (tỷ giá giả `14000.5`, chỉ trong DB tạm — không phải tỷ giá thực): tạo → đặt rate → bật → `GET /api/v1/website/config` có `XCG` với `14000.5`.
  3. `SVC` tạo được.
  4. Manager không quyền: không gửi request website nào, API trực tiếp 403, ẩn danh 401.
  5. **Logout pending, không mở dialog** (proxy giữ phản hồi logout 5 giây; click thật): Sign out thành "Signing out…" (disabled), Add/Edit/Rate/Toggle/Default/Delete đều disabled, click ép buộc không mở dialog; **0** `POST` settings (đếm bằng `page.on('request')` và nhật ký proxy), đúng một `POST logout`.
  6. **Logout pending, đang mở form rate:** modal che nút Sign out nên click thật không tới được — nút được kích bằng `dispatchEvent('click')` (nêu rõ). Trong lúc chờ: Save và ô nhập disabled; click ép buộc, Enter và `requestSubmit()` không gửi gì (**0** settings `POST` theo cả trình duyệt lẫn proxy; không dựa vào 401 của server vì proxy đã chuyển tiếp logout trước đó). Sau logout xác nhận: về `/signin?returnTo=%2Fwebsite%2Fcurrencies`, panel gỡ, `me`/đọc/ghi từ cùng context đều 401, `/website/currencies` lại yêu cầu đăng nhập, rate trong DB không đổi. Phạm vi một trang một context; đa tab không thuộc thiết kế và không kiểm.
- Script/ảnh (ngoài repo, không chứa bí mật): `~/bha-evidence/CUST-WEB-HEADER-001-CP02/c1-harness/`, `c1-shots/`, `c1-e2e-results.json`.
- **Cây mới:** `Back_End` = `8c39294fdf4e0782a228eebaf72b859ea471b97b`; `Front_End/Admin_Web` = `55066b813996297bbabf91222dc35f8ac5617aa5` **không đổi**. Bộ E2E 38/38 trước đây (e2e1–e2e3) vẫn là bằng chứng lịch sử của `Back_End` `0923ced…` + Admin `55066b8…`; **không chạy lại** ở C1 và không gán sang cây backend mới. Admin test/lint/tsc không chạy lại local (cây Admin không đổi); CI của PR là regression bổ sung.
- Exit 82 của `dotnet test` trong sandbox của reviewer không được tái hiện trên máy này (unit 343 và integration 1007 xanh) và không được coi là lỗi sản phẩm.

### 8.4 Giới hạn / NOT RUN
- Re-review: **NOT RUN — chờ Owner gọi lại** trên head sau correction. Không merge/Ready/deploy; phase 3 chưa mở.
- `diagnosing-bugs`: không gọi được qua công cụ Skill (`disable-model-invocation`); `SKILL.md` được đọc và làm theo thủ công (vòng phản hồi = test đỏ trước sửa, xanh sau).
- Advisor (Opus 5.5) được gọi trước khi chốt kế hoạch C1; gợi ý đã dùng: kiểm tra `checkCurrencyCode` của Admin chỉ kiểm hình dạng (nên server quyết định — đúng), không đọc `staff.env` (mật khẩu thử sinh mới), giữ `XAD` bị loại, kiểm chứng mạng-vắng-mặt cho logout.
