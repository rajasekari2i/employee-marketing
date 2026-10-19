# Phase 0 Research: Add Extra Shop — Executive

**Feature**: `007-extra-shops` | **Date**: 2026-10-19

Every decision below is grounded in code that already exists in this repository, or in a board decoded from `docs/ui-design/Field_Sales_Beat_App.html`. Where the product documentation and the design disagree, the disagreement is named rather than smoothed over.

---

## §1 — The two endpoints are already specified; use those paths

**Decision**: `POST /assignments/:id/stops` for the add, `GET /shops/nearby?lat=&lng=&excludeAssignment=` for the picker. Both are taken verbatim from the architecture's API surface table rather than invented here.

`03-ARCHITECTURE.md:824-826`:

```
| POST | `/assignments/:id/stops` | Exec | extra shop, own day |
| POST | `/assignments/:id/stops/manager` | Manager | extra shop with `reason` |
| GET  | `/shops/nearby?lat=&lng=&excludeAssignment=` | Exec | picker source |
```

**Rationale**: the document already decided this, so there is no design question — only a instruction to follow. Worth recording because the obvious instinct is to hang the picker off the assignment (`/assignments/:id/nearby-shops`, which is what this research first proposed); the documented shape puts it on `/shops` and passes the assignment as the *exclusion* parameter, which is the better factoring — the thing being listed is shops, and today's route is a filter on them.

The manager route on line 825 confirms the module boundary without the manager flow being in scope here: both extra-shop commands live under `/assignments/:id/stops`, differing only by role and the manager's extra `reason`. Building the executive one at that path leaves the manager's as a sibling rather than a refactor.

**Module placement**: the add belongs to `assignments`, whose controller is already `@Controller('assignments')` with class-level `@Roles('MARKETING_EXECUTIVE')` and the `requireCompanyId` / `requireExecutiveId` helpers, so it inherits the three-layer scoping (company → RLS → own executive id) with nothing new to invent. `GET /shops/nearby` is an executive route on a `/shops` path, which is the same situation as `POST /shops/:id/pin` — and `visits.controller.ts:34-36` already records the resolution: that route lives with the executive's field flow rather than in the admin-only shops module, "because it is the executive's field flow", not because of the noun in its path. `/shops/nearby` follows it.

**Audit**: `@Audited('extra-shop.create', 'AssignmentStop')`, matching the dotted `entity.verb` convention the `AuditEvent` model documents by example (`"shop.pin.approved"`, `03-ARCHITECTURE.md:725`).

---

## §2 — Nearest-first without a spatial database

**Decision**: a two-stage read. SQL narrows the candidate set and applies the exclusions; the existing `haversineMetres` ranks what comes back.

1. SQL selects the company's **active** shops, excluding every `shopId` already on today's assignment, applying the search term when present.
2. When there is **no** search term and the device supplied a position, SQL additionally applies a **bounding box** — a latitude/longitude window around the executive — so a large directory never loads whole.
3. When there **is** a search term, no bounding box is applied: FR-006 must find a shop by name wherever it is.
4. `haversineMetres` computes each distance in Node, the list sorts, and a page is returned.

**Rationale**: this is the architecture's own decision, not a new one. `D-13` (`03-ARCHITECTURE.md:29`) reads *"Geo distance | Haversine in SQL/Node + a bounding-box pre-filter, lat/lng as `Decimal` | Avoids a PostGIS dependency on Railway's Postgres image; PostGIS is a later upgrade"*, and §8 (`:776-787`) writes this exact query out for this exact screen, naming PRD FR-EXTRA-02:

```sql
WHERE "companyId" = $1 AND "isActive"
  AND latitude  BETWEEN $2 AND $3   -- lat ± (radiusKm / 111.32)
  AND longitude BETWEEN $4 AND $5   -- lng ± (radiusKm / (111.32 * cos(lat)))
  AND id <> ALL($6)                 -- shops already in today's list
LIMIT 200;
```

