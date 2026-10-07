# Control Tower closure input — FE-001

Use this report to make the final closure decision for `FE-001` and select the
next controlled work item. Do not ask the executor to change code from this
report.

## Status requested

**STATUS: PASS — recommend closing FE-001**

- Repository: `emLamHD/The_BHA_hotels_Booking`
- Integration branch: `develop`
- Verified `develop` HEAD: `e5d8b218ba6326a22b56b8a7999d0ffd66ef148e`
- Open pull requests: none
- Remaining remote branches matching `feature/fe-001-*`: none

The owner merged PR #21 and deleted its local and remote feature branch. A
post-merge comparison confirms that `develop` is identical to merge commit
`e5d8b218...`.

## Delivered work

| Work unit | Outcome | Pull request | Merge commit |
| --- | --- | --- | --- |
| `FE-001.1` | Shared Axios foundation, environment validation, credentialed requests, RFC 7807 error normalization, cancellation, and live Property UI on `/home-2` | [#17](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/17) | `2e76467c2335dba7b5e131170adc241576bcf022` |
| `FE-001.2` | Live Property-scoped RoomType catalog using real backend IDs and API data, template-derived cards, honest media fallback, and isolated loading/empty/error/retry behavior | [#18](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/18) | `3da0901c359669f8ee21e6ed2a9bed4be130f813` |
| `FE-001.3` | Live Availability search with real RoomType/RatePlan offers, server nightly prices/totals/currency, structural validation, retry, cancellation, and stale-response protection | [#19](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/19) | `3a150b2030285cdded80bee3a86252468d6d2c27` |
| `FE-001.4` | Live 15-minute Booking Hold creation from a selected offer, CSRF and idempotency contracts, exact retry after uncertain outcome, memory-only guest token/session ownership, synchronized Hold/Availability state, PII scrubbing, and server-backed success/replay summary | [#21](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/21) | `e5d8b218ba6326a22b56b8a7999d0ffd66ef148e` |

Supporting prerequisite:

- `CT-CONTRACT-002`, merged through
  [PR #20](https://github.com/emLamHD/The_BHA_hotels_Booking/pull/20) at
  `bd68666f41fc5733342640ce7199e8711ef33eb4`, stabilized the antiforgery
  Problem Details discriminator required for FE-001.4's single safe CSRF
  refresh retry.

## Final verified behavior

- `/home-2` consumes live Property, RoomType, Availability, CSRF, and Booking
  Hold endpoints; fake listing data is not used for the delivered business
  flow.
- Availability uses real Property/RoomType/RatePlan identifiers and preserves
  server-authoritative nightly prices, totals, inventory, and currency.
- Hold creation sends only the allowed request fields, one caller-owned
  Idempotency-Key, and the required CSRF header.
- A definitive `201 Created` or exact-replay `200 OK` renders a server-backed
  Hold summary.
- An uncertain transport outcome permits only an explicit exact retry with the
  original body and key.
- Hold creation and Availability actions are synchronously serialized so
  same-tick stale-render races cannot create a second attempt or search against
  an obsolete offer.
- The active session and unresolved attempt survive ordinary client navigation
  for the mounted application lifetime without browser storage.
- Contact PII, obsolete offer data, attempt data, and errors are scrubbed after
  definitive success; raw CSRF, idempotency, and guest-access tokens are not
  rendered, logged, placed in URLs, or persisted in browser storage.

## Verification baseline

- Frontend: lint clean, TypeScript clean, production build passed, `222/222`
  tests passed across 18 files.
- Backend regression: Release build passed with zero warnings/errors;
  `494/494` PostgreSQL-backed tests passed (`241` unit + `253` integration).
- Database: six migrations unchanged; no pending EF model changes.
- Final PR scope/secret/generated-artifact checks passed.
- Both final PR CI jobs passed before owner merge.

## Impact and boundaries

- FE-001 added Customer Web integration code, UI components, tests, and
  FE-001 documentation.
- FE-001 itself added no database migration and did not change booking
  business rules.
- `CT-CONTRACT-002` was the only backend prerequisite change: response
  formatting for already-rejected antiforgery requests. It added no migration
  or schema change.
- No deployment, hosting, Admin Web, payment, or CMS capability was introduced.

## Remaining FE-001 requirements

**None.**

The following are real future frontend needs, but they were explicitly outside
the authorized FE-001 boundary and must not keep FE-001 open:

- Hold read, confirmation, and cancellation UI.
- Reservation read and cancellation UI.
- Login, registration, logout, `/auth/me`, and authenticated profile state.
- Reload/crash recovery, persisted booking-secret storage, multiple concurrent
  active Holds, background expiry cleanup, and countdown behavior.
- Payment, tax, surcharge, discount, and currency conversion.
- RoomType detail pages, Admin CRUD, CMS, public hosting, and deployment.

Control Tower should create separate work items for any selected capability
rather than reopening FE-001.

## Decision request — content and representative data

Please decide whether the next initiative should be a controlled,
domain-driven content/data slice before more customer-facing content work.

### Recommended direction

Approve a new planning work item, tentatively:

`DATA-001.1 — Content/media inventory and source-of-truth mapping`

Do **not** continue hard-coding Property, RoomType, RatePlan, price, inventory,
amenity, or media business content in React. Also do **not** copy every Chisfis
template field and image into PostgreSQL merely to make the template look full.

First classify each candidate field:

| Content class | Source of truth | Near-term rule |
| --- | --- | --- |
| Operational/catalog data: Property, RoomType, Amenity, RatePlan, daily rates, inventory controls, media metadata | PostgreSQL through the existing domain/API | Add only real business fields supported by approved domain requirements; populate through the explicit idempotent Development seed |
| Media binaries | Object storage/CDN or another approved media host | PostgreSQL stores URL, alt text, type, sort order, and cover flag; do not store image bytes in PostgreSQL |
| Marketing/editorial content: hero copy, brand story, promotions, FAQ, local guides | Explicit frontend configuration for MVP, or a later CMS/content model | Do not force these fields into Property/RoomType tables without a content-domain decision |
| Template-only demo data: fake reviews, hosts, addresses, bed/bath/size, discounts, popularity labels, unsupported CTAs | No production source of truth | Remove or leave unused; never fabricate it through adapters or seed data |

After the mapping is approved, a separate implementation work item may extend
the existing `DevelopmentDataSeeder` with a curated representative dataset.
That seed must remain:

- explicit and Development-only;
- deterministic/idempotent and safe to rerun;
- non-destructive toward locally customized rates and inventory controls;
- based on real The BHA content where available, or clearly labeled synthetic
  development content;
- compatible with the existing Property/RoomType/RatePlan/Amenity/Media
  architecture;
- licensed for the intended use, with template attribution and asset rights
  checked before reusing bundled images;
- free from production secrets and personal customer data.

Current evidence supports this direction: the existing seed already owns The
BHA Hotel, two RoomTypes, amenities, one RatePlan, rolling rates, inventory
controls, physical rooms, and Media metadata, but its Media URLs use
`images.example.com`. The FE therefore correctly rejects those reserved
example-host URLs and renders a bundled placeholder. Replacing this with a
curated, valid media/data strategy is a data/media task, not unfinished
FE-001 content work.

### Decision fields requested from Control Tower

Return:

1. `FE-001 closure`: PASS/CLOSED or CHANGES REQUIRED.
2. `Next work item`: chosen ID and title.
3. `Content ownership`: approve or amend the four-class mapping above.
4. `Media decision`: approved storage/hosting boundary for development and
   production.
5. `Dataset policy`: real hotel content, synthetic development content, or a
   controlled mixture.
6. `Documentation impact`: whether the decision belongs in
   `PROJECT_BIBLE.md`, an ADR, a component/content design document, or only the
   next plan.
7. `Execution order`: content inventory/mapping first, then seed/API changes,
   then FE presentation.

## Recommended project-state update

Update `SNAPSHOT.md` after accepting this report:

- Current phase: FE/BE booking integration foundation completed.
- Completed: `FE-001.1`, `FE-001.2`, `FE-001.3`, `FE-001.4`,
  `CT-CONTRACT-002`.
- Verified `develop`: `e5d8b218ba6326a22b56b8a7999d0ffd66ef148e`.
- Open PRs: none.
- Test baseline: Frontend `222/222`; Backend `494/494`.
- Known blockers: none.
- Next: Control Tower decision on `DATA-001.1` and the next customer booking
  lifecycle slice.
