# BHA-NEWSLETTER-002 — completion report (xác minh email Newsletter + kết nối Gmail)

- **IMPLEMENTATION:** xem `STATUS` ở tin bàn giao (cuối báo cáo này). **REVIEW:** NOT_RUN — Owner gọi Codex.
- **Roles:** `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`; `CODEX_REVIEW_COMMAND` do prompt cấp: `/codex:review --wait --base origin/develop`.
- **Branch / base:** `feature/bha-newsletter-002-email-verification` từ `origin/develop` `04b924c`; tree sạch lúc bắt đầu; không worktree; không có việc Resend dang dở để chuyển.
- **Graphify:** không dùng (đọc mã nguồn trực tiếp).

## Điểm tích hợp đã chọn

| Điểm | Chọn |
|---|---|
| Gửi thư | Gmail API `users.messages.send`, OAuth 2.0 authorization code + PKCE (S256) + `state` một lần, `access_type=offline`, `prompt=consent` (+ `select_account` khi "Đổi tài khoản"). Scopes: `openid email https://www.googleapis.com/auth/gmail.send`. |
| **Redirect URI** | **Một trang Admin**, không phải API: `<Admin origin>/website/newsletter/sender/callback`. Lý do: cookie Staff là `SameSite=Strict` (không được gửi khi Google chuyển hướng về) và log "Request starting" của ASP.NET ghi cả query string; trang Admin đọc `code`/`state`, xoá chúng khỏi thanh địa chỉ và `POST` lên API bằng phiên Staff, nên `code` không vào query của API và state được kiểm theo đúng Staff khởi tạo. |
| Lưu trữ | 3 bảng mới + 2 cột (migration 22 `AddNewsletterVerification`; migration 23 `AddNewsletterClaimFences` ở C1): `NewsletterSenderSettings` (1 dòng), `NewsletterOAuthStates`, `NewsletterVerificationRequests` (outbox); `NewsletterSubscriptions.VerifiedAtUtc`, `LastVerificationRequestedAtUtc`, check `Status` thêm `Verified`. |
| Bí mật | Client Secret và refresh token là payload ASP.NET Data Protection (purpose `TheBha.Newsletter.Sender.v1`); không có đường đọc ra: API chỉ trả metadata. Authorization code, state, token xác nhận: chỉ băm SHA-256 (token còn một bản mã hoá cho tới khi thư đã đi, để retry cùng link). |
| Gửi | `BackgroundService` (`NewsletterVerificationWorker`) + `INewsletterVerificationDispatcher.ProcessBatchAsync`; nhận việc bằng `UPDATE … WHERE Id = (SELECT … FOR UPDATE SKIP LOCKED)` + lease. |
| Link | `<CustomerOrigin>/newsletter/confirm#t=<token>` — token trong **URL fragment** (trình duyệt không gửi lên server/log/referrer). `GET` chỉ mở trang; nút **Xác nhận đăng ký** `POST …/newsletter-subscriptions/confirmations` với token trong body. |

## Quyết định của tôi (nói nếu muốn đổi)