The `LIMIT 200` is adopted as written — it is the only hard list cap stated anywhere in the document. The upgrade path is likewise already recorded as **ADR-0007** and open decision **T-04** (*"PostGIS now or later? Later; bounding box + Haversine is enough at the stated volumes"*), so deferring it is the documented position rather than a shortcut.

`haversine.ts` already exists in the repository and its doc comment states the governing rule — it is "the product's single distance implementation" and "the device never computes a distance for any purpose, cosmetic or otherwise". `assignments.service.ts:555` (`nearestShopName`) already does this shape of work for the running beat card. Note the architecture puts the function at `packages/shared/src/geo.ts` while the repository has it at `apps/api/src/modules/visits/haversine.ts`; the repository's placement is correct in practice, since only server code may compute a distance, and moving it into the shared package would put it where the device could import it.

The `Shop.geohash` column and its `@@index([companyId, geohash])` exist, but no documented query uses them — the documented nearby path is bounding box plus Node-side Haversine. Writing and indexing geohashes is a later optimisation; nothing here prevents it, because the ordering lives behind one service method.

**Two deliberate departures from the documented SQL**, both forced by requirements the SQL predates:

1. **Pin-less shops must still be listed.** Board 1.4 draws a shop whose chip reads "No pin — capture on arrival", and FR-005 requires it. The documented `latitude BETWEEN … AND longitude BETWEEN …` silently drops every row with `NULL` coordinates, which would remove exactly those shops. The bounding box is therefore applied **only to rows that have coordinates**; a shop without them is never filtered out by a geometry it does not have. It has no distance, and sorts after the ones that do, by name.
2. **A search term lifts the box entirely.** FR-006 must find a shop by name wherever it is, and a shop 30 km away is still addable. The window applies to the unsearched "nearby" list only.

**When the device has no fix at all**, every shop sorts by name and no distance is shown. FR-004's ordering is a convenience; refusing the screen because a GPS fix was slow would be the worse failure (spec, *Reasonable defaults*).

**Alternatives considered**:
- Sorting in SQL with an expression. Rejected: it would be a second distance implementation in a second language, which is precisely what `haversine.ts` was extracted to prevent.
- Loading the whole directory and sorting in Node unconditionally. Rejected for a 500-shop company (SC-002) — the bounding box costs one `WHERE` clause and removes the cliff.

---

## §3 — What the picker may show an executive

**Decision**: a response shape authored for this screen, carrying exactly `id`, `name`, `addressLine`, `pinStatus`, `beatPlanName | null` and `distanceMeters | null`. It does **not** reuse `ShopListItem`.

**Rationale**: `ShopsService.toListItem` returns raw `latitude` / `longitude`, and the field's own comment justifies that as "Returned to the Company Admin only". Serving it to an executive would hand the device the coordinates it needs to compute its own range verdict — the exact inference `assignments.service.ts:461-467` drops `effectiveRadiusMeters` and the shop coordinates at the response boundary to prevent. A separate shape makes the restriction structural: the fields are not merely hidden, they are never selected.

**On the distance this screen does show** — FR-021. There are two different numbers, and they must not converge:

| | Picker distance | Visit measurement |
|---|---|---|
| Measured from | the executive's position *now* | the position sent *with the submission* |
| Measured to | a shop **not** on today's list | the stop's **frozen** approved coordinate |
| Shown to the executive | yes, rounded, as an aid to recognition | **never** |
| Decides anything | no | yes — `isExceedRange`, `PENDING_REVIEW` |

The exclusion in FR-EXTRA-08 does useful double duty here: because the picker never lists a shop already on today's route, an executive cannot use it to range-find a stop they are about to visit.

**This is not a claim that the inference is impossible**, and the spec does not pretend otherwise. An executive could add a shop, observe the distance the picker showed beforehand, and infer something about their proximity. The bound is narrow — the number is rounded, it is gone once the shop joins the list, and the radius itself is still never disclosed — and the user chose to match the board with full knowledge of the trade-off. Recording it here is the honest alternative to asserting a guarantee that does not hold.

---

