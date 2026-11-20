# ADR 0011: One activity stream per Admin menu and per-Staff unseen badges

- Status: Proposed (work item `BHA-ADMIN-BADGE-001-PR01`, 2026-11-20). Waiting for Owner acceptance. **Nothing below is implemented** except where a section says "exists". It is not `Accepted` until Owner says so.
- Date: 2026-11-20
- Related: ADR 0007 (Staff identity, Property memberships), ADR 0008 (global website permission), ADR 0009 (per-Property promotion permission), ADR 0010 (global Blog permissions). This ADR adds **no permission, role or Staff column** and amends none of them: every permission below is read from the code that exists today.

## Context

`BHA-NEWSLETTER-BADGE-001` (PR #136, merged) gave the Newsletter menu a per-Staff "unseen" badge. The Owner (2026-11-20) wants the same for every Admin menu that matters, with the rules in §Product rules. What exists, verified in source:

- **Tables** (migration 25): `MenuActivityStreams(MenuKey PK, LastSequence)`, `NewsletterVerificationActivities(Sequence PK, SubscriptionId FK **cascade**, OccurredAtUtc)` and `StaffMenuSeen(StaffAccountId, MenuKey PK; LastSeenSequence; FK to the stream Restrict, to `StaffAccounts` cascade)`.
- **One recorder**: `NewsletterActivityLog.RecordVerifiedAsync` takes the next number with `UPDATE "MenuActivityStreams" … RETURNING` and inserts in the same transaction as the verification. The counter row stays locked until COMMIT, so numbers commit in the order given, and "everything up to N is committed" is true for a reader that sees N. Its lock order is subscription, mails, then the counter row.
- **Count by rows**: `MenuUnseenService` counts `count(*) where Sequence > cursor` and reads counter, cursor and count in one statement. `MarkSeenAsync` is one `INSERT … ON CONFLICT DO UPDATE` with `GREATEST`, refused above the counter.
- **API** (`AdminWebsiteMenuUnseenController`): `GET /api/admin/v1/website/menu-unseen` → `{ newsletter: { count, lastSeenWatermark, currentWatermark } }`; `POST …/menu-unseen/{menuKey}/seen { viewWatermark }` → 200, `400 menu-unseen-watermark-invalid`, `404 menu-unseen-unknown-menu`. **Both carry `StaffWebsitePermission(WebsiteSettingsManage)`**, and `MenuUnseenKeys.IsKnown` accepts only `newsletter`.
- **Live**: `NewsletterLiveHub` is a server-to-client pipe for one message (`newsletterVerified`), authorized at connect and again at every send, with in-process connections (no backplane).
- **Admin_Web**: `NewsletterBadgeProvider` mounts once in the layout; the count comes from the API (SignalR is a hint, polling every 30 s, BigInt comparison, answers older than the applied one are dropped, a new generation per Staff identity). The sidebar shows `99+` on the Newsletter item and a **dot** (not a number) on the parent.

What blocks generalising it as is:

1. A Blog-only Staff or a Promotions Manager gets 403 from `menu-unseen`, because the route needs `WebsiteSettingsManage`.
2. Promotions and Calendar live under `/properties/{propertyId}/…`, Catalog under `/catalog`; `/website` does not fit them.
3. `StaffMenuSeen` has primary key (Staff, MenuKey); it cannot hold a per-Property cursor without a new table.
4. `StaffCalendarModeGuard` opens a route in `Staff` mode only for `StaffCalendarPermissionAttribute`, `StaffWebsitePermissionAttribute`, the Newsletter hub marker or the three session actions. There is no session-only marker, and a cross-menu read has no single permission.
5. Deleting a subscription deletes its activity (cascade), which contradicts rule 3 below.
6. The Calendar segment id is **not** a stable identity: `AssignmentMutationStore` supersedes the old segments and creates new ones with `Guid.NewGuid()` on move and split.
7. `UseNpgsql` is configured without `EnableRetryOnFailure`; the Blog posts service and the Newsletter admin service already wrap writes in `Database.BeginTransactionAsync`. Other services, including Catalog, Promotions, Hero and Menus, were not read for their transaction use and are PR-6 to PR-12 work (see Rollout).

## Product rules (decided by the Owner; not reopened here)

1. Every Staff has a number per menu: events by **other** people after the Staff's own "seen" point; their own actions do not count.
2. Add, edit, delete and publish all count, **by event**: editing a post five times is 5.
3. Add then delete keeps every event and stays viewable; each event keeps a safe title snapshot and does not depend on the object existing.
4. A parent menu shows the **real sum** of the children the Staff may see, never a sum of formatted `99+` strings. Dashboard, Forms, Tables, Charts and UI Elements (template) have no badge.
5. Clicking the badge opens the unseen list and does **not** mark anything seen. At most 50 newest entries, grouped by person and object; when more exist it says `50+` and links to history. A number is acknowledged only after the menu page loaded its data successfully, with the watermark tied to the data it read.
6. One Save-then-Publish click on the Blog with the same `correlationId` is one aggregate event; `BlogAudits` still records every operation. A failed publish leaves the saved event in place.
7. Calendar is the exception: its number counts **unread bars/objects**, not mutations; another person's change highlights the bar in one fixed colour; opening the page does not acknowledge the board; clicking exactly one bar acknowledges the version of that bar that was observed.
8. Newsletter moves to the shared standard in PR-14; Admin add and delete create events then.
9. History is kept long term, with no retention job. A new menu starts at 0 when its recording is activated; no arbitrary backfill.

Defaults taken from the plan (assumptions, change them by amending this ADR): the sidebar keeps `99+` and the list window uses `50+`; a bulk picture upload is **one** event whose item count is the number of pictures; `correlationId` merges only the Blog save-then-publish chain in this phase.

Out of scope and not to be reinterpreted: counting objects on every menu, recording only "important" events, acknowledging on badge click, a bell or e-mail notification, or any other messaging system.

## Decision

### A. Model and invariants (proposed; migration in PR-2)

- **`AdminActivities`** (append-only). Primary key `(MenuKey, Sequence)`; `Id uuid` unique. Columns: `PropertyId uuid NULL` (set only for Property-scoped menus; FK `Restrict` to `Properties`), `ActorKind` (`Staff` | `Public` | `System`), `ActorStaffId uuid NULL` (FK `Restrict` to `StaffAccounts`; CHECK `ActorKind = 'Staff'` ⇔ not null), `Action`, `EntityKind`, `EntityKey varchar(80)` (a canonical lower-case GUID, or a fixed token for a singleton such as the Blog settings), `TitleSnapshot varchar(200)`, `ItemCount int NOT NULL DEFAULT 1` (CHECK ≥ 1), `CorrelationId uuid NULL`, `OccurredAtUtc`. **No foreign key to any content table and no cascade on an object**: deleting a post, a subscription or a bar cannot remove its activity.
- **Counters**: `MenuActivityStreams` is reused unchanged. Sequences are **per menu**, never global. PR-2 seeds one counter row (`LastSequence = 0`) for each new menu key; a key with no counter row is refused by the recorder (the existing "must not commit what cannot be counted" rule). The `newsletter` row already exists and is not re-seeded.
- **Cursors** (all additive; `StaffMenuSeen` is unchanged):
  - `StaffMenuSeen` keeps serving the **global** menus.
  - `StaffMenuPropertySeen(StaffAccountId, MenuKey, PropertyId, LastSeenSequence, UpdatedAtUtc)`, primary key the first three columns, for `promotions`. A per-Property cursor cannot be added to `StaffMenuSeen`'s key, so it is a separate table.
  - `StaffEntitySeen(StaffAccountId, PropertyId, EntityKind, EntityKey, LastSeenSequence, UpdatedAtUtc)` for **Calendar only**.
  - Every cursor only moves up (`GREATEST`), is never read from or written for another Staff id, and a Staff with no row counts from the baseline (open decision OPEN-2).
- **Watermarks** are the stream's `Sequence`, a `bigint`, and travel as **decimal strings** (validated as `^(0|[1-9][0-9]*)$`, like today); a JavaScript client compares them as `BigInt`, never as `Number`, never by time.
- **Numbers and the count**: the recorder takes the next number with `UPDATE "MenuActivityStreams" … RETURNING` **inside the business transaction** and keeps the row locked to COMMIT; the insert is in the same transaction, so a rollback leaves neither the number nor the activity. The unseen number is always a **row count** (`count(*) where Sequence > cursor …`), **never `current − lastSeen`**: gaps already exist (the Newsletter cascade removed rows) and must stay harmless.
- **Recorder**: an explicit `IAdminActivityRecorder` in Application, implemented in Infrastructure beside `NewsletterActivityLog`. A write service calls it **by name** at the end of its own transaction, after its business writes and its audit row, as the **last statement before COMMIT** and the last lock it takes. It requires an open transaction and throws without one (an autocommit insert would lose the atomicity). **No middleware or filter records activity**: only the service knows the object, its safe title and whether the operation really committed. If `EnableRetryOnFailure` is ever turned on, every caller must run the transaction inside the execution strategy, as any `BeginTransaction` already needs.
- **Audit and activity are different records**: `BlogAudits`, `RoomOccupancySegmentAudits` and the other audits are the business trail; `AdminActivities` feeds badges and history. Both are written in the same transaction, neither is derived from or repairs the other.
- **Actor** comes only from the verified Staff session (`ActorStaffId` of the authenticated principal); no request field can name it. Events that no Staff caused (the guest who verifies a Newsletter subscription, a system job) are `Public`/`System` with a null Staff id and **count for every Staff**; no fake Staff is invented, including for history that already exists.
- **Safe snapshots**: the caller composes `TitleSnapshot` from a short allow-list per menu (post title, category name, picture title, banner title, language name, currency code, menu label, network name, promotion name, property or room-type name; Calendar: room label and dates; bulk upload: `ItemCount`). It never contains guest names, e-mail, phone, notes or reservation codes, and never a secret. Newsletter snapshots carry no address ("a subscription"); the sender settings record a generic notice only. The text is trimmed, control characters removed, capped at 200, and rendered as text, never HTML.
- **Indexes** (proposed): `(MenuKey, PropertyId, Sequence)` for count and list; `(MenuKey, EntityKind, EntityKey, Sequence)` for grouping and Calendar; a partial unique index `(MenuKey, CorrelationId, Action) WHERE CorrelationId IS NOT NULL` as a backstop (§D).

### B. Proposed HTTP contract (none of it exists yet)

**Prefix.** The source does not support `/api/admin/v1/website` for all menus (item 2 above), and a `website` path implies the website permission. The shared routes use **`/api/admin/v1/menu-unseen`** (and `/api/admin/v1/activity`). This is a technical choice, not an Owner decision. The existing `/api/admin/v1/website/menu-unseen` routes stay **unchanged** (same shape, same `WebsiteSettingsManage` boundary) until PR-14 removes them, after an Admin build that no longer calls them has been deployed. Until PR-14 the new routes serve `newsletter` from the legacy tables (same entry shape), so one provider can read everything.

**Boundary.** A new marker `StaffSessionAttribute` (proposed, PR-3) opens a route in `Staff` mode with HTTPS only, a valid Staff session (else 401) and the request boundary (Origin 403, JSON 415 on a write), `no-store`, and **no permission**; permission is decided in the service per menu, from the database, on every request (no cache, nothing from the cookie). `StaffCalendarModeGuard.IsOpenInStaffMode` learns this marker explicitly, never a prefix. In `LocalGate` the routes are closed (404) and the Calendar shows no badge.

| Route | Purpose |
| --- | --- |
| `GET /api/admin/v1/menu-unseen` | `{ menus: { "<key>": entry } }`. Global entry: `{ count, lastSeenWatermark, currentWatermark }`. Property-scoped entry (`promotions`, `calendar`): `{ count, byProperty: [{ propertyId, count, lastSeenWatermark, currentWatermark }] }` where `count` is the sum of `byProperty`. A menu or Property the Staff may not read is **absent**, never shown as 0. `newsletter` is a top-level key of `menus`, present only when permitted. One statement, one snapshot; never writes. |
| `GET /api/admin/v1/menu-unseen/{menu}/changes?propertyId=` | The unseen list: at most 50 **groups**, `hasMore`, `unseenEvents` (exact row-level count, same snapshot), `lastSeenWatermark`, `snapshotWatermark`, and the scope (`menu`, `propertyId`). Never writes. `snapshotWatermark` is informational: the popover is not a menu page load and never POSTs it. |
| `POST /api/admin/v1/menu-unseen/{menu}/seen` | `{ viewWatermark: "<decimal string>", propertyId? }` → atomic upsert with `GREATEST`; never moves back; **never acknowledges a newer mark on its own**. 200 returns the entry after the move. |
| `GET /api/admin/v1/activity?menu=&propertyId=&actorStaffId=&from=&to=&limit=&cursor=` | History, newest first. |
| `POST /api/admin/v1/menu-unseen/calendar/entities/seen` | `{ propertyId, entityKind, entityId, observedWatermark }` for one Calendar object. |

Rules shared by the routes:

- **Errors**: no session → 401; a menu that is unknown **or that the Staff may not read** → 404 `menu-unseen-unknown-menu` (anti-disclosure: the two look the same); a Property of a Property-scoped menu where the Staff has no membership → 404 as well; watermark not a plain non-negative integer, or above the menu's counter, or a malformed `limit`/`cursor` → 400 (`menu-unseen-watermark-invalid` stays); `propertyId` missing for a Property-scoped menu or present for a global one → 400. A refused watermark is never clamped to "everything so far". `POST /api/admin/v1/menu-unseen/calendar/seen` (the menu-level route) answers 400 `menu-unseen-use-entity-seen`: opening the page never acknowledges the board.
- **StaffId** is always the authenticated one; no request names another member.
- **A watermark belongs to the data it came with.** Every list a menu page loads must return `viewWatermark` from the **same snapshot** as its rows (the Newsletter precedent: REPEATABLE READ or one statement), and the page acknowledges that value unchanged. A watermark taken from an independent query made later and applied to older data would acknowledge events the Staff never saw. A page that loads several endpoints acknowledges the **minimum** of their watermarks. Those list-endpoint changes belong to the backend PRs (6, 8, 10, 11, 12), not to this ADR's PR. Acknowledging means "the menu page loaded", not "every object was displayed" (filters and paging are the screen's business).
- **History** needs one menu per query (`menu` is required): sequences are per menu, so a cross-menu list cannot be ordered by sequence. Order is `Sequence` descending; the cursor is opaque, carries the menu and Property and the last `Sequence`, and a cursor presented with different filters is a 400. Date and actor filters are `WHERE`, never ordering. History shows every event including the Staff's own (only the badge excludes own events), under the same read permission as the menu.

