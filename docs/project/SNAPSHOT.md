# THE BHA — SNAPSHOT

> Ngày cập nhật: 2026-10-08 (`BHA-WEB-PROXY-001`; các phần cũ hơn giữ nguyên kèm SHA)
>
> Mục đích: phục hồi trạng thái hiện tại mà không cần nạp worklog lịch sử

Cập nhật 2026-10-08 (`BHA-WEB-PROXY-001`, Customer_Web, branch `feat/bha-web-proxy-001-customer` từ `develop` `5eb0a38`, Draft PR vào `develop`): code proxy cùng origin cho demo trên URL Vercel. `next.config.js` thêm `rewrites()` opt-in qua `API_PROXY_ORIGIN` (server-only, validate bằng URL parsing: https, không credentials/query/fragment/path, không trùng origin Customer; sai thì fail lúc load config, không in giá trị): `/api/:path*` → `<upstream>/api/:path*` (`beforeFiles`, giữ tiền tố `/api` và query; không redirect). Phát hiện khi diễn tập: `src/middleware.ts` chặn `/api/*` bằng 404 **trước** rewrite nên config đơn thuần không chạy — sửa tối thiểu ngoài allowlist: `routePolicy.decideRoute` nhận `apiProxyEnabled`, chỉ cho `/api` (đúng chữ thường) đi qua khi build đã bake cờ `BHA_API_PROXY_ENABLED` (do `next.config.js` `env` chỉ đặt khi proxy bật); mặc định vẫn 404. Diễn tập local (Next + fixture HTTPS giả, CA tạm, dữ liệu giả): GET có query, POST JSON, Cookie/Origin/`X-CSRF-TOKEN`/`Idempotency-Key` tới upstream, status 201/body, hai `Set-Cookie` riêng và `no-store` giữ nguyên; thiếu CA thì 500 (không tắt TLS verify). Evidence cloud (Caddy/sslip.io, `/health/ready`, `/api/v1/auth/csrf`, cert, image `6ae3fdd`) là `OWNER_VERIFIED`, không phải test của Claude. Env Owner (Production only, rồi redeploy): `API_PROXY_ORIGIN=https://the-bha-api.52-65-145-145.sslip.io`, `NEXT_PUBLIC_API_BASE_URL=https://the-bha-hotels-booking-p5rj.vercel.app`; host `sslip.io` phụ thuộc IP công khai EC2. `VERCEL_CONFIG_APPLY`, `CUSTOMER_REDEPLOY`, `CUSTOMER_LOGIN_LIVE`, `CUSTOMER_BOOKING_LIVE`, `ADMIN_DEPLOY`: `NOT_RUN`; `REVIEW: NOT_RUN`. Report: `docs/reports/BHA-WEB-PROXY-001-completion.md`; runbook §7a.