## §4 — What `sequence` means for an extra stop

**Decision**: an extra stop is created with `sequence` set to one past the current maximum on that assignment. It is a tiebreak, not a position.

**Rationale**: `orderStops` (`assignments.service.ts:521`) sorts by status group first, then extras ahead of planned stops within a group, and only then by `sequence`. `StopRow` in the mobile list renders `'EX'` in place of the number for any non-`PLAN` stop (`TodaysBeatScreen.tsx:1090`), so the value is never displayed. Appending keeps extras in the order they were added, which is the only ordering the executive could reasonably expect, and matches the board's footer wording "Adding **Vasanth Super Mart** as stop 13 today."

The footer's "stop N" is therefore **a count of today's stops plus one**, not the `sequence` column — the board is describing the day's size, and the two must not be confused in the implementation.

---

## §5 — Making a double add impossible

**Decision**: lean on the existing `@@unique([assignmentId, shopId])` on `AssignmentStop`; catch `P2002` and translate it to a new `409 SHOP_ALREADY_IN_BEAT`.

**Rationale**: the constraint is already in the schema and its comment already explains why it is two columns rather than three — the three-column form "would let the same shop appear twice on one day at two sequence numbers, which contradicts BUS-08". So the database already refuses the duplicate; this feature only has to report it well. That makes FR-011 a database fact rather than an application check, which is what makes it survive two devices racing (SC-005).

`ensureTodayRoute` already establishes the house pattern for this exact situation at `assignments.service.ts:317-339`: catch `P2002`, re-read, return the winner. Here the resolution differs — the caller asked to add a shop that is already there, which is a refusal rather than a silent success, because reporting success would tell the executive they added something they did not.

The new code is added in the three places `errors.ts` requires (`ERROR_CODES`, `ERROR_STATUS`, `ERROR_TITLES`), following the `STOP_ALREADY_COMPLETED` / `PIN_ALREADY_SET` naming and its 409 status.

**On idempotency**: `Idempotency-Key` is required, as for every state-changing POST. A genuine retry of the *same* request replays the stored response; a *different* request that happens to name an already-added shop gets the 409. These are different situations and the two mechanisms handle one each.

---

## §6 — Creating a shop from the field (FR-016 … FR-018)

**Decision**: a dedicated executive route, `POST /assignments/:id/stops` accepting **either** an existing `shopId` **or** a `newShop` object, creating the shop and the stop in one transaction. The created shop's location is **not** auto-approved.

**Rationale**: three things rule out simply pointing the executive at `POST /shops`.

1. **Role.** `ShopsController` is class-level `@Roles('COMPANY_ADMIN')`. An executive gets 403.
2. **Approval.** `ShopsService.create` sets `locationStatus: 'APPROVED'` with `locationVerifiedBy` set to the caller when a location is supplied, and its comment justifies that by the caller being a Company Admin — "a brand-new shop has no prior approved pin to protect". That reasoning does not transfer to an executive, and FR-018 requires the opposite: the shop must be identifiable as awaiting the admin's confirmation. The executive-created shop therefore takes `PENDING_VERIFICATION` unless the company's auto-approve setting says otherwise — the same setting, and the same code path, as executive pin capture in `shop-pin.service.ts`.
3. **Atomicity.** FR-017 requires the shop and the stop to arrive together. Two calls from the device could leave a shop created and never added, which is exactly the orphan the "one transaction" rule exists to prevent.

**`shopCode` is generated by the server, not typed by the executive.** `createShopSchema` requires it (`min(1).max(64)`) and it is unique per company, but asking someone standing in front of a shop to invent a unique code is a bad field interaction and a collision waiting to happen. The server derives one and retries on `DUPLICATE_SHOP_CODE`. The Company Admin can rename it during review.

**Consequence, recorded rather than hidden**: with auto-approval off, an executive can create a shop and then not be able to record an outcome there, because an outcome requires an `APPROVED` location. This is the same dead-end slice 006 flagged for pin capture, now reachable by a second route. The recommendation is unchanged — **the pilot company should have auto-approval enabled**.

