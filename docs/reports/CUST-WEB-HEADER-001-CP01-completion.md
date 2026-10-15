# CUST-WEB-HEADER-001-CP01 — Logo sáng/tối và typography header

- **Work item:** `CUST-WEB-HEADER-001-CP01`. `IMPLEMENTER: CLAUDE` (Sonnet 5.5) + `REVIEWER: CODEX_READ_ONLY` (Owner gọi). Chỉ `Front_End/Customer_Web` + docs.
- **Branch:** `feature/cust-web-header-001-cp01-logo-typography` → Draft PR vào `develop`. `BASELINE_SHA` = `START_HEAD` = `00bff78e5c7c7294648344b915a9b367138114b4` (đã `git fetch --prune`; `origin/develop` trùng baseline).
- **Validation SHA:** `7af71a0ed20a6c4bb7f151ff0e43f9a37fc7c3b3` (code; commit `515377f…` + `7af71a0…`). Cây `Front_End/Customer_Web` tại đó: `def73bb620f1b1029e92f9aeda0615e17dd0d94d`; commit docs không đổi cây này. FINAL_HEAD, URL PR, additions/deletions GitHub và CI ghi ở PR body.
- **Skills:** `diagnosing-bugs` REQUIRED (lỗi nền logo dark mode). Skill **không gọi được qua công cụ Skill** trong phiên này (không nằm trong danh sách, `disable-model-invocation: true`); quy trình được thực hiện thủ công theo `~/.claude/skills/diagnosing-bugs/SKILL.md`. Graphify `NOT_APPLICABLE`, không dùng. Advisor: 2 lần, đều read-only (trước khi chốt kế hoạch; trước khi bàn giao). Subagent Haiku chỉ đọc (tra cứu nơi dùng `Logo`, file header/font); mọi sửa đổi do `ACTIVE_EXECUTOR`.

## 1. Vấn đề và hành vi sau sửa

| | Trước | Sau |
|---|---|---|
| Logo, dark mode | JPG nền trắng đục: hộp trắng quanh logo; chữ "The"/"RIVERSIDE" gần đen | PNG trong suốt; bản dark chỉ đổi mực sang off-white, vàng giữ nguyên |
| Chữ menu | Poppins (body) **không có subset tiếng Việt**: "Ư" rơi xuống `Liberation Serif`; cỡ/độ đậm lệch nhau ("Dịch vụ" to và đậm hơn "Blog") | Be Vietnam Pro cho header và drawer; một thang chữ chung |

## 2. Chẩn đoán (`diagnosing-bugs`)

- **Kích hoạt:** Owner báo defect cụ thể (nền logo ở dark mode).
- **Vòng phản hồi (Phase 1, chạy được ở trạng thái đỏ):** Playwright + Chrome 153 hệ thống, bản `next start` production, API + PostgreSQL demo; chụp từng `Logo` đang hiển thị (header, drawer, footer) trong 2 theme × 4 viewport × 3 trang (`home`, `riverside`, phòng) và chạy `python3 logo_loop.py results.json` (mã đầy đủ ở §4). Đo trên trang thật, không đo trên asset: (1) bốn góc ảnh (vùng lề thuần) phải trùng màu mặt nền cạnh logo; (2) nét mực (vị trí lấy từ JPG gốc) đạt WCAG ≥ 3:1 so với nền.
- **Đỏ trước sửa:** 37/74 đỏ, **toàn bộ ở dark**, 0 ở light; độ lệch viền 238/255 (hộp trắng).
- **Xanh sau sửa (cây `def73bb…`):** 0/74 đỏ, độ tương phản mực thấp nhất 10,15:1.
- **Giả thuyết xếp hạng:** H1 JPG nền đục không có alpha (**xác nhận**: 4 góc `(255,255,255)`); H2 mực gần đen mất trên nền tối (**xác nhận**; lưu ý chỉ số tương phản mực không tự đỏ ở baseline vì chính hộp trắng làm nền cho chữ — cờ đỏ ở baseline là chỉ số hộp trắng); H3 `next/image` làm mất alpha của PNG (**bác bỏ**: lần chạy xanh trên trang phục vụ bởi optimizer); H4 Poppins thiếu glyph tiếng Việt (**xác nhận** bằng CDP `CSS.getPlatformFontsForNode`: `Ưu đãi` = `Poppins:5` + `Liberation Serif:1`).
- **Không có seam unit-test đúng:** jsdom không đo được pixel/font thực; không thêm test chỉ kiểm tên class. Browser acceptance là kiểm chứng chính (theo prompt).
- **Post-mortem:** logo raster đục + font body không phủ tiếng Việt, không có kiểm tra thị giác dark mode. Không cần handoff kiến trúc.

