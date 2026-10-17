# CUST-WEB-SOCIAL-001-CP01 completion

## Scope delivered

- One revisioned WebsiteSocialSettings row and migration 14. The migration seeds Phone on (0899474888 / tel:+84899474888), Messenger/Zalo off and empty, Back to top on. Application startup does not reseed.
- Staff WebsiteSettingsManage Admin editor at /website/social-media; public GET returns enabled destinations only.
- One root Customer widget with fixed Phone → Messenger → Zalo order. Phone is a click popover with an explicit tel: link. Messenger and Zalo are safe new-tab links. Back to top is separate, appears only after 400 px, and respects reduced motion.
- Server-side VN phone normalization and exact HTTPS Messenger host/path validation. No external destination verification is performed.

Messenger and Zalo remain disabled pending Owner-provided destinations. The application verifies URL/number format only; it does not confirm that an external account exists or belongs to The BHA.

## Automated checks

Recorded on final source before documentation-only handoff update:

- Backend: restore PASS; Release build PASS (one nullable warning in the unchanged WebsiteTranslationsApiTests.cs). Full PostgreSQL suite after adding LocalGate/Origin/HTTPS boundary coverage: 543 unit + 1,083 integration PASS. Targeted WebsiteSocialApiTests: 6/6 PASS.
- Admin_Web: tsc, ESLint, Vitest 1,948/1,948, and Next production build PASS; /website/social-media is included. Social settings API tests verify revision parsing, 409 stale response handling, and a lost response becoming unverified after one request.
- Customer_Web: tsc, next lint, Vitest 1,297/1,297, and production build PASS.
- Browser responsive matrix after final frontend build: PASS at CSS viewport widths 375, 768, and 1440, in light and dark mode on home, FAQ, and room-detail routes respectively; the 375 room-detail run used real Riverside/RoomType data. Each run asserted one widget, Vietnamese label, 44×44 hit area, and button bounds within the viewport.
- `git diff --check`: rerun at final handoff.

## Browser evidence

Production builds were served locally with the HTTPS API and isolated PostgreSQL database. Customer and Admin were tested in Chrome with browser security enabled, through configured HTTPS origins. The API accepted no real external call and the browser did not send a message.

- Customer /faq: initial scroll hides Back to top; scrolling beyond the threshold reveals it; clicking returns to scrollY=0 with the same route. Phone opens only on click and exposes 0899474888 with tel:+84899474888.
- A fixture update changed phone while the popover was open and enabled Messenger/Zalo. Within 11.5 seconds, the popover updated to 0912345678 / tel:+84912345678; Messenger became https://m.me/thebha; Zalo became https://zalo.me/0899474888; links used _blank and noopener noreferrer. Turning all contact channels off left only Back to top.
- Admin Staff login and Website gate worked. An invalid m.me.evil value showed a field error and did not save; Cancel discarded the draft. One valid combined Save updated all destinations atomically, reload read the saved row, and API restart preserved it. The final DB fixture was restored to seed settings.
- At 375 px with real room data, Phone was at y=753 (44×44), the fixed mobile booking bar began at y=824, and FooterNav was absent on the room route. The widget did not overlap that bar. The 375/768/1440 viewport runs also verified that the floating button stayed inside the CSS viewport in light and dark mode.
- Screenshots: [home mobile](evidence/CUST-WEB-SOCIAL-001-CP01/customer-home-mobile.png), [FAQ desktop](evidence/CUST-WEB-SOCIAL-001-CP01/customer-faq-desktop.png), [real room mobile](evidence/CUST-WEB-SOCIAL-001-CP01/customer-room-mobile.png), and responsive light/dark samples [375](evidence/CUST-WEB-SOCIAL-001-CP01/customer-375-light.png), [768](evidence/CUST-WEB-SOCIAL-001-CP01/customer-768-dark.png), [1440](evidence/CUST-WEB-SOCIAL-001-CP01/customer-1440-light.png).

The isolated browser DB only exposed Vietnamese as an active locale, so live browser screenshots for English/French were not available. Unit tests cover the three locale-specific action-label sets. The room/home screenshot fixture also lacks much of the site's regular translation dictionary, so untranslated content keys are visible; this is a test-data limitation and the widget-specific Vietnamese label is present. The current home and FAQ content also has horizontal overflow at the measured 375/768 CSS widths (document widths 404/860 px); the floating widget itself remains within the viewport. Fixing unrelated page-content overflow is outside this work item.

The `m.me/thebha` URL above was only a syntactically valid test fixture used to verify rendering and safe-link attributes. It was not provided by the Owner or checked against Facebook; do not treat it as The BHA's destination. Messenger and Zalo remain disabled in the persisted demo settings.

## Review and delivery

- Branch: feature/cust-web-social-001-cp01-floating-contact-actions
- Base: develop at 6cb2cb247a257980dde467899ae6cae3349a2a4f
- Start HEAD: 6cb2cb247a257980dde467899ae6cae3349a2a4f
- Validation HEAD / final HEAD: record after final commit.
- Draft PR: record after creation.
- CI: record after the final PR head completes.

Owner setup steps: open Admin → Website → Social media. For Messenger, use the Facebook Page's real username and https://m.me/<username-cua-trang>; do not use its display name. Open the destination yourself, then enable and Save. For Zalo, enter the number linked to the account that should receive contacts, test its generated zalo.me link, then enable and Save.

Status: implementation and local checks complete; Draft PR CI and Owner product/diff review remain.