### C. Permissions and Property scope (read from the code; no new permission)

"Read" is the permission that opens the menu's own page and is also the permission for its count, unseen list, history and acknowledgement.

| Menu key | Sidebar entry (today) | Scope | Read / count / history / ack | Events recorded from (existing permission) |
| --- | --- | --- | --- | --- |
| `blog-posts` | Website › Blog: Bài viết | global | `BlogAccess` (`CanEditBlog` or `CanPublishBlog`) | `BlogEdit`: create post or translation, save draft, restore a revision; `BlogPublish`: publish, unpublish, archive, unarchive |
| `blog-categories` | Website › Blog: Chuyên mục | global | `BlogAccess` | `BlogPublish`: category create, save, delete, pins |
| `blog-media` | Website › Blog: Thư viện ảnh | global | `BlogAccess` | upload (`BlogAccess`, bulk upload = one event), save (`BlogEdit`), delete (`BlogPublish`) |
| `blog-settings` | Website › Blog: Cấu hình | global | `BlogAccess` | `BlogPublish`: settings save |
| `website-hero` | Website › Banner trang chủ | global | `WebsiteSettingsManage` | same permission |
| `website-menus` | Website › Menu | global | `WebsiteSettingsManage` | same |
| `website-languages` | Website › Ngôn ngữ & bản dịch (languages **and** language packs) | global | `WebsiteSettingsManage` | same |
| `website-translations` | Website › Bản dịch | global | `WebsiteSettingsManage` | same |
| `website-currencies` | Website › Tiền tệ & tỷ giá | global | `WebsiteSettingsManage` | same |
| `website-social` | Website › Social media | global | `WebsiteSettingsManage` | same |
| `newsletter-sender` | Website › Cấu hình email gửi | global | `WebsiteSettingsManage` | same (generic notice only) |
| `newsletter` | Website › Đăng ký nhận tin | global | `WebsiteSettingsManage` | verification by a guest (`Public`); from PR-14 also Admin add, update and delete (`Staff`) |
| `promotions` | Ưu đãi đặt phòng (top level) | per Property | `PromotionManage` for that Property: `Manager` only (ADR 0009) | same, per Property |
| `catalog` | Cơ sở & loại phòng (top level) | **global** | `WebsiteSettingsManage` | same. Its routes carry `propertyId`, but every Catalog admin action checks the global permission and ignores memberships, so Catalog is **not** Property-scoped |
| `calendar` | Calendar (top level) | per Property | `BoardRead` for that Property: `FrontDesk` and `Manager` | `AssignmentWrite`, `BlockWrite` (`FrontDesk`, `Manager`) |

