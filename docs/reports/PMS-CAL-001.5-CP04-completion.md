# PMS-CAL-001.5-CP04 — live acceptance and closeout of the Admin Reservation Board

> Draft PR into `develop`. Docs and evidence only; no source, test, backend, schema or governance change.
> Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only). `REVIEW: NOT RUN` until Owner runs it.
> Local Development only. No Admin authentication/RBAC. This is not a public-production claim.

## Baseline

`origin/develop` = `3d7eb12b09286bbb2aa79590442f4ace69321563` (PR #71 merge). PR #71 `MERGED`, remote branch deleted, branch `test/pms-cal-001-5-calendar-live-acceptance` created from it in the single checkout. CI on the baseline (evidence from GitHub, **not** a test run of this session): run 36690121585, Frontend / Admin / Backend success.

## How the live acceptance was run

Real Chrome, Admin as a **production build** over HTTPS, real API, isolated PostgreSQL (`thebha_cp04_live`, migrated + development seed + one synthetic reservation unit; dropped afterwards). Two harness pieces live outside the tree (scratch, not committed):

- **Fault proxy** between the browser and the API. It logs every request that reaches it (method, path, POST body), forwards to the real API, and can hold one POST in one of two ways: *hold-before* (never forwarded — the request did not reach the server) or *hold-after* (forwarded, the API answers and commits, the response is withheld until the client goes away). It is the server-side request evidence; the in-page `fetch` log only proves what the client called.
- **Web proxy** that injects a small script into the HTML so a simulated `getItem` fault exists **before the app mounts** and survives a real reload. It also records per-page events (`navigation.type`, `pagehide`, `pageshow.persisted`, fetches).

Every reload below is a real `location.reload()` (`navigation.type = reload`). Requests were held by the proxy, not seeded: the write was started from the UI, the intent was read back from `sessionStorage`, and the page was reloaded while the request was pending.

## A. Smoke on the baseline (UI, one POST each, DB checked)

| # | Operation (UI) | POST at proxy | Board re-read | DB | Result |
|---|---|---|---|---|---|
| A1 | Assign unit 72…01 `[10-01,10-07)` → room 101 | 1 (201) | 1 GET | Effective 101 | PASS |
| A2 | Move dialog 101 → 102 | 1 (200), body `expectedVersion` + the segment's dates | 1 GET | old Cancelled, new Effective 102 | PASS |
| A3 | Unassign 102 | 1 (200), `expectedVersion` | 1 GET | Cancelled, no Effective | PASS |
| A4 | Block create room 201 `[10-03,10-04)` | 1 (201) | 1 GET | OperationalBlock Effective | PASS |
| A5 | Block cancel (bar → popover → dialog) | 1 (200), `expectedVersion` | 1 GET | Cancelled | PASS |
| A6 | Drag the assigned bar (real mouse drag) to room 102 | **0** at drop; dialog "Move room" opened with room 102 selected and the segment's `[10-01,10-07)` | 0 | unchanged | PASS |
| A6b | Confirm that dialog | 1 (200), version and dates from the segment | 1 GET | moved to 102 | PASS |

## B. Reload between request and answer (move, unassign, block cancel)

For each: intent found in `pendingWrites` with `inFlight`, the segment and `expectedVersion` (and both rooms for a move) while the request was held; a real reload; the new page sent only `GET properties` and `GET reservation-board` (0 POST), and the proxy shows the original POST once, "client closed at reload".

| # | Operation, fault | Reached server / committed | After reload | Result |
|---|---|---|---|---|
| B1 | Move 102→101, **hold-after** | yes / yes (DB: new segment on 101) | in-flight notice; first board read shows the destination → resolved *"An assignment matching this request … is now shown on the server"*; record and intent cleared | PASS |
| B2 | Move 101→102, **hold-before** | no / no (DB unchanged) | notice unresolved (record `move inFlight`); blocks on source 101 **and** destination 102 refused before POST; Move action disabled; room 201 not blocked; Check again = 1 GET, still unresolved. Then a real `unassign` of the source via API → *"These nights have since changed … can no longer take effect. Its own result was never confirmed."*, record cleared | PASS |
| B3 | Unassign, **hold-after** | yes / yes | source no longer matches → *"changed … can no longer take effect"*, cleared | PASS |
| B4 | Unassign, **hold-before** | no / no | unresolved; source room 101 locked, room 102 not; Unassign action disabled; then a real `move` of that segment to 102 (an assignment elsewhere) → only *"changed … never confirmed"*, **not** "observed" | PASS |
| B5 | Block cancel, **hold-after** | yes / yes | *"no longer shown at version …, the version this request targeted. That shows the schedule changed; it does not prove this request cancelled it."* | PASS |
| B6 | Block cancel, **hold-before** | no / no | unresolved; room 201 same nights refused, other nights allowed; Cancel action disabled; Check again = 1 GET, still unresolved (a GET that shows no change is not evidence of failure). Then a real cancel via API → the same "changed" wording | PASS |

In the hold-after cases the board read at load already carries the evidence, so the notice resolves before an operator can attempt anything; the lock behaviour was therefore proven on the hold-before cases. Move locks both rooms, unassign only the source, cancel the block's room and nights, matching the reconciliation rules.

## C. Storage recovery (simulated fault in a real browser)

Started from a **real** unresolved write (block create room 201 `[10-05,10-06)`, hold-before), then set the fault flag and did a real reload. This is a *simulated* `getItem` refusal for both app keys, not the browser refusing storage.

| Step | Observation |
|---|---|
| Mount with both reads refused | warning "could not read the safety records … Nothing new was sent"; no notice yet; the stored record byte-identical; 2 GETs on load (properties, board) and no further reads, no loop |
| Confirm the same block while unreadable | refused ("Nothing was sent: … could not read the safety records"), 0 requests, storage unchanged |
| Fault cleared, **no reload, no button** | same dialog confirmed again → "An earlier request … still unconfirmed", 1 board GET, 0 POST; warning gone; notice restored; intent handed over (`pendingWrites` empty, `uncertainWrites` = create 201) |
| Afterwards | room 201 same nights refused; 201 the next night and room 102 same nights not refused; Check again = 1 GET; idle for 4 s = 0 fetches; the proxy shows no POST beyond the original held one |

PASS. Not covered live: a permanently refused `sessionStorage`, a fault beginning after the page is live, and `pageshow`-restored pages with this harness (covered in earlier checkpoints and by unit tests).

## Checks (this session, `Front_End/Admin_Web`)

`npm test` 29 files / **674 passed**; `npm run lint` exit 0; `npx tsc --noEmit` exit 0; `npm run build` exit 0; `git diff --check` clean. Backend suite not re-run (docs-only checkpoint); its CI is the baseline evidence above.

## Documentation changes

`docs/project/SNAPSHOT.md` — new top paragraph and current-state fixes (PR #48–#71 merged, no open execution PR, state token, §8 objective, board is the caller of all write routes including block cancel, reload protection is same-tab only); history and SHAs kept. `docs/project/PROJECT_BIBLE.md` — Admin Web is no longer described as fully mock, and CURRENT gains drag-to-dialog and same-tab reload protection.

## Limits and residual risks

- UI_LIVE is **PARTIAL overall**: A–C are proven above; the fault proxy and script injection are simulations of network loss and a storage read failure, so "the browser itself refuses storage" and cross-tab, other-device and closed-session cases are not verified. Same-tab only; no server idempotency.
- The proxy log proves what reached the fault proxy, and the DB proves what committed; the API's own request log was not used.
- Not done: Admin authentication/RBAC, public deployment, lifecycle/payment, split/swap/batch, OperationalBlock move/split, OTA.
- No product defect was found; nothing was fixed. `diagnosing-bugs` and Graphify not used.

## Cleanup

API, Next server and both proxies stopped, `thebha_cp04_live` dropped, credentials file shredded, Chrome tab closed. Other databases and the Postgres container untouched. No source or test file changed.

## Review

`REVIEW: NOT RUN`. Owner must run `/codex:review --base origin/develop` on the pushed head.