Cập nhật 2026-10-07 (`BHA-PG18-001-C1`, chỉ tài liệu, cùng Draft PR #85): sửa hai finding. (F1) runbook §11 buộc Owner (đã tạo role, đổi owner `thebha`, qua gate `btree_gist`) phải dừng nếu role tồn tại rồi CREATE ROLE/ALTER DATABASE lại — nay có bảng định tuyến A (mới) / B (có sẵn, chưa bootstrap) / **R (resume — trạng thái Owner)** / stop; R bỏ qua step 3–4, thêm **3R** (đọc kiểm role flags, owner, membership, TLS; lệch thì dừng, không reset) và **4R** (hardening còn pending: `REVOKE ALL … FROM PUBLIC`, `GRANT CONNECT … TO bha_app`, do `bha_operator` chạy, trước lần đăng nhập `bha_app` đầu tiên); gate extension đã `OWNER_VERIFIED_PASS` không chạy lại; emptiness gate chạy lại ngay trước apply; chuỗi R: 3R → 4R → emptiness → snapshot → migration → verify → grant + login `bha_app`. Diễn tập local trên PostgreSQL 18.3 cô lập đã chạy đúng các khối lệnh của route R (và hai lỗi trong bản nháp của mình được phát hiện: PG16+ tự tạo membership admin-only cho master nên "không có hàng" là sai; master stand-in mất CONNECT sau REVOKE PUBLIC — chưa kiểm trên RDS). (F2) lệnh kiểm release `git diff --quiet 6ae3fdd HEAD -- Back_End Front_End deploy .github` trả exit 1 vì PR thêm test; nay loại đúng `Back_End/tests`, báo `STOP` nếu runtime lệch, và liệt kê 5 file test thay đổi có chủ đích (exit 0 trên checkout hiện tại, exit 1 với commit runtime khác). Kết quả 244 + 847 giữ từ `ef5d2de` (runtime không đổi). `CLOUD_*`, `DEPLOY_*`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`; `REVIEW: NOT_RUN`.

Bản cập nhật trước (BHA-PG18-001):
Cập nhật 2026-10-07 (`BHA-PG18-001`, test-only, branch `test/bha-pg18-001-compatibility` từ `develop` `17c15e7`, Draft PR): chốt ba assertion fail trên PostgreSQL 18.3 ở C1. Đọc call site: chỗ duy nhất map SQLSTATE khoá ngoại là `RoomOccupancySegmentMutationSupport` (commit cuối của mutation segment — vi phạm phía bảng con, vẫn `23503` trên 18); production **không** có đường xoá dòng cha nào (chỉ `DailyInventoryControlStore.DeleteAsync` xoá dòng con) → **không có finding production**. Sửa test: helper `PostgresVersionSupport` (major hỗ trợ 17/18, `RestrictedParentDelete`: 17 → `23503`, 18 → `23001`, major khác ném lỗi), test migration đổi tên và nhận 17/18, hai test xoá-dòng-cha dùng mã theo major và có thêm kiểm dòng cha/con còn nguyên; child insert/`NO ACTION` giữ `23503`. Kết quả trên hai server riêng, cô lập: **PostgreSQL 18.3 — unit 244/244, integration 847/847; PostgreSQL 17.10 — 244/244, 847/847** (846 + 1 test helper); RED trên 18.3 tái hiện 3 lỗi cũ; SQL `idempotent.sql` không đổi (SHA-256 `d7d38722…019b406`, `--check` đạt). `PG18_COMPATIBILITY: LOCAL_TESTS_PASS`, `BACKEND_INTEGRATION_LOCAL18: PASS` — chỉ là gate local; kết quả C1 `843/846` giữ làm lịch sử của head cũ. Bằng chứng RDS của Owner (`OWNER_VERIFIED`): role `bha_operator`/`bha_app`, ownership `thebha`, đăng nhập TLS 1.3 và `CREATE EXTENSION btree_gist` trong transaction rollback đều PASS; chưa migration/import/grant bảng/đăng nhập `bha_app`/deploy. `CLOUD_MIGRATION`, `CLOUD_DATA`, `DEPLOY_*`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`; `REVIEW: NOT_RUN`. Report: `docs/reports/BHA-PG18-001-completion.md`; runbook §11 đã cập nhật trạng thái.

Bản cập nhật trước (CP01-C1):
Cập nhật 2026-10-07 (`BHA-DEPLOY-001-CP01-C1`, cùng Draft PR #84, bootstrap ordering + PostgreSQL 18.3): finding Codex (runbook §11 kết nối tới database/role chưa tồn tại) đã sửa — §11 viết lại với **hai đường**: A (database chưa có: master tạo role rồi `CREATE DATABASE … OWNER bha_operator`) và B (`thebha` đã được Owner tạo bằng `postgres`, rỗng: giữ nguyên, chỉ `ALTER DATABASE … OWNER TO bha_operator`); ba identity tách biệt (master = bootstrap, `bha_operator` = owner/migration/import, `bha_app` = API/Staff CLI), `verify-full` giữ nguyên, image build (từ `git archive` của `6ae3fdd`) trước khi Staff CLI dùng, smoke sau Customer deploy. Target theo Owner (`OWNER_VERIFIED`): RDS `the-bha-db`, `ap-southeast-2`, **PostgreSQL 18.3**, database `thebha` rỗng, TLS 1.3; chưa áp migration/import/role. Diễn tập local trên `postgres:18.3` (digest `sha256:7e32e983…684db`) bằng chính các khối lệnh runbook: cả hai đường PASS (áp SQL 2 lần: 9 history, 28 bảng, `btree_gist`; oid database đường B không đổi), role chỉ DML không DDL, import catalog 352 INSERT, Staff CLI + API chạy qua `SSL Mode=VerifyFull`. **Backend sau build: unit 244/244, integration 843/846 trên 18.3** — 3 test fail là assertion (một pin version `17.`; hai test đòi SQLSTATE `23503` nhưng PostgreSQL 18 trả `23001` cho `ON DELETE RESTRICT`; ràng buộc vẫn được thực thi) → `PG18_COMPATIBILITY: PARTIAL`, `BACKEND_INTEGRATION_LOCAL18: FAIL (3/846)`, cần work item riêng cho test; không dùng kết quả PG17.10 thay thế. `RDS_EXTENSION_PERMISSION`, `AWS_INVENTORY`, `CLOUD_*`, `DEPLOY_*`, `END_TO_END_LIVE`, `PUBLISH`: `NOT_RUN`; `REVIEW: NOT_RUN`. Bước tiếp theo duy nhất của Owner: truy vấn chỉ-đọc kiểm `btree_gist` trên `thebha` (report §11.7). Report: `docs/reports/BHA-DEPLOY-001-CP01-completion.md` §11.

Bản cập nhật trước (CP01):
Cập nhật 2026-10-07 (`BHA-DEPLOY-001-CP01`, Owner-led deploy readiness, branch `ops/bha-deploy-001-cp01-rds-demo`, release `6ae3fdd3306c50736c734712df5a0f2a1ab5054a` = `develop` sau khi PR #83 merged; CI `CI` 37554976232 và `Backend image` 37554976283 xanh, publish ECR skipped): theo quyết định mới của Owner, **Owner trực tiếp thao tác AWS/Vercel/DNS/database; Claude chỉ chuẩn bị, kiểm tra, hướng dẫn** — quyền cũ tạo `thebha_showcase_demo` và seed trên RDS đã rút, không dùng. Đã kiểm: SQL `idempotent.sql` (SHA-256 `d7d38722…019b406`, `--check` đạt) **không chỉ là schema** — migration 7 có `INSERT … SELECT` chuyển dữ liệu booking cũ (0 dòng trên DB rỗng) và migration 8 chạy `CREATE EXTENSION btree_gist`; diễn tập trên PostgreSQL 17.10 tạm (owner không phải superuser): áp 2 lần, 9 history, 28 bảng, schema giống DB local, API Production + role chỉ DML chạy được hold → confirm và Staff login/board; import catalog 11 bảng (352 INSERT, đổi origin media sang `https://thebhariverside.com`, một transaction, rerun fail không đổi gì). Kiểm kê local: catalog đúng danh sách Owner (1 Property, 3 RoomType, 11 phòng, 270 giá 1.0/1.1/1.6 triệu, 31 media toàn URL `localhost:3000`); 24 Reservations/28 holds/1 block/1 Staff là dữ liệu test E2E — không chuyển. Khuyến nghị: migration → Owner xác nhận trường còn "demo" (số phòng `DEMO-*`, tên rate plan, mô tả/địa chỉ) → import catalog → Staff CLI; **không** dùng seeder Development trên DB vận hành. Còn thiếu từ Owner: account/region/endpoint RDS (`the-bha-db` chưa xác minh), tên DB vận hành, role, đường mạng + TLS, runtime API (đề xuất ECS Fargate + EFS mã hóa), ECR, domain/ACM, hai Vercel project, Staff. Rủi ro mới: **giá theo đêm hết 2027-01-04 và Production không có công cụ gia hạn**; image không có RDS CA bundle. AWS inventory `NOT_RUN` (không có `aws` CLI/profile); `CLOUD_DATA`, `DEPLOY_API`, `DEPLOY_ADMIN`, `DEPLOY_CUSTOMER`, `END_TO_END_LIVE`, `PUBLISH` đều `NOT_RUN`; `REVIEW: NOT_RUN`. Report: `docs/reports/BHA-DEPLOY-001-CP01-completion.md`; packet từng bước: runbook §11.

Bản cập nhật trước (C4):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02-C4-SAFE-TOOLS`, cùng PR #83, Draft, chưa merge): sửa hai finding của Codex trên head C3 — (F1) `deploy/showcase/scripts/verify-key-persistence.sh`
dùng tên scratch cố định rồi DROP/xóa nên có thể xóa tài nguyên có sẵn; nay mỗi lần chạy có run id ngẫu nhiên, tài nguyên scratch (DB/container/2 volume) mang run id, không DROP để chuẩn bị, từ chối khi tên đã tồn tại,
chỉ xóa thứ mình đã tạo (xác minh bằng label), cổng do Docker cấp; có harness Python `deploy/showcase/scripts/tests/test_verify_key_persistence.py` (RED 12/15 trên script cũ, GREEN 15/15) và một lượt chạy thật với canary tên cũ (before/after giống hệt);
(F2) seed CLI từ chối `--from`/`--days` có ngày kết thúc exclusive không biểu diễn được bằng `DateOnly` bằng usage error 2 trước khi mở DB (test options + CLI). Cũng: generator SQL giữ đúng một newline cuối file (diff chỉ một dòng trống, `git diff --check` toàn PR sạch);
và theo yêu cầu Owner, panel đặt phòng trang chi tiết không còn là sticky scroll-container nên calendar/guest popover không bị cắt. Backend C4: unit 244 + integration 846. Bằng chứng UI/booking C3 giữ nguyên là bằng chứng C3; `REVIEW: NOT_RUN` cho head C4. Chi tiết: report §13.

Bản cập nhật trước (C3):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02-C3`, cùng PR #83, Draft, chưa merge): Owner đảo quyết định C2 — **template Chisfis được khôi phục
đầy đủ** (menu, dropdown, template/currency switcher, ảnh, mọi section, trang template; logo The BHA; không khôi phục secret/NextAuth/`/api/*`) và
các route template mở lại, riêng `/api/*` vẫn 404, `/showcase`→`/`, `/pay-done`→`/paydone`. Hero Stays dùng popover template (Location: The BHA House /
Riverside / Villa; lịch hai tháng; chọn khách) làm **component có kiểm soát** dùng chung cho desktop, modal mobile, Featured và trang phòng; Riverside
lấy offer thật theo ngày, ba card `StayCard2` hiển thị giá API hoặc "Chọn ngày để xem giá". Trang phòng: mosaic 1+4, Share/Save, rating 4.5 (112) ghi rõ
là mẫu, picker template trong panel đặt phòng; validate liên hệ trước khi gửi; giữ chỗ chuyển sang `/paydone` ("Đã giữ chỗ", chưa xác nhận, chưa thanh toán);
chỉ nút "Xác nhận đặt phòng" gọi confirm. **Media:** 31 ảnh (Property 10, 2PN 9, 1PN 6, 1PN view thoáng 6) theo thư mục Owner phân loại, Owner cho phép publish
dù quét thấy generator marker/không metadata — `MEDIA_COVERAGE: PASS`, `MEDIA_PROVENANCE: UNVERIFIED` (C2PA `NOT_RUN`); DB demo được patch bằng migration chỉ-media
(40 dòng một lần, rerun 0). Bằng chứng C3 chạy trên build thật + API container + PostgreSQL demo, desktop và mobile touch, Safari `NOT_RUN`:
`docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md` §12; kết quả C2 (§10) chỉ còn là lịch sử. `REVIEW: NOT_RUN` cho head C3; lỗi cookie khách cũ (401),
500 sau khi DB restart và key XML không mã hóa còn mở.

Bản cập nhật trước (C2, bị C3 thay thế ở phần giao diện):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02-C2`, cùng PR #83, Draft, chưa merge): Owner chốt giữ **homepage Chisfis** tại `/`
(thay trang đặt phòng một trang của CP01) và đặt phòng ở **trang chi tiết phòng**. `Featured places to stay` có ba tab tĩnh
The BHA Riverside / House / Villa: Riverside lấy Property theo slug `the-bha-riverside` và hiển thị **ba loại phòng** từ API, House/Villa
"Sắp ra mắt" (không gọi API); mỗi card mở `/listing-stay-detail?propertyId=&roomTypeId=` (route template có sẵn, nay là route thật duy
nhất của nhóm listing; các route template khác vẫn 404). Trang chi tiết: dữ liệu RoomType/Property từ API, một panel đặt phòng duy nhất
(tìm offer đúng phòng → liên hệ → hold → confirm) cho desktop và mobile, hold vẫn giữ qua điều hướng; các section dịch vụ của homepage
là preview inert có nhãn, ảnh mẫu thay bằng khung placeholder (không gọi ảnh template/Pexels). Đường demo: `/` → card phòng → chi tiết →
đặt phòng (không còn "Showcase" một trang). Bằng chứng C2 chạy trên build thật + API container + PostgreSQL demo (desktop và mobile touch;
Safari `NOT_RUN`): `docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md` §10. Kết quả E2E cũ ở `2bb70bb` thuộc luồng một trang và
**không** được tính cho giao diện mới. `MEDIA: PARTIAL` (1PN chưa có ảnh), `REVIEW: NOT_RUN` cho head C2, lỗi cookie khách cũ (401) còn mở.

Bản cập nhật trước (CP02, trước C2; phần mô tả "luồng đặt phòng một trang" bên dưới đã bị C2 thay thế):
Cập nhật 2026-10-07 (`CUST-WEB-SHOWCASE-001-CP02`, Draft PR, chưa merge; PR #82 đã merged, baseline
`9ad8edce4171f9b26a3f274cd544758be21f9162`): PR thứ hai và cuối của showcase. **Bằng chứng ảnh (đã chỉnh ở C1):** quét byte (heuristic, `validation: NOT_RUN`, không có
validator C2PA): 62/86 PNG chứa marker nêu dịch vụ sinh ảnh (`trainedAlgorithmicMedia`, `gpt-image`, `OpenAI Media Service`) — dấu hiệu cần
xác minh, chưa phải chứng minh; 23 JPEG có metadata editor (nguồn camera chưa được xác minh độc lập); 1 không metadata. 13 ảnh được publish
(chỉ loại `editor-metadata-present`); hai loại 1PN chưa có ảnh (placeholder), chờ Owner làm rõ ảnh 1PN là ảnh thật đã chỉnh hay ảnh sinh mới;
`MEDIA: PARTIAL`. Backend có
seeder insert-only `RiversideDemoSeeder` + CLI `--seed-riverside-demo` (chỉ Development, `--expected-database` phải khớp và chứa
`demo`/`showcase`, dry-run/apply, idempotent); `Hosting:TrustedProxy` (mặc định tắt) tin `X-Forwarded-For/-Proto` chỉ từ proxy liệt kê;
`Back_End/Dockerfile`, `deploy/showcase/` (PostgreSQL 17 bền vững, API, nginx TLS, key ring bền vững, SQL migration idempotent),
workflow `backend-image.yml` (build trên PR và push `develop`; publish ECR **tắt mặc định**, chỉ từ `develop` khi `ECR_PUBLISH_ENABLED=true`, tag = SHA nguồn, không rollout; `PUBLISH: NOT_RUN`). Catalog Riverside 3 loại/11 phòng
(1PN 3 phòng ₫1.000.000, 1PN view thoáng 2 phòng ₫1.100.000, 2PN 6 phòng ₫1.600.000; max 2/2/4) đã seed vào DB demo local bền vững
`thebha_showcase_demo` (cửa sổ 2026-10-07..2027-01-04, 316 dòng, rerun 0 insert) và chạy E2E trình duyệt + container + Admin Staff
(`DATA_LOCAL/UI_LIVE/CONTAINER: PASS`, `MEDIA: PARTIAL`). Chưa làm: `CLOUD_DATA`, `DEPLOY_LIVE` (Owner deploy theo runbook
`docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md`), Vercel `NOT_TESTED`, Safari `NOT_RUN`, `REVIEW: NOT_RUN`. Yêu cầu cứng: Customer, Admin
và API cùng một registrable domain (cookie Lax/Strict); Owner cung cấp `thebhariverside.com` / `admin.` / `api.` (cấu hình dự kiến, DNS/live `NOT_TESTED`); `*.vercel.app` + hostname AWS mặc định sẽ không giữ được đăng nhập.
Rủi ro mở: key ring Data Protection lưu không mã hóa trên volume; không có EF retry (request đầu sau restart DB trả 500); lỗi cookie
khách cũ (401) vẫn mở. Evidence: `docs/reports/CUST-WEB-SHOWCASE-001-CP02-completion.md`.

Bản cập nhật trước (2026-10-06, `CUST-WEB-SHOWCASE-001-CP01`; PR #82 nay đã merged):

Cập nhật 2026-10-06 (`CUST-WEB-SHOWCASE-001-CP01`, Draft PR, chưa merge): `PMS-CAL-002-CP00`
đã merged (PR #81, `b6e28a6`); split-move **tạm dừng** theo quyết định Owner (thiết kế giữ nguyên,
CP01–CP05 không mở). Objective Customer: `/` của Customer_Web là luồng thật (Property → RoomType →
availability/giá từng đêm → hold → confirm); mọi route template trả 404 "chưa có"; shell tối thiểu.
Correction C1 (cùng PR #82) sửa hai finding Codex: điều hướng header không làm mất guest hold;
CTA tới form khi catalog đang tải. Correction C2 (cùng PR #82) làm `/` render live page trực tiếp,
giữ alias an toàn trên loopback-IP và realign fragment khi catalog/RoomType đang settle; production
loopback, browser booking và isolated DB regression đã chạy. Correction C3 (Claude, MEP mới) giữ nguyên thao tác cuộn của khách khi catalog về (controller `anchorAlignment` + 18 regression test; catalog về sau 5 giây không còn được căn lại — hệ quả chấp nhận được, ghi trong report). Owner (06/10): work item này không còn target dòng, tối đa hai PR;
PR thứ hai (CP02) seed The BHA Riverside 3 RoomType / 11 PhysicalRoom (3/2/6), giá Owner, ảnh thật,
database demo riêng — chỉ mở sau khi Owner merge PR #82. Chưa nghiệm thu: dữ liệu demo, xử lý/hiển thị
ảnh, deploy Vercel (`NOT_TESTED`); lỗi cookie khách cũ (401) còn mở. Evidence:
`docs/reports/CUST-WEB-SHOWCASE-001-CP01-completion.md`.

Bản cập nhật trước (2026-10-06, `PMS-CAL-002-CP00`, viết khi PR #81 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP07` (PR #80) đã **merged** (`2026-10-04T09:32:21Z`), merge commit
`38d4a9d964fde411aa4c03b46323f250fd54221b`; CI run `37192482384` `success` trên đúng
commit đó. Milestone `PMS-ADMIN-AUTH-001` (CP00–CP07, PR #73–#80) là **PASS — CLOSED**:
Calendar mặc định `Staff` ở mọi môi trường, `LocalGate` chỉ là opt-in Development. Kết quả
review của CP07 không được ghi trong repository (report CP07 ghi `REVIEW: NOT RUN` tại thời
điểm viết). **Chưa deploy Production.** Objective mới là `PMS-CAL-002-CP00` — thiết kế
contract cho đổi phòng giữa kỳ bằng split assignment (split-move):
`docs/design/PMS-CAL-002-split-move.md`, evidence
`docs/reports/PMS-CAL-002-CP00-completion.md`. Đó là **đề xuất**, chưa phải CURRENT và
chưa được Owner duyệt: split-move vẫn **TARGET**, chưa có route/UI; quyết định D1–D6 còn
**OPEN**; CP01–CP05 chưa được kích hoạt.

Bản cập nhật trước (2026-10-04, `PMS-ADMIN-AUTH-001-CP07`, viết khi PR #80 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP06` cùng correction C1–C4 (PR #79) đã **merged**
(`2026-10-04T08:03:02Z`), merge commit `c62719b9fe8b947ef001cc2b20ea1a6a7d5e226e`. Review C4:
RUN — no actionable regressions (Reviewed SHA: UNVERIFIED). CP07 là checkpoint cuối của
milestone Staff auth: `AdminCalendar:AccessMode` không khai báo → `Staff` ở mọi môi trường
(parser CP04-C1 giữ nguyên cho giá trị rỗng/không hợp lệ); `LocalGate` chỉ là opt-in
Development — Production/Staging/môi trường khác từ chối khởi động; hai guard Production cho
local flags giữ nguyên, kể cả ở `Staff`. Launch profile `https` không còn bật read flag.
Admin_Web: `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` không đặt → `Staff`; `LocalGate` bị từ
chối trong production build. Calendar có Staff authentication/RBAC/audit (CP03–CP06); các module
Admin mẫu khác vẫn ngoài phạm vi. Runbook vận hành:
`docs/runbooks/PMS-ADMIN-AUTH-001-staff-calendar.md`. **Chưa deploy Production.** Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP07-completion.md`. Review CP07: NOT RUN.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP06`, viết khi PR #79 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP05` (PR #78) đã **merged** (`2026-10-03T08:23:15Z`), merge commit
`8f6222984b8678027e71523f27274407f8eeeb35`. CP06 chỉ đổi Admin_Web (không backend, schema,
dependency hay CI): `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` = `LocalGate` (mặc định khi
không đặt) | `Staff`; rỗng/giá trị khác là lỗi cấu hình và không gửi request Calendar nào;
không probe, không fallback, đổi giá trị cần rebuild/restart. `Staff` mode: trang `/signin`
đăng nhập Staff (password gửi nguyên văn), `/calendar` chờ `me` (401 → `/signin`, lỗi →
Retry), selector Property từ `me.memberships`, UI theo role (FrontDesk không có
cross-RoomType, Manager có), 401 kết thúc session, 403 đọc lại `me` và cập nhật quyền;
login/logout/me/board/năm write dùng `credentials: "include"`. `LocalGate` giữ nguyên
hành vi CP05. Pending/unknown uncertain writes giữ nguyên qua reload, sign-out và đổi
Staff (không namespace theo Staff). Acceptance browser thật (Chrome, cert tin cậy) chạy
trên PostgreSQL 17 riêng đã dọn. Default/Production vẫn CP07. Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP06-completion.md`. Review CP06: RUN — 2 findings (P2:
logout bị refresh ghi đè; ghi mới trong lúc logout pending), Reviewed SHA: UNVERIFIED;
correction C1 trên cùng PR #79 sửa cả hai. Review C1: RUN — 2 findings (P2: refresh bị
logout ngắt bị mất; logout kết thúc trước recovery), Reviewed SHA: UNVERIFIED; correction C2
trên cùng PR #79 sửa cả hai. Review C2: RUN — 1 finding (P2: permission refresh lỗi sau
403 bị bỏ qua), Reviewed SHA: UNVERIFIED; correction C3 trên cùng PR #79 sửa. Review C3: RUN — 1 finding (P2: deferred access failure
lỗi thời đóng Board sau check mới hơn), Reviewed SHA: UNVERIFIED; correction C4 trên cùng PR #79
sửa. Review C4: NOT RUN.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP05`, viết khi PR #78 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP04` (PR #77) đã **merged** (`2026-10-03T06:40:05Z`), merge commit
`f3f705f5e033fbcb231e19ed8ba9051f9b901dc8` — gồm correction C1. Owner chốt D8 khi kích
hoạt CP05: audit actor `staff:{StaffAccountId}` (GUID, không PII), evidence cross-RoomType
`staff-rbac:{role}:{propertyId}:cross-room-type-confirmed` từ authorization server-side.
CP05 chuyển đổi đúng năm Calendar POST: trong `Staff` mode mỗi action cần Staff session
và permission tại Property của route (`AssignmentWrite`/`BlockWrite`), rồi Origin/JSON —
tất cả trước model binding; create/move có `confirmCrossRoomType` cần thêm
`AssignmentCrossRoomType` (Manager) trước store; audit ghi Staff thực hiện (block cancel
giữ creator của header). `LocalGate` (mặc định) giữ write gate và constants cũ. Admin_Web
chưa dùng Staff cookie/login (CP06); default/Production vẫn CP07; Calendar chưa mở công
khai. Evidence: `docs/reports/PMS-ADMIN-AUTH-001-CP05-completion.md`. Review CP05: NOT RUN.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP04`, viết khi PR #77 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP03` (PR #76) đã **merged** (`2026-10-03T05:18:26Z`), merge commit
`c89efc22246771541f6aefecf0221374076a192f` — gồm correction C1/C2; reviewed SHA của các
lần review vẫn UNVERIFIED. Owner chốt D7 khi kích hoạt CP04:
`AdminCalendar:AccessMode` = `LocalGate` | `Staff` (thiếu key → `LocalGate`; giá trị
khai báo rỗng/không hợp lệ → host không khởi động; mode cố định từ startup). CP04 thêm
`IStaffAccessEvaluator` (membership đọc từ DB mỗi request theo `propertyId` của route,
map cố định FrontDesk/Manager), và **chỉ** Board GET được chuyển: trong `Staff` mode
Board cần Staff session + `BoardRead` tại Property (401/403 trước model binding, local
flags bị bỏ qua, CORS credentialed GET cho Admin origins); mọi route `/api/admin` khác
không có Staff permission — gồm năm Calendar POST — trả 404 trong `Staff` mode, trừ
login/logout/`me` của CP03. `LocalGate` (mặc định) giữ nguyên hành vi. Default chưa đổi
sang `Staff`; writes Staff chờ CP05, Admin_Web CP06, default/Production cut-over CP07;
D8 (audit actor) vẫn **mở**. Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP04-completion.md`. Review CP04: RUN, 1 finding P2
(`"AccessMode": {}`/`[]` trong JSON bị coi như không khai báo → âm thầm `LocalGate`);
correction `CP04-C1` sửa: chỉ key thực sự không được khai báo mới là `LocalGate`, khai
báo rỗng/null/có child bị từ chối khi khởi động. Review C1: RUN — không có regression cần
xử lý.

Bản cập nhật trước (2026-10-03, `PMS-ADMIN-AUTH-001-CP03`, viết khi PR #76 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP02` (PR #75) đã **merged**, merge commit
`6baefe90c409ba22f050c235bc2d5d0cf060cbd6`. Owner chốt D3/D4 khi kích hoạt CP03:
scheme riêng `TheBha.Staff` (cookie `.TheBha.Staff`, `Path=/api/admin`,
`SameSite=Strict`, 8 giờ tuyệt đối, không sliding), Customer vẫn là default
scheme; CSRF cho Staff bằng `SameSite=Strict` + exact Origin + JSON content type,
không antiforgery token. CP03 thêm `POST /api/admin/v1/auth/login`,
`POST /api/admin/v1/auth/logout`, `GET /api/admin/v1/me` (memberships đọc từ DB mỗi
request), CORS credentialed `admin-staff`, limiter `staff-login`, và tách predicate
Origin/JSON của `AdminCalendarWriteGateFilter` thành `AdminRequestBoundary` (hành vi
gate không đổi). Staff session **không** cấp quyền vào Calendar: Board và các route
ghi vẫn chỉ sau gate local; D7 (`AccessMode`) và D8 (audit actor) vẫn **mở**.
Evidence: `docs/reports/PMS-ADMIN-AUTH-001-CP03-completion.md`. CP04–CP07 chưa được
kích hoạt. Review Codex đầu tiên (Owner gọi): RUN, 2 finding P2; correction
`CP03-C1` sửa cả hai — reset failed count thất bại thì không cấp Staff session (401
chung), và bỏ `MaxLength(128)` của password login để password dài do CLI CP02 cấp
đăng nhập được. Review C1: RUN, 1 finding P2 (count = 0 không có update kiểm tra
concurrency); correction `CP03-C2` sửa: login thành công luôn ghi lại account bằng
update kiểm tra `ConcurrencyStamp` (reset khi count > 0, `UpdateAsync` khi count = 0)
trước khi cấp session. Review C2: RUN — không có regression cần xử lý (reviewed
SHA: UNVERIFIED).

Bản cập nhật trước (2026-10-01, `PMS-ADMIN-AUTH-001-CP02`, viết khi PR #75 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP01` (PR #74) đã **merged**, merge commit
`3c1eefd5836e6fb1710817ff86021e391c55179d`. Owner quyết định D6: Staff chỉ được
tạo/quản lý qua CLI bốn verb trên API host (`--staff-create`, `--staff-grant`,
`--staff-disable`, `--staff-reset-password`), không HTTP, không Staff trong seed;
Production do Owner hoặc người Owner chỉ định chạy sau khi xác nhận database đích;
mật khẩu qua hidden prompt (hoặc `BHA_STAFF_PASSWORD` ngắn hạn), không qua
argument. CP02 thêm `Api/Authentication/StaffBootstrapCommand.cs` — chưa có đăng
nhập Staff, cookie, route authorization hay audit Staff; các gate local
unauthenticated vẫn là cơ chế duy nhất truy cập Admin và Calendar chưa sẵn sàng
mở công khai. Owner cũng đổi chính sách kích thước: 100–400 dòng mỗi PR là
**mục tiêu, không phải giới hạn** (`docs/governance/WORKFLOW.md` §6); câu "CP02–CP07
vẫn giữ giới hạn" ở đoạn CP01 bên dưới đã hết hiệu lực. Vẫn **mở**: D3 (scheme
`TheBha.Staff`), D4, D7, D8. Evidence:
`docs/reports/PMS-ADMIN-AUTH-001-CP02-completion.md`. CP03–CP07 chưa được kích hoạt.

Bản cập nhật trước (2026-10-01, `PMS-ADMIN-AUTH-001-CP01`, viết khi PR #74 còn Draft; nay đã merged):
`PMS-ADMIN-AUTH-001-CP00` (PR #73) đã **merged**, merge commit
`874f1481808afbcc83e18950b00d6ab07368b1be`. Owner đã duyệt: Staff là identity
riêng (D1); role chỉ `FrontDesk`/`Manager`, không `Viewer`; Staff dùng password/
lockout policy của Customer, MFA hoãn; ADR 0007 nằm trong CP01; riêng CP01 được
vượt giới hạn 100–400 dòng kèm lời giải thích (phần lớn là output EF sinh tự
động; CP02–CP07 vẫn giữ giới hạn). Vẫn **mở**, không được duyệt bởi merge #73
hay CP01: D3 (scheme `TheBha.Staff`), D4, D6 và bootstrap Production, D7, D8.
CP01 thêm `StaffAccount`, `StaffPropertyMembership`, migration 9
`20261001141847_AddStaffIdentityFoundation` và ADR 0007 — **chỉ schema và
Identity store**: chưa có đăng nhập Staff, cookie, endpoint, CLI bootstrap,
route authorization hay audit Staff; các gate local unauthenticated vẫn là cơ chế duy nhất
truy cập Admin. Evidence: `docs/reports/PMS-ADMIN-AUTH-001-CP01-completion.md`.
CP02–CP07 chưa được kích hoạt.

Cập nhật 2026-09-30 (`PMS-ADMIN-AUTH-001-CP00`, docs, không đổi source):
`PMS-CAL-001.5-CP04` (PR #72) đã **merged**, merge commit
`0952e1b58e274a055b47ca3f04beb6fe08ed5ed8` (`origin/develop`). Owner chọn Admin
authentication/RBAC làm milestone tiếp theo; `PMS-ADMIN-AUTH-001-CP00` là PR
thiết kế (Draft) —
`docs/design/PMS-ADMIN-AUTH-001-staff-auth-rbac.md`. Đó là **đề xuất chờ Owner
duyệt**, chưa phải CURRENT: chưa có Staff, role, membership hay đăng nhập
Admin nào; các gate local unauthenticated vẫn là cơ chế duy nhất. CP01–CP07
chưa được kích hoạt.

Bản cập nhật trước (2026-09-30, `PMS-CAL-001.5-CP04`, docs/evidence, không đổi source):
`origin/develop` = `3d7eb12b09286bbb2aa79590442f4ace69321563` (PR #71). PR
#48–#71 đều **merged**; các câu bên dưới nói CP04B là "đang thực thi" đã hết
hiệu lực. Trong `develop` hiện có, trên Admin Reservation Board (local
Development, write gate CP01, không Admin authentication/RBAC): assign
(#45/#46), move bằng dialog (#52–#55), unassign (#56–#63), tạo và hủy
operational block (#64–#67), kéo một assigned segment sang phòng khác để
**mở dialog Move** (#68; drop chỉ chọn phòng, ngày và `expectedVersion` lấy
từ segment, chỉ confirm mới gửi), và bảo vệ write qua reload **cùng tab**
(#70/#71 cùng C2–C4 trong #71: lưu intent vào `sessionStorage` trước khi gửi,
khôi phục thành "gửi rồi, chưa rõ kết quả", khóa đúng Property/phòng/đêm,
không tự gửi lại). Đây **không** phải idempotency phía server, không bảo vệ
qua tab/thiết bị khác hay khi đóng browser. Evidence live của checkpoint này:
`docs/reports/PMS-CAL-001.5-CP04-completion.md`. Chưa hoàn tất: Admin
authentication/RBAC, deploy công khai, lifecycle/payment, split/swap/batch qua
HTTP, OperationalBlock move/split, OTA thật.

Lần cập nhật này ghi nhận `PMS-CAL-001.1` — Reservation Board Read
Projection & Frontend Integration — đã **merged và closed**: PR #41 merge
vào `develop` lúc `2026-09-03T03:11:21Z`, merge commit
`e0f5a395aec15cc02e328433a97850e30e165675`. Bản Snapshot trước mô tả PR #41
là **Draft/OPEN/chưa merge**; mô tả đó được viết trước thời điểm merge và
nay đã hết hiệu lực. Mọi câu "đang chờ Codex review trên C11 PR head" trong
các bản trước cũng đã hết hiệu lực.

`PMS-CAL-001.2-CP01` — Local Admin Write Gate foundation — đã **merged**:
PR #43 merge vào `develop` lúc `2026-09-11T12:53:38Z`, merge commit
`c8c1ea50e2b2eec44b1ae30e65a7919596458f99`, remote feature branch đã xóa.
`PMS-CAL-001.2-CP02` (PR #44, merge commit
`2f50951b8197eab7e2180e2ea4498a9fea1042d8`), `CP03A` (PR #45, merge commit
`261f75595042d9549ac3133b503cd09a66ed193a`), `CP03B` (PR #46, merge commit
`16303edd472e4b960db8b765f69b394f58411246`) và `CP04A` (PR #47, merge commit
`2fefb6295e4b772411dc2c63c270e298253690db`) đều đã **merged**; CI `success`
trên đúng từng merge commit, remote feature branch đã xóa. `CP04B` (PR #48)
và các PR sau đến #71 cũng đã merged (đoạn cập nhật ở đầu file). Không có mô
tả nào ở đây tuyên bố production readiness.

Lịch sử checkpoint của `PMS-CAL-001.1` được giữ lại vì mỗi CI run và review
result trích dẫn dưới đây gắn với **đúng SHA nêu kèm**, không tự động áp cho
SHA khác (xem §1, §2, §8; evidence canonical ở
`docs/reports/PMS-CAL-001.1-completion.md`):

- **Product-reviewed checkpoint** — `63d9b6019e4af37e146d943a1b8c1c13ac096469`:
  implementation cộng correction cycles `C1`–`C9`. CI run `33707673146`
  `success` trên đúng SHA đó; Codex review trên chính checkpoint này trả
  về **không có actionable correctness defect**. Đây là checkpoint mà
  product code đã được review, **không phải** PR head hiện tại.
- **C10 docs-only checkpoint** — `e6999914dd7a5afbf791506ffb598a99b8c320e6`:
  đồng bộ Snapshot, không đụng product code. CI run `33708652703` `success`.
  Codex review trên checkpoint này trả về **hai finding tài liệu**, không
  phát hiện thêm defect nào trong product code.
- **C11**: docs-only correction xử lý hai finding đó; là commit cuối trên
  feature branch trước khi Owner merge.
- **Merge commit** — `e0f5a395aec15cc02e328433a97850e30e165675`: CI run
  `33710458612` `success` (Backend/Frontend/Admin) trên đúng merge commit.

Repository SHA và PR state bên dưới đã được xác minh trực tiếp qua
`git`/`gh` tại thời điểm cập nhật tài liệu này, không phải cam kết rằng SHA
này sẽ còn là `develop` HEAD sau các commit tiếp theo; revalidate lại
`origin/develop` trước khi tạo feature branch mới.

## 1. Repository state

| Thuộc tính | Giá trị |
|---|---|
| Repository | `emLamHD/The_BHA_hotels_Booking` |
| Base branch | `develop` |
| `develop` HEAD | `38d4a9d964fde411aa4c03b46323f250fd54221b` (merge commit của PR #80, xác minh 2026-10-06; đọc lại từ Git sau `git fetch --prune origin` trước khi dùng làm baseline) |
| PR #31 | merged — `docs(pms): record core database blueprint v2`, merge commit `bfb3377b701e9309d3cbbea22bb18159bc37a2e0`, merged `2026-08-19T10:56:01Z`. Persists PMS blueprint documentation foundation (`docs/design/PMS-DATA-001-core-database-blueprint-v2.md`, ADR 0005, ADR 0006). |
| PR #32 | merged — `feat(admin): add PMS reservation board UI baseline`, merge commit `17e929d7c1f82941599223344b5f4cdc3aa34307`, merged `2026-08-22T14:42:31Z`. Closes `ADMIN-002.1`. |
| PR #33 | merged — `docs(project): close ADMIN-002.1 and record next sequence`, merge commit `2c38face7cf51d7271c361e6d684adea466edcf9`, merged `2026-08-22T15:38:25Z`. Closes `ADMIN-002.1-DOCS-CLOSEOUT`. |
| PR #34 | merged — `docs(project): record Graphify tooling adoption`, merge commit `7db8844dfde5ccc0651949f83ddfff76a3a977b9`, merged `2026-08-22T19:08:04Z`. Closes `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`; remote branch `docs/tool-graphify-001-closeout` deleted. This row is the current-state truth, replacing a since-corrected stale reference that had lingered in this file's own §7 section. |
| PR #35 | merged — `feat(booking): normalize commercial commitments`, feature branch `feature/pms-be-001-1-commercial-commitment-v2-foundation` (head `9e25f7cb6247420467957061a13c04801ce9b3c7`), merge commit `265d10006b219e456c30ed92bbb6c153a946944d`, merged `2026-08-24T16:46:46Z`. Closes `PMS-BE-001.1`. GitHub CI (Admin/Backend/Frontend) confirmed `pass` on this PR as of this Snapshot update (`gh pr checks 35`). Remote feature branch deleted (confirmed empty via `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`); the linked worktree `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for its implementation is confirmed removed (directory absent, not listed by `git worktree list --porcelain`) — see §4. |
| PR #36 | merged — `docs(project): close PMS-BE-001.1 and restore single-checkout workflow`, feature branch `docs/pms-be-001-1-closeout-single-checkout` (head `c8938c731dd5647868a07f0c3654d919e5d60e9a`), merge commit `298b7fd53c47824550e955b98c2bed370b38a646`, merged `2026-08-24T19:17:44Z`. Closes `PMS-BE-001.1-DOCS-CLOSEOUT`. |
| PR #37 | merged — `feat(pms): add physical room schedule and availability authority`, feature branch `feature/pms-be-001-2-physical-room-schedule-availability` (head `4b2de0ab50fa1703f0b125a043d2461cc0309417`), merge commit `0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`, merged `2026-08-26T10:33:13Z`. Closes `PMS-BE-001.2`. GitHub Actions (Backend/Frontend/Admin) confirmed `success` on this head (run `32957454881`). Remote feature branch confirmed deleted (`git ls-remote --heads origin feature/pms-be-001-2-physical-room-schedule-availability` empty). |
| PR #38 | merged — `docs(project): close PMS-BE-001.2 and record calendar handoff`, feature branch `docs/pms-be-001-2-closeout` (head `9b627fb29ce4b5b955e6e5640a465aa03953304f`), merge commit `f0eef23c59608d2aba1e43063c38074ea863edef`, merged `2026-08-26T12:01:07Z`. Closes `PMS-BE-001.2-DOCS-CLOSEOUT`. |
| PR #39 | merged — `docs(governance): allow prompt-selected single implementer`, merge commit `89b631cc58cb4d21e99d6054d2a9094338283fc7`, merged `2026-09-01T15:44:40Z`. Closes `AI-OPS-GOV-003`. |
| PR #40 | merged — `test(backend): pin clock in reservation-cancellation integration test`, feature branch `fix/pin-clock-reservation-cancellation-test`, merge commit `ff9d5b0c8d58efe64b562c631ecb36d488887df8`, merged `2026-09-01T15:57:51Z`. Unplanned CI fix: `AssignmentAwareAvailabilityTests.Reservation_cancellation_atomically_cancels_effective_assignments_and_removes_demand` never pinned `factory.Clock.UtcNow`, so it silently depended on real wall-clock time staying before its hardcoded `2026-09-01` check-in date. GitHub Actions (Admin/Backend/Frontend) confirmed `pass` on this head. Remote feature branch confirmed deleted. |
| PR #41 | merged — `feat(pms): Reservation Board read projection & Admin frontend integration`, feature branch `feature/pms-cal-001-1-board-read-integration`, checked out directly in the one repository checkout (no `git worktree add`), baseline `ff9d5b0c8d58efe64b562c631ecb36d488887df8` (PR #40), merge commit `e0f5a395aec15cc02e328433a97850e30e165675`, merged `2026-09-03T03:11:21Z`. Closes `PMS-CAL-001.1`. GitHub Actions (Backend/Frontend/Admin) `success` trên đúng merge commit (run `33710458612`). Remote feature branch confirmed deleted. Checkpoint/correction history (`C1`–`C11`) và toàn bộ evidence: `docs/reports/PMS-CAL-001.1-completion.md` (không liệt kê lại ở đây). |
| PR #42 | **CLOSED, NOT MERGED** — `fix(governance): reconcile merged PR state`, base `develop`, head branch `chore/ai-ops-gov-004-reconcile-pr41`. Một nỗ lực governance reconcile sau merge của PR #41; Owner đóng PR mà không merge, nên **không có** nội dung nào của nó nằm trong `develop` và không có commit nào của nó là ancestor của baseline hiện tại. Ghi ở đây chỉ để `#42` không bị đọc nhầm là đang mở hoặc đã merge. |
| PR #43 | merged — `feat(admin): local Admin Calendar write gate foundation`, feature branch `feature/pms-cal-001-2-cp01-local-write-gate`, baseline `e0f5a395aec15cc02e328433a97850e30e165675` (PR #41), merge commit `c8c1ea50e2b2eec44b1ae30e65a7919596458f99`, merged `2026-09-11T12:53:38Z`. Closes `PMS-CAL-001.2-CP01` (implementation cộng correction `C1`). Remote feature branch confirmed deleted (`git ls-remote --heads origin feature/pms-cal-001-2-cp01-local-write-gate` rỗng). Evidence: `docs/reports/PMS-CAL-001.2-CP01-completion.md`. |
| PR #44 | merged — `feat(admin): Admin reservation-assignment create API (PMS-CAL-001.2-CP02)`, merge commit `2f50951b8197eab7e2180e2ea4498a9fea1042d8`, merged `2026-09-13T08:02:12Z`. CI run `34746682303` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #45 | merged — `feat(admin): same-RoomType reservation assignment from the board (PMS-CAL-001.2-CP03A)`, merge commit `261f75595042d9549ac3133b503cd09a66ed193a`, merged `2026-09-14T17:09:04Z`. CI run `34872986691` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #46 | merged — `feat(admin): controlled cross-RoomType reservation assignment (PMS-CAL-001.2-CP03B)`, merge commit `16303edd472e4b960db8b765f69b394f58411246`, merged `2026-09-14T18:02:54Z`. CI run `34878420882` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #47 | merged — `fix(backend): record SupersedeAsync authorization evidence per audit event (PMS-CAL-001.2-CP04A)`, merge commit `2fefb6295e4b772411dc2c63c270e298253690db`, merged `2026-09-14T18:58:06Z`. CI run `34884020638` `success` trên đúng merge commit. Remote feature branch đã xóa. |
| PR #48–#71 | merged (2026-09 → 2026-09-30); CI của từng PR nằm trong mô tả PR đó, riêng merge #71 (`3d7eb12`) là run `36690121585` `success`: CP04B route move/unassign (#48, `b898c39`); CP04C–D move/unassign trên board (#49–#63); `PMS-CAL-001.3` block create/cancel API và board (#64–#67, `21240aa`); `PMS-CAL-001.4-CP01` kéo-để-mở-dialog-move (#68, `27c962d`); `PMS-CAL-001.5` CP01 (#69, `56eff1c`), CP02 (#70, `80f582e`), CP03 (#71, merge `3d7eb12b09286bbb2aa79590442f4ace69321563`). |
| PR #72–#80 | merged: `PMS-CAL-001.5-CP04` (#72, `0952e1b`); `PMS-ADMIN-AUTH-001` CP00 (#73, `874f148`), CP01 (#74, `3c1eefd`), CP02 (#75, `6baefe9`), CP03 (#76, `c89efc2`), CP04 (#77, `f3f705f`), CP05 (#78, `8f62229`), CP06 (#79, `c62719b`), CP07 (#80, merge `38d4a9d964fde411aa4c03b46323f250fd54221b`, `2026-10-04T09:32:21Z`, CI run `37192482384` `success`). PR thực thi đang mở duy nhất: Draft PR của `PMS-CAL-002-CP00` (docs-only). |

## 2. Work item state

### Hoàn tất

- `FE-001`: closed trước baseline hiện tại.
- `DATA-001.1`: đạt technical gate, PR #22 đã merge; `DATA-001.2` vẫn
  dormant/deferred (xem §5).
- `AI-OPS-GOV-002`: `PASS`.
- `AI-OPS-PILOT-001`: `PASS` — PR #27, merge `bb64f7e1592f4924049935ecc08922539c532bf8`.
- `FE-002.1` — Hold Confirmation UI: `PASS — CLOSED`. PR #28, merge commit
  `3f68bd79eff7f6c553e5516431abd09a93298f71`, merged 2026-08-12T13:39:21Z.
  Full evidence in `docs/daily/2026-08/2026-08-12-worklog.md`.
- `ADMIN-001.1` — Admin Web Template Baseline: `PASS — CLOSED`. PR #30
  merged (`f97c3529fb94c08fafad0da059ec1cf2b839b0d0`, 2026-08-18T10:12:53Z).
  Imports TailAdmin 2.3.0 as `Front_End/Admin_Web`.
- `PMS-DATA-DOCS-001`: `PASS — CLOSED`. PR #31 merged as above. Persists the
  Owner-approved TARGET PMS/database architecture into durable
  documentation. No table, column, constraint, migration, entity, endpoint,
  or UI described there is implemented by that documentation.
- `ADMIN-002.1` — PMS Reservation Board UI Baseline: `PASS — CLOSED`. PR #32
  merged as above. **This is the completed frontend phase**: an
  interactive Admin Reservation Board/Calendar prototype in
  `Front_End/Admin_Web` (room/date timeline, multi-property demo switching,
  assigned/unassigned reservations, operational blocks, front-desk
  reservation-creation and lifecycle/folio/notes/activity workspaces). Full
  evidence in `docs/reports/ADMIN-002.1-completion.md`. Only the frontend
  UI baseline is complete — see §5 for its mock-only boundary.
- `ADMIN-002.1-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #33 merged as above.
  Docs-only synchronization; no product source touched.
- `TOOL-GRAPHIFY-001` (Graphify tooling-adoption): `PASS — CLOSED`, adopted
  as an **optional, workspace-local** code-navigation tool. Full evidence in
  `docs/reports/TOOL-GRAPHIFY-001-completion.md`;
  `docs/governance/WORKFLOW.md` §12 is the canonical invocation policy.
- `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #34 merged as
  above. Docs-only diff; no product source touched.
- `PMS-BE-001.1` — Commercial Commitment V2 Foundation: `PASS — CLOSED`. PR
  #35 merged as above. Replaces the single-RoomType
  `BookingHold`/`BookingHoldNight`/`Reservation`/`ReservationNight`
  commercial authority with the normalized ADR 0005 `InventoryHold →
  InventoryHoldItem → InventoryHoldItemNight` / `Reservation →
  ReservationUnit → ReservationUnitNight` authority (migration 7,
  `CommercialCommitmentV2Foundation`), while preserving the public
  `/api/v1` contract byte-identical. Correction `PMS-BE-001.1-C1` (a Codex
  `[P1]` finding on the guarded downgrade's cross-night RatePlan check) was
  fixed and closed before merge — see
  `docs/reports/PMS-BE-001.1-completion.md`. Final Codex review: `PASS`, no
  discrete actionable correctness issue (Owner/OC-confirmed context for
  this closeout; not independently re-derivable from GitHub, since this
  repository's Codex review results are relayed through Owner/OC rather
  than posted as PR comments — no `gh pr view 35` comment trail exists to
  quote verbatim). Full detail in §4.
- `PMS-BE-001.1-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #36 merged as above
  (§1). Docs-only closeout of `PMS-BE-001.1` and restoration of
  single-primary-checkout-by-default governance; no product source touched.
- `PMS-BE-001.2` — Physical Room Schedule & Availability Authority:
  `PASS — CLOSED`. PR #37 merged as above (§1). Delivers the PhysicalRoom
  schedule database authority, block-adjusted/assignment-attributed
  availability, whole-Reservation cancellation cleanup, and an
  internal-only assignment/block mutation boundary with no HTTP/Admin
  exposure and no Staff/RBAC model — full as-built detail in ADR 0006 and
  `docs/reports/PMS-BE-001.2-completion.md`, not repeated here. Two
  Owner-invoked Codex corrections (`C1`: active-Hold demand omitted from
  mutation capacity validation; `C2`: booked-night coverage trigger let a
  `ReservationUnitNight` transfer ownership between Units unvalidated) were
  fixed and closed before merge — see the completion report. Does **not**
  implement: multi-RoomType public request shape, `Organization`, Admin
  authentication/RBAC, Staff identity, any HTTP exposure of the schedule
  authority, OTA, `FolioEntries`, or `DATA-001.2`.
- `PMS-BE-001.2-DOCS-CLOSEOUT`: `PASS — CLOSED`. PR #38 merged as above
  (§1). Docs-only closeout of `PMS-BE-001.2` after PR #37 merged; records
  `PMS-CAL-001.1` as the next Control-Tower-selected product work item,
  authorized for OC planning only, not implementation.
- `AI-OPS-GOV-003` — Prompt-Selected Single Implementer and Independent
  Reviewer: `PASS — CLOSED`. PR #39 merged as above (§1). Governance-only:
  replaces the repository's fixed Claude-implements/Codex-reviews
  assignment with a prompt-selected role pair (`docs/governance/RULES.md`
  §2.4), while preserving one writer, independent read-only review, OC
  authority and Owner-only merge. Went through correction cycles
  `C1`/`FINAL-SIMPLIFICATION`/`RESIDUAL-FIX`/`FINAL-INVOCATION-FIX` before
  merge — full detail in `docs/daily/2026-09/2026-09-01-worklog.md`.
- `CI fix (unplanned)`: `PASS — CLOSED`. PR #40 merged as above (§1). Fixed
  a test-time-bomb (`AssignmentAwareAvailabilityTests`, unpinned
  `factory.Clock.UtcNow` against a hardcoded 2026-09-01 date) that broke CI
  once real wall-clock time caught up. Not tied to any work-item ID; not a
  product/schema change.
- `PMS-CAL-001.1` — Reservation Board Read Projection & Frontend
  Integration: `PASS — CLOSED`. PR #41 merged as above (§1), merge commit
  `e0f5a395aec15cc02e328433a97850e30e165675`, `2026-09-03T03:11:21Z`. Adds
  the read-only Admin Reservation Board projection
  (`GET /api/admin/v1/properties/{propertyId}/reservation-board`, gated to
  same-machine development by `AdminCalendar:EnableUnauthenticatedRead`) and
  wires `Front_End/Admin_Web`'s board to it. Correction history `C1`–`C11`
  and all evidence — **canonical** — in
  `docs/reports/PMS-CAL-001.1-completion.md`. Does **not** implement: any
  mutation endpoint, Admin authentication/RBAC, Staff identity, or a schema
  change (still migration 8).

- `PMS-CAL-001.2-CP02` (PR #44), `CP03A` (PR #45), `CP03B` (PR #46) — merged.
  CP02 expose đúng một endpoint local-only
  `POST /api/admin/v1/properties/{propertyId:guid}/reservation-assignments`
  trên `IAssignmentMutationStore.CreateAsync`; CP03A cho Admin Reservation
  Board gọi nó để gán một unassigned range vào phòng Active cùng sold
  RoomType; CP03B mở rộng cùng dialog sang cross-RoomType có xác nhận thao
  tác và reason bắt buộc. Evidence nằm trong mô tả của từng PR.

### Hoàn tất (tiếp)

- `PMS-CAL-001.2-CP04A` (PR #47) — merged. `SupersedeAsync` ghi
  `AuthorizationEvidence` per audit event, không còn copy nguyên command
  evidence vào mọi row.

### Đang thực thi

- `PMS-ADMIN-AUTH-001` — Staff authentication/RBAC cho Admin Calendar: `PASS — CLOSED`.
  CP00–CP07 merged (PR #73–#80, CP07 merge `38d4a9d`). Chưa deploy Production.

### Đang thực thi

- `CUST-WEB-SHOWCASE-001-CP01` — Customer Web thật ở `/`, route template bị chặn (Draft PR).
- `PMS-CAL-002`: thiết kế split-move merged (PR #81); **tạm dừng**, D1–D6 OPEN, CP01–CP05 không mở.
- Các mutation khác (assignment swap/batch, operational-block move/split) **chưa kích
  hoạt**; Snapshot này không tự mở chúng.

### Quyết định đang hiệu lực

`PMS_ADMIN_AUTH_001_CLOSED__PMS_CAL_002_CP00_DESIGN_ACTIVE`

Ý nghĩa:

- `PMS-CAL-001.1` đã merge và đóng (`PASS — CLOSED`). Merge commit
  `e0f5a395aec15cc02e328433a97850e30e165675`; CI run `33710458612`
  `success` trên đúng commit đó. Remote feature branch đã bị xóa. Không còn
  bước review hay merge nào đang chờ cho work item này; mọi mô tả "đang chờ
  Codex review trên C11 PR head" trong các bản Snapshot trước đã hết hiệu
  lực.
- Owner đã thay kế hoạch một PR lớn cho `PMS-CAL-001.2` bằng các checkpoint
  độc lập. `CP01`–`CP04D` đã merge (PR #43–#63); `PMS-CAL-001.3`–`.5`
  cũng đã merge đến PR #71; các checkpoint sau chưa được kích hoạt.
- Admin Calendar (Board read và năm route ghi) có Staff authentication,
  RBAC theo Property/role và audit `staff:{id}` (`PMS-ADMIN-AUTH-001` CP03–CP06,
  merged); CP07 (PR #80, merged) làm `Staff` thành mặc định và giới hạn `LocalGate`
  (write/read gate same-machine development, không auth) thành opt-in
  Development. Chưa có Production deployment; các module Admin mẫu khác vẫn
  ngoài phạm vi. Admin Reservation Board là caller duy nhất của các route.
- Chỉ Owner được mark Ready, merge và branch cleanup. Claude không merge,
  không mark Ready, không xóa branch, và không tự invoke Codex.
- Governance vẫn dùng đúng một checkout repository duy nhất cho execution
  (`docs/governance/RULES.md` §5); `git worktree add` và mọi checkout thực
  thi bổ sung đều bị cấm, không có ngoại lệ.

### Tạm hoãn / locked

- `DATA-001.2`: dormant/deferred; không tự động kích hoạt lại.
- Mọi product implementation dựa trên PMS blueprint TARGET vượt ngoài phạm
  vi `PMS-BE-001.1`/`PMS-BE-001.2` và ngoài phạm vi planning-only của
  `PMS-CAL-001.1` (Organization, multi-RoomType Hold/Reservation
  **request** shape, HTTP/Admin/Calendar exposure của
  `RoomOccupancySegments`/`RoomBlock` vượt ngoài `PMS-CAL-001.1` và
  `PMS-CAL-001.2`'s exact scope, `FolioEntries`, OTA
  adapter/inbox/outbox): **locked** — documented as TARGET/APPROVED by
  `PMS-DATA-DOCS-001`, not authorized for implementation until its own
  Master Execution Prompt.
  Staff identity và Admin Calendar authentication/RBAC không còn locked: chúng
  CURRENT qua `PMS-ADMIN-AUTH-001` (PR #73–#80).
- Payments/refunds, full housekeeping/maintenance modules, production
  migrations for any remaining PMS TARGET entity, and adapter-specific OTA
  design: locked, unrelated separately authorized future work.

## 3. Current PostgreSQL schema and Hold/Reservation model

- `PMS-ADMIN-AUTH-001-CP01` (merged, PR #74) adds migration 9,
  `20261001141847_AddStaffIdentityFoundation`: `StaffAccounts` and
  `StaffPropertyMemberships` (ADR 0007; `docs/DATABASE.md`). Migrations 1–8
  are unchanged. The bullet below records the chain as of `PMS-BE-001.2`.
- Migration chain is now **eight** migrations, ending at
  `20260826035254_PhysicalRoomScheduleAvailabilityAuthority` (`PMS-BE-001.2`
  migration 8, this work item). Migrations 1–7 (pre-existing before
  `PMS-BE-001.2`) are byte-identical to `origin/develop` — confirmed via
  `git diff origin/develop` at this Snapshot update. No ninth migration was
  created; Phase 4's mutation-command work reused migration 8's schema and
  the ADR 0006 exclusion/trigger invariants without any further schema
  change. No other PMS migration exists (`Organization`, `FolioEntries`, OTA
  inbox/outbox remain unimplemented — see below).
- CURRENT commercial commitment authority (`BE-003.1`–`BE-003.5`,
  `PMS-BE-001.1`) is the ADR 0005 normalized model:
  `InventoryHold → InventoryHoldItem → InventoryHoldItemNight` and
  `Reservation → ReservationUnit → ReservationUnitNight`. Every persisted
  Item/Unit represents exactly one room (no `Quantity`/`Rooms` field exists
  on Item/Unit/Night); every nightly row carries its own `RatePlanId` and
  accepted money. `ReservationUnit.CommitmentStatus = Committed | Cancelled`
  is the sole demand predicate — committed demand counts every
  `InventoryHoldItemNight` of an `Active`, unexpired Hold and every
  `ReservationUnitNight` of a `Committed` Unit, exactly once. The public
  `/api/v1` contract, and the CURRENT limitation to exactly one
  RoomType/RatePlan per public Hold/Reservation request, are both unchanged
  — the request is atomically normalized into `Q` independent Items/Units
  internally; multi-RoomType **request** shape remains TARGET. The legacy
  `BookingHold`/`BookingHoldNight`/`ReservationNight` tables and the
  `RoomTypeId`/`RatePlanId`/`Rooms` columns previously on `Reservations` no
  longer exist — there is no dual-write and no dormant normalized table.
- CURRENT physical-room schedule authority (`PMS-BE-001.2`, ADR 0006,
  migration 8): `RoomOccupancySegment` is the sole PhysicalRoom schedule —
  no separate `RoomAssignments` dual-write model — with PostgreSQL-enforced
  exclusion, booked-night-coverage, unit-commitment-consistency, and
  same-Property invariants, `xmin` optimistic concurrency, and append-only
  audit. Availability is block-adjusted and assignment-attributed.
  Whole-Reservation cancellation atomically cancels its assignment segments.
  Assignment/OperationalBlock mutation commands live behind the
  application/persistence boundary. Trên `develop` các operation được expose
  qua HTTP — từ `PMS-ADMIN-AUTH-001-CP07` mặc định cần Staff session và permission
  theo Property/role (`AccessMode=Staff`); `LocalGate` (write gate của CP01, PR #43)
  chỉ còn là opt-in Development —
  là: `CreateAsync` qua
  `POST /api/admin/v1/properties/{propertyId}/reservation-assignments` (CP02,
  PR #44; được Admin Reservation Board gọi qua PR #45/#46), `SupersedeAsync`
  dạng một-segment qua `POST .../reservation-assignments/{segmentId}/move` và
  `.../unassign` (CP04B), và `CreateBlockAsync` dạng một-segment qua
  `POST /api/admin/v1/properties/{propertyId}/operational-blocks`
  (`PMS-CAL-001.3-CP01`; Admin Reservation Board gọi từ CP03; endpoint từ chối
  `[startDate, endDate)` dài hơn **366 đêm** ngay tại HTTP boundary — chốt
  chặn tài nguyên, không phải business rule về độ dài closure), và
  `SupersedeSegmentsAsync` dạng một-segment, không replacement, qua
  `POST .../operational-blocks/{segmentId}/cancel` (`PMS-CAL-001.3-CP02`;
  Admin Reservation Board gọi từ CP04 — block bar → popover → dialog xác nhận
  hiển thị đúng toàn bộ nights của segment và `expectedVersion` từ board, rồi
  đọc lại board). `SupersedeAsync` dạng split/batch và
  OperationalBlock move/split/multi-segment supersede **vẫn** internal-only (thiết kế
  split-move một-segment: `PMS-CAL-002-CP00`, TARGET). Cross-RoomType assignment
  requires an `AuthorizationEvidence`/`Reason` pair: ở `Staff` mode evidence là
  `staff-rbac:{role}:{propertyId}:cross-room-type-confirmed` từ authorization
  server-side (permission `AssignmentCrossRoomType`, Manager) và actor là
  `staff:{id}`; ở `LocalGate` vẫn là hằng số opaque. A
  shared `AdvisoryLockCoordinator` is now used by every advisory-lock-taking
  writer. Exact constraint names, SQLSTATEs, lock order, and error mapping
  are recorded in ADR 0006 and `docs/reports/PMS-BE-001.2-completion.md`,
  not duplicated here.
- No `Organization` entity, no `FolioEntries` table, and no OTA
  inbox/outbox exist anywhere in the current schema or codebase.
- CURRENT Admin Calendar read exposure (`PMS-CAL-001.1`, no schema change):
  one HTTP `GET` endpoint,
  `/api/admin/v1/properties/{propertyId}/reservation-board`, projects the
  existing `RoomOccupancySegment`/`RoomBlock` authority (above) into a
  frozen read-only JSON contract for the Admin Reservation Board frontend.
  **Read-only**: các route ghi (CP02/CP04B, merged) là những route riêng và
  không thuộc contract đọc này. Mỗi
  request chỉ được phục vụ khi **tất cả** điều kiện sau đúng, kiểm tra
  trước model binding: HTTPS; host environment là Development; địa chỉ
  local **và** remote của connection đều là loopback; và
  `AdminCalendar:EnableUnauthenticatedRead` là `true` — mà cờ này mặc định
  `false` **kể cả trong Development**, chỉ được bật bởi supported local
  HTTPS launch profile (từ CP07: biến môi trường local tường minh cùng
  `AdminCalendar__AccessMode=LocalGate`; `AdminCalendar__EnableUnauthenticatedRead=true`,
  bind duy nhất vào `localhost`), và không thể bật ở Production
  (startup-fatal). Mọi request không thỏa mãn nhận `404` + `no-store`,
  không phân biệt được với route không tồn tại. Đây là endpoint
  **same-machine development only** — không public production-ready; đó là
  `AccessMode=LocalGate`. Mặc định (`Staff`, CP07) thay các điều kiện này bằng
  Staff session + membership/role kiểm tra trên server (design §7). Exact contract/coverage-
  classification detail: `docs/reports/PMS-CAL-001.1-completion.md`.
- The `ADMIN-002.1` frontend's Reservation Board (§5) now reads this real
  endpoint instead of browser-memory mock state (`PMS-CAL-001.1`, §2); the
  rest of that prototype (front-desk creation workspace, lifecycle/folio/
  move demonstrations) is unchanged and still mock-only.

## 4. Verification evidence — prior closed work items

Full verification evidence for `FE-002.1` (PR #28) and `AI-OPS-PILOT-001`
(PR #27) remains recorded in `docs/daily/2026-08/2026-08-12-worklog.md`.

`ADMIN-001.1` (PR #30): Admin CI (independent job) green; template imported
with upstream TailAdmin attribution preserved; no backend/API/database
change.

`PMS-DATA-DOCS-001` (PR #31): docs-only diff, no product source/schema/API
change; Owner-invoked Codex review and Owner merge.

`ADMIN-002.1` (PR #32): full C1–C8 iteration history, final CI run
`32567637108` (Admin/Frontend/Backend all `success`), final Codex review
"No actionable correctness defects were identified in the reviewed diff."
Full detail in `docs/reports/ADMIN-002.1-completion.md`.

`ADMIN-002.1-DOCS-CLOSEOUT` (PR #33): docs-only diff, merged
`2c38face7cf51d7271c361e6d684adea466edcf9` at `2026-08-22T15:38:25Z`;
confirmed via `gh pr view 33` and remote branch deletion.

`TOOL-GRAPHIFY-001` / `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT` (PR #34): functional
gate evidence (not corpus-count comparisons) — exact CLI version confirmed;
Claude ran the project-scoped install and cleaned its known side effects;
code-only graph build completed; pilot query correctly identified the three
required ownership areas in `Front_End/Admin_Web`, independently checked
against source. Merge confirmed via `gh pr view 34` (`MERGED`, merge commit
`7db8844d...`, merged `2026-08-22T19:08:04Z`) and empty
`git ls-remote --heads origin docs/tool-graphify-001-closeout`. Full detail
in `docs/reports/TOOL-GRAPHIFY-001-completion.md`.

`PMS-BE-001.1` (PR #35): full C0–C1 implementation and correction history
in `docs/reports/PMS-BE-001.1-completion.md`,
`docs/daily/2026-08/2026-08-23-worklog.md`, and
`docs/daily/2026-08/2026-08-24-worklog.md`. Merge and cleanup evidence
independently verified for this Snapshot update via:

- `gh pr view 35`: `state=MERGED`, `headRefOid=9e25f7cb6247420467957061a13c04801ce9b3c7`,
  `mergeCommit=265d10006b219e456c30ed92bbb6c153a946944d`,
  `mergedAt=2026-08-24T16:46:46Z`.
- `gh pr checks 35`: Admin/Backend/Frontend all `pass`.
- `git ls-remote --heads origin feature/pms-be-001-1-commercial-commitment-v2-foundation`:
  empty — remote feature branch deleted.
- `git worktree list --porcelain` at this Snapshot's preflight: the linked
  worktree `/home/admin1/The_BHA_hotels_Booking-pms-be-001-1` used for this
  work item's implementation is **not** listed, and the directory itself is
  absent from disk — cleanup confirmed. (Two unrelated historical linked
  worktrees from discontinued Orca dry-runs, dated 2026-08-07, remain
  registered under `/home/admin1/orca/workspaces/...`; audited, not
  mutated — out of scope for this work item.)
- Backend test suite reproduced independently in this Claude Code session,
  built from the merged commit (`9e25f7cb6...`) against real PostgreSQL 17:
  **243/243** unit tests, **257/257** integration tests, **6/6**
  `CommercialCommitmentV2MigrationTests` — all PASS, matching the counts
  recorded in `docs/reports/PMS-BE-001.1-completion.md`'s C1 section.
  `Front_End/Customer_Web` **298/298** test count is sourced from that
  completion report (not independently re-run in this session).
- Manual, end-to-end acceptance test performed in this session against the
  live merged code: built and ran `TheBha.Api` from a clean checkout of the
  merged commit against a disposable, migration-7-applied PostgreSQL
  database (isolated from `thebha_dev`); exercised the exact API sequence
  `Front_End/Customer_Web` uses (`GET .../availability` →
  `POST /api/v1/booking-holds` → `POST .../confirm` →
  `POST /api/v1/reservations/{id}/cancel`) for a 2-room × 2-night case:
  - availability search: `requestedRooms=2`, `availableRooms=2`,
    `totalAmount=6,000,000 VND` (2 × 2 × 1,500,000).
  - Hold creation: exactly 1 `InventoryHold`, 2 `InventoryHoldItems`, 4
    `InventoryHoldItemNights`; `SUM(UnitAmount)` of the Nights equals
    `InventoryHolds.TotalAmount` exactly.
  - Confirmation: exactly 1 `Reservation`, 2 `ReservationUnits`, 4
    `ReservationUnitNights`; the 2 Units carry 2 **distinct**
    `SourceInventoryHoldItemId` values; all Units `CommitmentStatus =
    Committed`; `SUM(UnitAmount)` equals `Reservations.TotalAmount` exactly.
  - Availability after confirmation: raw committed-demand aggregation
    (reconstructed directly in SQL, before the API's `Math.Max(0, …)`
    clamp) equals exactly 2 rooms/night, not 4 — confirming the Hold's
    demand is excluded once its status flips to `Confirmed` and only the
    `Committed` Reservation Units are counted, with no double-count.
  - Cancellation: both Units transition to `CommitmentStatus = Cancelled`;
    their Night rows (`RatePlanId`, `UnitAmount`, `StayDate`) are byte-for-
    byte unchanged; availability search afterward returns
    `availableRooms=2` again.
  - All 5/5 manual acceptance criteria PASS. This is Owner-requested manual
    UI/database acceptance evidence performed via direct API calls (no
    Customer Web UI click-through — the Claude-in-Chrome browser extension
    was not connected in this session) against the real running system and
    real PostgreSQL, not a mock or unit-test double.

`PMS-BE-001.2` (PR #37): full checkpoint/correction history, self-review,
and local/CI verification evidence (build, full unit/integration/
migration/concurrency test counts, EF pending-model check, frontend CI
parity, forbidden-file review) recorded in
`docs/reports/PMS-BE-001.2-completion.md` and
`docs/daily/2026-08/2026-08-26-worklog.md` — not duplicated here. Merge
evidence independently verified for this closeout via:

- `gh pr view 37`: `state=MERGED`, `headRefOid=4b2de0ab50fa1703f0b125a043d2461cc0309417`,
  `mergeCommit=0a818f7a8ebb8ee72f45605e5a0ce37fed2a5442`,
  `mergedAt=2026-08-26T10:33:13Z`.
- `gh run view 32957454881`: `conclusion=success`, Backend/Frontend/Admin
  all `success`, on the exact merged head.
- `git ls-remote --heads origin feature/pms-be-001-2-physical-room-schedule-availability`:
  empty — remote feature branch deleted.
- Final Codex/OC review outcome: `PASS`, Owner/OC-confirmed; not
  independently re-derivable from GitHub, since this repository's Codex
  review results are relayed through Owner/OC rather than posted as PR
  comments — no `gh pr view 37` comment trail exists to quote verbatim.

## 5. Product/architecture state liên quan

- Customer Web hiện có luồng client-side đầy đủ: `Active Booking Hold →
  Confirm Hold → Reservation result`, tiêu thụ contract backend đã có sẵn
  (`BE-003.4`, `PMS-BE-001.1`), không đổi backend request/response shape.
- Admin Web hiện có một **interactive Reservation Board frontend** trên nền
  TailAdmin template baseline (PR #30, `ADMIN-002.1`). Kể từ
  `PMS-CAL-001.1` (§2), phần đọc chính của Reservation Board
  (`ReservationBoard.tsx`/`ReservationBoardServerTimeline.tsx`/
  `ReservationBoardStayPopover.tsx`) đọc **dữ liệu thật, read-only**, qua
  HTTPS, từ `GET /api/admin/v1/properties/{propertyId}/reservation-board`
  (§3) — không còn dùng `mockData.ts`/`reservationRuntime.ts`. Các phần
  khác của prototype `ADMIN-002.1` (front-desk creation workspace,
  lifecycle/folio/move demonstrations tại `reservationRuntimeReducer` trong
  `reservationRuntime.ts`, `formReducer` trong `CreateReservationForm.tsx`)
  **vẫn** chỉ chạy trên local deterministic mock state — không có backend
  call, không có persistence, không có Admin authentication/RBAC thật và
  không có OTA behavior thật. Riêng Admin Reservation Board là caller thật
  của các route assignment (Staff-authorized mặc định từ `PMS-ADMIN-AUTH-001`;
  `LocalGate` chỉ là opt-in Development): create của CP02 (CP03A/CP03B, merged),
  move một segment (CP04C, PR #53/#55) và unassign một segment (CP04D, PR
  #63) của CP04B, và của route tạo một OperationalBlock segment
  (`PMS-CAL-001.3-CP01`) qua dialog trên toolbar từ CP03 — khoảng đêm nằm
  trong board đang hiển thị, rồi đọc lại board từ server. Route hủy block
  (CP02) được board gọi từ CP04. Assignment split/batch và OperationalBlock
  move/split vẫn chưa có route HTTP.
- `PROJECT_BIBLE.md`, `docs/design/PMS-DATA-001-core-database-blueprint-v2.md`,
  ADR (0001–0007), test baseline và source code là nguồn sự thật sản phẩm/
  kiến trúc. Chúng phân biệt rõ CURRENT frontend prototype (mock-only),
  CURRENT backend (`PMS-BE-001.1` normalized Item/Unit authority, một
  RoomType/RatePlan mỗi public request; `PMS-BE-001.2` physical-room
  schedule database authority/availability/internal mutation boundary — cả
  hai đã hoạt động; phần HTTP exposure của schedule authority (Staff mặc định) đã
  CURRENT theo `PMS-CAL-001.1`/`PMS-CAL-001.2`/`PMS-CAL-001.3` CP01–CP02) và
  TARGET (multi-RoomType public request, phần HTTP/Admin/Calendar mutation
  còn lại của schedule authority, OTA — chưa implement; Staff
  authentication/RBAC của Admin Calendar đã CURRENT qua `PMS-ADMIN-AUTH-001`).
- Local Graphify tooling state (đọc/graph hoá source hiện có trên máy
  Claude, không commit vào Git) không được gộp với tracked repository
  state hay product/backend implementation state — nó không tạo, sửa hay
  xoá bất kỳ table, migration, endpoint hay UI nào.
- Template hotel assets hiện có trạng thái quyền sử dụng chưa được chứng
  minh đầy đủ; chỉ dùng development/reference, không được tự động promote
  sang production.

## 6. Operating model đang được áp dụng

- Owner Hồ Đình Lâm: quyết định cuối, Ready/merge, branch cleanup và mở task
  tiếp theo. Control Tower: objective/execution order cấp cao và
  escalation. OC: phân rã work item/checkpoint, viết Master Execution
  Prompt, review report/diff/PR. Implementer được Master Execution Prompt
  chọn (Claude hoặc Codex): duy nhất có quyền ghi code/working tree.
  Reviewer ghép cặp: read-only (`docs/governance/RULES.md` §2.4).
- Mô hình lịch sử trước `AI-OPS-GOV-003` (không còn là policy hiện tại,
  xem §2.4 `docs/governance/RULES.md`): `Claude writes. Codex reviews. OC
  decides. Owner merges.` — đã chứng minh hoạt động xuyên suốt
  `AI-OPS-PILOT-001`, `FE-002.1`, `ADMIN-001.1`, `PMS-DATA-DOCS-001`,
  `ADMIN-002.1`, `TOOL-GRAPHIFY-001-DOCS-CLOSEOUT`, `PMS-BE-001.1`, và
  `PMS-BE-001.2` (bao gồm hai correction cycle `C1`/`C2` trước khi merge).
- **Single-checkout workflow (khôi phục từ `PMS-BE-001.1-DOCS-CLOSEOUT`):**
  dự án dùng đúng một checkout repository đang tồn tại
  (`/home/admin1/The_BHA_hotels_Booking`). Một work item dùng một feature
  branch, checkout trực tiếp trong đó; chỉ `ACTIVE_EXECUTOR` được Master
  Execution Prompt chọn có write lock.
  `git worktree add` và mọi checkout thực thi bổ sung đều bị **cấm** —
  không có ngoại lệ, không có field ủy quyền, không có policy matrix cho
  việc này (PR #35 từng dùng và sau đó đã xóa một linked worktree trong
  quá trình implementation của nó — xem §4 — đó là lịch sử đã kết thúc,
  không phải cơ chế còn hiệu lực). Chi tiết và vòng đời branch chuẩn:
  `docs/governance/RULES.md` §5 (canonical), `AGENTS.md` §8,
  `docs/governance/WORKFLOW.md` §8.
- Sau implementation/correction và mandatory checks, `ACTIVE_EXECUTOR`
  dừng ghi tại checkpoint ổn định và công bố `READY_FOR_<REVIEWER>_REVIEW`;
  chỉ Owner mới invoke reviewer đã chọn (`/codex:review --base
  origin/develop`, hoặc base do prompt chỉ định, khi reviewer là Codex;
  một phiên Claude read-only riêng khi reviewer là Claude). Không dùng
  rescue, transfer, Codex write mode, automatic review gate, parallel
  agent hoặc nested implementation orchestration — mô hình
  single-primary-checkout không thay đổi bất biến này.

## 7. Tooling migration state

- `openai/codex-plugin-cc`: review-only bridge, operating throughout all
  closed work items above.
- GitNexus: `UNAVAILABLE — RECORDED_NON_BLOCKING_TOOLING_GAP`. Graphify
  adoption does not imply GitNexus removal.
- Graphify: adopted as an optional, workspace-local code-navigation tool
  (§2). `docs/governance/WORKFLOW.md` §12 is the canonical policy —
  `GRAPHIFY_POLICY` values, freshness, and install/rebuild boundaries live
  there, not duplicated here. Queried once during `PMS-BE-001.1` Phase 0
  preflight (graph fresh at that time; every result cross-checked directly
  against source); not invoked by `PMS-BE-001.1-DOCS-CLOSEOUT`
  (docs-only, `NOT_APPLICABLE` per the WORKFLOW.md §12 mapping table).
- `diagnosing-bugs` (`mattpocock/skills`): conditional global skill. Not
  invoked by `PMS-BE-001.1` (no concrete reproducible defect — every test
  failure during that session was an immediately obvious authoring mistake,
  fixed directly). Not applicable to `PMS-BE-001.1-DOCS-CLOSEOUT`
  (docs-only, no defect in scope).
- Không bật rescue, transfer, Codex write mode hoặc automatic review gate.

## 8. Current objective

`PMS-CAL-001.1` — Reservation Board Read Projection & Frontend Integration
— đã đóng (`PASS — CLOSED`, PR #41 merged, merge commit
`e0f5a395aec15cc02e328433a97850e30e165675`, `2026-09-03T03:11:21Z`; §1,
§2, §4). Không còn review gate hay merge nào đang chờ trên work item đó.

`PMS-ADMIN-AUTH-001` đã đóng (`PASS — CLOSED`, CP07 = PR #80 merged, merge commit
`38d4a9d964fde411aa4c03b46323f250fd54221b`). Production deployment chưa thực hiện và cần
quyết định riêng của Owner.

Objective hiện tại là `CUST-WEB-SHOWCASE-001` (CP01 Draft PR): Customer Web thật ở `/`, route
template bị chặn. `PMS-CAL-002` (split-move, thiết kế merged PR #81) tạm dừng theo Owner;
D1–D6 vẫn OPEN. Review Codex chỉ do Owner gọi, OC quyết định,
Owner giữ Ready/merge/branch cleanup. Không tự bắt đầu work item khác từ Snapshot này.

## 9. Main risks

- Coi tài liệu này là đúng mà không đối chiếu Git/GitHub — đây chính là
  drift đã xảy ra với PR #41: bản Snapshot trước mô tả PR #41 là
  Draft/OPEN/chưa merge sau khi PR đã merge. Chạy `git fetch --prune origin`
  và đọc `origin/develop` HEAD từ Git trước khi dùng file này làm baseline.
- Trích một CI run hoặc review result sang một SHA khác với SHA nêu kèm nó
  — không hợp lệ. Mỗi con số trong tài liệu này gắn với đúng commit được ghi
  bên cạnh.
- Nhầm các route ghi local-only với một Admin Calendar đã có mutation/CRUD
  thật — không đúng. `PMS-CAL-001.2-CP02` expose route tạo assignment
  (`POST .../reservation-assignments`), `CP04B` expose route move/unassign
  một segment (`.../{segmentId}/move`, `.../{segmentId}/unassign`), và
  `PMS-CAL-001.3` expose route tạo một OperationalBlock segment
  (`POST .../operational-blocks`, tối đa 366 đêm tại HTTP boundary; CP01) và
  route hủy một segment (`.../{segmentId}/cancel`; CP02). Ở `Staff` mode
  (mặc định từ CP07) mỗi route cần Staff session và permission theo
  Property/role (CP05); ở `LocalGate` (chỉ Development) chúng chỉ chạy trên
  host loopback đã bật `AdminCalendar:EnableUnauthenticatedWrite` (mặc định
  tắt), không có authentication. Caller duy nhất của create/move/unassign assignment
  và tạo/hủy block là Admin Reservation Board. Assignment split/batch và
  OperationalBlock move/split vẫn chỉ tồn tại ở tầng application/persistence
  nội bộ (`PMS-BE-001.2`), không có route HTTP.
- Nhầm phần còn lại của frontend mock prototype (`ADMIN-002.1`: front-desk
  creation workspace, lifecycle/folio/move demonstrations) — vẫn hoàn toàn
  mock-only — với backend PMS behavior thật.
- Coi `AdminCalendar:EnableUnauthenticatedRead` hoặc
  `AdminCalendar:EnableUnauthenticatedWrite` là bằng chứng sẵn sàng
  public-Internet production — không đúng; "commercial-quality" ở đây nghĩa
  là robust/verified/merge-ready, không phải public production-ready. Cả hai
  đều là **same-machine development only**: mặc định tắt kể cả ở Development,
  và chỉ phục vụ request HTTPS loopback-to-loopback ở host Development (§3).
  Write flag còn từ chối thêm mọi request mang header `Forwarded`/
  `X-Forwarded-*`. Hai flag độc lập: bật read không bật write và ngược lại.
  Không được để lộ qua LAN/public listener hay external-facing proxy — việc
  không đặt proxy công khai trước API local là **điều kiện vận hành**, không
  phải thứ code phát hiện được. Từ CP07 hai flag chỉ có tác dụng với
  `AccessMode=LocalGate` (chỉ Development); `Staff` mặc định không đọc chúng.
- Nhầm database authority/internal mutation boundary của `RoomOccupancySegment`/
  `RoomBlock` (`PMS-BE-001.2`, đã CURRENT) với HTTP/Admin/Calendar
  integration đầy đủ — ngoài năm route ghi (assignment create của
  `PMS-CAL-001.2` CP02, one-segment move/unassign của CP04B, và
  single-segment operational-block create/cancel của `PMS-CAL-001.3`
  CP01/CP02), các mutation khác (split, swap/batch, block move/split) vẫn
  TARGET, chưa implement. Staff identity/RBAC và audit actor Staff đã CURRENT
  (`PMS-ADMIN-AUTH-001`); chỉ ở `LocalGate` `ActorReference`/`AuthorizationEvidence`
  mới là hằng số opaque.
- Coi thiết kế `PMS-CAL-002-CP00` (split-move) là CURRENT hoặc đã được Owner duyệt
  — không đúng: chưa có route/UI, D1–D6 còn OPEN.
- Nhầm foundation normalized Item/Unit (`PMS-BE-001.1`, single-RoomType
  public request) với multi-RoomType public request TARGET đã implement —
  vẫn chưa implement.
- Coi các đoạn cert/HTTPS-trust runtime-only dùng cho Phase 3 browser
  acceptance của `PMS-CAL-001.1` (`Kestrel:Certificates:Default:*` trỏ vào
  một chứng chỉ `mkcert` cục bộ, `mkcert -install` vào system trust store)
  là một phần cấu hình đã commit — không đúng: đó chỉ là tiện ích kiểm thử
  cục bộ, không nằm trong bất kỳ file được commit nào, và không thay đổi
  cách backend chạy ở Development/Production.
- Tạo `git worktree add` hoặc bất kỳ checkout thực thi bổ sung nào — luôn
  bị cấm, không có ngoại lệ (`docs/governance/RULES.md` §5).
- Codex được cấp nhầm write mode hoặc dùng rescue/transfer.
- Claude mutate working tree trong lúc Codex đang review.
- Review base bị suy ra thành `main` thay vì explicit `origin/develop`.

## 10. First action

Chạy `git fetch --prune origin` và đọc `origin/develop` HEAD trực tiếp từ
Git — **không** lấy SHA từ tài liệu này — trước khi dùng Snapshot này làm
planning baseline.

Work item đang thực thi là `CUST-WEB-SHOWCASE-001-CP01` (branch
`feature/cust-web-showcase-001-cp01-live-entry`). Owner invoke `/codex:review --base
origin/develop` trên đúng PR head, OC quyết định, Owner Ready/merge; CP02 (ảnh, dữ liệu demo)
chỉ mở sau đó. Evidence: `docs/reports/CUST-WEB-SHOWCASE-001-CP01-completion.md`. (Đoạn First action cũ trỏ tới
`PMS-CAL-001.2-CP04B` đã hết hiệu lực; CP04B merged trong PR #48.)