- The global Website and Blog permissions are not Property permissions, and a Property role never grants them (ADR 0008, ADR 0010). A Manager of one Property gets no Blog or Website number from being a Manager.
- **Filter on the server, before everything else.** The set of permitted menus and Properties is computed from the database per request (`HasGlobalPermissionAsync`, memberships), and the single SQL applies it **before** `COUNT`, `LIMIT`, `GROUP BY`, the cursor, the sums and the totals. A Property or menu the Staff may not read contributes neither a number nor a title.
- Example: Manager at Property A and FrontDesk at Property B → `promotions` counts A only; `calendar` counts A + B.
- **Switching Property in the UI.** The sidebar number of a Property-scoped menu is the sum over **every Property the Staff may read**, and `byProperty` feeds a per-Property count beside the Property selector. An acknowledgement is **per Property**: opening Property A acknowledges only A's cursor with the watermark A's list returned, so unseen events of Property B stay unseen. The number shown is exactly what the cursors leave unseen.
- **Session changes.** The provider is keyed by Staff id; a new identity, sign-out or unmount starts a new generation and drops everything on the wire (the existing rule). A lost permission removes the menu from the next `GET` and the sidebar renders only the keys present, so the previous Staff's state is never shown to the next one; a 401 ends the session as every other 401 does.