1. **Quyền:** dùng lại `WebsiteSettingsManage` cho cả 4 route cấu hình người gửi (kiểm cả UI lẫn API); không thêm cờ mới, không đổi schema `StaffAccounts`. Người đọc danh sách subscriber vì vậy cũng cấu hình được người gửi.
2. **At-least-once:** kết quả không rõ (timeout, mất kết nối, 429/5xx, crash sau khi gọi) → thử lại với **cùng link/token** (thư gửi trùng vô hại vì xác nhận idempotent); hết `MaxAttempts` (6) mà vẫn không rõ → `Failed`/`uncertain`. Google từ chối hẳn (4xx) → `Failed`/`rejected`, không retry. 401/403 (trừ giới hạn tần suất) hoặc `invalid_grant` → sender `NeedsReconnect`, thư giữ `Pending`, **không tốn lượt thử**.
3. **Đổi tài khoản & thư đang chờ:** mỗi lần kết nối một địa chỉ Gmail **khác** tăng `SenderGeneration`; danh tính (From, tên, Reply-To, generation) được ghim ở lần thử đầu. Thư *đã từng thử* dưới danh tính cũ bị huỷ (`sender-changed`) và cooldown của địa chỉ đó được nhả để khách đăng ký lại ngay; thư *chưa từng thử* đi từ tài khoản mới. Kết nối lại cùng tài khoản không đổi generation. Đổi tên người gửi/Reply-To chỉ áp cho thư chưa từng thử.
4. **Cooldown** gửi lại 300 s theo địa chỉ đã chuẩn hoá, giữ bằng một `UPDATE` có điều kiện (đồng thời → một thư); **không** ghi dấu cooldown khi chưa có sender; thư cũ chưa gửi bị thay (`superseded`), link đã gửi vẫn dùng được. Link sống 48 h.
5. **Phản hồi công khai:** vẫn `202 {"status":"received"}` + trường mới `confirmation: "email" | "none"` — là sự thật của **site** (đã kết nối Gmail chưa), giống nhau cho địa chỉ mới và đã có. Body nhận thêm `language` (`vi|en|fr`, mặc định `vi`) để viết thư đúng ngôn ngữ.
6. **Down() của migration** từ chối khi còn dữ liệu xác minh/sender/outbox (như V1).
7. **Bản dịch:** khoá mới `customer.newsletter.receivedConfirm` và `customer.newsletter.confirm.*` (12 khoá, vi/en/fr, catalog + 3 pack); khoá cũ giữ nguyên. Không nâng phiên bản pack (site đã cài pack nhận text nhúng cho khoá mới, như C3).

## Cấu hình máy chủ cần chuẩn bị

| Khoá | Ý nghĩa | Mặc định |
|---|---|---|
| `Website:Newsletter:CustomerOrigin` | origin https của Customer để dựng link | `Cors:AllowedOrigins[0]` (https) |
| `Website:Newsletter:AdminOrigin` | origin https của Admin (đích OAuth redirect) | `Cors:AdminOrigins[0]` |
| `Website:Newsletter:ResendCooldownSeconds` / `TokenLifetimeHours` / `MaxAttempts` / `LeaseSeconds` / `WorkerPollSeconds` / `WorkerEnabled` | | 300 / 48 / 6 / 120 / 5 / true |
| `DataProtection:KeysPath` | **bắt buộc bền và dùng chung** (Production đã ép) — mất key ring thì sender hiện "Cần kết nối lại", không 500 | — |
| `Website:Newsletter:Google:*Endpoint` | địa chỉ Google, chỉ ghi đè được ở **Development** (stub local); Production có khoá này thì host **không khởi động** | Google thật |

## Hướng dẫn cho Owner (Google Cloud)

1. Bật **Gmail API** trong project. **OAuth consent screen → External**; thêm Gmail sẽ dùng để gửi vào **Test users**.
2. **Credentials → OAuth client ID → Web application**; **Authorized redirect URIs** = đúng chuỗi trang Admin hiển thị (có nút Sao chép):
   - local: `https://localhost:3001/website/newsletter/sender/callback`
   - triển khai: `<ADMIN_ORIGIN>/website/newsletter/sender/callback`. Origin Admin đã triển khai **không có trong repo**: `deploy/showcase/compose.yaml` chỉ ánh xạ `Cors__AdminOrigins__0: ${ADMIN_ORIGIN}` từ một `.env` không được commit, và các script/test trong `deploy/showcase/` chỉ dùng giá trị `.invalid`/`localhost`; `docs/runbooks/` và `appsettings*.json` cũng không nêu. Tôi đã tìm ở các chỗ đó (và trong ghi chú về đích AWS) nên không điền giá trị đoán. Owner đọc `ADMIN_ORIGIN` thật và nối đường dẫn trên; trang Admin cũng hiển thị đúng chuỗi cần dán.
3. Admin → **Website → Cấu hình email gửi**: dán Client ID, Client Secret (chỉ ghi, không hiện lại) → **Kết nối Gmail** → chọn tài khoản → **Cho phép** (giữ tick quyền gửi email).
4. **Thành công khi:** quay về trang "Kết nối Gmail" báo "Đã kết nối Gmail: <địa chỉ>", trang cấu hình hiện **Đã kết nối** + địa chỉ + số thư đang chờ; form trang chủ đổi thông báo thành "Hãy mở email chúng tôi vừa gửi…"; sau khi khách bấm xác nhận, danh sách hiện **Đã xác minh** + thời điểm.
5. **Giới hạn Google External / Testing:** refresh token của quyền gửi Gmail có thể hết hạn sau **7 ngày**; khi đó trang báo **Cần kết nối lại** (thư chờ giữ nguyên, tự gửi sau khi kết nối lại). Chuyển app sang **In production** (có thể cần xác minh của Google) để bền vững.
6. Owner tự thực hiện thiết lập Google Cloud và **gửi thử một thư thật tới hộp thư test** (phần này tôi không làm được).