## 3. Thay đổi

`Logo.tsx` (hai `Image`, `dark:hidden` / `hidden dark:block`, `priority`, `sizes="128px"`; CSS-only, không state/provider mới; alt giữ), 2 asset PNG mới, `shared/headerTypography.ts` (thang chữ), `layout.tsx` (chỉ đăng ký `Be_Vietnam_Pro` → `--font-header`; giữ class body, provider, metadata), `MainNav2`, `BlogNavDropdown`, `DropdownTravelers`, `TemplatesDropdown`, `LangDropdown`, `NavMobile` (dùng thang chung; hover/pressed nền cho nút ngôn ngữ/tiền tệ). Không đổi tên/link/thứ tự menu, không đổi ngôn ngữ/tiền tệ/cảnh báo demo, không backend/Admin/dependency/lockfile/CI.

**Typography:** menu chính 15px (16px từ `xl`), weight 500, `leading-6`; submenu 14px, weight 400; một kiểu pill chung (hover, pressed, focus ring). Font chỉ áp ở dải header (`MainNav2`, gồm ô tìm kiếm gọn và panel tài khoản) và drawer (`NavMobile`, vì dialog được portal ra khỏi header); body vẫn Poppins.

## 4. Provenance asset và font

- **Nguồn logo:** `Front_End/Customer_Web/src/images/logo_the_bha_riverside.jpg` (commit `10522f4`, PR #16; 1439×685) là bản logo The BHA duy nhất trong repo; `logo.png`/`logo-light.png`/`logoOnly.svg` là của template Chisfis, không dùng. Chỉ có JPG nên được tách nền kỹ thuật bằng Pillow (không sinh ảnh/vẽ lại); JPG gốc **được giữ** (nguồn đối chiếu, không còn nơi import).
- **Số đo:** kích thước hai biến thể trùng nhau (1439×685 RGBA); composite bản sáng lên nền trắng so với JPG: sai khác trung bình 0,575/255, lớn nhất 147, 0,29% pixel lệch > 40 (viền khử răng cưa); bản tối so với bản sáng: 0 pixel vàng đổi, kênh alpha giữ nguyên; vàng đậm nhất 3,01:1, vàng trung vị 4,60:1, mực off-white 15,00:1 trên `neutral-900` (không đổi màu vàng). Kiểm tra 3× các nét mảnh ("The", gạch ngang, đường sóng) trên nền `#171717` và trắng: không viền trắng, không mất nét.
- **Dung lượng:** +372.068 và +286.021 byte nhị phân (PNG không mất dữ liệu; `next/image` phục vụ rendition nhỏ).
- **Font:** Be Vietnam Pro, SIL Open Font License 1.1 (Google Fonts; thiết kế cho tiếng Việt). Đăng ký bằng `next/font/google` (tự host lúc build, không gọi Google lúc chạy), subset `latin`, `latin-ext`, `vietnamese`, weight 400 và 500. Repo chưa có quy ước ghi license font (Poppins/line-awesome cũng không được ghi), nên chỉ ghi ở report này.

Mã tạo asset (nguyên văn, `harness/derive_logo.py`):

```python
"""Derive transparent light/dark variants of the The BHA Riverside logo from the verified source JPG.
Method: alpha from distance-to-white (min channel), colour decontaminated from the nearest opaque pixels (no
white fringe); the dark variant recolours ONLY near-neutral dark "ink" pixels (the script "The" and "RIVERSIDE")
to a warm off-white and leaves every gold pixel byte-identical. Pure Pillow; no generative drawing."""
import sys
from collections import deque
from PIL import Image
SRC, OUT_LIGHT, OUT_DARK = sys.argv[1:4]
INK_TO = (242, 234, 219)            # warm off-white for ink on dark surfaces
T0, T1 = 10, 90                     # alpha ramp on d = 255 - min(R,G,B): <=T0 transparent (JPEG noise), >=T1 opaque
src = Image.open(SRC).convert("RGB"); W, H = src.size; px = list(src.getdata())
def alpha(c):
    d = 255 - min(c); t = (d - T0) / (T1 - T0)
    return 0.0 if t <= 0 else 1.0 if t >= 1 else t * t * (3 - 2 * t)
a = [alpha(c) for c in px]
col = [None] * (W * H); q = deque()
for i, c in enumerate(px):
    if a[i] >= 0.98: col[i] = c; q.append(i)           # opaque core keeps its own colour
dist = {i: 0 for i in q}
while q:                                                # BFS: edge/transparent pixels inherit the mean of coloured neighbours
    i = q.popleft(); x, y = i % W, i // W
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            nx, ny = x + dx, y + dy; j = ny * W + nx
            if 0 <= nx < W and 0 <= ny < H and col[j] is None and dist[i] < 8:
                ns = [col[ny * W + nx + ox + oy * W] for ox in (-1, 0, 1) for oy in (-1, 0, 1)
                      if 0 <= nx + ox < W and 0 <= ny + oy < H and col[ny * W + nx + ox + oy * W] is not None]
                col[j] = tuple(sum(n[k] for n in ns) // len(ns) for k in range(3)); dist[j] = dist[i] + 1; q.append(j)
fill = (170, 120, 40)
col = [c if c is not None else fill for c in col]
light = Image.new("RGBA", (W, H)); light.putdata([(c[0], c[1], c[2], round(255 * al)) for c, al in zip(col, a)])
def is_ink(c): return (max(c) - min(c)) < 45 and (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 140
dark = Image.new("RGBA", (W, H)); dark.putdata([((INK_TO if is_ink(c) else c) + (round(255 * al),)) for c, al in zip(col, a)])
light.save(OUT_LIGHT, optimize=True); dark.save(OUT_DARK, optimize=True)
print("size", W, H, "ink px", sum(1 for c, al in zip(col, a) if al > 0.5 and is_ink(c)), "opaque px", sum(1 for al in a if al >= 0.98))
```

Mã vòng phản hồi (nguyên văn, `harness/logo_loop.py`):

```python
# Red/green feedback loop for the dark-mode logo defect. usage: python3 logo_loop.py <results.json>  -> exit 1 if red
# Two symptoms, both measured on the rendered page (element screenshot), not on the asset:
#  (1) box:   the logo's four corners (pure margin) must equal the surface next to the logo (no white/opaque box)
#  (2) ink:   the ink strokes ("The", "RIVERSIDE"; located from the verified source JPG, best-covered quarter of the stroke pixels) must
#             reach WCAG >= 3:1 against that surface
import json, sys, warnings; warnings.filterwarnings("ignore")
from PIL import Image
SRC = "/home/admin1/The_BHA_hotels_Booking/Front_End/Customer_Web/src/images/logo_the_bha_riverside.jpg"
def mean(img_or_path):
    im = Image.open(img_or_path).convert("RGB") if isinstance(img_or_path, str) else img_or_path
    px = list(im.getdata()); return tuple(sum(c[i] for c in px) / len(px) for i in range(3))
def rl(c):
    f = lambda v: v / 255 / 12.92 if v / 255 <= 0.03928 else ((v / 255 + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
def ratio(a, b): la, lb = rl(a), rl(b); return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
src = Image.open(SRC).convert("RGB")
ink = Image.new("L", src.size); ink.putdata([255 if (max(c) - min(c)) < 45 and (0.299*c[0]+0.587*c[1]+0.114*c[2]) < 90 else 0 for c in src.getdata()])
res = json.load(open(sys.argv[1])); bad = []; n = 0; worst_ink = 99.0
for r in res:
    for l in r["logos"]:
        bg = mean(l["bg"]); im = Image.open(l["file"]).convert("RGB"); W, H = im.size; n += 1
        mism = 0
        for x, y in [(2, 2), (W - 10, 2), (2, H - 10), (W - 10, H - 10)]:
            m = mean(im.crop((x, y, x + 8, y + 8))); mism = max(mism, max(abs(m[i] - bg[i]) for i in range(3)))
        mk = ink.resize((W, H), Image.BILINEAR).point(lambda v: 255 if v > 128 else 0)
        sel = [c for c, m in zip(im.getdata(), mk.getdata()) if m]
        sel.sort(key=lambda c: -abs(rl(c) - rl(bg))); sel = sel[: max(1, len(sel) // 4)]  # best-covered quarter: anti-aliased edges would dilute the mean
        ic = tuple(sum(c[i] for c in sel) / len(sel) for i in range(3)) if sel else bg
        assert sel, 'empty ink mask: the loop would be blind'
        cr = ratio(ic, bg); worst_ink = min(worst_ink, cr)
        if mism > 12 or cr < 3.0: bad.append((r["theme"], r["vw"], r["page"], l["ctx"], round(mism, 1), round(cr, 2)))
print(f"logo instances checked: {n}; RED instances: {len(bad)}; worst ink contrast: {worst_ink:.2f}:1")
for b in bad[:6]: print("  RED theme=%s vw=%s page=%s ctx=%s box_mismatch=%s ink_contrast=%s:1" % b)
sys.exit(1 if bad else 0)
```

## 5. Acceptance

**A1 logo (light/dark):** ảnh trước/sau cùng viewport (header 375/768/1024/1440, drawer 375/768, footer) và vòng đỏ/xanh ở §2; không hộp/viền trắng ở dark; thông số asset ở §4. Toggle 6 lần liên tiếp đều đổi trạng thái; tải lại giữ theme (cả sáng lẫn tối) trên `home`, `riverside`, phòng; 0 asset/font phản hồi ≥ 400.

**A2 typography:** CDP trên `Ưu đãi`: trước `Poppins:5 + Liberation Serif:1`, sau `Be Vietnam Pro Medium:6` (15px ở 1024, 16px ở 1440, weight 500); toàn bộ 24 tổ hợp chỉ dùng `Be Vietnam Pro Medium`. Ở 375/768/1024/1440 × light/dark × 3 trang: 0/24 tràn ngang (`scrollWidth ≤ clientWidth`, tài liệu không rộng hơn viewport), mọi mục menu một dòng. Đo thêm ở 1024, 1100, 1180, 1280 (đầu `xl`, chữ lên 16px) và 1440 × light/dark × `home`/`riverside` (`layout.mjs`): 0/20 tràn hoặc xuống dòng, cả ở pha fallback (woff2 bị giữ lại 1,8 giây) lẫn khi font đã tải; **độ dư rộng không được đo** nên không khẳng định điểm nào là hẹp nhất. **Nhảy bố cục khi font tải:** tải bình thường (font được preload) là 0 px, 0 mục layout-shift ở header; khi woff2 bị giữ lại 1,8 giây rồi mới đổi font, các mục menu dịch ngang tối đa 23,1px (21,7px ở ≤ 1180) và mục layout-shift lớn nhất của header là 30,2px (28,3px ở ≤ 1180), không gây tràn hay xuống dòng — chỉ là trường hợp mạng chậm. Dấu chồng ("ữ", "ẫ", "ị", "Ư") kiểm bằng ảnh DPR 2: không bị cắt.

**A3 tương tác** (`accept.mjs`, 312 kiểm tra, **312 đạt**; khách ẩn danh): logo về `/` (3 trang × 2 theme); link Riverside → `/riverside`, Ưu đãi → `/offers`, Blog → `/blog`; `Dịch vụ`, `Giao diện mẫu`, ngôn ngữ/tiền tệ, tài khoản: mở bằng click/Enter/Space, đóng bằng Escape (đọc `aria-expanded`); Blog mở khi hover và đóng khi con trỏ rời, chevron mở bằng bàn phím; lựa chọn ngôn ngữ chỉ báo "chưa áp dụng", `lang="vi"` và URL không đổi, cảnh báo demo còn; drawer ở 375, 768 và hai mức mô phỏng zoom 200% (viewport 720 và 512): mở/đóng bằng Escape, link điều hướng và đóng drawer, mục ngôn ngữ/tiền tệ mở rộng, không tràn ngang, nút theme và tài khoản vẫn trong header. **Vòng focus (dark):** `focus.mjs` trong context dark mới (`html.dark`, nền `(16,23,38)`): Tab tới `Riverside`, `Ưu đãi`, `Dịch vụ`, `Giao diện mẫu` và nút theme; mỗi điều khiển có 425–893 pixel khác nhau giữa lúc focus và lúc blur (ảnh `focus/`). Phép kiểm focus ban đầu trong `accept.mjs` vô nghĩa (`box-shadow` luôn khớp `rgb`) và ảnh `focus-dark-1440.png` thực ra là theme sáng: đã bỏ, thay bằng `focus.mjs`. **0 POST** tới hold/reservation trong cả hai bộ kiểm tra. Lỗi console duy nhất: `401` của `GET /api/v1/auth/me` ẩn danh (như baseline, 24/24 trang); không lỗi console mới.

## 6. Checks (cây `def73bb…`, sạch, chạy liên tiếp không sửa giữa chừng)

| Lệnh (từ `Front_End/Customer_Web`) | Kết quả |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL=https://localhost:7443 npm run build` | exit 0 (build lại từ cây sạch sau commit cuối) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 cảnh báo/lỗi |
| `npm test` (`vitest run`) | 50 file, 1152/1152 |
| `git diff --check origin/develop...HEAD` | sạch |
| Browser acceptance, vòng logo, A2 | PASS (§2, §5) |

`npm ci` không cần (`node_modules` đã khớp lockfile); không đổi dependency/lockfile. Không có test hiện có tham chiếu các file đã sửa. CI của PR HEAD: ghi ở PR body.

## 7. Deviations

- Commit thứ hai (`7af71a0`) thêm `sizes="128px"` cho hai `Image` tải sớm: không có nó, trình duyệt tải rendition 1920px cho logo ≤ 128px (đã đúng với JPG cũ; bản mới có hai ảnh nên tăng gấp đôi). Nằm trong `Logo.tsx`, không ngoài scope.
- 14/312 kiểm tra đỏ ở lượt đầu của `accept.mjs` là lỗi selector của script (`text=…` khớp cả nội dung trang) — không phải lỗi sản phẩm; script sửa sang đọc `aria-expanded`, sản phẩm không đổi.
- Kích thước PR: xem GitHub ở PR body; code ≈ 62/30 dòng cộng hai asset nhị phân, còn lại là docs.

## 8. Known risks / NOT RUN

- Một lần duy nhất (lượt chụp đầu trên cây `515377f`, light, 768, trang phòng) có một lỗi console `404` không rõ URL; **không tái hiện** trong 8 lần tải lại cùng tổ hợp, trong lượt chụp cuối (24 tổ hợp) và trong 312 kiểm tra. Không quy được nguyên nhân; coi là thoáng qua, chưa giải thích.
- Request mới bị hủy (`ERR_ABORTED`) tới iframe Google Maps nhúng ở trang chủ khi đóng trang; không liên quan header.
- Chỉ khách ẩn danh: header khi đã đăng nhập chưa chạy (typography thừa hưởng qua class, không đổi logic).
- Còn Poppins (thiếu glyph tiếng Việt) ở **body**, tiêu đề hero, thanh app bar dưới (`FooterNav`: "Menu", "Trang chủ") và các dialog portal khác ngoài drawer — ngoài scope, khuyến nghị theo dõi riêng.
- Zoom 200% được mô phỏng bằng cách chia đôi viewport (720, 512), không phải zoom trình duyệt thật.
- Bản mẫu header không dùng (`MainNav1`, `Header3`) cũng dùng `Logo` nên nhận logo mới; không kiểm trên trang. `SectionBecomeAnAuthor` (`<Logo className="w-20">`) không được import ở đâu (mã template chưa dùng); bề mặt dark của nó chưa kiểm.
- Build phụ thuộc Google Fonts lúc build (đã đúng với Poppins; thêm một font tăng nhẹ khả năng flake `ETIMEDOUT` trên CI).
- Quan sát mã (không đổi): `BlogNavDropdown` mở khi hover, nên click chevron ngay sau hover sẽ đóng lại.
- Ảnh không đính kèm được vào PR (`gh` không tải ảnh lên): bộ bằng chứng ở `/home/admin1/bha-evidence/CUST-WEB-HEADER-001-CP01/` (`before/`, `after/`, `accept/`, `asset/`, `focus/`, `harness/` gồm `cap.mjs`, `accept.mjs`, `focus.mjs`, `layout.mjs`, `logo_loop.py`, `derive_logo.py`), ngoài repo. Ảnh chỉ chứa giao diện test ẩn danh.
- `REVIEW: NOT RUN` — chờ Owner gọi `/codex:review --base origin/develop`.