### D. Correlation, grouping, consistency

- **Append-only.** An event row is **never updated in place**. Publishing inserts its **own** row with a **new** sequence and the same `CorrelationId` as the save it follows. Updating the saved row without a new number would let a Staff who acknowledged the draft at sequence 10 miss the publish; bumping the old row's number would reorder history and move rows between pages. Append-only keeps sequences immutable and keyset pages stable.
- **Count** = `COUNT(DISTINCT COALESCE(CorrelationId, Id))` over **other people's** rows above the cursor. A Staff who acknowledged the draft (10) and then sees the publish (12) counts 1; a Staff who saw neither counts 1 (rows 10 and 12 share one `CorrelationId`).
- **Where the id comes from**: the browser generates one `uuid` per click that starts a chain and sends it on **every** request of that chain as the optional header `X-Admin-Correlation-Id` (a header, so no Blog body contract changes; the credentialed Admin CORS policy must list it in its allowed headers, a PR-6 task). Create-then-publish of a new post is the same chain and merges too.
- **When rows merge.** The recorder keeps the id only if an earlier row of the same menu with the same `CorrelationId` has the **same actor, the same entity and an action of `Created` or `DraftSaved`**, and the new action is `Published`. In any other case it stores `CorrelationId = NULL` for the new row (it is then counted on its own); the business operation never fails because of it. The prior-row check runs **after** the recorder took the counter row, so two requests carrying the same id are serialised; the partial unique index is only a backstop. Reusing an id can therefore never merge unrelated rows, and it is **not** an idempotency key: `expectedVersion` stays the business idempotency, and a stale retry fails with its 409 before it reaches the recorder.
- **Failed publish**: the save committed in its own transaction, so its row stays; the failed publish wrote nothing.
- **The limit of 50 applies to groups** (actor + object), ordered by each group's newest sequence, fetched as 51 to decide `hasMore`. A group is never cut. The badge counts **events**; the list shows **groups**, each with its logical-event count (rows merged by correlation count once), so the groups' counts add up to `unseenEvents` unless `hasMore`; when it is true, `unseenEvents` is returned as the total and the sum of the visible groups is never presented as that total. For `calendar` the list groups by object only (several actors listed).
- **Calendar objects.** The identity of a bar is the **object**, not the segment: `ReservationUnitId` (kind `reservation-unit`, covers assigned and unassigned ranges) or `RoomBlockId` (kind `room-block`), because moves and splits create new segment ids. All segments of one unit are one object. Consequences: several mutations of one bar are one unread object; an object that was split or moved keeps its read state; clicking any segment of a split unit acknowledges the unit.
- **Calendar read state.** The existing board read (additive change, PR-12) returns per object `activity: { unread, watermark }` computed in the **same snapshot** as the board. Clicking a bar sends that bar's `watermark` as `observedWatermark`; the cursor moves up to it with `GREATEST`, refused above the counter, so a change that arrives after the snapshot has a higher sequence and stays unread. The count is `COUNT(DISTINCT object)` with another person's event above that object's own cursor. A Calendar snapshot holds a room label and dates, never a guest name.
- **Lock order and contention.** The recorder is last. In Calendar writes it takes the `menu` counter after the existing advisory locks and row locks (`AdvisoryLockCoordinator`); the counter row is then a serialisation point **across Properties**, held only for the tail of the transaction. This is accepted for now and measured in PR-12; the escape hatch is one counter row per Property (`calendar:{propertyId}`), which the per-Property cursors already tolerate.

