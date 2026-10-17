# CUST-WEB-SOCIAL-001-CP01 — floating contact actions

The site owns one `WebsiteSocialSettings` row. Admin reads and atomically saves the whole row with an expected revision; public reads return only enabled destinations. Migration 14 seeds Phone on (`0899474888` / `tel:+84899474888`), Messenger and Zalo off/empty, and Back to top on. Startup never re-seeds it.

The API, not either browser, normalizes Vietnamese `0…` / `+84…` numbers. It constructs `tel:` and `https://zalo.me/…`; Messenger accepts only HTTPS `m.me/<page>` or `(www.)messenger.com/t/<id>` chat paths. It makes no external verification request.

Customer mounts one widget in the root layout. It reads immediately and every 10 seconds while visible, retains the last successful revision on failure, and rejects older responses. Phone opens an accessible local popover; Messenger/Zalo are safe new-tab links; Back to top appears only above 400 px and respects reduced motion. Mobile bottom offsets clear FooterNav or the room booking bar.

Admin route `/website/social-media` stays behind the existing Staff session and `WebsiteSettingsManage` gate. One Save uses the shared pending-write/logout and uncertain-result controls; stale revision returns 409 without dropping the draft.