## Kiểm chứng (đã chạy trong phiên này)

| Việc | Kết quả |
|---|---|
| Backend unit | 676 passed |
| Backend integration, toàn bộ, trên bản build trước khi sửa 7 mục ghim | 1431 passed, **7 failed** — đều là danh sách/số migration ghim hoặc registry route (`BlogMediaMigrationTests` ×3, `PropertyInventoryPersistenceTests`, `AdminCalendarAssignmentApiTests` OpenAPI, `BookingPersistenceTests` OpenAPI) và 1 test của tôi (phiên Staff hết hạn khi đẩy đồng hồ +1 ngày) |
| Sau khi sửa: chạy lại `*MigrationTests`, `BlogMedia*`, 2 test OpenAPI, `NewsletterVerificationTests`, `WebsiteNewsletter*`, `ContentPackTests`, `WebsiteSettingsAuthorizationTests`, `PropertyInventoryPersistenceTests` | **134 / 134 passed**. **Toàn bộ suite chưa được chạy lại nguyên khối sau các sửa đó.** |
| Test mới (`NewsletterVerificationTests`, 36 ca + helper `NewsletterGoogleStub`) | kết nối (PKCE, state một lần/hết hạn/của người khác, từ chối scope/refresh/email chưa xác minh/đổi mã/huỷ consent giữ nguyên kết nối cũ, secret không lộ ở API/DB/log), đăng ký (V1 khi chưa kết nối, một thư, cooldown, đồng thời 24 request = 1 thư), xác nhận (một lần, replay, 12 xác nhận đồng thời = 1 chuyển trạng thái, hết hạn, token sai), retry cùng link, từ chối vĩnh viễn, thu hồi quyền, giới hạn tần suất, đổi tài khoản/ghim danh tính, 3 worker song song = 1 thư + thu hồi lease, secret không đọc được → NeedsReconnect (không 500), key ring dùng lại sau "restart", worker thật tự gửi, dữ liệu V1 không bị gửi hồi tố, **không bí mật nào vào log**, ghi đè endpoint Google chỉ ở Development, ma trận quyền 4 route ghi |
| Customer_Web | `vitest` 1658 passed; `tsc`, `next lint`, `next build` pass (route `/newsletter/confirm` có trong build) |
| Admin_Web | `vitest` 2494 passed; `tsc`, `eslint .`, `next build` pass (3 route mới) |
| **Chrome, HTTPS, API + PostgreSQL thật, Google = stub local** | DB demo đang có 2 dòng V1 → `database update` lên migration 22: 2 dòng nguyên vẹn, 0 yêu cầu gửi. Admin `/signin?returnTo=…/sender` → đăng nhập → quay đúng trang; nhập Client ID/Secret → **Kết nối Gmail** → stub nhận `authorize` (PKCE S256, offline, consent) → trang callback báo "Đã kết nối Gmail: owner.gmail@example.test", thanh địa chỉ sạch `code`/`state`; trang chủ gửi `khach.that@example.com` → "Hãy mở email chúng tôi vừa gửi…"; **worker thật** gửi (stub nhận exchange → userinfo → refresh → send), thư có From/To/Subject đúng và link `…/confirm#t=…`; mở link → DB vẫn `PendingVerification`; bấm nút → "Cảm ơn bạn! Email của bạn đã được xác nhận."; Admin hiện **Đã xác minh** + thời điểm, hai dòng V1 vẫn "Chưa xác minh email" |

## Phần dùng stub, phần chưa kiểm chứng thực tế