### E. Rollout, realtime, compatibility

- **SignalR is only a hint** to refetch; the API is the source of every number. Polling and reconnect catch-up stay (30 s while visible, on focus, after reconnect). The hint is sent **after COMMIT**, carries only `{ menuKey, propertyId? }` (no title, no count, no actor), and the broadcaster re-authorises every connection for that menu or Property at every send, as `NewsletterLiveBroadcaster` does. The Newsletter hub keeps its own message until PR-14. Connections are in-process: with several API instances a hint reaches only the connections on the instance that committed, and polling makes up the rest; this is recorded as a limit and **no Redis backplane or outbox is built here**.
- **Registry and provider.** One Admin registry holds, per menu key, the label, path, scope and badge flag, and one provider reads `GET menu-unseen`. Adding a registry row does not create a recorder or a backend permission: each menu still needs its explicit recorder call and its permission check.
- **Sidebar**: a parent shows the **sum of the real numbers** of the children the Staff may see, formatted to `99+` only after summing; the entry keeps the real number in its accessible label (today the parent shows a dot, which the number replaces). Blog items are children of Website; Catalog, Promotions and Calendar are top level.
- **Migrations** are additive, each `Down` refuses while any activity, cursor or moved counter exists (as migration 25's does). Deploy order is database → API → Admin, and every PR leaves the application running.
- **Newsletter cutover (PR-14, last).**
  - Semantics change: today a deleted subscription removes its count; afterwards the event stays counted until seen (rule 3). Record it in the PR.
  - The `newsletter` counter row is reused and rows are copied **with their existing `Sequence`**, so there is no rewind or collision and every existing cursor stays valid.
  - Because the rollout order lets the old API binary keep writing the legacy table after the copy, PR-14 is delivered as two deployable steps: (1) the new API **dual-writes** (same number into both tables) and an idempotent copy (`INSERT … ON CONFLICT DO NOTHING`) brings the old rows over; (2) after the new API owns writes, a second run closes any gap and reads switch to `AdminActivities`. Verified rows that arrive exactly during the switch are covered by the idempotent copy; no row is counted twice, none is skipped. The legacy table is kept for one more release.
  - Legacy rows have no Staff actor and become `ActorKind = 'Public'` (the guest verified through an e-mailed link). **History deleted by the old cascade cannot be recovered and no actor is guessed**; only rows that still exist are copied. This is a stated limit, not a promise to rebuild history.
- **Risks, with no new infrastructure now**: contention on the per-menu counter (above), and permanent history growth. Measure rows per day and the unseen query plan when a menu goes live; retention stays an open Owner item.

### F. Roadmap

Sizes in the plan are estimates; none was inventoried here, and a PR may exceed its estimate with a short reason.

| PR | Scope | Depends on |
| --- | --- | --- |
| 1 | This ADR (docs only) | none |
| 2 | Recorder, model, migration (tables, cursors, counter rows, guarded `Down`) | 1 |
| 3 | API: read, changes, seen, activity; `StaffSessionAttribute`; hint | 2 |
| 4 | Admin registry, shared provider, sidebar sums | 3 |
| 5 | Unseen popover and history screen | 3, 4 |
| 6 | Blog backend: recorder calls, `viewWatermark` on lists, correlation header | 3 |
| 7 | Blog frontend | 4, 6 |
| 8 | Website backend (hero, menus, languages and packs, translations, currencies, social, newsletter-sender) | 3 |
| 9 | Website frontend | 4, 8 |
| 10 | Promotions backend and frontend | 4 |
| 11 | Catalog backend and frontend | 4 |
| 12 | Calendar backend (objects, board `activity`, entity acknowledgement) | 3 |
| 13 | Calendar frontend (highlight, per-bar acknowledgement) | 4, 12 |
| 14 | Newsletter cutover, last | 2–5 |

Menu keys (fixed): `blog-posts`, `blog-categories`, `blog-media`, `blog-settings`, `website-hero`, `website-menus`, `website-languages`, `website-translations`, `website-currencies`, `website-social`, `newsletter-sender`, `newsletter`, `promotions`, `catalog`, `calendar`.

## Open decisions (Owner)

- **OPEN-1 — Calendar objects that vanish.** A cancelled block, or a cancelled reservation, leaves no bar to click, so its unread state could never be acknowledged. Options: **(a)** count only objects still on the board and keep the rest in history only (simple; a cancellation by someone else stops being noticed in the badge); **(b)** keep vanished objects in the popover with a per-item "mark seen" action that acknowledges only that object, with the watermark of that list (one more action; the rule "only an explicit click acknowledges" holds; the popover is no longer purely read-only); **(c)** treat an object as seen when it vanishes (nothing to manage; a cancellation is never noticed). **Recommendation: (b).** Whether a past object (range already ended) still counts is a sub-question; recommendation: no date limit in the first release, revisit if it is noisy.
- **OPEN-2 — Baseline of a Staff with no cursor.** Today the Newsletter counts from 0 (everything since activation). Options: **(a)** keep it (a new Staff starts with everything recorded since the menu was activated, which can be large on Calendar); **(b)** count only events at or after the Staff account's creation (`StaffAccounts.CreatedAtUtc`, no write needed). **Recommendation: (b)**, applied to every menu including the Newsletter at PR-14, where it changes only Staff created after activation.

Until the Owner decides, the PRs must not implement either option beyond what the recommendation says; the ADR stays `Proposed`.

## Consequences

- A Staff sees only numbers of menus and Properties they may read; the number is never a derived difference and survives a deleted object.
- Activity rows accumulate forever; there is no retention job, no per-notification table and no new infrastructure.
- Every future menu costs one counter row, one registry row, one explicit recorder call and one permission mapping; none is automatic.
- Calendar needs three things the other menus do not: an object identity that survives moves, a per-object cursor, and a board read that reports its own watermark.
- The Newsletter keeps working unchanged until PR-14; its history lost to the old cascade stays lost.
