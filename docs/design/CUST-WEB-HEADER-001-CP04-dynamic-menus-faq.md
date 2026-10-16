# CUST-WEB-HEADER-001-CP04 — header navigation managed in the Admin, and the FAQ page

Status: implemented on `feature/cust-web-header-001-cp04-dynamic-menus-faq` (Draft PR). Evidence: `docs/reports/CUST-WEB-HEADER-001-CP04-completion.md`.

## 1. What changed for a person

- **Admin → Website → Menu** (`/website/menus`): create, edit, delete, reorder and re-link the entries of the Customer header and drawer; set the label per language (vi/en/fr and any installed language); switch an entry off; open in a new tab; move between the main row and the secondary group; sub-entries up to 4 levels. Edits are a local draft; **Lưu menu** applies the whole tree, links and labels in one transaction; **Huỷ thay đổi** drops the draft.
- **Customer**: the header (desktop) and the drawer (mobile) draw the same tree from the API. A Save is visible to the next request, and to a tab that is already open within 10–15 seconds. No build, deploy or restart.
- **`/faq`**: a real page (the Riverside page's six questions, one policy text), reachable from a default "FAQ" entry after Blog that the Admin can edit like any other.

## 2. Data

- Navigation is **site-wide**, not per Property. `WebsiteMenuItems` + singleton `WebsiteMenu` (see `docs/DATABASE.md`, migration 12). The tree is `ParentId`/`Placement`/`SortOrder`; a root's placement is `primary` (left of the header) or `secondary` (right, beside language/account). The logo, search, language/currency, light/dark and account controls stay code: they are not entries.
- **Labels are stored content.** The Vietnamese label is the row's `Label` (the content source language); every other language's label is a `WebsiteTranslations` row with key `content.menuItem.<id>.label` (`ContentCatalog` lists them, so coverage, the Translations screen, pack export/import and "outdated" work with no new machinery). The id never changes when a name, link or position does. A pack carries menu labels by that id; it cannot create or delete entries. A site that does not have an entry's id skips its pack text ("unknown content"), as for any stored content.
- A label a language lacks falls back to the default language's, then to Vietnamese. The Admin shows it as missing; it never blocks a Save (only vi and the default language are required).
- **Seed**: the migration reproduces what the header actually showed (Riverside, Ưu đãi, Blog + 3 categories, FAQ, Dịch vụ + 5 services, and under "Giao diện mẫu" the template's sample tree) with fixed ids and vi/en/fr labels (`WebsiteMenuSeed`, frozen). *Desktop and mobile showed different sample trees; one tree serves both, so the desktop "Home" column (`/`, `/home-2`, `/home-3`) of the sample menu, which the drawer had deliberately dropped, and the "Five columns" demo are not in it.* The desktop Services card (icons, per-item descriptions, the "Mẫu" badge, the footnote) and the sample menu's featured image are replaced by the plain dropdown/panel with the drawer's labels ("… (trang mẫu)"): entries are data, so they have no per-entry extras. Sample-template names had no pack texts before (they were shown in English everywhere); the seed gives them vi/en/fr labels written by the implementer, without native review.

## 3. API

| | Route | Notes |
|---|---|---|
| Admin read | `GET /api/admin/v1/website/menus` | flat list in tree order, every language's label, `revision`, `version`; `no-store` |
| Admin write | `POST /api/admin/v1/website/menus/save` | body `{expectedRevision, items:[{id,parentId,placement,isEnabled,href,openInNewTab,labels}]}`; list order = sibling order |
| Public read | `GET /api/v1/website/menus?locale=` | `{revision, locale, generatedAtUtc, primary[], secondary[]}`, enabled entries only, labels resolved; `no-cache` + ETag (304) |

Access is the other website routes': Staff session + global `WebsiteSettingsManage` (401/403), Origin + JSON on the write, closed under LocalGate. The actor is the session's Staff id. Public output has no Staff id, draft or administrative field.

**Save** runs in the website advisory-lock transaction. It compares `expectedRevision` (the tree's version plus the version of every label row, so a label edited on the Translations screen in the meantime also makes a save stale → `409 stale-version`), validates, replaces the tree (one `DELETE` + inserts: the self-FK is checked at statement end), writes/clears label rows (hand-edited, stamped with the default-language text they were written against), deletes the labels of removed entries, bumps the version. A save that changes nothing writes nothing. Refusals are `400` with `code` `menu-*` and `field` `items[i].…`: `menu-url-invalid`, `menu-label-invalid`, `menu-label-required`, `menu-duplicate-item`, `menu-parent-missing`, `menu-cycle`, `menu-too-deep`, `menu-too-many`, `menu-placement-invalid`, `menu-delete-has-children` (an entry still has children and is absent from the payload: refused, never a silent branch delete), `menu-unknown-locale`.

**Links** (`MenuText.ValidateHref`, mirrored in both front ends): an internal path starting `/`, a `#` fragment, or an absolute `https://` URL. Refused: other schemes (`javascript:`, `data:`, `mailto:`, `http:` …), `//host`, a backslash, whitespace/control characters, userinfo, and the encoded forms of those (decoded up to three times). Never fetched by the server. A new-tab or external link carries `rel="noopener noreferrer"`. Labels are plain text (no `<`, `>`, control characters, ≤ 80), rendered as text. A link does not carry or bypass any guard: the target page decides its own access.

## 4. Freshness (Customer)

- The root layout reads the menu server-side, `no-store`, per language, for the first render (a transient failure keeps the last good copy; a first failure renders the header without a menu).
- One client `MenuProvider` keeps it current: while the tab is visible it checks every 10 s (a 304 when nothing changed), and on focus / becoming visible / navigation (≥ 1 s apart); one request at a time; the language's change aborts the one in flight; **no** `router.refresh()`, so forms, holds and sessions are untouched.
- A response replaces the menu only if it is for the language on screen and newer by the API's own clock (`generatedAtUtc`), so answers arriving out of order or after a language switch never win; a language change accepts the new language's first answer. A failed check keeps the last good menu (nothing is faked as success, nothing built-in comes back); a valid empty menu renders no navigation.
- Header layout adapts: entries are measured and the ones that do not fit go into a "···" list; labels truncate with a tooltip; the controls are never pushed off screen. The drawer scrolls.

## 5. Admin editor behaviour

Position is buttons (up/down, in/out, switch group, add child, delete), usable by keyboard and on a phone; no drag-and-drop library. The operations cannot build a cycle, a fifth level, an orphan or a silent branch delete. Bad links/labels are explained beside the field and block Save; a server refusal naming a field selects that entry. A stale save keeps the draft; "tải giá trị mới nhất" lays the operator's **content** edits (labels, links, on/off, tab) on the latest tree so another editor's changes to other entries survive; if the operator changed the structure (added, deleted, moved) the draft is kept as it is and the screen says Save will replace the server's tree. A lost answer is never retried: the screen reads the server and confirms by comparing the stored tree with what was sent. Leaving with unsaved changes asks first (tab close and in-app links).

## 6. FAQ

`/faq` renders the Riverside page's `HomeFaq` (`buildFaq`, keys `customer.faq.*`; check-in/out times from the booking system when it has them, a translated "no data" text otherwise). Title/description/heading reuse existing catalog keys (no new key, so no installed language becomes incomplete). It reads nothing about availability and creates no hold. The Riverside `#faq` section stays. CRUD of FAQ content is not in this phase.

## 7. Not done / limits

No drag-and-drop; no footer builder; no per-Property menus; no draft/publish versions; entries cannot be created by a pack; sample-template labels not natively reviewed; the old keys `customer.header.menu.*`, `customer.header.dropdownTravelers.*`, `customer.header.templatesDropdown.*`, `customer.nav.*` remain in the catalog unused (removing them would change every language's required count).