**Alternatives considered**:
- Widening `POST /shops` to accept executives. Rejected: it would put two very different trust models through one method, and the approval difference would become an `if` inside admin code.
- Creating the shop first, then adding the stop in a second request. Rejected: breaks FR-017 and can orphan a shop.

---

## §7 — The entry point, and the day with no beat plan

**Decision (entry point)**: the dashed button board 1.3 already draws. Decoding the board shows it under `<sc-if value="{{active}}">`, in the slot directly above the stop list — the same slot that holds the locked strip when the beat has not started:

```html
<a href="AddShop.dc.html" style="flex-shrink: 0; display: flex; align-items: center;
   justify-content: center; gap: 8px; height: 48px; border-radius: 14px;
   border: 1.5px dashed #1D4ED8; color: #1D4ED8;
   font: 700 15px 'Figtree',sans-serif; text-decoration: none">
  <svg …stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>Add extra shop to today</a>
```

It is **not** beside "End beat" in the running strip. `TodaysBeatScreen.tsx:569-575` already renders that slot for `NOT_STARTED` and `ENDED`; the `RUNNING` case currently renders nothing, which is the gap this feature fills. Identical styling to board 1.4's own "Shop not listed — create new" button, so one shared dashed-button treatment serves both.

**Decision (no-plan day)**: creating a plan-less `DailyAssignment` is **in scope**, so that a day with no beat plan can be started and can hold extra stops.

**Rationale**: `ensureTodayRoute` returns `{ assignment: null, noBeatReason: 'NO_BEAT_PLAN' | 'NOT_A_WORKING_DAY' }` and creates no row. `start()` takes an `assignmentId`. So today, on a non-working day or with no plan assigned, there is nothing to start and therefore nothing to add an extra shop to — while PRD FR-ASSIGN-10 explicitly promises the opposite: *"If no assignment exists for today … the screen explains which and offers Add extra shop once the beat is started."* `DailyAssignment.beatPlanId` was made nullable in slice 005 for precisely this, its data model recording "a day can exist with no plan behind it once extra-shop-only days are possible". That day has arrived.

This is the one place this feature reaches back into slice 005's state machine, so it is called out as a deliberate change rather than absorbed quietly: the no-beat card gains a way to start an empty day, and `GET /assignments/today` keeps reporting *why* the day is empty so the card's existing copy still works.

**Alternatives considered**: leaving it out and softening the spec's edge case. Rejected — it would leave FR-ASSIGN-10 unmet and would withhold the feature exactly on the days an executive most needs it.

---

## §8 — Capturing the position, and saying so

**Decision**: the screen requests a position on mount through the existing `getCurrentPosition()`, renders immediately without waiting, and fills in distances when the fix arrives. The permission rationale in `location.ts` gains a clause about finding nearby shops.

**Rationale**: `location.ts` already solves the hard parts — two attempts with a coarse fallback, a non-zero `maximumAge`, an `inFlight` single-flight guard, and the `'android'` provider that a native crash forced in slice 006. Reusing it unchanged means this screen inherits those fixes instead of rediscovering them.

