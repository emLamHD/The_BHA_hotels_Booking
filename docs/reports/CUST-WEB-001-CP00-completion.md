# CUST-WEB-001-CP00 — Audit và hợp đồng sản phẩm/release Customer Web

- **Work item / phase:** `CUST-WEB-001-CP00` / `CP00_AUDIT_PRODUCT_CONTRACT`. Role pair: `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`.
- **Branch:** `docs/cust-web-001-cp00-product-contract` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `2ad2bc967735931a9390112d796c3cdd870ed1df`.
- **FINAL_HEAD, commit, số liệu PR và CI của FINAL_HEAD:** ghi trong PR body và terminal handoff, **không** ghi ở file này (tránh commit chỉ để chèn hash rồi lấy CI của head cũ).
- **Nội dung chính:** [docs/design/CUST-WEB-001-product-contract.md](../design/CUST-WEB-001-product-contract.md). File này không lặp lại; chỉ trỏ tới mục.

## Status

```
IMPLEMENTATION_CP00: PASS (xem phần “Acceptance”; điều kiện CI/PR alignment kiểm ở handoff)
CUSTOMER_PRODUCT_CONTRACT: PREPARED (PROPOSAL, mọi quyết định OPEN)
CUSTOMER_WEBSITE: NOT_COMPLETE
RUNTIME_CHANGES_CP00: NONE
RUNTIME_BROWSER_CP00: NOT_REQUIRED
REVIEW_CP00: NOT_RUN — OWNER_ONLY
CP01_PLUS: NOT_STARTED
LIVE_DEPLOY_CP00: NOT_RUN
BACKEND_CD: OUT_OF_SCOPE — NO_NEW_LIVE_VERIFICATION
```

`PASS` ở đây là PASS của implementation tài liệu, **không** phải PASS review, không phải hợp đồng đã được Owner duyệt, không phải quyền merge.

## Preflight

- Work item: `CUST-WEB-001-CP00`.
- Repository/Branch/HEAD: `/home/admin1/The_BHA_hotels_Booking` / `develop` → `docs/cust-web-001-cp00-product-contract` / `2ad2bc9`.
- Scope: 4 file allowlist (contract, report, `PROJECT_BIBLE.md`, `SNAPSHOT.md`); docs-only.
- First action: đọc governance, rồi audit source Customer_Web và `Back_End`.
- Xác minh: cây sạch; `git fetch --prune origin`; `HEAD` = `origin/develop` = `BASELINE_SHA`; không có `FEATURE_BRANCH` local/remote; không có contract/report CP00 trước đó; 0 PR mở; chỉ một process `claude` (phiên này) và không có file khoá `.git/*.lock`. Hai linked worktree Orca cũ (`/home/admin1/orca/workspaces/...`) tồn tại trên đĩa; theo `docs/governance/RULES.md` §5 chỉ ghi nhận, không dùng và không đụng tới.

## Kết quả audit (chi tiết trong contract)

- **Inventory (§2):** chỉ `HomeFeaturedRooms`, trang phòng, hold → confirm → `/paydone` và `StaySearchProvider` là `REAL_INTEGRATED`; `/login`, `/signup`, `/account*`, `/contact`, `/about`, footer, `/listing-stay`, `/checkout`, menu đa dịch vụ là `TEMPLATE_ONLY`. Customer_Web chưa có client cho `auth/*` và `reservations/*`.
- **Khác biệt cần chú ý so với giả định ban đầu:** trang `/checkout` còn nút “Confirm and pay”; `FooterNav` “Log in” trỏ `/account`; `AvatarDropdown` luôn hiện “Eden Smith”; `NavMobile` còn “Get Template” (themeforest); bảng “Customize” chỉ có trên desktop; `/api/hello` không tiếp cận được ở cả hai chế độ proxy; `LikeSaveBtns` dùng `localStorage` còn `/account-savelists` hiển thị dữ liệu mẫu.
- **API (§4):** `register` trả `201 CustomerSessionResponse` nhưng **không** đăng nhập; `login`/`register` bỏ CSRF, `logout`/`booking-holds`/`confirm`/`cancel` cần CSRF; Origin chỉ kiểm ở route Admin/Staff; không có API liệt kê đặt phòng (đã kiểm toàn bộ route map); `confirm` không có `Idempotency-Key` nhưng idempotent theo hold nguồn.
- **Hazard tìm thấy trong source (§7), chưa tái hiện, không sửa:** (H01) cookie Customer hỏng/hết hạn chặn mọi booking API kể cả khách, và `logout` không dọn được; (H03) replay `create` không trả `guestAccessToken` ⇒ khách mất phản hồi đầu có thể không bao giờ xác nhận được; (H04) fingerprint của hold chứa `customerAccountId` ⇒ đổi danh tính giữa chừng gây 409 hoặc mất credential; CSRF gắn danh tính, `invalidateCsrfToken()` chưa có ai gọi khi login/logout.
- **Owner packet (§5):** 11 quyết định, tất cả `OPEN`, mỗi dòng có khuyến nghị, đánh đổi, input thiếu và CP phụ thuộc.
- **Chuỗi PR (§6):** CP01 → CP10; **checkpoint triển khai đầu tiên đề xuất: `CUST-WEB-001-CP01` (nền tảng session & chuyển danh tính, 350–550 logic, có ranh giới tách 01a/01b)**. Chưa kích hoạt.
- **Release (§8):** mười gate G1–G10; không giảm journey bắt buộc.