- **Stub:** toàn bộ Google (authorize/token/userinfo/send/revoke) — trong integration test là handler thay mạng của chính `HttpClient` gateway (nên dựng request và đọc phản hồi chạy thật); trong lần chạy Chrome là một server HTTPS Node cục bộ (không nằm trong repo). **Chưa có thư thật nào được gửi qua Gmail và chưa có OAuth thật nào với Google** — cần Owner.
- **Không chạy:** Codex review; CI trên SHA cuối (xem tin bàn giao); thử "Ngắt kết nối" và "Đổi tài khoản" trên Chrome (chỉ có test tích hợp và test UI); email render trong client thư thật (chỉ giải mã MIME bằng script).
- **Dòng `code` trong log Admin dev:** log request của `next dev` (Admin) có ghi `…/callback?code=…&state=…`. Không có ở API. Code dùng một lần và gắn PKCE (verifier chỉ nằm mã hoá trong DB) nên vô dụng nếu bị lộ; nhưng một reverse proxy hoặc access log phía trước Admin có thể ghi query của trang callback — cân nhắc loại query của đường dẫn này khỏi access log khi triển khai.
- **Cần làm sau merge (Owner):** DB mặc định `thebha_dev` đang ở migration 21; tôi **cố ý không** áp migration chưa được review lên đó. Chạy `dotnet ef database update …` (lệnh trong AGENTS §9) sau khi merge, trước khi mở form hoặc trang Admin mới, nếu không form newsletter và trang danh sách sẽ lỗi trên DB đó.
- **Dấu vết trên máy:** DB demo `thebha_newsletter_demo` đã ở migration 22 và đang giữ một kết nối sender tới **stub** (secret/refresh token giả, key ring ở thư mục scratchpad của phiên); không có gì trong repo trỏ tới chúng. Các DB `thebha_nl_integration_*` do test tạo/dập nằm trong container `the-bha-postgres-1`; một lần chạy bị `timeout` giết giữa chừng có thể để lại DB mồ côi, chưa xoá khi chưa có ý của Owner.
- **Giới hạn đã biết:** Gmail có thể ghi đè `Message-ID`, nên không dùng được để dò thư đã gửi; vì không xin thêm scope đọc, chính sách là gửi trùng (cùng link) thay vì mất thư.

## Sai lệch cần OC chấp nhận / điểm cần biết

1. **`Back_End/src/TheBha.Infrastructure/TheBha.Infrastructure.csproj` thêm `<FrameworkReference Include="Microsoft.AspNetCore.App" />`** — phụ thuộc mới của lớp Infrastructure (AGENTS §7). Cần cho `IDataProtectionProvider`, `IHttpClientFactory` và `BackgroundService`; không thêm gói NuGet, không đổi chiều phụ thuộc Domain → Application → Infrastructure → Api. Phương án thay thế (đưa gateway/worker/protector sang `TheBha.Api`) sẽ đặt mã adapter ngoài Infrastructure.
2. **`BookingPersistenceTests.OpenApi_exposes_only_the_approved_hold_and_reservation_lifecycle_paths`** — bộ lọc "chứa `confirm`" của test bắt trúng route công khai mới `…/newsletter-subscriptions/confirmations`. Tôi loại tiền tố `/api/v1/website/` khỏi bộ lọc của test đặt phòng này (không nới danh sách cho phép đặt phòng). Đây là thay đổi phạm vi test, không phải nới registry; route mới được khẳng định đầy đủ ở `NewsletterVerificationTests`. Cũng cập nhật registry route Admin (`WebsiteMutationPaths`) với 4 route sender, các số/danh sách migration (22) và danh sách `TRUNCATE` của factory.
3. **`Down()` của migration 22** từ chối khi còn sender/outbox/dòng `Verified` — đã kiểm tra nửa "từ chối" trên DB demo đang có dòng sender (xem dưới). Nửa "cho phép khi rỗng" **NOT RUN**.
4. **Sửa sau khi tự xem xét:** dispatcher từng gộp việc đọc token của *request* vào cùng chuỗi giải mã với secret của *sender*, nên một request bị giữ bởi worker đã chết rồi được khách xác nhận (token đã xoá) sẽ làm cả site chuyển "Cần kết nối lại". Đã tách: token đã dùng hoặc không đọc được ⇒ request tự kết thúc (`Cancelled`/`verified` hoặc `token-unavailable`), không bao giờ là lỗi sender; request đã dùng còn sót lại vẫn được nhận để dọn (không để kẹt ở `Sending`); xác nhận cũng huỷ request đang `Sending`. Có 2 test mới.
5. **Catalog:** `catalog.json` ở `develop` đã không còn khớp `catalog.mjs --check` trên máy này (xem C3). Tôi chỉ xếp lại khối `customer.newsletter.*` theo đúng thứ tự `localeCompare("en")` của bộ sinh (không tái sinh cả file, để không xê dịch khoá không liên quan); `--check` vẫn báo lệch do phần có sẵn.