The rationale string is load-bearing, not cosmetic. Slice 006 made it the *only* place the app discloses location use, because the confirm sheet was deliberately silenced (006's FR-018 — note this slice renumbers from FR-001, so its own FR-018 is a different requirement). Adding a third use without widening it would make that disclosure incomplete — so FR-020 requires the wording to cover beat start/end, recording a visit, **and** finding shops nearby.

**Rendering must not block on the fix.** A cold fix can take seconds; the search box and the list are useful before it lands. Distances appear when available, which also makes the no-fix path (§2) a degradation rather than a special case.

---

## §9 — Offline: the add queues, the picker does not

**Decision**: the add goes through the existing outbox. The picker does not, because it is a read.

**This reverses an earlier judgement in this research**, and the reversal is the point of recording it. The first pass concluded that adding an extra shop should simply require a connection. `03-ARCHITECTURE.md:1016` settles it the other way, and explicitly:

> Only visit submission, extra-shop addition, pin capture and beat start/end are queueable. Reads are never queued; they fall back to the last cached payload with a visible "showing saved data" banner.

Extra-shop addition is named. Constitution rule 7 says the same at `:1167-1168`. So the add queues.

**Rationale**: the cost is genuinely small, which is what makes the earlier conclusion wrong rather than merely different. `outbox.ts` already exists from slice 006 with `enqueue`, FIFO `sync`, a key minted at record time, restart survival and permanent-rejection handling. This feature adds one `HeldKind` (`'STOP'`) and one call site. The hard parts were paid for last slice.

**What queueing does and does not buy**, stated plainly so the limitation is not discovered later:

- The add is never lost, never reported as a failure, and records exactly once however many times it is retried — the same guarantee a visit gets.
- `GET /shops/nearby` is a read and stays unqueued, per the same rule. So the *screen* still needs a connection to be useful: without one there is nothing to rank and nothing to pick from. Caching the directory for offline browsing is a separate concern the architecture does not ask for here.
- **A stop added while offline cannot be visited until it syncs**, because the stop id the visit is recorded against is the server's. The executive is told the shop is waiting to sync rather than being shown a stop they cannot open. Closing that gap needs the device to mint an id the server adopts — a change to the visit contract, not to this feature.

**Ordering matters and is already handled.** `sync()` sends oldest-first and stops at the first transient failure, which is exactly what 006's FR-042 established for a pin capture queued ahead of the visit that depends on it. An add queued ahead of anything touching its stop inherits that property for free.

---

## §10 — Showing a distance

**Decision**: metres below 1000 (`90 m`), kilometres with one decimal at or above (`1.2 km`) — the two forms board 1.4 shows. Formatted on the **server**, alongside the raw `distanceMeters`.

**Rationale**: the board shows both forms and nothing in between, so the rule is read directly off the design rather than invented. Formatting server-side keeps the "one distance implementation" rule whole in spirit as well as letter — the device neither computes nor interprets a distance, it renders a string. The raw number is included so the client can sort stably without re-deriving anything.

---

## §11 — OD-08 is already resolved at the architecture level

**Decision**: an executive's extra shop is added immediately, with no manager approval. Implement it that way without treating it as an open question.

**Rationale**: the BRD lists `OD-08` as *"Does the executive's extra shop need manager approval first? No; added immediately and shown to the manager as an extra visit"* but still marks it **needs client confirmation**. The architecture's own open-decisions table resolves it (`03-ARCHITECTURE.md:1195`):

> `| T-01 | Does the executive's extra shop need manager approval? | No for release 1; flag it as an extra visit (BRD OD-08) | Slice 010 |`

Board 1.4 agrees — its button adds the shop to today's list with no approval step anywhere on the screen. Three sources concur, so this feature implements immediate addition. The spec still records it as *flagged* rather than settled, because "needs client confirmation" is the client's word to give, not the architecture's; what changes is that the default is now well-supported rather than assumed.

---

## Summary of new surface

| Layer | What is added |
|---|---|
| Prisma | **Nothing structural.** `StopSource.EXEC_EXTRA`, `addedByUserId`, `addedAt` and `@@unique([assignmentId, shopId])` already exist and have had no writer until now. |
| Shared | `extra-shops.schema.ts` — `addExtraStopSchema` (`.strict()`), `nearbyShopsQuerySchema`; re-exports in `index.ts`; one new error code in the three required places. |
| API | `GET /shops/nearby` (picker) and `POST /assignments/:id/stops` (add, idempotent, audited) — both at the paths `03-ARCHITECTURE.md:824-826` already specifies. Plan-less day creation in `assignments.service.ts`. |
| Mobile | `AddExtraShopScreen` (board 1.4), the dashed entry button on board 1.3's running state, one `ExecutiveStackParamList` entry, one new outbox `HeldKind`, and the `pinStatus` type widened to include `PENDING_VERIFICATION` — which the server can already return and the mobile types still omit. |
