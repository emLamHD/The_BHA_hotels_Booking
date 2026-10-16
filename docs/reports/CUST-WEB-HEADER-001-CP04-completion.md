# CUST-WEB-HEADER-001-CP04 — completion report

Work item `CUST-WEB-HEADER-001-CP04` (menu managed in the Admin, Customer updates at run time, `/faq`). `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner-only review). Branch `feature/cust-web-header-001-cp04-dynamic-menus-faq` from `develop` `a75de9d` (PR #119 merged). Design: `docs/design/CUST-WEB-HEADER-001-CP04-dynamic-menus-faq.md`. Evidence outside the repo: `~/bha-evidence/CUST-WEB-HEADER-001-CP04/` (`e2e/` results, shots, process snapshots; `counts-*.txt`; `demo-db-before-migration-12.dump`).

## 1. How to try it

1. Sign in to Admin (`/signin`) with a Staff account that has the website permission → **Website → Menu**.
2. Select an entry, change its label (per language), link, on/off, tab; use Lên/Xuống/Thụt vào/Lùi ra/Chuyển nhóm/Thêm mục con/Xoá; the right side previews what a visitor sees per language; **Lưu menu** saves, **Huỷ thay đổi** drops the draft.
3. Keep the Customer open in another browser: the header (desktop) and the menu drawer (phone width) change within ~10 s; a brand-new request sees it at once. Open `/faq`.
4. Menu labels also appear in **Website → Bản dịch** (set "Trạng thái" to "Tất cả"/"Đã dịch": the default filter shows only what needs work) under `content.menuItem.<id>.label`, and travel in exported/imported language packs by that id.
5. Setup on an existing database: `dotnet ef database update` (migration 12 `AddWebsiteMenus`). No rebuild or restart is needed to change a menu afterwards.

## 2. Acceptance

| | Result | Evidence (final code; all browser runs on production builds + real PostgreSQL) |
|---|---|---|
| A1 data/migration | PASS | Demo DB (languages, packs, rates, 39 holds, 35 reservations) dumped, migrated 11→12: languages 3, currencies 3 (3 rates), holds 39, reservations 35, properties 1, staff 2, non-menu translations 4323 — identical before/after (`counts-before.txt` vs `counts-after-migration-12.txt`); 54 menu entries, 108 en/fr label rows, version 1. API restarted: still 54 / version 1 (no reseed). `has-pending-model-changes`: clean. Integration test `Migration_12_…`: V11 DB with an installed fr language and an operator edit → untouched; rerun keeps operator menu edits; Down removes only the menu. Older migration tests updated for the 12th migration. |
| A2 Admin for real | PASS | `menu-a` 11/11: create (external link, new tab, vi/en/fr), edit labels/links, reorder, move group/level, hide/show, delete, empty tree; Cancel vs Save; reload reads the DB; bad link (`javascript:`, `//host`), missing vi label, delete-with-children, fifth level are answered on screen and send nothing; DB checked after each save (rows, sort order, label rows manual + stamped, orphan labels removed). |
| A3 no redeploy | PASS | Same PIDs, builds, API binary and start times at start and end (`processes-start.json` = `processes-end-A/B/C.json`). Time from "Save succeeded" to the change visible in a separate Customer desktop tab and phone drawer: create 6.6/7.0 s, reorder 9.0, link 9.8, hide 9.6/10.0, delete 9.6, group 9.8 s, empty tree 3.2 s, restore 4.2 s (**max 10.0 s**, limit 15). A fresh context saw each change immediately. Empty tree: header and drawer show no menu and no built-in one returns, search/language/account still work. |
| A4 i18n/FAQ | PASS | `menu-b` 12/12: for vi/en/fr header labels, sub-entries, expander aria-label ("Mở rộng/Expand/Développer …") and drawer match the API's; the EUR choice is kept; `/faq` direct load with the six questions in each language, accordion with Enter/Space, no write or availability request, mobile/tablet/desktop × light/dark without horizontal overflow; header FAQ entry leads to `/faq`. A label edited on the Translations screen (language asserted before typing) and a label imported by pack (overwrite mode, entry renamed in between: the label followed the id) reached the Customer in ≤ 8 s without deploy. A missing en/fr label is flagged in Admin and shown as the default's on the site. 12 long labels at 1440/1024: no overflow, controls on screen. |
| A5 concurrency/auth | PASS | `menu-c` 10/10: two editors → 409 with the draft kept, "tải mới" merges content edits and keeps the other editor's change; a label changed on the Translations screen makes a save stale; double click = 1 POST, +1 version; lost response → "chưa xác nhận", Save blocked, "Kiểm tra máy chủ" confirms it applied exactly once (1 POST); lost cookie → no write, sent to sign-in; revoked permission → next request 403, nothing written, grant restores; foreign/missing Origin 403, wrong content type 415, anonymous 401 (also integration tests, incl. LocalGate 404). Customer: API 500/abort keeps the last menu and recovers on its own; a slow answer for the old language never replaces the new language's menu after a switch. |
| A6 regression/CI | PASS locally; CI see PR | Booking smoke on the final build: vi 8/8, en 8/8, fr 10/10 (one hold + one confirm each, VND `2000000.00` stored; fr: language/currency switch while typing, with a hold and during a confirm). `menu-d` 4/4: menu changed while the form is typed and while a hold is active → typed values, hold id, expiry, browser storage unchanged; no request sent; a failing menu API changes nothing. C2 pack/currency regressions: Backend suite. |

Checks: Backend Release build 0 errors; unit 479 + integration 1061 pass (PostgreSQL 17); catalog check clean; Admin tsc/eslint clean, 1877 tests; Customer tsc/`next lint` clean, 1269 tests; production builds of both apps. Screenshots (375/768/1440 × light/dark, header, drawer, FAQ, empty menu, 409, lost response, 403): `e2e/shots/`.

## 3. Findings fixed on the way (browser)

- The main row shrank every entry to nothing with 12 long labels → entries are measured and overflow into a "···" list; the left header block got a definite width.
- A stale save followed by "load latest" would have overwritten the other editor's changes → the operator's content edits are laid over the latest tree; structural edits keep the draft and say Save replaces the tree.
- Focus/visibility/navigation events produced two requests 130 ms apart → event-triggered checks are ≥ 1 s apart.
- The demo room type has one unit; the vi booking window used by the previous run was sold out, so vi was re-run on a free window (data, not a defect).

## 4. Deviations, limits, NOT RUN

- Desktop and mobile showed different sample trees; one tree serves both (the desktop "Home" column and "Five columns" demo are not seeded). The desktop Services card (icons, descriptions, "Mẫu" badge, footnote) and the sample menu's featured image became plain dropdown/panel entries with the drawer's labels.
- Sample-template labels (46) and the en/fr labels of the blog categories and services were written by the implementer; no native review.
- No drag-and-drop (buttons instead). No per-Property or footer menus. Only content edits merge after a stale save.
- Old unused catalog keys (`customer.header.menu.*`, `…dropdownTravelers.*`, `…templatesDropdown.*`, `customer.nav.*`) remain.
- NOT RUN: real mobile devices (emulated viewports only); production deploy or production-like migration; browser test of sign-out while a menu save is pending (covered by the gate's unit tests); the Admin screen's keyboard drag alternative is buttons only.
- The Staff demo password stays the disposable one set in R1; the demo stack, LibreTranslate excluded, is left running only while the Owner reviews.