## Thứ tự triển khai

API (migration 22, pack/catalog mới) **trước hoặc cùng** Customer_Web/Admin_Web mới: Customer mới đọc khoá dịch mà API cũ chưa có, và gọi route xác nhận chưa tồn tại. API mới + front cũ an toàn (form cũ bỏ qua trường `confirmation`).

## PR size

Vượt xa mức 100–400 dòng: một migration có `Designer.cs` (~4 000 dòng) + snapshot, 36 test tích hợp mới và stub, test UI và dịch 3 ngôn ngữ; phần mã sản phẩm viết tay là một phần nhỏ.

## Không thuộc PR này

Toast, cập nhật trực tiếp danh sách, badge/chuông thông báo (các PR sau, theo prompt); huỷ đăng ký (link unsubscribe), chiến dịch, xuất CSV.

## C1 — sửa bốn lỗi đồng thời (`BHA-NEWSLETTER-002-C1`, Codex review đợt 1)

Bốn finding P2 đều là thật; mỗi lỗi có test tái hiện chạy **trước** khi sửa (fail đúng lý do) và **sau** khi sửa (pass). Test dùng PostgreSQL thật, Google stub có cổng chờ (`NewsletterGoogleStub.Hold`), đồng hồ điều khiển được và `NewsletterSqlGate` (chặn một câu SQL của ứng dụng thật tại điểm chọn trước, chỉ khi test bật).

| # | Lỗi | Sửa | Test (trước → sau) |
|---|---|---|---|
| 1 | Câu trả lời muộn `401`/`invalid_grant` của kết nối **cũ** đẩy kết nối **mới** sang `NeedsReconnect` | Cột mới `NewsletterSenderSettings.ConnectionEpoch`, tăng ở **mọi** connect/disconnect (cùng địa chỉ Gmail cũng tăng). Worker ghi nhớ epoch lúc đọc credentials; `NeedsReconnect` chỉ ghi khi worker còn claim **và** `ConnectionEpoch` còn khớp. Access token cache theo epoch thay vì `SenderGeneration`. | `A_late_failure_of_the_old_connection_never_breaks_the_new_one` ×4 (send-401 / refresh-invalid-grant × cùng / khác địa chỉ): trước `Connected` ≠ `NeedsReconnect` ×4 → sau pass, mail vẫn gửi được từ kết nối mới. Lỗi của chính kết nối đang dùng vẫn ra `NeedsReconnect` (test sẵn có `A_revoked_permission_…` ×3). |
| 2 | Hai lần lưu profile cùng version đều thành công | `UPDATE … WHERE "Version" = @expected` ngay trong DB (`ExecuteUpdate`); 0 dòng ⇒ `newsletter-sender-version-conflict`. Lần lưu đầu (chưa có dòng) vẫn qua INSERT + bắt `DbUpdateException`. | `Two_profile_saves_of_one_version_cannot_both_win`: trước `[OK, OK]` → sau `[OK, Conflict]`, bản ghi cuối là của request thắng, version +1 đúng một lần. `Two_first_profile_saves_…`: đúng từ trước, giữ làm hồi quy. |
| 3 | Worker hết lease vẫn ghi được sau khi worker khác nhận lại | Cột mới `NewsletterVerificationRequests.ClaimId`, cấp bởi chính câu `UPDATE … RETURNING` nhận việc. **Mọi** đường ghi của worker (ghim danh tính, hoàn tất, retry, trả lại khi cần kết nối lại) đòi `Status='Sending' AND ClaimId=@claim`; tác động kèm theo (nhả cooldown, cập nhật sender) chỉ chạy khi câu ghi chính trả về đúng 1 dòng. | `A_worker_whose_lease_ran_out_…` ×4 (trả lời muộn 200/500/400/401): trước `Sending` ≠ `Sent`/`Pending`/`Failed` → sau claim, lease, token, `Attempts` của B giữ nguyên tới khi B tự hoàn tất. `A_worker_that_lost_its_claim_before_pinning_…`: trước `FromName` bị ghi đè "Name One" → sau A không ghim, không gửi. |
| 4 | Confirm khoá request→subscription, resend khoá subscription→request ⇒ deadlock (`40P01`) | Một thứ tự duy nhất: **subscription trước, request sau**. `ConfirmAsync` tìm subscription theo hash, `SELECT … FOR UPDATE` rồi mới tiêu token. Đường thu hồi khi đổi sender cũng đảo lại (chọn id → khoá subscription theo thứ tự `Id` → thu hồi request → nhả cooldown). Đường nhả cooldown của worker là hai câu autocommit riêng, không giữ khoá xuyên câu nên không thể vào vòng khoá. | `A_confirmation_and_a_resend_after_the_cooldown_never_deadlock_…` và `A_change_of_sender_and_a_resend_after_the_cooldown_never_deadlock`: trước 500 + log "deadlock detected" cả hai → sau 200/202, subscription `Verified` đúng một lần, không còn thư `Pending`/`Sending` cho địa chỉ đã xác minh; thư gửi lại không bị mất khi đổi sender. |