## Owner PR policy (nguyên văn và phạm vi)

Chép nguyên văn ở contract §0. Áp dụng cho mọi PR và correction của initiative. Hai file governance (`WORKFLOW.md` §6, `AGENTS.md` §13) còn wording 100–400 dòng cũ; không sửa trong CP00; đề xuất work item riêng (contract §9).

## Acceptance

| Nhóm | Kết quả | Evidence |
|---|---|---|
| 1. Inventory đủ route/action reachable, ref tồn tại, phân loại có evidence | Đạt | Contract §2; tham chiếu path/symbol được đối chiếu với source (check bên dưới) |
| 2. API matrix không nhầm register/session, reservation-id/history, proxy/route policy, retry/ownership, template data | Đạt | Contract §4, A02–A05, A11–A17, X01, X03 |
| 3. Owner packet tách known khỏi OPEN và gắn dependency | Đạt | Contract §5 |
| 4. Chuỗi PR theo one-concern/~400 logic, mỗi slice có gate/acceptance/checks | Đạt (ước lượng) | Contract §6; ước lượng cần implementer đo lại |
| 5. Release contract không tự giảm journey; blocker/thiếu evidence minh bạch | Đạt | Contract §8, §7 |
| 6. Nhất quán contract/report/BIBLE/SNAPSHOT; chỉ allowlist thay đổi; Draft PR; head đồng nhất; CI FINAL_HEAD | Phần tài liệu đạt; PR/CI kiểm ở handoff | `git diff --name-only`; PR body |

## Checks (CP00)

| Check | Kết quả |
|---|---|
| `git diff --check` (working tree và `origin/develop...HEAD`) | chạy, kết quả ghi ở handoff |
| Review file thay đổi so với allowlist | chỉ 4 file allowlist |
| Đối chiếu path/symbol/endpoint trong contract với source | chạy bằng script ad-hoc (không thêm vào repo), kết quả ghi ở handoff |
| Quét secret/PII trên file thay đổi | chạy bằng `grep`, không in giá trị; kết quả ghi ở handoff |
| Self-review inventory ↔ API ↔ quyết định ↔ PR ↔ release | đã thực hiện |
| GitHub additions/deletions, `git diff --numstat` | ghi ở PR body/handoff. Ước lượng **hand-written logic = 0** (cả 4 file là tài liệu; không có code, test, generated, lockfile, snapshot) |
| CI Backend/Frontend/Admin trên FINAL_HEAD | ghi ở PR body/handoff; workflow `.github/workflows/ci.yml` chạy trên mọi `pull_request` vào `develop` (không có path filter) |
| Vercel / Backend image tự kích hoạt | ghi riêng ở handoff nếu có; không suy ra deploy readiness |

## Không chạy (NOT_RUN), giới hạn, rủi ro

- **Không chạy** trình duyệt, `npm ci/test/lint/build`, `tsc`, .NET, PostgreSQL: `RUNTIME_BROWSER_CP00`, `CUSTOMER_LOCAL_TEST_BUILD_CP00`, `DOTNET_POSTGRES_CP00` đều `NOT_REQUIRED`. Mọi nhận định về hành vi là `SOURCE_ONLY @ 2ad2bc9`; không dùng evidence trình duyệt của CP02 cho baseline này.
- Hành vi của framework chưa được repo chứng minh: ràng buộc token CSRF với danh tính, và việc cookie handler có xoá cookie hết hạn hay không. Contract đánh dấu `UNVERIFIED`, không khẳng định.
- Ước lượng logic của các PR là ước lượng thô.
- Không dùng skill `diagnosing-bugs` (không có defect cụ thể). Không dùng Graphify/GitNexus. Model: Sonnet 5.5 theo hệ thống.
- Drift còn lại không sửa (ngoài allowlist hoặc ngoài Customer): contract §10.
- Không có Ready, merge, xoá nhánh, deploy hay dispatch workflow.

## Handoff

Mọi thao tác ghi đã dừng ở checkpoint này. Review do Owner gọi; xem terminal handoff cho FINAL_HEAD, PR và CI.
