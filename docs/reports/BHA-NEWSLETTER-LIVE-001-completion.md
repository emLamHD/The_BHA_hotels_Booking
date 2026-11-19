# BHA-NEWSLETTER-LIVE-001 — completion report

- Work item `BHA-NEWSLETTER-LIVE-001` — màn Newsletter Admin cập nhật trực tiếp khi một subscription được xác minh. Implementer `CLAUDE`, reviewer `CODEX_READ_ONLY` (Owner gọi).
- Branch `feature/bha-newsletter-live-001-admin-updates`, base `origin/develop`, **baseline = START_HEAD = `b28c95fd8b6da8f9dedcdb1603a2b2c3a12ad0b2`** (PR #134 đã merge; CI trên `develop` tại baseline: success, run `44455287551`). Một Draft PR mới vào `develop`.
- Commits: `d3d2d6e` (CP1 backend), `4601419` (CP2 Admin), `d20a690` (CP3: sửa lỗi tìm thấy khi nghiệm thu trình duyệt), `1bcaf65` (CP3: sửa lời banner hoãn), rồi các commit chỉ-tài-liệu (báo cáo này, worklog, SNAPSHOT). **Tested code SHA: `1bcaf65`** — mọi commit sau đó chỉ đổi `docs/`. Backend không đổi từ `d3d2d6e`. Lần nghiệm thu trình duyệt chạy trên `d20a690`; `1bcaf65` chỉ đổi một chuỗi hiển thị của banner (kiểm tra bằng vitest/tsc/eslint/build, không chạy lại trình duyệt; các kiểm tra của trình duyệt chỉ dựa vào đoạn “xong thao tác”, vẫn còn trong chuỗi mới).
- Phạm vi giữ đúng prompt: Newsletter backend/Application, tích hợp API/auth cần thiết, Admin Newsletter + API client, dependency SignalR, test, tài liệu. **Không schema, không migration, không đổi RBAC, không đổi Customer_Web, không Redis/Kafka/Azure SignalR.** Không có badge, notification center, email tổng hợp hay thay đổi Gmail.

## Nghiệp vụ → hành vi

Mốc thông báo là subscription **thực sự chuyển `PendingVerification → Verified`**: chỉ `ConfirmAsync` làm việc đó, và chỉ lần gọi mà câu `UPDATE … WHERE Status = 'PendingVerification'` trả `1` hàng (cùng điều kiện đã quyết định Welcome) và sau khi `COMMIT` thành công mới phát. Nhập email, thêm từ Admin, gửi lời mời, replay token, `already-verified`, token sai/hết hạn, rollback hay commit lỗi: không phát. Khách hủy rồi đăng ký lại và xác minh bằng link mới: một lần xác minh mới, một tín hiệu mới (id mới).

| Trạng thái Staff | Hành vi (đã kiểm chứng) |
|---|---|
| Trang 1, yên | Toast “Có đăng ký mới” (hoặc “Có N đăng ký mới”), đọc lại **đúng truy vấn đang xem** (từ khóa đã áp dụng, status, scope, trang 1, `sort=recent-activity`); dòng vừa xác minh lên đầu nếu khớp. |
| Trang 2+ | Toast kèm “Xem đăng ký mới” + banner bền; **không đọc, không đổi dòng nào**. Nút đưa về trang 1, giữ từ khóa/bộ lọc/scope. Staff tự về trang 1 thì banner tự hết. |
| Tìm kiếm/lọc | Từ khóa đang gõ (chưa gửi), status, scope giữ nguyên; server quyết định dòng nào khớp (dòng không khớp không được chèn, không xóa bộ lọc). |
| Dialog / ghi / recovery / hold / stale | Banner “sẽ cập nhật khi bạn xong thao tác”; không đọc, không đóng dialog, không đổi nháp; áp dụng đúng lúc màn hình yên lại. |

Không thông báo hồi tố khi mở trang; sau reconnect đọc lại **không phát toast** cho dữ liệu cũ.

## Hợp đồng

**Tín hiệu (Application).** `INewsletterLiveSignal.PublishVerifiedAsync(NewsletterVerifiedSignal(Guid EventId, DateTimeOffset OccurredAtUtc))`. Payload chỉ hai trường; không email, token, thông tin Gmail hay dữ liệu subscriber (test khẳng định đúng hai khóa và không chứa email/token). `EventId` mới cho mỗi lần chuyển trạng thái, để client chống xử lý trùng.

**Hub (API).** `/api/admin/v1/website/newsletter-live`, **chỉ ở chế độ Staff** (LocalGate không có endpoint → 404), **chỉ WebSockets** (không mở bề mặt long-polling GET/DELETE), không có method nào client gọi được, `MaximumReceiveMessageSize` 1 KB. Server → client: `newsletterVerified(payload)` và `newsletterLiveReady()`. `newsletterLiveReady` được gửi **sau khi kết nối đã được đăng ký** (SignalR hoàn tất handshake *trước* `OnConnectedAsync`, nên client đọc lại danh sách ngay khi “connected” có thể trượt một xác minh commit đúng khoảng đó — phát hiện khi viết test, đóng bằng message này; client chỉ đọc lại sau `ready`).

**Danh sách.** `GET …/newsletter-subscriptions?sort=recent-activity` → `VerifiedAtUtc ?? ReceivedAtUtc` giảm dần rồi `Id` giảm dần; server vẫn lọc/sắp/phân trang. Không truyền `sort` (hoặc rỗng) = thứ tự cũ; giá trị khác → `400 newsletter-list-invalid`. `ReceivedAtUtc` không bị sửa. Màn Newsletter luôn gửi `recent-activity` và nói ngắn gọn điều đó trên dòng trạng thái.

**Kiểm soát quyền.**
- Policy `staff-newsletter-live`: scheme Staff riêng (cookie Customer không thỏa), user đã xác thực, và `HasGlobalPermissionAsync(WebsiteSettingsManage)` đọc DB lúc kết nối (disabled/thu hồi → 401/403 ở negotiate và handshake).
- `StaffCalendarModeGuard` chỉ mở endpoint khi có **cả** marker `StaffLiveHubEndpointMetadata` **và** `IAuthorizeData` nêu đúng policy (`IsEnforcedHub`); không mở prefix Admin nào; có test cho từng route của Hub và cho trường hợp chỉ-có-marker (không mở).
- CORS riêng `admin-staff-newsletter-live`: các origin Admin HTTPS đã cấu hình, chỉ `POST` (negotiate), header `Content-Type`, `X-Requested-With`, `X-SignalR-User-Agent`, credentials. Không nới policy Admin nào khác (test preflight: origin lạ, `DELETE`/`PUT`, header lạ đều không được liệt kê).
- Guard `Origin` chạy trước CORS/auth, trên negotiate **và** handshake WebSocket (CORS không áp cho WebSocket): đúng một giá trị, so khớp nguyên văn với `Cors:AdminOrigins`; thiếu/sai/hai giá trị/viết hoa khác → 403, `Cache-Control: no-store`. Cleartext → 404 (guard Admin sẵn có).
- **Kết nối đang mở được xét lại.** SignalR chỉ ủy quyền lúc kết nối nên mỗi lần phát (và mỗi 30 giây, `NewsletterLiveSweeper`) `NewsletterLiveBroadcaster` đọc DB trong scope riêng và, theo từng kết nối, kiểm tra: tài khoản còn, đang active, còn `CanManageWebsite`, `SecurityStamp` bằng stamp lúc kết nối, và chưa quá `ExpiresUtc` của ticket cookie lúc kết nối (đồng hồ ứng dụng). Kết nối không còn đủ điều kiện bị `Abort()` và không nhận tín hiệu; lỗi đọc DB **không** bị coi là thu hồi (ném, không đụng kết nối).
- Publisher chạy **trong request xác minh**, scope DB riêng, tối đa 3 giây, mọi ngoại lệ (kể cả hủy) bị nuốt và log không kèm email/token: không fire-and-forget, không giữ `DbContext` hết vòng đời, không biến một xác minh đã commit thành 500 hay làm mất Welcome.
- Phụ thuộc: Infrastructure chỉ biết interface Application; Hub/broadcaster ở API; chiều phụ thuộc Clean Architecture giữ nguyên.

## Client (Admin)

- `lib/website/newsletterLive.ts`: một kết nối cho màn hình; handler đăng ký **trước** `start()`; retry có backoff `1s,2s,5s,10s,30s` cho cả lần start đầu và sau mỗi mất kết nối; `retryNow()`; `dispose()` ở mọi pha (đang chờ factory, giữa lúc `start`, đã nối, giữa hai lần thử) dọn timer, handler và kết nối, nuốt `start()` bị `stop()` cắt (Strict Mode). 401 → `onUnauthenticated`, 403 → `onDenied` rồi **dừng retry**; mất mạng/5xx **không bao giờ** là đăng xuất. Chỉ WebSockets, `withCredentials`.
- **Phát hiện khi nghiệm thu:** `@microsoft/signalr` bọc lỗi negotiate trong `FailedToNegotiateWithServerError` — không có `statusCode`, trạng thái chỉ nằm trong chuỗi (`… Status code '403'`). Đọc `statusCode` một mình khiến quyền bị thu hồi retry mãi. `statusOf` đọc cả hai; test dùng đúng hình dạng lỗi thật (`d20a690`).
- `useNewsletterLive`: một kết nối cho mỗi (màn hình, Staff identity), dọn khi unmount/đăng xuất/đổi tài khoản; chống trùng theo `eventId` (nhớ 200 id); **gộp** tín hiệu đến dồn trong 300 ms thành một `onNew(count)` → một toast, một lần đọc.
- `NewsletterSubscriptionsPanel` — phối hợp với guard C2–C4:
  - `dialogRef`/`pageRef` đồng bộ (cập nhật cùng lúc với state, trước render kế tiếp); “yên” = `dialog == null && !writingRef && !readingRef && !heldRef && staleRef.size == 0`, đọc từ **ref**, nên callback giữ từ render cũ và một timer vẫn thấy sự thật của thời điểm đó.
  - Áp dụng cập nhật **không bao giờ** gọi `write.release()`, không xóa tập stale, không thay thế recovery tường minh, không đóng dialog, không đổi nháp, không gửi mutation; không bắt đầu đọc khi `readingRef` (recovery đang chạy) hoặc khi một live-read đang bay (một lần một request; cái đến dồn được đọc đúng một lần sau đó).
  - Dấu hiệu “đang chờ” (`liveDirtyRef`) giữ qua trạng thái bận; effect theo `[dialog, locked, staleRowIds]` áp dụng ngay khi yên lại, theo quy tắc trang hiện hành. Response cũ không ghi đè query mới (cơ chế generation của `useWebsiteList`, có test).
  - `expectedVersion` và cách khôi phục sau conflict của mọi mutation: không đổi.
- Toast: `role="status"`, `aria-live="polite"`, không lấy focus, có nút Đóng, tự ẩn sau 8 giây; banner bền còn đó sau khi toast biến mất. Dòng trạng thái kết nối ngắn (đang kết nối / đã bật / mất kết nối + “Thử kết nối lại” / bị từ chối).

## Bằng chứng

**Tín hiệu và Hub (PostgreSQL thật, pipeline HTTP thật, `NewsletterLiveTests`, 14 ca):** chuyển trạng thái duy nhất mới phát (nhập/Staff thêm/mời/replay/token sai: 0); re-opt-in hợp lệ phát tín hiệu thứ hai với id khác; **commit bị từ chối → 0 tín hiệu, hàng vẫn Pending, bấm lại được**; publisher ném lỗi → 200, `Verified`, đúng 1 Welcome, replay vẫn `already-verified`; ma trận kết nối (Staff có quyền ✓; ẩn danh, cookie Customer, cookie rác → 401; Desk/Manager không có cờ → 403; origin sai/thiếu/khác cổng/viết hoa/hai giá trị → 403; cleartext → 404; LocalGate → 404 cả connect và negotiate); negotiate chỉ `WebSockets` + `no-store`; preflight; payload đúng hai khóa; client gửi gì cũng không sinh tín hiệu; **thu hồi quyền → connection bị đóng thật (`WebSocketState`), không nhận tín hiệu, kết nối lại 403, cấp lại thì nối lại được; tài khoản bị disable; đổi security stamp (reset mật khẩu); hết phiên theo ticket của chính cookie đăng nhập** (đồng hồ kiểm thử tiến quá `Lifetime`: connection đóng, kết nối lại 401); sweep định kỳ đóng kết nối mà không cần tín hiệu; sort (dòng cũ vừa xác minh lên đầu, lọc/phân trang/ranh giới trang, `ReceivedAtUtc` nguyên vẹn, tie-break theo `Id` đúng thứ tự `uuid` của PostgreSQL với Id khác byte đầu, mặc định không đổi, 4 giá trị sai → 400).

**Admin (vitest, deferred promise và transport giả):** `newsletterLive.test.ts` 17 ca (thứ tự `on…on,onclose,start`; start đầu thất bại + backoff + backoff lặp/reset; 401/403 dừng + `retryNow`; lỗi negotiate đúng hình dạng thư viện; 5xx/mạng chỉ retry; reconnect + `ready`; dispose ở 4 pha; Strict Mode). `NewsletterSubscriptionLive.test.tsx` 23 ca: trang 1/2+, tìm kiếm/status/scope, tín hiệu trùng/dồn/trong lúc tải đầu/đến dồn khi live-read còn bay, `ready` ở trang 1 và 2, dialog + nháp, callback giữ từ render cũ, **cùng một tick** với click mở dialog/bắt đầu ghi, ghi đang bay, **hold** (không đọc, banner vẫn, Add vẫn khóa, chỉ recovery của Staff mới gỡ, rồi mới áp dụng), **stale**, **recovery đang bay**, response cũ sau khi đổi query, 401/403 từ kết nối, mất kết nối không phải đăng xuất, vòng đời + Strict Mode, toast (không focus, đóng, tự ẩn). Kiểm tra đột biến: vô hiệu hóa guard “yên” → 7 ca đỏ; khôi phục → xanh.

**Trình duyệt, HTTPS (Chrome hệ thống), API + PostgreSQL thật, SignalR thật, Google = stub cục bộ:** 43/43 kiểm tra đạt trên DB sạch (script và stub không nằm trong repo; ảnh ở `/tmp/claude-1000/-home-admin1-The-BHA-hotels-Booking/3746aae4-ec3f-4309-9465-c9e7888d1a80/scratchpad/accept/shots/`). Hai Staff cùng mở Newsletter; khách xác minh trong luồng riêng (gọi chính API công khai mà trang `/newsletter/confirm` gọi, không cookie Staff; **không dùng trang Customer_Web**). Cả hai trang nhận toast và dòng mới ở đầu mà **không tải lại trình duyệt** (`window` marker còn nguyên, 0 lần `load`, đúng 1 lần đọc danh sách); một địa chỉ đăng ký từ 30 giờ trước (`seed-30`), mời rồi xác minh vừa xong, **lên đầu** và `ReceivedAtUtc` vẫn là giờ cũ; trang 2: cùng dòng cùng thứ tự, 0 lần đọc, nút “Xem đăng ký mới” và banner còn sau khi đóng toast, nút về trang 1 giữ bộ lọc; tìm kiếm `zeta` + `Verified`: dòng khớp xuất hiện, dòng khác không chèn, ô tìm kiếm/status/scope nguyên vẹn; dialog mở với nháp: 0 lần đọc, nháp còn, đóng dialog thì áp dụng; hold (câu trả lời mời bị mất sau khi server đã commit): 0 lần đọc, hold và Add khóa còn nguyên, sau recovery của chính Staff thì hold gỡ và dòng mới lên đầu, **Staff gửi đúng 1 ghi** (lời mời của chính họ); mất mạng → “đang thử lại”, vẫn xem được danh sách, không bị đăng xuất, bỏ lỡ một xác minh, có mạng lại → socket mới, danh sách đọc lại thấy dòng bỏ lỡ, **không toast phát lại**; mất kết nối ở trang 2 → giữ nguyên dòng, banner “có thể có đăng ký mới”, không toast; **lần kết nối đầu thất bại** (negotiate bị hủy 2 lần): danh sách vẫn dùng, “đang thử lại”, nối được sau backoff (3 negotiate); **đăng xuất** trong tab: màn hình mất và WebSocket đóng; **thu hồi quyền khi đang kết nối**: không toast, server đóng kết nối, negotiate 403 → màn hình chuyển sang “không có quyền”, ngừng retry; Staff còn quyền vẫn nhận tiếp.

**Thời gian phản hồi (đo thật, từ lúc câu trả lời xác nhận của khách về tới lúc toast xuất hiện trong trang):** ba lần chạy, mỗi lần hai trang Staff (A/B): **338/329 ms, 335/335 ms, 339/337 ms** (mục tiêu ≈ 5 giây). Gần như toàn bộ là cửa sổ gộp 300 ms.

## Kiểm tra cục bộ (trên mã `1bcaf65`; trình duyệt trên `d20a690`)

| Kiểm tra | Kết quả |
|---|---|
| Backend `dotnet build` Release | thành công |
| Backend unit | 676 passed |
| Backend integration (PostgreSQL 17 thật, cụm riêng ở scratchpad, UTC) | **1542 passed, 0 failed** (21 phút 38 giây; gồm 14 ca `NewsletterLiveTests` mới). Lần chạy đầu có 2 lỗi do harness, xem mục rủi ro |
| Admin_Web `tsc --noEmit`, `eslint .` | sạch |
| Admin_Web vitest (toàn bộ) | 91 file, 2618 passed (+40 ca mới; 9 kỳ vọng truy vấn của test Newsletter cũ nay có `sort`) |
| Admin_Web `next build` | thành công |
| Customer_Web | **không chạy**: không đổi mã hay hợp đồng nào nó dùng |
| Chrome HTTPS + API + PostgreSQL + SignalR thật | 43/43 |

Hợp đồng test cũ đổi có chủ đích: 9 kỳ vọng “list được gọi với đúng tham số” của 4 file test Newsletter cũ thêm `sort: "recent-activity"`. `vitest.setup.ts` thêm stub `@microsoft/signalr` để không test nào mở kết nối thật.

## Giới hạn và rủi ro

- **Một API instance.** Kết nối nằm trong bộ nhớ; không backplane (không Redis/Azure SignalR). Sau khi triển khai nhiều instance, tín hiệu chỉ tới Staff đang nối **cùng instance** với request xác minh.
- **Không replay, không bảo đảm giao.** Cơ chế phục hồi là **đọc lại API**: client đọc lại sau mỗi `ready` (lần đầu và sau reconnect). Một tín hiệu bị rơi giữa hai lần kết nối được bù bằng lần đọc đó, không bằng replay. SignalR không bảo đảm mọi sự kiện.
- **Chế độ proxy cùng-origin (`BHA-ADMIN-PROXY-001`)**: rewrite của Next không chuyển được WebSocket upgrade; kết nối sẽ không khởi động được, màn hình nói “mất kết nối/đang thử lại”, danh sách vẫn dùng thủ công. Chưa có chế độ nào khác dùng proxy cho hub; **chưa kiểm chứng trong build proxy**.
- **Đăng xuất không xoay `SecurityStamp`** (thiết kế sẵn có: cookie là ticket phi trạng thái). Đăng xuất ở một tab chỉ xóa cookie của trình duyệt; một tab khác của cùng trình duyệt giữ socket cũ đến khi nó gọi API và nhận 401 hoặc phiên hết hạn, và trong lúc đó chỉ nhận tín hiệu **không mang dữ liệu**. Không mở rộng phạm vi để đổi hành vi đăng xuất.
- Hết phiên 8 giờ được chứng minh **bằng integration test** (cookie đăng nhập thật + tiến đồng hồ kiểm thử), **không** trong trình duyệt (không chờ 8 giờ). Trong trình duyệt đã chứng minh thu hồi quyền, đăng xuất tab và mất kết nối.
- Nghiệm thu trình duyệt chạy Admin bằng `next dev` (Strict Mode, URL API ghi đè bằng biến môi trường), không phải `next start`; `NEXT_PUBLIC_API_BASE_URL` được bake lúc build, và build production đã được dựng nhưng không phục vụ cho lần chạy này.
- Test hub dùng WebSocket client của TestServer tự nói giao thức JSON của SignalR (handshake, invocation, close), **không** thêm package `Microsoft.AspNetCore.SignalR.Client` vào dự án test: không có dependency test mới.
- **Không gửi thư thật**; Google là stub. `thebha_dev` không bị chạm bởi work item này (DB test và DB nghiệm thu là cụm PostgreSQL riêng). Lưu ý riêng, ngoài phạm vi PR này: trước khi nhận prompt này, theo yêu cầu khác của Owner trong cùng ngày, migration `AddNewsletterManagement` (migration 24 của PR #134) đã được áp lên `thebha_dev` để sửa HTTP 500 của màn đăng nhập Admin.
- Lần chạy backend đầy đủ đầu tiên có 2 lỗi do **harness của tôi**, không do mã: cụm PostgreSQL thử nghiệm chạy ở múi giờ +07 (một test content-pack so chuỗi `+00:00`) và mật khẩu thử là `local` trùng chữ “local” trong thông điệp của một test Riverside. Đặt PostgreSQL về UTC và đổi mật khẩu thử → hai test xanh (48 ca của hai lớp), rồi chạy lại toàn bộ.

## Kích thước PR

Ngoài mục tiêu 100–400 dòng. Mã sản xuất backend +355/−10 và Admin +518/−19; **test +1444 (backend 600, Admin 844/−9)** là phần lớn vì các bảo vệ bắt buộc (quyền/thu hồi/hết phiên/guard C2–C4) cần từng ca riêng; lockfile +181/−1 (cây phụ thuộc của `@microsoft/signalr`, không nâng dependency nào khác); tài liệu theo kích thước bài này. Số thực tế từ GitHub ghi trong PR body.

## Skill policy / review

- `diagnosing-bugs`: `ALLOWED_IF_TRIGGERED`; không kích hoạt riêng. Ba điều đã gặp: handshake hoàn tất trước khi kết nối được đăng ký (test quét định kỳ đỏ trước, xanh sau khi thêm `newsletterLiveReady`); hình dạng lỗi negotiate của thư viện (tìm bằng nghiệm thu trình duyệt, test thêm cùng lúc với sửa); đồng hồ test đóng băng làm hai lần xác minh trùng `VerifiedAtUtc` (là lỗi của test, ràng buộc “một Welcome cho mỗi lần xác minh” hoạt động đúng; test tiến đồng hồ).
- Graphify: `ALLOWED_IF_RELEVANT`; không dùng, phân tích ảnh hưởng bằng đọc nguồn + test.
- Advisor đã được hỏi trước khi chốt kế hoạch (nhờ đó có xét lại quyền mỗi lần phát, guard theo marker + policy, WebSockets-only, ranh giới xác nhận handshake/đăng ký).
- Review: chưa chạy — chờ Owner gọi `/codex:review --wait --base origin/develop`; kết quả sẽ chèn nguyên văn khi Owner chuyển lại.

## Quyết định cần Owner/OC

Chuyển PR cho review; nếu đạt, quyết định Ready/merge. Không bắt đầu phần badge/đã-xem theo Staff.