**Migration 23 `AddNewsletterClaimFences`**: chỉ thêm 2 cột (`ClaimId uuid NULL`, `ConnectionEpoch int NOT NULL DEFAULT 0`). Áp lên DB demo đang ở migration 22 (3 subscription, 1 request, 1 sender `Connected`): số dòng và dữ liệu không đổi, `ConnectionEpoch=0`, `ClaimId` rỗng. `Down` → `Up` chạy trên bản sao DB demo: hai cột mất rồi có lại, 3 subscription còn nguyên. Request đang `Sending` từ trước migration (không có `ClaimId`) chỉ được hoàn tất sau khi hết lease và được nhận lại — đúng ý đồ.

**Giới hạn đã biết:** `Version` vẫn được tăng bằng thực thể theo dõi ở `CompleteConnect`/`Disconnect` (không có bảo vệ so sánh version): một lần kết nối chạy song song đúng lúc có lần lưu profile có thể trùng số version; không mất dữ liệu (EF chỉ ghi các cột đã đổi), chỉ làm màn hình đang giữ số cũ không bị báo xung đột. Không thuộc finding nào, để Owner quyết định có cần làm chặt.

**Hai điểm còn mở của bàn giao trước (để Owner quyết định phát hành, chưa sửa):**
1. `WebsiteSettingsManage` là quyền duy nhất cho cả danh sách subscriber (`AdminWebsiteNewsletterController`) và 4 route cấu hình sender + GET (`AdminWebsiteNewsletterSenderController`, 5 dòng `[StaffWebsitePermission(WebsiteSettingsManage)]`) → ai đọc được danh sách email khách đều đổi/ngắt được Gmail gửi thư, và ngược lại. Môi trường ảnh hưởng: mọi môi trường có Staff được cấp quyền này; chưa kiểm tài khoản nào đang có quyền này ở môi trường thật. Muốn tách phải thêm quyền riêng (đổi schema `StaffAccounts`/RBAC), nên không làm trong C1.
2. Log request của `next dev` (Admin) ghi `GET /website/newsletter/sender/callback?code=…&state=…`. Bằng chứng: quan sát ở lần chạy Chrome HTTPS trước (log Admin dev); API không ghi query này. Môi trường ảnh hưởng: máy dev chạy `next dev`. **Chưa kiểm** production Admin (`next start`/Vercel/reverse proxy phía trước): access log ở đó có thể ghi query. Giảm nhẹ sẵn có: `code` dùng một lần, gắn PKCE (verifier chỉ nằm mã hoá trong DB), `state` dùng một lần, gắn đúng Staff, hết hạn 10 phút.

**Kiểm chứng C1:** backend unit 676 pass; integration toàn bộ: 1449 pass + 5 fail ở lượt đầu — 1 pin migration bị sót (đã sửa) và 4 test BlogMedia fail vì tên DB tích hợp quá 63 ký tự do tên DB gốc của tôi (`thebha_newsletter_demo`, môi trường chứ không phải code); chạy lại với tên DB gốc ngắn: `StaffIdentityMigrationTests` + `BlogMedia*` 50/50 pass; 13 test C1 chạy lặp 3 lần đều 13/13. CI trên SHA bàn giao: xem PR #133.
